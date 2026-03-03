import type {
  AssistantContextEventRecord,
  AssistantContextGroundingClaimRecord,
  AssistantContextGroundingSourceRecord,
  AssistantContextRecord
} from '../types';
import type {
  AssistantContextEventRow,
  AssistantContextGroundingClaimCitationJoinRow,
  AssistantContextGroundingClaimRow,
  AssistantContextGroundingSourceRow,
  AssistantContextRow
} from './types';

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

export function mapAssistantContextRow(row: AssistantContextRow): AssistantContextRecord {
  const widgetPlan = parseJsonArray<string>(row.widget_plan).filter((item) => typeof item === 'string' && item.trim().length > 0);

  return {
    id: row.id,
    userId: row.user_id,
    clientContextId: row.client_context_id,
    source: row.source,
    intent: row.intent,
    prompt: row.prompt,
    widgetPlan,
    status: row.status,
    taskId: row.task_id,
    servedProvider: row.served_provider,
    servedModel: row.served_model,
    usedFallback: row.used_fallback,
    selectionReason: row.selection_reason,
    output: row.output,
    error: row.error,
    revision: row.revision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export function mapAssistantContextEventRow(row: AssistantContextEventRow): AssistantContextEventRecord {
  return {
    id: row.id,
    contextId: row.context_id,
    sequence: typeof row.sequence === 'string' ? Number.parseInt(row.sequence, 10) : row.sequence,
    eventType: row.event_type,
    data: row.data,
    traceId: row.trace_id ?? undefined,
    spanId: row.span_id ?? undefined,
    createdAt: row.created_at.toISOString()
  };
}

export function mapAssistantContextGroundingSourceRow(
  row: AssistantContextGroundingSourceRow
): AssistantContextGroundingSourceRecord {
  return {
    id: row.id,
    contextId: row.context_id,
    url: row.url,
    title: row.title,
    domain: row.domain,
    sourceOrder: row.source_order,
    createdAt: row.created_at.toISOString()
  };
}

export async function listGroundingClaimsByContextId(
  queryable: { query: <T>(queryText: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  contextId: string
): Promise<AssistantContextGroundingClaimRecord[]> {
  const claimRows = await queryable.query<AssistantContextGroundingClaimRow>(
    `
      SELECT id, context_id, claim_text, claim_order, created_at
      FROM assistant_context_grounding_claims
      WHERE context_id = $1::uuid
      ORDER BY claim_order ASC, created_at ASC
    `,
    [contextId]
  );
  if (claimRows.rows.length === 0) {
    return [];
  }

  const claimIds = claimRows.rows.map((row) => row.id);
  const citationRows = await queryable.query<AssistantContextGroundingClaimCitationJoinRow>(
    `
      SELECT
        cc.claim_id,
        cc.source_id,
        cc.citation_order,
        s.source_order,
        s.url,
        s.title,
        s.domain
      FROM assistant_context_grounding_claim_citations cc
      INNER JOIN assistant_context_grounding_sources s ON s.id = cc.source_id
      WHERE cc.claim_id = ANY($1::uuid[])
      ORDER BY cc.claim_id ASC, cc.citation_order ASC, s.source_order ASC
    `,
    [claimIds]
  );

  const citationsByClaimId = new Map<string, AssistantContextGroundingClaimRecord['citations']>();
  for (const citationRow of citationRows.rows) {
    const current = citationsByClaimId.get(citationRow.claim_id) ?? [];
    current.push({
      sourceId: citationRow.source_id,
      url: citationRow.url,
      title: citationRow.title,
      domain: citationRow.domain,
      citationOrder: citationRow.citation_order,
      sourceOrder: citationRow.source_order
    });
    citationsByClaimId.set(citationRow.claim_id, current);
  }

  return claimRows.rows.map((row) => ({
    id: row.id,
    contextId: row.context_id,
    claimText: row.claim_text,
    claimOrder: row.claim_order,
    citations: citationsByClaimId.get(row.id) ?? [],
    createdAt: row.created_at.toISOString()
  }));
}
