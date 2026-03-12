import { describe, expect, it } from 'vitest';

import { scoreRetrievalItem } from '../ranker';

describe('scoreRetrievalItem', () => {
  it('prefers global major-news coverage over local political noise for broad major-news prompts', () => {
    const prompt = '오늘 주요 뉴스를 나에게 제공해줘봐';

    const globalResult = scoreRetrievalItem({
      prompt,
      title: 'EU agrees on new sanctions package',
      snippet: 'International markets and diplomacy reacted to the new global sanctions package.',
      domain: 'reuters.com',
      publishedAt: new Date().toISOString()
    });

    const localResult = scoreRetrievalItem({
      prompt,
      title: '부산 찾은 한동훈 “윤어게인 한 줌이 이끄는 국힘 안타까워”',
      snippet: '부산 지역 방문에서 국민의힘과 민주당을 둘러싼 국내 정치 발언이 이어졌다.',
      domain: 'news.google.com',
      publishedAt: new Date().toISOString()
    });

    expect(globalResult.final).toBeGreaterThan(localResult.final);
    expect(globalResult.trust).toBeGreaterThan(localResult.trust);
  });

  it('penalizes local low-significance coverage beneath global economic headlines for major-news prompts', () => {
    const prompt = '오늘 세계 주요 뉴스를 정리해줘';

    const headlineResult = scoreRetrievalItem({
      prompt,
      profile: 'broad_news',
      sourcePolicy: 'headline_media',
      title: 'Central bank signals rate pause as global markets rally',
      snippet: 'Investors reacted after the central bank signaled a pause and trade talks resumed.',
      domain: 'reuters.com',
      publishedAt: new Date().toISOString(),
    });

    const localResult = scoreRetrievalItem({
      prompt,
      profile: 'broad_news',
      sourcePolicy: 'headline_media',
      title: '부산 시의회 지역 정치 공방 이어져',
      snippet: '지역 정치와 시의회 갈등이 이어졌다는 보도다.',
      domain: 'news.google.com',
      publishedAt: new Date().toISOString(),
    });

    expect(headlineResult.significance).toBeGreaterThan(localResult.significance);
    expect(headlineResult.final).toBeGreaterThan(localResult.final);
  });
});
