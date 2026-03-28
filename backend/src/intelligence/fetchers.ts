import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  IntelligenceSourceCursorRecord,
  IntelligenceSourceRecord,
} from '../store/types';
import { fetchRadarFeed } from '../radar/feed-fetchers';

export type IntelligenceFetchedDocument = {
  sourceUrl: string;
  canonicalUrl: string;
  documentIdentityKey: string;
  title: string;
  summary: string;
  rawText: string;
  rawHtml: string | null;
  publishedAt: string | null;
  observedAt: string | null;
  language: string | null;
  sourceType: IntelligenceSourceRecord['sourceType'];
  sourceTier: IntelligenceSourceRecord['sourceTier'];
  entityHints: string[];
  rawMetrics: Record<string, unknown>;
  trustHint: string | null;
  metadataJson: Record<string, unknown>;
  documentFingerprint: string;
};

type BrowserFetchResult = {
  statusCode: number;
  finalUrl: string;
  html: string;
  title?: string | null;
};

type BrowserFetchImpl = (input: { url: string; timeoutMs: number }) => Promise<BrowserFetchResult>;

export type IntelligenceFetchResult = {
  documents: IntelligenceFetchedDocument[];
  cursor: {
    cursor?: string | null;
    etag?: string | null;
    lastModified?: string | null;
    lastSeenPublishedAt?: string | null;
    lastFetchedAt?: string | null;
  };
  fetchMeta: {
    statusCode: number | null;
    notModified: boolean;
    failed?: boolean;
    blockedByRobots?: boolean;
    latencyMs?: number | null;
    usedHeadless?: boolean;
    searchCandidateCount?: number;
    failureReason?: string | null;
  };
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string, fallback: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  return title || fallback;
}

function extractMetaDescription(html: string): string {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return match?.[1]?.trim() ?? '';
}

function canonicalizeUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = '';
    return url.toString();
  } catch {
    return input;
  }
}

function fingerprintDocument(input: {
  canonicalUrl: string;
  title: string;
}): string {
  return createHash('sha1')
    // Search/community sources often replay the same canonical article with a newer observed/published time.
    // Fingerprints must stay stable across those re-observations.
    .update(`${input.canonicalUrl}|${input.title}`)
    .digest('hex');
}

function normalizeIdentityPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s./:]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDocumentIdentityKey(input: { canonicalUrl: string; sourceUrl: string; title: string }): string {
  const canonicalUrl = input.canonicalUrl.trim();
  if (canonicalUrl.length > 0) return canonicalUrl;
  return `${input.sourceUrl.trim()}|${normalizeIdentityPart(input.title)}`;
}

function getSourceHost(source: IntelligenceSourceRecord, url = source.url): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function domainAllowed(policy: IntelligenceSourceRecord['crawlPolicy'], url: string): boolean {
  const host = getSourceHost({ ...({} as IntelligenceSourceRecord), url } as IntelligenceSourceRecord, url);
  if (!host) return true;
  const deny = policy.denyDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (deny) return false;
  if (policy.allowDomains.length === 0) return true;
  return policy.allowDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function detectLanguage(input: string): string | null {
  if (!input.trim()) return null;
  return /[가-힣]/u.test(input) ? 'ko' : 'en';
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of urls) {
    const canonical = canonicalizeUrl(value);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    output.push(canonical);
  }
  return output;
}

function parseParserConfigArray(root: unknown, pathSpec: unknown): unknown[] {
  if (!pathSpec || typeof pathSpec !== 'string') return Array.isArray(root) ? root : [];
  const keys = pathSpec.split('.').map((part) => part.trim()).filter(Boolean);
  let current: unknown = root;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return [];
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : [];
}

function extractCandidateUrlsFromJson(payload: unknown, source: IntelligenceSourceRecord): string[] {
  const parser = source.parserConfigJson ?? {};
  const items = parseParserConfigArray(payload, parser.itemsPath ?? 'items');
  const urlField = typeof parser.urlField === 'string' ? parser.urlField : 'url';
  const urls: string[] = [];
  for (const row of items) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const value = (row as Record<string, unknown>)[urlField];
    if (typeof value === 'string' && value.trim().length > 0) urls.push(value);
  }
  return uniqueUrls(urls);
}

function extractCandidateUrlsFromHtml(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const regex = /<a[^>]+href=["']([^"'#]+)["']/giu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      urls.push(new URL(raw, baseUrl).toString());
    } catch {
      continue;
    }
    if (urls.length >= 50) break;
  }
  return uniqueUrls(urls);
}

function mapRadarDocuments(source: IntelligenceSourceRecord, fetched: Awaited<ReturnType<typeof fetchRadarFeed>>): IntelligenceFetchedDocument[] {
  return fetched.items.map((item) => {
    const canonicalUrl = canonicalizeUrl(item.sourceUrl);
    return {
      sourceUrl: item.sourceUrl,
      canonicalUrl,
      documentIdentityKey: buildDocumentIdentityKey({
        canonicalUrl,
        sourceUrl: item.sourceUrl,
        title: item.title,
      }),
      title: item.title,
      summary: item.summary ?? '',
      rawText: `${item.title}\n\n${item.summary ?? ''}`.trim(),
      rawHtml: null,
      publishedAt: item.publishedAt ?? null,
      observedAt: item.observedAt ?? item.publishedAt ?? null,
      language: null,
      sourceType: source.sourceType,
      sourceTier: source.sourceTier,
      entityHints: [...(item.entityHints ?? []), ...source.entityHints],
      rawMetrics: { ...(item.rawMetrics ?? {}) },
      trustHint: item.trustHint ?? null,
      metadataJson: { fetched_from: source.kind },
      documentFingerprint: fingerprintDocument({ canonicalUrl, title: item.title }),
    };
  });
}

const requireFromHere = createRequire(import.meta.url);

async function loadPlaywright(): Promise<BrowserFetchImpl | null> {
  const candidatePaths = [
    path.resolve(process.cwd(), 'node_modules', 'playwright'),
    path.resolve(process.cwd(), '..', 'web', 'node_modules', 'playwright'),
    path.resolve(process.cwd(), 'web', 'node_modules', 'playwright'),
  ];
  for (const candidate of candidatePaths) {
    try {
      const resolved = requireFromHere.resolve(candidate);
      const mod = await import(pathToFileURL(resolved).href);
      const playwright = (mod.default ?? mod) as { chromium?: { launch: (options?: Record<string, unknown>) => Promise<unknown> } };
      if (!playwright.chromium?.launch) continue;
      return async ({ url, timeoutMs }) => {
        const browser = await playwright.chromium!.launch({ headless: true });
        const browserApi = browser as {
          newPage: (options?: Record<string, unknown>) => Promise<{
            goto: (pageUrl: string, options?: Record<string, unknown>) => Promise<{ status: () => number } | null>;
            content: () => Promise<string>;
            title: () => Promise<string>;
            url: () => string;
            close: () => Promise<void>;
          }>;
          close: () => Promise<void>;
        };
        const page = await browserApi.newPage();
        try {
          const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
          const html = await page.content();
          const title = await page.title();
          return {
            statusCode: response?.status() ?? 200,
            finalUrl: page.url(),
            html,
            title,
          };
        } finally {
          await page.close().catch(() => undefined);
          await browserApi.close().catch(() => undefined);
        }
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchRobotsTxt(input: {
  url: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<string | null> {
  try {
    const origin = new URL(input.url).origin;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(500, input.timeoutMs));
    try {
      const response = await input.fetchImpl(`${origin}/robots.txt`, { signal: controller.signal });
      if (!response.ok) return null;
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function robotsAllows(url: string, robotsText: string | null): boolean {
  if (!robotsText) return true;
  let inGlobal = false;
  const disallowRules: string[] = [];
  const allowRules: string[] = [];
  for (const rawLine of robotsText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [directiveRaw, ...rest] = line.split(':');
    const directive = directiveRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (directive === 'user-agent') {
      inGlobal = value === '*';
      continue;
    }
    if (!inGlobal) continue;
    if (directive === 'disallow' && value) disallowRules.push(value);
    if (directive === 'allow' && value) allowRules.push(value);
  }
  const pathName = (() => {
    try {
      return new URL(url).pathname || '/';
    } catch {
      return '/';
    }
  })();
  for (const allow of allowRules) {
    if (pathName.startsWith(allow)) return true;
  }
  for (const disallow of disallowRules) {
    if (pathName.startsWith(disallow)) return false;
  }
  return true;
}

async function fetchHtmlDocument(input: {
  url: string;
  source: IntelligenceSourceRecord;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  browserFetch?: BrowserFetchImpl | null;
  useHeadless: boolean;
}): Promise<{ document: IntelligenceFetchedDocument; statusCode: number; usedHeadless: boolean }> {
  const source = input.source;
  const shouldUseHeadless = input.useHeadless && Boolean(input.browserFetch);
  if (shouldUseHeadless && input.browserFetch) {
    const browserResult = await input.browserFetch({ url: input.url, timeoutMs: input.timeoutMs });
    const canonicalUrl = canonicalizeUrl(browserResult.finalUrl || input.url);
    const summary = extractMetaDescription(browserResult.html);
    const rawText = stripHtml(browserResult.html).slice(0, 20_000);
    const title = browserResult.title?.trim() || extractTitle(browserResult.html, source.name);
    return {
      document: {
        sourceUrl: input.url,
        canonicalUrl,
        documentIdentityKey: buildDocumentIdentityKey({
          canonicalUrl,
          sourceUrl: input.url,
          title,
        }),
        title,
        summary,
        rawText,
        rawHtml: browserResult.html.slice(0, 60_000),
        publishedAt: null,
        observedAt: new Date().toISOString(),
        language: detectLanguage(rawText),
        sourceType: source.sourceType,
        sourceTier: source.sourceTier,
        entityHints: [...source.entityHints],
        rawMetrics: {},
        trustHint: source.sourceTier,
        metadataJson: { fetched_from: source.kind, status_code: browserResult.statusCode, used_headless: true },
        documentFingerprint: fingerprintDocument({ canonicalUrl, title }),
      },
      statusCode: browserResult.statusCode,
      usedHeadless: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, input.timeoutMs));
  try {
    const response = await input.fetchImpl(input.url, { signal: controller.signal });
    const html = await response.text();
    const canonicalUrl = canonicalizeUrl(input.url);
    const title = extractTitle(html, source.name);
    const summary = extractMetaDescription(html);
    const rawText = stripHtml(html).slice(0, 20_000);
    return {
      document: {
        sourceUrl: input.url,
        canonicalUrl,
        documentIdentityKey: buildDocumentIdentityKey({
          canonicalUrl,
          sourceUrl: input.url,
          title,
        }),
        title,
        summary,
        rawText,
        rawHtml: html.slice(0, 60_000),
        publishedAt: null,
        observedAt: new Date().toISOString(),
        language: detectLanguage(rawText),
        sourceType: source.sourceType,
        sourceTier: source.sourceTier,
        entityHints: [...source.entityHints],
        rawMetrics: {},
        trustHint: source.sourceTier,
        metadataJson: { fetched_from: source.kind, status_code: response.status, used_headless: false },
        documentFingerprint: fingerprintDocument({ canonicalUrl, title }),
      },
      statusCode: response.status,
      usedHeadless: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

function allowedSearchCandidates(source: IntelligenceSourceRecord, urls: string[]): string[] {
  const maxPerRun = Math.max(1, source.crawlPolicy.maxPagesPerRun);
  const perDomainBudget = Math.max(1, source.crawlPolicy.perDomainRateLimitPerMinute);
  const domainCounter = new Map<string, number>();
  const output: string[] = [];
  for (const url of urls) {
    if (!domainAllowed(source.crawlPolicy, url)) continue;
    const host = getSourceHost(source, url) ?? 'unknown';
    const count = domainCounter.get(host) ?? 0;
    if (count >= perDomainBudget) continue;
    domainCounter.set(host, count + 1);
    output.push(url);
    if (output.length >= maxPerRun) break;
  }
  return output;
}

export async function fetchIntelligenceSource(input: {
  source: IntelligenceSourceRecord;
  cursor?: IntelligenceSourceCursorRecord | null;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  browserFetchImpl?: BrowserFetchImpl | null;
}): Promise<IntelligenceFetchResult> {
  const startedAt = Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const browserFetch = typeof input.browserFetchImpl === 'undefined' ? await loadPlaywright() : input.browserFetchImpl;
  const source = input.source;
  const shouldCheckRobots =
    source.crawlPolicy.respectRobots &&
    (source.kind === 'search' || source.kind === 'headless' || source.kind === 'api' || source.kind === 'mcp_connector');

  if (source.kind !== 'search' && !domainAllowed(source.crawlPolicy, source.url)) {
    return {
      documents: [],
      cursor: { lastFetchedAt: new Date().toISOString() },
      fetchMeta: {
        statusCode: null,
        notModified: false,
        failed: true,
        blockedByRobots: false,
        latencyMs: Date.now() - startedAt,
        failureReason: 'domain_denied',
      },
    };
  }

  if (shouldCheckRobots) {
    const robotsText = await fetchRobotsTxt({
      url: source.url,
      fetchImpl,
      timeoutMs: Math.min(input.timeoutMs, 4_000),
    });
    if (!robotsAllows(source.url, robotsText)) {
      return {
        documents: [],
        cursor: { lastFetchedAt: new Date().toISOString() },
        fetchMeta: {
          statusCode: null,
          notModified: false,
          failed: true,
          blockedByRobots: true,
          latencyMs: Date.now() - startedAt,
          failureReason: 'robots_blocked',
        },
      };
    }
  }

  if (source.kind === 'rss' || source.kind === 'atom' || source.kind === 'json' || source.kind === 'synthetic') {
    const fetched = await fetchRadarFeed({
      source: {
        id: source.id,
        name: source.name,
        kind: source.kind,
        url: source.url,
        sourceType: source.sourceType === 'search_result' || source.sourceType === 'web_page' ? 'news' : source.sourceType,
        sourceTier: source.sourceTier,
        pollMinutes: source.pollMinutes,
        enabled: source.enabled,
        parserHints: source.parserConfigJson,
        entityHints: source.entityHints,
        metricHints: source.metricHints,
        lastFetchedAt: source.lastFetchedAt,
        lastSuccessAt: source.lastSuccessAt,
        lastError: source.lastError,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      },
      cursor: input.cursor
        ? {
            sourceId: input.cursor.sourceId,
            cursor: input.cursor.cursor,
            etag: input.cursor.etag,
            lastModified: input.cursor.lastModified,
            lastSeenPublishedAt: input.cursor.lastSeenPublishedAt,
            lastFetchedAt: input.cursor.lastFetchedAt,
            updatedAt: input.cursor.updatedAt,
          }
        : null,
      timeoutMs: input.timeoutMs,
      fetchImpl,
    });
    return {
      documents: mapRadarDocuments(source, fetched),
      cursor: fetched.cursor,
      fetchMeta: {
        ...fetched.fetchMeta,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  if (source.kind === 'search') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, input.timeoutMs));
    try {
      const response = await fetchImpl(source.url, { signal: controller.signal });
      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();
      const candidateUrls = contentType.includes('application/json')
        ? extractCandidateUrlsFromJson(JSON.parse(body), source)
        : extractCandidateUrlsFromHtml(body, source.url);
      const allowedCandidates = allowedSearchCandidates(source, candidateUrls);
      const documents: IntelligenceFetchedDocument[] = [];
      let usedHeadless = false;
      for (const candidateUrl of allowedCandidates) {
        if (source.crawlPolicy.respectRobots) {
          const robotsText = await fetchRobotsTxt({
            url: candidateUrl,
            fetchImpl,
            timeoutMs: Math.min(input.timeoutMs, 4_000),
          });
          if (!robotsAllows(candidateUrl, robotsText)) continue;
        }
        const fetchedDocument = await fetchHtmlDocument({
          url: candidateUrl,
          source,
          timeoutMs: input.timeoutMs,
          fetchImpl,
          browserFetch,
          useHeadless: true,
        });
        usedHeadless = usedHeadless || fetchedDocument.usedHeadless;
        documents.push({
          ...fetchedDocument.document,
          metadataJson: {
            ...fetchedDocument.document.metadataJson,
            search_source_url: source.url,
          },
        });
      }
      return {
        documents,
        cursor: {
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          lastSeenPublishedAt: null,
          lastFetchedAt: new Date().toISOString(),
        },
        fetchMeta: {
          statusCode: response.status,
          notModified: false,
          latencyMs: Date.now() - startedAt,
          usedHeadless,
          searchCandidateCount: allowedCandidates.length,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const fetched = await fetchHtmlDocument({
    url: source.url,
    source,
    timeoutMs: input.timeoutMs,
    fetchImpl,
    browserFetch,
    useHeadless: source.kind === 'headless',
  });
  return {
    documents: [fetched.document],
    cursor: {
      cursor: null,
      etag: null,
      lastModified: null,
      lastSeenPublishedAt: null,
      lastFetchedAt: new Date().toISOString(),
    },
    fetchMeta: {
      statusCode: fetched.statusCode,
      notModified: false,
      latencyMs: Date.now() - startedAt,
      usedHeadless: fetched.usedHeadless,
    },
  };
}
