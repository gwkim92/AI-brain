import type { GroundingSource } from './grounding';
import type { ResponseLanguage } from './language-policy';

export type NewsBriefingFact = {
  headline: string;
  summary: string;
  whyItMatters?: string;
  eventDate?: string;
  sourceUrls: string[];
};

type BriefingTopic = 'security' | 'economy' | 'policy' | 'technology' | 'disaster' | 'general';

type ExtractionShape = {
  facts?: Array<Record<string, unknown>>;
};

const MAJOR_NEWS_SIGNAL_PATTERN =
  /(대통령|정부|전쟁|공격|협상|외교|제재|금리|인플레이션|시장|증시|경제|국방|ai|정책|선거|재난|earthquake|war|attack|sanction|economy|market|policy|government|diplomacy)/iu;
const MINOR_NEWS_SIGNAL_PATTERN =
  /(오피스텔|매물|부동산|가십|연예|scandal|rumor|celebrity|hot tub|epstein)/iu;
const HANGUL_PREFIXED_LATIN_PATTERN = /([가-힣]{1,2})([A-Za-z][A-Za-z0-9-]{2,})([가-힣]{0,2})/gu;
const URL_DATE_PATTERN = /\/(20\d{2})\/(0[1-9]|1[0-2])\/([0-2]\d|3[01])(?=\/|$)/u;
const TOKEN_PATTERN = /[a-z0-9가-힣]{2,}/giu;
const KOREAN_ALLOWED_LATIN_TOKENS = new Set(['openai', 'anthropic', 'ai', 'us', 'uk', 'eu', 'g7', 'g20', 'nato']);
const TOPIC_PATTERNS: Record<Exclude<BriefingTopic, 'general'>, RegExp> = {
  security: /(전쟁|공습|공격|미사일|국방|안보|tehran|iran|military|defense|attack|strike|missile|security)/iu,
  economy: /(금리|물가|인플레이션|증시|시장|환율|경제|economy|inflation|market|stocks|rate)/iu,
  policy: /(정부|대통령|선거|정책|법안|규제|협상|외교|제재|government|policy|election|regulation|diplomacy|sanction)/iu,
  technology: /(인공지능|ai|openai|anthropic|technology|tech|반도체|모델)/iu,
  disaster: /(지진|홍수|산불|태풍|재난|earthquake|flood|wildfire|storm|disaster)/iu
};
const KNOWN_ENTITY_NORMALIZERS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /오픈아이/gu, replacement: 'OpenAI' },
  {
    pattern: /애니프로틱|앤트로픽|안트로픽|안스로픽|안트로피크|앤솔라피티|앤소로피티|앤트로피티|앤트로픽스/gu,
    replacement: 'Anthropic'
  }
];

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function sanitizeVisibleText(value: string): string {
  return normalizeSpaces(value.replace(/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/gu, ' '));
}

function safeDateOnly(value: unknown): string | undefined {
  const text = safeText(value);
  if (!text) {
    return undefined;
  }
  const matched = /^\d{4}-\d{2}-\d{2}$/u.exec(text);
  if (matched) {
    return text;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function inferDateFromUrl(url: string): string | undefined {
  const matched = URL_DATE_PATTERN.exec(url);
  if (!matched) {
    return undefined;
  }
  const year = matched[1];
  const month = matched[2];
  const day = matched[3];
  if (!year || !month || !day) {
    return undefined;
  }
  return `${year}-${month}-${day}`;
}

function hangulRatio(value: string): number {
  if (!value) {
    return 0;
  }
  const filtered = Array.from(value).filter((ch) => /[\uac00-\ud7a3A-Za-z0-9]/u.test(ch));
  if (filtered.length === 0) {
    return 0;
  }
  const hangul = filtered.filter((ch) => /[\uac00-\ud7a3]/u.test(ch)).length;
  return hangul / filtered.length;
}

function collectCanonicalLatinTerms(sources: GroundingSource[]): string[] {
  const seen = new Map<string, string>();
  for (const source of sources) {
    const text = `${source.title} ${source.domain}`;
    const matches = text.match(/[A-Za-z][A-Za-z0-9-]{2,}/gu) ?? [];
    for (const match of matches) {
      const cleaned = match.replace(/[^A-Za-z0-9-]/gu, '');
      if (cleaned.length < 3) {
        continue;
      }
      const key = cleaned.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, cleaned);
      }
    }
  }
  return Array.from(seen.values());
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix: number[][] = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) {
    matrix[i]![0] = i;
  }
  for (let j = 0; j <= right.length; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + substitutionCost
      );
    }
  }

  return matrix[left.length]![right.length]!;
}

function resolveCanonicalLatinToken(token: string, canonicalTerms: string[]): string {
  const normalized = token.replace(/[^A-Za-z]/gu, '');
  if (normalized.length < 3 || canonicalTerms.length === 0) {
    return normalized || token;
  }
  const lower = normalized.toLowerCase();
  let best: { term: string; distance: number } | null = null;
  for (const term of canonicalTerms) {
    const termLower = term.toLowerCase();
    if (Math.abs(termLower.length - lower.length) > 3) {
      continue;
    }
    const distance = levenshteinDistance(lower, termLower);
    if (distance > 2) {
      continue;
    }
    if (!best || distance < best.distance) {
      best = { term, distance };
    }
  }
  return best?.term ?? normalized;
}

function repairHangulPrefixedLatin(value: string, canonicalTerms: string[]): string {
  return value.replace(HANGUL_PREFIXED_LATIN_PATTERN, (_whole, _prefix, latin, suffix) => {
    const normalizedLatin = typeof latin === 'string' ? latin : '';
    const normalizedSuffix = typeof suffix === 'string' ? suffix : '';
    if (!normalizedLatin) {
      return _whole;
    }
    const repaired = resolveCanonicalLatinToken(normalizedLatin, canonicalTerms);
    return `${repaired}${normalizedSuffix}`;
  });
}

function removeUnexpectedLatinWordsForKorean(value: string, canonicalTerms: string[]): string {
  const allowed = new Set([
    ...KOREAN_ALLOWED_LATIN_TOKENS,
    ...canonicalTerms.map((item) => item.toLowerCase())
  ]);
  return normalizeSpaces(
    value.replace(/\b([A-Za-z]{4,})\b/gu, (word) => {
      const normalized = word.toLowerCase();
      return allowed.has(normalized) ? word : '';
    })
  );
}

function normalizeKnownEntityAliases(value: string): string {
  let result = value;
  for (const row of KNOWN_ENTITY_NORMALIZERS) {
    result = result.replace(row.pattern, row.replacement);
  }
  return result;
}

function cleanFactText(
  value: string,
  canonicalTerms: string[],
  expectedLanguage: ResponseLanguage | null = null
): string {
  if (!value) {
    return '';
  }
  const sanitized = sanitizeVisibleText(value);
  const repaired = normalizeKnownEntityAliases(normalizeSpaces(repairHangulPrefixedLatin(sanitized, canonicalTerms)));
  if (expectedLanguage === 'ko') {
    return removeUnexpectedLatinWordsForKorean(repaired, canonicalTerms);
  }
  return repaired;
}

function parseJsonFromModelText(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed);
  const candidates = fenced?.[1] ? [fenced[1], trimmed] : [trimmed];

  const firstObjectIdx = trimmed.indexOf('{');
  const lastObjectIdx = trimmed.lastIndexOf('}');
  if (firstObjectIdx >= 0 && lastObjectIdx > firstObjectIdx) {
    candidates.push(trimmed.slice(firstObjectIdx, lastObjectIdx + 1));
  }
  const firstArrayIdx = trimmed.indexOf('[');
  const lastArrayIdx = trimmed.lastIndexOf(']');
  if (firstArrayIdx >= 0 && lastArrayIdx > firstArrayIdx) {
    candidates.push(trimmed.slice(firstArrayIdx, lastArrayIdx + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

function toExtractionShape(payload: unknown): ExtractionShape {
  if (Array.isArray(payload)) {
    return { facts: payload.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>> };
  }
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const row = payload as Record<string, unknown>;
  if (Array.isArray(row.facts)) {
    return {
      facts: row.facts.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>
    };
  }
  return {};
}

export function buildNewsFactExtractionSystemInstruction(expectedLanguage: ResponseLanguage | null): string {
  const languageName =
    expectedLanguage === 'en'
      ? 'English'
      : expectedLanguage === 'ja'
      ? 'Japanese'
      : expectedLanguage === 'zh'
      ? 'Chinese'
      : 'Korean';

  return [
    'You are a factual extraction engine for grounded news briefing.',
    'Extract only verifiable facts from the provided evidence.',
    'Return ONLY valid JSON. No markdown. No prose outside JSON.',
    `All text fields must be written in ${languageName}.`,
    'Schema:',
    '{',
    '  "facts": [',
    '    {',
    '      "headline": "short headline",',
    '      "summary": "one or two sentence factual summary",',
    '      "why_it_matters": "impact statement (optional)",',
    '      "event_date": "YYYY-MM-DD (optional)",',
    '      "source_urls": ["https://..."]',
    '    }',
    '  ]',
    '}',
    'Rules:',
    '1) Do not invent entities, numbers, or dates.',
    '2) Every fact must include at least one source URL from provided evidence.',
    '3) Keep up to 5 facts and prioritize globally relevant major updates.',
    '4) If evidence has 2+ distinct domains, cover at least 2 domains and use max 2 facts per domain.',
    '5) Never output template artifacts or mixed-script corrupted entity tokens.'
  ].join('\n');
}

function interleaveSourcesByDomain(sources: GroundingSource[], maxSources: number): GroundingSource[] {
  const buckets = new Map<string, GroundingSource[]>();
  for (const source of sources) {
    const domain = source.domain?.trim().toLowerCase() || 'unknown';
    const existing = buckets.get(domain);
    if (existing) {
      existing.push(source);
    } else {
      buckets.set(domain, [source]);
    }
  }
  const domains = Array.from(buckets.keys());
  const selected: GroundingSource[] = [];
  while (selected.length < maxSources) {
    let progressed = false;
    for (const domain of domains) {
      const queue = buckets.get(domain);
      if (!queue || queue.length === 0) {
        continue;
      }
      selected.push(queue.shift()!);
      progressed = true;
      if (selected.length >= maxSources) {
        break;
      }
    }
    if (!progressed) {
      break;
    }
  }
  return selected;
}

export function buildNewsFactExtractionPrompt(input: {
  userPrompt: string;
  sources: GroundingSource[];
  maxSources?: number;
}): string {
  const rows = interleaveSourcesByDomain(
    input.sources,
    Math.max(3, Math.min(input.maxSources ?? 8, 12))
  );
  const evidence = rows
    .map((source, index) => {
      const publishedAt = source.publishedAt ? source.publishedAt.slice(0, 10) : 'unknown';
      const snippet = source.snippet?.replace(/\s+/gu, ' ').trim() ?? '';
      return [
        `${index + 1}. title: ${source.title}`,
        `   url: ${source.url}`,
        `   domain: ${source.domain}`,
        `   published_at: ${publishedAt}`,
        `   snippet: ${snippet}`
      ].join('\n');
    })
    .join('\n');

  return [
    `User request: ${input.userPrompt}`,
    'Instruction: Prefer major, high-impact updates and keep domain diversity in selected facts.',
    '',
    '[Evidence]',
    evidence,
    '',
    'Return JSON now.'
  ].join('\n');
}

function collectSourceUrlCandidates(row: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const fromSourceUrls = row.source_urls;
  if (Array.isArray(fromSourceUrls)) {
    for (const item of fromSourceUrls) {
      if (typeof item === 'string') {
        candidates.push(item);
      }
    }
  }
  const fromSources = row.sources;
  if (Array.isArray(fromSources)) {
    for (const item of fromSources) {
      if (typeof item === 'string') {
        candidates.push(item);
      } else if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).url === 'string') {
        candidates.push((item as Record<string, unknown>).url as string);
      }
    }
  }
  const fromSourceUrl = row.source_url;
  if (typeof fromSourceUrl === 'string') {
    candidates.push(fromSourceUrl);
  }
  return candidates;
}

function dedupe<T>(rows: T[]): T[] {
  return Array.from(new Set(rows));
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function isGoogleNewsDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return normalized === 'news.google.com' || normalized.endsWith('.google.com');
}

function scoreFactPriority(fact: NewsBriefingFact, sourceByUrl: Map<string, GroundingSource>): number {
  const text = `${fact.headline} ${fact.summary} ${fact.whyItMatters ?? ''}`;
  let score = 0.45;
  if (MAJOR_NEWS_SIGNAL_PATTERN.test(text)) {
    score += 0.3;
  }
  if (MINOR_NEWS_SIGNAL_PATTERN.test(text)) {
    score -= 0.38;
  }
  const hasNonGoogleSource = fact.sourceUrls.some((url) => {
    const domain = sourceByUrl.get(url)?.domain ?? '';
    return domain.length > 0 && !isGoogleNewsDomain(domain);
  });
  if (hasNonGoogleSource) {
    score += 0.12;
  }
  if (fact.whyItMatters) {
    score += 0.06;
  }
  return clamp01(score);
}

function primarySourceDomain(fact: NewsBriefingFact, sourceByUrl: Map<string, GroundingSource>): string {
  for (const url of fact.sourceUrls) {
    const domain = (sourceByUrl.get(url)?.domain ?? '').toLowerCase();
    if (domain && !isGoogleNewsDomain(domain)) {
      return domain;
    }
  }
  return (sourceByUrl.get(fact.sourceUrls[0] ?? '')?.domain ?? '').toLowerCase();
}

function tokenize(value: string): Set<string> {
  const rows = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags);
  const normalized = value.toLowerCase();
  while ((match = pattern.exec(normalized)) !== null) {
    const token = (match[0] ?? '').trim();
    if (token.length >= 3) {
      rows.add(token);
    }
  }
  return rows;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function selectDiverseFacts(
  rows: Array<{ fact: NewsBriefingFact; score: number }>,
  sourceByUrl: Map<string, GroundingSource>,
  maxFacts: number
): NewsBriefingFact[] {
  const perDomainLimit = 2;
  const selected: NewsBriefingFact[] = [];
  const selectedTokens: Set<string>[] = [];
  const domainCounts = new Map<string, number>();

  const domains = new Set(rows.map((row) => primarySourceDomain(row.fact, sourceByUrl)).filter(Boolean));
  const targetDomainCoverage = Math.min(domains.size, 2, maxFacts);

  const canSelect = (fact: NewsBriefingFact): boolean => {
    const factDomain = primarySourceDomain(fact, sourceByUrl);
    if (factDomain) {
      const count = domainCounts.get(factDomain) ?? 0;
      if (count >= perDomainLimit) {
        return false;
      }
    }
    const currentTokens = tokenize(`${fact.headline} ${fact.summary}`);
    for (const existing of selectedTokens) {
      if (jaccard(existing, currentTokens) >= 0.72) {
        return false;
      }
    }
    return true;
  };

  for (const row of rows) {
    if (selected.length >= targetDomainCoverage) {
      break;
    }
    const factDomain = primarySourceDomain(row.fact, sourceByUrl);
    if (!factDomain || (domainCounts.get(factDomain) ?? 0) > 0) {
      continue;
    }
    if (!canSelect(row.fact)) {
      continue;
    }
    selected.push(row.fact);
    selectedTokens.push(tokenize(`${row.fact.headline} ${row.fact.summary}`));
    domainCounts.set(factDomain, (domainCounts.get(factDomain) ?? 0) + 1);
  }

  for (const row of rows) {
    if (selected.length >= maxFacts) {
      break;
    }
    if (selected.some((item) => item === row.fact)) {
      continue;
    }
    if (!canSelect(row.fact)) {
      continue;
    }
    const factDomain = primarySourceDomain(row.fact, sourceByUrl);
    selected.push(row.fact);
    selectedTokens.push(tokenize(`${row.fact.headline} ${row.fact.summary}`));
    if (factDomain) {
      domainCounts.set(factDomain, (domainCounts.get(factDomain) ?? 0) + 1);
    }
  }

  return selected.slice(0, maxFacts);
}

function selectDiverseSources(sources: GroundingSource[], maxFacts: number): GroundingSource[] {
  const selected: GroundingSource[] = [];
  const counts = new Map<string, number>();
  for (const source of sources) {
    const domain = source.domain.toLowerCase();
    const count = counts.get(domain) ?? 0;
    if (count >= 2) {
      continue;
    }
    selected.push(source);
    counts.set(domain, count + 1);
    if (selected.length >= maxFacts) {
      break;
    }
  }
  return selected;
}

function detectBriefingTopic(value: string): BriefingTopic {
  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS) as Array<[Exclude<BriefingTopic, 'general'>, RegExp]>) {
    if (pattern.test(value)) {
      return topic;
    }
  }
  return 'general';
}

function topicLabel(topic: BriefingTopic, english: boolean): string {
  if (english) {
    const map: Record<BriefingTopic, string> = {
      security: 'Security',
      economy: 'Economy',
      policy: 'Policy',
      technology: 'Technology',
      disaster: 'Disaster',
      general: 'General'
    };
    return map[topic];
  }
  const map: Record<BriefingTopic, string> = {
    security: '안보',
    economy: '경제',
    policy: '정책',
    technology: '기술',
    disaster: '재난',
    general: '종합'
  };
  return map[topic];
}

function topicImpact(topic: BriefingTopic, english: boolean): string {
  if (english) {
    const map: Record<BriefingTopic, string> = {
      security: 'Security and geopolitical risk exposure may expand.',
      economy: 'Market, rates, and inflation expectations may shift.',
      policy: 'Policy and regulatory direction may affect public and business decisions.',
      technology: 'Technology adoption and governance trajectory may change.',
      disaster: 'Public safety and infrastructure recovery implications should be monitored.',
      general: 'Potential cross-sector impact should be monitored.'
    };
    return map[topic];
  }
  const map: Record<BriefingTopic, string> = {
    security: '안보와 지정학 리스크 변동 가능성이 있습니다.',
    economy: '시장·금리·물가 전망에 영향이 있을 수 있습니다.',
    policy: '정책·규제 방향 변화가 의사결정에 영향을 줄 수 있습니다.',
    technology: '기술 도입 및 거버넌스 방향 변화 가능성이 있습니다.',
    disaster: '공공안전과 인프라 복구 이슈를 모니터링할 필요가 있습니다.',
    general: '분야 간 파급 가능성이 있어 후속 동향 확인이 필요합니다.'
  };
  return map[topic];
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function buildFallbackNewsFactsFromSources(input: {
  sources: GroundingSource[];
  expectedLanguage: ResponseLanguage | null;
  maxFacts?: number;
}): NewsBriefingFact[] {
  const maxFacts = Math.max(1, Math.min(input.maxFacts ?? 5, 8));
  const selectedSources = selectDiverseSources(input.sources, maxFacts);
  const english = input.expectedLanguage === 'en';
  const facts: NewsBriefingFact[] = [];
  for (const [index, source] of selectedSources.entries()) {
    const title = sanitizeVisibleText(source.title || source.domain);
    const snippet = sanitizeVisibleText(source.snippet ?? '');
    const date = inferDateFromUrl(source.url) ?? (source.publishedAt ? source.publishedAt.slice(0, 10) : undefined);
    const topic = detectBriefingTopic(`${title} ${snippet} ${source.domain}`);
    const label = topicLabel(topic, english);
    const koHeadlineBase = hangulRatio(title) >= 0.3 ? title : `주요 업데이트 ${index + 1}`;
    const koHeadline = `[${label}] ${koHeadlineBase}`;
    const koSummary = snippet && hangulRatio(snippet) >= 0.25
      ? truncateText(snippet, 220)
      : `[${label}] 영문 보도 기반 핵심 업데이트입니다. 기사 제목: "${title}".`;
    const enSummary = snippet ? truncateText(snippet, 260) : `[${label}] Key update from source report: "${title}".`;

    facts.push({
      headline: english ? `[${label}] ${title || `Major update ${index + 1}`}` : koHeadline,
      summary: english ? enSummary : koSummary,
      whyItMatters: topicImpact(topic, english),
      eventDate: date,
      sourceUrls: [source.url]
    });
  }
  return facts;
}

export function ensureFactDomainCoverage(input: {
  facts: NewsBriefingFact[];
  sources: GroundingSource[];
  expectedLanguage: ResponseLanguage | null;
  maxFacts?: number;
}): NewsBriefingFact[] {
  const maxFacts = Math.max(1, Math.min(input.maxFacts ?? 5, 8));
  const sourceByUrl = new Map<string, GroundingSource>();
  for (const source of input.sources) {
    const normalized = normalizeUrl(source.url);
    if (normalized && !sourceByUrl.has(normalized)) {
      sourceByUrl.set(normalized, source);
    }
  }

  const currentFacts = input.facts.slice(0, maxFacts);
  const factDomains = new Set(currentFacts.map((fact) => primarySourceDomain(fact, sourceByUrl)).filter(Boolean));
  const sourceDomains = new Set(input.sources.map((source) => source.domain.toLowerCase()).filter(Boolean));

  if (sourceDomains.size < 2 || factDomains.size >= 2 || currentFacts.length >= maxFacts) {
    return currentFacts;
  }

  const missingDomains = new Set(Array.from(sourceDomains).filter((domain) => !factDomains.has(domain)));
  if (missingDomains.size === 0) {
    return currentFacts;
  }

  const supplemental = buildFallbackNewsFactsFromSources({
    sources: input.sources.filter((source) => missingDomains.has(source.domain.toLowerCase())),
    expectedLanguage: input.expectedLanguage,
    maxFacts
  });

  const merged = [...currentFacts];
  const addedDomains = new Set<string>();
  for (const fact of supplemental) {
    if (merged.length >= maxFacts) {
      break;
    }
    const key = fact.sourceUrls[0];
    if (!key) {
      continue;
    }
    const factDomain = primarySourceDomain(fact, sourceByUrl);
    if (factDomain && addedDomains.has(factDomain)) {
      continue;
    }
    if (merged.some((existing) => existing.sourceUrls[0] === key)) {
      continue;
    }
    merged.push(fact);
    if (factDomain) {
      addedDomains.add(factDomain);
      if (addedDomains.size >= missingDomains.size) {
        break;
      }
    }
  }

  return merged.slice(0, maxFacts);
}

export function extractNewsFactsFromOutput(
  outputText: string,
  sources: GroundingSource[],
  maxFacts = 5,
  expectedLanguage: ResponseLanguage | null = null
): {
  facts: NewsBriefingFact[];
  parseFailed: boolean;
} {
  const parsed = parseJsonFromModelText(outputText);
  const extraction = toExtractionShape(parsed);
  const knownSourceUrls = new Set(
    sources
      .map((item) => normalizeUrl(item.url))
      .filter((item): item is string => Boolean(item))
  );
  const sourceByUrl = new Map<string, GroundingSource>();
  for (const source of sources) {
    const normalized = normalizeUrl(source.url);
    if (normalized && !sourceByUrl.has(normalized)) {
      sourceByUrl.set(normalized, source);
    }
  }
  const canonicalLatinTerms = collectCanonicalLatinTerms(sources);

  const facts: NewsBriefingFact[] = [];
  for (const rawFact of extraction.facts ?? []) {
    const headline = cleanFactText(
      safeText(rawFact.headline ?? rawFact.title),
      canonicalLatinTerms,
      expectedLanguage
    );
    const summary = cleanFactText(
      safeText(rawFact.summary ?? rawFact.claim ?? rawFact.fact),
      canonicalLatinTerms,
      expectedLanguage
    );
    if (!headline || !summary) {
      continue;
    }
    const sourceUrls = dedupe(
      collectSourceUrlCandidates(rawFact)
        .map((url) => normalizeUrl(url))
        .filter((url): url is string => typeof url === 'string')
        .filter((url) => knownSourceUrls.has(url))
    );
    if (sourceUrls.length === 0) {
      continue;
    }
    facts.push({
      headline,
      summary,
      whyItMatters:
        cleanFactText(
          safeText(rawFact.why_it_matters ?? rawFact.impact),
          canonicalLatinTerms,
          expectedLanguage
        ) || undefined,
      eventDate: safeDateOnly(rawFact.event_date ?? rawFact.date),
      sourceUrls
    });
    if (facts.length >= maxFacts) {
      break;
    }
  }

  return {
    facts: selectDiverseFacts(
      facts
      .map((fact) => ({
        fact,
        score: scoreFactPriority(fact, sourceByUrl)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, maxFacts * 2),
      sourceByUrl,
      maxFacts
    ),
    parseFailed: (extraction.facts ?? []).length === 0
  };
}

function formatRetrievedAt(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return iso;
  }
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(ts));
}

function linkForSource(url: string, byUrl: Map<string, GroundingSource>): string {
  const source = byUrl.get(url);
  const rawLabel = source?.title?.trim() || source?.domain?.trim() || url;
  const label = rawLabel.length > 96 ? `${rawLabel.slice(0, 93)}...` : rawLabel;
  return `[${label}](${url})`;
}

export function renderNewsBriefingFromFacts(input: {
  facts: NewsBriefingFact[];
  sources: GroundingSource[];
  expectedLanguage: ResponseLanguage | null;
  retrievedAt: string;
}): string {
  const facts = input.facts.slice(0, 5);
  if (facts.length === 0) {
    return '';
  }

  const byUrl = new Map<string, GroundingSource>();
  for (const source of input.sources) {
    const normalized = normalizeUrl(source.url);
    if (normalized && !byUrl.has(normalized)) {
      byUrl.set(normalized, source);
    }
  }

  const english = input.expectedLanguage === 'en';
  const header = english
    ? `### Major News Briefing (${input.retrievedAt})`
    : `### 주요 뉴스 브리핑 (${formatRetrievedAt(input.retrievedAt)} KST)`;
  const lines: string[] = [header];

  for (const [index, fact] of facts.entries()) {
    const primarySourceUrl =
      fact.sourceUrls.find((url) => {
        const domain = byUrl.get(url)?.domain ?? '';
        return domain.length > 0 && !isGoogleNewsDomain(domain);
      }) ?? fact.sourceUrls[0];
    const primarySourceDate = primarySourceUrl
      ? inferDateFromUrl(primarySourceUrl) ?? byUrl.get(primarySourceUrl)?.publishedAt?.slice(0, 10) ?? undefined
      : undefined;
    const inlineCitation = primarySourceUrl
      ? english
        ? ` ([primary source](${primarySourceUrl}))`
        : ` ([주요 출처](${primarySourceUrl}))`
      : '';
    const effectiveDate = primarySourceDate ?? fact.eventDate;
    lines.push(`${index + 1}. **${fact.headline}**${inlineCitation}`);
    lines.push(
      english
        ? `- Summary: ${fact.summary}${inlineCitation}`
        : `- 요약: ${fact.summary}${inlineCitation}`
    );
    if (fact.whyItMatters) {
      lines.push(
        english
          ? `- Impact: ${fact.whyItMatters}${inlineCitation}`
          : `- 영향: ${fact.whyItMatters}${inlineCitation}`
      );
    }
    if (effectiveDate) {
      lines.push(
        english
          ? `- Date: ${effectiveDate}${inlineCitation}`
          : `- 날짜: ${effectiveDate}${inlineCitation}`
      );
    }
    const sourceLinks = fact.sourceUrls.slice(0, 3).map((url, linkIndex) =>
      english ? `[source ${linkIndex + 1}](${url})` : `[출처 ${linkIndex + 1}](${url})`
    );
    lines.push(
      english
        ? `- Evidence: ${sourceLinks.join(', ')}`
        : `- 근거: ${sourceLinks.join(', ')}`
    );
  }

  const referencedUrls = dedupe(facts.flatMap((fact) => fact.sourceUrls));
  lines.push('');
  lines.push('Sources:');
  for (const url of referencedUrls) {
    lines.push(`- ${linkForSource(url, byUrl)}`);
  }

  return lines.join('\n');
}
