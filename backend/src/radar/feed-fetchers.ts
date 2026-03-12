import { appendOpsPolicyItems, type RawRadarSourceItem } from './ingest';
import { buildOpsUpgradeProposals } from './ops-policy';

import type { RadarFeedCursorRecord, RadarFeedSourceRecord } from '../store/types';

export type RadarFetchedFeed = {
  items: RawRadarSourceItem[];
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
  };
};

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block: string, tag: string): string | null {
  const patterns = [
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*/>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (match?.[1]) {
      return decodeXmlEntities(match[1].trim());
    }
  }
  return null;
}

function extractLink(block: string): string | null {
  const hrefMatch = block.match(/<link[^>]+href="([^"]+)"[^>]*\/?>/i);
  if (hrefMatch?.[1]) {
    return hrefMatch[1];
  }
  return extractTag(block, 'link');
}

function parseXmlFeed(xml: string, source: RadarFeedSourceRecord): RawRadarSourceItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi) ?? [];
  const items: Array<RawRadarSourceItem | null> = blocks.map((block) => {
      const title = extractTag(block, 'title') ?? '';
      const summary =
        extractTag(block, 'description') ??
        extractTag(block, 'summary') ??
        extractTag(block, 'content') ??
        '';
      const sourceUrl = extractLink(block) ?? source.url;
      const publishedAt =
        extractTag(block, 'pubDate') ??
        extractTag(block, 'published') ??
        extractTag(block, 'updated') ??
        undefined;
      if (!title.trim() || !sourceUrl) {
        return null;
      }
      return {
        title: title.trim(),
        summary: summary.trim(),
        sourceUrl,
        publishedAt,
        sourceType: source.sourceType,
        sourceTier: source.sourceTier,
        entityHints: [...source.entityHints],
        rawMetrics: {},
        trustHint: `${source.name} ${source.sourceTier}`.trim(),
      };
    });
  return items.filter((item): item is RawRadarSourceItem => Boolean(item));
}

function readPath(value: unknown, path: string | undefined): unknown {
  if (!path) {
    return value;
  }
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function parseJsonFeed(payload: unknown, source: RadarFeedSourceRecord): RawRadarSourceItem[] {
  const itemsPath = typeof source.parserHints.itemsPath === 'string' ? source.parserHints.itemsPath : undefined;
  const titleField = typeof source.parserHints.titleField === 'string' ? source.parserHints.titleField : 'title';
  const summaryField = typeof source.parserHints.summaryField === 'string' ? source.parserHints.summaryField : 'summary';
  const urlField = typeof source.parserHints.urlField === 'string' ? source.parserHints.urlField : 'url';
  const publishedAtField =
    typeof source.parserHints.publishedAtField === 'string' ? source.parserHints.publishedAtField : 'published_at';
  const entityHintField =
    typeof source.parserHints.entityHintField === 'string' ? source.parserHints.entityHintField : undefined;
  const rows = readPath(payload, itemsPath) ?? payload;
  if (!Array.isArray(rows)) {
    return [];
  }
  const items: Array<RawRadarSourceItem | null> = rows.map((row) => {
      if (!row || typeof row !== 'object') {
        return null;
      }
      const title = readPath(row, titleField);
      const summary = readPath(row, summaryField);
      const sourceUrl = readPath(row, urlField);
      const publishedAt = readPath(row, publishedAtField);
      const entityHintValue = entityHintField ? readPath(row, entityHintField) : undefined;
      if (typeof title !== 'string' || !title.trim() || typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
        return null;
      }
      return {
        title: title.trim(),
        summary: typeof summary === 'string' ? summary.trim() : '',
        sourceUrl: sourceUrl.trim(),
        publishedAt: typeof publishedAt === 'string' ? publishedAt : undefined,
        sourceType: source.sourceType,
        sourceTier: source.sourceTier,
        entityHints: entityHintValue ? [...source.entityHints, String(entityHintValue)] : [...source.entityHints],
        rawMetrics: {},
        trustHint: `${source.name} ${source.sourceTier}`.trim(),
      };
    });
  return items.filter((item): item is RawRadarSourceItem => Boolean(item));
}

function buildSyntheticOpsItems(source: RadarFeedSourceRecord): RawRadarSourceItem[] {
  const normalized = appendOpsPolicyItems(
    [],
    buildOpsUpgradeProposals({
      node: { currentMajor: 22, preferredMajor: 24, maintenanceMajor: 22 },
      postgres: { currentMinor: 0, latestMinor: 2, outOfCycleSecurityNotice: false },
      valkey: { currentPatch: 0, latestPatch: 2, vulnerabilityNotice: false },
    })
  );
  return normalized.map((item) => ({
    title: item.title,
    summary: item.summary,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt ?? undefined,
    observedAt: item.observedAt ?? undefined,
    confidenceScore: item.confidenceScore,
    sourceType: source.sourceType,
    sourceTier: source.sourceTier,
    entityHints: [...item.entityHints],
    rawMetrics: { ...(item.rawMetrics ?? {}) },
    trustHint: item.trustHint ?? source.name,
  }));
}

export async function fetchRadarFeed(input: {
  source: RadarFeedSourceRecord;
  cursor?: RadarFeedCursorRecord | null;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: string;
}): Promise<RadarFetchedFeed> {
  const now = input.now ?? new Date().toISOString();

  if (input.source.kind === 'synthetic') {
    return {
      items: buildSyntheticOpsItems(input.source),
      cursor: {
        lastFetchedAt: now,
        lastSeenPublishedAt: now,
      },
      fetchMeta: {
        statusCode: 200,
        notModified: false,
      },
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, input.timeoutMs));

  try {
    const headers: Record<string, string> = {};
    if (input.cursor?.etag) {
      headers['If-None-Match'] = input.cursor.etag;
    }
    if (input.cursor?.lastModified) {
      headers['If-Modified-Since'] = input.cursor.lastModified;
    }
    const response = await fetchImpl(input.source.url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (response.status === 304) {
      return {
        items: [],
        cursor: {
          cursor: input.cursor?.cursor ?? null,
          etag: input.cursor?.etag ?? null,
          lastModified: input.cursor?.lastModified ?? null,
          lastSeenPublishedAt: input.cursor?.lastSeenPublishedAt ?? null,
          lastFetchedAt: now,
        },
        fetchMeta: {
          statusCode: 304,
          notModified: true,
        },
      };
    }

    if (!response.ok) {
      throw new Error(`feed fetch failed with ${response.status}`);
    }

    const text = await response.text();
    const items =
      input.source.kind === 'json'
        ? parseJsonFeed(JSON.parse(text), input.source)
        : parseXmlFeed(text, input.source);
    const lastSeenPublishedAt = items
      .map((item) => item.publishedAt ?? null)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? input.cursor?.lastSeenPublishedAt ?? null;

    return {
      items,
      cursor: {
        cursor: null,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        lastSeenPublishedAt,
        lastFetchedAt: now,
      },
      fetchMeta: {
        statusCode: response.status,
        notModified: false,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
