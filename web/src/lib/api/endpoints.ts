import { apiRequest, apiRequestEnvelope, buildApiUrl, createClientRequestId, tryParseSseData } from "@/lib/api/client";
import type {
  AssistantContextCreateRequest,
  AssistantContextEventRecord,
  AssistantContextGroundingEvidenceData,
  AssistantContextEventStreamEnvelope,
  AssistantContextRecord,
  AssistantContextRunRequest,
  AssistantContextRunMeta,
  AssistantContextStatus,
  AssistantContextUpdateRequest,
  AiRespondData,
  AiRespondRequest,
  AuthLoginRequest,
  AuthConfigData,
  AuthMeData,
  AuthSessionData,
  AuthStaticTokenLoginData,
  AuthStaticTokenLoginRequest,
  AuthSignupRequest,
  CouncilAgentRespondedStreamEnvelope,
  CouncilRoundCompletedStreamEnvelope,
  CouncilRoundStartedStreamEnvelope,
  CouncilRunRecord,
  CouncilRunRequest,
  CouncilRunStreamEnvelope,
  DashboardOverviewData,
  DashboardOverviewStreamEnvelope,
  ExecutionRunRecord,
  ExecutionRunRequest,
  ExecutionRunStreamEnvelope,
  HealthPayload,
  JarvisRequest,
  JarvisRequestResult,
  JarvisSessionDetail,
  JarvisSessionEventRecord,
  JarvisSessionRecord,
  SkillFindResult,
  SkillId,
  SkillRecord,
  SkillResourceDetail,
  SkillUseResult,
  WorkspaceChunkRecord,
  WorkspaceRecord,
  WorkspaceSpawnResult,
  BriefingRecord,
  BriefingGenerateResult,
  DossierDetail,
  DossierRecord,
  DossierRefreshResult,
  SystemNotification,
  WatcherKind,
  WatcherRecord,
  WatcherRunRecord,
  MemorySnapshotData,
  MemorySummaryData,
  MemoryContextData,
  MemoryNoteKind,
  MemoryNoteRecord,
  MissionCreateRequest,
  MissionRecord,
  MissionStreamEnvelope,
  MissionStatus,
  MissionUpdateRequest,
  ProposalDecisionRequest,
  ProviderModelCatalogEntry,
  ProviderName,
  ProviderAvailability,
  ProviderConnectionTestResult,
  ProviderCredentialMutationResult,
  ProviderCredentialRecord,
  ProviderCredentialSelectionMode,
  UserProviderCredentialRecord,
  UserProviderConnectionTestResult,
  ProviderOauthStartResult,
  ModelControlFeatureKey,
  UserModelSelectionPreference,
  ModelRecommendationRun,
  AiInvocationTraceRecord,
  AiInvocationMetrics,
  RadarDecision,
  RadarAutonomyDecisionRecord,
  RadarControlSettingsRecord,
  RadarControlUpdateRequest,
  RadarFeedSourceRecord,
  RadarDomainPackMetricRecord,
  RadarDomainPackDefinition,
  RadarDomainPosteriorRecord,
  RadarEventRecord,
  RadarIngestRunRecord,
  RadarIngestRequest,
  RadarItemRecord,
  RadarItemStatus,
  RadarOperatorFeedbackRecord,
  RadarPromotionDecision,
  RadarPromotionResult,
  RadarRecommendationRecord,
  ReportsOverviewData,
  SettingsOverviewData,
  TaskCreateRequest,
  TaskListQuery,
  TaskRecord,
  TelegramReportRecord,
  TelegramReportStreamEnvelope,
  TelegramReportStatus,
  TelegramReportsStreamEnvelope,
  TaskStreamEnvelope,
  UpgradeProposalRecord,
  UpgradeRunRecord,
  UpgradeRunRequest,
  UpgradeStatus,
  GeneratePlanRequest,
  GeneratePlanResponse,
  IntelligenceBridgeDispatchRecord,
  AliasRolloutRecord,
  ClaimLinkRecord,
  EventReviewState,
  ExecutionAuditRecord,
  HypothesisEvidenceLink,
  IntelligenceHypothesisEvidenceSummary,
  HypothesisLedgerEntry,
  IntelligenceCapabilityAlias,
  IntelligenceCapabilityAliasBinding,
  IntelligenceDomainId,
  IntelligenceEventClusterRecord,
  IntelligenceEventGraphNeighborhood,
  IntelligenceEventGraphSummary,
  IntelligenceHotspotCluster,
  IntelligenceExpectedSignalEntryRecord,
  IntelligenceFetchFailureRecord,
  IntelligenceIdentityCollisionRecord,
  IntelligenceInvalidationEntryRecord,
  IntelligenceModelRegistryEntry,
  IntelligenceOutcomeEntryRecord,
  IntelligenceNarrativeClusterMemberSummary,
  IntelligenceNarrativeClusterLedgerEntryRecord,
  IntelligenceNarrativeClusterTimelineRecord,
  IntelligenceNarrativeClusterTrendSummary,
  IntelligenceNarrativeClusterGraphSummary,
  IntelligenceNarrativeClusterRecord,
  IntelligenceProvisionalEventRecord,
  IntelligenceQuarantinedSignalRecord,
  IntelligenceRelatedHistoricalEventSummary,
  IntelligenceTemporalNarrativeLedgerEntryRecord,
  IntelligenceSignalRetryResult,
  IntelligenceSourceRetryResult,
  LinkedClaimEdgeRecord,
  LinkedClaimRecord,
  OperatorNoteRecord,
  ProviderHealthRecord,
  SemanticBacklogStatus,
  IntelligenceScanRunRecord,
  IntelligenceSourceRecord,
  IntelligenceStaleEventPreview,
  IntelligenceStaleMaintenanceWorkerRun,
  IntelligenceSemanticWorkerRun,
  IntelligenceBulkEventRebuildResult,
  IntelligenceEventRebuildResult,
  IntelligenceWorkspaceRebuildResult,
  IntelligenceWorkspaceRecord,
  IntelligenceScannerWorkerRun,
  IntelligenceCatalogSyncRun,
  IntelligenceWorkerStatus,
} from "@/lib/api/types";

export async function getHealth(): Promise<HealthPayload> {
  return apiRequest<HealthPayload>("/health", { method: "GET" });
}

export async function authSignup(payload: AuthSignupRequest): Promise<AuthSessionData> {
  return apiRequest<AuthSessionData>("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function authLogin(payload: AuthLoginRequest): Promise<AuthSessionData> {
  return apiRequest<AuthSessionData>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function authStaticTokenLogin(payload: AuthStaticTokenLoginRequest): Promise<AuthStaticTokenLoginData> {
  return apiRequest<AuthStaticTokenLoginData>("/api/v1/auth/static-token/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function authMe(): Promise<AuthMeData> {
  return apiRequest<AuthMeData>("/api/v1/auth/me", { method: "GET" });
}

export async function authConfig(): Promise<AuthConfigData> {
  return apiRequest<AuthConfigData>("/api/v1/auth/config", { method: "GET" });
}

export async function authLogout(): Promise<{ revoked: boolean }> {
  return apiRequest<{ revoked: boolean }>("/api/v1/auth/logout", { method: "POST" });
}

export async function listIntelligenceWorkspaces(): Promise<{ workspaces: IntelligenceWorkspaceRecord[] }> {
  return apiRequest<{ workspaces: IntelligenceWorkspaceRecord[] }>("/api/v1/intelligence/workspaces", { method: "GET" });
}

export async function createIntelligenceWorkspace(payload: { name?: string }): Promise<{
  workspace: IntelligenceWorkspaceRecord;
}> {
  return apiRequest("/api/v1/intelligence/workspaces", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listIntelligenceSources(query: { workspace_id?: string } = {}): Promise<{
  workspace_id: string;
  workspaces: IntelligenceWorkspaceRecord[];
  sources: IntelligenceSourceRecord[];
  scanner_worker: IntelligenceWorkerStatus<IntelligenceScannerWorkerRun>;
  semantic_worker: IntelligenceWorkerStatus<IntelligenceSemanticWorkerRun>;
}> {
  return apiRequest("/api/v1/intelligence/sources", { method: "GET", query });
}

export async function createIntelligenceSource(payload: {
  workspace_id?: string;
  name: string;
  kind: IntelligenceSourceRecord["kind"];
  url: string;
  source_type: IntelligenceSourceRecord["sourceType"];
  source_tier: IntelligenceSourceRecord["sourceTier"];
  poll_minutes?: number;
  parser_config_json?: Record<string, unknown>;
  crawl_config_json?: Record<string, unknown>;
  crawl_policy?: {
    allow_domains?: string[];
    deny_domains?: string[];
    respect_robots?: boolean;
    max_depth?: number;
    max_pages_per_run?: number;
    revisit_cooldown_minutes?: number;
    per_domain_rate_limit_per_minute?: number;
  };
  connector_capability?: {
    connector_id: string;
    write_allowed: boolean;
    destructive: boolean;
    requires_human: boolean;
    schema_id?: string | null;
    allowed_actions?: string[];
  } | null;
  entity_hints?: string[];
  metric_hints?: string[];
}): Promise<{ source: IntelligenceSourceRecord }> {
  return apiRequest("/api/v1/intelligence/sources", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function toggleIntelligenceSource(sourceId: string, payload: {
  workspace_id?: string;
  enabled: boolean;
}): Promise<{ source: IntelligenceSourceRecord }> {
  return apiRequest(`/api/v1/intelligence/sources/${sourceId}/toggle`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function retryIntelligenceSource(sourceId: string, payload: {
  workspace_id?: string;
}): Promise<{ workspace_id: string; result: IntelligenceSourceRetryResult }> {
  return apiRequest(`/api/v1/intelligence/sources/${sourceId}/retry`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listIntelligenceRuns(query: {
  workspace_id?: string;
  source_id?: string;
  limit?: number;
} = {}): Promise<{
  workspace_id: string;
  runs: IntelligenceScanRunRecord[];
  scanner_worker: IntelligenceWorkerStatus<IntelligenceScannerWorkerRun>;
  semantic_worker: IntelligenceWorkerStatus<IntelligenceSemanticWorkerRun>;
  stale_maintenance_worker: IntelligenceWorkerStatus<IntelligenceStaleMaintenanceWorkerRun>;
  model_sync_worker: IntelligenceWorkerStatus<IntelligenceCatalogSyncRun>;
  semantic_backlog: SemanticBacklogStatus;
}> {
  return apiRequest("/api/v1/intelligence/runs", { method: "GET", query });
}

export async function listIntelligenceEvents(query: {
  workspace_id?: string;
  domain_id?: IntelligenceDomainId;
  limit?: number;
} = {}): Promise<{
  workspace_id: string;
  events: IntelligenceEventClusterRecord[];
}> {
  return apiRequest("/api/v1/intelligence/events", { method: "GET", query });
}

export async function getIntelligenceEvent(eventId: string, query: { workspace_id?: string } = {}): Promise<{
  workspace_id: string;
  event: IntelligenceEventClusterRecord;
  linked_claims: LinkedClaimRecord[];
  claim_links: ClaimLinkRecord[];
  review_state: EventReviewState;
  bridge_dispatches: IntelligenceBridgeDispatchRecord[];
  execution_audit: ExecutionAuditRecord[];
  operator_notes: OperatorNoteRecord[];
  invalidation_entries: IntelligenceInvalidationEntryRecord[];
  expected_signal_entries: IntelligenceExpectedSignalEntryRecord[];
  outcome_entries: IntelligenceOutcomeEntryRecord[];
  narrative_cluster: IntelligenceNarrativeClusterRecord | null;
  narrative_cluster_members: IntelligenceNarrativeClusterMemberSummary[];
  temporal_narrative_ledger: IntelligenceTemporalNarrativeLedgerEntryRecord[];
  related_historical_events: IntelligenceRelatedHistoricalEventSummary[];
}> {
  return apiRequest(`/api/v1/intelligence/events/${eventId}`, { method: "GET", query });
}

export async function getIntelligenceEventGraph(eventId: string, query: { workspace_id?: string } = {}): Promise<{
  workspace_id: string;
  event_id: string;
  summary: IntelligenceEventGraphSummary;
  nodes: LinkedClaimRecord[];
  edges: Array<LinkedClaimEdgeRecord & { evidence_signal_count: number }>;
  hotspots: string[];
  neighborhoods: IntelligenceEventGraphNeighborhood[];
  hotspot_clusters: IntelligenceHotspotCluster[];
  related_historical_events: IntelligenceRelatedHistoricalEventSummary[];
}> {
  return apiRequest(`/api/v1/intelligence/events/${eventId}/graph`, { method: "GET", query });
}

export async function getIntelligenceHypotheses(eventId: string, query: { workspace_id?: string } = {}): Promise<{
  workspace_id: string;
  event_id: string;
  primary_hypotheses: IntelligenceEventClusterRecord["primaryHypotheses"];
  counter_hypotheses: IntelligenceEventClusterRecord["counterHypotheses"];
  invalidation_conditions: IntelligenceEventClusterRecord["invalidationConditions"];
  expected_signals: IntelligenceEventClusterRecord["expectedSignals"];
  world_states: IntelligenceEventClusterRecord["worldStates"];
  deliberations: IntelligenceEventClusterRecord["deliberations"];
  outcomes: IntelligenceEventClusterRecord["outcomes"];
  ledger_entries: HypothesisLedgerEntry[];
  evidence_links: HypothesisEvidenceLink[];
  evidence_summary: IntelligenceHypothesisEvidenceSummary[];
  invalidation_entries: IntelligenceInvalidationEntryRecord[];
  expected_signal_entries: IntelligenceExpectedSignalEntryRecord[];
  outcome_entries: IntelligenceOutcomeEntryRecord[];
}> {
  return apiRequest(`/api/v1/intelligence/hypotheses/${eventId}`, { method: "GET", query });
}

export async function listIntelligenceNarrativeClusters(query: {
  workspace_id?: string;
  limit?: number;
} = {}): Promise<{
  workspace_id: string;
  narrative_clusters: IntelligenceNarrativeClusterRecord[];
}> {
  return apiRequest("/api/v1/intelligence/narrative-clusters", { method: "GET", query });
}

export async function getIntelligenceNarrativeCluster(clusterId: string, query: { workspace_id?: string } = {}): Promise<{
  workspace_id: string;
  narrative_cluster: IntelligenceNarrativeClusterRecord;
  memberships: IntelligenceNarrativeClusterMemberSummary[];
  recent_events: IntelligenceEventClusterRecord[];
  ledger_entries: IntelligenceNarrativeClusterLedgerEntryRecord[];
  operator_notes: OperatorNoteRecord[];
}> {
  return apiRequest(`/api/v1/intelligence/narrative-clusters/${clusterId}`, { method: "GET", query });
}

export async function getIntelligenceNarrativeClusterTimeline(clusterId: string, query: { workspace_id?: string } = {}): Promise<{
  workspace_id: string;
  cluster_id: string;
  trend_summary: IntelligenceNarrativeClusterTrendSummary;
  timeline: IntelligenceNarrativeClusterTimelineRecord[];
}> {
  return apiRequest(`/api/v1/intelligence/narrative-clusters/${clusterId}/timeline`, { method: "GET", query });
}

export async function getIntelligenceNarrativeClusterGraph(clusterId: string, query: { workspace_id?: string } = {}): Promise<{
  workspace_id: string;
  cluster_id: string;
  summary: IntelligenceNarrativeClusterGraphSummary;
  nodes: LinkedClaimRecord[];
  edges: Array<LinkedClaimEdgeRecord & { evidence_signal_count: number }>;
  hotspots: string[];
  neighborhoods: IntelligenceEventGraphNeighborhood[];
  hotspot_clusters: IntelligenceHotspotCluster[];
  recent_events: IntelligenceEventClusterRecord[];
}> {
  return apiRequest(`/api/v1/intelligence/narrative-clusters/${clusterId}/graph`, { method: "GET", query });
}

export async function listIntelligenceFetchFailures(query: {
  workspace_id?: string;
  source_id?: string;
  limit?: number;
} = {}): Promise<{
  workspace_id: string;
  fetch_failures: IntelligenceFetchFailureRecord[];
}> {
  return apiRequest("/api/v1/intelligence/fetch-failures", { method: "GET", query });
}

export async function listIntelligenceStaleEvents(query: {
  workspace_id?: string;
  limit?: number;
} = {}): Promise<{
  workspace_id: string;
  stale_events: IntelligenceStaleEventPreview[];
}> {
  return apiRequest("/api/v1/intelligence/maintenance/stale-events", { method: "GET", query });
}

export async function listIntelligenceQuarantine(query: {
  workspace_id?: string;
} = {}): Promise<{
  workspace_id: string;
  quarantined_signals: IntelligenceQuarantinedSignalRecord[];
  provisional_events: IntelligenceProvisionalEventRecord[];
  identity_collisions: IntelligenceIdentityCollisionRecord[];
}> {
  return apiRequest("/api/v1/intelligence/quarantine", { method: "GET", query });
}

export async function retryIntelligenceSignal(signalId: string, payload: {
  workspace_id?: string;
}): Promise<{ workspace_id: string; result: IntelligenceSignalRetryResult }> {
  return apiRequest(`/api/v1/intelligence/signals/${signalId}/retry`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function rebuildIntelligenceEventById(eventId: string, payload: {
  workspace_id?: string;
}): Promise<{ workspace_id: string; result: IntelligenceEventRebuildResult }> {
  return apiRequest(`/api/v1/intelligence/events/${eventId}/rebuild`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function bulkRebuildIntelligenceEvents(payload: {
  workspace_id?: string;
  event_ids?: string[];
  limit?: number;
}): Promise<{ workspace_id: string; result: IntelligenceBulkEventRebuildResult }> {
  return apiRequest("/api/v1/intelligence/maintenance/rebuild-stale-events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function rebuildIntelligenceWorkspace(payload: {
  workspace_id?: string;
  mode?: "hard_reset";
}): Promise<{ workspace_id: string; result: IntelligenceWorkspaceRebuildResult }> {
  return apiRequest("/api/v1/intelligence/maintenance/rebuild-workspace", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateIntelligenceEventReviewState(eventId: string, payload: {
  workspace_id?: string;
  review_state: EventReviewState;
  review_reason?: string | null;
  review_owner?: string | null;
  review_resolved_at?: string | null;
}): Promise<{ workspace_id: string; event: IntelligenceEventClusterRecord }> {
  return apiRequest(`/api/v1/intelligence/events/${eventId}/review-state`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateIntelligenceLinkedClaimReviewState(linkedClaimId: string, payload: {
  workspace_id?: string;
  review_state: EventReviewState;
  review_reason?: string | null;
  review_owner?: string | null;
  review_resolved_at?: string | null;
}): Promise<{ workspace_id: string; linked_claim: LinkedClaimRecord }> {
  return apiRequest(`/api/v1/intelligence/linked-claims/${linkedClaimId}/review-state`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateIntelligenceHypothesisReviewState(entryId: string, payload: {
  workspace_id?: string;
  review_state: EventReviewState;
  review_reason?: string | null;
  review_owner?: string | null;
  review_resolved_at?: string | null;
}): Promise<{ workspace_id: string; hypothesis: HypothesisLedgerEntry }> {
  return apiRequest(`/api/v1/intelligence/hypotheses/entries/${entryId}/review-state`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateIntelligenceNarrativeClusterReviewState(clusterId: string, payload: {
  workspace_id?: string;
  review_state: EventReviewState;
  review_reason?: string | null;
  review_owner?: string | null;
  review_resolved_at?: string | null;
}): Promise<{ workspace_id: string; narrative_cluster: IntelligenceNarrativeClusterRecord }> {
  return apiRequest(`/api/v1/intelligence/narrative-clusters/${clusterId}/review-state`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createIntelligenceOperatorNote(eventId: string, payload: {
  workspace_id?: string;
  scope?: OperatorNoteRecord["scope"];
  scope_id?: string | null;
  note: string;
}): Promise<{ workspace_id: string; note: OperatorNoteRecord }> {
  return apiRequest(`/api/v1/intelligence/events/${eventId}/operator-note`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deliberateIntelligenceEvent(eventId: string, payload: { workspace_id?: string } = {}): Promise<{
  workspace_id: string;
  dispatch: IntelligenceBridgeDispatchRecord;
  deliberation: IntelligenceEventClusterRecord["deliberations"][number] | null;
}> {
  return apiRequest(`/api/v1/intelligence/events/${eventId}/deliberate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function executeIntelligenceEvent(eventId: string, payload: {
  workspace_id?: string;
  candidate_id: string;
}): Promise<{
  workspace_id: string;
  candidate: IntelligenceEventClusterRecord["executionCandidates"][number];
  event: IntelligenceEventClusterRecord;
}> {
  return apiRequest(`/api/v1/intelligence/events/${eventId}/execute`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function bridgeIntelligenceEventToCouncil(payload: {
  workspace_id?: string;
  event_id: string;
}): Promise<{
  workspace_id: string;
  dispatch: IntelligenceBridgeDispatchRecord;
  deliberation: IntelligenceEventClusterRecord["deliberations"][number] | null;
}> {
  return apiRequest("/api/v1/intelligence/bridges/council", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function bridgeIntelligenceEventToBrief(payload: {
  workspace_id?: string;
  event_id: string;
}): Promise<{
  workspace_id: string;
  dispatch: IntelligenceBridgeDispatchRecord;
}> {
  return apiRequest("/api/v1/intelligence/bridges/brief", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function bridgeIntelligenceEventToAction(payload: {
  workspace_id?: string;
  event_id: string;
}): Promise<{
  workspace_id: string;
  dispatch: IntelligenceBridgeDispatchRecord;
}> {
  return apiRequest("/api/v1/intelligence/bridges/action", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listIntelligenceRuntimeModels(query: { workspace_id?: string } = {}): Promise<{
  workspace_id: string;
  models: IntelligenceModelRegistryEntry[];
  provider_health: ProviderHealthRecord[];
  sync_worker: IntelligenceWorkerStatus<IntelligenceCatalogSyncRun>;
}> {
  return apiRequest("/api/v1/intelligence/runtime/models", { method: "GET", query });
}

export async function listIntelligenceRuntimeAliases(query: {
  workspace_id?: string;
  alias?: IntelligenceCapabilityAlias;
} = {}): Promise<{
  workspace_id: string;
  alias: IntelligenceCapabilityAlias | null;
  bindings: {
    workspace: IntelligenceCapabilityAliasBinding[];
    global: IntelligenceCapabilityAliasBinding[];
  };
  rollouts: {
    workspace: AliasRolloutRecord[];
    global: AliasRolloutRecord[];
  };
}> {
  return apiRequest("/api/v1/intelligence/runtime/aliases", { method: "GET", query });
}

export async function updateIntelligenceAliasBindings(
  alias: IntelligenceCapabilityAlias,
  payload: {
    workspace_id?: string;
    scope?: "workspace" | "global";
    bindings: Array<{
      provider: ProviderName;
      model_id: string;
      weight?: number;
      fallback_rank?: number;
      canary_percent?: number;
      is_active?: boolean;
      requires_structured_output?: boolean;
      requires_tool_use?: boolean;
      requires_long_context?: boolean;
      max_cost_class?: "free" | "low" | "standard" | "premium" | null;
    }>;
  }
): Promise<{
  workspace_id: string;
  binding_scope: "workspace" | "global";
  alias: IntelligenceCapabilityAlias;
  bindings: IntelligenceCapabilityAliasBinding[];
  rollout: AliasRolloutRecord;
}> {
  return apiRequest(`/api/v1/intelligence/runtime/aliases/${alias}/bindings`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listProviders(): Promise<{ providers: ProviderAvailability[] }> {
  return apiRequest<{ providers: ProviderAvailability[] }>("/api/v1/providers", { method: "GET" });
}

export async function listProviderModels(query: { scope?: "user" | "workspace" } = {}): Promise<{ providers: ProviderModelCatalogEntry[] }> {
  return apiRequest<{ providers: ProviderModelCatalogEntry[] }>("/api/v1/providers/models", { method: "GET", query });
}

export async function getSettingsOverview(): Promise<SettingsOverviewData> {
  return apiRequest<SettingsOverviewData>("/api/v1/settings/overview", { method: "GET" });
}

export async function getDashboardOverview(
  query: {
    task_limit?: number;
    pending_approval_limit?: number;
    running_task_limit?: number;
  } = {}
): Promise<DashboardOverviewData> {
  return apiRequest<DashboardOverviewData>("/api/v1/dashboard/overview", {
    method: "GET",
    query,
  });
}

export type DashboardOverviewEventsStream = {
  close: () => void;
};

export type NotificationsStream = {
  close: () => void;
};

function createApiEventSource(pathname: string): EventSource {
  return new EventSource(buildApiUrl(pathname), { withCredentials: true });
}

export function streamNotifications(handlers: {
  onOpen?: () => void;
  onMessage?: (notification: SystemNotification) => void;
  onError?: (error: unknown) => void;
}): NotificationsStream {
  const source = createApiEventSource("/api/v1/notifications/stream");

  source.onopen = () => {
    handlers.onOpen?.();
  };

  source.onmessage = (event) => {
    handlers.onMessage?.(tryParseSseData((event as MessageEvent).data) as SystemNotification);
  };

  source.onerror = (error) => {
    handlers.onError?.(error);
  };

  return {
    close: () => source.close(),
  };
}

export function streamDashboardOverviewEvents(
  query: {
    task_limit?: number;
    pending_approval_limit?: number;
    running_task_limit?: number;
    poll_ms?: number;
    timeout_ms?: number;
  } = {},
  handlers: {
    onOpen?: (payload: { request_id: string }) => void;
    onUpdated?: (payload: DashboardOverviewStreamEnvelope) => void;
    onClose?: (payload: unknown) => void;
    onError?: (error: unknown) => void;
  }
): DashboardOverviewEventsStream {
  const params = new URLSearchParams();
  if (typeof query.task_limit === "number") {
    params.set("task_limit", String(query.task_limit));
  }
  if (typeof query.pending_approval_limit === "number") {
    params.set("pending_approval_limit", String(query.pending_approval_limit));
  }
  if (typeof query.running_task_limit === "number") {
    params.set("running_task_limit", String(query.running_task_limit));
  }
  if (typeof query.poll_ms === "number") {
    params.set("poll_ms", String(query.poll_ms));
  }
  if (typeof query.timeout_ms === "number") {
    params.set("timeout_ms", String(query.timeout_ms));
  }
  const querySuffix = params.toString().length > 0 ? `?${params.toString()}` : "";
  const source = createApiEventSource(`/api/v1/dashboard/events${querySuffix}`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string });
  });

  source.addEventListener("dashboard.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as DashboardOverviewStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    handlers.onClose?.(tryParseSseData((event as MessageEvent).data));
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function listAdminProviderCredentials(): Promise<{ providers: ProviderCredentialRecord[] }> {
  return apiRequest<{ providers: ProviderCredentialRecord[] }>("/api/v1/admin/providers/credentials", { method: "GET" });
}

export async function upsertAdminProviderCredential(
  provider: ProviderCredentialRecord["provider"],
  apiKey: string
): Promise<ProviderCredentialMutationResult> {
  return apiRequest<ProviderCredentialMutationResult>(`/api/v1/admin/providers/credentials/${provider}`, {
    method: "PUT",
    body: JSON.stringify({
      api_key: apiKey,
    }),
  });
}

export async function deleteAdminProviderCredential(
  provider: ProviderCredentialRecord["provider"]
): Promise<ProviderCredentialMutationResult> {
  return apiRequest<ProviderCredentialMutationResult>(`/api/v1/admin/providers/credentials/${provider}`, {
    method: "DELETE",
  });
}

export async function testAdminProviderConnection(
  provider: ProviderCredentialRecord["provider"]
): Promise<ProviderConnectionTestResult> {
  return apiRequest<ProviderConnectionTestResult>(`/api/v1/admin/providers/credentials/${provider}/test`, {
    method: "POST",
  });
}

export async function listUserProviderCredentials(): Promise<{ providers: UserProviderCredentialRecord[] }> {
  return apiRequest<{ providers: UserProviderCredentialRecord[] }>("/api/v1/providers/credentials", { method: "GET" });
}

export async function createJarvisRequest(payload: JarvisRequest): Promise<JarvisRequestResult> {
  return apiRequest<JarvisRequestResult>("/api/v1/jarvis/requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listJarvisSessions(query: { status?: JarvisSessionRecord["status"]; limit?: number } = {}): Promise<{ sessions: JarvisSessionRecord[] }> {
  return apiRequest<{ sessions: JarvisSessionRecord[] }>("/api/v1/jarvis/sessions", {
    method: "GET",
    query,
  });
}

export async function getJarvisSession(sessionId: string): Promise<JarvisSessionDetail> {
  return apiRequest<JarvisSessionDetail>(`/api/v1/jarvis/sessions/${sessionId}`, { method: "GET" });
}

export async function listJarvisSessionEvents(
  sessionId: string,
  query: { since_sequence?: number; limit?: number } = {}
): Promise<{ events: JarvisSessionEventRecord[] }> {
  return apiRequest<{ events: JarvisSessionEventRecord[] }>(`/api/v1/jarvis/sessions/${sessionId}/events`, {
    method: "GET",
    query,
  });
}

export async function approveJarvisAction(sessionId: string, actionId: string): Promise<{ session: JarvisSessionRecord; action: unknown }> {
  return apiRequest<{ session: JarvisSessionRecord; action: unknown }>(
    `/api/v1/jarvis/sessions/${sessionId}/actions/${actionId}/approve`,
    { method: "POST" }
  );
}

export async function rejectJarvisAction(sessionId: string, actionId: string): Promise<{ session: JarvisSessionRecord; action: unknown }> {
  return apiRequest<{ session: JarvisSessionRecord; action: unknown }>(
    `/api/v1/jarvis/sessions/${sessionId}/actions/${actionId}/reject`,
    { method: "POST" }
  );
}

export async function listWatchers(query: { kind?: WatcherKind; status?: WatcherRecord["status"]; limit?: number } = {}): Promise<{ watchers: WatcherRecord[] }> {
  return apiRequest<{ watchers: WatcherRecord[] }>("/api/v1/watchers", {
    method: "GET",
    query,
  });
}

export async function listSkills(): Promise<{ skills: SkillRecord[] }> {
  return apiRequest<{ skills: SkillRecord[] }>("/api/v1/skills", {
    method: "GET",
  });
}

export async function findSkills(payload: { prompt: string; limit?: number }): Promise<SkillFindResult> {
  return apiRequest<SkillFindResult>("/api/v1/skills/find", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getSkillResource(skillId: SkillId, resourceId: string): Promise<SkillResourceDetail> {
  return apiRequest<SkillResourceDetail>(`/api/v1/skills/${skillId}/resources/${resourceId}`, {
    method: "GET",
  });
}

export async function useSkill(payload: {
  skill_id: SkillId;
  prompt: string;
  execute?: boolean;
  provider?: ProviderName | "auto";
  strict_provider?: boolean;
  model?: string;
  feature_key?: ModelControlFeatureKey;
  task_type?: string;
}): Promise<SkillUseResult> {
  return apiRequest<SkillUseResult>("/api/v1/skills/use", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listWorkspaces(): Promise<{ workspaces: WorkspaceRecord[] }> {
  return apiRequest<{ workspaces: WorkspaceRecord[] }>("/api/v1/workspaces", {
    method: "GET",
  });
}

export async function createWorkspace(payload: {
  name?: string;
  cwd?: string;
  kind?: "current" | "worktree" | "devcontainer";
  base_ref?: string;
  source_workspace_id?: string;
  image?: string;
  approval_required?: boolean;
}): Promise<WorkspaceRecord> {
  return apiRequest<WorkspaceRecord>("/api/v1/workspaces", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function spawnWorkspaceSession(
  workspaceId: string,
  payload: { command: string; client_session_id?: string; shell?: string }
): Promise<WorkspaceSpawnResult> {
  return apiRequest<WorkspaceSpawnResult>(`/api/v1/workspaces/${workspaceId}/pty/spawn`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function writeWorkspaceSession(
  workspaceId: string,
  payload: { data: string }
): Promise<{ workspace: WorkspaceRecord }> {
  return apiRequest<{ workspace: WorkspaceRecord }>(`/api/v1/workspaces/${workspaceId}/pty/write`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function readWorkspaceSession(
  workspaceId: string,
  query: { after_sequence?: number; limit?: number } = {}
): Promise<{ workspace: WorkspaceRecord; chunks: WorkspaceChunkRecord[]; nextSequence: number }> {
  return apiRequest<{ workspace: WorkspaceRecord; chunks: WorkspaceChunkRecord[]; nextSequence: number }>(
    `/api/v1/workspaces/${workspaceId}/pty/read`,
    {
      method: "GET",
      query,
    }
  );
}

export async function shutdownWorkspace(workspaceId: string): Promise<{ workspace: WorkspaceRecord; shutdown: boolean }> {
  return apiRequest<{ workspace: WorkspaceRecord; shutdown: boolean }>(`/api/v1/workspaces/${workspaceId}/shutdown`, {
    method: "POST",
  });
}

export async function deleteWorkspace(workspaceId: string): Promise<{ workspace: WorkspaceRecord; deleted: boolean }> {
  return apiRequest<{ workspace: WorkspaceRecord; deleted: boolean }>(`/api/v1/workspaces/${workspaceId}`, {
    method: "DELETE",
  });
}

export async function createWatcher(payload: {
  kind: WatcherKind;
  title: string;
  query: string;
  status?: WatcherRecord["status"];
  config_json?: Record<string, unknown>;
}): Promise<WatcherRecord> {
  return apiRequest<WatcherRecord>("/api/v1/watchers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateWatcher(
  watcherId: string,
  payload: Partial<{
    kind: WatcherKind;
    title: string;
    query: string;
    status: WatcherRecord["status"];
    config_json: Record<string, unknown>;
  }>
): Promise<WatcherRecord> {
  return apiRequest<WatcherRecord>(`/api/v1/watchers/${watcherId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteWatcher(watcherId: string): Promise<{ deleted: boolean; watcher_id: string }> {
  return apiRequest<{ deleted: boolean; watcher_id: string }>(`/api/v1/watchers/${watcherId}`, {
    method: "DELETE",
  });
}

export async function runWatcher(watcherId: string): Promise<{
  watcher: WatcherRecord;
  run: WatcherRunRecord | null;
  briefing: BriefingRecord;
  dossier: DossierRecord;
  follow_up: import("./types").WatcherFollowUpRecord | null;
}> {
  return apiRequest<{
    watcher: WatcherRecord;
    run: WatcherRunRecord | null;
    briefing: BriefingRecord;
    dossier: DossierRecord;
    follow_up: import("./types").WatcherFollowUpRecord | null;
  }>(`/api/v1/watchers/${watcherId}/run`, {
    method: "POST",
  });
}

export async function listBriefings(query: { type?: BriefingRecord["type"]; status?: BriefingRecord["status"]; limit?: number } = {}): Promise<{ briefings: BriefingRecord[] }> {
  return apiRequest<{ briefings: BriefingRecord[] }>("/api/v1/briefings", {
    method: "GET",
    query,
  });
}

export async function generateBriefing(payload: { query: string; title?: string; type?: BriefingRecord["type"] }): Promise<BriefingGenerateResult> {
  return apiRequest<BriefingGenerateResult>("/api/v1/briefings/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listDossiers(query: { status?: DossierRecord["status"]; limit?: number } = {}): Promise<{ dossiers: DossierRecord[] }> {
  return apiRequest<{ dossiers: DossierRecord[] }>("/api/v1/dossiers", {
    method: "GET",
    query,
  });
}

export async function getDossier(dossierId: string): Promise<DossierDetail> {
  return apiRequest<DossierDetail>(`/api/v1/dossiers/${dossierId}`, { method: "GET" });
}

export async function refreshDossier(dossierId: string, payload: { query?: string; title?: string } = {}): Promise<DossierRefreshResult> {
  return apiRequest<DossierRefreshResult>(`/api/v1/dossiers/${dossierId}/refresh`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function exportDossier(dossierId: string): Promise<{ dossier_id: string; title: string; format: string; content: string }> {
  return apiRequest<{ dossier_id: string; title: string; format: string; content: string }>(
    `/api/v1/dossiers/${dossierId}/export`,
    { method: "POST" }
  );
}

export async function getUserProviderCredential(provider: ProviderName): Promise<UserProviderCredentialRecord> {
  return apiRequest<UserProviderCredentialRecord>(`/api/v1/providers/credentials/${provider}`, { method: "GET" });
}

export async function upsertUserProviderCredential(
  provider: ProviderName,
  payload: {
    api_key?: string;
    credential_priority?: "api_key_first" | "auth_first";
    selected_credential_mode?: ProviderCredentialSelectionMode;
    is_active?: boolean;
  }
): Promise<UserProviderCredentialRecord> {
  return apiRequest<UserProviderCredentialRecord>(`/api/v1/providers/credentials/${provider}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteUserProviderCredential(provider: ProviderName): Promise<UserProviderCredentialRecord> {
  return apiRequest<UserProviderCredentialRecord>(`/api/v1/providers/credentials/${provider}`, {
    method: "DELETE",
  });
}

export async function testUserProviderCredential(provider: ProviderName): Promise<UserProviderConnectionTestResult> {
  return apiRequest<UserProviderConnectionTestResult>(`/api/v1/providers/credentials/${provider}/test`, {
    method: "POST",
  });
}

export async function startUserProviderOauth(
  provider: Extract<ProviderName, "openai" | "gemini">,
  payload: Record<string, never> = {}
): Promise<ProviderOauthStartResult> {
  return apiRequest<ProviderOauthStartResult>(`/api/v1/providers/credentials/${provider}/auth/start`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function completeUserProviderOauth(
  provider: Extract<ProviderName, "openai" | "gemini">,
  payload: {
    state: string;
    code: string;
  }
): Promise<UserProviderCredentialRecord> {
  return apiRequest<UserProviderCredentialRecord>(`/api/v1/providers/credentials/${provider}/auth/complete`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getModelControlPreferences(): Promise<{ preferences: UserModelSelectionPreference[] }> {
  return apiRequest<{ preferences: UserModelSelectionPreference[] }>("/api/v1/model-control/preferences", {
    method: "GET",
  });
}

export async function upsertModelControlPreference(
  feature: ModelControlFeatureKey,
  payload: {
    provider: ProviderName | "auto";
    model?: string;
    strict_provider?: boolean;
    selection_mode?: "auto" | "manual";
  }
): Promise<UserModelSelectionPreference> {
  return apiRequest<UserModelSelectionPreference>(`/api/v1/model-control/preferences/${feature}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function createModelRecommendation(payload: {
  feature_key: ModelControlFeatureKey;
  prompt: string;
  task_type?: string;
}): Promise<ModelRecommendationRun> {
  return apiRequest<ModelRecommendationRun>("/api/v1/model-control/recommendations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listModelRecommendations(query: {
  feature_key?: ModelControlFeatureKey;
  limit?: number;
} = {}): Promise<{ recommendations: ModelRecommendationRun[] }> {
  return apiRequest<{ recommendations: ModelRecommendationRun[] }>("/api/v1/model-control/recommendations", {
    method: "GET",
    query,
  });
}

export async function applyModelRecommendation(recommendationId: string): Promise<{
  recommendation: ModelRecommendationRun;
  preference: UserModelSelectionPreference;
}> {
  return apiRequest<{ recommendation: ModelRecommendationRun; preference: UserModelSelectionPreference }>(
    `/api/v1/model-control/recommendations/${recommendationId}/apply`,
    {
      method: "POST",
    }
  );
}

export async function listModelControlTraces(query: {
  feature_key?: ModelControlFeatureKey | "diagnostic";
  success?: boolean;
  limit?: number;
} = {}): Promise<{ traces: AiInvocationTraceRecord[] }> {
  const normalizedQuery: Record<string, string | number> = {};
  if (query.feature_key) {
    normalizedQuery.feature_key = query.feature_key;
  }
  if (typeof query.success === "boolean") {
    normalizedQuery.success = query.success ? "true" : "false";
  }
  if (typeof query.limit === "number") {
    normalizedQuery.limit = query.limit;
  }
  return apiRequest<{ traces: AiInvocationTraceRecord[] }>("/api/v1/model-control/traces", {
    method: "GET",
    query: normalizedQuery,
  });
}

export async function getModelControlMetrics(query: { since?: string } = {}): Promise<AiInvocationMetrics> {
  return apiRequest<AiInvocationMetrics>("/api/v1/model-control/metrics", {
    method: "GET",
    query,
  });
}

export async function aiRespond(payload: AiRespondRequest): Promise<AiRespondData> {
  return apiRequest<AiRespondData>("/api/v1/ai/respond", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function startCouncilRun(payload: CouncilRunRequest): Promise<CouncilRunRecord> {
  const idempotencyKey = payload.idempotency_key ?? createClientRequestId("council");
  const traceId = payload.trace_id ?? createClientRequestId("trace");
  const requestBody = {
    ...payload,
  };
  delete requestBody.idempotency_key;
  delete requestBody.trace_id;
  const response = await apiRequestEnvelope<CouncilRunRecord>("/api/v1/councils/runs", {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
      "x-trace-id": traceId,
    },
    body: JSON.stringify(requestBody),
  });

  return {
    ...response.data,
    idempotent_replay: response.meta.idempotent_replay === true,
  };
}

export async function getCouncilRun(runId: string): Promise<CouncilRunRecord> {
  return apiRequest<CouncilRunRecord>(`/api/v1/councils/runs/${runId}`, { method: "GET" });
}

export async function listCouncilRuns(query: { limit?: number } = {}): Promise<{ runs: CouncilRunRecord[] }> {
  return apiRequest<{ runs: CouncilRunRecord[] }>("/api/v1/councils/runs", {
    method: "GET",
    query,
  });
}

export async function startExecutionRun(payload: ExecutionRunRequest): Promise<ExecutionRunRecord> {
  const idempotencyKey = payload.idempotency_key ?? createClientRequestId("execution");
  const traceId = payload.trace_id ?? createClientRequestId("trace");
  const requestBody = {
    ...payload,
  };
  delete requestBody.idempotency_key;
  delete requestBody.trace_id;
  const response = await apiRequestEnvelope<ExecutionRunRecord>("/api/v1/executions/runs", {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
      "x-trace-id": traceId,
    },
    body: JSON.stringify(requestBody),
  });

  return {
    ...response.data,
    idempotent_replay: response.meta.idempotent_replay === true,
  };
}

export async function getExecutionRun(runId: string): Promise<ExecutionRunRecord> {
  return apiRequest<ExecutionRunRecord>(`/api/v1/executions/runs/${runId}`, { method: "GET" });
}

export async function listExecutionRuns(query: { limit?: number } = {}): Promise<{ runs: ExecutionRunRecord[] }> {
  return apiRequest<{ runs: ExecutionRunRecord[] }>("/api/v1/executions/runs", {
    method: "GET",
    query,
  });
}

export type ExecutionRunEventsStream = {
  close: () => void;
};

export type CouncilRunEventsStream = {
  close: () => void;
};

export function streamCouncilRunEvents(
  runId: string,
  handlers: {
    onOpen?: (payload: CouncilRunStreamEnvelope) => void;
    onRoundStarted?: (payload: CouncilRoundStartedStreamEnvelope) => void;
    onAgentResponded?: (payload: CouncilAgentRespondedStreamEnvelope) => void;
    onRoundCompleted?: (payload: CouncilRoundCompletedStreamEnvelope) => void;
    onUpdated?: (payload: CouncilRunStreamEnvelope) => void;
    onCompleted?: (payload: CouncilRunStreamEnvelope) => void;
    onFailed?: (payload: CouncilRunStreamEnvelope) => void;
    onClose?: (payload: CouncilRunStreamEnvelope) => void;
    onError?: (error: unknown) => void;
  }
): CouncilRunEventsStream {
  const source = createApiEventSource(`/api/v1/councils/runs/${runId}/events`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope);
  });

  source.addEventListener("council.round.started", (event) => {
    handlers.onRoundStarted?.(tryParseSseData((event as MessageEvent).data) as CouncilRoundStartedStreamEnvelope);
  });

  source.addEventListener("council.agent.responded", (event) => {
    handlers.onAgentResponded?.(tryParseSseData((event as MessageEvent).data) as CouncilAgentRespondedStreamEnvelope);
  });

  source.addEventListener("council.round.completed", (event) => {
    handlers.onRoundCompleted?.(tryParseSseData((event as MessageEvent).data) as CouncilRoundCompletedStreamEnvelope);
  });

  source.addEventListener("council.run.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope);
  });

  source.addEventListener("council.run.completed", (event) => {
    handlers.onCompleted?.(tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope);
  });

  source.addEventListener("council.run.failed", (event) => {
    handlers.onFailed?.(tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    const payload = tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope;
    handlers.onClose?.(payload);
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export function streamExecutionRunEvents(
  runId: string,
  handlers: {
    onOpen?: (payload: ExecutionRunStreamEnvelope) => void;
    onUpdated?: (payload: ExecutionRunStreamEnvelope) => void;
    onCompleted?: (payload: ExecutionRunStreamEnvelope) => void;
    onFailed?: (payload: ExecutionRunStreamEnvelope) => void;
    onClose?: (payload: ExecutionRunStreamEnvelope) => void;
    onError?: (error: unknown) => void;
  }
): ExecutionRunEventsStream {
  const source = createApiEventSource(`/api/v1/executions/runs/${runId}/events`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope);
  });

  source.addEventListener("execution.run.completed", (event) => {
    handlers.onCompleted?.(tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope);
  });

  source.addEventListener("execution.run.failed", (event) => {
    handlers.onFailed?.(tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope);
  });

  source.addEventListener("execution.run.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    const payload = tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope;
    handlers.onClose?.(payload);
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function createTask(
  payload: TaskCreateRequest,
  options?: {
    idempotencyKey?: string;
  }
): Promise<TaskRecord> {
  return apiRequest<TaskRecord>("/api/v1/tasks", {
    method: "POST",
    headers: options?.idempotencyKey
      ? {
          "idempotency-key": options.idempotencyKey,
        }
      : undefined,
    body: JSON.stringify(payload),
  });
}

export async function createMission(payload: MissionCreateRequest): Promise<MissionRecord> {
  return apiRequest<MissionRecord>("/api/v1/missions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listMissions(query: { status?: MissionStatus; limit?: number } = {}): Promise<{ missions: MissionRecord[] }> {
  return apiRequest<{ missions: MissionRecord[] }>("/api/v1/missions", {
    method: "GET",
    query,
  });
}

export async function getMission(missionId: string): Promise<MissionRecord> {
  return apiRequest<MissionRecord>(`/api/v1/missions/${missionId}`, { method: "GET" });
}

export async function updateMission(missionId: string, payload: MissionUpdateRequest): Promise<MissionRecord> {
  return apiRequest<MissionRecord>(`/api/v1/missions/${missionId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function generateMissionPlan(payload: GeneratePlanRequest): Promise<GeneratePlanResponse> {
  return apiRequest<GeneratePlanResponse>("/api/v1/missions/generate-plan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type MissionEventsStream = {
  close: () => void;
};

export function streamMissionEvents(
  missionId: string,
  query: {
    poll_ms?: number;
    timeout_ms?: number;
  } = {},
  handlers: {
    onOpen?: (payload: { request_id: string; mission_id: string }) => void;
    onUpdated?: (payload: MissionStreamEnvelope) => void;
    onClose?: (payload: unknown) => void;
    onError?: (error: unknown) => void;
  }
): MissionEventsStream {
  const params = new URLSearchParams();
  if (typeof query.poll_ms === "number") {
    params.set("poll_ms", String(query.poll_ms));
  }
  if (typeof query.timeout_ms === "number") {
    params.set("timeout_ms", String(query.timeout_ms));
  }
  const querySuffix = params.toString().length > 0 ? `?${params.toString()}` : "";
  const source = createApiEventSource(`/api/v1/missions/${missionId}/events${querySuffix}`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string; mission_id: string });
  });

  source.addEventListener("mission.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as MissionStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    handlers.onClose?.(tryParseSseData((event as MessageEvent).data));
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function createAssistantContext(payload: AssistantContextCreateRequest): Promise<AssistantContextRecord> {
  return apiRequest<AssistantContextRecord>("/api/v1/assistant/contexts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listAssistantContexts(
  query: { status?: AssistantContextStatus; limit?: number } = {}
): Promise<{ contexts: AssistantContextRecord[] }> {
  return apiRequest<{ contexts: AssistantContextRecord[] }>("/api/v1/assistant/contexts", {
    method: "GET",
    query,
  });
}

export async function getAssistantContext(contextId: string): Promise<AssistantContextRecord> {
  return apiRequest<AssistantContextRecord>(`/api/v1/assistant/contexts/${contextId}`, {
    method: "GET",
  });
}

export async function getAssistantContextGroundingEvidence(
  contextId: string,
  query: { limit?: number } = {}
): Promise<AssistantContextGroundingEvidenceData> {
  return apiRequest<AssistantContextGroundingEvidenceData>(
    `/api/v1/assistant/contexts/${contextId}/grounding-evidence`,
    {
      method: "GET",
      query,
    }
  );
}

export async function updateAssistantContext(
  contextId: string,
  payload: AssistantContextUpdateRequest
): Promise<AssistantContextRecord> {
  return apiRequest<AssistantContextRecord>(`/api/v1/assistant/contexts/${contextId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function runAssistantContext(
  contextId: string,
  payload: AssistantContextRunRequest = {}
): Promise<AssistantContextRecord> {
  const response = await apiRequestEnvelope<AssistantContextRecord>(`/api/v1/assistant/contexts/${contextId}/run`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function runAssistantContextWithMeta(
  contextId: string,
  payload: AssistantContextRunRequest = {}
): Promise<{ context: AssistantContextRecord; meta: AssistantContextRunMeta }> {
  const response = await apiRequestEnvelope<AssistantContextRecord>(`/api/v1/assistant/contexts/${contextId}/run`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    context: response.data,
    meta: response.meta as AssistantContextRunMeta,
  };
}

export async function appendAssistantContextEvent(
  contextId: string,
  payload: { event_type: string; data?: Record<string, unknown> }
): Promise<AssistantContextEventRecord> {
  return apiRequest<AssistantContextEventRecord>(`/api/v1/assistant/contexts/${contextId}/events`, {
    method: "POST",
    body: JSON.stringify({
      event_type: payload.event_type,
      data: payload.data ?? {},
    }),
  });
}

export async function listAssistantContextEvents(
  contextId: string,
  query: { since_sequence?: number; limit?: number } = {}
): Promise<{ context_id: string; events: AssistantContextEventRecord[]; next_since_sequence: number | null }> {
  return apiRequest<{ context_id: string; events: AssistantContextEventRecord[]; next_since_sequence: number | null }>(
    `/api/v1/assistant/contexts/${contextId}/events`,
    {
      method: "GET",
      query,
    }
  );
}

export async function listTasks(query: TaskListQuery = {}): Promise<TaskRecord[]> {
  return apiRequest<TaskRecord[]>("/api/v1/tasks", {
    method: "GET",
    query: {
      status: query.status,
      limit: query.limit,
    },
  });
}

export async function getTask(taskId: string): Promise<TaskRecord> {
  return apiRequest<TaskRecord>(`/api/v1/tasks/${taskId}`, { method: "GET" });
}

export async function getMemorySnapshot(query: { limit?: number } = {}): Promise<MemorySnapshotData> {
  return apiRequest<MemorySnapshotData>("/api/v1/memory/snapshot", {
    method: "GET",
    query,
  });
}

export async function getMemorySummary(query: { limit?: number } = {}): Promise<MemorySummaryData> {
  return apiRequest<MemorySummaryData>("/api/v1/memory/summary", {
    method: "GET",
    query,
  });
}

export async function getMemoryContext(query: { q?: string; limit?: number; kind?: MemoryNoteKind } = {}): Promise<MemoryContextData> {
  return apiRequest<MemoryContextData>("/api/v1/memory/context", {
    method: "GET",
    query,
  });
}

export async function createMemoryNote(payload: {
  kind: MemoryNoteKind;
  key?: string;
  value?: string;
  attributes?: Record<string, unknown>;
  title: string;
  content: string;
  tags?: string[];
  pinned?: boolean;
  source?: "manual" | "session" | "system";
  related_session_id?: string;
  related_task_id?: string;
}): Promise<MemoryNoteRecord> {
  return apiRequest<MemoryNoteRecord>("/api/v1/memory/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateMemoryNote(
  noteId: string,
  payload: Partial<{
    key: string;
    value: string;
    attributes: Record<string, unknown>;
    title: string;
    content: string;
    tags: string[];
    pinned: boolean;
  }>
): Promise<MemoryNoteRecord> {
  return apiRequest<MemoryNoteRecord>(`/api/v1/memory/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteMemoryNote(noteId: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/api/v1/memory/notes/${noteId}`, {
    method: "DELETE",
  });
}

export async function getRecentDecisionMemory(query: { limit?: number } = {}): Promise<{ notes: MemoryNoteRecord[]; total: number }> {
  return apiRequest<{ notes: MemoryNoteRecord[]; total: number }>("/api/v1/memory/recent-decisions", {
    method: "GET",
    query,
  });
}

export async function getReportsOverview(
  query: {
    task_limit?: number;
    run_limit?: number;
  } = {}
): Promise<ReportsOverviewData> {
  return apiRequest<ReportsOverviewData>("/api/v1/reports/overview", {
    method: "GET",
    query,
  });
}

export type TaskEventsStream = {
  close: () => void;
};

export type AssistantContextEventsStream = {
  close: () => void;
};

export function streamTaskEvents(
  taskId: string,
  handlers: {
    onOpen?: (payload: TaskStreamEnvelope) => void;
    onEvent?: (eventType: string, payload: TaskStreamEnvelope) => void;
    onClose?: (payload: TaskStreamEnvelope) => void;
    onError?: (error: unknown) => void;
  }
): TaskEventsStream {
  const source = createApiEventSource(`/api/v1/tasks/${taskId}/events`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as TaskStreamEnvelope);
  });

  const knownTaskEvents = [
    "task.created",
    "task.updated",
    "task.blocked",
    "task.retrying",
    "task.failed",
    "task.done",
    "task.cancelled",
  ];

  for (const eventName of knownTaskEvents) {
    source.addEventListener(eventName, (event) => {
      handlers.onEvent?.(eventName, tryParseSseData((event as MessageEvent).data) as TaskStreamEnvelope);
    });
  }

  source.addEventListener("stream.close", (event) => {
    const payload = tryParseSseData((event as MessageEvent).data) as TaskStreamEnvelope;
    handlers.onClose?.(payload);
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export function streamAssistantContextEvents(
  contextId: string,
  handlers: {
    onOpen?: (payload: { request_id: string; context_id: string; since_sequence: number | null }) => void;
    onEvent?: (payload: AssistantContextEventStreamEnvelope) => void;
    onClose?: (payload: { context_id: string; since_sequence: number | null }) => void;
    onError?: (error: unknown) => void;
  }
): AssistantContextEventsStream {
  const source = createApiEventSource(`/api/v1/assistant/contexts/${contextId}/events/stream`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string; context_id: string; since_sequence: number | null });
  });

  source.addEventListener("assistant.context.event", (event) => {
    handlers.onEvent?.(tryParseSseData((event as MessageEvent).data) as AssistantContextEventStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    const payload = tryParseSseData((event as MessageEvent).data) as { context_id: string; since_sequence: number | null };
    handlers.onClose?.(payload);
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function ingestRadar(payload: RadarIngestRequest = {}): Promise<{ ingest_job_id: string; status: string; accepted_count: number }> {
  return apiRequest<{ ingest_job_id: string; status: string; accepted_count: number }>("/api/v1/radar/ingest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listRadarItems(query: { status?: RadarItemStatus; limit?: number } = {}): Promise<{ items: RadarItemRecord[] }> {
  return apiRequest<{ items: RadarItemRecord[] }>("/api/v1/radar/items", {
    method: "GET",
    query,
  });
}

export async function evaluateRadar(payload: { item_ids: string[] }): Promise<{ evaluation_job_id: string; status: string; recommendation_count: number }> {
  return apiRequest<{
    evaluation_job_id: string;
    status: string;
    recommendation_count: number;
    promoted_count: number;
    promotions: RadarPromotionResult[];
  }>("/api/v1/radar/evaluate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listRadarRecommendations(query: { decision?: RadarDecision } = {}): Promise<{ recommendations: RadarRecommendationRecord[] }> {
  return apiRequest<{ recommendations: RadarRecommendationRecord[] }>("/api/v1/radar/recommendations", {
    method: "GET",
    query,
  });
}

export async function listRadarEvents(
  query: { decision?: RadarPromotionDecision; limit?: number } = {}
): Promise<{ events: RadarEventRecord[] }> {
  return apiRequest<{ events: RadarEventRecord[] }>("/api/v1/radar/events", {
    method: "GET",
    query,
  });
}

export async function getRadarEvent(eventId: string): Promise<{
  event: RadarEventRecord;
  domain_posteriors: RadarDomainPosteriorRecord[];
  autonomy_decision: RadarAutonomyDecisionRecord | null;
  feedback: RadarOperatorFeedbackRecord[];
}> {
  return apiRequest<{
    event: RadarEventRecord;
    domain_posteriors: RadarDomainPosteriorRecord[];
    autonomy_decision: RadarAutonomyDecisionRecord | null;
    feedback: RadarOperatorFeedbackRecord[];
  }>(`/api/v1/radar/events/${eventId}`, {
    method: "GET",
  });
}

export async function listRadarDomainPacks(): Promise<{ domain_packs: RadarDomainPackDefinition[] }> {
  return apiRequest<{ domain_packs: RadarDomainPackDefinition[] }>("/api/v1/radar/domain-packs", {
    method: "GET",
  });
}

export async function getRadarControl(): Promise<{
  control: RadarControlSettingsRecord;
  domain_pack_metrics: RadarDomainPackMetricRecord[];
  sources: RadarFeedSourceRecord[];
  scanner_worker: SettingsOverviewData["radar_scanner_worker"];
}> {
  return apiRequest<{
    control: RadarControlSettingsRecord;
    domain_pack_metrics: RadarDomainPackMetricRecord[];
    sources: RadarFeedSourceRecord[];
    scanner_worker: SettingsOverviewData["radar_scanner_worker"];
  }>("/api/v1/radar/control", {
    method: "GET",
  });
}

export async function listRadarSources(query: { enabled?: boolean; limit?: number } = {}): Promise<{
  sources: RadarFeedSourceRecord[];
}> {
  return apiRequest<{ sources: RadarFeedSourceRecord[] }>("/api/v1/radar/sources", {
    method: "GET",
    query,
  });
}

export async function toggleRadarSource(sourceId: string, payload: { enabled: boolean }): Promise<{
  source: RadarFeedSourceRecord;
}> {
  return apiRequest<{ source: RadarFeedSourceRecord }>(`/api/v1/radar/sources/${sourceId}/toggle`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listRadarRuns(query: { source_id?: string; limit?: number } = {}): Promise<{
  runs: RadarIngestRunRecord[];
}> {
  return apiRequest<{ runs: RadarIngestRunRecord[] }>("/api/v1/radar/runs", {
    method: "GET",
    query,
  });
}

export async function updateRadarControl(payload: RadarControlUpdateRequest): Promise<{
  control: RadarControlSettingsRecord;
}> {
  return apiRequest<{
    control: RadarControlSettingsRecord;
  }>("/api/v1/radar/control", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function ackRadarEvent(eventId: string, payload: { note?: string } = {}): Promise<{
  event: RadarEventRecord | null;
  feedback: RadarOperatorFeedbackRecord;
}> {
  return apiRequest<{
    event: RadarEventRecord | null;
    feedback: RadarOperatorFeedbackRecord;
  }>(`/api/v1/radar/events/${eventId}/ack`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function overrideRadarEvent(
  eventId: string,
  payload: { decision: RadarPromotionDecision; note?: string }
): Promise<{
  event: RadarEventRecord | null;
  feedback: RadarOperatorFeedbackRecord;
}> {
  return apiRequest<{
    event: RadarEventRecord | null;
    feedback: RadarOperatorFeedbackRecord;
  }>(`/api/v1/radar/events/${eventId}/override`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendRadarTelegramReport(payload: { chat_id: string }): Promise<TelegramReportRecord> {
  return apiRequest<TelegramReportRecord>("/api/v1/radar/reports/telegram", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function retryRadarTelegramReport(
  reportId: string,
  payload: { max_attempts?: number } = {}
): Promise<TelegramReportRecord> {
  return apiRequest<TelegramReportRecord>(`/api/v1/radar/reports/telegram/${reportId}/retry`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listRadarTelegramReports(
  query: { status?: TelegramReportStatus; limit?: number } = {}
): Promise<{ reports: TelegramReportRecord[] }> {
  return apiRequest<{ reports: TelegramReportRecord[] }>("/api/v1/radar/reports/telegram", {
    method: "GET",
    query,
  });
}

export async function getRadarTelegramReport(reportId: string): Promise<TelegramReportRecord> {
  return apiRequest<TelegramReportRecord>(`/api/v1/radar/reports/telegram/${reportId}`, { method: "GET" });
}

export type TelegramReportsEventsStream = {
  close: () => void;
};

export function streamRadarTelegramReportsEvents(
  query: { status?: TelegramReportStatus; limit?: number } = {},
  handlers: {
    onOpen?: (payload: { request_id: string }) => void;
    onUpdated?: (payload: TelegramReportsStreamEnvelope) => void;
    onClose?: (payload: unknown) => void;
    onError?: (error: unknown) => void;
  }
): TelegramReportsEventsStream {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const querySuffix = params.toString().length > 0 ? `?${params.toString()}` : "";
  const source = createApiEventSource(`/api/v1/radar/reports/telegram/events${querySuffix}`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string });
  });

  source.addEventListener("telegram.reports.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as TelegramReportsStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    handlers.onClose?.(tryParseSseData((event as MessageEvent).data));
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export type TelegramReportEventsStream = {
  close: () => void;
};

export function streamRadarTelegramReportEvents(
  reportId: string,
  handlers: {
    onOpen?: (payload: { request_id: string; report_id: string }) => void;
    onUpdated?: (payload: TelegramReportStreamEnvelope) => void;
    onClose?: (payload: unknown) => void;
    onError?: (error: unknown) => void;
  }
): TelegramReportEventsStream {
  const source = createApiEventSource(`/api/v1/radar/reports/telegram/${reportId}/events`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string; report_id: string });
  });

  source.addEventListener("telegram.report.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as TelegramReportStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    handlers.onClose?.(tryParseSseData((event as MessageEvent).data));
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function listUpgradeProposals(query: { status?: UpgradeStatus } = {}): Promise<{ proposals: UpgradeProposalRecord[] }> {
  return apiRequest<{ proposals: UpgradeProposalRecord[] }>("/api/v1/upgrades/proposals", {
    method: "GET",
    query,
  });
}

export async function decideUpgradeProposal(proposalId: string, payload: ProposalDecisionRequest): Promise<UpgradeProposalRecord> {
  return apiRequest<UpgradeProposalRecord>(`/api/v1/upgrades/proposals/${proposalId}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function startUpgradeRun(payload: UpgradeRunRequest): Promise<UpgradeRunRecord> {
  return apiRequest<UpgradeRunRecord>("/api/v1/upgrades/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listUpgradeRuns(query: { limit?: number } = {}): Promise<{ runs: UpgradeRunRecord[] }> {
  return apiRequest<{ runs: UpgradeRunRecord[] }>("/api/v1/upgrades/runs", {
    method: "GET",
    query,
  });
}

export async function getUpgradeRun(runId: string): Promise<UpgradeRunRecord> {
  return apiRequest<UpgradeRunRecord>(`/api/v1/upgrades/runs/${runId}`, { method: "GET" });
}

export type ModelRegistryEntry = {
  id: string;
  provider: string;
  model_id: string;
  display_name: string | null;
  capabilities: string[];
  context_window: number | null;
  is_available: boolean;
  last_seen_at: string | null;
};

export type TaskModelPolicyEntry = {
  id: string;
  task_type: string;
  provider: string;
  model_id: string;
  tier: number;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function getModelRegistry(): Promise<{ models: ModelRegistryEntry[] }> {
  return apiRequest<{ models: ModelRegistryEntry[] }>("/api/v1/providers/registry", { method: "GET" });
}

export async function getTaskModelPolicies(): Promise<{ policies: TaskModelPolicyEntry[] }> {
  return apiRequest<{ policies: TaskModelPolicyEntry[] }>("/api/v1/providers/policies", { method: "GET" });
}

export async function upsertTaskModelPolicy(payload: {
  task_type: string;
  provider: string;
  model_id: string;
  tier?: number;
  priority?: number;
  is_active?: boolean;
}): Promise<TaskModelPolicyEntry> {
  return apiRequest<TaskModelPolicyEntry>("/api/v1/providers/policies", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function listApprovals(
  query: { status?: import("./types").ApprovalStatus; limit?: number } = {}
): Promise<{ approvals: import("./types").ApprovalRecord[] }> {
  return apiRequest<{ approvals: import("./types").ApprovalRecord[] }>("/api/v1/approvals", {
    method: "GET",
    query,
  });
}

export async function decideApproval(
  approvalId: string,
  payload: { decision: "approved" | "rejected"; reason?: string }
): Promise<import("./types").ApprovalRecord> {
  return apiRequest<import("./types").ApprovalRecord>(`/api/v1/approvals/${approvalId}/decision`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
