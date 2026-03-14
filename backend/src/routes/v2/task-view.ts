import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sendError, sendSuccess } from '../../lib/http';
import { getSharedPolicyEngine } from '../../policy/engine';
import { getSharedMemoryV2Repository } from '../../store/memory/v2-repositories';
import { createPostgresV2Repository } from '../../store/postgres/v2-repositories';
import type { V2RiskLevel } from '../../store/types';
import { buildTaskViewSchema } from '../../view-schema/builder';
import type { V2RouteContext } from './types';

const ParamsSchema = z.object({
  taskId: z.string().uuid()
});

const memoryV2Repo = getSharedMemoryV2Repository();
const policyEngine = getSharedPolicyEngine();

function inferRiskLevelFromTaskMode(mode: string): V2RiskLevel {
  if (mode === 'high_risk') return 'high';
  if (mode === 'execute' || mode === 'upgrade_execution') return 'medium';
  return 'low';
}

export async function registerV2TaskViewRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.get('/api/v2/tasks/:taskId/view-schema', async (request, reply) => {
    if (!ctx.v2Flags.schemaUiEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 schema ui is disabled');
    }

    const parsedParams = ParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid task id', parsedParams.error.flatten());
    }

    const task = await ctx.store.getTaskById(parsedParams.data.taskId);
    if (!task) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'task not found');
    }
    const role = ctx.resolveRequestRole(request);
    const userId = ctx.resolveRequestUserId(request);
    if (role !== 'admin' && task.userId !== userId) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'task not found');
    }

    const policyResult = policyEngine.evaluate({
      action: 'task.view_schema',
      riskLevel: inferRiskLevelFromTaskMode(task.mode)
    });

    const schema = buildTaskViewSchema({
      taskId: task.id,
      mode: task.mode,
      status: task.status,
      riskLevel: inferRiskLevelFromTaskMode(task.mode),
      policyDecision: policyResult.decision
    });

    const pool = ctx.store.getPool();
    const repo = pool ? createPostgresV2Repository(pool) : memoryV2Repo;
    await repo.saveTaskViewSchema({
      taskId: task.id,
      schemaVersion: schema.version,
      schema
    });

    return sendSuccess(reply, request, 200, {
      task_view_schema: schema,
      policy: {
        decision: policyResult.decision,
        matched_rule_ids: policyResult.matchedRuleIds
      }
    });
  });
}
