import type {
  RadarDomainPosteriorRecord,
  RadarEventRecord,
  RadarItemRecord,
  WorldModelEntityKind,
  WorldModelEventKind,
} from '../store/types';
import type { WorldModelExtraction } from '../world-model/schemas';

function inferEntityKind(value: string): WorldModelEntityKind {
  if (/(iran|israel|china|europe|saudi|uae|qatar|russia|ukraine|us|usa)/i.test(value)) return 'country';
  if (/(terminal|pipeline|plant|port|facility)/i.test(value)) return 'facility';
  if (/(route|strait|hormuz|suez)/i.test(value)) return 'route';
  if (/(oil|lng|gas|brent|copper|commodity)/i.test(value)) return 'commodity';
  if (/(fed|ecb|treasury|policy|act|regulation)/i.test(value)) return 'policy';
  if (/(inc|corp|group|holdings|bank|shipping|energy|platform|ai)/i.test(value)) return 'organization';
  return 'other';
}

function inferEventKind(value: RadarEventRecord['eventType']): WorldModelEventKind {
  if (value === 'geopolitical_flashpoint') return 'geopolitical';
  if (value === 'policy_change') return 'policy';
  if (value === 'earnings_guidance') return 'financial';
  if (value === 'rate_repricing' || value === 'commodity_move') return 'market';
  if (value === 'supply_chain_shift') return 'operational';
  return 'other';
}

function inferChannel(event: RadarEventRecord['eventType']): 'physical' | 'contractual' | 'financial' | 'political' | 'narrative' | 'other' {
  if (event === 'geopolitical_flashpoint' || event === 'policy_change') return 'political';
  if (event === 'rate_repricing' || event === 'commodity_move' || event === 'earnings_guidance') return 'financial';
  if (event === 'supply_chain_shift') return 'physical';
  return 'narrative';
}

export function buildWorldModelExtractionFromRadarEvent(input: {
  event: RadarEventRecord;
  items: RadarItemRecord[];
  posteriors: RadarDomainPosteriorRecord[];
  generatedAt?: string;
}): WorldModelExtraction {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const entityMap = new Map<string, { key: string; canonicalName: string; kind: WorldModelEntityKind }>();
  for (const value of input.event.entities) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = `entity:${trimmed.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`;
    if (!entityMap.has(key)) {
      entityMap.set(key, {
        key,
        canonicalName: trimmed,
        kind: inferEntityKind(trimmed),
      });
    }
  }

  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const sourceUrls = input.items.map((item) => item.sourceUrl);
  const eventChannel = inferChannel(input.event.eventType);
  const entities = [...entityMap.values()].map((entity) => ({
    key: entity.key,
    kind: entity.kind,
    canonicalName: entity.canonicalName,
    aliases: [entity.canonicalName],
    sourceUrls,
    mentionCount: 1,
    epistemicStatus: 'extracted' as const,
  }));

  const claims = input.event.claims.map((claimText, index) => ({
    key: `claim:${index + 1}`,
    text: claimText,
    sourceUrls,
    entityKeys: entities.map((entity) => entity.key),
    eventKeys: [`event:${input.event.id}`],
    channel: eventChannel,
    epistemicStatus: 'extracted' as const,
  }));

  const observations = input.event.metricShocks.map((shock, index) => ({
    key: `observation:${index + 1}`,
    metricKey: shock.metricKey,
    valueText: typeof shock.value === 'string' ? shock.value : shock.value === null ? 'unknown' : String(shock.value),
    unit: shock.unit,
    observedAt: shock.observedAt,
    recordedAt: input.items[0]?.publishedAt ?? null,
    sourceUrls,
    entityKeys: entities.map((entity) => entity.key),
    claimKeys: claims.map((claim) => claim.key),
    channel: eventChannel,
    epistemicStatus: 'extracted' as const,
  }));

  const dominantPosterior = input.posteriors[0]?.domainId ?? 'policy_regulation_platform_ai';

  return {
    schemaVersion: '2026-03-10',
    status: 'candidate',
    generatedAt,
    query: `${input.event.title}\n${input.event.summary}`,
    researchProfile: dominantPosterior === 'company_earnings_guidance' || dominantPosterior === 'macro_rates_inflation_fx'
      ? 'market_research'
      : dominantPosterior === 'policy_regulation_platform_ai'
        ? 'policy_regulation'
        : 'topic_news',
    entities,
    events: [
      {
        key: `event:${input.event.id}`,
        kind: inferEventKind(input.event.eventType),
        summary: input.event.summary,
        occurredAt: input.items[0]?.publishedAt ?? null,
        recordedAt: input.items[0]?.publishedAt ?? null,
        sourceUrls,
        entityKeys: entities.map((entity) => entity.key),
        claimKeys: claims.map((claim) => claim.key),
        channel: eventChannel,
        epistemicStatus: 'extracted',
      },
    ],
    observations,
    claims,
    stats: {
      sourceCount: new Set(sourceUrls).size,
      entityCount: entities.length,
      eventCount: 1,
      observationCount: observations.length,
      claimCount: claims.length,
    },
  };
}
