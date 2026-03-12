import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { buildRadarDigestMessage, buildTelegramApprovalActionPayload } from '../integrations/telegram/reporter';
import { sendError, sendSuccess } from '../lib/http';
import { listRadarDomainPacks } from '../radar/domain-packs';
import { executeRadarEvaluationAndPromotion } from '../radar/evaluation-service';
import { listDefaultRadarFeedSources } from '../radar/feed-sources';
import { appendOpsPolicyItems, normalizeRadarItems } from '../radar/ingest';
import type { RawRadarSourceItem } from '../radar/ingest';
import { buildOpsUpgradeProposals } from '../radar/ops-policy';
import { getRadarScannerWorkerStatus } from '../radar/scanner-worker';
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
        observed_at: z.string().datetime().optional(),
        confidence_score: z.number().min(0).max(1).optional(),
        source_type: z
          .enum(['news', 'filing', 'policy', 'market_tick', 'freight', 'inventory', 'blog', 'forum', 'social', 'manual'])
          .optional(),
        source_tier: z.enum(['tier_0', 'tier_1', 'tier_2', 'tier_3']).optional(),
        raw_metrics: z.record(z.string(), z.unknown()).optional(),
        entity_hints: z.array(z.string().min(1)).optional(),
        trust_hint: z.string().min(1).optional()
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

const RadarEventQuerySchema = z.object({
  decision: z.enum(['ignore', 'watch', 'dossier', 'action', 'execute_auto_candidate']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const RadarSourceQuerySchema = z.object({
  enabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

const RadarSourceToggleSchema = z.object({
  enabled: z.boolean()
});

const RadarRunsQuerySchema = z.object({
  source_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const RadarFeedbackSchema = z.object({
  note: z.string().max(2000).optional()
});

const RadarOverrideSchema = z.object({
  decision: z.enum(['ignore', 'watch', 'dossier', 'action', 'execute_auto_candidate']),
  note: z.string().max(2000).optional()
});

const RadarControlUpdateSchema = z.object({
  global_kill_switch: z.boolean().optional(),
  auto_execution_enabled: z.boolean().optional(),
  dossier_promotion_enabled: z.boolean().optional(),
  tier3_escalation_enabled: z.boolean().optional(),
  disabled_domain_ids: z
    .array(
      z.enum([
        'geopolitics_energy_lng',
        'macro_rates_inflation_fx',
        'shipping_supply_chain',
        'policy_regulation_platform_ai',
        'company_earnings_guidance',
        'commodities_raw_materials'
      ])
    )
    .optional(),
  disabled_source_tiers: z.array(z.enum(['tier_0', 'tier_1', 'tier_2', 'tier_3'])).optional()
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
  const { store, env, ensureMinRole, notificationService, resolveRequestUserId } = ctx;
  const ensureRadarSources = () => store.upsertRadarFeedSources({ sources: listDefaultRadarFeedSources() });

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

    const defaults: RawRadarSourceItem[] = [
      {
        title: 'OpenAI platform updates',
        summary: 'Track Responses API, eval, and platform release notes',
        sourceUrl: 'https://platform.openai.com/docs/changelog',
        publishedAt: new Date().toISOString(),
        confidenceScore: 0.95
      },
      {
        title: 'MCP spec updates',
        summary: 'Track MCP transport and security changes',
        sourceUrl: 'https://modelcontextprotocol.io/specification',
        publishedAt: new Date().toISOString(),
        confidenceScore: 0.9
      }
    ];

    const ingestSourceItems: RawRadarSourceItem[] = requestedItems
      ? requestedItems.map((item) => ({
          title: item.title,
          summary: item.summary,
          sourceUrl: item.source_url,
          publishedAt: item.published_at,
          observedAt: item.observed_at,
          confidenceScore: item.confidence_score,
          sourceType: item.source_type,
          sourceTier: item.source_tier,
          rawMetrics: item.raw_metrics,
          entityHints: item.entity_hints,
          trustHint: item.trust_hint
        }))
      : defaults;

    const normalized = normalizeRadarItems(parsed.data.source_name, ingestSourceItems);

    const withOps =
      requestedItems && requestedItems.length > 0
        ? normalized
        : appendOpsPolicyItems(
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
      observedAt: item.observedAt,
      confidenceScore: item.confidenceScore,
      status: 'new' as const,
      sourceType: item.sourceType,
      sourceTier: item.sourceTier,
      rawMetrics: item.rawMetrics,
      entityHints: item.entityHints,
      trustHint: item.trustHint,
      payload: item.payload
    }));

    const storedItems = await store.ingestRadarItems(ingestItems);
    const count = storedItems.length;
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
    const roleError = ensureMinRole(request, reply, 'member');
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

  app.get('/api/v1/radar/events', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'member');
    if (roleError) {
      return roleError;
    }
    const parsed = RadarEventQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid radar event query', parsed.error.flatten());
    }
    const events = await store.listRadarEvents({
      decision: parsed.data.decision,
      limit: parsed.data.limit
    });
    return sendSuccess(reply, request, 200, { events });
  });

  app.get('/api/v1/radar/events/:eventId', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'member');
    if (roleError) {
      return roleError;
    }
    const { eventId } = request.params as { eventId: string };
    const event = await store.getRadarEventById(eventId);
    if (!event) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'radar event not found');
    }
    const [domainPosteriors, autonomyDecision, feedback] = await Promise.all([
      store.listRadarDomainPosteriors(eventId),
      store.getRadarAutonomyDecision(eventId),
      store.listRadarOperatorFeedback({ eventId, limit: 20 })
    ]);
    return sendSuccess(reply, request, 200, {
      event,
      domain_posteriors: domainPosteriors,
      autonomy_decision: autonomyDecision,
      feedback
    });
  });

  app.get('/api/v1/radar/domain-packs', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'member');
    if (roleError) {
      return roleError;
    }
    return sendSuccess(reply, request, 200, { domain_packs: listRadarDomainPacks() });
  });

  app.get('/api/v1/radar/sources', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'member');
    if (roleError) {
      return roleError;
    }
    const parsed = RadarSourceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid radar source query', parsed.error.flatten());
    }
    await ensureRadarSources();
    const sources = await store.listRadarFeedSources({
      enabled: parsed.data.enabled,
      limit: parsed.data.limit,
    });
    return sendSuccess(reply, request, 200, { sources });
  });

  app.post('/api/v1/radar/sources/:sourceId/toggle', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }
    const parsed = RadarSourceToggleSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid radar source toggle payload', parsed.error.flatten());
    }
    const { sourceId } = request.params as { sourceId: string };
    const userId = resolveRequestUserId(request);
    const source = await store.toggleRadarFeedSource({
      sourceId,
      enabled: parsed.data.enabled,
      userId,
    });
    if (!source) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'radar source not found');
    }
    return sendSuccess(reply, request, 200, { source });
  });

  app.get('/api/v1/radar/runs', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }
    const parsed = RadarRunsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid radar runs query', parsed.error.flatten());
    }
    const runs = await store.listRadarIngestRuns({
      sourceId: parsed.data.source_id,
      limit: parsed.data.limit,
    });
    return sendSuccess(reply, request, 200, { runs });
  });

  app.get('/api/v1/radar/control', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }
    await ensureRadarSources();
    const [control, domainPackMetrics, sources] = await Promise.all([
      store.getRadarControlSettings(),
      store.listRadarDomainPackMetrics(),
      store.listRadarFeedSources({ limit: 200 })
    ]);
    return sendSuccess(reply, request, 200, {
      control,
      domain_pack_metrics: domainPackMetrics,
      sources,
      scanner_worker: getRadarScannerWorkerStatus(),
    });
  });

  app.post('/api/v1/radar/control', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }
    const parsed = RadarControlUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid radar control payload', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const control = await store.updateRadarControlSettings({
      userId,
      globalKillSwitch: parsed.data.global_kill_switch,
      autoExecutionEnabled: parsed.data.auto_execution_enabled,
      dossierPromotionEnabled: parsed.data.dossier_promotion_enabled,
      tier3EscalationEnabled: parsed.data.tier3_escalation_enabled,
      disabledDomainIds: parsed.data.disabled_domain_ids,
      disabledSourceTiers: parsed.data.disabled_source_tiers,
    });
    return sendSuccess(reply, request, 200, { control });
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

    const userId = resolveRequestUserId(request);
    const result = await executeRadarEvaluationAndPromotion({
      store,
      userId,
      itemIds: parsed.data.item_ids,
      notificationService,
    });

    return sendSuccess(reply, request, 202, {
      evaluation_job_id: `eval_${Date.now()}`,
      status: 'queued',
      recommendation_count: result.recommendations.length,
      promoted_count: result.promotions.length,
      promotions: result.promotions.map((promotion) => ({
        event_id: promotion.eventId,
        decision: promotion.decision,
        watcher_id: promotion.watcherId,
        briefing_id: promotion.briefingId,
        dossier_id: promotion.dossierId,
        session_id: promotion.sessionId,
        action_proposal_id: promotion.actionProposalId,
        auto_executed: promotion.autoExecuted,
      }))
    });
  });

  app.get('/api/v1/radar/recommendations', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'member');
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

  app.post('/api/v1/radar/events/:eventId/ack', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'member');
    if (roleError) {
      return roleError;
    }
    const parsed = RadarFeedbackSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid radar ack payload', parsed.error.flatten());
    }
    const { eventId } = request.params as { eventId: string };
    const userId = resolveRequestUserId(request);
    const feedback = await store.createRadarOperatorFeedback({
      eventId,
      userId,
      kind: 'ack',
      note: parsed.data.note ?? null
    });
    const event = await store.getRadarEventById(eventId);
    return sendSuccess(reply, request, 200, { event, feedback });
  });

  app.post('/api/v1/radar/events/:eventId/override', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'operator');
    if (roleError) {
      return roleError;
    }
    const parsed = RadarOverrideSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid radar override payload', parsed.error.flatten());
    }
    const { eventId } = request.params as { eventId: string };
    const userId = resolveRequestUserId(request);
    const feedback = await store.createRadarOperatorFeedback({
      eventId,
      userId,
      kind: 'override',
      note: parsed.data.note ?? null,
      overrideDecision: parsed.data.decision
    });
    const event = await store.getRadarEventById(eventId);
    return sendSuccess(reply, request, 200, { event, feedback });
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
