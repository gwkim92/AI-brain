export type CodeLoopStatusV2 =
  | 'planned'
  | 'patched'
  | 'tested'
  | 'linted'
  | 'reviewed'
  | 'pr_opened'
  | 'completed'
  | 'blocked'
  | 'failed';

export type CodeLoopStepNameV2 = 'plan' | 'patch' | 'test' | 'lint' | 'review' | 'pr_open';

export type CodeLoopStepRecordV2 = {
  id: string;
  step: CodeLoopStepNameV2;
  status: 'completed' | 'failed' | 'skipped';
  startedAt: string;
  completedAt: string;
  log: string;
  metadata: Record<string, unknown>;
};

export type CodeLoopEventV2 = {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
};

export type CodeLoopRunV2 = {
  id: string;
  userId: string;
  contractId: string;
  prompt: string;
  status: CodeLoopStatusV2;
  retryCount: number;
  blockedReasons: string[];
  requiresApproval: boolean;
  approvedAt: string | null;
  changedFiles: string[];
  steps: CodeLoopStepRecordV2[];
  events: CodeLoopEventV2[];
  createdAt: string;
  updatedAt: string;
};
