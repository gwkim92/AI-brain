import type { ResearchProfile, ResearchProfileSourcePolicy } from './research-profile';

export type RetrievalRankingInput = {
  prompt: string;
  title: string;
  snippet: string;
  domain: string;
  publishedAt?: string;
  domainCounts?: Map<string, number>;
  profile?: ResearchProfile;
  sourcePolicy?: ResearchProfileSourcePolicy;
};

export type RetrievalRankingScores = {
  relevance: number;
  freshness: number;
  trust: number;
  diversity: number;
  significance: number;
  sourceFit: number;
  final: number;
};

const QUERY_STOPWORDS = new Set([
  '오늘',
  '주요',
  '뉴스',
  '정리',
  '제공',
  '해줘',
  '나에게',
  'latest',
  'today',
  'news',
  'brief',
  'briefing',
  'provide',
  'summary',
  'summarize'
]);

const TRUST_HINTS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /(news\.google\.com)/iu, score: 0.58 },
  { pattern: /(reuters\.com|apnews\.com|bloomberg\.com|bbc\.com|nytimes\.com)/iu, score: 0.95 },
  { pattern: /(yonhapnews\.co\.kr|chosun\.com|hani\.co\.kr|joongang\.co\.kr|khan\.co\.kr)/iu, score: 0.9 },
  { pattern: /(naver\.com|daum\.net|mk\.co\.kr|sedaily\.com)/iu, score: 0.82 }
];

const MAJOR_BRIEFING_PROMPT_PATTERN =
  /(주요\s*뉴스|헤드라인|브리핑|top\s*news|major\s*news|headline|briefing)/iu;

const MAJOR_NEWS_SIGNAL_PATTERN =
  /(대통령|정부|전쟁|공격|협상|외교|제재|금리|인플레이션|시장|증시|경제|국방|ai|정책|선거|재난|earthquake|war|attack|sanction|economy|market|policy|government|diplomacy)/iu;

const MINOR_NEWS_SIGNAL_PATTERN =
  /(오피스텔|매물|연예|가십|hot tub|epstein|scandal|celebrity|rumor|주택|부동산|성매매|sex trafficking|trafficking|investigation|murder|trial|criminal|crime)/iu;
const GLOBAL_SCOPE_PROMPT_PATTERN =
  /(세계|글로벌|world|global|headline|headlines|헤드라인|주요\s*뉴스|top\s*news|major\s*news)/iu;
const GLOBAL_SCOPE_SIGNAL_PATTERN =
  /(세계|글로벌|국제|유럽|미국|중국|러시아|중동|우크라이나|유엔|nato|eu|g7|g20|international|global|world|europe|china|russia|middle east|ukraine|united nations)/iu;
const GLOBAL_HEADLINE_SIGNAL_PATTERN =
  /(정상회담|중앙은행|금리 동결|금리 인하|금리 인상|관세|제재|휴전|무역 협상|반도체|인공지능 모델|외교장관|국방장관|summit|central bank|rate cut|rate hike|tariff|sanction|ceasefire|trade talks|semiconductor|ai model|leaders?|defense ministers?|foreign ministers?)/iu;
const LOCAL_SCOPE_PENALTY_PATTERN =
  /(지방선거|공천|도당|시의회|도의회|구청장|군수|지역구|국민의힘|국힘|민주당|윤어게인|한동훈|이재명|윤석열|부산\s*찾은|전북도당|기초단체|광역의회)/iu;
const LOW_SIGNIFICANCE_LOCAL_PATTERN =
  /(지역 정치|지역 이슈|지방 정치|local politics|district|city council|provincial|county|시장 방문|도의회|시의회|구청|군청)/iu;
const OFFICIAL_SOURCE_PATTERN =
  /(\.gov\b|\.go\.kr\b|europa\.eu\b|sec\.gov\b|federalreserve\.gov\b|ecb\.europa\.eu\b|whitehouse\.gov\b|gov\.uk\b|who\.int\b|imf\.org\b|worldbank\.org\b)/iu;
const REPO_SOURCE_PATTERN =
  /(github\.com|gitlab\.com|docs\.[^/]+|readthedocs\.io|npmjs\.com|pypi\.org|crates\.io)/iu;
const OFFICIAL_ENTITY_SIGNAL_PATTERN =
  /(official|press release|investor relations|sec filing|blog|announcement|공식|보도자료|발표|공시|ir)/iu;
const COMPARISON_SIGNAL_PATTERN =
  /(\bvs\b|비교|장단점|difference|trade-?off|compare|alternative)/iu;
const REPO_SIGNAL_PATTERN =
  /(github|gitlab|readme|release|issue|package|repo|repository|commit|pull request|레포|릴리즈|이슈)/iu;
const POLICY_SIGNAL_PATTERN =
  /(policy|regulation|law|act|guideline|official notice|compliance|정책|규제|법|법안|가이드라인|공식 공지)/iu;

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/gu, ' ')
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function scoreRelevance(prompt: string, title: string, snippet: string): number {
  const promptTokens = new Set(tokenize(prompt).filter((token) => !QUERY_STOPWORDS.has(token)));
  if (promptTokens.size === 0) {
    return 0.4;
  }
  const contentTokens = new Set([...tokenize(title), ...tokenize(snippet)]);
  if (contentTokens.size === 0) {
    return 0.3;
  }
  let overlap = 0;
  for (const token of promptTokens) {
    if (contentTokens.has(token)) {
      overlap += 1;
    }
  }
  const ratio = overlap / promptTokens.size;
  return clamp01(0.25 + ratio * 0.75);
}

function scoreScopeFit(prompt: string, title: string, snippet: string): number {
  if (!GLOBAL_SCOPE_PROMPT_PATTERN.test(prompt)) {
    return 0.5;
  }

  const text = `${title} ${snippet}`;
  let score = 0.5;
  if (GLOBAL_SCOPE_SIGNAL_PATTERN.test(text)) {
    score += 0.25;
  }
  if (LOCAL_SCOPE_PENALTY_PATTERN.test(text)) {
    score -= 0.35;
  }
  return clamp01(score);
}

function scoreFreshness(publishedAt?: string): number {
  if (!publishedAt) {
    return 0.45;
  }
  const publishedTs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedTs)) {
    return 0.45;
  }
  const ageHours = Math.max(0, (Date.now() - publishedTs) / (1000 * 60 * 60));
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.9;
  if (ageHours <= 72) return 0.75;
  if (ageHours <= 168) return 0.6;
  return 0.45;
}

function scoreTrust(domain: string): number {
  const normalized = domain.toLowerCase();
  for (const candidate of TRUST_HINTS) {
    if (candidate.pattern.test(normalized)) {
      return candidate.score;
    }
  }
  return 0.7;
}

function scoreDiversity(domain: string, domainCounts?: Map<string, number>): number {
  if (!domainCounts) {
    return 1;
  }
  const count = domainCounts.get(domain.toLowerCase()) ?? 0;
  if (count <= 0) return 1;
  if (count === 1) return 0.9;
  if (count === 2) return 0.75;
  return 0.6;
}

function scoreMajorityForBriefing(prompt: string, title: string, snippet: string, domain: string): number {
  if (!MAJOR_BRIEFING_PROMPT_PATTERN.test(prompt)) {
    return 0.5;
  }
  const text = `${title} ${snippet}`;
  let score = 0.5;
  if (MAJOR_NEWS_SIGNAL_PATTERN.test(text)) {
    score += 0.28;
  }
  if (MINOR_NEWS_SIGNAL_PATTERN.test(text)) {
    score -= 0.32;
  }
  if (/news\.google\.com/iu.test(domain)) {
    score -= 0.1;
  }
  return clamp01(score);
}

function scoreBroadHeadlineFit(prompt: string, title: string, snippet: string, domain: string): number {
  let score = scoreMajorityForBriefing(prompt, title, snippet, domain);
  const text = `${title} ${snippet}`;
  if (GLOBAL_SCOPE_PROMPT_PATTERN.test(prompt) && GLOBAL_SCOPE_SIGNAL_PATTERN.test(text)) {
    score += 0.12;
  }
  if (GLOBAL_HEADLINE_SIGNAL_PATTERN.test(text)) {
    score += 0.14;
  }
  if (/(reuters\.com|apnews\.com|bbc\.com|nytimes\.com|ft\.com|bloomberg\.com|wsj\.com|aljazeera\.com)/iu.test(domain)) {
    score += 0.08;
  }
  if (LOCAL_SCOPE_PENALTY_PATTERN.test(text)) {
    score -= 0.24;
  }
  if (LOW_SIGNIFICANCE_LOCAL_PATTERN.test(text)) {
    score -= 0.18;
  }
  return clamp01(score);
}

function scoreSignificance(
  profile: ResearchProfile | undefined,
  prompt: string,
  title: string,
  snippet: string,
  domain: string
): number {
  const text = `${title} ${snippet}`;
  if (!profile) {
    return 0.5;
  }
  if (profile === 'broad_news') {
    return scoreBroadHeadlineFit(prompt, title, snippet, domain);
  }
  if (profile === 'topic_news') {
    let score = scoreMajorityForBriefing(prompt, title, snippet, domain);
    if (/(latest|timeline|최근 변화|최신 동향|after|amid|overnight|updated)/iu.test(text)) score += 0.12;
    if (GLOBAL_HEADLINE_SIGNAL_PATTERN.test(text)) score += 0.06;
    return clamp01(score);
  }
  if (profile === 'comparison_research') {
    let score = 0.45;
    if (COMPARISON_SIGNAL_PATTERN.test(text)) score += 0.25;
    if (OFFICIAL_ENTITY_SIGNAL_PATTERN.test(text)) score += 0.1;
    return clamp01(score);
  }
  if (profile === 'repo_research') {
    let score = 0.45;
    if (REPO_SIGNAL_PATTERN.test(text)) score += 0.25;
    if (REPO_SOURCE_PATTERN.test(domain)) score += 0.18;
    return clamp01(score);
  }
  if (profile === 'policy_regulation') {
    let score = 0.45;
    if (POLICY_SIGNAL_PATTERN.test(text)) score += 0.25;
    if (OFFICIAL_SOURCE_PATTERN.test(domain)) score += 0.2;
    return clamp01(score);
  }
  if (profile === 'market_research') {
    let score = 0.45;
    if (MAJOR_NEWS_SIGNAL_PATTERN.test(text)) score += 0.2;
    if (/(reuters\.com|bloomberg\.com|ft\.com|wsj\.com)/iu.test(domain)) score += 0.18;
    return clamp01(score);
  }
  if (profile === 'entity_brief') {
    let score = 0.45;
    if (OFFICIAL_ENTITY_SIGNAL_PATTERN.test(text)) score += 0.2;
    if (OFFICIAL_SOURCE_PATTERN.test(domain)) score += 0.18;
    return clamp01(score);
  }
  return 0.5;
}

function scoreSourceFit(
  sourcePolicy: ResearchProfileSourcePolicy | undefined,
  domain: string,
  title: string,
  snippet: string
): number {
  if (!sourcePolicy) {
    return 0.5;
  }
  const text = `${title} ${snippet}`;
  switch (sourcePolicy) {
    case 'headline_media': {
      let score = 0.55;
      if (/news\.google\.com/iu.test(domain)) score -= 0.15;
      if (/(reuters\.com|apnews\.com|bbc\.com|nytimes\.com|ft\.com|bloomberg\.com|wsj\.com|aljazeera\.com)/iu.test(domain)) score += 0.2;
      return clamp01(score);
    }
    case 'topic_media': {
      let score = 0.5;
      if (/news\.google\.com/iu.test(domain)) score -= 0.1;
      if (MAJOR_NEWS_SIGNAL_PATTERN.test(text)) score += 0.12;
      return clamp01(score);
    }
    case 'official_first': {
      let score = 0.4;
      if (OFFICIAL_SOURCE_PATTERN.test(domain)) score += 0.35;
      if (OFFICIAL_ENTITY_SIGNAL_PATTERN.test(text)) score += 0.18;
      return clamp01(score);
    }
    case 'repo_first': {
      let score = 0.35;
      if (REPO_SOURCE_PATTERN.test(domain)) score += 0.38;
      if (REPO_SIGNAL_PATTERN.test(text)) score += 0.15;
      return clamp01(score);
    }
    case 'market_authority': {
      let score = 0.4;
      if (/(reuters\.com|bloomberg\.com|ft\.com|wsj\.com)/iu.test(domain)) score += 0.25;
      if (OFFICIAL_SOURCE_PATTERN.test(domain)) score += 0.2;
      return clamp01(score);
    }
    default:
      return 0.5;
  }
}

export function scoreRetrievalItem(input: RetrievalRankingInput): RetrievalRankingScores {
  const relevance = scoreRelevance(input.prompt, input.title, input.snippet);
  const freshness = scoreFreshness(input.publishedAt);
  const trust = scoreTrust(input.domain);
  const diversity = scoreDiversity(input.domain, input.domainCounts);
  const majorBriefingFit = scoreMajorityForBriefing(input.prompt, input.title, input.snippet, input.domain);
  const scopeFit = scoreScopeFit(input.prompt, input.title, input.snippet);
  const significance = scoreSignificance(input.profile, input.prompt, input.title, input.snippet, input.domain);
  const sourceFit = scoreSourceFit(input.sourcePolicy, input.domain, input.title, input.snippet);

  const final = clamp01(
    relevance * 0.26 +
      freshness * 0.18 +
      trust * 0.17 +
      diversity * 0.08 +
      majorBriefingFit * 0.08 +
      scopeFit * 0.08 +
      significance * 0.09 +
      sourceFit * 0.06
  );
  return {
    relevance,
    freshness,
    trust,
    diversity,
    significance,
    sourceFit,
    final
  };
}
