import type { GitHubPrResult } from '../code-loop/adapters/github-pr';
import { GraphCallbackRegistry } from '../graph-runtime/callbacks';
import type {
  ArtifactRecord,
  ExecutionGraphNode,
  ExecutionGraphNodeStatus,
  ExecutionGraphSpec,
  JarvisSessionRecord,
  JarvisStore,
  RunnerRunRecord,
  WorkflowContract
} from '../store/types';

export type ShellCommandResult = {
  command: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  blockedReason?: string;
};

export type WorkflowCommandExecutionResult = {
  continueExecution: boolean;
  disposition: 'completed' | 'blocked' | 'retry' | 'failed';
  reason?: string;
  results: ShellCommandResult[];
};

export type RunnerGraphRuntimeState = {
  run: RunnerRunRecord;
  session: JarvisSessionRecord;
  workflow: WorkflowContract;
  graphSpec: ExecutionGraphSpec;
  callbacks: GraphCallbackRegistry;
  workspacePath: string;
  worktreeCreated: boolean;
  branchName: string;
  prompt: string;
  executionContext: Record<string, unknown>;
  codexCommand: string;
  verificationResult?: WorkflowCommandExecutionResult;
  changedFiles?: string[];
  gitStatus?: string;
  prResult?: GitHubPrResult;
  artifacts: ArtifactRecord[];
};

export type UpdateRunSnapshotInput = {
  patch: Parameters<JarvisStore['updateRunnerRun']>[0];
  nodeKey?: string;
  nodeStatus?: ExecutionGraphNodeStatus;
  nodeSummary?: string | null;
  nodeError?: string | null;
  appendArtifacts?: ArtifactRecord[];
};

type CreateRunnerGraphCallbacksInput = {
  state: RunnerGraphRuntimeState;
  store: JarvisStore;
  updateRunSnapshot: (run: RunnerRunRecord, input: UpdateRunSnapshotInput) => Promise<RunnerRunRecord>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function getStageDescriptor(node: Pick<ExecutionGraphNode, 'key' | 'title'>) {
  if (node.key === 'handoff') {
    return {
      stageKey: 'handoff',
      capability: 'notify' as const,
      title: 'PR handoff'
    };
  }
  if (node.key === 'verification') {
    return {
      stageKey: 'verify',
      capability: 'execute' as const,
      title: 'Verification'
    };
  }
  return {
    stageKey: node.key,
    capability: 'execute' as const,
    title: node.title
  };
}

function buildStageArtifactRefs(state: RunnerGraphRuntimeState, nodeKey: string): Record<string, unknown> | undefined {
  if (nodeKey === 'handoff' && state.prResult) {
    return {
      pr_url: state.prResult.url,
      pr_number: state.prResult.number,
      branch: state.branchName
    };
  }
  if (nodeKey === 'verification' && state.verificationResult) {
    return {
      verification_command_count: state.verificationResult.results.length,
      changed_files: state.changedFiles ?? []
    };
  }
  return undefined;
}

export function createRunnerGraphCallbacks(input: CreateRunnerGraphCallbacksInput): GraphCallbackRegistry {
  const callbacks = new GraphCallbackRegistry();

  callbacks.register('beforeGraph', async () => {
    await input.store.appendJarvisSessionEvent({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      eventType: 'runner.run.started',
      status: 'running',
      summary: input.state.run.workItem.title,
      data: {
        runner_run_id: input.state.run.id,
        work_item: input.state.run.workItem.identifier,
        workspace_path: input.state.workspacePath
      }
    });
  });

  callbacks.register('beforeNode', async ({ node, graphRun }) => {
    input.state.run = await input.updateRunSnapshot(input.state.run, {
      patch: {
        runId: input.state.run.id,
        graphRun,
        lastHeartbeatAt: nowIso()
      }
    });
    const stage = getStageDescriptor(node);
    await input.store.upsertJarvisSessionStage({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      stageKey: stage.stageKey,
      capability: stage.capability,
      title: stage.title,
      status: 'running',
      summary: node.key === 'execute' ? input.state.codexCommand : node.title
    });
  });

  callbacks.register('afterNode', async ({ node, graphRun }) => {
    input.state.run = await input.updateRunSnapshot(input.state.run, {
      patch: {
        runId: input.state.run.id,
        graphRun,
        lastHeartbeatAt: nowIso()
      }
    });
    const stage = getStageDescriptor(node);
    await input.store.upsertJarvisSessionStage({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      stageKey: stage.stageKey,
      capability: stage.capability,
      title: stage.title,
      status: 'completed',
      summary:
        node.key === 'verification'
          ? input.state.verificationResult?.results.length
            ? 'Verification passed'
            : 'No verification configured'
          : node.key === 'handoff'
            ? input.state.prResult?.url ?? stage.title
            : node.title,
      artifactRefsJson: buildStageArtifactRefs(input.state, node.key),
      completedAt: nowIso()
    });
  });

  callbacks.register('beforeTool', async ({ node, invocation }) => {
    await input.store.appendJarvisSessionEvent({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      eventType: 'runner.tool.started',
      status: 'running',
      summary: invocation.name,
      data: {
        runner_run_id: input.state.run.id,
        node_key: node.key,
        tool_source: invocation.source
      }
    });
  });

  callbacks.register('afterTool', async ({ node, invocation, result }) => {
    await input.store.appendJarvisSessionEvent({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      eventType: 'runner.tool.completed',
      status: 'completed',
      summary: invocation.name,
      data: {
        runner_run_id: input.state.run.id,
        node_key: node.key,
        tool_source: invocation.source,
        result:
          typeof result === 'object' && result !== null
            ? result
            : {
                value: result
              }
      }
    });
  });

  callbacks.register('onRetry', async ({ node, reason }) => {
    await input.store.appendJarvisSessionEvent({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      eventType: 'runner.run.retry_scheduled',
      status: 'queued',
      summary: reason,
      data: {
        runner_run_id: input.state.run.id,
        node_key: node.key
      }
    });
  });

  callbacks.register('onArtifact', async ({ node, artifact }) => {
    await input.store.appendJarvisSessionEvent({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      eventType: 'runner.artifact.created',
      status: 'completed',
      summary: artifact.label,
      data: {
        runner_run_id: input.state.run.id,
        node_key: node.key,
        artifact_id: artifact.id,
        artifact_type: artifact.type
      }
    });
  });

  callbacks.register('onBlocked', async ({ node, graphRun, reason }) => {
    input.state.run = await input.updateRunSnapshot(input.state.run, {
      patch: {
        runId: input.state.run.id,
        graphRun,
        lastHeartbeatAt: nowIso()
      }
    });
    await input.store.appendJarvisSessionEvent({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      eventType: 'runner.graph.blocked',
      status: 'blocked',
      summary: reason,
      data: {
        runner_run_id: input.state.run.id,
        node_key: node.key
      }
    });
  });

  callbacks.register('onFail', async ({ node, graphRun, error }) => {
    input.state.run = await input.updateRunSnapshot(input.state.run, {
      patch: {
        runId: input.state.run.id,
        graphRun,
        lastHeartbeatAt: nowIso()
      }
    });
    if (!node) {
      return;
    }
    const stage = getStageDescriptor(node);
    await input.store.upsertJarvisSessionStage({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      stageKey: stage.stageKey,
      capability: stage.capability,
      title: stage.title,
      status: 'failed',
      summary: error.message,
      errorMessage: error.message,
      completedAt: nowIso()
    });
  });

  callbacks.register('afterGraph', async ({ graphRun }) => {
    await input.store.appendJarvisSessionEvent({
      userId: input.state.run.userId,
      sessionId: input.state.session.id,
      eventType: 'runner.graph.completed',
      status:
        graphRun.status === 'blocked'
          ? 'blocked'
          : graphRun.status === 'failed'
            ? 'failed'
            : 'completed',
      summary: graphRun.status,
      data: {
        runner_run_id: input.state.run.id,
        graph_run_id: graphRun.id,
        graph_status: graphRun.status
      }
    });
  });

  return callbacks;
}
