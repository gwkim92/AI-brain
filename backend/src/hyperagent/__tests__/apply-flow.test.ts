import { describe, expect, it } from 'vitest';

import { evaluateHyperAgentRecommendationGate } from '../../evals/gate';

describe('hyperagent apply flow', () => {
  it('refuses to apply a recommendation that failed the eval gate', () => {
    const result = evaluateHyperAgentRecommendationGate({
      recommendationStatus: 'accepted',
      summary: {
        promotionScore: 0.42,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('hyperagent_promotion_score_below_threshold');
  });
});
