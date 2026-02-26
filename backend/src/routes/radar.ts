import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { buildRadarDigestMessage, buildTelegramApprovalActionPayload } from '../integrations/telegram/reporter';
import { sendError, sendSuccess } from '../lib/http';
import { appendOpsPolicyItems, normalizeRadarItems } from '../radar/ingest';
import { buildOpsUpgradeProposals } from '../radar/ops-policy';
import type { RouteContext } from './types';
import {
  applySseCorsHeaders,
  buildTelegramReportSignature,
  buildTelegramReportsSignature,
  summarizeTelegramReports
} from './types';

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

const TelegramReportListQuerySchema = z.object({
  status: z.enum(['queued', 'sent', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(30)
});

const TelegramReportRetrySchema = z
  .object({
    max_attempts: z.coerce.number().int().min(1).max(20).optional()
  })
  .optional();

export async function radarRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, env, ensureMinRole, notificationService } = ctx;

  app.post('/api/v1/radar/ingest', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

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
    if (count > 0) {
      notificationService?.emitRadarNewItem(count);
    }

    return sendSuccess(reply, request, 202, {
      ingest_job_id: `ingest_${Date.now()}`,
      status: 'queued',
      accepted_count: count
    });
  });

  app.get('/api/v1/radar/items', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

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
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

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
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

    const parsed = RadarRecommendationQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const recommendations = await store.listRadarRecommendations(parsed.data.decision);
    return sendSuccess(reply, request, 200, { recommendations });
  });

  app.post('/api/v1/radar/reports/telegram', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

    const parsed = TelegramReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid telegram payload', parsed.error.flatten());
    }

    const recommendations = await store.listRadarRecommendations();
    const proposals = await store.listUpgradeProposals('proposed');
    const approvalActionPayloads = env.TELEGRAM_WEBHOOK_SECRET
      ? proposals.slice(0, 3).map((proposal) =>
          buildTelegramApprovalActionPayload({
            proposalId: proposal.id,
            secret: env.TELEGRAM_WEBHOOK_SECRET as string
          })
        )
      : [];
    const recommendationLines = recommendations
      .slice(0, 5)
      .map(
        (item) =>
          `[${item.decision.toUpperCase()}] ${item.itemId} score=${item.totalScore.toFixed(2)} benefit=${item.expectedBenefit} risk=${item.riskLevel}`
      );
    const proposalLines =
      proposals.length === 0
        ? ['No proposal awaiting approval']
        : proposals.slice(0, 3).map((proposal, index) => `Approval ${index + 1}: ${proposal.id.slice(0, 8)} ${proposal.proposalTitle}`);
    const digestPayload = {
      title: 'JARVIS Radar Digest',
      generatedAt: new Date().toISOString(),
      lines: [...recommendationLines, ...proposalLines].slice(0, 10)
    };
    const digestBodyMarkdown = buildRadarDigestMessage(digestPayload);

    const report = await store.createTelegramReport({
      chatId: parsed.data.chat_id,
      topic: 'radar-digest',
      bodyMarkdown: digestBodyMarkdown,
      maxAttempts: env.TELEGRAM_REPORT_MAX_ATTEMPTS
    });

    return sendSuccess(reply, request, 202, report, {
      approval_action_payloads: approvalActionPayloads,
      telegram_delivery: {
        attempted: false,
        delivered: false,
        reason: env.TELEGRAM_BOT_TOKEN ? 'queued_for_worker' : 'missing_bot_token'
      }
    });
  });

  app.get('/api/v1/radar/reports/telegram', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

    const parsed = TelegramReportListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const reports = await store.listTelegramReports({
      status: parsed.data.status,
      limit: parsed.data.limit
    });
    return sendSuccess(reply, request, 200, { reports });
  });

  app.get('/api/v1/radar/reports/telegram/:reportId', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

    const reportId = (request.params as { reportId: string }).reportId;
    const report = await store.getTelegramReportById(reportId);
    if (!report) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'telegram report not found');
    }

    return sendSuccess(reply, request, 200, report);
  });

  app.post('/api/v1/radar/reports/telegram/:reportId/retry', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

    const reportId = (request.params as { reportId: string }).reportId;
    const parsed = TelegramReportRetrySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid retry payload', parsed.error.flatten());
    }

    const current = await store.getTelegramReportById(reportId);
    if (!current) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'telegram report not found');
    }

    if (current.status === 'sent') {
      return sendError(reply, request, 409, 'CONFLICT', 'sent report cannot be retried');
    }

    const resetMaxAttempts = Math.max(
      1,
      parsed.data?.max_attempts ?? current.maxAttempts,
      env.TELEGRAM_REPORT_MAX_ATTEMPTS
    );
    const updated = await store.updateTelegramReportDelivery({
      reportId,
      status: 'queued',
      attemptCount: 0,
      maxAttempts: resetMaxAttempts,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      telegramMessageId: null,
      sentAt: null
    });
    if (!updated) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'telegram report not found');
    }

    return sendSuccess(reply, request, 202, updated, { retried: true });
  });

  app.get('/api/v1/radar/reports/telegram/events', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

    const parsed = TelegramReportListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    applySseCorsHeaders(request, reply, env);

    reply.raw.write('event: stream.open\n');
    reply.raw.write(`data: ${JSON.stringify({ request_id: request.id })}\n\n`);

    let closed = false;
    let lastSignature: string | null = null;

    const emitSnapshot = (reports: Awaited<ReturnType<typeof store.listTelegramReports>>) => {
      reply.raw.write('event: telegram.reports.updated\n');
      reply.raw.write(
        `data: ${JSON.stringify({
          timestamp: new Date().toISOString(),
          data: {
            reports,
            summary: summarizeTelegramReports(reports)
          }
        })}\n\n`
      );
    };

    const closeStream = () => {
      if (closed) {
        return;
      }
      closed = true;
      reply.raw.write('event: stream.close\n');
      reply.raw.write(`data: ${JSON.stringify({ request_id: request.id })}\n\n`);
      reply.raw.end();
    };

    const poll = async () => {
      if (closed) {
        return;
      }

      const reports = await store.listTelegramReports({
        status: parsed.data.status,
        limit: parsed.data.limit
      });
      const signature = buildTelegramReportsSignature(reports);
      if (signature !== lastSignature) {
        emitSnapshot(reports);
        lastSignature = signature;
      }

      const hasQueued = reports.some((report) => report.status === 'queued');
      if (!hasQueued) {
        closeStream();
      }
    };

    reply.raw.on('close', () => {
      closed = true;
    });

    await poll();
    if (closed) {
      return;
    }

    const interval = setInterval(() => {
      void poll();
    }, 1000);

    const timeout = setTimeout(() => {
      closeStream();
    }, 45000);

    reply.raw.on('close', () => {
      clearInterval(interval);
      clearTimeout(timeout);
    });
  });

  app.get('/api/v1/radar/reports/telegram/:reportId/events', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }

    const reportId = (request.params as { reportId: string }).reportId;
    const initial = await store.getTelegramReportById(reportId);
    if (!initial) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'telegram report not found');
    }

    applySseCorsHeaders(request, reply, env);

    reply.raw.write('event: stream.open\n');
    reply.raw.write(`data: ${JSON.stringify({ request_id: request.id, report_id: reportId })}\n\n`);

    let closed = false;
    let lastSignature: string | null = null;

    const emitReport = (
      report: NonNullable<Awaited<ReturnType<typeof store.getTelegramReportById>>>
    ) => {
      reply.raw.write('event: telegram.report.updated\n');
      reply.raw.write(
        `data: ${JSON.stringify({
          report_id: reportId,
          timestamp: new Date().toISOString(),
          data: report
        })}\n\n`
      );
    };

    const closeStream = () => {
      if (closed) {
        return;
      }
      closed = true;
      reply.raw.write('event: stream.close\n');
      reply.raw.write(`data: ${JSON.stringify({ report_id: reportId })}\n\n`);
      reply.raw.end();
    };

    const poll = async () => {
      if (closed) {
        return;
      }

      const current = await store.getTelegramReportById(reportId);
      if (!current) {
        closeStream();
        return;
      }

      const signature = buildTelegramReportSignature(current);
      if (signature !== lastSignature) {
        emitReport(current);
        lastSignature = signature;
      }

      if (current.status === 'sent' || current.status === 'failed') {
        closeStream();
      }
    };

    reply.raw.on('close', () => {
      closed = true;
    });

    await poll();
    if (closed) {
      return;
    }

    const interval = setInterval(() => {
      void poll();
    }, 1000);

    const timeout = setTimeout(() => {
      closeStream();
    }, 45000);

    reply.raw.on('close', () => {
      clearInterval(interval);
      clearTimeout(timeout);
    });
  });
}
