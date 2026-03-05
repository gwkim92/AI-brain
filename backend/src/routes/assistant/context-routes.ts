import type { FastifyInstance } from 'fastify';

import { sendError, sendSuccess } from '../../lib/http';
import { resolveTaskIdForContext } from './helpers';
import {
  AssistantContextCreateSchema,
  AssistantContextGroundingEvidenceQuerySchema,
  AssistantContextListQuerySchema,
  AssistantContextUpdateSchema
} from './schemas';
import type { RouteContext } from '../types';
import { createSpanId } from '../types';

const RUNNING_CONTEXT_STALE_TIMEOUT_MS = 3 * 60 * 1000;
const STALE_CONTEXT_REASON_CODE = 'SERVER_RUN_STATE_LOST';
const STALE_CONTEXT_OUTPUT = 'Server state was lost for this run. Re-run this session.';

export function registerAssistantContextCrudRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { store, resolveRequestUserId, resolveRequestTraceId } = ctx;

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

    const resolvedTaskId = parsed.data.task_id ?? (await resolveTaskIdForContext(store, userId, parsed.data.client_context_id));

    const context = await store.upsertAssistantContext({
      userId,
      clientContextId: parsed.data.client_context_id,
      source: parsed.data.source,
      intent: parsed.data.intent,
      prompt: parsed.data.prompt,
      widgetPlan: parsed.data.widget_plan,
      taskId: resolvedTaskId,
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

    const nowMs = Date.now();
    const normalizedContexts: typeof contexts = [];
    for (const context of contexts) {
      if (context.status !== 'running') {
        normalizedContexts.push(context);
        continue;
      }

      const updatedAtMs = Date.parse(context.updatedAt);
      if (Number.isNaN(updatedAtMs) || nowMs - updatedAtMs < RUNNING_CONTEXT_STALE_TIMEOUT_MS) {
        normalizedContexts.push(context);
        continue;
      }

      const failed = await store.updateAssistantContext({
        userId,
        contextId: context.id,
        status: 'failed',
        output: STALE_CONTEXT_OUTPUT,
        error: STALE_CONTEXT_REASON_CODE
      });
      if (!failed) {
        normalizedContexts.push(context);
        continue;
      }

      await store.appendAssistantContextEvent({
        userId,
        contextId: failed.id,
        eventType: 'assistant.context.run.failed',
        data: {
          reason: STALE_CONTEXT_REASON_CODE,
          source: 'stale_timeout_reaper',
          transition_from: 'running',
          transition_to: 'failed',
          transition_valid: true
        },
        traceId: resolveRequestTraceId(request),
        spanId: createSpanId()
      });

      if (failed.taskId) {
        await store.setTaskStatus({
          taskId: failed.taskId,
          status: 'failed',
          eventType: 'task.failed',
          traceId: resolveRequestTraceId(request),
          spanId: createSpanId(),
          data: {
            source: 'assistant_context_stale_timeout',
            context_id: failed.id,
            error_code: STALE_CONTEXT_REASON_CODE,
            error: STALE_CONTEXT_OUTPUT
          }
        });
      }

      normalizedContexts.push(failed);
    }

    return sendSuccess(reply, request, 200, {
      contexts: normalizedContexts
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

  app.get('/api/v1/assistant/contexts/:contextId/grounding-evidence', async (request, reply) => {
    const parsed = AssistantContextGroundingEvidenceQuerySchema.safeParse(request.query);
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

    const sources = await store.listAssistantContextGroundingSources({
      userId,
      contextId,
      limit: parsed.data.limit
    });
    const claims = await store.listAssistantContextGroundingClaims({
      userId,
      contextId,
      limit: parsed.data.limit
    });

    return sendSuccess(reply, request, 200, {
      context_id: contextId,
      status: context.status,
      sources,
      claims,
      summary: {
        source_count: sources.length,
        claim_count: claims.length,
        unique_domains: Array.from(new Set(sources.map((item) => item.domain))),
        updated_at: context.updatedAt
      }
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
}
