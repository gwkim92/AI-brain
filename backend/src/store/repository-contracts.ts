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
  'deleteProviderCredential'
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
  'ingestRadarItems',
  'listRadarItems',
  'evaluateRadar',
  'listRadarRecommendations',
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
  'listMemorySegments'
] as const satisfies readonly (keyof JarvisStore)[];

export const STORE_METHOD_KEY_GROUPS = {
  core: CORE_STORE_METHOD_KEYS,
  auth: AUTH_REPOSITORY_METHOD_KEYS,
  mission: MISSION_REPOSITORY_METHOD_KEYS,
  assistant_context: ASSISTANT_CONTEXT_REPOSITORY_METHOD_KEYS,
  task: TASK_REPOSITORY_METHOD_KEYS,
  radar_upgrade: RADAR_UPGRADE_REPOSITORY_METHOD_KEYS,
  telegram_report: TELEGRAM_REPORT_REPOSITORY_METHOD_KEYS,
  council_execution_approval: COUNCIL_EXECUTION_APPROVAL_REPOSITORY_METHOD_KEYS,
  memory: MEMORY_REPOSITORY_METHOD_KEYS
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
  | 'ingestRadarItems'
  | 'listRadarItems'
  | 'evaluateRadar'
  | 'listRadarRecommendations'
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

export type MemoryRepositoryContract = Pick<JarvisStore, 'createMemorySegment' | 'searchMemoryByEmbedding' | 'listMemorySegments'>;

export type UpgradeExecutorGatewayStoreDepsContract = Pick<JarvisStore, 'findUpgradeProposalById' | 'createUpgradeRun'>;
export type UpgradeExecutorGatewayContract = ReturnType<JarvisStore['createUpgradeExecutorGateway']>;
