import { describe, expect, it } from 'vitest';

import {
  buildFallbackNewsFactsFromSources,
  ensureFactDomainCoverage,
  extractNewsFactsFromOutput,
  renderNewsBriefingFromFacts
} from '../news-briefing';

describe('news briefing helpers', () => {
  it('extracts structured facts and keeps only known source urls', () => {
    const output = JSON.stringify({
      facts: [
        {
          headline: '시장 반등',
          summary: '인플레이션 둔화 신호로 주요 지수가 상승했다.',
          source_urls: [
            'https://www.reuters.com/world/markets-rebound',
            'https://unknown.example.com/not-allowed'
          ]
        }
      ]
    });

    const extracted = extractNewsFactsFromOutput(output, [
      {
        url: 'https://www.reuters.com/world/markets-rebound',
        title: 'Markets rebound',
        domain: 'www.reuters.com'
      }
    ]);

    expect(extracted.parseFailed).toBe(false);
    expect(extracted.facts).toHaveLength(1);
    expect(extracted.facts[0]?.sourceUrls).toEqual(['https://www.reuters.com/world/markets-rebound']);
  });

  it('renders stable korean briefing with inline citations and sources section', () => {
    const rendered = renderNewsBriefingFromFacts({
      facts: [
        {
          headline: '글로벌 시장 반등',
          summary: '주요 시장이 동반 상승했다.',
          whyItMatters: '위험자산 선호 회복 가능성이 있다.',
          eventDate: '2026-02-28',
          sourceUrls: ['https://www.reuters.com/world/markets-rebound']
        }
      ],
      sources: [
        {
          url: 'https://www.reuters.com/world/markets-rebound',
          title: 'Markets rebound',
          domain: 'www.reuters.com'
        }
      ],
      expectedLanguage: 'ko',
      retrievedAt: '2026-02-28T09:00:00.000Z'
    });

    expect(rendered).toContain('### 주요 뉴스 브리핑');
    expect(rendered).toContain('https://www.reuters.com/world/markets-rebound');
    expect(rendered).toContain('Sources:');
  });

  it('normalizes mixed-script artifacts and keeps domain diversity in extracted facts', () => {
    const output = JSON.stringify({
      facts: [
        {
          headline: '오픈아이와 방위부의 인공지능 계약',
          summary: '트럼프 대통령이 안THRropic의 기술 사용을 금지했다.',
          source_urls: ['https://www.nytimes.com/2026/02/27/technology/openai-agreement-pentagon-ai.html']
        },
        {
          headline: '방위부와 안THRropic 간의 대립',
          summary: '방위부는 안THRropic 및 앤솔라피티 기술 중단을 지시했다.',
          source_urls: ['https://www.nytimes.com/2026/02/27/us/politics/anthropic-military-ai.html']
        },
        {
          headline: '영국 규제 강화',
          summary: '식품 표시 규제 강화가 발표됐다.',
          source_urls: ['https://www.bbc.com/news/articles/cn0egryw20yo']
        }
      ]
    });

    const extracted = extractNewsFactsFromOutput(output, [
      {
        url: 'https://www.nytimes.com/2026/02/27/technology/openai-agreement-pentagon-ai.html',
        title: 'OpenAI Reaches A.I. Agreement With Defense Dept. After Anthropic Clash',
        domain: 'www.nytimes.com'
      },
      {
        url: 'https://www.nytimes.com/2026/02/27/us/politics/anthropic-military-ai.html',
        title: 'Trump Orders U.S. Agencies to Stop Using Anthropic AI Tech',
        domain: 'www.nytimes.com'
      },
      {
        url: 'https://www.bbc.com/news/articles/cn0egryw20yo',
        title: 'Man charged after Churchill statue defaced, police say',
        domain: 'www.bbc.com'
      }
    ]);

    expect(extracted.facts).toHaveLength(3);
    expect(extracted.facts.some((fact) => /안THRropic/u.test(`${fact.headline} ${fact.summary}`))).toBe(false);
    expect(extracted.facts.some((fact) => /앤솔라피티/u.test(`${fact.headline} ${fact.summary}`))).toBe(false);
    const domains = new Set(
      extracted.facts.map((fact) => (fact.sourceUrls[0]?.includes('bbc.com') ? 'bbc' : 'nyt'))
    );
    expect(domains.has('bbc')).toBe(true);
    expect(domains.has('nyt')).toBe(true);
  });

  it('builds deterministic fallback facts when structured extraction is unavailable', () => {
    const fallback = buildFallbackNewsFactsFromSources({
      sources: [
        {
          url: 'https://www.nytimes.com/2026/02/27/technology/openai-agreement-pentagon-ai.html',
          title: 'OpenAI Reaches A.I. Agreement With Defense Dept.',
          domain: 'www.nytimes.com',
          snippet: 'The Defense Department reached an AI agreement.'
        },
        {
          url: 'https://www.bbc.com/news/articles/cn0egryw20yo',
          title: '영국 당국, 식품 표시 규제 강화 발표',
          domain: 'www.bbc.com',
          snippet: '영국 정부가 식품 표시 관련 새 규정을 발표했다.'
        }
      ],
      expectedLanguage: 'ko',
      maxFacts: 3
    });

    expect(fallback).toHaveLength(2);
    expect(fallback[0]?.sourceUrls[0]).toContain('nytimes.com');
    expect(fallback[1]?.headline).toContain('영국');
    expect(fallback[0]?.headline).toMatch(/^\[[^\]]+\]/u);
    expect(fallback[0]?.whyItMatters?.length).toBeGreaterThan(10);
    expect(fallback.every((fact) => fact.summary.length > 10)).toBe(true);
  });

  it('supplements facts to improve domain coverage when evidence has multiple domains', () => {
    const diversified = ensureFactDomainCoverage({
      facts: [
        {
          headline: '이라크 공격으로 인한 혼란',
          summary: '테헤란에서 혼란이 가중되었다.',
          sourceUrls: ['https://www.nytimes.com/2026/02/28/world/middleeast/iran-reaction-us-attack-tehran.html']
        }
      ],
      sources: [
        {
          url: 'https://www.nytimes.com/2026/02/28/world/middleeast/iran-reaction-us-attack-tehran.html',
          title: 'Chaos and Panic Grip Tehran as Airstrikes Shake City',
          domain: 'www.nytimes.com'
        },
        {
          url: 'https://www.bbc.com/news/articles/cn0egryw20yo',
          title: '영국 당국, 식품 표시 규제 강화 발표',
          domain: 'www.bbc.com'
        }
      ],
      expectedLanguage: 'ko',
      maxFacts: 3
    });

    expect(diversified.length).toBeGreaterThanOrEqual(2);
    expect(diversified.some((fact) => fact.sourceUrls[0]?.includes('bbc.com'))).toBe(true);
  });

  it('prioritizes non-security topic coverage for major-news fallback facts', () => {
    const fallback = buildFallbackNewsFactsFromSources({
      sources: [
        {
          url: 'https://www.reuters.com/world/europe/sanctions',
          title: 'EU agrees on new sanctions package',
          domain: 'www.reuters.com',
          snippet: 'Officials said the sanctions package would tighten strategic export controls.'
        },
        {
          url: 'https://www.bbc.com/news/business-12345678',
          title: 'Central bank signals pause on rate hikes',
          domain: 'www.bbc.com',
          snippet: 'Markets rallied after policymakers signaled a pause in rate moves.'
        },
        {
          url: 'https://www.nytimes.com/2026/03/07/technology/ai-chip-race.html',
          title: 'AI chip race intensifies as new model launches',
          domain: 'www.nytimes.com',
          snippet: 'Technology companies accelerated model releases and chip investment plans.'
        },
        {
          url: 'https://www.ft.com/content/conflict-update',
          title: 'Regional forces exchange fire near disputed border',
          domain: 'www.ft.com',
          snippet: 'Security forces exchanged fire as tensions remained elevated overnight.'
        }
      ],
      expectedLanguage: 'ko',
      maxFacts: 4,
      qualityProfile: 'major'
    });

    const topics = new Set(fallback.map((fact) => fact.headline));
    expect(topics.size).toBeGreaterThanOrEqual(3);
    expect(fallback.some((fact) => fact.sourceUrls[0]?.includes('bbc.com'))).toBe(true);
    expect(fallback.some((fact) => fact.sourceUrls[0]?.includes('nytimes.com'))).toBe(true);
  });
});
