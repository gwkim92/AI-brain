import type { AppEnv } from '../config/env';
import { syncExternalWorkCommentByTarget } from '../external-work/service';
import type {
  ActionProposalRecord,
  ArtifactRecord,
  GraphRunRecord,
  JarvisSessionRecord,
  JarvisStore,
  RunnerProofOfWork,
  RunnerRunRecord,
  RunnerVerificationSummary,
  WorkflowContract,
} from "../store/types";
import type { NotificationService } from "../notifications/proactive";
import type { UpdateRunSnapshotInput } from "./graph-callbacks";

type UpdateRunSnapshot = (run: RunnerRunRecord, input: UpdateRunSnapshotInput) => Promise<RunnerRunRecord>;

type BaseRunnerEffectInput = {
  store: JarvisStore;
  env: AppEnv;
  now: () => string;
  updateRunSnapshot: UpdateRunSnapshot;
  notificationService?: NotificationService;
};

function truncate(input: string, maxLength = 280): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}...`;
}

async function syncRunnerComment(
  input: BaseRunnerEffectInput & {
    run: RunnerRunRecord;
    body: string;
  }
): Promise<void> {
  await syncExternalWorkCommentByTarget(input.store, input.env, {
    userId: input.run.userId,
    targetType: 'runner',
    targetId: input.run.id,
    body: input.body,
  });
}

export async function createRunnerApprovalProposal(
  input: BaseRunnerEffectInput & {
    run: RunnerRunRecord;
    session: JarvisSessionRecord;
    command: string;
    category: string;
    reason: string;
    nodeKey: string;
  }
): Promise<ActionProposalRecord> {
  const proposal = await input.store.createActionProposal({
    userId: input.run.userId,
    sessionId: input.session.id,
    kind: "custom",
    title: `Runner approval required: ${input.category}`,
    summary: truncate(input.command, 120),
    payload: {
      runner_run_id: input.run.id,
      category: input.category,
      command: input.command,
      reason: input.reason,
      work_item: input.run.workItem.identifier,
    },
  });

  await input.updateRunSnapshot(input.run, {
    patch: {
      runId: input.run.id,
      claimState: "running",
      status: "blocked_needs_approval",
      blockedReason: input.reason,
      sessionSnapshot: {
        sessionId: input.session.id,
        actionProposalId: proposal.id,
        status: "needs_approval",
        updatedAt: input.now(),
      },
    },
    nodeKey: input.nodeKey,
    nodeStatus: "blocked",
    nodeSummary: input.reason,
  });

  await input.store.updateJarvisSession({
    sessionId: input.session.id,
    userId: input.run.userId,
    status: "needs_approval",
  });

  await input.store.upsertJarvisSessionStage({
    userId: input.run.userId,
    sessionId: input.session.id,
    stageKey: "approve",
    capability: "approve",
    title: "Approval gate",
    status: "needs_approval",
    summary: input.reason,
    artifactRefsJson: {
      action_proposal_id: proposal.id,
      runner_run_id: input.run.id,
      category: input.category,
    },
  });

  await input.store.appendJarvisSessionEvent({
    userId: input.run.userId,
    sessionId: input.session.id,
    eventType: "runner.approval_requested",
    status: "needs_approval",
    summary: input.reason,
    data: {
      runner_run_id: input.run.id,
      action_proposal_id: proposal.id,
      command: input.command,
      category: input.category,
    },
  });

  if (input.run.workItem.taskId) {
    await input.store.setTaskStatus({
      taskId: input.run.workItem.taskId,
      status: "blocked",
      eventType: "task.runner_blocked_for_approval",
      data: {
        runner_run_id: input.run.id,
        action_proposal_id: proposal.id,
      },
    });
  }

  input.notificationService?.emitActionProposalReady(input.session.id, proposal.id, proposal.title, {
    message: `Runner command requires approval: ${input.reason}`
  });
  await syncRunnerComment({
    ...input,
    body: `JARVIS runner ${input.run.id} is blocked pending approval: ${input.reason}`
  });

  return proposal;
}

export async function failRunnerRun(
  input: BaseRunnerEffectInput & {
    run: RunnerRunRecord;
    reason: string;
    nodeKey: string;
    recordStateError: (message: string, run?: RunnerRunRecord) => Promise<void>;
  }
): Promise<void> {
  const completedAt = input.now();

  await input.updateRunSnapshot(input.run, {
    patch: {
      runId: input.run.id,
      claimState: "released",
      status: "failed_terminal",
      failureReason: input.reason,
      completedAt,
      lastHeartbeatAt: completedAt,
      lastProcessPid: 0,
    },
    nodeKey: input.nodeKey,
    nodeStatus: "failed",
    nodeError: input.reason,
  });

  if (input.run.workItem.taskId) {
    await input.store.setTaskStatus({
      taskId: input.run.workItem.taskId,
      status: "failed",
      eventType: "task.runner_failed",
      data: {
        runner_run_id: input.run.id,
        reason: input.reason,
      },
    });
  }

  const sessionId = input.run.sessionSnapshot?.sessionId;
  if (sessionId) {
    await input.store.updateJarvisSession({
      sessionId,
      userId: input.run.userId,
      status: "failed",
    });
    await input.store.upsertJarvisSessionStage({
      userId: input.run.userId,
      sessionId,
      stageKey: "execute",
      capability: "execute",
      title: "Execution",
      status: "failed",
      summary: input.reason,
      errorMessage: input.reason,
      completedAt,
    });
    await input.store.appendJarvisSessionEvent({
      userId: input.run.userId,
      sessionId,
      eventType: "runner.run.failed",
      status: "failed",
      summary: input.reason,
      data: {
        runner_run_id: input.run.id,
      },
    });
  }

  await input.recordStateError(input.reason, input.run);
  input.notificationService?.emitRunnerRunFailed(input.run.id, input.run.workItem.title, input.reason);
  await syncRunnerComment({
    ...input,
    body: `JARVIS runner ${input.run.id} failed: ${input.reason}`
  });
}

export async function scheduleRunnerRetry(
  input: BaseRunnerEffectInput & {
    run: RunnerRunRecord;
    reason: string;
    nodeKey: string;
    workflow: WorkflowContract | null;
    maxAttempts: number;
    buildBackoffMs: (workflow: WorkflowContract, attemptCount: number) => number;
    failRun: (run: RunnerRunRecord, reason: string) => Promise<void>;
  }
): Promise<void> {
  const nextAttemptCount = input.run.attemptCount + 1;
  if (nextAttemptCount >= input.maxAttempts || !input.workflow) {
    await input.failRun(input.run, input.reason);
    return;
  }

  const nextRetryAt = new Date(Date.now() + input.buildBackoffMs(input.workflow, nextAttemptCount)).toISOString();

  await input.updateRunSnapshot(input.run, {
    patch: {
      runId: input.run.id,
      claimState: "retry_queued",
      status: "retry_queued",
      attemptCount: nextAttemptCount,
      failureReason: input.reason,
      nextRetryAt,
      lastProcessPid: 0,
      lastHeartbeatAt: input.now(),
    },
    nodeKey: input.nodeKey,
    nodeStatus: "failed",
    nodeError: input.reason,
  });

  if (input.run.workItem.taskId) {
    await input.store.setTaskStatus({
      taskId: input.run.workItem.taskId,
      status: "retrying",
      eventType: "task.runner_retry_scheduled",
      data: {
        runner_run_id: input.run.id,
        reason: input.reason,
        next_retry_at: nextRetryAt,
      },
    });
  }
}

export async function completeRunnerHandoff(
  input: BaseRunnerEffectInput & {
    run: RunnerRunRecord;
    session: JarvisSessionRecord;
    branchName: string;
    prUrl: string | null;
    prNumber: number | null;
    verificationSummary: RunnerVerificationSummary;
    proofOfWork: RunnerProofOfWork;
    graphRun: GraphRunRecord | null;
    artifacts: ArtifactRecord[];
  }
): Promise<RunnerRunRecord> {
  const completedAt = input.now();
  const updated = await input.updateRunSnapshot(input.run, {
    patch: {
      runId: input.run.id,
      claimState: "released",
      status: "human_review_ready",
      prUrl: input.prUrl,
      prNumber: input.prNumber,
      verificationSummary: input.verificationSummary,
      proofOfWork: input.proofOfWork,
      completedAt,
      lastHeartbeatAt: completedAt,
      blockedReason: "",
      failureReason: "",
      graphRun: input.graphRun,
    },
    appendArtifacts: input.artifacts,
  });

  if (input.run.workItem.taskId) {
    await input.store.setTaskStatus({
      taskId: input.run.workItem.taskId,
      status: "blocked",
      eventType: "task.runner_human_review_ready",
      data: {
        runner_run_id: input.run.id,
        pr_url: input.prUrl,
        pr_number: input.prNumber,
      },
    });
  }

  await input.store.updateJarvisSession({
    sessionId: input.session.id,
    userId: input.run.userId,
    status: "completed",
  });

  await input.store.appendJarvisSessionEvent({
    userId: input.run.userId,
    sessionId: input.session.id,
    eventType: "runner.handoff.ready",
    status: "completed",
    summary: input.prUrl ?? "handoff_complete",
    data: {
      runner_run_id: input.run.id,
      pr_url: input.prUrl,
      pr_number: input.prNumber,
      branch: input.branchName,
    },
  });

  input.notificationService?.emitRunnerHandoffReady(input.run.id, input.run.workItem.title, input.prUrl);
  await syncRunnerComment({
    ...input,
    body: input.prUrl
      ? `JARVIS runner ${input.run.id} produced PR #${input.prNumber ?? '-'}: ${input.prUrl}`
      : `JARVIS runner ${input.run.id} completed and is ready for human review.`
  });

  return updated;
}
