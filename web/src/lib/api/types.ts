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
export type ProviderAttempt = ApiSchemas["ProviderAttempt"];
export type ProviderModelCatalogEntry = {
  provider: ProviderName;
  configured_model: string;
  recommended_model?: string;
  source: "remote" | "configured";
  models: string[];
  error?: string;
};
export type ProviderCredentialSource = "stored" | "env" | "none";
export type ProviderCredentialRecord = {
  provider: ProviderName;
  has_key: boolean;
  source: ProviderCredentialSource;
  updated_at: string | null;
};
export type ProviderCredentialMutationResult = {
  provider: ProviderName;
  has_key: boolean;
  source: ProviderCredentialSource;
  updated_at?: string | null;
  deleted?: boolean;
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

export type RadarItemStatus = ApiSchemas["RadarItem"]["status"];
export type RadarDecision = ApiSchemas["RadarRecommendation"]["decision"];
export type RadarItemRecord = ApiSchemas["RadarItem"];
export type RadarRecommendationRecord = ApiSchemas["RadarRecommendation"];

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
  idempotent_replay?: boolean;
};

export type CouncilRunRequest = OptionalByDefault<
  ApiSchemas["CouncilRunCreateRequest"],
  "provider" | "strict_provider" | "create_task"
> & {
  idempotency_key?: string;
  trace_id?: string;
};

export type ExecutionRunMode = ApiSchemas["ExecutionRun"]["mode"];

export type ExecutionRunRecord = ApiSchemas["ExecutionRun"] & {
  idempotent_replay?: boolean;
};

export type ExecutionRunRequest = OptionalByDefault<
  ApiSchemas["ExecutionRunCreateRequest"],
  "provider" | "strict_provider" | "create_task"
> & {
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
    attempts: number;
    successes: number;
    failures: number;
    avg_latency_ms: number;
    success_rate_pct: number;
    last_attempt_at: string | null;
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
};

export type DashboardOverviewData = {
  generated_at: string;
  signals: {
    task_count: number;
    running_count: number;
    failed_count: number;
    blocked_count: number;
    pending_approval_count: number;
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

export type V2ExecutionContract = {
  id: string;
  goal: string;
  success_criteria: string[];
  constraints: Record<string, unknown>;
  risk: {
    level: "low" | "medium" | "high";
    reasons: string[];
    requires_approval: boolean;
  };
  deliverables: Array<Record<string, unknown>>;
  domain_mix: Record<string, number>;
};

export type V2CommandCompileResponse = {
  execution_contract: V2ExecutionContract;
  routing: {
    intent: "code" | "research" | "finance" | "news" | "general";
    complexity: "simple" | "moderate" | "complex";
    confidence: number;
    uncertainty: number;
  };
  clarification: {
    required: boolean;
    questions: string[];
  };
};

export type TaskViewSchema = {
  version: "1.0";
  task_id: string;
  layout: "single" | "split" | "board";
  widgets: Array<{
    id: string;
    type: string;
    title: string;
    props: Record<string, unknown>;
    visible_when?: string;
  }>;
  actions: Array<{
    id: "pause" | "resume" | "retry" | "replan" | "approve" | "rollback";
    enabled: boolean;
    reason?: string;
  }>;
};

export type V2TaskViewSchemaResponse = {
  task_view_schema: TaskViewSchema;
  policy: {
    decision: "allow" | "deny" | "approval_required";
    matched_rule_ids: string[];
  };
};
