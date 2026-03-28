import { randomUUID } from 'node:crypto';

import type {
  ArtifactRecord,
  ExecutionGraphNode,
  ExecutionGraphNodeKind,
  ExecutionGraphNodeStatus,
  ExecutionGraphSpec,
  GraphNodeRunRecord,
  GraphRunRecord,
  MissionRecord,
  RunnerProofOfWork,
  RunnerRunRecord,
  RunnerRunStatus,
  RunnerSessionSnapshot,
  RunnerVerificationSummary,
  SessionStateSnapshot,
  WorkflowContract,
  WorkItem
} from '../store/types';

export type PlannerGraphStepInput = {
  id: string;
  type: string;
  taskType: string;
  title: string;
  description: string;
  order: number;
  dependencies: string[];
  route?: string | null;
  metadata?: Record<string, unknown>;
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

type RunnerRunHydrationInput = Omit<RunnerRunRecord, 'graphRunId' | 'currentNodeId' | 'artifactCount'>;

function nowIso(): string {
  return new Date().toISOString();
}

function mapPlanStepKind(stepType: string): ExecutionGraphNodeKind {
  if (stepType === 'human_gate') return 'approval';
  if (stepType === 'tool_call') return 'tool';
  if (stepType === 'sub_mission') return 'subgraph';
  if (stepType === 'council_debate') return 'parallel';
  return 'llm';
}

function createGraphNode(input: {
  key: string;
  kind: ExecutionGraphNodeKind;
  title: string;
  description: string;
  order: number;
  dependencies?: string[];
  route?: string | null;
  metadata?: Record<string, unknown>;
}): ExecutionGraphNode {
  return {
    id: randomUUID(),
    key: input.key,
    kind: input.kind,
    title: input.title,
    description: input.description,
    order: input.order,
    dependencies: input.dependencies ?? [],
    route: input.route ?? null,
    metadata: input.metadata
  };
}

function findNodeByKey(graphSpec: ExecutionGraphSpec, nodeKey: string) {
  return graphSpec.nodes.find((node) => node.key === nodeKey || node.id === nodeKey) ?? null;
}

function mergeArtifactIds(current: string[], next?: string[]): string[] {
  if (!next || next.length === 0) {
    return current;
  }
  return Array.from(new Set([...current, ...next]));
}

function mapRunnerStatusToSessionStatus(status: RunnerRunStatus): SessionStateSnapshot['status'] {
  if (status === 'claimed' || status === 'retry_queued') return 'queued';
  if (status === 'running') return 'running';
  if (status === 'blocked_needs_approval') return 'blocked';
  if (status === 'human_review_ready' || status === 'released') return 'completed';
  return 'failed';
}

export function createExecutionGraphFromPlan(input: {
  title: string;
  objective: string;
  domain: string;
  steps: PlannerGraphStepInput[];
  createdAt?: string;
}): ExecutionGraphSpec {
  const createdAt = input.createdAt ?? nowIso();
  const nodes = input.steps.map((step) => ({
    id: step.id,
    key: step.id,
    kind: mapPlanStepKind(step.type),
    title: step.title,
    description: step.description,
    route: step.route ?? null,
    dependencies: step.dependencies,
    order: step.order,
    metadata: {
      taskType: step.taskType,
      ...step.metadata
    }
  }));

  return {
    id: randomUUID(),
    source: 'planner',
    title: input.title,
    objective: input.objective,
    createdAt,
    entryNodeIds: nodes.filter((node) => node.dependencies.length === 0).map((node) => node.id),
    nodes,
    metadata: {
      domain: input.domain
    }
  };
}

export function createMissionExecutionGraph(mission: Pick<MissionRecord, 'id' | 'title' | 'objective' | 'domain' | 'steps'>): ExecutionGraphSpec {
  const sortedSteps = [...mission.steps].sort((left, right) => left.order - right.order);

  return createExecutionGraphFromPlan({
    title: mission.title,
    objective: mission.objective,
    domain: mission.domain,
    steps: sortedSteps.map((step, index) => ({
      id: step.id,
      type: step.type,
      taskType: step.taskType ?? 'execute',
      title: step.title,
      description: step.description,
      order: step.order,
      dependencies:
        index === 0
          ? []
          : sortedSteps
              .filter((candidate) => candidate.order < step.order)
              .map((candidate) => candidate.id),
      route: step.route,
      metadata: step.metadata
    })),
    createdAt: new Date().toISOString()
  });
}

export function createRunnerExecutionGraph(input: {
  workflow: WorkflowContract;
  workItem: WorkItem;
  createdAt?: string;
}): ExecutionGraphSpec {
  const createdAt = input.createdAt ?? nowIso();
  const nodes: ExecutionGraphNode[] = [];
  let previousNodeId: string | null = null;
  let order = 1;

  const pushNode = (
    key: string,
    kind: ExecutionGraphNodeKind,
    title: string,
    description: string,
    metadata?: Record<string, unknown>
  ) => {
    const node = createGraphNode({
      key,
      kind,
      title,
      description,
      order,
      dependencies: previousNodeId ? [previousNodeId] : [],
      metadata
    });
    nodes.push(node);
    previousNodeId = node.id;
    order += 1;
  };

  if (input.workflow.hooks.afterCreate.length > 0) {
    pushNode('after_create', 'tool', 'After create hooks', 'Run workspace bootstrap hooks after first provision.', {
      commands: input.workflow.hooks.afterCreate
    });
  }

  if (input.workflow.hooks.beforeRun.length > 0) {
    pushNode('before_run', 'tool', 'Before run hooks', 'Prepare the workspace before the main execution.', {
      commands: input.workflow.hooks.beforeRun
    });
  }

  pushNode('execute', 'llm', 'Execution', 'Run the main autonomous implementation command.', {
    command: input.workflow.codex.command
  });

  if (input.workflow.hooks.afterRun.length > 0) {
    pushNode('after_run', 'tool', 'After run hooks', 'Perform post-execution cleanup and normalization.', {
      commands: input.workflow.hooks.afterRun
    });
  }

  if (input.workflow.codex.verificationCommands.length > 0) {
    pushNode('verification', 'tool', 'Verification', 'Run verification commands before handoff.', {
      commands: input.workflow.codex.verificationCommands
    });
  }

  pushNode('handoff', 'tool', 'PR handoff', 'Create pull request metadata and hand off for human review.', {
    draft: input.workflow.codex.pullRequest.draft
  });

  return {
    id: randomUUID(),
    source: 'runner_workflow',
    title: `Runner graph: ${input.workItem.title}`,
    objective: input.workItem.description,
    createdAt,
    entryNodeIds: nodes.length > 0 ? [nodes[0]!.id] : [],
    nodes,
    metadata: {
      workItemIdentifier: input.workItem.identifier,
      sourcePath: input.workflow.sourcePath
    }
  };
}

export function createGraphRun(graphSpec: ExecutionGraphSpec, createdAt = nowIso()): GraphRunRecord {
  const nodeRuns: GraphNodeRunRecord[] = graphSpec.nodes.map((node) => ({
    nodeId: node.id,
    nodeKey: node.key,
    kind: node.kind,
    status: 'pending',
    summary: null,
    error: null,
    attemptCount: 0,
    artifactIds: [],
    startedAt: null,
    completedAt: null,
    updatedAt: createdAt,
    metadata: node.metadata
  }));

  return {
    id: randomUUID(),
    graphId: graphSpec.id,
    status: 'queued',
    currentNodeId: graphSpec.entryNodeIds[0] ?? null,
    startedAt: null,
    completedAt: null,
    updatedAt: createdAt,
    nodeRuns
  };
}

export function updateGraphRunNode(input: {
  graphSpec: ExecutionGraphSpec;
  graphRun: GraphRunRecord;
  nodeKey: string;
  status: ExecutionGraphNodeStatus;
  timestamp?: string;
  summary?: string | null;
  error?: string | null;
  artifactIds?: string[];
  runStatus?: GraphRunRecord['status'];
}): GraphRunRecord {
  const timestamp = input.timestamp ?? nowIso();
  const targetNode = findNodeByKey(input.graphSpec, input.nodeKey);
  if (!targetNode) {
    return {
      ...input.graphRun,
      updatedAt: timestamp
    };
  }

  const nodeRuns = input.graphRun.nodeRuns.map((nodeRun) => {
    if (nodeRun.nodeId !== targetNode.id) {
      return nodeRun;
    }
    return {
      ...nodeRun,
      status: input.status,
      summary: input.summary === undefined ? nodeRun.summary : input.summary,
      error: input.error === undefined ? nodeRun.error : input.error,
      attemptCount: input.status === 'running' ? nodeRun.attemptCount + 1 : nodeRun.attemptCount,
      artifactIds: mergeArtifactIds(nodeRun.artifactIds, input.artifactIds),
      startedAt: input.status === 'running' ? nodeRun.startedAt ?? timestamp : nodeRun.startedAt,
      completedAt: ['completed', 'failed', 'skipped'].includes(input.status) ? timestamp : nodeRun.completedAt,
      updatedAt: timestamp
    };
  });

  const terminalNodeStatuses = new Set<ExecutionGraphNodeStatus>(['completed', 'skipped']);
  const nextPending = input.graphSpec.nodes
    .sort((left, right) => left.order - right.order)
    .find((node) => {
      const nodeRun = nodeRuns.find((candidate) => candidate.nodeId === node.id);
      return nodeRun ? !terminalNodeStatuses.has(nodeRun.status) && nodeRun.status !== 'failed' : false;
    });

  let nextRunStatus = input.graphRun.status;
  if (input.runStatus) {
    nextRunStatus = input.runStatus;
  } else if (input.status === 'running') {
    nextRunStatus = 'running';
  } else if (input.status === 'blocked') {
    nextRunStatus = 'blocked';
  } else if (input.status === 'failed') {
    nextRunStatus = 'failed';
  } else if (nodeRuns.every((nodeRun) => terminalNodeStatuses.has(nodeRun.status))) {
    nextRunStatus = 'completed';
  }

  return {
    ...input.graphRun,
    status: nextRunStatus,
    currentNodeId: ['completed', 'skipped'].includes(input.status) ? nextPending?.id ?? null : targetNode.id,
    startedAt: input.graphRun.startedAt ?? (input.status === 'running' ? timestamp : null),
    completedAt: ['completed', 'failed', 'cancelled'].includes(nextRunStatus) ? input.graphRun.completedAt ?? timestamp : null,
    updatedAt: timestamp,
    nodeRuns
  };
}

export function buildRunnerArtifacts(input: {
  runId: string;
  workItem: WorkItem;
  branchName: string | null;
  verificationSummary: RunnerVerificationSummary;
  proofOfWork: RunnerProofOfWork;
  prUrl: string | null;
  prNumber: number | null;
  createdAt: string;
}): ArtifactRecord[] {
  const artifacts: ArtifactRecord[] = [];

  if (input.verificationSummary.commands.length > 0) {
    artifacts.push({
      id: `${input.runId}:verification_log`,
      type: 'verification_log',
      label: 'Verification log',
      createdAt: input.createdAt,
      content: input.verificationSummary.commands
        .map((entry) => [`$ ${entry.command}`, entry.stdout.trim(), entry.stderr.trim()].filter(Boolean).join('\n'))
        .join('\n\n'),
      metadata: {
        commands: input.verificationSummary.commands
      }
    });
  }

  if (input.proofOfWork.changedFiles.length > 0 || input.proofOfWork.gitStatus.trim().length > 0) {
    artifacts.push({
      id: `${input.runId}:patch_bundle`,
      type: 'patch_bundle',
      label: 'Workspace diff summary',
      createdAt: input.createdAt,
      content: input.proofOfWork.gitStatus,
      metadata: {
        branchName: input.branchName,
        changedFiles: input.proofOfWork.changedFiles
      }
    });
  }

  if (input.proofOfWork.summary.length > 0) {
    artifacts.push({
      id: `${input.runId}:report`,
      type: 'report',
      label: 'Proof of work summary',
      createdAt: input.createdAt,
      content: input.proofOfWork.summary.join('\n'),
      metadata: {
        verificationPassed: input.proofOfWork.verificationPassed,
        workItemIdentifier: input.workItem.identifier
      }
    });
  }

  if (input.prUrl) {
    artifacts.push({
      id: `${input.runId}:pr_metadata`,
      type: 'pr_metadata',
      label: 'Pull request',
      createdAt: input.createdAt,
      content: input.prUrl,
      metadata: {
        prUrl: input.prUrl,
        prNumber: input.prNumber,
        branchName: input.branchName
      }
    });
  }

  return artifacts;
}

export function buildRunnerSessionState(input: {
  status: RunnerRunStatus;
  sessionSnapshot: RunnerSessionSnapshot | null;
  workspacePath: string | null;
  branchName: string | null;
  blockedReason: string | null;
  failureReason: string | null;
  updatedAt: string;
  workItem: WorkItem;
}): SessionStateSnapshot {
  return {
    status: mapRunnerStatusToSessionStatus(input.status),
    updatedAt: input.updatedAt,
    values: {
      sessionId: input.sessionSnapshot?.sessionId ?? null,
      actionProposalId: input.sessionSnapshot?.actionProposalId ?? null,
      sessionStatus: input.sessionSnapshot?.status ?? null,
      workspacePath: input.workspacePath,
      branchName: input.branchName,
      blockedReason: input.blockedReason,
      failureReason: input.failureReason,
      workItemIdentifier: input.workItem.identifier
    },
    promotionKeys: []
  };
}

export function hydrateRunnerRunRecord(run: RunnerRunHydrationInput): RunnerRunRecord {
  const artifacts = run.artifacts.length > 0
    ? run.artifacts
    : buildRunnerArtifacts({
        runId: run.id,
        workItem: run.workItem,
        branchName: run.branchName,
        verificationSummary: run.verificationSummary,
        proofOfWork: run.proofOfWork,
        prUrl: run.prUrl,
        prNumber: run.prNumber,
        createdAt: run.completedAt ?? run.updatedAt
      });

  const sessionState = run.sessionState ?? buildRunnerSessionState({
    status: run.status,
    sessionSnapshot: run.sessionSnapshot,
    workspacePath: run.workspacePath,
    branchName: run.branchName,
    blockedReason: run.blockedReason,
    failureReason: run.failureReason,
    updatedAt: run.updatedAt,
    workItem: run.workItem
  });

  return {
    ...run,
    artifacts,
    sessionState,
    graphRunId: run.graphRun?.id ?? null,
    currentNodeId: run.graphRun?.currentNodeId ?? null,
    artifactCount: artifacts.length
  };
}

export function buildRunnerCompatSteps(run: Pick<RunnerRunRecord, 'graphSpec' | 'graphRun'>): RunnerCompatStep[] {
  if (!run.graphSpec || !run.graphRun) {
    return [];
  }

  return [...run.graphSpec.nodes]
    .sort((left, right) => left.order - right.order)
    .map((node) => {
      const nodeRun = run.graphRun?.nodeRuns.find((entry) => entry.nodeId === node.id);
      return {
        id: node.id,
        key: node.key,
        title: node.title,
        kind: node.kind,
        order: node.order,
        route: node.route,
        status: nodeRun?.status ?? 'pending',
        summary: nodeRun?.summary ?? null
      };
    });
}
