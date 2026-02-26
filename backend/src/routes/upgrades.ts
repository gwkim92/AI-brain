import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import { evaluateEvalGate } from '../evals/gate';
import { executeUpgradeRun } from '../upgrades/executor';
import type { RouteContext } from './types';

const ProposalDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().optional()
});

const UpgradeRunSchema = z.object({
  proposal_id: z.string().uuid(),
  start_command: z.literal('작업 시작'),
  eval: z
    .object({
      accuracy: z.number().min(0).max(1),
      safety: z.number().min(0).max(1),
      cost_delta_pct: z.number().min(0)
    })
    .optional()
});

const UpgradeRunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20)
});

export async function upgradeRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, ensureMinRole, ensureHighRiskRole } = ctx;

  app.get('/api/v1/upgrades/proposals', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) return roleError;

    const statusQuery = (request.query as { status?: string }).status;
    type UpgradeStatus = 'proposed' | 'approved' | 'planning' | 'running' | 'verifying' | 'deployed' | 'failed' | 'rolled_back' | 'rejected';
    const validStatuses: UpgradeStatus[] = ['proposed', 'approved', 'planning', 'running', 'verifying', 'deployed', 'failed', 'rolled_back', 'rejected'];
    const statusFilter = statusQuery && validStatuses.includes(statusQuery as UpgradeStatus)
      ? (statusQuery as UpgradeStatus)
      : undefined;

    const proposals = await store.listUpgradeProposals(statusFilter);
    return sendSuccess(reply, request, 200, proposals);
  });

  app.post('/api/v1/upgrades/proposals/:proposalId/approve', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) return roleError;

    const proposalId = (request.params as { proposalId: string }).proposalId;
    const parsed = ProposalDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid decision payload', parsed.error.flatten());
    }

    if (parsed.data.decision === 'approve') {
      const approved = await store.decideUpgradeProposal(proposalId, 'approve', parsed.data.reason);
      if (!approved) {
        return sendError(reply, request, 404, 'NOT_FOUND', 'proposal not found or already decided');
      }
      return sendSuccess(reply, request, 200, approved);
    }

    const rejected = await store.decideUpgradeProposal(proposalId, 'reject', parsed.data.reason);
    if (!rejected) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'proposal not found or already decided');
    }
    return sendSuccess(reply, request, 200, rejected);
  });

  app.post('/api/v1/upgrades/runs', async (request, reply) => {
    const roleError = ensureHighRiskRole(request, reply);
    if (roleError) return roleError;

    const parsed = UpgradeRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid upgrade run payload', parsed.error.flatten());
    }

    const evalData = parsed.data.eval;
    const evalResult = evalData
      ? evaluateEvalGate({
          accuracy: evalData.accuracy,
          safety: evalData.safety,
          costDeltaPct: evalData.cost_delta_pct
        })
      : { passed: true, reasons: [] as string[] };

    const result = await executeUpgradeRun(
      {
        proposalId: parsed.data.proposal_id,
        actorId: ctx.env.DEFAULT_USER_ID,
        startCommand: parsed.data.start_command
      },
      store.createUpgradeExecutorGateway(),
      { evaluateGate: async () => evalResult }
    );

    if (result.status === 'rejected') {
      return sendError(reply, request, 409, 'CONFLICT', 'upgrade run rejected', {
        reason: result.reason
      });
    }

    const run = await store.getUpgradeRunById(result.run.id);
    return sendSuccess(reply, request, 202, run ?? result.run);
  });

  app.get('/api/v1/upgrades/runs', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) return roleError;

    const parsed = UpgradeRunListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const runs = await store.listUpgradeRuns(parsed.data.limit);
    return sendSuccess(reply, request, 200, runs);
  });

  app.get('/api/v1/upgrades/runs/:runId', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) return roleError;

    const runId = (request.params as { runId: string }).runId;
    const run = await store.getUpgradeRunById(runId);
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'upgrade run not found');
    }
    return sendSuccess(reply, request, 200, run);
  });
}
