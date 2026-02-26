import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { runContextPipeline } from '../context/pipeline';
import { evaluateEvalGate } from '../evals/gate';
import { sendError, sendSuccess } from '../lib/http';
import { embedAndStore } from '../memory/embed';
import { extractProviderAttempts, maskErrorForApi } from '../providers/router';
import type { RouteContext } from './types';
import { applySseCorsHeaders, createSpanId, resolveAssistantContextTaskType } from './types';

// --- Schemas ---

const AssistantContextStatusSchema = z.enum(['running', 'completed', 'failed']);

const AssistantContextCreateSchema = z.object({
  client_context_id: z.string().min(1).max(120),
  source: z.string().min(1).max(120).default('inbox_quick_command'),
  intent: z.string().min(1).max(60).default('general'),
  prompt: z.string().min(1).max(8000),
  widget_plan: z.array(z.string().min(1).max(80)).max(20).default([]),
  task_id: z.string().uuid().optional()
});

const AssistantContextUpdateSchema = z.object({
  status: AssistantContextStatusSchema.optional(),
  task_id: z.string().uuid().nullable().optional(),
  served_provider: z.enum(['openai', 'gemini', 'anthropic', 'local']).nullable().optional(),
  served_model: z.string().max(160).nullable().optional(),
  used_fallback: z.boolean().optional(),
  selection_reason: z.string().max(2000).nullable().optional(),
  output: z.string().max(20000).optional(),
  error: z.string().max(4000).nullable().optional()
});

const AssistantContextListQuerySchema = z.object({
  status: AssistantContextStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80)
});

const AssistantContextEventCreateSchema = z.object({
  event_type: z.string().min(1).max(120),
  data: z.record(z.string(), z.unknown()).default({})
});

const AssistantContextEventListQuerySchema = z.object({
  since_sequence: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const AssistantContextEventStreamQuerySchema = z.object({
  since_sequence: z.coerce.number().int().positive().optional(),
  poll_ms: z.coerce.number().int().min(150).max(2000).default(300),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).default(30000)
});

const AssistantContextRunSchema = z.object({
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).default('auto'),
  strict_provider: z.boolean().default(false),
  task_type: z
    .enum(['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'])
    .optional(),
  model: z.string().max(160).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().max(32000).optional(),
  force_rerun: z.boolean().default(false)
});

// --- Routes ---

export async function assistantRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const {
    store,
    providerRouter,
    notificationService,
    resolveRequestUserId,
    resolveRequestTraceId,
    assistantContextRunsInFlight
  } = ctx;

  app.post('/api/v1/assistant/contexts', async (request, reply) => {
    const parsed = AssistantContextCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid assistant context payload', parsed.error.flatten());
    }

    const userId = resolveRequestUserId(request);
    const existing = await store.getAssistantContextByClientContextId({
      userId,
      clientContextId: parsed.data.client_context_id
    });

    const context = await store.upsertAssistantContext({
      userId,
      clientContextId: parsed.data.client_context_id,
      source: parsed.data.source,
      intent: parsed.data.intent,
      prompt: parsed.data.prompt,
      widgetPlan: parsed.data.widget_plan,
      taskId: parsed.data.task_id ?? null,
      status: 'running'
    });

    await store.appendAssistantContextEvent({
      userId,
      contextId: context.id,
      eventType: existing ? 'assistant.context.reused' : 'assistant.context.created',
      data: {
        client_context_id: context.clientContextId,
        source: context.source,
        intent: context.intent,
        status: context.status,
        task_id: context.taskId
      },
      traceId: resolveRequestTraceId(request),
      spanId: createSpanId()
    });

    return sendSuccess(reply, request, existing ? 200 : 201, context, {
      idempotent_replay: Boolean(existing)
    });
  });

  app.get('/api/v1/assistant/contexts', async (request, reply) => {
    const parsed = AssistantContextListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const userId = resolveRequestUserId(request);
    const contexts = await store.listAssistantContexts({
      userId,
      status: parsed.data.status,
      limit: parsed.data.limit
    });

    return sendSuccess(reply, request, 200, {
      contexts
    });
  });

  app.get('/api/v1/assistant/contexts/:contextId', async (request, reply) => {
    const contextId = (request.params as { contextId: string }).contextId;
    const userId = resolveRequestUserId(request);
    const context = await store.getAssistantContextById({
      userId,
      contextId
    });

    if (!context) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'assistant context not found');
    }

    return sendSuccess(reply, request, 200, context);
  });

  app.post('/api/v1/assistant/contexts/:contextId/run', async (request, reply) => {
    const parsed = AssistantContextRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid assistant context run payload', parsed.error.flatten());
    }

    const contextId = (request.params as { contextId: string }).contextId;
    const userId = resolveRequestUserId(request);
    const traceId = resolveRequestTraceId(request);
    const context = await store.getAssistantContextById({
      userId,
      contextId
    });

    if (!context) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'assistant context not found');
    }

    if (context.status === 'completed' && !parsed.data.force_rerun) {
      return sendSuccess(reply, request, 200, context, {
        accepted: false,
        reason: 'already_completed'
      });
    }

    if (assistantContextRunsInFlight.has(contextId)) {
      return sendSuccess(reply, request, 202, context, {
        accepted: false,
        reason: 'already_running'
      });
    }

    const taskType = parsed.data.task_type ?? resolveAssistantContextTaskType(context.intent);
    const prepared =
      parsed.data.force_rerun || context.status !== 'running'
        ? await store.updateAssistantContext({
            userId,
            contextId,
            status: 'running',
            servedProvider: null,
            servedModel: null,
            usedFallback: false,
            selectionReason: null,
            output: '',
            error: null
          })
        : context;

    if (!prepared) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'assistant context not found');
    }

    await store.appendAssistantContextEvent({
      userId,
      contextId: prepared.id,
      eventType: 'assistant.context.run.accepted',
      data: {
        task_type: taskType,
        provider: parsed.data.provider,
        strict_provider: parsed.data.strict_provider,
        model: parsed.data.model ?? null,
        force_rerun: parsed.data.force_rerun
      },
      traceId,
      spanId: createSpanId()
    });

    assistantContextRunsInFlight.add(prepared.id);

    void (async () => {
      const spanId = createSpanId();
      try {
        const contextResult = await runContextPipeline(store, {
          userId,
          prompt: prepared.prompt,
          taskType
        });

        await store.appendAssistantContextEvent({
          userId,
          contextId: prepared.id,
          eventType: 'assistant.context.run.started',
          data: {
            task_type: taskType,
            prompt_chars: prepared.prompt.length,
            context_segments_used: contextResult.segmentsUsed,
            context_tokens_used: contextResult.tokensUsed,
            context_mode: contextResult.contextMode
          },
          traceId,
          spanId
        });

        if (prepared.taskId) {
          await store.setTaskStatus({
            taskId: prepared.taskId,
            status: 'running',
            eventType: 'task.updated',
            traceId,
            spanId: createSpanId(),
            data: {
              source: 'assistant_context_run',
              context_id: prepared.id,
              stage: 'running'
            }
          });
        }

        const routed = await providerRouter.generate({
          prompt: contextResult.enrichedPrompt,
          systemPrompt: contextResult.systemPrompt || undefined,
          provider: parsed.data.provider,
          strictProvider: parsed.data.strict_provider,
          taskType,
          model: parsed.data.model,
          temperature: parsed.data.temperature,
          maxOutputTokens: parsed.data.max_output_tokens
        });

        const evalResult = evaluateEvalGate({
          accuracy: routed.result.outputText.length > 10 ? 0.85 : 0.4,
          safety: 0.95,
          costDeltaPct: 0
        });

        if (!evalResult.passed) {
          await store.appendAssistantContextEvent({
            userId,
            contextId: prepared.id,
            eventType: 'assistant.context.eval_gate.warning',
            data: {
              passed: false,
              reasons: evalResult.reasons,
              provider: routed.result.provider,
              model: routed.result.model
            },
            traceId,
            spanId: createSpanId()
          });
          notificationService?.emitEvalGateDegradation(routed.result.provider);
        }

        const completed = await store.updateAssistantContext({
          userId,
          contextId: prepared.id,
          status: 'completed',
          servedProvider: routed.result.provider,
          servedModel: routed.result.model,
          usedFallback: routed.usedFallback,
          selectionReason: routed.selection?.reason ?? null,
          output: routed.result.outputText,
          error: null
        });

        if (completed) {
          await store.appendAssistantContextEvent({
            userId,
            contextId: completed.id,
            eventType: 'assistant.context.run.completed',
            data: {
              task_type: taskType,
              provider: routed.result.provider,
              model: routed.result.model,
              used_fallback: routed.usedFallback,
              selection_reason: routed.selection?.reason ?? null,
              attempts: routed.attempts,
              eval_gate: { passed: evalResult.passed, reasons: evalResult.reasons }
            },
            traceId,
            spanId: createSpanId()
          });

          void embedAndStore(store, null, {
            userId,
            content: `Q: ${prepared.prompt}\nA: ${routed.result.outputText}`,
            segmentType: 'assistant_response',
            taskId: prepared.taskId ?? undefined,
            confidence: evalResult.passed ? 0.8 : 0.4,
          }).catch(() => undefined);
        }

        if (prepared.taskId) {
          await store.setTaskStatus({
            taskId: prepared.taskId,
            status: 'done',
            eventType: 'task.done',
            traceId,
            spanId: createSpanId(),
            data: {
              source: 'assistant_context_run',
              context_id: prepared.id,
              provider: routed.result.provider,
              model: routed.result.model,
              used_fallback: routed.usedFallback
            }
          });
        }
      } catch (error) {
        const reason = maskErrorForApi(error);
        const attempts = extractProviderAttempts(error);
        const failed = await store.updateAssistantContext({
          userId,
          contextId: prepared.id,
          status: 'failed',
          servedProvider: null,
          servedModel: null,
          usedFallback: attempts.length > 0,
          selectionReason: null,
          output: `PROVIDER_ROUTING_FAILED: ${reason}`,
          error: reason
        });

        if (failed) {
          await store.appendAssistantContextEvent({
            userId,
            contextId: failed.id,
            eventType: 'assistant.context.run.failed',
            data: {
              task_type: taskType,
              reason,
              attempts
            },
            traceId,
            spanId: createSpanId()
          });
        }

        if (prepared.taskId) {
          await store.setTaskStatus({
            taskId: prepared.taskId,
            status: 'failed',
            eventType: 'task.failed',
            traceId,
            spanId: createSpanId(),
            data: {
              source: 'assistant_context_run',
              context_id: prepared.id,
              error_code: 'PROVIDER_ROUTING_FAILED',
              error: reason
            }
          });
        }
      } finally {
        assistantContextRunsInFlight.delete(prepared.id);
      }
    })();

    return sendSuccess(reply, request, 202, prepared, {
      accepted: true,
      task_type: taskType
    });
  });

  app.patch('/api/v1/assistant/contexts/:contextId', async (request, reply) => {
    const parsed = AssistantContextUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid assistant context update payload', parsed.error.flatten());
    }

    if (
      typeof parsed.data.status === 'undefined' &&
      typeof parsed.data.task_id === 'undefined' &&
      typeof parsed.data.served_provider === 'undefined' &&
      typeof parsed.data.served_model === 'undefined' &&
      typeof parsed.data.used_fallback === 'undefined' &&
      typeof parsed.data.selection_reason === 'undefined' &&
      typeof parsed.data.output === 'undefined' &&
      typeof parsed.data.error === 'undefined'
    ) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'no update fields provided');
    }

    const contextId = (request.params as { contextId: string }).contextId;
    const userId = resolveRequestUserId(request);
    const updated = await store.updateAssistantContext({
      userId,
      contextId,
      status: parsed.data.status,
      taskId: parsed.data.task_id,
      servedProvider: parsed.data.served_provider,
      servedModel: parsed.data.served_model,
      usedFallback: parsed.data.used_fallback,
      selectionReason: parsed.data.selection_reason,
      output: parsed.data.output,
      error: parsed.data.error
    });

    if (!updated) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'assistant context not found');
    }

    await store.appendAssistantContextEvent({
      userId,
      contextId: updated.id,
      eventType: 'assistant.context.updated',
      data: {
        status: updated.status,
        task_id: updated.taskId,
        served_provider: updated.servedProvider,
        served_model: updated.servedModel,
        used_fallback: updated.usedFallback,
        selection_reason: updated.selectionReason,
        has_output: updated.output.length > 0,
        has_error: Boolean(updated.error),
        revision: updated.revision
      },
      traceId: resolveRequestTraceId(request),
      spanId: createSpanId()
    });

    return sendSuccess(reply, request, 200, updated);
  });

  app.post('/api/v1/assistant/contexts/:contextId/events', async (request, reply) => {
    const parsed = AssistantContextEventCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid assistant context event payload', parsed.error.flatten());
    }

    const contextId = (request.params as { contextId: string }).contextId;
    const userId = resolveRequestUserId(request);
    const event = await store.appendAssistantContextEvent({
      userId,
      contextId,
      eventType: parsed.data.event_type,
      data: parsed.data.data,
      traceId: resolveRequestTraceId(request),
      spanId: createSpanId()
    });

    if (!event) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'assistant context not found');
    }

    return sendSuccess(reply, request, 201, event);
  });

  app.get('/api/v1/assistant/contexts/:contextId/events', async (request, reply) => {
    const parsed = AssistantContextEventListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const contextId = (request.params as { contextId: string }).contextId;
    const userId = resolveRequestUserId(request);
    const context = await store.getAssistantContextById({
      userId,
      contextId
    });
    if (!context) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'assistant context not found');
    }

    const events = await store.listAssistantContextEvents({
      userId,
      contextId,
      sinceSequence: parsed.data.since_sequence,
      limit: parsed.data.limit
    });
    const nextSinceSequence = events.length > 0 ? events[events.length - 1]?.sequence ?? null : parsed.data.since_sequence ?? null;

    return sendSuccess(reply, request, 200, {
      context_id: contextId,
      events,
      next_since_sequence: nextSinceSequence
    });
  });

  app.get('/api/v1/assistant/contexts/:contextId/events/stream', async (request, reply) => {
    const parsed = AssistantContextEventStreamQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const contextId = (request.params as { contextId: string }).contextId;
    const userId = resolveRequestUserId(request);
    const context = await store.getAssistantContextById({
      userId,
      contextId
    });
    if (!context) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'assistant context not found');
    }

    applySseCorsHeaders(request, reply, ctx.env);

    let closed = false;
    let sinceSequence = parsed.data.since_sequence;

    const emitEvent = (eventName: string, payload: Record<string, unknown>) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const closeStream = () => {
      if (closed) {
        return;
      }
      closed = true;
      emitEvent('stream.close', {
        context_id: contextId,
        since_sequence: sinceSequence ?? null
      });
      reply.raw.end();
    };

    emitEvent('stream.open', {
      request_id: request.id,
      context_id: contextId,
      since_sequence: sinceSequence ?? null
    });

    const poll = async () => {
      if (closed) {
        return;
      }

      const current = await store.getAssistantContextById({
        userId,
        contextId
      });
      if (!current) {
        closeStream();
        return;
      }

      const events = await store.listAssistantContextEvents({
        userId,
        contextId,
        sinceSequence,
        limit: 200
      });

      for (const event of events) {
        sinceSequence = event.sequence;
        emitEvent('assistant.context.event', {
          context_id: contextId,
          timestamp: new Date().toISOString(),
          event,
          context: current
        });
      }

      if ((current.status === 'completed' || current.status === 'failed') && events.length === 0) {
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
    }, parsed.data.poll_ms);

    const timeout = setTimeout(() => {
      closeStream();
    }, parsed.data.timeout_ms);

    reply.raw.on('close', () => {
      clearInterval(interval);
      clearTimeout(timeout);
    });
  });
}
