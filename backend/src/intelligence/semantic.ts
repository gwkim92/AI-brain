import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { AppEnv } from '../config/env';
import type { ProviderRouter } from '../providers/router';
import type {
  CounterHypothesisRecord,
  ExpectedSignalRecord,
  HypothesisRecord,
  IntelligenceDomainId,
  IntelligenceEventFamily,
  IntelligenceMetricShock,
  IntelligenceWorldState,
  InvalidationConditionRecord,
  LinkedClaimRecord,
  SemanticClaim,
} from '../store/types';
import { resolveCapabilityModel } from './runtime';
import type { JarvisStore } from '../store/types';

const DomainPosteriorSchema = z.object({
  domain_id: z.enum([
    'geopolitics_energy_lng',
    'macro_rates_inflation_fx',
    'shipping_supply_chain',
    'policy_regulation_platform_ai',
    'company_earnings_guidance',
    'commodities_raw_materials',
  ]),
  score: z.number().min(0).max(1),
  evidence_features: z.array(z.string()).max(8).default([]),
  counter_features: z.array(z.string()).max(8).default([]),
});

const ExtractionSchema = z.object({
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(2000),
  event_family: z.enum([
    'geopolitical_flashpoint',
    'policy_change',
    'earnings_guidance',
    'supply_chain_shift',
    'rate_repricing',
    'commodity_move',
    'platform_ai_shift',
    'general_signal',
  ]),
  entities: z.array(z.string().min(1)).max(16).default([]),
  semantic_claims: z
    .array(
      z.object({
        subject_entity: z.string().min(1),
        predicate: z.string().min(1),
        object: z.string().min(1),
        evidence_span: z.string().nullable().optional(),
        time_scope: z.string().nullable().optional(),
        uncertainty: z.enum(['low', 'medium', 'high']).default('medium'),
        stance: z.enum(['supporting', 'neutral', 'contradicting']).default('neutral'),
        claim_type: z.enum(['fact', 'prediction', 'opinion', 'signal']).default('fact'),
      })
    )
    .max(10)
    .default([]),
  metric_shocks: z
    .array(
      z.object({
        metric_key: z.string().min(1),
        value: z.union([z.number(), z.string(), z.null()]).default(null),
        unit: z.string().nullable().optional(),
        direction: z.enum(['up', 'down', 'flat', 'unknown']).default('unknown'),
        observed_at: z.string().nullable().optional(),
      })
    )
    .max(8)
    .default([]),
  domain_posteriors: z.array(DomainPosteriorSchema).min(1).max(6),
  primary_hypotheses: z.array(z.object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(1200),
  })).min(1).max(3),
  counter_hypotheses: z.array(z.object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(1200),
  })).min(1).max(3),
  invalidation_conditions: z.array(z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(800),
    matcher_json: z.record(z.string(), z.unknown()).default({}),
  })).min(2).max(6),
  expected_signals: z.array(z.object({
    signal_key: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    due_at: z.string().nullable().optional(),
  })).min(2).max(6),
  world_states: z.array(z.object({
    key: z.string().min(1).max(120),
    value_json: z.record(z.string(), z.unknown()).default({}),
  })).max(8).default([]),
});

export type ExtractedEventSemantics = {
  title: string;
  summary: string;
  eventFamily: IntelligenceEventFamily;
  entities: string[];
  semanticClaims: SemanticClaim[];
  metricShocks: IntelligenceMetricShock[];
  domainPosteriors: Array<{
    domainId: IntelligenceDomainId;
    score: number;
    evidenceFeatures: string[];
    counterFeatures: string[];
  }>;
  primaryHypotheses: HypothesisRecord[];
  counterHypotheses: CounterHypothesisRecord[];
  invalidationConditions: InvalidationConditionRecord[];
  expectedSignals: ExpectedSignalRecord[];
  worldStates: IntelligenceWorldState[];
  usedModel: { provider: string; modelId: string } | null;
};

const ClaimLinkSchema = z.object({
  relation: z.enum(['same', 'supporting', 'contradicting', 'unrelated']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400).optional().default(''),
});

export type ClaimLinkClassification = {
  relation: 'same' | 'supporting' | 'contradicting' | 'unrelated';
  confidence: number;
  rationale: string;
  usedModel: { provider: string; modelId: string } | null;
};

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function safeParseLooseJson(text: string): unknown | null {
  const stripped = stripMarkdownCodeFence(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function clampConfidence(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'name' in item && typeof item.name === 'string') {
        return item.name.trim();
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeEventFamilyLoose(value: unknown, fallbackText: string): IntelligenceEventFamily {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return inferEventFamily(fallbackText);
  }
  const normalized = normalizeText(value);
  if (normalized.includes('geopolitical')) return 'geopolitical_flashpoint';
  if (normalized.includes('policy')) return 'policy_change';
  if (normalized.includes('earnings')) return 'earnings_guidance';
  if (normalized.includes('supply')) return 'supply_chain_shift';
  if (normalized.includes('rate')) return 'rate_repricing';
  if (normalized.includes('commod')) return 'commodity_move';
  if (normalized.includes('platform') || normalized.includes('acquisition') || normalized.includes('ai')) {
    return 'platform_ai_shift';
  }
  return inferEventFamily(`${value}\n${fallbackText}`);
}

function normalizeSemanticClaimsLoose(input: {
  value: unknown;
  entities: string[];
  title: string;
  summary: string;
}): SemanticClaim[] {
  if (!Array.isArray(input.value)) {
    return [
      {
        claimId: randomUUID(),
        subjectEntity: input.entities[0] ?? 'market',
        predicate: 'signals',
        object: input.title,
        evidenceSpan: input.summary.slice(0, 220),
        timeScope: null,
        uncertainty: 'medium',
        stance: 'supporting',
        claimType: 'signal',
      },
    ];
  }
  const claims = input.value
    .map((row): SemanticClaim | null => {
      if (typeof row === 'string') {
        return {
          claimId: randomUUID(),
          subjectEntity: input.entities[0] ?? 'market',
          predicate: 'mentions',
          object: row.trim().slice(0, 400),
          evidenceSpan: row.trim().slice(0, 220),
          timeScope: null,
          uncertainty: 'medium',
          stance: 'supporting',
          claimType: 'signal',
        };
      }
      if (!row || typeof row !== 'object') return null;
      const record = row as Record<string, unknown>;
      const subject = typeof record.subject_entity === 'string' ? record.subject_entity.trim() : input.entities[0] ?? 'market';
      const predicate = typeof record.predicate === 'string' ? record.predicate.trim() : 'mentions';
      const object =
        typeof record.object === 'string'
          ? record.object.trim()
          : typeof record.description === 'string'
            ? record.description.trim()
            : input.title;
      if (!subject || !predicate || !object) return null;
      return {
        claimId: randomUUID(),
        subjectEntity: subject,
        predicate,
        object: object.slice(0, 400),
        evidenceSpan: typeof record.evidence_span === 'string' ? record.evidence_span.slice(0, 220) : input.summary.slice(0, 220),
        timeScope: typeof record.time_scope === 'string' ? record.time_scope : null,
        uncertainty:
          record.uncertainty === 'low' || record.uncertainty === 'high' || record.uncertainty === 'medium'
            ? record.uncertainty
            : 'medium',
        stance:
          record.stance === 'supporting' || record.stance === 'neutral' || record.stance === 'contradicting'
            ? record.stance
            : 'supporting',
        claimType:
          record.claim_type === 'fact' || record.claim_type === 'prediction' || record.claim_type === 'opinion' || record.claim_type === 'signal'
            ? record.claim_type
            : 'signal',
      };
    })
    .filter((row): row is SemanticClaim => Boolean(row))
    .slice(0, 10);
  return claims.length > 0
    ? claims
    : [
        {
          claimId: randomUUID(),
          subjectEntity: input.entities[0] ?? 'market',
          predicate: 'signals',
          object: input.title,
          evidenceSpan: input.summary.slice(0, 220),
          timeScope: null,
          uncertainty: 'medium',
          stance: 'supporting',
          claimType: 'signal',
        },
      ];
}

function normalizeExtractionLoose(input: {
  raw: unknown;
  fallback: ExtractedEventSemantics;
  title: string;
  rawText: string;
}): ExtractedEventSemantics | null {
  if (!input.raw || typeof input.raw !== 'object') return null;
  const record = input.raw as Record<string, unknown>;
  const title =
    typeof record.title === 'string' && record.title.trim().length > 0
      ? record.title.trim().slice(0, 300)
      : input.fallback.title;
  const summary =
    typeof record.summary === 'string' && record.summary.trim().length > 0
      ? record.summary.trim().slice(0, 2000)
      : input.fallback.summary;
  const entities = coerceStringArray(record.entities);
  const eventFamily = normalizeEventFamilyLoose(record.event_family, `${title}\n${summary}\n${input.rawText}`);
  const semanticClaims = normalizeSemanticClaimsLoose({
    value: record.semantic_claims,
    entities: entities.length > 0 ? entities : input.fallback.entities,
    title,
    summary,
  });
  const domainPosteriors = inferDomainScores(`${title}\n${summary}\n${input.rawText}`, eventFamily);
  const topDomain = domainPosteriors[0]?.domainId ?? input.fallback.domainPosteriors[0]?.domainId ?? 'macro_rates_inflation_fx';
  const metricShocks = Array.isArray(record.metric_shocks)
    ? record.metric_shocks
        .map((row, index) => {
          if (typeof row === 'string') {
            return {
              metricKey: `metric_${index + 1}`,
              value: row.slice(0, 120),
              unit: null,
              direction: 'unknown' as const,
              observedAt: null,
            };
          }
          if (!row || typeof row !== 'object') return null;
          const entry = row as Record<string, unknown>;
          const metricKey =
            typeof entry.metric_key === 'string' && entry.metric_key.trim().length > 0
              ? entry.metric_key.trim()
              : `metric_${index + 1}`;
          return {
            metricKey,
            value:
              typeof entry.value === 'number' || typeof entry.value === 'string'
                ? entry.value
                : null,
            unit: typeof entry.unit === 'string' ? entry.unit : null,
            direction:
              entry.direction === 'up' || entry.direction === 'down' || entry.direction === 'flat' || entry.direction === 'unknown'
                ? entry.direction
                : 'unknown',
            observedAt: typeof entry.observed_at === 'string' ? entry.observed_at : null,
          };
        })
        .filter((row): row is IntelligenceMetricShock => Boolean(row))
        .slice(0, 8)
    : [];
  const normalizeHypotheses = (
    value: unknown,
    kind: 'primary' | 'counter',
    fallbackRows: HypothesisRecord[],
  ): HypothesisRecord[] => {
    if (!Array.isArray(value)) return fallbackRows;
    const rows = value
      .map((row, index): HypothesisRecord | null => {
        if (typeof row === 'string') {
          return {
            id: randomUUID(),
            title: row.trim().slice(0, 180),
            summary: row.trim().slice(0, 1000),
            confidence: clampConfidence(undefined, kind === 'primary' ? 0.62 : 0.42),
            rationale: 'Normalized from freeform model output.',
          };
        }
        if (!row || typeof row !== 'object') return null;
        const entry = row as Record<string, unknown>;
        const titleValue =
          typeof entry.title === 'string' && entry.title.trim().length > 0
            ? entry.title.trim()
            : `${kind === 'primary' ? topDomain : 'Alternative'} hypothesis ${index + 1}`;
        const summaryValue =
          typeof entry.summary === 'string' && entry.summary.trim().length > 0
            ? entry.summary.trim()
            : titleValue;
        return {
          id: randomUUID(),
          title: titleValue.slice(0, 200),
          summary: summaryValue.slice(0, 1000),
          confidence: clampConfidence(entry.confidence, kind === 'primary' ? 0.62 : 0.42),
          rationale:
            typeof entry.rationale === 'string' && entry.rationale.trim().length > 0
              ? entry.rationale.trim().slice(0, 1200)
              : 'Normalized from freeform model output.',
        };
      })
      .filter((row): row is HypothesisRecord => Boolean(row))
      .slice(0, 3);
    return rows.length > 0 ? rows : fallbackRows;
  };
  const normalizeStringsToRecords = <T>(
    value: unknown,
    minCount: number,
    mapper: (text: string, index: number) => T,
    fallbackRows: T[],
  ): T[] => {
    if (!Array.isArray(value)) return fallbackRows;
    const rows = value
      .map((row, index) => {
        if (typeof row === 'string' && row.trim().length > 0) {
          return mapper(row.trim(), index);
        }
        if (!row || typeof row !== 'object') return null;
        return mapper(JSON.stringify(row).slice(0, 400), index);
      })
      .filter((row): row is T => Boolean(row))
      .slice(0, Math.max(minCount, fallbackRows.length));
    return rows.length >= minCount ? rows : fallbackRows;
  };
  return {
    title,
    summary,
    eventFamily,
    entities: entities.length > 0 ? entities.slice(0, 16) : input.fallback.entities,
    semanticClaims,
    metricShocks,
    domainPosteriors,
    primaryHypotheses: normalizeHypotheses(record.primary_hypotheses, 'primary', input.fallback.primaryHypotheses),
    counterHypotheses: normalizeHypotheses(record.counter_hypotheses, 'counter', input.fallback.counterHypotheses),
    invalidationConditions: normalizeStringsToRecords(
      record.invalidation_conditions,
      2,
      (text, index) => ({
        id: randomUUID(),
        title: text.slice(0, 180),
        description: text.slice(0, 800),
        matcherJson: { type: `normalized_invalidation_${index + 1}` },
        status: 'pending' as const,
      }),
      input.fallback.invalidationConditions,
    ),
    expectedSignals: normalizeStringsToRecords(
      record.expected_signals,
      2,
      (text, index) => ({
        id: randomUUID(),
        signalKey: `normalized_signal_${index + 1}`,
        description: text.slice(0, 500),
        dueAt: null,
        status: 'pending' as const,
      }),
      input.fallback.expectedSignals,
    ),
    worldStates: normalizeStringsToRecords(
      record.world_states,
      0,
      (text, index) => ({
        id: randomUUID(),
        key: `normalized_state_${index + 1}`,
        valueJson: { summary: text.slice(0, 500) },
      }),
      input.fallback.worldStates,
    ),
    usedModel: null,
  };
}

function normalizeClaimLinkLoose(raw: unknown): ClaimLinkClassification | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const relationRaw = typeof record.relation === 'string' ? normalizeText(record.relation) : '';
  let relation: ClaimLinkClassification['relation'] | null = null;
  if (relationRaw === 'same') relation = 'same';
  else if (relationRaw === 'supporting' || relationRaw === 'supports' || relationRaw === 'support') relation = 'supporting';
  else if (relationRaw === 'contradicting' || relationRaw === 'contradicts' || relationRaw === 'contradict') relation = 'contradicting';
  else if (relationRaw === 'unrelated') relation = 'unrelated';
  if (!relation) return null;
  return {
    relation,
    confidence: clampConfidence(record.confidence, 0.58),
    rationale:
      typeof record.rationale === 'string'
        ? record.rationale.slice(0, 400)
        : 'Normalized from freeform model output.',
    usedModel: null,
  };
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeText(left).split(' ').filter((item) => item.length >= 3));
  const rightTokens = new Set(normalizeText(right).split(' ').filter((item) => item.length >= 3));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function heuristicClaimLink(input: {
  claim: SemanticClaim;
  candidate: LinkedClaimRecord;
}): ClaimLinkClassification {
  const candidateText = `${input.candidate.canonicalSubject} ${input.candidate.canonicalPredicate} ${input.candidate.canonicalObject}`;
  const claimText = `${input.claim.subjectEntity} ${input.claim.predicate} ${input.claim.object}`;
  const similarity = tokenSimilarity(candidateText, claimText);
  const exact =
    normalizeText(input.candidate.canonicalSubject) === normalizeText(input.claim.subjectEntity) &&
    normalizeText(input.candidate.canonicalPredicate) === normalizeText(input.claim.predicate) &&
    normalizeText(input.candidate.canonicalObject) === normalizeText(input.claim.object);
  if (exact) {
    return {
      relation: 'same',
      confidence: input.claim.stance === 'contradicting' ? 0.84 : 0.92,
      rationale: 'Exact canonical claim match',
      usedModel: null,
    };
  }
  if (similarity >= 0.82) {
    return {
      relation: input.claim.stance === 'contradicting' ? 'contradicting' : 'supporting',
      confidence: 0.76,
      rationale: 'High lexical overlap',
      usedModel: null,
    };
  }
  if (similarity <= 0.38) {
    return {
      relation: 'unrelated',
      confidence: 0.72,
      rationale: 'Low lexical overlap',
      usedModel: null,
    };
  }
  return {
    relation: input.claim.stance === 'contradicting' ? 'contradicting' : 'supporting',
    confidence: 0.58,
    rationale: 'Ambiguous lexical overlap',
    usedModel: null,
  };
}

function extractEntitiesHeuristic(text: string, hints: string[]): string[] {
  const seeded = new Set(hints.map((item) => item.trim()).filter(Boolean));
  const matches = text.match(/\b[A-Z][a-zA-Z0-9&.-]{2,}\b/g) ?? [];
  for (const match of matches.slice(0, 12)) {
    seeded.add(match);
  }
  return [...seeded].slice(0, 12);
}

function inferEventFamily(text: string): IntelligenceEventFamily {
  const lower = text.toLowerCase();
  if (/(war|attack|strait|sanction|missile|military|iran|israel|ukraine)/.test(lower)) return 'geopolitical_flashpoint';
  if (/(fed|ecb|boj|inflation|cpi|rate|yield|treasury)/.test(lower)) return 'rate_repricing';
  if (/(earnings|guidance|revenue|outlook|quarter)/.test(lower)) return 'earnings_guidance';
  if (/(freight|shipping|port|supply chain|terminal|carrier|inventory|reroute)/.test(lower)) return 'supply_chain_shift';
  if (/(commodity|oil|lng|gas|copper|gold|brent|wti|jkm|ttf)/.test(lower)) return 'commodity_move';
  if (/(openai|google ai|gemini|anthropic|model|api|policy|regulation|platform)/.test(lower)) return 'platform_ai_shift';
  if (/(policy|regulation|law|rule|sec|federal reserve|government)/.test(lower)) return 'policy_change';
  return 'general_signal';
}

function inferDomainScores(text: string, family: IntelligenceEventFamily): Array<{
  domainId: IntelligenceDomainId;
  score: number;
  evidenceFeatures: string[];
  counterFeatures: string[];
}> {
  const lower = text.toLowerCase();
  const scores: Record<IntelligenceDomainId, number> = {
    geopolitics_energy_lng: 0.1,
    macro_rates_inflation_fx: 0.1,
    shipping_supply_chain: 0.1,
    policy_regulation_platform_ai: 0.1,
    company_earnings_guidance: 0.1,
    commodities_raw_materials: 0.1,
  };
  const bump = (domainId: IntelligenceDomainId, amount: number) => {
    scores[domainId] = Math.min(1, scores[domainId] + amount);
  };

  if (family === 'geopolitical_flashpoint') {
    bump('geopolitics_energy_lng', 0.55);
    bump('shipping_supply_chain', 0.2);
  }
  if (family === 'rate_repricing' || /(inflation|yield|fx|dxy|treasury)/.test(lower)) {
    bump('macro_rates_inflation_fx', 0.55);
  }
  if (family === 'earnings_guidance') bump('company_earnings_guidance', 0.6);
  if (family === 'supply_chain_shift') bump('shipping_supply_chain', 0.6);
  if (family === 'platform_ai_shift' || /(openai|gemini|anthropic|model|regulation|policy)/.test(lower)) {
    bump('policy_regulation_platform_ai', 0.55);
  }
  if (family === 'commodity_move' || /(oil|lng|gas|copper|gold|commodity)/.test(lower)) {
    bump('commodities_raw_materials', 0.5);
    bump('geopolitics_energy_lng', 0.15);
  }
  if (/(lng|hormuz|terminal|jkm|ttf)/.test(lower)) bump('geopolitics_energy_lng', 0.15);
  if (/(freight|carrier|shipping|port)/.test(lower)) bump('shipping_supply_chain', 0.15);

  return Object.entries(scores)
    .map(([domainId, score]) => ({
      domainId: domainId as IntelligenceDomainId,
      score: Number(score.toFixed(3)),
      evidenceFeatures: [family.replaceAll('_', ' ')],
      counterFeatures: score < 0.3 ? ['weak textual evidence'] : [],
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

function heuristicExtraction(input: {
  rawText: string;
  title: string;
  entityHints: string[];
}): ExtractedEventSemantics {
  const family = inferEventFamily(`${input.title}\n${input.rawText}`);
  const entities = extractEntitiesHeuristic(`${input.title}\n${input.rawText}`, input.entityHints);
  const domainPosteriors = inferDomainScores(`${input.title}\n${input.rawText}`, family).map((row) => ({
    ...row,
  }));
  const topDomain = domainPosteriors[0]?.domainId ?? 'macro_rates_inflation_fx';
  const title = input.title.trim().slice(0, 200) || 'Untitled event';
  const summary = input.rawText.trim().slice(0, 600) || title;
  return {
    title,
    summary,
    eventFamily: family,
    entities,
    semanticClaims: [
      {
        claimId: randomUUID(),
        subjectEntity: entities[0] ?? 'market',
        predicate: 'signals',
        object: title,
        evidenceSpan: summary.slice(0, 220),
        timeScope: null,
        uncertainty: 'medium',
        stance: 'supporting',
        claimType: 'signal',
      },
    ],
    metricShocks: [],
    domainPosteriors,
    primaryHypotheses: [
      {
        id: randomUUID(),
        title: `${topDomain} structure may be repricing`,
        summary: `The cluster points to a developing ${topDomain.replaceAll('_', ' ')} regime shift.`,
        confidence: 0.61,
        rationale: 'Heuristic extraction found correlated language around the event family and top domain.',
      },
    ],
    counterHypotheses: [
      {
        id: randomUUID(),
        title: 'Headline noise remains possible',
        summary: 'The cluster may still represent short-lived narrative amplification rather than durable structural change.',
        confidence: 0.45,
        rationale: 'Corroboration and downstream confirmations have not yet been fully observed.',
      },
    ],
    invalidationConditions: [
      {
        id: randomUUID(),
        title: 'No corroborating follow-up',
        description: 'Higher-trust or non-social confirmation fails to appear in the expected horizon.',
        matcherJson: { type: 'follow_up_absent', source_tier: 'tier_0' },
        status: 'pending',
      },
      {
        id: randomUUID(),
        title: 'No linked market or operational signal',
        description: 'Expected downstream metrics fail to react within the observation window.',
        matcherJson: { type: 'metric_absent' },
        status: 'pending',
      },
    ],
    expectedSignals: [
      {
        id: randomUUID(),
        signalKey: 'official_follow_up',
        description: 'An official filing, statement, or trusted-source follow-up appears.',
        dueAt: null,
        status: 'pending',
      },
      {
        id: randomUUID(),
        signalKey: 'market_confirmation',
        description: 'Related rates, commodity, shipping, or platform metrics confirm the narrative.',
        dueAt: null,
        status: 'pending',
      },
    ],
    worldStates: [
      {
        id: randomUUID(),
        key: 'signal_density',
        valueJson: { entities: entities.length, family },
      },
    ],
    usedModel: null,
  };
}

export async function extractEventSemantics(input: {
  store: JarvisStore;
  env: AppEnv;
  providerRouter: ProviderRouter;
  workspaceId: string;
  title: string;
  rawText: string;
  entityHints: string[];
}): Promise<ExtractedEventSemantics> {
  const fallback = heuristicExtraction(input);
  const resolved = await resolveCapabilityModel({
    store: input.store,
    env: input.env,
    providerRouter: input.providerRouter,
    workspaceId: input.workspaceId,
    alias: 'structured_extraction',
    requirements: {
      structuredOutputRequired: true,
      maxCostClass: 'standard',
    },
  });
  if (!resolved) return fallback;

  try {
    const prompt = [
      'Return JSON only.',
      'Extract event semantics for the following document cluster.',
      'Include: title, summary, event_family, entities, semantic_claims, metric_shocks, domain_posteriors, primary_hypotheses, counter_hypotheses, invalidation_conditions, expected_signals, world_states.',
      'Ensure at least 1 primary hypothesis, 1 counter hypothesis, 2 invalidation conditions, and 2 expected signals.',
      '',
      `TITLE:\n${input.title}`,
      '',
      `TEXT:\n${input.rawText.slice(0, 7000)}`,
      '',
      `ENTITY_HINTS:\n${input.entityHints.join(', ')}`,
    ].join('\n');

    const routed = await input.providerRouter.generate({
      provider: resolved.provider,
      strictProvider: true,
      model: resolved.modelId,
      taskType: 'radar_review',
      temperature: 0.1,
      maxOutputTokens: 2200,
      prompt,
      systemPrompt: 'You are a structured event extraction engine. Return valid JSON only.',
    });
    const raw = safeParseLooseJson(routed.result.outputText);
    const parsed = ExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      const normalized = normalizeExtractionLoose({
        raw,
        fallback,
        title: input.title,
        rawText: input.rawText,
      });
      if (!normalized) return fallback;
      return {
        ...normalized,
        usedModel: { provider: routed.result.provider, modelId: routed.result.model },
      };
    }
    return {
      title: parsed.data.title,
      summary: parsed.data.summary,
      eventFamily: parsed.data.event_family,
      entities: parsed.data.entities,
      semanticClaims: parsed.data.semantic_claims.map((row) => ({
        claimId: randomUUID(),
        subjectEntity: row.subject_entity,
        predicate: row.predicate,
        object: row.object,
        evidenceSpan: row.evidence_span ?? null,
        timeScope: row.time_scope ?? null,
        uncertainty: row.uncertainty,
        stance: row.stance,
        claimType: row.claim_type,
      })),
      metricShocks: parsed.data.metric_shocks.map((row) => ({
        metricKey: row.metric_key,
        value: row.value ?? null,
        unit: row.unit ?? null,
        direction: row.direction,
        observedAt: row.observed_at ?? null,
      })),
      domainPosteriors: parsed.data.domain_posteriors.map((row) => ({
        domainId: row.domain_id,
        score: row.score,
        evidenceFeatures: row.evidence_features,
        counterFeatures: row.counter_features,
      })),
      primaryHypotheses: parsed.data.primary_hypotheses.map((row) => ({ id: randomUUID(), ...row })),
      counterHypotheses: parsed.data.counter_hypotheses.map((row) => ({ id: randomUUID(), ...row })),
      invalidationConditions: parsed.data.invalidation_conditions.map((row) => ({
        id: randomUUID(),
        title: row.title,
        description: row.description,
        matcherJson: row.matcher_json,
        status: 'pending',
      })),
      expectedSignals: parsed.data.expected_signals.map((row) => ({
        id: randomUUID(),
        signalKey: row.signal_key,
        description: row.description,
        dueAt: row.due_at ?? null,
        status: 'pending',
      })),
      worldStates: parsed.data.world_states.map((row) => ({
        id: randomUUID(),
        key: row.key,
        valueJson: row.value_json,
      })),
      usedModel: { provider: routed.result.provider, modelId: routed.result.model },
    };
  } catch {
    return fallback;
  }
}

export async function classifyClaimLink(input: {
  store: JarvisStore;
  env: AppEnv;
  providerRouter: ProviderRouter;
  workspaceId: string;
  claim: SemanticClaim;
  candidate: LinkedClaimRecord;
}): Promise<ClaimLinkClassification> {
  const heuristic = heuristicClaimLink(input);
  if (heuristic.confidence >= 0.8 || heuristic.relation === 'unrelated') {
    return heuristic;
  }

  const resolved = await resolveCapabilityModel({
    store: input.store,
    env: input.env,
    providerRouter: input.providerRouter,
    workspaceId: input.workspaceId,
    alias: 'cross_doc_linking',
    requirements: {
      structuredOutputRequired: true,
      longContextRequired: true,
      maxCostClass: 'standard',
    },
  });
  if (!resolved) return heuristic;

  try {
    const prompt = [
      'Return JSON only.',
      'Classify whether an incoming claim should be linked to an existing canonical linked claim.',
      'Return one of: same, supporting, contradicting, unrelated.',
      '',
      `INCOMING_SUBJECT: ${input.claim.subjectEntity}`,
      `INCOMING_PREDICATE: ${input.claim.predicate}`,
      `INCOMING_OBJECT: ${input.claim.object}`,
      `INCOMING_STANCE: ${input.claim.stance}`,
      `INCOMING_TIME_SCOPE: ${input.claim.timeScope ?? 'none'}`,
      '',
      `CANONICAL_SUBJECT: ${input.candidate.canonicalSubject}`,
      `CANONICAL_PREDICATE: ${input.candidate.canonicalPredicate}`,
      `CANONICAL_OBJECT: ${input.candidate.canonicalObject}`,
      `CANONICAL_TIME_SCOPE: ${input.candidate.timeScope ?? 'none'}`,
      `CANONICAL_CONTRADICTIONS: ${input.candidate.contradictionCount}`,
    ].join('\n');
    const routed = await input.providerRouter.generate({
      provider: resolved.provider,
      strictProvider: true,
      model: resolved.modelId,
      taskType: 'radar_review',
      temperature: 0,
      maxOutputTokens: 300,
      prompt,
      systemPrompt: 'You are a structured cross-document claim linker. Return valid JSON only.',
    });
    const raw = safeParseLooseJson(routed.result.outputText);
    const parsed = ClaimLinkSchema.safeParse(raw);
    if (!parsed.success) {
      const normalized = normalizeClaimLinkLoose(raw);
      if (!normalized) return heuristic;
      return {
        ...normalized,
        usedModel: { provider: routed.result.provider, modelId: routed.result.model },
      };
    }
    return {
      relation: parsed.data.relation,
      confidence: parsed.data.confidence,
      rationale: parsed.data.rationale,
      usedModel: { provider: routed.result.provider, modelId: routed.result.model },
    };
  } catch {
    return heuristic;
  }
}
