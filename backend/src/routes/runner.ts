import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getLinkedExternalWorkSummary } from '../external-work/service';
import { buildRunnerCompatSteps } from '../graph-runtime/graph';
import { sendError, sendSuccess } from '../lib/http';
import { buildRunnerOperationalMetrics, buildRunnerStats } from '../runner/service';
import { loadWorkflowContract } from '../runner/workflow-contract';
import { resolveRunnerRepoRoot, terminateProcessGroup } from '../runner/workspace';
import type { RouteContext } from './types';

const RunnerRunsQuerySchema = z.object({
  status: z
    .enum([
      'claimed',
      'running',
      'retry_queued',
      'blocked_needs_approval',
      'human_review_ready',
      'failed_terminal',
      'cancelled',
      'released'
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  scope: z.enum(['mine', 'all']).default('mine')
});

const RunnerRunParamsSchema = z.object({
  id: z.string().uuid()
});

export async function runnerRoutes(app: FastifyInstance, ctx: RouteContext) {
  const repoRoot = resolveRunnerRepoRoot(ctx.env.RUNNER_REPO_ROOT);

  app.get('/api/v1/runner/state', async (request, reply) => {
    const denied = ctx.ensureMinRole(request, reply, 'operator');
    if (denied) return denied;

    const [state, runs] = await Promise.all([
      ctx.store.getRunnerState(),
      ctx.store.listRunnerRuns({ limit: 100 })
    ]);
    const workflow = loadWorkflowContract({
      repoRoot
    }).contract;
    const stallTimeoutMs = workflow?.polling.stallTimeoutMs ?? ctx.env.RUNNER_POLL_INTERVAL_MS * 5;

    return sendSuccess(reply, request, 200, {
      state,
      stats: buildRunnerStats(runs),
      metrics: buildRunnerOperationalMetrics({
        state,
        runs,
        stallTimeoutMs
      }),
      runs
    });
  });

  app.post('/api/v1/runner/refresh', async (request, reply) => {
    const denied = ctx.ensureMinRole(request, reply, 'operator');
    if (denied) return denied;

    const state = await ctx.store.upsertRunnerState({
      refreshRequestedAt: new Date().toISOString()
    });

    return sendSuccess(reply, request, 202, {
      accepted: true,
      state
    });
  });

  app.get('/api/v1/runner/runs', async (request, reply) => {
    const denied = ctx.ensureMinRole(request, reply, 'operator');
    if (denied) return denied;

    const parsed = RunnerRunsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid runner query', parsed.error.flatten());
    }

    const scope = parsed.data.scope;
    const role = ctx.resolveRequestRole(request);
    if (scope === 'all' && role !== 'admin') {
      return sendError(reply, request, 403, 'FORBIDDEN', 'scope=all requires admin role');
    }

    const runs = await ctx.store.listRunnerRuns({
      userId: scope === 'all' ? undefined : ctx.resolveRequestUserId(request),
      status: parsed.data.status,
      limit: parsed.data.limit
    });

    return sendSuccess(reply, request, 200, {
      runs,
      stats: buildRunnerStats(runs)
    });
  });

  app.get('/api/v1/runner/runs/:id', async (request, reply) => {
    const denied = ctx.ensureMinRole(request, reply, 'operator');
    if (denied) return denied;

    const parsed = RunnerRunParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid runner run id', parsed.error.flatten());
    }

    const role = ctx.resolveRequestRole(request);
    const run = await ctx.store.getRunnerRunById({
      runId: parsed.data.id,
      userId: role === 'admin' ? undefined : ctx.resolveRequestUserId(request)
    });
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'runner run not found');
    }

    return sendSuccess(reply, request, 200, {
      run,
      graph: run.graphSpec,
      node_runs: run.graphRun?.nodeRuns ?? [],
      artifacts: run.artifacts,
      session_state_summary: run.sessionState,
      compat_steps: buildRunnerCompatSteps(run),
      linked_external_work: await getLinkedExternalWorkSummary(ctx.store, {
        userId: run.userId,
        targetType: 'runner',
        targetId: run.id
      })
    });
  });

  app.get('/api/v1/runner/runs/:id/artifacts', async (request, reply) => {
    const denied = ctx.ensureMinRole(request, reply, 'operator');
    if (denied) return denied;

    const parsed = RunnerRunParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid runner run id', parsed.error.flatten());
    }

    const role = ctx.resolveRequestRole(request);
    const run = await ctx.store.getRunnerRunById({
      runId: parsed.data.id,
      userId: role === 'admin' ? undefined : ctx.resolveRequestUserId(request)
    });
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'runner run not found');
    }

    return sendSuccess(reply, request, 200, {
      run_id: run.id,
      artifacts: run.artifacts
    });
  });

  app.post('/api/v1/runner/runs/:id/cancel', async (request, reply) => {
    const denied = ctx.ensureMinRole(request, reply, 'operator');
    if (denied) return denied;

    const parsed = RunnerRunParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid runner run id', parsed.error.flatten());
    }

    const role = ctx.resolveRequestRole(request);
    const userId = role === 'admin' ? undefined : ctx.resolveRequestUserId(request);
    const run = await ctx.store.getRunnerRunById({
      runId: parsed.data.id,
      userId
    });
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'runner run not found');
    }

    const terminated = run.lastProcessPid ? terminateProcessGroup(run.lastProcessPid) : false;
    const updated = await ctx.store.updateRunnerRun({
      runId: run.id,
      userId,
      claimState: 'released',
      status: 'cancelled',
      failureReason: 'cancelled_by_operator',
      completedAt: new Date().toISOString(),
      lastProcessPid: 0
    });
    if (run.workItem.taskId) {
      await ctx.store.setTaskStatus({
        taskId: run.workItem.taskId,
        status: 'cancelled',
        eventType: 'task.runner_cancelled',
        data: {
          runner_run_id: run.id
        }
      });
    }
    if (run.sessionSnapshot?.sessionId) {
      await ctx.store.updateJarvisSession({
        sessionId: run.sessionSnapshot.sessionId,
        userId: run.userId,
        status: 'blocked'
      });
      await ctx.store.appendJarvisSessionEvent({
        userId: run.userId,
        sessionId: run.sessionSnapshot.sessionId,
        eventType: 'runner.run.cancelled',
        status: 'blocked',
        summary: 'Runner execution cancelled by operator',
        data: {
          runner_run_id: run.id,
          terminated
        }
      });
    }

    return sendSuccess(reply, request, 200, {
      run: updated,
      terminated
    });
  });

  app.post('/api/v1/runner/workflow/validate', async (request, reply) => {
    const denied = ctx.ensureMinRole(request, reply, 'operator');
    if (denied) return denied;

    const result = loadWorkflowContract({
      repoRoot
    });

    return sendSuccess(reply, request, result.contract ? 200 : 422, {
      valid: Boolean(result.contract),
      source_path: result.sourcePath,
      contract: result.contract,
      errors: result.errors
    });
  });
}
