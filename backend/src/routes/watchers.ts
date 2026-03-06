import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { executeWatcherRun } from '../jarvis/watchers';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';

const WatcherCreateSchema = z.object({
  kind: z.enum(['external_topic', 'company', 'market', 'war_region', 'repo', 'task_health', 'mission_health', 'approval_backlog']),
  title: z.string().min(1).max(180),
  query: z.string().min(1).max(4000),
  status: z.enum(['active', 'paused', 'error']).optional(),
  config_json: z.record(z.string(), z.unknown()).optional()
});

const WatcherListSchema = z.object({
  kind: z.enum(['external_topic', 'company', 'market', 'war_region', 'repo', 'task_health', 'mission_health', 'approval_backlog']).optional(),
  status: z.enum(['active', 'paused', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const WatcherUpdateSchema = z.object({
  kind: z.enum(['external_topic', 'company', 'market', 'war_region', 'repo', 'task_health', 'mission_health', 'approval_backlog']).optional(),
  title: z.string().min(1).max(180).optional(),
  query: z.string().min(1).max(4000).optional(),
  status: z.enum(['active', 'paused', 'error']).optional(),
  config_json: z.record(z.string(), z.unknown()).optional()
}).refine((value) => Object.keys(value).length > 0, 'at least one watcher field must be provided');

export async function watcherRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, resolveRequestUserId, notificationService } = ctx;

  app.get('/api/v1/watchers', async (request, reply) => {
    const parsed = WatcherListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid watcher query', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const watchers = await store.listWatchers({
      userId,
      kind: parsed.data.kind,
      status: parsed.data.status,
      limit: parsed.data.limit
    });
    return sendSuccess(reply, request, 200, { watchers });
  });

  app.post('/api/v1/watchers', async (request, reply) => {
    const parsed = WatcherCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid watcher payload', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const watcher = await store.createWatcher({
      userId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      query: parsed.data.query,
      status: parsed.data.status,
      configJson: parsed.data.config_json
    });
    return sendSuccess(reply, request, 201, watcher);
  });

  app.patch('/api/v1/watchers/:watcherId', async (request, reply) => {
    const parsed = WatcherUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid watcher update payload', parsed.error.flatten());
    }
    const { watcherId } = request.params as { watcherId: string };
    const userId = resolveRequestUserId(request);
    const watcher = await store.updateWatcher({
      watcherId,
      userId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      query: parsed.data.query,
      status: parsed.data.status,
      configJson: parsed.data.config_json
    });
    if (!watcher) return sendError(reply, request, 404, 'NOT_FOUND', 'watcher not found');
    return sendSuccess(reply, request, 200, watcher);
  });

  app.delete('/api/v1/watchers/:watcherId', async (request, reply) => {
    const { watcherId } = request.params as { watcherId: string };
    const userId = resolveRequestUserId(request);
    const deleted = await store.deleteWatcher({ watcherId, userId });
    if (!deleted) return sendError(reply, request, 404, 'NOT_FOUND', 'watcher not found');
    return sendSuccess(reply, request, 200, { deleted: true, watcher_id: watcherId });
  });

  app.post('/api/v1/watchers/:watcherId/run', async (request, reply) => {
    const { watcherId } = request.params as { watcherId: string };
    const userId = resolveRequestUserId(request);
    const watcher = await store.getWatcherById({ watcherId, userId });
    if (!watcher) return sendError(reply, request, 404, 'NOT_FOUND', 'watcher not found');

    const run = await store.createWatcherRun({
      watcherId,
      userId,
      status: 'running',
      summary: 'Watcher run started'
    });

    try {
      const result = await executeWatcherRun({
        store,
        watcher,
        run,
        notificationService
      });
      return sendSuccess(reply, request, 200, {
        watcher,
        run: result.run,
        briefing: result.briefing,
        dossier: result.dossier
      });
    } catch (error) {
      const failedRun = await store.listWatcherRuns({
        userId,
        watcherId: watcher.id,
        limit: 1
      }).then((rows) => rows.find((item) => item.id === run.id) ?? null);
      const message = error instanceof Error ? error.message : 'watcher run failed';
      return sendError(
        reply,
        request,
        message.startsWith('quality gate failed:') ? 409 : 500,
        message.startsWith('quality gate failed:') ? 'CONFLICT' : 'INTERNAL_ERROR',
        message,
        failedRun
      );
    }
  });
}
