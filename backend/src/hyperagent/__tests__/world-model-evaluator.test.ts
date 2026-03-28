import { describe, expect, it } from 'vitest';

import { evaluateWorldModelVariant } from '../world-model-evaluator';

describe('world-model evaluator', () => {
  it('scores a dossier config variant using deterministic structural metrics', async () => {
    const result = await evaluateWorldModelVariant({
      artifactKey: 'world_model_dossier_config',
      payload: {
        maxBottlenecks: 3,
        maxInvalidationConditions: 10,
        maxNextWatchSignals: 4,
        bottleneckScoreThreshold: 0.35,
      },
      fixtures: [
        {
          fixtureId: 'case-1',
          extractionInput: {
            query: '중동 충돌이 LNG 계약과 운임에 미치는 영향',
            researchProfile: 'market_research',
            generatedAt: '2026-03-10T00:00:00Z',
            sources: [
              {
                url: 'https://www.reuters.com/world/middle-east/lng-shipping',
                title: 'Qatar signs LNG deal as freight rates jump',
                domain: 'www.reuters.com',
                publishedAt: '2026-03-10T00:00:00Z',
                snippet: 'Shipping rates rose 12% and insurers raised premiums after conflict fears.'
              }
            ],
            claims: [
              {
                claimText:
                  'Qatar signed an LNG contract after the Iran-Israel conflict pushed shipping rates up 12% and lifted insurance costs.',
                sourceUrls: ['https://www.reuters.com/world/middle-east/lng-shipping']
              }
            ],
          },
          expectedPrimaryThesisPresent: true,
          expectedCounterHypothesisPresent: true,
          minInvalidationConditions: 1,
          minBottlenecks: 1,
          maxNextWatchSignals: 4,
        },
      ],
    });

    expect(result.caseResults).toHaveLength(1);
    expect(result.caseResults[0]?.passed).toBe(true);
    expect(result.metrics.primaryThesisCoverage).toBe(1);
    expect(result.metrics.counterHypothesisRetained).toBe(1);
    expect(result.metrics.invalidationConditionCoverage).toBe(1);
    expect(result.metrics.promotionScore).toBeGreaterThan(0);
  });
});
