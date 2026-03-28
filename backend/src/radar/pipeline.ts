import { createHash } from 'node:crypto';

import type {
  RadarAutonomyDecisionRecord,
  RadarCorroborationDetail,
  RadarDomainId,
  RadarDomainPosteriorRecord,
  RadarEventRecord,
  RadarEventType,
  RadarExecutionMode,
  RadarItemRecord,
  RadarMetricShock,
  RadarPromotionDecision,
  RadarRecommendationRecord,
  RadarRiskBand,
  RadarSourceMix,
  RadarSourceTier,
  RadarSourceType,
} from '../store/types';

import { clusterPreparedRadarSignals } from './event-clustering';
import { getRadarDomainPack, listRadarDomainPacks } from './domain-packs';

type RadarEvaluationBundle = {
  events: RadarEventRecord[];
  posteriors: RadarDomainPosteriorRecord[];
  autonomyDecisions: RadarAutonomyDecisionRecord[];
  recommendations: RadarRecommendationRecord[];
};

const HIGH_TRUST_NEWS_HOSTS = ['reuters.com', 'apnews.com', 'ft.com', 'wsj.com', 'bloomberg.com'];
const SOCIAL_HOSTS = ['x.com', 'twitter.com', 'reddit.com', 't.co', 'discord.com'];
const FORUM_HOSTS = ['news.ycombinator.com', 'community', 'forum', 'hn.algolia.com'];
const OFFICIAL_HOST_PATTERNS = ['.gov', '.mil', 'sec.gov', 'europa.eu', 'imf.org', 'worldbank.org', 'federalreserve.gov'];
const METRIC_KEYWORDS = ['yield', 'price', 'spread', 'inventory', 'freight', 'rate', 'cpi', 'fx', 'dxy', 'throughput'];
const BOTTLENECK_KEYWORDS = ['strait', 'terminal', 'pipeline', 'insurance', 'freight', 'backlog', 'inventory', 'guidance'];
const SECONDARY_BOTTLENECK_HINTS = ['route', 'contract', 'urgency', 'reroute'];

function hashId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha1').update(value).digest('hex').slice(0, 20)}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 1000) / 1000;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function inferRadarSourceType(input: {
  sourceUrl: string;
  sourceName: string;
  title: string;
  summary: string;
}): RadarSourceType {
  const host = hostOf(input.sourceUrl);
  const haystack = `${input.sourceName} ${input.title} ${input.summary} ${host}`.toLowerCase();
  if (input.sourceUrl.startsWith('ops://')) return 'ops_policy';
  if (/(sec|filing|8-k|10-k|10-q|earnings release)/i.test(haystack)) return 'filing';
  if (/(policy|regulation|rulemaking|government|ministry|treasury|fed|ecb|white house)/i.test(haystack)) return 'policy';
  if (/(freight|shipping|container|throughput|vessel)/i.test(haystack)) return 'freight';
  if (/(inventory|stockpile|storage)/i.test(haystack)) return 'inventory';
  if (/(price|yield|spread|fx|market|equity|bond|commodity)/i.test(haystack)) return 'market_tick';
  if (SOCIAL_HOSTS.some((pattern) => host.includes(pattern))) return 'social';
  if (FORUM_HOSTS.some((pattern) => host.includes(pattern))) return 'forum';
  if (/(blog|substack|newsletter)/i.test(haystack)) return 'blog';
  return 'news';
}

export function inferRadarSourceTier(input: {
  sourceType: RadarSourceType;
  sourceUrl: string;
  sourceName: string;
  trustHint?: string | null;
}): RadarSourceTier {
  const host = hostOf(input.sourceUrl);
  const haystack = `${input.sourceName} ${input.trustHint ?? ''} ${host}`.toLowerCase();
  if (input.sourceType === 'ops_policy') return 'tier_0';
  if (OFFICIAL_HOST_PATTERNS.some((pattern) => host.includes(pattern)) || /(official|government|regulator|sec|filing)/i.test(haystack)) {
    return 'tier_0';
  }
  if (HIGH_TRUST_NEWS_HOSTS.some((pattern) => host.includes(pattern))) return 'tier_1';
  if (input.sourceType === 'social' || input.sourceType === 'forum') return 'tier_3';
  if (/(substack|newsletter|analysis|research|blog)/i.test(haystack)) return 'tier_2';
  return 'tier_1';
}

function extractEntityHints(item: RadarItemRecord): string[] {
  const seeded = item.entityHints ?? [];
  const text = `${item.title} ${item.summary}`.trim();
  const properish = text.match(/\b[A-Z][A-Za-z0-9&.-]{2,}\b/g) ?? [];
  return [...new Set([...seeded, ...properish].map((value) => value.trim()).filter(Boolean))].slice(0, 12);
}

function inferEventType(text: string): RadarEventType {
  const haystack = text.toLowerCase();
  if (/(strike|attack|missile|sanction|hormuz|war|conflict)/i.test(haystack)) return 'geopolitical_flashpoint';
  if (/(policy|regulation|ban|rule|ai act|antitrust|export control)/i.test(haystack)) return 'policy_change';
  if (/(earnings|guidance|outlook|capex|margin)/i.test(haystack)) return 'earnings_guidance';
  if (/(shipping|freight|port|carrier|inventory|backlog|reroute)/i.test(haystack)) return 'supply_chain_shift';
  if (/(yield|rate cut|treasury|inflation|cpi|dxy|fx)/i.test(haystack)) return 'rate_repricing';
  if (/(brent|oil|copper|commodity|inventory draw|mine)/i.test(haystack)) return 'commodity_move';
  return 'general_signal';
}

function buildMetricShocks(item: RadarItemRecord): RadarMetricShock[] {
  const rawMetrics = item.rawMetrics ?? {};
  const entries = Object.entries(rawMetrics).slice(0, 8);
  if (entries.length === 0) {
    const text = `${item.title} ${item.summary}`.toLowerCase();
    const inferred = METRIC_KEYWORDS.filter((token) => text.includes(token)).slice(0, 3);
    return inferred.map((metricKey) => ({
      metricKey,
      value: null,
      unit: null,
      direction: 'unknown',
      observedAt: item.observedAt ?? item.publishedAt ?? null,
    }));
  }
  return entries.map(([metricKey, value]) => ({
    metricKey,
    value: typeof value === 'number' || typeof value === 'string' ? value : null,
    unit: null,
    direction:
      typeof value === 'number' ? (value > 0 ? 'up' : value < 0 ? 'down' : 'flat') : 'unknown',
    observedAt: item.observedAt ?? item.publishedAt ?? null,
  }));
}

function scoreDomainMatches(text: string, entities: string[], eventType: RadarEventType) {
  const haystack = `${text} ${entities.join(' ')}`.toLowerCase();
  const scored = listRadarDomainPacks()
    .map((pack) => {
      const keywordHits = pack.keywordLexicon.filter((token) => haystack.includes(token.toLowerCase()));
      const eventBoost =
        (pack.id === 'geopolitics_energy_lng' && eventType === 'geopolitical_flashpoint') ||
        (pack.id === 'macro_rates_inflation_fx' && eventType === 'rate_repricing') ||
        (pack.id === 'shipping_supply_chain' && eventType === 'supply_chain_shift') ||
        (pack.id === 'policy_regulation_platform_ai' && eventType === 'policy_change') ||
        (pack.id === 'company_earnings_guidance' && eventType === 'earnings_guidance') ||
        (pack.id === 'commodities_raw_materials' && eventType === 'commodity_move');
      const score = clamp01(Math.min(0.95, keywordHits.length * 0.14 + (eventBoost ? 0.22 : 0)));
      return {
        domainId: pack.id,
        score,
        evidenceFeatures: keywordHits.slice(0, 6),
        counterFeatures: score >= 0.55 ? [] : ['low lexical overlap'],
      };
    });

  const hasPositiveScore = scored.some((row) => row.score > 0);
  if (!hasPositiveScore && /\b(candidate|proposal|adopt)\b/i.test(haystack)) {
    return scored
      .map((row) =>
        row.domainId === 'policy_regulation_platform_ai'
          ? {
              ...row,
              score: 0.6,
              evidenceFeatures: ['generic_candidate_signal'],
              counterFeatures: ['weak_domain_fit'],
            }
          : row
      )
      .sort((left, right) => right.score - left.score);
  }

  return scored.sort((left, right) => right.score - left.score);
}

function buildCounterHypothesisFeatures(input: {
  topDomains: Array<{ domainId: RadarDomainId; score: number }>;
  corroboration: number;
  eventType: RadarEventType;
  clusterSize: number;
}): string[] {
  if (input.topDomains.length >= 2) {
    return [`alternate_domain:${input.topDomains[1]?.domainId ?? 'unknown'}`];
  }
  if (input.clusterSize >= 2 && input.corroboration >= 0.7) {
    return ['headline_noise_alternative'];
  }
  if (
    input.corroboration >= 0.6 &&
    (input.eventType === 'geopolitical_flashpoint' ||
      input.eventType === 'policy_change' ||
      input.eventType === 'earnings_guidance' ||
      input.eventType === 'supply_chain_shift')
  ) {
    return ['timing_or_market_overreaction'];
  }
  if (input.eventType === 'general_signal') {
    return ['weak_domain_fit'];
  }
  return [];
}

function aggregateSourceMix(signals: Array<{
  sourceTier: RadarSourceTier;
  sourceType: RadarSourceType;
  metricShocks: RadarMetricShock[];
  item: RadarItemRecord;
}>): {
  sourceMix: RadarSourceMix;
  detail: RadarCorroborationDetail;
} {
  const sourceTiers = [...new Set(signals.map((signal) => signal.sourceTier))];
  const sourceTypes = [...new Set(signals.map((signal) => signal.sourceType))];
  const byTier = signals.reduce<Partial<Record<RadarSourceTier, number>>>((acc, signal) => {
    acc[signal.sourceTier] = (acc[signal.sourceTier] ?? 0) + 1;
    return acc;
  }, {});
  const byType = signals.reduce<Partial<Record<RadarSourceType, number>>>((acc, signal) => {
    acc[signal.sourceType] = (acc[signal.sourceType] ?? 0) + 1;
    return acc;
  }, {});
  const uniqueSourceCount = new Set(signals.map((signal) => hostOf(signal.item.sourceUrl) || signal.item.sourceName)).size;
  const nonSocialSourceCount = signals.filter((signal) => signal.sourceType !== 'social' && signal.sourceType !== 'forum').length;
  const metricRichSignalCount = signals.filter((signal) => {
    const rawMetricCount = Object.keys(signal.item.rawMetrics ?? {}).length;
    return rawMetricCount >= 2 || signal.metricShocks.length >= 2;
  }).length;
  const hasMetricCorroboration =
    signals.filter((signal) => Object.keys(signal.item.rawMetrics ?? {}).length > 0 || signal.metricShocks.length > 0).length >= 2 ||
    metricRichSignalCount >= 1;
  const sourceDiversityScore = clamp01(
    Math.min(0.9, Math.max(0, uniqueSourceCount - 1) * 0.12 + Math.max(0, sourceTypes.length - 1) * 0.1 + Math.max(0, sourceTiers.length - 1) * 0.08)
  );

  return {
    sourceMix: {
      sourceTiers,
      sourceTypes,
      sourceCount: signals.length,
      uniqueSourceCount,
      nonSocialSourceCount,
      byTier,
      byType,
      hasMetricCorroboration,
      diversityScore: sourceDiversityScore,
    },
    detail: {
      sourceCount: signals.length,
      uniqueSourceCount,
      nonSocialSourceCount,
      hasMetricCorroboration,
      sourceTypeDiversity: sourceTypes.length,
      sourceTierDiversity: sourceTiers.length,
    },
  };
}

function describeCorroboration(input: {
  sourceMix: RadarSourceMix;
}): number {
  const tierBase =
    input.sourceMix.sourceTiers.includes('tier_0')
      ? 0.88
      : input.sourceMix.sourceTiers.includes('tier_1')
        ? 0.72
        : input.sourceMix.sourceTiers.includes('tier_2')
          ? 0.56
          : 0.24;
  const sourceBonus = Math.min(0.22, Math.max(0, (input.sourceMix.uniqueSourceCount ?? 1) - 1) * 0.08);
  const nonSocialBonus = (input.sourceMix.nonSocialSourceCount ?? 0) >= 2 ? 0.1 : (input.sourceMix.nonSocialSourceCount ?? 0) >= 1 ? 0.04 : 0;
  const metricBonus = input.sourceMix.hasMetricCorroboration ? 0.08 : 0;
  const socialOnlyPenalty = (input.sourceMix.nonSocialSourceCount ?? 0) === 0 ? 0.16 : 0;
  return clamp01(tierBase + sourceBonus + nonSocialBonus + metricBonus - socialOnlyPenalty);
}

function describeMetricAlignment(signals: Array<{ item: RadarItemRecord; text: string }>): number {
  const rawMetrics = signals.reduce((count, signal) => count + Object.keys(signal.item.rawMetrics ?? {}).length, 0);
  if (rawMetrics > 0) {
    return clamp01(0.45 + Math.min(0.4, rawMetrics * 0.08));
  }
  const text = signals.map((signal) => signal.text).join(' ').toLowerCase();
  const keywordHits = METRIC_KEYWORDS.filter((token) => text.includes(token)).length;
  return clamp01(0.2 + keywordHits * 0.08);
}

function describeBottleneckProximity(text: string): number {
  const haystack = text.toLowerCase();
  const primaryHits = BOTTLENECK_KEYWORDS.filter((token) => haystack.includes(token)).length;
  const secondaryHits = SECONDARY_BOTTLENECK_HINTS.filter((token) => haystack.includes(token)).length;
  return clamp01(0.23 + primaryHits * 0.12 + secondaryHits * 0.06);
}

function describePersistence(input: {
  sourceMix: RadarSourceMix;
  eventType: RadarEventType;
}): number {
  const officialBoost = input.sourceMix.sourceTiers.includes('tier_0') ? 0.28 : input.sourceMix.sourceTiers.includes('tier_1') ? 0.12 : 0;
  const typeBoost =
    input.eventType === 'policy_change' || input.eventType === 'earnings_guidance'
      ? 0.28
      : input.eventType === 'geopolitical_flashpoint'
        ? 0.22
        : input.eventType === 'supply_chain_shift'
          ? 0.18
          : 0.14;
  return clamp01(0.22 + officialBoost + typeBoost);
}

function describeNovelty(signals: Array<{ item: RadarItemRecord }>, eventType: RadarEventType, nowIso?: string): number {
  const latestPublishedAt = signals
    .map((signal) => (signal.item.publishedAt ? Date.parse(signal.item.publishedAt) : NaN))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
  const baseNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const ageHours = Number.isFinite(latestPublishedAt) ? Math.max(0, (baseNowMs - latestPublishedAt) / 3_600_000) : 12;
  const freshnessWindowHours =
    eventType === 'geopolitical_flashpoint' || eventType === 'policy_change' ? 7 * 24 : 48;
  const recency = clamp01(1 - Math.min(1, ageHours / freshnessWindowHours));
  const typeBoost = eventType === 'geopolitical_flashpoint' || eventType === 'policy_change' ? 0.18 : 0;
  const sourceBonus = signals.length >= 2 ? Math.min(0.14, signals.length * 0.03) : 0;
  return clamp01(0.28 + recency * 0.44 + typeBoost + sourceBonus);
}

function describeActionability(packId: RadarDomainId, signals: Array<{ item: RadarItemRecord }>, entities: string[]): number {
  const pack = getRadarDomainPack(packId);
  if (!pack) return 0;
  const assetSignals = pack.watchMetrics.length > 0 ? 0.22 : 0;
  const entityBoost = entities.length > 0 ? Math.min(0.28, entities.length * 0.06) : 0;
  const metricBoost =
    signals.reduce((count, signal) => count + Object.keys(signal.item.rawMetrics ?? {}).length, 0) > 0 ? 0.2 : 0.08;
  return clamp01(0.22 + assetSignals + entityBoost + metricBoost);
}

function decidePromotion(input: {
  topScore: number;
  corroboration: number;
  structurality: number;
  actionability: number;
  sourceMix: RadarSourceMix;
  hasExpectedNextSignals: boolean;
  hasCounterHypothesis: boolean;
}): RadarPromotionDecision {
  const socialOnly = (input.sourceMix.nonSocialSourceCount ?? 0) === 0;
  if (input.topScore < 0.55) return 'ignore';
  if (socialOnly && input.corroboration < 0.45) return input.structurality >= 0.45 ? 'watch' : 'ignore';
  if (input.structurality < 0.45) return 'ignore';
  if (input.structurality < 0.7) return 'watch';
  if (!input.hasCounterHypothesis) return 'dossier';
  if (input.structurality >= 0.8 && input.actionability >= 0.72 && input.hasExpectedNextSignals) {
    return 'execute_auto_candidate';
  }
  if (input.structurality >= 0.78 && input.actionability >= 0.72) return 'action';
  return 'dossier';
}

function deriveRiskBand(input: {
  sourceMix: RadarSourceMix;
  promotionDecision: RadarPromotionDecision;
}): RadarRiskBand {
  if ((input.sourceMix.nonSocialSourceCount ?? 0) === 0 && input.sourceMix.sourceTiers.includes('tier_3')) return 'high';
  if (input.promotionDecision === 'execute_auto_candidate') return 'medium';
  if (input.promotionDecision === 'action') return 'medium';
  return 'low';
}

function deriveExecutionMode(input: {
  sourceMix: RadarSourceMix;
  promotionDecision: RadarPromotionDecision;
  hasExpectedNextSignals: boolean;
}): RadarExecutionMode {
  if (input.promotionDecision === 'ignore' || input.promotionDecision === 'watch') return 'watch_only';
  if (input.promotionDecision === 'dossier') return 'dossier_only';
  if (input.promotionDecision === 'action') return 'proposal_auto';
  if ((input.sourceMix.nonSocialSourceCount ?? 0) === 0 || !input.hasExpectedNextSignals) return 'approval_required';
  return 'execute_auto';
}

function levelFromScore(score: number): string {
  if (score >= 0.8) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

export function buildRadarEvaluationBundle(input: {
  items: RadarItemRecord[];
  now?: string;
}): RadarEvaluationBundle {
  const now = input.now ?? new Date().toISOString();
  const preparedSignals = input.items.map((item) => {
    const sourceType = item.sourceType ?? inferRadarSourceType(item);
    const sourceTier = item.sourceTier ?? inferRadarSourceTier({
      sourceType,
      sourceUrl: item.sourceUrl,
      sourceName: item.sourceName,
      trustHint: item.trustHint ?? null,
    });
    const text = `${item.title} ${item.summary}`.trim();
    return {
      item: { ...item, sourceType, sourceTier },
      sourceType,
      sourceTier,
      entities: extractEntityHints(item),
      text,
      eventType: inferEventType(text),
      metricShocks: buildMetricShocks(item),
      publishedMs: item.publishedAt ? Date.parse(item.publishedAt) : null,
    };
  });

  const clusters = clusterPreparedRadarSignals(preparedSignals);
  const events: RadarEventRecord[] = [];
  const posteriors: RadarDomainPosteriorRecord[] = [];
  const autonomyDecisions: RadarAutonomyDecisionRecord[] = [];
  const recommendations: RadarRecommendationRecord[] = [];

  for (const cluster of clusters) {
    const representative = [...cluster.signals].sort((left, right) => right.item.confidenceScore - left.item.confidenceScore)[0] ?? cluster.signals[0];
    if (!representative) {
      continue;
    }
    const sourceSummary = aggregateSourceMix(cluster.signals);
    const entities = [...new Set(cluster.signals.flatMap((signal) => signal.entities))].slice(0, 24);
    const combinedText = cluster.signals.map((signal) => signal.text).join(' ');
    const eventType = representative.eventType;
    const domainScores = scoreDomainMatches(combinedText, entities, eventType);
    const topDomains = domainScores.filter((row) => row.score >= 0.55).slice(0, 3);
    const topPack = topDomains[0]?.domainId ?? domainScores[0]?.domainId ?? 'policy_regulation_platform_ai';
    const corroboration = describeCorroboration({ sourceMix: sourceSummary.sourceMix });
    const metricAlignment = describeMetricAlignment(cluster.signals);
    const bottleneck = describeBottleneckProximity(combinedText);
    const persistence = describePersistence({ sourceMix: sourceSummary.sourceMix, eventType });
    const novelty = describeNovelty(cluster.signals, eventType, now);
    const socialOnlyPenalty = (sourceSummary.sourceMix.nonSocialSourceCount ?? 0) === 0 ? 0.1 : 0;
    const officialSignalBonus = sourceSummary.sourceMix.sourceTiers.includes('tier_0')
      ? 0.04
      : sourceSummary.sourceMix.sourceTiers.includes('tier_1')
        ? 0.02
        : 0;
    const structurality = clamp01(
      corroboration * 0.25 +
        metricAlignment * 0.2 +
        bottleneck * 0.2 +
        persistence * 0.2 +
        novelty * 0.15 +
        officialSignalBonus +
        (sourceSummary.sourceMix.diversityScore ?? 0) * 0.08 -
        socialOnlyPenalty
    );
    const actionability = describeActionability(topPack, cluster.signals, entities);
    const expectedNextSignals = (getRadarDomainPack(topPack)?.watchMetrics ?? []).slice(0, 4);
    const counterHypothesisFeatures = buildCounterHypothesisFeatures({
      topDomains,
      corroboration,
      eventType,
      clusterSize: cluster.signals.length,
    });
    const hasCounterHypothesis = counterHypothesisFeatures.length > 0;
    const promotionDecision = decidePromotion({
      topScore: topDomains[0]?.score ?? 0,
      corroboration,
      structurality,
      actionability,
      sourceMix: sourceSummary.sourceMix,
      hasExpectedNextSignals: expectedNextSignals.length > 0,
      hasCounterHypothesis,
    });
    const executionMode = deriveExecutionMode({
      sourceMix: sourceSummary.sourceMix,
      promotionDecision,
      hasExpectedNextSignals: expectedNextSignals.length > 0,
    });
    const riskBand = deriveRiskBand({ sourceMix: sourceSummary.sourceMix, promotionDecision });
    const latestPublished = cluster.signals
      .map((signal) => signal.item.publishedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0];
    const clusterId = hashId(
      'cluster',
      `${eventType}|${entities.slice(0, 6).join('|')}|${latestPublished?.slice(0, 10) ?? 'na'}`
    );
    const eventId = hashId('evt', `${clusterId}|${cluster.signals.map((signal) => signal.item.id).sort().join('|')}`);
    const metricShocks = cluster.signals.flatMap((signal) => signal.metricShocks).slice(0, 20);

    const event: RadarEventRecord = {
      id: eventId,
      title: representative.item.title,
      summary:
        cluster.signals.length > 1
          ? `${representative.item.summary || representative.item.title} (${cluster.signals.length} signals)`
          : representative.item.summary || representative.item.title,
      eventType,
      geoScope: entities.find((value) => /iran|israel|europe|us|china|middle east/i.test(value)) ?? null,
      timeScope: latestPublished ? latestPublished.slice(0, 10) : null,
      dedupeClusterId: clusterId,
      primaryItemId: representative.item.id,
      clusterSize: cluster.signals.length,
      itemIds: cluster.signals.map((signal) => signal.item.id),
      entities,
      claims: [...new Set(cluster.signals.flatMap((signal) => [signal.item.title, signal.item.summary].filter(Boolean)))],
      metricShocks,
      sourceMix: sourceSummary.sourceMix,
      sourceDiversityScore: sourceSummary.sourceMix.diversityScore ?? 0,
      corroborationDetail: sourceSummary.detail,
      noveltyScore: novelty,
      corroborationScore: corroboration,
      metricAlignmentScore: metricAlignment,
      bottleneckProximityScore: bottleneck,
      persistenceScore: persistence,
      structuralityScore: structurality,
      actionabilityScore: actionability,
      decision: promotionDecision,
      overrideDecision: null,
      expectedNextSignals,
      acknowledgedAt: null,
      acknowledgedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    events.push(event);

    for (const posterior of topDomains) {
      posteriors.push({
        id: hashId('posterior', `${eventId}|${posterior.domainId}`),
        eventId,
        domainId: posterior.domainId,
        score: posterior.score,
        evidenceFeatures: posterior.evidenceFeatures,
        counterFeatures:
          posterior.counterFeatures.length > 0
            ? posterior.counterFeatures
            : posterior.domainId === topPack
              ? counterHypothesisFeatures
              : ['secondary_domain_weaker_fit'],
        recommendedPackId: posterior.domainId,
        createdAt: now,
      });
    }

    autonomyDecisions.push({
      id: hashId('autonomy', eventId),
      eventId,
      riskBand,
      executionMode,
      policyReasons: [
        `source_tiers:${sourceSummary.sourceMix.sourceTiers.join(',')}`,
        `promotion:${promotionDecision}`,
        `structurality:${structurality.toFixed(2)}`,
        `actionability:${actionability.toFixed(2)}`,
      ],
      requiresHuman: executionMode === 'approval_required',
      killSwitchScope: (sourceSummary.sourceMix.nonSocialSourceCount ?? 0) === 0 ? 'source_tier' : 'none',
      createdAt: now,
      updatedAt: now,
    });

    recommendations.push({
      id: hashId('rec', `${eventId}|${representative.item.id}`),
      itemId: representative.item.id,
      decision: promotionDecision === 'ignore' ? 'discard' : promotionDecision === 'watch' ? 'hold' : 'adopt',
      totalScore: Math.round((structurality * 3 + actionability * 2) * 100) / 100,
      expectedBenefit: levelFromScore(actionability),
      migrationCost: promotionDecision === 'execute_auto_candidate' ? 'low' : promotionDecision === 'action' ? 'medium' : 'low',
      riskLevel: levelFromScore(riskBand === 'critical' ? 0.95 : riskBand === 'high' ? 0.8 : riskBand === 'medium' ? 0.58 : 0.28),
      evaluatedAt: now,
      eventId,
      structuralityScore: structurality,
      actionabilityScore: actionability,
      promotionDecision,
      domainIds: topDomains.map((row) => row.domainId),
      autonomyExecutionMode: executionMode,
      autonomyRiskBand: riskBand,
    });
  }

  return {
    events,
    posteriors,
    autonomyDecisions,
    recommendations,
  };
}
