import { describe, expect, it } from 'vitest';

import { createMemoryStore } from '../../store/memory-store';

import { extractWorldModelCandidateFacts } from '../extraction';
import { persistWorldModelProjection } from '../persistence';

describe('persistWorldModelProjection', () => {
  it('stores entities, observations, hypotheses, invalidation conditions, and a state snapshot', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const dossier = await store.createDossier({
      userId: 'user-default',
      title: 'Hormuz LNG brief',
      query: '호르무즈 리스크와 LNG 계약',
      status: 'ready',
      summary: '요약',
      answerMarkdown: '본문',
    });

    const extraction = extractWorldModelCandidateFacts({
      query: dossier.query,
      researchProfile: 'market_research',
      generatedAt: '2026-03-10T00:00:00Z',
      sources: [
        {
          url: 'https://example.com/hormuz-lng',
          title: 'Hormuz risk lifts freight rates',
          domain: 'example.com',
          publishedAt: '2026-03-10T00:00:00Z',
          snippet: 'Freight rates rose 12% and insurance costs climbed while buyers reopened LNG contract talks.',
        },
      ],
      claims: [
        {
          claimText:
            'Hormuz risk lifted freight rates 12% and insurance costs, and buyers reopened long-term LNG contract talks.',
          sourceUrls: ['https://example.com/hormuz-lng'],
        },
      ],
    });

    const persisted = await persistWorldModelProjection({
      store,
      userId: 'user-default',
      dossierId: dossier.id,
      origin: 'dossier_refresh',
      snapshotTarget: {
        targetType: 'dossier',
        targetId: dossier.id,
      },
      extraction,
    });

    const entities = await store.listWorldModelEntities({
      userId: 'user-default',
      limit: 20,
    });
    const events = await store.listWorldModelEvents({
      userId: 'user-default',
      dossierId: dossier.id,
      limit: 20,
    });
    const observations = await store.listWorldModelObservations({
      userId: 'user-default',
      dossierId: dossier.id,
      limit: 20,
    });
    const constraints = await store.listWorldModelConstraints({
      userId: 'user-default',
      dossierId: dossier.id,
      limit: 20,
    });
    const hypotheses = await store.listWorldModelHypotheses({
      userId: 'user-default',
      dossierId: dossier.id,
      limit: 20,
    });
    const invalidationConditions = await store.listWorldModelInvalidationConditions({
      hypothesisId: hypotheses[0]!.id,
      limit: 20,
    });
    const snapshots = await store.listWorldModelStateSnapshots({
      userId: 'user-default',
      targetType: 'dossier',
      targetId: dossier.id,
      limit: 20,
    });

    expect(persisted.hypotheses.length).toBeGreaterThan(0);
    expect(entities.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(observations.length).toBeGreaterThan(0);
    expect(constraints.length).toBeGreaterThan(0);
    expect(hypotheses.some((row) => row.stance === 'primary')).toBe(true);
    expect(hypotheses.some((row) => row.stance === 'counter')).toBe(true);
    expect(invalidationConditions.length).toBeGreaterThan(0);
    expect(snapshots[0]?.stateJson).toMatchObject({
      dominant_signals: expect.any(Array),
    });
    expect(persisted.projection.status).toBe('active');
    expect(persisted.projection.dossierId).toBe(dossier.id);
  });

  it('supersedes the previous active projection for the same dossier', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const dossier = await store.createDossier({
      userId: 'user-default',
      title: 'Projection rollover brief',
      query: '중동 운임 리스크',
      status: 'ready',
      summary: '요약',
      answerMarkdown: '본문',
    });

    const firstExtraction = extractWorldModelCandidateFacts({
      query: dossier.query,
      researchProfile: 'market_research',
      generatedAt: '2026-03-10T00:00:00Z',
      sources: [],
      claims: [],
    });
    const secondExtraction = extractWorldModelCandidateFacts({
      query: dossier.query,
      researchProfile: 'market_research',
      generatedAt: '2026-03-11T00:00:00Z',
      sources: [],
      claims: [],
    });

    const first = await persistWorldModelProjection({
      store,
      userId: 'user-default',
      dossierId: dossier.id,
      origin: 'dossier_refresh',
      extraction: firstExtraction,
    });
    const second = await persistWorldModelProjection({
      store,
      userId: 'user-default',
      dossierId: dossier.id,
      origin: 'dossier_refresh',
      extraction: secondExtraction,
    });

    const projections = await store.listWorldModelProjections({
      userId: 'user-default',
      dossierId: dossier.id,
      limit: 10,
    });

    expect(second.projection.status).toBe('active');
    expect(projections[0]?.id).toBe(second.projection.id);
    expect(projections.find((row) => row.id === first.projection.id)?.status).toBe('superseded');
    expect(projections.find((row) => row.id === first.projection.id)?.supersededByProjectionId).toBe(second.projection.id);
  });
});
