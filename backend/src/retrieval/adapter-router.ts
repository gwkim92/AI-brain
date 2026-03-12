import { execFileSync } from 'node:child_process';

import { scoreRetrievalItem, type RetrievalRankingScores } from './ranker';
import { detectBriefingTopic, type BriefingTopic, type NewsBriefingQualityProfile } from './news-briefing';
import {
  extractEntitySubject,
  isNewsLikeResearchProfile,
  type ResearchProfile,
  type ResearchProfileSourcePolicy
} from './research-profile';

type GoogleNewsRssItem = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};

export type RetrievalEvidenceItem = {
  sourceId: string;
  title: string;
  url: string;
  domain: string;
  publishedAt?: string;
  retrievedAt: string;
  snippet: string;
  scores: RetrievalRankingScores;
};

export type RetrievalEvidencePack = {
  query: string;
  rewrittenQueries: string[];
  items: RetrievalEvidenceItem[];
  sources: Array<{
    url: string;
    title: string;
    domain: string;
    snippet?: string;
    publishedAt?: string;
  }>;
};

export type RetrieveWebEvidenceInput = {
  prompt: string;
  rewrittenQueries?: string[];
  maxItems?: number;
  perQueryLimit?: number;
  profile?: ResearchProfile;
  sourcePolicy?: ResearchProfileSourcePolicy;
};

const RSS_FETCH_TIMEOUT_MS = 4500;
const GOOGLE_NEWS_SEARCH_URL = 'https://news.google.com/rss/search';
const BING_SEARCH_RSS_URL = 'https://www.bing.com/search';
const BRAVE_SEARCH_URL = 'https://search.brave.com/search';
const GITHUB_SEARCH_API_URL = 'https://api.github.com/search/repositories';
const GOOGLE_NEWS_TOP_FEEDS = [
  'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko',
  'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en'
];
const CURATED_NEWS_FALLBACK_FEEDS = [
  'https://feeds.bbci.co.uk/news/rss.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
  'https://www.aljazeera.com/xml/rss/all.xml',
  'https://www.yna.co.kr/rss/news.xml',
  'https://feeds.reuters.com/Reuters/worldNews',
  'https://feeds.reuters.com/reuters/businessNews'
];
const PREFERRED_MAJOR_PUBLISHERS = [
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'nytimes.com',
  'aljazeera.com',
  'ft.com',
  'bloomberg.com',
  'wsj.com',
  'theguardian.com'
];
const LOCAL_POLITICS_SIGNAL_PATTERN =
  /(지방선거|공천|도당|시의회|도의회|구청장|군수|국민의힘|국힘|민주당|윤어게인|한동훈|이재명|윤석열|부산\s*찾은|전북도당)/iu;
const LOW_VALUE_MAJOR_SIGNAL_PATTERN =
  /(연예|가십|rumor|celebrity|scandal|sex trafficking|trafficking|investigation|murder|trial|criminal|crime|부동산|오피스텔|매물)/iu;
const OFFICIAL_DOMAIN_PATTERN =
  /(\.gov\b|\.go\.kr\b|europa\.eu\b|sec\.gov\b|federalreserve\.gov\b|ecb\.europa\.eu\b|whitehouse\.gov\b|gov\.uk\b|who\.int\b|imf\.org\b|worldbank\.org\b)/iu;
const REPO_DOMAIN_PATTERN = /(github\.com|gitlab\.com|readthedocs\.io|docs\.[^/]+|npmjs\.com|pypi\.org|crates\.io)/iu;
const MARKET_AUTHORITY_DOMAIN_PATTERN =
  /(reuters\.com|bloomberg\.com|ft\.com|wsj\.com|imf\.org|worldbank\.org|federalreserve\.gov|ecb\.europa\.eu)/iu;
const MARKET_SUPPORTING_MEDIA_DOMAIN_PATTERN =
  /(reuters\.com|bloomberg\.com|ft\.com|wsj\.com|apnews\.com|bbc\.com|nytimes\.com|economist\.com|cnbc\.com|marketwatch\.com)/iu;
const LOW_VALUE_GENERAL_WEB_DOMAIN_PATTERN =
  /(youtube\.com|youtu\.be|reddit\.com|zhihu\.com|quora\.com|astrologyanswers\.com|pinterest\.com)/iu;
const FORUM_LIKE_DOMAIN_PATTERN = /(forums?\.)/iu;
const GENERIC_NAVIGATION_URL_PATTERN =
  /(https?:\/\/(?:www\.)?google\.[^/]+\/?(?:\?|$)|https?:\/\/about\.google\/?(?:intl\/[^/?#]+)?$|https?:\/\/apps\.apple\.com\/[^?#]+google-chrome)/iu;
const GENERIC_NAVIGATION_TITLE_PATTERN = /^(google(?:\s+고급검색)?|google 소개.*)$/iu;
const GENERIC_COMPARISON_HOME_DOMAIN_PATTERN = /^(about\.google|(?:www\.)?google\.[^.]+(?:\.[^.]+)?)$/iu;
const LOW_VALUE_COMPARISON_DOMAIN_PATTERN = /^(?:images\.google\.com|gemini\.google)$/iu;
const GENERIC_MARKET_LANDING_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:reuters\.com\/(?:technology|markets)\/?$|ft\.com\/(?:technology|markets)\/?$|bloomberg\.com\/(?:technology|markets)\/?$)/iu;
const LOW_VALUE_MARKET_SIGNAL_PATTERN = /(hot takes|speculative|opinion|rumor|commentary|price target only|analyst chatter)/iu;
const LOW_VALUE_ENTITY_DOMAIN_PATTERN =
  /(^|\.)baidu\.com$|(^|\.)zhidao\.baidu\.com$|(^|\.)jingyan\.baidu\.com$|(^|\.)forums?\.[^/]+$|(^|\.)community\.[^/]+$/iu;
const RELEASE_SIGNAL_PATTERN = /(release|changelog|version|tag|배포|릴리즈|출시)/iu;
const ISSUE_SIGNAL_PATTERN = /(issue|pull request|bug|ticket|이슈|pr)/iu;
const COMPARISON_AXIS_SEED_QUERIES = [
  'pricing access cost subscription',
  'api sdk developer integration',
  'enterprise security governance',
  'model capability performance'
] as const;
const COMPARISON_DOC_SEEDS: Record<string, Array<{ url: string; title: string; snippet: string }>> = {
  Gemini: [
    {
      url: 'https://ai.google.dev/gemini-api/docs',
      title: 'Gemini API documentation',
      snippet: 'Official Gemini API documentation, models, and integration guides.'
    },
    {
      url: 'https://ai.google.dev/gemini-api/docs/pricing',
      title: 'Gemini API pricing',
      snippet: 'Official Gemini API pricing, rate limits, and access tiers.'
    },
    {
      url: 'https://cloud.google.com/vertex-ai/generative-ai/docs/overview',
      title: 'Vertex AI generative AI overview',
      snippet: 'Google enterprise deployment and governance overview for Gemini and Vertex AI.'
    },
    {
      url: 'https://ai.google.dev/gemini-api/docs/openai',
      title: 'OpenAI compatibility | Gemini API',
      snippet: 'Official Gemini API guide for OpenAI client-library compatibility and migration.'
    }
  ],
  OpenAI: [
    {
      url: 'https://platform.openai.com/docs/overview',
      title: 'OpenAI API platform overview',
      snippet: 'Official OpenAI API documentation overview and platform guides.'
    },
    {
      url: 'https://openai.com/api/pricing/',
      title: 'OpenAI API pricing',
      snippet: 'Official OpenAI API pricing, model pricing, and usage details.'
    },
    {
      url: 'https://openai.com/enterprise-privacy/',
      title: 'OpenAI enterprise privacy',
      snippet: 'OpenAI enterprise privacy, security, and governance information.'
    },
    {
      url: 'https://platform.openai.com/docs/api-reference/introduction',
      title: 'OpenAI API reference introduction',
      snippet: 'Official OpenAI API reference and usage patterns.'
    }
  ],
  Claude: [
    {
      url: 'https://docs.anthropic.com/en/docs/welcome',
      title: 'Anthropic Claude documentation',
      snippet: 'Official Claude documentation, prompts, and API guides.'
    }
  ],
  Copilot: [
    {
      url: 'https://docs.github.com/en/copilot',
      title: 'GitHub Copilot documentation',
      snippet: 'Official GitHub Copilot product and configuration documentation.'
    }
  ]
};
const POLICY_SEEDS: Array<{
  match: RegExp;
  sources: Array<{ url: string; title: string; snippet: string }>;
}> = [
  {
    match: /(?:eu\b|유럽|european\s+union).{0,30}ai\s*act|ai\s*act.{0,30}(?:eu\b|유럽|european\s+union)/iu,
    sources: [
      {
        url: 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai',
        title: 'EU regulatory framework for AI',
        snippet:
          'Official European Commission overview of the EU AI Act and implementation framework. The AI Act entered into force on 1 August 2024 and is fully applicable on 2 August 2026, with phased obligations from 2 February 2025 and 2 August 2025.'
      },
      {
        url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
        title: 'Regulation (EU) 2024/1689 (AI Act) - EUR-Lex',
        snippet:
          'Official EUR-Lex text of the EU AI Act with legal scope, entry into force on 1 August 2024, and the core application timetable that runs to 2 August 2026 and 2 August 2027.'
      }
    ]
  }
];

const ENTITY_SEEDS: Array<{
  match: RegExp;
  sources: Array<{ url: string; title: string; snippet: string }>;
}> = [
  {
    match: /\bnvidia\b|엔비디아/iu,
    sources: [
      {
        url: 'https://www.nvidia.com/',
        title: 'NVIDIA official site',
        snippet: 'Official NVIDIA company overview, platforms, and product information.'
      },
      {
        url: 'https://nvidianews.nvidia.com/news/nvidia-expands-blackwell-systems-for-enterprise-and-cloud-build-outs',
        title: 'NVIDIA expands Blackwell systems for enterprise and cloud build-outs',
        snippet: 'Official NVIDIA newsroom update on Blackwell systems, partner expansion, enterprise rollout, and data-center demand.'
      },
      {
        url: 'https://investor.nvidia.com/news-events/press-releases/detail/331/nvidia-announces-financial-results',
        title: 'NVIDIA announces financial results',
        snippet: 'Official NVIDIA IR update covering quarterly results, AI demand, data-center revenue, and capital investment.'
      }
    ]
  },
  {
    match: /\btsmc\b|대만\s*반도체|taiwan\s*semiconductor/iu,
    sources: [
      {
        url: 'https://www.tsmc.com/english',
        title: 'TSMC official site',
        snippet: 'Official TSMC company overview, technology, and investor information.'
      },
      {
        url: 'https://www.tsmc.com/english/news',
        title: 'TSMC news',
        snippet: 'Official TSMC news and corporate updates.'
      },
      {
        url: 'https://en.wikipedia.org/wiki/TSMC',
        title: 'TSMC overview',
        snippet: 'Reference background for TSMC business, history, and operations.'
      }
    ]
  },
  {
    match: /\bwho\b|world\s*health\s*organization|세계\s*보건\s*기구/iu,
    sources: [
      {
        url: 'https://www.who.int/',
        title: 'World Health Organization',
        snippet: 'Official WHO organizational overview, health priorities, and global programs.'
      },
      {
        url: 'https://www.who.int/news',
        title: 'WHO news',
        snippet: 'Official WHO news, statements, and health emergency updates.'
      },
      {
        url: 'https://en.wikipedia.org/wiki/World_Health_Organization',
        title: 'World Health Organization overview',
        snippet: 'Reference background for the World Health Organization.'
      }
    ]
  }
];

const AI_INFRA_MARKET_SEEDS: Array<{ url: string; title: string; snippet: string }> = [
  {
    url: 'https://investor.nvidia.com/',
    title: 'NVIDIA investor relations',
    snippet: 'Official investor materials covering data-center demand, AI revenue mix, capital expenditure posture, and platform expansion signals.'
  },
  {
    url: 'https://www.microsoft.com/en-us/Investor/earnings/FY-2025-Q2/press-release-webcast',
    title: 'Microsoft earnings and capital expenditure update',
    snippet: 'Official earnings and capital expenditure commentary tied to Azure capacity, infrastructure build-out, and AI demand.'
  },
  {
    url: 'https://ir.aboutamazon.com/quarterly-results/default.aspx',
    title: 'Amazon quarterly results and AWS demand',
    snippet: 'Official quarterly materials covering AWS demand, infrastructure investment, and fulfillment of AI-related capacity needs.'
  },
  {
    url: 'https://www.tsmc.com/english/news',
    title: 'TSMC news and capacity updates',
    snippet: 'Official foundry updates touching advanced packaging, semiconductor supply, and capacity expansion tied to AI demand.'
  },
];

type WorkspaceRepoContext = {
  repoName: string;
  repoSlug?: string;
  repoUrl?: string;
};

let workspaceRepoContextCache: WorkspaceRepoContext | null | undefined;

function sshRemoteToHttps(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const sshMatch = /^git@([^:]+):(.+?)(?:\.git)?$/u.exec(trimmed);
  if (sshMatch?.[1] && sshMatch[2]) {
    return `https://${sshMatch[1]}/${sshMatch[2].replace(/\.git$/u, '')}`;
  }
  if (/^https?:\/\//iu.test(trimmed)) {
    return trimmed.replace(/\.git$/iu, '');
  }
  return null;
}

function getWorkspaceRepoContext(): WorkspaceRepoContext | null {
  if (workspaceRepoContextCache !== undefined) {
    return workspaceRepoContextCache;
  }
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!repoRoot) {
      workspaceRepoContextCache = null;
      return workspaceRepoContextCache;
    }
    const repoName = repoRoot.split('/').filter(Boolean).pop() ?? 'repository';
    let repoSlug: string | undefined;
    let repoUrl: string | undefined;
    try {
      const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      repoUrl = sshRemoteToHttps(remote) ?? undefined;
      if (repoUrl) {
        const slugMatch = /^https?:\/\/[^/]+\/(.+)$/iu.exec(repoUrl);
        repoSlug = slugMatch?.[1];
      }
    } catch {
      repoSlug = undefined;
      repoUrl = undefined;
    }
    workspaceRepoContextCache = { repoName, repoSlug, repoUrl };
    return workspaceRepoContextCache;
  } catch {
    workspaceRepoContextCache = null;
    return workspaceRepoContextCache;
  }
}

function isCurrentWorkspaceRepoPrompt(prompt: string): boolean {
  return /(이\s*(레포|리포지토리|저장소)|현재\s*(레포|리포지토리|저장소)|this\s+repo|current\s+repo)/iu.test(prompt);
}

function normalizeRepoSearchQuery(prompt: string): string {
  const workspaceRepo = isCurrentWorkspaceRepoPrompt(prompt) ? getWorkspaceRepoContext() : null;
  if (workspaceRepo && (workspaceRepo.repoSlug || workspaceRepo.repoName)) {
    return workspaceRepo.repoSlug ?? workspaceRepo.repoName;
  }
  const ownerRepoMatch = prompt.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/u);
  if (ownerRepoMatch?.[1]) {
    return ownerRepoMatch[1];
  }
  const normalized = prompt
    .replace(/(조사해줘|정리해줘|설명해줘|알려줘|브리프|요약해줘|overview|summary|summarize|작업\s*계획|계획|승인|실행|준비|세운\s*뒤|까지|검토해줘|만들어줘)/giu, ' ')
    .replace(/(repo|repository|github|gitlab|readme|release|releases|issue|issues|pull request|codebase|레포|리포지토리|깃허브|코드베이스|저장소|이\s*레포|현재\s*레포)/giu, ' ')
    .replace(/[^\p{L}\p{N}\s/-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (normalized) {
    return normalized;
  }
  return workspaceRepo?.repoSlug ?? workspaceRepo?.repoName ?? prompt;
}

function isAiInfraMarketPrompt(value: string): boolean {
  return /(ai|인공지능|infra|infrastructure|데이터센터|data center|gpu|반도체|semiconductor|hyperscaler|cloud)/iu.test(value);
}

type RetrievalBackend = 'news_rss' | 'general_web_rss';

function inferRetrievalProfile(prompt: string): NewsBriefingQualityProfile {
  const broadSignal =
    /(세계|글로벌|world|global|headline|headlines|헤드라인)/iu.test(prompt) ||
    /(주요\s*뉴스|뉴스\s*요약|major\s+news|top\s+news|top\s+headlines|main\s+news)/iu.test(prompt);
  const warSignal = /(전쟁|war|conflict|안보|security|미사일|공습|strike|attack)/iu.test(prompt);
  if (broadSignal && warSignal) return 'major_with_war';
  if (broadSignal) return 'major';
  return 'standard';
}

function mapResearchProfileToNewsProfile(profile: ResearchProfile | undefined, prompt: string): NewsBriefingQualityProfile {
  if (!profile) {
    return inferRetrievalProfile(prompt);
  }
  if (profile === 'broad_news') return 'major';
  if (profile === 'topic_news' && /(전쟁|war|conflict|안보|security|공습|attack|strike)/iu.test(prompt)) {
    return 'major_with_war';
  }
  return 'standard';
}

function selectRetrievalBackend(profile: ResearchProfile | undefined): RetrievalBackend {
  if (!profile || isNewsLikeResearchProfile(profile)) {
    return 'news_rss';
  }
  return 'general_web_rss';
}

function extractComparisonEntities(prompt: string): string[] {
  const vsMatch = prompt.match(/(.+?)\s+\bvs\b\s+(.+)/iu);
  if (vsMatch?.[1] && vsMatch[2]) {
    return [vsMatch[1].trim(), vsMatch[2].trim()].filter(Boolean).slice(0, 2);
  }
  const compareMatch = prompt.match(/(.+?)와\s+(.+?)\s+(비교|차이|장단점)/u);
  if (compareMatch?.[1] && compareMatch[2]) {
    return [compareMatch[1].trim(), compareMatch[2].trim()].filter(Boolean).slice(0, 2);
  }
  return [];
}

function normalizeComparisonEntity(entity: string): string {
  const trimmed = entity.trim();
  if (/^gemini$/iu.test(trimmed)) return 'Gemini';
  if (/^openai$/iu.test(trimmed)) return 'OpenAI';
  if (/^claude$/iu.test(trimmed)) return 'Claude';
  if (/^copilot$/iu.test(trimmed)) return 'Copilot';
  return trimmed;
}

function buildGeneralWebQueries(baseQueries: string[], profile: ResearchProfile | undefined): string[] {
  if (!profile) {
    return baseQueries;
  }

  const expanded = new Set<string>();
  const normalizeComparisonQueryEntity = (entity: string): string => {
    const normalizedEntity = normalizeComparisonEntity(entity);
    if (normalizedEntity === 'Gemini') return 'Google Gemini AI';
    if (normalizedEntity === 'OpenAI') return 'OpenAI';
    if (normalizedEntity === 'Claude') return 'Anthropic Claude';
    if (normalizedEntity === 'Copilot') return 'GitHub Copilot';
    return normalizedEntity;
  };

  for (const query of baseQueries) {
    const normalized = query.trim();
    if (!normalized) {
      continue;
    }
    expanded.add(normalized);
    switch (profile) {
      case 'entity_brief': {
        const subject = extractEntitySubject(normalized) ?? normalized;
        expanded.add(`${subject} official site`);
        expanded.add(`${subject} investor relations`);
        expanded.add(`${subject} newsroom press release`);
        expanded.add(`${subject} wikipedia overview`);
        expanded.add(`${subject} company profile`);
        expanded.add(`${subject} latest updates`);
        break;
      }
      case 'comparison_research': {
        const entities = extractComparisonEntities(normalized);
        if (entities.length >= 2) {
          const left = normalizeComparisonQueryEntity(entities[0]);
          const right = normalizeComparisonQueryEntity(entities[1]);
          expanded.add(`${left} ${right} AI comparison official documentation`);
          expanded.add(`${left} ${right} pricing features compare`);
          expanded.add(`${left} vs ${right} model comparison`);
          for (const axisQuery of COMPARISON_AXIS_SEED_QUERIES) {
            expanded.add(`${left} vs ${right} ${axisQuery}`);
          }
        } else {
          expanded.add(`${normalized} official documentation compare`);
        }
        break;
      }
      case 'repo_research':
        expanded.add(`${normalized} github readme releases issues`);
        expanded.add(`${normalized} docs changelog`);
        expanded.add(`${normalized} package registry documentation`);
        expanded.add(`${normalized} site:github.com`);
        expanded.add(`${normalized} site:npmjs.com documentation`);
        expanded.add(`${normalized} site:readthedocs.io docs`);
        break;
      case 'market_research':
        expanded.add(`${normalized} Reuters Bloomberg FT`);
        expanded.add(`${normalized} official market release central bank`);
        expanded.add(`${normalized} industry outlook official report`);
        expanded.add(`${normalized} site:reuters.com`);
        expanded.add(`${normalized} site:bloomberg.com`);
        expanded.add(`${normalized} site:ft.com`);
        expanded.add(`${normalized} site:wsj.com`);
        expanded.add(`${normalized} site:federalreserve.gov`);
        expanded.add(`${normalized} site:ecb.europa.eu`);
        if (/(ai|인공지능|infra|infrastructure|데이터센터|data center|gpu|반도체|semiconductor|hyperscaler|cloud)/iu.test(normalized)) {
          expanded.add('AI infrastructure market demand capex');
          expanded.add('AI infrastructure data center spending demand');
          expanded.add('AI infrastructure semiconductor supply chain');
          expanded.add('AI infrastructure market demand capex site:reuters.com');
          expanded.add('AI infrastructure supply chain site:ft.com');
          expanded.add('AI infrastructure investment site:bloomberg.com');
        }
        break;
      case 'policy_regulation':
        if (/ai\s*act/iu.test(normalized) && /(?:eu\b|유럽|european\s+union)/iu.test(normalized)) {
          expanded.add(`"EU AI Act" site:eur-lex.europa.eu`);
          expanded.add(`"EU AI Act" site:digital-strategy.ec.europa.eu`);
          expanded.add(`"EU AI Act" official guidance compliance`);
        }
        expanded.add(`${normalized} site:gov official guidance`);
        expanded.add(`${normalized} official text compliance guidance`);
        break;
      default:
        break;
    }
  }

  return Array.from(expanded).slice(0, 12);
}

function isPreferredMajorPublisher(domain: string): boolean {
  return PREFERRED_MAJOR_PUBLISHERS.some((publisher) => domain === publisher || domain.endsWith(`.${publisher}`));
}

function countNonSecurityTopics(topicCounts: Map<BriefingTopic, number>): number {
  let total = 0;
  for (const [topic, count] of topicCounts.entries()) {
    if (count <= 0) continue;
    if (topic !== 'security' && topic !== 'general') {
      total += 1;
    }
  }
  return total;
}

function selectBalancedRetrievalItems(
  ranked: RetrievalEvidenceItem[],
  maxItems: number,
  profile: NewsBriefingQualityProfile
): RetrievalEvidenceItem[] {
  if (profile === 'standard') {
    const nonGoogleRanked = ranked.filter((item) => !isGoogleNewsDomain(item.domain));
    const googleRanked = ranked.filter((item) => isGoogleNewsDomain(item.domain));
    const preferredNonGoogleCount = Math.min(maxItems, Math.max(3, Math.floor(maxItems * 0.75)));
    const selected: RetrievalEvidenceItem[] = [];
    for (const item of nonGoogleRanked) {
      selected.push(item);
      if (selected.length >= preferredNonGoogleCount) {
        break;
      }
    }
    if (selected.length < maxItems) {
      for (const item of [...nonGoogleRanked.slice(selected.length), ...googleRanked]) {
        if (selected.some((row) => row.url === item.url)) {
          continue;
        }
        selected.push(item);
        if (selected.length >= maxItems) {
          break;
        }
      }
    }
    return selected;
  }

  const selected: RetrievalEvidenceItem[] = [];
  const selectedUrls = new Set<string>();
  const domainCounts = new Map<string, number>();
  const topicCounts = new Map<BriefingTopic, number>();
  const availableTopics = new Set(ranked.map((item) => detectBriefingTopic(`${item.title} ${item.snippet} ${item.domain}`)));
  const targetTopicCoverage = Math.min(profile === 'major' ? 4 : 3, Math.max(3, availableTopics.size), maxItems);
  const targetNonSecurityCoverage = Math.min(profile === 'major' ? 3 : 2, maxItems);
  const securityCap = profile === 'major' ? 1 : 2;
  const preferredMajorPublisherTarget = Math.min(3, maxItems);
  const highSignificanceTarget = Math.min(profile === 'major' ? 3 : 2, maxItems);
  const preferredTopicOrder: BriefingTopic[] = ['policy', 'economy', 'technology'];

  const countPreferredMajorPublishers = () =>
    selected.filter((item) => !isGoogleNewsDomain(item.domain) && isPreferredMajorPublisher(item.domain)).length;
  const countHighSignificance = () => selected.filter((item) => item.scores.significance >= 0.72).length;

  const pushCandidate = (item: RetrievalEvidenceItem | undefined | null) => {
    if (!item || selectedUrls.has(item.url) || selected.length >= Math.min(maxItems, ranked.length)) {
      return false;
    }
    const topic = detectBriefingTopic(`${item.title} ${item.snippet} ${item.domain}`);
    const domainCount = domainCounts.get(item.domain) ?? 0;
    const topicCount = topicCounts.get(topic) ?? 0;
    if (domainCount >= 1 && domainCounts.size < Math.min(4, maxItems)) {
      return false;
    }
    if (domainCount >= 2) {
      return false;
    }
    if (topicCount >= 2) {
      return false;
    }
    if (topic === 'security' && topicCount >= securityCap) {
      return false;
    }
    selected.push(item);
    selectedUrls.add(item.url);
    domainCounts.set(item.domain, domainCount + 1);
    topicCounts.set(topic, topicCount + 1);
    return true;
  };

  const highestByPredicate = (predicate: (item: RetrievalEvidenceItem) => boolean) =>
    ranked.find((item) => predicate(item) && !selectedUrls.has(item.url));

  for (const topic of preferredTopicOrder) {
    pushCandidate(
      highestByPredicate(
        (item) =>
          detectBriefingTopic(`${item.title} ${item.snippet} ${item.domain}`) === topic &&
          !isGoogleNewsDomain(item.domain) &&
          isPreferredMajorPublisher(item.domain) &&
          item.scores.significance >= 0.62
      )
    ) ||
      pushCandidate(
        highestByPredicate(
          (item) =>
            detectBriefingTopic(`${item.title} ${item.snippet} ${item.domain}`) === topic &&
            !isGoogleNewsDomain(item.domain) &&
            item.scores.significance >= 0.6
        )
      );
  }
  if (profile === 'major_with_war') {
    pushCandidate(
      highestByPredicate(
        (item) =>
          detectBriefingTopic(`${item.title} ${item.snippet} ${item.domain}`) === 'security' &&
          !isGoogleNewsDomain(item.domain) &&
          item.scores.significance >= 0.62
      )
    );
  }
  while (countPreferredMajorPublishers() < preferredMajorPublisherTarget) {
    if (
      !pushCandidate(
        highestByPredicate(
          (item) =>
            !isGoogleNewsDomain(item.domain) &&
            isPreferredMajorPublisher(item.domain) &&
            item.scores.significance >= 0.62
        )
      )
    ) {
      break;
    }
  }

  while (selected.length < Math.min(maxItems, ranked.length)) {
    let best: RetrievalEvidenceItem | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const item of ranked) {
      if (selectedUrls.has(item.url)) continue;

      const topic = detectBriefingTopic(`${item.title} ${item.snippet} ${item.domain}`);
      const domainCount = domainCounts.get(item.domain) ?? 0;
      const topicCount = topicCounts.get(topic) ?? 0;
      if (domainCount >= 1 && domainCounts.size < Math.min(4, maxItems)) continue;
      if (domainCount >= 2) continue;
      if (topicCount >= 2) continue;
      if (topic === 'security' && topicCount >= securityCap) continue;

      const nonSecurityCount = countNonSecurityTopics(topicCounts);
      let candidateScore = item.scores.final;
      if (!isGoogleNewsDomain(item.domain)) candidateScore += 0.16;
      if (isPreferredMajorPublisher(item.domain)) candidateScore += 0.12;
      if (countPreferredMajorPublishers() < preferredMajorPublisherTarget && isPreferredMajorPublisher(item.domain) && !isGoogleNewsDomain(item.domain)) {
        candidateScore += 0.18;
      }
      if (countHighSignificance() < highSignificanceTarget && item.scores.significance >= 0.72) {
        candidateScore += 0.18;
      }
      if (item.scores.significance < 0.52) {
        candidateScore -= 0.24;
      }
      if (domainCount === 0 && domainCounts.size < Math.min(3, maxItems)) candidateScore += 0.18;
      if (topicCount === 0 && topicCounts.size < targetTopicCoverage) candidateScore += 0.22;
      if (topic !== 'security' && topic !== 'general' && topicCount === 0 && nonSecurityCount < targetNonSecurityCoverage) {
        candidateScore += 0.2;
      }
      if (isGoogleNewsDomain(item.domain)) {
        candidateScore -= selected.length < Math.max(3, maxItems - 1) ? 0.42 : 0.28;
      }
      if (LOCAL_POLITICS_SIGNAL_PATTERN.test(`${item.title} ${item.snippet}`)) {
        candidateScore -= 0.25;
      }
      if (LOW_VALUE_MAJOR_SIGNAL_PATTERN.test(`${item.title} ${item.snippet}`)) {
        candidateScore -= 0.28;
      }
      if (topic === 'general' && topicCounts.size < targetTopicCoverage) candidateScore -= 0.08;
      if (topic === 'security' && nonSecurityCount < targetNonSecurityCoverage && (topicCounts.get('security') ?? 0) >= Math.max(1, securityCap - 1)) {
        candidateScore -= 0.22;
      }

      if (candidateScore > bestScore) {
        best = item;
        bestScore = candidateScore;
      }
    }

    if (!best) break;
    if (bestScore < (profile === 'major' ? 0.56 : 0.52) && selected.length >= 3) {
      break;
    }

    const topic = detectBriefingTopic(`${best.title} ${best.snippet} ${best.domain}`);
    selected.push(best);
    selectedUrls.add(best.url);
    domainCounts.set(best.domain, (domainCounts.get(best.domain) ?? 0) + 1);
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }

  return selected;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>');
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[(.*)\]\]>$/isu, '$1').trim();
}

function extractTag(item: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'iu');
  const match = pattern.exec(item);
  if (!match?.[1]) {
    return null;
  }
  return decodeXmlEntities(stripCdata(match[1].trim()));
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

function toDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

function isGoogleNewsDomain(domain: string): boolean {
  return domain === 'news.google.com' || domain.endsWith('.google.com');
}

function extractAnchorUrls(html: string): string[] {
  const results: string[] = [];
  const pattern = /<a[^>]+href=["']([^"']+)["']/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const href = decodeXmlEntities((match[1] ?? '').trim());
    if (href.length > 0) {
      results.push(href);
    }
  }
  return results;
}

function resolvePreferredUrl(link: string, descriptionHtml: string): string | null {
  const candidates = [link, ...extractAnchorUrls(descriptionHtml)];
  let fallback: string | null = null;
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (!normalized) {
      continue;
    }
    if (!fallback) {
      fallback = normalized;
    }
    const domain = toDomain(normalized);
    if (!isGoogleNewsDomain(domain)) {
      return normalized;
    }
  }
  return fallback;
}

function parseGoogleNewsRss(xml: string): GoogleNewsRssItem[] {
  const items: GoogleNewsRssItem[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/giu;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) !== null) {
    const rawItem = match[1] ?? '';
    const title = extractTag(rawItem, 'title') ?? '';
    const link = extractTag(rawItem, 'link') ?? '';
    const descriptionRaw = extractTag(rawItem, 'description') ?? '';
    const pubDateRaw = extractTag(rawItem, 'pubDate') ?? '';
    const normalizedUrl = resolvePreferredUrl(link, descriptionRaw);
    if (!normalizedUrl) {
      continue;
    }
    const publishedTs = pubDateRaw ? Date.parse(pubDateRaw) : Number.NaN;

    items.push({
      title: title.trim(),
      url: normalizedUrl,
      snippet: descriptionRaw.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim(),
      publishedAt: Number.isFinite(publishedTs) ? new Date(publishedTs).toISOString() : undefined
    });
  }
  return items;
}

function parseSearchRss(xml: string): GoogleNewsRssItem[] {
  return parseGoogleNewsRss(xml);
}

function mergeUniqueItems(items: GoogleNewsRssItem[]): GoogleNewsRssItem[] {
  const merged = new Map<string, GoogleNewsRssItem>();
  for (const item of items) {
    const normalized = normalizeUrl(item.url);
    if (!normalized || merged.has(normalized)) {
      continue;
    }
    merged.set(normalized, { ...item, url: normalized });
  }
  return Array.from(merged.values());
}

function stripHtmlTags(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim());
}

function parseBraveSearchHtml(html: string): GoogleNewsRssItem[] {
  const items: GoogleNewsRssItem[] = [];
  const anchorPattern = /<a[^>]+href="(https:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/giu;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const url = normalizeUrl(match[1] ?? '');
    if (!url) {
      continue;
    }
    const domain = toDomain(url);
    if (
      domain === 'search.brave.com' ||
      domain === 'cdn.search.brave.com' ||
      domain === 'imgs.search.brave.com'
    ) {
      continue;
    }
    const anchorHtml = match[2] ?? '';
    const titleMatch =
      /<div class="title [^"]*"[^>]*>([\s\S]*?)<\/div>/iu.exec(anchorHtml) ??
      /<span[^>]*>([\s\S]*?)<\/span>/iu.exec(anchorHtml);
    const title = stripHtmlTags(titleMatch?.[1] ?? anchorHtml);
    if (!title) {
      continue;
    }
    const nextAnchorIndex = html.indexOf('<a ', match.index + match[0].length);
    const snippetRegion = html.slice(
      match.index + match[0].length,
      nextAnchorIndex >= 0 ? nextAnchorIndex : Math.min(html.length, match.index + match[0].length + 2400)
    );
    const snippetMatch =
      /<div class="content [^"]*"[^>]*>([\s\S]*?)<\/div>/iu.exec(snippetRegion) ??
      /<div class="generic-snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/iu.exec(snippetRegion) ??
      /<p[^>]*>([\s\S]*?)<\/p>/iu.exec(snippetRegion);
    const snippet = stripHtmlTags(snippetMatch?.[1] ?? '');
    items.push({
      title,
      url,
      snippet,
    });
    if (items.length >= 20) {
      break;
    }
  }
  return items;
}

async function fetchGoogleNewsRss(query: string): Promise<GoogleNewsRssItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      q: query,
      hl: 'ko',
      gl: 'KR',
      ceid: 'KR:ko'
    });
    return await fetchRss(`${GOOGLE_NEWS_SEARCH_URL}?${params.toString()}`, controller.signal);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRss(url: string, signal?: AbortSignal): Promise<GoogleNewsRssItem[]> {
  const response = await fetch(url, {
    method: 'GET',
    signal
  });
  if (!response.ok) {
    return [];
  }
  const xml = await response.text();
  return parseSearchRss(xml);
}

async function fetchGoogleNewsTopFeed(url: string): Promise<GoogleNewsRssItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
  try {
    return await fetchRss(url, controller.signal);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCuratedFeed(url: string): Promise<GoogleNewsRssItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
  try {
    return await fetchRss(url, controller.signal);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBingSearchRss(query: string): Promise<GoogleNewsRssItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      format: 'rss',
      q: query,
    });
    return await fetchRss(`${BING_SEARCH_RSS_URL}?${params.toString()}`, controller.signal);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBraveSearchHtml(query: string): Promise<GoogleNewsRssItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      q: query,
      source: 'web',
    });
    const response = await fetch(`${BRAVE_SEARCH_URL}?${params.toString()}`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0',
      },
    });
    if (!response.ok) {
      return [];
    }
    const html = await response.text();
    return parseBraveSearchHtml(html);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGitHubRepositorySeeds(query: string): Promise<GoogleNewsRssItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      q: `${normalizeRepoSearchQuery(query)} in:name,description,readme`,
      per_page: '5',
    });
    const response = await fetch(`${GITHUB_SEARCH_API_URL}?${params.toString()}`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'jarvis-research'
      }
    });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as {
      items?: Array<{ full_name?: string; html_url?: string; description?: string; updated_at?: string }>;
    };
    return (body.items ?? [])
      .slice(0, 4)
      .flatMap((item) => {
        const htmlUrl = normalizeUrl(item.html_url ?? '');
        if (!htmlUrl) {
          return [];
        }
        const title = item.full_name?.trim() || htmlUrl;
        const description = item.description?.trim() || 'GitHub repository overview';
        const publishedAt = item.updated_at ? new Date(item.updated_at).toISOString() : undefined;
        return [
          {
            title: `${title} README overview`,
            url: htmlUrl,
            snippet: `${description} README and project overview`,
            publishedAt
          },
          {
            title: `${title} releases`,
            url: `${htmlUrl}/releases`,
            snippet: `${description} Releases and changelog`,
            publishedAt
          },
          {
            title: `${title} issues`,
            url: `${htmlUrl}/issues`,
            snippet: `${description} Issues and maintenance activity`,
            publishedAt
          }
        ] satisfies GoogleNewsRssItem[];
      });
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function countDomains(items: Iterable<GoogleNewsRssItem>): number {
  return new Set(Array.from(items, (item) => toDomain(item.url))).size;
}

function countNonGoogleItems(items: Iterable<GoogleNewsRssItem>): number {
  let count = 0;
  for (const item of items) {
    if (!isGoogleNewsDomain(toDomain(item.url))) {
      count += 1;
    }
  }
  return count;
}

function isOfficialDomain(domain: string): boolean {
  return OFFICIAL_DOMAIN_PATTERN.test(domain);
}

function isRepoDomain(domain: string): boolean {
  return REPO_DOMAIN_PATTERN.test(domain);
}

function isMarketAuthorityDomain(domain: string): boolean {
  return MARKET_AUTHORITY_DOMAIN_PATTERN.test(domain) || isOfficialDomain(domain);
}

function isLowValueGeneralWebDomain(domain: string): boolean {
  return LOW_VALUE_GENERAL_WEB_DOMAIN_PATTERN.test(domain);
}

function isLowValueForProfile(domain: string, profile: ResearchProfile | undefined): boolean {
  if (!profile) {
    return false;
  }
  if (isLowValueGeneralWebDomain(domain)) {
    return true;
  }
  if ((profile === 'policy_regulation' || profile === 'comparison_research') && FORUM_LIKE_DOMAIN_PATTERN.test(domain)) {
    return true;
  }
  return false;
}

function isLowValueGeneralWebItem(item: RetrievalEvidenceItem, profile: ResearchProfile | undefined): boolean {
  if (isLowValueForProfile(item.domain, profile)) {
    return true;
  }
  if (GENERIC_NAVIGATION_URL_PATTERN.test(item.url)) {
    return true;
  }
  if (GENERIC_NAVIGATION_TITLE_PATTERN.test(item.title.trim())) {
    return true;
  }
  if (
    profile === 'comparison_research' &&
    (GENERIC_COMPARISON_HOME_DOMAIN_PATTERN.test(item.domain) ||
      LOW_VALUE_COMPARISON_DOMAIN_PATTERN.test(item.domain) ||
      /apps\.apple\.com/iu.test(item.domain))
  ) {
    return true;
  }
  if (profile === 'entity_brief' && LOW_VALUE_ENTITY_DOMAIN_PATTERN.test(item.domain)) {
    return true;
  }
  if (profile === 'market_research' && GENERIC_MARKET_LANDING_URL_PATTERN.test(item.url)) {
    return true;
  }
  if (profile === 'market_research' && isGoogleNewsDomain(item.domain)) {
    return true;
  }
  if (profile === 'market_research' && LOW_VALUE_MARKET_SIGNAL_PATTERN.test(`${item.title} ${item.snippet}`)) {
    return true;
  }
  return false;
}

function isMarketSignalRichItem(item: RetrievalEvidenceItem): boolean {
  return /(demand|capex|spending|investment|valuation|pricing|rate|yield|inflation|supply|supply chain|capacity|hyperscaler|data center|semiconductor|gpu|cloud|funding|macro|금리|투자|지출|수요|공급망|캐파|반도체|데이터센터)/iu.test(
    `${item.title} ${item.snippet}`
  );
}

function isSectorSpecificMarketItem(item: RetrievalEvidenceItem): boolean {
  return /(ai|인공지능|infra|infrastructure|data center|데이터센터|gpu|반도체|semiconductor|hyperscaler|cloud|aws|azure|tsmc|nvidia|엔비디아|capex|capacity|demand|orders|packaging|foundry|server|compute|investment|수요|캐파|증설|첨단 패키징|파운드리|클라우드|서버)/iu.test(
    `${item.title} ${item.snippet} ${item.domain}`
  );
}

function buildProfileSeedItems(profile: ResearchProfile | undefined, prompt: string): GoogleNewsRssItem[] {
  if (!profile) {
    return [];
  }
  if (profile === 'entity_brief') {
    return ENTITY_SEEDS.filter((entry) => entry.match.test(prompt)).flatMap((entry) => entry.sources.map((source) => ({ ...source })));
  }
  if (profile === 'comparison_research') {
    const requestedEntities = new Set<string>();
    for (const entity of extractComparisonEntities(prompt).map(normalizeComparisonEntity)) {
      requestedEntities.add(entity);
    }
    if (/gemini/iu.test(prompt)) requestedEntities.add('Gemini');
    if (/openai/iu.test(prompt)) requestedEntities.add('OpenAI');
    if (/claude/iu.test(prompt)) requestedEntities.add('Claude');
    if (/copilot/iu.test(prompt)) requestedEntities.add('Copilot');
    return [...requestedEntities]
      .flatMap((entity) => COMPARISON_DOC_SEEDS[entity] ?? [])
      .map((source) => ({ ...source }));
  }
  if (profile === 'policy_regulation') {
    return POLICY_SEEDS.filter((entry) => entry.match.test(prompt)).flatMap((entry) => entry.sources.map((source) => ({ ...source })));
  }
  if (profile === 'market_research') {
    const macroSeeds = [
      {
        url: 'https://www.federalreserve.gov/monetarypolicy.htm',
        title: 'Federal Reserve monetary policy resources',
        snippet: 'Official macro and monetary-policy context relevant to rates, funding conditions, and investment sentiment.',
      },
      {
        url: 'https://www.ecb.europa.eu/press/govcdec/mopo/html/index.en.html',
        title: 'ECB monetary policy decisions',
        snippet: 'Official euro-area policy decisions and macro guidance relevant to capital costs and demand conditions.',
      },
      {
        url: 'https://www.imf.org/en/Publications/WEO',
        title: 'IMF World Economic Outlook',
        snippet: 'Official global macro outlook used to frame demand, investment, and growth assumptions.',
      },
      {
        url: 'https://www.worldbank.org/en/topic/digitaldevelopment',
        title: 'World Bank digital development',
        snippet: 'Official digital infrastructure context covering connectivity, investment, and adoption conditions.',
      },
    ];
    if (isAiInfraMarketPrompt(prompt)) {
      return [...AI_INFRA_MARKET_SEEDS, ...macroSeeds];
    }
    return macroSeeds;
  }
  if (profile === 'repo_research' && isCurrentWorkspaceRepoPrompt(prompt)) {
    const workspaceRepo = getWorkspaceRepoContext();
    if (!workspaceRepo?.repoUrl) {
      return [];
    }
    return [
      {
        url: workspaceRepo.repoUrl,
        title: `${workspaceRepo.repoSlug ?? workspaceRepo.repoName} repository`,
        snippet: 'Current workspace repository source for README, releases, issues, and maintenance activity.',
      },
    ];
  }
  return [];
}

function mentionsEntity(item: RetrievalEvidenceItem, entity: string): boolean {
  const regex = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu');
  return regex.test(`${item.title} ${item.snippet}`);
}

function buildEntitySubjectTokens(prompt: string): string[] {
  const subject = extractEntitySubject(prompt) ?? prompt;
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s.-]/gu, ' ')
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !['official', 'company', 'overview', 'profile', '요약해줘', '정리해줘'].includes(token));
}

function getEntitySubject(prompt: string): string | null {
  const subject = extractEntitySubject(prompt) ?? prompt;
  const trimmed = subject.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isEntityRelevantItem(item: RetrievalEvidenceItem, prompt: string): boolean {
  const subject = getEntitySubject(prompt);
  if (!subject) {
    return true;
  }
  const haystack = `${item.domain} ${item.title} ${item.snippet}`.trim();
  if (/^[A-Z]{2,5}$/u.test(subject)) {
    const lower = subject.toLowerCase();
    const domainMatches = item.domain.toLowerCase().includes(lower);
    const exactTokenMatches = new RegExp(`\\b${subject}\\b`, 'u').test(haystack);
    const knownExpansionMatches =
      subject === 'WHO' && /world health organization|who\.int/iu.test(haystack);
    return domainMatches || exactTokenMatches || knownExpansionMatches;
  }
  return buildEntitySubjectTokens(prompt).some((token) => haystack.toLowerCase().includes(token));
}

function isEntityOfficialLikeItem(item: RetrievalEvidenceItem, prompt: string): boolean {
  if (isOfficialDomain(item.domain)) {
    return true;
  }
  const subjectTokens = buildEntitySubjectTokens(prompt);
  if (subjectTokens.length === 0) {
    return false;
  }
  const domain = item.domain.toLowerCase();
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const mentionsSubject = subjectTokens.some((token) => domain.includes(token) || text.includes(token));
  if (!mentionsSubject) {
    return false;
  }
  return /(official|investor relations|newsroom|press release|company overview|공식|보도자료|뉴스룸|ir|investor)/iu.test(
    `${item.title} ${item.snippet} ${item.url}`
  );
}

function isEntityOfficialUpdateLikeItem(item: RetrievalEvidenceItem, prompt: string): boolean {
  if (!isEntityOfficialLikeItem(item, prompt)) {
    return false;
  }
  return /(newsroom|press release|announcement|launch|investor|earnings|quarterly|results|update|blog|news|보도자료|뉴스룸|실적|발표|공지|출시|업데이트|파트너십|capacity|expansion|roadmap)/iu.test(
    `${item.title} ${item.snippet} ${item.url}`
  );
}

function selectGeneralWebItems(
  ranked: RetrievalEvidenceItem[],
  maxItems: number,
  profile: ResearchProfile | undefined,
  prompt: string
): RetrievalEvidenceItem[] {
  const preferredPool = ranked.filter((item) => !isLowValueGeneralWebItem(item, profile));
  const strictProfiles = profile === 'comparison_research' || profile === 'repo_research' || profile === 'policy_regulation';
  const baseCandidatePool = strictProfiles
    ? preferredPool
    : preferredPool.length >= Math.min(4, maxItems)
      ? preferredPool
      : ranked.filter((item) => !isLowValueGeneralWebItem(item, profile));
  const candidatePool =
    profile === 'entity_brief'
      ? (() => {
          const relevant = baseCandidatePool.filter((item) => isEntityRelevantItem(item, prompt));
          return relevant.length >= Math.min(3, maxItems) ? relevant : baseCandidatePool;
        })()
      : baseCandidatePool;
  const selected: RetrievalEvidenceItem[] = [];
  const selectedUrls = new Set<string>();
  const domainCounts = new Map<string, number>();

  const pushIfEligible = (item: RetrievalEvidenceItem | undefined | null) => {
    if (!item || selectedUrls.has(item.url)) {
      return;
    }
    const domainCount = domainCounts.get(item.domain) ?? 0;
    const domainCap = profile === 'repo_research' && item.domain === 'github.com' ? 3 : 2;
    if (domainCount >= domainCap) {
      return;
    }
    selected.push(item);
    selectedUrls.add(item.url);
    domainCounts.set(item.domain, domainCount + 1);
  };

  if (profile === 'entity_brief') {
    pushIfEligible(candidatePool.find((item) => isEntityOfficialUpdateLikeItem(item, prompt)));
    pushIfEligible(candidatePool.find((item) => isEntityOfficialLikeItem(item, prompt)));
    pushIfEligible(candidatePool.find((item) => isOfficialDomain(item.domain)));
  }
  if (profile === 'policy_regulation') {
    pushIfEligible(candidatePool.find((item) => isOfficialDomain(item.domain)));
  }
  if (profile === 'repo_research') {
    pushIfEligible(candidatePool.find((item) => isRepoDomain(item.domain)));
    pushIfEligible(candidatePool.find((item) => /(docs|readme|guide|manual|documentation)/iu.test(`${item.title} ${item.snippet}`)));
    pushIfEligible(candidatePool.find((item) => RELEASE_SIGNAL_PATTERN.test(`${item.title} ${item.snippet}`)));
    pushIfEligible(candidatePool.find((item) => ISSUE_SIGNAL_PATTERN.test(`${item.title} ${item.snippet}`)));
  }
  if (profile === 'market_research') {
    const sectorSpecificPrompt = isAiInfraMarketPrompt(prompt);
    if (sectorSpecificPrompt) {
      pushIfEligible(candidatePool.find((item) => isSectorSpecificMarketItem(item)));
      pushIfEligible(candidatePool.find((item) => isSectorSpecificMarketItem(item) && item.domain !== selected[0]?.domain));
    }
    pushIfEligible(candidatePool.find((item) => isMarketAuthorityDomain(item.domain)));
    pushIfEligible(candidatePool.find((item) => isMarketAuthorityDomain(item.domain) && item.domain !== selected[0]?.domain));
  }
  if (profile === 'comparison_research') {
    pushIfEligible(candidatePool.find((item) => /(ai\.google\.dev|deepmind\.google)/iu.test(item.domain)));
    pushIfEligible(candidatePool.find((item) => /(platform\.openai\.com|openai\.com)/iu.test(item.domain)));
    pushIfEligible(candidatePool.find((item) => /(docs\.anthropic\.com|anthropic\.com)/iu.test(item.domain)));
    pushIfEligible(candidatePool.find((item) => /(docs\.github\.com|github\.com)/iu.test(item.domain)));
    for (const entity of extractComparisonEntities(prompt)) {
      pushIfEligible(candidatePool.find((item) => mentionsEntity(item, entity)));
    }
  }

  for (const item of candidatePool) {
    if (selected.length >= maxItems) {
      break;
    }
    if (
      profile === 'market_research' &&
      selected.filter((row) => isMarketAuthorityDomain(row.domain)).length < 2 &&
      !isMarketAuthorityDomain(item.domain) &&
      !(isAiInfraMarketPrompt(prompt) && isSectorSpecificMarketItem(item))
    ) {
      continue;
    }
    if (
      profile === 'market_research' &&
      !isMarketAuthorityDomain(item.domain) &&
      (!MARKET_SUPPORTING_MEDIA_DOMAIN_PATTERN.test(item.domain) || !isMarketSignalRichItem(item))
    ) {
      continue;
    }
    pushIfEligible(item);
  }

  return selected.slice(0, maxItems);
}

function backfillSelectionWithSeeds(input: {
  selected: RetrievalEvidenceItem[];
  seedItems: GoogleNewsRssItem[];
  maxItems: number;
  prompt: string;
  profile: ResearchProfile | undefined;
  sourcePolicy: ResearchProfileSourcePolicy | undefined;
  domainCounts: Map<string, number>;
  retrievedAt: string;
}): RetrievalEvidenceItem[] {
  if (input.seedItems.length === 0 || input.selected.length >= input.maxItems) {
    return input.selected;
  }
  const selected = [...input.selected];
  const selectedUrls = new Set(selected.map((item) => item.url));
  const mutableDomainCounts = new Map<string, number>();
  for (const item of selected) {
    mutableDomainCounts.set(item.domain, (mutableDomainCounts.get(item.domain) ?? 0) + 1);
  }
  for (const seed of input.seedItems) {
    if (selected.length >= input.maxItems) {
      break;
    }
    const url = normalizeUrl(seed.url);
    if (!url || selectedUrls.has(url)) {
      continue;
    }
    const domain = toDomain(url);
    if ((mutableDomainCounts.get(domain) ?? 0) >= 2) {
      continue;
    }
    const candidate: RetrievalEvidenceItem = {
      sourceId: `seed_${selected.length + 1}`,
      title: seed.title || domain,
      url,
      domain,
      publishedAt: seed.publishedAt,
      retrievedAt: input.retrievedAt,
      snippet: seed.snippet,
      scores: scoreRetrievalItem({
        prompt: input.prompt,
        title: seed.title,
        snippet: seed.snippet,
        domain,
        publishedAt: seed.publishedAt,
        domainCounts: input.domainCounts,
        profile: input.profile,
        sourcePolicy: input.sourcePolicy
      })
    };
    if (isLowValueGeneralWebItem(candidate, input.profile)) {
      continue;
    }
    selected.push(candidate);
    selectedUrls.add(url);
    mutableDomainCounts.set(domain, (mutableDomainCounts.get(domain) ?? 0) + 1);
  }
  return selected;
}

function ensureRequiredProfileSeeds(input: {
  selected: RetrievalEvidenceItem[];
  maxItems: number;
  prompt: string;
  profile: ResearchProfile | undefined;
  sourcePolicy: ResearchProfileSourcePolicy | undefined;
  domainCounts: Map<string, number>;
  retrievedAt: string;
}): RetrievalEvidenceItem[] {
  if (!input.profile) {
    return input.selected;
  }
  const requiredSeeds: GoogleNewsRssItem[] = [];
  if (input.profile === 'comparison_research') {
    if (/gemini/iu.test(input.prompt)) {
      requiredSeeds.push(...(COMPARISON_DOC_SEEDS.Gemini ?? []).slice(0, 3));
    }
    if (/openai/iu.test(input.prompt)) {
      requiredSeeds.push(...(COMPARISON_DOC_SEEDS.OpenAI ?? []).slice(0, 3));
    }
    if (/claude/iu.test(input.prompt)) {
      requiredSeeds.push(...(COMPARISON_DOC_SEEDS.Claude ?? []).slice(0, 1));
    }
    if (/copilot/iu.test(input.prompt)) {
      requiredSeeds.push(...(COMPARISON_DOC_SEEDS.Copilot ?? []).slice(0, 1));
    }
  } else if (input.profile === 'policy_regulation') {
    requiredSeeds.push(...buildProfileSeedItems(input.profile, input.prompt));
  }
  if (requiredSeeds.length === 0) {
    return input.selected;
  }

  const selectedUrls = new Set<string>();
  const domainCounts = new Map<string, number>();
  const prioritized: RetrievalEvidenceItem[] = [];
  const pushCandidate = (candidate: RetrievalEvidenceItem) => {
    if (prioritized.length >= input.maxItems || selectedUrls.has(candidate.url)) {
      return;
    }
    const domainCount = domainCounts.get(candidate.domain) ?? 0;
    if (domainCount >= 2) {
      return;
    }
    prioritized.push(candidate);
    selectedUrls.add(candidate.url);
    domainCounts.set(candidate.domain, domainCount + 1);
  };

  for (const seed of requiredSeeds) {
    const url = normalizeUrl(seed.url);
    if (!url) continue;
    const domain = toDomain(url);
    const candidate: RetrievalEvidenceItem = {
      sourceId: `required_seed_${prioritized.length + 1}`,
      title: seed.title || domain,
      url,
      domain,
      publishedAt: seed.publishedAt,
      retrievedAt: input.retrievedAt,
      snippet: seed.snippet,
      scores: scoreRetrievalItem({
        prompt: input.prompt,
        title: seed.title,
        snippet: seed.snippet,
        domain,
        publishedAt: seed.publishedAt,
        domainCounts: input.domainCounts,
        profile: input.profile,
        sourcePolicy: input.sourcePolicy
      })
    };
    if (isLowValueGeneralWebItem(candidate, input.profile)) {
      continue;
    }
    pushCandidate(candidate);
  }

  for (const candidate of input.selected) {
    pushCandidate(candidate);
  }

  return prioritized;
}

export async function retrieveWebEvidence(input: RetrieveWebEvidenceInput): Promise<RetrievalEvidencePack> {
  const maxItems = Math.max(3, Math.min(input.maxItems ?? 8, 20));
  const perQueryLimit = Math.max(3, Math.min(input.perQueryLimit ?? 6, 10));
  const backend = selectRetrievalBackend(input.profile);
  const newsProfile = mapResearchProfileToNewsProfile(input.profile, input.prompt);
  const initialQueries = Array.from(
    new Set([input.prompt.trim(), ...(input.rewrittenQueries ?? []).map((item) => item.trim())].filter(Boolean))
  ).slice(0, 8);
  const rewrittenQueries =
    backend === 'general_web_rss' ? buildGeneralWebQueries(initialQueries, input.profile) : initialQueries;

  const merged = new Map<string, GoogleNewsRssItem>();
  const seedItems: GoogleNewsRssItem[] = [];
  for (const seed of buildProfileSeedItems(input.profile, input.prompt)) {
    seedItems.push(seed);
    if (!merged.has(seed.url)) {
      merged.set(seed.url, seed);
    }
  }
  if (input.profile === 'repo_research') {
    for (const seed of await fetchGitHubRepositorySeeds(input.prompt)) {
      seedItems.push(seed);
      if (!merged.has(seed.url)) {
        merged.set(seed.url, seed);
      }
    }
  }
  const queryResults = await Promise.all(
    rewrittenQueries.map(async (query) => ({
      query,
      items: await (backend === 'general_web_rss'
        ? (async () => {
            if (input.profile === 'market_research') {
              const [braveItems, bingItems] = await Promise.all([fetchBraveSearchHtml(query), fetchBingSearchRss(query)]);
              const combined = mergeUniqueItems([...braveItems, ...bingItems]);
              if (combined.length > 0) {
                return combined;
              }
            }
            const braveItems = await fetchBraveSearchHtml(query);
            if (braveItems.length > 0) {
              return braveItems;
            }
            return fetchBingSearchRss(query);
          })()
        : fetchGoogleNewsRss(query)),
    }))
  );
  for (const { items: rssItems } of queryResults) {
    for (const item of rssItems.slice(0, perQueryLimit)) {
      if (!merged.has(item.url)) {
        merged.set(item.url, item);
      }
      if (merged.size >= maxItems * 3) {
        break;
      }
    }
    if (merged.size >= maxItems * 3) {
      break;
    }
  }

  if (input.profile === 'market_research') {
    const supplementalNewsQueries = Array.from(
      new Set(
        [
          input.prompt.trim(),
          `${input.prompt.trim()} 최신`,
          `${input.prompt.trim()} Reuters FT Bloomberg`,
        ].filter((query) => query.trim().length > 0)
      )
    ).slice(0, 3);
    const marketNewsResults = await Promise.all(supplementalNewsQueries.map((query) => fetchGoogleNewsRss(query)));
    for (const rssItems of marketNewsResults) {
      for (const item of rssItems.slice(0, perQueryLimit)) {
        if (!merged.has(item.url)) {
          merged.set(item.url, item);
        }
        if (merged.size >= maxItems * 3) {
          break;
        }
      }
      if (merged.size >= maxItems * 3) {
        break;
      }
    }
  }

  const needsTopFeedBackfill =
    backend === 'news_rss' &&
    (newsProfile !== 'standard' ||
      merged.size < Math.max(newsProfile === 'standard' ? 4 : 6, maxItems) ||
      countDomains(merged.values()) < (newsProfile === 'standard' ? 2 : 3));
  if (needsTopFeedBackfill) {
    const topFeedResults = await Promise.all(GOOGLE_NEWS_TOP_FEEDS.map((url) => fetchGoogleNewsTopFeed(url)));
    for (const feedItems of topFeedResults) {
      for (const item of feedItems.slice(0, perQueryLimit)) {
        if (!merged.has(item.url)) {
          merged.set(item.url, item);
        }
        if (merged.size >= maxItems * 3) {
          break;
        }
      }
      if (merged.size >= maxItems * 3) {
        break;
      }
    }
  }

  const needsCuratedBackfill =
    backend === 'news_rss' &&
    (newsProfile !== 'standard' ||
      merged.size < Math.max(newsProfile === 'standard' ? 4 : 6, maxItems) ||
      countDomains(merged.values()) < (newsProfile === 'standard' ? 2 : 3));
  const nonGoogleCount = countNonGoogleItems(merged.values());
  const needsNonGoogleBackfill =
    backend === 'news_rss' &&
    nonGoogleCount < Math.max(newsProfile === 'standard' ? 2 : 3, Math.floor(maxItems * (newsProfile === 'standard' ? 0.5 : 0.75)));
  if (needsCuratedBackfill || needsNonGoogleBackfill) {
    const curatedResults = await Promise.all(CURATED_NEWS_FALLBACK_FEEDS.map((url) => fetchCuratedFeed(url)));
    for (const feedItems of curatedResults) {
      for (const item of feedItems.slice(0, perQueryLimit)) {
        if (!merged.has(item.url)) {
          merged.set(item.url, item);
        }
        if (merged.size >= maxItems * 3) {
          break;
        }
      }
      if (merged.size >= maxItems * 3) {
        break;
      }
    }
  }

  const candidates = Array.from(merged.values());
  const domainCounts = new Map<string, number>();
  for (const item of candidates) {
    const domain = toDomain(item.url);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  const retrievedAt = new Date().toISOString();
  const ranked: RetrievalEvidenceItem[] = candidates
    .map((candidate, index) => {
      const domain = toDomain(candidate.url);
      const scores = scoreRetrievalItem({
        prompt: input.prompt,
        title: candidate.title,
        snippet: candidate.snippet,
        domain,
        publishedAt: candidate.publishedAt,
        domainCounts,
        profile: input.profile,
        sourcePolicy: input.sourcePolicy
      });
      return {
        sourceId: `src_${index + 1}`,
        title: candidate.title || domain,
        url: candidate.url,
        domain,
        publishedAt: candidate.publishedAt,
        retrievedAt,
        snippet: candidate.snippet,
        scores
      };
    })
    .sort((left, right) => right.scores.final - left.scores.final)
    .slice(0, maxItems * 2);

  const selected =
    backend === 'general_web_rss'
      ? selectGeneralWebItems(ranked, maxItems, input.profile, input.prompt)
      : selectBalancedRetrievalItems(ranked, maxItems, newsProfile);
  const completedSelection =
    backend === 'general_web_rss'
      ? backfillSelectionWithSeeds({
          selected,
          seedItems,
          maxItems,
          prompt: input.prompt,
          profile: input.profile,
          sourcePolicy: input.sourcePolicy,
          domainCounts,
          retrievedAt
        })
      : selected;
  const finalizedSelection =
    backend === 'general_web_rss'
      ? ensureRequiredProfileSeeds({
          selected: completedSelection,
          maxItems,
          prompt: input.prompt,
          profile: input.profile,
          sourcePolicy: input.sourcePolicy,
          domainCounts,
          retrievedAt
        })
      : completedSelection;

  const sources = finalizedSelection.map((item) => ({
    url: item.url,
    title: item.title,
    domain: item.domain,
    snippet: item.snippet,
    publishedAt: item.publishedAt
  }));

  return {
    query: input.prompt.trim(),
    rewrittenQueries,
    items: finalizedSelection,
    sources
  };
}

export function buildRetrievalSystemInstruction(pack: RetrievalEvidencePack): string {
  if (pack.items.length === 0) {
    return '';
  }

  const evidenceLines = pack.items
    .slice(0, 8)
    .map((item, index) => {
      const published = item.publishedAt ? `published_at=${item.publishedAt}` : 'published_at=unknown';
      return `${index + 1}. [${item.title}](${item.url}) | domain=${item.domain} | ${published}\nsnippet: ${item.snippet}`;
    })
    .join('\n');

  return [
    'Grounded retrieval evidence is provided below. Use it as primary context.',
    'Do not invent sources. Keep claims aligned with the listed evidence.',
    'Always include a "Sources" section with markdown links from the evidence set.',
    '',
    '[Retrieved Evidence]',
    evidenceLines
  ].join('\n');
}
