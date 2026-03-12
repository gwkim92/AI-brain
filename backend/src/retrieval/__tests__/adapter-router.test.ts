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

  it('prioritizes globally significant major-news sources over local political noise for broad news', async () => {
    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>Central bank signals rate pause</title>',
      '<link>https://www.reuters.com/world/europe/rate-pause</link>',
      '<description>Markets react as the central bank signals a pause and trade talks resume.</description>',
      '<pubDate>Fri, 27 Feb 2026 08:00:00 GMT</pubDate>',
      '</item>',
      '<item>',
      '<title>AI model launch intensifies semiconductor race</title>',
      '<link>https://www.bbc.com/news/technology-ai-chip-race</link>',
      '<description>Technology companies accelerate model releases and chip investment.</description>',
      '<pubDate>Fri, 27 Feb 2026 08:30:00 GMT</pubDate>',
      '</item>',
      '<item>',
      '<title>Ceasefire talks continue amid regional tensions</title>',
      '<link>https://www.ft.com/content/ceasefire-talks</link>',
      '<description>Diplomats continue ceasefire talks as security risks remain elevated.</description>',
      '<pubDate>Fri, 27 Feb 2026 09:00:00 GMT</pubDate>',
      '</item>',
      '<item>',
      '<title>부산 시의회 지역 정치 공방 이어져</title>',
      '<link>https://news.google.com/articles/local-politics</link>',
      '<description>지역 정치와 시의회 갈등이 이어졌다는 보도다.</description>',
      '<pubDate>Fri, 27 Feb 2026 09:10:00 GMT</pubDate>',
      '</item>',
      '<item>',
      '<title>Celebrity scandal dominates local chatter</title>',
      '<link>https://news.google.com/articles/celebrity-scandal</link>',
      '<description>Celebrity scandal and rumor coverage dominates local chatter.</description>',
      '<pubDate>Fri, 27 Feb 2026 09:20:00 GMT</pubDate>',
      '</item>',
      '</channel></rss>'
    ].join('');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(rssXml, {
        status: 200,
        headers: { 'content-type': 'application/xml' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: '오늘 세계 주요 뉴스를 정리해줘',
      rewrittenQueries: ['오늘 세계 주요 뉴스를 정리해줘'],
      maxItems: 4,
      profile: 'broad_news',
      sourcePolicy: 'headline_media',
    });

    expect(result.sources.map((source) => source.domain)).toEqual(
      expect.arrayContaining(['www.reuters.com', 'www.bbc.com', 'www.ft.com'])
    );
    expect(result.sources.some((source) => /local-politics|celebrity-scandal/u.test(source.url))).toBe(false);
  });

  it('uses general web rss for repo research and prefers repo-native sources', async () => {
    const braveHtml = `
      <main id="search-page">
        <div id="results">
          <div class="snippet">
            <a href="https://github.com/openai/codex" target="_self">
              <div class="title">openai/codex README and releases</div>
            </a>
            <div class="content">GitHub repository README releases issues documentation</div>
          </div>
          <div class="snippet">
            <a href="https://platform.openai.com/docs/changelog" target="_self">
              <div class="title">Codex docs changelog</div>
            </a>
            <div class="content">documentation changelog version</div>
          </div>
          <div class="snippet">
            <a href="https://example.com/blog/codex" target="_self">
              <div class="title">Generic blog reaction</div>
            </a>
            <div class="content">generic coverage</div>
          </div>
        </div>
      </main>
    `;

    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('api.github.com/search/repositories')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                full_name: 'openai/codex',
                html_url: 'https://github.com/openai/codex',
                description: 'Lightweight coding agent that runs in your terminal',
                updated_at: '2026-03-07T18:41:33Z'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      return new Response(braveHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'openai codex repo 조사해줘',
      rewrittenQueries: ['openai codex repo 조사해줘'],
      maxItems: 5,
      profile: 'repo_research',
      sourcePolicy: 'repo_first',
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('api.github.com/search/repositories');
    expect(result.rewrittenQueries.some((query) => query.includes('github readme releases issues'))).toBe(true);
    expect(result.sources.map((source) => source.domain)).toContain('github.com');
  });

  it('uses the current workspace repository as a seed for ambiguous local repo prompts', async () => {
    const braveHtml = `
      <main id="search-page">
        <div id="results">
          <div class="snippet">
            <a href="https://github.com/gwkim92/AI-brain" target="_self">
              <div class="title">gwkim92/AI-brain repository</div>
            </a>
            <div class="content">Repository README releases issues maintenance overview.</div>
          </div>
        </div>
      </main>
    `;

    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('api.github.com/search/repositories')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                full_name: 'gwkim92/AI-brain',
                html_url: 'https://github.com/gwkim92/AI-brain',
                description: 'Jarvis operator workspace',
                updated_at: '2026-03-07T18:41:33Z'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      return new Response(braveHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: '이 레포를 조사하고 작업 계획을 세운 뒤 승인 후 실행 준비까지 정리해줘',
      rewrittenQueries: ['이 레포를 조사하고 작업 계획을 세운 뒤 승인 후 실행 준비까지 정리해줘'],
      maxItems: 5,
      profile: 'repo_research',
      sourcePolicy: 'repo_first',
    });

    const githubCallUrl = String(fetchMock.mock.calls.find((call) => String(call[0]).includes('api.github.com/search/repositories'))?.[0] ?? '');
    expect(decodeURIComponent(githubCallUrl)).toMatch(/gwkim92\/AI-brain|AI-brain/u);
    expect(result.sources.map((source) => source.url)).toContain('https://github.com/gwkim92/AI-brain');
  });

  it('parses brave html results for comparison research before falling back to rss', async () => {
    const braveHtml = `
      <main id="search-page">
        <div id="results">
          <div class="snippet">
            <div class="result-wrapper">
              <div class="result-content">
                <a href="https://ai.google.dev/gemini-api/docs/openai" target="_self" class="svelte-14r20fy l1">
                  <div class="title search-snippet-title line-clamp-1 svelte-14r20fy">OpenAI compatibility | Gemini API | Google AI for Developers</div>
                </a>
                <div class="generic-snippet svelte-1cwdgg3">
                  <div class="content desktop-default-regular t-primary line-clamp-dynamic svelte-1cwdgg3">
                    Compare Gemini API compatibility with the OpenAI client library.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    `;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(braveHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'Gemini와 OpenAI 비교해줘',
      rewrittenQueries: ['Gemini와 OpenAI 비교해줘'],
      maxItems: 4,
      profile: 'comparison_research',
      sourcePolicy: 'topic_media',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('search.brave.com/search');
    expect(result.sources[0]?.url).toMatch(/^https:\/\/ai\.google\.dev\/gemini-api\/docs/);
  });

  it('shapes policy regulation queries toward official sources on general web search', async () => {
    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>EU AI Act official guidance</title>',
      '<link>https://artificialintelligenceact.eu/the-act/</link>',
      '<description>official guidance compliance timeline</description>',
      '<pubDate>Fri, 27 Feb 2026 08:00:00 GMT</pubDate>',
      '</item>',
      '</channel></rss>'
    ].join('');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(rssXml, {
        status: 200,
        headers: { 'content-type': 'application/xml' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await retrieveWebEvidence({
      prompt: 'EU AI Act 최근 변화',
      rewrittenQueries: ['EU AI Act 최근 변화'],
      maxItems: 4,
      profile: 'policy_regulation',
      sourcePolicy: 'official_first',
    });

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.includes('search.brave.com/search'))).toBe(true);
    expect(
      calledUrls.some(
        (url) =>
          decodeURIComponent(url).includes('site:eur-lex.europa.eu') ||
          decodeURIComponent(url).includes('site:digital-strategy.ec.europa.eu')
      )
    ).toBe(true);
  });

  it('backfills entity brief with official and reference seeds for known entities', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html><body><main id="search-page"><div id="results"></div></main></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'TSMC를 요약해줘',
      rewrittenQueries: ['TSMC를 요약해줘'],
      maxItems: 4,
      profile: 'entity_brief',
      sourcePolicy: 'official_first',
    });

    expect(result.sources.map((source) => source.url)).toEqual(
      expect.arrayContaining([
        'https://www.tsmc.com/english',
        'https://www.tsmc.com/english/news',
        'https://en.wikipedia.org/wiki/TSMC',
      ])
    );
    expect(result.rewrittenQueries).toEqual(
      expect.arrayContaining(['TSMC official site', 'TSMC investor relations', 'TSMC newsroom press release'])
    );
  });

  it('backfills entity brief with official seeds for common global organizations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html><body><main id="search-page"><div id="results"></div></main></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'WHO를 요약해줘',
      rewrittenQueries: ['WHO를 요약해줘'],
      maxItems: 4,
      profile: 'entity_brief',
      sourcePolicy: 'official_first',
    });

    expect(result.sources.map((source) => source.url)).toEqual(
      expect.arrayContaining([
        'https://www.who.int/',
        'https://www.who.int/news',
        'https://en.wikipedia.org/wiki/World_Health_Organization',
      ])
    );
    expect(result.rewrittenQueries).toEqual(
      expect.arrayContaining(['WHO official site', 'WHO investor relations', 'WHO newsroom press release'])
    );
  });

  it('filters low-value community and how-to domains for entity briefs', async () => {
    const braveHtml = `
      <main id="search-page">
        <div id="results">
          <div class="snippet">
            <a href="https://jingyan.baidu.com/article/e9fb46e1f4b9fe3421f7668d.html" target="_self">
              <div class="title">NVIDIA control panel guide</div>
            </a>
            <div class="content">Community how-to article with weak company relevance.</div>
          </div>
          <div class="snippet">
            <a href="https://forums.geforce.com/default/topic/123/" target="_self">
              <div class="title">NVIDIA GeForce Forums</div>
            </a>
            <div class="content">Community discussion thread.</div>
          </div>
          <div class="snippet">
            <a href="https://nvidianews.nvidia.com/" target="_self">
              <div class="title">NVIDIA newsroom</div>
            </a>
            <div class="content">Official NVIDIA newsroom and announcements.</div>
          </div>
        </div>
      </main>
    `;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(braveHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'NVIDIA를 요약해줘',
      rewrittenQueries: ['NVIDIA를 요약해줘'],
      maxItems: 4,
      profile: 'entity_brief',
      sourcePolicy: 'official_first',
    });

    expect(result.sources.map((source) => source.url)).not.toContain('https://jingyan.baidu.com/article/e9fb46e1f4b9fe3421f7668d.html');
    expect(result.sources.map((source) => source.url)).not.toContain('https://forums.geforce.com/default/topic/123');
    expect(result.sources.some((source) => source.domain.includes('nvidia.com'))).toBe(true);
  });

  it('filters ambiguous acronym noise for entity briefs when a focused official source exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `
          <main id="search-page">
            <div id="results">
              <div class="snippet">
                <a href="https://www.apple.com/who-we-are/" target="_self">
                  <div class="title">Who we are at Apple</div>
                </a>
                <div class="content">Generic company page unrelated to the World Health Organization.</div>
              </div>
              <div class="snippet">
                <a href="https://www.who.int/news" target="_self">
                  <div class="title">WHO news</div>
                </a>
                <div class="content">World Health Organization official updates and statements.</div>
              </div>
            </div>
          </main>
        `,
        {
          status: 200,
          headers: { 'content-type': 'text/html' }
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'WHO를 요약해줘',
      rewrittenQueries: ['WHO를 요약해줘'],
      maxItems: 4,
      profile: 'entity_brief',
      sourcePolicy: 'official_first',
    });

    expect(result.sources.some((source) => source.domain === 'www.apple.com')).toBe(false);
    expect(result.sources.some((source) => source.domain === 'www.who.int')).toBe(true);
  });

  it('backfills comparison research with official vendor docs when general web results are noisy', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('search.brave.com/search')) {
        return new Response(
          `
            <main id="search-page">
              <div id="results">
                <div class="snippet">
                  <a href="https://www.google.com/?hl=ko-kr" target="_self"><div class="title">Google</div></a>
                  <div class="content">Generic navigation page</div>
                </div>
              </div>
            </main>
          `,
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      return new Response('<?xml version="1.0" encoding="UTF-8"?><rss><channel></channel></rss>', {
        status: 200,
        headers: { 'content-type': 'application/xml' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'Gemini와 OpenAI 비교해줘',
      rewrittenQueries: ['Gemini와 OpenAI 비교해줘'],
      maxItems: 4,
      profile: 'comparison_research',
      sourcePolicy: 'topic_media',
    });

    expect(result.sources.map((source) => source.domain)).toContain('ai.google.dev');
    expect(result.sources.map((source) => source.domain)).toContain('platform.openai.com');
  });

  it('backfills policy regulation with official sources when general web results are junk', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(
        `
          <main id="search-page">
            <div id="results">
              <div class="snippet">
                <a href="https://eu.forums.blizzard.com/en/wow/t/thunderstrike-eu-anniversary-discord-server/600281" target="_self">
                  <div class="title">Thunderstrike - EU Anniversary Discord Server</div>
                </a>
                <div class="content">Forum chatter unrelated to law.</div>
              </div>
            </div>
          </main>
        `,
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'EU AI Act 최근 변화를 정리해줘',
      rewrittenQueries: ['EU AI Act 최근 변화를 정리해줘'],
      maxItems: 4,
      profile: 'policy_regulation',
      sourcePolicy: 'official_first',
    });

    expect(result.sources.map((source) => source.domain)).toContain('digital-strategy.ec.europa.eu');
    expect(result.sources.map((source) => source.domain)).toContain('eur-lex.europa.eu');
  });

  it('prefers github repository seeds for repo research when search results are low value', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('api.github.com/search/repositories')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                full_name: 'openai/codex',
                html_url: 'https://github.com/openai/codex',
                description: 'Lightweight coding agent that runs in your terminal',
                updated_at: '2026-03-07T18:41:33Z'
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(
        `
          <main id="search-page">
            <div id="results">
              <div class="snippet">
                <a href="https://www.zhihu.com/question/1999888901490304692" target="_self">
                  <div class="title">OpenAI 发布基于 GPT-5.2 的Prism</div>
                </a>
                <div class="content">Generic social chatter.</div>
              </div>
            </div>
          </main>
        `,
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'openai codex repo 조사해줘',
      rewrittenQueries: ['openai codex repo 조사해줘'],
      maxItems: 4,
      profile: 'repo_research',
      sourcePolicy: 'repo_first',
    });

    expect(result.sources.map((source) => source.url)).toContain('https://github.com/openai/codex');
    expect(result.sources.map((source) => source.url)).toContain('https://github.com/openai/codex/releases');
  });

  it('prioritizes multiple authority domains for market research', async () => {
    const braveHtml = `
      <main id="search-page">
        <div id="results">
          <div class="snippet">
            <a href="https://www.reuters.com/markets/us/ai-infrastructure-demand" target="_self">
              <div class="title">AI infrastructure demand lifts data-center spending outlook</div>
            </a>
            <div class="content">Reuters coverage on data-center capex and infrastructure demand.</div>
          </div>
          <div class="snippet">
            <a href="https://www.ft.com/content/ai-infrastructure-supply-chain" target="_self">
              <div class="title">AI infrastructure supply chain tightens as hyperscalers expand</div>
            </a>
            <div class="content">FT covers semiconductor supply and enterprise investment.</div>
          </div>
          <div class="snippet">
            <a href="https://www.federalreserve.gov/newsevents/speech/ai-productivity.htm" target="_self">
              <div class="title">Federal Reserve remarks on AI productivity and investment</div>
            </a>
            <div class="content">Official remarks on productivity, investment, and macro outlook.</div>
          </div>
          <div class="snippet">
            <a href="https://randomblog.example.com/ai-hot-takes" target="_self">
              <div class="title">Random hot takes on AI investing</div>
            </a>
            <div class="content">Speculative commentary with weak sourcing.</div>
          </div>
        </div>
      </main>
    `;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(braveHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'AI 인프라 시장 동향을 알려줘',
      rewrittenQueries: ['AI 인프라 시장 동향을 알려줘'],
      maxItems: 4,
      profile: 'market_research',
      sourcePolicy: 'market_authority',
    });

    expect(result.sources.map((source) => source.domain)).toEqual(
      expect.arrayContaining(['www.reuters.com', 'www.ft.com', 'www.federalreserve.gov'])
    );
    expect(result.sources.map((source) => source.domain)).not.toContain('randomblog.example.com');
    expect(fetchMock.mock.calls.some((call) => decodeURIComponent(String(call[0])).includes('site:reuters.com'))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => decodeURIComponent(String(call[0])).includes('site:federalreserve.gov'))).toBe(true);
  });

  it('backfills market research with authority seeds when search results are empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html><body><main id="search-page"><div id="results"></div></main></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'AI 인프라 시장 동향을 알려줘',
      rewrittenQueries: ['AI 인프라 시장 동향을 알려줘'],
      maxItems: 4,
      profile: 'market_research',
      sourcePolicy: 'market_authority',
    });

    expect(result.sources.map((source) => source.domain)).toEqual(
      expect.arrayContaining(['investor.nvidia.com', 'ir.aboutamazon.com', 'www.federalreserve.gov', 'www.ecb.europa.eu'])
    );
  });

  it('adds sector-specific IR seeds for AI infrastructure market research', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html><body><main id="search-page"><div id="results"></div></main></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'AI 인프라 시장 동향을 알려줘',
      rewrittenQueries: ['AI 인프라 시장 동향을 알려줘'],
      maxItems: 6,
      profile: 'market_research',
      sourcePolicy: 'market_authority',
    });

    expect(result.sources.map((source) => source.url)).toEqual(
      expect.arrayContaining([
        'https://investor.nvidia.com/',
        'https://ir.aboutamazon.com/quarterly-results/default.aspx',
      ])
    );
    expect(result.sources[0]?.url).toBe('https://investor.nvidia.com/');
    expect(result.sources.map((source) => source.domain)).toEqual(
      expect.arrayContaining(['www.federalreserve.gov', 'www.ecb.europa.eu'])
    );
  });

  it('filters google-news aggregator links and weak local noise for market research', async () => {
    const braveHtml = `
      <main id="search-page">
        <div id="results">
          <div class="snippet">
            <a href="https://news.google.com/articles/abc123" target="_self">
              <div class="title">지역 매체가 보는 AI 인프라 전망</div>
            </a>
            <div class="content">지역 매체 종합 기사.</div>
          </div>
          <div class="snippet">
            <a href="https://www.reuters.com/markets/us/ai-infrastructure-demand" target="_self">
              <div class="title">AI infrastructure demand lifts data-center spending outlook</div>
            </a>
            <div class="content">Reuters coverage on data-center capex and infrastructure demand.</div>
          </div>
          <div class="snippet">
            <a href="https://www.ft.com/content/ai-infrastructure-supply-chain" target="_self">
              <div class="title">AI infrastructure supply chain tightens as hyperscalers expand</div>
            </a>
            <div class="content">FT covers semiconductor supply and enterprise investment.</div>
          </div>
          <div class="snippet">
            <a href="https://www.federalreserve.gov/newsevents/speech/ai-productivity.htm" target="_self">
              <div class="title">Federal Reserve remarks on AI productivity and investment</div>
            </a>
            <div class="content">Official remarks on productivity, investment, and macro outlook.</div>
          </div>
        </div>
      </main>
    `;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(braveHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrieveWebEvidence({
      prompt: 'AI 인프라 시장 동향을 알려줘',
      rewrittenQueries: ['AI 인프라 시장 동향을 알려줘'],
      maxItems: 4,
      profile: 'market_research',
      sourcePolicy: 'market_authority',
    });

    expect(result.sources.map((source) => source.domain)).not.toContain('news.google.com');
    expect(result.sources.map((source) => source.domain)).toEqual(
      expect.arrayContaining(['www.reuters.com', 'www.ft.com', 'www.federalreserve.gov'])
    );
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
            significance: 0.9,
            sourceFit: 0.9,
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
