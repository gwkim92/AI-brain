import type { Pool } from 'pg';

import type { ExternalWorkRepositoryContract } from '../repository-contracts';
import type {
  CreateExternalWorkLinkInput,
  ExternalLinkTargetType,
  ExternalWorkItemRecord,
  ExternalWorkLinkRecord,
  ExternalWorkSource,
  ExternalWorkTriageStatus,
  UpdateExternalWorkItemInput,
  UpsertExternalWorkItemInput
} from '../types';
import type { ExternalWorkItemRow, ExternalWorkLinkRow } from './types';

type ExternalWorkRepositoryDeps = {
  pool: Pool;
};

function normalizeLimit(limit: number): number {
  return Math.max(1, Math.min(limit, 200));
}

function mapExternalWorkItemRow(row: ExternalWorkItemRow): ExternalWorkItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    externalId: row.external_id,
    identifier: row.identifier,
    title: row.title,
    description: row.description,
    url: row.url,
    state: row.state,
    priority: row.priority,
    labels: row.labels_json ?? [],
    triageStatus: row.triage_status,
    displayMetadata: row.display_metadata_json ?? {},
    rawPayload: row.raw_payload_json ?? {},
    lastSeenAt: row.last_seen_at.toISOString(),
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapExternalWorkLinkRow(row: ExternalWorkLinkRow): ExternalWorkLinkRecord {
  return {
    id: row.id,
    externalWorkItemId: row.external_work_item_id,
    targetType: row.target_type,
    targetId: row.target_id,
    role: row.role,
    createdAt: row.created_at.toISOString()
  };
}

export function createExternalWorkRepository({
  pool
}: ExternalWorkRepositoryDeps): ExternalWorkRepositoryContract {
  return {
    async upsertExternalWorkItems(input: { items: UpsertExternalWorkItemInput[] }) {
      const rows: ExternalWorkItemRecord[] = [];
      for (const item of input.items) {
        const { rows: upserted } = await pool.query<ExternalWorkItemRow>(
          `
            INSERT INTO external_work_items (
              user_id,
              source,
              external_id,
              identifier,
              title,
              description,
              url,
              state,
              priority,
              labels_json,
              triage_status,
              display_metadata_json,
              raw_payload_json,
              last_seen_at,
              last_synced_at,
              last_sync_error
            )
            VALUES (
              $1::uuid,
              $2::external_work_source,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8::external_work_state,
              $9,
              $10::jsonb,
              COALESCE($11::external_work_triage_status, 'new'::external_work_triage_status),
              $12::jsonb,
              $13::jsonb,
              COALESCE($14::timestamptz, now()),
              $15::timestamptz,
              $16
            )
            ON CONFLICT (user_id, source, external_id) DO UPDATE
            SET identifier = EXCLUDED.identifier,
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                url = EXCLUDED.url,
                state = EXCLUDED.state,
                priority = EXCLUDED.priority,
                labels_json = EXCLUDED.labels_json,
                triage_status = COALESCE($11::external_work_triage_status, external_work_items.triage_status),
                display_metadata_json = EXCLUDED.display_metadata_json,
                raw_payload_json = EXCLUDED.raw_payload_json,
                last_seen_at = EXCLUDED.last_seen_at,
                last_synced_at = COALESCE($15::timestamptz, external_work_items.last_synced_at),
                last_sync_error = CASE
                  WHEN $16::text IS NULL THEN external_work_items.last_sync_error
                  ELSE $16::text
                END,
                updated_at = now()
            RETURNING *
          `,
          [
            item.userId,
            item.source,
            item.externalId,
            item.identifier,
            item.title,
            item.description,
            item.url ?? null,
            item.state,
            item.priority ?? null,
            JSON.stringify(item.labels ?? []),
            item.triageStatus ?? null,
            JSON.stringify(item.displayMetadata ?? {}),
            JSON.stringify(item.rawPayload ?? {}),
            item.lastSeenAt ?? null,
            item.lastSyncedAt ?? null,
            item.lastSyncError ?? null
          ]
        );
        rows.push(mapExternalWorkItemRow(upserted[0]!));
      }
      return rows;
    },

    async listExternalWorkItems(input: {
      userId: string;
      source?: ExternalWorkSource;
      triageStatus?: ExternalWorkTriageStatus;
      limit: number;
    }) {
      const params: unknown[] = [input.userId];
      const where = ['user_id = $1::uuid'];
      if (input.source) {
        params.push(input.source);
        where.push(`source = $${params.length}::external_work_source`);
      }
      if (input.triageStatus) {
        params.push(input.triageStatus);
        where.push(`triage_status = $${params.length}::external_work_triage_status`);
      }
      params.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<ExternalWorkItemRow>(
        `
          SELECT *
          FROM external_work_items
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC
          LIMIT $${params.length}
        `,
        params
      );
      return rows.map(mapExternalWorkItemRow);
    },

    async getExternalWorkItemById(input: { itemId: string; userId: string }) {
      const { rows } = await pool.query<ExternalWorkItemRow>(
        `
          SELECT *
          FROM external_work_items
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          LIMIT 1
        `,
        [input.itemId, input.userId]
      );
      return rows[0] ? mapExternalWorkItemRow(rows[0]) : null;
    },

    async getExternalWorkItemBySource(input: {
      userId: string;
      source: ExternalWorkSource;
      externalId: string;
    }) {
      const { rows } = await pool.query<ExternalWorkItemRow>(
        `
          SELECT *
          FROM external_work_items
          WHERE user_id = $1::uuid
            AND source = $2::external_work_source
            AND external_id = $3
          LIMIT 1
        `,
        [input.userId, input.source, input.externalId]
      );
      return rows[0] ? mapExternalWorkItemRow(rows[0]) : null;
    },

    async updateExternalWorkItem(input: UpdateExternalWorkItemInput) {
      const { rows } = await pool.query<ExternalWorkItemRow>(
        `
          UPDATE external_work_items
          SET triage_status = COALESCE($3::external_work_triage_status, triage_status),
              last_synced_at = CASE
                WHEN $4::timestamptz IS NULL AND $6 = false THEN last_synced_at
                ELSE $4::timestamptz
              END,
              last_sync_error = CASE
                WHEN $5::text IS NULL AND $7 = false THEN last_sync_error
                ELSE $5::text
              END,
              updated_at = now()
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          RETURNING *
        `,
        [
          input.itemId,
          input.userId,
          input.triageStatus ?? null,
          input.lastSyncedAt ?? null,
          input.lastSyncError ?? null,
          Object.prototype.hasOwnProperty.call(input, 'lastSyncedAt'),
          Object.prototype.hasOwnProperty.call(input, 'lastSyncError')
        ]
      );
      return rows[0] ? mapExternalWorkItemRow(rows[0]) : null;
    },

    async createExternalWorkLink(input: CreateExternalWorkLinkInput) {
      const { rows } = await pool.query<ExternalWorkLinkRow>(
        `
          INSERT INTO external_work_links (
            external_work_item_id,
            target_type,
            target_id,
            role
          )
          VALUES ($1::uuid, $2::external_link_target_type, $3, $4::external_work_link_role)
          ON CONFLICT (external_work_item_id, target_type, target_id, role) DO UPDATE
          SET target_id = external_work_links.target_id
          RETURNING *
        `,
        [input.externalWorkItemId, input.targetType, input.targetId, input.role]
      );
      return mapExternalWorkLinkRow(rows[0]!);
    },

    async listExternalWorkLinksByItem(input: { itemId: string }) {
      const { rows } = await pool.query<ExternalWorkLinkRow>(
        `
          SELECT *
          FROM external_work_links
          WHERE external_work_item_id = $1::uuid
          ORDER BY created_at ASC
        `,
        [input.itemId]
      );
      return rows.map(mapExternalWorkLinkRow);
    },

    async listExternalWorkLinksByTarget(input: { targetType: ExternalLinkTargetType; targetId: string }) {
      const { rows } = await pool.query<ExternalWorkLinkRow>(
        `
          SELECT *
          FROM external_work_links
          WHERE target_type = $1::external_link_target_type
            AND target_id = $2
          ORDER BY created_at ASC
        `,
        [input.targetType, input.targetId]
      );
      return rows.map(mapExternalWorkLinkRow);
    },

    async getPrimaryExternalWorkLinkByItem(input: { itemId: string }) {
      const { rows } = await pool.query<ExternalWorkLinkRow>(
        `
          SELECT *
          FROM external_work_links
          WHERE external_work_item_id = $1::uuid
            AND role = 'primary'::external_work_link_role
          ORDER BY created_at ASC
          LIMIT 1
        `,
        [input.itemId]
      );
      return rows[0] ? mapExternalWorkLinkRow(rows[0]) : null;
    },

    async getPrimaryExternalWorkLinkByTarget(input: { targetType: ExternalLinkTargetType; targetId: string }) {
      const { rows } = await pool.query<ExternalWorkLinkRow>(
        `
          SELECT *
          FROM external_work_links
          WHERE target_type = $1::external_link_target_type
            AND target_id = $2
            AND role = 'primary'::external_work_link_role
          ORDER BY created_at ASC
          LIMIT 1
        `,
        [input.targetType, input.targetId]
      );
      return rows[0] ? mapExternalWorkLinkRow(rows[0]) : null;
    }
  };
}
