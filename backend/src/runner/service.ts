import { existsSync } from 'node:fs';

import type { AppEnv } from '../config/env';
import { createDerivedExternalWorkLink } from '../external-work/service';
import { executeExecutionGraph, GraphExecutionHalt } from '../graph-runtime/executor';
import {
  buildRunnerArtifacts,
  buildRunnerSessionState,
  createGraphRun,
  createRunnerExecutionGraph,
  updateGraphRunNode
} from '../graph-runtime/graph';
import { createGitHubBranchAndPr } from '../code-loop/adapters/github-pr';
import type {
  ActionProposalRecord,
  ArtifactRecord,
  ExecutionGraphNode,
  ExecutionGraphNodeStatus,
  JarvisSessionRecord,
  JarvisStore,
  RunnerRunRecord,
  RunnerStateRecord,
  WorkItem,
  WorkflowContract
} from '../store/types';
import type { NotificationService } from '../notifications/proactive';
import { evaluateToolInvocationPolicy } from '../tools/gateway';
import {
  createRunnerGraphCallbacks,
  type RunnerGraphRuntimeState,
  type ShellCommandResult,
  type WorkflowCommandExecutionResult
} from './graph-callbacks';
import { listInternalTaskWorkItems } from './internal-task-adapter';
import { listLinearWorkItems } from './linear-adapter';
import {
  completeRunnerHandoff,
  createRunnerApprovalProposal,
  failRunnerRun,
  scheduleRunnerRetry
} from './run-effects';
import { loadWorkflowContract, renderWorkflowTemplate } from './workflow-contract';
import {
  commitAndPushChanges,
  ensureLocalBranch,
  ensureRunnerWorktree,
  getGitStatus,
  listChangedFiles,
  removeRunnerWorktree,
  resolveRunnerRepoRoot,
  runShellCommand,
  terminateProcessGroup
} from './workspace';

type LoggerLike = {
  info?: (message: string, data?: Record<string, unknown>) => void;
  warn?: (message: string, data?: Record<string, unknown>) => void;
  error?: (message: string, data?: Record<string, unknown>) => void;
};

export type RunnerSnapshot = {
  state: RunnerStateRecord;
  stats: {
    claimed: number;
    running: number;
    retryQueued: number;
    blocked: number;
    humanReviewReady: number;
    failed: number;
    cancelled: number;
    released: number;
  };
  metrics: RunnerOperationalMetrics;
  runs: RunnerRunRecord[];
};

export type RunnerOperationalMetrics = {
  dueRetryRuns: number;
  stalledRuns: number;
  terminalCleanupPending: number;
  workflowErrorCount: number;
  recentErrorCount: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function truncate(input: string, maxLength = 280): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}...`;
}

function createLogger(logger?: LoggerLike): Required<LoggerLike> {
  return {
    info: logger?.info ?? ((message, data) => console.info(message, data ?? {})),
    warn: logger?.warn ?? ((message, data) => console.warn(message, data ?? {})),
    error: logger?.error ?? ((message, data) => console.error(message, data ?? {}))
  };
}

export function buildRunnerStats(runs: RunnerRunRecord[]): RunnerSnapshot['stats'] {
  return runs.reduce<RunnerSnapshot['stats']>(
    (accumulator, run) => {
      if (run.status === 'claimed') accumulator.claimed += 1;
      else if (run.status === 'running') accumulator.running += 1;
      else if (run.status === 'retry_queued') accumulator.retryQueued += 1;
      else if (run.status === 'blocked_needs_approval') accumulator.blocked += 1;
      else if (run.status === 'human_review_ready') accumulator.humanReviewReady += 1;
      else if (run.status === 'failed_terminal') accumulator.failed += 1;
      else if (run.status === 'cancelled') accumulator.cancelled += 1;
      else if (run.status === 'released') accumulator.released += 1;
      return accumulator;
    },
    {
      claimed: 0,
      running: 0,
      retryQueued: 0,
      blocked: 0,
      humanReviewReady: 0,
      failed: 0,
      cancelled: 0,
      released: 0
    }
  );
}

export function buildRunnerOperationalMetrics(input: {
  state: Pick<RunnerStateRecord, 'workflowErrors' | 'recentErrors'>;
  runs: RunnerRunRecord[];
  stallTimeoutMs: number;
  nowMs?: number;
}): RunnerOperationalMetrics {
  const nowMs = input.nowMs ?? Date.now();
  let dueRetryRuns = 0;
  let stalledRuns = 0;
  let terminalCleanupPending = 0;

  for (const run of input.runs) {
    if (run.status === 'retry_queued' && (!run.nextRetryAt || Date.parse(run.nextRetryAt) <= nowMs)) {
      dueRetryRuns += 1;
    }

    if (run.status === 'running' && run.lastHeartbeatAt) {
      const lastHeartbeatAtMs = Date.parse(run.lastHeartbeatAt);
      if (Number.isFinite(lastHeartbeatAtMs) && nowMs - lastHeartbeatAtMs > input.stallTimeoutMs) {
        stalledRuns += 1;
      }
    }

    if (
      run.workspacePath &&
      (run.status === 'failed_terminal' || run.status === 'cancelled' || run.status === 'released') &&
      existsSync(run.workspacePath)
    ) {
      terminalCleanupPending += 1;
    }
  }

  return {
    dueRetryRuns,
    stalledRuns,
    terminalCleanupPending,
    workflowErrorCount: input.state.workflowErrors.length,
    recentErrorCount: input.state.recentErrors.length
  };
}

function buildPromptContext(workItem: WorkItem, workflow: WorkflowContract, workspacePath: string, prompt = ''): Record<string, unknown> {
  return {
    workItem,
    workspace: {
      cwd: workspacePath,
      kind: workflow.workspace.type
    },
    repo: {
      root: workspacePath
    },
    prompt
  };
}

function buildBackoffMs(contract: WorkflowContract, attemptCount: number): number {
  return Math.min(contract.polling.retryBaseMs * Math.max(1, 2 ** Math.max(0, attemptCount - 1)), contract.polling.retryMaxMs);
}

function mergeArtifacts(current: ArtifactRecord[], next: ArtifactRecord[]): ArtifactRecord[] {
  if (next.length === 0) {
    return current;
  }
  const artifactMap = new Map(current.map((artifact) => [artifact.id, artifact]));
  for (const artifact of next) {
    artifactMap.set(artifact.id, artifact);
  }
  return [...artifactMap.values()];
}

function mapCategoryToNodeKey(category: string): string {
  if (category === 'after_create') return 'after_create';
  if (category === 'before_run') return 'before_run';
  if (category === 'after_run') return 'after_run';
  if (category === 'verification') return 'verification';
  if (category === 'handoff') return 'handoff';
  return 'execute';
}

function resolveCurrentNodeKey(run: RunnerRunRecord): string | null {
  if (!run.graphSpec || !run.currentNodeId) {
    return null;
  }
  return run.graphSpec.nodes.find((node) => node.id === run.currentNodeId)?.key ?? null;
}

export class DeliveryRunnerService {
  private readonly repoRoot: string;
  private readonly logger: Required<LoggerLike>;
  private readonly notificationService?: NotificationService;
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private refreshInFlight: Promise<RunnerSnapshot> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastKnownGoodWorkflow: WorkflowContract | null = null;

  constructor(
    private readonly store: JarvisStore,
    private readonly env: AppEnv,
    notificationService?: NotificationService,
    logger?: LoggerLike
  ) {
    this.repoRoot = resolveRunnerRepoRoot(env.RUNNER_REPO_ROOT);
    this.logger = createLogger(logger);
    this.notificationService = notificationService;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.refreshOnce('startup');
    this.timer = setInterval(() => {
      void this.refreshOnce('interval');
    }, this.env.RUNNER_POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async requestRefresh(): Promise<RunnerSnapshot> {
    await this.store.upsertRunnerState({
      refreshRequestedAt: nowIso()
    });
    return this.getSnapshot();
  }

  async getSnapshot(limit = 50): Promise<RunnerSnapshot> {
    const [state, runs] = await Promise.all([
      this.store.getRunnerState(),
      this.store.listRunnerRuns({ limit })
    ]);
    const stallTimeoutMs = this.lastKnownGoodWorkflow?.polling.stallTimeoutMs ?? this.env.RUNNER_POLL_INTERVAL_MS * 5;
    return {
      state,
      stats: buildRunnerStats(runs),
      metrics: buildRunnerOperationalMetrics({
        state,
        runs,
        stallTimeoutMs
      }),
      runs
    };
  }

  async refreshOnce(reason: string): Promise<RunnerSnapshot> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.performRefresh(reason).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private createInitialRunState(workflow: WorkflowContract, workItem: WorkItem, createdAt: string) {
    const graphSpec = createRunnerExecutionGraph({
      workflow,
      workItem,
      createdAt
    });
    return {
      graphSpec,
      graphRun: createGraphRun(graphSpec, createdAt),
      sessionState: buildRunnerSessionState({
        status: 'claimed',
        sessionSnapshot: null,
        workspacePath: null,
        branchName: workItem.branchName ?? null,
        blockedReason: null,
        failureReason: null,
        updatedAt: createdAt,
        workItem
      })
    };
  }

  private async updateRunSnapshot(
    run: RunnerRunRecord,
    input: {
      patch: Parameters<JarvisStore['updateRunnerRun']>[0];
      nodeKey?: string;
      nodeStatus?: ExecutionGraphNodeStatus;
      nodeSummary?: string | null;
      nodeError?: string | null;
      appendArtifacts?: ArtifactRecord[];
    }
  ): Promise<RunnerRunRecord> {
    const updatedAt = input.patch.completedAt ?? input.patch.lastHeartbeatAt ?? nowIso();
    const graphSpec = input.patch.graphSpec === undefined ? run.graphSpec : input.patch.graphSpec;
    const baseGraphRun = input.patch.graphRun === undefined ? run.graphRun : input.patch.graphRun;
    const nextArtifacts = input.patch.artifacts
      ? input.patch.artifacts
      : input.appendArtifacts
      ? mergeArtifacts(run.artifacts, input.appendArtifacts)
      : run.artifacts;
    const nextGraphRun = graphSpec && (baseGraphRun || input.nodeKey)
      ? input.nodeKey
        ? updateGraphRunNode({
            graphSpec,
            graphRun: baseGraphRun ?? createGraphRun(graphSpec, updatedAt),
            nodeKey: input.nodeKey,
            status: input.nodeStatus ?? 'running',
            timestamp: updatedAt,
            summary: input.nodeSummary,
            error: input.nodeError,
            artifactIds: input.appendArtifacts?.map((artifact) => artifact.id)
          })
        : baseGraphRun
      : null;

    const previewStatus = input.patch.status ?? run.status;
    const previewSessionSnapshot = input.patch.sessionSnapshot === undefined ? run.sessionSnapshot : input.patch.sessionSnapshot;
    const previewWorkspacePath = input.patch.workspacePath === undefined ? run.workspacePath : input.patch.workspacePath;
    const previewBranchName = input.patch.branchName === undefined ? run.branchName : input.patch.branchName;
    const previewBlockedReason = input.patch.blockedReason === undefined ? run.blockedReason : input.patch.blockedReason;
    const previewFailureReason = input.patch.failureReason === undefined ? run.failureReason : input.patch.failureReason;

    return (
      (await this.store.updateRunnerRun({
        ...input.patch,
        graphRun: nextGraphRun,
        sessionState:
          input.patch.sessionState
          ?? buildRunnerSessionState({
            status: previewStatus,
            sessionSnapshot: previewSessionSnapshot,
            workspacePath: previewWorkspacePath,
            branchName: previewBranchName,
            blockedReason: previewBlockedReason,
            failureReason: previewFailureReason,
            updatedAt,
            workItem: run.workItem
          }),
        artifacts: nextArtifacts
      })) ?? run
    );
  }

  private async executeRunnerGraphNode(state: RunnerGraphRuntimeState, node: ExecutionGraphNode): Promise<unknown> {
    if (node.key === 'after_create') {
      if (!state.worktreeCreated) {
        return {
          skipped: true
        };
      }
      const result = await this.runWorkflowCommands({
        runtimeState: state,
        node,
        run: state.run,
        session: state.session,
        workflow: state.workflow,
        workspacePath: state.workspacePath,
        commands: state.workflow.hooks.afterCreate,
        category: 'after_create',
        allowAutoRun: state.workflow.agent.autoApproveMainCommand
      });
      if (!result.continueExecution) {
        throw new GraphExecutionHalt({
          message: result.reason ?? result.disposition,
          nodeStatus: result.disposition === 'blocked' ? 'blocked' : 'failed',
          graphStatus: result.disposition === 'retry' ? 'queued' : result.disposition === 'blocked' ? 'blocked' : 'failed'
        });
      }
      return result;
    }

    if (node.key === 'before_run') {
      const result = await this.runWorkflowCommands({
        runtimeState: state,
        node,
        run: state.run,
        session: state.session,
        workflow: state.workflow,
        workspacePath: state.workspacePath,
        commands: state.workflow.hooks.beforeRun,
        category: 'before_run',
        allowAutoRun: state.workflow.agent.autoApproveMainCommand
      });
      if (!result.continueExecution) {
        throw new GraphExecutionHalt({
          message: result.reason ?? result.disposition,
          nodeStatus: result.disposition === 'blocked' ? 'blocked' : 'failed',
          graphStatus: result.disposition === 'retry' ? 'queued' : result.disposition === 'blocked' ? 'blocked' : 'failed'
        });
      }
      return result;
    }

    if (node.key === 'execute') {
      const mainExecution = await runShellCommand({
        cwd: state.workspacePath,
        shell: state.workflow.codex.shell,
        command: state.codexCommand,
        onStarted: async (pid) => {
          state.run =
            (await this.store.updateRunnerRun({
              runId: state.run.id,
              lastProcessPid: pid,
              lastHeartbeatAt: nowIso()
            })) ?? state.run;
        },
        onHeartbeat: async () => {
          state.run =
            (await this.store.updateRunnerRun({
              runId: state.run.id,
              lastHeartbeatAt: nowIso()
            })) ?? state.run;
        }
      });

      state.run = await this.updateRunSnapshot(state.run, {
        patch: {
          runId: state.run.id,
          lastProcessPid: 0,
          lastHeartbeatAt: nowIso()
        }
      });

      if (mainExecution.exitCode !== 0) {
        const reason = truncate(mainExecution.stderr || mainExecution.stdout || `codex_exit_${mainExecution.exitCode}`);
        await this.scheduleRetry(state.run, reason);
        await state.callbacks.emit('onRetry', {
          graph: state.graphSpec,
          graphRun: state.run.graphRun ?? createGraphRun(state.graphSpec, nowIso()),
          node,
          state: state.executionContext,
          reason
        });
        throw new GraphExecutionHalt({
          message: reason,
          nodeStatus: 'failed',
          graphStatus: 'queued'
        });
      }

      return mainExecution;
    }

    if (node.key === 'after_run') {
      const result = await this.runWorkflowCommands({
        runtimeState: state,
        node,
        run: state.run,
        session: state.session,
        workflow: state.workflow,
        workspacePath: state.workspacePath,
        commands: state.workflow.hooks.afterRun,
        category: 'after_run',
        allowAutoRun: state.workflow.agent.autoApproveMainCommand
      });
      if (!result.continueExecution) {
        throw new GraphExecutionHalt({
          message: result.reason ?? result.disposition,
          nodeStatus: result.disposition === 'blocked' ? 'blocked' : 'failed',
          graphStatus: result.disposition === 'retry' ? 'queued' : result.disposition === 'blocked' ? 'blocked' : 'failed'
        });
      }
      return result;
    }

    if (node.key === 'verification') {
      const verificationResult = await this.runWorkflowCommands({
        runtimeState: state,
        node,
        run: state.run,
        session: state.session,
        workflow: state.workflow,
        workspacePath: state.workspacePath,
        commands: state.workflow.codex.verificationCommands,
        category: 'verification',
        allowAutoRun: state.workflow.agent.autoApproveMainCommand
      });
      state.verificationResult = verificationResult;
      if (!verificationResult.continueExecution) {
        throw new GraphExecutionHalt({
          message: verificationResult.reason ?? verificationResult.disposition,
          nodeStatus: verificationResult.disposition === 'blocked' ? 'blocked' : 'failed',
          graphStatus: verificationResult.disposition === 'retry' ? 'queued' : verificationResult.disposition === 'blocked' ? 'blocked' : 'failed'
        });
      }
      return verificationResult;
    }

    if (node.key === 'handoff') {
      const changedFiles = listChangedFiles({ cwd: state.workspacePath });
      state.changedFiles = changedFiles;
      if (changedFiles.length === 0) {
        const reason = 'no_changes_detected';
        await this.failRun(state.run, reason);
        throw new GraphExecutionHalt({
          message: reason,
          nodeStatus: 'failed',
          graphStatus: 'failed'
        });
      }

      const gitStatus = getGitStatus({ cwd: state.workspacePath });
      state.gitStatus = gitStatus;
      const commitMessage = `[Runner] ${state.run.workItem.identifier} ${truncate(state.run.workItem.title, 72)}`;
      try {
        commitAndPushChanges({
          cwd: state.workspacePath,
          branchName: state.branchName,
          commitMessage
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'git_push_failed';
        await this.failRun(state.run, reason);
        throw new GraphExecutionHalt({
          message: reason,
          nodeStatus: 'failed',
          graphStatus: 'failed'
        });
      }

      if (!this.env.GITHUB_TOKEN || !this.env.GITHUB_OWNER || !this.env.GITHUB_REPO) {
        const reason = 'github_configuration_missing';
        await this.failRun(state.run, reason);
        throw new GraphExecutionHalt({
          message: reason,
          nodeStatus: 'failed',
          graphStatus: 'failed'
        });
      }

      const prTitle = renderWorkflowTemplate(state.workflow.codex.pullRequest.titleTemplate, {
        ...state.executionContext,
        prompt: state.prompt
      });
      const prBody = renderWorkflowTemplate(state.workflow.codex.pullRequest.bodyTemplate, {
        ...state.executionContext,
        prompt: state.prompt
      });

      try {
        state.prResult = await createGitHubBranchAndPr(
          {
            token: this.env.GITHUB_TOKEN,
            owner: this.env.GITHUB_OWNER,
            repo: this.env.GITHUB_REPO,
            baseBranch: 'main'
          },
          {
            branchName: state.branchName,
            title: prTitle,
            body: prBody,
            draft: state.workflow.codex.pullRequest.draft
          }
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'github_pr_failed';
        await this.failRun(state.run, reason);
        throw new GraphExecutionHalt({
          message: reason,
          nodeStatus: 'failed',
          graphStatus: 'failed'
        });
      }

      const verificationSummary = {
        commands: state.verificationResult?.results ?? []
      };
      const proofOfWork = {
        verificationPassed: verificationSummary.commands.every((entry) => entry.ok),
        changedFiles,
        gitStatus,
        summary: [
          `branch=${state.branchName}`,
          `pr=${state.prResult.url}`,
          `changed_files=${changedFiles.length}`,
          ...verificationSummary.commands.map((entry) => `${entry.command}:exit=${entry.exitCode}`)
        ]
      };
      state.artifacts = buildRunnerArtifacts({
        runId: state.run.id,
        workItem: state.run.workItem,
        branchName: state.branchName,
        verificationSummary,
        proofOfWork,
        prUrl: state.prResult.url,
        prNumber: state.prResult.number,
        createdAt: nowIso()
      });
      for (const artifact of state.artifacts) {
        await state.callbacks.emit('onArtifact', {
          graph: state.graphSpec,
          graphRun: state.run.graphRun ?? createGraphRun(state.graphSpec, nowIso()),
          node,
          state: state.executionContext,
          artifact
        });
      }

      return {
        verificationSummary,
        proofOfWork,
        prResult: state.prResult,
        artifacts: state.artifacts
      };
    }

    return null;
  }

  private async performRefresh(reason: string): Promise<RunnerSnapshot> {
    const loadedAt = nowIso();
    const workflowResult = loadWorkflowContract({
      repoRoot: this.repoRoot,
      loadedAt
    });

    if (!workflowResult.contract) {
      await this.store.upsertRunnerState({
        dispatchEnabled: false,
        refreshedAt: loadedAt,
        workflowPath: workflowResult.sourcePath,
        workflowValidation: 'invalid',
        workflowErrors: workflowResult.errors
      });
      await this.recordStateError(workflowResult.errors.map((entry) => entry.message).join('; '));
      this.notificationService?.emitRunnerWorkflowInvalid(
        workflowResult.sourcePath,
        workflowResult.errors.map((entry) => `${entry.path}: ${entry.message}`)
      );
      if (this.lastKnownGoodWorkflow) {
        await this.reconcileRuns(this.lastKnownGoodWorkflow);
      }
      return this.getSnapshot();
    }

    const workflow = workflowResult.contract;
    const activeSources = workflow.tracker.sources.filter((source) =>
      source === 'linear' ? this.env.RUNNER_LINEAR_DIRECT_ENABLED : true
    );
    this.lastKnownGoodWorkflow = workflow;
    await this.store.upsertRunnerState({
      dispatchEnabled: true,
      refreshedAt: loadedAt,
      workflowPath: workflow.sourcePath,
      workflowValidation: 'valid',
      workflowErrors: [],
      lastLoadedWorkflowAt: workflow.loadedAt,
      lastLoopStartedAt: loadedAt,
      activeSources
    });

    await this.reconcileRuns(workflow);

    const availableSlots = Math.max(workflow.polling.maxConcurrentRuns - this.activeExecutions.size, 0);
    if (availableSlots === 0) {
      this.logger.info('runner refresh skipped due to concurrency', { reason });
      return this.getSnapshot();
    }

    const retryRuns = await this.listDueRetryRuns(availableSlots);
    for (const run of retryRuns) {
      this.launchRun(workflow, run);
    }

    const remainingSlots = Math.max(workflow.polling.maxConcurrentRuns - this.activeExecutions.size, 0);
    if (remainingSlots > 0) {
      const workItems = await this.listCandidateWorkItems(workflow, workflow.polling.batchSize);
      for (const workItem of workItems) {
        if (this.activeExecutions.size >= workflow.polling.maxConcurrentRuns) {
          break;
        }
        const active = await this.store.findActiveRunnerRunByWorkItem({
          source: workItem.source,
          identifier: workItem.identifier
        });
        if (active) {
          continue;
        }
        const initialState = this.createInitialRunState(workflow, workItem, loadedAt);
        const run = await this.store.createRunnerRun({
          userId: workItem.userId,
          workItem,
          claimState: 'claimed',
          status: 'claimed',
          graphSpec: initialState.graphSpec,
          graphRun: initialState.graphRun,
          sessionState: initialState.sessionState,
          artifacts: []
        });
        if (workItem.taskId) {
          await this.store.setTaskStatus({
            taskId: workItem.taskId,
            status: 'running',
            eventType: 'task.runner_claimed',
            data: {
              runner_run_id: run.id
            }
          });
          await createDerivedExternalWorkLink(this.store, {
            fromTargetType: 'task',
            fromTargetId: workItem.taskId,
            toTargetType: 'runner',
            toTargetId: run.id
          });
        }
        this.launchRun(workflow, run);
      }
    }

    this.logger.info('runner refresh complete', { reason });
    return this.getSnapshot();
  }

  private async listCandidateWorkItems(workflow: WorkflowContract, limit: number): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    if (workflow.tracker.sources.includes('internal_task')) {
      items.push(...(await listInternalTaskWorkItems(this.store, limit)));
    }
    if (this.env.RUNNER_LINEAR_DIRECT_ENABLED && workflow.tracker.sources.includes('linear')) {
      items.push(...(await listLinearWorkItems(this.env, limit, this.env.DEFAULT_USER_ID)));
    }
    return items.slice(0, limit);
  }

  private async listDueRetryRuns(limit: number): Promise<RunnerRunRecord[]> {
    const runs = await this.store.listRunnerRuns({
      status: 'retry_queued',
      limit: 100
    });
    const now = Date.now();
    return runs
      .filter((run) => !this.activeExecutions.has(run.id))
      .filter((run) => !run.nextRetryAt || Date.parse(run.nextRetryAt) <= now)
      .slice(0, limit);
  }

  private launchRun(workflow: WorkflowContract, run: RunnerRunRecord): void {
    const execution = this.executeRun(workflow, run)
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        await this.failRun(run, message);
      })
      .finally(() => {
        this.activeExecutions.delete(run.id);
      });
    this.activeExecutions.set(run.id, execution);
  }

  private async reconcileRuns(workflow: WorkflowContract): Promise<void> {
    const runs = await this.store.listRunnerRuns({ limit: 200 });
    for (const run of runs) {
      if (this.activeExecutions.has(run.id)) {
        continue;
      }
      if (run.status === 'blocked_needs_approval') {
        await this.reconcileApprovalBlockedRun(run);
        continue;
      }
      if (run.status === 'running' && run.lastHeartbeatAt) {
        const stalledMs = Date.now() - Date.parse(run.lastHeartbeatAt);
        if (stalledMs > workflow.polling.stallTimeoutMs) {
          const terminated =
            this.env.RUNNER_STALL_TERMINATE_ENABLED && typeof run.lastProcessPid === 'number' && run.lastProcessPid > 0
              ? terminateProcessGroup(run.lastProcessPid)
              : false;
          const reason = `runner_stall_detected:${stalledMs}`;
          const message = terminated
            ? `runner stalled after ${stalledMs}ms; terminated pid ${run.lastProcessPid ?? 0} and queued retry`
            : `runner stalled after ${stalledMs}ms; queued retry`;
          await this.recordStateError(message, run);
          this.notificationService?.emitRunnerRunStalled(run.id, run.workItem.title, message);
          await this.scheduleRetry(run, reason);
          continue;
        }
      }
      if (
        workflow.workspace.cleanupOnTerminal &&
        run.workspacePath &&
        (run.status === 'failed_terminal' || run.status === 'cancelled' || run.status === 'released')
      ) {
        try {
          removeRunnerWorktree({
            repoRoot: this.repoRoot,
            workspacePath: run.workspacePath
          });
        } catch (error) {
          await this.recordStateError(error instanceof Error ? error.message : String(error), run);
        }
      }
    }
  }

  private async reconcileApprovalBlockedRun(run: RunnerRunRecord): Promise<void> {
    const sessionId = run.sessionSnapshot?.sessionId;
    const actionProposalId = run.sessionSnapshot?.actionProposalId;
    if (!sessionId || !actionProposalId) {
      return;
    }
    const proposals = await this.store.listActionProposals({
      userId: run.userId,
      sessionId,
      limit: 20
    });
    const proposal = proposals.find((entry) => entry.id === actionProposalId);
    if (!proposal) {
      return;
    }
    if (proposal.status === 'approved') {
      await this.updateRunSnapshot(run, {
        patch: {
          runId: run.id,
          claimState: 'retry_queued',
          status: 'retry_queued',
          blockedReason: '',
          nextRetryAt: nowIso(),
          lastHeartbeatAt: nowIso(),
          sessionSnapshot: {
            sessionId,
            actionProposalId,
            status: 'queued',
            updatedAt: nowIso()
          }
        }
      });
      if (run.workItem.taskId) {
        await this.store.setTaskStatus({
          taskId: run.workItem.taskId,
          status: 'retrying',
          eventType: 'task.runner_resumed',
          data: {
            runner_run_id: run.id,
            action_proposal_id: actionProposalId
          }
        });
      }
      return;
    }
    if (proposal.status === 'rejected') {
      await this.failRun(run, 'approval_rejected');
    }
  }

  private async executeRun(workflow: WorkflowContract, initialRun: RunnerRunRecord): Promise<void> {
    const worktree = ensureRunnerWorktree({
      repoRoot: this.repoRoot,
      rootDir: workflow.workspace.rootDir,
      workspaceKey: initialRun.workItem.workspaceKey,
      baseRef: workflow.workspace.baseRef
    });
    const branchName = initialRun.branchName ?? initialRun.workItem.branchName ?? `runner/${initialRun.workItem.externalId}`;
    ensureLocalBranch({
      cwd: worktree.workspacePath,
      branchName,
      baseRef: workflow.workspace.baseRef
    });

    const run = await this.updateRunSnapshot(initialRun, {
      patch: {
        runId: initialRun.id,
        claimState: 'running',
        status: 'running',
        workspacePath: worktree.workspacePath,
        workspaceKind: workflow.workspace.type,
        branchName,
        startedAt: initialRun.startedAt ?? nowIso(),
        lastHeartbeatAt: nowIso(),
        blockedReason: '',
        failureReason: ''
      }
    });

    const promptContext = buildPromptContext(run.workItem, workflow, worktree.workspacePath);
    const session = await this.ensureSession(run, workflow, promptContext);
    const prompt = renderWorkflowTemplate(workflow.agent.promptTemplate, promptContext);
    const executionContext = buildPromptContext(run.workItem, workflow, worktree.workspacePath, prompt);
    const codexCommand = renderWorkflowTemplate(workflow.codex.command, executionContext);
    const graphSpec = run.graphSpec ?? createRunnerExecutionGraph({
      workflow,
      workItem: run.workItem,
      createdAt: nowIso()
    });
    const runtimeState: RunnerGraphRuntimeState = {
      run,
      session,
      workflow,
      graphSpec,
      callbacks: null as never,
      workspacePath: worktree.workspacePath,
      worktreeCreated: worktree.created,
      branchName,
      prompt,
      executionContext,
      codexCommand,
      artifacts: []
    };
    runtimeState.callbacks = createRunnerGraphCallbacks({
      state: runtimeState,
      store: this.store,
      updateRunSnapshot: (currentRun, input) => this.updateRunSnapshot(currentRun, input)
    });

    const graphResult = await executeExecutionGraph(graphSpec, {
      callbacks: runtimeState.callbacks,
      maxConcurrency: 1,
      defaultExecutor: async ({ node }) => this.executeRunnerGraphNode(runtimeState, node)
    });

    runtimeState.run =
      (await this.store.getRunnerRunById({
        runId: runtimeState.run.id,
        userId: runtimeState.run.userId
      })) ?? runtimeState.run;
    runtimeState.run = await this.updateRunSnapshot(runtimeState.run, {
      patch: {
        runId: runtimeState.run.id,
        graphSpec,
        graphRun: graphResult.graphRun,
        lastHeartbeatAt: nowIso()
      },
      appendArtifacts: runtimeState.artifacts
    });

    if (graphResult.halted) {
      return;
    }

    const verificationSummary = {
      commands: runtimeState.verificationResult?.results ?? []
    };
    const proofOfWork = {
      verificationPassed: verificationSummary.commands.every((entry) => entry.ok),
      changedFiles: runtimeState.changedFiles ?? [],
      gitStatus: runtimeState.gitStatus ?? '',
      summary: [
        `branch=${branchName}`,
        `pr=${runtimeState.prResult?.url ?? ''}`,
        `changed_files=${runtimeState.changedFiles?.length ?? 0}`,
        ...verificationSummary.commands.map((entry) => `${entry.command}:exit=${entry.exitCode}`)
      ]
    };

    runtimeState.run = await completeRunnerHandoff({
      store: this.store,
      env: this.env,
      now: nowIso,
      updateRunSnapshot: (run, input) => this.updateRunSnapshot(run, input),
      notificationService: this.notificationService,
      run: runtimeState.run,
      session,
      branchName,
      prUrl: runtimeState.prResult?.url ?? null,
      prNumber: runtimeState.prResult?.number ?? null,
      verificationSummary,
      proofOfWork,
      graphRun: graphResult.graphRun,
      artifacts: runtimeState.artifacts
    });
  }

  private async ensureSession(
    run: RunnerRunRecord,
    workflow: WorkflowContract,
    promptContext: Record<string, unknown>
  ): Promise<JarvisSessionRecord> {
    const existingSessionId = run.sessionSnapshot?.sessionId;
    if (existingSessionId) {
      const session = await this.store.getJarvisSessionById({
        userId: run.userId,
        sessionId: existingSessionId
      });
      if (session) {
        await this.store.updateJarvisSession({
          sessionId: session.id,
          userId: run.userId,
          status: 'running'
        });
        return session;
      }
    }

    const title = renderWorkflowTemplate(workflow.agent.sessionTitleTemplate, promptContext);
    const session = await this.store.createJarvisSession({
      userId: run.userId,
      title,
      prompt: run.workItem.description,
      source: `delivery_runner:${run.workItem.source}`,
      intent: 'code',
      status: 'running',
      workspacePreset: 'execution',
      primaryTarget: 'execution',
      taskId: run.workItem.taskId
    });

    await this.updateRunSnapshot(run, {
      patch: {
        runId: run.id,
        sessionSnapshot: {
          sessionId: session.id,
          actionProposalId: null,
          status: session.status,
          updatedAt: session.updatedAt
        }
      }
    });
    return session;
  }

  private async runWorkflowCommands(input: {
    runtimeState: RunnerGraphRuntimeState;
    node: ExecutionGraphNode;
    run: RunnerRunRecord;
    session: JarvisSessionRecord;
    workflow: WorkflowContract;
    workspacePath: string;
    commands: string[];
    category: string;
    allowAutoRun: boolean;
  }): Promise<WorkflowCommandExecutionResult> {
    const results: ShellCommandResult[] = [];

    for (const command of input.commands) {
      const renderedCommand = renderWorkflowTemplate(command, buildPromptContext(input.run.workItem, input.workflow, input.workspacePath));
      const invocation = {
        source: 'internal',
        name: `runner.${input.category}`,
        command: renderedCommand,
        workspaceKind: input.workflow.workspace.type,
        metadata: {
          category: input.category
        }
      } as const;
      const policy = evaluateToolInvocationPolicy(invocation);
      if (!input.allowAutoRun && policy.disposition !== 'allow') {
        await this.createApprovalProposal({
          run: input.run,
          session: input.session,
          command: renderedCommand,
          category: input.category,
          reason: policy.rationale
        });
        return {
          continueExecution: false,
          disposition: 'blocked',
          reason: policy.rationale,
          results
        };
      }

      await input.runtimeState.callbacks.emit('beforeTool', {
        graph: input.runtimeState.graphSpec,
        graphRun: input.runtimeState.run.graphRun ?? createGraphRun(input.runtimeState.graphSpec, nowIso()),
        node: input.node,
        state: input.runtimeState.executionContext,
        invocation
      });

      const result = await runShellCommand({
        cwd: input.workspacePath,
        shell: input.workflow.codex.shell,
        command: renderedCommand,
        onStarted: async (pid) => {
          await this.store.updateRunnerRun({
            runId: input.run.id,
            lastProcessPid: pid,
            lastHeartbeatAt: nowIso()
          });
        },
        onHeartbeat: async () => {
          await this.store.updateRunnerRun({
            runId: input.run.id,
            lastHeartbeatAt: nowIso()
          });
        }
      });

      await this.store.updateRunnerRun({
        runId: input.run.id,
        lastProcessPid: 0,
        lastHeartbeatAt: nowIso()
      });

      results.push({
        command: renderedCommand,
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr
      });
      await input.runtimeState.callbacks.emit('afterTool', {
        graph: input.runtimeState.graphSpec,
        graphRun: input.runtimeState.run.graphRun ?? createGraphRun(input.runtimeState.graphSpec, nowIso()),
        node: input.node,
        state: input.runtimeState.executionContext,
        invocation,
        result: results[results.length - 1] ?? null
      });

      if (result.exitCode !== 0) {
        if (input.category === 'verification') {
          const reason = truncate(result.stderr || result.stdout || `verification_exit_${result.exitCode}`);
          await this.scheduleRetry(input.run, reason);
          await input.runtimeState.callbacks.emit('onRetry', {
            graph: input.runtimeState.graphSpec,
            graphRun: input.runtimeState.run.graphRun ?? createGraphRun(input.runtimeState.graphSpec, nowIso()),
            node: input.node,
            state: input.runtimeState.executionContext,
            reason
          });
          return {
            continueExecution: false,
            disposition: 'retry',
            reason,
            results
          };
        } else {
          const reason = truncate(result.stderr || result.stdout || `${input.category}_exit_${result.exitCode}`);
          await this.failRun(input.run, reason);
          return {
            continueExecution: false,
            disposition: 'failed',
            reason,
            results
          };
        }
      }
    }

    return {
      continueExecution: true,
      disposition: 'completed',
      results
    };
  }

  private async createApprovalProposal(input: {
    run: RunnerRunRecord;
    session: JarvisSessionRecord;
    command: string;
    category: string;
    reason: string;
  }): Promise<ActionProposalRecord> {
    return createRunnerApprovalProposal({
      store: this.store,
      env: this.env,
      now: nowIso,
      updateRunSnapshot: (run, payload) => this.updateRunSnapshot(run, payload),
      notificationService: this.notificationService,
      run: input.run,
      session: input.session,
      command: input.command,
      category: input.category,
      reason: input.reason,
      nodeKey: mapCategoryToNodeKey(input.category)
    });
  }

  private async scheduleRetry(run: RunnerRunRecord, reason: string): Promise<void> {
    await scheduleRunnerRetry({
      store: this.store,
      env: this.env,
      now: nowIso,
      updateRunSnapshot: (targetRun, input) => this.updateRunSnapshot(targetRun, input),
      run,
      reason,
      nodeKey: resolveCurrentNodeKey(run) ?? 'execute',
      workflow: this.lastKnownGoodWorkflow,
      maxAttempts: this.env.RUNNER_MAX_ATTEMPTS,
      buildBackoffMs,
      failRun: async (targetRun, failureReason) => this.failRun(targetRun, failureReason)
    });
  }

  private async failRun(run: RunnerRunRecord, reason: string): Promise<void> {
    await failRunnerRun({
      store: this.store,
      env: this.env,
      now: nowIso,
      updateRunSnapshot: (targetRun, input) => this.updateRunSnapshot(targetRun, input),
      notificationService: this.notificationService,
      run,
      reason,
      nodeKey: resolveCurrentNodeKey(run) ?? 'execute',
      recordStateError: (message, failedRun) => this.recordStateError(message, failedRun)
    });
  }

  private async recordStateError(message: string, run?: RunnerRunRecord): Promise<void> {
    const current = await this.store.getRunnerState();
    const nextErrors = [
      {
        at: nowIso(),
        message,
        runId: run?.id ?? null,
        source: run?.workItem.source ?? null
      },
      ...current.recentErrors
    ].slice(0, 12);
    await this.store.upsertRunnerState({
      recentErrors: nextErrors
    });
  }
}
