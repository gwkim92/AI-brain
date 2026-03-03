import { scoreRetrievalItem, type RetrievalRankingScores } from './ranker';

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
};

const RSS_FETCH_TIMEOUT_MS = 4500;
const GOOGLE_NEWS_SEARCH_URL = 'https://news.google.com/rss/search';
const GOOGLE_NEWS_TOP_FEEDS = [
  'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko',
  'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en'
];
const CURATED_NEWS_FALLBACK_FEEDS = [
  'https://feeds.bbci.co.uk/news/rss.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
  'https://www.aljazeera.com/xml/rss/all.xml',
  'https://www.yna.co.kr/rss/news.xml'
];

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
  return parseGoogleNewsRss(xml);
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

export async function retrieveWebEvidence(input: RetrieveWebEvidenceInput): Promise<RetrievalEvidencePack> {
  const maxItems = Math.max(3, Math.min(input.maxItems ?? 8, 20));
  const perQueryLimit = Math.max(3, Math.min(input.perQueryLimit ?? 6, 10));
  const rewrittenQueries = Array.from(
    new Set([input.prompt.trim(), ...(input.rewrittenQueries ?? []).map((item) => item.trim())].filter(Boolean))
  ).slice(0, 4);

  const merged = new Map<string, GoogleNewsRssItem>();
  const queryResults = await Promise.all(rewrittenQueries.map(async (query) => ({ query, items: await fetchGoogleNewsRss(query) })));
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

  const needsTopFeedBackfill = merged.size < Math.max(4, maxItems) || countDomains(merged.values()) < 2;
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

  const needsCuratedBackfill = merged.size < Math.max(4, maxItems) || countDomains(merged.values()) < 2;
  const nonGoogleCount = countNonGoogleItems(merged.values());
  const needsNonGoogleBackfill = nonGoogleCount < Math.max(2, Math.floor(maxItems / 2));
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
        domainCounts
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

  const sources = selected.map((item) => ({
    url: item.url,
    title: item.title,
    domain: item.domain,
    snippet: item.snippet,
    publishedAt: item.publishedAt
  }));

  return {
    query: input.prompt.trim(),
    rewrittenQueries,
    items: selected,
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
