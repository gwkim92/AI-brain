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

export type TelegramReportRecord = {
  id: string;
  chatId: string;
  status: 'queued' | 'sent' | 'failed';
  createdAt: string;
};

export type CreateTaskInput = {
  userId: string;
  mode: TaskMode;
  title: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
  traceId?: string;
};

export type EvaluateRadarInput = {
  itemIds: string[];
};

export type JarvisStore = {
  kind: 'memory' | 'postgres';
  initialize: () => Promise<void>;
  health: () => Promise<{ store: 'memory' | 'postgres'; db: 'up' | 'down' | 'n/a' }>;

  createTask: (input: CreateTaskInput) => Promise<TaskRecord>;
  listTasks: (input: { status?: TaskStatus; limit: number }) => Promise<TaskRecord[]>;
  getTaskById: (taskId: string) => Promise<TaskRecord | null>;

  appendTaskEvent: (event: Omit<TaskEventRecord, 'id' | 'timestamp'>) => Promise<TaskEventRecord>;
  listTaskEvents: (taskId: string, limit: number) => Promise<TaskEventRecord[]>;

  ingestRadarItems: (items: RadarItemRecord[]) => Promise<number>;
  listRadarItems: (input: { status?: RadarItemStatus; limit: number }) => Promise<RadarItemRecord[]>;
  evaluateRadar: (input: EvaluateRadarInput) => Promise<RadarRecommendationRecord[]>;
  listRadarRecommendations: (decision?: 'adopt' | 'hold' | 'discard') => Promise<RadarRecommendationRecord[]>;

  createTelegramReport: (input: { chatId: string }) => Promise<TelegramReportRecord>;

  listUpgradeProposals: (status?: UpgradeStatus) => Promise<UpgradeProposalRecord[]>;
  findUpgradeProposalById: (proposalId: string) => Promise<UpgradeProposalRecord | null>;
  decideUpgradeProposal: (
    proposalId: string,
    decision: 'approve' | 'reject',
    reason?: string
  ) => Promise<UpgradeProposalRecord | null>;

  createUpgradeRun: (payload: { proposalId: string; startCommand: string }) => Promise<UpgradeRunApiRecord>;
  getUpgradeRunById: (runId: string) => Promise<UpgradeRunApiRecord | null>;

  createUpgradeExecutorGateway: () => UpgradeExecutorGateway;
};
