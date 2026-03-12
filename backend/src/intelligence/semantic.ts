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
    const parsed = ExtractionSchema.safeParse(JSON.parse(routed.result.outputText));
    if (!parsed.success) return fallback;
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
    const parsed = ClaimLinkSchema.safeParse(JSON.parse(routed.result.outputText));
    if (!parsed.success) return heuristic;
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
