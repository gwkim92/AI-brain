import type {
  RadarEventType,
  RadarItemRecord,
  RadarMetricShock,
  RadarSourceTier,
  RadarSourceType,
} from '../store/types';

export type PreparedRadarSignal = {
  item: RadarItemRecord;
  sourceType: RadarSourceType;
  sourceTier: RadarSourceTier;
  entities: string[];
  text: string;
  eventType: RadarEventType;
  metricShocks: RadarMetricShock[];
  publishedMs: number | null;
};

export type RadarItemCluster = {
  signals: PreparedRadarSignal[];
};

function toTokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function setOverlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }
  return count;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const overlap = setOverlap(left, right);
  const union = new Set([...left, ...right]).size;
  return overlap / Math.max(1, union);
}

function overlapsWithin24Hours(left: number | null, right: number | null): boolean {
  if (left === null || right === null) {
    return true;
  }
  return Math.abs(left - right) <= 24 * 60 * 60 * 1000;
}

function signalMatchesCluster(signal: PreparedRadarSignal, cluster: RadarItemCluster): boolean {
  const representative = cluster.signals[0];
  if (!representative || signal.eventType !== representative.eventType) {
    return false;
  }
  if (!cluster.signals.some((existing) => overlapsWithin24Hours(signal.publishedMs, existing.publishedMs))) {
    return false;
  }

  const signalEntitySet = new Set(signal.entities.map((value) => value.toLowerCase()));
  const clusterEntitySet = new Set(cluster.signals.flatMap((row) => row.entities.map((value) => value.toLowerCase())));
  if (setOverlap(signalEntitySet, clusterEntitySet) < 2) {
    return false;
  }

  const titleSimilarity = jaccard(toTokenSet(signal.item.title), toTokenSet(representative.item.title));
  const claimSimilarity = jaccard(toTokenSet(signal.text), toTokenSet(cluster.signals.map((row) => row.text).join(' ')));
  return titleSimilarity >= 0.18 && claimSimilarity >= 0.12;
}

export function clusterPreparedRadarSignals(signals: PreparedRadarSignal[]): RadarItemCluster[] {
  const sorted = [...signals].sort((left, right) => {
    const leftScore = Date.parse(left.item.publishedAt ?? '') || 0;
    const rightScore = Date.parse(right.item.publishedAt ?? '') || 0;
    return rightScore - leftScore;
  });
  const clusters: RadarItemCluster[] = [];

  for (const signal of sorted) {
    const match = clusters.find((cluster) => signalMatchesCluster(signal, cluster));
    if (match) {
      match.signals.push(signal);
      continue;
    }
    clusters.push({ signals: [signal] });
  }

  return clusters;
}
