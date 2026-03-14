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
  IntelligenceSemanticValidation,
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
  validation: IntelligenceSemanticValidation;
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

function normalizedTokens(value: string): Set<string> {
  return new Set(normalizeText(value).split(' ').filter(Boolean));
}

function normalizedPhraseMatch(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return false;
  return ` ${normalizedHaystack} `.includes(` ${normalizedNeedle} `);
}

function hasAnyNormalizedToken(tokens: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function hasAnyNormalizedPhrase(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => normalizedPhraseMatch(text, candidate));
}

function normalizeSourceHintSet(sourceEntityHints?: string[] | null): Set<string> {
  return new Set((sourceEntityHints ?? []).map((hint) => normalizeText(hint)).filter(Boolean));
}

function clampSemanticScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function isGenericSemanticClaim(
  claim: Pick<SemanticClaim, 'predicate' | 'claimType'>,
): boolean {
  const normalizedPredicate = normalizeText(claim.predicate);
  if (GENERIC_PREDICATE_TOKENS.has(normalizedPredicate)) return true;
  return claim.claimType === 'signal' && normalizedPredicate === 'general';
}

function buildSemanticValidation(input: {
  sourceTitle: string;
  extractedTitle: string;
  rawText: string;
  entities: string[];
  entityHints: string[];
  sourceEntityHints?: string[];
  domainPosteriors: Array<{ score: number }>;
  semanticClaims: SemanticClaim[];
  usedFallback: boolean;
}): IntelligenceSemanticValidation {
  const combinedText = `${input.sourceTitle}\n${input.rawText}`;
  const topDomainScore = input.domainPosteriors[0]?.score ?? 0;
  const secondDomainScore = input.domainPosteriors[1]?.score ?? 0;
  const topDomainMargin = Math.max(0, topDomainScore - secondDomainScore);
  const genericClaimCount = input.semanticClaims.filter((claim) => isGenericSemanticClaim(claim)).length;
  const genericClaimRatio =
    input.semanticClaims.length > 0 ? genericClaimCount / input.semanticClaims.length : 1;
  const hintSet = new Set(
    [...input.entityHints, ...(input.sourceEntityHints ?? [])]
      .map((hint) => normalizeText(hint))
      .filter(Boolean),
  );
  const hintOnlyEntityCount = input.entities.filter((entity) => {
    const normalizedEntity = normalizeText(entity);
    if (!normalizedEntity) return false;
    if (normalizedPhraseMatch(combinedText, entity)) return false;
    return hintSet.has(normalizedEntity);
  }).length;
  const hintOnlyEntityRatio =
    input.entities.length > 0 ? hintOnlyEntityCount / input.entities.length : 0;
  const titleDriftScore =
    input.sourceTitle.trim().length > 0
      ? tokenSimilarity(input.sourceTitle, input.extractedTitle)
      : 1;
  const nonGenericClaimCount = input.semanticClaims.length - genericClaimCount;
  const reasons: string[] = [];
  if (input.usedFallback) reasons.push('used_fallback');
  if (nonGenericClaimCount <= 0) reasons.push('generic_claims_only');
  if (topDomainScore < 0.6) reasons.push('low_top_domain_score');
  if (topDomainMargin < 0.15) reasons.push('weak_top_domain_margin');
  if (hintOnlyEntityRatio > 0.5) reasons.push('hint_only_entities');
  if (titleDriftScore < 0.45) reasons.push('title_drift');

  let confidence = 0.92;
  if (input.usedFallback) confidence -= 0.34;
  confidence -= Math.min(0.28, genericClaimRatio * 0.32);
  confidence -= topDomainScore < 0.6 ? 0.18 : 0;
  confidence -= topDomainMargin < 0.15 ? 0.14 : 0;
  confidence -= hintOnlyEntityRatio > 0.5 ? 0.12 : 0;
  confidence -= titleDriftScore < 0.45 ? 0.08 : 0;

  return {
    confidence: clampSemanticScore(confidence),
    usedFallback: input.usedFallback,
    genericClaimRatio: clampSemanticScore(genericClaimRatio),
    hintOnlyEntityRatio: clampSemanticScore(hintOnlyEntityRatio),
    topDomainScore: clampSemanticScore(topDomainScore),
    topDomainMargin: clampSemanticScore(topDomainMargin),
    titleDriftScore: clampSemanticScore(titleDriftScore),
    reasons,
  };
}

const GENERIC_PREDICATE_TOKENS = new Set(['signal', 'signals', 'mention', 'mentions', 'report', 'reports']);
const GENERIC_SUBJECT_TOKENS = new Set([
  'api',
  'apis',
  'pdf',
  'pdfs',
  'tool',
  'tools',
  'framework',
  'page',
  'pages',
  'system',
  'systems',
  'platform',
  'workflow',
  'workflows',
]);
const LOW_INFORMATION_ENTITY_TOKENS = new Set([
  'show',
  'showhn',
  'ask',
  'askhn',
  'tell',
  'tellhn',
  'how',
  'howhn',
  'hn',
  'what',
  'why',
  'when',
  'where',
  'if',
  'turn',
  'give',
  'you',
  'we',
  'they',
  'them',
  'their',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'me',
  'my',
  'our',
  'your',
  'the',
  'a',
  'an',
]);
const SUBJECT_NOISE_PREFIX_TOKENS = new Set(['what', 'why', 'when', 'where', 'if', 'turn', 'turning']);
const AI_CONTEXT_TOKENS = [
  'ai',
  'software',
  'chatbot',
  'chatbots',
  'copilot',
  'browser',
  'cache',
  'benchmark',
  'benchmarks',
  'code',
  'coding',
  'developer',
  'developers',
  'robot',
  'robots',
  'authorization',
  'inference',
  'forecast',
  'forecasts',
  'writing',
  'voice',
  'speech',
  'tts',
  'assistant',
  'assistants',
  'model',
  'models',
  'agent',
  'agents',
  'agentic',
  'llm',
  'llms',
  'mcp',
  'reasoning',
];
const SOFTWARE_PRODUCT_CONTEXT_TOKENS = [
  'api',
  'browser',
  'cache',
  'compiler',
  'protocol',
  'workflow',
  'tool',
  'tools',
  'app',
  'apps',
  'pdf',
  'pdfs',
  'spreadsheet',
  'spreadsheets',
  'note',
  'notes',
  'brief',
  'briefs',
  'kv',
  'ui',
];
const FINANCIAL_REGULATORY_TOKENS = [
  'sec',
  'securities',
  'exchange',
  'federal',
  'reserve',
  'bancorp',
  'bank',
  'banks',
  'enforcement',
  'liquidity',
  'supervision',
  'prudential',
  'application',
  'approval',
  'approves',
  'approved',
];
const FINANCIAL_REGULATORY_PHRASES = [
  'federal reserve',
  'federal reserve board',
  'securities and exchange commission',
  'division of enforcement',
  'regulation s p',
  'approval of application',
  'approval of notice',
  'capital treatment of tokenized securities',
  'tokenized securities',
];
const AI_POLICY_TOKENS = [
  'openai',
  'gemini',
  'anthropic',
  'gpt',
  'claude',
  'llm',
  'llms',
  'model',
  'models',
  'agent',
  'agents',
  'api',
  'platform',
];
const TITLE_SUBJECT_STOP_TOKENS = new Set([
  'with',
  'for',
  'to',
  'and',
  'or',
  'now',
  'on',
  'in',
  'at',
  'of',
  'into',
  'by',
  'about',
  'is',
  'are',
  'was',
  'were',
  'be',
  'being',
  'been',
  'tell',
  'tells',
  'told',
  'help',
  'helping',
  'expand',
  'expanding',
  'writing',
  'making',
  'guess',
  'behind',
]);
const TITLE_SUBJECT_ANCHOR_TOKENS = ['ai', 'llm', 'llms', 'mcp', 'copilot', 'claude', 'gpt', 'openai', 'agentic'];
const TITLE_SUBJECT_SECONDARY_NOUNS = new Set([
  'assistant',
  'assistants',
  'agents',
  'agent',
  'software',
  'system',
  'systems',
  'memory',
  'protocol',
  'cache',
  'browser',
  'workstation',
  'benchmark',
  'benchmarks',
  'directory',
  'page',
  'pages',
  'network',
  'networking',
  'communication',
  'reasoning',
]);
const TITLE_FRAGMENT_SUBJECT_TOKENS = new Set([
  'analyst',
  'analysts',
  'brief',
  'briefing',
  'filing',
  'filings',
  'follow',
  'logistics',
  'memo',
  'memos',
  'note',
  'notes',
  'official',
  'officials',
  'report',
  'reports',
  'statement',
  'statements',
  'update',
  'updates',
]);

function isLowInformationEntity(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1) return LOW_INFORMATION_ENTITY_TOKENS.has(tokens[0]);
  return tokens.every((token) => LOW_INFORMATION_ENTITY_TOKENS.has(token));
}

function isGenericSubjectEntity(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => GENERIC_SUBJECT_TOKENS.has(token));
}

function shouldReplaceWithPreferredSubject(currentSubject: string, preferredSubject: string): boolean {
  const normalizedCurrent = normalizeText(currentSubject);
  const normalizedPreferred = normalizeText(preferredSubject);
  if (!normalizedCurrent || !normalizedPreferred || normalizedCurrent === normalizedPreferred) {
    return false;
  }
  const currentTokens = normalizedCurrent.split(' ').filter(Boolean);
  const preferredTokens = normalizedPreferred.split(' ').filter(Boolean);
  if (
    currentTokens.length > preferredTokens.length &&
    ` ${normalizedCurrent} `.includes(` ${normalizedPreferred} `)
  ) {
    return true;
  }
  if (currentTokens.length >= 1 && currentTokens.some((token) => TITLE_FRAGMENT_SUBJECT_TOKENS.has(token))) {
    return true;
  }
  if (
    currentTokens.length === 1 &&
    preferredTokens.length >= 2 &&
    currentTokens[0] === preferredTokens[0] &&
    !TITLE_FRAGMENT_SUBJECT_TOKENS.has(preferredTokens[0])
  ) {
    return true;
  }
  return (
    currentTokens.length === 1 &&
    preferredTokens.length >= 2 &&
    (GENERIC_SUBJECT_TOKENS.has(currentTokens[0]) ||
      LOW_INFORMATION_ENTITY_TOKENS.has(currentTokens[0]) ||
      TITLE_FRAGMENT_SUBJECT_TOKENS.has(currentTokens[0]))
  );
}

function looksLikeNarrativeTitleFragmentSubject(subject: string, title: string): boolean {
  const normalizedSubject = normalizeText(subject);
  const normalizedTitle = normalizeText(title);
  if (!normalizedSubject || !normalizedTitle) return false;
  const subjectTokens = normalizedSubject.split(' ').filter(Boolean);
  if (subjectTokens.length === 0) return false;
  if (normalizedSubject === normalizedTitle) return true;
  const weakTokenCount = subjectTokens.filter((token) => TITLE_FRAGMENT_SUBJECT_TOKENS.has(token)).length;
  if (
    weakTokenCount > 0 &&
    (normalizedTitle.startsWith(normalizedSubject) || tokenSimilarity(normalizedSubject, normalizedTitle) >= 0.45)
  ) {
    return true;
  }
  return subjectTokens.length >= 3 && tokenSimilarity(normalizedSubject, normalizedTitle) >= 0.78;
}

function subjectAlignsWithKnownEntities(subject: string, entities: string[]): boolean {
  const normalizedSubject = normalizeText(subject);
  if (!normalizedSubject) return false;
  return entities.some((entity) => {
    const normalizedEntity = normalizeText(entity);
    if (!normalizedEntity) return false;
    return (
      normalizedSubject === normalizedEntity ||
      ` ${normalizedSubject} `.includes(` ${normalizedEntity} `) ||
      ` ${normalizedEntity} `.includes(` ${normalizedSubject} `)
    );
  });
}

function mergeEntitiesWithClaimSubjects(input: {
  entities: string[];
  semanticClaims: SemanticClaim[];
  title: string;
}): string[] {
  const merged = new Set<string>();
  for (const entity of input.entities) {
    const trimmed = entity.trim();
    if (trimmed) merged.add(trimmed);
  }
  for (const claim of input.semanticClaims) {
    const subject = claim.subjectEntity.trim();
    if (!subject) continue;
    if (isLowInformationEntity(subject)) continue;
    if (looksLikeNarrativeTitleFragmentSubject(subject, input.title)) continue;
    merged.add(subject);
  }
  return [...merged].slice(0, 16);
}

function deriveTitleSubject(title: string): string | null {
  const stripped = title
    .trim()
    .replace(/^(show|ask|tell|how)\s*hn\s*[:\-–]\s*/i, '')
    .replace(/^(show|ask|tell)\s*[:\-–]\s*/i, '')
    .trim();
  if (!stripped) return null;
  const imperativeTargetMatch = stripped.match(/^(turn|convert|transform)\s+.+?\s+(?:into|to)\s+(.+)$/iu);
  if (imperativeTargetMatch) {
    const targetPhrase = imperativeTargetMatch[2]
      .replace(/\s*\([^)]*\)\s*$/u, '')
      .replace(/\s+via\s+ai$/iu, '')
      .trim();
    if (targetPhrase && !isLowInformationEntity(targetPhrase) && !isGenericSubjectEntity(targetPhrase)) {
      return targetPhrase;
    }
  }
  const primarySegment =
    stripped
      .split(/\s+[—–-]\s+|\s+\|\s+/u)
      .map((segment) => segment.trim())
      .find(Boolean) ?? stripped;
  const anchorSearchSegment = primarySegment.replace(/\s*\([^)]*\)\s*$/u, '').trim() || primarySegment;
  const normalizedAnchorTokens = normalizeText(anchorSearchSegment).split(' ').filter(Boolean);
  for (let index = 0; index < normalizedAnchorTokens.length; index += 1) {
    const token = normalizedAnchorTokens[index];
    if (!TITLE_SUBJECT_ANCHOR_TOKENS.includes(token)) continue;
    const phraseTokens = [token];
    const nextToken = normalizedAnchorTokens[index + 1];
    if (nextToken && !TITLE_SUBJECT_STOP_TOKENS.has(nextToken)) {
      phraseTokens.push(nextToken);
      const thirdToken = normalizedAnchorTokens[index + 2];
      if (thirdToken && TITLE_SUBJECT_SECONDARY_NOUNS.has(thirdToken)) {
        phraseTokens.push(thirdToken);
      }
    }
    const phrase = phraseTokens.join(' ').trim();
    if (phrase && !isLowInformationEntity(phrase)) {
      return phrase;
    }
  }
  const colonSegments = primarySegment
    .split(':')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const candidates =
    colonSegments.length >= 2 &&
    (normalizedTokens(colonSegments[0]).size >= 4 ||
      hasAnyNormalizedToken(normalizedTokens(colonSegments[0]), ['you', 'we', 'i']))
      ? [colonSegments[colonSegments.length - 1], colonSegments[0], primarySegment, stripped]
      : colonSegments.length >= 2
        ? [colonSegments[0], colonSegments[colonSegments.length - 1], primarySegment, stripped]
        : [primarySegment, stripped];
  return candidates
    .map((candidate) =>
      candidate
        .replace(/\s*\([^)]*\)\s*$/u, '')
        .trim()
        .split(/\s+/u)
        .filter((token, index, tokens) => !(index === 0 && tokens.length > 1 && SUBJECT_NOISE_PREFIX_TOKENS.has(normalizeText(token))))
        .filter((token, index, tokens) => !(index === 0 && tokens.length > 1 && SUBJECT_NOISE_PREFIX_TOKENS.has(normalizeText(token))))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .find((candidate) => candidate.length > 1 && !isLowInformationEntity(candidate)) ?? null;
}

function resolveStableEventTitle(sourceTitle: string, extractedTitle: string): string {
  const stableSourceTitle = sourceTitle.trim().slice(0, 200);
  if (stableSourceTitle) return stableSourceTitle;
  const fallbackTitle = extractedTitle.trim().slice(0, 200);
  return fallbackTitle || 'Untitled event';
}

function selectPrimaryEntity(input: {
  title: string;
  rawText: string;
  entities: string[];
}): string {
  const meaningfulEntities = input.entities.filter((entity) => !isLowInformationEntity(entity));
  const titleEntity = meaningfulEntities.find((entity) => normalizedPhraseMatch(input.title, entity));
  const textEntity = meaningfulEntities.find((entity) => normalizedPhraseMatch(`${input.title}\n${input.rawText}`, entity));
  const derivedTitleSubject = deriveTitleSubject(input.title);
  if (
    titleEntity &&
    !isGenericSubjectEntity(titleEntity) &&
    !(
      derivedTitleSubject &&
      (shouldReplaceWithPreferredSubject(titleEntity, derivedTitleSubject) ||
        looksLikeNarrativeTitleFragmentSubject(derivedTitleSubject, input.title))
    )
  ) {
    return titleEntity;
  }
  if (derivedTitleSubject) {
    if (textEntity && looksLikeNarrativeTitleFragmentSubject(derivedTitleSubject, input.title)) {
      return textEntity;
    }
    return derivedTitleSubject;
  }
  if (titleEntity) return titleEntity;
  if (textEntity) return textEntity;
  return meaningfulEntities[0] ?? input.entities.find((entity) => entity.trim().length > 0) ?? 'market';
}

function inferSpecificPredicate(input: {
  title: string;
  rawText: string;
  eventFamily: IntelligenceEventFamily;
}): string {
  const normalized = normalizeText(`${input.title}\n${input.rawText}`);
  const tokens = normalizedTokens(normalized);
  if (hasAnyNormalizedToken(tokens, ['launch', 'launches', 'launched', 'release', 'releases', 'released', 'introduce', 'introduces', 'introduced', 'debut', 'debuts'])) {
    return 'launches';
  }
  if (hasAnyNormalizedToken(tokens, ['build', 'builds', 'built', 'develop', 'develops', 'developed', 'create', 'creates', 'created'])) {
    return 'builds';
  }
  if (hasAnyNormalizedToken(tokens, ['hire', 'hiring', 'recruit', 'recruiting'])) {
    return 'hiring_focuses_on';
  }
  if (hasAnyNormalizedToken(tokens, ['fail', 'fails', 'failed', 'weakness', 'weaknesses', 'struggle', 'struggles', 'struggled'])) {
    return 'struggles_with';
  }
  if (hasAnyNormalizedToken(tokens, ['mislead', 'misleads', 'misled'])) {
    return 'misleads';
  }
  if (hasAnyNormalizedToken(tokens, ['authorization', 'authorize', 'authorizes', 'auth'])) {
    return 'authorizes';
  }
  if (hasAnyNormalizedToken(tokens, ['inspect', 'clean', 'cleaning'])) {
    return 'cleans';
  }
  if (hasAnyNormalizedToken(tokens, ['optimize', 'optimization', 'selling', 'sell'])) {
    return 'optimizes_for';
  }
  if (input.eventFamily === 'platform_ai_shift') return 'introduces';
  if (input.eventFamily === 'policy_change') return 'changes_policy';
  if (input.eventFamily === 'earnings_guidance') return 'posts_results';
  if (input.eventFamily === 'supply_chain_shift') return 'reshapes_supply_chain';
  if (input.eventFamily === 'rate_repricing') return 'reprices_rates';
  if (input.eventFamily === 'commodity_move') return 'moves_commodity';
  if (input.eventFamily === 'geopolitical_flashpoint') return 'escalates';
  return 'affects';
}

function predicateMatchesText(input: {
  predicate: string;
  text: string;
}): boolean {
  const normalized = normalizeText(input.text);
  switch (normalizeText(input.predicate)) {
    case 'launches':
      return /\b(launch|launches|launched|release|releases|released|introduce|introduces|introduced|debut|debuts)\b/u.test(normalized);
    case 'builds':
      return /\b(build|builds|built|develop|develops|developed|create|creates|created)\b/u.test(normalized);
    case 'hiring focuses on':
    case 'hiring_focuses_on':
      return /\b(hire|hiring|recruit|recruiting)\b/u.test(normalized);
    case 'struggles with':
    case 'struggles_with':
      return /\b(fail|fails|failed|weakness|weaknesses|struggle|struggles|struggled)\b/u.test(normalized);
    case 'misleads':
      return /\b(mislead|misleads|misled)\b/u.test(normalized);
    case 'authorizes':
      return /\b(authorize|authorizes|authorization|auth)\b/u.test(normalized);
    case 'cleans':
      return /\b(inspect|clean|cleaning)\b/u.test(normalized);
    case 'optimizes for':
    case 'optimizes_for':
      return /\b(optimize|optimization|optimizes|selling|sell)\b/u.test(normalized);
    default:
      return true;
  }
}

function hasFinancialRegulatoryContext(input: {
  normalized: string;
  tokens: Set<string>;
  sourceEntityHints?: string[] | null;
}): boolean {
  const hintSet = normalizeSourceHintSet(input.sourceEntityHints);
  return (
    hasAnyNormalizedToken(input.tokens, FINANCIAL_REGULATORY_TOKENS) ||
    hasAnyNormalizedPhrase(input.normalized, FINANCIAL_REGULATORY_PHRASES) ||
    hintSet.has('sec') ||
    hintSet.has('securities and exchange commission') ||
    hintSet.has('federal reserve') ||
    hintSet.has('federal reserve board')
  );
}

function hasAiPolicyContext(input: {
  normalized: string;
  tokens: Set<string>;
  sourceEntityHints?: string[] | null;
}): boolean {
  const hintSet = normalizeSourceHintSet(input.sourceEntityHints);
  return (
    hasAnyNormalizedToken(input.tokens, AI_POLICY_TOKENS) ||
    hasAnyNormalizedPhrase(input.normalized, ['google ai', 'ai policy', 'ai regulation', 'model card']) ||
    (input.tokens.has('ai') && hasAnyNormalizedToken(input.tokens, ['policy', 'regulation', 'regulatory', 'platform', 'agent', 'agents', 'api'])) ||
    hintSet.has('openai') ||
    hintSet.has('gemini') ||
    hintSet.has('anthropic')
  );
}

function stabilizeSemanticClaims(input: {
  claims: SemanticClaim[];
  title: string;
  summary: string;
  rawText: string;
  entities: string[];
  eventFamily: IntelligenceEventFamily;
}): SemanticClaim[] {
  const preferredSubject = selectPrimaryEntity({
    title: input.title,
    rawText: input.rawText,
    entities: input.entities,
  });
  const fallbackPredicate = inferSpecificPredicate({
    title: input.title,
    rawText: input.rawText,
    eventFamily: input.eventFamily,
  });
  const combinedText = `${input.title}\n${input.rawText}`;
  const normalizedClaims = input.claims
    .map((claim, index) => {
      const subject = claim.subjectEntity.trim();
      const predicate = claim.predicate.trim();
      const object = claim.object.trim();
      const normalizedPredicate = normalizeText(predicate);
      return {
        ...claim,
        subjectEntity:
          subject &&
          !isLowInformationEntity(subject) &&
          !(isGenericSubjectEntity(subject) && normalizeText(preferredSubject) !== normalizeText(subject)) &&
          !shouldReplaceWithPreferredSubject(subject, preferredSubject) &&
          !looksLikeNarrativeTitleFragmentSubject(subject, input.title) &&
          (
            normalizedPhraseMatch(combinedText, subject) ||
            subjectAlignsWithKnownEntities(subject, input.entities) ||
            looksLikeNarrativeTitleFragmentSubject(preferredSubject, input.title)
          )
            ? subject
            : preferredSubject,
        predicate:
          normalizedPredicate &&
          !GENERIC_PREDICATE_TOKENS.has(normalizedPredicate) &&
          predicateMatchesText({
            predicate,
            text: claim.evidenceSpan ?? `${input.title}\n${input.rawText}`,
          })
            ? predicate.slice(0, 80)
            : fallbackPredicate,
        object:
          object ||
          (index === 0 ? input.title : input.summary.slice(0, 220) || input.title),
        evidenceSpan: claim.evidenceSpan ?? input.summary.slice(0, 220),
      };
    })
    .filter((claim) => Boolean(claim.subjectEntity && claim.predicate && claim.object))
    .slice(0, 10);

  if (normalizedClaims.length > 0) {
    return normalizedClaims;
  }

  return [
    {
      claimId: randomUUID(),
      subjectEntity: preferredSubject,
      predicate: fallbackPredicate,
      object: input.title,
      evidenceSpan: input.summary.slice(0, 220),
      timeScope: null,
      uncertainty: 'medium',
      stance: 'supporting',
      claimType: 'signal',
    },
  ];
}

function resolveEntityHintContext(input: {
  text: string;
  entityHints: string[];
  sourceEntityHints?: string[];
}): {
  strongHints: string[];
  admittedWeakHints: string[];
  effectiveHints: string[];
} {
  const sourceHintKeys = new Set((input.sourceEntityHints ?? []).map((hint) => normalizeText(hint)).filter(Boolean));
  const strongHints: string[] = [];
  const admittedWeakHints: string[] = [];
  for (const hint of input.entityHints.map((row) => row.trim()).filter(Boolean)) {
    const normalizedHint = normalizeText(hint);
    if (!normalizedHint) continue;
    if (sourceHintKeys.has(normalizedHint)) {
      if (normalizedPhraseMatch(input.text, hint)) {
        admittedWeakHints.push(hint);
      }
      continue;
    }
    strongHints.push(hint);
  }
  return {
    strongHints,
    admittedWeakHints,
    effectiveHints: [...new Set([...strongHints, ...admittedWeakHints])],
  };
}

function sanitizeExtractedEntities(input: {
  text: string;
  entities: string[];
  entityHints: string[];
  sourceEntityHints?: string[];
}): string[] {
  const sourceHintKeys = new Set((input.sourceEntityHints ?? []).map((hint) => normalizeText(hint)).filter(Boolean));
  const filtered = input.entities
    .map((row) => row.trim())
    .filter(Boolean)
    .filter((row) => {
      const normalized = normalizeText(row);
      if (!normalized) return false;
      if (!sourceHintKeys.has(normalized)) return true;
      return normalizedPhraseMatch(input.text, row);
    });
  if (filtered.length > 0) {
    return [...new Set(filtered)].slice(0, 16);
  }
  return extractEntitiesHeuristic(input.text, input.entityHints, input.sourceEntityHints).slice(0, 16);
}

function normalizeEventFamilyLoose(
  value: unknown,
  fallbackText: string,
  sourceEntityHints?: string[],
): IntelligenceEventFamily {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return inferEventFamily(fallbackText, { sourceEntityHints });
  }
  const normalized = normalizeText(value);
  const tokens = normalizedTokens(normalized);
  if (hasAnyNormalizedToken(tokens, ['geopolitical', 'conflict']) || hasAnyNormalizedPhrase(normalized, ['flashpoint'])) {
    return 'geopolitical_flashpoint';
  }
  if (hasAnyNormalizedToken(tokens, ['platform', 'model', 'models', 'gpt', 'llm', 'llms']) || hasAnyNormalizedPhrase(normalized, ['ai shift', 'platform ai'])) {
    return 'platform_ai_shift';
  }
  if (hasAnyNormalizedToken(tokens, ['policy', 'regulation', 'regulatory', 'law', 'rule'])) {
    return 'policy_change';
  }
  if (hasAnyNormalizedToken(tokens, ['earnings', 'guidance', 'quarter', 'quarterly'])) {
    return 'earnings_guidance';
  }
  if (hasAnyNormalizedToken(tokens, ['shipping', 'port', 'carrier', 'inventory']) || hasAnyNormalizedPhrase(normalized, ['supply chain'])) {
    return 'supply_chain_shift';
  }
  if (hasAnyNormalizedToken(tokens, ['commodity', 'commodities', 'oil', 'gas', 'lng', 'copper', 'gold'])) {
    return 'commodity_move';
  }
  if (hasAnyNormalizedToken(tokens, ['rate', 'rates', 'inflation', 'yield', 'treasury', 'fed', 'ecb', 'boj']) || hasAnyNormalizedPhrase(normalized, ['interest rate'])) {
    return 'rate_repricing';
  }
  return inferEventFamily(`${value}\n${fallbackText}`, { sourceEntityHints });
}

function normalizeSemanticClaimsLoose(input: {
  value: unknown;
  entities: string[];
  title: string;
  summary: string;
  rawText: string;
  eventFamily: IntelligenceEventFamily;
}): SemanticClaim[] {
  const stableTitle = resolveStableEventTitle(input.title, input.title);
  if (!Array.isArray(input.value)) {
    return stabilizeSemanticClaims({
      claims: [
        {
          claimId: randomUUID(),
          subjectEntity: input.entities[0] ?? 'market',
          predicate: 'mentions',
          object: stableTitle,
          evidenceSpan: input.summary.slice(0, 220),
          timeScope: null,
          uncertainty: 'medium',
          stance: 'supporting',
          claimType: 'signal',
        },
      ],
      title: stableTitle,
      summary: input.summary,
      rawText: input.rawText,
      entities: input.entities,
      eventFamily: input.eventFamily,
    });
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
  return stabilizeSemanticClaims({
    claims,
    title: stableTitle,
    summary: input.summary,
    rawText: input.rawText,
    entities: input.entities,
    eventFamily: input.eventFamily,
  });
}

function normalizeExtractionLoose(input: {
  raw: unknown;
  fallback: ExtractedEventSemantics;
  title: string;
  rawText: string;
  entityHints?: string[];
  sourceEntityHints?: string[];
}): ExtractedEventSemantics | null {
  if (!input.raw || typeof input.raw !== 'object') return null;
  const record = input.raw as Record<string, unknown>;
  const title =
    resolveStableEventTitle(
      input.title,
      typeof record.title === 'string' && record.title.trim().length > 0
        ? record.title.trim().slice(0, 300)
        : input.fallback.title,
    );
  const summary =
    typeof record.summary === 'string' && record.summary.trim().length > 0
      ? record.summary.trim().slice(0, 2000)
      : input.fallback.summary;
  const entities = sanitizeExtractedEntities({
    text: `${title}\n${summary}\n${input.rawText}`,
    entities: coerceStringArray(record.entities),
    entityHints: input.fallback.entities,
  });
  const eventFamily = normalizeEventFamilyLoose(
    record.event_family,
    `${title}\n${summary}\n${input.rawText}`,
    input.sourceEntityHints,
  );
  const semanticClaims = normalizeSemanticClaimsLoose({
    value: record.semantic_claims,
    entities: entities.length > 0 ? entities : input.fallback.entities,
    title,
    summary,
    rawText: input.rawText,
    eventFamily,
  });
  const domainPosteriors = inferDomainScores(
    `${title}\n${summary}\n${input.rawText}`,
    eventFamily,
    input.sourceEntityHints,
  );
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
    validation: buildSemanticValidation({
      sourceTitle: input.title,
      extractedTitle: title,
      rawText: input.rawText,
      entities: entities.length > 0 ? entities.slice(0, 16) : input.fallback.entities,
      entityHints: input.entityHints ?? input.fallback.entities,
      sourceEntityHints: input.sourceEntityHints,
      domainPosteriors,
      semanticClaims,
      usedFallback: true,
    }),
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

export function normalizeText(value: string | null | undefined): string {
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
    relation: 'unrelated',
    confidence: 0.58,
    rationale: 'Ambiguous lexical overlap',
    usedModel: null,
  };
}

function extractEntitiesHeuristic(text: string, hints: string[], sourceEntityHints: string[] = []): string[] {
  const hintContext = resolveEntityHintContext({
    text,
    entityHints: hints,
    sourceEntityHints,
  });
  const seeded = new Set(
    hintContext.effectiveHints
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && !isLowInformationEntity(item)),
  );
  const matches = text.match(/\b[A-Z][a-zA-Z0-9&.-]{2,}\b/g) ?? [];
  for (const match of matches.slice(0, 12)) {
    if (isLowInformationEntity(match)) continue;
    seeded.add(match);
  }
  return [...seeded].slice(0, 12);
}

export function inferEventFamily(
  text: string,
  options?: { sourceEntityHints?: string[] | null },
): IntelligenceEventFamily {
  const normalized = normalizeText(text);
  const tokens = normalizedTokens(normalized);
  const financialRegulatoryContext = hasFinancialRegulatoryContext({
    normalized,
    tokens,
    sourceEntityHints: options?.sourceEntityHints,
  });
  const hasAiContext =
    hasAnyNormalizedToken(tokens, AI_CONTEXT_TOKENS) ||
    hasAnyNormalizedPhrase(normalized, ['artificial intelligence', 'ai powered', 'ai powered tool']);
  const hasPlatformMovementCue =
    hasAnyNormalizedToken(tokens, [
      'launch',
      'launches',
      'launched',
      'release',
      'releases',
      'released',
      'introduce',
      'introduces',
      'introduced',
      'debut',
      'debuts',
      'built',
      'build',
      'builds',
      'ship',
      'ships',
      'shipped',
      'tool',
      'tools',
      'app',
      'apps',
      'browser',
      'protocol',
      'workflow',
      'copilot',
    ]) || hasAnyNormalizedPhrase(normalized, ['show hn']);
  const hasPlatformTechnologyCue = hasAnyNormalizedToken(tokens, [
    'review',
    'workstation',
    'benchmark',
    'benchmarks',
    'leaderboard',
    'leaderboards',
    'authorization',
    'auth',
    'cache',
    'compiler',
    'protocol',
    'infrastructure',
    'networking',
    'mesh',
    'browser',
    'tool',
    'tools',
    'app',
    'apps',
    'api',
    'assistant',
    'assistants',
    'mcp',
    'memory',
    'search',
    'reasoning',
  ]) || hasAnyNormalizedPhrase(normalized, ['local first', 'web search']);
  if (hasAnyNormalizedToken(tokens, ['war', 'attack', 'strait', 'sanction', 'missile', 'military', 'iran', 'israel', 'ukraine', 'gaza', 'iraq'])) {
    return 'geopolitical_flashpoint';
  }
  if (financialRegulatoryContext) {
    return 'policy_change';
  }
  if (
    hasAnyNormalizedToken(tokens, ['openai', 'gemini', 'anthropic', 'gpt', 'claude', 'llm', 'llms', 'platform']) ||
    hasAnyNormalizedPhrase(normalized, ['google ai', 'model card', 'ai agent', 'ai agents']) ||
    (tokens.has('ai') && hasAnyNormalizedToken(tokens, ['model', 'models', 'api', 'agent', 'agents', 'platform'])) ||
    (hasAiContext && (hasPlatformMovementCue || hasPlatformTechnologyCue))
  ) {
    return 'platform_ai_shift';
  }
  if (
    hasAnyNormalizedToken(tokens, ['policy', 'regulation', 'regulatory', 'law', 'rule', 'rules', 'sec', 'government']) ||
    hasAnyNormalizedPhrase(normalized, ['federal reserve', 'policy strategy'])
  ) {
    return 'policy_change';
  }
  if (hasAnyNormalizedToken(tokens, ['earnings', 'guidance', 'revenue', 'outlook', 'quarter', 'quarterly'])) {
    return 'earnings_guidance';
  }
  if (
    hasAnyNormalizedToken(tokens, ['freight', 'shipping', 'port', 'terminal', 'carrier', 'inventory', 'reroute']) ||
    hasAnyNormalizedPhrase(normalized, ['supply chain'])
  ) {
    return 'supply_chain_shift';
  }
  if (hasAnyNormalizedToken(tokens, ['commodity', 'commodities', 'oil', 'lng', 'gas', 'copper', 'gold', 'brent', 'wti', 'jkm', 'ttf'])) {
    return 'commodity_move';
  }
  if (
    hasAnyNormalizedToken(tokens, ['fed', 'ecb', 'boj', 'inflation', 'cpi', 'rates', 'rate', 'yield', 'treasury']) ||
    hasAnyNormalizedPhrase(normalized, ['interest rate', 'interest rates'])
  ) {
    return 'rate_repricing';
  }
  return 'general_signal';
}

export function inferDomainScores(
  text: string,
  family: IntelligenceEventFamily,
  sourceEntityHints?: string[] | null,
): Array<{
  domainId: IntelligenceDomainId;
  score: number;
  evidenceFeatures: string[];
  counterFeatures: string[];
}> {
  const normalized = normalizeText(text);
  const tokens = normalizedTokens(normalized);
  const financialRegulatoryContext = hasFinancialRegulatoryContext({
    normalized,
    tokens,
    sourceEntityHints,
  });
  const aiPolicyContext = hasAiPolicyContext({
    normalized,
    tokens,
    sourceEntityHints,
  });
  const hasAiContext =
    hasAnyNormalizedToken(tokens, AI_CONTEXT_TOKENS) ||
    hasAnyNormalizedPhrase(normalized, ['artificial intelligence', 'text to speech', 'home price forecast']);
  const hasSoftwareProductContext =
    hasAnyNormalizedToken(tokens, SOFTWARE_PRODUCT_CONTEXT_TOKENS) ||
    hasAnyNormalizedPhrase(normalized, ['show hn', 'showhn', 'hacker news']);
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
  if (family === 'platform_ai_shift') bump('policy_regulation_platform_ai', 0.62);
  if (family === 'policy_change') {
    if (financialRegulatoryContext) {
      bump('macro_rates_inflation_fx', 0.58);
    } else if (aiPolicyContext) {
      bump('policy_regulation_platform_ai', 0.58);
    } else {
      bump('macro_rates_inflation_fx', 0.28);
    }
  }
  if (family === 'earnings_guidance') bump('company_earnings_guidance', 0.6);
  if (family === 'supply_chain_shift') bump('shipping_supply_chain', 0.6);
  if (
    family === 'rate_repricing' ||
    hasAnyNormalizedToken(tokens, ['inflation', 'yield', 'fx', 'dxy', 'treasury', 'rates', 'rate']) ||
    hasAnyNormalizedPhrase(normalized, ['interest rate', 'interest rates'])
  ) {
    bump('macro_rates_inflation_fx', 0.55);
  }
  if (family === 'platform_ai_shift' || aiPolicyContext) {
    bump('policy_regulation_platform_ai', 0.55);
  }
  if (financialRegulatoryContext) {
    bump('macro_rates_inflation_fx', family === 'policy_change' ? 0.55 : 0.3);
  }
  if (hasAiContext) {
    bump('policy_regulation_platform_ai', family === 'general_signal' ? 0.32 : 0.16);
  }
  if (hasSoftwareProductContext) {
    bump('policy_regulation_platform_ai', family === 'general_signal' ? 0.28 : 0.12);
  }
  if (family === 'commodity_move' || hasAnyNormalizedToken(tokens, ['oil', 'lng', 'gas', 'copper', 'gold', 'commodity', 'commodities'])) {
    bump('commodities_raw_materials', 0.5);
    bump('geopolitics_energy_lng', 0.15);
  }
  if (hasAnyNormalizedToken(tokens, ['lng', 'hormuz', 'terminal', 'jkm', 'ttf'])) bump('geopolitics_energy_lng', 0.15);
  if (hasAnyNormalizedToken(tokens, ['freight', 'carrier', 'shipping', 'port'])) bump('shipping_supply_chain', 0.15);
  if (
    family === 'general_signal' &&
    hasAiContext &&
    scores.policy_regulation_platform_ai <= scores.geopolitics_energy_lng
  ) {
    scores.policy_regulation_platform_ai = Math.min(1, scores.geopolitics_energy_lng + 0.05);
  }

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
  sourceEntityHints?: string[];
}): ExtractedEventSemantics {
  const family = inferEventFamily(`${input.title}\n${input.rawText}`, {
    sourceEntityHints: input.sourceEntityHints,
  });
  const fullText = `${input.title}\n${input.rawText}`;
  const entities = extractEntitiesHeuristic(fullText, input.entityHints, input.sourceEntityHints);
  const domainPosteriors = inferDomainScores(
    `${input.title}\n${input.rawText}`,
    family,
    input.sourceEntityHints,
  ).map((row) => ({
    ...row,
  }));
  const topDomain = domainPosteriors[0]?.domainId ?? 'macro_rates_inflation_fx';
  const title = resolveStableEventTitle(input.title, input.title);
  const summary = input.rawText.trim().slice(0, 600) || title;
  const semanticClaims = stabilizeSemanticClaims({
    claims: [
      {
        claimId: randomUUID(),
        subjectEntity: entities[0] ?? 'market',
        predicate: 'mentions',
        object: title,
        evidenceSpan: summary.slice(0, 220),
        timeScope: null,
        uncertainty: 'medium',
        stance: 'supporting',
        claimType: 'signal',
      },
    ],
    title,
    summary,
    rawText: input.rawText,
    entities,
    eventFamily: family,
  });
  return {
    title,
    summary,
    eventFamily: family,
    entities,
    semanticClaims,
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
    validation: buildSemanticValidation({
      sourceTitle: input.title,
      extractedTitle: title,
      rawText: input.rawText,
      entities,
      entityHints: input.entityHints,
      sourceEntityHints: input.sourceEntityHints,
      domainPosteriors,
      semanticClaims,
      usedFallback: true,
    }),
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
  sourceEntityHints?: string[];
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
      'Treat source hints as weak context only. Do not emit an entity unless it appears in the text or is directly supported by the document.',
      '',
      `TITLE:\n${input.title}`,
      '',
      `TEXT:\n${input.rawText.slice(0, 7000)}`,
      '',
      `DOC_ENTITY_HINTS:\n${input.entityHints.join(', ')}`,
      '',
      `WEAK_SOURCE_ENTITY_HINTS:\n${(input.sourceEntityHints ?? []).join(', ')}`,
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
        entityHints: input.entityHints,
        sourceEntityHints: input.sourceEntityHints,
      });
      if (!normalized) return fallback;
      return {
        ...normalized,
        usedModel: { provider: routed.result.provider, modelId: routed.result.model },
      };
    }
    const stableTitle = resolveStableEventTitle(input.title, parsed.data.title);
    const entities = sanitizeExtractedEntities({
      text: `${input.title}\n${input.rawText}`,
      entities: parsed.data.entities,
      entityHints: input.entityHints,
      sourceEntityHints: input.sourceEntityHints,
    });
    const semanticClaims = stabilizeSemanticClaims({
      claims: parsed.data.semantic_claims.map((row) => ({
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
      title: stableTitle,
      summary: parsed.data.summary,
      rawText: input.rawText,
      entities,
      eventFamily: parsed.data.event_family,
    });
    const mergedEntities = mergeEntitiesWithClaimSubjects({
      entities,
      semanticClaims,
      title: stableTitle,
    });
    const domainPosteriors = parsed.data.domain_posteriors.map((row) => ({
      domainId: row.domain_id,
      score: row.score,
      evidenceFeatures: row.evidence_features,
      counterFeatures: row.counter_features,
    }));
    return {
      title: stableTitle,
      summary: parsed.data.summary,
      eventFamily: parsed.data.event_family,
      entities: mergedEntities,
      semanticClaims,
      metricShocks: parsed.data.metric_shocks.map((row) => ({
        metricKey: row.metric_key,
        value: row.value ?? null,
        unit: row.unit ?? null,
        direction: row.direction,
        observedAt: row.observed_at ?? null,
      })),
      domainPosteriors,
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
      validation: buildSemanticValidation({
        sourceTitle: input.title,
        extractedTitle: stableTitle,
        rawText: input.rawText,
        entities: mergedEntities,
        entityHints: input.entityHints,
        sourceEntityHints: input.sourceEntityHints,
        domainPosteriors,
        semanticClaims,
        usedFallback: false,
      }),
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
