import { randomUUID } from 'node:crypto';

import { hydrateRunnerRunRecord } from '../../graph-runtime/graph';
import type { RunnerRepositoryContract } from '../repository-contracts';
import type {
  ArtifactRecord,
  CreateRunnerRunInput,
  ExecutionGraphSpec,
  GraphRunRecord,
  RunnerProofOfWork,
  RunnerRunRecord,
  RunnerRunStatus,
  RunnerStateRecord,
  RunnerVerificationSummary,
  SessionStateSnapshot,
  UpsertRunnerStateInput,
  UpdateRunnerRunInput
} from '../types';
import type { MemoryStoreState } from './state';

type MemoryRunnerRepositoryDeps = {
  state: MemoryStoreState;
  nowIso: () => string;
};

const ACTIVE_RUN_STATUSES = new Set<RunnerRunStatus>(['claimed', 'running', 'retry_queued', 'blocked_needs_approval']);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyVerificationSummary(): RunnerVerificationSummary {
  return {
    commands: []
  };
}

function createEmptyProofOfWork(): RunnerProofOfWork {
  return {
    verificationPassed: false,
    changedFiles: [],
    gitStatus: '',
    summary: []
  };
}

function cloneArtifacts(artifacts: ArtifactRecord[]): ArtifactRecord[] {
  return clone(artifacts);
}

function cloneGraphSpec(graphSpec: ExecutionGraphSpec | null): ExecutionGraphSpec | null {
  return graphSpec ? clone(graphSpec) : null;
}

function cloneGraphRun(graphRun: GraphRunRecord | null): GraphRunRecord | null {
  return graphRun ? clone(graphRun) : null;
}

function cloneSessionState(sessionState: SessionStateSnapshot | null): SessionStateSnapshot | null {
  return sessionState ? clone(sessionState) : null;
}

function ensureRunnerState(state: MemoryStoreState, nowIso: () => string): RunnerStateRecord {
  const current = state.runnerState;
  if (current) {
    return current;
  }
  const now = nowIso();
  const next: RunnerStateRecord = {
    id: 'runner',
    dispatchEnabled: false,
    refreshRequestedAt: null,
    refreshedAt: null,
    workflowPath: null,
    workflowValidation: 'unknown',
    workflowErrors: [],
    lastLoadedWorkflowAt: null,
    lastLoopStartedAt: null,
    activeSources: [],
    recentErrors: [],
    createdAt: now,
    updatedAt: now
  };
  state.runnerState = next;
  return next;
}

function toRunnerRunRecord(row: RunnerRunRecord): RunnerRunRecord {
  return hydrateRunnerRunRecord(clone(row));
}

export function createMemoryRunnerRepository({ state, nowIso }: MemoryRunnerRepositoryDeps): RunnerRepositoryContract {
  return {
    async getRunnerState() {
      return clone(ensureRunnerState(state, nowIso));
    },

    async upsertRunnerState(input: UpsertRunnerStateInput) {
      const current = ensureRunnerState(state, nowIso);
      const next: RunnerStateRecord = {
        ...current,
        dispatchEnabled: input.dispatchEnabled ?? current.dispatchEnabled,
        refreshRequestedAt: input.refreshRequestedAt === undefined ? current.refreshRequestedAt : input.refreshRequestedAt,
        refreshedAt: input.refreshedAt === undefined ? current.refreshedAt : input.refreshedAt,
        workflowPath: input.workflowPath === undefined ? current.workflowPath : input.workflowPath,
        workflowValidation: input.workflowValidation ?? current.workflowValidation,
        workflowErrors: input.workflowErrors ? clone(input.workflowErrors) : clone(current.workflowErrors),
        lastLoadedWorkflowAt: input.lastLoadedWorkflowAt === undefined ? current.lastLoadedWorkflowAt : input.lastLoadedWorkflowAt,
        lastLoopStartedAt: input.lastLoopStartedAt === undefined ? current.lastLoopStartedAt : input.lastLoopStartedAt,
        activeSources: input.activeSources ? [...input.activeSources] : [...current.activeSources],
        recentErrors: input.recentErrors ? clone(input.recentErrors) : clone(current.recentErrors),
        updatedAt: nowIso()
      };
      state.runnerState = next;
      return clone(next);
    },

    async createRunnerRun(input: CreateRunnerRunInput) {
      const now = nowIso();
      const row: RunnerRunRecord = {
        id: input.id ?? randomUUID(),
        userId: input.userId,
        workItem: clone(input.workItem),
        claimState: input.claimState ?? 'claimed',
        status: input.status ?? 'claimed',
        attemptCount: input.attemptCount ?? 0,
        sessionSnapshot: input.sessionSnapshot ? clone(input.sessionSnapshot) : null,
        workspaceId: input.workspaceId ?? null,
        workspacePath: input.workspacePath ?? null,
        workspaceKind: input.workspaceKind ?? 'worktree',
        branchName: input.branchName ?? input.workItem.branchName ?? null,
        prUrl: input.prUrl ?? null,
        prNumber: input.prNumber ?? null,
        verificationSummary: input.verificationSummary ? clone(input.verificationSummary) : createEmptyVerificationSummary(),
        proofOfWork: input.proofOfWork ? clone(input.proofOfWork) : createEmptyProofOfWork(),
        lastProcessPid: input.lastProcessPid ?? null,
        blockedReason: input.blockedReason ?? null,
        failureReason: input.failureReason ?? null,
        nextRetryAt: input.nextRetryAt ?? null,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        lastHeartbeatAt: input.lastHeartbeatAt ?? null,
        graphSpec: cloneGraphSpec(input.graphSpec ?? null),
        graphRun: cloneGraphRun(input.graphRun ?? null),
        sessionState: cloneSessionState(input.sessionState ?? null),
        artifacts: cloneArtifacts(input.artifacts ?? []),
        graphRunId: null,
        currentNodeId: null,
        artifactCount: 0,
        createdAt: now,
        updatedAt: now
      };
      state.runnerRuns.set(row.id, row);
      return toRunnerRunRecord(row);
    },

    async listRunnerRuns(input) {
      return [...state.runnerRuns.values()]
        .filter((row) => (input.userId ? row.userId === input.userId : true))
        .filter((row) => (input.status ? row.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit)
        .map(toRunnerRunRecord);
    },

    async getRunnerRunById(input) {
      const row = state.runnerRuns.get(input.runId);
      if (!row) return null;
      if (input.userId && row.userId !== input.userId) return null;
      return toRunnerRunRecord(row);
    },

    async findActiveRunnerRunByWorkItem(input) {
      const row = [...state.runnerRuns.values()]
        .filter((candidate) => candidate.workItem.source === input.source)
        .filter((candidate) => candidate.workItem.identifier === input.identifier)
        .filter((candidate) => ACTIVE_RUN_STATUSES.has(candidate.status))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      return row ? toRunnerRunRecord(row) : null;
    },

    async updateRunnerRun(input: UpdateRunnerRunInput) {
      const current = state.runnerRuns.get(input.runId);
      if (!current) return null;
      if (input.userId && current.userId !== input.userId) return null;
      const next: RunnerRunRecord = {
        ...current,
        claimState: input.claimState ?? current.claimState,
        status: input.status ?? current.status,
        attemptCount: input.attemptCount ?? current.attemptCount,
        sessionSnapshot: input.sessionSnapshot === undefined ? current.sessionSnapshot : input.sessionSnapshot ? clone(input.sessionSnapshot) : null,
        workspaceId: input.workspaceId === undefined ? current.workspaceId : input.workspaceId,
        workspacePath: input.workspacePath === undefined ? current.workspacePath : input.workspacePath,
        workspaceKind: input.workspaceKind ?? current.workspaceKind,
        branchName: input.branchName === undefined ? current.branchName : input.branchName,
        prUrl: input.prUrl === undefined ? current.prUrl : input.prUrl,
        prNumber: input.prNumber === undefined ? current.prNumber : input.prNumber,
        verificationSummary: input.verificationSummary ? clone(input.verificationSummary) : clone(current.verificationSummary),
        proofOfWork: input.proofOfWork ? clone(input.proofOfWork) : clone(current.proofOfWork),
        lastProcessPid: input.lastProcessPid === undefined ? current.lastProcessPid : input.lastProcessPid,
        blockedReason: input.blockedReason === undefined ? current.blockedReason : input.blockedReason,
        failureReason: input.failureReason === undefined ? current.failureReason : input.failureReason,
        nextRetryAt: input.nextRetryAt === undefined ? current.nextRetryAt : input.nextRetryAt,
        startedAt: input.startedAt === undefined ? current.startedAt : input.startedAt,
        completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt,
        lastHeartbeatAt: input.lastHeartbeatAt === undefined ? current.lastHeartbeatAt : input.lastHeartbeatAt,
        graphSpec: input.graphSpec === undefined ? cloneGraphSpec(current.graphSpec) : cloneGraphSpec(input.graphSpec),
        graphRun: input.graphRun === undefined ? cloneGraphRun(current.graphRun) : cloneGraphRun(input.graphRun),
        sessionState: input.sessionState === undefined ? cloneSessionState(current.sessionState) : cloneSessionState(input.sessionState),
        artifacts: input.artifacts === undefined ? cloneArtifacts(current.artifacts) : cloneArtifacts(input.artifacts),
        graphRunId: null,
        currentNodeId: null,
        artifactCount: 0,
        updatedAt: nowIso()
      };
      state.runnerRuns.set(next.id, next);
      return toRunnerRunRecord(next);
    }
  };
}
