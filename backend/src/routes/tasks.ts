import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import type { TaskMode } from '../store/types';
import { applySseCorsHeaders, type RouteContext } from './types';

const TaskCreateSchema = z.object({
  mode: z
    .enum(['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'])
    .default('execute'),
  title: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()).default({})
});

const TaskListQuerySchema = z.object({
  status: z.enum(['queued', 'running', 'blocked', 'retrying', 'done', 'failed', 'cancelled']).optional(),
  scope: z.enum(['mine', 'all']).default('mine'),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export async function taskRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, resolveTaskCreateContext, resolveRequiredIdempotencyKey, resolveRequestRole, resolveRequestUserId } = ctx;

  app.post('/api/v1/tasks', async (request, reply) => {
    const parsed = TaskCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid task payload', parsed.error.flatten());
    }

    const requestedIdempotencyKey = resolveRequiredIdempotencyKey(request);
    const context = resolveTaskCreateContext(request);
    if (requestedIdempotencyKey) {
      const existing = (await store.listTasks({ userId: context.userId, status: undefined, limit: 200 })).find(
        (row) => row.idempotencyKey === requestedIdempotencyKey
      );
      if (existing) {
        return sendSuccess(reply, request, 200, existing, { idempotent_replay: true });
      }
    }
    try {
      const task = await store.createTask({
        userId: context.userId,
        mode: parsed.data.mode as TaskMode,
        title: parsed.data.title,
        input: parsed.data.input,
        idempotencyKey: context.idempotencyKey,
        traceId: context.traceId
      });

      return sendSuccess(reply, request, 201, task);
    } catch (error) {
      const conflictCode = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      if (conflictCode === '23505') {
        const existing = (await store.listTasks({ userId: context.userId, status: undefined, limit: 200 })).find(
          (row) => row.idempotencyKey === context.idempotencyKey
        );
        if (existing) {
          return sendSuccess(reply, request, 200, existing, { idempotent_replay: true });
        }
      }
      request.log.error({ err: error }, 'task create failed');
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'task create failed');
    }
  });

  app.get('/api/v1/tasks', async (request, reply) => {
    const parsed = TaskListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const scope = parsed.data.scope;
    const role = resolveRequestRole(request);
    if (scope === 'all' && role !== 'admin') {
      return sendError(reply, request, 403, 'FORBIDDEN', 'scope=all requires admin role');
    }

    const scopedUserId = scope === 'all' ? undefined : resolveRequestUserId(request);
    const tasks = await store.listTasks({
      userId: scopedUserId,
      status: parsed.data.status,
      limit: parsed.data.limit
    });
    return sendSuccess(reply, request, 200, tasks);
  });

  app.get('/api/v1/tasks/:taskId', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const task = await store.getTaskById(taskId);
    if (!task) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'task not found');
    }
    const role = resolveRequestRole(request);
    if (role !== 'admin' && task.userId !== resolveRequestUserId(request)) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'task not found');
    }
    return sendSuccess(reply, request, 200, task);
  });

  app.get('/api/v1/tasks/:taskId/events', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const task = await store.getTaskById(taskId);
    if (!task) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'task not found');
    }
    const role = resolveRequestRole(request);
    if (role !== 'admin' && task.userId !== resolveRequestUserId(request)) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'task not found');
    }

    const events = await store.listTaskEvents(taskId, 200);

    applySseCorsHeaders(request, reply, ctx.env);

    reply.raw.write(`event: stream.open\n`);
    reply.raw.write(`data: ${JSON.stringify({ request_id: request.id, task_id: taskId })}\n\n`);

    for (const event of events) {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify({
        event_id: event.id,
        task_id: event.taskId,
        timestamp: event.timestamp,
        data: event.data,
        trace_id: event.traceId,
        span_id: event.spanId
      })}\n\n`);
    }

    reply.raw.write('event: stream.close\n');
    reply.raw.write(`data: ${JSON.stringify({ task_id: taskId })}\n\n`);
    reply.raw.end();
  });
}
