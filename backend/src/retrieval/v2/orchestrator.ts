import { evaluateCoverageGate, scoreRetrievalV2 } from './scoring';
import type {
  RetrievalAdapterV2,
  RetrievalEvidenceCandidateV2,
  RetrievalOrchestratorInputV2,
  RetrievalOrchestratorResultV2,
  RetrievalSubQueryV2
} from './types';

const MAX_SUB_QUERY_COUNT = 6;

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/gu, ' ');
}

function buildSubQueries(query: string): RetrievalSubQueryV2[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }

  const splitItems = normalized
    .split(/,|;|\n|\s+and\s+|\s+그리고\s+|\s+및\s+/giu)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const unique = Array.from(new Set(splitItems.length > 0 ? splitItems : [normalized])).slice(0, MAX_SUB_QUERY_COUNT);
  return unique.map((text, index) => ({
    id: `q_${index + 1}`,
    text
  }));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'unknown_retrieval_error';
}

function dedupeEvidence(items: RetrievalEvidenceCandidateV2[]): RetrievalEvidenceCandidateV2[] {
  const deduped = new Map<string, RetrievalEvidenceCandidateV2>();
  for (const item of items) {
    const key = item.url.trim();
    if (!key) continue;
    const previous = deduped.get(key);
    if (!previous || previous.rankScore < item.rankScore) {
      deduped.set(key, item);
    }
  }
  return Array.from(deduped.values());
}

export async function runRetrievalOrchestratorV2(input: {
  adapters: RetrievalAdapterV2[];
  request: RetrievalOrchestratorInputV2;
}): Promise<RetrievalOrchestratorResultV2> {
  const normalizedQuery = normalizeQuery(input.request.query);
  const subQueries = buildSubQueries(normalizedQuery);
  const adapters = input.adapters;
  const runMaxItems = Math.max(1, Math.min(10, Math.ceil(input.request.maxItems / Math.max(1, adapters.length))));

  const runResults = await Promise.all(
    subQueries.flatMap((subQuery) =>
      adapters.map(async (adapter) => {
        const runKey = `${adapter.id}:${subQuery.id}`;
        const startedAt = Date.now();
        try {
          const result = await adapter.query({
            subQuery,
            maxItems: runMaxItems,
            nowIso: new Date().toISOString()
          });
          const items = result.items.map((item) => ({
            ...item,
            runKey,
            subQueryId: subQuery.id,
            connector: item.connector || adapter.id
          }));
          return {
            run: {
              runKey,
              subQueryId: subQuery.id,
              subQuery: subQuery.text,
              adapterId: adapter.id,
              status: 'completed' as const,
              latencyMs: Date.now() - startedAt,
              itemCount: items.length
            },
            items
          };
        } catch (error) {
          return {
            run: {
              runKey,
              subQueryId: subQuery.id,
              subQuery: subQuery.text,
              adapterId: adapter.id,
              status: 'failed' as const,
              latencyMs: Date.now() - startedAt,
              itemCount: 0,
              error: toErrorMessage(error)
            },
            items: [] as RetrievalEvidenceCandidateV2[]
          };
        }
      })
    )
  );

  const runs = runResults.map((result) => result.run);
  const rawEvidence = runResults.flatMap((result) => result.items);
  const dedupedEvidence = dedupeEvidence(rawEvidence)
    .sort((left, right) => right.rankScore - left.rankScore)
    .slice(0, input.request.maxItems);

  const score = scoreRetrievalV2({
    subQueries,
    evidenceItems: rawEvidence
  });
  const gate = evaluateCoverageGate({
    intent: input.request.intent,
    riskLevel: input.request.riskLevel,
    score
  });

  return {
    normalizedQuery,
    subQueries,
    runs,
    evidenceItems: dedupedEvidence,
    score,
    gate
  };
}
