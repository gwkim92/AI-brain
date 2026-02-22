import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppEnv } from '../config/env';
import { evaluateEvalGate } from '../evals/gate';
import { handleResponsesWebhook } from '../integrations/openai/webhook-handler';
import { handleTelegramCommand } from '../integrations/telegram/commands';
import { sendError, sendSuccess } from '../lib/http';
import { maskErrorForApi, summarizeResult, type ProviderRouter } from '../providers/router';
import { appendOpsPolicyItems, normalizeRadarItems } from '../radar/ingest';
import { buildOpsUpgradeProposals } from '../radar/ops-policy';
import type { JarvisStore, TaskMode } from '../store/types';
import { executeUpgradeRun } from '../upgrades/executor';

const TaskCreateSchema = z.object({
  mode: z
    .enum(['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'])
    .default('execute'),
  title: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()).default({})
});

const TaskListQuerySchema = z.object({
  status: z.enum(['queued', 'running', 'blocked', 'retrying', 'done', 'failed', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const RadarIngestSchema = z.object({
  source_name: z.string().default('manual'),
  items: z
    .array(
      z.object({
        title: z.string().min(1),
        summary: z.string().optional(),
        source_url: z.string().url(),
        published_at: z.string().datetime().optional(),
        confidence_score: z.number().min(0).max(1).optional()
      })
    )
    .optional()
});

const RadarEvaluateSchema = z.object({
  item_ids: z.array(z.string().min(1)).min(1)
});

const RadarRecommendationQuerySchema = z.object({
  decision: z.enum(['adopt', 'hold', 'discard']).optional()
});

const TelegramReportSchema = z.object({
  chat_id: z.string().min(1)
});

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

const AiRespondSchema = z.object({
  prompt: z.string().min(1),
  system_prompt: z.string().optional(),
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).default('auto'),
  strict_provider: z.boolean().default(false),
  task_type: z
    .enum(['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'])
    .default('chat'),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().max(32000).optional()
});

export async function registerRoutes(
  app: FastifyInstance,
  store: JarvisStore,
  env: AppEnv,
  providerRouter: ProviderRouter
): Promise<void> {
  app.get('/health', async (request, reply) => {
    const health = await store.health();

    return sendSuccess(
      reply,
      request,
      200,
      {
        status: 'ok',
        service: 'jarvis-backend',
        env: env.NODE_ENV,
        store: health.store,
        db: health.db,
        now: new Date().toISOString()
      },
      {}
    );
  });

  app.get('/api/v1/providers', async (request, reply) => {
    return sendSuccess(reply, request, 200, {
      providers: providerRouter.listAvailability()
    });
  });

  app.post('/api/v1/ai/respond', async (request, reply) => {
    const parsed = AiRespondSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid ai request payload', parsed.error.flatten());
    }

    try {
      const routed = await providerRouter.generate({
        prompt: parsed.data.prompt,
        systemPrompt: parsed.data.system_prompt,
        provider: parsed.data.provider,
        strictProvider: parsed.data.strict_provider,
        taskType: parsed.data.task_type,
        model: parsed.data.model,
        temperature: parsed.data.temperature,
        maxOutputTokens: parsed.data.max_output_tokens
      });

      return sendSuccess(reply, request, 200, {
        ...summarizeResult(routed.result),
        attempts: routed.attempts,
        used_fallback: routed.usedFallback
      });
    } catch (error) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'all providers failed', {
        reason: maskErrorForApi(error)
      });
    }
  });

  app.post('/api/v1/tasks', async (request, reply) => {
    const parsed = TaskCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid task payload', parsed.error.flatten());
    }

    const userIdHeader = request.headers['x-user-id'];
    const userId = typeof userIdHeader === 'string' ? userIdHeader : env.DEFAULT_USER_ID;

    const idempotencyHeader = request.headers['idempotency-key'];
    const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader : randomUUID();

    const traceHeader = request.headers['x-trace-id'];
    const traceId = typeof traceHeader === 'string' ? traceHeader : undefined;

    const task = await store.createTask({
      userId,
      mode: parsed.data.mode as TaskMode,
      title: parsed.data.title,
      input: parsed.data.input,
      idempotencyKey,
      traceId
    });

    return sendSuccess(reply, request, 201, task);
  });

  app.get('/api/v1/tasks', async (request, reply) => {
    const parsed = TaskListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const tasks = await store.listTasks(parsed.data);
    return sendSuccess(reply, request, 200, tasks);
  });

  app.get('/api/v1/tasks/:taskId', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const task = await store.getTaskById(taskId);
    if (!task) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'task not found');
    }

    return sendSuccess(reply, request, 200, task);
  });

  app.get('/api/v1/tasks/:taskId/events', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const events = await store.listTaskEvents(taskId, 200);

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    reply.raw.write(`event: stream.open\n`);
    reply.raw.write(`data: ${JSON.stringify({ request_id: request.id, task_id: taskId })}\n\n`);

    for (const event of events) {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(
        `data: ${JSON.stringify({
          event_id: event.id,
          task_id: event.taskId,
          timestamp: event.timestamp,
          data: event.data
        })}\n\n`
      );
    }

    reply.raw.write('event: stream.close\n');
    reply.raw.write(`data: ${JSON.stringify({ task_id: taskId })}\n\n`);
    reply.raw.end();
  });

  app.post('/api/v1/radar/ingest', async (request, reply) => {
    const parsed = RadarIngestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid radar ingest payload', parsed.error.flatten());
    }

    const requestedItems = parsed.data.items;

    const defaults = [
      {
        title: 'OpenAI platform updates',
        summary: 'Track Responses API, eval, and platform release notes',
        source_url: 'https://platform.openai.com/docs/changelog',
        published_at: new Date().toISOString(),
        confidence_score: 0.95
      },
      {
        title: 'MCP spec updates',
        summary: 'Track MCP transport and security changes',
        source_url: 'https://modelcontextprotocol.io/specification',
        published_at: new Date().toISOString(),
        confidence_score: 0.9
      }
    ];

    const normalized = normalizeRadarItems(
      parsed.data.source_name,
      (requestedItems ?? defaults).map((item) => ({
        title: item.title,
        summary: item.summary,
        sourceUrl: item.source_url,
        publishedAt: item.published_at,
        confidenceScore: item.confidence_score
      }))
    );

    const withOps = appendOpsPolicyItems(
      normalized,
      buildOpsUpgradeProposals({
        node: {
          currentMajor: 22,
          preferredMajor: 24,
          maintenanceMajor: 22
        },
        postgres: {
          currentMinor: 0,
          latestMinor: 2,
          outOfCycleSecurityNotice: false
        },
        valkey: {
          currentPatch: 0,
          latestPatch: 2,
          vulnerabilityNotice: false
        }
      })
    );

    const ingestItems = withOps.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      sourceUrl: item.sourceUrl,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      confidenceScore: item.confidenceScore,
      status: 'new' as const
    }));

    const count = await store.ingestRadarItems(ingestItems);

    return sendSuccess(reply, request, 202, {
      ingest_job_id: `ingest_${Date.now()}`,
      status: 'queued',
      accepted_count: count
    });
  });

  app.get('/api/v1/radar/items', async (request, reply) => {
    const parsed = z
      .object({
        status: z.enum(['new', 'scored', 'archived']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50)
      })
      .safeParse(request.query);

    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const items = await store.listRadarItems({
      status: parsed.data.status,
      limit: parsed.data.limit
    });

    return sendSuccess(reply, request, 200, { items });
  });

  app.post('/api/v1/radar/evaluate', async (request, reply) => {
    const parsed = RadarEvaluateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid evaluate payload', parsed.error.flatten());
    }

    const recommendations = await store.evaluateRadar({ itemIds: parsed.data.item_ids });

    return sendSuccess(reply, request, 202, {
      evaluation_job_id: `eval_${Date.now()}`,
      status: 'queued',
      recommendation_count: recommendations.length
    });
  });

  app.get('/api/v1/radar/recommendations', async (request, reply) => {
    const parsed = RadarRecommendationQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const recommendations = await store.listRadarRecommendations(parsed.data.decision);
    return sendSuccess(reply, request, 200, { recommendations });
  });

  app.post('/api/v1/radar/reports/telegram', async (request, reply) => {
    const parsed = TelegramReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid telegram payload', parsed.error.flatten());
    }

    const report = await store.createTelegramReport({
      chatId: parsed.data.chat_id
    });

    return sendSuccess(reply, request, 202, report);
  });

  app.get('/api/v1/upgrades/proposals', async (request, reply) => {
    const parsed = z
      .object({
        status: z
          .enum(['proposed', 'approved', 'planning', 'running', 'verifying', 'deployed', 'failed', 'rolled_back', 'rejected'])
          .optional()
      })
      .safeParse(request.query);

    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const proposals = await store.listUpgradeProposals(parsed.data.status as UpgradeStatus | undefined);
    return sendSuccess(reply, request, 200, { proposals });
  });

  app.post('/api/v1/upgrades/proposals/:proposalId/approve', async (request, reply) => {
    const proposalId = (request.params as { proposalId: string }).proposalId;
    const parsed = ProposalDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid approval payload', parsed.error.flatten());
    }

    const proposal = await store.decideUpgradeProposal(proposalId, parsed.data.decision, parsed.data.reason);
    if (!proposal) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'proposal not found');
    }

    return sendSuccess(reply, request, 200, proposal);
  });

  app.post('/api/v1/upgrades/runs', async (request, reply) => {
    const parsed = UpgradeRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid run payload', parsed.error.flatten());
    }

    const evalData = parsed.data.eval;
    const evalResult = evalData
      ? evaluateEvalGate({
          accuracy: evalData.accuracy,
          safety: evalData.safety,
          costDeltaPct: evalData.cost_delta_pct
        })
      : { passed: true, reasons: [] };

    const result = await executeUpgradeRun(
      {
        proposalId: parsed.data.proposal_id,
        actorId: env.DEFAULT_USER_ID,
        startCommand: parsed.data.start_command
      },
      store.createUpgradeExecutorGateway(),
      {
        evaluateGate: async () => evalResult
      }
    );

    if (result.status === 'rejected') {
      return sendError(reply, request, 409, 'CONFLICT', 'upgrade run rejected', {
        reason: result.reason
      });
    }

    const run = await store.getUpgradeRunById(result.run.id);
    return sendSuccess(reply, request, 202, run ?? result.run);
  });

  app.get('/api/v1/upgrades/runs/:runId', async (request, reply) => {
    const runId = (request.params as { runId: string }).runId;
    const run = await store.getUpgradeRunById(runId);
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'upgrade run not found');
    }

    return sendSuccess(reply, request, 200, run);
  });

  app.post('/api/v1/integrations/openai/webhook', async (request, reply) => {
    const signature = request.headers['x-jarvis-openai-signature'];

    if (!env.OPENAI_WEBHOOK_SECRET) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'OPENAI_WEBHOOK_SECRET not configured');
    }

    const rawBody = JSON.stringify(request.body ?? {});
    const result = await handleResponsesWebhook(
      {
        rawBody,
        signature: typeof signature === 'string' ? signature : undefined,
        secret: env.OPENAI_WEBHOOK_SECRET
      },
      {
        async onEvent() {
          return;
        }
      }
    );

    if (!result.accepted) {
      return sendError(reply, request, 401, 'UNAUTHORIZED', 'webhook rejected', { reason: result.reason });
    }

    return sendSuccess(reply, request, 200, { accepted: true });
  });

  app.post('/api/v1/integrations/telegram/webhook', async (request, reply) => {
    const secretToken = request.headers['x-telegram-bot-api-secret-token'];

    if (!env.TELEGRAM_WEBHOOK_SECRET) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'TELEGRAM_WEBHOOK_SECRET not configured');
    }

    if (typeof secretToken !== 'string' || secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
      return sendError(reply, request, 401, 'UNAUTHORIZED', 'invalid telegram webhook secret');
    }

    const body = request.body as {
      message?: {
        text?: string;
      };
    };

    const text = body?.message?.text;
    if (!text) {
      return sendSuccess(reply, request, 200, { accepted: true, ignored: true });
    }

    const commandResult = await handleTelegramCommand(
      {
        text,
        actorId: env.DEFAULT_USER_ID,
        chatId: 'telegram'
      },
      {
        findProposalById: async (proposalId: string) => {
          const proposal = await store.findUpgradeProposalById(proposalId);
          if (!proposal) {
            return null;
          }
          return {
            id: proposal.id,
            status: proposal.status
          };
        },
        createRun: async (payload: { proposalId: string; startCommand: '작업 시작' }) => {
          const run = await store.createUpgradeRun(payload);
          return {
            id: run.id,
            proposalId: run.proposalId,
            status: run.status
          };
        }
      }
    );

    return sendSuccess(reply, request, 200, commandResult);
  });
}

type UpgradeStatus =
  | 'proposed'
  | 'approved'
  | 'planning'
  | 'running'
  | 'verifying'
  | 'deployed'
  | 'failed'
  | 'rolled_back'
  | 'rejected';
