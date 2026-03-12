import { describe, expect, it } from 'vitest';

import { resolveNarrativeClusterState } from '../service';

describe('resolveNarrativeClusterState', () => {
  it('keeps a diverging cluster diverging until recovery is convincing', () => {
    const state = resolveNarrativeClusterState({
      previousState: 'diverging',
      recurringEventCount: 1,
      divergingEventCount: 0,
      supportiveHistoryCount: 1,
      driftScore: 0.5,
      supportScore: 0.44,
      contradictionScore: 0.29,
      hotspotEventCount: 0,
      trendSummary: {
        recurringStrengthTrend: 0.14,
        divergenceTrend: 0.07,
        supportDecayScore: 0.1,
        contradictionAcceleration: 0.07,
      },
    });

    expect(state).toBe('diverging');
  });

  it('allows a diverging cluster to recover when support materially returns', () => {
    const state = resolveNarrativeClusterState({
      previousState: 'diverging',
      recurringEventCount: 1,
      divergingEventCount: 0,
      supportiveHistoryCount: 1,
      driftScore: 0.28,
      supportScore: 0.56,
      contradictionScore: 0.18,
      hotspotEventCount: 0,
      trendSummary: {
        recurringStrengthTrend: 0.2,
        divergenceTrend: 0.02,
        supportDecayScore: 0.03,
        contradictionAcceleration: 0.02,
      },
    });

    expect(state).toBe('recurring');
  });

  it('keeps a recurring cluster recurring under mild decay instead of flapping to forming', () => {
    const state = resolveNarrativeClusterState({
      previousState: 'recurring',
      recurringEventCount: 0,
      divergingEventCount: 0,
      supportiveHistoryCount: 0,
      driftScore: 0.22,
      supportScore: 0.31,
      contradictionScore: 0.33,
      hotspotEventCount: 0,
      trendSummary: {
        recurringStrengthTrend: -0.03,
        divergenceTrend: 0.04,
        supportDecayScore: 0.08,
        contradictionAcceleration: 0.03,
      },
    });

    expect(state).toBe('recurring');
  });
});
