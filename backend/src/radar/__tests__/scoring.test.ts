import { describe, expect, it } from 'vitest';

import { evaluateRadarItems, scoreRadarCandidate } from '../scoring';

describe('scoreRadarCandidate', () => {
  it('returns adopt when benefit is high and risk/cost are low', () => {
    const result = scoreRadarCandidate({
      id: 'r1',
      title: 'High impact runtime optimization',
      benefit: 4.8,
      risk: 1.1,
      cost: 1.3
    });

    expect(result.decision).toBe('adopt');
    expect(result.totalScore).toBeGreaterThanOrEqual(3.3);
  });

  it('returns hold or discard when risk/cost offset benefit', () => {
    const result = scoreRadarCandidate({
      id: 'r2',
      title: 'Experimental unstable framework',
      benefit: 2.6,
      risk: 4.5,
      cost: 4.2
    });

    expect(['hold', 'discard']).toContain(result.decision);
    expect(result.totalScore).toBeLessThan(2.5);
  });
});

describe('evaluateRadarItems', () => {
  it('sorts by score desc and returns recommendation entries', () => {
    const recommendations = evaluateRadarItems([
      { id: 'a', title: 'A', benefit: 4.2, risk: 1.2, cost: 1.6 },
      { id: 'b', title: 'B', benefit: 2.9, risk: 2.4, cost: 2.8 },
      { id: 'c', title: 'C', benefit: 1.9, risk: 4.1, cost: 3.6 }
    ]);

    expect(recommendations).toHaveLength(3);
    expect(recommendations[0]?.itemId).toBe('a');
    expect(recommendations[0]?.totalScore).toBeGreaterThan(recommendations[1]?.totalScore ?? 0);
  });
});
