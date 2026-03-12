import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from '../../store/memory-store';
import { runRadarScannerPass } from '../scanner-worker';

describe('runRadarScannerPass', () => {
  it('fetches, ingests, evaluates, and records a scanner run for enabled sources', async () => {
    const userId = '00000000-0000-4000-8000-000000000321';
    const store = createMemoryStore(userId, 'scanner@example.com');
    await store.initialize();

    await store.upsertRadarFeedSources({
      sources: [
        {
          id: 'scanner-json',
          name: 'Scanner JSON',
          kind: 'json',
          url: 'https://energy.gov/example/radar.json',
          sourceType: 'policy',
          sourceTier: 'tier_0',
          pollMinutes: 5,
          enabled: true,
          parserHints: {
            itemsPath: 'items',
            titleField: 'title',
            summaryField: 'summary',
            urlField: 'url',
            publishedAtField: 'published_at',
          },
          entityHints: ['Hormuz', 'LNG'],
          metricHints: ['insurance_spread', 'freight_index'],
        },
      ],
    });

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              title: 'Official Hormuz LNG terminal insurance shock drives freight and contract urgency',
              summary:
                'Government filing confirms Hormuz routing risk, insurance spike, freight jump, long-term contract urgency, inflation passthrough, and treasury repricing.',
              url: 'https://energy.gov/example/hormuz-lng',
              published_at: '2026-03-11T00:00:00.000Z',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: 'etag-1',
            'last-modified': 'Wed, 11 Mar 2026 00:00:00 GMT',
          },
        }
      )
    );

    const result = await runRadarScannerPass({
      store,
      userId,
      fetchTimeoutMs: 2_000,
      sourceBatch: 5,
      fetchImpl,
      seedDefaultSources: false,
      nowIso: '2026-03-11T00:05:00.000Z',
    });

    expect(result.dueSources).toBe(1);
    expect(result.fetchedCount).toBe(1);
    expect(result.ingestedCount).toBe(1);
    expect(result.evaluatedCount).toBe(1);
    expect(result.promotedCount).toBe(1);
    expect(result.autoExecutedCount).toBe(0);

    const runs = await store.listRadarIngestRuns({ limit: 5 });
    expect(runs[0]?.status).toBe('ok');
    expect(runs[0]?.promotedCount).toBe(1);

    const cursors = await store.listRadarFeedCursors({ sourceId: 'scanner-json' });
    expect(cursors[0]?.etag).toBe('etag-1');

    const events = await store.listRadarEvents({ limit: 10 });
    expect(events[0]?.clusterSize).toBe(1);
    expect(events[0]?.decision).toBe('dossier');
  });

  it('skips disabled sources', async () => {
    const userId = '00000000-0000-4000-8000-000000000322';
    const store = createMemoryStore(userId, 'scanner-disabled@example.com');
    await store.initialize();

    await store.upsertRadarFeedSources({
      sources: [
        {
          id: 'disabled-source',
          name: 'Disabled Source',
          kind: 'json',
          url: 'https://example.com/disabled.json',
          sourceType: 'news',
          sourceTier: 'tier_1',
          pollMinutes: 5,
          enabled: false,
          parserHints: {
            itemsPath: 'items',
          },
          entityHints: [],
          metricHints: [],
        },
      ],
    });

    const fetchImpl = vi.fn();
    const result = await runRadarScannerPass({
      store,
      userId,
      fetchTimeoutMs: 2_000,
      sourceBatch: 5,
      fetchImpl,
      seedDefaultSources: false,
      nowIso: '2026-03-11T00:05:00.000Z',
    });

    expect(result.dueSources).toBe(0);
    expect(result.fetchedCount).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
