import type { FastifyInstance } from 'fastify';

import { sendError, sendSuccess } from '../../lib/http';
import { AssistantContextEventCreateSchema, AssistantContextEventListQuerySchema, AssistantContextEventStreamQuerySchema } from './schemas';
import type { RouteContext } from '../types';
import { applySseCorsHeaders, createSpanId } from '../types';

export function registerAssistantContextEventRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { store, resolveRequestUserId, resolveRequestTraceId } = ctx;

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
