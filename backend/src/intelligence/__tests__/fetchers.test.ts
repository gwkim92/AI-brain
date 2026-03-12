import { describe, expect, it, vi } from 'vitest';

import type { IntelligenceSourceRecord } from '../../store/types';
import { fetchIntelligenceSource } from '../fetchers';

function makeSource(overrides?: Partial<IntelligenceSourceRecord>): IntelligenceSourceRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    name: 'Example source',
    kind: 'headless',
    url: 'https://example.com/article',
    sourceType: 'web_page',
    sourceTier: 'tier_1',
    pollMinutes: 30,
    enabled: true,
    parserConfigJson: {},
    crawlConfigJson: {},
    crawlPolicy: {
      allowDomains: [],
      denyDomains: [],
      respectRobots: true,
      maxDepth: 1,
      maxPagesPerRun: 5,
      revisitCooldownMinutes: 60,
      perDomainRateLimitPerMinute: 6,
    },
    health: {
      lastStatus: 'idle',
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      recentLatencyMs: null,
      status403Count: 0,
      status429Count: 0,
      robotsBlocked: false,
      lastFailureReason: null,
      updatedAt: null,
    },
    connectorCapability: null,
    entityHints: [],
    metricHints: [],
    lastFetchedAt: null,
    lastSuccessAt: null,
    lastError: null,
    createdAt: '2026-03-12T00:00:00.000Z',
    updatedAt: '2026-03-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('fetchIntelligenceSource', () => {
  it('blocks headless sources when robots disallow crawling', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /article\n', { status: 200 });
      }
      return new Response('<html><title>blocked</title></html>', { status: 200 });
    });

    const result = await fetchIntelligenceSource({
      source: makeSource(),
      timeoutMs: 2_000,
      fetchImpl,
      browserFetchImpl: null,
    });

    expect(result.documents).toHaveLength(0);
    expect(result.fetchMeta.blockedByRobots).toBe(true);
    expect(result.fetchMeta.failed).toBe(true);
  });

  it('expands search sources into candidate urls instead of storing the search result page', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/search')) {
        return new Response(
          JSON.stringify({
            items: [
              { title: 'one', url: 'https://docs.example.com/a' },
              { title: 'two', url: 'https://docs.example.com/b' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (String(url).endsWith('/robots.txt')) {
        return new Response('User-agent: *\nAllow: /\n', { status: 200 });
      }
      return new Response('<html><title>doc</title><body>hello</body></html>', { status: 200 });
    });

    const result = await fetchIntelligenceSource({
      source: makeSource({
        kind: 'search',
        url: 'https://example.com/search?q=intelligence',
        sourceType: 'search_result',
        parserConfigJson: {
          itemsPath: 'items',
          urlField: 'url',
        },
        crawlPolicy: {
          allowDomains: ['docs.example.com'],
          denyDomains: [],
          respectRobots: true,
          maxDepth: 1,
          maxPagesPerRun: 5,
          revisitCooldownMinutes: 60,
          perDomainRateLimitPerMinute: 6,
        },
      }),
      timeoutMs: 2_000,
      fetchImpl,
      browserFetchImpl: null,
    });

    expect(result.documents).toHaveLength(2);
    expect(result.documents.every((document) => document.metadataJson.search_source_url === 'https://example.com/search?q=intelligence')).toBe(true);
    expect(result.documents.some((document) => document.canonicalUrl.includes('/search'))).toBe(false);
    expect(result.fetchMeta.searchCandidateCount).toBe(2);
  });
});
