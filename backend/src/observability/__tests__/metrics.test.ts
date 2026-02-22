import { describe, expect, it } from 'vitest';

import {
  calculateParallelEfficiency,
  calculateRadarMissRate,
  calculateTokenReduction,
  summarizeCoreSlo
} from '../metrics';

describe('metrics', () => {
  it('calculates parallel efficiency correctly', () => {
    const efficiency = calculateParallelEfficiency({ sequentialMs: 1000, parallelMs: 620 });
    expect(efficiency).toBeCloseTo(38, 1);
  });

  it('calculates token reduction correctly', () => {
    const reduction = calculateTokenReduction({ baselineTokens: 10000, optimizedTokens: 5600 });
    expect(reduction).toBeCloseTo(44, 1);
  });

  it('calculates radar miss rate correctly', () => {
    const missRate = calculateRadarMissRate({ expectedReports: 12, deliveredReports: 11 });
    expect(missRate).toBeCloseTo(8.33, 2);
  });

  it('summarizes all metrics together', () => {
    const summary = summarizeCoreSlo({
      sequentialMs: 2000,
      parallelMs: 1200,
      baselineTokens: 12000,
      optimizedTokens: 7000,
      expectedReports: 10,
      deliveredReports: 10
    });

    expect(summary.parallelEfficiencyPct).toBeGreaterThan(35);
    expect(summary.tokenReductionPct).toBeGreaterThan(40);
    expect(summary.radarMissRatePct).toBe(0);
  });
});
