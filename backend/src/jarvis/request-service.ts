import { generateResearchArtifact } from './research';

import { startCouncilRun } from '../council/run-service';
import { resolveModelSelection } from '../providers/model-selection';
import type { ProviderCredentialsByProvider, ProviderName } from '../providers/types';
import { buildSimplePlan, classifyComplexity } from '../orchestrator/complexity';
import { generatePlan, planToMissionInput, type OrchestratorPlan } from '../orchestrator/planner';
import type {
  JarvisSessionIntent,
  JarvisSessionPrimaryTarget,
  JarvisSessionRecord,
  JarvisSessionStatus,
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
  if (/(코드|개발|버그|리팩토링|테스트|배포|debug|code|refactor|test|deploy)/iu.test(prompt)) return 'code';
  if (/(리서치|연구|분석|비교|research|study|analyze|compare)/iu.test(prompt)) return 'research';
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
  provider?: ProviderName | 'auto';
  strictProvider?: boolean;
  model?: string;
  traceId?: string;
  credentialsByProvider?: ProviderCredentialsByProvider;
};

export type ExecuteJarvisRequestResult = {
  session: JarvisSessionRecord;
  delegation: {
    intent: JarvisSessionIntent;
    complexity: 'simple' | 'moderate' | 'complex';
    primary_target: JarvisSessionPrimaryTarget;
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

export async function executeJarvisRequest(
  ctx: RouteContext,
  input: ExecuteJarvisRequestInput
): Promise<ExecuteJarvisRequestResult> {
  const { store, providerRouter, env, notificationService } = ctx;
  const prompt = input.prompt.trim();
  const title = truncateText(prompt, 90);
  const intent = inferJarvisIntent(prompt);
  const complexity = classifyComplexity(prompt);
  const primaryTarget = resolvePrimaryTarget(intent, complexity);

  const session = await store.createJarvisSession({
    id: input.clientSessionId,
    userId: input.userId,
    title,
    prompt,
    source: input.source,
    intent,
    status: 'running',
    workspacePreset: resolveWorkspacePreset(intent),
    primaryTarget
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
      primary_target: primaryTarget,
      source: input.source
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
        strictness: intent === 'news' ? 'news' : 'default'
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
      const completedSession =
        (await store.updateJarvisSession({
          sessionId: session.id,
          userId: input.userId,
          status: 'completed',
          briefingId: briefing.id,
          dossierId: dossier.id
        })) ?? session;
      await store.appendJarvisSessionEvent({
        userId: input.userId,
        sessionId: session.id,
        eventType: 'dossier.compiled',
        status: 'completed',
        summary: 'Grounded dossier ready',
        data: {
          briefing_id: briefing.id,
          dossier_id: dossier.id,
          source_count: artifact.sources.length,
          conflict_count: artifact.conflicts.count ?? 0,
          quality_gate_passed: artifact.quality.quality_gate_passed ?? null
        }
      });
      notificationService?.emitBriefingReady(briefing.id, artifact.title, artifact.sources.length, dossier.id, {
        severity: artifact.quality.quality_gate_passed === false ? 'warning' : 'info',
        message:
          artifact.quality.quality_gate_passed === false
            ? `${artifact.sources.length} source(s) compiled, but the quality gate reported warnings.`
            : undefined
      });
      return {
        session: completedSession,
        delegation: {
          intent,
          complexity,
          primary_target: primaryTarget,
          briefing_id: briefing.id,
          dossier_id: dossier.id
        }
      };
    } catch (error) {
      const blockedByQuality = error instanceof Error && error.message.startsWith('quality gate failed:');
      const failedSession =
        (await store.updateJarvisSession({
          sessionId: session.id,
          userId: input.userId,
          status: blockedByQuality ? 'blocked' : 'failed'
        })) ?? session;
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
      return {
        session: failedSession,
        delegation: {
          intent,
          complexity,
          primary_target: primaryTarget,
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
      provider: input.provider,
      strictProvider: input.strictProvider,
      model: input.model,
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

    return {
      session: linkedSession,
      delegation: {
        intent,
        complexity,
        primary_target: primaryTarget,
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
    return {
      session: linkedSession,
      delegation: {
        intent,
        complexity,
        primary_target: primaryTarget,
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
      provider: input.provider,
      strictProvider: input.strictProvider,
      model: input.model
    }
  });

  let plan: OrchestratorPlan = buildSimplePlan(prompt);
  let plannerMode: 'llm' | 'fallback' = 'fallback';
  try {
    const generated = await generatePlan(prompt, providerRouter, input.credentialsByProvider ?? {}, {
      provider: modelSelection.provider,
      strictProvider: modelSelection.strictProvider,
      model: modelSelection.model ?? undefined,
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
  const linkedSession =
    (await store.updateJarvisSession({
      sessionId: session.id,
      userId: input.userId,
      missionId: mission.id,
      status: 'needs_approval'
    })) ?? session;
  const proposal = await store.createActionProposal({
    userId: input.userId,
    sessionId: session.id,
    kind: 'mission_execute',
    title: 'Execute mission plan',
    summary: 'Review the generated plan and approve mission execution.',
    payload: {
      mission_id: mission.id,
      planner_mode: plannerMode
    }
  });
  notificationService?.emitActionProposalReady(session.id, proposal.id, proposal.title, {
    severity: 'warning',
    message: `${proposal.title} · planner ${plannerMode}`
  });
  await store.appendJarvisSessionEvent({
    userId: input.userId,
    sessionId: session.id,
    eventType: 'mission.planned',
    status: 'needs_approval',
    summary: `Mission planned via ${plannerMode}`,
    data: {
      mission_id: mission.id,
      action_proposal_id: proposal.id,
      step_count: mission.steps.length
    }
  });

  return {
    session: linkedSession,
    delegation: {
      intent,
      complexity,
      primary_target: primaryTarget,
      mission_id: mission.id,
      action_proposal_id: proposal.id,
      planner_mode: plannerMode
    }
  };
}
