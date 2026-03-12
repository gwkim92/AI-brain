import { generateResearchArtifact } from './research';
import {
  buildPlannerPromptWithMemory,
  resolveMemoryBackedRouting,
  resolveJarvisMemoryContext,
  resolveJarvisMemoryPlan,
  resolveJarvisMemoryPreferences,
  type JarvisMemoryContext,
  type JarvisMemoryPlanSignal,
  type JarvisMemoryPreferenceHints
} from './memory-context';
import {
  buildJarvisStagePlan,
  ensureJarvisSessionStages,
  getJarvisSessionOrchestrationSnapshot,
  syncJarvisSessionFromStages,
  type JarvisNextAction
} from './stages';
import {
  mapResearchProfileToJarvisIntent,
  resolveResearchProfile,
  shouldRouteByResearchProfile
} from '../retrieval/research-profile';

import { startCouncilRun } from '../council/run-service';
import { resolveModelSelection } from '../providers/model-selection';
import type { ProviderCredentialsByProvider, ProviderName } from '../providers/types';
import { buildSimplePlan, classifyComplexity } from '../orchestrator/complexity';
import { generatePlan, planToMissionInput, type OrchestratorPlan } from '../orchestrator/planner';
import type {
  JarvisCapability,
  JarvisSessionIntent,
  JarvisSessionPrimaryTarget,
  JarvisSessionRecord,
  JarvisSessionStageRecord,
  JarvisSessionStatus,
  JarvisStore,
  JarvisWorkspacePreset,
  TaskMode
} from '../store/types';
import type { RouteContext } from '../routes/types';

function truncateText(value: string, maxLength = 120): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

export function inferJarvisIntent(prompt: string): JarvisSessionIntent {
  if (/(agent\s*council|에이전트\s*카운슬|agent council로|council로 보내|카운슬로 보내|debate|토론하고 최종 결론|찬성[\\/· ,]+반대|찬반|반대 관점|리스크 관점)/iu.test(prompt)) {
    return 'council';
  }
  if (/(코드|개발|버그|리팩토링|테스트|배포|\bdebug\b|\bcode\b|\brefactor\b|\btest\b|\bdeploy\b)/iu.test(prompt)) return 'code';
  if (/(리서치|연구|조사|분석|비교|근거와 함께|브리프|브리핑|research|study|analyze|compare|brief)/iu.test(prompt)) return 'research';
  if (/(금융|주식|환율|시장|거시|finance|market|stocks|fx)/iu.test(prompt)) return 'finance';
  if (/(뉴스|브리핑|속보|전쟁|헤드라인|news|briefing|headline|war)/iu.test(prompt)) return 'news';
  return 'general';
}

function resolveWorkspacePreset(intent: JarvisSessionIntent): JarvisWorkspacePreset {
  if (intent === 'code') return 'execution';
  if (intent === 'research' || intent === 'finance' || intent === 'news' || intent === 'council') return 'research';
  return 'jarvis';
}

function resolveTaskMode(intent: JarvisSessionIntent): TaskMode {
  if (intent === 'code') return 'code';
  if (intent === 'council') return 'council';
  if (intent === 'research' || intent === 'finance' || intent === 'news') return 'radar_review';
  return 'execute';
}

function resolvePrimaryTarget(intent: JarvisSessionIntent, complexity: ReturnType<typeof classifyComplexity>): JarvisSessionPrimaryTarget {
  if (intent === 'council') return 'council';
  if (intent === 'research' || intent === 'finance' || intent === 'news') return 'dossier';
  if (complexity === 'simple') return 'assistant';
  return 'mission';
}

export function mapMissionStatusToSessionStatus(status: string): JarvisSessionStatus {
  if (status === 'running') return 'running';
  if (status === 'blocked') return 'blocked';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'needs_approval';
}

export type ExecuteJarvisRequestInput = {
  userId: string;
  prompt: string;
  source: string;
  clientSessionId?: string;
  targetHint?: 'assistant';
  provider?: ProviderName | 'auto';
  strictProvider?: boolean;
  model?: string;
  traceId?: string;
  credentialsByProvider?: ProviderCredentialsByProvider;
};

export type ExecuteJarvisRequestResult = {
  session: JarvisSessionRecord;
  requested_capabilities: JarvisCapability[];
  active_capabilities: JarvisCapability[];
  completed_capabilities: JarvisCapability[];
  stages: JarvisSessionStageRecord[];
  next_action: JarvisNextAction;
  research_profile: string | null;
  research_profile_reasons: string[];
  quality_mode: 'pass' | 'warn' | 'block' | null;
  warning_codes: string[];
  format_hint: string | null;
  quality_dimensions: Record<string, unknown> | null;
  memory_context: JarvisMemoryContext | null;
  memory_plan_signals: JarvisMemoryPlanSignal[];
  memory_plan_summary: string[];
  memory_preference_summary: string[];
  memory_preference_applied: string[];
  memory_influences: string[];
  execution_option: string | null;
  preferred_provider_applied: string | null;
  preferred_model_applied: string | null;
  project_context_refs: {
    repo_slug: string | null;
    project_name: string | null;
    pinned_refs: string[];
  } | null;
  monitoring_preference_applied: string | null;
  delegation: {
    intent: JarvisSessionIntent;
    complexity: 'simple' | 'moderate' | 'complex';
    primary_target: JarvisSessionPrimaryTarget;
    capabilities: JarvisCapability[];
    task_id?: string;
    mission_id?: string;
    assistant_context_id?: string;
    council_run_id?: string;
    briefing_id?: string;
    dossier_id?: string;
    action_proposal_id?: string;
    planner_mode?: 'llm' | 'fallback';
    error?: string;
  };
};

function compactLines(lines: string[], maxCount = 3): string[] {
  return lines.map((line) => line.trim()).filter(Boolean).slice(0, maxCount);
}

function buildResearchMemoryContent(input: {
  prompt: string;
  profile: string;
  summary: string;
  warningCodes: string[];
}): string {
  const lines = [
    `Prompt: ${input.prompt}`,
    `Research profile: ${input.profile}`,
    `Summary: ${input.summary}`
  ];
  if (input.warningCodes.length > 0) {
    lines.push(`Warnings: ${input.warningCodes.join(', ')}`);
  }
  return lines.join('\n');
}

function buildProjectMemoryContent(input: {
  prompt: string;
  missionTitle: string;
  plannerMode: 'llm' | 'fallback';
  stepTitles: string[];
}): string {
  const lines = [
    `Prompt: ${input.prompt}`,
    `Mission: ${input.missionTitle}`,
    `Planner mode: ${input.plannerMode}`
  ];
  const steps = compactLines(input.stepTitles, 4);
  if (steps.length > 0) {
    lines.push(`Steps: ${steps.join(' | ')}`);
  }
  return lines.join('\n');
}

function resolveExecutionOptionFromMemory(
  signals: JarvisMemoryPlanSignal[]
): 'approval_required_write' | 'read_only_review' {
  if (
    signals.includes('approval_sensitive_preference') ||
    signals.includes('risk_first_preference') ||
    signals.includes('recent_rejection_history')
  ) {
    return 'read_only_review';
  }
  return 'approval_required_write';
}

function buildExecutionPlanningCopy(input: {
  memoryPlanSignals: JarvisMemoryPlanSignal[];
  plannerMode: 'llm' | 'fallback';
}) {
  const executionOption = resolveExecutionOptionFromMemory(input.memoryPlanSignals);
  if (executionOption === 'read_only_review') {
    return {
      executionOption,
      proposalTitle: 'Review read-only execution plan',
      proposalSummary: 'Start with read-only checks and explicit approval gates before any write execution.',
      approvalSummary: 'Review read-only checks and approve execution',
      blockedSummary: 'Waiting for read-only review and approval before execution',
      planSummary: `Mission planned via ${input.plannerMode} with read-only review first`
    };
  }

  return {
    executionOption,
    proposalTitle: 'Review write execution plan',
    proposalSummary: 'Review the generated plan, confirm any write operations, and approve execution.',
    approvalSummary: 'Review write execution and approve run',
    blockedSummary: 'Waiting for approval before write execution',
    planSummary: `Mission planned via ${input.plannerMode} with approval required for write execution`
  };
}

async function captureResearchMemory(
  store: JarvisStore,
  input: {
    userId: string;
    sessionId: string;
    taskId?: string | null;
    title: string;
    prompt: string;
    profile: string;
    summary: string;
    warningCodes: string[];
  }
) {
  await store.createMemoryNote({
    userId: input.userId,
    kind: 'research_memory',
    title: input.title,
    content: buildResearchMemoryContent({
      prompt: input.prompt,
      profile: input.profile,
      summary: input.summary,
      warningCodes: input.warningCodes
    }),
    tags: ['research', input.profile, ...input.warningCodes].slice(0, 8),
    pinned: false,
    source: 'session',
    relatedSessionId: input.sessionId,
    relatedTaskId: input.taskId ?? null
  });
}

async function captureProjectMemory(
  store: JarvisStore,
  input: {
    userId: string;
    sessionId: string;
    taskId?: string | null;
    prompt: string;
    missionTitle: string;
    plannerMode: 'llm' | 'fallback';
    stepTitles: string[];
  }
) {
  await store.createMemoryNote({
    userId: input.userId,
    kind: 'project_context',
    title: `Plan: ${truncateText(input.missionTitle, 72)}`,
    content: buildProjectMemoryContent({
      prompt: input.prompt,
      missionTitle: input.missionTitle,
      plannerMode: input.plannerMode,
      stepTitles: input.stepTitles
    }),
    tags: ['plan', input.plannerMode, 'mission'].slice(0, 8),
    pinned: false,
    source: 'session',
    relatedSessionId: input.sessionId,
    relatedTaskId: input.taskId ?? null
  });
}

function resolveWatcherKind(intent: JarvisSessionIntent): 'external_topic' | 'market' | 'company' {
  if (intent === 'finance') return 'market';
  if (intent === 'research') return 'company';
  return 'external_topic';
}

function buildMemoryResponseMeta(input: {
  memoryContext: JarvisMemoryContext | null;
  memoryPreferences: JarvisMemoryPreferenceHints | null;
  memoryPlan: { signals: JarvisMemoryPlanSignal[]; summary: string[] } | null;
  memoryRouting: { applied: string[] };
  executionOption?: string | null;
}) {
  const preferredProviderApplied =
    input.memoryRouting.applied
      .find((value) => value.startsWith('preferred_provider:'))
      ?.slice('preferred_provider:'.length) ?? null;
  const preferredModelApplied =
    input.memoryRouting.applied
      .find((value) => value.startsWith('preferred_model:'))
      ?.slice('preferred_model:'.length) ?? null;

  return {
    memory_context: input.memoryContext,
    memory_plan_signals: input.memoryPlan?.signals ?? [],
    memory_plan_summary: input.memoryPlan?.summary ?? [],
    memory_preference_summary: input.memoryPreferences?.summary ?? [],
    memory_preference_applied: input.memoryRouting.applied,
    memory_influences: Array.from(
      new Set([
        ...(input.memoryPlan?.summary ?? []),
        ...(input.memoryPreferences?.summary ?? []),
        ...input.memoryRouting.applied,
        ...(input.memoryContext?.projectContext?.summary ?? []),
        ...(input.memoryContext?.recentDecisionSignals?.summary ?? []),
      ])
    ),
    execution_option: input.executionOption ?? null,
    preferred_provider_applied: preferredProviderApplied,
    preferred_model_applied: preferredModelApplied,
    project_context_refs: input.memoryContext?.projectContext
      ? {
          repo_slug: input.memoryContext.projectContext.repoSlug ?? null,
          project_name: input.memoryContext.projectContext.projectName ?? null,
          pinned_refs: input.memoryContext.projectContext.pinnedRefs ?? [],
        }
      : null,
    monitoring_preference_applied: input.memoryContext?.preferences?.monitoringPreference ?? null,
  };
}

const MEMORY_RESEARCH_PROMPT_PATTERN =
  /(업데이트|최신|최근|변화|동향|정리|요약|요약해|브리프|summary|brief|latest|update|changes|status|what'?s new)/iu;
function shouldPromotePromptToResearch(input: {
  prompt: string;
  targetHint?: 'assistant';
  inferredIntent: JarvisSessionIntent;
  profileDecision: ReturnType<typeof resolveResearchProfile> | null;
  memoryContext: JarvisMemoryContext | null;
}): boolean {
  if (input.targetHint === 'assistant') return false;
  if (input.inferredIntent !== 'general') return false;
  if (input.profileDecision && shouldRouteByResearchProfile(input.profileDecision)) return false;
  if (!MEMORY_RESEARCH_PROMPT_PATTERN.test(input.prompt)) return false;
  return (
    input.memoryContext?.notes.some(
      (note) => note.kind === 'research_memory' || note.kind === 'project_context'
    ) ?? false
  );
}

async function buildExecutionSnapshot(
  store: JarvisStore,
  input: { userId: string; sessionId: string }
): Promise<
  Pick<
    ExecuteJarvisRequestResult,
    | 'requested_capabilities'
    | 'active_capabilities'
    | 'completed_capabilities'
    | 'stages'
    | 'next_action'
    | 'research_profile'
    | 'research_profile_reasons'
    | 'quality_mode'
    | 'warning_codes'
    | 'format_hint'
    | 'quality_dimensions'
    | 'memory_plan_signals'
    | 'memory_plan_summary'
    | 'memory_preference_summary'
    | 'memory_preference_applied'
    | 'memory_influences'
    | 'execution_option'
    | 'preferred_provider_applied'
    | 'preferred_model_applied'
    | 'project_context_refs'
    | 'monitoring_preference_applied'
  >
> {
  const snapshot = await getJarvisSessionOrchestrationSnapshot(store, input);
  return {
    requested_capabilities: snapshot?.requestedCapabilities ?? [],
    active_capabilities: snapshot?.activeCapabilities ?? [],
    completed_capabilities: snapshot?.completedCapabilities ?? [],
    stages: snapshot?.stages ?? [],
    next_action: snapshot?.nextAction ?? null,
    research_profile: snapshot?.researchProfile ?? null,
    research_profile_reasons: snapshot?.researchProfileReasons ?? [],
    quality_mode: snapshot?.qualityMode ?? null,
    warning_codes: snapshot?.warningCodes ?? [],
    format_hint: snapshot?.formatHint ?? null,
    quality_dimensions: snapshot?.qualityDimensions ?? null,
    memory_plan_signals: snapshot?.memoryPlanSignals ?? [],
    memory_plan_summary: snapshot?.memoryPlanSummary ?? [],
    memory_preference_summary: [],
    memory_preference_applied: [],
    memory_influences: [],
    execution_option: snapshot?.executionOption ?? null,
    preferred_provider_applied: null,
    preferred_model_applied: null,
    project_context_refs: null,
    monitoring_preference_applied: null
  };
}

export async function executeJarvisRequest(
  ctx: RouteContext,
  input: ExecuteJarvisRequestInput
): Promise<ExecuteJarvisRequestResult> {
  const { store, providerRouter, env, notificationService } = ctx;
  const prompt = input.prompt.trim();
  const title = truncateText(prompt, 90);
  const inferredIntent = inferJarvisIntent(prompt);
  const profileDecision =
    input.targetHint === 'assistant'
      ? null
      : resolveResearchProfile({
          prompt,
          intent: inferredIntent,
          taskType: 'jarvis_request',
          targetHint: input.targetHint
        });
  const complexity = classifyComplexity(prompt);
  const memoryContext = await resolveJarvisMemoryContext(store, {
    userId: input.userId,
    prompt,
    limit: 4
  });
  const memoryPreferences = resolveJarvisMemoryPreferences(memoryContext);
  const memoryPlan = resolveJarvisMemoryPlan(memoryContext);
  const memoryPromotedResearch = shouldPromotePromptToResearch({
    prompt,
    targetHint: input.targetHint,
    inferredIntent,
    profileDecision,
    memoryContext
  });
  const intent =
    memoryPromotedResearch
      ? 'research'
      : profileDecision && shouldRouteByResearchProfile(profileDecision) && inferredIntent !== 'council' && inferredIntent !== 'code'
        ? mapResearchProfileToJarvisIntent(profileDecision.profile)
        : inferredIntent;
  const primaryTarget = input.targetHint === 'assistant' ? 'assistant' : resolvePrimaryTarget(intent, complexity);
  const workspacePreset = input.targetHint === 'assistant' ? 'jarvis' : resolveWorkspacePreset(intent);
  const stagePlan = buildJarvisStagePlan({
    prompt,
    intent,
    complexity,
    primaryTarget,
    targetHint: input.targetHint,
    memoryPlanSignals: memoryPlan?.signals ?? [],
    memoryPreferences,
    researchProfile: profileDecision?.profile ?? null
  });
  const capabilities = stagePlan.map((stage) => stage.capability);
  const memoryRouting = resolveMemoryBackedRouting({
    provider: input.provider,
    strictProvider: input.strictProvider,
    model: input.model,
    memoryPreferences
  });
  const buildRequestMemoryMeta = (executionOption?: string | null) =>
    buildMemoryResponseMeta({
      memoryContext,
      memoryPreferences,
      memoryPlan,
      memoryRouting,
      executionOption
    });

  const session = await store.createJarvisSession({
    id: input.clientSessionId,
    userId: input.userId,
    title,
    prompt,
    source: input.source,
    intent,
    status: 'running',
    workspacePreset,
    primaryTarget
  });
  await ensureJarvisSessionStages(store, {
    userId: input.userId,
    sessionId: session.id,
    stages: stagePlan,
    runningStageKey: stagePlan[0]?.stageKey
  });

  await store.appendJarvisSessionEvent({
    userId: input.userId,
    sessionId: session.id,
    eventType: 'session.created',
    status: 'running',
    summary: `Intent resolved as ${intent}`,
    data: {
      intent,
      complexity,
      capabilities,
      primary_target: primaryTarget,
      source: input.source,
      research_profile: profileDecision?.profile ?? null,
      memory_intent_promoted: memoryPromotedResearch,
      memory_plan_signals: memoryPlan?.signals ?? [],
      memory_preference_summary: memoryPreferences?.summary ?? [],
      memory_preference_applied: memoryRouting.applied
    }
  });
  if (memoryPromotedResearch) {
    await store.appendJarvisSessionEvent({
      userId: input.userId,
      sessionId: session.id,
      eventType: 'memory.intent.promoted',
      status: 'running',
      summary: '기존 조사 맥락을 참고해 이번 요청을 리서치 세션으로 승격했습니다.',
      data: {
        from_intent: inferredIntent,
        to_intent: intent,
        signals: memoryPlan?.signals ?? []
      }
    });
  }
  if (memoryContext) {
    await store.appendJarvisSessionEvent({
      userId: input.userId,
      sessionId: session.id,
      eventType: 'memory.context.loaded',
      status: 'running',
      summary: `${memoryContext.notes.length} memory note(s) applied`,
      data: {
        summary: memoryContext.summary,
        applied_hints: memoryContext.appliedHints,
        notes: memoryContext.notes.map((note) => ({
          id: note.id,
          kind: note.kind,
          title: note.title,
          pinned: note.pinned,
          source: note.source,
          updated_at: note.updatedAt,
          related_session_id: note.relatedSessionId,
          related_task_id: note.relatedTaskId
        }))
      }
    });
  }
  if (memoryPlan) {
    await store.appendJarvisSessionEvent({
      userId: input.userId,
      sessionId: session.id,
      eventType: 'memory.plan.resolved',
      status: 'running',
      summary: `${memoryPlan.signals.length} planner memory signal(s) applied`,
      data: {
        signals: memoryPlan.signals,
        summary: memoryPlan.summary
      }
    });
  }

  await store.appendJarvisSessionEvent({
    userId: input.userId,
    sessionId: session.id,
    eventType: 'session.capabilities.resolved',
    status: 'running',
    summary: `Capabilities: ${capabilities.join(', ')}`,
    data: {
      capabilities
    }
  });

  if (primaryTarget === 'dossier') {
    await store.appendJarvisSessionEvent({
      userId: input.userId,
      sessionId: session.id,
      eventType: 'retrieval.started',
      status: 'running',
      summary: 'Gathering grounded evidence',
      data: {}
    });

    try {
      const artifact = await generateResearchArtifact(prompt, {
        strictness: intent === 'news' ? 'news' : 'default',
        intent: inferredIntent,
        taskType: primaryTarget,
        targetHint: input.targetHint,
        responseStyle: memoryPreferences?.responseStyle ?? null,
      });
      await store.appendJarvisSessionEvent({
        userId: input.userId,
        sessionId: session.id,
        eventType: 'retrieval.query.completed',
        status: 'running',
        summary: `${artifact.sources.length} grounded sources fetched`,
        data: {
          query: artifact.query,
          source_count: artifact.sources.length
        }
      });
      await store.appendJarvisSessionEvent({
        userId: input.userId,
        sessionId: session.id,
        eventType: 'retrieval.ranked',
        status: 'running',
        summary: `${artifact.sources.length} sources ranked · quality ${artifact.quality.quality_gate_passed ? 'pass' : 'warn'}`,
        data: {
          source_count: artifact.sources.length,
          quality: artifact.quality,
          soft_warning_count: Array.isArray(artifact.quality.soft_warnings) ? artifact.quality.soft_warnings.length : 0
        }
      });
      const briefing = await store.createBriefing({
        userId: input.userId,
        sessionId: session.id,
        type: 'on_demand',
        status: 'completed',
        title: artifact.title,
        query: artifact.query,
        summary: artifact.summary,
        answerMarkdown: artifact.answerMarkdown,
        sourceCount: artifact.sources.length,
        qualityJson: artifact.quality
      });
      const dossier = await store.createDossier({
        userId: input.userId,
        sessionId: session.id,
        briefingId: briefing.id,
        title: artifact.title,
        query: artifact.query,
        status: 'ready',
        summary: artifact.summary,
        answerMarkdown: artifact.answerMarkdown,
        qualityJson: artifact.quality,
        conflictsJson: artifact.conflicts
      });
      await store.replaceDossierSources({ userId: input.userId, dossierId: dossier.id, sources: artifact.sources });
      await store.replaceDossierClaims({ userId: input.userId, dossierId: dossier.id, claims: artifact.claims });
      await store.updateJarvisSession({
        sessionId: session.id,
        userId: input.userId,
        briefingId: briefing.id,
        dossierId: dossier.id
      });
      await store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: session.id,
        stageKey: 'research',
        capability: 'research',
        title: 'Grounded research',
        status: 'completed',
        orderIndex: stagePlan.find((stage) => stage.stageKey === 'research')?.orderIndex ?? 0,
        summary: `${artifact.sources.length} grounded sources ranked`,
        artifactRefsJson: {
          source_count: artifact.sources.length,
          research_profile: artifact.researchProfile,
          profile_reasons: artifact.profileReasons,
          format_hint: artifact.formatHint,
          quality_mode: artifact.qualityMode,
          memory_plan_signals: memoryPlan?.signals ?? [],
          memory_plan_summary: memoryPlan?.summary ?? [],
          memory_preference_summary: memoryPreferences?.summary ?? [],
          memory_preference_applied: memoryRouting.applied,
          warning_codes: Array.isArray(artifact.quality.soft_warning_codes) ? artifact.quality.soft_warning_codes : [],
          quality_dimensions:
            artifact.quality.quality_dimensions && typeof artifact.quality.quality_dimensions === 'object'
              ? (artifact.quality.quality_dimensions as Record<string, unknown>)
              : {}
        },
        completedAt: new Date().toISOString()
      });
      await store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: session.id,
        stageKey: 'brief',
        capability: 'brief',
        title: 'Brief synthesis',
        status: 'completed',
        orderIndex: stagePlan.find((stage) => stage.stageKey === 'brief')?.orderIndex ?? 1,
        summary:
          artifact.quality.quality_gate_passed === false
            ? 'Partial brief ready with coverage warnings'
            : artifact.summary,
        artifactRefsJson: {
          briefing_id: briefing.id,
          dossier_id: dossier.id,
          source_count: artifact.sources.length,
          research_profile: artifact.researchProfile,
          profile_reasons: artifact.profileReasons,
          format_hint: artifact.formatHint,
          quality_mode: artifact.qualityMode,
          memory_plan_signals: memoryPlan?.signals ?? [],
          memory_plan_summary: memoryPlan?.summary ?? [],
          memory_preference_summary: memoryPreferences?.summary ?? [],
          memory_preference_applied: memoryRouting.applied,
          warning_codes: Array.isArray(artifact.quality.soft_warning_codes) ? artifact.quality.soft_warning_codes : [],
          soft_warning_codes: Array.isArray(artifact.quality.soft_warning_codes) ? artifact.quality.soft_warning_codes : [],
          quality_dimensions:
            artifact.quality.quality_dimensions && typeof artifact.quality.quality_dimensions === 'object'
              ? (artifact.quality.quality_dimensions as Record<string, unknown>)
              : {}
        },
        completedAt: new Date().toISOString()
      });
      await store.appendJarvisSessionEvent({
        userId: input.userId,
        sessionId: session.id,
        eventType: 'dossier.compiled',
        status: 'completed',
        summary:
          artifact.quality.quality_gate_passed === false
            ? 'Partial brief ready with coverage warnings'
            : 'Grounded dossier ready',
        data: {
          briefing_id: briefing.id,
          dossier_id: dossier.id,
          source_count: artifact.sources.length,
          conflict_count: artifact.conflicts.count ?? 0,
          quality_gate_passed: artifact.quality.quality_gate_passed ?? null,
          soft_warning_codes: Array.isArray(artifact.quality.soft_warning_codes) ? artifact.quality.soft_warning_codes : [],
          soft_warnings: Array.isArray(artifact.quality.soft_warnings) ? artifact.quality.soft_warnings : []
        }
      });
      notificationService?.emitBriefingReady(briefing.id, artifact.title, artifact.sources.length, dossier.id, {
        severity: artifact.quality.quality_gate_passed === false ? 'warning' : 'info',
        message:
          artifact.quality.quality_gate_passed === false
            ? `${artifact.sources.length} source(s) compiled, but the quality gate reported warnings.`
            : undefined
      });

      let missionId: string | undefined;
      let actionProposalId: string | undefined;
      let plannerMode: 'llm' | 'fallback' | undefined;
      if (capabilities.includes('plan')) {
        const modelSelection = await resolveModelSelection({
          store,
          userId: input.userId,
          featureKey: 'mission_plan_generation',
          override: {
            provider: memoryRouting.provider,
            strictProvider: memoryRouting.strictProvider,
            model: memoryRouting.model
          }
        });

        let plan: OrchestratorPlan = buildSimplePlan(prompt);
        plannerMode = 'fallback';
        try {
          const generated = await generatePlan(buildPlannerPromptWithMemory(prompt, memoryPlan), providerRouter, input.credentialsByProvider ?? {}, {
            provider: modelSelection.provider,
            strictProvider: modelSelection.strictProvider,
            model: modelSelection.model ?? undefined,
            modelSelection,
            trace: {
              store,
              env,
              userId: input.userId,
              traceId: input.traceId
            }
          });
          plan = generated;
          plannerMode = 'llm';
        } catch {
          plannerMode = 'fallback';
        }

        const mission = await store.createMission({
          ...planToMissionInput(plan, input.userId),
          workspaceId: null,
          status: 'draft'
        });
        await captureProjectMemory(store, {
          userId: input.userId,
          sessionId: session.id,
          taskId: session.taskId,
          prompt,
          missionTitle: mission.title,
          plannerMode,
          stepTitles: mission.steps.map((step) => step.title)
        });
        missionId = mission.id;
        const executionPlanning = buildExecutionPlanningCopy({
          memoryPlanSignals: memoryPlan?.signals ?? [],
          plannerMode
        });
        const proposal = await store.createActionProposal({
          userId: input.userId,
          sessionId: session.id,
          kind: 'mission_execute',
          title: executionPlanning.proposalTitle,
          summary: executionPlanning.proposalSummary,
          payload: {
            mission_id: mission.id,
            planner_mode: plannerMode,
            dossier_id: dossier.id,
            briefing_id: briefing.id,
            execution_option: executionPlanning.executionOption
          }
        });
        actionProposalId = proposal.id;
        notificationService?.emitActionProposalReady(session.id, proposal.id, proposal.title, {
          severity: 'warning',
          message: `${proposal.title} · planner ${plannerMode}`
        });
        await store.upsertJarvisSessionStage({
          userId: input.userId,
          sessionId: session.id,
          stageKey: 'plan',
          capability: 'plan',
          title: 'Execution plan',
          status: 'completed',
          orderIndex: stagePlan.find((stage) => stage.stageKey === 'plan')?.orderIndex ?? 2,
          summary: executionPlanning.planSummary,
          artifactRefsJson: {
            mission_id: mission.id,
            step_count: mission.steps.length,
            memory_plan_signals: memoryPlan?.signals ?? [],
            memory_plan_summary: memoryPlan?.summary ?? [],
            execution_option: executionPlanning.executionOption
          },
          completedAt: new Date().toISOString()
        });
        await store.upsertJarvisSessionStage({
          userId: input.userId,
          sessionId: session.id,
          stageKey: 'approve',
          capability: 'approve',
          title: 'Approval gate',
          status: 'needs_approval',
          orderIndex: stagePlan.find((stage) => stage.stageKey === 'approve')?.orderIndex ?? 3,
          summary: executionPlanning.approvalSummary,
          artifactRefsJson: {
            action_proposal_id: proposal.id,
            mission_id: mission.id,
            execution_option: executionPlanning.executionOption
          }
        });
        if (capabilities.includes('execute')) {
          await store.upsertJarvisSessionStage({
            userId: input.userId,
            sessionId: session.id,
            stageKey: 'execute',
            capability: 'execute',
            title: 'Execution',
            status: 'blocked',
            orderIndex: stagePlan.find((stage) => stage.stageKey === 'execute')?.orderIndex ?? 4,
            summary: executionPlanning.blockedSummary,
            artifactRefsJson: {
              mission_id: mission.id,
              execution_option: executionPlanning.executionOption
            }
          });
        }
        await store.updateJarvisSession({
          sessionId: session.id,
          userId: input.userId,
          missionId: mission.id
        });
        await store.appendJarvisSessionEvent({
          userId: input.userId,
          sessionId: session.id,
          eventType: 'mission.planned',
          status: 'needs_approval',
          summary: executionPlanning.planSummary,
          data: {
            mission_id: mission.id,
            action_proposal_id: proposal.id,
            step_count: mission.steps.length,
            memory_plan_signals: memoryPlan?.signals ?? [],
            memory_preference_summary: memoryPreferences?.summary ?? [],
            memory_preference_applied: memoryRouting.applied,
            execution_option: executionPlanning.executionOption
          }
        });
      }

      if (capabilities.includes('monitor')) {
        const watcher = await store.createWatcher({
          userId: input.userId,
          kind: resolveWatcherKind(intent),
          title: artifact.title,
          query: artifact.query,
          status: 'active',
          configJson: {
            source: 'jarvis_request',
            session_id: session.id,
            dossier_id: dossier.id
          }
        });
        await store.upsertJarvisSessionStage({
          userId: input.userId,
          sessionId: session.id,
          stageKey: 'monitor',
          capability: 'monitor',
          title: 'Continuous monitor',
          status: 'completed',
          orderIndex: stagePlan.find((stage) => stage.stageKey === 'monitor')?.orderIndex ?? 2,
          summary: 'Monitor created from this brief',
          artifactRefsJson: {
            watcher_id: watcher.id
          },
          completedAt: new Date().toISOString()
        });
        await store.appendJarvisSessionEvent({
          userId: input.userId,
          sessionId: session.id,
          eventType: 'monitor.created',
          status: 'completed',
          summary: 'Monitor created from research session',
          data: {
            watcher_id: watcher.id,
            dossier_id: dossier.id
          }
        });
        if (capabilities.includes('notify')) {
          await store.upsertJarvisSessionStage({
            userId: input.userId,
            sessionId: session.id,
            stageKey: 'notify',
            capability: 'notify',
            title: 'Notification routing',
            status: 'completed',
            orderIndex: stagePlan.find((stage) => stage.stageKey === 'notify')?.orderIndex ?? 3,
            summary: 'Monitor alerts are armed for future changes',
            artifactRefsJson: {
              watcher_id: watcher.id,
              dossier_id: dossier.id
            },
            completedAt: new Date().toISOString()
          });
          await store.appendJarvisSessionEvent({
            userId: input.userId,
            sessionId: session.id,
            eventType: 'notify.armed',
            status: 'completed',
            summary: 'Future updates will be surfaced through notifications',
            data: {
              watcher_id: watcher.id
            }
          });
        }
      }

      const synced = await syncJarvisSessionFromStages(store, {
        userId: input.userId,
        sessionId: session.id
      });
      await captureResearchMemory(store, {
        userId: input.userId,
        sessionId: session.id,
        taskId: synced?.session.taskId ?? session.taskId,
        title: artifact.title,
        prompt,
        profile: artifact.researchProfile,
        summary: artifact.summary,
        warningCodes: Array.isArray(artifact.quality.soft_warning_codes) ? artifact.quality.soft_warning_codes : []
      });
      const orchestration = await buildExecutionSnapshot(store, {
        userId: input.userId,
        sessionId: session.id
      });

      return {
        session: synced?.session ?? session,
        ...orchestration,
        research_profile: artifact.researchProfile,
        research_profile_reasons: artifact.profileReasons,
        quality_mode: artifact.qualityMode,
        warning_codes: Array.isArray(artifact.quality.soft_warning_codes) ? artifact.quality.soft_warning_codes : [],
        format_hint: artifact.formatHint,
        quality_dimensions:
          artifact.quality.quality_dimensions && typeof artifact.quality.quality_dimensions === 'object'
            ? (artifact.quality.quality_dimensions as Record<string, unknown>)
            : null,
        ...buildRequestMemoryMeta(orchestration.execution_option),
        delegation: {
          intent,
          complexity,
          primary_target: primaryTarget,
          capabilities,
          mission_id: missionId,
          action_proposal_id: actionProposalId,
          planner_mode: plannerMode,
          briefing_id: briefing.id,
          dossier_id: dossier.id
        }
      };
    } catch (error) {
      const blockedByQuality = error instanceof Error && error.message.startsWith('quality gate failed:');
      await store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: session.id,
        stageKey: 'research',
        capability: 'research',
        title: 'Grounded research',
        status: 'failed',
        orderIndex: stagePlan.find((stage) => stage.stageKey === 'research')?.orderIndex ?? 0,
        errorMessage: error instanceof Error ? error.message : 'Failed to compile grounded dossier',
        completedAt: new Date().toISOString()
      });
      if (capabilities.includes('brief')) {
        await store.upsertJarvisSessionStage({
          userId: input.userId,
          sessionId: session.id,
          stageKey: 'brief',
          capability: 'brief',
          title: 'Brief synthesis',
          status: 'blocked',
          orderIndex: stagePlan.find((stage) => stage.stageKey === 'brief')?.orderIndex ?? 1,
          summary: 'Brief is blocked until research succeeds'
        });
      }
      const synced = await syncJarvisSessionFromStages(store, {
        userId: input.userId,
        sessionId: session.id
      });
      await store.appendJarvisSessionEvent({
        userId: input.userId,
        sessionId: session.id,
        eventType: blockedByQuality ? 'dossier.blocked' : 'dossier.failed',
        status: blockedByQuality ? 'blocked' : 'failed',
        summary: error instanceof Error ? error.message : 'Failed to compile grounded dossier',
        data: {}
      });
      if (blockedByQuality) {
        notificationService?.emitSessionStalled(session.id, session.title);
      }
      const orchestration =
        await buildExecutionSnapshot(store, {
          userId: input.userId,
          sessionId: session.id
        });
      return {
        session: synced?.session ?? session,
        ...orchestration,
        ...buildRequestMemoryMeta(orchestration.execution_option),
        delegation: {
          intent,
          complexity,
          primary_target: primaryTarget,
          capabilities,
          error: error instanceof Error ? error.message : 'Failed to compile grounded dossier'
        }
      };
    }
  }

  if (primaryTarget === 'council') {
    const result = await startCouncilRun(ctx, {
      userId: input.userId,
      traceId: input.traceId,
      idempotencyKey: `jarvis:${session.id}:council`,
      question: prompt,
      createTask: true,
      taskTitle: title,
      taskSource: 'jarvis_request',
      routeLabel: '/api/v1/jarvis/requests',
      provider: memoryRouting.provider,
      strictProvider: memoryRouting.strictProvider,
      model: memoryRouting.model,
      credentialsByProvider: input.credentialsByProvider ?? {}
    });

    const nextStatus =
      result.run.status === 'completed' ? 'completed' : result.run.status === 'failed' ? 'failed' : 'running';
    const linkedSession =
      (await store.updateJarvisSession({
        sessionId: session.id,
        userId: input.userId,
        status: nextStatus,
        taskId: result.run.task_id,
        councilRunId: result.run.id
      })) ?? session;

    await store.appendJarvisSessionEvent({
      userId: input.userId,
      sessionId: session.id,
      eventType: 'council.run.created',
      status: nextStatus,
      summary: result.idempotentReplay ? 'Reused existing council run' : 'Council run prepared',
      data: {
        council_run_id: result.run.id,
        task_id: result.run.task_id,
        idempotent_replay: result.idempotentReplay
      }
    });
    await store.upsertJarvisSessionStage({
      userId: input.userId,
      sessionId: session.id,
      stageKey: 'debate',
      capability: 'debate',
      title: 'Council debate',
      status: nextStatus === 'completed' ? 'completed' : nextStatus === 'failed' ? 'failed' : 'running',
      orderIndex: stagePlan.find((stage) => stage.stageKey === 'debate')?.orderIndex ?? 0,
      summary: result.idempotentReplay ? 'Reused existing council run' : 'Council run prepared',
      artifactRefsJson: {
        council_run_id: result.run.id,
        task_id: result.run.task_id
      },
      completedAt: nextStatus === 'completed' || nextStatus === 'failed' ? new Date().toISOString() : null
    });
    const orchestration = await buildExecutionSnapshot(store, {
      userId: input.userId,
      sessionId: session.id
    });

    return {
      session: linkedSession,
      ...orchestration,
      ...buildRequestMemoryMeta(orchestration.execution_option),
      delegation: {
        intent,
        complexity,
        primary_target: primaryTarget,
        capabilities,
        council_run_id: result.run.id,
        task_id: result.run.task_id ?? undefined
      }
    };
  }

  if (primaryTarget === 'assistant') {
    const task = await store.createTask({
      userId: input.userId,
      mode: resolveTaskMode(intent),
      title,
      input: {
        prompt,
        source: input.source,
        intent,
        session_id: session.id
      },
      idempotencyKey: `jarvis:${session.id}`,
      traceId: input.traceId
    });
    const assistantContext = await store.upsertAssistantContext({
      userId: input.userId,
      clientContextId: session.id,
      source: input.source,
      intent,
      prompt,
      widgetPlan: ['assistant', 'tasks'],
      taskId: task.id,
      status: 'running'
    });
    const linkedSession =
      (await store.updateJarvisSession({
        sessionId: session.id,
        userId: input.userId,
        taskId: task.id,
        assistantContextId: assistantContext.id,
        status: 'running'
      })) ?? session;
    await store.appendJarvisSessionEvent({
      userId: input.userId,
      sessionId: session.id,
      eventType: 'assistant.context.created',
      status: 'running',
      summary: 'Assistant context prepared',
      data: {
        task_id: task.id,
        assistant_context_id: assistantContext.id
      }
    });
    const orchestration = await buildExecutionSnapshot(store, {
      userId: input.userId,
      sessionId: session.id
    });
    return {
      session: linkedSession,
      ...orchestration,
      ...buildRequestMemoryMeta(orchestration.execution_option),
      delegation: {
        intent,
        complexity,
        primary_target: primaryTarget,
        capabilities,
        task_id: task.id,
        assistant_context_id: assistantContext.id
      }
    };
  }

  const modelSelection = await resolveModelSelection({
    store,
    userId: input.userId,
    featureKey: 'mission_plan_generation',
    override: {
      provider: memoryRouting.provider,
      strictProvider: memoryRouting.strictProvider,
      model: memoryRouting.model
    }
  });

  let plan: OrchestratorPlan = buildSimplePlan(prompt);
  let plannerMode: 'llm' | 'fallback' = 'fallback';
  try {
    const generated = await generatePlan(buildPlannerPromptWithMemory(prompt, memoryPlan), providerRouter, input.credentialsByProvider ?? {}, {
      provider: modelSelection.provider,
      strictProvider: modelSelection.strictProvider,
      model: modelSelection.model ?? undefined,
      modelSelection,
      trace: {
        store,
        env,
        userId: input.userId,
        traceId: input.traceId
      }
    });
    plan = generated;
    plannerMode = 'llm';
  } catch {
    plannerMode = 'fallback';
  }

  const mission = await store.createMission({
    ...planToMissionInput(plan, input.userId),
    workspaceId: null,
    status: 'draft'
  });
  await captureProjectMemory(store, {
    userId: input.userId,
    sessionId: session.id,
    taskId: session.taskId,
    prompt,
    missionTitle: mission.title,
    plannerMode,
    stepTitles: mission.steps.map((step) => step.title)
  });
  const linkedSession =
    (await store.updateJarvisSession({
      sessionId: session.id,
      userId: input.userId,
      missionId: mission.id,
      status: 'needs_approval'
    })) ?? session;
  const executionPlanning = buildExecutionPlanningCopy({
    memoryPlanSignals: memoryPlan?.signals ?? [],
    plannerMode
  });
  const proposal = await store.createActionProposal({
    userId: input.userId,
    sessionId: session.id,
    kind: 'mission_execute',
    title: executionPlanning.proposalTitle,
    summary: executionPlanning.proposalSummary,
    payload: {
      mission_id: mission.id,
      planner_mode: plannerMode,
      execution_option: executionPlanning.executionOption
    }
  });
  notificationService?.emitActionProposalReady(session.id, proposal.id, proposal.title, {
    severity: 'warning',
    message: `${proposal.title} · planner ${plannerMode}`
  });
  await store.upsertJarvisSessionStage({
    userId: input.userId,
    sessionId: session.id,
    stageKey: 'plan',
    capability: 'plan',
    title: 'Execution plan',
    status: 'completed',
    orderIndex: stagePlan.find((stage) => stage.stageKey === 'plan')?.orderIndex ?? 0,
    summary: executionPlanning.planSummary,
    artifactRefsJson: {
      mission_id: mission.id,
      step_count: mission.steps.length,
      memory_plan_signals: memoryPlan?.signals ?? [],
      memory_plan_summary: memoryPlan?.summary ?? [],
      execution_option: executionPlanning.executionOption
    },
    completedAt: new Date().toISOString()
  });
  await store.upsertJarvisSessionStage({
    userId: input.userId,
    sessionId: session.id,
    stageKey: 'approve',
    capability: 'approve',
    title: 'Approval gate',
    status: 'needs_approval',
    orderIndex: stagePlan.find((stage) => stage.stageKey === 'approve')?.orderIndex ?? 1,
    summary: executionPlanning.approvalSummary,
    artifactRefsJson: {
      action_proposal_id: proposal.id,
      mission_id: mission.id,
      execution_option: executionPlanning.executionOption
    }
  });
  if (capabilities.includes('execute')) {
    await store.upsertJarvisSessionStage({
      userId: input.userId,
      sessionId: session.id,
      stageKey: 'execute',
      capability: 'execute',
      title: 'Execution',
      status: 'blocked',
      orderIndex: stagePlan.find((stage) => stage.stageKey === 'execute')?.orderIndex ?? 2,
      summary: executionPlanning.blockedSummary,
      artifactRefsJson: {
        mission_id: mission.id,
        execution_option: executionPlanning.executionOption
      }
    });
  }
  await store.appendJarvisSessionEvent({
    userId: input.userId,
    sessionId: session.id,
    eventType: 'mission.planned',
    status: 'needs_approval',
    summary: executionPlanning.planSummary,
    data: {
      mission_id: mission.id,
      action_proposal_id: proposal.id,
      step_count: mission.steps.length,
      memory_plan_signals: memoryPlan?.signals ?? [],
      memory_preference_summary: memoryPreferences?.summary ?? [],
      memory_preference_applied: memoryRouting.applied,
      execution_option: executionPlanning.executionOption
    }
  });
  const synced = await syncJarvisSessionFromStages(store, {
    userId: input.userId,
    sessionId: session.id
  });
  const orchestration = await buildExecutionSnapshot(store, {
    userId: input.userId,
    sessionId: session.id
  });

  return {
    session: synced?.session ?? linkedSession,
    ...orchestration,
    ...buildRequestMemoryMeta(executionPlanning.executionOption),
    delegation: {
      intent,
      complexity,
      primary_target: primaryTarget,
      capabilities,
      mission_id: mission.id,
      action_proposal_id: proposal.id,
      planner_mode: plannerMode
    }
  };
}
