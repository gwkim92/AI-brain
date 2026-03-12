import { describe, expect, it } from 'vitest';

import { buildRadarEvaluationBundle } from '../pipeline';

describe('buildRadarEvaluationBundle', () => {
  it('infers domain posterior and execute-auto candidate for high-confidence geopolitical LNG signals', () => {
    const bundle = buildRadarEvaluationBundle({
      now: '2026-03-11T00:00:00.000Z',
      items: [
        {
          id: 'sig-1',
          title: 'Official Hormuz LNG terminal insurance shock drives freight and contract urgency',
          summary: 'Government filing confirms strait routing risk, insurance spike, freight jump and contract urgency.',
          sourceUrl: 'https://energy.gov/example/hormuz-lng-update',
          sourceName: 'US Energy',
          publishedAt: '2026-03-11T00:00:00.000Z',
          observedAt: '2026-03-11T00:00:00.000Z',
          confidenceScore: 0.96,
          status: 'new',
          sourceType: 'policy',
          sourceTier: 'tier_0',
          rawMetrics: {
            freight_index: 14.2,
            insurance_spread: 8.4,
            us10y: 4.52,
          },
          entityHints: ['Hormuz', 'QatarEnergy', 'LNG'],
          trustHint: 'official filing',
          payload: {},
        },
      ],
    });

    expect(bundle.events).toHaveLength(1);
    expect(bundle.events[0]?.decision).toBe('execute_auto_candidate');
    expect(bundle.recommendations[0]?.decision).toBe('adopt');
    expect(bundle.recommendations[0]?.autonomyExecutionMode).toBe('execute_auto');
    expect(bundle.posteriors[0]?.domainId).toBe('geopolitics_energy_lng');
  });
});
