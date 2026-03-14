import { describe, expect, it } from 'vitest';

import { computeIntelligenceTemporalNarrativeProfile, resolveNarrativeClusterState } from '../service';

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

describe('computeIntelligenceTemporalNarrativeProfile', () => {
  it('does not relate unrelated events solely because they share a generic family/domain bucket', () => {
    const previousEvent = {
      id: 'event-1',
      title: 'Crazy Rogue AI',
      summary: 'A sensational story about rogue AI behavior.',
      entities: ['Crazy Rogue AI'],
      eventFamily: 'general_signal' as const,
      topDomainId: 'geopolitics_energy_lng' as const,
      semanticClaims: [
        {
          claimId: 'claim-1',
          subjectEntity: 'Crazy Rogue AI',
          predicate: 'affects',
          object: 'AI behavior',
          evidenceSpan: 'rogue ai behavior',
          timeScope: null,
          uncertainty: 'medium' as const,
          stance: 'supporting' as const,
          claimType: 'signal' as const,
        },
      ],
      primaryHypotheses: [
        {
          id: 'hyp-1',
          title: 'Rogue AI concern',
          summary: 'This story is about runaway AI behavior.',
          confidence: 0.6,
          rationale: 'test',
        },
      ],
      graphSupportScore: 0.1,
      graphContradictionScore: 0,
      graphHotspotCount: 0,
      timeCoherenceScore: 0.8,
      timeWindowEnd: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:00:00.000Z',
    };
    const currentEvent = {
      id: 'event-2',
      title: 'How we hire AI-native engineers now: our criteria',
      summary: 'A hiring rubric for AI-native engineers.',
      entities: ['AI-native engineers'],
      eventFamily: 'general_signal' as const,
      topDomainId: 'geopolitics_energy_lng' as const,
      semanticClaims: [
        {
          claimId: 'claim-2',
          subjectEntity: 'AI-native engineers',
          predicate: 'hiring_focuses_on',
          object: 'engineering criteria',
          evidenceSpan: 'hiring rubric',
          timeScope: null,
          uncertainty: 'medium' as const,
          stance: 'supporting' as const,
          claimType: 'signal' as const,
        },
      ],
      primaryHypotheses: [
        {
          id: 'hyp-2',
          title: 'Hiring criteria update',
          summary: 'This note describes recruiting criteria.',
          confidence: 0.6,
          rationale: 'test',
        },
      ],
      graphSupportScore: 0.1,
      graphContradictionScore: 0,
      graphHotspotCount: 0,
      timeCoherenceScore: 0.8,
      timeWindowEnd: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };

    const temporal = computeIntelligenceTemporalNarrativeProfile({
      event: currentEvent as never,
      candidateEvents: [previousEvent, currentEvent] as never,
    });

    expect(temporal.relatedHistoricalEventCount).toBe(0);
    expect(temporal.temporalNarrativeState).toBe('new');
  });

  it('does not relate regulator notices solely because they share the same agency entity', () => {
    const previousEvent = {
      id: 'event-sec-1',
      title: 'SEC Proposes Amendments to Reduce Burdens in Reporting of Fund Portfolio Holdings',
      summary: 'The SEC proposes amendments to reduce portfolio holdings reporting burdens.',
      entities: ['SEC'],
      eventFamily: 'policy_change' as const,
      topDomainId: 'macro_rates_inflation_fx' as const,
      semanticClaims: [
        {
          claimId: 'claim-sec-1',
          subjectEntity: 'SEC Proposes Amendments to Reduce Burdens in Reporting of Fund Portfolio Holdings',
          predicate: 'changes_policy',
          object: 'portfolio holdings reporting rules',
          evidenceSpan: 'The SEC proposes amendments to reduce portfolio holdings reporting burdens.',
          timeScope: null,
          uncertainty: 'medium' as const,
          stance: 'supporting' as const,
          claimType: 'signal' as const,
        },
      ],
      primaryHypotheses: [
        {
          id: 'hyp-sec-1',
          title: 'Portfolio holdings reporting update',
          summary: 'This notice is about fund reporting burdens.',
          confidence: 0.62,
          rationale: 'test',
        },
      ],
      graphSupportScore: 0.15,
      graphContradictionScore: 0,
      graphHotspotCount: 0,
      timeCoherenceScore: 0.82,
      timeWindowEnd: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:00:00.000Z',
    };
    const currentEvent = {
      id: 'event-sec-2',
      title: 'SEC Announces Roundtable on Options Market Structure Reform',
      summary: 'The SEC is organizing a roundtable on options market structure reform.',
      entities: ['SEC'],
      eventFamily: 'policy_change' as const,
      topDomainId: 'macro_rates_inflation_fx' as const,
      semanticClaims: [
        {
          claimId: 'claim-sec-2',
          subjectEntity: 'SEC Announces Roundtable on Options Market Structure Reform',
          predicate: 'changes_policy',
          object: 'options market structure reform roundtable',
          evidenceSpan: 'The SEC is organizing a roundtable on options market structure reform.',
          timeScope: null,
          uncertainty: 'medium' as const,
          stance: 'supporting' as const,
          claimType: 'signal' as const,
        },
      ],
      primaryHypotheses: [
        {
          id: 'hyp-sec-2',
          title: 'Options market reform roundtable',
          summary: 'This notice is about an options market structure roundtable.',
          confidence: 0.61,
          rationale: 'test',
        },
      ],
      graphSupportScore: 0.15,
      graphContradictionScore: 0,
      graphHotspotCount: 0,
      timeCoherenceScore: 0.82,
      timeWindowEnd: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };

    const temporal = computeIntelligenceTemporalNarrativeProfile({
      event: currentEvent as never,
      candidateEvents: [previousEvent, currentEvent] as never,
    });

    expect(temporal.relatedHistoricalEventCount).toBe(0);
    expect(temporal.temporalNarrativeState).toBe('new');
  });
});
