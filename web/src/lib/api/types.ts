import type { components as OpenApiComponents } from "@/lib/api/generated/openapi";

type ApiSchemas = OpenApiComponents["schemas"];

type OptionalByDefault<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR";

export type ApiErrorEnvelope = ApiSchemas["ApiErrorEnvelope"];

export type ApiSuccessEnvelope<T> = {
  request_id: string;
  data: T;
  meta: Record<string, unknown>;
};

export type ProviderName = ApiSchemas["ProviderAvailability"]["provider"];
export type ProviderAvailability = ApiSchemas["ProviderAvailability"];
export type RuntimeSelectedCredential = {
  source: UserProviderCredentialSource;
  selected_credential_mode: ProviderCredentialMode | null;
  credential_priority: ProviderCredentialPriority;
  auth_access_token_expires_at: string | null;
};
export type RuntimeResolvedRoute = {
  provider: ProviderName | "auto";
  model: string | null;
  strict_provider: boolean;
  source: "request_override" | "feature_preference" | "global_default" | "auto" | "runtime_result";
  used_fallback: boolean;
};
export type ProviderAttempt = ApiSchemas["ProviderAttempt"] & {
  credential?: {
    source: UserProviderCredentialSource;
    selectedCredentialMode: ProviderCredentialMode | null;
    credentialPriority: ProviderCredentialPriority;
    authAccessTokenExpiresAt: string | null;
  };
};
export type ProviderModelCatalogEntry = {
  provider: ProviderName;
  configured_model: string;
  recommended_model?: string;
  source: "remote" | "configured";
  models: string[];
  error?: string;
};
export type ProviderCredentialSource = "stored" | "env" | "none";
export type UserProviderCredentialSource = "user" | "workspace" | "env" | "none";
export type ProviderCredentialMode = "api_key" | "oauth_official";
export type ProviderCredentialSelectionMode = "auto" | ProviderCredentialMode;
export type ProviderCredentialPriority = "api_key_first" | "auth_first";
export type ProviderCredentialRecord = {
  provider: ProviderName;
  has_key: boolean;
  source: ProviderCredentialSource;
  updated_at: string | null;
};
export type UserProviderCredentialRecord = {
  provider: ProviderName;
  source: UserProviderCredentialSource;
  selected_credential_mode: ProviderCredentialMode | null;
  selected_user_credential_mode: ProviderCredentialSelectionMode;
  credential_priority: ProviderCredentialPriority;
  auth_access_token_expires_at: string | null;
  has_user_credential: boolean;
  has_user_api_key: boolean;
  has_user_oauth_official: boolean;
  has_user_oauth_token: boolean;
  user_updated_at: string | null;
  deleted?: boolean;
};
export type ProviderCredentialMutationResult = {
  provider: ProviderName;
  has_key: boolean;
  source: ProviderCredentialSource;
  updated_at?: string | null;
  deleted?: boolean;
};
export type UserProviderConnectionTestResult = {
  provider: ProviderName;
  ok: boolean;
  source: UserProviderCredentialSource;
  selected_credential_mode: ProviderCredentialMode | null;
  credential_priority: ProviderCredentialPriority;
  auth_access_token_expires_at: string | null;
  latency_ms: number;
  model?: string;
  reason?: string;
};
export type ProviderOauthStartResult = {
  provider: Extract<ProviderName, "openai" | "gemini">;
  auth_url: string;
  state: string;
  expires_at: string;
  callback_origins?: string[];
};
export type ModelControlFeatureKey =
  | "global_default"
  | "assistant_chat"
  | "assistant_context_run"
  | "council_run"
  | "execution_code"
  | "execution_compute"
  | "mission_plan_generation"
  | "mission_execute_step";
export type UserModelSelectionPreference = {
  userId: string;
  featureKey: ModelControlFeatureKey;
  provider: ProviderName | "auto";
  modelId: string | null;
  strictProvider: boolean;
  selectionMode: "auto" | "manual";
  updatedAt: string;
  updatedBy: string | null;
};
export type ModelRecommendationRun = {
  id: string;
  userId: string;
  featureKey: ModelControlFeatureKey;
  promptHash: string;
  promptExcerptRedacted: string;
  recommendedProvider: ProviderName;
  recommendedModelId: string;
  rationaleText: string;
  evidenceJson: Record<string, unknown>;
  recommenderProvider: "openai";
  appliedAt: string | null;
  createdAt: string;
};
export type AiInvocationTraceRecord = {
  id: string;
  userId: string;
  featureKey: ModelControlFeatureKey | "diagnostic";
  taskType: string;
  requestProvider: ProviderName | "auto";
  requestModel: string | null;
  resolvedProvider: ProviderName | null;
  resolvedModel: string | null;
  credentialMode: ProviderCredentialMode | null;
  credentialSource: UserProviderCredentialSource;
  attemptsJson: Array<Record<string, unknown>>;
  usedFallback: boolean;
  success: boolean;
  errorCode: string | null;
  errorMessageRedacted: string | null;
  latencyMs: number;
  traceId: string | null;
  contextRefsJson: Record<string, unknown>;
  createdAt: string;
};
export type AiInvocationMetrics = {
  windowStart: string;
  windowEnd: string;
  total: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  providerDistribution: Array<{ provider: ProviderName; count: number }>;
  credentialSourceDistribution: Array<{ source: UserProviderCredentialSource; count: number }>;
};
export type JarvisSessionIntent = "general" | "code" | "research" | "finance" | "news" | "council";
export type JarvisSessionStatus = "queued" | "running" | "blocked" | "needs_approval" | "completed" | "failed" | "stale";
export type JarvisWorkspacePreset = "jarvis" | "research" | "execution" | "control";
export type JarvisSessionPrimaryTarget = "assistant" | "mission" | "council" | "execution" | "briefing" | "dossier";
export type JarvisCapability =
  | "answer"
  | "research"
  | "brief"
  | "debate"
  | "plan"
  | "approve"
  | "execute"
  | "monitor"
  | "notify";
export type JarvisSessionStageStatus =
  | "queued"
  | "running"
  | "blocked"
  | "needs_approval"
  | "completed"
  | "failed"
  | "skipped";
export type JarvisSessionRecord = {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  source: string;
  intent: JarvisSessionIntent;
  status: JarvisSessionStatus;
  workspacePreset: JarvisWorkspacePreset | null;
  primaryTarget: JarvisSessionPrimaryTarget;
  taskId: string | null;
  missionId: string | null;
  assistantContextId: string | null;
  councilRunId: string | null;
  executionRunId: string | null;
  briefingId: string | null;
  dossierId: string | null;
  createdAt: string;
  updatedAt: string;
  lastEventAt: string;
};
export type JarvisSessionEventRecord = {
  id: string;
  sessionId: string;
  sequence: number;
  eventType: string;
  status: JarvisSessionStatus | null;
  summary: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};
export type JarvisSessionStageRecord = {
  id: string;
  sessionId: string;
  stageKey: string;
  capability: JarvisCapability;
  title: string;
  status: JarvisSessionStageStatus;
  orderIndex: number;
  dependsOnJson: string[];
  artifactRefsJson: Record<string, unknown>;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type JarvisNextAction = {
  kind: "open_action_center" | "open_brief" | "open_workbench" | "create_monitor";
  label: string;
} | null;
export type ActionProposalKind = "mission_execute" | "council_run" | "execution_run" | "workspace_prepare" | "notify" | "custom";
export type ActionProposalStatus = "pending" | "approved" | "rejected";
export type ActionProposalRecord = {
  id: string;
  userId: string;
  sessionId: string;
  kind: ActionProposalKind;
  title: string;
  summary: string;
  status: ActionProposalStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
};
export type JarvisRequest = {
  prompt: string;
  source?: string;
  client_session_id?: string;
  target_hint?: "assistant";
  provider?: ProviderName | "auto";
  strict_provider?: boolean;
  model?: string;
};
export type JarvisRequestResult = {
  session: JarvisSessionRecord;
  requested_capabilities: JarvisCapability[];
  active_capabilities: JarvisCapability[];
  completed_capabilities: JarvisCapability[];
  stages: JarvisSessionStageRecord[];
  next_action: JarvisNextAction;
  research_profile: string | null;
  research_profile_reasons: string[];
  quality_mode: "pass" | "warn" | "block" | null;
  warning_codes: string[];
  format_hint: string | null;
  quality_dimensions: Record<string, unknown> | null;
  memory_context: JarvisMemoryContext | null;
  memory_plan_signals: JarvisMemoryPlanSignal[];
  memory_plan_summary: string[];
  memory_preference_summary: string[];
  memory_preference_applied: string[];
  memory_influences: string[];
  execution_option: string | null;
  preferred_provider_applied: string | null;
  preferred_model_applied: string | null;
  project_context_refs: {
    repo_slug: string | null;
    project_name: string | null;
    pinned_refs: string[];
  } | null;
  monitoring_preference_applied: string | null;
  delegation: {
    intent: JarvisSessionIntent;
    complexity: "simple" | "moderate" | "complex";
    primary_target: JarvisSessionPrimaryTarget;
    capabilities: JarvisCapability[];
    task_id?: string;
    mission_id?: string;
    assistant_context_id?: string;
    council_run_id?: string;
    briefing_id?: string;
    dossier_id?: string;
    action_proposal_id?: string;
    planner_mode?: "llm" | "fallback";
    error?: string;
  };
};
export type JarvisSessionDetail = {
  session: JarvisSessionRecord;
  requested_capabilities: JarvisCapability[];
  active_capabilities: JarvisCapability[];
  completed_capabilities: JarvisCapability[];
  stages: JarvisSessionStageRecord[];
  next_action: JarvisNextAction;
  research_profile: string | null;
  research_profile_reasons: string[];
  quality_mode: "pass" | "warn" | "block" | null;
  warning_codes: string[];
  format_hint: string | null;
  quality_dimensions: Record<string, unknown> | null;
  memory_context: JarvisMemoryContext | null;
  memory_plan_signals: JarvisMemoryPlanSignal[];
  memory_plan_summary: string[];
  memory_preference_summary: string[];
  memory_preference_applied: string[];
  memory_influences: string[];
  execution_option: string | null;
  preferred_provider_applied: string | null;
  preferred_model_applied: string | null;
  project_context_refs: {
    repo_slug: string | null;
    project_name: string | null;
    pinned_refs: string[];
  } | null;
  monitoring_preference_applied: string | null;
  events: JarvisSessionEventRecord[];
  actions: ActionProposalRecord[];
  briefing: BriefingRecord | null;
  dossier: DossierRecord | null;
};
export type WatcherKind =
  | "external_topic"
  | "company"
  | "market"
  | "war_region"
  | "repo"
  | "task_health"
  | "mission_health"
  | "approval_backlog";
export type WatcherStatus = "active" | "paused" | "error";
export type WatcherRunStatus = "running" | "completed" | "failed";
export type WatcherRecord = {
  id: string;
  userId: string;
  kind: WatcherKind;
  status: WatcherStatus;
  title: string;
  query: string;
  configJson: Record<string, unknown>;
  lastRunAt: string | null;
  lastHitAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type WatcherRunRecord = {
  id: string;
  watcherId: string;
  userId: string;
  status: WatcherRunStatus;
  summary: string;
  briefingId: string | null;
  dossierId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type WatcherWorldModelDelta = {
  hasMeaningfulShift: boolean;
  reasons: string[];
  primaryHypothesisShift: number;
  counterHypothesisShift: number;
  invalidationHitCount: number;
  bottleneckShiftCount: number;
  topStateShift: {
    key: string;
    delta: number;
  } | null;
};
export type WatcherFollowUpRecord = {
  session: JarvisSessionRecord;
  actionProposal: ActionProposalRecord | null;
  changeClass:
    | "new_high_significance_item"
    | "official_update"
    | "policy_change"
    | "market_shift"
    | "repo_release"
    | "health_regression"
    | "routine_refresh";
  severity: "info" | "warning" | "critical";
  summary: string;
  score: number;
  reasons: string[];
  worldModelDelta: WatcherWorldModelDelta | null;
};
export type BriefingType = "daily" | "on_change" | "on_demand";
export type BriefingStatus = "draft" | "completed" | "failed";
export type BriefingRecord = {
  id: string;
  userId: string;
  watcherId: string | null;
  sessionId: string | null;
  type: BriefingType;
  status: BriefingStatus;
  title: string;
  query: string;
  summary: string;
  answerMarkdown: string;
  sourceCount: number;
  qualityJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type DossierStatus = "draft" | "ready" | "failed";
export type DossierRecord = {
  id: string;
  userId: string;
  sessionId: string | null;
  briefingId: string | null;
  title: string;
  query: string;
  status: DossierStatus;
  summary: string;
  answerMarkdown: string;
  qualityJson: Record<string, unknown>;
  conflictsJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type DossierSourceRecord = {
  id: string;
  dossierId: string;
  url: string;
  title: string;
  domain: string;
  snippet: string;
  publishedAt: string | null;
  sourceOrder: number;
  createdAt: string;
};
export type DossierClaimRecord = {
  id: string;
  dossierId: string;
  claimText: string;
  claimOrder: number;
  sourceUrls: string[];
  createdAt: string;
};
export type WorldModelStateVariable = {
  score: number;
  direction: "up" | "flat";
  drivers: string[];
};
export type DossierWorldModelHypothesisEvidence = {
  claim_text: string;
  relation: "supports" | "contradicts" | "context";
  source_urls: string[];
  weight: number;
};
export type DossierWorldModelHypothesis = {
  thesis: string;
  stance: "primary" | "counter";
  confidence: number;
  status: "active" | "weakened" | "invalidated";
  summary: string;
  watch_state_keys: string[];
  evidence: DossierWorldModelHypothesisEvidence[];
};
export type DossierWorldModelInvalidationCondition = {
  hypothesis_thesis: string;
  stance: "primary" | "counter";
  description: string;
  expected_by: string | null;
  observed_status: "pending" | "hit" | "missed";
  severity: "low" | "medium" | "high";
  matched_evidence: string[];
};
export type DossierWorldModelNextWatchSignal = {
  description: string;
  expected_by: string | null;
  severity: "low" | "medium" | "high";
  stance: "primary" | "counter";
};
export type DossierWorldModel = {
  state_snapshot: {
    generated_at: string;
    dominant_signals: string[];
    variables: Record<string, WorldModelStateVariable>;
    notes: string[];
  };
  bottlenecks: Array<{
    key: string;
    score: number;
    drivers: string[];
  }>;
  hypotheses: DossierWorldModelHypothesis[];
  invalidation_conditions: DossierWorldModelInvalidationCondition[];
  next_watch_signals: DossierWorldModelNextWatchSignal[];
};
export type DossierDetail = {
  dossier: DossierRecord;
  sources: DossierSourceRecord[];
  claims: DossierClaimRecord[];
  world_model?: DossierWorldModel;
};
export type DossierRefreshResult = DossierRecord & {
  world_model?: DossierWorldModel;
};
export type BriefingGenerateResult = BriefingRecord & {
  world_model?: {
    state_snapshot: {
      generated_at: string;
      dominant_signals: string[];
      variables: Record<string, WorldModelStateVariable>;
      notes: string[];
    };
    hypotheses: Array<{
      thesis: string;
      stance: "primary" | "counter";
      confidence: number;
      status: "active" | "weakened" | "invalidated";
      summary: string;
    }>;
  };
};
export type SkillId =
  | "deep_research"
  | "news_briefing"
  | "repo_health_review"
  | "incident_triage"
  | "model_recommendation_reasoner";
export type SkillCategory = "research" | "operations" | "code" | "routing";
export type SkillExecutionKind = "jarvis_request" | "model_recommendation";
export type SkillResourceKind = "guide" | "checklist" | "template";
export type SkillResourceRecord = {
  id: string;
  title: string;
  kind: SkillResourceKind;
  contentType: "text/markdown";
  content: string;
};
export type SkillRecord = {
  id: SkillId;
  title: string;
  summary: string;
  category: SkillCategory;
  executionKind: SkillExecutionKind;
  defaultFeatureKey?: ModelControlFeatureKey;
  suggestedWorkspacePreset: "jarvis" | "research" | "execution" | "control";
  suggestedWidgets: string[];
  keywords: string[];
  resources: SkillResourceRecord[];
};
export type SkillMatchRecord = {
  skill: SkillRecord;
  score: number;
  reason: string;
  matchedTerms: string[];
};
export type SkillUsePreview = {
  skillId: SkillId;
  title: string;
  summary: string;
  executionKind: SkillExecutionKind;
  normalizedPrompt: string;
  suggestedPrompt: string;
  suggestedTitle: string;
  suggestedWorkspacePreset: "jarvis" | "research" | "execution" | "control";
  suggestedWidgets: string[];
  featureKey?: ModelControlFeatureKey;
  taskType?: string;
  providerOverride?: ProviderName | "auto";
  modelOverride?: string;
  rationale: string;
};
export type SkillFindResult = {
  normalized_prompt: string;
  recommended_skill_id: SkillId | null;
  matches: SkillMatchRecord[];
};
export type SkillResourceDetail = {
  skill_id: SkillId;
  resource: SkillResourceRecord;
};
export type SkillUseResult = {
  dry_run: boolean;
  result_type: "preview" | "jarvis_request" | "model_recommendation";
  preview: SkillUsePreview;
  session?: JarvisSessionRecord;
  delegation?: JarvisRequestResult["delegation"];
  recommendation?: ModelRecommendationRun;
};
export type WorkspaceStatus = "ready" | "running" | "stopped" | "error";
export type WorkspaceKind = "current" | "worktree" | "devcontainer";
export type WorkspaceCommandRiskLevel = "read_only" | "write" | "build" | "network" | "process_control" | "unknown";
export type WorkspaceCommandImpactProfile =
  | "read_only"
  | "file_mutation"
  | "artifact_build"
  | "dependency_install"
  | "process_launch"
  | "external_access"
  | "external_sync"
  | "process_control"
  | "unclassified";
export type WorkspaceCommandSeverity = "low" | "medium" | "high" | "critical";
export type WorkspaceCommandImpactLevel = "none" | "possible" | "expected";
export type WorkspaceCommandImpactDimension = {
  level: WorkspaceCommandImpactLevel;
  summary: string;
  targets: string[];
};
export type WorkspaceCommandImpact = {
  files: WorkspaceCommandImpactDimension;
  network: WorkspaceCommandImpactDimension;
  processes: WorkspaceCommandImpactDimension;
  notes: string[];
};
export type WorkspaceCommandPolicy = {
  normalizedCommand: string;
  riskLevel: WorkspaceCommandRiskLevel;
  impactProfile: WorkspaceCommandImpactProfile;
  severity: WorkspaceCommandSeverity;
  disposition: "auto_run" | "approval_required" | "role_required";
  reason: string;
  impact: WorkspaceCommandImpact;
};
export type WorkspaceRecord = {
  id: string;
  userId: string;
  name: string;
  cwd: string;
  kind: WorkspaceKind;
  baseRef: string | null;
  sourceWorkspaceId: string | null;
  containerName: string | null;
  containerImage: string | null;
  containerSource: "image" | "dockerfile" | null;
  containerImageManaged: boolean;
  containerBuildContext: string | null;
  containerDockerfile: string | null;
  containerFeatures: string[];
  containerAppliedFeatures: string[];
  containerWorkdir: string | null;
  containerConfigPath: string | null;
  containerRunArgs: string[];
  containerWarnings: string[];
  status: WorkspaceStatus;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
  sessionId: string | null;
  activeCommand: string | null;
  exitCode: number | null;
  lastError: string | null;
};
export type WorkspaceSpawnResult = {
  workspace: WorkspaceRecord;
  low_risk: boolean;
  policy: WorkspaceCommandPolicy;
  requires_approval?: boolean;
  session?: JarvisSessionRecord;
  action?: ActionProposalRecord;
};
export type WorkspaceChunkRecord = {
  sequence: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
  createdAt: string;
};
export type ProviderConnectionTestResult = {
  provider: ProviderName;
  ok: boolean;
  source: ProviderCredentialSource;
  availability: {
    enabled: boolean;
    reason?: string;
  };
  catalog_source: "remote" | "configured";
  configured_model: string;
  model_count: number;
  sampled_models: string[];
  latency_ms: number;
  reason?: string;
};

export type TaskMode = ApiSchemas["Task"]["mode"];
export type TaskStatus = ApiSchemas["Task"]["status"];
export type TaskRecord = ApiSchemas["Task"];
export type TaskEventRecord = ApiSchemas["TaskEventRecord"];

export type MemoryCategory = ApiSchemas["MemorySnapshotEntry"]["category"];
export type MemorySnapshotEntry = ApiSchemas["MemorySnapshotEntry"];
export type MemorySnapshotData = ApiSchemas["MemorySnapshot"];
export type MemoryNoteKind = "user_preference" | "project_context" | "decision_memory" | "research_memory";
export type MemoryNoteSource = "manual" | "session" | "system";
export type MemoryNoteRecord = {
  id: string;
  userId: string;
  kind: MemoryNoteKind;
  key?: string | null;
  value?: string | null;
  attributes?: Record<string, unknown>;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  source: MemoryNoteSource;
  relatedSessionId: string | null;
  relatedTaskId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type MemorySummaryData = {
  counts: {
    total: number;
    pinned: number;
    user_preference: number;
    project_context: number;
    decision_memory: number;
    research_memory: number;
  };
  pinned_notes: MemoryNoteRecord[];
  recent_notes: MemoryNoteRecord[];
};
export type MemoryContextData = {
  query: string;
  notes: MemoryNoteRecord[];
  structured_notes: MemoryNoteRecord[];
  preferences: {
    responseStyle: "concise" | "balanced" | "detailed" | null;
    preferredProvider: ProviderName | "local" | null;
    preferredModel: string | null;
    riskTolerance: "cautious" | "balanced" | "aggressive" | null;
    approvalStyle: "read_only_review" | "approval_required_write" | "safe_auto_run_preferred" | null;
    monitoringPreference: "manual" | "important_changes" | "all_changes" | null;
    summary: string[];
  } | null;
  project_context: {
    repo_slug: string | null;
    project_name: string | null;
    goal_summary: string | null;
    pinned_refs: string[];
    note_ids: string[];
    summary: string[];
  } | null;
  recent_decision_signals: {
    recent_approval_history: boolean;
    recent_rejection_history: boolean;
    approval_sensitive_preference: boolean;
    safe_auto_run_acceptance: boolean;
    summary: string[];
  } | null;
  total: number;
};
export type JarvisMemoryContext = {
  notes: Array<{
    id: string;
    kind: MemoryNoteKind;
    key?: string | null;
    value?: string | null;
    attributes?: Record<string, unknown>;
    title: string;
    content: string;
    tags: string[];
    pinned: boolean;
    source: MemoryNoteSource;
    relatedSessionId: string | null;
    relatedTaskId: string | null;
    updatedAt: string;
  }>;
  structuredNotes: Array<{
    id: string;
    kind: MemoryNoteKind;
    key?: string | null;
    value?: string | null;
    attributes?: Record<string, unknown>;
    title: string;
    content: string;
    tags: string[];
    pinned: boolean;
    source: MemoryNoteSource;
    relatedSessionId: string | null;
    relatedTaskId: string | null;
    updatedAt: string;
  }>;
  summary: string[];
  appliedHints: string[];
  preferences: {
    responseStyle: "concise" | "balanced" | "detailed" | null;
    preferredProvider: ProviderName | "local" | null;
    preferredModel: string | null;
    riskTolerance: "cautious" | "balanced" | "aggressive" | null;
    approvalStyle: "read_only_review" | "approval_required_write" | "safe_auto_run_preferred" | null;
    monitoringPreference: "manual" | "important_changes" | "all_changes" | null;
    summary: string[];
  } | null;
  projectContext: {
    repoSlug: string | null;
    projectName: string | null;
    goalSummary: string | null;
    pinnedRefs: string[];
    noteIds: string[];
    summary: string[];
  } | null;
  recentDecisionSignals: {
    recentApprovalHistory: boolean;
    recentRejectionHistory: boolean;
    approvalSensitivePreference: boolean;
    safeAutoRunAcceptance: boolean;
    summary: string[];
  } | null;
};
export type JarvisMemoryPlanSignal =
  | "pinned_context"
  | "project_context_available"
  | "research_history_available"
  | "recent_approval_history"
  | "recent_rejection_history"
  | "risk_first_preference"
  | "approval_sensitive_preference"
  | "monitor_followup_preference"
  | "notify_followup_preference"
  | "concise_response_preference"
  | "balanced_response_preference"
  | "detailed_response_preference"
  | "cautious_risk_preference"
  | "aggressive_risk_preference"
  | "read_only_review_preference"
  | "manual_monitoring_preference"
  | "all_changes_monitoring_preference"
  | "safe_auto_run_preference"
  | "preferred_provider_available"
  | "preferred_model_available";

export type RadarItemStatus = ApiSchemas["RadarItem"]["status"];
export type RadarDecision = ApiSchemas["RadarRecommendation"]["decision"];
export type RadarSourceType =
  | "news"
  | "filing"
  | "policy"
  | "market_tick"
  | "freight"
  | "inventory"
  | "blog"
  | "forum"
  | "social"
  | "ops_policy"
  | "manual";
export type RadarSourceTier = "tier_0" | "tier_1" | "tier_2" | "tier_3";
export type RadarPromotionDecision = "ignore" | "watch" | "dossier" | "action" | "execute_auto_candidate";
export type RadarExecutionMode = "watch_only" | "dossier_only" | "proposal_auto" | "execute_auto" | "approval_required";
export type RadarRiskBand = "low" | "medium" | "high" | "critical";
export type RadarDomainId =
  | "geopolitics_energy_lng"
  | "macro_rates_inflation_fx"
  | "shipping_supply_chain"
  | "policy_regulation_platform_ai"
  | "company_earnings_guidance"
  | "commodities_raw_materials";
export type RadarItemRecord = ApiSchemas["RadarItem"] & {
  observedAt?: string | null;
  sourceType?: RadarSourceType;
  sourceTier?: RadarSourceTier;
  rawMetrics?: Record<string, unknown>;
  entityHints?: string[];
  trustHint?: string | null;
  payload?: Record<string, unknown>;
};
export type RadarRecommendationRecord = ApiSchemas["RadarRecommendation"] & {
  eventId?: string;
  structuralityScore?: number;
  actionabilityScore?: number;
  promotionDecision?: RadarPromotionDecision;
  domainIds?: RadarDomainId[];
  autonomyExecutionMode?: RadarExecutionMode;
  autonomyRiskBand?: RadarRiskBand;
};
export type RadarMetricShock = {
  metricKey: string;
  value: string | number | null;
  unit: string | null;
  direction: "up" | "down" | "flat" | "unknown";
  observedAt: string | null;
};
export type RadarSourceMix = {
  sourceTiers: RadarSourceTier[];
  sourceTypes: RadarSourceType[];
};
export type RadarEventRecord = {
  id: string;
  title: string;
  summary: string;
  eventType: string;
  geoScope: string | null;
  timeScope: string | null;
  dedupeClusterId: string;
  itemIds: string[];
  entities: string[];
  claims: string[];
  metricShocks: RadarMetricShock[];
  sourceMix: RadarSourceMix;
  noveltyScore: number;
  corroborationScore: number;
  metricAlignmentScore: number;
  bottleneckProximityScore: number;
  persistenceScore: number;
  structuralityScore: number;
  actionabilityScore: number;
  decision: RadarPromotionDecision;
  overrideDecision: RadarPromotionDecision | null;
  expectedNextSignals: string[];
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
export type RadarDomainPosteriorRecord = {
  id: string;
  eventId: string;
  domainId: RadarDomainId;
  score: number;
  evidenceFeatures: string[];
  counterFeatures: string[];
  recommendedPackId: RadarDomainId;
  createdAt: string;
};
export type RadarAutonomyDecisionRecord = {
  id: string;
  eventId: string;
  riskBand: RadarRiskBand;
  executionMode: RadarExecutionMode;
  policyReasons: string[];
  requiresHuman: boolean;
  killSwitchScope: "none" | "global" | "domain_pack" | "source_tier";
  createdAt: string;
  updatedAt: string;
};
export type RadarOperatorFeedbackRecord = {
  id: string;
  eventId: string;
  userId: string;
  kind: "ack" | "override";
  note: string | null;
  overrideDecision: RadarPromotionDecision | null;
  createdAt: string;
};
export type RadarDomainPackMetricRecord = {
  domainId: RadarDomainId;
  calibrationScore: number;
  evaluationCount: number;
  promotionCount: number;
  dossierCount: number;
  actionCount: number;
  autoExecuteCount: number;
  overrideCount: number;
  ackCount: number;
  confirmedCount: number;
  invalidatedCount: number;
  mixedCount: number;
  unresolvedCount: number;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type RadarControlSettingsRecord = {
  globalKillSwitch: boolean;
  autoExecutionEnabled: boolean;
  dossierPromotionEnabled: boolean;
  tier3EscalationEnabled: boolean;
  disabledDomainIds: RadarDomainId[];
  disabledSourceTiers: RadarSourceTier[];
  updatedBy: string | null;
  updatedAt: string;
};
export type RadarFeedKind = "rss" | "atom" | "json" | "mcp_connector" | "synthetic";
export type RadarIngestRunStatus = "running" | "ok" | "error";
export type RadarFeedSourceRecord = {
  id: string;
  name: string;
  kind: RadarFeedKind;
  url: string;
  sourceType: RadarSourceType;
  sourceTier: RadarSourceTier;
  pollMinutes: number;
  enabled: boolean;
  parserHints: Record<string, unknown>;
  entityHints: string[];
  metricHints: string[];
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
export type RadarIngestRunRecord = {
  id: string;
  sourceId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: RadarIngestRunStatus;
  fetchedCount: number;
  ingestedCount: number;
  evaluatedCount: number;
  promotedCount: number;
  autoExecutedCount: number;
  failedCount: number;
  error: string | null;
  detailJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type RadarDomainPackDefinition = {
  id: RadarDomainId;
  displayName: string;
  ontology: string[];
  mechanismTemplates: string[];
  stateVariables: string[];
  invalidationTemplates: string[];
  watchMetrics: string[];
  keywordLexicon: string[];
  actionMapping: {
    watcherKind: WatcherKind;
    sessionIntent: JarvisSessionIntent;
    defaultActionKind: ActionProposalKind;
    executionMode: RadarExecutionMode;
  };
};
export type RadarPromotionResult = {
  event_id: string;
  decision: RadarPromotionDecision;
  watcher_id: string | null;
  briefing_id: string | null;
  dossier_id: string | null;
  session_id: string | null;
  action_proposal_id: string | null;
  auto_executed: boolean;
};
export type RadarControlUpdateRequest = {
  global_kill_switch?: boolean;
  auto_execution_enabled?: boolean;
  dossier_promotion_enabled?: boolean;
  tier3_escalation_enabled?: boolean;
  disabled_domain_ids?: RadarDomainId[];
  disabled_source_tiers?: RadarSourceTier[];
};

export type UpgradeStatus = ApiSchemas["UpgradeProposal"]["status"];
export type UpgradeProposalRecord = ApiSchemas["UpgradeProposal"];
export type UpgradeRunRecord = ApiSchemas["UpgradeRun"];
export type TelegramReportRecord = ApiSchemas["TelegramReport"];
export type TelegramReportStatus = TelegramReportRecord["status"];
export type HealthPayload = ApiSchemas["Health"];

export type AiRespondRequest = OptionalByDefault<ApiSchemas["AiRespondRequest"], "provider" | "strict_provider" | "task_type">;
export type GroundingPolicy = "static" | "dynamic_factual" | "high_risk_factual";
export type GroundingStatus =
  | "not_required"
  | "provider_only"
  | "required_unavailable"
  | "blocked_due_to_quality_gate"
  | "soft_warn"
  | "served_with_limits";
export type GroundingQualityCode = string;
export type AiRespondData = ApiSchemas["AiRespondResult"] & {
  attempts: ProviderAttempt[];
  credential?: RuntimeSelectedCredential;
  selection?: {
    strategy: "auto_orchestrator" | "requested_provider";
    taskType: TaskMode;
    orderedProviders: ProviderName[];
    scores?: Array<{
      provider: ProviderName;
      score: number;
      breakdown?: {
        domain_fit: number;
        recent_success: number;
        latency: number;
        cost: number;
        context_fit: number;
        prompt_fit: number;
        availability_penalty: number;
      };
    }>;
    reason?: string;
  };
  grounding?: {
    policy: GroundingPolicy;
    required: boolean;
    reasons: string[];
    status: GroundingStatus;
    render_mode?: AssistantRenderMode;
    sources?: Array<{
      url: string;
      title: string;
      domain: string;
    }>;
    claims?: Array<{
      claimText: string;
      sourceUrls: string[];
    }>;
    source_count?: number;
    domain_count?: number;
    freshness_ratio?: number | null;
    quality_gate_code?: GroundingQualityCode[];
    retrieval_quality_gate_code?: GroundingQualityCode[];
    quality_gate_result?: "hard_fail" | "soft_warn" | "pass";
    fallback_trace_tag?: string | null;
    quality_gate?: {
      passed: boolean;
      reasons: string[];
    };
    quality?: {
      gateResult: "hard_fail" | "soft_warn" | "pass";
      reasons: string[];
      softened: boolean;
      languageAligned: boolean;
      claimCitationCoverage: number;
    };
    language?: {
      expected?: string | null;
      detected?: string | null;
      score?: number;
    };
  };
  delivery?: {
    mode: "normal" | "degraded";
    contextId: string | null;
    revision: number;
  };
};

export type AssistantRenderMode = "user_mode" | "debug_mode";
export type AssistantFeedbackSignal = "good" | "bad";
export type AssistantFeedbackEventData = {
  answer_quality?: AssistantFeedbackSignal | null;
  source_quality?: AssistantFeedbackSignal | null;
  comment?: string | null;
  task_id?: string | null;
};

export type CouncilRole = ApiSchemas["CouncilParticipant"]["role"];
export type CouncilConsensusStatus = Exclude<ApiSchemas["CouncilRun"]["consensus_status"], null>;
export type CouncilParticipantRecord = ApiSchemas["CouncilParticipant"];

export type CouncilRunRecord = ApiSchemas["CouncilRun"] & {
  selected_credential?: RuntimeSelectedCredential | null;
  resolved_route?: RuntimeResolvedRoute | null;
  attempts: ProviderAttempt[];
  idempotent_replay?: boolean;
  session?: JarvisSessionRecord | null;
};

export type CouncilRunRequest = OptionalByDefault<
  ApiSchemas["CouncilRunCreateRequest"],
  "provider" | "strict_provider" | "create_task"
> & {
  client_session_id?: string;
  idempotency_key?: string;
  trace_id?: string;
};

export type ExecutionRunMode = ApiSchemas["ExecutionRun"]["mode"];

export type ExecutionRunRecord = ApiSchemas["ExecutionRun"] & {
  selected_credential?: RuntimeSelectedCredential | null;
  resolved_route?: RuntimeResolvedRoute | null;
  attempts: ProviderAttempt[];
  idempotent_replay?: boolean;
  session?: JarvisSessionRecord | null;
};

export type ExecutionRunRequest = OptionalByDefault<
  ApiSchemas["ExecutionRunCreateRequest"],
  "provider" | "strict_provider" | "create_task"
> & {
  client_session_id?: string;
  idempotency_key?: string;
  trace_id?: string;
};

export type TaskCreateRequest = OptionalByDefault<ApiSchemas["TaskCreateRequest"], "mode">;

export type TaskListQuery = {
  status?: TaskStatus;
  limit?: number;
};

export type RadarIngestRequest = OptionalByDefault<ApiSchemas["RadarIngestRequest"], "source_name">;

export type UpgradeRunRequest = {
  proposal_id: string;
  start_command: "작업 시작";
  eval?: {
    accuracy: number;
    safety: number;
    cost_delta_pct: number;
  };
};

export type ProposalDecisionRequest = ApiSchemas["ProposalDecisionRequest"];

export type TaskStreamEnvelope = ApiSchemas["TaskSseDataEnvelope"];
export type ExecutionRunStreamEnvelope = ApiSchemas["ExecutionRunSseDataEnvelope"];
export type CouncilRunStreamEnvelope = ApiSchemas["CouncilRunSseDataEnvelope"];
export type CouncilRoundStartedStreamEnvelope = {
  run_id: string;
  timestamp: string;
  round: number;
  max_rounds: number;
  provider: ProviderName | null;
  model: string;
  attempt_count: number;
};
export type CouncilAgentRespondedStreamEnvelope = {
  run_id: string;
  timestamp: string;
  round: number;
  max_rounds: number;
  agent_index: number;
  attempt: ProviderAttempt;
};
export type CouncilRoundCompletedStreamEnvelope = {
  run_id: string;
  timestamp: string;
  round: number;
  max_rounds: number;
  summary: string;
  provider: ProviderName | null;
  model: string;
  used_fallback: boolean;
  attempt_count: number;
};
export type TelegramReportSummary = {
  queued: number;
  sent: number;
  failed: number;
};
export type TelegramReportsStreamEnvelope = {
  timestamp: string;
  data: {
    reports: TelegramReportRecord[];
    summary: TelegramReportSummary;
  };
};
export type TelegramReportStreamEnvelope = {
  report_id: string;
  timestamp: string;
  data: TelegramReportRecord;
};
export type AssistantContextEventStreamEnvelope = {
  context_id: string;
  timestamp: string;
  event: AssistantContextEventRecord;
  context?: AssistantContextRecord;
};

export type ReportsOverviewData = {
  generated_at: string;
  sampled_limits: {
    task_limit: number;
    run_limit: number;
  };
  tasks: {
    total: number;
    by_status: Record<TaskStatus, number>;
    by_mode: Record<TaskMode, number>;
    running: number;
    failed_or_cancelled: number;
  };
  councils: {
    total: number;
    by_status: Record<"queued" | "running" | "completed" | "failed", number>;
    by_consensus: Record<"consensus_reached" | "contradiction_detected" | "escalated_to_human", number>;
    escalated: number;
  };
  executions: {
    total: number;
    by_status: Record<"queued" | "running" | "completed" | "failed", number>;
    avg_duration_ms: number;
    fallback_used: number;
    fallback_rate_pct: number;
  };
  upgrades: {
    total: number;
    by_status: Record<UpgradeStatus, number>;
    pending_approvals: number;
  };
  radar: {
    recommendation_total: number;
    by_decision: Record<RadarDecision, number>;
  };
  providers: {
    enabled: number;
    disabled: number;
    items: ProviderAvailability[];
  };
};

export type SettingsOverviewData = {
  generated_at: string;
  backend: {
    env: string;
    store: "memory" | "postgres";
    db: "up" | "down" | "n/a";
    now: string;
  };
  providers: Array<{
    provider: ProviderName;
    enabled: boolean;
    model: string | null;
    reason?: string;
    credential_source?: UserProviderCredentialSource;
    selected_credential_mode?: ProviderCredentialMode | null;
    credential_priority?: ProviderCredentialPriority;
    attempts: number;
    successes: number;
    failures: number;
    avg_latency_ms: number;
    success_rate_pct: number;
    last_attempt_at: string | null;
    cooldown_until?: string | null;
    cooldown_reason?: string | null;
    health_failure_count?: number;
  }>;
  policies: {
    high_risk_requires_approval: boolean;
    approval_max_age_hours: number;
    high_risk_allowed_roles: Array<"member" | "operator" | "admin">;
    provider_failover_auto: boolean;
    auth_required: boolean;
    auth_allow_signup: boolean;
    auth_token_configured: boolean;
  };
  oauth_worker?: {
    enabled: boolean;
    inflight: boolean;
    history: Array<Record<string, unknown>>;
    lastRun?: Record<string, unknown> | null;
  };
  ai_trace_worker?: {
    enabled: boolean;
    inflight: boolean;
    history: Array<Record<string, unknown>>;
    lastRun?: Record<string, unknown> | null;
  };
  jarvis_watcher_worker?: {
    enabled: boolean;
    inflight: boolean;
    history: Array<Record<string, unknown>>;
    lastRun?: Record<string, unknown> | null;
  };
  radar_scanner_worker?: {
    enabled: boolean;
    inflight: boolean;
    history: Array<Record<string, unknown>>;
    lastRun?: Record<string, unknown> | null;
  };
  workspace_runtime?: {
    total: number;
    running: number;
    worktrees?: number;
    rootPath: string;
  };
  jarvis_skills_enabled?: boolean;
  notification_runtime?: {
    listeners: number;
    emitted: number;
    suppressed: number;
    lastEventAt: string | null;
    dedupeWindowMs: number;
    channels: Array<{
      name: string;
      sent: number;
      skipped: number;
      failed: number;
      lastSuccessAt: string | null;
      lastErrorAt: string | null;
      lastError: string | null;
    }>;
  } | null;
  notification_policy?: {
    in_app: {
      enabled: boolean;
      min_severity: SystemNotification["severity"];
      event_types: string[];
    };
    webhook: {
      enabled: boolean;
      min_severity: SystemNotification["severity"];
      event_types: string[];
    };
    telegram: {
      enabled: boolean;
      min_severity: SystemNotification["severity"];
      event_types: string[];
    };
  };
  radar_policy?: {
    control: RadarControlSettingsRecord;
    domain_pack_metrics: RadarDomainPackMetricRecord[];
    sources?: RadarFeedSourceRecord[];
    scanner_worker?: SettingsOverviewData["radar_scanner_worker"];
  };
};

export type NotificationEventType =
  | "mission_step_completed"
  | "radar_new_item"
  | "eval_gate_degradation"
  | "idle_reminder"
  | "approval_required"
  | "watcher_hit"
  | "briefing_ready"
  | "action_proposal_ready"
  | "session_stalled";

export type SystemNotification = {
  id: string;
  type: NotificationEventType;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  actionUrl?: string;
  entityType?: string;
  entityId?: string;
  createdAt: string;
};

export type DashboardOverviewData = {
  generated_at: string;
  signals: {
    task_count: number;
    running_count: number;
    failed_count: number;
    blocked_count: number;
    pending_approval_count: number;
    pending_session_approval_count: number;
  };
  tasks: TaskRecord[];
  running_tasks: TaskRecord[];
  pending_approvals: UpgradeProposalRecord[];
};

export type DashboardOverviewStreamEnvelope = {
  timestamp: string;
  data: DashboardOverviewData;
};

export type MissionStreamEnvelope = {
  mission_id: string;
  timestamp: string;
  data: MissionRecord;
};

export type AuthUserRole = "member" | "operator" | "admin";

export type AuthUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: AuthUserRole;
};

export type AuthSessionData = {
  token: string;
  expires_at: string;
  user: AuthUser;
};

export type AuthMeData = {
  user: AuthUser;
  auth_type: "session" | "static_token";
};

export type AuthConfigData = {
  auth_required: boolean;
  auth_allow_signup: boolean;
  auth_token_configured: boolean;
};

export type AuthSignupRequest = {
  email: string;
  password: string;
  display_name?: string;
};

export type AuthLoginRequest = {
  email: string;
  password: string;
};

export type AuthStaticTokenLoginRequest = {
  token: string;
};

export type AuthStaticTokenLoginData = {
  user: AuthUser;
  auth_type: "static_token";
  expires_at: string;
};

export type MissionDomain = "code" | "research" | "finance" | "news" | "mixed";
export type MissionStatus = "draft" | "planned" | "running" | "blocked" | "completed" | "failed";
export type MissionStepPattern = "llm_generate" | "council_debate" | "human_gate" | "tool_call" | "sub_mission";
export type LegacyMissionStepType = "code" | "research" | "finance" | "news" | "approval" | "execute";
export type MissionStepType = MissionStepPattern | LegacyMissionStepType;
export type MissionStepStatus = "pending" | "running" | "done" | "blocked" | "failed";
export type ComplexityLevel = "simple" | "moderate" | "complex";
export type AssistantContextStatus = "running" | "completed" | "failed";
export type AssistantStage =
  | "accepted"
  | "policy_resolved"
  | "retrieval_started"
  | "retrieval_completed"
  | "generation_started"
  | "quality_checked"
  | "finalized";

export type AssistantStageTimelineItem = {
  stage: AssistantStage;
  stageSeq: number;
  startedAt: string;
  endedAt: string | null;
  reasonCode: string | null;
  finalized: "delivered" | "failed" | null;
  contextId: string;
  revision: number;
  taskId: string | null;
};

export type AssistantQualityMeta = {
  gateResult: "hard_fail" | "soft_warn" | "pass";
  reasons: string[];
  softened: boolean;
  languageAligned: boolean;
  claimCitationCoverage: number;
};

export type SessionRestoreMeta = {
  lastRenderedContextRevision?: Record<string, number>;
  restoreMode?: "full" | "focus_only";
};

export type MissionStepRecord = {
  id: string;
  type: MissionStepType;
  title: string;
  description: string;
  route: string;
  status: MissionStepStatus;
  order: number;
  taskType?: string;
  metadata?: Record<string, unknown>;
};

export type MissionApprovalPolicyMode = "auto" | "required_for_high_risk" | "required_for_all";

export type MissionContractConstraints = {
  maxCostUsd?: number;
  deadlineAt?: string;
  allowedTools?: string[];
  maxRetriesPerStep?: number;
};

export type MissionApprovalPolicy = {
  mode: MissionApprovalPolicyMode;
  approverRoles?: Array<"operator" | "admin">;
};

export type MissionContract = {
  constraints: MissionContractConstraints;
  approvalPolicy: MissionApprovalPolicy;
};

export type MissionContractConstraintsInput = {
  max_cost_usd?: number;
  deadline_at?: string;
  allowed_tools?: string[];
  max_retries_per_step?: number;
};

export type MissionApprovalPolicyInput = {
  mode?: MissionApprovalPolicyMode;
  approver_roles?: Array<"operator" | "admin">;
};

export type MissionRecord = {
  id: string;
  userId: string;
  workspaceId: string | null;
  title: string;
  objective: string;
  domain: MissionDomain;
  status: MissionStatus;
  missionContract: MissionContract;
  steps: MissionStepRecord[];
  createdAt: string;
  updatedAt: string;
};

export type MissionCreateRequest = {
  title: string;
  objective: string;
  domain?: MissionDomain;
  workspace_id?: string;
  constraints?: MissionContractConstraintsInput;
  approval_policy?: MissionApprovalPolicyInput;
  steps?: Array<{
    type: MissionStepType;
    title: string;
    description?: string;
    route?: string;
    task_type?: string;
    metadata?: Record<string, unknown>;
  }>;
};

export type OrchestratorPlanStep = {
  id: string;
  type: MissionStepPattern;
  taskType: string;
  title: string;
  description: string;
  order: number;
  dependencies: string[];
  metadata?: Record<string, unknown>;
};

export type OrchestratorPlan = {
  title: string;
  objective: string;
  domain: string;
  steps: OrchestratorPlanStep[];
};

export type GeneratePlanRequest = {
  prompt: string;
  auto_create?: boolean;
  complexity_hint?: ComplexityLevel;
};

export type GeneratePlanResponse = {
  plan: OrchestratorPlan;
  mission?: MissionRecord;
  complexity: ComplexityLevel;
};

export type MissionUpdateRequest = {
  status?: MissionStatus;
  title?: string;
  objective?: string;
  constraints?: MissionContractConstraintsInput;
  approval_policy?: MissionApprovalPolicyInput;
  step_statuses?: Array<{
    step_id: string;
    status: MissionStepStatus;
  }>;
};

export type AssistantContextRecord = {
  id: string;
  userId: string;
  clientContextId: string;
  source: string;
  intent: string;
  prompt: string;
  widgetPlan: string[];
  status: AssistantContextStatus;
  taskId: string | null;
  servedProvider: ProviderName | null;
  servedModel: string | null;
  usedFallback: boolean;
  selectionReason: string | null;
  output: string;
  error: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type AssistantContextCreateRequest = {
  client_context_id: string;
  source?: string;
  intent?: string;
  prompt: string;
  widget_plan?: string[];
  task_id?: string;
};

export type AssistantContextUpdateRequest = {
  status?: AssistantContextStatus;
  task_id?: string | null;
  served_provider?: ProviderName | null;
  served_model?: string | null;
  used_fallback?: boolean;
  selection_reason?: string | null;
  output?: string;
  error?: string | null;
};

export type AssistantContextRunRequest = {
  provider?: "auto" | ProviderName;
  strict_provider?: boolean;
  task_type?:
    | "chat"
    | "execute"
    | "council"
    | "code"
    | "compute"
    | "long_run"
    | "high_risk"
    | "radar_review"
    | "upgrade_execution";
  model?: string;
  temperature?: number;
  max_output_tokens?: number;
  force_rerun?: boolean;
  client_run_nonce?: string;
};

export type AssistantContextRunMeta = {
  accepted: boolean;
  reason?: string;
  client_run_nonce?: string | null;
  run?: {
    accepted: boolean;
    replayed?: boolean;
    nonce?: string | null;
  };
  stage?: {
    current?: AssistantStage;
    seq?: number;
  };
  delivery?: {
    mode: "normal" | "degraded";
    contextId: string;
    revision: number;
  };
};

export type AssistantContextEventRecord = {
  id: string;
  contextId: string;
  sequence: number;
  eventType: string;
  data: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  createdAt: string;
};

export type AssistantContextGroundingSourceRecord = {
  id: string;
  contextId: string;
  url: string;
  title: string;
  domain: string;
  sourceOrder: number;
  createdAt: string;
};

export type AssistantContextGroundingClaimCitationRecord = {
  sourceId: string;
  url: string;
  title: string;
  domain: string;
  citationOrder: number;
  sourceOrder: number;
};

export type AssistantContextGroundingClaimRecord = {
  id: string;
  contextId: string;
  claimText: string;
  claimOrder: number;
  citations: AssistantContextGroundingClaimCitationRecord[];
  createdAt: string;
};

export type AssistantContextGroundingEvidenceData = {
  context_id: string;
  status: AssistantContextStatus;
  sources: AssistantContextGroundingSourceRecord[];
  claims: AssistantContextGroundingClaimRecord[];
  summary: {
    source_count: number;
    claim_count: number;
    unique_domains: string[];
    updated_at: string;
  };
};

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRecord = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: ApprovalStatus;
  requestedBy: string;
  decidedBy?: string | null;
  decision?: string | null;
  reason?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceWorkspaceRole = "owner" | "admin" | "member";
export type IntelligenceSourceKind = "rss" | "atom" | "json" | "api" | "search" | "headless" | "mcp_connector" | "synthetic";
export type IntelligenceSourceType =
  | "news"
  | "filing"
  | "policy"
  | "market_tick"
  | "freight"
  | "inventory"
  | "blog"
  | "forum"
  | "social"
  | "search_result"
  | "web_page"
  | "manual";
export type IntelligenceSourceTier = "tier_0" | "tier_1" | "tier_2" | "tier_3";
export type IntelligenceEventFamily =
  | "geopolitical_flashpoint"
  | "policy_change"
  | "earnings_guidance"
  | "supply_chain_shift"
  | "rate_repricing"
  | "commodity_move"
  | "platform_ai_shift"
  | "general_signal";
export type IntelligenceDomainId =
  | "geopolitics_energy_lng"
  | "macro_rates_inflation_fx"
  | "shipping_supply_chain"
  | "policy_regulation_platform_ai"
  | "company_earnings_guidance"
  | "commodities_raw_materials";
export type IntelligenceCapabilityAlias =
  | "fast_triage"
  | "structured_extraction"
  | "cross_doc_linking"
  | "skeptical_critique"
  | "deep_synthesis"
  | "policy_judgment"
  | "deep_research"
  | "execution_planning";
export type IntelligenceScanRunStatus = "running" | "ok" | "error" | "timeout";
export type IntelligenceExecutionStatus = "pending" | "approved" | "executed" | "blocked" | "failed";
export type IntelligenceSignalProcessingStatus = "pending" | "processing" | "processed" | "failed";

export type IntelligenceSourceHealth = {
  lastStatus: "idle" | "ok" | "error" | "blocked";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  recentLatencyMs: number | null;
  status403Count: number;
  status429Count: number;
  robotsBlocked: boolean;
  lastFailureReason: string | null;
  updatedAt: string | null;
};

export type IntelligenceCrawlPolicy = {
  allowDomains: string[];
  denyDomains: string[];
  respectRobots: boolean;
  maxDepth: number;
  maxPagesPerRun: number;
  revisitCooldownMinutes: number;
  perDomainRateLimitPerMinute: number;
};

export type ConnectorCapabilityRecord = {
  connectorId: string;
  writeAllowed: boolean;
  destructive: boolean;
  requiresHuman: boolean;
  schemaId: string | null;
  allowedActions: string[];
};

export type IntelligenceFetchFailureRecord = {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  url: string;
  reason: string;
  statusCode: number | null;
  retryable: boolean;
  blockedByRobots: boolean;
  createdAt: string;
};

export type ProviderHealthRecord = {
  provider: ProviderName;
  available: boolean;
  cooldownUntil: string | null;
  reasonCode: string | null;
  failureCount: number;
  updatedAt: string | null;
};

export type AliasRolloutRecord = {
  id: string;
  workspaceId: string | null;
  alias: IntelligenceCapabilityAlias;
  bindingIds: string[];
  createdBy: string | null;
  note: string | null;
  createdAt: string;
};

export type IntelligenceWorkspaceRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceSourceRecord = {
  id: string;
  workspaceId: string;
  name: string;
  kind: IntelligenceSourceKind;
  url: string;
  sourceType: IntelligenceSourceType;
  sourceTier: IntelligenceSourceTier;
  pollMinutes: number;
  enabled: boolean;
  parserConfigJson: Record<string, unknown>;
  crawlConfigJson: Record<string, unknown>;
  crawlPolicy: IntelligenceCrawlPolicy;
  health: IntelligenceSourceHealth;
  connectorCapability: ConnectorCapabilityRecord | null;
  entityHints: string[];
  metricHints: string[];
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceScanRunRecord = {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  status: IntelligenceScanRunStatus;
  fetchedCount: number;
  storedDocumentCount: number;
  signalCount: number;
  clusteredEventCount: number;
  executionCount: number;
  failedCount: number;
  error: string | null;
  detailJson: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceSemanticClaim = {
  claimId: string;
  subjectEntity: string;
  predicate: string;
  object: string;
  evidenceSpan: string | null;
  timeScope: string | null;
  uncertainty: "low" | "medium" | "high";
  stance: "supporting" | "neutral" | "contradicting";
  claimType: "fact" | "prediction" | "opinion" | "signal";
};

export type LinkedClaimRecord = {
  id: string;
  workspaceId: string;
  claimFingerprint: string;
  canonicalSubject: string;
  canonicalPredicate: string;
  canonicalObject: string;
  predicateFamily: string;
  timeScope: string | null;
  timeBucketStart: string | null;
  timeBucketEnd: string | null;
  stanceDistribution: {
    supporting: number;
    neutral: number;
    contradicting: number;
  };
  sourceCount: number;
  contradictionCount: number;
  nonSocialSourceCount: number;
  supportingSignalIds: string[];
  lastSupportedAt: string | null;
  lastContradictedAt: string | null;
  reviewState: EventReviewState;
  reviewReason: string | null;
  reviewOwner: string | null;
  reviewUpdatedAt: string | null;
  reviewUpdatedBy: string | null;
  reviewResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LinkedClaimEdgeRecord = {
  id: string;
  workspaceId: string;
  leftLinkedClaimId: string;
  rightLinkedClaimId: string;
  relation: "supports" | "contradicts" | "related";
  edgeStrength: number;
  evidenceSignalIds: string[];
  lastObservedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClaimLinkRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  linkedClaimId: string;
  signalId: string;
  semanticClaimId: string;
  relation: "supporting" | "contradicting" | "related";
  confidence: number;
  linkStrength: number;
  createdAt: string;
};

export type IntelligenceMetricShock = {
  metricKey: string;
  value: number | string | null;
  unit: string | null;
  direction: "up" | "down" | "flat" | "unknown";
  observedAt: string | null;
};

export type IntelligenceDomainPosterior = {
  id: string;
  domainId: IntelligenceDomainId;
  score: number;
  evidenceFeatures: string[];
  counterFeatures: string[];
};

export type IntelligenceWorldState = {
  id: string;
  key: string;
  valueJson: Record<string, unknown>;
};

export type IntelligenceHypothesisRecord = {
  id: string;
  title: string;
  summary: string;
  confidence: number;
  rationale: string;
};

export type IntelligenceCounterHypothesisRecord = IntelligenceHypothesisRecord;

export type IntelligenceInvalidationConditionRecord = {
  id: string;
  title: string;
  description: string;
  matcherJson: Record<string, unknown>;
  status: "pending" | "hit" | "missed";
};

export type IntelligenceInvalidationEntryRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  title: string;
  description: string;
  matcherJson: Record<string, unknown>;
  status: "pending" | "hit" | "missed";
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceExpectedSignalRecord = {
  id: string;
  signalKey: string;
  description: string;
  dueAt: string | null;
  status: "pending" | "observed" | "absent";
};

export type IntelligenceExpectedSignalEntryRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  signalKey: string;
  description: string;
  dueAt: string | null;
  status: "pending" | "observed" | "absent";
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceDeliberationResult = {
  id: string;
  source: "bridge_council" | "local";
  status: "pending" | "completed" | "failed";
  proposedPrimary: string;
  proposedCounter: string;
  weakestLink: string;
  requiredNextSignals: string[];
  executionStance: "proceed" | "hold" | "reject";
  rawJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type HypothesisLedgerEntry = {
  id: string;
  workspaceId: string;
  eventId: string;
  hypothesisId: string;
  kind: "primary" | "counter";
  title: string;
  summary: string;
  confidence: number;
  rationale: string;
  status: "active" | "superseded";
  reviewState: EventReviewState;
  reviewReason: string | null;
  reviewOwner: string | null;
  reviewUpdatedAt: string | null;
  reviewUpdatedBy: string | null;
  reviewResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HypothesisEvidenceLink = {
  id: string;
  workspaceId: string;
  eventId: string;
  hypothesisId: string;
  linkedClaimId: string | null;
  signalId: string | null;
  relation: "supports" | "contradicts" | "monitors";
  evidenceStrength: number | null;
  createdAt: string;
};

export type IntelligenceHypothesisEvidenceSummary = {
  hypothesis_id: string;
  support_count: number;
  contradict_count: number;
  monitor_count: number;
  support_strength: number;
  contradict_strength: number;
  monitor_strength: number;
  linked_claim_ids: string[];
  support_edge_count: number;
  contradict_edge_count: number;
  edge_linked_claim_ids: string[];
  graph_support_strength: number;
  graph_contradict_strength: number;
};

export type IntelligenceExecutionCandidateRecord = {
  id: string;
  title: string;
  summary: string;
  riskBand: RadarRiskBand;
  executionMode: "proposal" | "execute_auto" | "approval_required";
  payload: Record<string, unknown>;
  policyJson: Record<string, unknown>;
  status: IntelligenceExecutionStatus;
  resultJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
};

export type IntelligenceOutcomeRecord = {
  id: string;
  status: "confirmed" | "invalidated" | "mixed" | "unresolved";
  summary: string;
  createdAt: string;
};

export type IntelligenceOutcomeEntryRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  status: "confirmed" | "invalidated" | "mixed" | "unresolved";
  summary: string;
  createdAt: string;
};

export type EventReviewState = "watch" | "review" | "ignore";

export type ExecutionAuditRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  candidateId: string;
  connectorId: string | null;
  actionName: string | null;
  status: IntelligenceExecutionStatus;
  summary: string;
  resultJson: Record<string, unknown>;
  createdAt: string;
};

export type OperatorNoteRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  userId: string;
  scope: "event" | "hypothesis" | "linked_claim" | "narrative_cluster";
  scopeId: string | null;
  note: string;
  createdAt: string;
};

export type SemanticBacklogStatus = {
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  latestFailedSignalIds: string[];
};

export type IntelligenceSourceRetryResult = {
  sourceId: string;
  workspaceId: string;
  queuedAt: string;
  sourceEnabled: boolean;
};

export type IntelligenceSignalRetryResult = {
  signalId: string;
  workspaceId: string;
  queuedAt: string;
  processingStatus: IntelligenceSignalProcessingStatus;
};

export type IntelligenceEventClusterRecord = {
  id: string;
  workspaceId: string;
  title: string;
  summary: string;
  eventFamily: IntelligenceEventFamily;
  signalIds: string[];
  documentIds: string[];
  entities: string[];
  linkedClaimCount: number;
  contradictionCount: number;
  nonSocialCorroborationCount: number;
  linkedClaimHealthScore: number;
  timeCoherenceScore: number;
  graphSupportScore: number;
  graphContradictionScore: number;
  graphHotspotCount: number;
  semanticClaims: IntelligenceSemanticClaim[];
  metricShocks: IntelligenceMetricShock[];
  sourceMix: Record<string, unknown>;
  corroborationScore: number;
  noveltyScore: number;
  structuralityScore: number;
  actionabilityScore: number;
  riskBand: RadarRiskBand;
  topDomainId: IntelligenceDomainId | null;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  domainPosteriors: IntelligenceDomainPosterior[];
  worldStates: IntelligenceWorldState[];
  primaryHypotheses: IntelligenceHypothesisRecord[];
  counterHypotheses: IntelligenceCounterHypothesisRecord[];
  invalidationConditions: IntelligenceInvalidationConditionRecord[];
  expectedSignals: IntelligenceExpectedSignalRecord[];
  deliberationStatus: "idle" | "completed" | "failed";
  reviewState: EventReviewState;
  reviewReason: string | null;
  reviewOwner: string | null;
  reviewUpdatedAt: string | null;
  reviewUpdatedBy: string | null;
  reviewResolvedAt: string | null;
  deliberations: IntelligenceDeliberationResult[];
  executionCandidates: IntelligenceExecutionCandidateRecord[];
  outcomes: IntelligenceOutcomeRecord[];
  operatorNoteCount: number;
  operatorPriorityScore?: number;
  recurringNarrativeScore?: number;
  relatedHistoricalEventCount?: number;
  temporalNarrativeState?: IntelligenceTemporalNarrativeState;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceTemporalNarrativeState = "new" | "recurring" | "diverging";

export type IntelligenceRelatedHistoricalEventSummary = {
  eventId: string;
  title: string;
  relation: "recurring" | "diverging" | "supportive_history";
  score: number;
  daysDelta: number | null;
  topDomainId: IntelligenceDomainId | null;
  graphSupportScore: number;
  graphContradictionScore: number;
  graphHotspotCount: number;
  timeCoherenceScore: number;
};

export type IntelligenceTemporalNarrativeLedgerEntryRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  relatedEventId: string;
  relatedEventTitle: string;
  relation: "recurring" | "diverging" | "supportive_history";
  score: number;
  daysDelta: number | null;
  topDomainId: IntelligenceDomainId | null;
  graphSupportScore: number;
  graphContradictionScore: number;
  graphHotspotCount: number;
  timeCoherenceScore: number;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceNarrativeClusterState = "forming" | "recurring" | "diverging";

export type IntelligenceNarrativeClusterRecord = {
  id: string;
  workspaceId: string;
  clusterKey: string;
  title: string;
  eventFamily: IntelligenceEventFamily;
  topDomainId: IntelligenceDomainId | null;
  anchorEntities: string[];
  state: IntelligenceNarrativeClusterState;
  eventCount: number;
  recurringEventCount: number;
  divergingEventCount: number;
  supportiveHistoryCount: number;
  hotspotEventCount: number;
  latestRecurringScore: number;
  driftScore: number;
  supportScore: number;
  contradictionScore: number;
  timeCoherenceScore: number;
  reviewState: EventReviewState;
  reviewReason: string | null;
  reviewOwner: string | null;
  reviewUpdatedAt: string | null;
  reviewUpdatedBy: string | null;
  reviewResolvedAt: string | null;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceNarrativeClusterMemberSummary = {
  membershipId: string;
  eventId: string;
  title: string;
  relation: "origin" | "recurring" | "diverging" | "supportive_history";
  score: number;
  daysDelta: number | null;
  isLatest: boolean;
  temporalNarrativeState?: IntelligenceTemporalNarrativeState;
  graphSupportScore: number;
  graphContradictionScore: number;
  graphHotspotCount: number;
  timeCoherenceScore: number;
  lastEventAt: string | null;
};

export type IntelligenceEventGraphSummary = {
  eventId: string;
  linkedClaimCount: number;
  edgeCount: number;
  graphSupportScore: number;
  graphContradictionScore: number;
  graphHotspotCount: number;
  recurringNarrativeScore?: number;
  relatedHistoricalEventCount?: number;
  temporalNarrativeState?: IntelligenceTemporalNarrativeState;
  hotspotClusterCount?: number;
};

export type IntelligenceEventGraphNeighborhood = {
  centerLinkedClaimId: string;
  directNeighborIds: string[];
  twoHopNeighborIds: string[];
};

export type IntelligenceHotspotCluster = {
  id: string;
  centerLinkedClaimId: string;
  label: string;
  memberLinkedClaimIds: string[];
  supportEdgeCount: number;
  contradictionEdgeCount: number;
  hotspotScore: number;
};

export type IntelligenceBridgeDispatchRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  kind: "council" | "brief" | "action";
  status: "pending" | "dispatched" | "failed";
  targetId: string | null;
  requestJson: Record<string, unknown>;
  responseJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceModelRegistryEntry = {
  id: string;
  provider: ProviderName;
  modelId: string;
  availability: "active" | "inactive";
  contextWindow: number | null;
  supportsStructuredOutput: boolean;
  supportsToolUse: boolean;
  supportsLongContext: boolean;
  supportsReasoning: boolean;
  costClass: "free" | "low" | "standard" | "premium";
  latencyClass: "fast" | "balanced" | "slow";
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceCapabilityAliasBinding = {
  id: string;
  workspaceId: string | null;
  alias: IntelligenceCapabilityAlias;
  provider: ProviderName;
  modelId: string;
  weight: number;
  fallbackRank: number;
  canaryPercent: number;
  isActive: boolean;
  requiresStructuredOutput: boolean;
  requiresToolUse: boolean;
  requiresLongContext: boolean;
  maxCostClass: "free" | "low" | "standard" | "premium" | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceWorkerRun = {
  startedAt: string;
  finishedAt: string;
  status: "ok" | "error" | "timeout";
  durationMs: number;
  error?: string;
};

export type IntelligenceScannerWorkerRun = IntelligenceWorkerRun & {
  workspaceId: string;
  scannedSources: number;
  fetchedCount: number;
  storedDocumentCount: number;
  signalCount: number;
  clusteredEventCount: number;
  executionCount: number;
  failedCount: number;
  failedSources: string[];
};

export type IntelligenceSemanticWorkerRun = IntelligenceWorkerRun & {
  workspaceId: string;
  processedSignalCount: number;
  clusteredEventCount: number;
  deliberationCount: number;
  executionCount: number;
  failedCount: number;
  failedSignalIds: string[];
};

export type IntelligenceCatalogSyncRun = IntelligenceWorkerRun & {
  syncedEntries: number;
};

export type IntelligenceWorkerStatus<T> = {
  enabled: boolean;
  inflight: boolean;
  lastRun: T | null;
  history: T[];
};
