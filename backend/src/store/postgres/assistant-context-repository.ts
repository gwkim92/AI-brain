import type { Pool } from 'pg';

import { listGroundingClaimsByContextId, mapAssistantContextEventRow, mapAssistantContextGroundingSourceRow, mapAssistantContextRow } from './assistant-context-mappers';
import type {
  AssistantContextEventRow,
  AssistantContextGroundingClaimRow,
  AssistantContextGroundingSourceRow,
  AssistantContextRow
} from './types';
import type {
  AssistantContextStatus,
  AppendAssistantContextEventInput,
  ReplaceAssistantContextGroundingClaimsInput,
  ReplaceAssistantContextGroundingSourcesInput,
  UpdateAssistantContextInput,
  UpsertAssistantContextInput
} from '../types';
import type { AssistantContextRepositoryContract } from '../repository-contracts';

type AssistantContextRepositoryDeps = {
  pool: Pool;
  defaultUserId: string;
};

export function createAssistantContextRepository({
  pool,
  defaultUserId
}: AssistantContextRepositoryDeps): AssistantContextRepositoryContract {
  return {
    async upsertAssistantContext(input: UpsertAssistantContextInput) {
      const { rows } = await pool.query<AssistantContextRow>(
        `
          INSERT INTO assistant_contexts (
            user_id,
            client_context_id,
            source,
            intent,
            prompt,
            widget_plan,
            status,
            task_id
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8::uuid)
          ON CONFLICT (user_id, client_context_id) DO UPDATE
          SET
            task_id = COALESCE(EXCLUDED.task_id, assistant_contexts.task_id),
            updated_at = now(),
            revision = assistant_contexts.revision + 1
          RETURNING
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
        `,
        [
          input.userId || defaultUserId,
          input.clientContextId,
          input.source,
          input.intent,
          input.prompt,
          JSON.stringify(input.widgetPlan),
          input.status ?? 'running',
          input.taskId ?? null
        ]
      );

      return mapAssistantContextRow(rows[0]!);
    },

    async updateAssistantContext(input: UpdateAssistantContextInput) {
      const current = await pool.query<AssistantContextRow>(
        `
          SELECT
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
          FROM assistant_contexts
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          LIMIT 1
        `,
        [input.contextId, input.userId]
      );

      const row = current.rows[0];
      if (!row) {
        return null;
      }

      const next = mapAssistantContextRow(row);
      const updatedStatus = input.status ?? next.status;
      const updatedTaskId = typeof input.taskId === 'undefined' ? next.taskId : input.taskId;
      const updatedServedProvider =
        typeof input.servedProvider === 'undefined' ? next.servedProvider : input.servedProvider;
      const updatedServedModel = typeof input.servedModel === 'undefined' ? next.servedModel : input.servedModel;
      const updatedUsedFallback = typeof input.usedFallback === 'undefined' ? next.usedFallback : input.usedFallback;
      const updatedSelectionReason =
        typeof input.selectionReason === 'undefined' ? next.selectionReason : input.selectionReason;
      const updatedOutput = typeof input.output === 'undefined' ? next.output : input.output;
      const updatedError = typeof input.error === 'undefined' ? next.error : input.error;

      const { rows } = await pool.query<AssistantContextRow>(
        `
          UPDATE assistant_contexts
          SET
            status = $3,
            task_id = $4::uuid,
            served_provider = $5,
            served_model = $6,
            used_fallback = $7,
            selection_reason = $8,
            output = $9,
            error = $10,
            revision = revision + 1,
            updated_at = now()
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          RETURNING
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
        `,
        [
          input.contextId,
          input.userId,
          updatedStatus,
          updatedTaskId,
          updatedServedProvider,
          updatedServedModel,
          updatedUsedFallback,
          updatedSelectionReason,
          updatedOutput,
          updatedError
        ]
      );

      return rows[0] ? mapAssistantContextRow(rows[0]) : null;
    },

    async listAssistantContexts(input: { userId: string; status?: AssistantContextStatus; limit: number }) {
      const params: unknown[] = [input.userId, input.limit];
      let where = '';

      if (input.status) {
        params.splice(1, 0, input.status);
        where = 'AND status = $2';
      }

      const limitParam = input.status ? '$3' : '$2';
      const { rows } = await pool.query<AssistantContextRow>(
        `
          SELECT
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
          FROM assistant_contexts
          WHERE user_id = $1::uuid
          ${where}
          ORDER BY updated_at DESC
          LIMIT ${limitParam}
        `,
        params
      );

      return rows.map((row) => mapAssistantContextRow(row));
    },

    async getAssistantContextById(input: { userId: string; contextId: string }) {
      const { rows } = await pool.query<AssistantContextRow>(
        `
          SELECT
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
          FROM assistant_contexts
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          LIMIT 1
        `,
        [input.contextId, input.userId]
      );

      return rows[0] ? mapAssistantContextRow(rows[0]) : null;
    },

    async getAssistantContextByClientContextId(input: { userId: string; clientContextId: string }) {
      const { rows } = await pool.query<AssistantContextRow>(
        `
          SELECT
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
          FROM assistant_contexts
          WHERE user_id = $1::uuid
            AND client_context_id = $2
          LIMIT 1
        `,
        [input.userId, input.clientContextId]
      );

      return rows[0] ? mapAssistantContextRow(rows[0]) : null;
    },

    async appendAssistantContextEvent(input: AppendAssistantContextEventInput) {
      const { rows } = await pool.query<AssistantContextEventRow>(
        `
          INSERT INTO assistant_context_events (
            context_id,
            event_type,
            data,
            trace_id,
            span_id
          )
          SELECT c.id, $3, $4::jsonb, $5, $6
          FROM assistant_contexts c
          WHERE c.id = $1::uuid
            AND c.user_id = $2::uuid
          RETURNING id, context_id, sequence, event_type, data, trace_id, span_id, created_at
        `,
        [input.contextId, input.userId, input.eventType, JSON.stringify(input.data), input.traceId ?? null, input.spanId ?? null]
      );

      if (!rows[0]) {
        return null;
      }

      return mapAssistantContextEventRow(rows[0]);
    },

    async listAssistantContextEvents(input: { userId: string; contextId: string; sinceSequence?: number; limit: number }) {
      const params: unknown[] = [input.userId, input.contextId];
      let sinceClause = '';

      if (typeof input.sinceSequence === 'number') {
        params.push(input.sinceSequence);
        sinceClause = `AND e.sequence > $${params.length}::bigint`;
      }

      params.push(input.limit);
      const limitParam = `$${params.length}`;

      const { rows } = await pool.query<AssistantContextEventRow>(
        `
          SELECT
            e.id, e.context_id, e.sequence, e.event_type, e.data, e.trace_id, e.span_id, e.created_at
          FROM assistant_context_events e
          INNER JOIN assistant_contexts c ON c.id = e.context_id
          WHERE c.user_id = $1::uuid
            AND e.context_id = $2::uuid
            ${sinceClause}
          ORDER BY e.sequence ASC
          LIMIT ${limitParam}
        `,
        params
      );

      return rows.map((row) => mapAssistantContextEventRow(row));
    },

    async replaceAssistantContextGroundingSources(input: ReplaceAssistantContextGroundingSourcesInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const contextRows = await client.query<{ id: string }>(
          `
            SELECT id
            FROM assistant_contexts
            WHERE id = $1::uuid
              AND user_id = $2::uuid
            LIMIT 1
          `,
          [input.contextId, input.userId]
        );
        if (!contextRows.rows[0]) {
          await client.query('ROLLBACK');
          return [];
        }

        await client.query(
          `
            DELETE FROM assistant_context_grounding_sources
            WHERE context_id = $1::uuid
          `,
          [input.contextId]
        );
        await client.query(
          `
            DELETE FROM assistant_context_grounding_claims
            WHERE context_id = $1::uuid
          `,
          [input.contextId]
        );

        const normalized = input.sources
          .map((source) => ({
            url: source.url.trim(),
            title: source.title.trim(),
            domain: source.domain.trim()
          }))
          .filter((source) => source.url.length > 0);

        if (normalized.length > 0) {
          const values: string[] = [];
          const params: unknown[] = [input.contextId];
          normalized.forEach((source, index) => {
            const offset = 2 + index * 4;
            values.push(`($1::uuid, $${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3})`);
            params.push(
              source.url,
              source.title.length > 0 ? source.title : source.domain || 'source',
              source.domain.length > 0 ? source.domain : 'unknown',
              index
            );
          });

          await client.query(
            `
              INSERT INTO assistant_context_grounding_sources (
                context_id, url, title, domain, source_order
              )
              VALUES ${values.join(', ')}
              ON CONFLICT (context_id, url) DO UPDATE
              SET
                title = EXCLUDED.title,
                domain = EXCLUDED.domain,
                source_order = EXCLUDED.source_order
            `,
            params
          );
        }

        const { rows } = await client.query<AssistantContextGroundingSourceRow>(
          `
            SELECT id, context_id, url, title, domain, source_order, created_at
            FROM assistant_context_grounding_sources
            WHERE context_id = $1::uuid
            ORDER BY source_order ASC, created_at ASC
          `,
          [input.contextId]
        );

        await client.query('COMMIT');
        return rows.map((row) => mapAssistantContextGroundingSourceRow(row));
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listAssistantContextGroundingSources(input: { userId: string; contextId: string; limit: number }) {
      const { rows } = await pool.query<AssistantContextGroundingSourceRow>(
        `
          SELECT s.id, s.context_id, s.url, s.title, s.domain, s.source_order, s.created_at
          FROM assistant_context_grounding_sources s
          INNER JOIN assistant_contexts c ON c.id = s.context_id
          WHERE s.context_id = $1::uuid
            AND c.user_id = $2::uuid
          ORDER BY s.source_order ASC, s.created_at ASC
          LIMIT $3
        `,
        [input.contextId, input.userId, input.limit]
      );

      return rows.map((row) => mapAssistantContextGroundingSourceRow(row));
    },

    async replaceAssistantContextGroundingClaims(input: ReplaceAssistantContextGroundingClaimsInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const contextRows = await client.query<{ id: string }>(
          `
            SELECT id
            FROM assistant_contexts
            WHERE id = $1::uuid
              AND user_id = $2::uuid
            LIMIT 1
          `,
          [input.contextId, input.userId]
        );
        if (!contextRows.rows[0]) {
          await client.query('ROLLBACK');
          return [];
        }

        await client.query(
          `
            DELETE FROM assistant_context_grounding_claims
            WHERE context_id = $1::uuid
          `,
          [input.contextId]
        );

        const sourceRows = await client.query<AssistantContextGroundingSourceRow>(
          `
            SELECT id, context_id, url, title, domain, source_order, created_at
            FROM assistant_context_grounding_sources
            WHERE context_id = $1::uuid
            ORDER BY source_order ASC, created_at ASC
          `,
          [input.contextId]
        );
        const sourceByUrl = new Map(sourceRows.rows.map((row) => [row.url, row]));

        for (let claimOrder = 0; claimOrder < input.claims.length; claimOrder += 1) {
          const claim = input.claims[claimOrder]!;
          const claimText = claim.claimText.trim();
          if (!claimText) {
            continue;
          }

          const dedupedUrls = claim.sourceUrls
            .map((value) => value.trim())
            .filter((value, index, rows) => value.length > 0 && rows.indexOf(value) === index);
          if (dedupedUrls.length === 0) {
            continue;
          }

          const matchedSources = dedupedUrls
            .map((url) => sourceByUrl.get(url))
            .filter((row): row is AssistantContextGroundingSourceRow => Boolean(row));
          if (matchedSources.length === 0) {
            continue;
          }

          const insertedClaimRows = await client.query<AssistantContextGroundingClaimRow>(
            `
              INSERT INTO assistant_context_grounding_claims (context_id, claim_text, claim_order)
              VALUES ($1::uuid, $2, $3)
              RETURNING id, context_id, claim_text, claim_order, created_at
            `,
            [input.contextId, claimText, claimOrder]
          );
          const insertedClaim = insertedClaimRows.rows[0];
          if (!insertedClaim) {
            continue;
          }

          const values: string[] = [];
          const params: unknown[] = [insertedClaim.id];
          matchedSources.forEach((source, citationOrder) => {
            const offset = 2 + citationOrder * 2;
            values.push(`($1::uuid, $${offset}::uuid, $${offset + 1}::integer)`);
            params.push(source.id, citationOrder);
          });
          if (values.length > 0) {
            await client.query(
              `
                INSERT INTO assistant_context_grounding_claim_citations (claim_id, source_id, citation_order)
                VALUES ${values.join(', ')}
                ON CONFLICT (claim_id, source_id) DO UPDATE
                SET citation_order = EXCLUDED.citation_order
              `,
              params
            );
          }
        }

        const claims = await listGroundingClaimsByContextId(client, input.contextId);
        await client.query('COMMIT');
        return claims;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listAssistantContextGroundingClaims(input: { userId: string; contextId: string; limit: number }) {
      const contextRows = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM assistant_contexts
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          LIMIT 1
        `,
        [input.contextId, input.userId]
      );
      if (!contextRows.rows[0]) {
        return [];
      }

      const claims = await listGroundingClaimsByContextId(pool, input.contextId);
      if (claims.length <= input.limit) {
        return claims;
      }
      return claims.slice(0, input.limit);
    }
  };
}
