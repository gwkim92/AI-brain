import type { Pool } from 'pg';

import { hydrateRunnerRunRecord } from '../../graph-runtime/graph';
import type { RunnerRepositoryContract } from '../repository-contracts';
import type {
  ArtifactRecord,
  CreateRunnerRunInput,
  ExecutionGraphSpec,
  GraphRunRecord,
  RunnerRunRecord,
  RunnerRunStatus,
  RunnerSessionSnapshot,
  RunnerStateRecord,
  SessionStateSnapshot,
  UpdateRunnerRunInput,
  WorkItem
} from '../types';
import type { RunnerRunRow, RunnerStateRow } from './types';

type RunnerRepositoryDeps = {
  pool: Pool;
};

const ACTIVE_RUN_STATUSES: RunnerRunStatus[] = ['claimed', 'running', 'retry_queued', 'blocked_needs_approval'];

function normalizeLimit(limit: number): number {
  return Math.max(1, Math.min(limit, 200));
}

function mapRunnerStateRow(row: RunnerStateRow): RunnerStateRecord {
  return {
    id: row.id,
    dispatchEnabled: row.dispatch_enabled,
    refreshRequestedAt: row.refresh_requested_at?.toISOString() ?? null,
    refreshedAt: row.refreshed_at?.toISOString() ?? null,
    workflowPath: row.workflow_path,
    workflowValidation: row.workflow_validation,
    workflowErrors: row.workflow_errors_json ?? [],
    lastLoadedWorkflowAt: row.last_loaded_workflow_at?.toISOString() ?? null,
    lastLoopStartedAt: row.last_loop_started_at?.toISOString() ?? null,
    activeSources: row.active_sources_json ?? [],
    recentErrors: row.recent_errors_json ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapRunnerRunRow(row: RunnerRunRow): RunnerRunRecord {
  return hydrateRunnerRunRecord({
    id: row.id,
    userId: row.user_id,
    workItem: row.work_item_json as WorkItem,
    claimState: row.claim_state,
    status: row.status,
    attemptCount: row.attempt_count,
    sessionSnapshot: (row.session_snapshot_json as RunnerSessionSnapshot | null) ?? null,
    workspaceId: row.workspace_id,
    workspacePath: row.workspace_path,
    workspaceKind: row.workspace_kind,
    branchName: row.branch_name,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    verificationSummary: row.verification_summary_json,
    proofOfWork: row.proof_of_work_json,
    lastProcessPid: row.last_process_pid,
    blockedReason: row.blocked_reason,
    failureReason: row.failure_reason,
    nextRetryAt: row.next_retry_at?.toISOString() ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? null,
    graphSpec: (row.graph_spec_json as ExecutionGraphSpec | null) ?? null,
    graphRun: (row.graph_run_json as GraphRunRecord | null) ?? null,
    sessionState: (row.session_state_json as SessionStateSnapshot | null) ?? null,
    artifacts: (row.artifacts_json as ArtifactRecord[] | null) ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  });
}

async function ensureRunnerState(pool: Pool): Promise<RunnerStateRecord> {
  const { rows } = await pool.query<RunnerStateRow>(
    `
      INSERT INTO runner_state (
        id,
        dispatch_enabled,
        workflow_validation,
        workflow_errors_json,
        active_sources_json,
        recent_errors_json
      )
      VALUES ('runner', false, 'unknown', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET id = runner_state.id
      RETURNING *
    `
  );
  return mapRunnerStateRow(rows[0]!);
}

export function createRunnerRepository({ pool }: RunnerRepositoryDeps): RunnerRepositoryContract {
  return {
    async getRunnerState() {
      return ensureRunnerState(pool);
    },

    async upsertRunnerState(input) {
      await ensureRunnerState(pool);
      const { rows } = await pool.query<RunnerStateRow>(
        `
          UPDATE runner_state
          SET dispatch_enabled = COALESCE($2, dispatch_enabled),
              refresh_requested_at = COALESCE($3::timestamptz, refresh_requested_at),
              refreshed_at = COALESCE($4::timestamptz, refreshed_at),
              workflow_path = COALESCE($5, workflow_path),
              workflow_validation = COALESCE($6, workflow_validation),
              workflow_errors_json = COALESCE($7::jsonb, workflow_errors_json),
              last_loaded_workflow_at = COALESCE($8::timestamptz, last_loaded_workflow_at),
              last_loop_started_at = COALESCE($9::timestamptz, last_loop_started_at),
              active_sources_json = COALESCE($10::jsonb, active_sources_json),
              recent_errors_json = COALESCE($11::jsonb, recent_errors_json),
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [
          'runner',
          input.dispatchEnabled ?? null,
          input.refreshRequestedAt ?? null,
          input.refreshedAt ?? null,
          input.workflowPath ?? null,
          input.workflowValidation ?? null,
          input.workflowErrors ? JSON.stringify(input.workflowErrors) : null,
          input.lastLoadedWorkflowAt ?? null,
          input.lastLoopStartedAt ?? null,
          input.activeSources ? JSON.stringify(input.activeSources) : null,
          input.recentErrors ? JSON.stringify(input.recentErrors) : null
        ]
      );
      return mapRunnerStateRow(rows[0]!);
    },

    async createRunnerRun(input: CreateRunnerRunInput) {
      const { rows } = await pool.query<RunnerRunRow>(
        `
          INSERT INTO runner_runs (
            id,
            user_id,
            work_item_json,
            claim_state,
            status,
            attempt_count,
            session_snapshot_json,
            workspace_id,
            workspace_path,
            workspace_kind,
            branch_name,
            pr_url,
            pr_number,
            verification_summary_json,
            proof_of_work_json,
            last_process_pid,
            blocked_reason,
            failure_reason,
            next_retry_at,
            started_at,
            completed_at,
            last_heartbeat_at,
            graph_spec_json,
            graph_run_json,
            artifacts_json,
            session_state_json
          )
          VALUES (
            COALESCE($1::uuid, gen_random_uuid()),
            $2::uuid,
            $3::jsonb,
            $4,
            $5,
            $6,
            $7::jsonb,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14::jsonb,
            $15::jsonb,
            $16,
            $17,
            $18,
            $19::timestamptz,
            $20::timestamptz,
            $21::timestamptz,
            $22::timestamptz,
            $23::jsonb,
            $24::jsonb,
            $25::jsonb,
            $26::jsonb
          )
          RETURNING *
        `,
        [
          input.id ?? null,
          input.userId,
          JSON.stringify(input.workItem),
          input.claimState ?? 'claimed',
          input.status ?? 'claimed',
          input.attemptCount ?? 0,
          JSON.stringify(input.sessionSnapshot ?? null),
          input.workspaceId ?? null,
          input.workspacePath ?? null,
          input.workspaceKind ?? 'worktree',
          input.branchName ?? input.workItem.branchName ?? null,
          input.prUrl ?? null,
          input.prNumber ?? null,
          JSON.stringify(input.verificationSummary ?? { commands: [] }),
          JSON.stringify(
            input.proofOfWork ?? {
              verificationPassed: false,
              changedFiles: [],
              gitStatus: '',
              summary: []
            }
          ),
          input.lastProcessPid ?? null,
          input.blockedReason ?? null,
          input.failureReason ?? null,
          input.nextRetryAt ?? null,
          input.startedAt ?? null,
          input.completedAt ?? null,
          input.lastHeartbeatAt ?? null,
          input.graphSpec ? JSON.stringify(input.graphSpec) : null,
          input.graphRun ? JSON.stringify(input.graphRun) : null,
          JSON.stringify(input.artifacts ?? []),
          input.sessionState ? JSON.stringify(input.sessionState) : null
        ]
      );
      return mapRunnerRunRow(rows[0]!);
    },

    async listRunnerRuns(input) {
      const values: unknown[] = [];
      const filters: string[] = [];
      if (input.userId) {
        values.push(input.userId);
        filters.push(`user_id = $${values.length}::uuid`);
      }
      if (input.status) {
        values.push(input.status);
        filters.push(`status = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const { rows } = await pool.query<RunnerRunRow>(
        `
          SELECT *
          FROM runner_runs
          ${where}
          ORDER BY updated_at DESC
          LIMIT $${values.length}
        `,
        values
      );
      return rows.map(mapRunnerRunRow);
    },

    async getRunnerRunById(input) {
      const values: unknown[] = [input.runId];
      let query = `
        SELECT *
        FROM runner_runs
        WHERE id = $1::uuid
      `;
      if (input.userId) {
        values.push(input.userId);
        query += ` AND user_id = $${values.length}::uuid`;
      }
      query += ' LIMIT 1';
      const { rows } = await pool.query<RunnerRunRow>(query, values);
      return rows[0] ? mapRunnerRunRow(rows[0]) : null;
    },

    async findActiveRunnerRunByWorkItem(input) {
      const { rows } = await pool.query<RunnerRunRow>(
        `
          SELECT *
          FROM runner_runs
          WHERE work_item_json->>'source' = $1
            AND work_item_json->>'identifier' = $2
            AND status = ANY($3::text[])
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [input.source, input.identifier, ACTIVE_RUN_STATUSES]
      );
      return rows[0] ? mapRunnerRunRow(rows[0]) : null;
    },

    async updateRunnerRun(input: UpdateRunnerRunInput) {
      const current = await this.getRunnerRunById({ runId: input.runId, userId: input.userId });
      if (!current) return null;
      const { rows } = await pool.query<RunnerRunRow>(
        `
          UPDATE runner_runs
          SET claim_state = COALESCE($2, claim_state),
              status = COALESCE($3, status),
              attempt_count = COALESCE($4, attempt_count),
              session_snapshot_json = COALESCE($5::jsonb, session_snapshot_json),
              workspace_id = COALESCE($6, workspace_id),
              workspace_path = COALESCE($7, workspace_path),
              workspace_kind = COALESCE($8, workspace_kind),
              branch_name = COALESCE($9, branch_name),
              pr_url = COALESCE($10, pr_url),
              pr_number = COALESCE($11, pr_number),
              verification_summary_json = COALESCE($12::jsonb, verification_summary_json),
              proof_of_work_json = COALESCE($13::jsonb, proof_of_work_json),
              last_process_pid = COALESCE($14, last_process_pid),
              blocked_reason = COALESCE($15, blocked_reason),
              failure_reason = COALESCE($16, failure_reason),
              next_retry_at = COALESCE($17::timestamptz, next_retry_at),
              started_at = COALESCE($18::timestamptz, started_at),
              completed_at = COALESCE($19::timestamptz, completed_at),
              last_heartbeat_at = COALESCE($20::timestamptz, last_heartbeat_at),
              graph_spec_json = COALESCE($21::jsonb, graph_spec_json),
              graph_run_json = COALESCE($22::jsonb, graph_run_json),
              artifacts_json = COALESCE($23::jsonb, artifacts_json),
              session_state_json = COALESCE($24::jsonb, session_state_json),
              updated_at = now()
          WHERE id = $1::uuid
          RETURNING *
        `,
        [
          input.runId,
          input.claimState ?? null,
          input.status ?? null,
          input.attemptCount ?? null,
          input.sessionSnapshot === undefined ? null : JSON.stringify(input.sessionSnapshot),
          input.workspaceId ?? null,
          input.workspacePath ?? null,
          input.workspaceKind ?? null,
          input.branchName ?? null,
          input.prUrl ?? null,
          input.prNumber ?? null,
          input.verificationSummary ? JSON.stringify(input.verificationSummary) : null,
          input.proofOfWork ? JSON.stringify(input.proofOfWork) : null,
          input.lastProcessPid ?? null,
          input.blockedReason ?? null,
          input.failureReason ?? null,
          input.nextRetryAt ?? null,
          input.startedAt ?? null,
          input.completedAt ?? null,
          input.lastHeartbeatAt ?? null,
          input.graphSpec ? JSON.stringify(input.graphSpec) : null,
          input.graphRun ? JSON.stringify(input.graphRun) : null,
          input.artifacts ? JSON.stringify(input.artifacts) : null,
          input.sessionState ? JSON.stringify(input.sessionState) : null
        ]
      );
      return rows[0] ? mapRunnerRunRow(rows[0]) : null;
    }
  };
}
