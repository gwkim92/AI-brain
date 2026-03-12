import { describe, expect, it } from 'vitest';

import { createMemoryStore } from '../../store/memory-store';

import { extractWorldModelCandidateFacts } from '../extraction';
import { recordWorldModelOutcome } from '../outcomes';
import { recordWorldModelProjectionOutcomes } from '../outcomes';
import { persistWorldModelProjection } from '../persistence';

describe('recordWorldModelOutcome', () => {
  it('records missed invalidators for a weakened hypothesis', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const hypothesis = await store.createWorldModelHypothesis({
      userId: 'user-default',
      thesis: '물류 압력이 장기계약 전환으로 이어진다.',
      stance: 'primary',
      confidence: 0.74,
      status: 'active',
      summary: '초기 가설',
    });

    await store.createWorldModelInvalidationCondition({
      hypothesisId: hypothesis.id,
      description: '7일 안에 계약 후속 신호가 없으면 약화',
      observedStatus: 'hit',
      severity: 'high',
    });
    await store.createWorldModelInvalidationCondition({
      hypothesisId: hypothesis.id,
      description: '운임이 빠르게 정상화되면 약화',
      observedStatus: 'pending',
      severity: 'medium',
    });

    const recorded = await recordWorldModelOutcome({
      store,
      userId: 'user-default',
      hypothesisId: hypothesis.id,
      result: 'mixed',
      revisionNotes: '계약 후속 신호가 없어 가설을 약화했다.',
    });

    expect(recorded.missedInvalidators).toEqual(['7일 안에 계약 후속 신호가 없으면 약화']);
    expect(recorded.outcome.missedInvalidators).toEqual(['7일 안에 계약 후속 신호가 없으면 약화']);
    expect(recorded.outcome.errorNotes).toBe('계약 후속 신호가 없어 가설을 약화했다.');
    expect(recorded.hypothesis.status).toBe('weakened');
    expect(recorded.hypothesis.confidence).toBeLessThan(0.74);
  });

  it('boosts confidence for confirmed hypotheses without invalidators', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const hypothesis = await store.createWorldModelHypothesis({
      userId: 'user-default',
      thesis: '헤드라인 노이즈가 실물 재편 없이 잦아든다.',
      stance: 'counter',
      confidence: 0.43,
      status: 'weakened',
      summary: '초기 반대가설',
    });

    const recorded = await recordWorldModelOutcome({
      store,
      userId: 'user-default',
      hypothesisId: hypothesis.id,
      result: 'confirmed',
      horizonRealized: '14d',
    });

    expect(recorded.missedInvalidators).toEqual([]);
    expect(recorded.hypothesis.status).toBe('active');
    expect(recorded.hypothesis.confidence).toBeGreaterThan(0.43);
    expect(recorded.outcome.horizonRealized).toBe('14d');
  });

  it('automatically records outcomes for a prior dossier projection when a later extraction resolves pending invalidators', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const dossier = await store.createDossier({
      userId: 'user-default',
      title: 'Hormuz watcher dossier',
      query: '호르무즈 리스크',
      status: 'ready',
      summary: '요약',
      answerMarkdown: '본문',
    });

    const initialExtraction = extractWorldModelCandidateFacts({
      query: dossier.query,
      researchProfile: 'topic_news',
      generatedAt: '2026-03-01T00:00:00Z',
      sources: [
        {
          url: 'https://example.com/hormuz-warning',
          title: 'Hormuz disruption fears rise',
          domain: 'example.com',
          publishedAt: '2026-03-01T00:00:00Z',
          snippet: 'Officials warned about disruption risk but no contract or freight move was confirmed.',
        },
      ],
      claims: [
        {
          claimText: 'Hormuz disruption risk rose, but no LNG contract or freight follow-through was confirmed.',
          sourceUrls: ['https://example.com/hormuz-warning'],
        },
      ],
    });

    await persistWorldModelProjection({
      store,
      userId: 'user-default',
      dossierId: dossier.id,
      origin: 'watcher_run',
      snapshotTarget: {
        targetType: 'dossier',
        targetId: dossier.id,
      },
      extraction: initialExtraction,
      now: '2026-03-01T00:00:00Z',
    });
    const [projection] = await store.listWorldModelProjections({
      userId: 'user-default',
      dossierId: dossier.id,
      limit: 1,
    });
    await store.updateWorldModelProjection({
      projectionId: projection!.id,
      userId: 'user-default',
      summaryJson: {
        ...projection!.summaryJson,
        radar_event_id: 'evt-hormuz-test',
        radar_domain_id: 'geopolitics_energy_lng',
      },
    });

    const laterExtraction = extractWorldModelCandidateFacts({
      query: dossier.query,
      researchProfile: 'topic_news',
      generatedAt: '2026-03-20T00:00:00Z',
      sources: [
        {
          url: 'https://example.com/hormuz-still-unclear',
          title: 'Hormuz threat persists without freight follow-through',
          domain: 'example.com',
          publishedAt: '2026-03-20T00:00:00Z',
          snippet: 'No freight, insurance, or contract escalation appeared after the initial warning.',
        },
      ],
      claims: [
        {
          claimText: 'The warning persisted, but no freight, insurance, or contract escalation appeared.',
          sourceUrls: ['https://example.com/hormuz-still-unclear'],
        },
      ],
    });

    const outcomes = await recordWorldModelProjectionOutcomes({
      store,
      userId: 'user-default',
      dossierId: dossier.id,
      extraction: laterExtraction,
      evaluatedAt: '2026-03-20T00:00:00Z',
      now: '2026-03-20T00:00:00Z',
    });

    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.some((row) => row.outcome.result === 'invalidated' || row.outcome.result === 'confirmed')).toBe(true);

    const persistedOutcomes = await store.listWorldModelOutcomes({
      userId: 'user-default',
      hypothesisId: outcomes[0]!.hypothesis.id,
      limit: 10,
    });
    expect(persistedOutcomes.length).toBeGreaterThan(0);

    const metrics = await store.listRadarDomainPackMetrics();
    const packMetric = metrics.find((row) => row.domainId === 'geopolitics_energy_lng');
    expect(packMetric).toBeTruthy();
    expect((packMetric?.confirmedCount ?? 0) + (packMetric?.invalidatedCount ?? 0) + (packMetric?.mixedCount ?? 0)).toBeGreaterThan(0);
  });
});
