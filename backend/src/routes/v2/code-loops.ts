import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createGitHubBranchAndPr } from '../../code-loop/adapters/github-pr';
import { getSharedCodeLoopEngine } from '../../code-loop/engine';
import { runLocalVerificationCommand } from '../../code-loop/runners/local-shell';
import { sendError, sendSuccess } from '../../lib/http';
import { getSharedMemoryV2Repository } from '../../store/memory/v2-repositories';
import { createPostgresV2Repository } from '../../store/postgres/v2-repositories';
import { applySseCorsHeaders } from '../types';
import type { V2RouteContext } from './types';

const CreateCodeLoopRunSchema = z.object({
  contract_id: z.string().uuid(),
  prompt: z.string().min(1).max(12000).optional(),
  changed_files: z.array(z.string().min(1).max(500)).max(200).default([]),
  policy_violations: z.array(z.string().min(1).max(240)).max(50).optional(),
  verification_commands: z.array(z.string().min(1).max(240)).max(8).optional(),
  simulate: z
    .object({
      test_failures: z.number().int().min(0).max(5).optional()
    })
    .optional()
});

const RunIdParamsSchema = z.object({
  id: z.string().uuid()
});

const memoryV2Repo = getSharedMemoryV2Repository();
const codeLoopEngine = getSharedCodeLoopEngine();

export async function registerV2CodeLoopRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.post('/api/v2/code-loops/runs', async (request, reply) => {
    if (!ctx.v2Flags.codeLoopEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 code loop is disabled');
    }

    const parsed = CreateCodeLoopRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid code loop payload', parsed.error.flatten());
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

    const run = await codeLoopEngine.startRun({
      userId,
      contractId: contract.id,
      prompt: parsed.data.prompt ?? contract.prompt,
      riskLevel: contract.riskLevel,
      changedFiles: parsed.data.changed_files,
      policyViolations: parsed.data.policy_violations,
      simulate: parsed.data.simulate
    });

    const verification = parsed.data.verification_commands
      ? await Promise.all(
          parsed.data.verification_commands.map(async (command) => ({
            command,
            ...(await runLocalVerificationCommand({
              command,
              cwd: process.cwd(),
              enabled: ctx.env.CODE_LOOP_LOCAL_EXEC_ENABLED
            }))
          }))
        )
      : [];

    let pr:
      | {
          url: string;
          number: number;
          head: string;
          base: string;
        }
      | null = null;
    let prError: string | null = null;
    if (run.status === 'completed' && ctx.env.GITHUB_TOKEN && ctx.env.GITHUB_OWNER && ctx.env.GITHUB_REPO) {
      try {
        pr = await createGitHubBranchAndPr(
          {
            token: ctx.env.GITHUB_TOKEN,
            owner: ctx.env.GITHUB_OWNER,
            repo: ctx.env.GITHUB_REPO,
            baseBranch: 'main'
          },
          {
            branchName: `jarvis/code-loop-${run.id.slice(0, 8)}`,
            title: `[Jarvis] Code loop ${run.id.slice(0, 8)}`,
            body: `Automated code-loop execution\n\nPrompt: ${run.prompt}`
          }
        );
      } catch (error) {
        prError = error instanceof Error ? error.message : String(error);
      }
    }

    return sendSuccess(reply, request, 200, {
      run_id: run.id,
      status: run.status,
      retry_count: run.retryCount,
      requires_approval: run.requiresApproval,
      blocked_reasons: run.blockedReasons,
      verification,
      pr,
      pr_error: prError
    });
  });

  app.post('/api/v2/code-loops/runs/:id/approve', async (request, reply) => {
    if (!ctx.v2Flags.codeLoopEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 code loop is disabled');
    }

    const parsedParams = RunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid run id', parsedParams.error.flatten());
    }

    const run = await codeLoopEngine.approveRun({
      runId: parsedParams.data.id,
      userId: ctx.resolveRequestUserId(request)
    });
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'code loop run not found');
    }

    return sendSuccess(reply, request, 200, {
      run_id: run.id,
      status: run.status,
      approved_at: run.approvedAt
    });
  });

  app.post('/api/v2/code-loops/runs/:id/replan', async (request, reply) => {
    if (!ctx.v2Flags.codeLoopEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 code loop is disabled');
    }

    const parsedParams = RunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid run id', parsedParams.error.flatten());
    }

    const run = await codeLoopEngine.replanRun({
      runId: parsedParams.data.id,
      userId: ctx.resolveRequestUserId(request)
    });
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'code loop run not found');
    }

    return sendSuccess(reply, request, 200, {
      run_id: run.id,
      status: run.status,
      retry_count: run.retryCount
    });
  });

  app.get('/api/v2/code-loops/runs/:id/events', async (request, reply) => {
    if (!ctx.v2Flags.codeLoopEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 code loop is disabled');
    }

    const parsedParams = RunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid run id', parsedParams.error.flatten());
    }

    const run = codeLoopEngine.getRun(parsedParams.data.id);
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'code loop run not found');
    }

    const role = ctx.resolveRequestRole(request);
    const userId = ctx.resolveRequestUserId(request);
    if (role !== 'admin' && run.userId !== userId) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'code loop run not found');
    }

    applySseCorsHeaders(request, reply, ctx.env);
    reply.raw.write('event: stream.open\n');
    reply.raw.write(`data: ${JSON.stringify({ request_id: request.id, run_id: run.id })}\n\n`);

    for (const event of run.events) {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(
        `data: ${JSON.stringify({
          event_id: event.id,
          run_id: run.id,
          timestamp: event.timestamp,
          data: event.data
        })}\n\n`
      );
    }

    reply.raw.write('event: stream.close\n');
    reply.raw.write(`data: ${JSON.stringify({ run_id: run.id })}\n\n`);
    reply.raw.end();
  });
}
