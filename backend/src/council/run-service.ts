import { z } from 'zod';

import { embedAndStore } from '../memory/embed';
import { withAiInvocationTrace } from '../observability/ai-trace';
import { resolveModelSelection } from '../providers/model-selection';
import type { ResolvedModelSelection } from '../providers/model-selection';
import { generateWithPreferenceRecovery } from '../providers/preference-recovery';
import { extractProviderAttempts, maskErrorForApi } from '../providers/router';
import {
  resolveJarvisMemoryContext,
  resolveJarvisMemoryPreferences,
  resolveMemoryBackedRouting
} from '../jarvis/memory-context';
import { syncJarvisSessionFromStages } from '../jarvis/stages';
import type { ProviderAttempt, ProviderCredentialsByProvider, ProviderName } from '../providers/types';
import type { RouteContext } from '../routes/types';
import { COUNCIL_ROLES, createSpanId, truncateText } from '../routes/types';
import type {
  CouncilConsensusStatus,
  CouncilParticipantRecord,
  CouncilPhaseStatusRecord,
  CouncilRole,
  CouncilRunRecord,
  CouncilStructuredResult,
  CouncilTranscriptEntry,
} from '../store/types';

type CouncilSpanEvent = {
  name: 'provider.call.start' | 'provider.call.complete';
  provider: ProviderName;
  traceId?: string;
  success?: boolean;
  latencyMs?: number;
  error?: string;
};

export type StartCouncilRunInput = {
  userId: string;
  linkedSessionId?: string;
  traceId?: string;
  idempotencyKey: string;
  question: string;
  systemPrompt?: string;
  maxRounds?: number;
  provider?: ProviderName | 'auto';
  excludeProviders?: ProviderName[];
  strictProvider?: boolean;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  createTask?: boolean;
  taskTitle?: string;
  taskSource?: string;
  routeLabel?: string;
  waitForCompletion?: boolean;
  credentialsByProvider: ProviderCredentialsByProvider;
  onSpanEvent?: (event: CouncilSpanEvent) => void;
};

export type StartCouncilRunResult = {
  run: CouncilRunRecord;
  idempotentReplay: boolean;
  resolvedModelSelection: ResolvedModelSelection;
};

type ExplorationRole = Exclude<CouncilRole, 'synthesizer'>;

type CouncilRoleExecutionResult = {
  role: ExplorationRole;
  provider: ProviderName | null;
  model: string;
  usedFallback: boolean;
  output: string;
  attempts: ProviderAttempt[];
  latencyMs?: number;
};

const EXPLORATION_ROLES = COUNCIL_ROLES as ExplorationRole[];

const DEFAULT_COUNCIL_PHASE_STATUS: CouncilPhaseStatusRecord = {
  exploration: 'pending',
  synthesis: 'pending',
};

const HYBRID_SYNTHESIS_RETRY_LIMIT = 2;

const CouncilSynthesisSchema = z.object({
  summary: z.string().min(1).max(4000),
  consensusStatus: z.enum(['consensus_reached', 'contradiction_detected', 'escalated_to_human']),
  primaryHypothesis: z.string().min(1).max(2000),
  counterHypothesis: z.string().min(1).max(2000),
  weakestLink: z.string().min(1).max(2000),
  requiredNextSignals: z.array(z.string().min(1).max(400)).max(8),
  executionStance: z.enum(['proceed', 'hold', 'reject']),
});

function clonePhaseStatus(status?: CouncilPhaseStatusRecord): CouncilPhaseStatusRecord {
  return status
    ? { exploration: status.exploration, synthesis: status.synthesis }
    : { ...DEFAULT_COUNCIL_PHASE_STATUS };
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced?.[1]?.trim() ?? trimmed;
}

function safeParseLooseJson(text: string): unknown | null {
  const stripped = stripMarkdownCodeFence(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function flattenText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function buildLegacyRoundPrompt(question: string, roundSummaries: string[]): string {
  if (roundSummaries.length === 0) {
    return question;
  }
  return `${question}\n\nPrevious rounds:\n${roundSummaries
    .map((entry, index) => `- R${index + 1}: ${entry}`)
    .join('\n')}\n\nRefine decision, resolve contradictions, and produce updated synthesis for this round.`;
}

function mapStructuredCouncilParticipants(
  routed: Awaited<ReturnType<RouteContext['providerRouter']['generate']>>,
  roundSummaries: string[]
): CouncilRunRecord['participants'] {
  const participants: CouncilRunRecord['participants'] = COUNCIL_ROLES.map((role, index) => {
    const attempt = routed.attempts[index];
    if (!attempt) {
      return {
        role,
        provider: null,
        status: 'skipped',
        summary: 'No provider attempt assigned for this role.'
      };
    }

    if (attempt.status === 'success') {
      return {
        role,
        provider: attempt.provider,
        status: attempt.status,
        latency_ms: attempt.latencyMs,
        summary: `${attempt.provider.toUpperCase()} produced a council argument.`
      };
    }

    if (attempt.status === 'failed') {
      return {
        role,
        provider: attempt.provider,
        status: attempt.status,
        latency_ms: attempt.latencyMs,
        summary: `${attempt.provider.toUpperCase()} failed to provide argument.`,
        error: truncateText(attempt.error ?? 'provider error', 200)
      };
    }

    return {
      role,
      provider: attempt.provider,
      status: attempt.status,
      latency_ms: attempt.latencyMs,
      summary: `${attempt.provider.toUpperCase()} skipped for council route.`,
      error: truncateText(attempt.error ?? 'provider unavailable', 200)
    };
  });

  participants.push({
    role: 'synthesizer',
    provider: routed.result.provider,
    status: 'success',
    summary: truncateText(`R${roundSummaries.length}: ${routed.result.outputText}`, 240)
  });

  return participants;
}

function resolveStructuredConsensusStatus(
  attempts: ProviderAttempt[],
  roundSummaries: string[],
  usedFallback: boolean,
  consensusThreshold: number
): CouncilConsensusStatus {
  const failedCount = attempts.filter((item) => item.status === 'failed').length;
  if (failedCount === 0 && !usedFallback && roundSummaries.length >= consensusThreshold) {
    return 'consensus_reached';
  }
  if (failedCount > 0) {
    return 'contradiction_detected';
  }
  return 'escalated_to_human';
}

function buildExplorationPrompt(input: {
  question: string;
  role: ExplorationRole;
  round: number;
  maxRounds: number;
  explorationSummary?: string;
  transcript: CouncilTranscriptEntry[];
}): string {
  const recentTranscript = input.transcript
    .slice(-COUNCIL_ROLES.length * 2)
    .map((entry) => `R${entry.round} ${entry.participant}: ${entry.content}`)
    .join('\n\n');
  const priorSummary = input.explorationSummary?.trim()
    ? `Prior exploration digest:\n${input.explorationSummary.trim()}\n\n`
    : '';
  const priorTranscript = recentTranscript ? `Recent discussion transcript:\n${recentTranscript}\n\n` : '';
  return [
    `Question:\n${input.question}`,
    '',
    `${priorSummary}${priorTranscript}You are the ${input.role} viewpoint for round ${input.round}/${input.maxRounds}.`,
    'Respond in natural language. Do not return JSON or bullet-only output.',
    'Address all of these labels in your response:',
    'Current claim:',
    'Strongest counterargument:',
    'Signals to confirm:',
    'Decision flips if:',
    'Challenge the current framing and respond directly to what other roles already said when relevant.',
  ].join('\n');
}

function buildRoundDigest(round: number, entries: CouncilTranscriptEntry[]): string {
  const byRole = new Map(entries.map((entry) => [entry.participant, entry]));
  return `R${round}: ${EXPLORATION_ROLES.map((role) => {
    const entry = byRole.get(role);
    return `${role}=${truncateText(flattenText(entry?.content ?? 'no response'), 160)}`;
  }).join(' | ')}`;
}

function buildExplorationSummary(transcript: CouncilTranscriptEntry[]): string {
  const rounds = Array.from(new Set(transcript.map((entry) => entry.round))).sort((left, right) => left - right);
  return rounds
    .map((round) => buildRoundDigest(round, transcript.filter((entry) => entry.round === round)))
    .join('\n');
}

function buildSynthesisPrompt(input: {
  question: string;
  explorationSummary: string;
  transcript: CouncilTranscriptEntry[];
}): string {
  const transcriptText = input.transcript
    .map((entry) => `R${entry.round} ${entry.participant}:\n${entry.content}`)
    .join('\n\n');
  return [
    `Question:\n${input.question}`,
    '',
    `Exploration digest:\n${input.explorationSummary || 'No exploration digest available.'}`,
    '',
    `Exploration transcript:\n${transcriptText || 'No transcript available.'}`,
    '',
    'Return strict JSON only with this exact shape:',
    '{"summary":"...","consensusStatus":"consensus_reached|contradiction_detected|escalated_to_human","primaryHypothesis":"...","counterHypothesis":"...","weakestLink":"...","requiredNextSignals":["..."],"executionStance":"proceed|hold|reject"}',
    'Do not wrap the JSON in markdown fences.',
  ].join('\n');
}

function resolveLatestLatency(attempts: ProviderAttempt[]): number | undefined {
  return [...attempts].reverse().find((attempt) => typeof attempt.latencyMs === 'number')?.latencyMs;
}

function buildHybridParticipants(
  roleResults: Partial<Record<ExplorationRole, CouncilRoleExecutionResult>>,
  synthesizer?: {
    provider: ProviderName | null;
    status: CouncilParticipantRecord['status'];
    summary: string;
    error?: string;
    latency_ms?: number;
  }
): CouncilRunRecord['participants'] {
  const participants: CouncilRunRecord['participants'] = EXPLORATION_ROLES.map((role) => {
    const result = roleResults[role];
    if (!result) {
      return {
        role,
        provider: null,
        status: 'skipped',
        summary: 'Awaiting exploration response.'
      };
    }
    return {
      role,
      provider: result.provider,
      status: 'success',
      latency_ms: result.latencyMs,
      summary: truncateText(result.output, 240)
    };
  });

  participants.push(
    synthesizer
      ? {
          role: 'synthesizer',
          ...synthesizer
        }
      : {
          role: 'synthesizer',
          provider: null,
          status: 'skipped',
          summary: 'Awaiting synthesis.'
        }
  );

  return participants;
}

function isHybridSynthesisEscalation(run: CouncilRunRecord): boolean {
  return run.workflow_version === 'hybrid_v1'
    && run.status === 'completed'
    && run.phase_status?.exploration === 'completed'
    && run.phase_status?.synthesis === 'failed';
}

function resolveCouncilSessionStatus(run: CouncilRunRecord): 'running' | 'completed' | 'failed' | 'blocked' {
  if (isHybridSynthesisEscalation(run)) {
    return 'blocked';
  }
  if (run.status === 'completed') {
    return 'completed';
  }
  if (run.status === 'failed') {
    return 'failed';
  }
  return 'running';
}

async function resolveCouncilModelSelection(ctx: RouteContext, input: StartCouncilRunInput): Promise<ResolvedModelSelection> {
  const { store } = ctx;
  const memoryContext = await resolveJarvisMemoryContext(store, {
    userId: input.userId,
    prompt: input.question
  });
  const memoryPreferences = resolveJarvisMemoryPreferences(memoryContext);
  const memoryRouting = resolveMemoryBackedRouting({
    provider: input.provider,
    strictProvider: input.strictProvider,
    model: input.model,
    memoryPreferences
  });

  return resolveModelSelection({
    store,
    userId: input.userId,
    featureKey: 'council_run',
    override: {
      provider: memoryRouting.provider,
      strictProvider: memoryRouting.strictProvider,
      model: memoryRouting.model
    }
  });
}

function useHybridCouncilWorkflow(ctx: Pick<RouteContext, 'env'>): boolean {
  return ctx.env.COUNCIL_WORKFLOW_MODE !== 'structured';
}

async function invokeCouncilGeneration(params: {
  ctx: RouteContext;
  input: StartCouncilRunInput;
  run: CouncilRunRecord;
  modelSelection: ResolvedModelSelection;
  phase: 'exploration' | 'synthesis';
  prompt: string;
  systemPrompt: string;
  round?: number;
  role?: ExplorationRole;
  retry?: number;
}) {
  const { ctx, input, run, modelSelection, phase, prompt, systemPrompt, round, role, retry } = params;
  return withAiInvocationTrace({
    store: ctx.store,
    env: ctx.env,
    userId: input.userId,
    featureKey: 'council_run',
    taskType: 'council',
    requestProvider: modelSelection.provider,
    requestModel: modelSelection.model,
    traceId: input.traceId,
    contextRefs: {
      route: input.routeLabel ?? '/api/v1/councils/runs',
      run_id: run.id,
      phase,
      round,
      role,
      retry,
      model_selection_source: modelSelection.source
    },
    run: () =>
      generateWithPreferenceRecovery({
        providerRouter: ctx.providerRouter,
        modelSelection,
        request: {
          prompt,
          systemPrompt,
          provider: modelSelection.provider,
          credentialsByProvider: input.credentialsByProvider,
          traceId: input.traceId,
          onSpanEvent: input.onSpanEvent,
          excludeProviders: input.excludeProviders,
          strictProvider: modelSelection.strictProvider,
          taskType: 'council',
          model: modelSelection.model ?? undefined,
          temperature: input.temperature,
          maxOutputTokens: input.maxOutputTokens
        }
      })
  });
}

async function finalizeSuccessfulCouncilRun(params: {
  ctx: RouteContext;
  input: StartCouncilRunInput;
  run: CouncilRunRecord;
  taskId: string | null;
  summary: string;
  consensusStatus: CouncilConsensusStatus;
  roundsExecuted: number;
  createBriefArtifacts: boolean;
}): Promise<void> {
  const { ctx, input, run, taskId, summary, consensusStatus, roundsExecuted, createBriefArtifacts } = params;
  const { store } = ctx;

  if (input.linkedSessionId) {
    if (createBriefArtifacts) {
      const briefing = await store.createBriefing({
        userId: input.userId,
        sessionId: input.linkedSessionId,
        type: 'on_demand',
        status: 'completed',
        title: truncateText(input.question, 140),
        query: input.question,
        summary: truncateText(summary, 280),
        answerMarkdown: summary,
        sourceCount: 0,
        qualityJson: {
          source: 'council',
          consensus_status: consensusStatus,
          rounds_executed: roundsExecuted
        }
      });
      const dossier = await store.createDossier({
        userId: input.userId,
        sessionId: input.linkedSessionId,
        briefingId: briefing.id,
        title: truncateText(input.question, 140),
        query: input.question,
        status: 'ready',
        summary: truncateText(summary, 280),
        answerMarkdown: summary,
        qualityJson: {
          source: 'council',
          consensus_status: consensusStatus
        },
        conflictsJson: {
          consensus_status: consensusStatus
        }
      });
      await store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: input.linkedSessionId,
        stageKey: 'debate',
        capability: 'debate',
        title: 'Council debate',
        status: 'completed',
        summary: truncateText(summary, 220),
        artifactRefsJson: {
          council_run_id: run.id,
          task_id: taskId
        },
        completedAt: new Date().toISOString()
      });
      await store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: input.linkedSessionId,
        stageKey: 'brief',
        capability: 'brief',
        title: 'Brief synthesis',
        status: 'completed',
        summary: truncateText(summary, 220),
        artifactRefsJson: {
          briefing_id: briefing.id,
          dossier_id: dossier.id
        },
        completedAt: new Date().toISOString()
      });
      const synced = await syncJarvisSessionFromStages(store, {
        userId: input.userId,
        sessionId: input.linkedSessionId
      });
      await store.updateJarvisSession({
        sessionId: input.linkedSessionId,
        userId: input.userId,
        status: synced?.snapshot.status ?? 'completed',
        taskId,
        councilRunId: run.id,
        briefingId: briefing.id,
        dossierId: dossier.id
      });
    } else {
      await store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: input.linkedSessionId,
        stageKey: 'debate',
        capability: 'debate',
        title: 'Council debate',
        status: 'completed',
        summary: truncateText(summary, 220),
        artifactRefsJson: {
          council_run_id: run.id,
          task_id: taskId
        },
        completedAt: new Date().toISOString()
      });
      await store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: input.linkedSessionId,
        stageKey: 'brief',
        capability: 'brief',
        title: 'Brief synthesis',
        status: 'blocked',
        summary: 'Brief is blocked until the structured synthesis succeeds'
      });
      const synced = await syncJarvisSessionFromStages(store, {
        userId: input.userId,
        sessionId: input.linkedSessionId
      });
      await store.updateJarvisSession({
        sessionId: input.linkedSessionId,
        userId: input.userId,
        status: synced?.snapshot.status ?? 'blocked',
        taskId,
        councilRunId: run.id
      });
    }
  }

  void embedAndStore(store, null, {
    userId: input.userId,
    content: `Council Q: ${input.question}\nSynthesis: ${summary}`,
    segmentType: 'council_synthesis',
    taskId: taskId ?? undefined,
    confidence: consensusStatus === 'consensus_reached' ? 0.9 : 0.5
  }).catch(() => undefined);

  if (taskId) {
    await store.setTaskStatus({
      taskId,
      status: 'done',
      eventType: 'task.done',
      traceId: input.traceId,
      spanId: createSpanId(),
      data: {
        source: 'council_run',
        run_id: run.id,
        consensus_status: consensusStatus,
        rounds_executed: roundsExecuted
      }
    });
  }
}

async function failCouncilRun(params: {
  ctx: RouteContext;
  input: StartCouncilRunInput;
  run: CouncilRunRecord;
  taskId: string | null;
  summary: string;
  reason: string;
  attempts: ProviderAttempt[];
  participants: CouncilRunRecord['participants'];
  provider: ProviderName | null;
  model: string;
  usedFallback: boolean;
  phaseStatus?: CouncilPhaseStatusRecord;
  explorationSummary?: string;
  explorationTranscript?: CouncilTranscriptEntry[];
}): Promise<CouncilRunRecord> {
  const {
    ctx,
    input,
    run,
    taskId,
    summary,
    reason,
    attempts,
    participants,
    provider,
    model,
    usedFallback,
    phaseStatus,
    explorationSummary,
    explorationTranscript
  } = params;

  const failedRun = await ctx.store.updateCouncilRun({
    runId: run.id,
    status: 'failed',
    consensus_status: 'escalated_to_human',
    summary,
    participants,
    attempts,
    provider,
    model,
    used_fallback: usedFallback,
    workflow_version: useHybridCouncilWorkflow(ctx) ? 'hybrid_v1' : 'structured_v1',
    phase_status: phaseStatus,
    exploration_summary: explorationSummary,
    exploration_transcript: explorationTranscript,
    synthesis_error: reason,
    structured_result: null
  });

  if (input.linkedSessionId) {
    await ctx.store.upsertJarvisSessionStage({
      userId: input.userId,
      sessionId: input.linkedSessionId,
      stageKey: 'debate',
      capability: 'debate',
      title: 'Council debate',
      status: 'failed',
      summary: truncateText(summary, 220),
      errorMessage: reason,
      artifactRefsJson: {
        council_run_id: run.id,
        task_id: taskId
      },
      completedAt: new Date().toISOString()
    });
    await ctx.store.upsertJarvisSessionStage({
      userId: input.userId,
      sessionId: input.linkedSessionId,
      stageKey: 'brief',
      capability: 'brief',
      title: 'Brief synthesis',
      status: 'blocked',
      summary: 'Brief is blocked until the debate succeeds'
    });
    const synced = await syncJarvisSessionFromStages(ctx.store, {
      userId: input.userId,
      sessionId: input.linkedSessionId
    });
    await ctx.store.updateJarvisSession({
      sessionId: input.linkedSessionId,
      userId: input.userId,
      status: synced?.snapshot.status ?? 'failed',
      taskId,
      councilRunId: run.id
    });
  }

  if (taskId) {
    await ctx.store.setTaskStatus({
      taskId,
      status: 'failed',
      eventType: 'task.failed',
      traceId: input.traceId,
      spanId: createSpanId(),
      data: {
        source: 'council_run',
        run_id: run.id,
        error_code: 'PROVIDER_ROUTING_FAILED',
        error: reason
      }
    });
  }

  return failedRun ?? {
    ...run,
    status: 'failed',
    consensus_status: 'escalated_to_human',
    summary,
    participants,
    attempts,
    provider,
    model,
    used_fallback: usedFallback,
    workflow_version: useHybridCouncilWorkflow(ctx) ? 'hybrid_v1' : 'structured_v1',
    phase_status: phaseStatus,
    exploration_summary: explorationSummary,
    exploration_transcript: explorationTranscript,
    synthesis_error: reason,
    structured_result: null
  };
}

async function attemptHybridCouncilSynthesis(params: {
  ctx: RouteContext;
  input: StartCouncilRunInput;
  run: CouncilRunRecord;
  modelSelection: ResolvedModelSelection;
  question: string;
  explorationSummary: string;
  transcript: CouncilTranscriptEntry[];
}): Promise<
  | {
      ok: true;
      result: CouncilStructuredResult;
      attempts: ProviderAttempt[];
      provider: ProviderName;
      model: string;
      usedFallback: boolean;
      latencyMs?: number;
    }
  | {
      ok: false;
      reason: string;
      attempts: ProviderAttempt[];
      provider: ProviderName | null;
      model: string;
      usedFallback: boolean;
      latencyMs?: number;
    }
> {
  const synthesisAttempts: ProviderAttempt[] = [];
  let provider: ProviderName | null = null;
  let model = 'pending';
  let usedFallback = false;
  let latencyMs: number | undefined;
  let lastReason = 'Structured synthesis returned invalid output.';

  for (let retry = 0; retry <= HYBRID_SYNTHESIS_RETRY_LIMIT; retry += 1) {
    let routed: Awaited<ReturnType<typeof invokeCouncilGeneration>>;
    try {
      routed = await invokeCouncilGeneration({
        ctx: params.ctx,
        input: params.input,
        run: params.run,
        modelSelection: params.modelSelection,
        phase: 'synthesis',
        prompt: buildSynthesisPrompt({
          question: params.question,
          explorationSummary: params.explorationSummary,
          transcript: params.transcript
        }),
        systemPrompt: params.input.systemPrompt
          ? `${params.input.systemPrompt}\n\nStructured council synthesis. Return JSON only.`
          : 'Structured council synthesis. Return JSON only.',
        retry
      });
    } catch (error) {
      return {
        ok: false,
        reason: maskErrorForApi(error),
        attempts: synthesisAttempts.concat(extractProviderAttempts(error)),
        provider,
        model,
        usedFallback,
        latencyMs
      };
    }

    synthesisAttempts.push(...routed.attempts);
    provider = routed.result.provider;
    model = routed.result.model;
    usedFallback = usedFallback || routed.usedFallback;
    latencyMs = resolveLatestLatency(routed.attempts) ?? latencyMs;

    const parsed = CouncilSynthesisSchema.safeParse(safeParseLooseJson(routed.result.outputText));
    if (parsed.success) {
      return {
        ok: true,
        result: parsed.data,
        attempts: synthesisAttempts,
        provider: routed.result.provider,
        model: routed.result.model,
        usedFallback,
        latencyMs
      };
    }

    lastReason = `Structured synthesis validation failed: ${parsed.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}`;
  }

  return {
    ok: false,
    reason: lastReason,
    attempts: synthesisAttempts,
    provider,
    model,
    usedFallback,
    latencyMs
  };
}

async function executeStructuredCouncilRun(
  ctx: RouteContext,
  input: StartCouncilRunInput,
  run: CouncilRunRecord,
  taskId: string | null,
  modelSelection: ResolvedModelSelection
): Promise<CouncilRunRecord> {
  const maxRounds = input.maxRounds ?? 2;
  const consensusThreshold = maxRounds > 1 ? 2 : 1;
  const roundSummaries: string[] = [];
  const allAttempts: CouncilRunRecord['attempts'] = [];
  let routed: Awaited<ReturnType<typeof invokeCouncilGeneration>> | null = null;

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      const roundPrompt = buildLegacyRoundPrompt(input.question, roundSummaries);
      const roundSystemPrompt = input.systemPrompt
        ? `${input.systemPrompt}\n\nCouncil round ${round}/${maxRounds}.`
        : `Council round ${round}/${maxRounds}.`;

      routed = await invokeCouncilGeneration({
        ctx,
        input,
        run,
        modelSelection,
        phase: 'exploration',
        prompt: roundPrompt,
        systemPrompt: roundSystemPrompt,
        round
      });

      allAttempts.push(...routed.attempts);
      roundSummaries.push(truncateText(routed.result.outputText, 500));

      await ctx.store.updateCouncilRun({
        runId: run.id,
        status: 'running',
        summary: `Round ${round}/${maxRounds} complete: ${truncateText(routed.result.outputText, 220)}`,
        attempts: allAttempts,
        provider: routed.result.provider,
        model: routed.result.model,
        used_fallback: routed.usedFallback,
        workflow_version: 'structured_v1'
      });

      const roundFailedCount = routed.attempts.filter((item) => item.status === 'failed').length;
      if (roundFailedCount === 0 && !routed.usedFallback && round >= consensusThreshold) {
        break;
      }
    }

    if (!routed) {
      throw new Error('council round execution did not produce a routed result');
    }

    const consensusStatus = resolveStructuredConsensusStatus(allAttempts, roundSummaries, routed.usedFallback, consensusThreshold);
    const participants = mapStructuredCouncilParticipants(routed, roundSummaries);
    const summaryWithRounds =
      roundSummaries.length > 1
        ? `${routed.result.outputText}\n\nRound log:\n${roundSummaries.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}`
        : routed.result.outputText;

    const completedRun = await ctx.store.updateCouncilRun({
      runId: run.id,
      status: 'completed',
      consensus_status: consensusStatus,
      summary: summaryWithRounds,
      participants,
      attempts: allAttempts,
      provider: routed.result.provider,
      model: routed.result.model,
      used_fallback: routed.usedFallback,
      workflow_version: 'structured_v1'
    });

    const latestRun = completedRun ?? {
      ...run,
      status: 'completed',
      consensus_status: consensusStatus,
      summary: summaryWithRounds,
      participants,
      attempts: allAttempts,
      provider: routed.result.provider,
      model: routed.result.model,
      used_fallback: routed.usedFallback,
      workflow_version: 'structured_v1'
    };

    await finalizeSuccessfulCouncilRun({
      ctx,
      input,
      run: latestRun,
      taskId,
      summary: summaryWithRounds,
      consensusStatus,
      roundsExecuted: roundSummaries.length,
      createBriefArtifacts: true
    });

    return latestRun;
  } catch (error) {
    const reason = maskErrorForApi(error);
    const attempts = allAttempts.concat(extractProviderAttempts(error));

    return failCouncilRun({
      ctx,
      input,
      run,
      taskId,
      summary: `PROVIDER_ROUTING_FAILED: ${reason}`,
      reason,
      attempts,
      participants: [
        {
          role: 'synthesizer',
          provider: null,
          status: 'failed',
          summary: 'Council synthesis failed.',
          error: reason
        }
      ],
      provider: null,
      model: 'failed',
      usedFallback: true
    });
  }
}

async function executeHybridCouncilRun(
  ctx: RouteContext,
  input: StartCouncilRunInput,
  run: CouncilRunRecord,
  taskId: string | null,
  modelSelection: ResolvedModelSelection
): Promise<CouncilRunRecord> {
  const maxRounds = input.maxRounds ?? 2;
  const allAttempts: CouncilRunRecord['attempts'] = [];
  const transcript: CouncilTranscriptEntry[] = [];
  const roleResults: Partial<Record<ExplorationRole, CouncilRoleExecutionResult>> = {};
  let explorationSummary = '';
  let usedFallback = false;
  let lastProvider: ProviderName | null = null;
  let lastModel = 'pending';

  const runningPhaseStatus: CouncilPhaseStatusRecord = {
    exploration: 'running',
    synthesis: 'pending'
  };

  await ctx.store.updateCouncilRun({
    runId: run.id,
    workflow_version: 'hybrid_v1',
    phase_status: runningPhaseStatus,
    participants: buildHybridParticipants(roleResults),
    summary: `Round 1/${maxRounds} in progress: free-form exploration underway.`,
    attempts: allAttempts,
    provider: lastProvider,
    model: lastModel,
    used_fallback: usedFallback
  });

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      await ctx.store.updateCouncilRun({
        runId: run.id,
        status: 'running',
        workflow_version: 'hybrid_v1',
        phase_status: runningPhaseStatus,
        summary: `Round ${round}/${maxRounds} in progress: free-form exploration underway.`,
        participants: buildHybridParticipants(roleResults),
        attempts: allAttempts,
        provider: lastProvider,
        model: lastModel,
        used_fallback: usedFallback,
        exploration_summary: explorationSummary || undefined,
        exploration_transcript: transcript
      });

      for (const role of EXPLORATION_ROLES) {
        const routed = await invokeCouncilGeneration({
          ctx,
          input,
          run,
          modelSelection,
          phase: 'exploration',
          prompt: buildExplorationPrompt({
            question: input.question,
            role,
            round,
            maxRounds,
            explorationSummary,
            transcript
          }),
          systemPrompt: input.systemPrompt
            ? `${input.systemPrompt}\n\nFree-form council exploration. Role: ${role}. Round ${round}/${maxRounds}.`
            : `Free-form council exploration. Role: ${role}. Round ${round}/${maxRounds}.`,
          round,
          role
        });

        allAttempts.push(...routed.attempts);
        usedFallback = usedFallback || routed.usedFallback;
        lastProvider = routed.result.provider;
        lastModel = routed.result.model;

        const roleResult: CouncilRoleExecutionResult = {
          role,
          provider: routed.result.provider,
          model: routed.result.model,
          usedFallback: routed.usedFallback,
          output: routed.result.outputText,
          attempts: routed.attempts,
          latencyMs: resolveLatestLatency(routed.attempts)
        };
        roleResults[role] = roleResult;

        transcript.push({
          round,
          participant: role,
          content: routed.result.outputText,
          createdAt: new Date().toISOString()
        });
        explorationSummary = buildExplorationSummary(transcript);

        await ctx.store.updateCouncilRun({
          runId: run.id,
          status: 'running',
          workflow_version: 'hybrid_v1',
          phase_status: runningPhaseStatus,
          summary: `Round ${round}/${maxRounds} in progress: ${role} responded.`,
          participants: buildHybridParticipants(roleResults),
          attempts: allAttempts,
          provider: lastProvider,
          model: lastModel,
          used_fallback: usedFallback,
          exploration_summary: explorationSummary,
          exploration_transcript: transcript
        });
      }

      explorationSummary = buildExplorationSummary(transcript);
      await ctx.store.updateCouncilRun({
        runId: run.id,
        status: 'running',
        workflow_version: 'hybrid_v1',
        phase_status: runningPhaseStatus,
        summary: `Round ${round}/${maxRounds} complete: ${truncateText(buildRoundDigest(round, transcript.filter((entry) => entry.round === round)), 220)}`,
        participants: buildHybridParticipants(roleResults),
        attempts: allAttempts,
        provider: lastProvider,
        model: lastModel,
        used_fallback: usedFallback,
        exploration_summary: explorationSummary,
        exploration_transcript: transcript
      });
    }
  } catch (error) {
    const reason = maskErrorForApi(error);
    const attempts = allAttempts.concat(extractProviderAttempts(error));
    const phaseStatus: CouncilPhaseStatusRecord = {
      exploration: 'failed',
      synthesis: 'pending'
    };

    return failCouncilRun({
      ctx,
      input,
      run,
      taskId,
      summary: `PROVIDER_ROUTING_FAILED: ${reason}`,
      reason,
      attempts,
      participants: buildHybridParticipants(roleResults),
      provider: lastProvider,
      model: lastModel,
      usedFallback: usedFallback || attempts.some((attempt) => attempt.status === 'skipped'),
      phaseStatus,
      explorationSummary: explorationSummary || undefined,
      explorationTranscript: transcript
    });
  }

  const synthesisPhaseStatus: CouncilPhaseStatusRecord = {
    exploration: 'completed',
    synthesis: 'running'
  };

  await ctx.store.updateCouncilRun({
    runId: run.id,
    status: 'running',
    workflow_version: 'hybrid_v1',
    phase_status: synthesisPhaseStatus,
    summary: 'Synthesis in progress: consolidating exploration transcript.',
    participants: buildHybridParticipants(roleResults),
    attempts: allAttempts,
    provider: lastProvider,
    model: lastModel,
    used_fallback: usedFallback,
    exploration_summary: explorationSummary,
    exploration_transcript: transcript
  });

  const synthesis = await attemptHybridCouncilSynthesis({
    ctx,
    input,
    run,
    modelSelection,
    question: input.question,
    explorationSummary,
    transcript
  });

  allAttempts.push(...synthesis.attempts);
  usedFallback = usedFallback || synthesis.usedFallback;

  if (!synthesis.ok) {
    const fallbackSummary = `[Exploration only] ${truncateText(explorationSummary || 'Human review required.', 3800)}`;
    const completedRun = await ctx.store.updateCouncilRun({
      runId: run.id,
      status: 'completed',
      consensus_status: 'escalated_to_human',
      summary: fallbackSummary,
      participants: buildHybridParticipants(roleResults, {
        provider: synthesis.provider,
        status: 'failed',
        summary: 'Structured synthesis failed; human review required.',
        error: synthesis.reason,
        latency_ms: synthesis.latencyMs
      }),
      attempts: allAttempts,
      provider: synthesis.provider ?? lastProvider,
      model: synthesis.model || lastModel,
      used_fallback: usedFallback,
      workflow_version: 'hybrid_v1',
      phase_status: {
        exploration: 'completed',
        synthesis: 'failed'
      },
      exploration_summary: explorationSummary,
      exploration_transcript: transcript,
      synthesis_error: synthesis.reason,
      structured_result: null
    });

    const latestRun = completedRun ?? {
      ...run,
      status: 'completed',
      consensus_status: 'escalated_to_human',
      summary: fallbackSummary,
      participants: buildHybridParticipants(roleResults, {
        provider: synthesis.provider,
        status: 'failed',
        summary: 'Structured synthesis failed; human review required.',
        error: synthesis.reason,
        latency_ms: synthesis.latencyMs
      }),
      attempts: allAttempts,
      provider: synthesis.provider ?? lastProvider,
      model: synthesis.model || lastModel,
      used_fallback: usedFallback,
      workflow_version: 'hybrid_v1',
      phase_status: {
        exploration: 'completed',
        synthesis: 'failed'
      },
      exploration_summary: explorationSummary,
      exploration_transcript: transcript,
      synthesis_error: synthesis.reason,
      structured_result: null
    };

    await finalizeSuccessfulCouncilRun({
      ctx,
      input,
      run: latestRun,
      taskId,
      summary: fallbackSummary,
      consensusStatus: 'escalated_to_human',
      roundsExecuted: maxRounds,
      createBriefArtifacts: false
    });

    return latestRun;
  }

  const completedRun = await ctx.store.updateCouncilRun({
    runId: run.id,
    status: 'completed',
    consensus_status: synthesis.result.consensusStatus,
    summary: synthesis.result.summary,
    participants: buildHybridParticipants(roleResults, {
      provider: synthesis.provider,
      status: 'success',
      summary: truncateText(synthesis.result.summary, 240),
      latency_ms: synthesis.latencyMs
    }),
    attempts: allAttempts,
    provider: synthesis.provider,
    model: synthesis.model,
    used_fallback: usedFallback,
    workflow_version: 'hybrid_v1',
    phase_status: {
      exploration: 'completed',
      synthesis: 'completed'
    },
    exploration_summary: explorationSummary,
    exploration_transcript: transcript,
    synthesis_error: null,
    structured_result: synthesis.result
  });

  const latestRun = completedRun ?? {
    ...run,
    status: 'completed',
    consensus_status: synthesis.result.consensusStatus,
    summary: synthesis.result.summary,
    participants: buildHybridParticipants(roleResults, {
      provider: synthesis.provider,
      status: 'success',
      summary: truncateText(synthesis.result.summary, 240),
      latency_ms: synthesis.latencyMs
    }),
    attempts: allAttempts,
    provider: synthesis.provider,
    model: synthesis.model,
    used_fallback: usedFallback,
    workflow_version: 'hybrid_v1',
    phase_status: {
      exploration: 'completed',
      synthesis: 'completed'
    },
    exploration_summary: explorationSummary,
    exploration_transcript: transcript,
    synthesis_error: null,
    structured_result: synthesis.result
  };

  await finalizeSuccessfulCouncilRun({
    ctx,
    input,
    run: latestRun,
    taskId,
    summary: synthesis.result.summary,
    consensusStatus: synthesis.result.consensusStatus,
    roundsExecuted: maxRounds,
    createBriefArtifacts: true
  });

  return latestRun;
}

async function executeCouncilRun(
  ctx: RouteContext,
  input: StartCouncilRunInput,
  run: CouncilRunRecord,
  taskId: string | null,
  modelSelection: ResolvedModelSelection
) : Promise<CouncilRunRecord> {
  if (useHybridCouncilWorkflow(ctx)) {
    return executeHybridCouncilRun(ctx, input, run, taskId, modelSelection);
  }
  return executeStructuredCouncilRun(ctx, input, run, taskId, modelSelection);
}

export async function startCouncilRun(ctx: RouteContext, input: StartCouncilRunInput): Promise<StartCouncilRunResult> {
  const { store } = ctx;
  const resolvedModelSelection = await resolveCouncilModelSelection(ctx, input);
  const existing = await store.getCouncilRunByIdempotency({
    userId: input.userId,
    idempotencyKey: input.idempotencyKey
  });
  if (existing) {
    if (input.linkedSessionId) {
      const existingSession = await store.getJarvisSessionById({ userId: input.userId, sessionId: input.linkedSessionId });
      const sessionStatus = resolveCouncilSessionStatus(existing);
      if (existingSession) {
        await store.updateJarvisSession({
          sessionId: input.linkedSessionId,
          userId: input.userId,
          title: input.taskTitle ?? truncateText(input.question, 180),
          prompt: input.question,
          status: sessionStatus,
          workspacePreset: 'jarvis',
          primaryTarget: 'council',
          taskId: existing.task_id,
          councilRunId: existing.id
        });
      } else {
        await store.createJarvisSession({
          id: input.linkedSessionId,
          userId: input.userId,
          title: input.taskTitle ?? truncateText(input.question, 180),
          prompt: input.question,
          source: input.taskSource ?? 'council_run_api',
          intent: 'council',
          status: sessionStatus,
          workspacePreset: 'jarvis',
          primaryTarget: 'council',
          taskId: existing.task_id,
          councilRunId: existing.id
        });
      }
      await store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: input.linkedSessionId,
        stageKey: 'debate',
        capability: 'debate',
        title: 'Council debate',
        status:
          sessionStatus === 'completed'
            ? 'completed'
            : sessionStatus === 'failed'
              ? 'failed'
              : sessionStatus === 'blocked'
                ? 'completed'
                : 'running',
        orderIndex: 0,
        summary:
          sessionStatus === 'blocked'
            ? 'Reused council exploration awaiting structured synthesis review'
            : sessionStatus === 'completed'
              ? 'Reused completed council debate'
              : 'Reused council run',
        artifactRefsJson: {
          council_run_id: existing.id,
          task_id: existing.task_id
        },
        completedAt:
          sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'blocked'
            ? new Date().toISOString()
            : null
      });
      await store.upsertJarvisSessionStage({
        userId: input.userId,
        sessionId: input.linkedSessionId,
        stageKey: 'brief',
        capability: 'brief',
        title: 'Brief synthesis',
        status: sessionStatus === 'completed' ? 'completed' : sessionStatus === 'blocked' ? 'blocked' : 'queued',
        orderIndex: 1,
        summary:
          sessionStatus === 'completed'
            ? 'Brief ready from prior council run'
            : sessionStatus === 'blocked'
              ? 'Brief is blocked until the structured synthesis succeeds'
              : 'Brief will follow after debate'
      });
    }
    return {
      run: existing,
      idempotentReplay: true,
      resolvedModelSelection
    };
  }

  const run = await store.createCouncilRun({
    user_id: input.userId,
    idempotency_key: input.idempotencyKey,
    trace_id: input.traceId,
    question: input.question,
    status: 'running',
    consensus_status: null,
    summary: 'Council run started.',
    participants: [],
    attempts: [],
    provider: null,
    model: 'pending',
    used_fallback: false,
    task_id: null,
    workflow_version: useHybridCouncilWorkflow(ctx) ? 'hybrid_v1' : 'structured_v1',
    phase_status: useHybridCouncilWorkflow(ctx) ? clonePhaseStatus() : undefined,
    exploration_summary: undefined,
    exploration_transcript: [],
    synthesis_error: null,
    structured_result: null
  });

  let taskId: string | null = null;
  if (input.createTask) {
    const task = await store.createTask({
      userId: input.userId,
      mode: 'council',
      title: input.taskTitle ?? truncateText(input.question, 180),
      input: {
        question: input.question,
        source: input.taskSource ?? 'council_run_api',
        run_id: run.id
      },
      idempotencyKey: `${input.idempotencyKey}:council-task`,
      traceId: input.traceId
    });
    taskId = task.id;

    await store.updateCouncilRun({
      runId: run.id,
      task_id: taskId
    });

    await store.setTaskStatus({
      taskId,
      status: 'running',
      eventType: 'task.updated',
      traceId: input.traceId,
      spanId: createSpanId(),
      data: {
        source: 'council_run',
        run_id: run.id,
        stage: 'running'
      }
    });
  }

  if (input.linkedSessionId) {
    const existingSession = await store.getJarvisSessionById({ userId: input.userId, sessionId: input.linkedSessionId });
    if (existingSession) {
      await store.updateJarvisSession({
        sessionId: input.linkedSessionId,
        userId: input.userId,
        title: input.taskTitle ?? truncateText(input.question, 180),
        prompt: input.question,
        status: 'running',
        workspacePreset: 'jarvis',
        primaryTarget: 'council',
        taskId,
        councilRunId: run.id
      });
    } else {
      await store.createJarvisSession({
        id: input.linkedSessionId,
        userId: input.userId,
        title: input.taskTitle ?? truncateText(input.question, 180),
        prompt: input.question,
        source: input.taskSource ?? 'council_run_api',
        intent: 'council',
        status: 'running',
        workspacePreset: 'jarvis',
        primaryTarget: 'council',
        taskId,
        councilRunId: run.id
      });
    }
    await store.upsertJarvisSessionStage({
      userId: input.userId,
      sessionId: input.linkedSessionId,
      stageKey: 'debate',
      capability: 'debate',
      title: 'Council debate',
      status: 'running',
      orderIndex: 0,
      summary: 'Council debate started',
      artifactRefsJson: {
        council_run_id: run.id,
        task_id: taskId
      },
      startedAt: new Date().toISOString()
    });
    await store.upsertJarvisSessionStage({
      userId: input.userId,
      sessionId: input.linkedSessionId,
      stageKey: 'brief',
      capability: 'brief',
      title: 'Brief synthesis',
      status: 'queued',
      orderIndex: 1,
      summary: 'Brief will be compiled after the debate'
    });
  }

  const execution = executeCouncilRun(ctx, input, run, taskId, resolvedModelSelection);
  if (!input.waitForCompletion) {
    void execution;
  }

  const latest = input.waitForCompletion
    ? await execution
    : await store.getCouncilRunById(run.id);
  return {
    run: latest ?? run,
    idempotentReplay: false,
    resolvedModelSelection
  };
}
