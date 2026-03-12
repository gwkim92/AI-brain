import { describe, expect, it } from 'vitest';

import { createMemoryStore } from '../../store/memory-store';

import { runWorldModelOutcomeBackfillPass } from '../outcome-worker';
import { extractWorldModelCandidateFacts } from '../extraction';
import { persistWorldModelProjection } from '../persistence';

describe('runWorldModelOutcomeBackfillPass', () => {
  it('records outcomes for active projections whose invalidation deadlines have passed', async () => {
    const store = createMemoryStore('user-default', 'user-default@example.com');
    await store.initialize();

    const dossier = await store.createDossier({
      userId: 'user-default',
      title: 'Outcome backfill dossier',
      query: '호르무즈 리스크',
      status: 'ready',
      summary: '요약',
      answerMarkdown: '본문',
    });
    await store.replaceDossierSources({
      userId: 'user-default',
      dossierId: dossier.id,
      sources: [
        {
          url: 'https://example.com/hormuz',
          title: 'Hormuz risk persists',
          domain: 'example.com',
          snippet: 'No contract or freight follow-through appeared after the initial warning.',
          publishedAt: '2026-03-20T00:00:00Z',
        },
      ],
    });
    await store.replaceDossierClaims({
      userId: 'user-default',
      dossierId: dossier.id,
      claims: [
        {
          claimText: 'The warning persisted, but no contract or freight follow-through appeared.',
          sourceUrls: ['https://example.com/hormuz'],
        },
      ],
    });

    const extraction = extractWorldModelCandidateFacts({
      query: dossier.query,
      researchProfile: 'topic_news',
      generatedAt: '2026-03-01T00:00:00Z',
      sources: [
        {
          url: 'https://example.com/hormuz',
          title: 'Hormuz risk persists',
          domain: 'example.com',
          publishedAt: '2026-03-20T00:00:00Z',
          snippet: 'No contract or freight follow-through appeared after the initial warning.',
        },
      ],
      claims: [
        {
          claimText: 'Hormuz risk rose, but no contract or freight follow-through appeared.',
          sourceUrls: ['https://example.com/hormuz'],
        },
      ],
    });

    const persisted = await persistWorldModelProjection({
      store,
      userId: 'user-default',
      dossierId: dossier.id,
      origin: 'dossier_refresh',
      extraction,
      now: '2026-03-01T00:00:00Z',
    });
    await store.updateWorldModelProjection({
      projectionId: persisted.projection.id,
      userId: 'user-default',
      summaryJson: {
        ...persisted.projection.summaryJson,
        pending_invalidation_count: 2,
        next_expected_by: '2026-03-05T00:00:00Z',
      },
    });

    const result = await runWorldModelOutcomeBackfillPass({
      store,
      batchSize: 10,
      nowIso: '2026-03-20T00:00:00Z',
    });

    expect(result.scanned).toBeGreaterThan(0);
    expect(result.due).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.recordedOutcomes).toBeGreaterThan(0);

    const hypotheses = await store.listWorldModelHypotheses({
      userId: 'user-default',
      projectionId: persisted.projection.id,
      limit: 20,
    });
    const outcomes = await store.listWorldModelOutcomes({
      userId: 'user-default',
      hypothesisId: hypotheses[0]!.id,
      limit: 20,
    });
    expect(outcomes.length).toBeGreaterThan(0);
  });
});
