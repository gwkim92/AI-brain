import type {
  ActionProposalRecord,
  AiInvocationTraceRecord,
  ApprovalRecord,
  AssistantContextEventRecord,
  AssistantContextGroundingClaimRecord,
  AssistantContextGroundingSourceRecord,
  AssistantContextRecord,
  AuthUserWithPasswordRecord,
  BriefingRecord,
  CouncilRunRecord,
  DossierClaimRecord,
  DossierRecord,
  DossierSourceRecord,
  ExecutionRunRecord,
  JarvisSessionEventRecord,
  JarvisSessionRecord,
  JarvisSessionStageRecord,
  ModelRecommendationRunRecord,
  MemorySegmentRecord,
  MemoryNoteRecord,
  IntelligenceBridgeDispatchRecord,
  LinkedClaimRecord,
  ClaimLinkRecord,
  EventMembershipRecord,
  HypothesisLedgerEntry,
  HypothesisEvidenceLink,
  IntelligenceInvalidationEntryRecord,
  IntelligenceExpectedSignalEntryRecord,
  IntelligenceOutcomeEntryRecord,
  IntelligenceNarrativeClusterMembershipRecord,
  IntelligenceNarrativeClusterRecord,
  IntelligenceTemporalNarrativeLedgerEntryRecord,
  LinkedClaimEdgeRecord,
  OperatorNoteRecord,
  ExecutionAuditRecord,
  IntelligenceEventClusterRecord,
  IntelligenceScanRunRecord,
  IntelligenceSourceCursorRecord,
  IntelligenceSourceRecord,
  IntelligenceWorkspaceMemberRecord,
  IntelligenceWorkspaceRecord,
  ModelRegistryEntryRecord,
  CapabilityAliasBindingRecord,
  AliasRolloutRecord,
  ProviderHealthRecord,
  IntelligenceFetchFailureRecord,
  RawDocumentRecord,
  SignalEnvelopeRecord,
  UserModelSelectionPreferenceRecord,
  MissionRecord,
  RadarAutonomyDecisionRecord,
  RadarControlSettingsRecord,
  RadarDomainPackMetricRecord,
  RadarDomainPosteriorRecord,
  RadarEventRecord,
  RadarFeedCursorRecord,
  RadarFeedSourceRecord,
  RadarIngestRunRecord,
  RadarItemRecord,
  RadarOperatorFeedbackRecord,
  RadarRecommendationRecord,
  TaskEventRecord,
  TaskRecord,
  TelegramReportRecord,
  UpgradeProposalRecord,
  WatcherRecord,
  WatcherRunRecord,
  UpgradeRunApiRecord,
  WorldModelConstraintRecord,
  WorldModelEntityRecord,
  WorldModelEventRecord,
  WorldModelHypothesisEvidenceRecord,
  WorldModelHypothesisRecord,
  WorldModelInvalidationConditionRecord,
  WorldModelObservationRecord,
  WorldModelOutcomeRecord,
  WorldModelProjectionRecord,
  WorldModelStateSnapshotRecord
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

export type MemoryUserProviderCredentialRow = {
  encryptedPayload: string;
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

export type MemoryProviderOauthStateRow = {
  state: string;
  userId: string;
  provider: 'openai' | 'gemini' | 'anthropic' | 'local';
  encryptedContext: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type MemoryUserModelSelectionPreferenceRow = UserModelSelectionPreferenceRecord;
export type MemoryModelRecommendationRunRow = ModelRecommendationRunRecord;
export type MemoryAiInvocationTraceRow = AiInvocationTraceRecord;
export type MemoryJarvisSessionRow = JarvisSessionRecord;
export type MemoryJarvisSessionEventRow = JarvisSessionEventRecord;
export type MemoryJarvisSessionStageRow = JarvisSessionStageRecord;
export type MemoryActionProposalRow = ActionProposalRecord;
export type MemoryWatcherRow = WatcherRecord;
export type MemoryWatcherRunRow = WatcherRunRecord;
export type MemoryBriefingRow = BriefingRecord;
export type MemoryDossierRow = DossierRecord;
export type MemoryDossierSourceRow = DossierSourceRecord;
export type MemoryDossierClaimRow = DossierClaimRecord;
export type MemoryNoteRow = MemoryNoteRecord;
export type MemoryWorldModelEntityRow = WorldModelEntityRecord;
export type MemoryWorldModelEventRow = WorldModelEventRecord;
export type MemoryWorldModelObservationRow = WorldModelObservationRecord;
export type MemoryWorldModelConstraintRow = WorldModelConstraintRecord;
export type MemoryWorldModelHypothesisRow = WorldModelHypothesisRecord;
export type MemoryWorldModelHypothesisEvidenceRow = WorldModelHypothesisEvidenceRecord;
export type MemoryWorldModelInvalidationConditionRow = WorldModelInvalidationConditionRecord;
export type MemoryWorldModelStateSnapshotRow = WorldModelStateSnapshotRecord;
export type MemoryWorldModelProjectionRow = WorldModelProjectionRecord;
export type MemoryWorldModelOutcomeRow = WorldModelOutcomeRecord;
export type MemoryRadarEventRow = RadarEventRecord;
export type MemoryRadarFeedSourceRow = RadarFeedSourceRecord;
export type MemoryRadarFeedCursorRow = RadarFeedCursorRecord;
export type MemoryRadarIngestRunRow = RadarIngestRunRecord;
export type MemoryRadarDomainPosteriorRow = RadarDomainPosteriorRecord;
export type MemoryRadarAutonomyDecisionRow = RadarAutonomyDecisionRecord;
export type MemoryRadarOperatorFeedbackRow = RadarOperatorFeedbackRecord;
export type MemoryRadarDomainPackMetricRow = RadarDomainPackMetricRecord;
export type MemoryRadarControlSettingsRow = RadarControlSettingsRecord;
export type MemoryIntelligenceWorkspaceRow = IntelligenceWorkspaceRecord;
export type MemoryIntelligenceWorkspaceMemberRow = IntelligenceWorkspaceMemberRecord;
export type MemoryIntelligenceSourceRow = IntelligenceSourceRecord;
export type MemoryIntelligenceSourceCursorRow = IntelligenceSourceCursorRecord;
export type MemoryIntelligenceScanRunRow = IntelligenceScanRunRecord;
export type MemoryRawDocumentRow = RawDocumentRecord;
export type MemorySignalEnvelopeRow = SignalEnvelopeRecord;
export type MemoryLinkedClaimRow = LinkedClaimRecord;
export type MemoryClaimLinkRow = ClaimLinkRecord;
export type MemoryLinkedClaimEdgeRow = LinkedClaimEdgeRecord;
export type MemoryEventMembershipRow = EventMembershipRecord;
export type MemoryHypothesisLedgerRow = HypothesisLedgerEntry;
export type MemoryHypothesisEvidenceLinkRow = HypothesisEvidenceLink;
export type MemoryInvalidationEntryRow = IntelligenceInvalidationEntryRecord;
export type MemoryExpectedSignalEntryRow = IntelligenceExpectedSignalEntryRecord;
export type MemoryOutcomeEntryRow = IntelligenceOutcomeEntryRecord;
export type MemoryNarrativeClusterRow = IntelligenceNarrativeClusterRecord;
export type MemoryNarrativeClusterMembershipRow = IntelligenceNarrativeClusterMembershipRecord;
export type MemoryTemporalNarrativeLedgerEntryRow = IntelligenceTemporalNarrativeLedgerEntryRecord;
export type MemoryExecutionAuditRow = ExecutionAuditRecord;
export type MemoryOperatorNoteRow = OperatorNoteRecord;
export type MemoryIntelligenceEventRow = IntelligenceEventClusterRecord;
export type MemoryIntelligenceBridgeDispatchRow = IntelligenceBridgeDispatchRecord;
export type MemoryIntelligenceModelRegistryRow = ModelRegistryEntryRecord;
export type MemoryIntelligenceAliasBindingRow = CapabilityAliasBindingRecord;
export type MemoryIntelligenceFetchFailureRow = IntelligenceFetchFailureRecord;
export type MemoryIntelligenceProviderHealthRow = ProviderHealthRecord;
export type MemoryIntelligenceAliasRolloutRow = AliasRolloutRecord;

export type MemoryStoreState = {
  users: Map<string, AuthUserWithPasswordRecord>;
  userIdByEmail: Map<string, string>;
  sessions: Map<string, MemorySessionRow>;
  providerCredentials: Map<string, MemoryProviderCredentialRow>;
  userProviderCredentials: Map<string, MemoryUserProviderCredentialRow>;
  providerOauthStates: Map<string, MemoryProviderOauthStateRow>;
  userModelSelectionPreferences: Map<string, MemoryUserModelSelectionPreferenceRow>;
  modelRecommendationRuns: Map<string, MemoryModelRecommendationRunRow>;
  aiInvocationTraces: Map<string, MemoryAiInvocationTraceRow>;
  jarvisSessions: Map<string, MemoryJarvisSessionRow>;
  jarvisSessionEvents: Map<string, MemoryJarvisSessionEventRow[]>;
  jarvisSessionStages: Map<string, MemoryJarvisSessionStageRow[]>;
  jarvisSessionEventSequence: number;
  actionProposals: Map<string, MemoryActionProposalRow>;
  watchers: Map<string, MemoryWatcherRow>;
  watcherRuns: Map<string, MemoryWatcherRunRow>;
  briefings: Map<string, MemoryBriefingRow>;
  dossiers: Map<string, MemoryDossierRow>;
  dossierSources: Map<string, MemoryDossierSourceRow[]>;
  dossierClaims: Map<string, MemoryDossierClaimRow[]>;
  worldModelEntities: Map<string, MemoryWorldModelEntityRow>;
  worldModelEvents: Map<string, MemoryWorldModelEventRow>;
  worldModelObservations: Map<string, MemoryWorldModelObservationRow>;
  worldModelConstraints: Map<string, MemoryWorldModelConstraintRow>;
  worldModelHypotheses: Map<string, MemoryWorldModelHypothesisRow>;
  worldModelHypothesisEvidence: Map<string, MemoryWorldModelHypothesisEvidenceRow>;
  worldModelInvalidationConditions: Map<string, MemoryWorldModelInvalidationConditionRow>;
  worldModelStateSnapshots: Map<string, MemoryWorldModelStateSnapshotRow>;
  worldModelProjections: Map<string, MemoryWorldModelProjectionRow>;
  worldModelOutcomes: Map<string, MemoryWorldModelOutcomeRow>;
  missions: Map<string, MissionRecord>;
  assistantContexts: Map<string, AssistantContextRecord>;
  assistantContextByClientId: Map<string, string>;
  assistantContextEvents: Map<string, AssistantContextEventRecord[]>;
  assistantContextGroundingSources: Map<string, AssistantContextGroundingSourceRecord[]>;
  assistantContextGroundingClaims: Map<string, AssistantContextGroundingClaimRecord[]>;
  assistantContextEventSequence: number;
  tasks: Map<string, TaskRecord>;
  taskEvents: Map<string, TaskEventRecord[]>;
  radarFeedSources: Map<string, MemoryRadarFeedSourceRow>;
  radarFeedCursors: Map<string, MemoryRadarFeedCursorRow>;
  radarIngestRuns: Map<string, MemoryRadarIngestRunRow>;
  radarItems: Map<string, RadarItemRecord>;
  radarEvents: Map<string, MemoryRadarEventRow>;
  radarDomainPosteriors: Map<string, MemoryRadarDomainPosteriorRow>;
  radarAutonomyDecisions: Map<string, MemoryRadarAutonomyDecisionRow>;
  radarOperatorFeedback: Map<string, MemoryRadarOperatorFeedbackRow>;
  radarDomainPackMetrics: Map<string, MemoryRadarDomainPackMetricRow>;
  radarControlSettings: MemoryRadarControlSettingsRow | null;
  radarRecommendations: Map<string, RadarRecommendationRecord>;
  intelligenceWorkspaces: Map<string, MemoryIntelligenceWorkspaceRow>;
  intelligenceWorkspaceMembers: Map<string, MemoryIntelligenceWorkspaceMemberRow>;
  intelligenceSources: Map<string, MemoryIntelligenceSourceRow>;
  intelligenceSourceCursors: Map<string, MemoryIntelligenceSourceCursorRow>;
  intelligenceScanRuns: Map<string, MemoryIntelligenceScanRunRow>;
  intelligenceRawDocuments: Map<string, MemoryRawDocumentRow>;
  intelligenceSignals: Map<string, MemorySignalEnvelopeRow>;
  intelligenceLinkedClaims: Map<string, MemoryLinkedClaimRow>;
  intelligenceClaimLinks: Map<string, MemoryClaimLinkRow>;
  intelligenceLinkedClaimEdges: Map<string, MemoryLinkedClaimEdgeRow>;
  intelligenceEventMemberships: Map<string, MemoryEventMembershipRow>;
  intelligenceHypothesisLedger: Map<string, MemoryHypothesisLedgerRow>;
  intelligenceHypothesisEvidenceLinks: Map<string, MemoryHypothesisEvidenceLinkRow>;
  intelligenceInvalidationEntries: Map<string, MemoryInvalidationEntryRow>;
  intelligenceExpectedSignalEntries: Map<string, MemoryExpectedSignalEntryRow>;
  intelligenceOutcomeEntries: Map<string, MemoryOutcomeEntryRow>;
  intelligenceNarrativeClusters: Map<string, MemoryNarrativeClusterRow>;
  intelligenceNarrativeClusterMemberships: Map<string, MemoryNarrativeClusterMembershipRow>;
  intelligenceTemporalNarrativeLedger: Map<string, MemoryTemporalNarrativeLedgerEntryRow>;
  intelligenceExecutionAudits: Map<string, MemoryExecutionAuditRow>;
  intelligenceOperatorNotes: Map<string, MemoryOperatorNoteRow>;
  intelligenceEvents: Map<string, MemoryIntelligenceEventRow>;
  intelligenceBridgeDispatches: Map<string, MemoryIntelligenceBridgeDispatchRow>;
  intelligenceModelRegistry: Map<string, MemoryIntelligenceModelRegistryRow>;
  intelligenceAliasBindings: Map<string, MemoryIntelligenceAliasBindingRow>;
  intelligenceFetchFailures: Map<string, MemoryIntelligenceFetchFailureRow>;
  intelligenceProviderHealth: Map<string, MemoryIntelligenceProviderHealthRow>;
  intelligenceAliasRollouts: Map<string, MemoryIntelligenceAliasRolloutRow>;
  telegramReports: Map<string, TelegramReportRecord>;
  upgradeProposals: Map<string, UpgradeProposalRecord>;
  upgradeRuns: Map<string, UpgradeRunApiRecord>;
  councilRuns: Map<string, CouncilRunRecord>;
  executionRuns: Map<string, ExecutionRunRecord>;
  councilRunByIdempotency: Map<string, string>;
  executionRunByIdempotency: Map<string, string>;
  memorySegments: Map<string, MemorySegmentRecord>;
  memoryNotes: Map<string, MemoryNoteRow>;
  approvals: Map<string, ApprovalRecord>;
};

export function createMemoryStoreState(): MemoryStoreState {
  return {
    users: new Map<string, AuthUserWithPasswordRecord>(),
    userIdByEmail: new Map<string, string>(),
    sessions: new Map<string, MemorySessionRow>(),
    providerCredentials: new Map<string, MemoryProviderCredentialRow>(),
    userProviderCredentials: new Map<string, MemoryUserProviderCredentialRow>(),
    providerOauthStates: new Map<string, MemoryProviderOauthStateRow>(),
    userModelSelectionPreferences: new Map<string, MemoryUserModelSelectionPreferenceRow>(),
    modelRecommendationRuns: new Map<string, MemoryModelRecommendationRunRow>(),
    aiInvocationTraces: new Map<string, MemoryAiInvocationTraceRow>(),
    jarvisSessions: new Map<string, MemoryJarvisSessionRow>(),
    jarvisSessionEvents: new Map<string, MemoryJarvisSessionEventRow[]>(),
    jarvisSessionStages: new Map<string, MemoryJarvisSessionStageRow[]>(),
    jarvisSessionEventSequence: 0,
    actionProposals: new Map<string, MemoryActionProposalRow>(),
    watchers: new Map<string, MemoryWatcherRow>(),
    watcherRuns: new Map<string, MemoryWatcherRunRow>(),
    briefings: new Map<string, MemoryBriefingRow>(),
    dossiers: new Map<string, MemoryDossierRow>(),
    dossierSources: new Map<string, MemoryDossierSourceRow[]>(),
    dossierClaims: new Map<string, MemoryDossierClaimRow[]>(),
    worldModelEntities: new Map<string, MemoryWorldModelEntityRow>(),
    worldModelEvents: new Map<string, MemoryWorldModelEventRow>(),
    worldModelObservations: new Map<string, MemoryWorldModelObservationRow>(),
    worldModelConstraints: new Map<string, MemoryWorldModelConstraintRow>(),
    worldModelHypotheses: new Map<string, MemoryWorldModelHypothesisRow>(),
    worldModelHypothesisEvidence: new Map<string, MemoryWorldModelHypothesisEvidenceRow>(),
    worldModelInvalidationConditions: new Map<string, MemoryWorldModelInvalidationConditionRow>(),
    worldModelStateSnapshots: new Map<string, MemoryWorldModelStateSnapshotRow>(),
    worldModelProjections: new Map<string, MemoryWorldModelProjectionRow>(),
    worldModelOutcomes: new Map<string, MemoryWorldModelOutcomeRow>(),
    missions: new Map<string, MissionRecord>(),
    assistantContexts: new Map<string, AssistantContextRecord>(),
    assistantContextByClientId: new Map<string, string>(),
    assistantContextEvents: new Map<string, AssistantContextEventRecord[]>(),
    assistantContextGroundingSources: new Map<string, AssistantContextGroundingSourceRecord[]>(),
    assistantContextGroundingClaims: new Map<string, AssistantContextGroundingClaimRecord[]>(),
    assistantContextEventSequence: 0,
    tasks: new Map<string, TaskRecord>(),
    taskEvents: new Map<string, TaskEventRecord[]>(),
    radarFeedSources: new Map<string, MemoryRadarFeedSourceRow>(),
    radarFeedCursors: new Map<string, MemoryRadarFeedCursorRow>(),
    radarIngestRuns: new Map<string, MemoryRadarIngestRunRow>(),
    radarItems: new Map<string, RadarItemRecord>(),
    radarEvents: new Map<string, MemoryRadarEventRow>(),
    radarDomainPosteriors: new Map<string, MemoryRadarDomainPosteriorRow>(),
    radarAutonomyDecisions: new Map<string, MemoryRadarAutonomyDecisionRow>(),
    radarOperatorFeedback: new Map<string, MemoryRadarOperatorFeedbackRow>(),
    radarDomainPackMetrics: new Map<string, MemoryRadarDomainPackMetricRow>(),
    radarControlSettings: null,
    radarRecommendations: new Map<string, RadarRecommendationRecord>(),
    intelligenceWorkspaces: new Map<string, MemoryIntelligenceWorkspaceRow>(),
    intelligenceWorkspaceMembers: new Map<string, MemoryIntelligenceWorkspaceMemberRow>(),
    intelligenceSources: new Map<string, MemoryIntelligenceSourceRow>(),
    intelligenceSourceCursors: new Map<string, MemoryIntelligenceSourceCursorRow>(),
    intelligenceScanRuns: new Map<string, MemoryIntelligenceScanRunRow>(),
    intelligenceRawDocuments: new Map<string, MemoryRawDocumentRow>(),
    intelligenceSignals: new Map<string, MemorySignalEnvelopeRow>(),
    intelligenceLinkedClaims: new Map<string, MemoryLinkedClaimRow>(),
    intelligenceClaimLinks: new Map<string, MemoryClaimLinkRow>(),
    intelligenceLinkedClaimEdges: new Map<string, MemoryLinkedClaimEdgeRow>(),
    intelligenceEventMemberships: new Map<string, MemoryEventMembershipRow>(),
    intelligenceHypothesisLedger: new Map<string, MemoryHypothesisLedgerRow>(),
    intelligenceHypothesisEvidenceLinks: new Map<string, MemoryHypothesisEvidenceLinkRow>(),
    intelligenceInvalidationEntries: new Map<string, MemoryInvalidationEntryRow>(),
    intelligenceExpectedSignalEntries: new Map<string, MemoryExpectedSignalEntryRow>(),
    intelligenceOutcomeEntries: new Map<string, MemoryOutcomeEntryRow>(),
    intelligenceNarrativeClusters: new Map<string, MemoryNarrativeClusterRow>(),
    intelligenceNarrativeClusterMemberships: new Map<string, MemoryNarrativeClusterMembershipRow>(),
    intelligenceTemporalNarrativeLedger: new Map<string, MemoryTemporalNarrativeLedgerEntryRow>(),
    intelligenceExecutionAudits: new Map<string, MemoryExecutionAuditRow>(),
    intelligenceOperatorNotes: new Map<string, MemoryOperatorNoteRow>(),
    intelligenceEvents: new Map<string, MemoryIntelligenceEventRow>(),
    intelligenceBridgeDispatches: new Map<string, MemoryIntelligenceBridgeDispatchRow>(),
    intelligenceModelRegistry: new Map<string, MemoryIntelligenceModelRegistryRow>(),
    intelligenceAliasBindings: new Map<string, MemoryIntelligenceAliasBindingRow>(),
    intelligenceFetchFailures: new Map<string, MemoryIntelligenceFetchFailureRow>(),
    intelligenceProviderHealth: new Map<string, MemoryIntelligenceProviderHealthRow>(),
    intelligenceAliasRollouts: new Map<string, MemoryIntelligenceAliasRolloutRow>(),
    telegramReports: new Map<string, TelegramReportRecord>(),
    upgradeProposals: new Map<string, UpgradeProposalRecord>(),
    upgradeRuns: new Map<string, UpgradeRunApiRecord>(),
    councilRuns: new Map<string, CouncilRunRecord>(),
    executionRuns: new Map<string, ExecutionRunRecord>(),
    councilRunByIdempotency: new Map<string, string>(),
    executionRunByIdempotency: new Map<string, string>(),
    memorySegments: new Map<string, MemorySegmentRecord>(),
    memoryNotes: new Map<string, MemoryNoteRow>(),
    approvals: new Map<string, ApprovalRecord>()
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
