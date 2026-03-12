import { createHash } from 'node:crypto';

import type { OpsUpgradeProposal } from './ops-policy';
import { inferRadarSourceTier, inferRadarSourceType } from './pipeline';

export type RawRadarSourceItem = {
  title: string;
  summary?: string;
  sourceUrl: string;
  publishedAt?: string;
  observedAt?: string;
  confidenceScore?: number;
  sourceType?: string;
  sourceTier?: string;
  rawMetrics?: Record<string, unknown>;
  entityHints?: string[];
  trustHint?: string;
};

export type NormalizedRadarItem = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: string | null;
  observedAt: string | null;
  confidenceScore: number;
  sourceName: string;
  sourceType: ReturnType<typeof inferRadarSourceType>;
  sourceTier: ReturnType<typeof inferRadarSourceTier>;
  rawMetrics: Record<string, unknown>;
  entityHints: string[];
  trustHint: string | null;
  payload: Record<string, unknown>;
};

export function normalizeRadarItems(sourceName: string, items: RawRadarSourceItem[]): NormalizedRadarItem[] {
  const seen = new Set<string>();
  const normalized: NormalizedRadarItem[] = [];

  for (const item of items) {
    const id = buildItemId(item);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    normalized.push({
      id,
      title: item.title.trim(),
      summary: item.summary?.trim() ?? '',
      sourceUrl: item.sourceUrl,
      publishedAt: normalizeDate(item.publishedAt),
      observedAt: normalizeDate(item.observedAt) ?? normalizeDate(item.publishedAt),
      confidenceScore: normalizeConfidence(item.confidenceScore),
      sourceName,
      sourceType: normalizeSourceType(item.sourceType, {
        sourceUrl: item.sourceUrl,
        sourceName,
        title: item.title,
        summary: item.summary ?? '',
      }),
      sourceTier: normalizeSourceTier(item.sourceTier, {
        sourceType: normalizeSourceType(item.sourceType, {
          sourceUrl: item.sourceUrl,
          sourceName,
          title: item.title,
          summary: item.summary ?? '',
        }),
        sourceUrl: item.sourceUrl,
        sourceName,
        trustHint: item.trustHint ?? null,
      }),
      rawMetrics: { ...(item.rawMetrics ?? {}) },
      entityHints: [...(item.entityHints ?? [])],
      trustHint: item.trustHint?.trim() || null,
      payload: {}
    });
  }

  return normalized;
}

export function appendOpsPolicyItems(
  sourceItems: NormalizedRadarItem[],
  proposals: OpsUpgradeProposal[]
): NormalizedRadarItem[] {
  const mapped: NormalizedRadarItem[] = proposals.map((proposal) => ({
    id: `ops_${proposal.id}`,
    title: proposal.title,
    summary: `${proposal.reason} | action: ${proposal.recommendedAction}`,
    sourceUrl: `ops://runtime/${proposal.id}`,
    publishedAt: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    confidenceScore: proposal.severity === 'critical' ? 1 : proposal.severity === 'high' ? 0.9 : 0.8,
    sourceName: 'ops-policy',
    sourceType: 'ops_policy',
    sourceTier: 'tier_0',
    rawMetrics: {},
    entityHints: [],
    trustHint: 'ops_policy',
    payload: {}
  }));

  return [...sourceItems, ...mapped];
}

function buildItemId(item: RawRadarSourceItem): string {
  const fingerprint = `${item.title}|${item.sourceUrl}|${item.publishedAt ?? ''}`;
  return createHash('sha1').update(fingerprint).digest('hex').slice(0, 16);
}

function normalizeDate(value?: string): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeConfidence(value?: number): number {
  if (value === undefined || value === null) {
    return 0.5;
  }
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0.5;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Math.round(value * 1000) / 1000;
}

function normalizeSourceType(
  value: string | undefined,
  fallback: Parameters<typeof inferRadarSourceType>[0]
): ReturnType<typeof inferRadarSourceType> {
  if (
    value === 'news' ||
    value === 'filing' ||
    value === 'policy' ||
    value === 'market_tick' ||
    value === 'freight' ||
    value === 'inventory' ||
    value === 'blog' ||
    value === 'forum' ||
    value === 'social' ||
    value === 'ops_policy' ||
    value === 'manual'
  ) {
    return value;
  }
  return inferRadarSourceType(fallback);
}

function normalizeSourceTier(
  value: string | undefined,
  fallback: Parameters<typeof inferRadarSourceTier>[0]
): ReturnType<typeof inferRadarSourceTier> {
  if (value === 'tier_0' || value === 'tier_1' || value === 'tier_2' || value === 'tier_3') {
    return value;
  }
  return inferRadarSourceTier(fallback);
}
