import { describe, expect, it } from 'vitest';

import { createMemoryStore } from '../memory-store';

describe('world model store contract', () => {
  it('upserts entities and lists them by user/kind', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const first = await store.upsertWorldModelEntity({
      userId: 'user-default',
      kind: 'country',
      canonicalName: 'Qatar',
      aliases: ['State of Qatar'],
      attributes: { region: 'Middle East' },
    });

    const second = await store.upsertWorldModelEntity({
      userId: 'user-default',
      kind: 'country',
      canonicalName: 'Qatar',
      aliases: ['Qatar'],
      attributes: { region: 'MENA' },
    });

    expect(second.id).toBe(first.id);
    expect(second.aliases).toEqual(['Qatar']);
    expect(second.attributes).toEqual({ region: 'MENA' });

    const rows = await store.listWorldModelEntities({
      userId: 'user-default',
      kind: 'country',
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.canonicalName).toBe('Qatar');
  });

  it('creates hypotheses linked to a dossier and stores evidence plus invalidation conditions', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const dossier = await store.createDossier({
      userId: 'user-default',
      title: 'LNG rerouting brief',
      query: 'Middle East LNG rerouting',
      status: 'ready',
      summary: 'Test dossier',
      answerMarkdown: 'Test',
    });

    const primary = await store.createWorldModelHypothesis({
      userId: 'user-default',
      dossierId: dossier.id,
      thesis: 'Supply risk forces long-term LNG contract acceptance.',
      stance: 'primary',
      confidence: 0.72,
    });

    const counter = await store.createWorldModelHypothesis({
      userId: 'user-default',
      dossierId: dossier.id,
      thesis: 'Headline volatility fades without structural contract changes.',
      stance: 'counter',
      confidence: 0.41,
    });

    await store.createWorldModelHypothesisEvidence({
      hypothesisId: primary.id,
      dossierId: dossier.id,
      claimText: 'European buyers restarted long-term LNG talks.',
      sourceUrls: ['https://example.com/lng'],
      weight: 0.8,
    });

    const invalidation = await store.createWorldModelInvalidationCondition({
      hypothesisId: primary.id,
      description: 'No contract announcements within two weeks.',
      observedStatus: 'pending',
    });

    const listed = await store.listWorldModelHypotheses({
      userId: 'user-default',
      dossierId: dossier.id,
      limit: 10,
    });
    const filtered = await store.listWorldModelHypotheses({
      userId: 'user-default',
      hypothesisId: primary.id,
      limit: 10,
    });
    const evidence = await store.listWorldModelHypothesisEvidence({
      hypothesisId: primary.id,
      limit: 10,
    });
    const invalidations = await store.listWorldModelInvalidationConditions({
      hypothesisId: primary.id,
      limit: 10,
    });

    expect(listed).toHaveLength(2);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(primary.id);
    expect(listed.some((row) => row.id === primary.id && row.stance === 'primary')).toBe(true);
    expect(listed.some((row) => row.id === counter.id && row.stance === 'counter')).toBe(true);
    expect(evidence[0]?.claimText).toContain('long-term LNG');
    expect(invalidations[0]?.id).toBe(invalidation.id);
  });

  it('records state snapshots and outcomes', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const hypothesis = await store.createWorldModelHypothesis({
      userId: 'user-default',
      thesis: 'Freight pressure is repricing rate expectations.',
      stance: 'primary',
    });

    const snapshot = await store.createWorldModelStateSnapshot({
      userId: 'user-default',
      targetType: 'session',
      targetId: 'f4a5d6f7-1111-4222-8333-0123456789ab',
      stateJson: {
        freight_pressure: 0.64,
        rate_repricing_pressure: 0.51,
      },
    });

    const outcome = await store.createWorldModelOutcome({
      userId: 'user-default',
      hypothesisId: hypothesis.id,
      result: 'mixed',
      missedInvalidators: ['No shipping insurance spike'],
    });

    const snapshots = await store.listWorldModelStateSnapshots({
      userId: 'user-default',
      targetType: 'session',
      limit: 10,
    });
    const outcomes = await store.listWorldModelOutcomes({
      userId: 'user-default',
      hypothesisId: hypothesis.id,
      limit: 10,
    });

    expect(snapshots[0]?.id).toBe(snapshot.id);
    expect(snapshots[0]?.stateJson).toMatchObject({ freight_pressure: 0.64 });
    expect(outcomes[0]?.id).toBe(outcome.id);
    expect(outcomes[0]?.missedInvalidators).toEqual(['No shipping insurance spike']);
  });

  it('records radar domain pack outcomes into calibration metrics', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const metric = await store.recordRadarDomainPackOutcome({
      domainId: 'geopolitics_energy_lng',
      result: 'invalidated',
      evaluatedAt: '2026-03-20T00:00:00.000Z',
      eventId: 'evt-radar-1',
    });

    const metrics = await store.listRadarDomainPackMetrics();
    expect(metric.domainId).toBe('geopolitics_energy_lng');
    expect(metric.invalidatedCount).toBe(1);
    expect(metrics[0]?.domainId).toBe('geopolitics_energy_lng');
    expect(metrics[0]?.invalidatedCount).toBe(1);
    expect(metrics[0]?.calibrationScore).toBeLessThan(0.75);
  });

  it('creates, supersedes, and filters projections with linked hypotheses', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const dossier = await store.createDossier({
      userId: 'user-default',
      title: 'Projection lineage brief',
      query: 'Projection lineage',
      status: 'ready',
      summary: 'Projection lineage test dossier',
      answerMarkdown: 'Test',
    });

    const firstProjection = await store.createWorldModelProjection({
      userId: 'user-default',
      dossierId: dossier.id,
      origin: 'dossier_refresh',
      summaryJson: {
        pending_invalidation_count: 1,
      },
    });

    const firstHypothesis = await store.createWorldModelHypothesis({
      userId: 'user-default',
      projectionId: firstProjection.id,
      dossierId: dossier.id,
      thesis: 'The first projection thesis',
      stance: 'primary',
      confidence: 0.58,
    });

    const secondProjection = await store.createWorldModelProjection({
      userId: 'user-default',
      dossierId: dossier.id,
      origin: 'dossier_refresh',
      summaryJson: {
        pending_invalidation_count: 0,
      },
    });

    await store.updateWorldModelProjection({
      projectionId: firstProjection.id,
      userId: 'user-default',
      status: 'superseded',
      supersededAt: '2026-03-10T00:10:00.000Z',
      supersededByProjectionId: secondProjection.id,
    });

    const active = await store.listWorldModelProjections({
      userId: 'user-default',
      dossierId: dossier.id,
      status: 'active',
      limit: 10,
    });
    const superseded = await store.listWorldModelProjections({
      userId: 'user-default',
      projectionId: firstProjection.id,
      limit: 10,
    });
    const linkedHypotheses = await store.listWorldModelHypotheses({
      userId: 'user-default',
      projectionId: firstProjection.id,
      limit: 10,
    });

    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(secondProjection.id);
    expect(superseded[0]?.status).toBe('superseded');
    expect(superseded[0]?.supersededByProjectionId).toBe(secondProjection.id);
    expect(linkedHypotheses).toHaveLength(1);
    expect(linkedHypotheses[0]?.id).toBe(firstHypothesis.id);
  });
});
