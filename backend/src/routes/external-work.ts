import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  refreshLinearExternalWork,
  syncExternalWorkCommentByItem
} from '../external-work/service';
import { sendError, sendSuccess } from '../lib/http';
import type {
  ExternalRouteAction,
  ExternalWorkItemRecord,
  ExternalWorkLinkRecord,
  JarvisSessionRecord,
  MissionDomain,
  MissionStepRecord,
  TaskRecord
} from '../store/types';
import type { RouteContext } from './types';

const ExternalWorkListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  refresh: z.coerce.number().int().min(0).max(1).default(0)
});

const ExternalWorkParamsSchema = z.object({
  itemId: z.string().uuid()
});

const ExternalWorkRouteSchema = z.object({
  action: z.enum([
    'task_code',
    'mission_code',
    'session_research',
    'mission_research',
    'session_council',
    'ignore'
  ] satisfies ExternalRouteAction[])
});

function summarizeStatuses(items: ExternalWorkItemRecord[]) {
  return items.reduce(
    (accumulator, item) => {
      accumulator[item.triageStatus] += 1;
      return accumulator;
    },
    {
      new: 0,
      imported: 0,
      ignored: 0,
      sync_error: 0
    } satisfies Record<ExternalWorkItemRecord['triageStatus'], number>
  );
}

function buildRouteTarget(action: ExternalRouteAction): Exclude<ExternalWorkLinkRecord['targetType'], 'runner' | 'council_run'> | null {
  if (action === 'task_code') return 'task';
  if (action === 'mission_code' || action === 'mission_research') return 'mission';
  if (action === 'session_research' || action === 'session_council') return 'session';
  return null;
}

function isSameRouteAction(action: ExternalRouteAction, targetType: ExternalWorkLinkRecord['targetType'], target?: unknown): boolean {
  if (action === 'ignore') {
    return false;
  }
  if (action === 'task_code') return targetType === 'task';
  if (action === 'mission_code' || action === 'mission_research') {
    return targetType === 'mission';
  }
  if (action === 'session_research' || action === 'session_council') {
    if (targetType !== 'session' || !target || typeof target !== 'object') {
      return false;
    }
    const session = target as JarvisSessionRecord;
    if (action === 'session_research') {
      return session.intent === 'research' && session.primaryTarget === 'assistant';
    }
    return session.intent === 'council' && session.primaryTarget === 'council';
  }
  return false;
}

function buildDefaultMissionSteps(domain: MissionDomain, objective: string): MissionStepRecord[] {
  const type = domain === 'code' ? 'code' : 'research';
  const route = domain === 'code' ? '/studio/code' : '/studio/research';
  return [
    {
      id: randomUUID(),
      type,
      title: `${type.toUpperCase()} step`,
      description: objective.slice(0, 240),
      route,
      status: 'pending',
      order: 1
    }
  ];
}

async function loadLinkedTarget(ctx: RouteContext, userId: string, link: ExternalWorkLinkRecord) {
  if (link.targetType === 'task') {
    return ctx.store.getTaskById(link.targetId);
  }
  if (link.targetType === 'mission') {
    return ctx.store.getMissionById({
      missionId: link.targetId,
      userId
    });
  }
  if (link.targetType === 'session') {
    return ctx.store.getJarvisSessionById({
      userId,
      sessionId: link.targetId
    });
  }
  if (link.targetType === 'council_run') {
    return ctx.store.getCouncilRunById(link.targetId);
  }
  if (link.targetType === 'runner') {
    return ctx.store.getRunnerRunById({
      runId: link.targetId,
      userId
    });
  }
  return null;
}

function buildImportComment(item: ExternalWorkItemRecord, action: ExternalRouteAction, targetId: string): string {
  if (action === 'task_code') {
    return `Imported ${item.identifier} into JARVIS as Code Task ${targetId}.`;
  }
  if (action === 'mission_code') {
    return `Imported ${item.identifier} into JARVIS as Code Mission ${targetId}.`;
  }
  if (action === 'mission_research') {
    return `Imported ${item.identifier} into JARVIS as Research Mission ${targetId}.`;
  }
  if (action === 'session_research') {
    return `Imported ${item.identifier} into JARVIS as Research Session ${targetId}.`;
  }
  if (action === 'session_council') {
    return `Imported ${item.identifier} into JARVIS as Council Session ${targetId}.`;
  }
  return `Marked ${item.identifier} as ignored in JARVIS inbox.`;
}

export async function externalWorkRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.get('/api/v1/inbox/external-work', async (request, reply) => {
    const parsed = ExternalWorkListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid external work query', parsed.error.flatten());
    }

    const userId = ctx.resolveRequestUserId(request);
    const enabled = Boolean(ctx.env.LINEAR_API_KEY?.trim());
    let refreshError: string | null = null;
    let items: ExternalWorkItemRecord[];

    if (parsed.data.refresh === 1 && enabled) {
      try {
        items = await refreshLinearExternalWork(ctx.store, ctx.env, userId, parsed.data.limit);
      } catch (error) {
        refreshError = error instanceof Error ? error.message : 'external_work_refresh_failed';
        items = await ctx.store.listExternalWorkItems({
          userId,
          source: 'linear',
          limit: parsed.data.limit
        });
      }
    } else {
      items = await ctx.store.listExternalWorkItems({
        userId,
        source: 'linear',
        limit: parsed.data.limit
      });
    }

    return sendSuccess(reply, request, 200, {
      enabled,
      refresh_error: refreshError,
      counts: summarizeStatuses(items),
      items
    });
  });

  app.get('/api/v1/inbox/external-work/:itemId', async (request, reply) => {
    const parsed = ExternalWorkParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid external work id', parsed.error.flatten());
    }
    const userId = ctx.resolveRequestUserId(request);
    const item = await ctx.store.getExternalWorkItemById({
      itemId: parsed.data.itemId,
      userId
    });
    if (!item) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'external work item not found');
    }
    const links = await ctx.store.listExternalWorkLinksByItem({
      itemId: item.id
    });
    return sendSuccess(reply, request, 200, {
      item,
      links
    });
  });

  app.post('/api/v1/inbox/external-work/:itemId/route', async (request, reply) => {
    const params = ExternalWorkParamsSchema.safeParse(request.params);
    const body = ExternalWorkRouteSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid external work route payload', {
        params: params.success ? null : params.error.flatten(),
        body: body.success ? null : body.error.flatten()
      });
    }

    const userId = ctx.resolveRequestUserId(request);
    const item = await ctx.store.getExternalWorkItemById({
      itemId: params.data.itemId,
      userId
    });
    if (!item) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'external work item not found');
    }

    const existingPrimary = await ctx.store.getPrimaryExternalWorkLinkByItem({
      itemId: item.id
    });
    if (body.data.action === 'ignore') {
      if (existingPrimary) {
        return sendError(reply, request, 409, 'CONFLICT', 'external work item already imported');
      }
      const updated = await ctx.store.updateExternalWorkItem({
        itemId: item.id,
        userId,
        triageStatus: 'ignored'
      });
      await syncExternalWorkCommentByItem(ctx.store, ctx.env, {
        userId,
        itemId: item.id,
        body: buildImportComment(item, 'ignore', item.id),
        successTriageStatus: 'ignored'
      });
      return sendSuccess(reply, request, 200, {
        item: updated ?? item,
        action: body.data.action,
        target_type: null,
        target_id: null,
        existing: false
      });
    }

    if (existingPrimary) {
      const existingTarget = await loadLinkedTarget(ctx, userId, existingPrimary);
      if (isSameRouteAction(body.data.action, existingPrimary.targetType, existingTarget)) {
        return sendSuccess(reply, request, 200, {
          item,
          action: body.data.action,
          target_type: existingPrimary.targetType,
          target_id: existingPrimary.targetId,
          target: existingTarget,
          existing: true
        });
      }
      return sendError(reply, request, 409, 'CONFLICT', 'external work item already imported');
    }

    const targetType = buildRouteTarget(body.data.action);
    if (!targetType) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'unsupported route action');
    }

    let target: TaskRecord | JarvisSessionRecord | Awaited<ReturnType<typeof ctx.store.createMission>>;

    if (body.data.action === 'task_code') {
      target = await ctx.store.createTask({
        userId,
        mode: 'code',
        title: item.title,
        input: {
          prompt: item.description,
          external_work_item_id: item.id,
          external_work_identifier: item.identifier,
          external_work_url: item.url
        },
        idempotencyKey: `external-work:${item.id}:task_code`,
        traceId: request.id
      });
      await ctx.store.appendTaskEvent({
        taskId: target.id,
        type: 'task.external_work_imported',
        data: {
          external_work_item_id: item.id,
          external_work_identifier: item.identifier,
          source: item.source
        },
        traceId: request.id
      });
    } else if (body.data.action === 'mission_code' || body.data.action === 'mission_research') {
      const domain: MissionDomain = body.data.action === 'mission_code' ? 'code' : 'research';
      target = await ctx.store.createMission({
        userId,
        workspaceId: null,
        title: item.title,
        objective: item.description,
        domain,
        status: 'draft',
        steps: buildDefaultMissionSteps(domain, item.description)
      });
    } else {
      const isCouncil = body.data.action === 'session_council';
      target = await ctx.store.createJarvisSession({
        userId,
        title: item.title,
        prompt: item.description,
        source: 'linear_external_work',
        intent: isCouncil ? 'council' : 'research',
        status: 'queued',
        workspacePreset: isCouncil ? 'control' : 'research',
        primaryTarget: isCouncil ? 'council' : 'assistant'
      });
      await ctx.store.appendJarvisSessionEvent({
        userId,
        sessionId: target.id,
        eventType: 'external_work.imported',
        status: 'queued',
        summary: item.identifier,
        data: {
          external_work_item_id: item.id,
          external_work_identifier: item.identifier,
          source: item.source
        }
      });
    }

    await ctx.store.createExternalWorkLink({
      externalWorkItemId: item.id,
      targetType,
      targetId: target.id,
      role: 'primary'
    });
    const updatedItem = await ctx.store.updateExternalWorkItem({
      itemId: item.id,
      userId,
      triageStatus: 'imported'
    });
    await syncExternalWorkCommentByItem(ctx.store, ctx.env, {
      userId,
      itemId: item.id,
      body: buildImportComment(item, body.data.action, target.id),
      successTriageStatus: 'imported'
    });

    return sendSuccess(reply, request, 201, {
      item: updatedItem ?? item,
      action: body.data.action,
      target_type: targetType,
      target_id: target.id,
      target,
      existing: false
    });
  });
}
