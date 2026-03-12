import { describe, expect, it } from 'vitest';

import { extractWorldModelCandidateFacts } from '../extraction';

describe('extractWorldModelCandidateFacts', () => {
  it('marks extracted facts as candidate facts and links entities, events, observations', () => {
    const result = extractWorldModelCandidateFacts({
      query: '이란-이스라엘 충돌이 LNG 운임에 미치는 영향',
      researchProfile: 'market_research',
      sources: [
        {
          url: 'https://www.reuters.com/world/middle-east/qatar-lng#top',
          title: 'Qatar weighs new LNG shipments after regional conflict',
          domain: 'www.reuters.com',
          publishedAt: '2026-03-10T01:00:00Z',
          snippet: 'Shipping rates rose 12% as insurers reassessed Red Sea risk.'
        }
      ],
      claims: [
        {
          claimText: 'Qatar moved to secure LNG shipments after the Iran-Israel conflict pushed shipping rates up 12%.',
          sourceUrls: ['https://www.reuters.com/world/middle-east/qatar-lng#top']
        }
      ],
    });

    expect(result.status).toBe('candidate');
    expect(result.claims[0]?.epistemicStatus).toBe('extracted');
    expect(result.entities.map((entity) => entity.canonicalName)).toEqual(
      expect.arrayContaining(['Iran', 'Israel', 'Qatar', 'LNG'])
    );
    expect(result.events.some((event) => event.kind === 'geopolitical')).toBe(true);
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: 'shipping_rate',
          valueText: expect.stringContaining('12%'),
        }),
      ])
    );
  });

  it('normalizes duplicate source urls and keeps extracted status separate from validation', () => {
    const result = extractWorldModelCandidateFacts({
      query: '카타르 LNG 계약',
      researchProfile: 'topic_news',
      sources: [
        {
          url: 'https://example.com/lng-deal/#fragment',
          title: 'Qatar signs LNG contract',
          domain: 'example.com',
          publishedAt: '2026-03-10T02:00:00Z',
          snippet: 'The deal lasts 20 years.'
        }
      ],
      claims: [
        {
          claimText: 'Qatar signed a 20-year LNG contract.',
          sourceUrls: ['https://example.com/lng-deal/#fragment', 'https://example.com/lng-deal/']
        }
      ],
    });

    expect(result.claims[0]?.sourceUrls).toEqual(['https://example.com/lng-deal']);
    expect(result.claims[0]?.epistemicStatus).toBe('extracted');
    expect(result.events[0]).toEqual(
      expect.objectContaining({
        kind: 'contract',
      })
    );
  });
});
