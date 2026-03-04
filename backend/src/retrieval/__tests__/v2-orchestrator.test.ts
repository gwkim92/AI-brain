import { describe, expect, it } from 'vitest';

import { runRetrievalOrchestratorV2 } from '../v2/orchestrator';
import type { RetrievalAdapterV2 } from '../v2/types';

function makeAdapter(
  id: RetrievalAdapterV2['id'],
  handler: RetrievalAdapterV2['query']
): RetrievalAdapterV2 {
  return {
    id,
    query: handler
  };
}

describe('runRetrievalOrchestratorV2', () => {
  it('keeps running when one adapter fails', async () => {
    const result = await runRetrievalOrchestratorV2({
      adapters: [
        makeAdapter('brave_web', async ({ subQuery }) => ({
          items: [
            {
              runKey: `brave_web:${subQuery.id}`,
              subQueryId: subQuery.id,
              url: 'https://www.reuters.com/world/story',
              title: 'Story',
              domain: 'www.reuters.com',
              snippet: 'sample',
              publishedAt: new Date().toISOString(),
              connector: 'brave_web',
              rankScore: 0.92,
              metadata: {}
            }
          ]
        })),
        makeAdapter('crossref_scholar', async () => {
          throw new Error('crossref offline');
        })
      ],
      request: {
        query: 'latest policy briefing',
        maxItems: 10,
        riskLevel: 'low',
        intent: 'research'
      }
    });

    expect(result.runs.some((run) => run.status === 'failed')).toBe(true);
    expect(result.evidenceItems.length).toBeGreaterThan(0);
  });

  it('scores coverage and blocks low coverage on finance/high-risk requests', async () => {
    const result = await runRetrievalOrchestratorV2({
      adapters: [
        makeAdapter('github_code', async ({ subQuery }) => ({
          items:
            subQuery.id === 'q_1'
              ? [
                  {
                    runKey: `github_code:${subQuery.id}`,
                    subQueryId: subQuery.id,
                    url: 'https://github.com/example/repo',
                    title: 'example/repo',
                    domain: 'github.com',
                    snippet: 'repo',
                    publishedAt: new Date().toISOString(),
                    connector: 'github_code',
                    rankScore: 0.88,
                    metadata: {}
                  }
                ]
              : []
        }))
      ],
      request: {
        query: 'portfolio hedging and fx risk',
        maxItems: 10,
        riskLevel: 'medium',
        intent: 'finance'
      }
    });

    expect(result.subQueries.length).toBe(2);
    expect(result.score.coverageScore).toBeLessThan(0.75);
    expect(result.gate.blocked).toBe(true);
    expect(result.gate.blockedReasons).toContain('insufficient_evidence_coverage');
  });
});
