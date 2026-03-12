import type { JarvisStore } from './types';

export const CORE_STORE_METHOD_KEYS = [
  'getPool',
  'initialize',
  'health',
  'createUpgradeExecutorGateway'
] as const satisfies readonly (keyof JarvisStore)[];

export const AUTH_REPOSITORY_METHOD_KEYS = [
  'createAuthUser',
  'upsertAuthUserByEmail',
  'findAuthUserByEmail',
  'getAuthUserById',
  'createAuthSession',
  'getAuthSessionByTokenHash',
  'revokeAuthSession',
  'listProviderCredentials',
  'upsertProviderCredential',
  'deleteProviderCredential',
  'listUserProviderCredentials',
  'getUserProviderCredential',
  'upsertUserProviderCredential',
  'deleteUserProviderCredential',
  'listActiveUserProviderCredentials',
  'createProviderOauthState',
  'consumeProviderOauthState',
  'cleanupExpiredProviderOauthStates',
  'listUserModelSelectionPreferences',
  'getUserModelSelectionPreference',
  'upsertUserModelSelectionPreference',
  'deleteUserModelSelectionPreference',
  'createModelRecommendationRun',
  'listModelRecommendationRuns',
  'markModelRecommendationApplied',
  'cleanupExpiredModelRecommendationRuns',
  'createAiInvocationTrace',
  'completeAiInvocationTrace',
  'listAiInvocationTraces',
  'getAiInvocationMetrics',
  'cleanupExpiredAiInvocationTraces'
] as const satisfies readonly (keyof JarvisStore)[];

export const JARVIS_REPOSITORY_METHOD_KEYS = [
  'createJarvisSession',
  'listJarvisSessions',
  'getJarvisSessionById',
  'updateJarvisSession',
  'appendJarvisSessionEvent',
  'listJarvisSessionEvents',
  'upsertJarvisSessionStage',
  'listJarvisSessionStages',
  'createActionProposal',
  'listActionProposals',
  'decideActionProposal',
  'createWatcher',
  'listWatchers',
  'listActiveWatchers',
  'getWatcherById',
  'updateWatcher',
  'deleteWatcher',
  'createWatcherRun',
  'listWatcherRuns',
  'updateWatcherRun',
  'createBriefing',
  'listBriefings',
  'getBriefingById',
  'createDossier',
  'listDossiers',
  'getDossierById',
  'updateDossier',
  'replaceDossierSources',
  'listDossierSources',
  'replaceDossierClaims',
  'listDossierClaims'
] as const satisfies readonly (keyof JarvisStore)[];

export const WORLD_MODEL_REPOSITORY_METHOD_KEYS = [
  'upsertWorldModelEntity',
  'listWorldModelEntities',
  'createWorldModelEvent',
  'listWorldModelEvents',
  'createWorldModelObservation',
  'listWorldModelObservations',
  'createWorldModelConstraint',
  'listWorldModelConstraints',
  'updateWorldModelConstraint',
  'createWorldModelHypothesis',
  'listWorldModelHypotheses',
  'updateWorldModelHypothesis',
  'createWorldModelHypothesisEvidence',
  'listWorldModelHypothesisEvidence',
  'createWorldModelInvalidationCondition',
  'listWorldModelInvalidationConditions',
  'updateWorldModelInvalidationCondition',
  'createWorldModelStateSnapshot',
  'listWorldModelStateSnapshots',
  'createWorldModelProjection',
  'listWorldModelProjections',
  'updateWorldModelProjection',
  'createWorldModelOutcome',
  'listWorldModelOutcomes'
] as const satisfies readonly (keyof JarvisStore)[];

export const MISSION_REPOSITORY_METHOD_KEYS = [
  'createMission',
  'listMissions',
  'getMissionById',
  'updateMission'
] as const satisfies readonly (keyof JarvisStore)[];

export const ASSISTANT_CONTEXT_REPOSITORY_METHOD_KEYS = [
  'upsertAssistantContext',
  'updateAssistantContext',
  'listAssistantContexts',
  'getAssistantContextById',
  'getAssistantContextByClientContextId',
  'appendAssistantContextEvent',
  'listAssistantContextEvents',
  'replaceAssistantContextGroundingSources',
  'listAssistantContextGroundingSources',
  'replaceAssistantContextGroundingClaims',
  'listAssistantContextGroundingClaims'
] as const satisfies readonly (keyof JarvisStore)[];

export const TASK_REPOSITORY_METHOD_KEYS = [
  'createTask',
  'setTaskStatus',
  'listTasks',
  'getTaskById',
  'appendTaskEvent',
  'listTaskEvents'
] as const satisfies readonly (keyof JarvisStore)[];

export const RADAR_UPGRADE_REPOSITORY_METHOD_KEYS = [
  'upsertRadarFeedSources',
  'listRadarFeedSources',
  'toggleRadarFeedSource',
  'listRadarFeedCursors',
  'upsertRadarFeedCursor',
  'createRadarIngestRun',
  'completeRadarIngestRun',
  'listRadarIngestRuns',
  'ingestRadarItems',
  'listRadarItems',
  'evaluateRadar',
  'listRadarRecommendations',
  'listRadarEvents',
  'getRadarEventById',
  'listRadarDomainPosteriors',
  'getRadarAutonomyDecision',
  'getRadarControlSettings',
  'updateRadarControlSettings',
  'listRadarDomainPackMetrics',
  'recordRadarDomainPackOutcome',
  'createRadarOperatorFeedback',
  'listRadarOperatorFeedback',
  'listUpgradeProposals',
  'findUpgradeProposalById',
  'decideUpgradeProposal',
  'createUpgradeRun',
  'listUpgradeRuns',
  'getUpgradeRunById'
] as const satisfies readonly (keyof JarvisStore)[];

export const TELEGRAM_REPORT_REPOSITORY_METHOD_KEYS = [
  'createTelegramReport',
  'listTelegramReports',
  'getTelegramReportById',
  'listPendingTelegramReports',
  'updateTelegramReportDelivery'
] as const satisfies readonly (keyof JarvisStore)[];

export const COUNCIL_EXECUTION_APPROVAL_REPOSITORY_METHOD_KEYS = [
  'createCouncilRun',
  'updateCouncilRun',
  'getCouncilRunByIdempotency',
  'listCouncilRuns',
  'getCouncilRunById',
  'createExecutionRun',
  'updateExecutionRun',
  'getExecutionRunByIdempotency',
  'listExecutionRuns',
  'getExecutionRunById',
  'createApproval',
  'listApprovals',
  'decideApproval'
] as const satisfies readonly (keyof JarvisStore)[];

export const MEMORY_REPOSITORY_METHOD_KEYS = [
  'createMemorySegment',
  'searchMemoryByEmbedding',
  'listMemorySegments',
  'createMemoryNote',
  'listMemoryNotes',
  'updateMemoryNote',
  'deleteMemoryNote'
] as const satisfies readonly (keyof JarvisStore)[];

export const INTELLIGENCE_REPOSITORY_METHOD_KEYS = [
  'getOrCreateIntelligenceWorkspace',
  'createIntelligenceWorkspace',
  'listIntelligenceWorkspaces',
  'getIntelligenceWorkspaceMembership',
  'createIntelligenceSource',
  'updateIntelligenceSource',
  'listAllIntelligenceSources',
  'listIntelligenceSources',
  'toggleIntelligenceSource',
  'listIntelligenceSourceCursors',
  'upsertIntelligenceSourceCursor',
  'createIntelligenceScanRun',
  'completeIntelligenceScanRun',
  'listIntelligenceScanRuns',
  'createIntelligenceFetchFailure',
  'listIntelligenceFetchFailures',
  'findIntelligenceRawDocumentByFingerprint',
  'createIntelligenceRawDocument',
  'listIntelligenceRawDocuments',
  'createIntelligenceSignal',
  'listIntelligenceSignals',
  'updateIntelligenceSignalProcessing',
  'createIntelligenceLinkedClaim',
  'listIntelligenceLinkedClaims',
  'updateIntelligenceLinkedClaimReviewState',
  'createIntelligenceClaimLink',
  'listIntelligenceClaimLinks',
  'createIntelligenceLinkedClaimEdge',
  'listIntelligenceLinkedClaimEdges',
  'replaceIntelligenceEventMemberships',
  'listIntelligenceEventMemberships',
  'upsertIntelligenceEvent',
  'listIntelligenceEvents',
  'getIntelligenceEventById',
  'updateIntelligenceEventReviewState',
  'createIntelligenceOperatorNote',
  'listIntelligenceOperatorNotes',
  'createIntelligenceHypothesisLedgerEntry',
  'listIntelligenceHypothesisLedgerEntries',
  'updateIntelligenceHypothesisLedgerReviewState',
  'createIntelligenceHypothesisEvidenceLink',
  'listIntelligenceHypothesisEvidenceLinks',
  'replaceIntelligenceInvalidationEntries',
  'listIntelligenceInvalidationEntries',
  'replaceIntelligenceExpectedSignalEntries',
  'listIntelligenceExpectedSignalEntries',
  'createIntelligenceOutcomeEntry',
  'listIntelligenceOutcomeEntries',
  'upsertIntelligenceNarrativeCluster',
  'listIntelligenceNarrativeClusters',
  'getIntelligenceNarrativeClusterById',
  'updateIntelligenceNarrativeClusterReviewState',
  'upsertIntelligenceNarrativeClusterMembership',
  'listIntelligenceNarrativeClusterMemberships',
  'replaceIntelligenceTemporalNarrativeLedgerEntries',
  'listIntelligenceTemporalNarrativeLedgerEntries',
  'createIntelligenceExecutionAudit',
  'listIntelligenceExecutionAudits',
  'createIntelligenceBridgeDispatch',
  'listIntelligenceBridgeDispatches',
  'upsertIntelligenceModelRegistryEntries',
  'listIntelligenceModelRegistryEntries',
  'replaceIntelligenceProviderHealth',
  'listIntelligenceProviderHealth',
  'replaceIntelligenceAliasBindings',
  'listIntelligenceAliasBindings',
  'createIntelligenceAliasRollout',
  'listIntelligenceAliasRollouts'
] as const satisfies readonly (keyof JarvisStore)[];

export const STORE_METHOD_KEY_GROUPS = {
  core: CORE_STORE_METHOD_KEYS,
  auth: AUTH_REPOSITORY_METHOD_KEYS,
  jarvis: JARVIS_REPOSITORY_METHOD_KEYS,
  world_model: WORLD_MODEL_REPOSITORY_METHOD_KEYS,
  mission: MISSION_REPOSITORY_METHOD_KEYS,
  assistant_context: ASSISTANT_CONTEXT_REPOSITORY_METHOD_KEYS,
  task: TASK_REPOSITORY_METHOD_KEYS,
  radar_upgrade: RADAR_UPGRADE_REPOSITORY_METHOD_KEYS,
  telegram_report: TELEGRAM_REPORT_REPOSITORY_METHOD_KEYS,
  council_execution_approval: COUNCIL_EXECUTION_APPROVAL_REPOSITORY_METHOD_KEYS,
  memory: MEMORY_REPOSITORY_METHOD_KEYS,
  intelligence: INTELLIGENCE_REPOSITORY_METHOD_KEYS
} as const satisfies Record<string, readonly (keyof JarvisStore)[]>;

export type StoreMethodKeyGroupName = keyof typeof STORE_METHOD_KEY_GROUPS;

export const ALL_STORE_METHOD_KEYS: (keyof JarvisStore)[] = Object.values(STORE_METHOD_KEY_GROUPS).flatMap((keys) =>
  [...keys]
);

export type AuthRepositoryContract = Pick<
  JarvisStore,
  | 'createAuthUser'
  | 'upsertAuthUserByEmail'
  | 'findAuthUserByEmail'
  | 'getAuthUserById'
  | 'createAuthSession'
  | 'getAuthSessionByTokenHash'
  | 'revokeAuthSession'
  | 'listProviderCredentials'
  | 'upsertProviderCredential'
  | 'deleteProviderCredential'
  | 'listUserProviderCredentials'
  | 'getUserProviderCredential'
  | 'upsertUserProviderCredential'
  | 'deleteUserProviderCredential'
  | 'listActiveUserProviderCredentials'
  | 'createProviderOauthState'
  | 'consumeProviderOauthState'
  | 'cleanupExpiredProviderOauthStates'
  | 'listUserModelSelectionPreferences'
  | 'getUserModelSelectionPreference'
  | 'upsertUserModelSelectionPreference'
  | 'deleteUserModelSelectionPreference'
  | 'createModelRecommendationRun'
  | 'listModelRecommendationRuns'
  | 'markModelRecommendationApplied'
  | 'cleanupExpiredModelRecommendationRuns'
  | 'createAiInvocationTrace'
  | 'completeAiInvocationTrace'
  | 'listAiInvocationTraces'
  | 'getAiInvocationMetrics'
  | 'cleanupExpiredAiInvocationTraces'
>;

export type JarvisRepositoryContract = Pick<
  JarvisStore,
  | 'createJarvisSession'
  | 'listJarvisSessions'
  | 'getJarvisSessionById'
  | 'updateJarvisSession'
  | 'appendJarvisSessionEvent'
  | 'listJarvisSessionEvents'
  | 'upsertJarvisSessionStage'
  | 'listJarvisSessionStages'
  | 'createActionProposal'
  | 'listActionProposals'
  | 'decideActionProposal'
  | 'createWatcher'
  | 'listWatchers'
  | 'listActiveWatchers'
  | 'getWatcherById'
  | 'updateWatcher'
  | 'deleteWatcher'
  | 'createWatcherRun'
  | 'listWatcherRuns'
  | 'updateWatcherRun'
  | 'createBriefing'
  | 'listBriefings'
  | 'getBriefingById'
  | 'createDossier'
  | 'listDossiers'
  | 'getDossierById'
  | 'updateDossier'
  | 'replaceDossierSources'
  | 'listDossierSources'
  | 'replaceDossierClaims'
  | 'listDossierClaims'
>;

export type WorldModelRepositoryContract = Pick<
  JarvisStore,
  | 'upsertWorldModelEntity'
  | 'listWorldModelEntities'
  | 'createWorldModelEvent'
  | 'listWorldModelEvents'
  | 'createWorldModelObservation'
  | 'listWorldModelObservations'
  | 'createWorldModelConstraint'
  | 'listWorldModelConstraints'
  | 'updateWorldModelConstraint'
  | 'createWorldModelHypothesis'
  | 'listWorldModelHypotheses'
  | 'updateWorldModelHypothesis'
  | 'createWorldModelHypothesisEvidence'
  | 'listWorldModelHypothesisEvidence'
  | 'createWorldModelInvalidationCondition'
  | 'listWorldModelInvalidationConditions'
  | 'updateWorldModelInvalidationCondition'
  | 'createWorldModelStateSnapshot'
  | 'listWorldModelStateSnapshots'
  | 'createWorldModelProjection'
  | 'listWorldModelProjections'
  | 'updateWorldModelProjection'
  | 'createWorldModelOutcome'
  | 'listWorldModelOutcomes'
>;

export type MissionRepositoryContract = Pick<
  JarvisStore,
  'createMission' | 'listMissions' | 'getMissionById' | 'updateMission'
>;

export type AssistantContextRepositoryContract = Pick<
  JarvisStore,
  | 'upsertAssistantContext'
  | 'updateAssistantContext'
  | 'listAssistantContexts'
  | 'getAssistantContextById'
  | 'getAssistantContextByClientContextId'
  | 'appendAssistantContextEvent'
  | 'listAssistantContextEvents'
  | 'replaceAssistantContextGroundingSources'
  | 'listAssistantContextGroundingSources'
  | 'replaceAssistantContextGroundingClaims'
  | 'listAssistantContextGroundingClaims'
>;

export type TaskRepositoryContract = Pick<
  JarvisStore,
  'createTask' | 'setTaskStatus' | 'listTasks' | 'getTaskById' | 'appendTaskEvent' | 'listTaskEvents'
>;

export type RadarUpgradeRepositoryContract = Pick<
  JarvisStore,
  | 'upsertRadarFeedSources'
  | 'listRadarFeedSources'
  | 'toggleRadarFeedSource'
  | 'listRadarFeedCursors'
  | 'upsertRadarFeedCursor'
  | 'createRadarIngestRun'
  | 'completeRadarIngestRun'
  | 'listRadarIngestRuns'
  | 'ingestRadarItems'
  | 'listRadarItems'
  | 'evaluateRadar'
  | 'listRadarRecommendations'
  | 'listRadarEvents'
  | 'getRadarEventById'
  | 'listRadarDomainPosteriors'
  | 'getRadarAutonomyDecision'
  | 'getRadarControlSettings'
  | 'updateRadarControlSettings'
  | 'listRadarDomainPackMetrics'
  | 'recordRadarDomainPackOutcome'
  | 'createRadarOperatorFeedback'
  | 'listRadarOperatorFeedback'
  | 'listUpgradeProposals'
  | 'findUpgradeProposalById'
  | 'decideUpgradeProposal'
  | 'createUpgradeRun'
  | 'listUpgradeRuns'
  | 'getUpgradeRunById'
>;

export type TelegramReportRepositoryContract = Pick<
  JarvisStore,
  | 'createTelegramReport'
  | 'listTelegramReports'
  | 'getTelegramReportById'
  | 'listPendingTelegramReports'
  | 'updateTelegramReportDelivery'
>;

export type CouncilExecutionApprovalRepositoryContract = Pick<
  JarvisStore,
  | 'createCouncilRun'
  | 'updateCouncilRun'
  | 'getCouncilRunByIdempotency'
  | 'listCouncilRuns'
  | 'getCouncilRunById'
  | 'createExecutionRun'
  | 'updateExecutionRun'
  | 'getExecutionRunByIdempotency'
  | 'listExecutionRuns'
  | 'getExecutionRunById'
  | 'createApproval'
  | 'listApprovals'
  | 'decideApproval'
>;

export type MemoryRepositoryContract = Pick<
  JarvisStore,
  'createMemorySegment' | 'searchMemoryByEmbedding' | 'listMemorySegments' | 'createMemoryNote' | 'listMemoryNotes' | 'updateMemoryNote' | 'deleteMemoryNote'
>;

export type IntelligenceRepositoryContract = Pick<
  JarvisStore,
  | 'getOrCreateIntelligenceWorkspace'
  | 'createIntelligenceWorkspace'
  | 'listIntelligenceWorkspaces'
  | 'getIntelligenceWorkspaceMembership'
  | 'createIntelligenceSource'
  | 'updateIntelligenceSource'
  | 'listAllIntelligenceSources'
  | 'listIntelligenceSources'
  | 'toggleIntelligenceSource'
  | 'listIntelligenceSourceCursors'
  | 'upsertIntelligenceSourceCursor'
  | 'createIntelligenceScanRun'
  | 'completeIntelligenceScanRun'
  | 'listIntelligenceScanRuns'
  | 'createIntelligenceFetchFailure'
  | 'listIntelligenceFetchFailures'
  | 'findIntelligenceRawDocumentByFingerprint'
  | 'createIntelligenceRawDocument'
  | 'listIntelligenceRawDocuments'
  | 'createIntelligenceSignal'
  | 'listIntelligenceSignals'
  | 'updateIntelligenceSignalProcessing'
  | 'createIntelligenceLinkedClaim'
  | 'listIntelligenceLinkedClaims'
  | 'updateIntelligenceLinkedClaimReviewState'
  | 'createIntelligenceLinkedClaimEdge'
  | 'listIntelligenceLinkedClaimEdges'
  | 'createIntelligenceClaimLink'
  | 'listIntelligenceClaimLinks'
  | 'replaceIntelligenceEventMemberships'
  | 'listIntelligenceEventMemberships'
  | 'upsertIntelligenceEvent'
  | 'listIntelligenceEvents'
  | 'getIntelligenceEventById'
  | 'updateIntelligenceEventReviewState'
  | 'createIntelligenceOperatorNote'
  | 'listIntelligenceOperatorNotes'
  | 'createIntelligenceHypothesisLedgerEntry'
  | 'listIntelligenceHypothesisLedgerEntries'
  | 'updateIntelligenceHypothesisLedgerReviewState'
  | 'createIntelligenceHypothesisEvidenceLink'
  | 'listIntelligenceHypothesisEvidenceLinks'
  | 'replaceIntelligenceInvalidationEntries'
  | 'listIntelligenceInvalidationEntries'
  | 'replaceIntelligenceExpectedSignalEntries'
  | 'listIntelligenceExpectedSignalEntries'
  | 'createIntelligenceOutcomeEntry'
  | 'listIntelligenceOutcomeEntries'
  | 'upsertIntelligenceNarrativeCluster'
  | 'listIntelligenceNarrativeClusters'
  | 'getIntelligenceNarrativeClusterById'
  | 'updateIntelligenceNarrativeClusterReviewState'
  | 'upsertIntelligenceNarrativeClusterMembership'
  | 'listIntelligenceNarrativeClusterMemberships'
  | 'replaceIntelligenceTemporalNarrativeLedgerEntries'
  | 'listIntelligenceTemporalNarrativeLedgerEntries'
  | 'createIntelligenceExecutionAudit'
  | 'listIntelligenceExecutionAudits'
  | 'createIntelligenceBridgeDispatch'
  | 'listIntelligenceBridgeDispatches'
  | 'upsertIntelligenceModelRegistryEntries'
  | 'listIntelligenceModelRegistryEntries'
  | 'replaceIntelligenceProviderHealth'
  | 'listIntelligenceProviderHealth'
  | 'replaceIntelligenceAliasBindings'
  | 'listIntelligenceAliasBindings'
  | 'createIntelligenceAliasRollout'
  | 'listIntelligenceAliasRollouts'
>;

export type UpgradeExecutorGatewayStoreDepsContract = Pick<JarvisStore, 'findUpgradeProposalById' | 'createUpgradeRun'>;
export type UpgradeExecutorGatewayContract = ReturnType<JarvisStore['createUpgradeExecutorGateway']>;
