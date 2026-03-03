import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRetrievalSystemInstruction, retrieveWebEvidence } from '../adapter-router';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('retrieveWebEvidence', () => {
  it('parses google news rss and ranks distinct sources', async () => {
    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>Headline A</title>',
      '<link>https://www.reuters.com/world/a</link>',
      '<description>snippet A</description>',
      '<pubDate>Fri, 27 Feb 2026 08:00:00 GMT</pubDate>',
      '</item>',
      '<item>',
      '<title>Headline B</title>',
      '<link>https://www.bloomberg.com/markets/b</link>',
      '<description>snippet B</description>',
      '<pubDate>Fri, 27 Feb 2026 09:00:00 GMT</pubDate>',
      '</item>',
      '</channel></rss>'
    ].join('');

    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(rssXml, {
        status: 200,
        headers: { 'content-type': 'application/xml' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'latest market headlines',
      rewrittenQueries: ['latest market headlines'],
      maxItems: 5
    });

    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.sources.map((source) => source.domain)).toContain('www.reuters.com');
    expect(result.sources.map((source) => source.domain)).toContain('www.bloomberg.com');
  });

  it('builds retrieval grounding instruction', () => {
    const instruction = buildRetrievalSystemInstruction({
      query: 'latest major news',
      rewrittenQueries: ['latest major news'],
      items: [
        {
          sourceId: 'src_1',
          title: 'Sample',
          url: 'https://www.reuters.com/world/sample',
          domain: 'www.reuters.com',
          publishedAt: '2026-02-27T08:00:00.000Z',
          retrievedAt: '2026-02-27T08:01:00.000Z',
          snippet: 'sample snippet',
          scores: {
            relevance: 0.9,
            freshness: 0.9,
            trust: 0.9,
            diversity: 0.9,
            final: 0.9
          }
        }
      ],
      sources: [
        {
          url: 'https://www.reuters.com/world/sample',
          title: 'Sample',
          domain: 'www.reuters.com'
        }
      ]
    });

    expect(instruction).toContain('Retrieved Evidence');
    expect(instruction).toContain('reuters.com/world/sample');
  });
});
