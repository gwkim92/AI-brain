import { createHash } from 'node:crypto';

import type { OpsUpgradeProposal } from './ops-policy';

export type RawRadarSourceItem = {
  title: string;
  summary?: string;
  sourceUrl: string;
  publishedAt?: string;
  confidenceScore?: number;
};

export type NormalizedRadarItem = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: string | null;
  confidenceScore: number;
  sourceName: string;
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
      confidenceScore: normalizeConfidence(item.confidenceScore),
      sourceName
    });
  }

  return normalized;
}

export function appendOpsPolicyItems(
  sourceItems: NormalizedRadarItem[],
  proposals: OpsUpgradeProposal[]
): NormalizedRadarItem[] {
  const mapped = proposals.map((proposal) => ({
    id: `ops_${proposal.id}`,
    title: proposal.title,
    summary: `${proposal.reason} | action: ${proposal.recommendedAction}`,
    sourceUrl: `ops://runtime/${proposal.id}`,
    publishedAt: new Date().toISOString(),
    confidenceScore: proposal.severity === 'critical' ? 1 : proposal.severity === 'high' ? 0.9 : 0.8,
    sourceName: 'ops-policy'
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
