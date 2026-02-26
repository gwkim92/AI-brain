import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { extractProviderAttempts, maskErrorForApi } from '../providers/router';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';
import { applySseCorsHeaders, createSpanId, truncateText } from './types';

const ExecutionRunCreateSchema = z.object({
  mode: z.enum(['code', 'compute']),
  prompt: z.string().min(1).max(8000),
  system_prompt: z.string().optional(),
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).default('auto'),
  exclude_providers: z.array(z.enum(['openai', 'gemini', 'anthropic', 'local'])).max(4).optional(),
  strict_provider: z.boolean().default(false),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().max(32000).optional(),
  create_task: z.boolean().default(true),
  task_title: z.string().min(1).max(200).optional()
});

const RunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export async function executionRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, providerRouter, resolveRequestUserId, resolveRequestTraceId, resolveRequiredIdempotencyKey } = ctx;

  app.post('/api/v1/executions/runs', async (request, reply) => {
    const parsed = ExecutionRunCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid execution run payload', parsed.error.flatten());
    }

    const userId = resolveRequestUserId(request);
    const traceId = resolveRequestTraceId(request);
    const idempotencyKey = resolveRequiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'idempotency-key header is required (8-200 chars)');
    }

    try {
      const existing = await store.getExecutionRunByIdempotency({
        userId,
        idempotencyKey
      });
      if (existing) {
        return sendSuccess(reply, request, 200, existing, { idempotent_replay: true });
      }

      const run = await store.createExecutionRun({
        user_id: userId,
        idempotency_key: idempotencyKey,
        trace_id: traceId,
        mode: parsed.data.mode,
        prompt: parsed.data.prompt,
        status: 'running',
        output: 'Execution run started.',
        attempts: [],
        provider: null,
        model: 'pending',
        used_fallback: false,
        task_id: null,
        duration_ms: 0
      });

      let taskId: string | null = null;
      if (parsed.data.create_task) {
        const task = await store.createTask({
          userId,
          mode: parsed.data.mode,
          title: parsed.data.task_title ?? truncateText(parsed.data.prompt, 180),
          input: {
            prompt: parsed.data.prompt,
            source: 'execution_run_api',
            mode: parsed.data.mode,
            run_id: run.id
          },
          idempotencyKey: `${idempotencyKey}:execution-task`,
          traceId
        });
        taskId = task.id;

        await store.updateExecutionRun({
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
            source: 'execution_run',
            run_id: run.id,
            stage: 'running',
            mode: run.mode
          }
        });
      }

      void (async () => {
        const startedAt = Date.now();
        try {
          const routed = await providerRouter.generate({
            prompt: parsed.data.prompt,
            systemPrompt: parsed.data.system_prompt,
            provider: parsed.data.provider,
            excludeProviders: parsed.data.exclude_providers,
            strictProvider: parsed.data.strict_provider,
            taskType: parsed.data.mode,
            model: parsed.data.model,
            temperature: parsed.data.temperature,
            maxOutputTokens: parsed.data.max_output_tokens
          });

          await store.updateExecutionRun({
            runId: run.id,
            status: 'completed',
            output: routed.result.outputText,
            attempts: routed.attempts,
            provider: routed.result.provider,
            model: routed.result.model,
            used_fallback: routed.usedFallback,
            duration_ms: Date.now() - startedAt
          });

          if (taskId) {
            await store.setTaskStatus({
              taskId,
              status: 'done',
              eventType: 'task.done',
              traceId,
              spanId: createSpanId(),
              data: {
                source: 'execution_run',
                run_id: run.id,
                mode: parsed.data.mode
              }
            });
          }
        } catch (error) {
          const reason = maskErrorForApi(error);
          const attempts = extractProviderAttempts(error);
          await store.updateExecutionRun({
            runId: run.id,
            status: 'failed',
            output: `PROVIDER_ROUTING_FAILED: ${reason}`,
            attempts,
            provider: null,
            model: 'failed',
            used_fallback: true,
            duration_ms: Date.now() - startedAt
          });

          if (taskId) {
            await store.setTaskStatus({
              taskId,
              status: 'failed',
              eventType: 'task.failed',
              traceId,
              spanId: createSpanId(),
              data: {
                source: 'execution_run',
                run_id: run.id,
                error_code: 'PROVIDER_ROUTING_FAILED',
                error: reason
              }
            });
          }
        }
      })();

      const latest = await store.getExecutionRunById(run.id);
      return sendSuccess(reply, request, 202, latest ?? run, { accepted: true });
    } catch (error) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'execution run failed', {
        reason: maskErrorForApi(error)
      });
    }
  });

  app.get('/api/v1/executions/runs', async (request, reply) => {
    const parsed = RunListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const runs = await store.listExecutionRuns(parsed.data.limit);

    return sendSuccess(reply, request, 200, {
      runs
    });
  });

  app.get('/api/v1/executions/runs/:runId', async (request, reply) => {
    const runId = (request.params as { runId: string }).runId;
    const run = await store.getExecutionRunById(runId);

    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'execution run not found');
    }

    return sendSuccess(reply, request, 200, run);
  });

  app.get('/api/v1/executions/runs/:runId/events', async (request, reply) => {
    const runId = (request.params as { runId: string }).runId;
    const run = await store.getExecutionRunById(runId);

    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'execution run not found');
    }

    applySseCorsHeaders(request, reply, ctx.env);

    reply.raw.write('event: stream.open\n');
    reply.raw.write(`data: ${JSON.stringify({ request_id: request.id, run_id: runId })}\n\n`);
    let closed = false;
    let lastStatus: string | null = null;

    const closeStream = () => {
      if (closed) {
        return;
      }
      closed = true;
      reply.raw.write('event: stream.close\n');
      reply.raw.write(`data: ${JSON.stringify({ run_id: runId })}\n\n`);
      reply.raw.end();
    };

    const emitRun = (eventName: string, row: NonNullable<Awaited<ReturnType<typeof store.getExecutionRunById>>>) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(
        `data: ${JSON.stringify({
          run_id: runId,
          timestamp: new Date().toISOString(),
          data: row
        })}\n\n`
      );
    };

    const poll = async () => {
      if (closed) {
        return;
      }

      const current = await store.getExecutionRunById(runId);
      if (!current) {
        closeStream();
        return;
      }

      if (current.status !== lastStatus) {
        const eventName =
          current.status === 'completed'
            ? 'execution.run.completed'
            : current.status === 'failed'
              ? 'execution.run.failed'
              : 'execution.run.updated';
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
