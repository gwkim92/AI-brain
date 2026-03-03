import type { Pool } from 'pg';

import type { CouncilExecutionApprovalRepositoryContract } from '../repository-contracts';
import type { CouncilRunRow, ExecutionRunRow } from './types';
import type {
  ApprovalRecord,
  CouncilParticipantRecord,
  CouncilRunRecord,
  ExecutionRunRecord,
  ProviderAttemptRecord
} from '../types';

type CouncilExecutionApprovalRepositoryDeps = {
  pool: Pool;
};

export function createCouncilExecutionApprovalRepository({
  pool
}: CouncilExecutionApprovalRepositoryDeps): CouncilExecutionApprovalRepositoryContract {
  async function getCouncilRunByIdInternal(runId: string): Promise<CouncilRunRecord | null> {
    const { rows } = await pool.query<CouncilRunRow>(
      `
          SELECT
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM council_runs
          WHERE id = $1::uuid
          LIMIT 1
        `,
      [runId]
    );

    return rows[0] ? mapCouncilRunRow(rows[0]) : null;
  }

  async function getExecutionRunByIdInternal(runId: string): Promise<ExecutionRunRecord | null> {
    const { rows } = await pool.query<ExecutionRunRow>(
      `
          SELECT
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM execution_runs
          WHERE id = $1::uuid
          LIMIT 1
        `,
      [runId]
    );

    return rows[0] ? mapExecutionRunRow(rows[0]) : null;
  }

  return {
    async createCouncilRun(input) {
      const { rows } = await pool.query<CouncilRunRow>(
        `
          INSERT INTO council_runs (
            user_id,
            idempotency_key,
            trace_id,
            question,
            status,
            consensus_status,
            summary,
            participants,
            attempts,
            provider,
            model,
            used_fallback,
            task_id
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13::uuid)
          RETURNING
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
        `,
        [
          input.user_id,
          input.idempotency_key,
          input.trace_id ?? null,
          input.question,
          input.status,
          input.consensus_status,
          input.summary,
          JSON.stringify(input.participants),
          JSON.stringify(input.attempts),
          input.provider,
          input.model,
          input.used_fallback,
          input.task_id
        ]
      );

      return mapCouncilRunRow(rows[0]!);
    },

    async updateCouncilRun(input) {
      const updates: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      const push = (sql: string, value: unknown) => {
        updates.push(`${sql} = $${i}`);
        params.push(value);
        i += 1;
      };

      if (input.status !== undefined) push('status', input.status);
      if (input.consensus_status !== undefined) push('consensus_status', input.consensus_status);
      if (input.summary !== undefined) push('summary', input.summary);
      if (input.participants !== undefined) push('participants', JSON.stringify(input.participants));
      if (input.attempts !== undefined) push('attempts', JSON.stringify(input.attempts));
      if (input.provider !== undefined) push('provider', input.provider);
      if (input.model !== undefined) push('model', input.model);
      if (input.used_fallback !== undefined) push('used_fallback', input.used_fallback);
      if (input.task_id !== undefined) push('task_id', input.task_id);

      if (updates.length === 0) {
        return getCouncilRunByIdInternal(input.runId);
      }

      const whereIdx = i;
      params.push(input.runId);

      const { rows } = await pool.query<CouncilRunRow>(
        `
          UPDATE council_runs
          SET ${updates.join(', ')}, updated_at = now()
          WHERE id = $${whereIdx}::uuid
          RETURNING
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
        `,
        params
      );

      return rows[0] ? mapCouncilRunRow(rows[0]) : null;
    },

    async getCouncilRunByIdempotency(input: { userId: string; idempotencyKey: string }) {
      const { rows } = await pool.query<CouncilRunRow>(
        `
          SELECT
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM council_runs
          WHERE user_id = $1::uuid
            AND idempotency_key = $2
          LIMIT 1
        `,
        [input.userId, input.idempotencyKey]
      );

      return rows[0] ? mapCouncilRunRow(rows[0]) : null;
    },

    async listCouncilRuns(limit: number) {
      const { rows } = await pool.query<CouncilRunRow>(
        `
          SELECT
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM council_runs
          ORDER BY created_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return rows.map((row) => mapCouncilRunRow(row));
    },

    async getCouncilRunById(runId: string) {
      return getCouncilRunByIdInternal(runId);
    },

    async createExecutionRun(input) {
      const { rows } = await pool.query<ExecutionRunRow>(
        `
          INSERT INTO execution_runs (
            user_id,
            idempotency_key,
            trace_id,
            mode,
            prompt,
            status,
            output,
            attempts,
            provider,
            model,
            used_fallback,
            task_id,
            duration_ms
          )
          VALUES ($1::uuid, $2, $3, $4::task_mode, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::uuid, $13)
          RETURNING
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
        `,
        [
          input.user_id,
          input.idempotency_key,
          input.trace_id ?? null,
          input.mode,
          input.prompt,
          input.status,
          input.output,
          JSON.stringify(input.attempts),
          input.provider,
          input.model,
          input.used_fallback,
          input.task_id,
          input.duration_ms
        ]
      );

      return mapExecutionRunRow(rows[0]!);
    },

    async updateExecutionRun(input) {
      const updates: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      const push = (sql: string, value: unknown) => {
        updates.push(`${sql} = $${i}`);
        params.push(value);
        i += 1;
      };

      if (input.status !== undefined) push('status', input.status);
      if (input.output !== undefined) push('output', input.output);
      if (input.attempts !== undefined) push('attempts', JSON.stringify(input.attempts));
      if (input.provider !== undefined) push('provider', input.provider);
      if (input.model !== undefined) push('model', input.model);
      if (input.used_fallback !== undefined) push('used_fallback', input.used_fallback);
      if (input.task_id !== undefined) push('task_id', input.task_id);
      if (input.duration_ms !== undefined) push('duration_ms', input.duration_ms);

      if (updates.length === 0) {
        return getExecutionRunByIdInternal(input.runId);
      }

      const whereIdx = i;
      params.push(input.runId);

      const { rows } = await pool.query<ExecutionRunRow>(
        `
          UPDATE execution_runs
          SET ${updates.join(', ')}, updated_at = now()
          WHERE id = $${whereIdx}::uuid
          RETURNING
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
        `,
        params
      );

      return rows[0] ? mapExecutionRunRow(rows[0]) : null;
    },

    async getExecutionRunByIdempotency(input: { userId: string; idempotencyKey: string }) {
      const { rows } = await pool.query<ExecutionRunRow>(
        `
          SELECT
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM execution_runs
          WHERE user_id = $1::uuid
            AND idempotency_key = $2
          LIMIT 1
        `,
        [input.userId, input.idempotencyKey]
      );

      return rows[0] ? mapExecutionRunRow(rows[0]) : null;
    },

    async listExecutionRuns(limit: number) {
      const { rows } = await pool.query<ExecutionRunRow>(
        `
          SELECT
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM execution_runs
          ORDER BY created_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return rows.map((row) => mapExecutionRunRow(row));
    },

    async getExecutionRunById(runId: string) {
      return getExecutionRunByIdInternal(runId);
    },

    async createApproval(input) {
      const { rows } = await pool.query(
        `
          INSERT INTO approvals (entity_type, entity_id, action, requested_by, expires_at)
          VALUES ($1, $2::uuid, $3, $4, $5)
          RETURNING *
        `,
        [input.entityType, input.entityId, input.action, input.requestedBy ?? null, input.expiresAt ?? null]
      );
      const row = rows[0]!;
      return mapApprovalRow(row);
    },

    async listApprovals(input) {
      const conditions = ['1=1'];
      const params: unknown[] = [];
      if (input.status) {
        params.push(input.status);
        conditions.push(`status = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query(
        `SELECT * FROM approvals WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      );
      return rows.map(mapApprovalRow);
    },

    async decideApproval(input) {
      const { rows } = await pool.query(
        `
          UPDATE approvals
          SET status = $1, decided_by = $2::uuid, decided_at = now(), reason = $3
          WHERE id = $4::uuid AND status = 'pending'
          RETURNING *
        `,
        [input.decision, input.decidedBy, input.reason ?? null, input.approvalId]
      );
      return rows[0] ? mapApprovalRow(rows[0]) : null;
    }
  };
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function mapCouncilRunRow(row: CouncilRunRow): CouncilRunRecord {
  return {
    id: row.id,
    question: row.question,
    status: row.status,
    consensus_status: row.consensus_status,
    summary: row.summary,
    participants: parseJsonArray<CouncilParticipantRecord>(row.participants),
    attempts: parseJsonArray<ProviderAttemptRecord>(row.attempts),
    provider: row.provider,
    model: row.model,
    used_fallback: row.used_fallback,
    task_id: row.task_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  };
}

function mapExecutionRunRow(row: ExecutionRunRow): ExecutionRunRecord {
  return {
    id: row.id,
    mode: row.mode,
    prompt: row.prompt,
    status: row.status,
    output: row.output,
    attempts: parseJsonArray<ProviderAttemptRecord>(row.attempts),
    provider: row.provider,
    model: row.model,
    used_fallback: row.used_fallback,
    task_id: row.task_id,
    duration_ms: row.duration_ms,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  };
}

function mapApprovalRow(row: Record<string, unknown>): ApprovalRecord {
  return {
    id: String(row.id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    action: String(row.action),
    status: String(row.status) as 'pending' | 'approved' | 'rejected' | 'expired',
    requestedBy: row.requested_by ? String(row.requested_by) : null,
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    decidedAt: row.decided_at ? (row.decided_at instanceof Date ? row.decided_at.toISOString() : String(row.decided_at)) : null,
    reason: row.reason ? String(row.reason) : null,
    expiresAt: row.expires_at ? (row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at)) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  };
}
