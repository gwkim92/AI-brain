import type {
  ApprovalRecord,
  AssistantContextEventRecord,
  AssistantContextGroundingClaimRecord,
  AssistantContextGroundingSourceRecord,
  AssistantContextRecord,
  AuthUserWithPasswordRecord,
  CouncilRunRecord,
  ExecutionRunRecord,
  MemorySegmentRecord,
  MissionRecord,
  RadarItemRecord,
  RadarRecommendationRecord,
  TaskEventRecord,
  TaskRecord,
  TelegramReportRecord,
  UpgradeProposalRecord,
  UpgradeRunApiRecord
} from '../types';

export type MemorySessionRow = {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type MemoryProviderCredentialRow = {
  encryptedApiKey: string;
  updatedBy: string | null;
  updatedAt: string;
};

export type MemoryStoreState = {
  users: Map<string, AuthUserWithPasswordRecord>;
  userIdByEmail: Map<string, string>;
  sessions: Map<string, MemorySessionRow>;
  providerCredentials: Map<string, MemoryProviderCredentialRow>;
  missions: Map<string, MissionRecord>;
  assistantContexts: Map<string, AssistantContextRecord>;
  assistantContextByClientId: Map<string, string>;
  assistantContextEvents: Map<string, AssistantContextEventRecord[]>;
  assistantContextGroundingSources: Map<string, AssistantContextGroundingSourceRecord[]>;
  assistantContextGroundingClaims: Map<string, AssistantContextGroundingClaimRecord[]>;
  assistantContextEventSequence: number;
  tasks: Map<string, TaskRecord>;
  taskEvents: Map<string, TaskEventRecord[]>;
  radarItems: Map<string, RadarItemRecord>;
  radarRecommendations: Map<string, RadarRecommendationRecord>;
  telegramReports: Map<string, TelegramReportRecord>;
  upgradeProposals: Map<string, UpgradeProposalRecord>;
  upgradeRuns: Map<string, UpgradeRunApiRecord>;
  councilRuns: Map<string, CouncilRunRecord>;
  executionRuns: Map<string, ExecutionRunRecord>;
  councilRunByIdempotency: Map<string, string>;
  executionRunByIdempotency: Map<string, string>;
  memorySegments: Map<string, MemorySegmentRecord>;
  approvals: Map<string, ApprovalRecord>;
};

export function createMemoryStoreState(): MemoryStoreState {
  return {
    users: new Map<string, AuthUserWithPasswordRecord>(),
    userIdByEmail: new Map<string, string>(),
    sessions: new Map<string, MemorySessionRow>(),
    providerCredentials: new Map<string, MemoryProviderCredentialRow>(),
    missions: new Map<string, MissionRecord>(),
    assistantContexts: new Map<string, AssistantContextRecord>(),
    assistantContextByClientId: new Map<string, string>(),
    assistantContextEvents: new Map<string, AssistantContextEventRecord[]>(),
    assistantContextGroundingSources: new Map<string, AssistantContextGroundingSourceRecord[]>(),
    assistantContextGroundingClaims: new Map<string, AssistantContextGroundingClaimRecord[]>(),
    assistantContextEventSequence: 0,
    tasks: new Map<string, TaskRecord>(),
    taskEvents: new Map<string, TaskEventRecord[]>(),
    radarItems: new Map<string, RadarItemRecord>(),
    radarRecommendations: new Map<string, RadarRecommendationRecord>(),
    telegramReports: new Map<string, TelegramReportRecord>(),
    upgradeProposals: new Map<string, UpgradeProposalRecord>(),
    upgradeRuns: new Map<string, UpgradeRunApiRecord>(),
    councilRuns: new Map<string, CouncilRunRecord>(),
    executionRuns: new Map<string, ExecutionRunRecord>(),
    councilRunByIdempotency: new Map<string, string>(),
    executionRunByIdempotency: new Map<string, string>(),
    memorySegments: new Map<string, MemorySegmentRecord>(),
    approvals: new Map<string, ApprovalRecord>()
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
