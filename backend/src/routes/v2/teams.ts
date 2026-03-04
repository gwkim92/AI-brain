import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sendError, sendSuccess } from '../../lib/http';
import { getSharedPolicyEngine } from '../../policy/engine';
import { composeTeamPlan } from '../../team/composer';
import { getSharedTeamRunEngine } from '../../team/run-engine';
import { getSharedMemoryV2Repository } from '../../store/memory/v2-repositories';
import { createPostgresV2Repository } from '../../store/postgres/v2-repositories';
import { applySseCorsHeaders } from '../types';
import type { V2RouteContext } from './types';

const TeamComposeSchema = z.object({
  contract_id: z.string().uuid()
});

const TeamRunSchema = z.object({
  contract_id: z.string().uuid(),
  prompt: z.string().min(1).max(12000).optional()
});

const TeamRunParamsSchema = z.object({
  id: z.string().uuid()
});

const memoryV2Repo = getSharedMemoryV2Repository();
const teamRunEngine = getSharedTeamRunEngine();
const policyEngine = getSharedPolicyEngine();

export async function registerV2TeamRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.post('/api/v2/teams/compose', async (request, reply) => {
    if (!ctx.v2Flags.teamEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 team composer is disabled');
    }

    const parsed = TeamComposeSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid v2 teams compose payload', parsed.error.flatten());
    }

    const userId = ctx.resolveRequestUserId(request);
    const pool = ctx.store.getPool();
    const repo = pool ? createPostgresV2Repository(pool) : memoryV2Repo;
    const contract = await repo.getCommandCompilationById({
      id: parsed.data.contract_id,
      userId
    });
    if (!contract) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'execution contract not found');
    }

    const plan = composeTeamPlan(contract);
    return sendSuccess(reply, request, 200, {
      contract_id: contract.id,
      team_plan: plan
    });
  });

  app.post('/api/v2/teams/runs', async (request, reply) => {
    if (!ctx.v2Flags.teamEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 team runs are disabled');
    }

    const parsed = TeamRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid v2 teams run payload', parsed.error.flatten());
    }

    const userId = ctx.resolveRequestUserId(request);
    const pool = ctx.store.getPool();
    const repo = pool ? createPostgresV2Repository(pool) : memoryV2Repo;
    const contract = await repo.getCommandCompilationById({
      id: parsed.data.contract_id,
      userId
    });
    if (!contract) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'execution contract not found');
    }
    const policy = policyEngine.evaluate({
      action: 'team.run.start',
      riskLevel: contract.riskLevel
    });
    if (policy.decision === 'deny') {
      return sendError(reply, request, 403, 'FORBIDDEN', 'policy denied team run execution', {
        matched_rule_ids: policy.matchedRuleIds,
        reasons: policy.reasons
      });
    }
    if (policy.decision === 'approval_required') {
      return sendError(reply, request, 403, 'FORBIDDEN', 'policy requires approval before team run execution', {
        matched_rule_ids: policy.matchedRuleIds,
        reasons: policy.reasons
      });
    }

    const run = await teamRunEngine.startRun({
      userId,
      contract,
      prompt: parsed.data.prompt ?? contract.prompt,
      plan: composeTeamPlan(contract)
    });

    return sendSuccess(reply, request, 200, {
      run_id: run.id,
      status: run.status,
      escalated_to_human: run.escalatedToHuman,
      arbitration_rounds: run.arbitrationRounds,
      selected_role: run.selectedRole
    });
  });

  app.get('/api/v2/teams/runs/:id/events', async (request, reply) => {
    if (!ctx.v2Flags.teamEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 team events are disabled');
    }

    const parsedParams = TeamRunParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid team run id', parsedParams.error.flatten());
    }

    const run = teamRunEngine.getRun(parsedParams.data.id);
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'team run not found');
    }

    const role = ctx.resolveRequestRole(request);
    const userId = ctx.resolveRequestUserId(request);
    if (role !== 'admin' && run.userId !== userId) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'team run not found');
    }

    applySseCorsHeaders(request, reply, ctx.env);
    reply.raw.write('event: stream.open\n');
    reply.raw.write(`data: ${JSON.stringify({ request_id: request.id, run_id: run.id })}\n\n`);

    for (const event of run.events) {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(
        `data: ${JSON.stringify({
          event_id: event.id,
          timestamp: event.timestamp,
          run_id: run.id,
          data: event.data
        })}\n\n`
      );
    }

    reply.raw.write('event: stream.close\n');
    reply.raw.write(`data: ${JSON.stringify({ run_id: run.id })}\n\n`);
    reply.raw.end();
  });
}
