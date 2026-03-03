import type { GroundingDecision } from './policy-router';

export type GroundingSource = {
  url: string;
  title: string;
  domain: string;
  snippet?: string;
  publishedAt?: string;
};

export type GroundingClaim = {
  claimText: string;
  sourceUrls: string[];
};

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/giu;
const PLAIN_URL_PATTERN = /\bhttps?:\/\/[^\s<>()]+/giu;
const SOURCE_HEADING_PATTERN = /^#{0,3}\s*sources?\s*:?\s*$/iu;
const SOURCE_LIST_ONLY_PATTERN = /^[-*]\s*(?:\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+)\s*$/iu;
const TOKEN_PATTERN = /[a-z0-9가-힣]{2,}/giu;
const ALIGNMENT_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'after',
  'before',
  'during',
  'under',
  'over',
  'into',
  'onto',
  'about',
  'latest',
  'today',
  'news',
  'update',
  'briefing'
]);

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

function toDomain(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return 'unknown';
  }
}

function extractNormalizedUrlsFromText(value: string, maxUrls = 10): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const markdownPattern = new RegExp(MARKDOWN_LINK_PATTERN.source, MARKDOWN_LINK_PATTERN.flags);
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownPattern.exec(value)) !== null) {
    const normalized = normalizeUrl(markdownMatch[2] ?? '');
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= maxUrls) {
      return urls;
    }
  }

  const plainPattern = new RegExp(PLAIN_URL_PATTERN.source, PLAIN_URL_PATTERN.flags);
  let plainMatch: RegExpExecArray | null;
  while ((plainMatch = plainPattern.exec(value)) !== null) {
    const normalized = normalizeUrl(plainMatch[0] ?? '');
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= maxUrls) {
      break;
    }
  }

  return urls;
}

function tokenizeForAlignment(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .replace(new RegExp(MARKDOWN_LINK_PATTERN.source, MARKDOWN_LINK_PATTERN.flags), '$1')
    .replace(new RegExp(PLAIN_URL_PATTERN.source, PLAIN_URL_PATTERN.flags), ' ')
    .replace(/[^a-z0-9가-힣\s]/gu, ' ');

  const tokens = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags);
  while ((match = pattern.exec(normalized)) !== null) {
    const token = (match[0] ?? '').trim();
    if (token.length >= 2 && !ALIGNMENT_STOPWORDS.has(token)) {
      tokens.add(token);
    }
  }
  return tokens;
}

function claimSourceAlignmentScore(claimText: string, source: GroundingSource): number {
  const claimTokens = tokenizeForAlignment(claimText);
  if (claimTokens.size === 0) {
    return 0;
  }
  const sourceTokens = tokenizeForAlignment(`${source.title} ${source.snippet ?? ''} ${source.domain}`);
  if (sourceTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of claimTokens) {
    if (sourceTokens.has(token)) {
      overlap += 1;
    }
  }
  const ratio = overlap / claimTokens.size;
  return Math.max(0, Math.min(1, ratio));
}

function selectAlignmentCitationUrls(
  claimText: string,
  sources: GroundingSource[],
  maxCitationsPerClaim: number
): string[] {
  if (sources.length === 0) {
    return [];
  }
  const ranked = sources
    .map((source) => ({
      url: source.url,
      score: claimSourceAlignmentScore(claimText, source)
    }))
    .sort((left, right) => right.score - left.score);

  const selected = ranked
    .filter((row) => row.score >= 0.12)
    .slice(0, Math.max(1, maxCitationsPerClaim))
    .map((row) => row.url);
  return selected;
}

export function extractGroundingSourcesFromText(output: string, maxSources = 8): GroundingSource[] {
  const map = new Map<string, GroundingSource>();
  const markdownPattern = new RegExp(MARKDOWN_LINK_PATTERN.source, MARKDOWN_LINK_PATTERN.flags);
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownPattern.exec(output)) !== null) {
    const title = (markdownMatch[1] ?? '').trim();
    const rawUrl = markdownMatch[2] ?? '';
    const normalizedUrl = normalizeUrl(rawUrl);
    if (!normalizedUrl || map.has(normalizedUrl)) {
      continue;
    }

    map.set(normalizedUrl, {
      url: normalizedUrl,
      title: title.length > 0 ? title : toDomain(normalizedUrl),
      domain: toDomain(normalizedUrl)
    });
    if (map.size >= maxSources) {
      return Array.from(map.values());
    }
  }

  const plainPattern = new RegExp(PLAIN_URL_PATTERN.source, PLAIN_URL_PATTERN.flags);
  let plainMatch: RegExpExecArray | null;
  while ((plainMatch = plainPattern.exec(output)) !== null) {
    const rawUrl = plainMatch[0] ?? '';
    const normalizedUrl = normalizeUrl(rawUrl);
    if (!normalizedUrl || map.has(normalizedUrl)) {
      continue;
    }
    const domain = toDomain(normalizedUrl);
    map.set(normalizedUrl, {
      url: normalizedUrl,
      title: domain,
      domain
    });
    if (map.size >= maxSources) {
      break;
    }
  }

  return Array.from(map.values());
}

export function mergeGroundingSources(
  primary: GroundingSource[],
  secondary: GroundingSource[],
  maxSources = 8
): GroundingSource[] {
  const merged = new Map<string, GroundingSource>();
  for (const source of [...primary, ...secondary]) {
    const normalized = normalizeUrl(source.url);
    if (!normalized || merged.has(normalized)) {
      continue;
    }
    merged.set(normalized, {
      url: normalized,
      title: source.title?.trim() || toDomain(normalized),
      domain: source.domain?.trim() || toDomain(normalized),
      snippet: source.snippet?.trim() || undefined,
      publishedAt: source.publishedAt
    });
    if (merged.size >= maxSources) {
      break;
    }
  }
  return Array.from(merged.values());
}

function buildSourcesSection(sources: GroundingSource[], maxSources = 8): string {
  const rows = sources.slice(0, maxSources).map((source) => `- [${source.title}](${source.url})`);
  if (rows.length === 0) {
    return '';
  }
  return ['Sources:', ...rows].join('\n');
}

export function ensureGroundingSourcesSection(output: string, sources: GroundingSource[], maxSources = 8): string {
  if (sources.length === 0) {
    return output;
  }
  const existing = extractGroundingSourcesFromText(output, maxSources);
  if (existing.length > 0) {
    return output;
  }
  const trimmed = output.trim();
  const sourceSection = buildSourcesSection(sources, maxSources);
  if (!sourceSection) {
    return output;
  }
  return `${trimmed}\n\n${sourceSection}`.trim();
}

function sanitizeClaimText(value: string): string {
  const replacedMarkdown = value.replace(new RegExp(MARKDOWN_LINK_PATTERN.source, MARKDOWN_LINK_PATTERN.flags), '$1');
  const withoutUrls = replacedMarkdown.replace(new RegExp(PLAIN_URL_PATTERN.source, PLAIN_URL_PATTERN.flags), '');
  return withoutUrls
    .replace(/^[-*]\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function extractGroundingClaimsFromText(
  output: string,
  sources: GroundingSource[],
  maxClaims = 8,
  maxCitationsPerClaim = 3
): GroundingClaim[] {
  const normalizedSourceUrls = sources
    .map((source) => normalizeUrl(source.url))
    .filter((url): url is string => Boolean(url));
  const sourceSet = new Set(normalizedSourceUrls);
  if (normalizedSourceUrls.length === 0) {
    return [];
  }

  const claims: GroundingClaim[] = [];
  const seenClaims = new Set<string>();
  const lines = output.split(/\r?\n/u);
  let inSourcesSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      inSourcesSection = false;
      continue;
    }
    if (SOURCE_HEADING_PATTERN.test(line) || /^sources?\s*:/iu.test(line)) {
      inSourcesSection = true;
      continue;
    }
    if (SOURCE_LIST_ONLY_PATTERN.test(line)) {
      continue;
    }
    if (inSourcesSection) {
      continue;
    }

    const claimText = sanitizeClaimText(line);
    if (claimText.length < 18) {
      continue;
    }

    const inlineSourceUrls = extractNormalizedUrlsFromText(line, maxCitationsPerClaim).filter((url) => sourceSet.has(url));
    const citations =
      inlineSourceUrls.length > 0 ? inlineSourceUrls : selectAlignmentCitationUrls(claimText, sources, maxCitationsPerClaim);

    const key = claimText.toLowerCase();
    if (seenClaims.has(key)) {
      continue;
    }
    seenClaims.add(key);
    claims.push({
      claimText,
      sourceUrls: citations
    });
    if (claims.length >= maxClaims) {
      break;
    }
  }

  return claims;
}

export function buildGroundingSystemInstruction(decision: GroundingDecision): string {
  if (!decision.requiresGrounding) {
    return '';
  }

  return [
    'You must provide a grounded answer.',
    'Every major claim must cite at least one web source URL.',
    'Include a "Sources" section with markdown links: - [Title](https://example.com).',
    'If evidence is insufficient, explicitly state uncertainty instead of guessing.'
  ].join('\n');
}

export function mergeSystemPrompt(basePrompt: string | undefined, extraPrompt: string): string | undefined {
  const trimmedExtra = extraPrompt.trim();
  if (!trimmedExtra) {
    return basePrompt;
  }
  const trimmedBase = basePrompt?.trim();
  if (!trimmedBase) {
    return trimmedExtra;
  }
  return `${trimmedBase}\n\n${trimmedExtra}`;
}
