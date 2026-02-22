import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { evaluateRadarItems } from '../radar/scoring';
import type {
  CreateTaskInput,
  JarvisStore,
  RadarItemRecord,
  RadarItemStatus,
  RadarRecommendationRecord,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  UpgradeProposalRecord,
  UpgradeRunApiRecord,
  UpgradeStatus
} from './types';

type PostgresStoreOptions = {
  connectionString: string;
  defaultUserId: string;
  defaultUserEmail: string;
};

type TaskRow = {
  id: string;
  user_id: string;
  mode: TaskRecord['mode'];
  status: TaskRecord['status'];
  title: string;
  input: Record<string, unknown>;
  idempotency_key: string;
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type RadarItemRow = {
  id: string;
  title: string;
  summary: string | null;
  source_url: string;
  source_name: string;
  published_at: Date | null;
  confidence_score: string | number;
  status: RadarItemStatus;
};

type UpgradeProposalRow = {
  id: string;
  radar_score_id: string;
  proposal_title: string;
  status: UpgradeStatus;
  created_at: Date;
  approved_at: Date | null;
};

type UpgradeRunRow = {
  id: string;
  proposal_id: string;
  status: UpgradeStatus;
  start_command: string;
  created_at: Date;
  updated_at: Date;
};

export function createPostgresStore(options: PostgresStoreOptions): JarvisStore {
  const pool = new Pool({ connectionString: options.connectionString });
  const taskEvents = new Map<string, TaskEventRecord[]>();

  const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

  const store: JarvisStore = {
    kind: 'postgres',

    async initialize() {
      await pool.query(
        `
          INSERT INTO users (id, email, display_name)
          VALUES ($1::uuid, $2, $3)
          ON CONFLICT (id) DO NOTHING
        `,
        [options.defaultUserId, options.defaultUserEmail, 'Jarvis Local User']
      );
    },

    async health() {
      try {
        await pool.query('SELECT 1');
        return {
          store: 'postgres',
          db: 'up'
        };
      } catch {
        return {
          store: 'postgres',
          db: 'down'
        };
      }
    },

    async createTask(input: CreateTaskInput) {
      const { rows } = await pool.query<TaskRow>(
        `
          INSERT INTO tasks (
            user_id,
            mode,
            status,
            title,
            input,
            idempotency_key,
            trace_id
          )
          VALUES ($1::uuid, $2::task_mode, 'queued'::task_status, $3, $4::jsonb, $5, $6)
          RETURNING *
        `,
        [
          input.userId || options.defaultUserId,
          input.mode,
          input.title,
          JSON.stringify(input.input),
          input.idempotencyKey,
          input.traceId ?? null
        ]
      );

      const task = mapTaskRow(rows[0]!);

      await store.appendTaskEvent({
        taskId: task.id,
        type: 'task.created',
        data: {
          mode: task.mode,
          status: task.status
        }
      });

      return task;
    },

    async listTasks(input: { status?: TaskStatus; limit: number }) {
      const params: unknown[] = [input.limit];
      let where = '';

      if (input.status) {
        params.push(input.status);
        where = 'WHERE status = $2::task_status';
      }

      const { rows } = await pool.query<TaskRow>(
        `
          SELECT *
          FROM tasks
          ${where}
          ORDER BY created_at DESC
          LIMIT $1
        `,
        params
      );

      return rows.map((row) => mapTaskRow(row));
    },

    async getTaskById(taskId: string) {
      const { rows } = await pool.query<TaskRow>(
        `
          SELECT *
          FROM tasks
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [taskId]
      );

      return rows[0] ? mapTaskRow(rows[0]) : null;
    },

    async appendTaskEvent(event: Omit<TaskEventRecord, 'id' | 'timestamp'>) {
      const next: TaskEventRecord = {
        id: randomUUID(),
        taskId: event.taskId,
        type: event.type,
        timestamp: new Date().toISOString(),
        data: event.data
      };

      const prev = taskEvents.get(event.taskId) ?? [];
      prev.push(next);
      taskEvents.set(event.taskId, prev);

      return next;
    },

    async listTaskEvents(taskId: string, limit: number) {
      const rows = taskEvents.get(taskId) ?? [];
      return rows.slice(Math.max(0, rows.length - limit));
    },

    async ingestRadarItems(items: RadarItemRecord[]) {
      for (const item of items) {
        await pool.query(
          `
            INSERT INTO tech_radar_items (
              source_url,
              source_name,
              title,
              summary,
              published_at,
              item_hash,
              confidence_score,
              status,
              payload
            )
            VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::radar_item_status, '{}'::jsonb)
            ON CONFLICT (source_url, item_hash)
            DO UPDATE SET
              title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              published_at = EXCLUDED.published_at,
              confidence_score = EXCLUDED.confidence_score,
              updated_at = now()
          `,
          [
            item.sourceUrl,
            item.sourceName,
            item.title,
            item.summary,
            item.publishedAt,
            item.id,
            item.confidenceScore,
            item.status
          ]
        );
      }

      return items.length;
    },

    async listRadarItems(input: { status?: RadarItemStatus; limit: number }) {
      const params: unknown[] = [input.limit];
      let where = '';

      if (input.status) {
        params.push(input.status);
        where = 'WHERE status = $2::radar_item_status';
      }

      const { rows } = await pool.query<RadarItemRow>(
        `
          SELECT id, title, summary, source_url, source_name, published_at, confidence_score, status
          FROM tech_radar_items
          ${where}
          ORDER BY published_at DESC NULLS LAST, created_at DESC
          LIMIT $1
        `,
        params
      );

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary ?? '',
        sourceUrl: row.source_url,
        sourceName: row.source_name,
        publishedAt: toIso(row.published_at),
        confidenceScore: Number(row.confidence_score),
        status: row.status
      }));
    },

    async evaluateRadar(input: { itemIds: string[] }) {
      if (input.itemIds.length === 0) {
        return [];
      }

      const { rows } = await pool.query<RadarItemRow>(
        `
          SELECT id, title, summary, source_url, source_name, published_at, confidence_score, status
          FROM tech_radar_items
          WHERE id = ANY($1::uuid[])
        `,
        [input.itemIds]
      );

      const scored = evaluateRadarItems(
        rows.map((item) => {
          const confidence = Number(item.confidence_score);
          return {
            id: item.id,
            title: item.title,
            benefit: Math.max(1.5, Math.min(5, confidence * 5)),
            risk: Math.max(0.5, 3.2 - confidence * 2),
            cost: 2.5
          };
        })
      );

      const recommendations: RadarRecommendationRecord[] = [];

      for (const row of scored) {
        const { rows: scoreRows } = await pool.query<{
          id: string;
          evaluated_at: Date;
        }>(
          `
            INSERT INTO tech_radar_scores (
              radar_item_id,
              performance_gain,
              reliability_gain,
              adoption_difficulty,
              rollback_difficulty,
              security_risk,
              total_score,
              decision,
              rationale
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::radar_decision, $9::jsonb)
            RETURNING id, evaluated_at
          `,
          [
            row.itemId,
            row.totalScore,
            row.totalScore,
            2.0,
            2.0,
            row.riskLevel === 'high' ? 4 : row.riskLevel === 'medium' ? 2.5 : 1.2,
            row.totalScore,
            row.decision,
            JSON.stringify({
              expectedBenefit: row.expectedBenefit,
              migrationCost: row.migrationCost,
              riskLevel: row.riskLevel
            })
          ]
        );

        await pool.query(
          `
            UPDATE tech_radar_items
            SET status = 'scored'::radar_item_status,
                updated_at = now()
            WHERE id = $1::uuid
          `,
          [row.itemId]
        );

        if (row.decision !== 'discard') {
          await pool.query(
            `
              INSERT INTO upgrade_proposals (
                radar_score_id,
                proposal_title,
                change_plan,
                risk_plan,
                status
              )
              VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, 'proposed'::upgrade_status)
            `,
            [
              scoreRows[0]!.id,
              `Adopt candidate ${row.itemId}`,
              JSON.stringify({ target: row.itemId, expectedBenefit: row.expectedBenefit }),
              JSON.stringify({ risk: row.riskLevel, migrationCost: row.migrationCost })
            ]
          );
        }

        recommendations.push({
          id: scoreRows[0]!.id,
          itemId: row.itemId,
          decision: row.decision,
          totalScore: row.totalScore,
          expectedBenefit: row.expectedBenefit,
          migrationCost: row.migrationCost,
          riskLevel: row.riskLevel,
          evaluatedAt: scoreRows[0]!.evaluated_at.toISOString()
        });
      }

      return recommendations;
    },

    async listRadarRecommendations(decision?: 'adopt' | 'hold' | 'discard') {
      const params: unknown[] = [];
      let where = '';

      if (decision) {
        params.push(decision);
        where = 'WHERE decision = $1::radar_decision';
      }

      const { rows } = await pool.query<{
        id: string;
        radar_item_id: string;
        decision: 'adopt' | 'hold' | 'discard';
        total_score: string | number;
        rationale: Record<string, unknown>;
        evaluated_at: Date;
      }>(
        `
          SELECT id, radar_item_id, decision, total_score, rationale, evaluated_at
          FROM tech_radar_scores
          ${where}
          ORDER BY evaluated_at DESC
          LIMIT 200
        `,
        params
      );

      return rows.map((row) => ({
        id: row.id,
        itemId: row.radar_item_id,
        decision: row.decision,
        totalScore: Number(row.total_score),
        expectedBenefit: String(row.rationale.expectedBenefit ?? 'medium'),
        migrationCost: String(row.rationale.migrationCost ?? 'medium'),
        riskLevel: String(row.rationale.riskLevel ?? 'medium'),
        evaluatedAt: row.evaluated_at.toISOString()
      }));
    },

    async createTelegramReport(input: { chatId: string }) {
      const { rows } = await pool.query<{
        id: string;
        chat_id: string;
        status: 'queued' | 'sent' | 'failed';
        created_at: Date;
      }>(
        `
          INSERT INTO telegram_reports (chat_id, topic, body_markdown, status)
          VALUES ($1, 'radar-digest', 'queued by api', 'queued'::telegram_report_status)
          RETURNING id, chat_id, status, created_at
        `,
        [input.chatId]
      );

      return {
        id: rows[0]!.id,
        chatId: rows[0]!.chat_id,
        status: rows[0]!.status,
        createdAt: rows[0]!.created_at.toISOString()
      };
    },

    async listUpgradeProposals(status?: UpgradeStatus) {
      const params: unknown[] = [];
      let where = '';

      if (status) {
        params.push(status);
        where = 'WHERE status = $1::upgrade_status';
      }

      const { rows } = await pool.query<UpgradeProposalRow>(
        `
          SELECT id, radar_score_id, proposal_title, status, created_at, approved_at
          FROM upgrade_proposals
          ${where}
          ORDER BY created_at DESC
          LIMIT 200
        `,
        params
      );

      return rows.map((row) => mapUpgradeProposalRow(row));
    },

    async findUpgradeProposalById(proposalId: string) {
      const { rows } = await pool.query<UpgradeProposalRow>(
        `
          SELECT id, radar_score_id, proposal_title, status, created_at, approved_at
          FROM upgrade_proposals
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [proposalId]
      );

      return rows[0] ? mapUpgradeProposalRow(rows[0]) : null;
    },

    async decideUpgradeProposal(proposalId: string, decision: 'approve' | 'reject', reason?: string) {
      const nextStatus: UpgradeStatus = decision === 'approve' ? 'approved' : 'rejected';

      const { rows } = await pool.query<UpgradeProposalRow>(
        `
          UPDATE upgrade_proposals
          SET status = $2::upgrade_status,
              approved_at = CASE WHEN $2::upgrade_status = 'approved'::upgrade_status THEN now() ELSE NULL END,
              updated_at = now()
          WHERE id = $1::uuid
          RETURNING id, radar_score_id, proposal_title, status, created_at, approved_at
        `,
        [proposalId, nextStatus]
      );

      if (!rows[0]) {
        return null;
      }

      await pool.query(
        `
          INSERT INTO audit_logs (
            actor_user_id,
            action,
            entity_type,
            entity_id,
            reason,
            after_data
          )
          VALUES ($1::uuid, 'upgrade_proposal.decide', 'upgrade_proposal', $2::uuid, $3, $4::jsonb)
        `,
        [options.defaultUserId, proposalId, reason ?? nextStatus, JSON.stringify({ status: nextStatus })]
      );

      return mapUpgradeProposalRow(rows[0]);
    },

    async createUpgradeRun(payload: { proposalId: string; startCommand: string }) {
      const { rows } = await pool.query<UpgradeRunRow>(
        `
          INSERT INTO upgrade_runs (
            proposal_id,
            triggered_by,
            start_command,
            status
          )
          VALUES ($1::uuid, $2::uuid, $3, 'planning'::upgrade_status)
          RETURNING id, proposal_id, status, start_command, created_at, updated_at
        `,
        [payload.proposalId, options.defaultUserId, payload.startCommand]
      );

      return mapUpgradeRunRow(rows[0]!);
    },

    async getUpgradeRunById(runId: string) {
      const { rows } = await pool.query<UpgradeRunRow>(
        `
          SELECT id, proposal_id, status, start_command, created_at, updated_at
          FROM upgrade_runs
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [runId]
      );

      return rows[0] ? mapUpgradeRunRow(rows[0]) : null;
    },

    createUpgradeExecutorGateway() {
      return {
        findProposalById: async (proposalId: string) => {
          const proposal = await store.findUpgradeProposalById(proposalId);
          if (!proposal) {
            return null;
          }
          return {
            id: proposal.id,
            status: proposal.status
          };
        },
        createRun: async (payload: { proposalId: string; startCommand: string }) => {
          const run = await store.createUpgradeRun(payload);
          return {
            id: run.id,
            proposalId: run.proposalId,
            status: run.status
          };
        },
        appendAuditLog: async (entry: { action: string; proposalId: string; reason: string }) => {
          await pool.query(
            `
              INSERT INTO audit_logs (
                actor_user_id,
                action,
                entity_type,
                entity_id,
                reason,
                after_data
              )
              VALUES ($1::uuid, $2, 'upgrade_proposal', $3::uuid, $4, $5::jsonb)
            `,
            [
              options.defaultUserId,
              entry.action,
              entry.proposalId,
              entry.reason,
              JSON.stringify({ reason: entry.reason })
            ]
          );
        }
      };
    }
  };

  function mapTaskRow(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      userId: row.user_id,
      mode: row.mode,
      status: row.status,
      title: row.title,
      input: row.input,
      idempotencyKey: row.idempotency_key,
      traceId: row.trace_id ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  function mapUpgradeProposalRow(row: UpgradeProposalRow): UpgradeProposalRecord {
    return {
      id: row.id,
      recommendationId: row.radar_score_id,
      proposalTitle: row.proposal_title,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      approvedAt: toIso(row.approved_at)
    };
  }

  function mapUpgradeRunRow(row: UpgradeRunRow): UpgradeRunApiRecord {
    return {
      id: row.id,
      proposalId: row.proposal_id,
      status: row.status,
      startCommand: row.start_command,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  return store;
}
