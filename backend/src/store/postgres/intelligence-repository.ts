import type { Pool } from 'pg';

import type { IntelligenceRepositoryContract } from '../repository-contracts';
import type {
  AliasRolloutRecord,
  CapabilityAliasBindingRecord,
  ClaimLinkRecord,
  ConnectorCapabilityRecord,
  EventMembershipRecord,
  ExecutionAuditRecord,
  IntelligenceFetchFailureRecord,
  IntelligenceBridgeDispatchRecord,
  IntelligenceEventClusterRecord,
  IntelligenceEventGraphNeighborhood,
  IntelligenceEventGraphSummary,
  IntelligenceExpectedSignalEntryRecord,
  IntelligenceInvalidationEntryRecord,
  IntelligenceNarrativeClusterMembershipRecord,
  IntelligenceNarrativeClusterRecord,
  IntelligenceOutcomeEntryRecord,
  IntelligenceTemporalNarrativeLedgerEntryRecord,
  HypothesisEvidenceLink,
  HypothesisLedgerEntry,
  LinkedClaimRecord,
  LinkedClaimEdgeRecord,
  OperatorNoteRecord,
  IntelligenceScanRunRecord,
  IntelligenceSourceCursorRecord,
  IntelligenceSourceRecord,
  IntelligenceSourceHealth,
  IntelligenceWorkspaceMemberRecord,
  IntelligenceWorkspaceRecord,
  ModelRegistryEntryRecord,
  ProviderHealthRecord,
  RawDocumentRecord,
  SignalEnvelopeRecord,
} from '../types';
import type {
  IntelligenceAliasBindingRow,
  IntelligenceAliasRolloutRow,
  IntelligenceBridgeDispatchRow,
  IntelligenceClaimLinkRow,
  IntelligenceLinkedClaimEdgeRow,
  IntelligenceEventMembershipRow,
  IntelligenceExecutionAuditRow,
  IntelligenceEventRow,
  IntelligenceFetchFailureRow,
  IntelligenceHypothesisEvidenceLinkRow,
  IntelligenceHypothesisLedgerRow,
  IntelligenceInvalidationEntryRow,
  IntelligenceLinkedClaimRow,
  IntelligenceModelRegistryRow,
  IntelligenceExpectedSignalEntryRow,
  IntelligenceOutcomeEntryRow,
  IntelligenceNarrativeClusterMembershipRow,
  IntelligenceNarrativeClusterRow,
  IntelligenceTemporalNarrativeLedgerEntryRow,
  IntelligenceOperatorNoteRow,
  IntelligenceProviderHealthRow,
  IntelligenceRawDocumentRow,
  IntelligenceScanRunRow,
  IntelligenceSignalRow,
  IntelligenceSourceCursorRow,
  IntelligenceSourceRow,
  IntelligenceWorkspaceMemberRow,
  IntelligenceWorkspaceRow,
} from './types';

type PostgresIntelligenceRepositoryDeps = {
  pool: Pool;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function defaultCrawlPolicy(partial?: Partial<IntelligenceSourceRecord['crawlPolicy']> | null): IntelligenceSourceRecord['crawlPolicy'] {
  return {
    allowDomains: partial?.allowDomains?.filter(Boolean) ?? [],
    denyDomains: partial?.denyDomains?.filter(Boolean) ?? [],
    respectRobots: partial?.respectRobots ?? true,
    maxDepth: partial?.maxDepth ?? 1,
    maxPagesPerRun: partial?.maxPagesPerRun ?? 5,
    revisitCooldownMinutes: partial?.revisitCooldownMinutes ?? 60,
    perDomainRateLimitPerMinute: partial?.perDomainRateLimitPerMinute ?? 6,
  };
}

function defaultSourceHealth(partial?: Partial<IntelligenceSourceHealth> | null): IntelligenceSourceHealth {
  return {
    lastStatus: partial?.lastStatus ?? 'idle',
    lastSuccessAt: partial?.lastSuccessAt ?? null,
    lastFailureAt: partial?.lastFailureAt ?? null,
    consecutiveFailures: partial?.consecutiveFailures ?? 0,
    recentLatencyMs: partial?.recentLatencyMs ?? null,
    status403Count: partial?.status403Count ?? 0,
    status429Count: partial?.status429Count ?? 0,
    robotsBlocked: partial?.robotsBlocked ?? false,
    lastFailureReason: partial?.lastFailureReason ?? null,
    updatedAt: partial?.updatedAt ?? null,
  };
}

function normalizeConnectorCapability(value: unknown): ConnectorCapabilityRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const connectorId = typeof record.connectorId === 'string' ? record.connectorId.trim() : '';
  if (!connectorId) return null;
  return {
    connectorId,
    writeAllowed: record.writeAllowed === true,
    destructive: record.destructive === true,
    requiresHuman: record.requiresHuman === true,
    schemaId: typeof record.schemaId === 'string' && record.schemaId.trim().length > 0 ? record.schemaId : null,
    allowedActions: normalizeStringArray(record.allowedActions),
  };
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'workspace';
}

function mapWorkspaceRow(row: IntelligenceWorkspaceRow): IntelligenceWorkspaceRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapWorkspaceMemberRow(row: IntelligenceWorkspaceMemberRow): IntelligenceWorkspaceMemberRecord {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapSourceRow(row: IntelligenceSourceRow): IntelligenceSourceRecord {
  const crawlPolicy =
    row.crawl_config_json && typeof row.crawl_config_json === 'object' && !Array.isArray(row.crawl_config_json)
      ? defaultCrawlPolicy(row.crawl_config_json as Partial<IntelligenceSourceRecord['crawlPolicy']>)
      : defaultCrawlPolicy();
  const health =
    row.health_json && typeof row.health_json === 'object' && !Array.isArray(row.health_json)
      ? defaultSourceHealth(row.health_json as Partial<IntelligenceSourceHealth>)
      : defaultSourceHealth();
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    kind: row.kind,
    url: row.url,
    sourceType: row.source_type as IntelligenceSourceRecord['sourceType'],
    sourceTier: row.source_tier as IntelligenceSourceRecord['sourceTier'],
    pollMinutes: row.poll_minutes,
    enabled: row.enabled,
    parserConfigJson: row.parser_config_json ?? {},
    crawlConfigJson: row.crawl_config_json ?? {},
    crawlPolicy,
    health,
    connectorCapability: normalizeConnectorCapability(row.connector_capability_json),
    entityHints: normalizeStringArray(row.entity_hints_json),
    metricHints: normalizeStringArray(row.metric_hints_json),
    lastFetchedAt: toIso(row.last_fetched_at),
    lastSuccessAt: toIso(row.last_success_at),
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapCursorRow(row: IntelligenceSourceCursorRow): IntelligenceSourceCursorRecord {
  return {
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    cursor: row.cursor_text,
    etag: row.etag,
    lastModified: row.last_modified,
    lastSeenPublishedAt: toIso(row.last_seen_published_at),
    lastFetchedAt: toIso(row.last_fetched_at),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapScanRunRow(row: IntelligenceScanRunRow): IntelligenceScanRunRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    status: row.status,
    fetchedCount: row.fetched_count,
    storedDocumentCount: row.stored_document_count,
    signalCount: row.signal_count,
    clusteredEventCount: row.clustered_event_count,
    executionCount: row.execution_count,
    failedCount: row.failed_count,
    error: row.error_text,
    detailJson: row.detail_json ?? {},
    startedAt: row.started_at.toISOString(),
    finishedAt: toIso(row.finished_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRawDocumentRow(row: IntelligenceRawDocumentRow): RawDocumentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    summary: row.summary,
    rawText: row.raw_text,
    rawHtml: row.raw_html,
    publishedAt: toIso(row.published_at),
    observedAt: toIso(row.observed_at),
    language: row.language,
    sourceType: row.source_type as RawDocumentRecord['sourceType'],
    sourceTier: row.source_tier as RawDocumentRecord['sourceTier'],
    documentFingerprint: row.document_fingerprint,
    metadataJson: row.metadata_json ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

function mapSignalRow(row: IntelligenceSignalRow): SignalEnvelopeRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    documentId: row.document_id,
    sourceType: row.source_type as SignalEnvelopeRecord['sourceType'],
    sourceTier: row.source_tier as SignalEnvelopeRecord['sourceTier'],
    url: row.url,
    publishedAt: toIso(row.published_at),
    observedAt: toIso(row.observed_at),
    language: row.language,
    rawText: row.raw_text,
    rawMetrics: row.raw_metrics_json ?? {},
    entityHints: normalizeStringArray(row.entity_hints_json),
    trustHint: row.trust_hint,
    processingStatus: row.processing_status,
    linkedEventId: row.linked_event_id,
    processingError: row.processing_error,
    processedAt: toIso(row.processed_at),
    createdAt: row.created_at.toISOString(),
  };
}

function mapLinkedClaimRow(row: IntelligenceLinkedClaimRow): LinkedClaimRecord {
  const distribution = row.stance_distribution_json ?? {};
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    claimFingerprint: row.claim_fingerprint,
    canonicalSubject: row.canonical_subject,
    canonicalPredicate: row.canonical_predicate,
    canonicalObject: row.canonical_object,
    predicateFamily: row.predicate_family,
    timeScope: row.time_scope,
    timeBucketStart: toIso(row.time_bucket_start),
    timeBucketEnd: toIso(row.time_bucket_end),
    stanceDistribution: {
      supporting: Number((distribution as Record<string, unknown>).supporting ?? 0),
      neutral: Number((distribution as Record<string, unknown>).neutral ?? 0),
      contradicting: Number((distribution as Record<string, unknown>).contradicting ?? 0),
    },
    sourceCount: row.source_count,
    contradictionCount: row.contradiction_count,
    nonSocialSourceCount: row.non_social_source_count,
    supportingSignalIds: normalizeStringArray(row.supporting_signal_ids_json),
    lastSupportedAt: toIso(row.last_supported_at),
    lastContradictedAt: toIso(row.last_contradicted_at),
    reviewState: row.review_state,
    reviewReason: row.review_reason,
    reviewOwner: row.review_owner,
    reviewUpdatedAt: toIso(row.review_updated_at),
    reviewUpdatedBy: row.review_updated_by,
    reviewResolvedAt: toIso(row.review_resolved_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapClaimLinkRow(row: IntelligenceClaimLinkRow): ClaimLinkRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    linkedClaimId: row.linked_claim_id,
    signalId: row.signal_id,
    semanticClaimId: row.semantic_claim_id,
    relation: row.relation,
    confidence: Number(row.confidence),
    linkStrength: Number(row.link_strength),
    createdAt: row.created_at.toISOString(),
  };
}

function mapLinkedClaimEdgeRow(row: IntelligenceLinkedClaimEdgeRow): LinkedClaimEdgeRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    leftLinkedClaimId: row.left_linked_claim_id,
    rightLinkedClaimId: row.right_linked_claim_id,
    relation: row.relation,
    edgeStrength: Number(row.edge_strength),
    evidenceSignalIds: normalizeStringArray(row.evidence_signal_ids_json),
    lastObservedAt: toIso(row.last_observed_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapEventMembershipRow(row: IntelligenceEventMembershipRow): EventMembershipRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    linkedClaimId: row.linked_claim_id,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

function mapFetchFailureRow(row: IntelligenceFetchFailureRow): IntelligenceFetchFailureRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    url: row.url,
    reason: row.reason,
    statusCode: row.status_code,
    retryable: row.retryable,
    blockedByRobots: row.blocked_by_robots,
    createdAt: row.created_at.toISOString(),
  };
}

function mapEventRow(row: IntelligenceEventRow): IntelligenceEventClusterRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    summary: row.summary,
    eventFamily: row.event_family,
    signalIds: normalizeStringArray(row.signal_ids_json),
    documentIds: normalizeStringArray(row.document_ids_json),
    entities: normalizeStringArray(row.entities_json),
    linkedClaimCount: row.linked_claim_count,
    contradictionCount: row.contradiction_count,
    nonSocialCorroborationCount: row.non_social_corroboration_count,
    linkedClaimHealthScore: Number(row.linked_claim_health_score),
    timeCoherenceScore: Number(row.time_coherence_score),
    graphSupportScore: Number(row.graph_support_score),
    graphContradictionScore: Number(row.graph_contradiction_score),
    graphHotspotCount: row.graph_hotspot_count,
    semanticClaims: Array.isArray(row.semantic_claims_json) ? row.semantic_claims_json as IntelligenceEventClusterRecord['semanticClaims'] : [],
    metricShocks: Array.isArray(row.metric_shocks_json) ? row.metric_shocks_json as IntelligenceEventClusterRecord['metricShocks'] : [],
    sourceMix: row.source_mix_json ?? {},
    corroborationScore: Number(row.corroboration_score),
    noveltyScore: Number(row.novelty_score),
    structuralityScore: Number(row.structurality_score),
    actionabilityScore: Number(row.actionability_score),
    riskBand: row.risk_band,
    topDomainId: row.top_domain_id,
    timeWindowStart: toIso(row.time_window_start),
    timeWindowEnd: toIso(row.time_window_end),
    domainPosteriors: Array.isArray(row.domain_posteriors_json) ? row.domain_posteriors_json as IntelligenceEventClusterRecord['domainPosteriors'] : [],
    worldStates: Array.isArray(row.world_states_json) ? row.world_states_json as IntelligenceEventClusterRecord['worldStates'] : [],
    primaryHypotheses: Array.isArray(row.primary_hypotheses_json) ? row.primary_hypotheses_json as IntelligenceEventClusterRecord['primaryHypotheses'] : [],
    counterHypotheses: Array.isArray(row.counter_hypotheses_json) ? row.counter_hypotheses_json as IntelligenceEventClusterRecord['counterHypotheses'] : [],
    invalidationConditions:
      Array.isArray(row.invalidation_conditions_json) ? row.invalidation_conditions_json as IntelligenceEventClusterRecord['invalidationConditions'] : [],
    expectedSignals: Array.isArray(row.expected_signals_json) ? row.expected_signals_json as IntelligenceEventClusterRecord['expectedSignals'] : [],
    deliberationStatus: row.deliberation_status,
    reviewState: row.review_state,
    reviewReason: row.review_reason,
    reviewOwner: row.review_owner,
    reviewUpdatedAt: toIso(row.review_updated_at),
    reviewUpdatedBy: row.review_updated_by,
    reviewResolvedAt: toIso(row.review_resolved_at),
    deliberations: Array.isArray(row.deliberations_json) ? row.deliberations_json as IntelligenceEventClusterRecord['deliberations'] : [],
    executionCandidates:
      Array.isArray(row.execution_candidates_json) ? row.execution_candidates_json as IntelligenceEventClusterRecord['executionCandidates'] : [],
    outcomes: Array.isArray(row.outcomes_json) ? row.outcomes_json as IntelligenceEventClusterRecord['outcomes'] : [],
    operatorNoteCount: row.operator_note_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapHypothesisLedgerRow(row: IntelligenceHypothesisLedgerRow): HypothesisLedgerEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    hypothesisId: row.hypothesis_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    confidence: Number(row.confidence),
    rationale: row.rationale,
    status: row.status,
    reviewState: row.review_state,
    reviewReason: row.review_reason,
    reviewOwner: row.review_owner,
    reviewUpdatedAt: toIso(row.review_updated_at),
    reviewUpdatedBy: row.review_updated_by,
    reviewResolvedAt: toIso(row.review_resolved_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapHypothesisEvidenceLinkRow(row: IntelligenceHypothesisEvidenceLinkRow): HypothesisEvidenceLink {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    hypothesisId: row.hypothesis_id,
    linkedClaimId: row.linked_claim_id,
    signalId: row.signal_id,
    relation: row.relation,
    evidenceStrength: row.evidence_strength === null ? null : Number(row.evidence_strength),
    createdAt: row.created_at.toISOString(),
  };
}

function mapInvalidationEntryRow(row: IntelligenceInvalidationEntryRow): IntelligenceInvalidationEntryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    title: row.title,
    description: row.description,
    matcherJson: row.matcher_json ?? {},
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapExpectedSignalEntryRow(row: IntelligenceExpectedSignalEntryRow): IntelligenceExpectedSignalEntryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    signalKey: row.signal_key,
    description: row.description,
    dueAt: toIso(row.due_at),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapOutcomeEntryRow(row: IntelligenceOutcomeEntryRow): IntelligenceOutcomeEntryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    status: row.status,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
  };
}

function mapNarrativeClusterRow(row: IntelligenceNarrativeClusterRow): IntelligenceNarrativeClusterRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    clusterKey: row.cluster_key,
    title: row.title,
    eventFamily: row.event_family,
    topDomainId: row.top_domain_id,
    anchorEntities: normalizeStringArray(row.anchor_entities_json),
    state: row.state,
    eventCount: row.event_count,
    recurringEventCount: row.recurring_event_count,
    divergingEventCount: row.diverging_event_count,
    supportiveHistoryCount: row.supportive_history_count,
    hotspotEventCount: row.hotspot_event_count,
    latestRecurringScore: Number(row.latest_recurring_score),
    driftScore: Number(row.drift_score),
    supportScore: Number(row.support_score),
    contradictionScore: Number(row.contradiction_score),
    timeCoherenceScore: Number(row.time_coherence_score),
    reviewState: row.review_state,
    reviewReason: row.review_reason,
    reviewOwner: row.review_owner,
    reviewUpdatedAt: toIso(row.review_updated_at),
    reviewUpdatedBy: row.review_updated_by,
    reviewResolvedAt: toIso(row.review_resolved_at),
    lastEventAt: toIso(row.last_event_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapNarrativeClusterMembershipRow(
  row: IntelligenceNarrativeClusterMembershipRow,
): IntelligenceNarrativeClusterMembershipRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    clusterId: row.cluster_id,
    eventId: row.event_id,
    relation: row.relation,
    score: Number(row.score),
    daysDelta: row.days_delta,
    isLatest: row.is_latest,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapTemporalNarrativeLedgerEntryRow(
  row: IntelligenceTemporalNarrativeLedgerEntryRow,
): IntelligenceTemporalNarrativeLedgerEntryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    relatedEventId: row.related_event_id,
    relatedEventTitle: row.related_event_title,
    relation: row.relation,
    score: Number(row.score),
    daysDelta: row.days_delta,
    topDomainId: row.top_domain_id,
    graphSupportScore: Number(row.graph_support_score),
    graphContradictionScore: Number(row.graph_contradiction_score),
    graphHotspotCount: row.graph_hotspot_count,
    timeCoherenceScore: Number(row.time_coherence_score),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapExecutionAuditRow(row: IntelligenceExecutionAuditRow): ExecutionAuditRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    candidateId: row.candidate_id,
    connectorId: row.connector_id,
    actionName: row.action_name,
    status: row.status as ExecutionAuditRecord['status'],
    summary: row.summary,
    resultJson: row.result_json ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

function mapOperatorNoteRow(row: IntelligenceOperatorNoteRow): OperatorNoteRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    userId: row.user_id,
    scope: row.scope,
    scopeId: row.scope_id,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}

function mapBridgeRow(row: IntelligenceBridgeDispatchRow): IntelligenceBridgeDispatchRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    kind: row.kind as IntelligenceBridgeDispatchRecord['kind'],
    status: row.status as IntelligenceBridgeDispatchRecord['status'],
    targetId: row.target_id,
    requestJson: row.request_json ?? {},
    responseJson: row.response_json ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapModelRegistryRow(row: IntelligenceModelRegistryRow): ModelRegistryEntryRecord {
  return {
    id: row.id,
    provider: row.provider as ModelRegistryEntryRecord['provider'],
    modelId: row.model_id,
    availability: row.availability as ModelRegistryEntryRecord['availability'],
    contextWindow: row.context_window,
    supportsStructuredOutput: row.supports_structured_output,
    supportsToolUse: row.supports_tool_use,
    supportsLongContext: row.supports_long_context,
    supportsReasoning: row.supports_reasoning,
    costClass: row.cost_class as ModelRegistryEntryRecord['costClass'],
    latencyClass: row.latency_class as ModelRegistryEntryRecord['latencyClass'],
    lastSeenAt: row.last_seen_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapAliasBindingRow(row: IntelligenceAliasBindingRow): CapabilityAliasBindingRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    alias: row.alias,
    provider: row.provider as CapabilityAliasBindingRecord['provider'],
    modelId: row.model_id,
    weight: Number(row.weight),
    fallbackRank: row.fallback_rank,
    canaryPercent: Number(row.canary_percent),
    isActive: row.is_active,
    requiresStructuredOutput: row.requires_structured_output,
    requiresToolUse: row.requires_tool_use,
    requiresLongContext: row.requires_long_context,
    maxCostClass: row.max_cost_class as CapabilityAliasBindingRecord['maxCostClass'],
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapProviderHealthRow(row: IntelligenceProviderHealthRow): ProviderHealthRecord {
  return {
    provider: row.provider as ProviderHealthRecord['provider'],
    available: row.available,
    cooldownUntil: toIso(row.cooldown_until),
    reasonCode: row.reason_code,
    failureCount: row.failure_count,
    updatedAt: toIso(row.updated_at),
  };
}

function mapAliasRolloutRow(row: IntelligenceAliasRolloutRow): AliasRolloutRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    alias: row.alias as AliasRolloutRecord['alias'],
    bindingIds: normalizeStringArray(row.binding_ids_json),
    createdBy: row.created_by,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}

export function createPostgresIntelligenceRepository({ pool }: PostgresIntelligenceRepositoryDeps): IntelligenceRepositoryContract {
  return {
    async getOrCreateIntelligenceWorkspace(input) {
      const existing = await pool.query<IntelligenceWorkspaceRow>(
        `SELECT w.*
         FROM intelligence_workspaces w
         JOIN intelligence_workspace_members m ON m.workspace_id = w.id
         WHERE m.user_id = $1 AND m.role IN ('owner', 'admin')
         ORDER BY w.updated_at DESC
         LIMIT 1`,
        [input.userId]
      );
      if (existing.rows[0]) return mapWorkspaceRow(existing.rows[0]);
      const workspace = await this.createIntelligenceWorkspace({
        userId: input.userId,
        name: input.name?.trim() || 'My Intelligence',
      });
      return workspace;
    },

    async createIntelligenceWorkspace(input) {
      const name = input.name?.trim() || 'My Intelligence';
      const slug = slugify(`${name}-${input.userId.slice(0, 8)}`);
      const inserted = await pool.query<IntelligenceWorkspaceRow>(
        `INSERT INTO intelligence_workspaces (owner_user_id, name, slug)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [input.userId, name, slug]
      );
      const workspace = inserted.rows[0]!;
      await pool.query(
        `INSERT INTO intelligence_workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
        [workspace.id, input.userId]
      );
      return mapWorkspaceRow(workspace);
    },

    async listIntelligenceWorkspaces(input) {
      const { rows } = await pool.query<IntelligenceWorkspaceRow>(
        `SELECT w.*
         FROM intelligence_workspaces w
         JOIN intelligence_workspace_members m ON m.workspace_id = w.id
         WHERE m.user_id = $1
         ORDER BY w.updated_at DESC`,
        [input.userId]
      );
      return rows.map(mapWorkspaceRow);
    },

    async getIntelligenceWorkspaceMembership(input) {
      const { rows } = await pool.query<IntelligenceWorkspaceMemberRow>(
        `SELECT * FROM intelligence_workspace_members
         WHERE workspace_id = $1 AND user_id = $2
         LIMIT 1`,
        [input.workspaceId, input.userId]
      );
      return rows[0] ? mapWorkspaceMemberRow(rows[0]) : null;
    },

    async createIntelligenceSource(input) {
      const { rows } = await pool.query<IntelligenceSourceRow>(
        `INSERT INTO intelligence_sources (
           workspace_id, name, kind, url, source_type, source_tier, poll_minutes, enabled,
           parser_config_json, crawl_config_json, entity_hints_json, metric_hints_json
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb)
         RETURNING *`,
        [
          input.workspaceId,
          input.name,
          input.kind,
          input.url,
          input.sourceType,
          input.sourceTier,
          input.pollMinutes ?? 5,
          input.enabled ?? true,
          JSON.stringify(input.parserConfigJson ?? {}),
          JSON.stringify(defaultCrawlPolicy({
            ...(input.crawlConfigJson as Partial<IntelligenceSourceRecord['crawlPolicy']> | undefined),
            ...(input.crawlPolicy ?? {}),
          })),
          JSON.stringify(input.entityHints ?? []),
          JSON.stringify(input.metricHints ?? []),
        ]
      );
      const base = mapSourceRow(rows[0]!);
      const normalized = {
        ...base,
        connectorCapability: normalizeConnectorCapability(input.connectorCapability),
        health: defaultSourceHealth(),
      };
      const persisted = await pool.query<IntelligenceSourceRow>(
        `UPDATE intelligence_sources
         SET health_json = $3::jsonb,
             connector_capability_json = $4::jsonb,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [
          input.workspaceId,
          base.id,
          JSON.stringify(normalized.health),
          JSON.stringify(normalized.connectorCapability),
        ]
      );
      return mapSourceRow(persisted.rows[0]!);
    },

    async updateIntelligenceSource(input) {
      const existing = await pool.query<IntelligenceSourceRow>(
        `SELECT * FROM intelligence_sources
         WHERE workspace_id = $1 AND id = $2
         LIMIT 1`,
        [input.workspaceId, input.sourceId]
      );
      const current = existing.rows[0];
      if (!current) return null;
      const mapped = mapSourceRow(current);
      const nextHealth = input.health ? defaultSourceHealth({ ...mapped.health, ...input.health }) : mapped.health;
      const nextCrawlPolicy = input.crawlPolicy ? defaultCrawlPolicy({ ...mapped.crawlPolicy, ...input.crawlPolicy }) : mapped.crawlPolicy;
      const nextConnectorCapability =
        typeof input.connectorCapability === 'undefined'
          ? mapped.connectorCapability
          : normalizeConnectorCapability(input.connectorCapability);
      const { rows } = await pool.query<IntelligenceSourceRow>(
        `UPDATE intelligence_sources
         SET enabled = COALESCE($3, enabled),
             poll_minutes = COALESCE($4, poll_minutes),
             parser_config_json = COALESCE($5::jsonb, parser_config_json),
             crawl_config_json = COALESCE($6::jsonb, crawl_config_json),
             health_json = $7::jsonb,
             connector_capability_json = $8::jsonb,
             last_fetched_at = CASE WHEN $9::timestamptz IS NULL THEN last_fetched_at ELSE $9::timestamptz END,
             last_success_at = CASE WHEN $10::timestamptz IS NULL THEN last_success_at ELSE $10::timestamptz END,
             last_error = CASE WHEN $11::text IS NULL THEN last_error ELSE $11 END,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [
          input.workspaceId,
          input.sourceId,
          typeof input.enabled === 'boolean' ? input.enabled : null,
          input.pollMinutes ?? null,
          input.parserConfigJson ? JSON.stringify(input.parserConfigJson) : null,
          JSON.stringify(nextCrawlPolicy),
          JSON.stringify(nextHealth),
          JSON.stringify(nextConnectorCapability),
          typeof input.lastFetchedAt === 'undefined' ? null : input.lastFetchedAt,
          typeof input.lastSuccessAt === 'undefined' ? null : input.lastSuccessAt,
          typeof input.lastError === 'undefined' ? null : input.lastError,
        ]
      );
      return rows[0] ? mapSourceRow(rows[0]) : null;
    },

    async listAllIntelligenceSources(input) {
      const params: unknown[] = [];
      let query = `SELECT * FROM intelligence_sources`;
      if (typeof input.enabled === 'boolean') {
        params.push(input.enabled);
        query += ` WHERE enabled = $1`;
      }
      params.push(input.limit);
      query += ` ORDER BY updated_at DESC LIMIT $${params.length}`;
      const { rows } = await pool.query<IntelligenceSourceRow>(query, params);
      return rows.map(mapSourceRow);
    },

    async listIntelligenceSources(input) {
      const conditions = ['workspace_id = $1'];
      const params: unknown[] = [input.workspaceId];
      if (typeof input.enabled === 'boolean') {
        params.push(input.enabled);
        conditions.push(`enabled = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceSourceRow>(
        `SELECT * FROM intelligence_sources
         WHERE ${conditions.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapSourceRow);
    },

    async toggleIntelligenceSource(input) {
      const { rows } = await pool.query<IntelligenceSourceRow>(
        `UPDATE intelligence_sources
         SET enabled = $3, updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [input.workspaceId, input.sourceId, input.enabled]
      );
      return rows[0] ? mapSourceRow(rows[0]) : null;
    },

    async listIntelligenceSourceCursors(input) {
      const params: unknown[] = [input.workspaceId];
      let query =
        `SELECT * FROM intelligence_source_cursors
         WHERE workspace_id = $1`;
      if (input.sourceId) {
        params.push(input.sourceId);
        query += ` AND source_id = $2`;
      }
      query += ` ORDER BY updated_at DESC`;
      const { rows } = await pool.query<IntelligenceSourceCursorRow>(query, params);
      return rows.map(mapCursorRow);
    },

    async upsertIntelligenceSourceCursor(input) {
      const { rows } = await pool.query<IntelligenceSourceCursorRow>(
        `INSERT INTO intelligence_source_cursors (
           workspace_id, source_id, cursor_text, etag, last_modified, last_seen_published_at, last_fetched_at
         ) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz)
         ON CONFLICT (workspace_id, source_id)
         DO UPDATE SET
           cursor_text = EXCLUDED.cursor_text,
           etag = EXCLUDED.etag,
           last_modified = EXCLUDED.last_modified,
           last_seen_published_at = EXCLUDED.last_seen_published_at,
           last_fetched_at = EXCLUDED.last_fetched_at,
           updated_at = now()
         RETURNING *`,
        [
          input.workspaceId,
          input.sourceId,
          input.cursor ?? null,
          input.etag ?? null,
          input.lastModified ?? null,
          input.lastSeenPublishedAt ?? null,
          input.lastFetchedAt ?? null,
        ]
      );
      return mapCursorRow(rows[0]!);
    },

    async createIntelligenceScanRun(input) {
      const { rows } = await pool.query<IntelligenceScanRunRow>(
        `INSERT INTO intelligence_scan_runs (
           workspace_id, source_id, status, fetched_count, stored_document_count, signal_count,
           clustered_event_count, execution_count, failed_count, error_text, detail_json, started_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::timestamptz)
         RETURNING *`,
        [
          input.workspaceId,
          input.sourceId ?? null,
          input.status ?? 'running',
          input.fetchedCount ?? 0,
          input.storedDocumentCount ?? 0,
          input.signalCount ?? 0,
          input.clusteredEventCount ?? 0,
          input.executionCount ?? 0,
          input.failedCount ?? 0,
          input.error ?? null,
          JSON.stringify(input.detailJson ?? {}),
          input.startedAt ?? new Date().toISOString(),
        ]
      );
      return mapScanRunRow(rows[0]!);
    },

    async createIntelligenceFetchFailure(input) {
      const { rows } = await pool.query<IntelligenceFetchFailureRow>(
        `INSERT INTO intelligence_fetch_failures (
           workspace_id, source_id, url, reason, status_code, retryable, blocked_by_robots
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          input.workspaceId,
          input.sourceId ?? null,
          input.url,
          input.reason,
          input.statusCode ?? null,
          input.retryable ?? false,
          input.blockedByRobots ?? false,
        ]
      );
      return mapFetchFailureRow(rows[0]!);
    },

    async listIntelligenceFetchFailures(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['workspace_id = $1'];
      if (input.sourceId) {
        params.push(input.sourceId);
        filters.push(`source_id = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceFetchFailureRow>(
        `SELECT * FROM intelligence_fetch_failures
         WHERE ${filters.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapFetchFailureRow);
    },

    async completeIntelligenceScanRun(input) {
      const { rows } = await pool.query<IntelligenceScanRunRow>(
        `UPDATE intelligence_scan_runs
         SET status = $3,
             fetched_count = COALESCE($4, fetched_count),
             stored_document_count = COALESCE($5, stored_document_count),
             signal_count = COALESCE($6, signal_count),
             clustered_event_count = COALESCE($7, clustered_event_count),
             execution_count = COALESCE($8, execution_count),
             failed_count = COALESCE($9, failed_count),
             error_text = COALESCE($10, error_text),
             detail_json = detail_json || $11::jsonb,
             finished_at = COALESCE($12::timestamptz, finished_at),
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [
          input.workspaceId,
          input.runId,
          input.status,
          input.fetchedCount ?? null,
          input.storedDocumentCount ?? null,
          input.signalCount ?? null,
          input.clusteredEventCount ?? null,
          input.executionCount ?? null,
          input.failedCount ?? null,
          input.error ?? null,
          JSON.stringify(input.detailJson ?? {}),
          input.finishedAt ?? new Date().toISOString(),
        ]
      );
      return rows[0] ? mapScanRunRow(rows[0]) : null;
    },

    async listIntelligenceScanRuns(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['workspace_id = $1'];
      if (input.sourceId) {
        params.push(input.sourceId);
        filters.push(`source_id = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceScanRunRow>(
        `SELECT * FROM intelligence_scan_runs
         WHERE ${filters.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapScanRunRow);
    },

    async findIntelligenceRawDocumentByFingerprint(input) {
      const { rows } = await pool.query<IntelligenceRawDocumentRow>(
        `SELECT * FROM intelligence_raw_documents
         WHERE workspace_id = $1 AND document_fingerprint = $2
         LIMIT 1`,
        [input.workspaceId, input.documentFingerprint]
      );
      return rows[0] ? mapRawDocumentRow(rows[0]) : null;
    },

    async createIntelligenceRawDocument(input) {
      const { rows } = await pool.query<IntelligenceRawDocumentRow>(
        `INSERT INTO intelligence_raw_documents (
           workspace_id, source_id, source_url, canonical_url, title, summary, raw_text, raw_html,
           published_at, observed_at, language, source_type, source_tier, document_fingerprint, metadata_json
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,$11,$12,$13,$14,$15::jsonb)
         RETURNING *`,
        [
          input.workspaceId,
          input.sourceId ?? null,
          input.sourceUrl,
          input.canonicalUrl,
          input.title,
          input.summary ?? '',
          input.rawText,
          input.rawHtml ?? null,
          input.publishedAt ?? null,
          input.observedAt ?? null,
          input.language ?? null,
          input.sourceType,
          input.sourceTier,
          input.documentFingerprint,
          JSON.stringify(input.metadataJson ?? {}),
        ]
      );
      return mapRawDocumentRow(rows[0]!);
    },

    async listIntelligenceRawDocuments(input) {
      const { rows } = await pool.query<IntelligenceRawDocumentRow>(
        `SELECT * FROM intelligence_raw_documents
         WHERE workspace_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [input.workspaceId, input.limit]
      );
      return rows.map(mapRawDocumentRow);
    },

    async createIntelligenceSignal(input) {
      const { rows } = await pool.query<IntelligenceSignalRow>(
        `INSERT INTO intelligence_signals (
           workspace_id, source_id, document_id, linked_event_id, source_type, source_tier, url,
           published_at, observed_at, language, raw_text, raw_metrics_json, entity_hints_json, trust_hint,
           processing_status, processing_error, processed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17::timestamptz)
         RETURNING *`,
        [
          input.workspaceId,
          input.sourceId ?? null,
          input.documentId,
          input.linkedEventId ?? null,
          input.sourceType,
          input.sourceTier,
          input.url,
          input.publishedAt ?? null,
          input.observedAt ?? null,
          input.language ?? null,
          input.rawText,
          JSON.stringify(input.rawMetrics ?? {}),
          JSON.stringify(input.entityHints ?? []),
          input.trustHint ?? null,
          input.processingStatus ?? 'pending',
          input.processingError ?? null,
          input.processedAt ?? null,
        ]
      );
      return mapSignalRow(rows[0]!);
    },

    async listIntelligenceSignals(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['workspace_id = $1'];
      if (input.sourceId) {
        params.push(input.sourceId);
        filters.push(`source_id = $${params.length}`);
      }
      if (input.processingStatus) {
        params.push(input.processingStatus);
        filters.push(`processing_status = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceSignalRow>(
        `SELECT * FROM intelligence_signals
         WHERE ${filters.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapSignalRow);
    },

    async updateIntelligenceSignalProcessing(input) {
      const { rows } = await pool.query<IntelligenceSignalRow>(
        `UPDATE intelligence_signals
         SET processing_status = $3,
             linked_event_id = CASE
               WHEN $4::boolean THEN $5::uuid
               ELSE linked_event_id
             END,
             processing_error = CASE
               WHEN $6::boolean THEN $7::text
               ELSE processing_error
             END,
             processed_at = CASE
               WHEN $8::boolean THEN $9::timestamptz
               ELSE processed_at
             END
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [
          input.workspaceId,
          input.signalId,
          input.processingStatus,
          typeof input.linkedEventId !== 'undefined',
          typeof input.linkedEventId === 'undefined' ? null : input.linkedEventId,
          typeof input.processingError !== 'undefined',
          typeof input.processingError === 'undefined' ? null : input.processingError,
          typeof input.processedAt !== 'undefined',
          typeof input.processedAt === 'undefined' ? null : input.processedAt,
        ]
      );
      return rows[0] ? mapSignalRow(rows[0]) : null;
    },

    async createIntelligenceLinkedClaim(input) {
      const { rows } = await pool.query<IntelligenceLinkedClaimRow>(
        `INSERT INTO intelligence_linked_claims (
           id, workspace_id, claim_fingerprint, canonical_subject, canonical_predicate, canonical_object,
           predicate_family, time_scope, time_bucket_start, time_bucket_end, stance_distribution_json,
           source_count, contradiction_count, non_social_source_count, supporting_signal_ids_json, last_supported_at, last_contradicted_at,
           review_state, review_reason, review_owner, review_updated_at, review_updated_by, review_resolved_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,$11::jsonb,$12,$13,$14,$15::jsonb,$16::timestamptz,$17::timestamptz,COALESCE($18,'watch'),$19,$20,$21::timestamptz,$22,$23::timestamptz)
         ON CONFLICT (workspace_id, claim_fingerprint)
         DO UPDATE SET
           canonical_subject = EXCLUDED.canonical_subject,
           canonical_predicate = EXCLUDED.canonical_predicate,
           canonical_object = EXCLUDED.canonical_object,
           predicate_family = EXCLUDED.predicate_family,
           time_scope = EXCLUDED.time_scope,
           time_bucket_start = EXCLUDED.time_bucket_start,
           time_bucket_end = EXCLUDED.time_bucket_end,
           stance_distribution_json = EXCLUDED.stance_distribution_json,
           source_count = EXCLUDED.source_count,
           contradiction_count = EXCLUDED.contradiction_count,
           non_social_source_count = EXCLUDED.non_social_source_count,
           supporting_signal_ids_json = EXCLUDED.supporting_signal_ids_json,
           last_supported_at = EXCLUDED.last_supported_at,
           last_contradicted_at = EXCLUDED.last_contradicted_at,
           review_state = CASE
             WHEN $18::text IS NULL THEN intelligence_linked_claims.review_state
             ELSE EXCLUDED.review_state
           END,
           review_reason = CASE
             WHEN $19::text IS NULL THEN intelligence_linked_claims.review_reason
             ELSE EXCLUDED.review_reason
           END,
           review_owner = CASE
             WHEN $20::uuid IS NULL THEN intelligence_linked_claims.review_owner
             ELSE EXCLUDED.review_owner
           END,
           review_updated_at = CASE
             WHEN $21::timestamptz IS NULL THEN intelligence_linked_claims.review_updated_at
             ELSE EXCLUDED.review_updated_at
           END,
           review_updated_by = CASE
             WHEN $22::uuid IS NULL THEN intelligence_linked_claims.review_updated_by
             ELSE EXCLUDED.review_updated_by
           END,
           review_resolved_at = CASE
             WHEN $23::timestamptz IS NULL THEN intelligence_linked_claims.review_resolved_at
             ELSE EXCLUDED.review_resolved_at
           END,
           updated_at = now()
         RETURNING *`,
        [
          input.id ?? null,
          input.workspaceId,
          input.claimFingerprint,
          input.canonicalSubject,
          input.canonicalPredicate,
          input.canonicalObject,
          input.predicateFamily,
          input.timeScope ?? null,
          input.timeBucketStart ?? null,
          input.timeBucketEnd ?? null,
          JSON.stringify(input.stanceDistribution),
          input.sourceCount,
          input.contradictionCount,
          input.nonSocialSourceCount,
          JSON.stringify(input.supportingSignalIds),
          input.lastSupportedAt ?? null,
          input.lastContradictedAt ?? null,
          input.reviewState ?? null,
          input.reviewReason ?? null,
          input.reviewOwner ?? null,
          input.reviewUpdatedAt ?? null,
          input.reviewUpdatedBy ?? null,
          input.reviewResolvedAt ?? null,
        ]
      );
      return mapLinkedClaimRow(rows[0]!);
    },

    async listIntelligenceLinkedClaims(input) {
      const params: unknown[] = [input.workspaceId];
      let joinClause = '';
      const filters = ['lc.workspace_id = $1'];
      if (input.eventId) {
        params.push(input.eventId);
        joinClause = 'INNER JOIN intelligence_event_memberships em ON em.linked_claim_id = lc.id';
        filters.push(`em.event_id = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceLinkedClaimRow>(
        `SELECT DISTINCT lc.* FROM intelligence_linked_claims lc
         ${joinClause}
         WHERE ${filters.join(' AND ')}
         ORDER BY lc.updated_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapLinkedClaimRow);
    },

    async updateIntelligenceLinkedClaimReviewState(input) {
      const { rows } = await pool.query<IntelligenceLinkedClaimRow>(
        `UPDATE intelligence_linked_claims
         SET review_state = $3,
             review_reason = $4,
             review_owner = $5,
             review_updated_at = now(),
             review_updated_by = $6,
             review_resolved_at = $7,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [
          input.workspaceId,
          input.linkedClaimId,
          input.reviewState,
          input.reviewReason ?? null,
          input.reviewOwner ?? null,
          input.updatedBy,
          input.reviewResolvedAt ?? (input.reviewState === 'ignore' ? new Date().toISOString() : null),
        ]
      );
      return rows[0] ? mapLinkedClaimRow(rows[0]) : null;
    },

    async createIntelligenceClaimLink(input) {
      const { rows } = await pool.query<IntelligenceClaimLinkRow>(
        `INSERT INTO intelligence_claim_links (
           id, workspace_id, event_id, linked_claim_id, signal_id, semantic_claim_id, relation, confidence, link_strength
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          input.id ?? null,
          input.workspaceId,
          input.eventId,
          input.linkedClaimId,
          input.signalId,
          input.semanticClaimId,
          input.relation,
          input.confidence,
          input.linkStrength,
        ]
      );
      return mapClaimLinkRow(rows[0]!);
    },

    async listIntelligenceClaimLinks(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['workspace_id = $1'];
      if (input.eventId) {
        params.push(input.eventId);
        filters.push(`event_id = $${params.length}`);
      }
      if (input.linkedClaimId) {
        params.push(input.linkedClaimId);
        filters.push(`linked_claim_id = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceClaimLinkRow>(
        `SELECT * FROM intelligence_claim_links
         WHERE ${filters.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapClaimLinkRow);
    },

    async createIntelligenceLinkedClaimEdge(input) {
      const [leftLinkedClaimId, rightLinkedClaimId] =
        input.leftLinkedClaimId.localeCompare(input.rightLinkedClaimId) <= 0
          ? [input.leftLinkedClaimId, input.rightLinkedClaimId]
          : [input.rightLinkedClaimId, input.leftLinkedClaimId];
      const { rows } = await pool.query<IntelligenceLinkedClaimEdgeRow>(
        `INSERT INTO intelligence_linked_claim_edges (
           id, workspace_id, left_linked_claim_id, right_linked_claim_id, relation, edge_strength, evidence_signal_ids_json, last_observed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)
         ON CONFLICT (workspace_id, left_linked_claim_id, right_linked_claim_id)
         DO UPDATE SET
           relation = EXCLUDED.relation,
           edge_strength = EXCLUDED.edge_strength,
           evidence_signal_ids_json = EXCLUDED.evidence_signal_ids_json,
           last_observed_at = EXCLUDED.last_observed_at,
           updated_at = now()
         RETURNING *`,
        [
          input.id ?? null,
          input.workspaceId,
          leftLinkedClaimId,
          rightLinkedClaimId,
          input.relation,
          input.edgeStrength,
          JSON.stringify(input.evidenceSignalIds),
          input.lastObservedAt ?? null,
        ],
      );
      return mapLinkedClaimEdgeRow(rows[0]!);
    },

    async listIntelligenceLinkedClaimEdges(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['e.workspace_id = $1'];
      let joins = '';
      if (input.linkedClaimId) {
        params.push(input.linkedClaimId);
        filters.push(`(e.left_linked_claim_id = $${params.length} OR e.right_linked_claim_id = $${params.length})`);
      }
      if (input.eventId) {
        params.push(input.eventId);
        joins = `INNER JOIN intelligence_event_memberships em_left
            ON em_left.workspace_id = e.workspace_id
           AND em_left.event_id = $${params.length}
           AND em_left.linked_claim_id = e.left_linked_claim_id
          INNER JOIN intelligence_event_memberships em_right
            ON em_right.workspace_id = e.workspace_id
           AND em_right.event_id = $${params.length}
           AND em_right.linked_claim_id = e.right_linked_claim_id`;
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceLinkedClaimEdgeRow>(
        `SELECT DISTINCT e.*
         FROM intelligence_linked_claim_edges e
         ${joins}
         WHERE ${filters.join(' AND ')}
         ORDER BY e.updated_at DESC
         LIMIT $${params.length}`,
        params,
      );
      return rows.map(mapLinkedClaimEdgeRow);
    },

    async replaceIntelligenceEventMemberships(input) {
      await pool.query(
        `DELETE FROM intelligence_event_memberships
         WHERE workspace_id = $1 AND event_id = $2`,
        [input.workspaceId, input.eventId]
      );
      const rows: EventMembershipRecord[] = [];
      for (const membership of input.memberships) {
        const result = await pool.query<IntelligenceEventMembershipRow>(
          `INSERT INTO intelligence_event_memberships (
             id, workspace_id, event_id, linked_claim_id, role
           ) VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            membership.id ?? null,
            input.workspaceId,
            input.eventId,
            membership.linkedClaimId,
            membership.role,
          ]
        );
        rows.push(mapEventMembershipRow(result.rows[0]!));
      }
      return rows;
    },

    async listIntelligenceEventMemberships(input) {
      const { rows } = await pool.query<IntelligenceEventMembershipRow>(
        `SELECT * FROM intelligence_event_memberships
         WHERE workspace_id = $1 AND event_id = $2
         ORDER BY created_at ASC`,
        [input.workspaceId, input.eventId]
      );
      return rows.map(mapEventMembershipRow);
    },

    async upsertIntelligenceEvent(input) {
      const { rows } = await pool.query<IntelligenceEventRow>(
         `INSERT INTO intelligence_events (
           id, workspace_id, title, summary, event_family, signal_ids_json, document_ids_json, entities_json,
           linked_claim_count, contradiction_count, non_social_corroboration_count, linked_claim_health_score, time_coherence_score,
           graph_support_score, graph_contradiction_score, graph_hotspot_count,
           semantic_claims_json, metric_shocks_json, source_mix_json, corroboration_score, novelty_score,
           structurality_score, actionability_score, risk_band, top_domain_id, time_window_start, time_window_end,
           domain_posteriors_json, world_states_json, primary_hypotheses_json, counter_hypotheses_json,
           invalidation_conditions_json, expected_signals_json, deliberation_status, review_state, review_reason, review_owner, review_updated_at, review_updated_by, review_resolved_at,
           deliberations_json, execution_candidates_json, outcomes_json, operator_note_count
         ) VALUES (
           $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22,$23,$24,$25,$26::timestamptz,$27::timestamptz,
           $28::jsonb,$29::jsonb,$30::jsonb,$31::jsonb,$32::jsonb,$33::jsonb,$34,$35,$36,$37,$38::timestamptz,$39,$40::timestamptz,$41::jsonb,$42::jsonb,$43::jsonb,$44
         )
         ON CONFLICT (id)
         DO UPDATE SET
           workspace_id = EXCLUDED.workspace_id,
           title = EXCLUDED.title,
           summary = EXCLUDED.summary,
           event_family = EXCLUDED.event_family,
           signal_ids_json = EXCLUDED.signal_ids_json,
           document_ids_json = EXCLUDED.document_ids_json,
           entities_json = EXCLUDED.entities_json,
           linked_claim_count = EXCLUDED.linked_claim_count,
           contradiction_count = EXCLUDED.contradiction_count,
           non_social_corroboration_count = EXCLUDED.non_social_corroboration_count,
           linked_claim_health_score = EXCLUDED.linked_claim_health_score,
           time_coherence_score = EXCLUDED.time_coherence_score,
           graph_support_score = EXCLUDED.graph_support_score,
           graph_contradiction_score = EXCLUDED.graph_contradiction_score,
           graph_hotspot_count = EXCLUDED.graph_hotspot_count,
           semantic_claims_json = EXCLUDED.semantic_claims_json,
           metric_shocks_json = EXCLUDED.metric_shocks_json,
           source_mix_json = EXCLUDED.source_mix_json,
           corroboration_score = EXCLUDED.corroboration_score,
           novelty_score = EXCLUDED.novelty_score,
           structurality_score = EXCLUDED.structurality_score,
           actionability_score = EXCLUDED.actionability_score,
           risk_band = EXCLUDED.risk_band,
           top_domain_id = EXCLUDED.top_domain_id,
           time_window_start = EXCLUDED.time_window_start,
           time_window_end = EXCLUDED.time_window_end,
           domain_posteriors_json = EXCLUDED.domain_posteriors_json,
           world_states_json = EXCLUDED.world_states_json,
           primary_hypotheses_json = EXCLUDED.primary_hypotheses_json,
           counter_hypotheses_json = EXCLUDED.counter_hypotheses_json,
           invalidation_conditions_json = EXCLUDED.invalidation_conditions_json,
           expected_signals_json = EXCLUDED.expected_signals_json,
           deliberation_status = EXCLUDED.deliberation_status,
           review_state = EXCLUDED.review_state,
           review_reason = EXCLUDED.review_reason,
           review_owner = EXCLUDED.review_owner,
           review_updated_at = EXCLUDED.review_updated_at,
           review_updated_by = EXCLUDED.review_updated_by,
           review_resolved_at = EXCLUDED.review_resolved_at,
           deliberations_json = EXCLUDED.deliberations_json,
           execution_candidates_json = EXCLUDED.execution_candidates_json,
           outcomes_json = EXCLUDED.outcomes_json,
           operator_note_count = EXCLUDED.operator_note_count,
           updated_at = now()
         RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.title,
          input.summary,
          input.eventFamily,
          JSON.stringify(input.signalIds),
          JSON.stringify(input.documentIds),
          JSON.stringify(input.entities),
          input.linkedClaimCount,
          input.contradictionCount,
          input.nonSocialCorroborationCount,
          input.linkedClaimHealthScore,
          input.timeCoherenceScore,
          input.graphSupportScore,
          input.graphContradictionScore,
          input.graphHotspotCount,
          JSON.stringify(input.semanticClaims),
          JSON.stringify(input.metricShocks),
          JSON.stringify(input.sourceMix ?? {}),
          input.corroborationScore,
          input.noveltyScore,
          input.structuralityScore,
          input.actionabilityScore,
          input.riskBand,
          input.topDomainId,
          input.timeWindowStart ?? null,
          input.timeWindowEnd ?? null,
          JSON.stringify(input.domainPosteriors),
          JSON.stringify(input.worldStates),
          JSON.stringify(input.primaryHypotheses),
          JSON.stringify(input.counterHypotheses),
          JSON.stringify(input.invalidationConditions),
          JSON.stringify(input.expectedSignals),
          input.deliberationStatus,
          input.reviewState,
          input.reviewReason ?? null,
          input.reviewOwner ?? null,
          input.reviewUpdatedAt ?? null,
          input.reviewUpdatedBy ?? null,
          input.reviewResolvedAt ?? null,
          JSON.stringify(input.deliberations),
          JSON.stringify(input.executionCandidates),
          JSON.stringify(input.outcomes),
          input.operatorNoteCount,
        ]
      );
      return mapEventRow(rows[0]!);
    },

    async listIntelligenceEvents(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['workspace_id = $1'];
      if (input.domainId) {
        params.push(input.domainId);
        filters.push(`top_domain_id = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceEventRow>(
        `SELECT * FROM intelligence_events
         WHERE ${filters.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapEventRow);
    },

    async getIntelligenceEventById(input) {
      const { rows } = await pool.query<IntelligenceEventRow>(
        `SELECT * FROM intelligence_events
         WHERE workspace_id = $1 AND id = $2
         LIMIT 1`,
        [input.workspaceId, input.eventId]
      );
      return rows[0] ? mapEventRow(rows[0]) : null;
    },

    async updateIntelligenceEventReviewState(input) {
      const { rows } = await pool.query<IntelligenceEventRow>(
        `UPDATE intelligence_events
         SET review_state = $3,
             review_reason = $4,
             review_owner = $5,
             review_updated_at = now(),
             review_updated_by = $6,
             review_resolved_at = $7,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [
          input.workspaceId,
          input.eventId,
          input.reviewState,
          input.reviewReason ?? null,
          input.reviewOwner ?? null,
          input.updatedBy,
          input.reviewResolvedAt ?? (input.reviewState === 'ignore' ? new Date().toISOString() : null),
        ]
      );
      return rows[0] ? mapEventRow(rows[0]) : null;
    },

    async createIntelligenceOperatorNote(input) {
      const { rows } = await pool.query<IntelligenceOperatorNoteRow>(
        `WITH inserted AS (
          INSERT INTO intelligence_operator_notes (
            id, workspace_id, event_id, user_id, scope, scope_id, note
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING *
        ), bumped AS (
          UPDATE intelligence_events
          SET operator_note_count = operator_note_count + 1,
              updated_at = now()
          WHERE workspace_id = $2 AND id = $3
          RETURNING id
        )
        SELECT * FROM inserted`,
        [
          input.id ?? null,
          input.workspaceId,
          input.eventId,
          input.userId,
          input.scope,
          input.scopeId ?? null,
          input.note,
        ]
      );
      return mapOperatorNoteRow(rows[0]!);
    },

    async listIntelligenceOperatorNotes(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['workspace_id = $1'];
      if (input.eventId) {
        params.push(input.eventId);
        filters.push(`event_id = $${params.length}`);
      }
      if (input.scope) {
        params.push(input.scope);
        filters.push(`scope = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceOperatorNoteRow>(
        `SELECT * FROM intelligence_operator_notes
         WHERE ${filters.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapOperatorNoteRow);
    },

    async createIntelligenceHypothesisLedgerEntry(input) {
      const { rows } = await pool.query<IntelligenceHypothesisLedgerRow>(
        `INSERT INTO intelligence_hypothesis_ledger (
           id, workspace_id, event_id, hypothesis_id, kind, title, summary, confidence, rationale, status,
           review_state, review_reason, review_owner, review_updated_at, review_updated_by, review_resolved_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15,$16::timestamptz)
         RETURNING *`,
        [
          input.id ?? null,
          input.workspaceId,
          input.eventId,
          input.hypothesisId,
          input.kind,
          input.title,
          input.summary,
          input.confidence,
          input.rationale,
          input.status,
          input.reviewState ?? 'watch',
          input.reviewReason ?? null,
          input.reviewOwner ?? null,
          input.reviewUpdatedAt ?? null,
          input.reviewUpdatedBy ?? null,
          input.reviewResolvedAt ?? null,
        ]
      );
      return mapHypothesisLedgerRow(rows[0]!);
    },

    async listIntelligenceHypothesisLedgerEntries(input) {
      const { rows } = await pool.query<IntelligenceHypothesisLedgerRow>(
        `SELECT * FROM intelligence_hypothesis_ledger
         WHERE workspace_id = $1 AND event_id = $2
         ORDER BY updated_at DESC, created_at DESC`,
        [input.workspaceId, input.eventId]
      );
      return rows.map(mapHypothesisLedgerRow);
    },

    async updateIntelligenceHypothesisLedgerReviewState(input) {
      const { rows } = await pool.query<IntelligenceHypothesisLedgerRow>(
        `UPDATE intelligence_hypothesis_ledger
         SET review_state = $3,
             review_reason = $4,
             review_owner = $5,
             review_updated_at = now(),
             review_updated_by = $6,
             review_resolved_at = $7,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [
          input.workspaceId,
          input.entryId,
          input.reviewState,
          input.reviewReason ?? null,
          input.reviewOwner ?? null,
          input.updatedBy,
          input.reviewResolvedAt ?? (input.reviewState === 'ignore' ? new Date().toISOString() : null),
        ]
      );
      return rows[0] ? mapHypothesisLedgerRow(rows[0]) : null;
    },

    async createIntelligenceHypothesisEvidenceLink(input) {
      const { rows } = await pool.query<IntelligenceHypothesisEvidenceLinkRow>(
        `INSERT INTO intelligence_hypothesis_evidence_links (
           id, workspace_id, event_id, hypothesis_id, linked_claim_id, signal_id, relation, evidence_strength
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          input.id ?? null,
          input.workspaceId,
          input.eventId,
          input.hypothesisId,
          input.linkedClaimId ?? null,
          input.signalId ?? null,
          input.relation,
          input.evidenceStrength ?? null,
        ]
      );
      return mapHypothesisEvidenceLinkRow(rows[0]!);
    },

    async listIntelligenceHypothesisEvidenceLinks(input) {
      const { rows } = await pool.query<IntelligenceHypothesisEvidenceLinkRow>(
        `SELECT * FROM intelligence_hypothesis_evidence_links
         WHERE workspace_id = $1 AND event_id = $2
         ORDER BY created_at DESC`,
        [input.workspaceId, input.eventId]
      );
      return rows.map(mapHypothesisEvidenceLinkRow);
    },

    async replaceIntelligenceInvalidationEntries(input) {
      await pool.query(
        `DELETE FROM intelligence_invalidation_entries
         WHERE workspace_id = $1 AND event_id = $2`,
        [input.workspaceId, input.eventId],
      );
      const rows: IntelligenceInvalidationEntryRecord[] = [];
      for (const entry of input.entries) {
        const result = await pool.query<IntelligenceInvalidationEntryRow>(
          `INSERT INTO intelligence_invalidation_entries (
             id, workspace_id, event_id, title, description, matcher_json, status
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
           RETURNING *`,
          [
            entry.id ?? null,
            input.workspaceId,
            input.eventId,
            entry.title,
            entry.description,
            JSON.stringify(entry.matcherJson ?? {}),
            entry.status,
          ],
        );
        rows.push(mapInvalidationEntryRow(result.rows[0]!));
      }
      return rows;
    },

    async listIntelligenceInvalidationEntries(input) {
      const { rows } = await pool.query<IntelligenceInvalidationEntryRow>(
        `SELECT * FROM intelligence_invalidation_entries
         WHERE workspace_id = $1 AND event_id = $2
         ORDER BY updated_at DESC, created_at DESC`,
        [input.workspaceId, input.eventId],
      );
      return rows.map(mapInvalidationEntryRow);
    },

    async replaceIntelligenceExpectedSignalEntries(input) {
      await pool.query(
        `DELETE FROM intelligence_expected_signal_entries
         WHERE workspace_id = $1 AND event_id = $2`,
        [input.workspaceId, input.eventId],
      );
      const rows: IntelligenceExpectedSignalEntryRecord[] = [];
      for (const entry of input.entries) {
        const result = await pool.query<IntelligenceExpectedSignalEntryRow>(
          `INSERT INTO intelligence_expected_signal_entries (
             id, workspace_id, event_id, signal_key, description, due_at, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            entry.id ?? null,
            input.workspaceId,
            input.eventId,
            entry.signalKey,
            entry.description,
            entry.dueAt ?? null,
            entry.status,
          ],
        );
        rows.push(mapExpectedSignalEntryRow(result.rows[0]!));
      }
      return rows;
    },

    async listIntelligenceExpectedSignalEntries(input) {
      const { rows } = await pool.query<IntelligenceExpectedSignalEntryRow>(
        `SELECT * FROM intelligence_expected_signal_entries
         WHERE workspace_id = $1 AND event_id = $2
         ORDER BY updated_at DESC, created_at DESC`,
        [input.workspaceId, input.eventId],
      );
      return rows.map(mapExpectedSignalEntryRow);
    },

    async createIntelligenceOutcomeEntry(input) {
      const { rows } = await pool.query<IntelligenceOutcomeEntryRow>(
        `INSERT INTO intelligence_outcome_entries (
           id, workspace_id, event_id, status, summary
         ) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           summary = EXCLUDED.summary
         RETURNING *`,
        [
          input.id ?? null,
          input.workspaceId,
          input.eventId,
          input.status,
          input.summary,
        ],
      );
      return mapOutcomeEntryRow(rows[0]!);
    },

    async listIntelligenceOutcomeEntries(input) {
      const { rows } = await pool.query<IntelligenceOutcomeEntryRow>(
        `SELECT * FROM intelligence_outcome_entries
         WHERE workspace_id = $1 AND event_id = $2
         ORDER BY created_at DESC`,
        [input.workspaceId, input.eventId],
      );
      return rows.map(mapOutcomeEntryRow);
    },

    async upsertIntelligenceNarrativeCluster(input) {
      const { rows } = await pool.query<IntelligenceNarrativeClusterRow>(
         `INSERT INTO intelligence_narrative_clusters (
           id, workspace_id, cluster_key, title, event_family, top_domain_id, anchor_entities_json, state,
           event_count, recurring_event_count, diverging_event_count, supportive_history_count, hotspot_event_count,
           latest_recurring_score, drift_score, support_score, contradiction_score, time_coherence_score,
           review_state, review_reason, review_owner, review_updated_at, review_updated_by, review_resolved_at,
           last_event_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
           $22::timestamptz,$23,$24::timestamptz,$25::timestamptz
         )
         ON CONFLICT (workspace_id, cluster_key) DO UPDATE SET
           title = EXCLUDED.title,
           event_family = EXCLUDED.event_family,
           top_domain_id = EXCLUDED.top_domain_id,
           anchor_entities_json = EXCLUDED.anchor_entities_json,
           state = EXCLUDED.state,
           event_count = EXCLUDED.event_count,
           recurring_event_count = EXCLUDED.recurring_event_count,
           diverging_event_count = EXCLUDED.diverging_event_count,
           supportive_history_count = EXCLUDED.supportive_history_count,
           hotspot_event_count = EXCLUDED.hotspot_event_count,
           latest_recurring_score = EXCLUDED.latest_recurring_score,
           drift_score = EXCLUDED.drift_score,
           support_score = EXCLUDED.support_score,
           contradiction_score = EXCLUDED.contradiction_score,
           time_coherence_score = EXCLUDED.time_coherence_score,
           review_state = COALESCE(EXCLUDED.review_state, intelligence_narrative_clusters.review_state),
           review_reason = COALESCE(EXCLUDED.review_reason, intelligence_narrative_clusters.review_reason),
           review_owner = COALESCE(EXCLUDED.review_owner, intelligence_narrative_clusters.review_owner),
           review_updated_at = COALESCE(EXCLUDED.review_updated_at, intelligence_narrative_clusters.review_updated_at),
           review_updated_by = COALESCE(EXCLUDED.review_updated_by, intelligence_narrative_clusters.review_updated_by),
           review_resolved_at = COALESCE(EXCLUDED.review_resolved_at, intelligence_narrative_clusters.review_resolved_at),
           last_event_at = EXCLUDED.last_event_at,
           updated_at = now()
         RETURNING *`,
        [
          input.id ?? null,
          input.workspaceId,
          input.clusterKey,
          input.title,
          input.eventFamily,
          input.topDomainId ?? null,
          JSON.stringify(input.anchorEntities),
          input.state,
          input.eventCount,
          input.recurringEventCount,
          input.divergingEventCount,
          input.supportiveHistoryCount,
          input.hotspotEventCount,
          input.latestRecurringScore,
          input.driftScore,
          input.supportScore,
          input.contradictionScore,
          input.timeCoherenceScore,
          input.reviewState ?? 'watch',
          input.reviewReason ?? null,
          input.reviewOwner ?? null,
          input.reviewUpdatedAt ?? null,
          input.reviewUpdatedBy ?? null,
          input.reviewResolvedAt ?? null,
          input.lastEventAt ?? null,
        ],
      );
      return mapNarrativeClusterRow(rows[0]!);
    },

    async listIntelligenceNarrativeClusters(input) {
      const { rows } = await pool.query<IntelligenceNarrativeClusterRow>(
        `SELECT * FROM intelligence_narrative_clusters
         WHERE workspace_id = $1
         ORDER BY updated_at DESC, created_at DESC
         LIMIT $2`,
        [input.workspaceId, input.limit],
      );
      return rows.map(mapNarrativeClusterRow);
    },

    async getIntelligenceNarrativeClusterById(input) {
      const { rows } = await pool.query<IntelligenceNarrativeClusterRow>(
        `SELECT * FROM intelligence_narrative_clusters
         WHERE workspace_id = $1 AND id = $2
         LIMIT 1`,
        [input.workspaceId, input.clusterId],
      );
      return rows[0] ? mapNarrativeClusterRow(rows[0]) : null;
    },

    async updateIntelligenceNarrativeClusterReviewState(input) {
      const { rows } = await pool.query<IntelligenceNarrativeClusterRow>(
        `UPDATE intelligence_narrative_clusters
         SET review_state = $3,
             review_reason = $4,
             review_owner = $5,
             review_updated_at = now(),
             review_updated_by = $6,
             review_resolved_at = $7,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [
          input.workspaceId,
          input.clusterId,
          input.reviewState,
          input.reviewReason ?? null,
          input.reviewOwner ?? null,
          input.updatedBy,
          input.reviewResolvedAt ?? (input.reviewState === 'ignore' ? new Date().toISOString() : null),
        ],
      );
      return rows[0] ? mapNarrativeClusterRow(rows[0]) : null;
    },

    async upsertIntelligenceNarrativeClusterMembership(input) {
      const { rows } = await pool.query<IntelligenceNarrativeClusterMembershipRow>(
        `INSERT INTO intelligence_narrative_cluster_memberships (
           id, workspace_id, cluster_id, event_id, relation, score, days_delta, is_latest
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (workspace_id, event_id) DO UPDATE SET
           cluster_id = EXCLUDED.cluster_id,
           relation = EXCLUDED.relation,
           score = EXCLUDED.score,
           days_delta = EXCLUDED.days_delta,
           is_latest = EXCLUDED.is_latest,
           updated_at = now()
         RETURNING *`,
        [
          input.id ?? null,
          input.workspaceId,
          input.clusterId,
          input.eventId,
          input.relation,
          input.score,
          input.daysDelta ?? null,
          input.isLatest,
        ],
      );
      return mapNarrativeClusterMembershipRow(rows[0]!);
    },

    async listIntelligenceNarrativeClusterMemberships(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['workspace_id = $1'];
      if (input.clusterId) {
        params.push(input.clusterId);
        filters.push(`cluster_id = $${params.length}`);
      }
      if (input.eventId) {
        params.push(input.eventId);
        filters.push(`event_id = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceNarrativeClusterMembershipRow>(
        `SELECT * FROM intelligence_narrative_cluster_memberships
         WHERE ${filters.join(' AND ')}
         ORDER BY updated_at DESC, created_at DESC
         LIMIT $${params.length}`,
        params,
      );
      return rows.map(mapNarrativeClusterMembershipRow);
    },

    async replaceIntelligenceTemporalNarrativeLedgerEntries(input) {
      await pool.query(
        `DELETE FROM intelligence_temporal_narrative_ledger
         WHERE workspace_id = $1 AND event_id = $2`,
        [input.workspaceId, input.eventId],
      );
      const rows: IntelligenceTemporalNarrativeLedgerEntryRecord[] = [];
      for (const entry of input.entries) {
        const result = await pool.query<IntelligenceTemporalNarrativeLedgerEntryRow>(
          `INSERT INTO intelligence_temporal_narrative_ledger (
             id, workspace_id, event_id, related_event_id, related_event_title, relation, score, days_delta,
             top_domain_id, graph_support_score, graph_contradiction_score, graph_hotspot_count, time_coherence_score
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            entry.id ?? null,
            input.workspaceId,
            input.eventId,
            entry.relatedEventId,
            entry.relatedEventTitle,
            entry.relation,
            entry.score,
            entry.daysDelta ?? null,
            entry.topDomainId ?? null,
            entry.graphSupportScore,
            entry.graphContradictionScore,
            entry.graphHotspotCount,
            entry.timeCoherenceScore,
          ],
        );
        rows.push(mapTemporalNarrativeLedgerEntryRow(result.rows[0]!));
      }
      return rows;
    },

    async listIntelligenceTemporalNarrativeLedgerEntries(input) {
      const { rows } = await pool.query<IntelligenceTemporalNarrativeLedgerEntryRow>(
        `SELECT * FROM intelligence_temporal_narrative_ledger
         WHERE workspace_id = $1 AND event_id = $2
         ORDER BY updated_at DESC, created_at DESC`,
        [input.workspaceId, input.eventId],
      );
      return rows.map(mapTemporalNarrativeLedgerEntryRow);
    },

    async createIntelligenceExecutionAudit(input) {
      const { rows } = await pool.query<IntelligenceExecutionAuditRow>(
        `INSERT INTO intelligence_execution_audits (
           id, workspace_id, event_id, candidate_id, connector_id, action_name, status, summary, result_json
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         RETURNING *`,
        [
          input.id ?? null,
          input.workspaceId,
          input.eventId,
          input.candidateId,
          input.connectorId ?? null,
          input.actionName ?? null,
          input.status,
          input.summary,
          JSON.stringify(input.resultJson ?? {}),
        ]
      );
      return mapExecutionAuditRow(rows[0]!);
    },

    async listIntelligenceExecutionAudits(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['workspace_id = $1'];
      if (input.eventId) {
        params.push(input.eventId);
        filters.push(`event_id = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceExecutionAuditRow>(
        `SELECT * FROM intelligence_execution_audits
         WHERE ${filters.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapExecutionAuditRow);
    },

    async createIntelligenceBridgeDispatch(input) {
      const { rows } = await pool.query<IntelligenceBridgeDispatchRow>(
        `INSERT INTO intelligence_bridge_dispatches (
           workspace_id, event_id, kind, status, target_id, request_json, response_json
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
         RETURNING *`,
        [
          input.workspaceId,
          input.eventId,
          input.kind,
          input.status ?? 'pending',
          input.targetId ?? null,
          JSON.stringify(input.requestJson ?? {}),
          JSON.stringify(input.responseJson ?? {}),
        ]
      );
      return mapBridgeRow(rows[0]!);
    },

    async listIntelligenceBridgeDispatches(input) {
      const params: unknown[] = [input.workspaceId];
      const filters = ['workspace_id = $1'];
      if (input.eventId) {
        params.push(input.eventId);
        filters.push(`event_id = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query<IntelligenceBridgeDispatchRow>(
        `SELECT * FROM intelligence_bridge_dispatches
         WHERE ${filters.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapBridgeRow);
    },

    async upsertIntelligenceModelRegistryEntries(input) {
      const rows: ModelRegistryEntryRecord[] = [];
      for (const entry of input.entries) {
        const result = await pool.query<IntelligenceModelRegistryRow>(
          `INSERT INTO intelligence_model_registry (
             provider, model_id, availability, context_window, supports_structured_output, supports_tool_use,
             supports_long_context, supports_reasoning, cost_class, latency_class, last_seen_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)
           ON CONFLICT (provider, model_id)
           DO UPDATE SET
             availability = EXCLUDED.availability,
             context_window = EXCLUDED.context_window,
             supports_structured_output = EXCLUDED.supports_structured_output,
             supports_tool_use = EXCLUDED.supports_tool_use,
             supports_long_context = EXCLUDED.supports_long_context,
             supports_reasoning = EXCLUDED.supports_reasoning,
             cost_class = EXCLUDED.cost_class,
             latency_class = EXCLUDED.latency_class,
             last_seen_at = EXCLUDED.last_seen_at,
             updated_at = now()
           RETURNING *`,
          [
            entry.provider,
            entry.modelId,
            entry.availability,
            entry.contextWindow,
            entry.supportsStructuredOutput,
            entry.supportsToolUse,
            entry.supportsLongContext,
            entry.supportsReasoning,
            entry.costClass,
            entry.latencyClass,
            entry.lastSeenAt,
          ]
        );
        rows.push(mapModelRegistryRow(result.rows[0]!));
      }
      return rows;
    },

    async listIntelligenceModelRegistryEntries(input) {
      const params: unknown[] = [];
      let query = `SELECT * FROM intelligence_model_registry`;
      if (input?.provider) {
        params.push(input.provider);
        query += ` WHERE provider = $1`;
      }
      query += ` ORDER BY updated_at DESC, provider, model_id`;
      const { rows } = await pool.query<IntelligenceModelRegistryRow>(query, params);
      return rows.map(mapModelRegistryRow);
    },

    async replaceIntelligenceProviderHealth(input) {
      await pool.query(`DELETE FROM intelligence_provider_health`);
      const rows: ProviderHealthRecord[] = [];
      for (const entry of input.entries) {
        const inserted = await pool.query<IntelligenceProviderHealthRow>(
          `INSERT INTO intelligence_provider_health (
             provider, available, cooldown_until, reason_code, failure_count, updated_at
           ) VALUES ($1,$2,$3::timestamptz,$4,$5,$6::timestamptz)
           RETURNING *`,
          [
            entry.provider,
            entry.available,
            entry.cooldownUntil ?? null,
            entry.reasonCode ?? null,
            entry.failureCount,
            entry.updatedAt ?? null,
          ]
        );
        rows.push(mapProviderHealthRow(inserted.rows[0]!));
      }
      return rows.sort((left, right) => left.provider.localeCompare(right.provider));
    },

    async listIntelligenceProviderHealth() {
      const { rows } = await pool.query<IntelligenceProviderHealthRow>(
        `SELECT * FROM intelligence_provider_health
         ORDER BY provider ASC`
      );
      return rows.map(mapProviderHealthRow);
    },

    async replaceIntelligenceAliasBindings(input) {
      await pool.query(
        `DELETE FROM intelligence_model_alias_bindings
         WHERE alias = $1 AND COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000') =
               COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000')`,
        [input.alias, input.workspaceId ?? null]
      );
      const rows: CapabilityAliasBindingRecord[] = [];
      for (const binding of input.bindings) {
        const inserted = await pool.query<IntelligenceAliasBindingRow>(
          `INSERT INTO intelligence_model_alias_bindings (
             workspace_id, alias, provider, model_id, weight, fallback_rank, canary_percent, is_active,
             requires_structured_output, requires_tool_use, requires_long_context, max_cost_class, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            input.workspaceId ?? null,
            input.alias,
            binding.provider,
            binding.modelId,
            binding.weight ?? 1,
            binding.fallbackRank ?? 1,
            binding.canaryPercent ?? 0,
            binding.isActive ?? true,
            binding.requiresStructuredOutput ?? false,
            binding.requiresToolUse ?? false,
            binding.requiresLongContext ?? false,
            binding.maxCostClass ?? null,
            input.updatedBy ?? binding.updatedBy ?? null,
          ]
        );
        rows.push(mapAliasBindingRow(inserted.rows[0]!));
      }
      return rows;
    },

    async listIntelligenceAliasBindings(input) {
      const params: unknown[] = [];
      const filters: string[] = [];
      if (typeof input?.workspaceId !== 'undefined') {
        params.push(input.workspaceId ?? null);
        filters.push(`COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000') = COALESCE($${params.length}::uuid, '00000000-0000-0000-0000-000000000000')`);
      }
      if (input?.alias) {
        params.push(input.alias);
        filters.push(`alias = $${params.length}`);
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const { rows } = await pool.query<IntelligenceAliasBindingRow>(
        `SELECT * FROM intelligence_model_alias_bindings
         ${where}
         ORDER BY alias, fallback_rank ASC, weight DESC`,
        params
      );
      return rows.map(mapAliasBindingRow);
    },

    async createIntelligenceAliasRollout(input) {
      const { rows } = await pool.query<IntelligenceAliasRolloutRow>(
        `INSERT INTO intelligence_alias_rollouts (
           workspace_id, alias, binding_ids_json, created_by, note
         ) VALUES ($1,$2,$3::jsonb,$4,$5)
         RETURNING *`,
        [
          input.workspaceId ?? null,
          input.alias,
          JSON.stringify(input.bindingIds),
          input.createdBy ?? null,
          input.note ?? null,
        ]
      );
      return mapAliasRolloutRow(rows[0]!);
    },

    async listIntelligenceAliasRollouts(input) {
      const params: unknown[] = [];
      const filters: string[] = [];
      if (typeof input?.workspaceId !== 'undefined') {
        params.push(input.workspaceId ?? null);
        filters.push(
          `COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000') = COALESCE($${params.length}::uuid, '00000000-0000-0000-0000-000000000000')`
        );
      }
      if (input?.alias) {
        params.push(input.alias);
        filters.push(`alias = $${params.length}`);
      }
      params.push(input?.limit ?? 50);
      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const { rows } = await pool.query<IntelligenceAliasRolloutRow>(
        `SELECT * FROM intelligence_alias_rollouts
         ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return rows.map(mapAliasRolloutRow);
    },
  };
}
