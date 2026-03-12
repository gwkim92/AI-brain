import type {
  JarvisCapability,
  JarvisSessionIntent,
  JarvisSessionPrimaryTarget,
  JarvisSessionRecord,
  JarvisSessionStageRecord,
  JarvisSessionStageStatus,
  JarvisSessionStatus,
  JarvisStore
} from '../store/types';
import type { JarvisMemoryPlanSignal, JarvisMemoryPreferenceHints } from './memory-context';

export type PlannedJarvisStage = {
  stageKey: string;
  capability: JarvisCapability;
  title: string;
  orderIndex: number;
  dependsOnJson: string[];
};

export type JarvisNextAction =
  | {
      kind: 'open_action_center' | 'open_brief' | 'open_workbench' | 'create_monitor';
      label: string;
    }
  | null;

export type JarvisOrchestrationSnapshot = {
  requestedCapabilities: JarvisCapability[];
  activeCapabilities: JarvisCapability[];
  completedCapabilities: JarvisCapability[];
  stages: JarvisSessionStageRecord[];
  nextAction: JarvisNextAction;
  executionOption: string | null;
  researchProfile: string | null;
  researchProfileReasons: string[];
  qualityMode: 'pass' | 'warn' | 'block' | null;
  warningCodes: string[];
  formatHint: string | null;
  qualityDimensions: Record<string, unknown> | null;
  memoryPlanSignals: JarvisMemoryPlanSignal[];
  memoryPlanSummary: string[];
  currentFocusTarget: JarvisSessionPrimaryTarget;
  status: JarvisSessionStatus;
};

const MONITOR_PROMPT_PATTERN =
  /(계속\s*(추적|모니터)|지속적으로|앞으로도\s*계속|계속 봐줘|monitor|watch|keep\s+tracking|notify\s+me)/iu;
const PLAN_PROMPT_PATTERN = /(계획|플랜|로드맵|roadmap|plan|단계별|step\s*by\s*step)/iu;
const EXECUTE_PROMPT_PATTERN = /(승인\s*후\s*실행|approve.*execute|실행까지|실행해줘|run\s+it|execute\s+it)/iu;
const RESEARCH_PROMPT_PATTERN =
  /(리서치|연구|조사|분석|비교|근거와 함께|브리프|브리핑|최신 동향|정리해줘|research|study|analyze|compare|brief|with\s+evidence)/iu;
const NOTIFY_PROMPT_PATTERN = /(알림|통지|변화가 있으면 알려|업데이트되면 알려|notify\s+me|alert\s+me|ping\s+me)/iu;

const CAPABILITY_TITLES: Record<JarvisCapability, string> = {
  answer: 'Direct answer',
  research: 'Grounded research',
  brief: 'Brief synthesis',
  debate: 'Council debate',
  plan: 'Execution plan',
  approve: 'Approval gate',
  execute: 'Execution',
  monitor: 'Continuous monitor',
  notify: 'Notification'
};

const CAPABILITY_TARGETS: Record<JarvisCapability, JarvisSessionPrimaryTarget> = {
  answer: 'assistant',
  research: 'dossier',
  brief: 'dossier',
  debate: 'council',
  plan: 'mission',
  approve: 'mission',
  execute: 'execution',
  monitor: 'dossier',
  notify: 'briefing'
};

const CHANGE_CLASS_BRIEF_LABELS: Record<string, string> = {
  new_high_significance_item: 'Open updated brief',
  official_update: 'Open official update brief',
  policy_change: 'Open policy brief',
  market_shift: 'Open market brief',
  repo_release: 'Open repo brief',
  health_regression: 'Open incident brief'
};

const PROFILE_BRIEF_LABELS: Record<string, string> = {
  broad_news: 'Open brief',
  topic_news: 'Open topic brief',
  entity_brief: 'Open entity brief',
  comparison_research: 'Open comparison brief',
  repo_research: 'Open repo brief',
  market_research: 'Open market brief',
  policy_regulation: 'Open policy brief'
};

function readExecutionOption(stages: JarvisSessionStageRecord[]): string | null {
  for (const stage of stages) {
    const refs = stage.artifactRefsJson ?? {};
    const value = refs.execution_option;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function includesMonitor(prompt: string): boolean {
  return MONITOR_PROMPT_PATTERN.test(prompt);
}

function includesPlan(prompt: string): boolean {
  return PLAN_PROMPT_PATTERN.test(prompt);
}

function includesExecute(prompt: string): boolean {
  return EXECUTE_PROMPT_PATTERN.test(prompt);
}

function includesResearch(prompt: string): boolean {
  return RESEARCH_PROMPT_PATTERN.test(prompt);
}

function includesNotify(prompt: string): boolean {
  return NOTIFY_PROMPT_PATTERN.test(prompt);
}

function pushCapability(list: JarvisCapability[], capability: JarvisCapability) {
  if (!list.includes(capability)) {
    list.push(capability);
  }
}

export function resolveRequestedCapabilities(input: {
  prompt: string;
  intent: JarvisSessionIntent;
  complexity: 'simple' | 'moderate' | 'complex';
  primaryTarget: JarvisSessionPrimaryTarget;
  targetHint?: 'assistant';
  memoryPlanSignals?: JarvisMemoryPlanSignal[];
  memoryPreferences?: JarvisMemoryPreferenceHints | null;
  researchProfile?: string | null;
}): JarvisCapability[] {
  if (input.targetHint === 'assistant' || input.primaryTarget === 'assistant') {
    return ['answer'];
  }

  const capabilities: JarvisCapability[] = [];
  const wantsPlan = includesPlan(input.prompt);
  const wantsExecute = includesExecute(input.prompt);
  const wantsMonitor = includesMonitor(input.prompt);
  const wantsResearch = includesResearch(input.prompt);
  const wantsNotify = includesNotify(input.prompt);
  const approvalSensitive =
    input.memoryPlanSignals?.includes('approval_sensitive_preference') ||
    input.memoryPlanSignals?.includes('recent_rejection_history') ||
    false;

  if (input.intent === 'council') {
    pushCapability(capabilities, 'debate');
    pushCapability(capabilities, 'brief');
    if (wantsPlan || (approvalSensitive && wantsExecute)) {
      pushCapability(capabilities, 'plan');
      pushCapability(capabilities, 'approve');
      if (wantsExecute) {
        pushCapability(capabilities, 'execute');
      }
    }
    return capabilities;
  }

  const autoMonitorEligible = ['topic_news', 'entity_brief', 'market_research', 'policy_regulation'].includes(input.researchProfile ?? '');

  if (input.intent === 'research' || input.intent === 'finance' || input.intent === 'news') {
    pushCapability(capabilities, 'research');
    pushCapability(capabilities, 'brief');
    if (wantsPlan || (approvalSensitive && wantsExecute)) {
      pushCapability(capabilities, 'plan');
      pushCapability(capabilities, 'approve');
      if (wantsExecute) {
        pushCapability(capabilities, 'execute');
      }
    }
    if (wantsMonitor || (input.memoryPreferences?.preferMonitorAfterBrief && autoMonitorEligible)) {
      pushCapability(capabilities, 'monitor');
      if (wantsNotify || input.memoryPreferences?.preferNotifyAfterMonitor) {
        pushCapability(capabilities, 'notify');
      }
    }
    return capabilities;
  }

  if (wantsResearch) {
    pushCapability(capabilities, 'research');
    pushCapability(capabilities, 'brief');
    if (wantsPlan || (approvalSensitive && wantsExecute)) {
      pushCapability(capabilities, 'plan');
      pushCapability(capabilities, 'approve');
      if (wantsExecute) {
        pushCapability(capabilities, 'execute');
      }
    }
    if (wantsMonitor || (input.memoryPreferences?.preferMonitorAfterBrief && autoMonitorEligible)) {
      pushCapability(capabilities, 'monitor');
      if (wantsNotify || input.memoryPreferences?.preferNotifyAfterMonitor) {
        pushCapability(capabilities, 'notify');
      }
    }
    return capabilities;
  }

  if (input.primaryTarget === 'mission' || input.complexity !== 'simple') {
    pushCapability(capabilities, 'plan');
    pushCapability(capabilities, 'approve');
    if (wantsExecute || input.intent === 'code') {
      pushCapability(capabilities, 'execute');
    }
    return capabilities;
  }

  if (approvalSensitive && wantsExecute) {
    pushCapability(capabilities, 'plan');
    pushCapability(capabilities, 'approve');
    pushCapability(capabilities, 'execute');
    return capabilities;
  }

  return ['answer'];
}

export function buildJarvisStagePlan(input: {
  prompt: string;
  intent: JarvisSessionIntent;
  complexity: 'simple' | 'moderate' | 'complex';
  primaryTarget: JarvisSessionPrimaryTarget;
  targetHint?: 'assistant';
  memoryPlanSignals?: JarvisMemoryPlanSignal[];
  memoryPreferences?: JarvisMemoryPreferenceHints | null;
  researchProfile?: string | null;
}): PlannedJarvisStage[] {
  const requestedCapabilities = resolveRequestedCapabilities(input);
  let previousStageKey: string | null = null;
  return requestedCapabilities.map((capability, index) => {
    const stageKey = capability;
    const stage: PlannedJarvisStage = {
      stageKey,
      capability,
      title: CAPABILITY_TITLES[capability],
      orderIndex: index,
      dependsOnJson: previousStageKey ? [previousStageKey] : []
    };
    previousStageKey = stageKey;
    return stage;
  });
}

export async function ensureJarvisSessionStages(
  store: JarvisStore,
  input: {
    userId: string;
    sessionId: string;
    stages: PlannedJarvisStage[];
    runningStageKey?: string;
  }
): Promise<JarvisSessionStageRecord[]> {
  const created: JarvisSessionStageRecord[] = [];
  for (const stage of input.stages) {
    const status: JarvisSessionStageStatus =
      input.runningStageKey && stage.stageKey === input.runningStageKey ? 'running' : 'queued';
    const row = await store.upsertJarvisSessionStage({
      userId: input.userId,
      sessionId: input.sessionId,
      stageKey: stage.stageKey,
      capability: stage.capability,
      title: stage.title,
      status,
      orderIndex: stage.orderIndex,
      dependsOnJson: stage.dependsOnJson
    });
    if (row) {
      created.push(row);
    }
  }
  return created;
}

export function summarizeJarvisSessionStages(
  session: Pick<JarvisSessionRecord, 'primaryTarget' | 'status' | 'dossierId'>,
  stages: JarvisSessionStageRecord[]
): JarvisOrchestrationSnapshot {
  if (stages.length === 0) {
    return {
      requestedCapabilities: [],
      activeCapabilities: [],
      completedCapabilities: [],
      stages: [],
      nextAction: null,
      executionOption: null,
      researchProfile: null,
      researchProfileReasons: [],
      qualityMode: null,
      warningCodes: [],
      formatHint: null,
      qualityDimensions: null,
      memoryPlanSignals: [],
      memoryPlanSummary: [],
      currentFocusTarget: session.primaryTarget,
      status: session.status
    };
  }

  const requestedCapabilities = Array.from(new Set(stages.map((stage) => stage.capability)));
  const activeCapabilities = Array.from(
    new Set(
      stages
        .filter((stage) => ['queued', 'running', 'needs_approval'].includes(stage.status))
        .map((stage) => stage.capability)
    )
  );
  const completedCapabilities = Array.from(
    new Set(stages.filter((stage) => ['completed', 'skipped'].includes(stage.status)).map((stage) => stage.capability))
  );

  const metadataStage =
    stages.find((stage) => stage.capability === 'brief' && Object.keys(stage.artifactRefsJson ?? {}).length > 0) ??
    stages.find((stage) => stage.capability === 'research' && Object.keys(stage.artifactRefsJson ?? {}).length > 0) ??
    stages.find((stage) => stage.capability === 'debate' && Object.keys(stage.artifactRefsJson ?? {}).length > 0) ??
    null;
  const metadata = metadataStage?.artifactRefsJson ?? {};
  const researchProfile = typeof metadata.research_profile === 'string' ? metadata.research_profile : null;
  const researchProfileReasons = Array.isArray(metadata.profile_reasons)
    ? metadata.profile_reasons.filter((value): value is string => typeof value === 'string')
    : [];
  const qualityMode =
    metadata.quality_mode === 'pass' || metadata.quality_mode === 'warn' || metadata.quality_mode === 'block'
      ? metadata.quality_mode
      : null;
  const warningCodes = Array.isArray(metadata.warning_codes)
    ? metadata.warning_codes.filter((value): value is string => typeof value === 'string')
    : Array.isArray(metadata.soft_warning_codes)
      ? metadata.soft_warning_codes.filter((value): value is string => typeof value === 'string')
      : [];
  const formatHint = typeof metadata.format_hint === 'string' ? metadata.format_hint : null;
  const qualityDimensions =
    metadata.quality_dimensions && typeof metadata.quality_dimensions === 'object' && !Array.isArray(metadata.quality_dimensions)
      ? (metadata.quality_dimensions as Record<string, unknown>)
      : null;
  const memoryMetadataStage =
    stages.find((stage) => Array.isArray(stage.artifactRefsJson?.memory_plan_signals) || Array.isArray(stage.artifactRefsJson?.memory_plan_summary)) ??
    null;
  const memoryMetadata = memoryMetadataStage?.artifactRefsJson ?? {};
  const memoryPlanSignals = Array.isArray(memoryMetadata.memory_plan_signals)
    ? memoryMetadata.memory_plan_signals.filter(
        (value): value is JarvisMemoryPlanSignal =>
          value === 'pinned_context' ||
          value === 'project_context_available' ||
          value === 'research_history_available' ||
          value === 'recent_approval_history' ||
          value === 'recent_rejection_history' ||
          value === 'risk_first_preference' ||
          value === 'approval_sensitive_preference' ||
          value === 'monitor_followup_preference' ||
          value === 'notify_followup_preference' ||
          value === 'concise_response_preference' ||
          value === 'balanced_response_preference' ||
          value === 'detailed_response_preference' ||
          value === 'cautious_risk_preference' ||
          value === 'aggressive_risk_preference' ||
          value === 'read_only_review_preference' ||
          value === 'manual_monitoring_preference' ||
          value === 'all_changes_monitoring_preference' ||
          value === 'safe_auto_run_preference' ||
          value === 'preferred_provider_available' ||
          value === 'preferred_model_available'
      )
    : [];
  const memoryPlanSummary = Array.isArray(memoryMetadata.memory_plan_summary)
    ? memoryMetadata.memory_plan_summary.filter((value): value is string => typeof value === 'string')
    : [];

  const nextStage =
    stages.find((stage) => stage.status === 'needs_approval') ??
    stages.find((stage) => stage.status === 'running') ??
    stages.find((stage) => stage.status === 'blocked') ??
    stages.find((stage) => stage.status === 'queued') ??
    stages[stages.length - 1] ??
    null;

  let status: JarvisSessionStatus = 'queued';
  if (stages.some((stage) => stage.status === 'failed')) {
    status = 'failed';
  } else if (stages.some((stage) => stage.status === 'needs_approval')) {
    status = 'needs_approval';
  } else if (stages.some((stage) => stage.status === 'blocked')) {
    status = 'blocked';
  } else if (stages.some((stage) => stage.status === 'running')) {
    status = 'running';
  } else if (stages.every((stage) => stage.status === 'completed' || stage.status === 'skipped')) {
    status = 'completed';
  } else if (stages.some((stage) => stage.status === 'queued')) {
    status = 'queued';
  }

  let nextAction: JarvisNextAction = null;
  const approvalSensitive =
    memoryPlanSignals.includes('approval_sensitive_preference') ||
    memoryPlanSignals.includes('risk_first_preference') ||
    memoryPlanSignals.includes('recent_rejection_history');
  const approvalStage = stages.find((stage) => stage.status === 'needs_approval') ?? null;
  const executionOption = readExecutionOption(stages);
  const changeClass = typeof metadata.change_class === 'string' ? metadata.change_class : null;
  if (approvalStage) {
    const approvalSummary = approvalStage.summary?.trim() ?? '';
    nextAction = {
      kind: 'open_action_center',
      label:
        approvalSummary && !/^approval required\b/i.test(approvalSummary)
          ? approvalSummary
          : executionOption === 'read_only_first' || executionOption === 'read_only_review'
            ? 'Review read-only checks and approve execution'
            : executionOption === 'approval_required_write'
            ? 'Review write execution and approve run'
            : approvalSensitive
            ? 'Review approval before execution'
            : 'Review approval'
    };
  } else if (stages.some((stage) => stage.capability === 'brief' && stage.status === 'completed') && session.dossierId) {
    nextAction = {
      kind: 'open_brief',
      label:
        (changeClass && CHANGE_CLASS_BRIEF_LABELS[changeClass]) ||
        (researchProfile && PROFILE_BRIEF_LABELS[researchProfile]) ||
        'Open brief'
    };
  } else if (stages.some((stage) => stage.capability === 'monitor' && stage.status === 'queued')) {
    nextAction = { kind: 'create_monitor', label: 'Create monitor' };
  } else if (stages.some((stage) => stage.capability === 'execute' && stage.status === 'running')) {
    nextAction = { kind: 'open_workbench', label: 'Open workbench' };
  }

  return {
    requestedCapabilities,
    activeCapabilities,
    completedCapabilities,
    stages,
    nextAction,
    executionOption,
    researchProfile,
    researchProfileReasons,
    qualityMode,
    warningCodes,
    formatHint,
    qualityDimensions,
    memoryPlanSignals,
    memoryPlanSummary,
    currentFocusTarget: nextStage ? CAPABILITY_TARGETS[nextStage.capability] : session.primaryTarget,
    status
  };
}

export async function getJarvisSessionOrchestrationSnapshot(
  store: JarvisStore,
  input: { userId: string; sessionId: string }
): Promise<JarvisOrchestrationSnapshot | null> {
  const session = await store.getJarvisSessionById({ userId: input.userId, sessionId: input.sessionId });
  if (!session) return null;
  const stages = await store.listJarvisSessionStages({ userId: input.userId, sessionId: input.sessionId });
  return summarizeJarvisSessionStages(session, stages);
}

export async function syncJarvisSessionFromStages(
  store: JarvisStore,
  input: { userId: string; sessionId: string }
): Promise<{ session: JarvisSessionRecord; snapshot: JarvisOrchestrationSnapshot } | null> {
  const session = await store.getJarvisSessionById({ userId: input.userId, sessionId: input.sessionId });
  if (!session) return null;
  const stages = await store.listJarvisSessionStages({ userId: input.userId, sessionId: input.sessionId });
  const snapshot = summarizeJarvisSessionStages(session, stages);
  const updated =
    (await store.updateJarvisSession({
      sessionId: input.sessionId,
      userId: input.userId,
      status: snapshot.status,
      primaryTarget: snapshot.currentFocusTarget
    })) ?? session;
  return {
    session: updated,
    snapshot
  };
}
