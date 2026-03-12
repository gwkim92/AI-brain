import type { GroundingClaim, GroundingSource } from '../retrieval/grounding';
import { extractEntitySubject, type ResearchProfile } from '../retrieval/research-profile';

import {
  buildCanonicalSourceUrls,
  canonicalizeWorldModelName,
  extractProperNounCandidates,
  extractWorldModelDateCandidate,
  inferObservationMetric,
  inferWorldModelChannel,
  inferWorldModelEntityKind,
  inferWorldModelEventKind,
  mergeUniqueStrings,
  scanLexiconEntities,
  slugifyWorldModelKey,
  worldModelTokenMatchesText,
} from './normalization';
import {
  type WorldModelCandidateClaim,
  type WorldModelCandidateEntity,
  type WorldModelCandidateEvent,
  type WorldModelCandidateObservation,
  type WorldModelExtraction,
  worldModelExtractionSchema,
} from './schemas';

export type WorldModelExtractionInput = {
  query: string;
  researchProfile: ResearchProfile;
  sources: GroundingSource[];
  claims: GroundingClaim[];
  generatedAt?: string;
};

type EntityAccumulator = {
  key: string;
  canonicalName: string;
  kind: WorldModelCandidateEntity['kind'];
  aliases: Set<string>;
  sourceUrls: Set<string>;
  mentionCount: number;
};

function upsertEntity(
  target: Map<string, EntityAccumulator>,
  input: {
    canonicalName: string;
    kind: WorldModelCandidateEntity['kind'];
    aliases?: string[];
    sourceUrls?: string[];
    mentionCount?: number;
  }
) {
  const canonicalName = canonicalizeWorldModelName(input.canonicalName);
  if (!canonicalName) return;
  const key = `entity:${slugifyWorldModelKey(canonicalName)}`;
  const existing = target.get(key);
  if (existing) {
    for (const alias of input.aliases ?? []) existing.aliases.add(alias);
    for (const sourceUrl of input.sourceUrls ?? []) existing.sourceUrls.add(sourceUrl);
    existing.mentionCount += input.mentionCount ?? 1;
    return;
  }
  target.set(key, {
    key,
    canonicalName,
    kind: input.kind,
    aliases: new Set((input.aliases ?? []).filter(Boolean)),
    sourceUrls: new Set((input.sourceUrls ?? []).filter(Boolean)),
    mentionCount: Math.max(1, input.mentionCount ?? 1),
  });
}

function buildClaimContextMap(sources: GroundingSource[]) {
  const byUrl = new Map<string, GroundingSource>();
  for (const source of sources) {
    for (const url of buildCanonicalSourceUrls([source])) {
      byUrl.set(url, source);
    }
  }
  return byUrl;
}

function buildEntities(input: WorldModelExtractionInput): WorldModelCandidateEntity[] {
  const entityMap = new Map<string, EntityAccumulator>();
  const subject = extractEntitySubject(input.query);
  const allTexts = [
    input.query,
    ...(subject ? [subject] : []),
    ...input.claims.map((claim) => claim.claimText),
    ...input.sources.map((source) => `${source.title} ${source.snippet ?? ''}`),
  ];

  for (const match of scanLexiconEntities(allTexts)) {
    upsertEntity(entityMap, {
      canonicalName: match.canonicalName,
      kind: match.kind,
      aliases: match.aliases,
      sourceUrls: buildCanonicalSourceUrls(input.sources),
      mentionCount: match.aliases.length,
    });
  }

  if (subject) {
    upsertEntity(entityMap, {
      canonicalName: subject,
      kind: inferWorldModelEntityKind(subject),
      aliases: [subject],
      sourceUrls: [],
      mentionCount: 1,
    });
  }

  for (const candidate of extractProperNounCandidates(allTexts)) {
    upsertEntity(entityMap, {
      canonicalName: candidate,
      kind: inferWorldModelEntityKind(candidate),
      aliases: [candidate],
      sourceUrls: buildCanonicalSourceUrls(
        input.sources.filter((source) => `${source.title} ${source.snippet ?? ''}`.includes(candidate))
      ),
      mentionCount: 1,
    });
  }

  return [...entityMap.values()]
    .map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      canonicalName: entry.canonicalName,
      aliases: mergeUniqueStrings(entry.aliases),
      sourceUrls: [...entry.sourceUrls].sort((left, right) => left.localeCompare(right)),
      mentionCount: entry.mentionCount,
      epistemicStatus: 'extracted' as const,
    }))
    .sort((left, right) => right.mentionCount - left.mentionCount || left.canonicalName.localeCompare(right.canonicalName))
    .slice(0, 16);
}

function matchEntityKeys(text: string, entities: WorldModelCandidateEntity[]): string[] {
  return entities
    .filter((entity) =>
      [entity.canonicalName, ...entity.aliases].some((token) => token && worldModelTokenMatchesText(token, text))
    )
    .map((entity) => entity.key);
}

function buildClaims(
  claims: GroundingClaim[],
  entities: WorldModelCandidateEntity[]
): WorldModelCandidateClaim[] {
  return claims.map((claim, index) => {
    const normalizedSourceUrls = buildCanonicalSourceUrls(claim.sourceUrls.map((url) => ({ url })));
    const key = `claim:${index + 1}`;
    return {
      key,
      text: claim.claimText.trim(),
      sourceUrls: normalizedSourceUrls,
      entityKeys: matchEntityKeys(claim.claimText, entities),
      eventKeys: [],
      channel: inferWorldModelChannel(claim.claimText),
      epistemicStatus: 'extracted',
    };
  });
}

function buildEvents(input: {
  claims: WorldModelCandidateClaim[];
  sourceLookup: Map<string, GroundingSource>;
}): WorldModelCandidateEvent[] {
  const eventMap = new Map<string, WorldModelCandidateEvent>();
  for (const claim of input.claims) {
    const supportingSource = claim.sourceUrls.map((url) => input.sourceLookup.get(url)).find(Boolean);
    const summary = claim.text;
    const kind = inferWorldModelEventKind(`${summary} ${supportingSource?.title ?? ''}`);
    const key = `event:${kind}:${slugifyWorldModelKey(summary).slice(0, 48)}`;
    const occurredAt =
      extractWorldModelDateCandidate(summary) ??
      extractWorldModelDateCandidate(supportingSource?.publishedAt ?? '') ??
      null;
    const recordedAt = supportingSource?.publishedAt ? extractWorldModelDateCandidate(supportingSource.publishedAt) : null;

    const existing = eventMap.get(key);
    if (existing) {
      existing.sourceUrls = mergeUniqueStrings([...existing.sourceUrls, ...claim.sourceUrls]);
      existing.entityKeys = mergeUniqueStrings([...existing.entityKeys, ...claim.entityKeys]);
      existing.claimKeys = mergeUniqueStrings([...existing.claimKeys, claim.key]);
      continue;
    }

    eventMap.set(key, {
      key,
      kind,
      summary,
      occurredAt,
      recordedAt,
      sourceUrls: [...claim.sourceUrls],
      entityKeys: [...claim.entityKeys],
      claimKeys: [claim.key],
      channel: claim.channel,
      epistemicStatus: 'extracted',
    });
  }
  return [...eventMap.values()];
}

function buildObservations(input: {
  claims: WorldModelCandidateClaim[];
  sourceLookup: Map<string, GroundingSource>;
}): WorldModelCandidateObservation[] {
  const observations: WorldModelCandidateObservation[] = [];
  const seen = new Set<string>();
  for (const claim of input.claims) {
    const supportingSource = claim.sourceUrls.map((url) => input.sourceLookup.get(url)).find(Boolean);
    const sourceText = `${supportingSource?.title ?? ''} ${supportingSource?.snippet ?? ''}`.trim();
    const metric = inferObservationMetric(`${claim.text} ${sourceText}`);
    if (!metric.valueText) continue;
    const key = `observation:${metric.metricKey}:${slugifyWorldModelKey(`${claim.text} ${metric.valueText}`)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    observations.push({
      key,
      metricKey: metric.metricKey,
      valueText: metric.valueText,
      unit: metric.unit,
      observedAt:
        extractWorldModelDateCandidate(claim.text) ??
        extractWorldModelDateCandidate(supportingSource?.publishedAt ?? '') ??
        null,
      recordedAt: supportingSource?.publishedAt ? extractWorldModelDateCandidate(supportingSource.publishedAt) : null,
      sourceUrls: [...claim.sourceUrls],
      entityKeys: [...claim.entityKeys],
      claimKeys: [claim.key],
      channel: claim.channel,
      epistemicStatus: 'extracted',
    });
  }
  return observations;
}

export function extractWorldModelCandidateFacts(input: WorldModelExtractionInput): WorldModelExtraction {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sourceLookup = buildClaimContextMap(input.sources);
  const entities = buildEntities(input);
  const claims = buildClaims(input.claims, entities);
  const events = buildEvents({ claims, sourceLookup });
  const eventKeysByClaim = new Map<string, string[]>();
  for (const event of events) {
    for (const claimKey of event.claimKeys) {
      const bucket = eventKeysByClaim.get(claimKey) ?? [];
      bucket.push(event.key);
      eventKeysByClaim.set(claimKey, bucket);
    }
  }
  for (const claim of claims) {
    claim.eventKeys = mergeUniqueStrings(eventKeysByClaim.get(claim.key) ?? []);
  }
  const observations = buildObservations({ claims, sourceLookup });

  return worldModelExtractionSchema.parse({
    schemaVersion: '2026-03-10',
    status: 'candidate',
    generatedAt,
    query: input.query,
    researchProfile: input.researchProfile,
    entities,
    events,
    observations,
    claims,
    stats: {
      sourceCount: input.sources.length,
      entityCount: entities.length,
      eventCount: events.length,
      observationCount: observations.length,
      claimCount: claims.length,
    },
  });
}
