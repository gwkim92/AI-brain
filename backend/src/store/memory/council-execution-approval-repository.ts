import { randomUUID } from 'node:crypto';

import type {
  ApprovalRecord,
  CreateCouncilRunInput,
  CreateExecutionRunInput
} from '../types';
import type { CouncilExecutionApprovalRepositoryContract } from '../repository-contracts';
import type { MemoryStoreState } from './state';

type MemoryCouncilExecutionApprovalRepositoryDeps = {
  state: MemoryStoreState;
  nowIso: () => string;
};

export function createMemoryCouncilExecutionApprovalRepository({
  state,
  nowIso
}: MemoryCouncilExecutionApprovalRepositoryDeps): CouncilExecutionApprovalRepositoryContract {
  return {
    async createCouncilRun(input: CreateCouncilRunInput) {
      const now = nowIso();
      const run = {
        id: randomUUID(),
        question: input.question,
        status: input.status,
        consensus_status: input.consensus_status,
        summary: input.summary,
        participants: input.participants,
        attempts: input.attempts,
        provider: input.provider,
        model: input.model,
        used_fallback: input.used_fallback,
        task_id: input.task_id,
        created_at: now,
        updated_at: now
      };
      state.councilRuns.set(run.id, run);
      state.councilRunByIdempotency.set(`${input.user_id}:${input.idempotency_key}`, run.id);
      return run;
    },

    async updateCouncilRun(input) {
      const current = state.councilRuns.get(input.runId);
      if (!current) {
        return null;
      }

      const next = {
        ...current,
        status: input.status ?? current.status,
        consensus_status: input.consensus_status ?? current.consensus_status,
        summary: input.summary ?? current.summary,
        participants: input.participants ?? current.participants,
        attempts: input.attempts ?? current.attempts,
        provider: input.provider === undefined ? current.provider : input.provider,
        model: input.model ?? current.model,
        used_fallback: input.used_fallback ?? current.used_fallback,
        task_id: input.task_id === undefined ? current.task_id : input.task_id,
        updated_at: nowIso()
      };

      state.councilRuns.set(current.id, next);
      return next;
    },

    async getCouncilRunByIdempotency(input: { userId: string; idempotencyKey: string }) {
      const runId = state.councilRunByIdempotency.get(`${input.userId}:${input.idempotencyKey}`);
      return runId ? (state.councilRuns.get(runId) ?? null) : null;
    },

    async listCouncilRuns(limit: number) {
      return [...state.councilRuns.values()]
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, limit);
    },

    async getCouncilRunById(runId: string) {
      return state.councilRuns.get(runId) ?? null;
    },

    async createExecutionRun(input: CreateExecutionRunInput) {
      const now = nowIso();
      const run = {
        id: randomUUID(),
        mode: input.mode,
        prompt: input.prompt,
        status: input.status,
        output: input.output,
        attempts: input.attempts,
        provider: input.provider,
        model: input.model,
        used_fallback: input.used_fallback,
        task_id: input.task_id,
        duration_ms: input.duration_ms,
        created_at: now,
        updated_at: now
      };
      state.executionRuns.set(run.id, run);
      state.executionRunByIdempotency.set(`${input.user_id}:${input.idempotency_key}`, run.id);
      return run;
    },

    async updateExecutionRun(input) {
      const current = state.executionRuns.get(input.runId);
      if (!current) {
        return null;
      }

      const next = {
        ...current,
        status: input.status ?? current.status,
        output: input.output ?? current.output,
        attempts: input.attempts ?? current.attempts,
        provider: input.provider === undefined ? current.provider : input.provider,
        model: input.model ?? current.model,
        used_fallback: input.used_fallback ?? current.used_fallback,
        task_id: input.task_id === undefined ? current.task_id : input.task_id,
        duration_ms: input.duration_ms ?? current.duration_ms,
        updated_at: nowIso()
      };

      state.executionRuns.set(current.id, next);
      return next;
    },

    async getExecutionRunByIdempotency(input: { userId: string; idempotencyKey: string }) {
      const runId = state.executionRunByIdempotency.get(`${input.userId}:${input.idempotencyKey}`);
      return runId ? (state.executionRuns.get(runId) ?? null) : null;
    },

    async listExecutionRuns(limit: number) {
      return [...state.executionRuns.values()]
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, limit);
    },

    async getExecutionRunById(runId: string) {
      return state.executionRuns.get(runId) ?? null;
    },

    async createApproval(input) {
      const id = randomUUID();
      const now = nowIso();
      const record: ApprovalRecord = {
        id,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        status: 'pending',
        requestedBy: input.requestedBy ?? null,
        decidedBy: null,
        decidedAt: null,
        reason: null,
        expiresAt: input.expiresAt ?? null,
        createdAt: now
      };
      state.approvals.set(id, record);
      return record;
    },

    async listApprovals(input) {
      return Array.from(state.approvals.values())
        .filter((approval) => !input.status || approval.status === input.status)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, input.limit);
    },

    async decideApproval(input) {
      const approval = state.approvals.get(input.approvalId);
      if (!approval || approval.status !== 'pending') {
        return null;
      }

      const updated: ApprovalRecord = {
        ...approval,
        status: input.decision,
        decidedBy: input.decidedBy,
        decidedAt: nowIso(),
        reason: input.reason ?? null
      };
      state.approvals.set(input.approvalId, updated);
      return updated;
    }
  };
}
