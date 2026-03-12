import { describe, expect, it } from 'vitest';

import { buildWatcherFollowUpDecision, resolveWatcherNotificationPolicy, type WatcherFollowUpChangeClass } from '../watchers';

import type { WatcherRecord } from '../../store/types';

function createWatcher(overrides?: Partial<WatcherRecord>): WatcherRecord {
  return {
    id: 'watcher-1',
    userId: 'user-1',
    kind: 'market',
    title: 'Watcher',
    query: 'query',
    status: 'active',
    configJson: {},
    lastRunAt: null,
    lastHitAt: null,
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    ...overrides
  };
}

function createDecision(input: {
  kind?: WatcherRecord['kind'];
  summary: string;
  researchProfile: string | null;
  qualityDimensions?: Record<string, unknown>;
  qualityGatePassed?: boolean;
  conflictCount?: number;
  monitoringPreference?: 'manual' | 'important_changes' | 'all_changes' | null;
}): { changeClass: WatcherFollowUpChangeClass; severity: 'info' | 'warning' | 'critical'; score: number; reasons: string[] } {
  return buildWatcherFollowUpDecision({
    watcher: createWatcher(input.kind ? { kind: input.kind } : undefined),
    summary: input.summary,
    previousSummary: 'previous summary',
    quality: {
      quality_gate_passed: input.qualityGatePassed ?? true,
      quality_dimensions: input.qualityDimensions ?? {}
    },
    conflictCount: input.conflictCount ?? 0,
    researchProfile: input.researchProfile,
    monitoringPreference: input.monitoringPreference ?? null
  });
}

describe('buildWatcherFollowUpDecision', () => {
  it('keeps health regressions critical when score crosses the regression threshold', () => {
    const decision = createDecision({
      kind: 'repo',
      summary: 'CI failing again after the latest release',
      researchProfile: 'repo_research',
      qualityDimensions: {
        release_source_count: 1
      }
    });

    expect(decision.changeClass).toBe('health_regression');
    expect(decision.severity).toBe('critical');
    expect(decision.score).toBeGreaterThanOrEqual(46);
    expect(decision.reasons).toEqual(
      expect.arrayContaining(['summary_changed', 'health_regression_signal', 'release_signal'])
    );
  });

  it('escalates high-confidence policy changes to critical', () => {
    const decision = createDecision({
      kind: 'company',
      summary: 'Official policy update with a new effective date was published',
      researchProfile: 'policy_regulation',
      qualityDimensions: {
        official_source_count: 2,
        effective_date_source_count: 2
      }
    });

    expect(decision.changeClass).toBe('policy_change');
    expect(decision.score).toBeGreaterThanOrEqual(58);
    expect(decision.severity).toBe('critical');
  });

  it('keeps routine refreshes informational when there are no strong change signals', () => {
    const decision = createDecision({
      kind: 'market',
      summary: 'same summary',
      researchProfile: 'market_research',
      qualityDimensions: {}
    });

    expect(decision.changeClass).toBe('routine_refresh');
    expect(decision.severity).toBe('info');
  });

  it('suppresses non-critical follow-up changes when monitoring preference is manual', () => {
    const decision = createDecision({
      kind: 'company',
      summary: 'Official update published on the newsroom today',
      researchProfile: 'entity_brief',
      qualityDimensions: {
        official_source_count: 1
      },
      monitoringPreference: 'manual'
    });

    expect(decision.changeClass).toBe('routine_refresh');
    expect(decision.severity).toBe('info');
    expect(decision.score).toBe(34);
    expect(decision.reasons).toEqual(expect.arrayContaining(['summary_changed', 'official_source_signal']));
  });

  it('keeps moderate non-routine changes when monitoring preference is all_changes', () => {
    const decision = createDecision({
      kind: 'company',
      summary: 'Official update published on the newsroom today',
      researchProfile: 'entity_brief',
      qualityDimensions: {
        official_source_count: 1
      },
      monitoringPreference: 'all_changes'
    });

    expect(decision.changeClass).toBe('official_update');
    expect(decision.severity).toBe('info');
    expect(decision.score).toBe(34);
    expect(decision.reasons).toEqual(expect.arrayContaining(['summary_changed', 'official_source_signal']));
  });

  it('treats structural world-model shifts as market changes even when the text summary is unchanged', () => {
    const decision = buildWatcherFollowUpDecision({
      watcher: createWatcher({ kind: 'market' }),
      summary: 'same summary',
      previousSummary: 'same summary',
      quality: {
        quality_gate_passed: true,
        quality_dimensions: {}
      },
      conflictCount: 0,
      researchProfile: 'market_research',
      monitoringPreference: null,
      worldModelDelta: {
        hasMeaningfulShift: true,
        reasons: ['state_acceleration', 'primary_hypothesis_shift', 'invalidation_hit'],
        primaryHypothesisShift: 0.22,
        counterHypothesisShift: -0.11,
        invalidationHitCount: 1,
        bottleneckShiftCount: 0,
        topStateShift: { key: 'freight_pressure', delta: 0.24 }
      }
    });

    expect(decision.changeClass).toBe('market_shift');
    expect(decision.severity).toBe('warning');
    expect(decision.reasons).toEqual(
      expect.arrayContaining(['state_acceleration', 'primary_hypothesis_shift', 'invalidation_hit'])
    );
    expect(decision.worldModelDelta?.hasMeaningfulShift).toBe(true);
  });
});

describe('resolveWatcherNotificationPolicy', () => {
  it('suppresses info-level routine refresh notifications for manual monitoring', () => {
    const policy = resolveWatcherNotificationPolicy({
      monitoringPreference: 'manual',
      changeClass: 'routine_refresh',
      severity: 'info',
      qualityWarning: false
    });

    expect(policy.emitWatcherHit).toBe(false);
    expect(policy.emitBriefingReady).toBe(false);
    expect(policy.watcherDedupeWindowMs).toBe(300_000);
  });

  it('keeps important changes visible but hides routine watcher-hit noise by default', () => {
    const policy = resolveWatcherNotificationPolicy({
      monitoringPreference: 'important_changes',
      changeClass: 'routine_refresh',
      severity: 'info',
      qualityWarning: false
    });

    expect(policy.emitWatcherHit).toBe(false);
    expect(policy.emitBriefingReady).toBe(true);
    expect(policy.briefingDedupeWindowMs).toBe(60_000);
  });

  it('keeps low-severity change notifications when monitoring preference is all_changes', () => {
    const policy = resolveWatcherNotificationPolicy({
      monitoringPreference: 'all_changes',
      changeClass: 'official_update',
      severity: 'info',
      qualityWarning: false
    });

    expect(policy.emitWatcherHit).toBe(true);
    expect(policy.emitBriefingReady).toBe(true);
    expect(policy.watcherDedupeWindowMs).toBe(15_000);
  });
});
