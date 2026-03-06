import { embedAndStore } from '../memory/embed';
import { withAiInvocationTrace } from '../observability/ai-trace';
import { resolveModelSelection } from '../providers/model-selection';
import { extractProviderAttempts, maskErrorForApi } from '../providers/router';
import type { ProviderAttempt, ProviderCredentialsByProvider, ProviderName } from '../providers/types';
import type { RouteContext } from '../routes/types';
import { COUNCIL_ROLES, createSpanId, truncateText } from '../routes/types';
import type { CouncilConsensusStatus, CouncilRunRecord } from '../store/types';

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
  credentialsByProvider: ProviderCredentialsByProvider;
  onSpanEvent?: (event: CouncilSpanEvent) => void;
};

export type StartCouncilRunResult = {
  run: CouncilRunRecord;
  idempotentReplay: boolean;
};

function buildRoundPrompt(question: string, roundSummaries: string[]): string {
  if (roundSummaries.length === 0) {
    return question;
  }
  return `${question}\n\nPrevious rounds:\n${roundSummaries
    .map((entry, index) => `- R${index + 1}: ${entry}`)
    .join('\n')}\n\nRefine decision, resolve contradictions, and produce updated synthesis for this round.`;
}

function mapCouncilParticipants(
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

function resolveConsensusStatus(
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

async function executeCouncilRun(ctx: RouteContext, input: StartCouncilRunInput, run: CouncilRunRecord, taskId: string | null) {
  const { store, providerRouter, env } = ctx;
  const maxRounds = input.maxRounds ?? 2;
  const consensusThreshold = maxRounds > 1 ? 2 : 1;
  const roundSummaries: string[] = [];
  const allAttempts: CouncilRunRecord['attempts'] = [];
  let routed: Awaited<ReturnType<typeof providerRouter.generate>> | null = null;

  try {
    const modelSelection = await resolveModelSelection({
      store,
      userId: input.userId,
      featureKey: 'council_run',
      override: {
        provider: input.provider,
        strictProvider: input.strictProvider,
        model: input.model
      }
    });

    for (let round = 1; round <= maxRounds; round += 1) {
      const roundPrompt = buildRoundPrompt(input.question, roundSummaries);
      const roundSystemPrompt = input.systemPrompt
        ? `${input.systemPrompt}\n\nCouncil round ${round}/${maxRounds}.`
        : `Council round ${round}/${maxRounds}.`;

      routed = await withAiInvocationTrace({
        store,
        env,
        userId: input.userId,
        featureKey: 'council_run',
        taskType: 'council',
        requestProvider: modelSelection.provider,
        requestModel: modelSelection.model,
        traceId: input.traceId,
        contextRefs: {
          route: input.routeLabel ?? '/api/v1/councils/runs',
          run_id: run.id,
          round,
          model_selection_source: modelSelection.source
        },
        run: () =>
          providerRouter.generate({
            prompt: roundPrompt,
            systemPrompt: roundSystemPrompt,
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
          })
      });

      allAttempts.push(...routed.attempts);
      roundSummaries.push(truncateText(routed.result.outputText, 500));

      await store.updateCouncilRun({
        runId: run.id,
        status: 'running',
        summary: `Round ${round}/${maxRounds} complete: ${truncateText(routed.result.outputText, 220)}`,
        attempts: allAttempts,
        provider: routed.result.provider,
        model: routed.result.model,
        used_fallback: routed.usedFallback
      });

      const roundFailedCount = routed.attempts.filter((item) => item.status === 'failed').length;
      if (roundFailedCount === 0 && !routed.usedFallback && round >= consensusThreshold) {
        break;
      }
    }

    if (!routed) {
      throw new Error('council round execution did not produce a routed result');
    }

    const consensusStatus = resolveConsensusStatus(allAttempts, roundSummaries, routed.usedFallback, consensusThreshold);
    const participants = mapCouncilParticipants(routed, roundSummaries);
    const summaryWithRounds =
      roundSummaries.length > 1
        ? `${routed.result.outputText}\n\nRound log:\n${roundSummaries.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}`
        : routed.result.outputText;

    await store.updateCouncilRun({
      runId: run.id,
      status: 'completed',
      consensus_status: consensusStatus,
      summary: summaryWithRounds,
      participants,
      attempts: allAttempts,
      provider: routed.result.provider,
      model: routed.result.model,
      used_fallback: routed.usedFallback
    });

    void embedAndStore(store, null, {
      userId: input.userId,
      content: `Council Q: ${input.question}\nSynthesis: ${summaryWithRounds}`,
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
          rounds_executed: roundSummaries.length
        }
      });
    }
  } catch (error) {
    const reason = maskErrorForApi(error);
    const attempts = extractProviderAttempts(error);

    await store.updateCouncilRun({
      runId: run.id,
      status: 'failed',
      consensus_status: 'escalated_to_human',
      summary: `PROVIDER_ROUTING_FAILED: ${reason}`,
      participants: [
        {
          role: 'synthesizer',
          provider: null,
          status: 'failed',
          summary: 'Council synthesis failed.',
          error: reason
        }
      ],
      attempts,
      provider: null,
      model: 'failed',
      used_fallback: true
    });

    if (taskId) {
      await store.setTaskStatus({
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
  }
}

export async function startCouncilRun(ctx: RouteContext, input: StartCouncilRunInput): Promise<StartCouncilRunResult> {
  const { store } = ctx;
  const existing = await store.getCouncilRunByIdempotency({
    userId: input.userId,
    idempotencyKey: input.idempotencyKey
  });
  if (existing) {
    return {
      run: existing,
      idempotentReplay: true
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
    task_id: null
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

  void executeCouncilRun(ctx, input, run, taskId);

  const latest = await store.getCouncilRunById(run.id);
  return {
    run: latest ?? run,
    idempotentReplay: false
  };
}
