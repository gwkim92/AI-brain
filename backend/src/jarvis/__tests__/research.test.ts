import { beforeEach, describe, expect, it, vi } from 'vitest';

const { retrieveWebEvidenceMock } = vi.hoisted(() => ({
  retrieveWebEvidenceMock: vi.fn()
}));

vi.mock('../../retrieval/adapter-router', () => ({
  retrieveWebEvidence: retrieveWebEvidenceMock
}));

import { generateResearchArtifact } from '../research';

function makeSource(input: {
  url: string;
  title: string;
  domain: string;
  publishedAt?: string;
  snippet?: string;
}) {
  return {
    url: input.url,
    title: input.title,
    domain: input.domain,
    publishedAt: input.publishedAt,
    snippet: input.snippet ?? input.title
  };
}

describe('generateResearchArtifact', () => {
  beforeEach(() => {
    retrieveWebEvidenceMock.mockReset();
  });

  it('retries news research with broader retrieval when the first quality gate is weak', async () => {
    const oldDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date().toISOString();

    retrieveWebEvidenceMock
      .mockResolvedValueOnce({
        query: 'latest war news',
        rewrittenQueries: ['latest war news'],
        items: [],
        sources: [
          makeSource({
            url: 'https://example.com/war-1',
            title: 'War update 1',
            domain: 'example.com',
            publishedAt: oldDate
          })
        ]
      })
      .mockResolvedValueOnce({
        query: 'latest war news',
        rewrittenQueries: ['latest war news', 'global conflict headlines'],
        items: [],
        sources: [
          makeSource({ url: 'https://example.com/war-1', title: 'War update 1', domain: 'example.com', publishedAt: recentDate }),
          makeSource({ url: 'https://example.net/war-2', title: 'War update 2', domain: 'example.net', publishedAt: recentDate }),
          makeSource({ url: 'https://example.org/war-3', title: 'War update 3', domain: 'example.org', publishedAt: recentDate }),
          makeSource({ url: 'https://news.kr/war-4', title: 'War update 4', domain: 'news.kr', publishedAt: recentDate })
        ]
      });

    const artifact = await generateResearchArtifact('latest war news', { strictness: 'news' });

    expect(retrieveWebEvidenceMock).toHaveBeenCalledTimes(2);
    expect(artifact.quality.quality_gate_passed).toBe(true);
    expect(artifact.quality.source_count).toBeGreaterThanOrEqual(4);
    expect(artifact.quality.domain_count).toBeGreaterThanOrEqual(3);
  });

  it('blocks strict news research when quality gate remains weak after retry', async () => {
    const oldDate = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    const weakPack = {
      query: 'breaking news',
      rewrittenQueries: ['breaking news'],
      items: [],
      sources: [
        makeSource({
          url: 'https://single-source.example/news',
          title: 'Only one source',
          domain: 'single-source.example',
          publishedAt: oldDate
        })
      ]
    };

    retrieveWebEvidenceMock.mockResolvedValueOnce(weakPack).mockResolvedValueOnce(weakPack);

    await expect(generateResearchArtifact('breaking news', { strictness: 'news' })).rejects.toThrow(
      'quality gate failed:'
    );
    expect(retrieveWebEvidenceMock).toHaveBeenCalledTimes(2);
  });
});
