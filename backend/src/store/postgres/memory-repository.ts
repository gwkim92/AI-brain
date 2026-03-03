import type { Pool } from 'pg';

import type { MemoryRepositoryContract } from '../repository-contracts';
import type { MemorySegmentRecord } from '../types';

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
