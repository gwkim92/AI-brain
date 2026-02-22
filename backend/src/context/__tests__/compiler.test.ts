import { describe, expect, it } from 'vitest';

import {
  compileContext,
  getTokenBudgetForMode,
  type CandidateSegment,
  type ContextMode
} from '../compiler';

describe('getTokenBudgetForMode', () => {
  it('returns different budgets by mode', () => {
    const modes: ContextMode[] = ['chat', 'council', 'code', 'compute'];

    const budgets = modes.map((mode) => getTokenBudgetForMode(mode));

    expect(new Set(budgets).size).toBe(4);
    expect(getTokenBudgetForMode('council')).toBeGreaterThan(getTokenBudgetForMode('chat'));
    expect(getTokenBudgetForMode('code')).toBeGreaterThan(getTokenBudgetForMode('chat'));
    expect(getTokenBudgetForMode('compute')).toBeGreaterThan(getTokenBudgetForMode('chat'));
  });
});

describe('compileContext', () => {
  it('prioritizes evidence/recency/reliability within budget', () => {
    const candidates: CandidateSegment[] = [
      {
        id: 'seg_low_old',
        tokenCount: 110,
        evidenceScore: 0.2,
        recencyScore: 0.2,
        reliabilityScore: 0.2,
        content: 'old and weak'
      },
      {
        id: 'seg_high_fresh',
        tokenCount: 120,
        evidenceScore: 0.9,
        recencyScore: 0.9,
        reliabilityScore: 0.8,
        content: 'fresh and grounded'
      },
      {
        id: 'seg_high_reliable',
        tokenCount: 100,
        evidenceScore: 0.85,
        recencyScore: 0.6,
        reliabilityScore: 0.95,
        content: 'highly reliable'
      }
    ];

    const result = compileContext({
      mode: 'chat',
      overrideTokenBudget: 230,
      candidates
    });

    expect(result.usedTokens).toBeLessThanOrEqual(230);
    expect(result.selectedSegments.map((item) => item.id)).toEqual(['seg_high_fresh', 'seg_high_reliable']);
    expect(result.droppedSegments.map((item) => item.id)).toContain('seg_low_old');
  });
});
