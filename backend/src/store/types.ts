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

export type ProviderCredentialRecord = {
  provider: ProviderCredentialProvider;
  encryptedApiKey: string;
  updatedBy: string | null;
  updatedAt: string;
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
