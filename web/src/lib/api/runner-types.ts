export type WorkItemSource = "linear" | "internal_task";
export type WorkItemState = "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";
export type RunnerWorkspaceKind = "worktree" | "devcontainer";
export type RunnerClaimState = "unclaimed" | "claimed" | "running" | "retry_queued" | "released";
export type RunnerRunStatus =
  | "claimed"
  | "running"
  | "retry_queued"
  | "blocked_needs_approval"
  | "human_review_ready"
  | "failed_terminal"
  | "cancelled"
  | "released";
export type WorkflowValidationStatus = "unknown" | "valid" | "invalid";

export type ExecutionGraphNodeKind = "llm" | "tool" | "approval" | "router" | "sequence" | "parallel" | "loop" | "subgraph";
export type ExecutionGraphNodeStatus = "pending" | "running" | "blocked" | "completed" | "failed" | "skipped";
export type ExecutionGraphRunStatus = "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";
export type SessionStateStatus = "queued" | "running" | "blocked" | "completed" | "failed";
export type ArtifactType = "verification_log" | "command_output" | "patch_bundle" | "pr_metadata" | "report" | "generated_doc";

export type WorkflowValidationError = {
  path: string;
  message: string;
};

export type RunnerStateErrorRecord = {
  at: string;
  message: string;
  runId: string | null;
  source: WorkItemSource | null;
};

export type LinkedExternalWorkSummary = {
  itemId: string;
  source: "linear";
  identifier: string;
  title: string;
  url: string | null;
  triageStatus: "new" | "imported" | "ignored" | "sync_error";
};

export type WorkItem = {
  source: WorkItemSource;
  externalId: string;
  identifier: string;
  userId: string;
  taskId: string | null;
  title: string;
  description: string;
  state: WorkItemState;
  priority: number | null;
  labels: string[];
  branchName: string | null;
  url: string | null;
  blockedBy: string[];
  workspaceKey: string;
  payload: Record<string, unknown>;
};

export type RunnerVerificationSummary = {
  commands: Array<{
    command: string;
    ok: boolean;
    exitCode: number;
    durationMs: number;
    blockedReason?: string;
    stdout: string;
    stderr: string;
  }>;
};

export type RunnerProofOfWork = {
  verificationPassed: boolean;
  changedFiles: string[];
  gitStatus: string;
  summary: string[];
};

export type RunnerSessionSnapshot = {
  sessionId: string | null;
  actionProposalId: string | null;
  status: string | null;
  updatedAt: string | null;
};

export type ExecutionGraphNode = {
  id: string;
  key: string;
  kind: ExecutionGraphNodeKind;
  title: string;
  description: string;
  route: string | null;
  dependencies: string[];
  order: number;
  metadata?: Record<string, unknown>;
};

export type ExecutionGraphSpec = {
  id: string;
  source: "planner" | "runner_workflow" | "legacy_projection";
  title: string;
  objective: string;
  createdAt: string;
  entryNodeIds: string[];
  nodes: ExecutionGraphNode[];
  metadata?: Record<string, unknown>;
};

export type GraphNodeRunRecord = {
  nodeId: string;
  nodeKey: string;
  kind: ExecutionGraphNodeKind;
  status: ExecutionGraphNodeStatus;
  summary: string | null;
  error: string | null;
  attemptCount: number;
  artifactIds: string[];
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type GraphRunRecord = {
  id: string;
  graphId: string;
  status: ExecutionGraphRunStatus;
  currentNodeId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  nodeRuns: GraphNodeRunRecord[];
};

export type SessionStateSnapshot = {
  status: SessionStateStatus;
  updatedAt: string | null;
  values: Record<string, unknown>;
  promotionKeys: string[];
};

export type ArtifactRecord = {
  id: string;
  type: ArtifactType;
  label: string;
  createdAt: string;
  content: string | null;
  metadata: Record<string, unknown>;
};

export type RunnerRunRecord = {
  id: string;
  userId: string;
  workItem: WorkItem;
  claimState: RunnerClaimState;
  status: RunnerRunStatus;
  attemptCount: number;
  sessionSnapshot: RunnerSessionSnapshot | null;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceKind: RunnerWorkspaceKind;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  verificationSummary: RunnerVerificationSummary;
  proofOfWork: RunnerProofOfWork;
  lastProcessPid: number | null;
  blockedReason: string | null;
  failureReason: string | null;
  nextRetryAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string | null;
  graphSpec: ExecutionGraphSpec | null;
  graphRun: GraphRunRecord | null;
  sessionState: SessionStateSnapshot | null;
  artifacts: ArtifactRecord[];
  graphRunId: string | null;
  currentNodeId: string | null;
  artifactCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RunnerStateRecord = {
  id: string;
  dispatchEnabled: boolean;
  refreshRequestedAt: string | null;
  refreshedAt: string | null;
  workflowPath: string | null;
  workflowValidation: WorkflowValidationStatus;
  workflowErrors: WorkflowValidationError[];
  lastLoadedWorkflowAt: string | null;
  lastLoopStartedAt: string | null;
  activeSources: WorkItemSource[];
  recentErrors: RunnerStateErrorRecord[];
  createdAt: string;
  updatedAt: string;
};

export type RunnerStats = {
  claimed: number;
  running: number;
  retryQueued: number;
  blocked: number;
  humanReviewReady: number;
  failed: number;
  cancelled: number;
  released: number;
};

export type RunnerOperationalMetrics = {
  dueRetryRuns: number;
  stalledRuns: number;
  terminalCleanupPending: number;
  workflowErrorCount: number;
  recentErrorCount: number;
};

export type RunnerSnapshot = {
  state: RunnerStateRecord;
  stats: RunnerStats;
  metrics: RunnerOperationalMetrics;
  runs: RunnerRunRecord[];
};

export type RunnerCompatStep = {
  id: string;
  key: string;
  title: string;
  kind: ExecutionGraphNodeKind;
  order: number;
  route: string | null;
  status: ExecutionGraphNodeStatus;
  summary: string | null;
};

export type RunnerRunDetail = {
  run: RunnerRunRecord;
  graph: ExecutionGraphSpec | null;
  node_runs: GraphNodeRunRecord[];
  artifacts: ArtifactRecord[];
  session_state_summary: SessionStateSnapshot | null;
  compat_steps: RunnerCompatStep[];
  linked_external_work?: LinkedExternalWorkSummary | null;
};

export type RunnerRunArtifactsResponse = {
  run_id: string;
  artifacts: ArtifactRecord[];
};

export type RunnerWorkflowValidationResult = {
  valid: boolean;
  source_path: string | null;
  contract: {
    sourcePath: string;
    tracker: {
      sources: WorkItemSource[];
    };
    codex: {
      command: string;
      verificationCommands: string[];
      pullRequest: {
        draft: boolean;
        branchPrefix: string;
      };
    };
    hooks?: {
      afterCreate?: string[];
      beforeRun?: string[];
      afterRun?: string[];
      beforeRemove?: string[];
    };
    workspace?: {
      type: RunnerWorkspaceKind;
    };
  } | null;
  errors: WorkflowValidationError[];
};
