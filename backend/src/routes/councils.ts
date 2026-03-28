import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { startCouncilRun } from '../council/run-service';
import type { CouncilPhaseStatusRecord, CouncilRunRecord } from '../store/types';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';
import {
  applySseCorsHeaders,
  parseRoundLogCount,
  parseRoundProgress
} from './types';

const CouncilRunCreateSchema = z.object({
  question: z.string().min(1).max(4000),
  client_session_id: z.string().uuid().optional(),
  system_prompt: z.string().optional(),
  max_rounds: z.coerce.number().int().min(1).max(4).default(2),
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).optional(),
  exclude_providers: z.array(z.enum(['openai', 'gemini', 'anthropic', 'local'])).max(4).optional(),
  strict_provider: z.boolean().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().max(32000).optional(),
  create_task: z.boolean().default(false),
  task_title: z.string().min(1).max(200).optional()
});

const RunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

type SelectedCredentialView = {
  source: 'user' | 'workspace' | 'env' | 'none';
  selected_credential_mode: 'api_key' | 'oauth_official' | null;
  credential_priority: 'api_key_first' | 'auth_first';
  auth_access_token_expires_at: string | null;
} | null;

type ResolvedRouteView = {
  provider: 'auto' | 'openai' | 'gemini' | 'anthropic' | 'local';
  model: string | null;
  strict_provider: boolean;
  source: 'request_override' | 'feature_preference' | 'global_default' | 'auto' | 'runtime_result';
  used_fallback: boolean;
};

function resolveSelectedCredentialForRun(run: CouncilRunRecord): SelectedCredentialView {
  const reversedAttempts = [...run.attempts].reverse();
  const matchingAttempts = run.provider
    ? reversedAttempts.filter((attempt) => attempt.provider === run.provider)
    : reversedAttempts;
  const credential =
    matchingAttempts.find((attempt) => attempt.status === 'success')?.credential
    ?? matchingAttempts.find((attempt) => attempt.credential)?.credential
    ?? reversedAttempts.find((attempt) => attempt.credential)?.credential;
  if (!credential) {
    return null;
  }
  return {
    source: credential.source,
    selected_credential_mode: credential.selectedCredentialMode,
    credential_priority: credential.credentialPriority,
    auth_access_token_expires_at: credential.authAccessTokenExpiresAt
  };
}

function resolveRunRoute(run: CouncilRunRecord, route?: Omit<ResolvedRouteView, 'used_fallback'>): ResolvedRouteView {
  if (route) {
    return {
      ...route,
      used_fallback: run.used_fallback
    };
  }

  const reversedAttempts = [...run.attempts].reverse();
  const attemptedProviders = Array.from(new Set(run.attempts.map((attempt) => attempt.provider)));
  const provider: ResolvedRouteView['provider'] = run.provider ?? reversedAttempts[0]?.provider ?? 'auto';
  const hasPinnedProvider = run.provider !== null || reversedAttempts.length > 0;
  return {
    provider,
    model: typeof run.model === 'string' && run.model.trim().length > 0 ? run.model : null,
    strict_provider: hasPinnedProvider ? !run.used_fallback && attemptedProviders.length <= 1 : false,
    source: 'runtime_result',
    used_fallback: run.used_fallback
  };
}

function withRunCredential(
  run: CouncilRunRecord,
  resolvedRoute?: Omit<ResolvedRouteView, 'used_fallback'>
): CouncilRunRecord & { selected_credential: SelectedCredentialView; resolved_route: ResolvedRouteView } {
  return {
    ...run,
    selected_credential: resolveSelectedCredentialForRun(run),
    resolved_route: resolveRunRoute(run, resolvedRoute)
  };
}

function normalizePhaseStatus(status?: CouncilPhaseStatusRecord): CouncilPhaseStatusRecord {
  return status
    ? { exploration: status.exploration, synthesis: status.synthesis }
    : { exploration: 'pending', synthesis: 'pending' };
}

function toCouncilRunListView(run: CouncilRunRecord): CouncilRunRecord {
  return {
    ...run,
    exploration_transcript: undefined
  };
}

export async function councilRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const {
    store,
    resolveRequestUserId,
    resolveRequestTraceId,
    resolveRequiredIdempotencyKey,
    resolveRequestProviderCredentials
  } = ctx;

  app.post('/api/v1/councils/runs', async (request, reply) => {
    const parsed = CouncilRunCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid council run payload', parsed.error.flatten());
    }

    const userId = resolveRequestUserId(request);
    const resolvedCredentials = await resolveRequestProviderCredentials(request);
    const traceId = resolveRequestTraceId(request);
    const idempotencyKey = resolveRequiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'idempotency-key header is required (8-200 chars)');
    }

    try {
      const result = await startCouncilRun(ctx, {
        userId,
        linkedSessionId: parsed.data.client_session_id,
        traceId,
        idempotencyKey,
        question: parsed.data.question,
        systemPrompt: parsed.data.system_prompt,
        maxRounds: parsed.data.max_rounds,
        provider: parsed.data.provider,
        excludeProviders: parsed.data.exclude_providers,
        strictProvider: parsed.data.strict_provider,
        model: parsed.data.model,
        temperature: parsed.data.temperature,
        maxOutputTokens: parsed.data.max_output_tokens,
        createTask: parsed.data.create_task,
        taskTitle: parsed.data.task_title,
        taskSource: 'council_run_api',
        routeLabel: '/api/v1/councils/runs',
        credentialsByProvider: resolvedCredentials.credentialsByProvider,
        onSpanEvent: (event) => {
          request.log.info(
            {
              trace_id: event.traceId,
              provider: event.provider,
              success: event.success,
              latency_ms: event.latencyMs,
              error: event.error
            },
            event.name
          );
        }
      });

      const linkedSession = parsed.data.client_session_id
        ? await store.getJarvisSessionById({ userId, sessionId: parsed.data.client_session_id })
        : null;

      return sendSuccess(
        reply,
        request,
        result.idempotentReplay ? 200 : 202,
        {
          ...withRunCredential(result.run, {
            provider: result.resolvedModelSelection.provider,
            model: result.resolvedModelSelection.model,
            strict_provider: result.resolvedModelSelection.strictProvider,
            source: result.resolvedModelSelection.source
          }),
          session: linkedSession
        },
        {
        accepted: result.idempotentReplay !== true,
        idempotent_replay: result.idempotentReplay
        }
      );
    } catch {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'council run failed');
    }
  });

  app.get('/api/v1/councils/runs', async (request, reply) => {
    const parsed = RunListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const runs = await store.listCouncilRuns(parsed.data.limit);

    return sendSuccess(reply, request, 200, {
      runs: runs.map((run) => withRunCredential(toCouncilRunListView(run)))
    });
  });

  app.get('/api/v1/councils/runs/:runId', async (request, reply) => {
    const runId = (request.params as { runId: string }).runId;
    const run = await store.getCouncilRunById(runId);

    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'council run not found');
    }

    return sendSuccess(reply, request, 200, withRunCredential(run));
  });

  app.get('/api/v1/councils/runs/:runId/events', async (request, reply) => {
    const runId = (request.params as { runId: string }).runId;
    const run = await store.getCouncilRunById(runId);

    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'council run not found');
    }

    applySseCorsHeaders(request, reply, ctx.env);

    reply.raw.write('event: stream.open\n');
    reply.raw.write(`data: ${JSON.stringify({ request_id: request.id, run_id: runId })}\n\n`);
    let closed = false;
    let lastStatus: string | null = null;
    let lastAttemptCount = 0;
    let lastRoundSummary: string | null = null;
    let lastPhaseStatus: CouncilPhaseStatusRecord = { exploration: 'pending', synthesis: 'pending' };
    const startedRounds = new Set<number>();
    const completedRounds = new Set<number>();

    const closeStream = () => {
      if (closed) {
        return;
      }
      closed = true;
      reply.raw.write('event: stream.close\n');
      reply.raw.write(`data: ${JSON.stringify({ run_id: runId })}\n\n`);
      reply.raw.end();
    };

    const emitEvent = (eventName: string, payload: Record<string, unknown>) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const emitRun = (eventName: string, row: NonNullable<Awaited<ReturnType<typeof store.getCouncilRunById>>>) => {
      emitEvent(eventName, {
        run_id: runId,
        timestamp: new Date().toISOString(),
        data: withRunCredential(row)
      });
    };

    const emitPhaseEvent = (
      eventName: 'council.phase.started' | 'council.phase.completed' | 'council.phase.failed',
      row: NonNullable<Awaited<ReturnType<typeof store.getCouncilRunById>>>,
      phase: 'exploration' | 'synthesis',
      phaseStatus: CouncilPhaseStatusRecord['exploration']
    ) => {
      emitEvent(eventName, {
        run_id: runId,
        timestamp: new Date().toISOString(),
        phase,
        phase_status: phaseStatus,
        provider: row.provider,
        model: row.model,
        selected_credential: resolveSelectedCredentialForRun(row),
        attempt_count: row.attempts.length
      });
    };

    const emitRoundStarted = (
      row: NonNullable<Awaited<ReturnType<typeof store.getCouncilRunById>>>,
      round: number,
      maxRounds: number
    ) => {
      if (startedRounds.has(round)) {
        return;
      }

      startedRounds.add(round);
      emitEvent('council.round.started', {
        run_id: runId,
        timestamp: new Date().toISOString(),
        phase: 'exploration',
        round,
        max_rounds: maxRounds,
        provider: row.provider,
        model: row.model,
        selected_credential: resolveSelectedCredentialForRun(row),
        attempt_count: row.attempts.length
      });
    };

    const emitRoundCompleted = (
      row: NonNullable<Awaited<ReturnType<typeof store.getCouncilRunById>>>,
      round: number,
      maxRounds: number
    ) => {
      if (completedRounds.has(round)) {
        return;
      }

      completedRounds.add(round);
      emitEvent('council.round.completed', {
        run_id: runId,
        timestamp: new Date().toISOString(),
        phase: 'exploration',
        round,
        max_rounds: maxRounds,
        summary: row.summary,
        provider: row.provider,
        model: row.model,
        selected_credential: resolveSelectedCredentialForRun(row),
        used_fallback: row.used_fallback,
        attempt_count: row.attempts.length
      });
    };

    const emitAgentResponses = (
      row: NonNullable<Awaited<ReturnType<typeof store.getCouncilRunById>>>,
      round: number,
      maxRounds: number
    ) => {
      const attempts = row.attempts.slice(lastAttemptCount);
      attempts.forEach((attempt, index) => {
        emitEvent('council.agent.responded', {
          run_id: runId,
          timestamp: new Date().toISOString(),
          phase: 'exploration',
          round,
          max_rounds: maxRounds,
          agent_index: lastAttemptCount + index + 1,
          attempt
        });
      });
      lastAttemptCount = row.attempts.length;
    };

    const emitFallbackRoundProgress = (row: NonNullable<Awaited<ReturnType<typeof store.getCouncilRunById>>>) => {
      if (row.attempts.length <= lastAttemptCount && !row.exploration_transcript?.length) {
        return;
      }

      const transcriptRounds = row.exploration_transcript?.map((entry) => entry.round) ?? [];
      const maxRounds = transcriptRounds.length > 0 ? Math.max(...transcriptRounds) : parseRoundLogCount(row.summary) ?? 1;
      const round = Math.max(1, maxRounds);
      emitRoundStarted(row, round, maxRounds);
      emitAgentResponses(row, round, maxRounds);
      emitRoundCompleted(row, round, maxRounds);
      lastRoundSummary = row.summary;
    };

    const emitPhaseChanges = (row: NonNullable<Awaited<ReturnType<typeof store.getCouncilRunById>>>) => {
      const currentPhaseStatus = normalizePhaseStatus(row.phase_status);
      (['exploration', 'synthesis'] as const).forEach((phase) => {
        const previous = lastPhaseStatus[phase];
        const next = currentPhaseStatus[phase];
        if (previous === next) {
          return;
        }

        // Late subscribers may attach after the phase already finished. Reconstruct
        // the missing "started" transition before emitting the terminal state.
        if (previous === 'pending' && (next === 'completed' || next === 'failed')) {
          emitPhaseEvent('council.phase.started', row, phase, 'running');
        }

        if (next === 'running') {
          emitPhaseEvent('council.phase.started', row, phase, next);
        } else if (next === 'completed') {
          emitPhaseEvent('council.phase.completed', row, phase, next);
        } else if (next === 'failed') {
          emitPhaseEvent('council.phase.failed', row, phase, next);
        }
      });
      lastPhaseStatus = currentPhaseStatus;
    };

    const poll = async () => {
      if (closed) {
        return;
      }

      const current = await store.getCouncilRunById(runId);
      if (!current) {
        closeStream();
        return;
      }

      const roundProgress = parseRoundProgress(current.summary);
      const summaryChanged = lastRoundSummary !== current.summary;
      const currentPhaseStatus = normalizePhaseStatus(current.phase_status);
      const phaseChanged =
        currentPhaseStatus.exploration !== lastPhaseStatus.exploration
        || currentPhaseStatus.synthesis !== lastPhaseStatus.synthesis;

      emitPhaseChanges(current);

      if (current.status === 'running' && roundProgress && (summaryChanged || current.attempts.length > lastAttemptCount)) {
        emitRoundStarted(current, roundProgress.round, roundProgress.maxRounds);
        emitAgentResponses(current, roundProgress.round, roundProgress.maxRounds);
        if (roundProgress.state === 'complete') {
          emitRoundCompleted(current, roundProgress.round, roundProgress.maxRounds);
        }
        lastRoundSummary = current.summary;
      } else if (
        (current.status === 'completed' || current.status === 'failed') &&
        (current.attempts.length > lastAttemptCount || summaryChanged)
      ) {
        emitFallbackRoundProgress(current);
      }

      if (
        current.status !== lastStatus
        || (current.status === 'running' && (summaryChanged || phaseChanged || current.attempts.length > lastAttemptCount))
      ) {
        const eventName =
          current.status === 'completed'
            ? 'council.run.completed'
            : current.status === 'failed'
              ? 'council.run.failed'
              : 'council.run.updated';
        emitRun(eventName, current);
        lastStatus = current.status;
      }

      if (current.status === 'completed' || current.status === 'failed') {
        closeStream();
      }
    };

    reply.raw.on('close', () => {
      closed = true;
    });

    await poll();
    if (closed) {
      return;
    }

    const interval = setInterval(() => {
      void poll();
    }, 300);

    const timeout = setTimeout(() => {
      closeStream();
    }, 30000);

    reply.raw.on('close', () => {
      clearInterval(interval);
      clearTimeout(timeout);
    });
  });
}
