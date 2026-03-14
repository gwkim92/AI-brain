import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { sendError, sendSuccess } from '../lib/http';
import { getIntelligenceCatalogSyncWorkerStatus } from '../intelligence/catalog-sync-worker';
import { ensureDefaultIntelligenceAliasBindings } from '../intelligence/runtime';
import { getIntelligenceScannerWorkerStatus } from '../intelligence/scanner-worker';
import { getIntelligenceSemanticWorkerStatus } from '../intelligence/semantic-worker';
import { getIntelligenceStaleMaintenanceWorkerStatus } from '../intelligence/stale-maintenance-worker';
import {
  buildIntelligenceGraphNeighborhoods,
  buildIntelligenceHotspotClusters,
  computeIntelligenceTemporalNarrativeProfile,
  computeIntelligenceEventQuality,
  computeIntelligenceNarrativeClusterQuality,
  bridgeIntelligenceEventToAction,
  bridgeIntelligenceEventToBrief,
  computeIntelligenceOperatorPriorityScore,
  dispatchIntelligenceCouncilBridge,
  executeIntelligenceCandidate,
  listSuspiciousIntelligenceEvents,
  bulkRebuildIntelligenceEvents,
  rebuildIntelligenceWorkspace,
  rebuildIntelligenceEvent,
} from '../intelligence/service';
import { ensureDefaultIntelligenceSources } from '../intelligence/sources';
import type {
  CapabilityAliasBindingRecord,
  IntelligenceCapabilityAlias,
  IntelligenceEventClusterRecord,
  IntelligenceNarrativeClusterLedgerEntryRecord,
  IntelligenceWorkspaceRole,
} from '../store/types';

import type { RouteContext } from './types';

const WorkspaceScopedQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
});

const WorkspaceCreateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

const SourceCreateSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  name: z.string().min(1).max(180),
  kind: z.enum(['rss', 'atom', 'json', 'api', 'search', 'headless', 'mcp_connector', 'synthetic']),
  url: z.string().url(),
  source_type: z.enum([
    'news',
    'filing',
    'policy',
    'market_tick',
    'freight',
    'inventory',
    'blog',
    'forum',
    'social',
    'search_result',
    'web_page',
    'manual',
  ]),
  source_tier: z.enum(['tier_0', 'tier_1', 'tier_2', 'tier_3']),
  poll_minutes: z.coerce.number().int().min(1).max(1440).default(60),
  parser_config_json: z.record(z.string(), z.unknown()).optional(),
  crawl_config_json: z.record(z.string(), z.unknown()).optional(),
  crawl_policy: z.object({
    allow_domains: z.array(z.string().min(1)).max(64).optional(),
    deny_domains: z.array(z.string().min(1)).max(64).optional(),
    respect_robots: z.boolean().optional(),
    max_depth: z.coerce.number().int().min(0).max(5).optional(),
    max_pages_per_run: z.coerce.number().int().min(1).max(100).optional(),
    revisit_cooldown_minutes: z.coerce.number().int().min(1).max(10_080).optional(),
    per_domain_rate_limit_per_minute: z.coerce.number().int().min(1).max(120).optional(),
  }).optional(),
  connector_capability: z.object({
    connector_id: z.string().min(1).max(200),
    write_allowed: z.boolean(),
    destructive: z.boolean(),
    requires_human: z.boolean(),
    schema_id: z.string().min(1).max(200).nullable().optional(),
    allowed_actions: z.array(z.string().min(1)).max(32).default([]),
  }).nullable().optional(),
  entity_hints: z.array(z.string().min(1)).max(32).optional(),
  metric_hints: z.array(z.string().min(1)).max(32).optional(),
});

const SourceToggleSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  enabled: z.boolean(),
});

const RunsQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  source_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const EventsQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  domain_id: z.enum([
    'geopolitics_energy_lng',
    'macro_rates_inflation_fx',
    'shipping_supply_chain',
    'policy_regulation_platform_ai',
    'company_earnings_guidance',
    'commodities_raw_materials',
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const NarrativeClustersQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const DeliberateSchema = z.object({
  workspace_id: z.string().uuid().optional(),
});

const ExecuteSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  candidate_id: z.string().uuid(),
});

const FetchFailuresQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  source_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const StaleEventsQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

const StaleEventsBulkRebuildSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  event_ids: z.array(z.string().uuid()).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const WorkspaceRebuildSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  mode: z.literal('hard_reset').default('hard_reset'),
});

const ReviewStateSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  review_state: z.enum(['watch', 'review', 'ignore']),
  review_reason: z.string().min(1).max(500).nullable().optional(),
  review_owner: z.string().uuid().nullable().optional(),
  review_resolved_at: z.string().datetime().nullable().optional(),
});

const OperatorNoteSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  scope: z.enum(['event', 'hypothesis', 'linked_claim', 'narrative_cluster']).default('event'),
  scope_id: z.string().min(1).max(200).nullable().optional(),
  note: z.string().min(1).max(2000),
});

const AliasListQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  alias: z.enum([
    'fast_triage',
    'structured_extraction',
    'cross_doc_linking',
    'skeptical_critique',
    'deep_synthesis',
    'policy_judgment',
    'deep_research',
    'execution_planning',
  ]).optional(),
});

const AliasBindingUpdateSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  scope: z.enum(['workspace', 'global']).default('workspace'),
  bindings: z.array(
    z.object({
      provider: z.enum(['openai', 'gemini', 'anthropic', 'local']),
      model_id: z.string().min(1).max(200),
      weight: z.number().min(0).max(10).default(1),
      fallback_rank: z.coerce.number().int().min(1).max(10).default(1),
      canary_percent: z.coerce.number().int().min(0).max(100).default(0),
      is_active: z.boolean().default(true),
      requires_structured_output: z.boolean().default(false),
      requires_tool_use: z.boolean().default(false),
      requires_long_context: z.boolean().default(false),
      max_cost_class: z.enum(['free', 'low', 'standard', 'premium']).nullable().optional(),
    })
  ).min(1).max(12),
});

const BridgeSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  event_id: z.string().uuid(),
});

async function resolveWorkspaceAccess(
  ctx: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    workspaceId?: string;
    requiredRole?: IntelligenceWorkspaceRole;
  }
): Promise<{ workspaceId: string; userId: string; workspaces: Awaited<ReturnType<RouteContext['store']['listIntelligenceWorkspaces']>> } | null> {
  const scope = await resolveIntelligenceWorkspaceScope(ctx, request);
  const workspaces = scope.workspaces;
  const workspace = input.workspaceId
    ? workspaces.find((row) => row.id === input.workspaceId) ?? null
    : workspaces[0] ?? await ctx.store.getOrCreateIntelligenceWorkspace({ userId: scope.defaultWorkspaceUserId });
  if (!workspace) {
    sendError(reply, request, 404, 'NOT_FOUND', 'intelligence workspace not found');
    return null;
  }
  let membership: Awaited<ReturnType<RouteContext['store']['getIntelligenceWorkspaceMembership']>> = null;
  for (const candidateUserId of scope.accessibleUserIds) {
    membership = await ctx.store.getIntelligenceWorkspaceMembership({
      workspaceId: workspace.id,
      userId: candidateUserId,
    });
    if (membership) break;
  }
  if (!membership) {
    sendError(reply, request, 403, 'FORBIDDEN', 'workspace membership required');
    return null;
  }
  if ((input.requiredRole ?? 'member') === 'admin' && membership.role !== 'admin' && membership.role !== 'owner') {
    sendError(reply, request, 403, 'FORBIDDEN', 'workspace admin role required');
    return null;
  }
  return {
    workspaceId: workspace.id,
    userId: scope.actorUserId,
    workspaces,
  };
}

async function resolveIntelligenceWorkspaceScope(
  ctx: RouteContext,
  request: FastifyRequest,
): Promise<{
  actorUserId: string;
  accessibleUserIds: string[];
  defaultWorkspaceUserId: string;
  workspaces: Awaited<ReturnType<RouteContext['store']['listIntelligenceWorkspaces']>>;
}> {
  const actorUserId = ctx.resolveRequestUserId(request);
  const accessibleUserIds = [actorUserId];
  const auth = ctx.getRequestAuthContext(request);
  let bootstrapAdminSession = false;
  if (auth?.authType === 'session' && actorUserId !== ctx.env.DEFAULT_USER_ID) {
    const user = await ctx.store.getAuthUserById(actorUserId);
    const bootstrapEmail = ctx.env.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase();
    if (user?.email.trim().toLowerCase() === bootstrapEmail) {
      bootstrapAdminSession = true;
      accessibleUserIds.unshift(ctx.env.DEFAULT_USER_ID);
    }
  }

  const workspaces: Awaited<ReturnType<RouteContext['store']['listIntelligenceWorkspaces']>> = [];
  const seen = new Set<string>();
  const legacyWorkspaceNames = new Set<string>();
  for (const userId of accessibleUserIds) {
    const rows = await ctx.store.listIntelligenceWorkspaces({ userId });
    for (const workspace of rows) {
      if (
        bootstrapAdminSession &&
        workspace.ownerUserId === actorUserId &&
        legacyWorkspaceNames.has(workspace.name.trim().toLowerCase())
      ) {
        continue;
      }
      if (seen.has(workspace.id)) continue;
      seen.add(workspace.id);
      workspaces.push(workspace);
      if (workspace.ownerUserId === ctx.env.DEFAULT_USER_ID) {
        legacyWorkspaceNames.add(workspace.name.trim().toLowerCase());
      }
    }
  }

  return {
    actorUserId,
    accessibleUserIds,
    defaultWorkspaceUserId: accessibleUserIds[0] ?? actorUserId,
    workspaces,
  };
}

async function loadEventOr404(
  ctx: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
  eventId: string,
) {
  const event = await ctx.store.getIntelligenceEventById({ workspaceId, eventId });
  if (!event) {
    sendError(reply, request, 404, 'NOT_FOUND', 'intelligence event not found');
    return null;
  }
  return event;
}

async function loadNarrativeClusterOr404(
  ctx: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
  clusterId: string,
) {
  const cluster = await ctx.store.getIntelligenceNarrativeClusterById({
    workspaceId,
    clusterId,
  });
  if (!cluster) {
    sendError(reply, request, 404, 'NOT_FOUND', 'intelligence narrative cluster not found');
    return null;
  }
  return cluster;
}

function buildClusterCollisionKey(input: {
  title: string;
  eventFamily: string;
  topDomainId: string | null;
}): string {
  return [
    input.eventFamily,
    input.topDomainId ?? 'unknown',
    input.title.trim().toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim(),
  ].join('::');
}

async function buildEventQualityMap(
  ctx: RouteContext,
  workspaceId: string,
  events: Awaited<ReturnType<RouteContext['store']['listIntelligenceEvents']>>,
) {
  const documentIds = [...new Set(events.flatMap((event) => event.documentIds))];
  const documents = documentIds.length
    ? await ctx.store.listIntelligenceRawDocumentsByIds({
        workspaceId,
        documentIds,
      })
    : [];
  const documentsById = new Map(documents.map((document) => [document.id, document] as const));
  const qualityEntries = await Promise.all(
    events.map(async (event) => {
      const eventDocuments = event.documentIds
        .map((documentId) => documentsById.get(documentId) ?? null)
        .filter((row): row is NonNullable<typeof row> => row !== null);
      const linkedClaims = await ctx.store.listIntelligenceLinkedClaims({
        workspaceId,
        eventId: event.id,
        limit: 120,
      });
      return [
        event.id,
        computeIntelligenceEventQuality({
          event,
          documents: eventDocuments,
          linkedClaims,
        }),
      ] as const;
    }),
  );
  return new Map(qualityEntries);
}

function buildClusterQualityMap(input: {
  clusters: Awaited<ReturnType<RouteContext['store']['listIntelligenceNarrativeClusters']>>;
  events: Awaited<ReturnType<RouteContext['store']['listIntelligenceEvents']>>;
  memberships: Awaited<ReturnType<RouteContext['store']['listIntelligenceNarrativeClusterMemberships']>>;
}) {
  const eventsById = new Map(input.events.map((event) => [event.id, event] as const));
  const duplicateTitleCounts = new Map<string, number>();
  for (const cluster of input.clusters) {
    const key = buildClusterCollisionKey(cluster);
    duplicateTitleCounts.set(key, (duplicateTitleCounts.get(key) ?? 0) + 1);
  }
  return new Map(
    input.clusters.map((cluster) => {
      const memberEvents = input.memberships
        .filter((membership) => membership.clusterId === cluster.id)
        .map((membership) => eventsById.get(membership.eventId) ?? null)
        .filter((row): row is NonNullable<typeof row> => row !== null);
      return [
        cluster.id,
        computeIntelligenceNarrativeClusterQuality({
          cluster,
          memberEvents,
          duplicateTitleCount: duplicateTitleCounts.get(buildClusterCollisionKey(cluster)) ?? 0,
        }),
      ] as const;
    }),
  );
}

function filterCanonicalEvents<T extends Pick<IntelligenceEventClusterRecord, 'lifecycleState'>>(events: T[]): T[] {
  return events.filter((event) => event.lifecycleState === 'canonical');
}

function formatQuarantineReason(reason: string): string {
  switch (reason) {
    case 'used_fallback':
      return '모델 추출이 fallback에 의존해서 canonical 승격을 막았다.';
    case 'generic_claims_only':
      return '비-generic claim이 없어 사건 해석이 너무 약하다.';
    case 'low_top_domain_score':
      return '상위 domain 점수가 낮아 사건 분류 확신이 부족하다.';
    case 'weak_top_domain_margin':
      return 'domain 간 점수 차가 좁아 분류가 모호하다.';
    case 'hint_only_entities':
      return '엔티티가 본문보다 힌트에 과하게 의존한다.';
    case 'title_drift':
      return '추출 제목이 원문 제목과 너무 멀다.';
    case 'restricted_source_requires_corroboration':
      return 'forum/search/social 신호라 corroboration 전까지 provisional로 유지한다.';
    case 'awaiting_corroboration_for_promotion':
      return '보강 신호가 더 필요해 아직 canonical로 승격하지 않았다.';
    case 'exact_canonical_url_match':
      return '기존 canonical 문서와 exact URL이 일치해 기존 사건에 붙였다.';
    default:
      return reason.replaceAll('_', ' ');
  }
}

function summarizeAliasBindingRollout(input: {
  scope: 'workspace' | 'global';
  before: CapabilityAliasBindingRecord[];
  after: CapabilityAliasBindingRecord[];
}) {
  const beforeRows = [...input.before].sort((left, right) => left.fallbackRank - right.fallbackRank);
  const afterRows = [...input.after].sort((left, right) => left.fallbackRank - right.fallbackRank);
  const maxLength = Math.max(beforeRows.length, afterRows.length);
  let added = 0;
  let removed = 0;
  let changed = 0;
  const detailRows: string[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const beforeRow = beforeRows[index] ?? null;
    const afterRow = afterRows[index] ?? null;
    if (!beforeRow && afterRow) {
      added += 1;
      if (detailRows.length < 3) {
        detailRows.push(`+ ${afterRow.provider}/${afterRow.modelId}`);
      }
      continue;
    }
    if (beforeRow && !afterRow) {
      removed += 1;
      if (detailRows.length < 3) {
        detailRows.push(`- ${beforeRow.provider}/${beforeRow.modelId}`);
      }
      continue;
    }
    if (!beforeRow || !afterRow) {
      continue;
    }
    const changedFields: string[] = [];
    if (beforeRow.provider !== afterRow.provider) changedFields.push('provider');
    if (beforeRow.modelId !== afterRow.modelId) changedFields.push('model');
    if (beforeRow.weight !== afterRow.weight) changedFields.push('weight');
    if (beforeRow.fallbackRank !== afterRow.fallbackRank) changedFields.push('rank');
    if (beforeRow.canaryPercent !== afterRow.canaryPercent) changedFields.push('canary');
    if (beforeRow.isActive !== afterRow.isActive) changedFields.push('active');
    if (beforeRow.requiresStructuredOutput !== afterRow.requiresStructuredOutput) changedFields.push('structured');
    if (beforeRow.requiresToolUse !== afterRow.requiresToolUse) changedFields.push('tool');
    if (beforeRow.requiresLongContext !== afterRow.requiresLongContext) changedFields.push('context');
    if (beforeRow.maxCostClass !== afterRow.maxCostClass) changedFields.push('cost');
    if (changedFields.length === 0) {
      continue;
    }
    changed += 1;
    if (detailRows.length < 3) {
      detailRows.push(`~ ${afterRow.provider}/${afterRow.modelId} (${changedFields.join(', ')})`);
    }
  }

  const suffix = detailRows.length > 0 ? ` · ${detailRows.join(' ; ')}` : '';
  return `${input.scope} runtime binding update (+${added}/-${removed}/~${changed})${suffix}`;
}

function toNarrativeClusterLastTransition(
  entry: IntelligenceNarrativeClusterLedgerEntryRecord | null,
  cluster?: {
    state: string;
    updatedAt: string;
    lastLedgerAt: string | null;
  } | null,
) {
  if (!entry) {
    if (!cluster) {
      return null;
    }
    return {
      entry_type: 'snapshot',
      summary: `${cluster.state} cluster snapshot`,
      score_delta: 0,
      created_at: cluster.lastLedgerAt ?? cluster.updatedAt,
    };
  }
  return {
    entry_type: entry.entryType,
    summary: entry.summary,
    score_delta: entry.scoreDelta,
    created_at: entry.createdAt,
  };
}

export async function intelligenceRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  app.get('/api/v1/intelligence/workspaces', async (request, reply) => {
    const scope = await resolveIntelligenceWorkspaceScope(ctx, request);
    const workspaces = scope.workspaces;
    if (workspaces.length === 0) {
      const workspace = await ctx.store.getOrCreateIntelligenceWorkspace({ userId: scope.defaultWorkspaceUserId });
      return sendSuccess(reply, request, 200, { workspaces: [workspace] });
    }
    return sendSuccess(reply, request, 200, { workspaces });
  });

  app.post('/api/v1/intelligence/workspaces', async (request, reply) => {
    const parsed = WorkspaceCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence workspace payload', parsed.error.flatten());
    }
    const userId = ctx.resolveRequestUserId(request);
    const workspace = await ctx.store.createIntelligenceWorkspace({
      userId,
      name: parsed.data.name?.trim() || 'My Intelligence',
    });
    await ensureDefaultIntelligenceSources({
      store: ctx.store,
      workspaceId: workspace.id,
    });
    return sendSuccess(reply, request, 201, { workspace });
  });

  app.get('/api/v1/intelligence/sources', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence source query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    await ensureDefaultIntelligenceSources({
      store: ctx.store,
      workspaceId: access.workspaceId,
    });
    const [sources, workspaces] = await Promise.all([
      ctx.store.listIntelligenceSources({ workspaceId: access.workspaceId, limit: 200 }),
      Promise.resolve(access.workspaces),
    ]);
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      workspaces,
      sources,
      scanner_worker: getIntelligenceScannerWorkerStatus(),
      semantic_worker: getIntelligenceSemanticWorkerStatus(),
      stale_maintenance_worker: getIntelligenceStaleMaintenanceWorkerStatus(),
    });
  });

  app.post('/api/v1/intelligence/sources', async (request, reply) => {
    const parsed = SourceCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence source payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const source = await ctx.store.createIntelligenceSource({
      workspaceId: access.workspaceId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      url: parsed.data.url,
      sourceType: parsed.data.source_type,
      sourceTier: parsed.data.source_tier,
      pollMinutes: parsed.data.poll_minutes,
      parserConfigJson: parsed.data.parser_config_json,
      crawlConfigJson: parsed.data.crawl_config_json,
      crawlPolicy: parsed.data.crawl_policy
        ? {
            allowDomains: parsed.data.crawl_policy.allow_domains ?? [],
            denyDomains: parsed.data.crawl_policy.deny_domains ?? [],
            respectRobots: parsed.data.crawl_policy.respect_robots ?? true,
            maxDepth: parsed.data.crawl_policy.max_depth ?? 1,
            maxPagesPerRun: parsed.data.crawl_policy.max_pages_per_run ?? 5,
            revisitCooldownMinutes: parsed.data.crawl_policy.revisit_cooldown_minutes ?? 60,
            perDomainRateLimitPerMinute: parsed.data.crawl_policy.per_domain_rate_limit_per_minute ?? 6,
          }
        : undefined,
      connectorCapability: parsed.data.connector_capability
        ? {
            connectorId: parsed.data.connector_capability.connector_id,
            writeAllowed: parsed.data.connector_capability.write_allowed,
            destructive: parsed.data.connector_capability.destructive,
            requiresHuman: parsed.data.connector_capability.requires_human,
            schemaId: parsed.data.connector_capability.schema_id ?? null,
            allowedActions: parsed.data.connector_capability.allowed_actions ?? [],
          }
        : null,
      entityHints: parsed.data.entity_hints,
      metricHints: parsed.data.metric_hints,
    });
    return sendSuccess(reply, request, 201, { source });
  });

  app.post('/api/v1/intelligence/sources/:sourceId/toggle', async (request, reply) => {
    const parsed = SourceToggleSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence source toggle payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const allSources = await ctx.store.listAllIntelligenceSources({ limit: 500 });
    const source = allSources.find((row) => row.id === (request.params as { sourceId: string }).sourceId && row.workspaceId === access.workspaceId);
    if (!source) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'intelligence source not found');
    }
    const updated = await ctx.store.toggleIntelligenceSource({
      workspaceId: access.workspaceId,
      sourceId: source.id,
      enabled: parsed.data.enabled,
    });
    return sendSuccess(reply, request, 200, { source: updated });
  });

  app.post('/api/v1/intelligence/sources/:sourceId/retry', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence source retry payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const allSources = await ctx.store.listAllIntelligenceSources({ limit: 500 });
    const source = allSources.find((row) => row.id === (request.params as { sourceId: string }).sourceId && row.workspaceId === access.workspaceId);
    if (!source) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'intelligence source not found');
    }
    await ctx.store.updateIntelligenceSource({
      workspaceId: access.workspaceId,
      sourceId: source.id,
      enabled: true,
      lastFetchedAt: '1970-01-01T00:00:00.000Z',
      lastError: '',
    });
    return sendSuccess(reply, request, 202, {
      workspace_id: access.workspaceId,
      result: {
        workspaceId: access.workspaceId,
        sourceId: source.id,
        queuedAt: new Date().toISOString(),
        sourceEnabled: true,
      },
    });
  });

  app.get('/api/v1/intelligence/fetch-failures', async (request, reply) => {
    const parsed = FetchFailuresQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence fetch failure query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const failures = await ctx.store.listIntelligenceFetchFailures({
      workspaceId: access.workspaceId,
      sourceId: parsed.data.source_id,
      limit: parsed.data.limit,
    });
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      fetch_failures: failures,
    });
  });

  app.get('/api/v1/intelligence/maintenance/stale-events', async (request, reply) => {
    const parsed = StaleEventsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid stale event maintenance query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const events = await listSuspiciousIntelligenceEvents({
      store: ctx.store,
      workspaceId: access.workspaceId,
      limit: parsed.data.limit,
    });
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      stale_events: events,
    });
  });

  app.post('/api/v1/intelligence/maintenance/rebuild-stale-events', async (request, reply) => {
    const parsed = StaleEventsBulkRebuildSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid stale event rebuild payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    try {
      const result = await bulkRebuildIntelligenceEvents({
        store: ctx.store,
        providerRouter: ctx.providerRouter,
        env: ctx.env,
        workspaceId: access.workspaceId,
        userId: access.userId,
        eventIds: parsed.data.event_ids,
        limit: parsed.data.limit,
        notificationService: ctx.notificationService,
      });
      return sendSuccess(reply, request, 202, {
        workspace_id: access.workspaceId,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, request, 422, 'VALIDATION_ERROR', message);
    }
  });

  app.post('/api/v1/intelligence/maintenance/rebuild-workspace', async (request, reply) => {
    const parsed = WorkspaceRebuildSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid workspace rebuild payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    try {
      const executionMode = getIntelligenceSemanticWorkerStatus().enabled ? 'worker' : 'background_loop';
      const result = await rebuildIntelligenceWorkspace({
        store: ctx.store,
        providerRouter: ctx.providerRouter,
        env: ctx.env,
        workspaceId: access.workspaceId,
        userId: access.userId,
        executionMode,
        notificationService: ctx.notificationService,
      });
      return sendSuccess(reply, request, 202, {
        workspace_id: access.workspaceId,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, request, 422, 'VALIDATION_ERROR', message);
    }
  });

  app.get('/api/v1/intelligence/runs', async (request, reply) => {
    const parsed = RunsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence runs query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const [runs, pendingSignals, processingSignals, failedSignals] = await Promise.all([
      ctx.store.listIntelligenceScanRuns({
        workspaceId: access.workspaceId,
        sourceId: parsed.data.source_id,
        limit: parsed.data.limit,
      }),
      ctx.store.listIntelligenceSignals({
        workspaceId: access.workspaceId,
        processingStatus: 'pending',
        limit: 200,
      }),
      ctx.store.listIntelligenceSignals({
        workspaceId: access.workspaceId,
        processingStatus: 'processing',
        limit: 200,
      }),
      ctx.store.listIntelligenceSignals({
        workspaceId: access.workspaceId,
        processingStatus: 'failed',
        limit: 50,
      }),
    ]);
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      runs,
      scanner_worker: getIntelligenceScannerWorkerStatus(),
      semantic_worker: getIntelligenceSemanticWorkerStatus(),
      stale_maintenance_worker: getIntelligenceStaleMaintenanceWorkerStatus(),
      model_sync_worker: getIntelligenceCatalogSyncWorkerStatus(),
      semantic_backlog: {
        pendingCount: pendingSignals.length,
        processingCount: processingSignals.length,
        failedCount: failedSignals.length,
        latestFailedSignalIds: failedSignals.slice(0, 10).map((row) => row.id),
      },
    });
  });

  app.get('/api/v1/intelligence/events', async (request, reply) => {
    const parsed = EventsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence events query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const [events, clusterMemberships, clusters] = await Promise.all([
      ctx.store.listIntelligenceEvents({
        workspaceId: access.workspaceId,
        limit: parsed.data.limit,
        domainId: parsed.data.domain_id,
      }),
      ctx.store.listIntelligenceNarrativeClusterMemberships({
        workspaceId: access.workspaceId,
        limit: 1000,
      }),
      ctx.store.listIntelligenceNarrativeClusters({
        workspaceId: access.workspaceId,
        limit: 200,
      }),
    ]);
    const canonicalEvents = filterCanonicalEvents(events);
    const clusterById = new Map(clusters.map((row) => [row.id, row] as const));
    const canonicalEventIds = new Set(canonicalEvents.map((event) => event.id));
    const clusterMembershipByEventId = new Map(
      clusterMemberships
        .filter((row) => canonicalEventIds.has(row.eventId))
        .map((row) => [row.eventId, row] as const),
    );
    const eventQualityById = await buildEventQualityMap(ctx, access.workspaceId, canonicalEvents);
    const enrichedEvents = canonicalEvents.map((event) => {
      const temporal = computeIntelligenceTemporalNarrativeProfile({
        event,
        candidateEvents: canonicalEvents,
      });
      const clusterMembership = clusterMembershipByEventId.get(event.id) ?? null;
      const cluster = clusterMembership ? clusterById.get(clusterMembership.clusterId) ?? null : null;
      return {
        ...event,
        recurringNarrativeScore: temporal.recurringNarrativeScore,
        relatedHistoricalEventCount: temporal.relatedHistoricalEventCount,
        temporalNarrativeState: temporal.temporalNarrativeState,
        narrativeClusterId: cluster?.id ?? null,
        narrativeClusterState: cluster?.state ?? null,
        quality: eventQualityById.get(event.id),
      };
    });
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      events: enrichedEvents.map((event) => ({
        ...event,
        operatorPriorityScore: computeIntelligenceOperatorPriorityScore(event),
      })),
    });
  });

  app.get('/api/v1/intelligence/events/:eventId', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence event query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const event = await loadEventOr404(ctx, request, reply, access.workspaceId, (request.params as { eventId: string }).eventId);
    if (!event) return reply;
    if (event.lifecycleState !== 'canonical') {
      return sendError(reply, request, 404, 'NOT_FOUND', 'canonical intelligence event not found');
    }
    if (event.lifecycleState !== 'canonical') {
      return sendError(reply, request, 404, 'NOT_FOUND', 'canonical intelligence event not found');
    }
    const [
      events,
      bridges,
      linkedClaims,
      claimLinks,
      executionAudit,
      operatorNotes,
      invalidationEntries,
      expectedSignalEntries,
      outcomeEntries,
      temporalNarrativeLedgerEntries,
      documents,
    ] = await Promise.all([
      ctx.store.listIntelligenceEvents({
        workspaceId: access.workspaceId,
        limit: 200,
      }),
      ctx.store.listIntelligenceBridgeDispatches({
        workspaceId: access.workspaceId,
        eventId: event.id,
        limit: 50,
      }),
      ctx.store.listIntelligenceLinkedClaims({
        workspaceId: access.workspaceId,
        eventId: event.id,
        limit: 100,
      }),
      ctx.store.listIntelligenceClaimLinks({
        workspaceId: access.workspaceId,
        eventId: event.id,
        limit: 200,
      }),
      ctx.store.listIntelligenceExecutionAudits({
        workspaceId: access.workspaceId,
        eventId: event.id,
        limit: 50,
      }),
      ctx.store.listIntelligenceOperatorNotes({
        workspaceId: access.workspaceId,
        eventId: event.id,
        limit: 100,
      }),
      ctx.store.listIntelligenceInvalidationEntries({
        workspaceId: access.workspaceId,
        eventId: event.id,
      }),
      ctx.store.listIntelligenceExpectedSignalEntries({
        workspaceId: access.workspaceId,
        eventId: event.id,
      }),
      ctx.store.listIntelligenceOutcomeEntries({
        workspaceId: access.workspaceId,
        eventId: event.id,
      }),
      ctx.store.listIntelligenceTemporalNarrativeLedgerEntries({
        workspaceId: access.workspaceId,
        eventId: event.id,
      }),
      ctx.store.listIntelligenceRawDocumentsByIds({
        workspaceId: access.workspaceId,
        documentIds: event.documentIds,
      }),
    ]);
    const canonicalEvents = filterCanonicalEvents(events);
    const narrativeClusterMembership = (
      await ctx.store.listIntelligenceNarrativeClusterMemberships({
        workspaceId: access.workspaceId,
        eventId: event.id,
        limit: 1,
      })
    )[0] ?? null;
    const narrativeCluster = narrativeClusterMembership
      ? await ctx.store.getIntelligenceNarrativeClusterById({
          workspaceId: access.workspaceId,
          clusterId: narrativeClusterMembership.clusterId,
        })
      : null;
    const clusterMemberships = narrativeCluster
      ? await ctx.store.listIntelligenceNarrativeClusterMemberships({
          workspaceId: access.workspaceId,
          clusterId: narrativeCluster.id,
          limit: 200,
        })
      : [];
    const narrativeClusterMembers = clusterMemberships
      .map((membership) => {
        const memberEvent = canonicalEvents.find((row) => row.id === membership.eventId);
        if (!memberEvent) return null;
        return {
          membershipId: membership.id,
          eventId: memberEvent.id,
          title: memberEvent.title,
          relation: membership.relation,
          score: membership.score,
          daysDelta: membership.daysDelta,
          isLatest: membership.isLatest,
          temporalNarrativeState: memberEvent.temporalNarrativeState,
          graphSupportScore: memberEvent.graphSupportScore,
          graphContradictionScore: memberEvent.graphContradictionScore,
          graphHotspotCount: memberEvent.graphHotspotCount,
          timeCoherenceScore: memberEvent.timeCoherenceScore,
          lastEventAt: memberEvent.timeWindowEnd ?? memberEvent.updatedAt,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((left, right) => {
        if (left.isLatest !== right.isLatest) return left.isLatest ? -1 : 1;
        return Date.parse(right.lastEventAt ?? '') - Date.parse(left.lastEventAt ?? '');
      });
    const temporal = computeIntelligenceTemporalNarrativeProfile({
      event,
      candidateEvents: canonicalEvents,
    });
    const eventQuality = computeIntelligenceEventQuality({
      event,
      documents,
      linkedClaims,
    });
    const narrativeClusterLastTransition = narrativeCluster
      ? toNarrativeClusterLastTransition(
          (
            await ctx.store.listIntelligenceNarrativeClusterLedgerEntries({
              workspaceId: access.workspaceId,
              clusterId: narrativeCluster.id,
              limit: 1,
            })
          )[0] ?? null,
          narrativeCluster,
        )
      : null;
    const enrichedEvent = {
      ...event,
      recurringNarrativeScore: temporal.recurringNarrativeScore,
      relatedHistoricalEventCount: temporal.relatedHistoricalEventCount,
      temporalNarrativeState: temporal.temporalNarrativeState,
      quality: eventQuality,
    };
    const narrativeClusterQuality = narrativeCluster
      ? computeIntelligenceNarrativeClusterQuality({
          cluster: narrativeCluster,
          memberEvents: clusterMemberships
            .map((membership) => canonicalEvents.find((row) => row.id === membership.eventId) ?? null)
            .filter((row): row is NonNullable<typeof row> => row !== null),
        })
      : null;
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      event: {
        ...enrichedEvent,
        operatorPriorityScore: computeIntelligenceOperatorPriorityScore(enrichedEvent),
      },
      linked_claims: linkedClaims,
      claim_links: claimLinks,
      review_state: event.reviewState,
      bridge_dispatches: bridges,
      execution_audit: executionAudit,
      operator_notes: operatorNotes,
      invalidation_entries: invalidationEntries,
      expected_signal_entries: expectedSignalEntries,
      outcome_entries: outcomeEntries,
      narrative_cluster: narrativeCluster
        ? {
            ...narrativeCluster,
            quality: narrativeClusterQuality,
            last_transition: narrativeClusterLastTransition,
          }
        : null,
      narrative_cluster_members: narrativeClusterMembers,
      temporal_narrative_ledger: temporalNarrativeLedgerEntries,
      related_historical_events: temporal.relatedHistoricalEvents,
    });
  });

  app.get('/api/v1/intelligence/events/:eventId/graph', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence event graph query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const event = await loadEventOr404(ctx, request, reply, access.workspaceId, (request.params as { eventId: string }).eventId);
    if (!event) return reply;
    const [events, linkedClaims, edges] = await Promise.all([
      ctx.store.listIntelligenceEvents({
        workspaceId: access.workspaceId,
        limit: 200,
      }),
      ctx.store.listIntelligenceLinkedClaims({
        workspaceId: access.workspaceId,
        eventId: event.id,
        limit: 100,
      }),
      ctx.store.listIntelligenceLinkedClaimEdges({
        workspaceId: access.workspaceId,
        eventId: event.id,
        limit: 200,
      }),
    ]);
    const canonicalEvents = filterCanonicalEvents(events);
    const temporal = computeIntelligenceTemporalNarrativeProfile({
      event,
      candidateEvents: canonicalEvents,
    });
    const hotspotClusters = buildIntelligenceHotspotClusters({
      linkedClaims,
      edges,
    });
    const hotspotClaimIds = new Set<string>(
      linkedClaims.filter((row) => row.contradictionCount > 0).map((row) => row.id),
    );
    for (const edge of edges) {
      if (edge.relation !== 'contradicts') continue;
      hotspotClaimIds.add(edge.leftLinkedClaimId);
      hotspotClaimIds.add(edge.rightLinkedClaimId);
    }
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      event_id: event.id,
      summary: {
        eventId: event.id,
        linkedClaimCount: event.linkedClaimCount,
        edgeCount: edges.length,
        graphSupportScore: event.graphSupportScore,
        graphContradictionScore: event.graphContradictionScore,
        graphHotspotCount: event.graphHotspotCount,
        recurringNarrativeScore: temporal.recurringNarrativeScore,
        relatedHistoricalEventCount: temporal.relatedHistoricalEventCount,
        temporalNarrativeState: temporal.temporalNarrativeState,
        hotspotClusterCount: hotspotClusters.length,
      },
      nodes: linkedClaims,
      edges: edges.map((edge) => ({
        ...edge,
        evidence_signal_count: edge.evidenceSignalIds.length,
      })),
      hotspots: [...hotspotClaimIds],
      neighborhoods: buildIntelligenceGraphNeighborhoods({
        linkedClaims,
        edges,
      }),
      hotspot_clusters: hotspotClusters,
      related_historical_events: temporal.relatedHistoricalEvents,
    });
  });

  app.get('/api/v1/intelligence/hypotheses/:eventId', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence hypothesis query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const event = await loadEventOr404(ctx, request, reply, access.workspaceId, (request.params as { eventId: string }).eventId);
    if (!event) return reply;
    if (event.lifecycleState !== 'canonical') {
      return sendError(reply, request, 404, 'NOT_FOUND', 'canonical intelligence event not found');
    }
    const [ledgerEntries, evidenceLinks, invalidationEntries, expectedSignalEntries, outcomeEntries, graphEdges] = await Promise.all([
      ctx.store.listIntelligenceHypothesisLedgerEntries({
        workspaceId: access.workspaceId,
        eventId: event.id,
      }),
      ctx.store.listIntelligenceHypothesisEvidenceLinks({
        workspaceId: access.workspaceId,
        eventId: event.id,
      }),
      ctx.store.listIntelligenceInvalidationEntries({
        workspaceId: access.workspaceId,
        eventId: event.id,
      }),
      ctx.store.listIntelligenceExpectedSignalEntries({
        workspaceId: access.workspaceId,
        eventId: event.id,
      }),
      ctx.store.listIntelligenceOutcomeEntries({
        workspaceId: access.workspaceId,
        eventId: event.id,
      }),
      ctx.store.listIntelligenceLinkedClaimEdges({
        workspaceId: access.workspaceId,
        eventId: event.id,
        limit: 200,
      }),
    ]);
    const evidenceSummary = [...new Set(ledgerEntries.map((row) => row.hypothesisId))].map((hypothesisId) => {
      const hypothesisLinks = evidenceLinks.filter((row) => row.hypothesisId === hypothesisId);
      const supports = hypothesisLinks.filter((row) => row.relation === 'supports');
      const contradicts = hypothesisLinks.filter((row) => row.relation === 'contradicts');
      const monitors = hypothesisLinks.filter((row) => row.relation === 'monitors');
      const linkedClaimIds = new Set(
        hypothesisLinks.map((row) => row.linkedClaimId).filter((row): row is string => Boolean(row)),
      );
      const supportEdges = graphEdges.filter((row) =>
        row.relation === 'supports' &&
        (linkedClaimIds.has(row.leftLinkedClaimId) || linkedClaimIds.has(row.rightLinkedClaimId)),
      );
      const contradictEdges = graphEdges.filter((row) =>
        row.relation === 'contradicts' &&
        (linkedClaimIds.has(row.leftLinkedClaimId) || linkedClaimIds.has(row.rightLinkedClaimId)),
      );
      return {
        hypothesis_id: hypothesisId,
        support_count: supports.length,
        contradict_count: contradicts.length,
        monitor_count: monitors.length,
        support_strength: Number(supports.reduce((total, row) => total + (row.evidenceStrength ?? 0), 0).toFixed(3)),
        contradict_strength: Number(contradicts.reduce((total, row) => total + (row.evidenceStrength ?? 0), 0).toFixed(3)),
        monitor_strength: Number(monitors.reduce((total, row) => total + (row.evidenceStrength ?? 0), 0).toFixed(3)),
        support_edge_count: supportEdges.length,
        contradict_edge_count: contradictEdges.length,
        linked_claim_ids: [...linkedClaimIds],
        edge_linked_claim_ids: [...new Set([
          ...supportEdges.flatMap((row) => [row.leftLinkedClaimId, row.rightLinkedClaimId]),
          ...contradictEdges.flatMap((row) => [row.leftLinkedClaimId, row.rightLinkedClaimId]),
        ])],
        graph_support_strength: Number(supportEdges.reduce((total, row) => total + row.edgeStrength, 0).toFixed(3)),
        graph_contradict_strength: Number(contradictEdges.reduce((total, row) => total + row.edgeStrength, 0).toFixed(3)),
      };
    });
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      event_id: event.id,
      primary_hypotheses: event.primaryHypotheses,
      counter_hypotheses: event.counterHypotheses,
      invalidation_conditions: event.invalidationConditions,
      expected_signals: event.expectedSignals,
      world_states: event.worldStates,
      deliberations: event.deliberations,
      outcomes: event.outcomes,
      ledger_entries: ledgerEntries,
      evidence_links: evidenceLinks,
      evidence_summary: evidenceSummary,
      invalidation_entries: invalidationEntries,
      expected_signal_entries: expectedSignalEntries,
      outcome_entries: outcomeEntries,
    });
  });

  app.get('/api/v1/intelligence/narrative-clusters', async (request, reply) => {
    const parsed = NarrativeClustersQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence narrative cluster query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const clusters = await ctx.store.listIntelligenceNarrativeClusters({
      workspaceId: access.workspaceId,
      limit: parsed.data.limit,
    });
    const [events, memberships] = await Promise.all([
      ctx.store.listIntelligenceEvents({
        workspaceId: access.workspaceId,
        limit: 500,
      }),
      ctx.store.listIntelligenceNarrativeClusterMemberships({
        workspaceId: access.workspaceId,
        limit: 1500,
      }),
    ]);
    const canonicalEvents = filterCanonicalEvents(events);
    const canonicalEventIds = new Set(canonicalEvents.map((event) => event.id));
    const clusterQualityById = buildClusterQualityMap({
      clusters,
      events: canonicalEvents,
      memberships: memberships.filter((membership) => canonicalEventIds.has(membership.eventId)),
    });
    const latestLedgerEntries = await Promise.all(
      clusters.map(async (cluster) => {
        const entry = (
          await ctx.store.listIntelligenceNarrativeClusterLedgerEntries({
            workspaceId: access.workspaceId,
            clusterId: cluster.id,
            limit: 1,
          })
        )[0] ?? null;
        return [cluster.id, toNarrativeClusterLastTransition(entry, cluster)] as const;
      }),
    );
    const latestLedgerEntryByClusterId = new Map(latestLedgerEntries);
    const sorted = [...clusters].sort(
      (left, right) =>
        right.clusterPriorityScore - left.clusterPriorityScore ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      narrative_clusters: sorted.map((cluster) => ({
        ...cluster,
        quality: clusterQualityById.get(cluster.id),
        last_transition: latestLedgerEntryByClusterId.get(cluster.id) ?? null,
      })),
    });
  });

  app.get('/api/v1/intelligence/narrative-clusters/:clusterId', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence narrative cluster detail query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const cluster = await loadNarrativeClusterOr404(
      ctx,
      request,
      reply,
      access.workspaceId,
      (request.params as { clusterId: string }).clusterId,
    );
    if (!cluster) return reply;
    const [memberships, events, ledgerEntries, operatorNotes] = await Promise.all([
      ctx.store.listIntelligenceNarrativeClusterMemberships({
        workspaceId: access.workspaceId,
        clusterId: cluster.id,
        limit: 500,
      }),
      ctx.store.listIntelligenceEvents({
        workspaceId: access.workspaceId,
        limit: 500,
      }),
      ctx.store.listIntelligenceNarrativeClusterLedgerEntries({
        workspaceId: access.workspaceId,
        clusterId: cluster.id,
        limit: 100,
      }),
      ctx.store.listIntelligenceOperatorNotes({
        workspaceId: access.workspaceId,
        limit: 200,
      }),
    ]);
    const canonicalEvents = filterCanonicalEvents(events);
    const canonicalEventIds = new Set(canonicalEvents.map((event) => event.id));
    const filteredMemberships = memberships.filter((membership) => canonicalEventIds.has(membership.eventId));
    const eventQualityById = await buildEventQualityMap(ctx, access.workspaceId, canonicalEvents);
    const clusterQuality = computeIntelligenceNarrativeClusterQuality({
      cluster,
      memberEvents: filteredMemberships
        .map((membership) => canonicalEvents.find((row) => row.id === membership.eventId) ?? null)
        .filter((row): row is NonNullable<typeof row> => row !== null),
    });
    const eventById = new Map(canonicalEvents.map((row) => [row.id, row] as const));
    const memberSummaries = filteredMemberships
      .map((membership) => {
        const event = eventById.get(membership.eventId);
        if (!event) return null;
        return {
          membershipId: membership.id,
          eventId: event.id,
          title: event.title,
          relation: membership.relation,
          score: membership.score,
          daysDelta: membership.daysDelta,
          isLatest: membership.isLatest,
          temporalNarrativeState: event.temporalNarrativeState,
          graphSupportScore: event.graphSupportScore,
          graphContradictionScore: event.graphContradictionScore,
          graphHotspotCount: event.graphHotspotCount,
          timeCoherenceScore: event.timeCoherenceScore,
          lastEventAt: event.timeWindowEnd ?? event.updatedAt,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((left, right) => {
        if (left.isLatest !== right.isLatest) return left.isLatest ? -1 : 1;
        return Date.parse(right.lastEventAt ?? '') - Date.parse(left.lastEventAt ?? '');
      });
    const clusterNotes = operatorNotes.filter(
      (note) => note.scope === 'narrative_cluster' && note.scopeId === cluster.id,
    );
    const recentEvents = memberSummaries
      .map((summary) => eventById.get(summary.eventId) ?? null)
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((left, right) => Date.parse(right.timeWindowEnd ?? right.updatedAt) - Date.parse(left.timeWindowEnd ?? left.updatedAt))
      .slice(0, 25)
      .map((event) => ({
        ...event,
        quality: eventQualityById.get(event.id),
      }));
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      narrative_cluster: {
        ...cluster,
        quality: clusterQuality,
        last_transition: toNarrativeClusterLastTransition(ledgerEntries[0] ?? null, cluster),
      },
      memberships: memberSummaries,
      recent_events: recentEvents,
      ledger_entries: ledgerEntries,
      operator_notes: clusterNotes,
    });
  });

  app.get('/api/v1/intelligence/narrative-clusters/:clusterId/timeline', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence narrative cluster timeline query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const cluster = await loadNarrativeClusterOr404(
      ctx,
      request,
      reply,
      access.workspaceId,
      (request.params as { clusterId: string }).clusterId,
    );
    if (!cluster) return reply;
    const timeline = await ctx.store.listIntelligenceNarrativeClusterTimelineEntries({
      workspaceId: access.workspaceId,
      clusterId: cluster.id,
    });
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      cluster_id: cluster.id,
      trend_summary: {
        recurring_strength_trend: cluster.recurringStrengthTrend,
        divergence_trend: cluster.divergenceTrend,
        support_decay_score: cluster.supportDecayScore,
        contradiction_acceleration: cluster.contradictionAcceleration,
        last_recurring_at: cluster.lastRecurringAt,
        last_diverging_at: cluster.lastDivergingAt,
      },
      timeline,
    });
  });

  app.get('/api/v1/intelligence/narrative-clusters/:clusterId/graph', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence narrative cluster graph query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const cluster = await loadNarrativeClusterOr404(
      ctx,
      request,
      reply,
      access.workspaceId,
      (request.params as { clusterId: string }).clusterId,
    );
    if (!cluster) return reply;
    const memberships = await ctx.store.listIntelligenceNarrativeClusterMemberships({
      workspaceId: access.workspaceId,
      clusterId: cluster.id,
      limit: 500,
    });
    const eventIds = memberships.map((membership) => membership.eventId);
    const [events, linkedClaimsByEvent, linkedEdgesByEvent] = await Promise.all([
      ctx.store.listIntelligenceEvents({
        workspaceId: access.workspaceId,
        limit: 500,
      }),
      Promise.all(
        eventIds.map((eventId) =>
          ctx.store.listIntelligenceLinkedClaims({
            workspaceId: access.workspaceId,
            eventId,
            limit: 200,
          }),
        ),
      ),
      Promise.all(
        eventIds.map((eventId) =>
          ctx.store.listIntelligenceLinkedClaimEdges({
            workspaceId: access.workspaceId,
            eventId,
            limit: 400,
          }),
        ),
      ),
    ]);
    const memberEvents = filterCanonicalEvents(events).filter((event) => eventIds.includes(event.id));
    const eventQualityById = await buildEventQualityMap(ctx, access.workspaceId, memberEvents);
    const linkedClaims = [...new Map(linkedClaimsByEvent.flat().map((row) => [row.id, row] as const)).values()];
    const edges = [...new Map(linkedEdgesByEvent.flat().map((row) => [row.id, row] as const)).values()];
    const hotspots = new Set<string>();
    for (const claim of linkedClaims) {
      if (claim.contradictionCount > 0) hotspots.add(claim.id);
    }
    for (const edge of edges) {
      if (edge.relation === 'contradicts') {
        hotspots.add(edge.leftLinkedClaimId);
        hotspots.add(edge.rightLinkedClaimId);
      }
    }
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      cluster_id: cluster.id,
      summary: {
        clusterId: cluster.id,
        eventCount: cluster.eventCount,
        linkedClaimCount: linkedClaims.length,
        edgeCount: edges.length,
        graphSupportScore: cluster.supportScore,
        graphContradictionScore: cluster.contradictionScore,
        graphHotspotCount: cluster.hotspotEventCount,
        hotspotClusterCount: buildIntelligenceHotspotClusters({
          linkedClaims,
          edges,
        }).length,
      },
      nodes: linkedClaims,
      edges: edges.map((edge) => ({
        ...edge,
        evidence_signal_count: edge.evidenceSignalIds.length,
      })),
      hotspots: [...hotspots],
      neighborhoods: buildIntelligenceGraphNeighborhoods({
        linkedClaims,
        edges,
      }),
      hotspot_clusters: buildIntelligenceHotspotClusters({
        linkedClaims,
        edges,
      }),
      recent_events: memberEvents
        .sort((left, right) => Date.parse(right.timeWindowEnd ?? right.updatedAt) - Date.parse(left.timeWindowEnd ?? left.updatedAt))
        .slice(0, 25)
        .map((event) => ({
          ...event,
          quality: eventQualityById.get(event.id),
        })),
    });
  });

  app.get('/api/v1/intelligence/quarantine', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence quarantine query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const [signals, events, documents] = await Promise.all([
      ctx.store.listIntelligenceSignals({
        workspaceId: access.workspaceId,
        limit: 5000,
      }),
      ctx.store.listIntelligenceEvents({
        workspaceId: access.workspaceId,
        limit: 2000,
      }),
      ctx.store.listIntelligenceRawDocuments({
        workspaceId: access.workspaceId,
        limit: 5000,
      }),
    ]);
    const documentById = new Map(documents.map((document) => [document.id, document] as const));
    const quarantinedSignals = signals
      .filter((signal) => signal.promotionState === 'quarantined')
      .map((signal) => {
        const document = documentById.get(signal.documentId) ?? null;
        return {
          signal_id: signal.id,
          document_id: signal.documentId,
          title: document?.title ?? 'Untitled document',
          url: signal.url,
          source_type: signal.sourceType,
          source_tier: signal.sourceTier,
          reasons: signal.promotionReasons.map(formatQuarantineReason),
          created_at: signal.createdAt,
          processed_at: signal.processedAt,
        };
      });
    const provisionalEvents = events
      .filter((event) => event.lifecycleState === 'provisional')
      .map((event) => ({
        event_id: event.id,
        title: event.title,
        summary: event.summary,
        signal_count: event.signalIds.length,
        document_count: event.documentIds.length,
        non_social_corroboration_count: event.nonSocialCorroborationCount,
        reasons: event.validationReasons.map(formatQuarantineReason),
        updated_at: event.updatedAt,
      }));
    const collisionsByIdentity = new Map<string, {
      document_identity_key: string;
      count: number;
      titles: string[];
      canonical_urls: string[];
    }>();
    for (const document of documents) {
      if (!document.documentIdentityKey) continue;
      const current = collisionsByIdentity.get(document.documentIdentityKey);
      if (!current) {
        collisionsByIdentity.set(document.documentIdentityKey, {
          document_identity_key: document.documentIdentityKey,
          count: 1,
          titles: [document.title],
          canonical_urls: [document.canonicalUrl],
        });
        continue;
      }
      current.count += 1;
      if (!current.titles.includes(document.title)) current.titles.push(document.title);
      if (!current.canonical_urls.includes(document.canonicalUrl)) current.canonical_urls.push(document.canonicalUrl);
    }
    const identityCollisions = [...collisionsByIdentity.values()]
      .filter((entry) => entry.count > 1)
      .sort((left, right) => right.count - left.count)
      .slice(0, 50);
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      quarantined_signals: quarantinedSignals,
      provisional_events: provisionalEvents,
      identity_collisions: identityCollisions,
    });
  });

  app.post('/api/v1/intelligence/signals/:signalId/retry', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence signal retry payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const signal = await ctx.store.updateIntelligenceSignalProcessing({
      workspaceId: access.workspaceId,
      signalId: (request.params as { signalId: string }).signalId,
      processingStatus: 'pending',
      promotionState: 'pending_validation',
      promotionReasons: [],
      processingLeaseId: null,
      linkedEventId: null,
      processingError: null,
      processedAt: null,
    });
    if (!signal) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'intelligence signal not found');
    }
    return sendSuccess(reply, request, 202, {
      workspace_id: access.workspaceId,
      result: {
        workspaceId: access.workspaceId,
        signalId: signal.id,
        queuedAt: new Date().toISOString(),
        processingStatus: signal.processingStatus,
      },
    });
  });

  app.post('/api/v1/intelligence/events/:eventId/rebuild', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence event rebuild payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    try {
      const result = await rebuildIntelligenceEvent({
        store: ctx.store,
        providerRouter: ctx.providerRouter,
        env: ctx.env,
        workspaceId: access.workspaceId,
        userId: access.userId,
        eventId: (request.params as { eventId: string }).eventId,
        notificationService: ctx.notificationService,
      });
      return sendSuccess(reply, request, 202, {
        workspace_id: access.workspaceId,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not found')) {
        return sendError(reply, request, 404, 'NOT_FOUND', message);
      }
      return sendError(reply, request, 422, 'VALIDATION_ERROR', message);
    }
  });

  app.post('/api/v1/intelligence/events/:eventId/review-state', async (request, reply) => {
    const parsed = ReviewStateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid review state payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const event = await ctx.store.updateIntelligenceEventReviewState({
      workspaceId: access.workspaceId,
      eventId: (request.params as { eventId: string }).eventId,
      reviewState: parsed.data.review_state,
      updatedBy: access.userId,
      reviewReason: parsed.data.review_reason ?? null,
      reviewOwner: parsed.data.review_owner ?? null,
      reviewResolvedAt: parsed.data.review_resolved_at ?? null,
    });
    if (!event) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'intelligence event not found');
    }
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      event,
    });
  });

  app.post('/api/v1/intelligence/linked-claims/:linkedClaimId/review-state', async (request, reply) => {
    const parsed = ReviewStateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid linked claim review payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const linkedClaim = await ctx.store.updateIntelligenceLinkedClaimReviewState({
      workspaceId: access.workspaceId,
      linkedClaimId: (request.params as { linkedClaimId: string }).linkedClaimId,
      reviewState: parsed.data.review_state,
      updatedBy: access.userId,
      reviewReason: parsed.data.review_reason ?? null,
      reviewOwner: parsed.data.review_owner ?? null,
      reviewResolvedAt: parsed.data.review_resolved_at ?? null,
    });
    if (!linkedClaim) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'linked claim not found');
    }
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      linked_claim: linkedClaim,
    });
  });

  app.post('/api/v1/intelligence/hypotheses/entries/:entryId/review-state', async (request, reply) => {
    const parsed = ReviewStateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hypothesis review payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const hypothesis = await ctx.store.updateIntelligenceHypothesisLedgerReviewState({
      workspaceId: access.workspaceId,
      entryId: (request.params as { entryId: string }).entryId,
      reviewState: parsed.data.review_state,
      updatedBy: access.userId,
      reviewReason: parsed.data.review_reason ?? null,
      reviewOwner: parsed.data.review_owner ?? null,
      reviewResolvedAt: parsed.data.review_resolved_at ?? null,
    });
    if (!hypothesis) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hypothesis ledger entry not found');
    }
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      hypothesis,
    });
  });

  app.post('/api/v1/intelligence/narrative-clusters/:clusterId/review-state', async (request, reply) => {
    const parsed = ReviewStateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid narrative cluster review payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const cluster = await ctx.store.updateIntelligenceNarrativeClusterReviewState({
      workspaceId: access.workspaceId,
      clusterId: (request.params as { clusterId: string }).clusterId,
      reviewState: parsed.data.review_state,
      updatedBy: access.userId,
      reviewReason: parsed.data.review_reason ?? null,
      reviewOwner: parsed.data.review_owner ?? null,
      reviewResolvedAt: parsed.data.review_resolved_at ?? null,
    });
    if (!cluster) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'narrative cluster not found');
    }
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      narrative_cluster: cluster,
    });
  });

  app.post('/api/v1/intelligence/events/:eventId/operator-note', async (request, reply) => {
    const parsed = OperatorNoteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid operator note payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const event = await loadEventOr404(ctx, request, reply, access.workspaceId, (request.params as { eventId: string }).eventId);
    if (!event) return reply;
    const note = await ctx.store.createIntelligenceOperatorNote({
      workspaceId: access.workspaceId,
      eventId: event.id,
      userId: access.userId,
      scope: parsed.data.scope,
      scopeId: parsed.data.scope_id ?? null,
      note: parsed.data.note,
    });
    return sendSuccess(reply, request, 201, {
      workspace_id: access.workspaceId,
      note,
    });
  });

  app.post('/api/v1/intelligence/events/:eventId/deliberate', async (request, reply) => {
    const parsed = DeliberateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid deliberation payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const event = await loadEventOr404(ctx, request, reply, access.workspaceId, (request.params as { eventId: string }).eventId);
    if (!event) return reply;
    const result = await dispatchIntelligenceCouncilBridge({
      ctx,
      workspaceId: access.workspaceId,
      event,
      userId: access.userId,
    });
    return sendSuccess(reply, request, 202, {
      workspace_id: access.workspaceId,
      dispatch: result.dispatch,
      deliberation: result.deliberation,
    });
  });

  app.post('/api/v1/intelligence/events/:eventId/execute', async (request, reply) => {
    const parsed = ExecuteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid execution payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const event = await loadEventOr404(ctx, request, reply, access.workspaceId, (request.params as { eventId: string }).eventId);
    if (!event) return reply;
    try {
      const result = await executeIntelligenceCandidate({
        store: ctx.store,
        providerRouter: ctx.providerRouter,
        env: ctx.env,
        workspaceId: access.workspaceId,
        userId: access.userId,
        event,
        candidateId: parsed.data.candidate_id,
        notificationService: ctx.notificationService,
      });
      return sendSuccess(reply, request, 200, {
        workspace_id: access.workspaceId,
        candidate: result.candidate,
        event: result.event,
      });
    } catch (error) {
      return sendError(
        reply,
        request,
        409,
        'CONFLICT',
        error instanceof Error ? error.message : 'failed to execute intelligence candidate'
      );
    }
  });

  app.get('/api/v1/intelligence/runtime/models', async (request, reply) => {
    const parsed = WorkspaceScopedQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence runtime model query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const [models, providerHealth] = await Promise.all([
      ctx.store.listIntelligenceModelRegistryEntries(),
      ctx.store.listIntelligenceProviderHealth(),
    ]);
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      models,
      provider_health: providerHealth,
      sync_worker: getIntelligenceCatalogSyncWorkerStatus(),
    });
  });

  app.get('/api/v1/intelligence/runtime/aliases', async (request, reply) => {
    const parsed = AliasListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid intelligence runtime alias query', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    await ensureDefaultIntelligenceAliasBindings(ctx.store, ctx.env);
    const [workspaceBindings, globalBindings, workspaceRollouts, globalRollouts] = await Promise.all([
      ctx.store.listIntelligenceAliasBindings({
        workspaceId: access.workspaceId,
        alias: parsed.data.alias as IntelligenceCapabilityAlias | undefined,
      }),
      ctx.store.listIntelligenceAliasBindings({
        workspaceId: null,
        alias: parsed.data.alias as IntelligenceCapabilityAlias | undefined,
      }),
      ctx.store.listIntelligenceAliasRollouts({
        workspaceId: access.workspaceId,
        alias: parsed.data.alias as IntelligenceCapabilityAlias | undefined,
        limit: 20,
      }),
      ctx.store.listIntelligenceAliasRollouts({
        workspaceId: null,
        alias: parsed.data.alias as IntelligenceCapabilityAlias | undefined,
        limit: 20,
      }),
    ]);
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      alias: parsed.data.alias ?? null,
      bindings: {
        workspace: workspaceBindings,
        global: globalBindings,
      },
      rollouts: {
        workspace: workspaceRollouts,
        global: globalRollouts,
      },
    });
  });

  app.post('/api/v1/intelligence/runtime/aliases/:alias/bindings', async (request, reply) => {
    const alias = (request.params as { alias: IntelligenceCapabilityAlias }).alias;
    const parsed = AliasBindingUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid alias binding payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
      requiredRole: 'admin',
    });
    if (!access) return reply;
    const targetWorkspaceId = parsed.data.scope === 'global' ? null : access.workspaceId;
    const previousBindings = await ctx.store.listIntelligenceAliasBindings({
      workspaceId: targetWorkspaceId,
      alias,
    });
    const bindings = await ctx.store.replaceIntelligenceAliasBindings({
      alias,
      workspaceId: targetWorkspaceId,
      updatedBy: access.userId,
      bindings: parsed.data.bindings.map((row) => ({
        alias,
        provider: row.provider,
        modelId: row.model_id,
        weight: row.weight,
        fallbackRank: row.fallback_rank,
        canaryPercent: row.canary_percent,
        isActive: row.is_active,
        requiresStructuredOutput: row.requires_structured_output,
        requiresToolUse: row.requires_tool_use,
        requiresLongContext: row.requires_long_context,
        maxCostClass: row.max_cost_class ?? null,
      })),
    });
    const rollout = await ctx.store.createIntelligenceAliasRollout({
      workspaceId: targetWorkspaceId,
      alias,
      bindingIds: bindings.map((row) => row.id),
      createdBy: access.userId,
      note: summarizeAliasBindingRollout({
        scope: parsed.data.scope,
        before: previousBindings,
        after: bindings,
      }),
    });
    return sendSuccess(reply, request, 200, {
      workspace_id: access.workspaceId,
      binding_scope: parsed.data.scope,
      alias,
      bindings,
      rollout,
    });
  });

  app.post('/api/v1/intelligence/bridges/council', async (request, reply) => {
    const parsed = BridgeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid council bridge payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const event = await loadEventOr404(ctx, request, reply, access.workspaceId, parsed.data.event_id);
    if (!event) return reply;
    const result = await dispatchIntelligenceCouncilBridge({
      ctx,
      workspaceId: access.workspaceId,
      event,
      userId: access.userId,
    });
    return sendSuccess(reply, request, 202, {
      workspace_id: access.workspaceId,
      dispatch: result.dispatch,
      deliberation: result.deliberation,
    });
  });

  app.post('/api/v1/intelligence/bridges/brief', async (request, reply) => {
    const parsed = BridgeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid brief bridge payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const event = await loadEventOr404(ctx, request, reply, access.workspaceId, parsed.data.event_id);
    if (!event) return reply;
    const dispatch = await bridgeIntelligenceEventToBrief({
      store: ctx.store,
      workspaceId: access.workspaceId,
      event,
      userId: access.userId,
    });
    return sendSuccess(reply, request, 202, {
      workspace_id: access.workspaceId,
      dispatch,
    });
  });

  app.post('/api/v1/intelligence/bridges/action', async (request, reply) => {
    const parsed = BridgeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid action bridge payload', parsed.error.flatten());
    }
    const access = await resolveWorkspaceAccess(ctx, request, reply, {
      workspaceId: parsed.data.workspace_id,
    });
    if (!access) return reply;
    const event = await loadEventOr404(ctx, request, reply, access.workspaceId, parsed.data.event_id);
    if (!event) return reply;
    const dispatch = await bridgeIntelligenceEventToAction({
      store: ctx.store,
      workspaceId: access.workspaceId,
      event,
      userId: access.userId,
    });
    return sendSuccess(reply, request, 202, {
      workspace_id: access.workspaceId,
      dispatch,
    });
  });
}
