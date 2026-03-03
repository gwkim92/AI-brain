import { describe, expect, it } from 'vitest';

import { evaluateRetrievalQualityGate } from '../retrieval-quality-gate';
import type { RetrievalEvidencePack } from '../adapter-router';

function buildEvidence(items: RetrievalEvidencePack['items']): RetrievalEvidencePack {
  return {
    query: 'latest major news briefing',
    rewrittenQueries: ['latest major news briefing'],
    items,
    sources: items.map((item) => ({
      url: item.url,
      title: item.title,
      domain: item.domain
    }))
  };
}

describe('evaluateRetrievalQualityGate', () => {
  it('passes for news when evidence has multiple recent domains', () => {
    const now = Date.now();
    const result = evaluateRetrievalQualityGate({
      decision: {
        policy: 'dynamic_factual',
        requiresGrounding: true,
        reasons: ['news_signal'],
        signals: {
          recency: true,
          factual: true,
          citations: false,
          highRisk: false,
          news: true
        }
      },
      evidence: buildEvidence([
        {
          sourceId: 'src_1',
          title: 'A',
          url: 'https://www.reuters.com/world/a',
          domain: 'www.reuters.com',
          publishedAt: new Date(now - 60 * 60 * 1000).toISOString(),
          retrievedAt: new Date(now).toISOString(),
          snippet: 'A',
          scores: { relevance: 0.9, freshness: 0.9, trust: 0.9, diversity: 0.9, final: 0.9 }
        },
        {
          sourceId: 'src_2',
          title: 'B',
          url: 'https://www.bloomberg.com/markets/b',
          domain: 'www.bloomberg.com',
          publishedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          retrievedAt: new Date(now).toISOString(),
          snippet: 'B',
          scores: { relevance: 0.8, freshness: 0.8, trust: 0.8, diversity: 0.8, final: 0.8 }
        }
      ])
    });

    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('fails when news evidence is too sparse and stale', () => {
    const now = Date.now();
    const result = evaluateRetrievalQualityGate({
      decision: {
        policy: 'dynamic_factual',
        requiresGrounding: true,
        reasons: ['news_signal'],
        signals: {
          recency: true,
          factual: true,
          citations: false,
          highRisk: false,
          news: true
        }
      },
      evidence: buildEvidence([
        {
          sourceId: 'src_1',
          title: 'A',
          url: 'https://www.reuters.com/world/a',
          domain: 'www.reuters.com',
          publishedAt: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
          retrievedAt: new Date(now).toISOString(),
          snippet: 'A',
          scores: { relevance: 0.6, freshness: 0.1, trust: 0.8, diversity: 0.2, final: 0.4 }
        }
      ])
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('insufficient_retrieval_sources');
    expect(result.reasons).toContain('insufficient_retrieval_domain_diversity');
    expect(result.reasons).toContain('insufficient_retrieval_freshness');
    expect(result.reasons).toContain('low_retrieval_freshness_ratio');
  });
});
