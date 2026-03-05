import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { embedAndStore } from '../memory/embed';
import { withAiInvocationTrace } from '../observability/ai-trace';
import { resolveModelSelection } from '../providers/model-selection';
import { extractProviderAttempts, maskErrorForApi } from '../providers/router';
import type { CouncilRunRecord } from '../store/types';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';
import {
  applySseCorsHeaders,
  COUNCIL_ROLES,
  createSpanId,
  parseRoundLogCount,
  parseRoundProgress,
  truncateText
} from './types';

const CouncilRunCreateSchema = z.object({
  question: z.string().min(1).max(4000),
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

function resolveSelectedCredentialForRun(run: CouncilRunRecord): SelectedCredentialView {
  if (!run.provider) {
    return null;
  }
  const match = [...run.attempts].reverse().find((attempt) => attempt.provider === run.provider && attempt.status === 'success');
  const credential = match?.credential;
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

function withRunCredential(run: CouncilRunRecord): CouncilRunRecord & { selected_credential: SelectedCredentialView } {
  return {
    ...run,
    selected_credential: resolveSelectedCredentialForRun(run)
  };
}

export async function councilRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const {
    store,
    providerRouter,
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
    const traceId = resolveRequestTraceId(request);
    const resolvedCredentials = await resolveRequestProviderCredentials(request);
    const credentialsByProvider = resolvedCredentials.credentialsByProvider;
    const modelSelection = await resolveModelSelection({
      store,
      userId,
      featureKey: 'council_run',
      override: {
        provider: parsed.data.provider,
        strictProvider: parsed.data.strict_provider,
        model: parsed.data.model
      }
    });
    const idempotencyKey = resolveRequiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'idempotency-key header is required (8-200 chars)');
    }

    try {
      const existing = await store.getCouncilRunByIdempotency({
        userId,
        idempotencyKey
      });
      if (existing) {
        return sendSuccess(reply, request, 200, withRunCredential(existing), { idempotent_replay: true });
      }

      const run = await store.createCouncilRun({
        user_id: userId,
        idempotency_key: idempotencyKey,
        trace_id: traceId,
        question: parsed.data.question,
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
      if (parsed.data.create_task) {
        const task = await store.createTask({
          userId,
          mode: 'council',
          title: parsed.data.task_title ?? truncateText(parsed.data.question, 180),
          input: {
            question: parsed.data.question,
            source: 'council_run_api',
            run_id: run.id
          },
          idempotencyKey: `${idempotencyKey}:council-task`,
          traceId
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
          traceId,
          spanId: createSpanId(),
          data: {
            source: 'council_run',
            run_id: run.id,
            stage: 'running'
          }
        });
      }

      void (async () => {
        try {
          const maxRounds = parsed.data.max_rounds;
          const consensusThreshold = maxRounds > 1 ? 2 : 1;
          const roundSummaries: string[] = [];
          const allAttempts: CouncilRunRecord['attempts'] = [];
          let routed: Awaited<ReturnType<typeof providerRouter.generate>> | null = null;

          for (let round = 1; round <= maxRounds; round += 1) {
            const roundPrompt =
              roundSummaries.length === 0
                ? parsed.data.question
                : `${parsed.data.question}\n\nPrevious rounds:\n${roundSummaries
                    .map((entry, index) => `- R${index + 1}: ${entry}`)
                    .join('\n')}\n\nRefine decision, resolve contradictions, and produce updated synthesis for this round.`;
            const roundSystemPrompt = parsed.data.system_prompt
              ? `${parsed.data.system_prompt}\n\nCouncil round ${round}/${maxRounds}.`
              : `Council round ${round}/${maxRounds}.`;

            routed = await withAiInvocationTrace({
              store,
              env: ctx.env,
              userId,
              featureKey: 'council_run',
              taskType: 'council',
              requestProvider: modelSelection.provider,
              requestModel: modelSelection.model,
              traceId,
              contextRefs: {
                route: '/api/v1/councils/runs',
                run_id: run.id,
                round,
                model_selection_source: modelSelection.source
              },
              run: () =>
                providerRouter.generate({
                  prompt: roundPrompt,
                  systemPrompt: roundSystemPrompt,
                  provider: modelSelection.provider,
                  credentialsByProvider,
                  traceId,
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
                  },
                  excludeProviders: parsed.data.exclude_providers,
                  strictProvider: modelSelection.strictProvider,
                  taskType: 'council',
                  model: modelSelection.model ?? undefined,
                  temperature: parsed.data.temperature,
                  maxOutputTokens: parsed.data.max_output_tokens
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

          const failedCount = allAttempts.filter((item) => item.status === 'failed').length;
          const consensusStatus: CouncilRunRecord['consensus_status'] =
            failedCount === 0 && !routed.usedFallback && roundSummaries.length >= consensusThreshold
              ? 'consensus_reached'
              : failedCount > 0
                ? 'contradiction_detected'
                : 'escalated_to_human';

          const summaryWithRounds =
            roundSummaries.length > 1
              ? `${routed.result.outputText}\n\nRound log:\n${roundSummaries
                  .map((entry, index) => `${index + 1}. ${entry}`)
                  .join('\n')}`
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
            userId,
            content: `Council Q: ${parsed.data.question}\nSynthesis: ${summaryWithRounds}`,
            segmentType: 'council_synthesis',
            taskId: taskId ?? undefined,
            confidence: consensusStatus === 'consensus_reached' ? 0.9 : 0.5,
          }).catch(() => undefined);

          if (taskId) {
            await store.setTaskStatus({
              taskId,
              status: 'done',
              eventType: 'task.done',
              traceId,
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
              traceId,
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
      })();

      const latest = await store.getCouncilRunById(run.id);
      return sendSuccess(reply, request, 202, withRunCredential(latest ?? run), { accepted: true });
    } catch (error) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'council run failed', {
        reason: maskErrorForApi(error)
      });
    }
  });

  app.get('/api/v1/councils/runs', async (request, reply) => {
    const parsed = RunListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const runs = await store.listCouncilRuns(parsed.data.limit);

    return sendSuccess(reply, request, 200, {
      runs: runs.map((run) => withRunCredential(run))
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
          round,
          max_rounds: maxRounds,
          agent_index: lastAttemptCount + index + 1,
          attempt
        });
      });
      lastAttemptCount = row.attempts.length;
    };

    const emitFallbackRoundProgress = (row: NonNullable<Awaited<ReturnType<typeof store.getCouncilRunById>>>) => {
      if (row.attempts.length <= lastAttemptCount) {
        return;
      }

      const maxRounds = parseRoundLogCount(row.summary) ?? 1;
      const round = Math.max(1, maxRounds);
      emitRoundStarted(row, round, maxRounds);
      emitAgentResponses(row, round, maxRounds);
      emitRoundCompleted(row, round, maxRounds);
      lastRoundSummary = row.summary;
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

      if (current.status === 'running' && roundProgress && (summaryChanged || current.attempts.length > lastAttemptCount)) {
        emitRoundStarted(current, roundProgress.round, roundProgress.maxRounds);
        emitAgentResponses(current, roundProgress.round, roundProgress.maxRounds);
        emitRoundCompleted(current, roundProgress.round, roundProgress.maxRounds);
        lastRoundSummary = current.summary;
      } else if (
        (current.status === 'completed' || current.status === 'failed') &&
        (current.attempts.length > lastAttemptCount || summaryChanged)
      ) {
        emitFallbackRoundProgress(current);
      }

      if (current.status !== lastStatus) {
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
