import type { Pool } from 'pg';

import type { MemoryRepositoryContract } from '../repository-contracts';
import type { MemoryNoteRecord, MemorySegmentRecord } from '../types';
import type { MemoryNoteRow } from './types';

type MemoryRepositoryDeps = {
  pool: Pool;
};

export function createMemoryRepository({ pool }: MemoryRepositoryDeps): MemoryRepositoryContract {
  return {
    async createMemorySegment(input) {
      const { rows } = await pool.query(
        `
          INSERT INTO memory_segments (user_id, task_id, segment_type, content, embedding, confidence, expires_at)
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
          RETURNING id, user_id, task_id, segment_type, content, confidence, created_at, expires_at
        `,
        [
          input.userId,
          input.taskId ?? null,
          input.segmentType,
          input.content,
          input.embedding ? `[${input.embedding.join(',')}]` : null,
          input.confidence ?? 0.5,
          input.expiresAt ?? null
        ]
      );

      return mapMemorySegmentRow(rows[0] as Record<string, unknown>);
    },

    async searchMemoryByEmbedding(input) {
      const minConf = input.minConfidence ?? 0;
      const { rows } = await pool.query(
        `
          SELECT id, user_id, task_id, segment_type, content, confidence, created_at, expires_at,
                 1 - (embedding <=> $1::vector) AS similarity
          FROM memory_segments
          WHERE user_id = $2::uuid
            AND embedding IS NOT NULL
            AND confidence >= $3
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY embedding <=> $1::vector
          LIMIT $4
        `,
        [`[${input.embedding.join(',')}]`, input.userId, minConf, input.limit]
      );

      return rows.map((row: Record<string, unknown>) => mapMemorySegmentRow(row, Number(row.similarity)));
    },

    async listMemorySegments(input) {
      const { rows } = await pool.query(
        `
          SELECT id, user_id, task_id, segment_type, content, confidence, created_at, expires_at
          FROM memory_segments
          WHERE user_id = $1::uuid
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [input.userId, input.limit]
      );
      return rows.map((row: Record<string, unknown>) => mapMemorySegmentRow(row));
    },

    async createMemoryNote(input) {
      const { rows } = await pool.query(
        `
          INSERT INTO memory_notes (
            user_id,
            kind,
            title,
            content,
            memory_key,
            memory_value,
            attributes_json,
            tags_json,
            pinned,
            source,
            related_session_id,
            related_task_id
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12)
          RETURNING *
        `,
        [
          input.userId,
          input.kind,
          input.title,
          input.content,
          input.key ?? null,
          input.value ?? null,
          JSON.stringify(input.attributes ?? {}),
          JSON.stringify(Array.from(new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean)))),
          input.pinned ?? false,
          input.source ?? 'manual',
          input.relatedSessionId ?? null,
          input.relatedTaskId ?? null
        ]
      );
      return mapMemoryNoteRow(rows[0] as MemoryNoteRow);
    },

    async listMemoryNotes(input) {
      const conditions = ['user_id = $1::uuid'];
      const values: unknown[] = [input.userId];
      if (input.kind) {
        values.push(input.kind);
        conditions.push(`kind = $${values.length}`);
      }
      if (typeof input.pinned === 'boolean') {
        values.push(input.pinned);
        conditions.push(`pinned = $${values.length}`);
      }
      values.push(input.limit);
      const { rows } = await pool.query(
        `
          SELECT *
          FROM memory_notes
          WHERE ${conditions.join(' AND ')}
          ORDER BY pinned DESC, updated_at DESC
          LIMIT $${values.length}
        `,
        values
      );
      return rows.map((row) => mapMemoryNoteRow(row as MemoryNoteRow));
    },

    async updateMemoryNote(input) {
      const updates: string[] = [];
      const values: unknown[] = [input.noteId, input.userId];
      if (typeof input.title === 'string') {
        values.push(input.title);
        updates.push(`title = $${values.length}`);
      }
      if (typeof input.content === 'string') {
        values.push(input.content);
        updates.push(`content = $${values.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(input, 'key')) {
        values.push(input.key ?? null);
        updates.push(`memory_key = $${values.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(input, 'value')) {
        values.push(input.value ?? null);
        updates.push(`memory_value = $${values.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(input, 'attributes')) {
        values.push(JSON.stringify(input.attributes ?? {}));
        updates.push(`attributes_json = $${values.length}::jsonb`);
      }
      if (Array.isArray(input.tags)) {
        values.push(JSON.stringify(Array.from(new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)))));
        updates.push(`tags_json = $${values.length}::jsonb`);
      }
      if (typeof input.pinned === 'boolean') {
        values.push(input.pinned);
        updates.push(`pinned = $${values.length}`);
      }
      if (updates.length === 0) {
        const { rows } = await pool.query(`SELECT * FROM memory_notes WHERE id = $1::uuid AND user_id = $2::uuid`, values);
        return rows[0] ? mapMemoryNoteRow(rows[0] as MemoryNoteRow) : null;
      }
      const { rows } = await pool.query(
        `
          UPDATE memory_notes
          SET ${updates.join(', ')}, updated_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING *
        `,
        values
      );
      return rows[0] ? mapMemoryNoteRow(rows[0] as MemoryNoteRow) : null;
    },

    async deleteMemoryNote(input) {
      const result = await pool.query(`DELETE FROM memory_notes WHERE id = $1::uuid AND user_id = $2::uuid`, [input.noteId, input.userId]);
      return (result.rowCount ?? 0) > 0;
    }
  };
}

function mapMemorySegmentRow(row: Record<string, unknown>, similarity?: number): MemorySegmentRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    taskId: row.task_id ? String(row.task_id) : null,
    segmentType: String(row.segment_type),
    content: String(row.content),
    confidence: Number(row.confidence),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    expiresAt: row.expires_at ? (row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at)) : null,
    similarity
  };
}

function mapMemoryNoteRow(row: MemoryNoteRow): MemoryNoteRecord {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    key: row.memory_key,
    value: row.memory_value,
    attributes: row.attributes_json && typeof row.attributes_json === 'object' ? row.attributes_json : {},
    tags: Array.isArray(row.tags_json) ? row.tags_json.filter((value): value is string => typeof value === 'string') : [],
    pinned: row.pinned,
    source: row.source,
    relatedSessionId: row.related_session_id,
    relatedTaskId: row.related_task_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
