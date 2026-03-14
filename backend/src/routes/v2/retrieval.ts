import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sendError, sendSuccess } from '../../lib/http';
import { runRetrievalOrchestratorV2 } from '../../retrieval/v2/orchestrator';
import { createBraveWebAdapter } from '../../retrieval/v2/adapters/brave';
import { createCrossrefScholarAdapter } from '../../retrieval/v2/adapters/crossref';
import { createGitHubCodeAdapter } from '../../retrieval/v2/adapters/github';
import { getSharedMemoryV2Repository } from '../../store/memory/v2-repositories';
import { createPostgresV2Repository } from '../../store/postgres/v2-repositories';
import type { V2RunStatus } from '../../store/types';
import type { V2RouteContext } from './types';

const RetrievalQuerySchema = z.object({
  contract_id: z.string().uuid(),
  query: z.string().min(1).max(12000),
  max_items: z.coerce.number().int().min(1).max(50).default(15)
});

const memoryV2Repo = getSharedMemoryV2Repository();

function toV2RunStatus(status: 'completed' | 'failed' | 'skipped'): V2RunStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'blocked';
}

export async function registerV2RetrievalRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.post('/api/v2/retrieval/query', async (request, reply) => {
    if (!ctx.v2Flags.retrievalEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 retrieval is disabled');
    }

    const parsed = RetrievalQuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid v2 retrieval payload', parsed.error.flatten());
    }

    const userId = ctx.resolveRequestUserId(request);
    const pool = ctx.store.getPool();
    const repo = pool ? createPostgresV2Repository(pool) : memoryV2Repo;
    const contract = await repo.getCommandCompilationById({
      id: parsed.data.contract_id,
      userId
    });
    if (!contract) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'execution contract not found');
    }

    const retrievalResult = await runRetrievalOrchestratorV2({
      adapters: [
        createBraveWebAdapter({ apiKey: ctx.env.BRAVE_API_KEY }),
        createCrossrefScholarAdapter({ mailto: ctx.env.CROSSREF_MAILTO }),
        createGitHubCodeAdapter({ token: ctx.env.GITHUB_TOKEN })
      ],
      request: {
        query: parsed.data.query,
        maxItems: parsed.data.max_items,
        riskLevel: contract.riskLevel,
        intent: contract.intent
      }
    });

    const queryRecords = await Promise.all(
      retrievalResult.runs.map((run) =>
        repo.createRetrievalQuery({
          contractId: contract.id,
          userId,
          query: run.subQuery,
          connector: run.adapterId,
          status: toV2RunStatus(run.status),
          metadata: {
            run_key: run.runKey,
            sub_query_id: run.subQueryId,
            latency_ms: run.latencyMs,
            item_count: run.itemCount,
            error: run.error ?? null
          }
        })
      )
    );

    const queryIdByRunKey = new Map(queryRecords.map((record) => [String(record.metadata.run_key), record.id]));
    const evidenceInput = retrievalResult.evidenceItems
      .map((item) => {
        const queryId = queryIdByRunKey.get(item.runKey);
        if (!queryId) return null;
        return {
          queryId,
          url: item.url,
          title: item.title,
          domain: item.domain,
          snippet: item.snippet,
          publishedAt: item.publishedAt,
          connector: item.connector,
          rankScore: item.rankScore,
          metadata: {
            ...item.metadata,
            sub_query_id: item.subQueryId
          }
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    await repo.createRetrievalEvidenceItems(evidenceInput);

    const scoreRecord = await repo.createRetrievalScore({
      contractId: contract.id,
      trustScore: retrievalResult.score.trustScore,
      coverageScore: retrievalResult.score.coverageScore,
      freshnessScore: retrievalResult.score.freshnessScore,
      diversityScore: retrievalResult.score.diversityScore,
      blocked: retrievalResult.gate.blocked,
      blockedReasons: retrievalResult.gate.blockedReasons
    });

    return sendSuccess(reply, request, 200, {
      contract_id: contract.id,
      normalized_query: retrievalResult.normalizedQuery,
      sub_queries: retrievalResult.subQueries.map((item) => item.text),
      run_summary: retrievalResult.runs,
      evidence: retrievalResult.evidenceItems,
      scores: {
        trust: scoreRecord.trustScore,
        coverage: scoreRecord.coverageScore,
        freshness: scoreRecord.freshnessScore,
        diversity: scoreRecord.diversityScore
      },
      gate: {
        blocked: scoreRecord.blocked,
        reasons: scoreRecord.blockedReasons
      }
    });
  });
}
