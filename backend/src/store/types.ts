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
export type JarvisCapability =
  | 'answer'
  | 'research'
  | 'brief'
  | 'debate'
  | 'plan'
  | 'approve'
  | 'execute'
  | 'monitor'
  | 'notify';
export type JarvisSessionStageStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'needs_approval'
  | 'completed'
  | 'failed'
  | 'skipped';

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

export type UpsertJarvisSessionStageInput = {
  userId: string;
  sessionId: string;
  stageKey: string;
  capability?: JarvisCapability;
  title?: string;
  status?: JarvisSessionStageStatus;
  orderIndex?: number;
  dependsOnJson?: string[];
  artifactRefsJson?: Record<string, unknown>;
  summary?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
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

export type WorldModelEntityKind =
  | 'actor'
  | 'organization'
  | 'country'
  | 'asset'
  | 'route'
  | 'facility'
  | 'commodity'
  | 'policy'
  | 'other';

export type WorldModelEventKind =
  | 'geopolitical'
  | 'contract'
  | 'policy'
  | 'market'
  | 'operational'
  | 'financial'
  | 'other';

export type WorldModelConstraintKind =
  | 'capacity'
  | 'logistics'
  | 'insurance'
  | 'regulatory'
  | 'settlement'
  | 'financing'
  | 'other';

export type WorldModelConstraintStatus = 'active' | 'watching' | 'relieved';
export type WorldModelSeverity = 'low' | 'medium' | 'high';
export type WorldModelHypothesisStance = 'primary' | 'counter';
export type WorldModelHypothesisStatus = 'active' | 'weakened' | 'invalidated';
export type WorldModelHypothesisEvidenceRelation = 'supports' | 'contradicts' | 'context';
export type WorldModelInvalidationStatus = 'pending' | 'hit' | 'missed';
export type WorldModelSnapshotTargetType = 'dossier' | 'watcher' | 'session';
export type WorldModelOutcomeResult = 'confirmed' | 'mixed' | 'invalidated' | 'unresolved';
export type WorldModelProjectionOrigin = 'briefing_generate' | 'dossier_refresh' | 'watcher_run' | 'outcome_backfill';
export type WorldModelProjectionStatus = 'active' | 'superseded';
export type WorldModelAttributes = Record<string, unknown>;

export type WorldModelEntityRecord = {
  id: string;
  userId: string;
  kind: WorldModelEntityKind;
  canonicalName: string;
  aliases: string[];
  attributes: WorldModelAttributes;
  createdAt: string;
  updatedAt: string;
};

export type UpsertWorldModelEntityInput = {
  userId: string;
  kind: WorldModelEntityKind;
  canonicalName: string;
  aliases?: string[];
  attributes?: WorldModelAttributes | null;
};

export type WorldModelEventRecord = {
  id: string;
  userId: string;
  dossierId: string | null;
  kind: WorldModelEventKind;
  summary: string;
  occurredAt: string | null;
  recordedAt: string | null;
  attributes: WorldModelAttributes;
  createdAt: string;
};

export type CreateWorldModelEventInput = {
  userId: string;
  dossierId?: string | null;
  kind: WorldModelEventKind;
  summary: string;
  occurredAt?: string | null;
  recordedAt?: string | null;
  attributes?: WorldModelAttributes | null;
};

export type WorldModelObservationRecord = {
  id: string;
  userId: string;
  dossierId: string | null;
  metricKey: string;
  valueText: string;
  unit: string | null;
  observedAt: string | null;
  recordedAt: string | null;
  attributes: WorldModelAttributes;
  createdAt: string;
};

export type CreateWorldModelObservationInput = {
  userId: string;
  dossierId?: string | null;
  metricKey: string;
  valueText: string;
  unit?: string | null;
  observedAt?: string | null;
  recordedAt?: string | null;
  attributes?: WorldModelAttributes | null;
};

export type WorldModelConstraintRecord = {
  id: string;
  userId: string;
  dossierId: string | null;
  kind: WorldModelConstraintKind;
  description: string;
  severity: WorldModelSeverity;
  status: WorldModelConstraintStatus;
  attributes: WorldModelAttributes;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorldModelConstraintInput = {
  userId: string;
  dossierId?: string | null;
  kind: WorldModelConstraintKind;
  description: string;
  severity?: WorldModelSeverity;
  status?: WorldModelConstraintStatus;
  attributes?: WorldModelAttributes | null;
};

export type UpdateWorldModelConstraintInput = {
  constraintId: string;
  userId: string;
  description?: string;
  severity?: WorldModelSeverity;
  status?: WorldModelConstraintStatus;
  attributes?: WorldModelAttributes | null;
};

export type WorldModelHypothesisRecord = {
  id: string;
  userId: string;
  projectionId: string | null;
  dossierId: string | null;
  briefingId: string | null;
  thesis: string;
  stance: WorldModelHypothesisStance;
  confidence: number;
  status: WorldModelHypothesisStatus;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorldModelHypothesisInput = {
  userId: string;
  projectionId?: string | null;
  dossierId?: string | null;
  briefingId?: string | null;
  thesis: string;
  stance: WorldModelHypothesisStance;
  confidence?: number;
  status?: WorldModelHypothesisStatus;
  summary?: string | null;
};

export type UpdateWorldModelHypothesisInput = {
  hypothesisId: string;
  userId: string;
  confidence?: number;
  status?: WorldModelHypothesisStatus;
  summary?: string | null;
};

export type WorldModelHypothesisEvidenceRecord = {
  id: string;
  hypothesisId: string;
  dossierId: string | null;
  claimText: string;
  relation: WorldModelHypothesisEvidenceRelation;
  sourceUrls: string[];
  weight: number;
  createdAt: string;
};

export type CreateWorldModelHypothesisEvidenceInput = {
  hypothesisId: string;
  dossierId?: string | null;
  claimText: string;
  relation?: WorldModelHypothesisEvidenceRelation;
  sourceUrls?: string[];
  weight?: number;
};

export type WorldModelInvalidationConditionRecord = {
  id: string;
  hypothesisId: string;
  description: string;
  expectedBy: string | null;
  observedStatus: WorldModelInvalidationStatus;
  severity: WorldModelSeverity;
  attributes: WorldModelAttributes;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorldModelInvalidationConditionInput = {
  hypothesisId: string;
  description: string;
  expectedBy?: string | null;
  observedStatus?: WorldModelInvalidationStatus;
  severity?: WorldModelSeverity;
  attributes?: WorldModelAttributes | null;
};

export type UpdateWorldModelInvalidationConditionInput = {
  invalidationConditionId: string;
  observedStatus?: WorldModelInvalidationStatus;
  expectedBy?: string | null;
  severity?: WorldModelSeverity;
  attributes?: WorldModelAttributes | null;
};

export type WorldModelStateSnapshotRecord = {
  id: string;
  userId: string;
  targetType: WorldModelSnapshotTargetType;
  targetId: string;
  stateJson: Record<string, unknown>;
  createdAt: string;
};

export type CreateWorldModelStateSnapshotInput = {
  userId: string;
  targetType: WorldModelSnapshotTargetType;
  targetId: string;
  stateJson: Record<string, unknown>;
};

export type WorldModelProjectionRecord = {
  id: string;
  userId: string;
  dossierId: string | null;
  briefingId: string | null;
  watcherId: string | null;
  sessionId: string | null;
  origin: WorldModelProjectionOrigin;
  status: WorldModelProjectionStatus;
  generatedAt: string;
  supersededAt: string | null;
  supersededByProjectionId: string | null;
  summaryJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorldModelProjectionInput = {
  userId: string;
  dossierId?: string | null;
  briefingId?: string | null;
  watcherId?: string | null;
  sessionId?: string | null;
  origin: WorldModelProjectionOrigin;
  status?: WorldModelProjectionStatus;
  generatedAt?: string;
  summaryJson?: Record<string, unknown>;
};

export type UpdateWorldModelProjectionInput = {
  projectionId: string;
  userId: string;
  status?: WorldModelProjectionStatus;
  supersededAt?: string | null;
  supersededByProjectionId?: string | null;
  summaryJson?: Record<string, unknown> | null;
};

export type WorldModelOutcomeRecord = {
  id: string;
  userId: string;
  hypothesisId: string;
  evaluatedAt: string;
  result: WorldModelOutcomeResult;
  errorNotes: string | null;
  horizonRealized: string | null;
  missedInvalidators: string[];
  createdAt: string;
};

export type CreateWorldModelOutcomeInput = {
  userId: string;
  hypothesisId: string;
  evaluatedAt?: string;
  result: WorldModelOutcomeResult;
  errorNotes?: string | null;
  horizonRealized?: string | null;
  missedInvalidators?: string[];
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

export type RadarSourceType =
  | 'news'
  | 'filing'
  | 'policy'
  | 'market_tick'
  | 'freight'
  | 'inventory'
  | 'blog'
  | 'forum'
  | 'social'
  | 'ops_policy'
  | 'manual';

export type RadarSourceTier = 'tier_0' | 'tier_1' | 'tier_2' | 'tier_3';
export type RadarFeedKind = 'rss' | 'atom' | 'json' | 'mcp_connector' | 'synthetic';
export type RadarEventType =
  | 'geopolitical_flashpoint'
  | 'policy_change'
  | 'earnings_guidance'
  | 'supply_chain_shift'
  | 'rate_repricing'
  | 'commodity_move'
  | 'general_signal';
export type RadarDomainId =
  | 'geopolitics_energy_lng'
  | 'macro_rates_inflation_fx'
  | 'shipping_supply_chain'
  | 'policy_regulation_platform_ai'
  | 'company_earnings_guidance'
  | 'commodities_raw_materials';
export type RadarPromotionDecision = 'ignore' | 'watch' | 'dossier' | 'action' | 'execute_auto_candidate';
export type RadarExecutionMode = 'watch_only' | 'dossier_only' | 'proposal_auto' | 'execute_auto' | 'approval_required';
export type RadarRiskBand = 'low' | 'medium' | 'high' | 'critical';
export type RadarKillSwitchScope = 'none' | 'global' | 'domain_pack' | 'source_tier';
export type RadarIngestRunStatus = 'running' | 'ok' | 'error';

export type RadarCorroborationDetail = {
  sourceCount: number;
  uniqueSourceCount: number;
  nonSocialSourceCount: number;
  hasMetricCorroboration: boolean;
  sourceTypeDiversity: number;
  sourceTierDiversity: number;
};

export type ExecutionPolicyDecision = {
  mode: 'blocked' | 'internal_only' | 'mcp_write_allowed';
  requiresHuman: boolean;
  reasons: string[];
  target: 'none' | 'internal' | 'mcp_write';
  mcpToolName: string | null;
};

export type RadarMetricShock = {
  metricKey: string;
  value: number | string | null;
  unit: string | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  observedAt: string | null;
};

export type RadarSourceMix = {
  sourceTiers: RadarSourceTier[];
  sourceTypes: RadarSourceType[];
  sourceCount?: number;
  uniqueSourceCount?: number;
  nonSocialSourceCount?: number;
  byTier?: Partial<Record<RadarSourceTier, number>>;
  byType?: Partial<Record<RadarSourceType, number>>;
  hasMetricCorroboration?: boolean;
  diversityScore?: number;
};

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

export type RadarFeedCursorRecord = {
  sourceId: string;
  cursor: string | null;
  etag: string | null;
  lastModified: string | null;
  lastSeenPublishedAt: string | null;
  lastFetchedAt: string | null;
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

export type RadarItemRecord = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  sourceName: string;
  publishedAt: string | null;
  confidenceScore: number;
  status: RadarItemStatus;
  sourceType?: RadarSourceType;
  sourceTier?: RadarSourceTier;
  observedAt?: string | null;
  rawMetrics?: Record<string, unknown>;
  entityHints?: string[];
  trustHint?: string | null;
  payload?: Record<string, unknown>;
};

export type RadarEventRecord = {
  id: string;
  title: string;
  summary: string;
  eventType: RadarEventType;
  geoScope: string | null;
  timeScope: string | null;
  dedupeClusterId: string;
  primaryItemId: string | null;
  clusterSize: number;
  itemIds: string[];
  entities: string[];
  claims: string[];
  metricShocks: RadarMetricShock[];
  sourceMix: RadarSourceMix;
  sourceDiversityScore: number;
  corroborationDetail: RadarCorroborationDetail;
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
  killSwitchScope: RadarKillSwitchScope;
  createdAt: string;
  updatedAt: string;
};

export type RadarOperatorFeedbackRecord = {
  id: string;
  eventId: string;
  userId: string;
  kind: 'ack' | 'override';
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

export type UpdateRadarControlSettingsInput = {
  userId: string;
  globalKillSwitch?: boolean;
  autoExecutionEnabled?: boolean;
  dossierPromotionEnabled?: boolean;
  tier3EscalationEnabled?: boolean;
  disabledDomainIds?: RadarDomainId[];
  disabledSourceTiers?: RadarSourceTier[];
};

export type ToggleRadarFeedSourceInput = {
  sourceId: string;
  enabled: boolean;
  userId: string;
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
  eventId?: string | null;
  structuralityScore?: number;
  actionabilityScore?: number;
  promotionDecision?: RadarPromotionDecision;
  domainIds?: RadarDomainId[];
  autonomyExecutionMode?: RadarExecutionMode;
  autonomyRiskBand?: RadarRiskBand;
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

export type MemoryNoteKind = 'user_preference' | 'project_context' | 'decision_memory' | 'research_memory';
export type MemoryNoteSource = 'manual' | 'session' | 'system';
export type MemoryPreferenceResponseStyle = 'concise' | 'balanced' | 'detailed';
export type MemoryPreferenceRiskTolerance = 'cautious' | 'balanced' | 'aggressive';
export type MemoryPreferenceApprovalStyle =
  | 'read_only_review'
  | 'approval_required_write'
  | 'safe_auto_run_preferred';
export type MemoryPreferenceMonitoring = 'manual' | 'important_changes' | 'all_changes';
export type MemoryPreferenceKey =
  | 'response_style'
  | 'preferred_provider'
  | 'preferred_model'
  | 'risk_tolerance'
  | 'approval_style'
  | 'monitoring_preference'
  | 'project_context';
export type MemoryNoteAttributes = Record<string, unknown>;

export type MemoryNoteRecord = {
  id: string;
  userId: string;
  kind: MemoryNoteKind;
  title: string;
  content: string;
  key: string | null;
  value: string | null;
  attributes: MemoryNoteAttributes;
  tags: string[];
  pinned: boolean;
  source: MemoryNoteSource;
  relatedSessionId: string | null;
  relatedTaskId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateMemoryNoteInput = {
  userId: string;
  kind: MemoryNoteKind;
  title: string;
  content: string;
  key?: string | null;
  value?: string | null;
  attributes?: MemoryNoteAttributes | null;
  tags?: string[];
  pinned?: boolean;
  source?: MemoryNoteSource;
  relatedSessionId?: string | null;
  relatedTaskId?: string | null;
};

export type UpdateMemoryNoteInput = {
  noteId: string;
  userId: string;
  title?: string;
  content?: string;
  key?: string | null;
  value?: string | null;
  attributes?: MemoryNoteAttributes | null;
  tags?: string[];
  pinned?: boolean;
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

export type IntelligenceWorkspaceRole = 'owner' | 'admin' | 'member';
export type IntelligenceSourceKind =
  | 'rss'
  | 'atom'
  | 'json'
  | 'api'
  | 'search'
  | 'headless'
  | 'mcp_connector'
  | 'synthetic';
export type IntelligenceSourceType =
  | 'news'
  | 'filing'
  | 'policy'
  | 'market_tick'
  | 'freight'
  | 'inventory'
  | 'blog'
  | 'forum'
  | 'social'
  | 'search_result'
  | 'web_page'
  | 'manual';
export type IntelligenceSourceTier = 'tier_0' | 'tier_1' | 'tier_2' | 'tier_3';
export type IntelligenceEventFamily =
  | 'geopolitical_flashpoint'
  | 'policy_change'
  | 'earnings_guidance'
  | 'supply_chain_shift'
  | 'rate_repricing'
  | 'commodity_move'
  | 'platform_ai_shift'
  | 'general_signal';
export type IntelligenceDomainId =
  | 'geopolitics_energy_lng'
  | 'macro_rates_inflation_fx'
  | 'shipping_supply_chain'
  | 'policy_regulation_platform_ai'
  | 'company_earnings_guidance'
  | 'commodities_raw_materials';
export type IntelligenceCapabilityAlias =
  | 'fast_triage'
  | 'structured_extraction'
  | 'cross_doc_linking'
  | 'skeptical_critique'
  | 'deep_synthesis'
  | 'policy_judgment'
  | 'deep_research'
  | 'execution_planning';
export type IntelligenceScanRunStatus = 'running' | 'ok' | 'error' | 'timeout';
export type IntelligenceExecutionStatus = 'pending' | 'approved' | 'executed' | 'blocked' | 'failed';
export type IntelligenceBridgeKind = 'council' | 'brief' | 'action';
export type IntelligenceBridgeStatus = 'pending' | 'dispatched' | 'failed';
export type IntelligenceCostClass = 'free' | 'low' | 'standard' | 'premium';
export type IntelligenceLatencyClass = 'fast' | 'balanced' | 'slow';
export type IntelligenceSignalProcessingStatus = 'pending' | 'processing' | 'processed' | 'failed';
export type IntelligenceSignalPromotionState = 'pending_validation' | 'quarantined' | 'attached' | 'promoted';
export type IntelligenceEventLifecycleState = 'provisional' | 'canonical';
export type IntelligenceDeliberationStatus = 'idle' | 'completed' | 'failed';
export type EventReviewState = 'watch' | 'review' | 'ignore';

export type IntelligenceCrawlPolicy = {
  allowDomains: string[];
  denyDomains: string[];
  respectRobots: boolean;
  maxDepth: number;
  maxPagesPerRun: number;
  revisitCooldownMinutes: number;
  perDomainRateLimitPerMinute: number;
};

export type IntelligenceSourceHealth = {
  lastStatus: 'idle' | 'ok' | 'error' | 'blocked';
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
  provider: ProviderCredentialProvider;
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

export type ResetIntelligenceDerivedWorkspaceStateResult = {
  workspaceId: string;
  deletedEventCount: number;
  deletedClusterCount: number;
  deletedLinkedClaimCount: number;
};

export type IntelligenceWorkspaceMemberRecord = {
  workspaceId: string;
  userId: string;
  role: IntelligenceWorkspaceRole;
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

export type CreateIntelligenceSourceInput = {
  workspaceId: string;
  name: string;
  kind: IntelligenceSourceKind;
  url: string;
  sourceType: IntelligenceSourceType;
  sourceTier: IntelligenceSourceTier;
  pollMinutes?: number;
  enabled?: boolean;
  parserConfigJson?: Record<string, unknown>;
  crawlConfigJson?: Record<string, unknown>;
  crawlPolicy?: Partial<IntelligenceCrawlPolicy>;
  connectorCapability?: ConnectorCapabilityRecord | null;
  entityHints?: string[];
  metricHints?: string[];
};

export type UpdateIntelligenceSourceInput = {
  workspaceId: string;
  sourceId: string;
  enabled?: boolean;
  pollMinutes?: number;
  parserConfigJson?: Record<string, unknown>;
  crawlConfigJson?: Record<string, unknown>;
  crawlPolicy?: Partial<IntelligenceCrawlPolicy>;
  health?: Partial<IntelligenceSourceHealth>;
  connectorCapability?: ConnectorCapabilityRecord | null;
  lastFetchedAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
};

export type IntelligenceSourceCursorRecord = {
  workspaceId: string;
  sourceId: string;
  cursor: string | null;
  etag: string | null;
  lastModified: string | null;
  lastSeenPublishedAt: string | null;
  lastFetchedAt: string | null;
  updatedAt: string;
};

export type UpsertIntelligenceSourceCursorInput = {
  workspaceId: string;
  sourceId: string;
  cursor?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  lastSeenPublishedAt?: string | null;
  lastFetchedAt?: string | null;
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

export type CreateIntelligenceScanRunInput = {
  workspaceId: string;
  sourceId?: string | null;
  status?: IntelligenceScanRunStatus;
  fetchedCount?: number;
  storedDocumentCount?: number;
  signalCount?: number;
  clusteredEventCount?: number;
  executionCount?: number;
  failedCount?: number;
  error?: string | null;
  detailJson?: Record<string, unknown>;
  startedAt?: string;
};

export type CompleteIntelligenceScanRunInput = {
  runId: string;
  workspaceId: string;
  status: IntelligenceScanRunStatus;
  fetchedCount?: number;
  storedDocumentCount?: number;
  signalCount?: number;
  clusteredEventCount?: number;
  executionCount?: number;
  failedCount?: number;
  error?: string | null;
  detailJson?: Record<string, unknown>;
  finishedAt?: string;
};

export type RawDocumentRecord = {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  sourceUrl: string;
  canonicalUrl: string;
  documentIdentityKey: string;
  title: string;
  summary: string;
  rawText: string;
  rawHtml: string | null;
  publishedAt: string | null;
  observedAt: string | null;
  language: string | null;
  sourceType: IntelligenceSourceType;
  sourceTier: IntelligenceSourceTier;
  documentFingerprint: string;
  metadataJson: Record<string, unknown>;
  createdAt: string;
};

export type CreateRawDocumentInput = {
  workspaceId: string;
  sourceId?: string | null;
  sourceUrl: string;
  canonicalUrl: string;
  documentIdentityKey?: string;
  title: string;
  summary?: string;
  rawText: string;
  rawHtml?: string | null;
  publishedAt?: string | null;
  observedAt?: string | null;
  language?: string | null;
  sourceType: IntelligenceSourceType;
  sourceTier: IntelligenceSourceTier;
  documentFingerprint: string;
  metadataJson?: Record<string, unknown>;
};

export type SignalEnvelopeRecord = {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  documentId: string;
  sourceType: IntelligenceSourceType;
  sourceTier: IntelligenceSourceTier;
  url: string;
  publishedAt: string | null;
  observedAt: string | null;
  language: string | null;
  rawText: string;
  rawMetrics: Record<string, unknown>;
  entityHints: string[];
  trustHint: string | null;
  processingStatus: IntelligenceSignalProcessingStatus;
  promotionState: IntelligenceSignalPromotionState;
  promotionReasons: string[];
  processingLeaseId: string | null;
  linkedEventId: string | null;
  processingError: string | null;
  processedAt: string | null;
  createdAt: string;
};

export type CreateSignalEnvelopeInput = {
  workspaceId: string;
  sourceId?: string | null;
  documentId: string;
  sourceType: IntelligenceSourceType;
  sourceTier: IntelligenceSourceTier;
  url: string;
  publishedAt?: string | null;
  observedAt?: string | null;
  language?: string | null;
  rawText: string;
  rawMetrics?: Record<string, unknown>;
  entityHints?: string[];
  trustHint?: string | null;
  processingStatus?: IntelligenceSignalProcessingStatus;
  promotionState?: IntelligenceSignalPromotionState;
  promotionReasons?: string[];
  processingLeaseId?: string | null;
  linkedEventId?: string | null;
  processingError?: string | null;
  processedAt?: string | null;
};

export type UpdateIntelligenceSignalProcessingInput = {
  workspaceId: string;
  signalId: string;
  processingStatus: IntelligenceSignalProcessingStatus;
  expectedCurrentStatus?: IntelligenceSignalProcessingStatus;
  expectedCurrentLeaseId?: string | null;
  promotionState?: IntelligenceSignalPromotionState;
  promotionReasons?: string[];
  processingLeaseId?: string | null;
  linkedEventId?: string | null;
  processingError?: string | null;
  processedAt?: string | null;
};

export type SemanticClaim = {
  claimId: string;
  subjectEntity: string;
  predicate: string;
  object: string;
  evidenceSpan: string | null;
  timeScope: string | null;
  uncertainty: 'low' | 'medium' | 'high';
  stance: 'supporting' | 'neutral' | 'contradicting';
  claimType: 'fact' | 'prediction' | 'opinion' | 'signal';
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

export type CreateLinkedClaimInput = Omit<
  LinkedClaimRecord,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'reviewState'
  | 'reviewReason'
  | 'reviewOwner'
  | 'reviewUpdatedAt'
  | 'reviewUpdatedBy'
  | 'reviewResolvedAt'
> & {
  id?: string;
  reviewState?: EventReviewState;
  reviewReason?: string | null;
  reviewOwner?: string | null;
  reviewUpdatedAt?: string | null;
  reviewUpdatedBy?: string | null;
  reviewResolvedAt?: string | null;
};

export type ClaimLinkRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  linkedClaimId: string;
  signalId: string;
  semanticClaimId: string;
  relation: 'supporting' | 'contradicting' | 'related';
  confidence: number;
  linkStrength: number;
  createdAt: string;
};

export type CreateClaimLinkInput = Omit<ClaimLinkRecord, 'id' | 'createdAt'> & {
  id?: string;
};

export type LinkedClaimEdgeRecord = {
  id: string;
  workspaceId: string;
  leftLinkedClaimId: string;
  rightLinkedClaimId: string;
  relation: 'supports' | 'contradicts' | 'related';
  edgeStrength: number;
  evidenceSignalIds: string[];
  lastObservedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateLinkedClaimEdgeInput = Omit<
  LinkedClaimEdgeRecord,
  'id' | 'createdAt' | 'updatedAt'
> & {
  id?: string;
};

export type EventMembershipRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  linkedClaimId: string;
  role: 'core' | 'supporting' | 'contradicting';
  createdAt: string;
};

export type CreateEventMembershipInput = Omit<EventMembershipRecord, 'id' | 'createdAt'> & {
  id?: string;
};

export type IntelligenceMetricShock = {
  metricKey: string;
  value: number | string | null;
  unit: string | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
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

export type HypothesisRecord = {
  id: string;
  title: string;
  summary: string;
  confidence: number;
  rationale: string;
};

export type HypothesisLedgerEntry = {
  id: string;
  workspaceId: string;
  eventId: string;
  hypothesisId: string;
  kind: 'primary' | 'counter';
  title: string;
  summary: string;
  confidence: number;
  rationale: string;
  status: 'active' | 'superseded';
  reviewState: EventReviewState;
  reviewReason: string | null;
  reviewOwner: string | null;
  reviewUpdatedAt: string | null;
  reviewUpdatedBy: string | null;
  reviewResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateHypothesisLedgerEntryInput = Omit<
  HypothesisLedgerEntry,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'reviewState'
  | 'reviewReason'
  | 'reviewOwner'
  | 'reviewUpdatedAt'
  | 'reviewUpdatedBy'
  | 'reviewResolvedAt'
> & {
  id?: string;
  reviewState?: EventReviewState;
  reviewReason?: string | null;
  reviewOwner?: string | null;
  reviewUpdatedAt?: string | null;
  reviewUpdatedBy?: string | null;
  reviewResolvedAt?: string | null;
};

export type CounterHypothesisRecord = {
  id: string;
  title: string;
  summary: string;
  confidence: number;
  rationale: string;
};

export type InvalidationConditionRecord = {
  id: string;
  title: string;
  description: string;
  matcherJson: Record<string, unknown>;
  status: 'pending' | 'hit' | 'missed';
};

export type ExpectedSignalRecord = {
  id: string;
  signalKey: string;
  description: string;
  dueAt: string | null;
  status: 'pending' | 'observed' | 'absent';
};

export type DeliberationResult = {
  id: string;
  source: 'bridge_council' | 'local';
  status: 'pending' | 'completed' | 'failed';
  proposedPrimary: string;
  proposedCounter: string;
  weakestLink: string;
  requiredNextSignals: string[];
  executionStance: 'proceed' | 'hold' | 'reject';
  rawJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionCandidateRecord = {
  id: string;
  title: string;
  summary: string;
  riskBand: RadarRiskBand;
  executionMode: 'proposal' | 'execute_auto' | 'approval_required';
  payload: Record<string, unknown>;
  policyJson: Record<string, unknown>;
  status: IntelligenceExecutionStatus;
  resultJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
};

export type HypothesisEvidenceLink = {
  id: string;
  workspaceId: string;
  eventId: string;
  hypothesisId: string;
  linkedClaimId: string | null;
  signalId: string | null;
  relation: 'supports' | 'contradicts' | 'monitors';
  evidenceStrength: number | null;
  createdAt: string;
};

export type CreateHypothesisEvidenceLinkInput = Omit<HypothesisEvidenceLink, 'id' | 'createdAt'> & {
  id?: string;
};

export type IntelligenceInvalidationEntryRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  title: string;
  description: string;
  matcherJson: Record<string, unknown>;
  status: 'pending' | 'hit' | 'missed';
  createdAt: string;
  updatedAt: string;
};

export type CreateIntelligenceInvalidationEntryInput = Omit<
  IntelligenceInvalidationEntryRecord,
  'createdAt' | 'updatedAt'
> & {
  id?: string;
};

export type IntelligenceExpectedSignalEntryRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  signalKey: string;
  description: string;
  dueAt: string | null;
  status: 'pending' | 'observed' | 'absent';
  createdAt: string;
  updatedAt: string;
};

export type CreateIntelligenceExpectedSignalEntryInput = Omit<
  IntelligenceExpectedSignalEntryRecord,
  'createdAt' | 'updatedAt'
> & {
  id?: string;
};

export type IntelligenceOutcomeRecord = {
  id: string;
  status: 'confirmed' | 'invalidated' | 'mixed' | 'unresolved';
  summary: string;
  createdAt: string;
};

export type IntelligenceOutcomeEntryRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  status: 'confirmed' | 'invalidated' | 'mixed' | 'unresolved';
  summary: string;
  createdAt: string;
};

export type CreateIntelligenceOutcomeEntryInput = Omit<IntelligenceOutcomeEntryRecord, 'createdAt'> & {
  id?: string;
};

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

export type CreateExecutionAuditInput = Omit<ExecutionAuditRecord, 'id' | 'createdAt'> & {
  id?: string;
};

export type OperatorNoteRecord = {
  id: string;
  workspaceId: string;
  eventId: string;
  userId: string;
  scope: 'event' | 'hypothesis' | 'linked_claim' | 'narrative_cluster';
  scopeId: string | null;
  note: string;
  createdAt: string;
};

export type CreateOperatorNoteInput = Omit<OperatorNoteRecord, 'id' | 'createdAt'> & {
  id?: string;
};

export type SemanticBacklogStatus = {
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  latestFailedSignalIds: string[];
};

export type SourceRetryResult = {
  sourceId: string;
  workspaceId: string;
  queuedAt: string;
  sourceEnabled: boolean;
};

export type SignalRetryResult = {
  signalId: string;
  workspaceId: string;
  queuedAt: string;
  processingStatus: IntelligenceSignalProcessingStatus;
};

export type IntelligenceQualityState = 'healthy' | 'suspect';

export type IntelligenceQualitySummary = {
  state: IntelligenceQualityState;
  score: number;
  reasons: string[];
};

export type IntelligenceSemanticValidation = {
  confidence: number;
  usedFallback: boolean;
  genericClaimRatio: number;
  hintOnlyEntityRatio: number;
  topDomainScore: number;
  topDomainMargin: number;
  titleDriftScore: number;
  reasons: string[];
};

export type IntelligenceEventClusterRecord = {
  id: string;
  workspaceId: string;
  title: string;
  summary: string;
  eventFamily: IntelligenceEventFamily;
  lifecycleState: IntelligenceEventLifecycleState;
  validationReasons: string[];
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
  semanticClaims: SemanticClaim[];
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
  primaryHypotheses: HypothesisRecord[];
  counterHypotheses: CounterHypothesisRecord[];
  invalidationConditions: InvalidationConditionRecord[];
  expectedSignals: ExpectedSignalRecord[];
  deliberationStatus: IntelligenceDeliberationStatus;
  reviewState: EventReviewState;
  reviewReason: string | null;
  reviewOwner: string | null;
  reviewUpdatedAt: string | null;
  reviewUpdatedBy: string | null;
  reviewResolvedAt: string | null;
  deliberations: DeliberationResult[];
  executionCandidates: ExecutionCandidateRecord[];
  outcomes: IntelligenceOutcomeRecord[];
  operatorNoteCount: number;
  recurringNarrativeScore?: number;
  relatedHistoricalEventCount?: number;
  temporalNarrativeState?: IntelligenceTemporalNarrativeState;
  narrativeClusterId?: string | null;
  narrativeClusterState?: IntelligenceNarrativeClusterState | null;
  quality?: IntelligenceQualitySummary;
  createdAt: string;
  updatedAt: string;
};

export type UpsertIntelligenceEventInput = Omit<IntelligenceEventClusterRecord, 'createdAt' | 'updatedAt' | 'lifecycleState' | 'validationReasons'> & {
  createdAt?: string;
  updatedAt?: string;
  lifecycleState?: IntelligenceEventLifecycleState;
  validationReasons?: string[];
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

export type IntelligenceTemporalNarrativeState = 'new' | 'recurring' | 'diverging';

export type IntelligenceRelatedHistoricalEventSummary = {
  eventId: string;
  title: string;
  relation: 'recurring' | 'diverging' | 'supportive_history';
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
  relation: IntelligenceRelatedHistoricalEventSummary['relation'];
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

export type IntelligenceNarrativeClusterState = 'forming' | 'recurring' | 'diverging';

export type IntelligenceNarrativeClusterLedgerEntryType =
  | 'merge'
  | 'split'
  | 'recurring_strengthened'
  | 'diverging_strengthened'
  | 'supportive_history_added'
  | 'stability_drop';

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
  recurringStrengthTrend: number;
  divergenceTrend: number;
  supportDecayScore: number;
  contradictionAcceleration: number;
  clusterPriorityScore: number;
  recentExecutionBlockedCount: number;
  reviewState: EventReviewState;
  reviewReason: string | null;
  reviewOwner: string | null;
  reviewUpdatedAt: string | null;
  reviewUpdatedBy: string | null;
  reviewResolvedAt: string | null;
  lastLedgerAt: string | null;
  lastEventAt: string | null;
  lastRecurringAt: string | null;
  lastDivergingAt: string | null;
  quality?: IntelligenceQualitySummary;
  createdAt: string;
  updatedAt: string;
};

export type CreateIntelligenceNarrativeClusterInput = Omit<
  IntelligenceNarrativeClusterRecord,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'reviewState'
  | 'reviewReason'
  | 'reviewOwner'
  | 'reviewUpdatedAt'
  | 'reviewUpdatedBy'
  | 'reviewResolvedAt'
> & {
  id?: string;
  reviewState?: EventReviewState;
  reviewReason?: string | null;
  reviewOwner?: string | null;
  reviewUpdatedAt?: string | null;
  reviewUpdatedBy?: string | null;
  reviewResolvedAt?: string | null;
};

export type IntelligenceNarrativeClusterMembershipRecord = {
  id: string;
  workspaceId: string;
  clusterId: string;
  eventId: string;
  relation: 'origin' | IntelligenceRelatedHistoricalEventSummary['relation'];
  score: number;
  daysDelta: number | null;
  isLatest: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateIntelligenceNarrativeClusterMembershipInput = Omit<
  IntelligenceNarrativeClusterMembershipRecord,
  'id' | 'createdAt' | 'updatedAt'
> & {
  id?: string;
};

export type IntelligenceNarrativeClusterMemberSummary = {
  membershipId: string;
  eventId: string;
  title: string;
  relation: IntelligenceNarrativeClusterMembershipRecord['relation'];
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

export type IntelligenceNarrativeClusterLedgerEntryRecord = {
  id: string;
  workspaceId: string;
  clusterId: string;
  entryType: IntelligenceNarrativeClusterLedgerEntryType;
  summary: string;
  scoreDelta: number;
  sourceEventIds: string[];
  createdAt: string;
};

export type CreateIntelligenceNarrativeClusterLedgerEntryInput = Omit<
  IntelligenceNarrativeClusterLedgerEntryRecord,
  'createdAt'
> & {
  id?: string;
  createdAt?: string;
};

export type IntelligenceNarrativeClusterTimelineRecord = {
  id: string;
  workspaceId: string;
  clusterId: string;
  bucketStart: string;
  eventCount: number;
  recurringScore: number;
  driftScore: number;
  supportScore: number;
  contradictionScore: number;
  timeCoherenceScore: number;
  hotspotEventCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceNarrativeClusterTrendSummary = {
  recurringStrengthTrend: number;
  divergenceTrend: number;
  supportDecayScore: number;
  contradictionAcceleration: number;
  lastRecurringAt: string | null;
  lastDivergingAt: string | null;
};

export type CreateIntelligenceNarrativeClusterTimelineInput = Omit<
  IntelligenceNarrativeClusterTimelineRecord,
  'createdAt' | 'updatedAt'
> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type IntelligenceNarrativeClusterGraphSummary = {
  clusterId: string;
  eventCount: number;
  linkedClaimCount: number;
  edgeCount: number;
  graphSupportScore: number;
  graphContradictionScore: number;
  graphHotspotCount: number;
  hotspotClusterCount: number;
};

export type CreateIntelligenceTemporalNarrativeLedgerEntryInput = Omit<
  IntelligenceTemporalNarrativeLedgerEntryRecord,
  'id' | 'createdAt' | 'updatedAt'
> & {
  id?: string;
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
  kind: IntelligenceBridgeKind;
  status: IntelligenceBridgeStatus;
  targetId: string | null;
  requestJson: Record<string, unknown>;
  responseJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreateIntelligenceBridgeDispatchInput = {
  workspaceId: string;
  eventId: string;
  kind: IntelligenceBridgeKind;
  status?: IntelligenceBridgeStatus;
  targetId?: string | null;
  requestJson?: Record<string, unknown>;
  responseJson?: Record<string, unknown>;
};

export type UpdateIntelligenceEventReviewStateInput = {
  workspaceId: string;
  eventId: string;
  reviewState: EventReviewState;
  updatedBy: string;
  reviewReason?: string | null;
  reviewOwner?: string | null;
  reviewResolvedAt?: string | null;
};

export type UpdateIntelligenceLinkedClaimReviewStateInput = {
  workspaceId: string;
  linkedClaimId: string;
  reviewState: EventReviewState;
  updatedBy: string;
  reviewReason?: string | null;
  reviewOwner?: string | null;
  reviewResolvedAt?: string | null;
};

export type UpdateIntelligenceHypothesisLedgerReviewStateInput = {
  workspaceId: string;
  entryId: string;
  reviewState: EventReviewState;
  updatedBy: string;
  reviewReason?: string | null;
  reviewOwner?: string | null;
  reviewResolvedAt?: string | null;
};

export type UpdateIntelligenceNarrativeClusterReviewStateInput = {
  workspaceId: string;
  clusterId: string;
  reviewState: EventReviewState;
  updatedBy: string;
  reviewReason?: string | null;
  reviewOwner?: string | null;
  reviewResolvedAt?: string | null;
};

export type ModelRegistryEntryRecord = {
  id: string;
  provider: ProviderCredentialProvider;
  modelId: string;
  availability: 'active' | 'inactive';
  contextWindow: number | null;
  supportsStructuredOutput: boolean;
  supportsToolUse: boolean;
  supportsLongContext: boolean;
  supportsReasoning: boolean;
  costClass: IntelligenceCostClass;
  latencyClass: IntelligenceLatencyClass;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CapabilityAliasBindingRecord = {
  id: string;
  workspaceId: string | null;
  alias: IntelligenceCapabilityAlias;
  provider: ProviderCredentialProvider;
  modelId: string;
  weight: number;
  fallbackRank: number;
  canaryPercent: number;
  isActive: boolean;
  requiresStructuredOutput: boolean;
  requiresToolUse: boolean;
  requiresLongContext: boolean;
  maxCostClass: IntelligenceCostClass | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateCapabilityAliasBindingInput = {
  workspaceId?: string | null;
  alias: IntelligenceCapabilityAlias;
  provider: ProviderCredentialProvider;
  modelId: string;
  weight?: number;
  fallbackRank?: number;
  canaryPercent?: number;
  isActive?: boolean;
  requiresStructuredOutput?: boolean;
  requiresToolUse?: boolean;
  requiresLongContext?: boolean;
  maxCostClass?: IntelligenceCostClass | null;
  updatedBy?: string | null;
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
  upsertJarvisSessionStage: (input: UpsertJarvisSessionStageInput) => Promise<JarvisSessionStageRecord | null>;
  listJarvisSessionStages: (input: { userId: string; sessionId: string }) => Promise<JarvisSessionStageRecord[]>;
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
  upsertWorldModelEntity: (input: UpsertWorldModelEntityInput) => Promise<WorldModelEntityRecord>;
  listWorldModelEntities: (input: {
    userId: string;
    kind?: WorldModelEntityKind;
    limit: number;
  }) => Promise<WorldModelEntityRecord[]>;
  createWorldModelEvent: (input: CreateWorldModelEventInput) => Promise<WorldModelEventRecord>;
  listWorldModelEvents: (input: {
    userId: string;
    dossierId?: string;
    kind?: WorldModelEventKind;
    limit: number;
  }) => Promise<WorldModelEventRecord[]>;
  createWorldModelObservation: (input: CreateWorldModelObservationInput) => Promise<WorldModelObservationRecord>;
  listWorldModelObservations: (input: {
    userId: string;
    dossierId?: string;
    metricKey?: string;
    limit: number;
  }) => Promise<WorldModelObservationRecord[]>;
  createWorldModelConstraint: (input: CreateWorldModelConstraintInput) => Promise<WorldModelConstraintRecord>;
  listWorldModelConstraints: (input: {
    userId: string;
    dossierId?: string;
    kind?: WorldModelConstraintKind;
    limit: number;
  }) => Promise<WorldModelConstraintRecord[]>;
  updateWorldModelConstraint: (input: UpdateWorldModelConstraintInput) => Promise<WorldModelConstraintRecord | null>;
  createWorldModelHypothesis: (input: CreateWorldModelHypothesisInput) => Promise<WorldModelHypothesisRecord>;
  listWorldModelHypotheses: (input: {
    userId: string;
    hypothesisId?: string;
    projectionId?: string;
    dossierId?: string;
    briefingId?: string;
    status?: WorldModelHypothesisStatus;
    limit: number;
  }) => Promise<WorldModelHypothesisRecord[]>;
  updateWorldModelHypothesis: (input: UpdateWorldModelHypothesisInput) => Promise<WorldModelHypothesisRecord | null>;
  createWorldModelHypothesisEvidence: (
    input: CreateWorldModelHypothesisEvidenceInput
  ) => Promise<WorldModelHypothesisEvidenceRecord>;
  listWorldModelHypothesisEvidence: (input: {
    hypothesisId: string;
    limit: number;
  }) => Promise<WorldModelHypothesisEvidenceRecord[]>;
  createWorldModelInvalidationCondition: (
    input: CreateWorldModelInvalidationConditionInput
  ) => Promise<WorldModelInvalidationConditionRecord>;
  listWorldModelInvalidationConditions: (input: {
    hypothesisId: string;
    limit: number;
  }) => Promise<WorldModelInvalidationConditionRecord[]>;
  updateWorldModelInvalidationCondition: (
    input: UpdateWorldModelInvalidationConditionInput
  ) => Promise<WorldModelInvalidationConditionRecord | null>;
  createWorldModelStateSnapshot: (
    input: CreateWorldModelStateSnapshotInput
  ) => Promise<WorldModelStateSnapshotRecord>;
  listWorldModelStateSnapshots: (input: {
    userId: string;
    targetType?: WorldModelSnapshotTargetType;
    targetId?: string;
    limit: number;
  }) => Promise<WorldModelStateSnapshotRecord[]>;
  createWorldModelProjection: (input: CreateWorldModelProjectionInput) => Promise<WorldModelProjectionRecord>;
  listWorldModelProjections: (input: {
    userId?: string;
    projectionId?: string;
    dossierId?: string;
    briefingId?: string;
    watcherId?: string;
    sessionId?: string;
    status?: WorldModelProjectionStatus;
    limit: number;
  }) => Promise<WorldModelProjectionRecord[]>;
  updateWorldModelProjection: (input: UpdateWorldModelProjectionInput) => Promise<WorldModelProjectionRecord | null>;
  createWorldModelOutcome: (input: CreateWorldModelOutcomeInput) => Promise<WorldModelOutcomeRecord>;
  listWorldModelOutcomes: (input: {
    userId: string;
    hypothesisId?: string;
    limit: number;
  }) => Promise<WorldModelOutcomeRecord[]>;

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

  upsertRadarFeedSources: (input: {
    sources: Array<
      Omit<RadarFeedSourceRecord, 'createdAt' | 'updatedAt' | 'lastFetchedAt' | 'lastSuccessAt' | 'lastError'> &
        Partial<Pick<RadarFeedSourceRecord, 'lastFetchedAt' | 'lastSuccessAt' | 'lastError'>>
    >;
  }) => Promise<RadarFeedSourceRecord[]>;
  listRadarFeedSources: (input?: { enabled?: boolean; limit?: number }) => Promise<RadarFeedSourceRecord[]>;
  toggleRadarFeedSource: (input: ToggleRadarFeedSourceInput) => Promise<RadarFeedSourceRecord | null>;
  listRadarFeedCursors: (input?: { sourceId?: string }) => Promise<RadarFeedCursorRecord[]>;
  upsertRadarFeedCursor: (input: {
    sourceId: string;
    cursor?: string | null;
    etag?: string | null;
    lastModified?: string | null;
    lastSeenPublishedAt?: string | null;
    lastFetchedAt?: string | null;
  }) => Promise<RadarFeedCursorRecord>;
  createRadarIngestRun: (input: {
    sourceId?: string | null;
    startedAt?: string;
    status?: RadarIngestRunStatus;
    fetchedCount?: number;
    ingestedCount?: number;
    evaluatedCount?: number;
    promotedCount?: number;
    autoExecutedCount?: number;
    failedCount?: number;
    error?: string | null;
    detailJson?: Record<string, unknown>;
  }) => Promise<RadarIngestRunRecord>;
  completeRadarIngestRun: (input: {
    runId: string;
    finishedAt?: string;
    status: RadarIngestRunStatus;
    fetchedCount?: number;
    ingestedCount?: number;
    evaluatedCount?: number;
    promotedCount?: number;
    autoExecutedCount?: number;
    failedCount?: number;
    error?: string | null;
    detailJson?: Record<string, unknown>;
  }) => Promise<RadarIngestRunRecord | null>;
  listRadarIngestRuns: (input?: { sourceId?: string; limit?: number }) => Promise<RadarIngestRunRecord[]>;
  ingestRadarItems: (items: RadarItemRecord[]) => Promise<RadarItemRecord[]>;
  listRadarItems: (input: { status?: RadarItemStatus; limit: number }) => Promise<RadarItemRecord[]>;
  evaluateRadar: (input: EvaluateRadarInput) => Promise<RadarRecommendationRecord[]>;
  listRadarRecommendations: (decision?: 'adopt' | 'hold' | 'discard') => Promise<RadarRecommendationRecord[]>;
  listRadarEvents: (input: { decision?: RadarPromotionDecision; limit: number }) => Promise<RadarEventRecord[]>;
  getRadarEventById: (eventId: string) => Promise<RadarEventRecord | null>;
  listRadarDomainPosteriors: (eventId: string) => Promise<RadarDomainPosteriorRecord[]>;
  getRadarAutonomyDecision: (eventId: string) => Promise<RadarAutonomyDecisionRecord | null>;
  getRadarControlSettings: () => Promise<RadarControlSettingsRecord>;
  updateRadarControlSettings: (input: UpdateRadarControlSettingsInput) => Promise<RadarControlSettingsRecord>;
  listRadarDomainPackMetrics: () => Promise<RadarDomainPackMetricRecord[]>;
  recordRadarDomainPackOutcome: (input: {
    domainId: RadarDomainId;
    result: WorldModelOutcomeResult;
    evaluatedAt?: string | null;
    eventId?: string | null;
  }) => Promise<RadarDomainPackMetricRecord>;
  createRadarOperatorFeedback: (input: {
    eventId: string;
    userId: string;
    kind: 'ack' | 'override';
    note?: string | null;
    overrideDecision?: RadarPromotionDecision | null;
  }) => Promise<RadarOperatorFeedbackRecord>;
  listRadarOperatorFeedback: (input: { eventId?: string; limit: number }) => Promise<RadarOperatorFeedbackRecord[]>;

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
  createMemoryNote: (input: CreateMemoryNoteInput) => Promise<MemoryNoteRecord>;
  listMemoryNotes: (input: {
    userId: string;
    kind?: MemoryNoteKind;
    pinned?: boolean;
    limit: number;
  }) => Promise<MemoryNoteRecord[]>;
  updateMemoryNote: (input: UpdateMemoryNoteInput) => Promise<MemoryNoteRecord | null>;
  deleteMemoryNote: (input: { noteId: string; userId: string }) => Promise<boolean>;

  getOrCreateIntelligenceWorkspace: (input: { userId: string; name?: string }) => Promise<IntelligenceWorkspaceRecord>;
  createIntelligenceWorkspace: (input: { userId: string; name: string }) => Promise<IntelligenceWorkspaceRecord>;
  listIntelligenceWorkspaces: (input: { userId: string }) => Promise<IntelligenceWorkspaceRecord[]>;
  getIntelligenceWorkspaceMembership: (input: {
    workspaceId: string;
    userId: string;
  }) => Promise<IntelligenceWorkspaceMemberRecord | null>;
  createIntelligenceSource: (input: CreateIntelligenceSourceInput) => Promise<IntelligenceSourceRecord>;
  updateIntelligenceSource: (input: UpdateIntelligenceSourceInput) => Promise<IntelligenceSourceRecord | null>;
  listAllIntelligenceSources: (input: {
    enabled?: boolean;
    limit: number;
  }) => Promise<IntelligenceSourceRecord[]>;
  listIntelligenceSources: (input: {
    workspaceId: string;
    enabled?: boolean;
    limit: number;
  }) => Promise<IntelligenceSourceRecord[]>;
  toggleIntelligenceSource: (input: {
    workspaceId: string;
    sourceId: string;
    enabled: boolean;
  }) => Promise<IntelligenceSourceRecord | null>;
  listIntelligenceSourceCursors: (input: {
    workspaceId: string;
    sourceId?: string;
  }) => Promise<IntelligenceSourceCursorRecord[]>;
  upsertIntelligenceSourceCursor: (input: UpsertIntelligenceSourceCursorInput) => Promise<IntelligenceSourceCursorRecord>;
  createIntelligenceScanRun: (input: CreateIntelligenceScanRunInput) => Promise<IntelligenceScanRunRecord>;
  completeIntelligenceScanRun: (input: CompleteIntelligenceScanRunInput) => Promise<IntelligenceScanRunRecord | null>;
  listIntelligenceScanRuns: (input: {
    workspaceId: string;
    sourceId?: string;
    limit: number;
  }) => Promise<IntelligenceScanRunRecord[]>;
  createIntelligenceFetchFailure: (input: {
    workspaceId: string;
    sourceId?: string | null;
    url: string;
    reason: string;
    statusCode?: number | null;
    retryable?: boolean;
    blockedByRobots?: boolean;
  }) => Promise<IntelligenceFetchFailureRecord>;
  listIntelligenceFetchFailures: (input: {
    workspaceId: string;
    sourceId?: string;
    limit: number;
  }) => Promise<IntelligenceFetchFailureRecord[]>;
  findIntelligenceRawDocumentByFingerprint: (input: {
    workspaceId: string;
    documentFingerprint: string;
  }) => Promise<RawDocumentRecord | null>;
  findIntelligenceRawDocumentByIdentityKey: (input: {
    workspaceId: string;
    documentIdentityKey: string;
  }) => Promise<RawDocumentRecord | null>;
  createIntelligenceRawDocument: (input: CreateRawDocumentInput) => Promise<RawDocumentRecord>;
  updateIntelligenceRawDocumentObservation: (input: {
    workspaceId: string;
    documentId: string;
    observedAt?: string | null;
    publishedAt?: string | null;
    metadataJson?: Record<string, unknown>;
  }) => Promise<RawDocumentRecord | null>;
  listIntelligenceRawDocuments: (input: {
    workspaceId: string;
    limit: number;
  }) => Promise<RawDocumentRecord[]>;
  listIntelligenceRawDocumentsByIds: (input: {
    workspaceId: string;
    documentIds: string[];
  }) => Promise<RawDocumentRecord[]>;
  createIntelligenceSignal: (input: CreateSignalEnvelopeInput) => Promise<SignalEnvelopeRecord>;
  listIntelligenceSignals: (input: {
    workspaceId: string;
    sourceId?: string;
    processingStatus?: IntelligenceSignalProcessingStatus;
    limit: number;
  }) => Promise<SignalEnvelopeRecord[]>;
  listIntelligenceSignalsByIds: (input: {
    workspaceId: string;
    signalIds: string[];
  }) => Promise<SignalEnvelopeRecord[]>;
  updateIntelligenceSignalProcessing: (input: UpdateIntelligenceSignalProcessingInput) => Promise<SignalEnvelopeRecord | null>;
  createIntelligenceLinkedClaim: (input: CreateLinkedClaimInput) => Promise<LinkedClaimRecord>;
  listIntelligenceLinkedClaims: (input: {
    workspaceId: string;
    eventId?: string;
    limit: number;
  }) => Promise<LinkedClaimRecord[]>;
  deleteIntelligenceLinkedClaimsByIds: (input: {
    workspaceId: string;
    linkedClaimIds: string[];
  }) => Promise<number>;
  updateIntelligenceLinkedClaimReviewState: (
    input: UpdateIntelligenceLinkedClaimReviewStateInput
  ) => Promise<LinkedClaimRecord | null>;
  createIntelligenceClaimLink: (input: CreateClaimLinkInput) => Promise<ClaimLinkRecord>;
  listIntelligenceClaimLinks: (input: {
    workspaceId: string;
    eventId?: string;
    linkedClaimId?: string;
    limit: number;
  }) => Promise<ClaimLinkRecord[]>;
  createIntelligenceLinkedClaimEdge: (input: CreateLinkedClaimEdgeInput) => Promise<LinkedClaimEdgeRecord>;
  listIntelligenceLinkedClaimEdges: (input: {
    workspaceId: string;
    eventId?: string;
    linkedClaimId?: string;
    limit: number;
  }) => Promise<LinkedClaimEdgeRecord[]>;
  replaceIntelligenceEventMemberships: (input: {
    workspaceId: string;
    eventId: string;
    memberships: CreateEventMembershipInput[];
  }) => Promise<EventMembershipRecord[]>;
  listIntelligenceEventMemberships: (input: {
    workspaceId: string;
    eventId: string;
  }) => Promise<EventMembershipRecord[]>;
  upsertIntelligenceEvent: (input: UpsertIntelligenceEventInput) => Promise<IntelligenceEventClusterRecord>;
  listIntelligenceEvents: (input: {
    workspaceId: string;
    limit: number;
    domainId?: IntelligenceDomainId;
  }) => Promise<IntelligenceEventClusterRecord[]>;
  getIntelligenceEventById: (input: {
    workspaceId: string;
    eventId: string;
  }) => Promise<IntelligenceEventClusterRecord | null>;
  deleteIntelligenceEventById: (input: {
    workspaceId: string;
    eventId: string;
  }) => Promise<boolean>;
  resetIntelligenceDerivedWorkspaceState: (input: {
    workspaceId: string;
  }) => Promise<ResetIntelligenceDerivedWorkspaceStateResult>;
  updateIntelligenceEventReviewState: (input: UpdateIntelligenceEventReviewStateInput) => Promise<IntelligenceEventClusterRecord | null>;
  createIntelligenceOperatorNote: (input: CreateOperatorNoteInput) => Promise<OperatorNoteRecord>;
  listIntelligenceOperatorNotes: (input: {
    workspaceId: string;
    eventId?: string;
    scope?: OperatorNoteRecord['scope'];
    limit: number;
  }) => Promise<OperatorNoteRecord[]>;
  createIntelligenceHypothesisLedgerEntry: (input: CreateHypothesisLedgerEntryInput) => Promise<HypothesisLedgerEntry>;
  listIntelligenceHypothesisLedgerEntries: (input: {
    workspaceId: string;
    eventId: string;
  }) => Promise<HypothesisLedgerEntry[]>;
  updateIntelligenceHypothesisLedgerReviewState: (
    input: UpdateIntelligenceHypothesisLedgerReviewStateInput
  ) => Promise<HypothesisLedgerEntry | null>;
  createIntelligenceHypothesisEvidenceLink: (input: CreateHypothesisEvidenceLinkInput) => Promise<HypothesisEvidenceLink>;
  listIntelligenceHypothesisEvidenceLinks: (input: {
    workspaceId: string;
    eventId: string;
  }) => Promise<HypothesisEvidenceLink[]>;
  replaceIntelligenceInvalidationEntries: (input: {
    workspaceId: string;
    eventId: string;
    entries: CreateIntelligenceInvalidationEntryInput[];
  }) => Promise<IntelligenceInvalidationEntryRecord[]>;
  listIntelligenceInvalidationEntries: (input: {
    workspaceId: string;
    eventId: string;
  }) => Promise<IntelligenceInvalidationEntryRecord[]>;
  replaceIntelligenceExpectedSignalEntries: (input: {
    workspaceId: string;
    eventId: string;
    entries: CreateIntelligenceExpectedSignalEntryInput[];
  }) => Promise<IntelligenceExpectedSignalEntryRecord[]>;
  listIntelligenceExpectedSignalEntries: (input: {
    workspaceId: string;
    eventId: string;
  }) => Promise<IntelligenceExpectedSignalEntryRecord[]>;
  createIntelligenceOutcomeEntry: (input: CreateIntelligenceOutcomeEntryInput) => Promise<IntelligenceOutcomeEntryRecord>;
  listIntelligenceOutcomeEntries: (input: {
    workspaceId: string;
    eventId: string;
  }) => Promise<IntelligenceOutcomeEntryRecord[]>;
  upsertIntelligenceNarrativeCluster: (
    input: CreateIntelligenceNarrativeClusterInput
  ) => Promise<IntelligenceNarrativeClusterRecord>;
  listIntelligenceNarrativeClusters: (input: {
    workspaceId: string;
    limit: number;
  }) => Promise<IntelligenceNarrativeClusterRecord[]>;
  getIntelligenceNarrativeClusterById: (input: {
    workspaceId: string;
    clusterId: string;
  }) => Promise<IntelligenceNarrativeClusterRecord | null>;
  deleteIntelligenceNarrativeCluster: (input: {
    workspaceId: string;
    clusterId: string;
  }) => Promise<boolean>;
  updateIntelligenceNarrativeClusterReviewState: (
    input: UpdateIntelligenceNarrativeClusterReviewStateInput
  ) => Promise<IntelligenceNarrativeClusterRecord | null>;
  upsertIntelligenceNarrativeClusterMembership: (
    input: CreateIntelligenceNarrativeClusterMembershipInput
  ) => Promise<IntelligenceNarrativeClusterMembershipRecord>;
  listIntelligenceNarrativeClusterMemberships: (input: {
    workspaceId: string;
    clusterId?: string;
    eventId?: string;
    limit: number;
  }) => Promise<IntelligenceNarrativeClusterMembershipRecord[]>;
  replaceIntelligenceTemporalNarrativeLedgerEntries: (input: {
    workspaceId: string;
    eventId: string;
    entries: CreateIntelligenceTemporalNarrativeLedgerEntryInput[];
  }) => Promise<IntelligenceTemporalNarrativeLedgerEntryRecord[]>;
  listIntelligenceTemporalNarrativeLedgerEntries: (input: {
    workspaceId: string;
    eventId: string;
  }) => Promise<IntelligenceTemporalNarrativeLedgerEntryRecord[]>;
  createIntelligenceNarrativeClusterLedgerEntry: (
    input: CreateIntelligenceNarrativeClusterLedgerEntryInput
  ) => Promise<IntelligenceNarrativeClusterLedgerEntryRecord>;
  listIntelligenceNarrativeClusterLedgerEntries: (input: {
    workspaceId: string;
    clusterId: string;
    limit?: number;
  }) => Promise<IntelligenceNarrativeClusterLedgerEntryRecord[]>;
  replaceIntelligenceNarrativeClusterTimelineEntries: (input: {
    workspaceId: string;
    clusterId: string;
    entries: CreateIntelligenceNarrativeClusterTimelineInput[];
  }) => Promise<IntelligenceNarrativeClusterTimelineRecord[]>;
  listIntelligenceNarrativeClusterTimelineEntries: (input: {
    workspaceId: string;
    clusterId: string;
  }) => Promise<IntelligenceNarrativeClusterTimelineRecord[]>;
  createIntelligenceExecutionAudit: (input: CreateExecutionAuditInput) => Promise<ExecutionAuditRecord>;
  listIntelligenceExecutionAudits: (input: {
    workspaceId: string;
    eventId?: string;
    limit: number;
  }) => Promise<ExecutionAuditRecord[]>;
  createIntelligenceBridgeDispatch: (input: CreateIntelligenceBridgeDispatchInput) => Promise<IntelligenceBridgeDispatchRecord>;
  listIntelligenceBridgeDispatches: (input: {
    workspaceId: string;
    eventId?: string;
    limit: number;
  }) => Promise<IntelligenceBridgeDispatchRecord[]>;
  upsertIntelligenceModelRegistryEntries: (input: {
    entries: Array<Omit<ModelRegistryEntryRecord, 'id' | 'createdAt' | 'updatedAt'>>;
  }) => Promise<ModelRegistryEntryRecord[]>;
  listIntelligenceModelRegistryEntries: (input?: {
    provider?: ProviderCredentialProvider;
  }) => Promise<ModelRegistryEntryRecord[]>;
  replaceIntelligenceProviderHealth: (input: {
    entries: ProviderHealthRecord[];
  }) => Promise<ProviderHealthRecord[]>;
  listIntelligenceProviderHealth: () => Promise<ProviderHealthRecord[]>;
  replaceIntelligenceAliasBindings: (input: {
    workspaceId?: string | null;
    alias: IntelligenceCapabilityAlias;
    bindings: CreateCapabilityAliasBindingInput[];
    updatedBy?: string | null;
  }) => Promise<CapabilityAliasBindingRecord[]>;
  listIntelligenceAliasBindings: (input?: {
    workspaceId?: string | null;
    alias?: IntelligenceCapabilityAlias;
  }) => Promise<CapabilityAliasBindingRecord[]>;
  createIntelligenceAliasRollout: (input: {
    workspaceId?: string | null;
    alias: IntelligenceCapabilityAlias;
    bindingIds: string[];
    createdBy?: string | null;
    note?: string | null;
  }) => Promise<AliasRolloutRecord>;
  listIntelligenceAliasRollouts: (input?: {
    workspaceId?: string | null;
    alias?: IntelligenceCapabilityAlias;
    limit?: number;
  }) => Promise<AliasRolloutRecord[]>;

  createApproval: (input: CreateApprovalInput) => Promise<ApprovalRecord>;
  listApprovals: (input: { status?: ApprovalStatus; limit: number }) => Promise<ApprovalRecord[]>;
  decideApproval: (input: { approvalId: string; decidedBy: string; decision: 'approved' | 'rejected'; reason?: string }) => Promise<ApprovalRecord | null>;

  createUpgradeExecutorGateway: () => UpgradeExecutorGateway;
};
