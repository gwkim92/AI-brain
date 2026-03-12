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
    expect(artifact.worldModelExtraction.status).toBe('candidate');
    expect(artifact.worldModelExtraction.claims[0]?.epistemicStatus).toBe('extracted');
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

  it('passes major news research only when topic coverage is broad enough', async () => {
    const recentDate = new Date().toISOString();

    retrieveWebEvidenceMock.mockResolvedValue({
      query: '오늘 세계 주요 뉴스 정리해줘',
      rewrittenQueries: ['오늘 세계 주요 뉴스 정리해줘', 'world major headlines today'],
      items: [],
      sources: [
        makeSource({
          url: 'https://bbc.com/economy/rates',
          title: 'Central bank signals rate pause',
          domain: 'bbc.com',
          publishedAt: recentDate,
          snippet: 'Markets reacted after the central bank signaled a pause in rate moves.'
        }),
        makeSource({
          url: 'https://nytimes.com/technology/ai-model',
          title: 'OpenAI unveils new AI model',
          domain: 'nytimes.com',
          publishedAt: recentDate,
          snippet: 'The release is expected to affect enterprise adoption and safety debates.'
        }),
        makeSource({
          url: 'https://reuters.com/world/europe/sanctions',
          title: 'EU agrees on new sanctions package',
          domain: 'reuters.com',
          publishedAt: recentDate,
          snippet: 'Officials said the package would tighten pressure on strategic exports.'
        }),
        makeSource({
          url: 'https://ft.com/world/conflict-update',
          title: 'Ceasefire talks continue amid regional tensions',
          domain: 'ft.com',
          publishedAt: recentDate,
          snippet: 'Diplomats said talks continued as regional security risks remained elevated.'
        })
      ]
    });

    const artifact = await generateResearchArtifact('오늘 세계 주요 뉴스 정리해줘', { strictness: 'news' });

    expect(artifact.quality.quality_profile).toBe('major');
    expect(artifact.quality.quality_gate_passed).toBe(true);
    expect(artifact.quality.topic_count).toBeGreaterThanOrEqual(3);
    expect(artifact.quality.domain_count).toBeGreaterThanOrEqual(3);
    expect(artifact.quality.quality_dimensions).toMatchObject({
      major_publisher_count: expect.any(Number),
      high_significance_headline_count: expect.any(Number),
    });
    expect((artifact.quality.quality_dimensions as Record<string, unknown>).high_significance_headline_count).toBeGreaterThanOrEqual(2);
  });

  it('returns a warning-grade artifact for broad world-news requests that stay overly concentrated on war coverage', async () => {
    const recentDate = new Date().toISOString();
    const concentratedPack = {
      query: '오늘 세계 주요 뉴스와 전쟁 관련 최신 동향을 정리해줘',
      rewrittenQueries: ['오늘 세계 주요 뉴스와 전쟁 관련 최신 동향을 정리해줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://bbc.com/world/war-1',
          title: 'Missile strike reported overnight',
          domain: 'bbc.com',
          publishedAt: recentDate,
          snippet: 'Officials reported another overnight strike in the conflict zone.'
        }),
        makeSource({
          url: 'https://nytimes.com/world/war-2',
          title: 'Air defenses activated after attack',
          domain: 'nytimes.com',
          publishedAt: recentDate,
          snippet: 'Military officials said air defenses were activated after a new attack.'
        }),
        makeSource({
          url: 'https://reuters.com/world/war-3',
          title: 'Regional forces exchange fire',
          domain: 'reuters.com',
          publishedAt: recentDate,
          snippet: 'Regional security forces exchanged fire near the disputed border.'
        }),
        makeSource({
          url: 'https://ft.com/world/war-4',
          title: 'Defense ministers discuss conflict response',
          domain: 'ft.com',
          publishedAt: recentDate,
          snippet: 'Defense ministers discussed the latest conflict response measures.'
        })
      ]
    };

    retrieveWebEvidenceMock.mockResolvedValueOnce(concentratedPack).mockResolvedValueOnce(concentratedPack);

    const artifact = await generateResearchArtifact('오늘 세계 주요 뉴스와 전쟁 관련 최신 동향을 정리해줘', {
      strictness: 'news'
    });

    expect(artifact.quality.quality_gate_passed).toBe(false);
    expect(artifact.quality.quality_profile).toBe('major_with_war');
    expect(Array.isArray(artifact.quality.soft_warnings)).toBe(true);
    expect((artifact.quality.soft_warnings as string[]).some((warning) => warning.includes('non-security'))).toBe(true);
    const retryCall = retrieveWebEvidenceMock.mock.calls[1]?.[0];
    expect(Array.isArray(retryCall?.rewrittenQueries)).toBe(true);
    expect(retryCall?.rewrittenQueries).toEqual(
      expect.arrayContaining([
        expect.stringContaining('경제 시장'),
        expect.stringContaining('기술 인공지능'),
        expect.stringContaining('전쟁 안보'),
      ])
    );
    expect(retrieveWebEvidenceMock).toHaveBeenCalledTimes(2);
  });

  it('renders structured comparison brief sections for comparison research', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'Gemini와 OpenAI 비교해줘',
      rewrittenQueries: ['Gemini와 OpenAI 비교해줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://blog.google/technology/gemini-update',
          title: 'Gemini model update and enterprise positioning',
          domain: 'blog.google',
          publishedAt: recentDate,
          snippet: 'Google described Gemini pricing, enterprise deployment, and multimodal capabilities.'
        }),
        makeSource({
          url: 'https://openai.com/index/new-models',
          title: 'OpenAI launches new models for developers',
          domain: 'openai.com',
          publishedAt: recentDate,
          snippet: 'OpenAI detailed reasoning quality, developer tooling, and pricing updates.'
        }),
        makeSource({
          url: 'https://www.theverge.com/ai-comparison',
          title: 'Gemini and OpenAI differ on ecosystem and deployment',
          domain: 'theverge.com',
          publishedAt: recentDate,
          snippet: 'Coverage compared ecosystem reach, pricing, and multimodal workflows.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('Gemini와 OpenAI 비교해줘');

    expect(artifact.researchProfile).toBe('comparison_research');
    expect(artifact.quality.quality_dimensions).toMatchObject({
      comparison_axes: expect.any(Number),
      comparison_axis_labels: expect.arrayContaining(['pricing_access', 'developer_experience', 'enterprise_governance']),
    });
    expect((artifact.quality.quality_dimensions as Record<string, unknown>).comparison_axes).toBeGreaterThanOrEqual(3);
    expect(artifact.answerMarkdown).toMatch(/#### (비교 구조|Comparison structure)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (비교 대상|Compared entities)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (핵심 비교축|Comparison axes)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (축별 근거|Axis evidence)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (차이 요약|Difference summary)/u);
    expect(artifact.answerMarkdown).toMatch(/(가격·접근성|Pricing and access)/u);
    expect(artifact.answerMarkdown).toMatch(/(개발자 경험|Developer experience)/u);
    expect(artifact.answerMarkdown).toMatch(/(근거 분포|Evidence split)/u);
    expect(artifact.answerMarkdown).toMatch(/(대표 근거|Representative evidence)/u);
    expect(artifact.answerMarkdown).toMatch(/enterprise deployment|developer tooling|ecosystem reach/u);
  });

  it('renders structured entity brief sections for entity research', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'TSMC를 요약해줘',
      rewrittenQueries: ['TSMC를 요약해줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://www.tsmc.com/english/news',
          title: 'TSMC investor and news updates',
          domain: 'www.tsmc.com',
          publishedAt: recentDate,
          snippet: 'Official updates on fabs, capacity, and customer demand.'
        }),
        makeSource({
          url: 'https://www.reuters.com/technology/tsmc-expansion',
          title: 'TSMC expands advanced packaging capacity',
          domain: 'www.reuters.com',
          publishedAt: recentDate,
          snippet: 'Reuters covers customer demand and expansion timing.'
        }),
        makeSource({
          url: 'https://www.ft.com/content/tsmc-chip-demand',
          title: 'TSMC sees sustained AI chip demand',
          domain: 'www.ft.com',
          publishedAt: recentDate,
          snippet: 'FT reports on AI demand and margins.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('TSMC를 요약해줘');

    expect(artifact.researchProfile).toBe('entity_brief');
    expect(artifact.answerMarkdown).toMatch(/#### (대상 스냅샷|Entity snapshot)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (최근 움직임|Recent moves)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (핵심 변화|Core changes)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (리스크·체크포인트|Risks and checkpoints)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (근거 구성|Evidence mix)/u);
    expect(artifact.answerMarkdown).toMatch(/advanced packaging capacity|AI chip demand|Official updates on fabs/u);
    expect(artifact.quality.quality_dimensions).toMatchObject({
      official_source_count: 1,
    });
  });

  it('prefers official update-like sources for entity recent moves and core changes', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'NVIDIA를 요약해줘',
      rewrittenQueries: ['NVIDIA를 요약해줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://www.nvidia.com/en-us/about-nvidia/',
          title: 'NVIDIA official company overview',
          domain: 'www.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official company overview and platform description.'
        }),
        makeSource({
          url: 'https://nvidianews.nvidia.com/news/nvidia-expands-blackwell-rack-shipments',
          title: 'NVIDIA expands Blackwell rack shipments',
          domain: 'nvidianews.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official newsroom update covering expanded Blackwell rack shipments, partner launches, and data-center demand.'
        }),
        makeSource({
          url: 'https://investor.nvidia.com/news-events/press-releases/detail/1234/nvidia-reports-quarterly-results',
          title: 'NVIDIA reports quarterly results',
          domain: 'investor.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official IR update discusses quarterly results, AI demand, and capital investment.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('NVIDIA를 요약해줘');

    expect(artifact.answerMarkdown).toMatch(/Blackwell rack shipments|quarterly results|AI demand|capital investment/u);
    expect(artifact.answerMarkdown).not.toMatch(/Official company overview and platform description/u);
  });

  it('counts branded corporate domains as official sources for entity briefs', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'NVIDIA를 요약해줘',
      rewrittenQueries: ['NVIDIA official site'],
      items: [],
      sources: [
        makeSource({
          url: 'https://www.nvidia.com/en-us/about-nvidia/',
          title: 'NVIDIA official company overview',
          domain: 'www.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official company overview and newsroom links.'
        }),
        makeSource({
          url: 'https://nvidianews.nvidia.com/news/nvidia-announces-platform-update',
          title: 'NVIDIA newsroom update',
          domain: 'nvidianews.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official NVIDIA newsroom announcement.'
        }),
        makeSource({
          url: 'https://www.reuters.com/technology/nvidia-demand',
          title: 'NVIDIA demand stays elevated',
          domain: 'www.reuters.com',
          publishedAt: recentDate,
          snippet: 'Reuters coverage of data-center and AI demand.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('NVIDIA를 요약해줘');

    expect(artifact.researchProfile).toBe('entity_brief');
    expect(artifact.quality.quality_dimensions).toMatchObject({
      official_source_count: 2,
      media_source_count: 1,
    });
    expect((artifact.quality.soft_warning_codes as string[]).includes('entity_needs_more_official_sources')).toBe(false);
  });

  it('does not warn about entity official coverage when at least two official sources exist even if media dominates the mix', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'WHO를 요약해줘',
      rewrittenQueries: ['WHO official site'],
      items: [],
      sources: [
        makeSource({
          url: 'https://www.who.int/',
          title: 'World Health Organization',
          domain: 'www.who.int',
          publishedAt: recentDate,
          snippet: 'Official WHO organization overview.'
        }),
        makeSource({
          url: 'https://www.who.int/news',
          title: 'WHO news',
          domain: 'www.who.int',
          publishedAt: recentDate,
          snippet: 'Official WHO newsroom updates.'
        }),
        makeSource({
          url: 'https://www.reuters.com/world/who-update',
          title: 'WHO update covered by Reuters',
          domain: 'www.reuters.com',
          publishedAt: recentDate,
          snippet: 'Reuters coverage of WHO guidance.'
        }),
        makeSource({
          url: 'https://www.bbc.com/news/world-who',
          title: 'BBC on WHO developments',
          domain: 'www.bbc.com',
          publishedAt: recentDate,
          snippet: 'BBC report on WHO policy discussions.'
        }),
        makeSource({
          url: 'https://www.nytimes.com/world/who',
          title: 'NYT on WHO and global health',
          domain: 'www.nytimes.com',
          publishedAt: recentDate,
          snippet: 'Media summary of WHO programs and changes.'
        }),
        makeSource({
          url: 'https://www.ft.com/content/who-health',
          title: 'FT report on WHO',
          domain: 'www.ft.com',
          publishedAt: recentDate,
          snippet: 'Financial Times coverage of WHO policy shifts.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('WHO를 요약해줘');

    expect(artifact.researchProfile).toBe('entity_brief');
    expect(artifact.quality.quality_dimensions).toMatchObject({
      official_source_count: 2,
      media_source_count: 4,
    });
    expect(artifact.quality.soft_warning_codes).not.toContain('entity_needs_more_official_sources');
  });

  it('derives entity snapshot guidance from official source mix when snippets are generic', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'NVIDIA를 요약해줘',
      rewrittenQueries: ['NVIDIA official site'],
      items: [],
      sources: [
        makeSource({
          url: 'https://www.nvidia.com/en-us/about-nvidia/',
          title: 'NVIDIA official company overview',
          domain: 'www.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official company overview and newsroom links.'
        }),
        makeSource({
          url: 'https://nvidianews.nvidia.com/news/nvidia-announces-platform-update',
          title: 'NVIDIA newsroom update',
          domain: 'nvidianews.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official NVIDIA newsroom announcement.'
        }),
        makeSource({
          url: 'https://investor.nvidia.com/',
          title: 'NVIDIA investor relations',
          domain: 'investor.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official NVIDIA investor relations and quarterly materials.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('NVIDIA를 요약해줘');

    expect(artifact.answerMarkdown).toMatch(/공식 자료, 뉴스룸 공지, IR·실적 자료/u);
  });

  it('renders repository coverage sections for repo research', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: '이 GitHub repo 조사해줘',
      rewrittenQueries: ['이 GitHub repo 조사해줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://github.com/example/repo',
          title: 'example/repo README',
          domain: 'github.com',
          publishedAt: recentDate,
          snippet: 'Repository README describes architecture and setup.'
        }),
        makeSource({
          url: 'https://github.com/example/repo/releases/tag/v1.2.0',
          title: 'Release v1.2.0',
          domain: 'github.com',
          publishedAt: recentDate,
          snippet: 'Release notes cover new features and fixes.'
        }),
        makeSource({
          url: 'https://docs.example.dev/getting-started',
          title: 'Getting started guide',
          domain: 'docs.example.dev',
          publishedAt: recentDate,
          snippet: 'Documentation explains installation and deployment.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('이 GitHub repo 조사해줘');

    expect(artifact.researchProfile).toBe('repo_research');
    expect(artifact.answerMarkdown).toMatch(/#### (레포 커버리지|Repository coverage)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (README·문서|README and docs)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (릴리즈·변경 이력|Releases and changelog)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (핵심 프로젝트 신호|Core project signals)/u);
  });

  it('does not warn about low domain diversity when repo-native coverage channels are strong', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'openai codex repo 조사해줘',
      rewrittenQueries: ['openai codex repo 조사해줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://github.com/openai/codex',
          title: 'openai/codex README',
          domain: 'github.com',
          publishedAt: recentDate,
          snippet: 'Repository README and documentation overview.'
        }),
        makeSource({
          url: 'https://github.com/openai/codex/releases',
          title: 'openai/codex releases',
          domain: 'github.com',
          publishedAt: recentDate,
          snippet: 'Release changelog and version history.'
        }),
        makeSource({
          url: 'https://github.com/openai/codex/issues',
          title: 'openai/codex issues',
          domain: 'github.com',
          publishedAt: recentDate,
          snippet: 'Issue tracker and maintenance activity.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('openai codex repo 조사해줘');

    expect(artifact.researchProfile).toBe('repo_research');
    expect(artifact.quality.quality_mode).toBe('pass');
    expect(artifact.quality.soft_warning_codes).not.toContain('low_domain_diversity');
    expect(artifact.quality.quality_dimensions).toMatchObject({
      repo_coverage_channels: 4,
      repo_source_count: 3,
    });
  });

  it('passes market research when at least two authority domains are present', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'AI 인프라 시장 동향을 알려줘',
      rewrittenQueries: ['AI 인프라 시장 동향을 알려줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://www.reuters.com/markets/us/ai-infrastructure-demand',
          title: 'AI infrastructure demand lifts data-center spending outlook',
          domain: 'www.reuters.com',
          publishedAt: recentDate,
          snippet: 'Reuters covers data-center demand, capex, and enterprise procurement signals.'
        }),
        makeSource({
          url: 'https://www.ft.com/content/ai-infrastructure-supply-chain',
          title: 'AI infrastructure supply chain tightens as hyperscalers expand',
          domain: 'www.ft.com',
          publishedAt: recentDate,
          snippet: 'FT reports on hyperscaler build-outs and semiconductor capacity constraints.'
        }),
        makeSource({
          url: 'https://www.federalreserve.gov/newsevents/speech/ai-productivity.htm',
          title: 'Federal Reserve remarks on AI, productivity, and investment',
          domain: 'www.federalreserve.gov',
          publishedAt: recentDate,
          snippet: 'Official remarks discuss investment conditions and macro productivity implications.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('AI 인프라 시장 동향을 알려줘');

    expect(artifact.researchProfile).toBe('market_research');
    expect(artifact.quality.quality_mode).toBe('pass');
    expect(artifact.quality.soft_warning_codes).not.toContain('market_needs_authority_source');
    expect(artifact.quality.soft_warning_codes).not.toContain('market_needs_authority_diversity');
    expect(artifact.quality.quality_dimensions).toMatchObject({
      authority_source_count: 3,
      authority_domain_count: 3,
    });
    expect(artifact.answerMarkdown).toMatch(/#### (핵심 지표|Core indicators)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (수급 신호|Supply and demand signals)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (정책 변수|Policy variables)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (확인된 사실|Verified facts)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (해석|Interpretation)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (리스크 관찰 포인트|Risk watchpoints)/u);
    expect(artifact.answerMarkdown).toMatch(/capex|hyperscaler build-outs|macro productivity implications/u);
  });

  it('separates sector and macro indicators for sector-specific market research', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'AI 인프라 시장 동향을 알려줘',
      rewrittenQueries: ['AI 인프라 시장 동향을 알려줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://investor.nvidia.com/',
          title: 'NVIDIA investor relations',
          domain: 'investor.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official investor materials covering data-center demand, AI revenue mix, capital expenditure posture, and platform expansion signals.'
        }),
        makeSource({
          url: 'https://ir.aboutamazon.com/quarterly-results/default.aspx',
          title: 'Amazon quarterly results and AWS demand',
          domain: 'ir.aboutamazon.com',
          publishedAt: recentDate,
          snippet: 'Official quarterly materials covering AWS demand, infrastructure investment, and fulfillment of AI-related capacity needs.'
        }),
        makeSource({
          url: 'https://www.federalreserve.gov/newsevents/speech/ai-productivity.htm',
          title: 'Federal Reserve remarks on AI, productivity, and investment',
          domain: 'www.federalreserve.gov',
          publishedAt: recentDate,
          snippet: 'Official remarks discuss investment conditions, monetary policy, and productivity implications.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('AI 인프라 시장 동향을 알려줘');

    expect(artifact.answerMarkdown).toMatch(/##### (섹터 지표|Sector indicators)/u);
    expect(artifact.answerMarkdown).toMatch(/##### (거시 지표|Macro indicators)/u);
    expect(artifact.answerMarkdown).toMatch(/AWS demand|data-center demand|capital expenditure posture/u);
    expect(artifact.answerMarkdown).toMatch(/Federal Reserve remarks|monetary policy/u);
    expect(artifact.quality.quality_dimensions).toMatchObject({
      sector_signal_count: expect.any(Number),
      macro_signal_count: expect.any(Number),
    });
  });

  it('renders quantitative-style market indicator lines when investment signals are present without numeric values', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'AI 인프라 시장 동향을 알려줘',
      rewrittenQueries: ['AI 인프라 시장 동향을 알려줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://investor.nvidia.com/',
          title: 'NVIDIA investor relations',
          domain: 'investor.nvidia.com',
          publishedAt: recentDate,
          snippet: 'Official investor materials covering data-center demand, AI revenue mix, capital expenditure posture, and platform expansion signals.'
        }),
        makeSource({
          url: 'https://ir.aboutamazon.com/quarterly-results/default.aspx',
          title: 'Amazon quarterly results and AWS demand',
          domain: 'ir.aboutamazon.com',
          publishedAt: recentDate,
          snippet: 'Official quarterly materials covering AWS demand, infrastructure investment, and fulfillment of AI-related capacity needs.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('AI 인프라 시장 동향을 알려줘');

    expect(artifact.answerMarkdown).toMatch(/capital expenditure posture|infrastructure investment|AWS demand|data-center demand/u);
  });

  it('renders policy scope sections for regulation research', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValueOnce({
      query: 'EU AI Act 최근 변화를 정리해줘',
      rewrittenQueries: ['EU AI Act 최근 변화를 정리해줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai',
          title: 'EU AI Act regulatory framework updated',
          domain: 'digital-strategy.ec.europa.eu',
          publishedAt: recentDate,
          snippet: 'The European Commission updated guidance on implementation and timelines. Applies from 2 August 2026 for the latest obligations.'
        }),
        makeSource({
          url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689',
          title: 'Official EU AI Act text',
          domain: 'eur-lex.europa.eu',
          publishedAt: recentDate,
          snippet: 'The regulation text includes scope, obligations, and effective dates. Entry into force on 1 August 2024.'
        }),
        makeSource({
          url: 'https://commission.europa.eu/strategy-and-policy/priorities-2019-2024/europe-fit-digital-age_en',
          title: 'Commission note on AI Act implementation phases',
          domain: 'commission.europa.eu',
          publishedAt: recentDate,
          snippet: 'The note explains jurisdiction, phased obligations, enforcement timing, and starts applying from 2 February 2025 for initial obligations.'
        }),
      ]
    });

    const artifact = await generateResearchArtifact('EU AI Act 최근 변화를 정리해줘');

    expect(artifact.researchProfile).toBe('policy_regulation');
    expect(artifact.answerMarkdown).toMatch(/#### (규정 적용 범위|Policy scope)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (관할·문서|Jurisdiction and documents)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (발효 일정|Effective timeline)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (단계별 적용일|Phased application dates)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (핵심 변경 사항|Core changes)/u);
    expect(artifact.answerMarkdown).toMatch(/#### (영향 범위|Impact scope)/u);
    expect(artifact.answerMarkdown).not.toMatch(/(발효일 또는 시행 시점 신호가 아직 부족합니다|Effective-date signals are still limited)/u);
    expect(artifact.answerMarkdown).toMatch(/2026-08-02|2024-08-01/u);
    expect(artifact.answerMarkdown).toMatch(/2025-02-02/u);
  });

  it('renders concise and detailed research briefs differently when response style is requested', async () => {
    const recentDate = new Date().toISOString();
    retrieveWebEvidenceMock.mockResolvedValue({
      query: 'openai codex repo 조사해줘',
      rewrittenQueries: ['openai codex repo 조사해줘'],
      items: [],
      sources: [
        makeSource({
          url: 'https://github.com/openai/codex',
          title: 'OpenAI Codex repository',
          domain: 'github.com',
          publishedAt: recentDate,
          snippet: 'Repository overview, README coverage, issue activity, and maintenance signals for Codex.'
        }),
        makeSource({
          url: 'https://github.com/openai/codex/releases',
          title: 'Codex releases',
          domain: 'github.com',
          publishedAt: recentDate,
          snippet: 'Release notes, changelog details, and tagged versions for Codex updates.'
        }),
        makeSource({
          url: 'https://github.com/openai/codex/issues',
          title: 'Codex issues',
          domain: 'github.com',
          publishedAt: recentDate,
          snippet: 'Issue backlog and maintenance discussions for Codex repository health.'
        }),
        makeSource({
          url: 'https://developers.openai.com/codex/docs',
          title: 'Codex documentation',
          domain: 'developers.openai.com',
          publishedAt: recentDate,
          snippet: 'Official documentation covering API usage, setup guides, and implementation details.'
        }),
      ]
    });

    const conciseArtifact = await generateResearchArtifact('openai codex repo 조사해줘', {
      responseStyle: 'concise',
    });
    const detailedArtifact = await generateResearchArtifact('openai codex repo 조사해줘', {
      responseStyle: 'detailed',
    });

    expect(conciseArtifact.answerMarkdown).not.toMatch(/#### (추가 근거|Additional evidence)/u);
    expect(detailedArtifact.answerMarkdown).toMatch(/#### (추가 근거|Additional evidence)/u);
    expect(detailedArtifact.answerMarkdown.split('\n').length).toBeGreaterThan(conciseArtifact.answerMarkdown.split('\n').length);
  });
});
