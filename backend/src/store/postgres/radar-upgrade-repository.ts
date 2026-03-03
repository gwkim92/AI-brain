import type { Pool } from 'pg';

import { evaluateRadarItems } from '../../radar/scoring';
import type { RadarUpgradeRepositoryContract } from '../repository-contracts';
import type { RadarItemRow, UpgradeProposalRow, UpgradeRunRow } from './types';
import type {
  RadarItemRecord,
  RadarItemStatus,
  RadarRecommendationRecord,
  UpgradeProposalRecord,
  UpgradeRunApiRecord,
  UpgradeStatus
} from '../types';

type RadarUpgradeRepositoryDeps = {
  pool: Pool;
  defaultUserId: string;
};

export function createRadarUpgradeRepository({
  pool,
  defaultUserId
}: RadarUpgradeRepositoryDeps): RadarUpgradeRepositoryContract {
  const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

  return {
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

      return rows.map((row) => mapUpgradeProposalRow(row, toIso));
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

      return rows[0] ? mapUpgradeProposalRow(rows[0], toIso) : null;
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
        [defaultUserId, proposalId, reason ?? nextStatus, JSON.stringify({ status: nextStatus })]
      );

      return mapUpgradeProposalRow(rows[0], toIso);
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
        [payload.proposalId, defaultUserId, payload.startCommand]
      );

      return mapUpgradeRunRow(rows[0]!);
    },

    async listUpgradeRuns(limit: number) {
      const { rows } = await pool.query<UpgradeRunRow>(
        `
          SELECT id, proposal_id, status, start_command, created_at, updated_at
          FROM upgrade_runs
          ORDER BY created_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return rows.map((row) => mapUpgradeRunRow(row));
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
    }
  };
}

function mapUpgradeProposalRow(
  row: UpgradeProposalRow,
  toIso: (value: Date | null) => string | null
): UpgradeProposalRecord {
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
