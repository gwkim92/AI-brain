import type { UpgradeExecutorGateway } from '../upgrades/executor';

export type TaskMode =
  | 'chat'
  | 'execute'
  | 'council'
  | 'code'
  | 'compute'
  | 'long_run'
  | 'high_risk'
  | 'radar_review'
  | 'upgrade_execution';

export type TaskStatus = 'queued' | 'running' | 'blocked' | 'retrying' | 'done' | 'failed' | 'cancelled';

export type UserRole = 'member' | 'operator' | 'admin';
export type ProviderCredentialProvider = 'openai' | 'gemini' | 'anthropic' | 'local';

export type MissionDomain = 'code' | 'research' | 'finance' | 'news' | 'mixed';
export type MissionStatus = 'draft' | 'planned' | 'running' | 'blocked' | 'completed' | 'failed';
export type MissionStepPattern = 'llm_generate' | 'council_debate' | 'human_gate' | 'tool_call' | 'sub_mission';
export type LegacyMissionStepType = 'code' | 'research' | 'finance' | 'news' | 'approval' | 'execute';
export type MissionStepType = MissionStepPattern | LegacyMissionStepType;
export type MissionStepStatus = 'pending' | 'running' | 'done' | 'blocked' | 'failed';
export type MissionApprovalPolicyMode = 'auto' | 'required_for_high_risk' | 'required_for_all';

export type LlmProviderName = 'openai' | 'gemini' | 'anthropic' | 'local';
export type AssistantContextStatus = 'running' | 'completed' | 'failed';

export type MissionContractConstraints = {
  maxCostUsd?: number;
  deadlineAt?: string;
  allowedTools?: string[];
  maxRetriesPerStep?: number;
};

export type MissionContractApprovalPolicy = {
  mode: MissionApprovalPolicyMode;
  approverRoles?: Array<Exclude<UserRole, 'member'>>;
};

export type MissionContractRecord = {
  constraints: MissionContractConstraints;
  approvalPolicy: MissionContractApprovalPolicy;
};

export type MissionContractUpdateInput = {
  constraints?: Partial<MissionContractConstraints>;
  approvalPolicy?: Partial<MissionContractApprovalPolicy>;
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

export type MissionRecord = {
  id: string;
  userId: string;
  workspaceId: string | null;
  title: string;
  objective: string;
  domain: MissionDomain;
  status: MissionStatus;
  missionContract: MissionContractRecord;
  steps: MissionStepRecord[];
  createdAt: string;
  updatedAt: string;
};

export type CreateMissionInput = {
  userId: string;
  workspaceId?: string | null;
  title: string;
  objective: string;
  domain: MissionDomain;
  status?: MissionStatus;
  missionContract?: MissionContractRecord;
  steps: MissionStepRecord[];
};

export type UpdateMissionInput = {
  missionId: string;
  userId: string;
  status?: MissionStatus;
  title?: string;
  objective?: string;
  missionContract?: MissionContractUpdateInput;
  stepStatuses?: Array<{
    stepId: string;
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
  servedProvider: LlmProviderName | null;
  servedModel: string | null;
  usedFallback: boolean;
  selectionReason: string | null;
  output: string;
  error: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
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

export type UpsertAssistantContextInput = {
  userId: string;
  clientContextId: string;
  source: string;
  intent: string;
  prompt: string;
  widgetPlan: string[];
  status?: AssistantContextStatus;
  taskId?: string | null;
};

export type UpdateAssistantContextInput = {
  userId: string;
  contextId: string;
  status?: AssistantContextStatus;
  taskId?: string | null;
  servedProvider?: LlmProviderName | null;
  servedModel?: string | null;
  usedFallback?: boolean;
  selectionReason?: string | null;
  output?: string;
  error?: string | null;
};

export type AppendAssistantContextEventInput = {
  userId: string;
  contextId: string;
  eventType: string;
  data: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
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

export type ReplaceAssistantContextGroundingSourcesInput = {
  userId: string;
  contextId: string;
  sources: Array<{
    url: string;
    title: string;
    domain: string;
  }>;
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

export type ReplaceAssistantContextGroundingClaimsInput = {
  userId: string;
  contextId: string;
  claims: Array<{
    claimText: string;
    sourceUrls: string[];
  }>;
};

export type JarvisSessionIntent = 'general' | 'code' | 'research' | 'finance' | 'news' | 'council';
export type JarvisSessionStatus = 'queued' | 'running' | 'blocked' | 'needs_approval' | 'completed' | 'failed' | 'stale';
export type JarvisWorkspacePreset = 'jarvis' | 'research' | 'execution' | 'control';
export type JarvisSessionPrimaryTarget = 'assistant' | 'mission' | 'council' | 'execution' | 'briefing' | 'dossier';

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

export type CreateJarvisSessionInput = {
  id?: string;
  userId: string;
  title: string;
  prompt: string;
  source: string;
  intent: JarvisSessionIntent;
  status?: JarvisSessionStatus;
  workspacePreset?: JarvisWorkspacePreset | null;
  primaryTarget: JarvisSessionPrimaryTarget;
  taskId?: string | null;
  missionId?: string | null;
  assistantContextId?: string | null;
  councilRunId?: string | null;
  executionRunId?: string | null;
  briefingId?: string | null;
  dossierId?: string | null;
};

export type UpdateJarvisSessionInput = {
  sessionId: string;
  userId: string;
  title?: string;
  prompt?: string;
  status?: JarvisSessionStatus;
  workspacePreset?: JarvisWorkspacePreset | null;
  primaryTarget?: JarvisSessionPrimaryTarget;
  taskId?: string | null;
  missionId?: string | null;
  assistantContextId?: string | null;
  councilRunId?: string | null;
  executionRunId?: string | null;
  briefingId?: string | null;
  dossierId?: string | null;
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

export type AppendJarvisSessionEventInput = {
  userId: string;
  sessionId: string;
  eventType: string;
  status?: JarvisSessionStatus | null;
  summary?: string | null;
  data?: Record<string, unknown>;
};

export type ActionProposalKind = 'mission_execute' | 'council_run' | 'execution_run' | 'workspace_prepare' | 'notify' | 'custom';
export type ActionProposalStatus = 'pending' | 'approved' | 'rejected';

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

export type CreateActionProposalInput = {
  userId: string;
  sessionId: string;
  kind: ActionProposalKind;
  title: string;
  summary: string;
  payload?: Record<string, unknown>;
};

export type DecideActionProposalInput = {
  proposalId: string;
  userId: string;
  decidedBy: string;
  decision: Exclude<ActionProposalStatus, 'pending'>;
};

export type WatcherKind =
  | 'external_topic'
  | 'company'
  | 'market'
  | 'war_region'
  | 'repo'
  | 'task_health'
  | 'mission_health'
  | 'approval_backlog';

export type WatcherStatus = 'active' | 'paused' | 'error';
export type WatcherRunStatus = 'running' | 'completed' | 'failed';

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

export type CreateWatcherInput = {
  userId: string;
  kind: WatcherKind;
  title: string;
  query: string;
  status?: WatcherStatus;
  configJson?: Record<string, unknown>;
};

export type UpdateWatcherInput = {
  watcherId: string;
  userId: string;
  kind?: WatcherKind;
  status?: WatcherStatus;
  title?: string;
  query?: string;
  configJson?: Record<string, unknown>;
  lastRunAt?: string | null;
  lastHitAt?: string | null;
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

export type CreateWatcherRunInput = {
  watcherId: string;
  userId: string;
  status?: WatcherRunStatus;
  summary?: string;
  briefingId?: string | null;
  dossierId?: string | null;
  error?: string | null;
};

export type UpdateWatcherRunInput = {
  runId: string;
  userId: string;
  status?: WatcherRunStatus;
  summary?: string;
  briefingId?: string | null;
  dossierId?: string | null;
  error?: string | null;
};

export type BriefingType = 'daily' | 'on_change' | 'on_demand';
export type BriefingStatus = 'draft' | 'completed' | 'failed';

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

export type CreateBriefingInput = {
  userId: string;
  watcherId?: string | null;
  sessionId?: string | null;
  type: BriefingType;
  status?: BriefingStatus;
  title: string;
  query: string;
  summary: string;
  answerMarkdown: string;
  sourceCount?: number;
  qualityJson?: Record<string, unknown>;
};

export type DossierStatus = 'draft' | 'ready' | 'failed';

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

export type CreateDossierInput = {
  userId: string;
  sessionId?: string | null;
  briefingId?: string | null;
  title: string;
  query: string;
  status?: DossierStatus;
  summary?: string;
  answerMarkdown?: string;
  qualityJson?: Record<string, unknown>;
  conflictsJson?: Record<string, unknown>;
};

export type UpdateDossierInput = {
  dossierId: string;
  userId: string;
  title?: string;
  query?: string;
  status?: DossierStatus;
  summary?: string;
  answerMarkdown?: string;
  qualityJson?: Record<string, unknown>;
  conflictsJson?: Record<string, unknown>;
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

export type ReplaceDossierSourcesInput = {
  userId: string;
  dossierId: string;
  sources: Array<{
    url: string;
    title: string;
    domain: string;
    snippet?: string;
    publishedAt?: string | null;
  }>;
};

export type DossierClaimRecord = {
  id: string;
  dossierId: string;
  claimText: string;
  claimOrder: number;
  sourceUrls: string[];
  createdAt: string;
};

export type ReplaceDossierClaimsInput = {
  userId: string;
  dossierId: string;
  claims: Array<{
    claimText: string;
    sourceUrls: string[];
  }>;
};

export type ProviderCredentialRecord = {
  provider: ProviderCredentialProvider;
  encryptedApiKey: string;
  updatedBy: string | null;
  updatedAt: string;
};

export type ProviderCredentialPriority = 'api_key_first' | 'auth_first';
export type ProviderCredentialMode = 'auto' | 'api_key' | 'oauth_official';
export type ResolvedProviderCredentialMode = Exclude<ProviderCredentialMode, 'auto'>;

export type UserProviderCredentialRecord = {
  userId: string;
  provider: ProviderCredentialProvider;
  encryptedPayload: string;
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

export type ProviderOauthStateRecord = {
  state: string;
  userId: string;
  provider: ProviderCredentialProvider;
  encryptedContext: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type ModelControlFeatureKey =
  | 'global_default'
  | 'assistant_chat'
  | 'assistant_context_run'
  | 'council_run'
  | 'execution_code'
  | 'execution_compute'
  | 'mission_plan_generation'
  | 'mission_execute_step';

export type UserModelSelectionPreferenceRecord = {
  userId: string;
  featureKey: ModelControlFeatureKey;
  provider: LlmProviderName | 'auto';
  modelId: string | null;
  strictProvider: boolean;
  selectionMode: 'auto' | 'manual';
  updatedAt: string;
  updatedBy: string | null;
};

export type CreateOrUpdateUserModelSelectionPreferenceInput = {
  userId: string;
  featureKey: ModelControlFeatureKey;
  provider: LlmProviderName | 'auto';
  modelId?: string | null;
  strictProvider?: boolean;
  selectionMode?: 'auto' | 'manual';
  updatedBy?: string | null;
};

export type ModelRecommendationRunRecord = {
  id: string;
  userId: string;
  featureKey: ModelControlFeatureKey;
  promptHash: string;
  promptExcerptRedacted: string;
  recommendedProvider: LlmProviderName;
  recommendedModelId: string;
  rationaleText: string;
  evidenceJson: Record<string, unknown>;
  recommenderProvider: 'openai';
  appliedAt: string | null;
  createdAt: string;
};

export type CreateModelRecommendationRunInput = {
  userId: string;
  featureKey: ModelControlFeatureKey;
  promptHash: string;
  promptExcerptRedacted: string;
  recommendedProvider: LlmProviderName;
  recommendedModelId: string;
  rationaleText: string;
  evidenceJson: Record<string, unknown>;
  recommenderProvider?: 'openai';
};

export type AiInvocationTraceRecord = {
  id: string;
  userId: string;
  featureKey: ModelControlFeatureKey | 'diagnostic';
  taskType: string;
  requestProvider: LlmProviderName | 'auto';
  requestModel: string | null;
  resolvedProvider: LlmProviderName | null;
  resolvedModel: string | null;
  credentialMode: ResolvedProviderCredentialMode | null;
  credentialSource: 'user' | 'workspace' | 'env' | 'none';
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

export type CreateAiInvocationTraceInput = {
  userId: string;
  featureKey: ModelControlFeatureKey | 'diagnostic';
  taskType: string;
  requestProvider: LlmProviderName | 'auto';
  requestModel?: string | null;
  traceId?: string | null;
  contextRefsJson?: Record<string, unknown>;
};

export type CompleteAiInvocationTraceInput = {
  id: string;
  resolvedProvider?: LlmProviderName | null;
  resolvedModel?: string | null;
  credentialMode?: ResolvedProviderCredentialMode | null;
  credentialSource?: 'user' | 'workspace' | 'env' | 'none';
  attemptsJson?: Array<Record<string, unknown>>;
  usedFallback?: boolean;
  success: boolean;
  errorCode?: string | null;
  errorMessageRedacted?: string | null;
  latencyMs: number;
};

export type AiInvocationTraceListFilters = {
  userId: string;
  limit: number;
  featureKey?: ModelControlFeatureKey | 'diagnostic';
  success?: boolean;
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
  providerDistribution: Array<{
    provider: LlmProviderName;
    count: number;
  }>;
  credentialSourceDistribution: Array<{
    source: 'user' | 'workspace' | 'env' | 'none';
    count: number;
  }>;
};

export type AuthUserRecord = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};

export type AuthUserWithPasswordRecord = AuthUserRecord & {
  passwordHash: string | null;
};

export type AuthSessionRecord = {
  user: AuthUserRecord;
  tokenHash: string;
  expiresAt: string;
};

export type RadarItemStatus = 'new' | 'scored' | 'archived';

export type UpgradeStatus =
  | 'proposed'
  | 'approved'
  | 'planning'
  | 'running'
  | 'verifying'
  | 'deployed'
  | 'failed'
  | 'rolled_back'
  | 'rejected';

export type TaskRecord = {
  id: string;
  userId: string;
  mode: TaskMode;
  status: TaskStatus;
  title: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
  traceId?: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskEventRecord = {
  id: string;
  taskId: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
};

export type AppendTaskEventInput = {
  taskId: string;
  type: string;
  data: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
};

export type RadarItemRecord = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  sourceName: string;
  publishedAt: string | null;
  confidenceScore: number;
  status: RadarItemStatus;
};

export type RadarRecommendationRecord = {
  id: string;
  itemId: string;
  decision: 'adopt' | 'hold' | 'discard';
  totalScore: number;
  expectedBenefit: string;
  migrationCost: string;
  riskLevel: string;
  evaluatedAt: string;
};

export type UpgradeProposalRecord = {
  id: string;
  recommendationId: string;
  proposalTitle: string;
  status: UpgradeStatus;
  createdAt: string;
  approvedAt: string | null;
};

export type UpgradeRunApiRecord = {
  id: string;
  proposalId: string;
  status: UpgradeStatus;
  startCommand: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderAttemptRecord = {
  provider: LlmProviderName;
  status: 'success' | 'failed' | 'skipped';
  latencyMs?: number;
  error?: string;
  credential?: {
    source: 'user' | 'workspace' | 'env' | 'none';
    selectedCredentialMode: 'api_key' | 'oauth_official' | null;
    credentialPriority: 'api_key_first' | 'auth_first';
    authAccessTokenExpiresAt: string | null;
  };
};

export type CouncilRole = 'planner' | 'researcher' | 'critic' | 'risk' | 'synthesizer';
export type CouncilConsensusStatus = 'consensus_reached' | 'contradiction_detected' | 'escalated_to_human';
export type CouncilRunStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ExecutionRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type CouncilParticipantRecord = {
  role: CouncilRole;
  provider: LlmProviderName | null;
  status: 'success' | 'failed' | 'skipped';
  latency_ms?: number;
  summary: string;
  error?: string;
};

export type CouncilRunRecord = {
  id: string;
  question: string;
  status: CouncilRunStatus;
  consensus_status: CouncilConsensusStatus | null;
  summary: string;
  participants: CouncilParticipantRecord[];
  attempts: ProviderAttemptRecord[];
  provider: LlmProviderName | null;
  model: string;
  used_fallback: boolean;
  task_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ExecutionRunRecord = {
  id: string;
  mode: 'code' | 'compute';
  prompt: string;
  status: ExecutionRunStatus;
  output: string;
  attempts: ProviderAttemptRecord[];
  provider: LlmProviderName | null;
  model: string;
  used_fallback: boolean;
  task_id: string | null;
  duration_ms: number;
  created_at: string;
  updated_at: string;
};

export type CreateCouncilRunInput = Omit<CouncilRunRecord, 'id' | 'created_at' | 'updated_at'> & {
  user_id: string;
  idempotency_key: string;
  trace_id?: string;
};

export type UpdateCouncilRunInput = {
  runId: string;
  status?: CouncilRunStatus;
  consensus_status?: CouncilConsensusStatus | null;
  summary?: string;
  participants?: CouncilParticipantRecord[];
  attempts?: ProviderAttemptRecord[];
  provider?: LlmProviderName | null;
  model?: string;
  used_fallback?: boolean;
  task_id?: string | null;
};

export type CreateExecutionRunInput = Omit<ExecutionRunRecord, 'id' | 'created_at' | 'updated_at'> & {
  user_id: string;
  idempotency_key: string;
  trace_id?: string;
};

export type UpdateExecutionRunInput = {
  runId: string;
  status?: ExecutionRunStatus;
  output?: string;
  attempts?: ProviderAttemptRecord[];
  provider?: LlmProviderName | null;
  model?: string;
  used_fallback?: boolean;
  task_id?: string | null;
  duration_ms?: number;
};

export type TelegramReportRecord = {
  id: string;
  chatId: string;
  topic: string;
  bodyMarkdown: string;
  status: 'queued' | 'sent' | 'failed';
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  telegramMessageId?: string | null;
  sentAt?: string | null;
  createdAt: string;
};

export type TelegramReportStatus = TelegramReportRecord['status'];

export type CreateTaskInput = {
  userId: string;
  mode: TaskMode;
  title: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
  traceId?: string;
};

export type MemorySegmentRecord = {
  id: string;
  userId: string;
  taskId: string | null;
  segmentType: string;
  content: string;
  confidence: number;
  createdAt: string;
  expiresAt: string | null;
  similarity?: number;
};

export type CreateMemorySegmentInput = {
  userId: string;
  taskId?: string | null;
  segmentType: string;
  content: string;
  embedding?: number[] | null;
  confidence?: number;
  expiresAt?: string | null;
};

export type SearchMemoryByEmbeddingInput = {
  userId: string;
  embedding: number[];
  limit: number;
  minConfidence?: number;
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type ApprovalRecord = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: ApprovalStatus;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type CreateApprovalInput = {
  entityType: string;
  entityId: string;
  action: string;
  requestedBy?: string | null;
  expiresAt?: string | null;
};

export type EvaluateRadarInput = {
  itemIds: string[];
};

export type JarvisStore = {
  kind: 'memory' | 'postgres';
  initialize: () => Promise<void>;
  health: () => Promise<{ store: 'memory' | 'postgres'; db: 'up' | 'down' | 'n/a' }>;
  getPool: () => import('pg').Pool | null;

  createAuthUser: (input: {
    email: string;
    displayName?: string;
    passwordHash: string;
    role?: UserRole;
  }) => Promise<AuthUserRecord | null>;
  upsertAuthUserByEmail: (input: {
    email: string;
    displayName?: string;
    passwordHash: string;
    role: UserRole;
  }) => Promise<AuthUserRecord>;
  findAuthUserByEmail: (email: string) => Promise<AuthUserWithPasswordRecord | null>;
  getAuthUserById: (userId: string) => Promise<AuthUserRecord | null>;
  createAuthSession: (input: { userId: string; tokenHash: string; expiresAt: string }) => Promise<void>;
  getAuthSessionByTokenHash: (tokenHash: string) => Promise<AuthSessionRecord | null>;
  revokeAuthSession: (tokenHash: string) => Promise<boolean>;

  listProviderCredentials: () => Promise<ProviderCredentialRecord[]>;
  upsertProviderCredential: (input: {
    provider: ProviderCredentialProvider;
    encryptedApiKey: string;
    updatedBy?: string | null;
  }) => Promise<ProviderCredentialRecord>;
  deleteProviderCredential: (provider: ProviderCredentialProvider) => Promise<boolean>;
  listUserProviderCredentials: (input: {
    userId: string;
    includeInactive?: boolean;
  }) => Promise<UserProviderCredentialRecord[]>;
  getUserProviderCredential: (input: {
    userId: string;
    provider: ProviderCredentialProvider;
    includeInactive?: boolean;
  }) => Promise<UserProviderCredentialRecord | null>;
  upsertUserProviderCredential: (input: {
    userId: string;
    provider: ProviderCredentialProvider;
    encryptedPayload: string;
    isActive?: boolean;
    updatedBy?: string | null;
  }) => Promise<UserProviderCredentialRecord>;
  deleteUserProviderCredential: (input: {
    userId: string;
    provider: ProviderCredentialProvider;
  }) => Promise<boolean>;
  listActiveUserProviderCredentials: (input: {
    provider?: ProviderCredentialProvider;
    limit: number;
  }) => Promise<UserProviderCredentialRecord[]>;
  createProviderOauthState: (input: {
    state: string;
    userId: string;
    provider: ProviderCredentialProvider;
    encryptedContext: string;
    expiresAt: string;
  }) => Promise<ProviderOauthStateRecord>;
  consumeProviderOauthState: (input: {
    state: string;
    provider: ProviderCredentialProvider;
  }) => Promise<ProviderOauthStateRecord | null>;
  cleanupExpiredProviderOauthStates: (input?: { nowIso?: string; limit?: number }) => Promise<number>;
  listUserModelSelectionPreferences: (input: {
    userId: string;
  }) => Promise<UserModelSelectionPreferenceRecord[]>;
  getUserModelSelectionPreference: (input: {
    userId: string;
    featureKey: ModelControlFeatureKey;
  }) => Promise<UserModelSelectionPreferenceRecord | null>;
  upsertUserModelSelectionPreference: (input: CreateOrUpdateUserModelSelectionPreferenceInput) => Promise<UserModelSelectionPreferenceRecord>;
  deleteUserModelSelectionPreference: (input: {
    userId: string;
    featureKey: ModelControlFeatureKey;
  }) => Promise<boolean>;
  createModelRecommendationRun: (input: CreateModelRecommendationRunInput) => Promise<ModelRecommendationRunRecord>;
  listModelRecommendationRuns: (input: {
    userId: string;
    limit: number;
    featureKey?: ModelControlFeatureKey;
  }) => Promise<ModelRecommendationRunRecord[]>;
  markModelRecommendationApplied: (input: {
    recommendationId: string;
    userId: string;
  }) => Promise<ModelRecommendationRunRecord | null>;
  cleanupExpiredModelRecommendationRuns: (input?: {
    nowIso?: string;
    retentionDays?: number;
    limit?: number;
  }) => Promise<number>;
  createAiInvocationTrace: (input: CreateAiInvocationTraceInput) => Promise<AiInvocationTraceRecord>;
  completeAiInvocationTrace: (input: CompleteAiInvocationTraceInput) => Promise<AiInvocationTraceRecord | null>;
  listAiInvocationTraces: (input: AiInvocationTraceListFilters) => Promise<AiInvocationTraceRecord[]>;
  getAiInvocationMetrics: (input: {
    userId: string;
    sinceIso?: string;
  }) => Promise<AiInvocationMetrics>;
  cleanupExpiredAiInvocationTraces: (input?: {
    nowIso?: string;
    retentionDays?: number;
    limit?: number;
  }) => Promise<number>;

  createJarvisSession: (input: CreateJarvisSessionInput) => Promise<JarvisSessionRecord>;
  listJarvisSessions: (input: {
    userId: string;
    status?: JarvisSessionStatus;
    limit: number;
  }) => Promise<JarvisSessionRecord[]>;
  getJarvisSessionById: (input: { userId: string; sessionId: string }) => Promise<JarvisSessionRecord | null>;
  updateJarvisSession: (input: UpdateJarvisSessionInput) => Promise<JarvisSessionRecord | null>;
  appendJarvisSessionEvent: (input: AppendJarvisSessionEventInput) => Promise<JarvisSessionEventRecord | null>;
  listJarvisSessionEvents: (input: {
    userId: string;
    sessionId: string;
    sinceSequence?: number;
    limit: number;
  }) => Promise<JarvisSessionEventRecord[]>;
  createActionProposal: (input: CreateActionProposalInput) => Promise<ActionProposalRecord>;
  listActionProposals: (input: {
    userId: string;
    sessionId?: string;
    status?: ActionProposalStatus;
    limit: number;
  }) => Promise<ActionProposalRecord[]>;
  decideActionProposal: (input: DecideActionProposalInput) => Promise<ActionProposalRecord | null>;

  createWatcher: (input: CreateWatcherInput) => Promise<WatcherRecord>;
  listWatchers: (input: {
    userId: string;
    status?: WatcherStatus;
    kind?: WatcherKind;
    limit: number;
  }) => Promise<WatcherRecord[]>;
  listActiveWatchers: (input: {
    limit: number;
  }) => Promise<WatcherRecord[]>;
  getWatcherById: (input: { userId: string; watcherId: string }) => Promise<WatcherRecord | null>;
  updateWatcher: (input: UpdateWatcherInput) => Promise<WatcherRecord | null>;
  deleteWatcher: (input: { userId: string; watcherId: string }) => Promise<boolean>;
  createWatcherRun: (input: CreateWatcherRunInput) => Promise<WatcherRunRecord>;
  listWatcherRuns: (input: { userId: string; watcherId: string; limit: number }) => Promise<WatcherRunRecord[]>;
  updateWatcherRun: (input: UpdateWatcherRunInput) => Promise<WatcherRunRecord | null>;

  createBriefing: (input: CreateBriefingInput) => Promise<BriefingRecord>;
  listBriefings: (input: {
    userId: string;
    type?: BriefingType;
    status?: BriefingStatus;
    limit: number;
  }) => Promise<BriefingRecord[]>;
  getBriefingById: (input: { userId: string; briefingId: string }) => Promise<BriefingRecord | null>;

  createDossier: (input: CreateDossierInput) => Promise<DossierRecord>;
  listDossiers: (input: {
    userId: string;
    status?: DossierStatus;
    limit: number;
  }) => Promise<DossierRecord[]>;
  getDossierById: (input: { userId: string; dossierId: string }) => Promise<DossierRecord | null>;
  updateDossier: (input: UpdateDossierInput) => Promise<DossierRecord | null>;
  replaceDossierSources: (input: ReplaceDossierSourcesInput) => Promise<DossierSourceRecord[]>;
  listDossierSources: (input: { userId: string; dossierId: string; limit: number }) => Promise<DossierSourceRecord[]>;
  replaceDossierClaims: (input: ReplaceDossierClaimsInput) => Promise<DossierClaimRecord[]>;
  listDossierClaims: (input: { userId: string; dossierId: string; limit: number }) => Promise<DossierClaimRecord[]>;

  createMission: (input: CreateMissionInput) => Promise<MissionRecord>;
  listMissions: (input: { userId: string; status?: MissionStatus; limit: number }) => Promise<MissionRecord[]>;
  getMissionById: (input: { missionId: string; userId: string }) => Promise<MissionRecord | null>;
  updateMission: (input: UpdateMissionInput) => Promise<MissionRecord | null>;

  upsertAssistantContext: (input: UpsertAssistantContextInput) => Promise<AssistantContextRecord>;
  updateAssistantContext: (input: UpdateAssistantContextInput) => Promise<AssistantContextRecord | null>;
  listAssistantContexts: (input: {
    userId: string;
    status?: AssistantContextStatus;
    limit: number;
  }) => Promise<AssistantContextRecord[]>;
  getAssistantContextById: (input: { userId: string; contextId: string }) => Promise<AssistantContextRecord | null>;
  getAssistantContextByClientContextId: (input: {
    userId: string;
    clientContextId: string;
  }) => Promise<AssistantContextRecord | null>;
  appendAssistantContextEvent: (input: AppendAssistantContextEventInput) => Promise<AssistantContextEventRecord | null>;
  listAssistantContextEvents: (input: {
    userId: string;
    contextId: string;
    sinceSequence?: number;
    limit: number;
  }) => Promise<AssistantContextEventRecord[]>;
  replaceAssistantContextGroundingSources: (
    input: ReplaceAssistantContextGroundingSourcesInput
  ) => Promise<AssistantContextGroundingSourceRecord[]>;
  listAssistantContextGroundingSources: (input: {
    userId: string;
    contextId: string;
    limit: number;
  }) => Promise<AssistantContextGroundingSourceRecord[]>;
  replaceAssistantContextGroundingClaims: (
    input: ReplaceAssistantContextGroundingClaimsInput
  ) => Promise<AssistantContextGroundingClaimRecord[]>;
  listAssistantContextGroundingClaims: (input: {
    userId: string;
    contextId: string;
    limit: number;
  }) => Promise<AssistantContextGroundingClaimRecord[]>;

  createTask: (input: CreateTaskInput) => Promise<TaskRecord>;
  setTaskStatus: (input: {
    taskId: string;
    status: TaskStatus;
    eventType?: string;
    data?: Record<string, unknown>;
    traceId?: string;
    spanId?: string;
  }) => Promise<TaskRecord | null>;
  listTasks: (input: { userId?: string; status?: TaskStatus; limit: number }) => Promise<TaskRecord[]>;
  getTaskById: (taskId: string) => Promise<TaskRecord | null>;

  appendTaskEvent: (event: AppendTaskEventInput) => Promise<TaskEventRecord>;
  listTaskEvents: (taskId: string, limit: number) => Promise<TaskEventRecord[]>;

  ingestRadarItems: (items: RadarItemRecord[]) => Promise<number>;
  listRadarItems: (input: { status?: RadarItemStatus; limit: number }) => Promise<RadarItemRecord[]>;
  evaluateRadar: (input: EvaluateRadarInput) => Promise<RadarRecommendationRecord[]>;
  listRadarRecommendations: (decision?: 'adopt' | 'hold' | 'discard') => Promise<RadarRecommendationRecord[]>;

  createTelegramReport: (input: {
    chatId: string;
    topic?: string;
    bodyMarkdown?: string;
    maxAttempts?: number;
  }) => Promise<TelegramReportRecord>;
  listTelegramReports: (input: {
    status?: TelegramReportStatus;
    limit: number;
  }) => Promise<TelegramReportRecord[]>;
  getTelegramReportById: (reportId: string) => Promise<TelegramReportRecord | null>;
  listPendingTelegramReports: (input: { limit: number; nowIso?: string }) => Promise<TelegramReportRecord[]>;
  updateTelegramReportDelivery: (input: {
    reportId: string;
    status: 'queued' | 'sent' | 'failed';
    incrementAttemptCount?: boolean;
    attemptCount?: number;
    maxAttempts?: number;
    telegramMessageId?: string | null;
    sentAt?: string | null;
    nextAttemptAt?: string | null;
    lastError?: string | null;
    bodyMarkdown?: string;
  }) => Promise<TelegramReportRecord | null>;

  listUpgradeProposals: (status?: UpgradeStatus) => Promise<UpgradeProposalRecord[]>;
  findUpgradeProposalById: (proposalId: string) => Promise<UpgradeProposalRecord | null>;
  decideUpgradeProposal: (
    proposalId: string,
    decision: 'approve' | 'reject',
    reason?: string
  ) => Promise<UpgradeProposalRecord | null>;

  createUpgradeRun: (payload: { proposalId: string; startCommand: string }) => Promise<UpgradeRunApiRecord>;
  listUpgradeRuns: (limit: number) => Promise<UpgradeRunApiRecord[]>;
  getUpgradeRunById: (runId: string) => Promise<UpgradeRunApiRecord | null>;

  createCouncilRun: (input: CreateCouncilRunInput) => Promise<CouncilRunRecord>;
  updateCouncilRun: (input: UpdateCouncilRunInput) => Promise<CouncilRunRecord | null>;
  getCouncilRunByIdempotency: (input: { userId: string; idempotencyKey: string }) => Promise<CouncilRunRecord | null>;
  listCouncilRuns: (limit: number) => Promise<CouncilRunRecord[]>;
  getCouncilRunById: (runId: string) => Promise<CouncilRunRecord | null>;

  createExecutionRun: (input: CreateExecutionRunInput) => Promise<ExecutionRunRecord>;
  updateExecutionRun: (input: UpdateExecutionRunInput) => Promise<ExecutionRunRecord | null>;
  getExecutionRunByIdempotency: (input: {
    userId: string;
    idempotencyKey: string;
  }) => Promise<ExecutionRunRecord | null>;
  listExecutionRuns: (limit: number) => Promise<ExecutionRunRecord[]>;
  getExecutionRunById: (runId: string) => Promise<ExecutionRunRecord | null>;

  createMemorySegment: (input: CreateMemorySegmentInput) => Promise<MemorySegmentRecord>;
  searchMemoryByEmbedding: (input: SearchMemoryByEmbeddingInput) => Promise<MemorySegmentRecord[]>;
  listMemorySegments: (input: { userId: string; limit: number }) => Promise<MemorySegmentRecord[]>;

  createApproval: (input: CreateApprovalInput) => Promise<ApprovalRecord>;
  listApprovals: (input: { status?: ApprovalStatus; limit: number }) => Promise<ApprovalRecord[]>;
  decideApproval: (input: { approvalId: string; decidedBy: string; decision: 'approved' | 'rejected'; reason?: string }) => Promise<ApprovalRecord | null>;

  createUpgradeExecutorGateway: () => UpgradeExecutorGateway;
};
