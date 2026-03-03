export type RetrievalRankingInput = {
  prompt: string;
  title: string;
  snippet: string;
  domain: string;
  publishedAt?: string;
  domainCounts?: Map<string, number>;
};

export type RetrievalRankingScores = {
  relevance: number;
  freshness: number;
  trust: number;
  diversity: number;
  final: number;
};

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
  /(오피스텔|매물|연예|가십|hot tub|epstein|scandal|celebrity|rumor|주택|부동산)/iu;

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
  const promptTokens = new Set(tokenize(prompt));
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

export function scoreRetrievalItem(input: RetrievalRankingInput): RetrievalRankingScores {
  const relevance = scoreRelevance(input.prompt, input.title, input.snippet);
  const freshness = scoreFreshness(input.publishedAt);
  const trust = scoreTrust(input.domain);
  const diversity = scoreDiversity(input.domain, input.domainCounts);
  const majorBriefingFit = scoreMajorityForBriefing(input.prompt, input.title, input.snippet, input.domain);

  const final = clamp01(relevance * 0.35 + freshness * 0.2 + trust * 0.2 + diversity * 0.1 + majorBriefingFit * 0.15);
  return {
    relevance,
    freshness,
    trust,
    diversity,
    final
  };
}
