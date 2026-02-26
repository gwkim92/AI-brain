import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import { classifyComplexity, buildSimplePlan } from '../orchestrator/complexity';
import { executeMission } from '../orchestrator/mission-executor';
import { generatePlan, planToMissionInput } from '../orchestrator/planner';
import type { MissionRecord, MissionStepRecord } from '../store/types';
import type { RouteContext } from './types';
import { truncateText, buildMissionSignature, type MissionDomain, type MissionStepType } from './types';

const MissionDomainSchema = z.enum(['code', 'research', 'finance', 'news', 'mixed']);
const MissionStatusSchema = z.enum(['draft', 'planned', 'running', 'blocked', 'completed', 'failed']);
const MissionStepTypeSchema = z.enum([
  'llm_generate', 'council_debate', 'human_gate', 'tool_call', 'sub_mission',
  'code', 'research', 'finance', 'news', 'approval', 'execute'
]);
const MissionStepStatusSchema = z.enum(['pending', 'running', 'done', 'blocked', 'failed']);

const MissionStepCreateSchema = z.object({
  type: MissionStepTypeSchema,
  title: z.string().min(1).max(180),
  description: z.string().max(2000).optional(),
  route: z.string().min(1).max(200).optional(),
  task_type: z.string().min(1).max(60).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const MissionCreateSchema = z.object({
  title: z.string().min(1).max(180),
  objective: z.string().min(1).max(4000),
  domain: MissionDomainSchema.default('mixed'),
  workspace_id: z.string().uuid().optional(),
  steps: z.array(MissionStepCreateSchema).max(40).optional()
});

const MissionListQuerySchema = z.object({
  status: MissionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const MissionEventsQuerySchema = z.object({
  poll_ms: z.coerce.number().int().min(300).max(10000).default(1200),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).default(45000)
});

const MissionUpdateSchema = z
  .object({
    status: MissionStatusSchema.optional(),
    title: z.string().min(1).max(180).optional(),
    objective: z.string().min(1).max(4000).optional(),
    step_statuses: z
      .array(z.object({ step_id: z.string().uuid(), status: MissionStepStatusSchema }))
      .max(100)
      .optional()
  })
  .refine((value) => {
    return (
      typeof value.status !== 'undefined' ||
      typeof value.title !== 'undefined' ||
      typeof value.objective !== 'undefined' ||
      (Array.isArray(value.step_statuses) && value.step_statuses.length > 0)
    );
  }, 'at least one mission field must be provided');

const defaultRouteByStepType: Record<string, string> = {
  code: '/studio/code', research: '/studio/research', finance: '/studio/finance',
  news: '/studio/news', approval: '/approvals', execute: '/mission',
  llm_generate: '/mission', council_debate: '/studio/research',
  human_gate: '/approvals', tool_call: '/mission', sub_mission: '/mission'
};

const defaultStepTypeByDomain: Record<MissionDomain, MissionStepType> = {
  code: 'code', research: 'research', finance: 'finance', news: 'news', mixed: 'execute'
};

function buildDefaultMissionSteps(domain: MissionDomain, objective: string): MissionStepRecord[] {
  const stepType = defaultStepTypeByDomain[domain];
  const route = defaultRouteByStepType[stepType];
  return [{
    id: randomUUID(),
    type: stepType,
    title: `${stepType.toUpperCase()} step`,
    description: truncateText(objective, 240),
    route,
    status: 'pending',
    order: 1
  }];
}

export async function missionRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, providerRouter, notificationService, resolveRequestUserId, publishMissionUpdated, subscribeMissionUpdates, missionExecutionsInFlight } = ctx;

  app.post('/api/v1/missions', async (request, reply) => {
    const parsed = MissionCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid mission payload', parsed.error.flatten());
    }

    const userId = resolveRequestUserId(request);
    const steps: MissionStepRecord[] =
      parsed.data.steps?.map((step, index) => ({
        id: randomUUID(),
        type: step.type,
        title: step.title,
        description: step.description ?? '',
        route: step.route ?? defaultRouteByStepType[step.type] ?? '/mission',
        status: 'pending',
        order: index + 1,
        taskType: step.task_type,
        metadata: step.metadata
      })) ?? buildDefaultMissionSteps(parsed.data.domain, parsed.data.objective);

    const mission = await store.createMission({
      userId,
      workspaceId: parsed.data.workspace_id ?? null,
      title: parsed.data.title,
      objective: parsed.data.objective,
      domain: parsed.data.domain,
      status: 'draft',
      steps
    });
    publishMissionUpdated(mission);
    return sendSuccess(reply, request, 201, mission);
  });

  app.get('/api/v1/missions', async (request, reply) => {
    const parsed = MissionListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const rows = await store.listMissions({ userId, status: parsed.data.status, limit: parsed.data.limit });
    return sendSuccess(reply, request, 200, { missions: rows });
  });

  app.get('/api/v1/missions/:missionId', async (request, reply) => {
    const missionId = (request.params as { missionId: string }).missionId;
    const userId = resolveRequestUserId(request);
    const mission = await store.getMissionById({ missionId, userId });
    if (!mission) return sendError(reply, request, 404, 'NOT_FOUND', 'mission not found');
    return sendSuccess(reply, request, 200, mission);
  });

  app.patch('/api/v1/missions/:missionId', async (request, reply) => {
    const missionId = (request.params as { missionId: string }).missionId;
    const parsed = MissionUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid mission update payload', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const updated = await store.updateMission({
      missionId, userId,
      status: parsed.data.status,
      title: parsed.data.title,
      objective: parsed.data.objective,
      stepStatuses: parsed.data.step_statuses?.map((step) => ({ stepId: step.step_id, status: step.status }))
    });
    if (!updated) return sendError(reply, request, 404, 'NOT_FOUND', 'mission not found');
    publishMissionUpdated(updated);
    return sendSuccess(reply, request, 200, updated);
  });

  app.post('/api/v1/missions/:missionId/execute', async (request, reply) => {
    const missionId = (request.params as { missionId: string }).missionId;
    const userId = resolveRequestUserId(request);
    const mission = await store.getMissionById({ missionId, userId });
    if (!mission) return sendError(reply, request, 404, 'NOT_FOUND', 'mission not found');
    if (mission.status === 'running') return sendError(reply, request, 409, 'CONFLICT', 'mission is already running');
    if (missionExecutionsInFlight.has(missionId)) return sendError(reply, request, 409, 'CONFLICT', 'mission execution already in flight');
    if (!mission.steps || mission.steps.length === 0) return sendError(reply, request, 422, 'VALIDATION_ERROR', 'mission has no steps to execute');

    missionExecutionsInFlight.add(missionId);

    void (async () => {
      try {
        await executeMission(mission, store, providerRouter, userId, {
          onStepCompleted: (stepId) => {
            const step = mission.steps.find((s) => s.id === stepId);
            notificationService?.emitMissionStepCompleted(missionId, step?.title ?? stepId);
          },
        });
      } catch {
        // errors already handled inside executeMission
      } finally {
        missionExecutionsInFlight.delete(missionId);
      }
    })();

    return sendSuccess(reply, request, 202, { mission_id: missionId, status: 'execution_started' });
  });

  app.post('/api/v1/missions/:missionId/steps/:stepId/retry', async (request, reply) => {
    const { missionId, stepId } = request.params as { missionId: string; stepId: string };
    const userId = resolveRequestUserId(request);
    const mission = await store.getMissionById({ missionId, userId });
    if (!mission) return sendError(reply, request, 404, 'NOT_FOUND', 'mission not found');
    const step = mission.steps.find((s) => s.id === stepId);
    if (!step) return sendError(reply, request, 404, 'NOT_FOUND', 'step not found');
    if (step.status !== 'failed') return sendError(reply, request, 422, 'VALIDATION_ERROR', 'only failed steps can be retried');
    await store.updateMission({ missionId, userId, stepStatuses: [{ stepId, status: 'pending' }] });
    return sendSuccess(reply, request, 200, { mission_id: missionId, step_id: stepId, status: 'retry_queued' });
  });

  app.post('/api/v1/missions/generate-plan', async (request, reply) => {
    const schema = z.object({
      prompt: z.string().min(1).max(5000),
      auto_create: z.boolean().default(false),
      complexity_hint: z.enum(['simple', 'moderate', 'complex']).optional()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid plan generation payload', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const complexity = parsed.data.complexity_hint ?? classifyComplexity(parsed.data.prompt);
    try {
      const plan = complexity === 'simple'
        ? buildSimplePlan(parsed.data.prompt)
        : await generatePlan(parsed.data.prompt, providerRouter);
      if (parsed.data.auto_create) {
        const missionInput = planToMissionInput(plan, userId);
        const mission = await store.createMission(missionInput);
        return sendSuccess(reply, request, 201, { plan, mission, complexity });
      }
      return sendSuccess(reply, request, 200, { plan, complexity });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'plan generation failed';
      return sendError(reply, request, 500, 'PLAN_GENERATION_FAILED', reason);
    }
  });

  app.get('/api/v1/missions/:missionId/events', async (request, reply) => {
    const missionId = (request.params as { missionId: string }).missionId;
    const parsed = MissionEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const initialMission = await store.getMissionById({ missionId, userId });
    if (!initialMission) return sendError(reply, request, 404, 'NOT_FOUND', 'mission not found');

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    const emitEvent = (name: string, payload: unknown) => {
      reply.raw.write(`event: ${name}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    emitEvent('stream.open', { request_id: request.id, mission_id: missionId });

    let closed = false;
    let lastSignature: string | null = null;
    let unsubscribeMissionUpdates: (() => void) | null = null;

    const closeStream = (reason?: string) => {
      if (closed) return;
      closed = true;
      if (unsubscribeMissionUpdates) { unsubscribeMissionUpdates(); unsubscribeMissionUpdates = null; }
      emitEvent('stream.close', { request_id: request.id, mission_id: missionId, reason });
      reply.raw.end();
    };

    const emitMissionUpdate = (mission: MissionRecord) => {
      if (closed) return;
      const signature = buildMissionSignature(mission);
      if (signature === lastSignature) return;
      lastSignature = signature;
      emitEvent('mission.updated', { mission_id: missionId, timestamp: new Date().toISOString(), data: mission });
    };

    const emitMissionSnapshot = async () => {
      if (closed) return;
      const current = await store.getMissionById({ missionId, userId });
      if (!current) { closeStream('mission_not_found'); return; }
      emitMissionUpdate(current);
    };

    unsubscribeMissionUpdates = subscribeMissionUpdates(missionId, (mission) => {
      emitMissionUpdate(mission);
    });

    reply.raw.on('close', () => {
      closed = true;
      if (unsubscribeMissionUpdates) { unsubscribeMissionUpdates(); unsubscribeMissionUpdates = null; }
    });

    await emitMissionSnapshot();
    if (closed) return;

    const interval = setInterval(() => { void emitMissionSnapshot(); }, parsed.data.poll_ms);
    const timeout = setTimeout(() => { closeStream('timeout'); }, parsed.data.timeout_ms);

    reply.raw.on('close', () => {
      clearInterval(interval);
      clearTimeout(timeout);
    });
  });
}
