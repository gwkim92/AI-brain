import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';
import {
  initCounter,
  TASK_STATUS_VALUES,
  TASK_MODE_VALUES,
  RUN_STATUS_VALUES,
  CONSENSUS_VALUES,
  UPGRADE_STATUS_VALUES,
  RADAR_DECISION_VALUES
} from './types';

const ReportsOverviewQuerySchema = z.object({
  task_limit: z.coerce.number().int().min(20).max(200).default(120),
  run_limit: z.coerce.number().int().min(20).max(200).default(80)
});

export async function reportRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, providerRouter, ensureMinRole } = ctx;

  app.get('/api/v1/reports/overview', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) return roleError;

    const parsed = ReportsOverviewQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const [tasks, councilRuns, executionRuns, proposals, recommendations] = await Promise.all([
      store.listTasks({ limit: parsed.data.task_limit, status: undefined }),
      store.listCouncilRuns(parsed.data.run_limit),
      store.listExecutionRuns(parsed.data.run_limit),
      store.listUpgradeProposals(undefined),
      store.listRadarRecommendations(undefined)
    ]);

    const taskByStatus = initCounter(TASK_STATUS_VALUES);
    const taskByMode = initCounter(TASK_MODE_VALUES);
    for (const task of tasks) {
      taskByStatus[task.status] += 1;
      taskByMode[task.mode] += 1;
    }

    const councilByStatus = initCounter(RUN_STATUS_VALUES);
    const councilByConsensus = initCounter(CONSENSUS_VALUES);
    for (const run of councilRuns) {
      councilByStatus[run.status] += 1;
      if (run.consensus_status) {
        councilByConsensus[run.consensus_status] += 1;
      }
    }

    const executionByStatus = initCounter(RUN_STATUS_VALUES);
    let totalDurationMs = 0;
    let fallbackUsedCount = 0;
    for (const run of executionRuns) {
      executionByStatus[run.status] += 1;
      totalDurationMs += run.duration_ms;
      if (run.used_fallback) fallbackUsedCount += 1;
    }

    const proposalByStatus = initCounter(UPGRADE_STATUS_VALUES);
    for (const proposal of proposals) {
      proposalByStatus[proposal.status] += 1;
    }

    const radarByDecision = initCounter(RADAR_DECISION_VALUES);
    for (const rec of recommendations) {
      radarByDecision[rec.decision] += 1;
    }

    const providerAvailability = providerRouter.listAvailability();
    const enabledProviders = providerAvailability.filter((p) => p.enabled).length;
    const avgDurationMs = executionRuns.length > 0 ? Math.round(totalDurationMs / executionRuns.length) : 0;
    const fallbackRatePct = executionRuns.length > 0 ? Math.round((fallbackUsedCount / executionRuns.length) * 1000) / 10 : 0;

    return sendSuccess(reply, request, 200, {
      generated_at: new Date().toISOString(),
      sampled_limits: { task_limit: parsed.data.task_limit, run_limit: parsed.data.run_limit },
      tasks: {
        total: tasks.length,
        by_status: taskByStatus,
        by_mode: taskByMode,
        running: taskByStatus.running + taskByStatus.retrying,
        failed_or_cancelled: taskByStatus.failed + taskByStatus.cancelled
      },
      councils: {
        total: councilRuns.length,
        by_status: councilByStatus,
        by_consensus: councilByConsensus,
        escalated: councilByConsensus.escalated_to_human
      },
      executions: {
        total: executionRuns.length,
        by_status: executionByStatus,
        avg_duration_ms: avgDurationMs,
        fallback_used: fallbackUsedCount,
        fallback_rate_pct: fallbackRatePct
      },
      upgrades: {
        total: proposals.length,
        by_status: proposalByStatus,
        pending_approvals: proposalByStatus.proposed
      },
      radar: {
        recommendation_total: recommendations.length,
        by_decision: radarByDecision
      },
      providers: {
        enabled: enabledProviders,
        disabled: providerAvailability.length - enabledProviders,
        items: providerAvailability
      }
    });
  });
}
