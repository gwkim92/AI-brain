import { randomUUID } from 'node:crypto';

import { startCouncilRun } from '../council/run-service';
import type { AppEnv } from '../config/env';
import type { NotificationService } from '../notifications/proactive';
import type { ProviderCredentialsByProvider } from '../providers/types';
import { handleMcpStreamRequest } from '../protocol/mcp-transport';
import type { ProviderRouter } from '../providers/router';
import type { RouteContext } from '../routes/types';
import type {
  ClaimLinkRecord,
  CreateIntelligenceNarrativeClusterTimelineInput,
  DeliberationResult,
  ExecutionCandidateRecord,
  IntelligenceBridgeDispatchRecord,
  IntelligenceDomainId,
  IntelligenceEventClusterRecord,
  IntelligenceEventLifecycleState,
  IntelligenceEventFamily,
  IntelligenceExpectedSignalEntryRecord,
  IntelligenceExecutionStatus,
  IntelligenceInvalidationEntryRecord,
  IntelligenceNarrativeClusterMembershipRecord,
  IntelligenceNarrativeClusterRecord,
  IntelligenceNarrativeClusterLedgerEntryRecord,
  IntelligenceNarrativeClusterTimelineRecord,
  LinkedClaimEdgeRecord,
  LinkedClaimRecord,
  IntelligenceOutcomeRecord,
  IntelligenceOutcomeEntryRecord,
  IntelligenceHotspotCluster,
  IntelligenceQualitySummary,
  IntelligenceRelatedHistoricalEventSummary,
  IntelligenceSemanticValidation,
  IntelligenceSignalPromotionState,
  ResetIntelligenceDerivedWorkspaceStateResult,
  IntelligenceTemporalNarrativeState,
  SemanticClaim,
  IntelligenceSignalProcessingStatus,
  ProviderCredentialProvider,
  IntelligenceSourceCursorRecord,
  IntelligenceSourceRecord,
  JarvisStore,
  RadarRiskBand,
  RawDocumentRecord,
  SignalEnvelopeRecord,
} from '../store/types';
import { fetchProviderModelCatalog } from '../providers/catalog';

import { fetchIntelligenceSource } from './fetchers';
import { inferIntelligenceModelMetadata } from './runtime';
import { classifyClaimLink, extractEventSemantics, inferDomainScores, inferEventFamily, normalizeText } from './semantic';

const SOCIAL_SOURCE_TYPES = new Set(['social', 'forum'] as const);
const SOCIAL_SOURCE_TIERS = new Set(['tier_3'] as const);
const RESTRICTED_PROMOTION_SOURCE_TYPES = new Set(['search_result', 'forum', 'social'] as const);
const CANONICAL_SOURCE_TIERS = new Set<string>(['tier_0', 'tier_1']);
const CANONICAL_SOURCE_TYPES = new Set(['policy', 'web_page', 'blog', 'news', 'filing'] as const);
const LOW_RISK_MCP_TOOLS = new Set(['task_create', 'notification_emit']);
const AUTO_DELIBERATION_DOMAIN_DELTA = 0.15;
const AUTO_DELIBERATION_HYPOTHESIS_DELTA = 0.2;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXACT_LINKED_CLAIM_WINDOW_MS = 2 * DAY_MS;
const SHORTLIST_LINKED_CLAIM_WINDOW_MS = 7 * DAY_MS;
const RECENCY_DECAY_WINDOW_MS = 14 * DAY_MS;
const GENERIC_CLAIM_PREDICATES = new Set(['signal', 'signals', 'mention', 'mentions', 'report', 'reports']);
const QUALITY_SUSPECT_THRESHOLD = 0.55;
const CANONICAL_CLUSTER_WINDOW_MS = 90 * DAY_MS;
const SEMANTIC_MATCH_EVENT_LIMIT = 2_000;

type WorkspaceScopedStore = Pick<
  JarvisStore,
  | 'listAllIntelligenceSources'
  | 'listIntelligenceSources'
  | 'updateIntelligenceSource'
  | 'listIntelligenceSourceCursors'
  | 'upsertIntelligenceSourceCursor'
  | 'createIntelligenceScanRun'
  | 'completeIntelligenceScanRun'
  | 'createIntelligenceFetchFailure'
  | 'listIntelligenceRawDocuments'
  | 'listIntelligenceRawDocumentsByIds'
  | 'findIntelligenceRawDocumentByFingerprint'
  | 'findIntelligenceRawDocumentByIdentityKey'
  | 'createIntelligenceRawDocument'
  | 'updateIntelligenceRawDocumentObservation'
  | 'createIntelligenceSignal'
  | 'listIntelligenceSignals'
  | 'listIntelligenceSignalsByIds'
  | 'updateIntelligenceSignalProcessing'
  | 'createIntelligenceLinkedClaim'
  | 'listIntelligenceLinkedClaims'
  | 'deleteIntelligenceLinkedClaimsByIds'
  | 'createIntelligenceLinkedClaimEdge'
  | 'listIntelligenceLinkedClaimEdges'
  | 'createIntelligenceClaimLink'
  | 'listIntelligenceClaimLinks'
  | 'replaceIntelligenceEventMemberships'
  | 'listIntelligenceEventMemberships'
  | 'listIntelligenceEvents'
  | 'upsertIntelligenceEvent'
  | 'deleteIntelligenceEventById'
  | 'resetIntelligenceDerivedWorkspaceState'
  | 'listIntelligenceModelRegistryEntries'
  | 'upsertIntelligenceModelRegistryEntries'
  | 'replaceIntelligenceProviderHealth'
  | 'listIntelligenceProviderHealth'
  | 'listIntelligenceAliasBindings'
  | 'replaceIntelligenceAliasBindings'
  | 'createIntelligenceAliasRollout'
  | 'listIntelligenceAliasRollouts'
  | 'createIntelligenceBridgeDispatch'
  | 'listIntelligenceBridgeDispatches'
  | 'updateIntelligenceEventReviewState'
  | 'createIntelligenceOperatorNote'
  | 'listIntelligenceOperatorNotes'
  | 'createIntelligenceHypothesisLedgerEntry'
  | 'listIntelligenceHypothesisLedgerEntries'
  | 'createIntelligenceHypothesisEvidenceLink'
  | 'listIntelligenceHypothesisEvidenceLinks'
  | 'replaceIntelligenceInvalidationEntries'
  | 'listIntelligenceInvalidationEntries'
  | 'replaceIntelligenceExpectedSignalEntries'
  | 'listIntelligenceExpectedSignalEntries'
  | 'createIntelligenceOutcomeEntry'
  | 'listIntelligenceOutcomeEntries'
  | 'upsertIntelligenceNarrativeCluster'
  | 'listIntelligenceNarrativeClusters'
  | 'getIntelligenceNarrativeClusterById'
  | 'deleteIntelligenceNarrativeCluster'
  | 'upsertIntelligenceNarrativeClusterMembership'
  | 'listIntelligenceNarrativeClusterMemberships'
  | 'replaceIntelligenceTemporalNarrativeLedgerEntries'
  | 'listIntelligenceTemporalNarrativeLedgerEntries'
  | 'createIntelligenceNarrativeClusterLedgerEntry'
  | 'listIntelligenceNarrativeClusterLedgerEntries'
  | 'replaceIntelligenceNarrativeClusterTimelineEntries'
  | 'listIntelligenceNarrativeClusterTimelineEntries'
  | 'createIntelligenceExecutionAudit'
  | 'listIntelligenceExecutionAudits'
  | 'getIntelligenceEventById'
  | 'createBriefing'
  | 'createDossier'
  | 'createJarvisSession'
  | 'createActionProposal'
>;

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type IntelligenceSourceScanSummary = {
  fetchedCount: number;
  storedDocumentCount: number;
  signalCount: number;
  clusteredEventCount: number;
  executionCount: number;
  failedCount: number;
  failedSources: string[];
  sourceIds: string[];
};

export type IntelligenceSemanticSummary = {
  processedSignalCount: number;
  clusteredEventCount: number;
  deliberationCount: number;
  executionCount: number;
  failedCount: number;
  failedSignalIds: string[];
  eventIds: string[];
};

export type IntelligenceScannerEvaluation = {
  event: IntelligenceEventClusterRecord;
  created: boolean;
  autoExecuted: boolean;
};

export type IntelligenceStaleEventPreview = {
  eventId: string;
  title: string;
  topDomainId: IntelligenceDomainId | null;
  staleScore: number;
  reasons: string[];
  linkedClaimCount: number;
  genericPredicateRatio: number;
  nonSocialCorroborationCount: number;
  edgeCount: number;
  graphSupportScore: number;
  graphContradictionScore: number;
  linkedClaimHealthScore: number;
  updatedAt: string;
};

export type IntelligenceEventRebuildResult = {
  workspaceId: string;
  previousEventId: string;
  rebuiltEventId: string | null;
  requeuedSignalIds: string[];
  deletedLinkedClaimIds: string[];
  semanticSummary: IntelligenceSemanticSummary;
};

export type IntelligenceBulkEventRebuildResult = {
  workspaceId: string;
  attemptedEventIds: string[];
  rebuiltCount: number;
  failedCount: number;
  results: IntelligenceEventRebuildResult[];
  failures: Array<{
    eventId: string;
    message: string;
  }>;
};

export type IntelligenceWorkspaceRebuildResult = ResetIntelligenceDerivedWorkspaceStateResult & {
  mode: 'hard_reset';
  queuedSignalCount: number;
  executionMode: 'worker' | 'background_loop';
};

export function computeIntelligenceOperatorPriorityScore(event: Pick<
  IntelligenceEventClusterRecord,
  | 'contradictionCount'
  | 'nonSocialCorroborationCount'
  | 'linkedClaimHealthScore'
  | 'timeCoherenceScore'
  | 'graphSupportScore'
  | 'graphContradictionScore'
  | 'graphHotspotCount'
  | 'reviewState'
  | 'deliberationStatus'
  | 'expectedSignals'
  | 'outcomes'
  | 'executionCandidates'
  | 'structuralityScore'
  | 'actionabilityScore'
  | 'recurringNarrativeScore'
  | 'relatedHistoricalEventCount'
  | 'temporalNarrativeState'
>): number {
  const absentCount = event.expectedSignals.filter((row) => row.status === 'absent').length;
  const invalidatedCount = event.outcomes.filter((row) => row.status === 'invalidated').length;
  const blockedExecutions = event.executionCandidates.filter((row) => row.status === 'blocked').length;
  const pendingExecutions = event.executionCandidates.filter((row) => row.status === 'pending').length;
  const reviewWeight = event.reviewState === 'review' ? 3 : event.reviewState === 'ignore' ? -1 : 0;
  const deliberationWeight = event.deliberationStatus === 'failed' ? 2 : 0;
  const structuralityWeight = event.structuralityScore >= 0.7 ? 2 : event.structuralityScore >= 0.55 ? 1 : 0;
  const actionabilityWeight = event.actionabilityScore >= 0.7 ? 1 : 0;
  const corroborationPenalty = event.nonSocialCorroborationCount < 1 ? 3 : 0;
  const linkedClaimHealthPenalty = event.linkedClaimHealthScore < 0.45 ? 2 : event.linkedClaimHealthScore < 0.6 ? 1 : 0;
  const timeCoherencePenalty = event.timeCoherenceScore < 0.4 ? 2 : event.timeCoherenceScore < 0.6 ? 1 : 0;
  const graphPressure = Math.round(event.graphContradictionScore * 6);
  const graphHotspotWeight = event.graphHotspotCount * 2;
  const recurringWeight =
    event.temporalNarrativeState === 'diverging'
      ? 3
      : event.temporalNarrativeState === 'recurring'
        ? Math.min(2, Math.round((event.recurringNarrativeScore ?? 0) * 2))
        : 0;
  const historicalWeight = Math.min(2, event.relatedHistoricalEventCount ?? 0);
  return (
    event.contradictionCount * 4 +
    graphPressure +
    graphHotspotWeight +
    absentCount * 3 +
    invalidatedCount * 4 +
    blockedExecutions * 2 +
    pendingExecutions +
    corroborationPenalty +
    linkedClaimHealthPenalty +
    timeCoherencePenalty +
    recurringWeight +
    historicalWeight +
    reviewWeight +
    deliberationWeight +
    structuralityWeight +
    actionabilityWeight
  );
}

export function computeNarrativeClusterPriorityScore(input: {
  cluster: Pick<
    IntelligenceNarrativeClusterRecord,
    | 'eventCount'
    | 'driftScore'
    | 'supportScore'
    | 'contradictionScore'
    | 'hotspotEventCount'
    | 'recurringStrengthTrend'
    | 'divergenceTrend'
    | 'supportDecayScore'
    | 'contradictionAcceleration'
    | 'reviewState'
    | 'recentExecutionBlockedCount'
  >;
  recentEvents: Array<
    Pick<
      IntelligenceEventClusterRecord,
      'graphHotspotCount' | 'graphContradictionScore' | 'nonSocialCorroborationCount' | 'executionCandidates'
    >
  >;
}): number {
  const eventCount = Math.max(1, input.cluster.eventCount);
  const hotspotRatio = input.cluster.hotspotEventCount / eventCount;
  const contradictionHeavyRecentEvents = input.recentEvents.filter(
    (row) => row.graphHotspotCount > 0 || row.graphContradictionScore >= 0.28,
  ).length;
  const lowCorroborationTrend =
    input.recentEvents.length === 0
      ? 0
      : input.recentEvents.filter((row) => row.nonSocialCorroborationCount < 1).length / input.recentEvents.length;
  const unresolvedReviewWeight =
    input.cluster.reviewState === 'review'
      ? 3
      : input.cluster.reviewState === 'watch'
        ? 1
        : 0;
  const blockedExecutionWeight = Math.min(6, input.cluster.recentExecutionBlockedCount * 2);
  const contradictionPressure = Math.round(input.cluster.contradictionScore * 10);
  const driftPressure = Math.round(input.cluster.driftScore * 10);
  const divergenceTrendPressure = Math.round(Math.max(0, input.cluster.divergenceTrend) * 8);
  const supportDecayPressure = Math.round(input.cluster.supportDecayScore * 6);
  const contradictionAccelerationPressure = Math.round(input.cluster.contradictionAcceleration * 6);
  const hotspotPressure = Math.round(hotspotRatio * 8);
  const recentHotspotPressure = contradictionHeavyRecentEvents;
  const corroborationPenalty = Math.round(lowCorroborationTrend * 5);
  const supportPenalty = input.cluster.supportScore < 0.4 ? 1 : 0;
  return Math.max(
    0,
    contradictionPressure +
      driftPressure +
      divergenceTrendPressure +
      supportDecayPressure +
      contradictionAccelerationPressure +
      hotspotPressure +
      recentHotspotPressure +
      corroborationPenalty +
      unresolvedReviewWeight +
      blockedExecutionWeight +
      supportPenalty,
  );
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function clampTrend(value: number): number {
  return Math.max(-1, Math.min(1, Number(value.toFixed(3))));
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
    .slice(0, 64);
}

function similarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function entityOverlap(left: string[], right: string[]): number {
  const leftSet = new Set(left.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const rightSet = new Set(right.map((item) => item.trim().toLowerCase()).filter(Boolean));
  let overlap = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) overlap += 1;
  }
  return overlap;
}

function isEventScopedLinkedClaim(input: {
  linkedClaim: Pick<LinkedClaimRecord, 'supportingSignalIds'>;
  signalIdSet: Set<string>;
}): boolean {
  return (
    input.linkedClaim.supportingSignalIds.length > 0 &&
    input.linkedClaim.supportingSignalIds.every((signalId) => input.signalIdSet.has(signalId))
  );
}

function normalizeClaimPart(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizedPhraseMatch(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return false;
  return ` ${normalizedHaystack} `.includes(` ${normalizedNeedle} `);
}

function buildNormalizedTitleKey(title: string): string {
  return normalizeText(title)
    .split(' ')
    .filter(Boolean)
    .slice(0, 12)
    .join(' ');
}

function isGenericPredicate(predicate: string): boolean {
  const normalized = normalizeClaimPart(predicate);
  return GENERIC_CLAIM_PREDICATES.has(normalized);
}

function isGenericSemanticClaim(claim: Pick<SemanticClaim, 'predicate' | 'claimType' | 'object'>): boolean {
  const normalizedPredicate = normalizeClaimPart(claim.predicate);
  if (GENERIC_CLAIM_PREDICATES.has(normalizedPredicate)) return true;
  return claim.claimType === 'signal' && normalizedPredicate === 'general';
}

const PLATFORM_GENERIC_NARRATIVE_ANCHORS = new Set([
  'agent',
  'agents',
  'ai',
  'ai agent',
  'ai agents',
  'ai generated',
  'ai native',
  'anthropic',
  'api',
  'apis',
  'app',
  'apps',
  'claude api',
  'gemini',
  'google',
  'llm',
  'llms',
  'model',
  'models',
  'openai',
  'platform',
  'protocol',
  'tool',
  'tools',
]);

const POLICY_GENERIC_NARRATIVE_ANCHORS = new Set([
  'agency',
  'agencies',
  'board',
  'cftc',
  'division of enforcement',
  'federal open market committee',
  'federal reserve',
  'federal reserve board',
  'fsa',
  'government',
  'governments',
  'sec',
  'securities and exchange commission',
]);

const POLICY_TITLE_NOISE_TOKENS = new Set([
  'announce',
  'announced',
  'announces',
  'approval',
  'application',
  'applications',
  'board',
  'by',
  'federal',
  'for',
  'from',
  'of',
  'on',
  'propose',
  'proposed',
  'proposes',
  'reserve',
  'sec',
  'the',
  'to',
]);

type NarrativeAnchorShape = Pick<
  IntelligenceEventClusterRecord,
  'title' | 'entities' | 'semanticClaims' | 'eventFamily'
>;

function isGenericNarrativeAnchor(value: string, eventFamily: IntelligenceEventFamily): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (eventFamily === 'platform_ai_shift') {
    return PLATFORM_GENERIC_NARRATIVE_ANCHORS.has(normalized);
  }
  if (eventFamily === 'policy_change') {
    return POLICY_GENERIC_NARRATIVE_ANCHORS.has(normalized);
  }
  return false;
}

function filterNarrativeAnchors(values: string[], eventFamily: IntelligenceEventFamily): string[] {
  return values.filter((value) => !isGenericNarrativeAnchor(value, eventFamily));
}

function narrativeEntityOverlap(
  left: string[],
  right: string[],
  eventFamily: IntelligenceEventFamily,
): number {
  return entityOverlap(filterNarrativeAnchors(left, eventFamily), filterNarrativeAnchors(right, eventFamily));
}

function isGenericLinkedClaim(claim: Pick<LinkedClaimRecord, 'canonicalPredicate' | 'predicateFamily'>): boolean {
  return isGenericPredicate(claim.canonicalPredicate) || claim.predicateFamily === 'signal';
}

function buildComparisonClaimText(claims: SemanticClaim[]): string {
  return claims
    .filter((claim) => !isGenericSemanticClaim(claim))
    .map((row) => `${row.subjectEntity} ${row.predicate} ${row.object}`)
    .join(' ');
}

function primarySemanticAnchor(input: NarrativeAnchorShape): string {
  const claimSubject = input.semanticClaims.find(
    (claim) =>
      !isGenericSemanticClaim(claim) &&
      normalizeText(claim.subjectEntity) &&
      !isGenericNarrativeAnchor(claim.subjectEntity, input.eventFamily),
  )?.subjectEntity;
  const entity = input.entities.find(
    (value) => normalizeText(value) && !isGenericNarrativeAnchor(value, input.eventFamily),
  );
  return normalizeText(claimSubject ?? entity ?? input.title);
}

function platformProductAnchorMismatch(
  left: NarrativeAnchorShape,
  right: NarrativeAnchorShape,
): boolean {
  if (left.eventFamily !== 'platform_ai_shift' || right.eventFamily !== 'platform_ai_shift') {
    return false;
  }
  const leftAnchor = primarySemanticAnchor(left);
  const rightAnchor = primarySemanticAnchor(right);
  if (!leftAnchor || !rightAnchor || leftAnchor === rightAnchor) {
    return false;
  }
  if (leftAnchor.includes(rightAnchor) || rightAnchor.includes(leftAnchor)) {
    return false;
  }
  return similarity(leftAnchor, rightAnchor) < 0.45;
}

function policyNarrativeAnchorMismatch(
  left: NarrativeAnchorShape,
  right: NarrativeAnchorShape,
): boolean {
  if (left.eventFamily !== 'policy_change' || right.eventFamily !== 'policy_change') {
    return false;
  }
  const leftTemplateAnchor = extractPolicyTemplateAnchor(left.title);
  const rightTemplateAnchor = extractPolicyTemplateAnchor(right.title);
  if (leftTemplateAnchor && rightTemplateAnchor) {
    if (leftTemplateAnchor === rightTemplateAnchor) return false;
    if (leftTemplateAnchor.includes(rightTemplateAnchor) || rightTemplateAnchor.includes(leftTemplateAnchor)) {
      return false;
    }
    return true;
  }
  const leftTitleAnchor = extractPolicyTitleAnchor(left.title);
  const rightTitleAnchor = extractPolicyTitleAnchor(right.title);
  if (leftTitleAnchor && rightTitleAnchor) {
    if (
      leftTitleAnchor !== rightTitleAnchor &&
      !leftTitleAnchor.includes(rightTitleAnchor) &&
      !rightTitleAnchor.includes(leftTitleAnchor) &&
      similarity(leftTitleAnchor, rightTitleAnchor) < 0.68
    ) {
      return true;
    }
  }
  const leftAnchor = primarySemanticAnchor(left);
  const rightAnchor = primarySemanticAnchor(right);
  if (!leftAnchor || !rightAnchor || leftAnchor === rightAnchor) {
    return false;
  }
  if (leftAnchor.includes(rightAnchor) || rightAnchor.includes(leftAnchor)) {
    return false;
  }
  if (narrativeEntityOverlap(left.entities, right.entities, 'policy_change') >= 1) {
    return false;
  }
  return similarity(leftAnchor, rightAnchor) < 0.58;
}

function extractPolicyTemplateAnchor(title: string): string | null {
  const normalized = normalizeText(title);
  if (!normalized) return null;
  const patterns = [
    /approval of application by (.+)$/u,
    /approval of the application by (.+)$/u,
    /approval of application from (.+)$/u,
    /approval of the application from (.+)$/u,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) return candidate;
  }
  return null;
}

function extractPolicyTitleAnchor(title: string): string | null {
  const tokens = normalizeText(title)
    .split(' ')
    .filter((token) => token.length >= 3)
    .filter((token) => !POLICY_TITLE_NOISE_TOKENS.has(token))
    .slice(0, 8);
  return tokens.length > 0 ? tokens.join(' ') : null;
}

function buildEventScopedClaimFingerprint(input: {
  claim: SemanticClaim;
  fallbackAt: string | null;
  eventId: string;
}): string {
  return `${buildClaimFingerprint(input.claim, input.fallbackAt)}|event:${input.eventId}`;
}

function eventCompatibilityBucket(event: Pick<IntelligenceEventClusterRecord, 'eventFamily' | 'topDomainId'>): string {
  return `${event.eventFamily}::${event.topDomainId ?? 'unknown'}`;
}

function eventDomainMatches(left: IntelligenceDomainId | null, right: IntelligenceDomainId | null): boolean {
  return left !== null && right !== null && left === right;
}

function isTrustedPolicyPromotionSource(source: IntelligenceSourceRecord): boolean {
  return source.sourceType === 'policy' && CANONICAL_SOURCE_TIERS.has(source.sourceTier);
}

function isTrustedPolicyEvent(event: Pick<IntelligenceEventClusterRecord, 'sourceMix'>): boolean {
  const sourceTypes = Array.isArray(event.sourceMix.source_types)
    ? event.sourceMix.source_types.filter((value): value is string => typeof value === 'string')
    : [];
  const sourceTiers = Array.isArray(event.sourceMix.source_tiers)
    ? event.sourceMix.source_tiers.filter((value): value is string => typeof value === 'string')
    : [];
  return (
    sourceTypes.includes('policy') &&
    sourceTiers.some((tier) => CANONICAL_SOURCE_TIERS.has(tier as IntelligenceSourceRecord['sourceTier'])) &&
    Number(event.sourceMix.non_social_source_count ?? 0) >= 1
  );
}

function sameTitleException(left: Pick<IntelligenceEventClusterRecord, 'title' | 'entities'>, right: Pick<IntelligenceEventClusterRecord, 'title' | 'entities'>): boolean {
  return buildNormalizedTitleKey(left.title) === buildNormalizedTitleKey(right.title) &&
    similarity(left.title, right.title) >= 0.75 &&
    entityOverlap(left.entities, right.entities) >= 1;
}

function eventsNarrativelyCompatible(
  left: Pick<IntelligenceEventClusterRecord, 'title' | 'entities' | 'semanticClaims' | 'eventFamily' | 'topDomainId'>,
  right: Pick<IntelligenceEventClusterRecord, 'title' | 'entities' | 'semanticClaims' | 'eventFamily' | 'topDomainId'>,
): boolean {
  if (sameTitleException(left, right)) return true;
  const sameFamily = left.eventFamily === right.eventFamily;
  const sameDomain = domainsCompatible(left.topDomainId, right.topDomainId);
  if (!sameFamily || !sameDomain) return false;
  if (platformProductAnchorMismatch(left, right) || policyNarrativeAnchorMismatch(left, right)) {
    return false;
  }
  const overlap =
    left.eventFamily === 'platform_ai_shift' || left.eventFamily === 'policy_change'
      ? narrativeEntityOverlap(left.entities, right.entities, left.eventFamily)
      : entityOverlap(left.entities, right.entities);
  const titleScore = similarity(left.title, right.title);
  if (left.eventFamily === 'general_signal') {
    return (overlap >= 1 && titleScore >= 0.18) || titleScore >= 0.72;
  }
  if (left.eventFamily === 'platform_ai_shift' || left.eventFamily === 'policy_change') {
    return overlap >= 1 || titleScore >= 0.58;
  }
  return overlap >= 1 || titleScore >= 0.5;
}

function clusterCompatibleWithEvent(input: {
  cluster: Pick<IntelligenceNarrativeClusterRecord, 'title' | 'eventFamily' | 'topDomainId' | 'anchorEntities'>;
  event: Pick<IntelligenceEventClusterRecord, 'title' | 'entities' | 'semanticClaims' | 'eventFamily' | 'topDomainId'>;
}): boolean {
  if (input.cluster.eventFamily !== input.event.eventFamily) return false;
  if (!domainsCompatible(input.cluster.topDomainId, input.event.topDomainId)) return false;
  const clusterAnchor: NarrativeAnchorShape = {
    title: input.cluster.title,
    entities: input.cluster.anchorEntities,
    semanticClaims: [],
    eventFamily: input.cluster.eventFamily,
  };
  if (
    platformProductAnchorMismatch(clusterAnchor, input.event) ||
    policyNarrativeAnchorMismatch(clusterAnchor, input.event)
  ) {
    return false;
  }
  const overlap = anchorOverlap(
    filterNarrativeAnchors(input.cluster.anchorEntities, input.cluster.eventFamily),
    filterNarrativeAnchors(input.event.entities, input.event.eventFamily),
  );
  if (overlap.count >= 1 || overlap.ratio >= 0.5) return true;
  return similarity(input.cluster.title, input.event.title) >= 0.75;
}

function hasNarrativeClusterHeterogeneityVeto(memberEvents: IntelligenceEventClusterRecord[]): boolean {
  const bucketCounts = new Map<string, number>();
  for (const event of memberEvents) {
    const bucket = eventCompatibilityBucket(event);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }
  if (bucketCounts.size <= 1) return false;
  const dominantBucket = Math.max(...bucketCounts.values(), 0);
  if (bucketCounts.size >= 3) return true;
  return memberEvents.length >= 4 && dominantBucket / Math.max(1, memberEvents.length) < 0.7;
}

export function computeIntelligenceEventQuality(input: {
  event: IntelligenceEventClusterRecord;
  documents?: Array<Pick<RawDocumentRecord, 'title' | 'summary' | 'rawText'>>;
  linkedClaims?: Array<Pick<LinkedClaimRecord, 'canonicalPredicate' | 'predicateFamily'>>;
}): IntelligenceQualitySummary {
  const reasons: string[] = [];
  let score = 0;
  const documents = input.documents ?? [];
  const linkedClaims = input.linkedClaims ?? [];
  if (documents.length >= 2) {
    const titles = documents.map((row) => row.title).filter(Boolean);
    let pairCount = 0;
    let pairScoreTotal = 0;
    for (let index = 0; index < titles.length; index += 1) {
      for (let inner = index + 1; inner < titles.length; inner += 1) {
        pairScoreTotal += similarity(titles[index] ?? '', titles[inner] ?? '');
        pairCount += 1;
      }
    }
    const averageTitleSimilarity = pairCount > 0 ? pairScoreTotal / pairCount : 1;
    if (averageTitleSimilarity < 0.28) {
      reasons.push('cross_document_title_divergence');
      score += 0.32;
    }
  }
  const genericSemanticClaimRatio =
    input.event.semanticClaims.length > 0
      ? input.event.semanticClaims.filter((claim) => isGenericSemanticClaim(claim)).length / input.event.semanticClaims.length
      : 0;
  const genericLinkedClaimRatio =
    linkedClaims.length > 0 ? linkedClaims.filter((claim) => isGenericLinkedClaim(claim)).length / linkedClaims.length : 0;
  if (Math.max(genericSemanticClaimRatio, genericLinkedClaimRatio) >= 0.6) {
    reasons.push('generic_claim_dominance');
    score += 0.24;
  }
  const combinedText = documents.map((row) => `${row.title}\n${row.summary}\n${row.rawText}`).join('\n');
  if (combinedText) {
    const hintOnlyEntityRatio =
      input.event.entities.length > 0
        ? input.event.entities.filter((entity) => !normalizedPhraseMatch(combinedText, entity)).length / input.event.entities.length
        : 0;
    if (hintOnlyEntityRatio >= 0.5) {
      reasons.push('hint_only_entities');
      score += 0.22;
    }
    const inferredFamily = inferEventFamily(combinedText);
    if (inferredFamily !== input.event.eventFamily) {
      reasons.push('family_domain_mismatch');
      score += 0.18;
    } else {
      const inferredDomain = inferDomainScores(combinedText, inferredFamily)[0]?.domainId ?? null;
      if (input.event.topDomainId && inferredDomain && inferredDomain !== input.event.topDomainId) {
        reasons.push('family_domain_mismatch');
        score += 0.18;
      }
    }
  }
  if (
    input.event.documentIds.length >= 2 &&
    input.event.linkedClaimCount === 0 &&
    input.event.graphSupportScore === 0 &&
    input.event.graphContradictionScore === 0
  ) {
    reasons.push('zero_graph_multi_document_merge');
    score += 0.28;
  }
  return {
    state: score >= QUALITY_SUSPECT_THRESHOLD ? 'suspect' : 'healthy',
    score: Number(clampScore(score).toFixed(3)),
    reasons,
  };
}

export function computeIntelligenceNarrativeClusterQuality(input: {
  cluster: IntelligenceNarrativeClusterRecord;
  memberEvents: IntelligenceEventClusterRecord[];
  duplicateTitleCount?: number;
}): IntelligenceQualitySummary {
  const reasons: string[] = [];
  let score = 0;
  if (hasNarrativeClusterHeterogeneityVeto(input.memberEvents)) {
    reasons.push('member_family_domain_heterogeneity');
    score += 0.34;
  }
  if ((input.duplicateTitleCount ?? 0) > 1) {
    reasons.push('duplicate_title_collision');
    score += 0.24;
  }
  const pollutedMemberSample = input.memberEvents.filter((event) => {
    const titleScore = similarity(event.title, input.cluster.title);
    return titleScore < 0.18 || !clusterCompatibleWithEvent({ cluster: input.cluster, event });
  }).length;
  if (input.memberEvents.length > 0 && pollutedMemberSample / input.memberEvents.length >= 0.25) {
    reasons.push('polluted_member_sample');
    score += 0.2;
  }
  const averageTitleSimilarity =
    input.memberEvents.length > 0
      ? average(input.memberEvents.map((event) => similarity(event.title, input.cluster.title)))
      : 1;
  if (input.memberEvents.length >= 10 && averageTitleSimilarity < 0.28 && input.cluster.timeCoherenceScore < 0.45) {
    reasons.push('oversized_low_coherence_cluster');
    score += 0.24;
  }
  return {
    state: score >= QUALITY_SUSPECT_THRESHOLD ? 'suspect' : 'healthy',
    score: Number(clampScore(score).toFixed(3)),
    reasons,
  };
}

function buildClaimFingerprint(claim: SemanticClaim, fallbackAt: string | null = null): string {
  const timeBucket = buildClaimTimeBucket(claim.timeScope, fallbackAt).start?.slice(0, 10) ?? normalizeClaimPart(claim.timeScope ?? fallbackAt);
  return [
    normalizeClaimPart(claim.subjectEntity),
    normalizeClaimPart(claim.predicate),
    normalizeClaimPart(claim.object),
    timeBucket,
  ].join('|');
}

function buildClaimCanonicalText(claim: SemanticClaim): string {
  return [
    normalizeClaimPart(claim.subjectEntity),
    normalizeClaimPart(claim.predicate),
    normalizeClaimPart(claim.object),
  ].join(' ');
}

function derivePredicateFamily(predicate: string): string {
  const normalized = normalizeClaimPart(predicate);
  if (!normalized) return 'general';
  if (/(raise|increase|tighten|reprice|surge|spike|lift)/.test(normalized)) return 'pressure_up';
  if (/(cut|lower|ease|relieve|cool|drop)/.test(normalized)) return 'pressure_down';
  if (/(signal|indicate|suggest|point|flag|imply)/.test(normalized)) return 'signal';
  if (/(announce|publish|file|report|state|issue)/.test(normalized)) return 'disclosure';
  if (/(dispute|deny|question|push back|challenge|contradict)/.test(normalized)) return 'challenge';
  return normalized.split(' ').slice(0, 2).join('_') || 'general';
}

function buildClaimTimeBucket(timeScope: string | null, fallbackAt: string | null): {
  start: string | null;
  end: string | null;
} {
  const base = timeScope ?? fallbackAt;
  if (!base) return { start: null, end: null };
  const parsed = Date.parse(base);
  if (!Number.isFinite(parsed)) return { start: null, end: null };
  const start = new Date(parsed);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function resolveClaimTemporalAnchorMs(claim: SemanticClaim, signalObservedAt: string | null): number | null {
  const bucket = buildClaimTimeBucket(claim.timeScope, signalObservedAt);
  return publishedMs(bucket.start ?? claim.timeScope ?? signalObservedAt);
}

function resolveLinkedClaimTemporalAnchorMs(row: LinkedClaimRecord): number | null {
  return publishedMs(
    row.lastContradictedAt ??
      row.lastSupportedAt ??
      row.timeBucketEnd ??
      row.timeBucketStart ??
      row.timeScope,
  );
}

function temporalDistanceScore(leftMs: number | null, rightMs: number | null, windowMs: number): number {
  if (leftMs === null || rightMs === null) return 0.45;
  const delta = Math.abs(leftMs - rightMs);
  if (delta > windowMs) return -1;
  return clampScore(1 - delta / windowMs);
}

function mergeTimeBucketBounds(input: {
  currentStart: string | null;
  currentEnd: string | null;
  nextStart: string | null;
  nextEnd: string | null;
}): { start: string | null; end: string | null } {
  const starts = [input.currentStart, input.nextStart]
    .map((value) => publishedMs(value))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const ends = [input.currentEnd, input.nextEnd]
    .map((value) => publishedMs(value))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  return {
    start: starts.length > 0 ? new Date(starts[0]!).toISOString() : null,
    end: ends.length > 0 ? new Date(ends[ends.length - 1]!).toISOString() : null,
  };
}

function recencyWeight(value: string | null, nowMs: number): number {
  const timestampMs = publishedMs(value);
  if (timestampMs === null) return 0.35;
  const ageMs = Math.max(0, nowMs - timestampMs);
  if (ageMs >= RECENCY_DECAY_WINDOW_MS) return 0.2;
  return clampScore(1 - 0.8 * (ageMs / RECENCY_DECAY_WINDOW_MS));
}

function isNonSocialSignal(signal: Pick<SignalEnvelopeRecord, 'sourceType' | 'sourceTier'>): boolean {
  return !SOCIAL_SOURCE_TYPES.has(signal.sourceType as 'social' | 'forum') && !SOCIAL_SOURCE_TIERS.has(signal.sourceTier as 'tier_3');
}

function isRestrictedPromotionSource(
  source: Pick<IntelligenceSourceRecord, 'sourceType'>,
): boolean {
  return RESTRICTED_PROMOTION_SOURCE_TYPES.has(
    source.sourceType as 'search_result' | 'forum' | 'social',
  );
}

function isCanonicalCreationSource(
  source: Pick<IntelligenceSourceRecord, 'sourceType' | 'sourceTier'>,
): boolean {
  return CANONICAL_SOURCE_TIERS.has(source.sourceTier as 'tier_0' | 'tier_1') &&
    CANONICAL_SOURCE_TYPES.has(
      source.sourceType as 'policy' | 'web_page' | 'blog' | 'news' | 'filing',
    );
}

function findExactCanonicalUrlEvent(input: {
  events: IntelligenceEventClusterRecord[];
  document: Pick<RawDocumentRecord, 'canonicalUrl'>;
  eventCanonicalUrlsById?: Map<string, Set<string>>;
}): IntelligenceEventClusterRecord | null {
  if (!input.document.canonicalUrl) return null;
  return input.events.find((event) => input.eventCanonicalUrlsById?.get(event.id)?.has(input.document.canonicalUrl)) ?? null;
}

function validationBlocksCanonicalWrite(input: {
  validation: IntelligenceSemanticValidation;
  hasExactCanonicalUrlMatch: boolean;
}): boolean {
  if (input.validation.usedFallback) return true;
  if (input.validation.genericClaimRatio >= 1) return true;
  if (input.validation.topDomainScore < 0.6) return true;
  if (input.validation.topDomainMargin < 0.15) return true;
  if (input.validation.hintOnlyEntityRatio > 0.5) return true;
  if (input.validation.titleDriftScore < 0.45 && !input.hasExactCanonicalUrlMatch) return true;
  return false;
}

function canPromoteProvisionalEvent(input: {
  event: IntelligenceEventClusterRecord;
  source: Pick<IntelligenceSourceRecord, 'sourceType' | 'sourceTier'>;
  validation: IntelligenceSemanticValidation;
}): boolean {
  const hasNonGenericClaim = input.event.semanticClaims.some((claim) => !isGenericSemanticClaim(claim));
  const distinctDocumentCount = new Set(input.event.documentIds).size;
  const hasTrustedSource = CANONICAL_SOURCE_TIERS.has(input.source.sourceTier as 'tier_0' | 'tier_1');
  return (
    hasNonGenericClaim &&
    input.validation.topDomainScore >= 0.6 &&
    input.validation.topDomainMargin >= 0.15 &&
    distinctDocumentCount >= 2 &&
    (input.event.nonSocialCorroborationCount >= 1 || hasTrustedSource)
  );
}

function determinePromotionPlan(input: {
  existing: IntelligenceEventClusterRecord | null;
  merged: IntelligenceEventClusterRecord;
  source: IntelligenceSourceRecord;
  validation: IntelligenceSemanticValidation;
  exactCanonicalUrlMatch: IntelligenceEventClusterRecord | null;
}): {
  promotionState: IntelligenceSignalPromotionState;
  promotionReasons: string[];
  lifecycleState: IntelligenceEventLifecycleState;
} {
  const restrictedSource = isRestrictedPromotionSource(input.source);
  const exactCanonicalMatch = input.exactCanonicalUrlMatch !== null;
  if (validationBlocksCanonicalWrite({
    validation: input.validation,
    hasExactCanonicalUrlMatch: exactCanonicalMatch,
  })) {
    return {
      promotionState: 'quarantined',
      promotionReasons: [...input.validation.reasons],
      lifecycleState: 'provisional',
    };
  }
  if (input.exactCanonicalUrlMatch?.lifecycleState === 'canonical') {
    return {
      promotionState: 'attached',
      promotionReasons: ['exact_canonical_url_match'],
      lifecycleState: 'canonical',
    };
  }
  if (restrictedSource && input.existing?.lifecycleState === 'canonical') {
    return {
      promotionState: 'attached',
      promotionReasons: ['restricted_source_attached_to_existing_canonical'],
      lifecycleState: 'canonical',
    };
  }
  if (restrictedSource) {
    return {
      promotionState: 'attached',
      promotionReasons: ['restricted_source_requires_corroboration'],
      lifecycleState: 'provisional',
    };
  }
  if (input.existing?.lifecycleState === 'canonical' || isCanonicalCreationSource(input.source)) {
    return {
      promotionState: 'promoted',
      promotionReasons: [],
      lifecycleState: 'canonical',
    };
  }
  if (canPromoteProvisionalEvent({
    event: input.merged,
    source: input.source,
    validation: input.validation,
  })) {
    return {
      promotionState: 'promoted',
      promotionReasons: [],
      lifecycleState: 'canonical',
    };
  }
  return {
    promotionState: 'attached',
    promotionReasons: ['awaiting_corroboration_for_promotion'],
    lifecycleState: 'provisional',
  };
}

function buildLinkedClaimShortlist(input: {
  claim: SemanticClaim;
  existingLinkedClaims: LinkedClaimRecord[];
  signalObservedAt: string | null;
}): Array<{ claim: LinkedClaimRecord; score: number }> {
  if (isGenericSemanticClaim(input.claim)) return [];
  const fingerprint = buildClaimFingerprint(input.claim, input.signalObservedAt);
  const claimAnchorMs = resolveClaimTemporalAnchorMs(input.claim, input.signalObservedAt);
  const exact = input.existingLinkedClaims.find((row) => row.claimFingerprint === fingerprint);
  if (exact) {
    const exactTimeScore = temporalDistanceScore(
      claimAnchorMs,
      resolveLinkedClaimTemporalAnchorMs(exact),
      EXACT_LINKED_CLAIM_WINDOW_MS,
    );
    if (exactTimeScore >= 0) {
      return [{ claim: exact, score: clampScore(0.92 + exactTimeScore * 0.08) }];
    }
    return [];
  }
  const canonical = buildClaimCanonicalText(input.claim);
  const predicateFamily = derivePredicateFamily(input.claim.predicate);
  const shortlist: Array<{ claim: LinkedClaimRecord; score: number }> = [];
  for (const row of input.existingLinkedClaims) {
    if (isGenericLinkedClaim(row)) continue;
    const timeScore = temporalDistanceScore(
      claimAnchorMs,
      resolveLinkedClaimTemporalAnchorMs(row),
      SHORTLIST_LINKED_CLAIM_WINDOW_MS,
    );
    if (timeScore < 0) continue;
    const lexicalScore = similarity(
      canonical,
      `${row.canonicalSubject} ${row.canonicalPredicate} ${row.canonicalObject}`,
    );
    const entityScore =
      normalizeClaimPart(row.canonicalSubject) === normalizeClaimPart(input.claim.subjectEntity) ? 0.3 : 0;
    const predicateScore = row.predicateFamily === predicateFamily ? 0.2 : 0;
    const score = lexicalScore + entityScore + predicateScore + 0.18 * timeScore;
    if (score < 0.7) continue;
    shortlist.push({ claim: row, score });
  }
  return shortlist.sort((left, right) => right.score - left.score).slice(0, 4);
}

function buildLinkedClaimEdgeShortlist(input: {
  claim: LinkedClaimRecord;
  existingLinkedClaims: LinkedClaimRecord[];
}): Array<{ claim: LinkedClaimRecord; score: number }> {
  if (isGenericLinkedClaim(input.claim)) return [];
  const claimAnchorMs = resolveLinkedClaimTemporalAnchorMs(input.claim);
  const claimText = `${input.claim.canonicalSubject} ${input.claim.canonicalPredicate} ${input.claim.canonicalObject}`;
  const shortlist: Array<{ claim: LinkedClaimRecord; score: number }> = [];
  for (const candidate of input.existingLinkedClaims) {
    if (candidate.id === input.claim.id) continue;
    if (isGenericLinkedClaim(candidate)) continue;
    const timeScore = temporalDistanceScore(
      claimAnchorMs,
      resolveLinkedClaimTemporalAnchorMs(candidate),
      SHORTLIST_LINKED_CLAIM_WINDOW_MS,
    );
    if (timeScore < 0) continue;
    const lexicalScore = similarity(
      claimText,
      `${candidate.canonicalSubject} ${candidate.canonicalPredicate} ${candidate.canonicalObject}`,
    );
    const subjectScore =
      normalizeClaimPart(candidate.canonicalSubject) === normalizeClaimPart(input.claim.canonicalSubject) ? 0.24 : 0;
    const predicateScore = candidate.predicateFamily === input.claim.predicateFamily ? 0.22 : 0;
    const score = lexicalScore + subjectScore + predicateScore + 0.14 * timeScore;
    if (score < 0.5) continue;
    shortlist.push({ claim: candidate, score });
  }
  return shortlist.sort((left, right) => right.score - left.score).slice(0, 6);
}

function dominantLinkedClaimOrientation(
  claim: Pick<LinkedClaimRecord, 'sourceCount' | 'contradictionCount'>,
): 'supporting' | 'contradicting' | 'mixed' {
  const supportingCount = Math.max(0, claim.sourceCount - claim.contradictionCount);
  if (claim.contradictionCount === 0) return 'supporting';
  if (supportingCount === 0) return 'contradicting';
  if (supportingCount === claim.contradictionCount) return 'mixed';
  return supportingCount > claim.contradictionCount ? 'supporting' : 'contradicting';
}

function inferLinkedClaimGraphRelation(input: {
  claim: LinkedClaimRecord;
  candidate: LinkedClaimRecord;
}): { relation: LinkedClaimEdgeRecord['relation']; confidence: number } | null {
  const sameSubject =
    normalizeClaimPart(input.claim.canonicalSubject) ===
    normalizeClaimPart(input.candidate.canonicalSubject);
  if (!sameSubject) return null;
  const leftFamily = input.claim.predicateFamily;
  const rightFamily = input.candidate.predicateFamily;
  const objectSimilarity = similarity(input.claim.canonicalObject, input.candidate.canonicalObject);
  const leftOrientation = dominantLinkedClaimOrientation(input.claim);
  const rightOrientation = dominantLinkedClaimOrientation(input.candidate);
  const oppositePressure =
    (leftFamily === 'pressure_up' && rightFamily === 'pressure_down') ||
    (leftFamily === 'pressure_down' && rightFamily === 'pressure_up');
  if (oppositePressure) {
    return { relation: 'contradicts', confidence: 0.78 };
  }
  if (
    ((leftFamily === 'challenge') !== (rightFamily === 'challenge') && objectSimilarity >= 0.18) ||
    (leftOrientation !== 'mixed' &&
      rightOrientation !== 'mixed' &&
      leftOrientation !== rightOrientation &&
      objectSimilarity >= 0.18)
  ) {
    return { relation: 'contradicts', confidence: 0.72 };
  }
  if (leftFamily === rightFamily && leftFamily !== 'general') {
    return { relation: 'supports', confidence: 0.74 };
  }
  if (objectSimilarity >= 0.45) {
    return {
      relation:
        leftOrientation === 'contradicting' || rightOrientation === 'contradicting'
          ? 'contradicts'
          : 'supports',
      confidence: 0.68,
    };
  }
  return null;
}

function canonicalizeLinkedClaimEdgePair(leftLinkedClaimId: string, rightLinkedClaimId: string): {
  leftLinkedClaimId: string;
  rightLinkedClaimId: string;
} {
  return leftLinkedClaimId.localeCompare(rightLinkedClaimId) <= 0
    ? { leftLinkedClaimId, rightLinkedClaimId }
    : { leftLinkedClaimId: rightLinkedClaimId, rightLinkedClaimId: leftLinkedClaimId };
}

type LinkedClaimGraphSummary = {
  graphSupportScore: number;
  graphContradictionScore: number;
  graphHotspotCount: number;
  contradictionRatio: number;
  hotspotClaimIds: string[];
};

function summarizeLinkedClaimGraph(input: {
  linkedClaims: LinkedClaimRecord[];
  edges: LinkedClaimEdgeRecord[];
}): LinkedClaimGraphSummary {
  if (input.linkedClaims.length === 0) {
    return {
      graphSupportScore: 0,
      graphContradictionScore: 0,
      graphHotspotCount: 0,
      contradictionRatio: 0,
      hotspotClaimIds: [],
    };
  }
  const supportEdges = input.edges.filter((row) => row.relation === 'supports');
  const contradictionEdges = input.edges.filter((row) => row.relation === 'contradicts');
  const supportStrength = supportEdges.reduce((total, row) => total + row.edgeStrength, 0);
  const contradictionStrength = contradictionEdges.reduce((total, row) => total + row.edgeStrength, 0);
  const hotspotClaimIds = new Set<string>();
  for (const claim of input.linkedClaims) {
    if (claim.contradictionCount > 0) hotspotClaimIds.add(claim.id);
  }
  for (const edge of contradictionEdges) {
    if (edge.edgeStrength >= 0.45) {
      hotspotClaimIds.add(edge.leftLinkedClaimId);
      hotspotClaimIds.add(edge.rightLinkedClaimId);
    }
  }
  const claimCount = Math.max(1, input.linkedClaims.length);
  const graphSupportScore = clampScore(
    supportStrength / Math.max(1, claimCount * 1.2),
  );
  const graphContradictionScore = clampScore(
    contradictionStrength / Math.max(1, claimCount) +
      hotspotClaimIds.size / Math.max(1, claimCount * 4),
  );
  return {
    graphSupportScore,
    graphContradictionScore,
    graphHotspotCount: hotspotClaimIds.size,
    contradictionRatio: clampScore(hotspotClaimIds.size / claimCount),
    hotspotClaimIds: [...hotspotClaimIds],
  };
}

function buildEventSemanticSignature(event: Pick<
  IntelligenceEventClusterRecord,
  'title' | 'summary' | 'semanticClaims' | 'primaryHypotheses'
>): string {
  const claimText = buildComparisonClaimText(event.semanticClaims);
  const hypothesisText = event.primaryHypotheses
    .map((row) => `${row.title} ${row.summary}`)
    .join(' ');
  return [event.title, event.summary, claimText, hypothesisText].join(' ').trim();
}

export function computeIntelligenceTemporalNarrativeProfile(input: {
  event: IntelligenceEventClusterRecord;
  candidateEvents: IntelligenceEventClusterRecord[];
}): {
  recurringNarrativeScore: number;
  relatedHistoricalEventCount: number;
  temporalNarrativeState: IntelligenceTemporalNarrativeState;
  relatedHistoricalEvents: IntelligenceRelatedHistoricalEventSummary[];
} {
  const currentAnchorMs = publishedMs(input.event.timeWindowEnd ?? input.event.updatedAt);
  const currentSignature = buildEventSemanticSignature(input.event);
  const relatedHistoricalEvents: IntelligenceRelatedHistoricalEventSummary[] = [];
  for (const candidate of input.candidateEvents) {
    if (candidate.id === input.event.id) continue;
    const candidateAnchorMs = publishedMs(candidate.timeWindowEnd ?? candidate.updatedAt);
    if (currentAnchorMs === null || candidateAnchorMs === null || candidateAnchorMs >= currentAnchorMs) {
      continue;
    }
    const deltaMs = currentAnchorMs - candidateAnchorMs;
    if (deltaMs > 90 * DAY_MS) continue;
    const titleScore = similarity(input.event.title, candidate.title);
    const entityOverlapCount = entityOverlap(input.event.entities, candidate.entities);
    const entityScore = clampScore(entityOverlapCount / 2);
    if (!eventsNarrativelyCompatible(input.event, candidate) && !(titleScore >= 0.75 && entityOverlapCount >= 1)) {
      continue;
    }
    const signatureScore = similarity(currentSignature, buildEventSemanticSignature(candidate));
    const sameDomainBoost = input.event.topDomainId && input.event.topDomainId === candidate.topDomainId ? 0.16 : 0;
    const sameFamilyBoost = input.event.eventFamily === candidate.eventFamily ? 0.18 : 0;
    const graphShapeScore = clampScore(
      1 -
        (
          Math.abs(input.event.graphSupportScore - candidate.graphSupportScore) +
          Math.abs(input.event.graphContradictionScore - candidate.graphContradictionScore) +
          Math.abs(input.event.timeCoherenceScore - candidate.timeCoherenceScore)
        ) / 3,
    );
    const score = clampScore(
      0.28 * entityScore +
        0.18 * titleScore +
        0.2 * signatureScore +
        sameDomainBoost +
        sameFamilyBoost +
        0.16 * graphShapeScore,
    );
    if (score < 0.48) continue;
    const relation: IntelligenceRelatedHistoricalEventSummary['relation'] =
      input.event.graphContradictionScore > candidate.graphContradictionScore + 0.12 ||
      input.event.graphHotspotCount > candidate.graphHotspotCount
        ? 'diverging'
        : candidate.graphSupportScore >= candidate.graphContradictionScore
          ? 'supportive_history'
          : 'recurring';
    relatedHistoricalEvents.push({
      eventId: candidate.id,
      title: candidate.title,
      relation,
      score,
      daysDelta: Math.max(1, Math.round(deltaMs / DAY_MS)),
      topDomainId: candidate.topDomainId,
      graphSupportScore: candidate.graphSupportScore,
      graphContradictionScore: candidate.graphContradictionScore,
      graphHotspotCount: candidate.graphHotspotCount,
      timeCoherenceScore: candidate.timeCoherenceScore,
    });
  }
  relatedHistoricalEvents
    .sort((left, right) => right.score - left.score || (left.daysDelta ?? Number.MAX_SAFE_INTEGER) - (right.daysDelta ?? Number.MAX_SAFE_INTEGER))
    .splice(6);

  const top = relatedHistoricalEvents[0] ?? null;
  const temporalNarrativeState: IntelligenceTemporalNarrativeState =
    !top
      ? 'new'
      : top.relation === 'diverging'
        ? 'diverging'
        : 'recurring';

  return {
    recurringNarrativeScore: top?.score ?? 0,
    relatedHistoricalEventCount: relatedHistoricalEvents.length,
    temporalNarrativeState,
    relatedHistoricalEvents,
  };
}

async function syncTemporalNarrativeLedgerForEvent(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  event: IntelligenceEventClusterRecord;
  candidateEvents: IntelligenceEventClusterRecord[];
}) {
  const temporal = computeIntelligenceTemporalNarrativeProfile({
    event: input.event,
    candidateEvents: input.candidateEvents,
  });
  const relatedEventRows = await Promise.all(
    temporal.relatedHistoricalEvents.map(async (row) => {
      const relatedEvent = await input.store.getIntelligenceEventById({
        workspaceId: input.workspaceId,
        eventId: row.eventId,
      });
      return relatedEvent ? row : null;
    }),
  );
  const relatedHistoricalEvents = relatedEventRows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  const top = relatedHistoricalEvents[0] ?? null;
  const nextTemporalNarrativeState: IntelligenceTemporalNarrativeState =
    !top
      ? 'new'
      : top.relation === 'diverging'
        ? 'diverging'
        : 'recurring';
  await input.store.replaceIntelligenceTemporalNarrativeLedgerEntries({
    workspaceId: input.workspaceId,
    eventId: input.event.id,
    entries: relatedHistoricalEvents.map((row) => ({
      workspaceId: input.workspaceId,
      eventId: input.event.id,
      relatedEventId: row.eventId,
      relatedEventTitle: row.title,
      relation: row.relation,
      score: row.score,
      daysDelta: row.daysDelta,
      topDomainId: row.topDomainId,
      graphSupportScore: row.graphSupportScore,
      graphContradictionScore: row.graphContradictionScore,
      graphHotspotCount: row.graphHotspotCount,
      timeCoherenceScore: row.timeCoherenceScore,
    })),
  });
  return {
    ...temporal,
    recurringNarrativeScore: top?.score ?? 0,
    relatedHistoricalEventCount: relatedHistoricalEvents.length,
    temporalNarrativeState: nextTemporalNarrativeState,
    relatedHistoricalEvents,
  };
}

type NarrativeClusterAggregate = {
  clusterKey: string;
  title: string;
  eventFamily: IntelligenceNarrativeClusterRecord['eventFamily'];
  topDomainId: IntelligenceNarrativeClusterRecord['topDomainId'];
  anchorEntities: string[];
  state: IntelligenceNarrativeClusterRecord['state'];
  eventCount: number;
  recurringEventCount: number;
  divergingEventCount: number;
  supportiveHistoryCount: number;
  hotspotEventCount: number;
  latestRecurringScore: number;
  driftScore: number;
  supportScore: number;
  contradictionScore: number;
  timeCoherenceScore: number;
  recurringStrengthTrend: number;
  divergenceTrend: number;
  supportDecayScore: number;
  contradictionAcceleration: number;
  clusterPriorityScore: number;
  recentExecutionBlockedCount: number;
  lastLedgerAt: string | null;
  lastEventAt: string | null;
  lastRecurringAt: string | null;
  lastDivergingAt: string | null;
};

function normalizeNarrativeAnchorEntities(values: string[]): string[] {
  return mergeUniqueStrings(values.map((row) => row.trim().toLowerCase()).filter(Boolean))
    .sort()
    .slice(0, 6);
}

function deriveNarrativeAnchorEntitiesForEvent(event: Pick<
  IntelligenceEventClusterRecord,
  'title' | 'entities' | 'semanticClaims' | 'eventFamily'
>): string[] {
  return normalizeNarrativeAnchorEntities([
    ...filterNarrativeAnchors(event.entities, event.eventFamily),
    primarySemanticAnchor(event),
  ]);
}

function buildNarrativeClusterKey(event: Pick<
  IntelligenceEventClusterRecord,
  'title' | 'eventFamily' | 'topDomainId' | 'entities' | 'semanticClaims'
>): string {
  const anchorEntities = deriveNarrativeAnchorEntitiesForEvent(event).slice(0, 3);
  return [
    event.eventFamily,
    event.topDomainId ?? 'unknown',
    anchorEntities.join('|') || 'no-entities',
  ].join('::');
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function eventAnchorIso(event: Pick<IntelligenceEventClusterRecord, 'timeWindowEnd' | 'updatedAt'>): string | null {
  return event.timeWindowEnd ?? event.updatedAt ?? null;
}

function bucketStartIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function clusterRecentReferenceMs(cluster: Pick<IntelligenceNarrativeClusterRecord, 'lastEventAt'> | null, memberEvents: IntelligenceEventClusterRecord[]): number {
  const values = memberEvents
    .map((row) => publishedMs(eventAnchorIso(row)))
    .filter((row): row is number => row !== null);
  const clusterValue = publishedMs(cluster?.lastEventAt ?? null);
  return Math.max(...values, clusterValue ?? 0, Date.now());
}

type NarrativeClusterTrendSummary = {
  recurringStrengthTrend: number;
  divergenceTrend: number;
  supportDecayScore: number;
  contradictionAcceleration: number;
  lastRecurringAt: string | null;
  lastDivergingAt: string | null;
};

export function resolveNarrativeClusterState(input: {
  previousState: IntelligenceNarrativeClusterRecord['state'] | null;
  recurringEventCount: number;
  divergingEventCount: number;
  supportiveHistoryCount: number;
  driftScore: number;
  supportScore: number;
  contradictionScore: number;
  hotspotEventCount: number;
  trendSummary: Pick<
    NarrativeClusterTrendSummary,
    'recurringStrengthTrend' | 'divergenceTrend' | 'supportDecayScore' | 'contradictionAcceleration'
  >;
}): IntelligenceNarrativeClusterRecord['state'] {
  const divergenceTriggered =
    input.divergingEventCount > 0 ||
    input.driftScore >= 0.58 ||
    input.trendSummary.divergenceTrend >= 0.18 ||
    input.trendSummary.contradictionAcceleration >= 0.16;
  const recurringTriggered =
    input.recurringEventCount > 0 ||
    input.supportiveHistoryCount > 0 ||
    input.trendSummary.recurringStrengthTrend >= 0.12;

  if (input.previousState === 'diverging') {
    const recovered =
      input.driftScore < 0.42 &&
      input.contradictionScore < 0.24 &&
      input.hotspotEventCount === 0 &&
      input.trendSummary.divergenceTrend < 0.08 &&
      input.trendSummary.contradictionAcceleration < 0.08 &&
      input.supportScore >= input.contradictionScore + 0.1;
    if (!recovered) {
      return 'diverging';
    }
    return recurringTriggered ? 'recurring' : 'forming';
  }

  if (input.previousState === 'recurring') {
    if (divergenceTriggered) {
      return 'diverging';
    }
    const recurringStillHealthy =
      input.supportScore >= input.contradictionScore - 0.05 ||
      input.trendSummary.supportDecayScore < 0.18 ||
      input.trendSummary.recurringStrengthTrend >= -0.08;
    return recurringTriggered || recurringStillHealthy ? 'recurring' : 'forming';
  }

  return divergenceTriggered ? 'diverging' : recurringTriggered ? 'recurring' : 'forming';
}

function computeNarrativeClusterTrendSummary(input: {
  memberEvents: IntelligenceEventClusterRecord[];
  referenceMs: number;
}): NarrativeClusterTrendSummary {
  const anchoredEvents = input.memberEvents
    .map((event) => ({
      event,
      anchorIso: eventAnchorIso(event),
      anchorMs: publishedMs(eventAnchorIso(event)),
    }))
    .filter((row): row is { event: IntelligenceEventClusterRecord; anchorIso: string | null; anchorMs: number } => row.anchorMs !== null);
  const recentWindow = anchoredEvents
    .filter((row) => input.referenceMs - row.anchorMs <= 30 * DAY_MS)
    .map((row) => row.event);
  const priorWindow = anchoredEvents
    .filter((row) => input.referenceMs - row.anchorMs > 30 * DAY_MS && input.referenceMs - row.anchorMs <= 60 * DAY_MS)
    .map((row) => row.event);
  const recurringSignal = (event: IntelligenceEventClusterRecord) =>
    Math.max(
      event.recurringNarrativeScore ?? 0,
      event.temporalNarrativeState === 'recurring' ? 0.7 : 0,
      event.temporalNarrativeState === 'diverging' ? 0 : 0.15,
    );
  const divergenceSignal = (event: IntelligenceEventClusterRecord) =>
    clampScore(
      0.45 * (event.temporalNarrativeState === 'diverging' ? 1 : 0) +
        0.3 * event.graphContradictionScore +
        0.15 * (event.graphHotspotCount > 0 ? 1 : 0) +
        0.1 * (1 - event.timeCoherenceScore),
    );
  const recentRecurring = average(recentWindow.map(recurringSignal));
  const priorRecurring = average(priorWindow.map(recurringSignal));
  const recentDivergence = average(recentWindow.map(divergenceSignal));
  const priorDivergence = average(priorWindow.map(divergenceSignal));
  const recentSupport = average(recentWindow.map((event) => event.graphSupportScore));
  const priorSupport = average(priorWindow.map((event) => event.graphSupportScore));
  const recentContradiction = average(recentWindow.map((event) => event.graphContradictionScore));
  const priorContradiction = average(priorWindow.map((event) => event.graphContradictionScore));
  const lastRecurringAt =
    anchoredEvents
      .filter((row) => row.event.temporalNarrativeState === 'recurring' || (row.event.recurringNarrativeScore ?? 0) >= 0.55)
      .sort((left, right) => right.anchorMs - left.anchorMs)[0]?.anchorIso ?? null;
  const lastDivergingAt =
    anchoredEvents
      .filter((row) => row.event.temporalNarrativeState === 'diverging' || row.event.graphContradictionScore >= 0.32 || row.event.graphHotspotCount > 0)
      .sort((left, right) => right.anchorMs - left.anchorMs)[0]?.anchorIso ?? null;

  return {
    recurringStrengthTrend: clampTrend(recentRecurring - priorRecurring),
    divergenceTrend: clampTrend(recentDivergence - priorDivergence),
    supportDecayScore: clampScore(Math.max(0, priorSupport - recentSupport)),
    contradictionAcceleration: clampScore(Math.max(0, recentContradiction - priorContradiction)),
    lastRecurringAt,
    lastDivergingAt,
  };
}

function anchorOverlap(left: string[], right: string[]): { count: number; ratio: number } {
  const leftSet = new Set(normalizeNarrativeAnchorEntities(left));
  const rightSet = new Set(normalizeNarrativeAnchorEntities(right));
  const overlapCount = [...leftSet].filter((row) => rightSet.has(row)).length;
  const ratio = Math.max(
    leftSet.size === 0 && rightSet.size === 0 ? 1 : 0,
    overlapCount / Math.max(1, Math.min(leftSet.size || 1, rightSet.size || 1)),
  );
  return { count: overlapCount, ratio };
}

function domainsCompatible(left: IntelligenceDomainId | null, right: IntelligenceDomainId | null): boolean {
  return left === right || left === null || right === null;
}

async function hydrateNarrativeClusterMemberEvents(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  memberships: IntelligenceNarrativeClusterMembershipRecord[];
  candidateEventsById: Map<string, IntelligenceEventClusterRecord>;
}): Promise<IntelligenceEventClusterRecord[]> {
  const rows = await Promise.all(
    input.memberships.map(async (membership) => {
      const cached = input.candidateEventsById.get(membership.eventId);
      if (cached) return cached;
      return input.store.getIntelligenceEventById({
        workspaceId: input.workspaceId,
        eventId: membership.eventId,
      });
    }),
  );
  return rows.filter((row): row is IntelligenceEventClusterRecord => row !== null);
}

function computeNarrativeClusterAggregate(input: {
  baseCluster: IntelligenceNarrativeClusterRecord | null;
  memberships: IntelligenceNarrativeClusterMembershipRecord[];
  memberEvents: IntelligenceEventClusterRecord[];
  defaultEvent: IntelligenceEventClusterRecord;
  latestRecurringScore: number;
  lastLedgerAt: string | null;
}): NarrativeClusterAggregate {
  const eventCount = Math.max(1, input.memberships.length);
  const recurringEventCount = input.memberships.filter((row) => row.relation === 'recurring').length;
  const divergingEventCount = input.memberships.filter((row) => row.relation === 'diverging').length;
  const supportiveHistoryCount = input.memberships.filter((row) => row.relation === 'supportive_history').length;
  const hotspotEventCount = input.memberEvents.filter((row) => row.graphHotspotCount > 0).length;
  const supportScore = clampScore(average(input.memberEvents.map((row) => row.graphSupportScore)));
  const contradictionScore = clampScore(average(input.memberEvents.map((row) => row.graphContradictionScore)));
  const timeCoherenceScore = clampScore(average(input.memberEvents.map((row) => row.timeCoherenceScore)));
  const recentReferenceMs = clusterRecentReferenceMs(input.baseCluster, input.memberEvents);
  const trendSummary = computeNarrativeClusterTrendSummary({
    memberEvents: input.memberEvents,
    referenceMs: recentReferenceMs,
  });
  const driftScore = clampScore(
    0.4 * (divergingEventCount / eventCount) +
      0.32 * contradictionScore +
      0.18 * (hotspotEventCount / eventCount) +
      0.06 * trendSummary.contradictionAcceleration +
      0.04 * (1 - timeCoherenceScore),
  );
  const state = resolveNarrativeClusterState({
    previousState: input.baseCluster?.state ?? null,
    recurringEventCount,
    divergingEventCount,
    supportiveHistoryCount,
    driftScore,
    supportScore,
    contradictionScore,
    hotspotEventCount,
    trendSummary,
  });
  const lastEventAt = input.memberEvents
    .map((row) => eventAnchorIso(row))
    .filter((row): row is string => Boolean(row))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  const recentBlockedEvents = input.memberEvents.filter((row) => {
    const anchorMs = publishedMs(eventAnchorIso(row));
    if (anchorMs === null || recentReferenceMs - anchorMs > 7 * DAY_MS) return false;
    return row.executionCandidates.some((candidate) => candidate.status === 'blocked');
  });
  const recentEvents = input.memberEvents.filter((row) => {
    const anchorMs = publishedMs(eventAnchorIso(row));
    return anchorMs !== null && recentReferenceMs - anchorMs <= 14 * DAY_MS;
  });
  const topDomainId = input.baseCluster?.topDomainId ??
    input.memberEvents.map((row) => row.topDomainId).find((row): row is IntelligenceDomainId => row !== null) ??
    input.defaultEvent.topDomainId ??
    null;
  const anchorEntities = normalizeNarrativeAnchorEntities([
    ...(input.baseCluster?.anchorEntities ?? []),
    ...input.memberEvents.flatMap((row) => deriveNarrativeAnchorEntitiesForEvent(row)),
    ...deriveNarrativeAnchorEntitiesForEvent(input.defaultEvent),
  ]);
  const partialCluster: Pick<
    IntelligenceNarrativeClusterRecord,
    | 'eventCount'
    | 'driftScore'
    | 'supportScore'
    | 'contradictionScore'
    | 'hotspotEventCount'
    | 'recurringStrengthTrend'
    | 'divergenceTrend'
    | 'supportDecayScore'
    | 'contradictionAcceleration'
    | 'reviewState'
    | 'recentExecutionBlockedCount'
  > = {
    eventCount,
    driftScore,
    supportScore,
    contradictionScore,
    hotspotEventCount,
    recurringStrengthTrend: trendSummary.recurringStrengthTrend,
    divergenceTrend: trendSummary.divergenceTrend,
    supportDecayScore: trendSummary.supportDecayScore,
    contradictionAcceleration: trendSummary.contradictionAcceleration,
    reviewState: input.baseCluster?.reviewState ?? 'watch',
    recentExecutionBlockedCount: recentBlockedEvents.length,
  };
  return {
    clusterKey: input.baseCluster?.clusterKey ?? buildNarrativeClusterKey(input.defaultEvent),
    title: input.baseCluster?.title ?? input.defaultEvent.title,
    eventFamily: input.baseCluster?.eventFamily ?? input.defaultEvent.eventFamily,
    topDomainId,
    anchorEntities,
    state,
    eventCount,
    recurringEventCount,
    divergingEventCount,
    supportiveHistoryCount,
    hotspotEventCount,
    latestRecurringScore: clampScore(
      Math.max(input.latestRecurringScore, ...input.memberEvents.map((row) => row.recurringNarrativeScore ?? 0)),
    ),
    driftScore,
    supportScore,
    contradictionScore,
    timeCoherenceScore,
    recurringStrengthTrend: trendSummary.recurringStrengthTrend,
    divergenceTrend: trendSummary.divergenceTrend,
    supportDecayScore: trendSummary.supportDecayScore,
    contradictionAcceleration: trendSummary.contradictionAcceleration,
    clusterPriorityScore: computeNarrativeClusterPriorityScore({
      cluster: partialCluster,
      recentEvents,
    }),
    recentExecutionBlockedCount: recentBlockedEvents.length,
    lastLedgerAt: input.lastLedgerAt,
    lastEventAt,
    lastRecurringAt: trendSummary.lastRecurringAt,
    lastDivergingAt: trendSummary.lastDivergingAt,
  };
}

function buildNarrativeClusterTimelineEntries(input: {
  workspaceId: string;
  clusterId: string;
  memberEvents: IntelligenceEventClusterRecord[];
}): CreateIntelligenceNarrativeClusterTimelineInput[] {
  const buckets = new Map<string, IntelligenceEventClusterRecord[]>();
  for (const event of input.memberEvents) {
    const bucketStart = bucketStartIso(eventAnchorIso(event));
    if (!bucketStart) continue;
    const current = buckets.get(bucketStart) ?? [];
    current.push(event);
    buckets.set(bucketStart, current);
  }
  return [...buckets.entries()]
    .map(([bucketStart, events]) => {
      const eventCount = events.length;
      const contradictionScore = clampScore(average(events.map((row) => row.graphContradictionScore)));
      const supportScore = clampScore(average(events.map((row) => row.graphSupportScore)));
      const timeCoherenceScore = clampScore(average(events.map((row) => row.timeCoherenceScore)));
      const hotspotEventCount = events.filter((row) => row.graphHotspotCount > 0).length;
      const recurringScore = clampScore(average(events.map((row) => row.recurringNarrativeScore ?? 0)));
      const driftScore = clampScore(
        0.42 * average(events.map((row) => (row.temporalNarrativeState === 'diverging' ? 1 : 0))) +
          0.34 * contradictionScore +
          0.16 * (hotspotEventCount / Math.max(1, eventCount)) +
          0.08 * (1 - timeCoherenceScore),
      );
      return {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        clusterId: input.clusterId,
        bucketStart,
        eventCount,
        recurringScore,
        driftScore,
        supportScore,
        contradictionScore,
        timeCoherenceScore,
        hotspotEventCount,
      };
    })
    .sort((left, right) => right.bucketStart.localeCompare(left.bucketStart));
}

async function upsertNarrativeClusterSnapshot(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  baseCluster: IntelligenceNarrativeClusterRecord | null;
  memberships: IntelligenceNarrativeClusterMembershipRecord[];
  memberEvents: IntelligenceEventClusterRecord[];
  defaultEvent: IntelligenceEventClusterRecord;
  latestRecurringScore: number;
  lastLedgerAt?: string | null;
}): Promise<IntelligenceNarrativeClusterRecord> {
  const aggregate = computeNarrativeClusterAggregate({
    baseCluster: input.baseCluster,
    memberships: input.memberships,
    memberEvents: input.memberEvents,
    defaultEvent: input.defaultEvent,
    latestRecurringScore: input.latestRecurringScore,
    lastLedgerAt: input.lastLedgerAt ?? input.baseCluster?.lastLedgerAt ?? null,
  });
  return input.store.upsertIntelligenceNarrativeCluster({
    id: input.baseCluster?.id,
    workspaceId: input.workspaceId,
    clusterKey: aggregate.clusterKey,
    title: aggregate.title,
    eventFamily: aggregate.eventFamily,
    topDomainId: aggregate.topDomainId,
    anchorEntities: aggregate.anchorEntities,
    state: aggregate.state,
    eventCount: aggregate.eventCount,
    recurringEventCount: aggregate.recurringEventCount,
    divergingEventCount: aggregate.divergingEventCount,
    supportiveHistoryCount: aggregate.supportiveHistoryCount,
    hotspotEventCount: aggregate.hotspotEventCount,
    latestRecurringScore: aggregate.latestRecurringScore,
    driftScore: aggregate.driftScore,
    supportScore: aggregate.supportScore,
    contradictionScore: aggregate.contradictionScore,
    timeCoherenceScore: aggregate.timeCoherenceScore,
    recurringStrengthTrend: aggregate.recurringStrengthTrend,
    divergenceTrend: aggregate.divergenceTrend,
    supportDecayScore: aggregate.supportDecayScore,
    contradictionAcceleration: aggregate.contradictionAcceleration,
    clusterPriorityScore: aggregate.clusterPriorityScore,
    recentExecutionBlockedCount: aggregate.recentExecutionBlockedCount,
    reviewState: input.baseCluster?.reviewState ?? 'watch',
    reviewReason: input.baseCluster?.reviewReason ?? null,
    reviewOwner: input.baseCluster?.reviewOwner ?? null,
    reviewUpdatedAt: input.baseCluster?.reviewUpdatedAt ?? null,
    reviewUpdatedBy: input.baseCluster?.reviewUpdatedBy ?? null,
    reviewResolvedAt: input.baseCluster?.reviewResolvedAt ?? null,
    lastLedgerAt: aggregate.lastLedgerAt,
    lastEventAt: aggregate.lastEventAt,
    lastRecurringAt: aggregate.lastRecurringAt,
    lastDivergingAt: aggregate.lastDivergingAt,
  });
}

async function createNarrativeClusterLedgerEntry(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  clusterId: string;
  entryType: IntelligenceNarrativeClusterLedgerEntryRecord['entryType'];
  summary: string;
  scoreDelta: number;
  sourceEventIds: string[];
}): Promise<IntelligenceNarrativeClusterLedgerEntryRecord> {
  return input.store.createIntelligenceNarrativeClusterLedgerEntry({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    clusterId: input.clusterId,
    entryType: input.entryType,
    summary: input.summary,
    scoreDelta: Number(input.scoreDelta.toFixed(3)),
    sourceEventIds: mergeUniqueStrings(input.sourceEventIds),
  });
}

async function syncNarrativeClusterTimeline(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  clusterId: string;
  memberEvents: IntelligenceEventClusterRecord[];
}) {
  await input.store.replaceIntelligenceNarrativeClusterTimelineEntries({
    workspaceId: input.workspaceId,
    clusterId: input.clusterId,
    entries: buildNarrativeClusterTimelineEntries({
      workspaceId: input.workspaceId,
      clusterId: input.clusterId,
      memberEvents: input.memberEvents,
    }),
  });
}

async function maybeRecordNarrativeClusterStateShift(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  previousCluster: IntelligenceNarrativeClusterRecord | null;
  nextCluster: IntelligenceNarrativeClusterRecord;
  sourceEventIds: string[];
}): Promise<string | null> {
  if (!input.previousCluster) return null;
  let latestLedgerAt: string | null = null;
  const maybeCreate = async (
    shouldCreate: boolean,
    entryType: IntelligenceNarrativeClusterLedgerEntryRecord['entryType'],
    summary: string,
    scoreDelta: number,
  ) => {
    if (!shouldCreate) return;
    const entry = await createNarrativeClusterLedgerEntry({
      store: input.store,
      workspaceId: input.workspaceId,
      clusterId: input.nextCluster.id,
      entryType,
      summary,
      scoreDelta,
      sourceEventIds: input.sourceEventIds,
    });
    latestLedgerAt = entry.createdAt;
  };

  await maybeCreate(
    input.nextCluster.state === 'recurring' &&
      input.nextCluster.latestRecurringScore >= input.previousCluster.latestRecurringScore + 0.1,
    'recurring_strengthened',
    `Recurring narrative strengthened for cluster "${input.nextCluster.title}".`,
    input.nextCluster.latestRecurringScore - input.previousCluster.latestRecurringScore,
  );
  await maybeCreate(
    input.nextCluster.state === 'diverging' &&
      (input.previousCluster.state !== 'diverging' || input.nextCluster.driftScore >= input.previousCluster.driftScore + 0.08),
    'diverging_strengthened',
    `Diverging pressure increased for cluster "${input.nextCluster.title}".`,
    input.nextCluster.driftScore - input.previousCluster.driftScore,
  );
  await maybeCreate(
    input.nextCluster.supportiveHistoryCount > input.previousCluster.supportiveHistoryCount,
    'supportive_history_added',
    `Supportive history expanded for cluster "${input.nextCluster.title}".`,
    input.nextCluster.supportiveHistoryCount - input.previousCluster.supportiveHistoryCount,
  );
  await maybeCreate(
    input.nextCluster.timeCoherenceScore <= input.previousCluster.timeCoherenceScore - 0.12,
    'stability_drop',
    `Stability dropped for cluster "${input.nextCluster.title}".`,
    input.nextCluster.timeCoherenceScore - input.previousCluster.timeCoherenceScore,
  );
  return latestLedgerAt;
}

async function loadClusterMemberships(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  clusterId: string;
}): Promise<IntelligenceNarrativeClusterMembershipRecord[]> {
  return input.store.listIntelligenceNarrativeClusterMemberships({
    workspaceId: input.workspaceId,
    clusterId: input.clusterId,
    limit: 500,
  });
}

function clusterHasRecentEvent(cluster: Pick<IntelligenceNarrativeClusterRecord, 'lastEventAt'>): boolean {
  const lastMs = publishedMs(cluster.lastEventAt);
  return lastMs !== null && Date.now() - lastMs <= 30 * DAY_MS;
}

function chooseCanonicalCluster(
  left: IntelligenceNarrativeClusterRecord,
  right: IntelligenceNarrativeClusterRecord,
): { canonical: IntelligenceNarrativeClusterRecord; absorbed: IntelligenceNarrativeClusterRecord } {
  return Date.parse(left.createdAt) <= Date.parse(right.createdAt)
    ? { canonical: left, absorbed: right }
    : { canonical: right, absorbed: left };
}

function findCanonicalNarrativeClusterByTitle(input: {
  clusters: IntelligenceNarrativeClusterRecord[];
  event: IntelligenceEventClusterRecord;
}): IntelligenceNarrativeClusterRecord | null {
  const targetKey = buildNormalizedTitleKey(input.event.title);
  const targetAnchorMs = publishedMs(eventAnchorIso(input.event));
  const matches = input.clusters.filter((cluster) => {
    if (cluster.eventFamily !== input.event.eventFamily) return false;
    if (!domainsCompatible(cluster.topDomainId, input.event.topDomainId)) return false;
    if (buildNormalizedTitleKey(cluster.title) !== targetKey) return false;
    const clusterAnchorMs = publishedMs(cluster.lastEventAt ?? cluster.updatedAt);
    if (targetAnchorMs !== null && clusterAnchorMs !== null && Math.abs(targetAnchorMs - clusterAnchorMs) > CANONICAL_CLUSTER_WINDOW_MS) {
      return false;
    }
    return true;
  });
  if (matches.length === 0) return null;
  return matches.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0] ?? null;
}

async function tryMergeNarrativeCluster(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  currentCluster: IntelligenceNarrativeClusterRecord;
  currentMemberships: IntelligenceNarrativeClusterMembershipRecord[];
  currentMemberEvents: IntelligenceEventClusterRecord[];
  currentEvent: IntelligenceEventClusterRecord;
  temporal: ReturnType<typeof computeIntelligenceTemporalNarrativeProfile>;
  candidateEventsById: Map<string, IntelligenceEventClusterRecord>;
}): Promise<{
  cluster: IntelligenceNarrativeClusterRecord;
  memberships: IntelligenceNarrativeClusterMembershipRecord[];
  memberEvents: IntelligenceEventClusterRecord[];
} | null> {
  const clusters = await input.store.listIntelligenceNarrativeClusters({
    workspaceId: input.workspaceId,
    limit: 200,
  });
  const scoresByClusterId = new Map<string, number[]>();
  for (const related of input.temporal.relatedHistoricalEvents) {
    if (!(related.relation === 'recurring' || related.relation === 'supportive_history')) continue;
    const membership = (
      await input.store.listIntelligenceNarrativeClusterMemberships({
        workspaceId: input.workspaceId,
        eventId: related.eventId,
        limit: 1,
      })
    )[0];
    if (!membership || membership.clusterId === input.currentCluster.id) continue;
    const current = scoresByClusterId.get(membership.clusterId) ?? [];
    current.push(related.score);
    scoresByClusterId.set(membership.clusterId, current);
  }

  let best:
    | {
        cluster: IntelligenceNarrativeClusterRecord;
        averageScore: number;
      }
    | null = null;
  for (const cluster of clusters) {
    if (cluster.id === input.currentCluster.id) continue;
    if (cluster.eventFamily !== input.currentCluster.eventFamily) continue;
    if (!domainsCompatible(cluster.topDomainId, input.currentCluster.topDomainId)) continue;
    if (!clusterHasRecentEvent(cluster) || !clusterHasRecentEvent(input.currentCluster)) continue;
    const overlap = anchorOverlap(cluster.anchorEntities, input.currentCluster.anchorEntities);
    if (overlap.count < 2 && overlap.ratio < 0.5) continue;
    const averageScore = average(scoresByClusterId.get(cluster.id) ?? []);
    if (averageScore < 0.72) continue;
    if (Math.abs(cluster.contradictionScore - input.currentCluster.contradictionScore) > 0.22) continue;
    if (!best || averageScore > best.averageScore) {
      best = { cluster, averageScore };
    }
  }
  if (!best) return null;

  const { canonical, absorbed } = chooseCanonicalCluster(input.currentCluster, best.cluster);
  const [canonicalMemberships, absorbedMemberships] = await Promise.all([
    loadClusterMemberships({
      store: input.store,
      workspaceId: input.workspaceId,
      clusterId: canonical.id,
    }),
    loadClusterMemberships({
      store: input.store,
      workspaceId: input.workspaceId,
      clusterId: absorbed.id,
    }),
  ]);
  const membershipsByEventId = new Map<string, IntelligenceNarrativeClusterMembershipRecord>();
  for (const membership of [...canonicalMemberships, ...absorbedMemberships]) {
    const existing = membershipsByEventId.get(membership.eventId);
    if (!existing || membership.score > existing.score) {
      membershipsByEventId.set(membership.eventId, {
        ...membership,
        clusterId: canonical.id,
      });
    }
  }
  const mergedMemberships = [...membershipsByEventId.values()];
  const mergedMemberEvents = await hydrateNarrativeClusterMemberEvents({
    store: input.store,
    workspaceId: input.workspaceId,
    memberships: mergedMemberships,
    candidateEventsById: input.candidateEventsById,
  });
  if (hasNarrativeClusterHeterogeneityVeto(mergedMemberEvents)) {
    return null;
  }
  const mergedCluster = await upsertNarrativeClusterSnapshot({
    store: input.store,
    workspaceId: input.workspaceId,
    baseCluster: canonical,
    memberships: mergedMemberships,
    memberEvents: mergedMemberEvents,
    defaultEvent: input.currentEvent,
    latestRecurringScore: Math.max(
      canonical.latestRecurringScore,
      absorbed.latestRecurringScore,
      input.temporal.recurringNarrativeScore,
    ),
    lastLedgerAt: canonical.lastLedgerAt,
  });
  const persistedMemberships: IntelligenceNarrativeClusterMembershipRecord[] = [];
  for (const membership of mergedMemberships) {
    persistedMemberships.push(
      await input.store.upsertIntelligenceNarrativeClusterMembership({
        id: membership.id,
        workspaceId: input.workspaceId,
        clusterId: mergedCluster.id,
        eventId: membership.eventId,
        relation: membership.relation,
        score: membership.score,
        daysDelta: membership.daysDelta,
        isLatest: membership.eventId === input.currentEvent.id,
      }),
    );
  }
  await input.store.deleteIntelligenceNarrativeCluster({
    workspaceId: input.workspaceId,
    clusterId: absorbed.id,
  });
  const ledgerEntry = await createNarrativeClusterLedgerEntry({
    store: input.store,
    workspaceId: input.workspaceId,
    clusterId: mergedCluster.id,
    entryType: 'merge',
    summary: `Merged narrative cluster "${absorbed.title}" into "${canonical.title}".`,
    scoreDelta: best.averageScore,
    sourceEventIds: mergedMemberships.map((row) => row.eventId),
  });
  const finalCluster = await upsertNarrativeClusterSnapshot({
    store: input.store,
    workspaceId: input.workspaceId,
    baseCluster: mergedCluster,
    memberships: persistedMemberships,
    memberEvents: mergedMemberEvents,
    defaultEvent: input.currentEvent,
    latestRecurringScore: mergedCluster.latestRecurringScore,
    lastLedgerAt: ledgerEntry.createdAt,
  });
  await syncNarrativeClusterTimeline({
    store: input.store,
    workspaceId: input.workspaceId,
    clusterId: finalCluster.id,
    memberEvents: mergedMemberEvents,
  });
  return {
    cluster: finalCluster,
    memberships: persistedMemberships,
    memberEvents: mergedMemberEvents,
  };
}

function pickSplitEventIds(input: {
  cluster: IntelligenceNarrativeClusterRecord;
  memberships: IntelligenceNarrativeClusterMembershipRecord[];
  memberEvents: IntelligenceEventClusterRecord[];
}): string[] {
  if (input.memberEvents.length < 2) return [];
  const referenceMs = clusterRecentReferenceMs(input.cluster, input.memberEvents);
  const recentEvents = input.memberEvents.filter((row) => {
    const anchorMs = publishedMs(eventAnchorIso(row));
    return anchorMs !== null && referenceMs - anchorMs <= 14 * DAY_MS;
  });
  if (recentEvents.length < 2) return [];
  const membershipByEventId = new Map(input.memberships.map((row) => [row.eventId, row] as const));
  const subgroup = recentEvents.filter((row) => {
    const membership = membershipByEventId.get(row.id);
    return (
      membership?.relation === 'diverging' ||
      row.temporalNarrativeState === 'diverging' ||
      row.graphHotspotCount > 0 ||
      row.graphContradictionScore >= row.graphSupportScore + 0.08
    );
  });
  if (subgroup.length === 0 || subgroup.length >= input.memberEvents.length) return [];
  const divergingRatio =
    recentEvents.filter((row) => {
      const membership = membershipByEventId.get(row.id);
      return membership?.relation === 'diverging' || row.temporalNarrativeState === 'diverging';
    }).length / recentEvents.length;
  const hotspotRatio = recentEvents.filter((row) => row.graphHotspotCount > 0).length / recentEvents.length;
  const supportGap = input.cluster.supportScore - input.cluster.contradictionScore;
  const rest = input.memberEvents.filter((row) => !subgroup.some((candidate) => candidate.id === row.id));
  if (rest.length === 0) return [];
  const subgroupSupportDensity = average(subgroup.map((row) => row.graphSupportScore));
  const restSupportDensity = average(rest.map((row) => row.graphSupportScore));
  const supportDensityDiff = Math.abs(subgroupSupportDensity - restSupportDensity);
  const shouldSplit =
    divergingRatio >= 0.45 ||
    hotspotRatio >= 0.4 ||
    (supportGap <= 0.08 && input.cluster.driftScore >= 0.58) ||
    supportDensityDiff >= 0.28;
  return shouldSplit ? subgroup.map((row) => row.id) : [];
}

async function trySplitNarrativeCluster(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  currentCluster: IntelligenceNarrativeClusterRecord;
  currentMemberships: IntelligenceNarrativeClusterMembershipRecord[];
  currentMemberEvents: IntelligenceEventClusterRecord[];
  currentEvent: IntelligenceEventClusterRecord;
}): Promise<{
  cluster: IntelligenceNarrativeClusterRecord;
  memberships: IntelligenceNarrativeClusterMembershipRecord[];
  memberEvents: IntelligenceEventClusterRecord[];
} | null> {
  const splitEventIds = new Set(
    pickSplitEventIds({
      cluster: input.currentCluster,
      memberships: input.currentMemberships,
      memberEvents: input.currentMemberEvents,
    }),
  );
  if (splitEventIds.size === 0) return null;
  const subgroupMemberships = input.currentMemberships.filter((row) => splitEventIds.has(row.eventId));
  const subgroupEvents = input.currentMemberEvents.filter((row) => splitEventIds.has(row.id));
  const retainedMemberships = input.currentMemberships.filter((row) => !splitEventIds.has(row.eventId));
  const retainedEvents = input.currentMemberEvents.filter((row) => !splitEventIds.has(row.id));
  if (subgroupMemberships.length === 0 || retainedMemberships.length === 0) return null;

  const subgroupAnchorEvent =
    subgroupEvents
      .slice()
      .sort((left, right) => Date.parse(eventAnchorIso(right) ?? '') - Date.parse(eventAnchorIso(left) ?? ''))[0] ??
    input.currentEvent;
  const newCluster = await upsertNarrativeClusterSnapshot({
    store: input.store,
    workspaceId: input.workspaceId,
    baseCluster: {
      ...input.currentCluster,
      id: randomUUID(),
      clusterKey: `${buildNarrativeClusterKey(subgroupAnchorEvent)}::split::${subgroupAnchorEvent.id.slice(0, 8)}`,
      title: subgroupAnchorEvent.title,
      state: 'diverging',
      reviewState: 'watch',
      reviewReason: null,
      reviewOwner: null,
      reviewUpdatedAt: null,
      reviewUpdatedBy: null,
      reviewResolvedAt: null,
      clusterPriorityScore: 0,
      recentExecutionBlockedCount: 0,
      lastLedgerAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastEventAt: subgroupAnchorEvent.timeWindowEnd ?? subgroupAnchorEvent.updatedAt,
    },
    memberships: subgroupMemberships,
    memberEvents: subgroupEvents,
    defaultEvent: subgroupAnchorEvent,
    latestRecurringScore: Math.max(...subgroupEvents.map((row) => row.recurringNarrativeScore ?? 0), 0.55),
    lastLedgerAt: null,
  });
  const persistedSubgroupMemberships: IntelligenceNarrativeClusterMembershipRecord[] = [];
  for (const membership of subgroupMemberships) {
    persistedSubgroupMemberships.push(
      await input.store.upsertIntelligenceNarrativeClusterMembership({
        id: membership.id,
        workspaceId: input.workspaceId,
        clusterId: newCluster.id,
        eventId: membership.eventId,
        relation: membership.relation === 'origin' ? 'diverging' : membership.relation,
        score: membership.score,
        daysDelta: membership.daysDelta,
        isLatest: membership.eventId === input.currentEvent.id,
      }),
    );
  }
  let retainedCluster = await upsertNarrativeClusterSnapshot({
    store: input.store,
    workspaceId: input.workspaceId,
    baseCluster: input.currentCluster,
    memberships: retainedMemberships,
    memberEvents: retainedEvents,
    defaultEvent: retainedEvents[0] ?? input.currentEvent,
    latestRecurringScore: Math.max(...retainedEvents.map((row) => row.recurringNarrativeScore ?? 0), 0.4),
    lastLedgerAt: input.currentCluster.lastLedgerAt,
  });
  const retainedPersistedMemberships: IntelligenceNarrativeClusterMembershipRecord[] = [];
  for (const membership of retainedMemberships) {
    retainedPersistedMemberships.push(
      await input.store.upsertIntelligenceNarrativeClusterMembership({
        id: membership.id,
        workspaceId: input.workspaceId,
        clusterId: retainedCluster.id,
        eventId: membership.eventId,
        relation: membership.relation,
        score: membership.score,
        daysDelta: membership.daysDelta,
        isLatest: membership.eventId === input.currentEvent.id,
      }),
    );
  }
  const retainedLedger = await createNarrativeClusterLedgerEntry({
    store: input.store,
    workspaceId: input.workspaceId,
    clusterId: retainedCluster.id,
    entryType: 'split',
    summary: `Split contradiction-heavy subgroup from cluster "${input.currentCluster.title}".`,
    scoreDelta: -input.currentCluster.driftScore,
    sourceEventIds: subgroupMemberships.map((row) => row.eventId),
  });
  retainedCluster = await upsertNarrativeClusterSnapshot({
    store: input.store,
    workspaceId: input.workspaceId,
    baseCluster: retainedCluster,
    memberships: retainedPersistedMemberships,
    memberEvents: retainedEvents,
    defaultEvent: retainedEvents[0] ?? input.currentEvent,
    latestRecurringScore: retainedCluster.latestRecurringScore,
    lastLedgerAt: retainedLedger.createdAt,
  });
  const newLedger = await createNarrativeClusterLedgerEntry({
    store: input.store,
    workspaceId: input.workspaceId,
    clusterId: newCluster.id,
    entryType: 'split',
    summary: `Created diverging narrative cluster from "${input.currentCluster.title}".`,
    scoreDelta: input.currentCluster.driftScore,
    sourceEventIds: subgroupMemberships.map((row) => row.eventId),
  });
  const finalNewCluster = await upsertNarrativeClusterSnapshot({
    store: input.store,
    workspaceId: input.workspaceId,
    baseCluster: newCluster,
    memberships: persistedSubgroupMemberships,
    memberEvents: subgroupEvents,
    defaultEvent: subgroupAnchorEvent,
    latestRecurringScore: newCluster.latestRecurringScore,
    lastLedgerAt: newLedger.createdAt,
  });
  await Promise.all([
    syncNarrativeClusterTimeline({
      store: input.store,
      workspaceId: input.workspaceId,
      clusterId: retainedCluster.id,
      memberEvents: retainedEvents,
    }),
    syncNarrativeClusterTimeline({
      store: input.store,
      workspaceId: input.workspaceId,
      clusterId: finalNewCluster.id,
      memberEvents: subgroupEvents,
    }),
  ]);
  if (splitEventIds.has(input.currentEvent.id)) {
    return {
      cluster: finalNewCluster,
      memberships: persistedSubgroupMemberships,
      memberEvents: subgroupEvents,
    };
  }
  return {
    cluster: retainedCluster,
    memberships: retainedPersistedMemberships,
    memberEvents: retainedEvents,
  };
}

async function syncNarrativeClusterForEvent(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  event: IntelligenceEventClusterRecord;
  temporal: ReturnType<typeof computeIntelligenceTemporalNarrativeProfile>;
  candidateEvents: IntelligenceEventClusterRecord[];
}): Promise<{
  cluster: IntelligenceNarrativeClusterRecord;
  memberships: IntelligenceNarrativeClusterMembershipRecord[];
}> {
  const [existingMembership, allClusters] = await Promise.all([
    (
      await input.store.listIntelligenceNarrativeClusterMemberships({
        workspaceId: input.workspaceId,
        eventId: input.event.id,
        limit: 1,
      })
    )[0] ?? null,
    input.store.listIntelligenceNarrativeClusters({
      workspaceId: input.workspaceId,
      limit: 200,
    }),
  ]);

  let cluster: IntelligenceNarrativeClusterRecord | null = existingMembership
    ? await input.store.getIntelligenceNarrativeClusterById({
        workspaceId: input.workspaceId,
        clusterId: existingMembership.clusterId,
      })
    : null;
  if (cluster && !clusterCompatibleWithEvent({ cluster, event: input.event })) {
    cluster = null;
  }

  if (!cluster) {
    for (const related of input.temporal.relatedHistoricalEvents) {
      const membership = (
        await input.store.listIntelligenceNarrativeClusterMemberships({
          workspaceId: input.workspaceId,
          eventId: related.eventId,
          limit: 1,
        })
      )[0];
      if (!membership) continue;
      const candidateCluster = await input.store.getIntelligenceNarrativeClusterById({
        workspaceId: input.workspaceId,
        clusterId: membership.clusterId,
      });
      if (!candidateCluster || !clusterCompatibleWithEvent({ cluster: candidateCluster, event: input.event })) continue;
      cluster = candidateCluster;
      break;
    }
  }

  if (!cluster) {
    cluster = findCanonicalNarrativeClusterByTitle({
      clusters: allClusters,
      event: input.event,
    });
  }

  const membersByEventId = new Map<string, IntelligenceNarrativeClusterMembershipRecord>();
  if (cluster) {
    for (const membership of await loadClusterMemberships({
      store: input.store,
      workspaceId: input.workspaceId,
      clusterId: cluster.id,
    })) {
      membersByEventId.set(membership.eventId, membership);
    }
  }

  const candidateEventsById = new Map(input.candidateEvents.map((row) => [row.id, row] as const));
  candidateEventsById.set(input.event.id, input.event);
  const clusterMembersToUpsert: Array<{
    eventId: string;
    relation: IntelligenceNarrativeClusterMembershipRecord['relation'];
    score: number;
    daysDelta: number | null;
    isLatest: boolean;
  }> = [
    {
      eventId: input.event.id,
      relation:
        input.temporal.temporalNarrativeState === 'new'
          ? 'origin'
          : input.temporal.temporalNarrativeState,
      score: Math.max(input.temporal.recurringNarrativeScore, 0.55),
      daysDelta: null,
      isLatest: true,
    },
    ...input.temporal.relatedHistoricalEvents.map((row) => ({
      eventId: row.eventId,
      relation: row.relation,
      score: row.score,
      daysDelta: row.daysDelta,
      isLatest: false,
    })),
  ];
  const priorMembershipsByEventId = new Map<string, IntelligenceNarrativeClusterMembershipRecord>();
  const priorMemberships = await Promise.all(
    [...new Set(clusterMembersToUpsert.map((row) => row.eventId))].map(async (eventId) => {
      if (eventId === input.event.id && existingMembership) return existingMembership;
      return (
        await input.store.listIntelligenceNarrativeClusterMemberships({
          workspaceId: input.workspaceId,
          eventId,
          limit: 1,
        })
      )[0] ?? null;
    }),
  );
  for (const membership of priorMemberships) {
    if (!membership) continue;
    priorMembershipsByEventId.set(membership.eventId, membership);
  }

  for (const membership of clusterMembersToUpsert) {
    const existing = membersByEventId.get(membership.eventId);
    membersByEventId.set(membership.eventId, {
      id: existing?.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      clusterId: cluster?.id ?? '',
      eventId: membership.eventId,
      relation: membership.relation,
      score: membership.score,
      daysDelta: membership.daysDelta,
      isLatest: membership.isLatest,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    });
  }

  let memberships = [...membersByEventId.values()];
  let memberEvents = await hydrateNarrativeClusterMemberEvents({
    store: input.store,
    workspaceId: input.workspaceId,
    memberships,
    candidateEventsById,
  });
  const previousCluster = cluster;
  let persistedCluster = await upsertNarrativeClusterSnapshot({
    store: input.store,
    workspaceId: input.workspaceId,
    baseCluster: cluster,
    memberships,
    memberEvents,
    defaultEvent: input.event,
    latestRecurringScore: input.temporal.recurringNarrativeScore,
    lastLedgerAt: cluster?.lastLedgerAt,
  });
  const persistedMemberships: IntelligenceNarrativeClusterMembershipRecord[] = [];
  for (const membership of memberships) {
    persistedMemberships.push(
      await input.store.upsertIntelligenceNarrativeClusterMembership({
        id: membership.id,
        workspaceId: input.workspaceId,
        clusterId: persistedCluster.id,
        eventId: membership.eventId,
        relation: membership.relation,
        score: membership.score,
        daysDelta: membership.daysDelta,
        isLatest: membership.eventId === input.event.id,
      }),
    );
  }
  memberships = persistedMemberships;

  const shiftedLedgerAt = await maybeRecordNarrativeClusterStateShift({
    store: input.store,
    workspaceId: input.workspaceId,
    previousCluster,
    nextCluster: persistedCluster,
    sourceEventIds: memberships.map((row) => row.eventId),
  });
  if (shiftedLedgerAt) {
    persistedCluster = await upsertNarrativeClusterSnapshot({
      store: input.store,
      workspaceId: input.workspaceId,
      baseCluster: persistedCluster,
      memberships,
      memberEvents,
      defaultEvent: input.event,
      latestRecurringScore: persistedCluster.latestRecurringScore,
      lastLedgerAt: shiftedLedgerAt,
    });
  }

  const merged = await tryMergeNarrativeCluster({
    store: input.store,
    workspaceId: input.workspaceId,
    currentCluster: persistedCluster,
    currentMemberships: memberships,
    currentMemberEvents: memberEvents,
    currentEvent: input.event,
    temporal: input.temporal,
    candidateEventsById,
  });
  if (merged) {
    persistedCluster = merged.cluster;
    memberships = merged.memberships;
    memberEvents = merged.memberEvents;
  }

  const split = await trySplitNarrativeCluster({
    store: input.store,
    workspaceId: input.workspaceId,
    currentCluster: persistedCluster,
    currentMemberships: memberships,
    currentMemberEvents: memberEvents,
    currentEvent: input.event,
  });
  if (split) {
    persistedCluster = split.cluster;
    memberships = split.memberships;
    memberEvents = split.memberEvents;
  }

  await syncNarrativeClusterTimeline({
    store: input.store,
    workspaceId: input.workspaceId,
    clusterId: persistedCluster.id,
    memberEvents,
  });
  const displacedClusterIds = new Set<string>();
  for (const membership of memberships) {
    const previousMembership = priorMembershipsByEventId.get(membership.eventId);
    if (!previousMembership) continue;
    if (previousMembership.clusterId !== membership.clusterId) {
      displacedClusterIds.add(previousMembership.clusterId);
    }
  }
  await Promise.all(
    [...displacedClusterIds]
      .filter((clusterId) => clusterId !== persistedCluster.id)
      .map((clusterId) =>
        reconcileNarrativeClusterAfterEventRemoval({
          store: input.store,
          workspaceId: input.workspaceId,
          clusterId,
        }),
      ),
  );

  return { cluster: persistedCluster, memberships };
}

async function reconcileNarrativeClusterAfterEventRemoval(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  clusterId: string;
}): Promise<IntelligenceNarrativeClusterRecord | null> {
  const cluster = await input.store.getIntelligenceNarrativeClusterById({
    workspaceId: input.workspaceId,
    clusterId: input.clusterId,
  });
  if (!cluster) return null;

  const memberships = await loadClusterMemberships({
    store: input.store,
    workspaceId: input.workspaceId,
    clusterId: cluster.id,
  });
  if (memberships.length === 0) {
    await input.store.deleteIntelligenceNarrativeCluster({
      workspaceId: input.workspaceId,
      clusterId: cluster.id,
    });
    return null;
  }

  const memberEvents = await hydrateNarrativeClusterMemberEvents({
    store: input.store,
    workspaceId: input.workspaceId,
    memberships,
    candidateEventsById: new Map(),
  });
  if (memberEvents.length === 0) {
    await input.store.deleteIntelligenceNarrativeCluster({
      workspaceId: input.workspaceId,
      clusterId: cluster.id,
    });
    return null;
  }

  const defaultEvent =
    memberEvents
      .slice()
      .sort((left, right) => Date.parse(eventAnchorIso(right) ?? '') - Date.parse(eventAnchorIso(left) ?? ''))[0] ??
    memberEvents[0]!;
  const latestRecurringScore = Math.max(...memberEvents.map((row) => row.recurringNarrativeScore ?? 0), 0);
  const repairedCluster = await upsertNarrativeClusterSnapshot({
    store: input.store,
    workspaceId: input.workspaceId,
    baseCluster: cluster,
    memberships,
    memberEvents,
    defaultEvent,
    latestRecurringScore,
    lastLedgerAt: cluster.lastLedgerAt,
  });
  await syncNarrativeClusterTimeline({
    store: input.store,
    workspaceId: input.workspaceId,
    clusterId: repairedCluster.id,
    memberEvents,
  });
  return repairedCluster;
}

export function buildIntelligenceHotspotClusters(input: {
  linkedClaims: LinkedClaimRecord[];
  edges: LinkedClaimEdgeRecord[];
}): IntelligenceHotspotCluster[] {
  const neighborhoods = buildIntelligenceGraphNeighborhoods({
    linkedClaims: input.linkedClaims,
    edges: input.edges,
  });
  const nodeById = new Map(input.linkedClaims.map((row) => [row.id, row] as const));
  const dedupe = new Set<string>();
  const clusters: IntelligenceHotspotCluster[] = [];
  for (const neighborhood of neighborhoods) {
    const memberLinkedClaimIds = mergeUniqueStrings([
      neighborhood.centerLinkedClaimId,
      ...neighborhood.directNeighborIds,
      ...neighborhood.twoHopNeighborIds,
    ]).slice(0, 24);
    const clusterKey = [...memberLinkedClaimIds].sort().join(':');
    if (!clusterKey || dedupe.has(clusterKey)) continue;
    dedupe.add(clusterKey);
    const clusterEdges = input.edges.filter(
      (row) =>
        memberLinkedClaimIds.includes(row.leftLinkedClaimId) &&
        memberLinkedClaimIds.includes(row.rightLinkedClaimId),
    );
    const contradictionEdgeCount = clusterEdges.filter((row) => row.relation === 'contradicts').length;
    const supportEdgeCount = clusterEdges.filter((row) => row.relation === 'supports').length;
    const contradictionStrength = clusterEdges
      .filter((row) => row.relation === 'contradicts')
      .reduce((total, row) => total + row.edgeStrength, 0);
    const center = nodeById.get(neighborhood.centerLinkedClaimId);
    clusters.push({
      id: `${neighborhood.centerLinkedClaimId}:${memberLinkedClaimIds.length}`,
      centerLinkedClaimId: neighborhood.centerLinkedClaimId,
      label: center
        ? `${center.canonicalSubject} · ${center.predicateFamily}`
        : neighborhood.centerLinkedClaimId.slice(0, 8),
      memberLinkedClaimIds,
      supportEdgeCount,
      contradictionEdgeCount,
      hotspotScore: clampScore(
        contradictionStrength / Math.max(1, memberLinkedClaimIds.length) +
          contradictionEdgeCount * 0.08,
      ),
    });
  }
  return clusters.sort((left, right) => right.hotspotScore - left.hotspotScore).slice(0, 6);
}

export function buildIntelligenceGraphNeighborhoods(input: {
  linkedClaims: LinkedClaimRecord[];
  edges: LinkedClaimEdgeRecord[];
}) {
  const adjacency = new Map<string, Set<string>>();
  const contradictionHotspots = new Set<string>();
  for (const claim of input.linkedClaims) {
    adjacency.set(claim.id, adjacency.get(claim.id) ?? new Set<string>());
    if (claim.contradictionCount > 0) contradictionHotspots.add(claim.id);
  }
  for (const edge of input.edges) {
    adjacency.set(edge.leftLinkedClaimId, adjacency.get(edge.leftLinkedClaimId) ?? new Set<string>());
    adjacency.set(edge.rightLinkedClaimId, adjacency.get(edge.rightLinkedClaimId) ?? new Set<string>());
    adjacency.get(edge.leftLinkedClaimId)?.add(edge.rightLinkedClaimId);
    adjacency.get(edge.rightLinkedClaimId)?.add(edge.leftLinkedClaimId);
    if (edge.relation === 'contradicts') {
      contradictionHotspots.add(edge.leftLinkedClaimId);
      contradictionHotspots.add(edge.rightLinkedClaimId);
    }
  }

  const centers = contradictionHotspots.size > 0
    ? [...contradictionHotspots]
    : input.linkedClaims.length > 0
      ? [input.linkedClaims[0]!.id]
      : [];

  return centers.slice(0, 4).map((centerLinkedClaimId) => {
    const directNeighborIds = [...(adjacency.get(centerLinkedClaimId) ?? new Set<string>())];
    const twoHopNeighborIds = new Set<string>();
    for (const neighborId of directNeighborIds) {
      for (const secondHopId of adjacency.get(neighborId) ?? new Set<string>()) {
        if (secondHopId === centerLinkedClaimId) continue;
        if (directNeighborIds.includes(secondHopId)) continue;
        twoHopNeighborIds.add(secondHopId);
      }
    }
    return {
      centerLinkedClaimId,
      directNeighborIds,
      twoHopNeighborIds: [...twoHopNeighborIds].slice(0, 24),
    };
  });
}

function summarizeLinkedClaimHealth(linkedClaims: LinkedClaimRecord[]): {
  linkedClaimCount: number;
  contradictionCount: number;
  contradictionRatio: number;
  nonSocialCorroborationCount: number;
  linkedClaimHealthScore: number;
  timeCoherence: number;
  recentSupportScore: number;
  recentContradictionScore: number;
} {
  if (linkedClaims.length === 0) {
    return {
      linkedClaimCount: 0,
      contradictionCount: 0,
      contradictionRatio: 0,
      nonSocialCorroborationCount: 0,
      linkedClaimHealthScore: 0,
      timeCoherence: 0,
      recentSupportScore: 0,
      recentContradictionScore: 0,
    };
  }
  const nowMs = Date.now();
  const contradictionCount = linkedClaims.reduce((total, row) => total + row.contradictionCount, 0);
  const sourceCount = linkedClaims.reduce((total, row) => total + Math.max(1, row.sourceCount), 0);
  const nonSocialCorroborationCount = linkedClaims.reduce((total, row) => total + row.nonSocialSourceCount, 0);
  const contradictionRatio = sourceCount > 0 ? contradictionCount / sourceCount : 0;
  const timeAnchors = linkedClaims
    .flatMap((row) => [row.timeBucketStart, row.timeBucketEnd])
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const timeCoherence =
    timeAnchors.length < 2 ? 0.85 : clampScore(1 - Math.min(1, (timeAnchors[timeAnchors.length - 1]! - timeAnchors[0]!) / SHORTLIST_LINKED_CLAIM_WINDOW_MS));
  const claimHealthScores = linkedClaims.map((row) => {
    const supportRecency = recencyWeight(row.lastSupportedAt ?? row.timeBucketEnd ?? row.timeBucketStart, nowMs);
    const contradictionRecency = row.lastContradictedAt ? recencyWeight(row.lastContradictedAt, nowMs) : 0;
    const contradictionPenalty =
      row.sourceCount > 0 ? (row.contradictionCount / row.sourceCount) * (0.55 + 0.45 * contradictionRecency) : 0;
    return clampScore(
      0.4 * (1 - Math.min(1, contradictionPenalty)) +
      0.28 * Math.min(1, row.nonSocialSourceCount / 2) +
      0.14 * (row.predicateFamily === 'general' ? 0.45 : 0.9) +
      0.1 * supportRecency +
      0.08 * (1 - contradictionRecency),
    );
  });
  const linkedClaimHealthScore =
    claimHealthScores.reduce((total, value) => total + value, 0) / Math.max(1, claimHealthScores.length);
  const recentSupportScore =
    linkedClaims.reduce((total, row) => total + recencyWeight(row.lastSupportedAt ?? row.timeBucketEnd ?? row.timeBucketStart, nowMs), 0) /
    Math.max(1, linkedClaims.length);
  const recentContradictionScore =
    linkedClaims.reduce((total, row) => total + (row.lastContradictedAt ? recencyWeight(row.lastContradictedAt, nowMs) : 0), 0) /
    Math.max(1, linkedClaims.length);
  return {
    linkedClaimCount: linkedClaims.length,
    contradictionCount,
    contradictionRatio: clampScore(contradictionRatio),
    nonSocialCorroborationCount,
    linkedClaimHealthScore: clampScore(linkedClaimHealthScore),
    timeCoherence,
    recentSupportScore: clampScore(recentSupportScore),
    recentContradictionScore: clampScore(recentContradictionScore),
  };
}

function summarizeDeliberationStatus(event: IntelligenceEventClusterRecord): IntelligenceEventClusterRecord['deliberationStatus'] {
  if (event.deliberations.some((row) => row.status === 'completed')) return 'completed';
  if (event.deliberations.some((row) => row.status === 'failed')) return 'failed';
  return 'idle';
}

function nowIso(): string {
  return new Date().toISOString();
}

function publishedMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldPollSource(source: IntelligenceSourceRecord, nowMs: number): boolean {
  if (!source.enabled) return false;
  if (!source.lastFetchedAt) return true;
  const lastFetchedMs = Date.parse(source.lastFetchedAt);
  if (!Number.isFinite(lastFetchedMs)) return true;
  const cooldownMinutes = Math.max(source.pollMinutes, source.crawlPolicy.revisitCooldownMinutes);
  return nowMs - lastFetchedMs >= Math.max(1, cooldownMinutes) * 60_000;
}

function isFreshDocument(document: { publishedAt: string | null }, cursor: IntelligenceSourceCursorRecord | null): boolean {
  if (!cursor?.lastSeenPublishedAt || !document.publishedAt) return true;
  const documentMs = publishedMs(document.publishedAt);
  const cursorMs = publishedMs(cursor.lastSeenPublishedAt);
  if (documentMs === null || cursorMs === null) return true;
  return documentMs > cursorMs;
}

function buildSourceHealthUpdate(input: {
  source: IntelligenceSourceRecord;
  status: IntelligenceSourceRecord['health']['lastStatus'];
  latencyMs: number | null;
  statusCode: number | null;
  reason?: string | null;
  blockedByRobots?: boolean;
}): IntelligenceSourceRecord['health'] {
  const previous = input.source.health;
  const isError = input.status === 'error' || input.status === 'blocked';
  return {
    lastStatus: input.status,
    lastSuccessAt: isError ? previous.lastSuccessAt : nowIso(),
    lastFailureAt: isError ? nowIso() : previous.lastFailureAt,
    consecutiveFailures: isError ? previous.consecutiveFailures + 1 : 0,
    recentLatencyMs: input.latencyMs,
    status403Count: previous.status403Count + (input.statusCode === 403 ? 1 : 0),
    status429Count: previous.status429Count + (input.statusCode === 429 ? 1 : 0),
    robotsBlocked: input.blockedByRobots ?? false,
    lastFailureReason: isError ? input.reason ?? null : null,
    updatedAt: nowIso(),
  };
}

function shouldAutoDeliberate(event: IntelligenceEventClusterRecord): boolean {
  if (event.deliberations.some((row) => row.status === 'completed')) return false;
  const top1 = event.domainPosteriors[0]?.score ?? 0;
  const top2 = event.domainPosteriors[1]?.score ?? 0;
  const primary = event.primaryHypotheses[0]?.confidence ?? 0;
  const counter = event.counterHypotheses[0]?.confidence ?? 0;
  const hasWriteCandidate = event.executionCandidates.some((candidate) => {
    const capability =
      candidate.payload.connector_capability && typeof candidate.payload.connector_capability === 'object'
        ? candidate.payload.connector_capability as Record<string, unknown>
        : null;
    return capability?.write_allowed === true;
  });
  const ambiguousDomain =
    event.structuralityScore >= 0.65 &&
    Math.abs(top1 - top2) < AUTO_DELIBERATION_DOMAIN_DELTA;
  const ambiguousHypothesis = Math.abs(primary - counter) < AUTO_DELIBERATION_HYPOTHESIS_DELTA;
  const riskyExecution =
    hasWriteCandidate &&
    (event.riskBand === 'medium' || event.riskBand === 'high' || event.riskBand === 'critical');
  return ambiguousDomain || ambiguousHypothesis || riskyExecution;
}

function buildRuntimeCredentialsFromEnv(env: AppEnv): ProviderCredentialsByProvider {
  const credentials: Partial<ProviderCredentialsByProvider> = {};
  const assign = (provider: ProviderCredentialProvider, apiKey: string | undefined) => {
    if (!apiKey || apiKey.trim().length === 0) return;
    credentials[provider] = {
      provider,
      source: 'env',
      selectedCredentialMode: 'api_key',
      credentialPriority: 'api_key_first',
      apiKey,
      authAccessTokenExpiresAt: null,
    };
  };
  assign('openai', env.OPENAI_API_KEY);
  assign('gemini', env.GEMINI_API_KEY);
  assign('anthropic', env.ANTHROPIC_API_KEY);
  return credentials as ProviderCredentialsByProvider;
}

function buildSourceMix(existing: Record<string, unknown> | null | undefined, source: IntelligenceSourceRecord) {
  const tiers = Array.isArray(existing?.source_tiers)
    ? existing.source_tiers.filter((item): item is string => typeof item === 'string')
    : [];
  const types = Array.isArray(existing?.source_types)
    ? existing.source_types.filter((item): item is string => typeof item === 'string')
    : [];
  const sourceIds = Array.isArray(existing?.source_ids)
    ? existing.source_ids.filter((item): item is string => typeof item === 'string')
    : [];

  const nextTierSet = new Set([...tiers, source.sourceTier]);
  const nextTypeSet = new Set([...types, source.sourceType]);
  const nextSourceSet = new Set([...sourceIds, source.id]);
  const nonSocialCount =
    Number(existing?.non_social_source_count ?? 0) +
    (SOCIAL_SOURCE_TYPES.has(source.sourceType as 'social' | 'forum') ? 0 : nextSourceSet.has(source.id) && sourceIds.includes(source.id) ? 0 : 1);

  return {
    source_ids: [...nextSourceSet],
    source_tiers: [...nextTierSet],
    source_types: [...nextTypeSet],
    source_count: nextSourceSet.size,
    unique_source_count: nextSourceSet.size,
    non_social_source_count: Math.max(0, nonSocialCount),
    social_only: [...nextTierSet].every((tier) => SOCIAL_SOURCE_TIERS.has(tier as 'tier_3')),
    diversity_score: clampScore((nextTierSet.size + nextTypeSet.size) / 8),
  };
}

function scoreEvent(input: {
  sourceMix: Record<string, unknown>;
  topDomainScore: number;
  noveltyScore: number;
  hypothesisConfidence: number;
  expectedSignalCount: number;
  nonSocialCorroborationCount: number;
  contradictionRatio: number;
  linkedClaimHealthScore: number;
  timeCoherence: number;
  graphSupportScore: number;
  graphContradictionScore: number;
  graphHotspotCount: number;
}): { corroborationScore: number; structuralityScore: number; actionabilityScore: number; riskBand: RadarRiskBand } {
  const uniqueSourceCount = Number(input.sourceMix.unique_source_count ?? 1);
  const nonSocialSourceCount = Math.max(
    Number(input.sourceMix.non_social_source_count ?? 0),
    input.nonSocialCorroborationCount,
  );
  const diversityScore = Number(input.sourceMix.diversity_score ?? 0);
  const socialOnly = input.sourceMix.social_only === true;

  const corroborationScore = clampScore(
    0.2 * Math.min(1, uniqueSourceCount / 3) +
      0.25 * Math.min(1, nonSocialSourceCount / 2) +
      0.25 * diversityScore +
      0.15 * input.topDomainScore +
      0.1 * input.linkedClaimHealthScore +
      0.05 * input.graphSupportScore
  );

  let structuralityScore = clampScore(
    0.28 * corroborationScore +
      0.2 * input.topDomainScore +
      0.2 * input.hypothesisConfidence +
      0.12 * input.noveltyScore +
      0.12 * input.timeCoherence +
      0.04 * input.graphSupportScore +
      0.04 * (1 - input.graphContradictionScore)
  );
  let actionabilityScore = clampScore(
    0.28 * input.topDomainScore +
      0.2 * corroborationScore +
      0.2 * Math.min(1, input.expectedSignalCount / 3) +
      0.18 * input.hypothesisConfidence +
      0.1 * input.linkedClaimHealthScore +
      0.04 * input.graphSupportScore
  );
  if (socialOnly) {
    structuralityScore = clampScore(structuralityScore - 0.12);
    actionabilityScore = clampScore(actionabilityScore - 0.22);
  }
  if (input.contradictionRatio > 0.35) {
    structuralityScore = clampScore(structuralityScore - 0.08);
    actionabilityScore = clampScore(actionabilityScore - 0.12);
  }
  if (input.graphContradictionScore > 0.28) {
    structuralityScore = clampScore(
      structuralityScore - Math.min(0.16, input.graphContradictionScore * 0.2),
    );
    actionabilityScore = clampScore(
      actionabilityScore - Math.min(0.2, input.graphContradictionScore * 0.26),
    );
  }
  if (input.graphHotspotCount > 0) {
    structuralityScore = clampScore(structuralityScore - Math.min(0.12, input.graphHotspotCount * 0.04));
    actionabilityScore = clampScore(actionabilityScore - Math.min(0.18, input.graphHotspotCount * 0.06));
  }

  const riskBand: RadarRiskBand =
    actionabilityScore >= 0.82 || structuralityScore >= 0.84
      ? 'critical'
      : actionabilityScore >= 0.72 || structuralityScore >= 0.72
        ? 'high'
        : actionabilityScore >= 0.55 || structuralityScore >= 0.55
          ? 'medium'
          : 'low';

  return {
    corroborationScore,
    structuralityScore,
    actionabilityScore,
    riskBand,
  };
}

function buildExecutionCandidate(input: {
  event: IntelligenceEventClusterRecord;
  cluster?: Pick<
    IntelligenceNarrativeClusterRecord,
    'state' | 'driftScore' | 'contradictionScore' | 'recentExecutionBlockedCount'
  > | null;
}): ExecutionCandidateRecord[] {
  const topDomainScore = input.event.domainPosteriors[0]?.score ?? 0;
  const nonSocialSourceCount = Math.max(
    Number(input.event.sourceMix.non_social_source_count ?? 0),
    input.event.nonSocialCorroborationCount,
  );
  const socialOnly = input.event.sourceMix.social_only === true;
  const totalSourceCount = Math.max(
    input.event.linkedClaimCount,
    input.event.linkedClaimCount + input.event.contradictionCount,
  );
  const contradictionRatio = totalSourceCount > 0 ? input.event.contradictionCount / totalSourceCount : 0;
  const evidenceWeak =
    socialOnly ||
    nonSocialSourceCount < 1 ||
    topDomainScore < 0.55 ||
    input.event.linkedClaimCount < 1 ||
    input.event.expectedSignals.length < 2 ||
    input.event.primaryHypotheses.length === 0 ||
    input.event.counterHypotheses.length === 0 ||
    contradictionRatio > 0.4 ||
    input.event.linkedClaimHealthScore < 0.45 ||
    input.event.timeCoherenceScore < 0.4 ||
    input.event.graphContradictionScore > 0.42 ||
    input.event.graphHotspotCount > 0;
  const clusterBlockedReason =
    input.cluster?.state === 'diverging'
      ? 'cluster_diverging'
      : (input.cluster?.driftScore ?? 0) >= 0.58
        ? 'cluster_drift_too_high'
        : (input.cluster?.contradictionScore ?? 0) >= 0.32
          ? 'cluster_contradiction_too_high'
          : (input.cluster?.recentExecutionBlockedCount ?? 0) >= 2
            ? 'cluster_recent_blocked_executions'
            : null;
  if (evidenceWeak || clusterBlockedReason) {
    return [
      {
        id: randomUUID(),
        title: `Execution blocked for evidence review: ${input.event.title}`,
        summary: `The event is noteworthy, but linked-claim corroboration is not yet strong enough for action.`,
        riskBand: input.event.riskBand,
        executionMode: 'proposal',
        payload: {
          execution_target: 'mcp_tool',
          mcp_tool_name: 'task_create',
          connector_capability: {
            connector_id: 'builtin.task_create',
            write_allowed: true,
            destructive: false,
            requires_human: false,
            schema_id: 'jarvis.task_create.v1',
            allowed_actions: ['task_create'],
          },
          arguments: {
            title: `Review blocked intelligence execution for ${input.event.title}`.slice(0, 180),
            mode: 'chat',
            prompt: `Review why the execution path for "${input.event.title}" is blocked and determine whether corroboration is sufficient.`,
          },
        },
        policyJson: {
          auto_execute_allowed: false,
          reasons: clusterBlockedReason
            ? ['cluster-level execution guard triggered']
            : ['linked-claim corroboration threshold not met'],
        },
        status: 'blocked',
        resultJson: {
          blocked_reason:
            clusterBlockedReason ??
            (socialOnly
              ? 'social_only'
              : nonSocialSourceCount < 1
                ? 'non_social_corroboration_required'
                : contradictionRatio > 0.4
                  ? 'contradiction_ratio_too_high'
                  : input.event.linkedClaimHealthScore < 0.45
                    ? 'linked_claim_health_too_low'
                    : input.event.timeCoherenceScore < 0.4
                      ? 'time_coherence_too_low'
                      : input.event.graphHotspotCount > 0
                        ? 'graph_hotspot_present'
                        : input.event.graphContradictionScore > 0.42
                          ? 'graph_contradiction_too_high'
                          : 'insufficient_claim_evidence'),
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
        executedAt: null,
      },
    ];
  }
  if (input.event.actionabilityScore < 0.68) return [];

  const notificationMode = input.event.actionabilityScore >= 0.74 && input.event.riskBand === 'low'
    ? 'execute_auto'
    : 'proposal';
  const taskMode = input.event.actionabilityScore >= 0.84 && input.event.riskBand !== 'critical'
    ? 'execute_auto'
    : 'proposal';
  return [
    {
      id: randomUUID(),
      title: `Broadcast intelligence alert: ${input.event.title}`,
      summary: `Emit a low-risk notification for the event "${input.event.title}".`,
      riskBand: input.event.riskBand,
      executionMode: notificationMode,
      payload: {
        execution_target: 'mcp_tool',
        mcp_tool_name: 'notification_emit',
        connector_capability: {
          connector_id: 'builtin.notification_emit',
          write_allowed: true,
          destructive: false,
          requires_human: false,
          schema_id: 'jarvis.notification_emit.v1',
          allowed_actions: ['notification_emit'],
        },
        arguments: {
          title: `Intelligence alert: ${input.event.title}`.slice(0, 160),
          message: input.event.summary.slice(0, 260),
          severity: input.event.riskBand === 'high' ? 'warning' : 'info',
          entity_type: 'intelligence_event',
          entity_id: input.event.id,
          action_url: `/intelligence?event=${input.event.id}`,
        },
      },
      policyJson: {
        auto_execute_allowed: notificationMode === 'execute_auto',
        reasons: ['low-risk notification_emit via MCP'],
      },
      status: 'pending',
      resultJson: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      executedAt: null,
    },
    {
      id: randomUUID(),
      title: `Investigate intelligence event: ${input.event.title}`,
      summary: input.event.summary.slice(0, 400),
      riskBand: input.event.riskBand,
      executionMode: taskMode,
      payload: {
        execution_target: 'mcp_tool',
        mcp_tool_name: 'task_create',
        connector_capability: {
          connector_id: 'builtin.task_create',
          write_allowed: true,
          destructive: false,
          requires_human: false,
          schema_id: 'jarvis.task_create.v1',
          allowed_actions: ['task_create'],
        },
        arguments: {
          title: `Investigate ${input.event.title}`.slice(0, 180),
          mode: 'chat',
          prompt: [
            `Review intelligence event "${input.event.title}".`,
            `Top domain: ${input.event.topDomainId ?? 'unknown'}.`,
            `Primary hypothesis: ${input.event.primaryHypotheses[0]?.summary ?? 'n/a'}`,
            `Counter hypothesis: ${input.event.counterHypotheses[0]?.summary ?? 'n/a'}`,
            `Expected signals: ${input.event.expectedSignals.map((signal) => signal.description).join('; ')}`,
          ].join('\n'),
        },
      },
      policyJson: {
        auto_execute_allowed: taskMode === 'execute_auto',
        reasons: ['low-risk task_create via MCP'],
      },
      status: 'pending',
      resultJson: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      executedAt: null,
    },
  ];
}

function mergeUniqueById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

function mergeUniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function mergeSemanticClaims(
  existing: IntelligenceEventClusterRecord['semanticClaims'],
  incoming: IntelligenceEventClusterRecord['semanticClaims']
): IntelligenceEventClusterRecord['semanticClaims'] {
  const map = new Map<string, IntelligenceEventClusterRecord['semanticClaims'][number]>();
  for (const row of [...existing, ...incoming]) {
    map.set(row.claimId, row);
  }
  return [...map.values()].slice(0, 20);
}

function mergeMetricShocks(
  existing: IntelligenceEventClusterRecord['metricShocks'],
  incoming: IntelligenceEventClusterRecord['metricShocks']
): IntelligenceEventClusterRecord['metricShocks'] {
  const map = new Map<string, IntelligenceEventClusterRecord['metricShocks'][number]>();
  for (const row of [...existing, ...incoming]) {
    const key = `${row.metricKey}:${row.observedAt ?? 'na'}:${row.direction}`;
    map.set(key, row);
  }
  return [...map.values()].slice(0, 12);
}

function preferredStorageEntity(input: {
  title: string;
  rawText: string;
  entities: string[];
}): string {
  const titleEntity = input.entities.find((entity) => normalizedPhraseMatch(input.title, entity));
  if (titleEntity) return titleEntity;
  const textEntity = input.entities.find((entity) => normalizedPhraseMatch(`${input.title}\n${input.rawText}`, entity));
  if (textEntity) return textEntity;
  return input.entities[0] ?? 'market';
}

function looksLikeTitleDerivedSubject(input: {
  subjectEntity: string | null | undefined;
  title: string;
  preferredEntity: string;
  eventFamily: IntelligenceEventClusterRecord['eventFamily'];
}): boolean {
  const subject = normalizeText(input.subjectEntity ?? '');
  const title = normalizeText(input.title);
  const preferred = normalizeText(input.preferredEntity);
  if (!subject || !title || !preferred) return false;
  if (input.eventFamily === 'platform_ai_shift') return false;
  if (subject === preferred) return false;
  if (subject === title) return true;
  if (subject.includes(title) || title.includes(subject)) return true;
  return similarity(subject, title) >= 0.78;
}

function subjectAlignsWithKnownEntities(subjectEntity: string | null | undefined, entities: string[]): boolean {
  const subject = (subjectEntity ?? '').trim();
  if (!subject) return false;
  return entities.some(
    (entity) =>
      normalizedPhraseMatch(subject, entity) ||
      normalizedPhraseMatch(entity, subject) ||
      normalizeText(subject) === normalizeText(entity),
  );
}

function storagePredicateFallback(input: {
  eventFamily: IntelligenceEventClusterRecord['eventFamily'];
  title: string;
  rawText: string;
}): string {
  const normalized = normalizeText(`${input.title}\n${input.rawText}`);
  if (/\b(launch|launches|launched|release|released|introduce|introduces|introduced|debut)\b/u.test(normalized)) return 'launches';
  if (/\b(build|builds|built|develop|develops|developed|create|creates|created)\b/u.test(normalized)) return 'builds';
  if (/\b(hire|hiring|recruit)\b/u.test(normalized)) return 'hiring_focuses_on';
  if (/\b(fail|fails|failed|weakness|weaknesses|struggle|struggles)\b/u.test(normalized)) return 'struggles_with';
  if (/\b(mislead|misleads|misled)\b/u.test(normalized)) return 'misleads';
  if (/\b(inspect|clean|cleaning)\b/u.test(normalized)) return 'cleans';
  if (input.eventFamily === 'platform_ai_shift') return 'introduces';
  if (input.eventFamily === 'policy_change') return 'changes_policy';
  if (input.eventFamily === 'earnings_guidance') return 'posts_results';
  if (input.eventFamily === 'supply_chain_shift') return 'reshapes_supply_chain';
  if (input.eventFamily === 'rate_repricing') return 'reprices_rates';
  if (input.eventFamily === 'commodity_move') return 'moves_commodity';
  if (input.eventFamily === 'geopolitical_flashpoint') return 'escalates';
  return 'affects';
}

function storagePredicateMatchesText(input: {
  predicate: string;
  text: string;
}): boolean {
  const normalized = normalizeText(input.text);
  switch (normalizeText(input.predicate)) {
    case 'launches':
      return /\b(launch|launches|launched|release|released|introduce|introduces|introduced|debut|debuts)\b/u.test(normalized);
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
    default:
      return true;
  }
}

function isRetryableIntelligenceProcessingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('intelligence_claim_links_event_id_fkey') ||
    message.includes('intelligence_temporal_narrative_ledger_related_event_id_fkey') ||
    message.includes('intelligence_linked_claim_edges_left_linked_claim_id_fkey') ||
    message.includes('intelligence_linked_claim_edges_right_linked_claim_id_fkey')
  );
}

async function hasActiveSignalProcessingLease(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  signalId: string;
  processingLeaseId: string | null;
}): Promise<boolean> {
  if (!input.processingLeaseId) return false;
  const current =
    (
      await input.store.listIntelligenceSignalsByIds({
        workspaceId: input.workspaceId,
        signalIds: [input.signalId],
      })
    )[0] ?? null;
  return current?.processingStatus === 'processing' && current.processingLeaseId === input.processingLeaseId;
}

function stabilizeSemanticClaimsForStorage(input: {
  claims: IntelligenceEventClusterRecord['semanticClaims'];
  title: string;
  rawText: string;
  entities: string[];
  eventFamily: IntelligenceEventClusterRecord['eventFamily'];
}): IntelligenceEventClusterRecord['semanticClaims'] {
  const fallbackPredicate = storagePredicateFallback({
    eventFamily: input.eventFamily,
    title: input.title,
    rawText: input.rawText,
  });
  const subjectEntity = preferredStorageEntity({
    title: input.title,
    rawText: input.rawText,
    entities: input.entities,
  });
  return input.claims.map((claim) => ({
    ...claim,
    subjectEntity:
      looksLikeTitleDerivedSubject({
        subjectEntity: claim.subjectEntity,
        title: input.title,
        preferredEntity: subjectEntity,
        eventFamily: input.eventFamily,
      })
        ? subjectEntity
        : input.eventFamily !== 'platform_ai_shift' &&
            !subjectAlignsWithKnownEntities(claim.subjectEntity, input.entities)
        ? subjectEntity
        : claim.subjectEntity &&
            normalizedPhraseMatch(`${input.title}\n${input.rawText}`, claim.subjectEntity) &&
            !(normalizeText(claim.subjectEntity).split(' ').filter(Boolean).length === 1 &&
              normalizeText(subjectEntity).split(' ').filter(Boolean).length >= 2 &&
              normalizeText(claim.subjectEntity) !== normalizeText(subjectEntity))
          ? claim.subjectEntity
          : subjectEntity,
    predicate:
      isGenericPredicate(claim.predicate) || !storagePredicateMatchesText({
        predicate: claim.predicate,
        text: claim.evidenceSpan ?? `${input.title}\n${input.rawText}`,
      })
        ? fallbackPredicate
        : claim.predicate,
    object: claim.object || input.title,
  }));
}

function mergeEvent(existing: IntelligenceEventClusterRecord | null, input: {
  source: IntelligenceSourceRecord;
  signal: SignalEnvelopeRecord;
  document: RawDocumentRecord;
  semantics: Awaited<ReturnType<typeof extractEventSemantics>>;
}): IntelligenceEventClusterRecord {
  const baseSourceMix = buildSourceMix(existing?.sourceMix, input.source);
  const signalIds = mergeUniqueStrings([...(existing?.signalIds ?? []), input.signal.id]);
  const documentIds = mergeUniqueStrings([...(existing?.documentIds ?? []), input.document.id]);
  const entities = mergeUniqueStrings([...(existing?.entities ?? []), ...input.semantics.entities]);
  const stableTitle = input.document.title.trim().slice(0, 200) || input.semantics.title;
  const incomingSemanticClaims = stabilizeSemanticClaimsForStorage({
    claims: input.semantics.semanticClaims,
    title: stableTitle,
    rawText: input.document.rawText,
    entities,
    eventFamily: input.semantics.eventFamily,
  });
  const semanticClaims = mergeSemanticClaims(existing?.semanticClaims ?? [], incomingSemanticClaims);
  const metricShocks = mergeMetricShocks(existing?.metricShocks ?? [], input.semantics.metricShocks);
  const domainPosteriorMap = new Map<IntelligenceDomainId, { score: number; evidenceFeatures: string[]; counterFeatures: string[] }>();
  for (const row of [...(existing?.domainPosteriors ?? []), ...input.semantics.domainPosteriors]) {
    const current = domainPosteriorMap.get(row.domainId);
    if (!current || row.score > current.score) {
      domainPosteriorMap.set(row.domainId, {
        score: row.score,
        evidenceFeatures: [...row.evidenceFeatures],
        counterFeatures: [...row.counterFeatures],
      });
    }
  }
  const domainPosteriors = [...domainPosteriorMap.entries()]
    .map(([domainId, row]) => ({
      id: existing?.domainPosteriors.find((item) => item.domainId === domainId)?.id ?? randomUUID(),
      domainId,
      score: row.score,
      evidenceFeatures: row.evidenceFeatures,
      counterFeatures: row.counterFeatures,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const topDomainScore = domainPosteriors[0]?.score ?? 0.4;
  const noveltyScore = clampScore(Math.max(existing?.noveltyScore ?? 0, input.semantics.semanticClaims.length >= 2 ? 0.72 : 0.58));
  const hypothesisConfidence = Math.max(
    input.semantics.primaryHypotheses[0]?.confidence ?? 0.55,
    existing?.primaryHypotheses[0]?.confidence ?? 0.55,
  );
  const scored = scoreEvent({
    sourceMix: baseSourceMix,
    topDomainScore,
    noveltyScore,
    hypothesisConfidence,
    expectedSignalCount: Math.max(existing?.expectedSignals.length ?? 0, input.semantics.expectedSignals.length),
    nonSocialCorroborationCount: existing?.nonSocialCorroborationCount ?? Number(baseSourceMix.non_social_source_count ?? 0),
    contradictionRatio:
      existing && existing.linkedClaimCount > 0
        ? clampScore(existing.contradictionCount / Math.max(1, existing.linkedClaimCount + existing.contradictionCount))
        : 0,
    linkedClaimHealthScore: existing?.linkedClaimHealthScore ?? 0.55,
    timeCoherence: 0.8,
    graphSupportScore: existing?.graphSupportScore ?? 0,
    graphContradictionScore: existing?.graphContradictionScore ?? 0,
    graphHotspotCount: existing?.graphHotspotCount ?? 0,
  });
  const eventId = existing?.id ?? randomUUID();
  const createdAt = existing?.createdAt ?? nowIso();
  const executionCandidates = buildExecutionCandidate({
    event: {
      ...(existing ?? {
        id: eventId,
        workspaceId: input.signal.workspaceId,
        title: stableTitle,
        summary: input.semantics.summary,
        eventFamily: input.semantics.eventFamily,
        lifecycleState: 'canonical' as IntelligenceEventLifecycleState,
        validationReasons: [],
        signalIds: [],
        documentIds: [],
        entities: [],
        linkedClaimCount: 0,
        contradictionCount: 0,
        nonSocialCorroborationCount: 0,
        linkedClaimHealthScore: 0,
        timeCoherenceScore: 0.8,
        graphSupportScore: 0,
        graphContradictionScore: 0,
        graphHotspotCount: 0,
        semanticClaims: [],
        metricShocks: [],
        sourceMix: {},
        corroborationScore: 0,
        noveltyScore: 0,
        structuralityScore: 0,
        actionabilityScore: 0,
        riskBand: 'low' as RadarRiskBand,
        topDomainId: null,
        timeWindowStart: input.document.publishedAt ?? input.document.observedAt,
        timeWindowEnd: input.document.publishedAt ?? input.document.observedAt,
        domainPosteriors: [],
        worldStates: [],
        primaryHypotheses: [],
        counterHypotheses: [],
        invalidationConditions: [],
        expectedSignals: [],
        deliberationStatus: 'idle',
        reviewState: 'watch',
        reviewReason: null,
        reviewOwner: null,
        reviewUpdatedAt: null,
        reviewUpdatedBy: null,
        reviewResolvedAt: null,
        deliberations: [],
        executionCandidates: [],
        outcomes: [],
        operatorNoteCount: 0,
        createdAt,
        updatedAt: createdAt,
      }),
      title: stableTitle,
      summary: input.semantics.summary,
      eventFamily: input.semantics.eventFamily,
      signalIds,
      documentIds,
      entities,
      linkedClaimCount: existing?.linkedClaimCount ?? 0,
      contradictionCount: existing?.contradictionCount ?? 0,
      nonSocialCorroborationCount: existing?.nonSocialCorroborationCount ?? 0,
      linkedClaimHealthScore: existing?.linkedClaimHealthScore ?? 0.55,
      timeCoherenceScore: existing?.timeCoherenceScore ?? 0.8,
      graphSupportScore: existing?.graphSupportScore ?? 0,
      graphContradictionScore: existing?.graphContradictionScore ?? 0,
      graphHotspotCount: existing?.graphHotspotCount ?? 0,
      semanticClaims,
      metricShocks,
      sourceMix: baseSourceMix,
      corroborationScore: scored.corroborationScore,
      noveltyScore,
      structuralityScore: scored.structuralityScore,
      actionabilityScore: scored.actionabilityScore,
      riskBand: scored.riskBand,
      topDomainId: domainPosteriors[0]?.domainId ?? null,
      timeWindowStart: existing?.timeWindowStart ?? input.document.publishedAt ?? input.document.observedAt,
      timeWindowEnd: input.document.publishedAt ?? input.document.observedAt ?? existing?.timeWindowEnd ?? null,
      domainPosteriors,
      worldStates: mergeUniqueById([...(existing?.worldStates ?? []), ...input.semantics.worldStates]),
      primaryHypotheses: mergeUniqueById([...(existing?.primaryHypotheses ?? []), ...input.semantics.primaryHypotheses]).slice(0, 3),
      counterHypotheses: mergeUniqueById([...(existing?.counterHypotheses ?? []), ...input.semantics.counterHypotheses]).slice(0, 3),
      invalidationConditions: mergeUniqueById([...(existing?.invalidationConditions ?? []), ...input.semantics.invalidationConditions]).slice(0, 6),
      expectedSignals: mergeUniqueById([...(existing?.expectedSignals ?? []), ...input.semantics.expectedSignals]).slice(0, 6),
      deliberationStatus: existing ? summarizeDeliberationStatus(existing) : 'idle',
      reviewState: existing?.reviewState ?? 'watch',
      reviewReason: existing?.reviewReason ?? null,
      reviewOwner: existing?.reviewOwner ?? null,
      reviewUpdatedAt: existing?.reviewUpdatedAt ?? null,
      reviewUpdatedBy: existing?.reviewUpdatedBy ?? null,
      reviewResolvedAt: existing?.reviewResolvedAt ?? null,
      deliberations: existing?.deliberations ?? [],
      executionCandidates: existing?.executionCandidates ?? [],
      outcomes: existing?.outcomes ?? [],
      operatorNoteCount: existing?.operatorNoteCount ?? 0,
      updatedAt: nowIso(),
    },
  });

  return {
    id: eventId,
    workspaceId: input.signal.workspaceId,
    title: stableTitle,
    summary: input.semantics.summary,
    eventFamily: input.semantics.eventFamily,
    lifecycleState: existing?.lifecycleState ?? 'canonical',
    validationReasons: [...(existing?.validationReasons ?? [])],
    signalIds,
    documentIds,
    entities,
    linkedClaimCount: existing?.linkedClaimCount ?? 0,
    contradictionCount: existing?.contradictionCount ?? 0,
    nonSocialCorroborationCount: existing?.nonSocialCorroborationCount ?? 0,
    linkedClaimHealthScore: existing?.linkedClaimHealthScore ?? 0.55,
    timeCoherenceScore: existing?.timeCoherenceScore ?? 0.8,
    graphSupportScore: existing?.graphSupportScore ?? 0,
    graphContradictionScore: existing?.graphContradictionScore ?? 0,
    graphHotspotCount: existing?.graphHotspotCount ?? 0,
    semanticClaims,
    metricShocks,
    sourceMix: baseSourceMix,
    corroborationScore: scored.corroborationScore,
    noveltyScore,
    structuralityScore: scored.structuralityScore,
    actionabilityScore: scored.actionabilityScore,
    riskBand: scored.riskBand,
    topDomainId: domainPosteriors[0]?.domainId ?? null,
    timeWindowStart: existing?.timeWindowStart ?? input.document.publishedAt ?? input.document.observedAt,
    timeWindowEnd: input.document.publishedAt ?? input.document.observedAt ?? existing?.timeWindowEnd ?? null,
    domainPosteriors,
    worldStates: mergeUniqueById([...(existing?.worldStates ?? []), ...input.semantics.worldStates]).slice(0, 8),
    primaryHypotheses: mergeUniqueById([...(existing?.primaryHypotheses ?? []), ...input.semantics.primaryHypotheses]).slice(0, 3),
    counterHypotheses: mergeUniqueById([...(existing?.counterHypotheses ?? []), ...input.semantics.counterHypotheses]).slice(0, 3),
    invalidationConditions: mergeUniqueById([...(existing?.invalidationConditions ?? []), ...input.semantics.invalidationConditions]).slice(0, 6),
    expectedSignals: mergeUniqueById([...(existing?.expectedSignals ?? []), ...input.semantics.expectedSignals]).slice(0, 6),
    deliberationStatus: existing ? summarizeDeliberationStatus(existing) : 'idle',
    reviewState: existing?.reviewState ?? 'watch',
    reviewReason: existing?.reviewReason ?? null,
    reviewOwner: existing?.reviewOwner ?? null,
    reviewUpdatedAt: existing?.reviewUpdatedAt ?? null,
    reviewUpdatedBy: existing?.reviewUpdatedBy ?? null,
    reviewResolvedAt: existing?.reviewResolvedAt ?? null,
    deliberations: existing?.deliberations ?? [],
    executionCandidates,
    outcomes: existing?.outcomes ?? [],
    operatorNoteCount: existing?.operatorNoteCount ?? 0,
    createdAt,
    updatedAt: nowIso(),
  };
}

function findMatchingEvent(input: {
  events: IntelligenceEventClusterRecord[];
  semantics: Awaited<ReturnType<typeof extractEventSemantics>>;
  document: RawDocumentRecord;
  source: IntelligenceSourceRecord;
  eventCanonicalUrlsById?: Map<string, Set<string>>;
}): IntelligenceEventClusterRecord | null {
  const documentMs = publishedMs(input.document.publishedAt ?? input.document.observedAt);
  const semanticsTopDomainId = input.semantics.domainPosteriors[0]?.domainId ?? null;
  const incomingClaimText = buildComparisonClaimText(input.semantics.semanticClaims);
  const incomingHasNonGenericClaim = input.semantics.semanticClaims.some((claim) => !isGenericSemanticClaim(claim));
  let best: { event: IntelligenceEventClusterRecord; score: number } | null = null;
  for (const event of input.events) {
    const exactCanonicalUrlMatch =
      input.eventCanonicalUrlsById?.get(event.id)?.has(input.document.canonicalUrl) ?? false;
    if (!exactCanonicalUrlMatch) {
      if (event.eventFamily !== input.semantics.eventFamily) continue;
      if (!eventDomainMatches(event.topDomainId, semanticsTopDomainId)) continue;
      if (platformProductAnchorMismatch(event, input.semantics) || policyNarrativeAnchorMismatch(event, input.semantics)) continue;
    }
    const eventMs = publishedMs(event.timeWindowEnd ?? event.updatedAt);
    const trustedPolicyWindowMs =
      isTrustedPolicyPromotionSource(input.source) && isTrustedPolicyEvent(event) ? 7 * DAY_MS : DAY_MS;
    if (
      !exactCanonicalUrlMatch &&
      documentMs !== null &&
      eventMs !== null &&
      Math.abs(documentMs - eventMs) > trustedPolicyWindowMs
    ) {
      continue;
    }
    const overlap =
      event.eventFamily === 'platform_ai_shift' || event.eventFamily === 'policy_change'
        ? narrativeEntityOverlap(event.entities, input.semantics.entities, event.eventFamily)
        : entityOverlap(event.entities, input.semantics.entities);
    const titleScore = similarity(event.title, input.semantics.title);
    const eventClaimText = buildComparisonClaimText(event.semanticClaims);
    const claimScore =
      incomingClaimText && eventClaimText ? similarity(eventClaimText, incomingClaimText) : 0;
    const eventHasNonGenericClaim = event.semanticClaims.some((claim) => !isGenericSemanticClaim(claim));
    const titleEntityReady = titleScore >= 0.45 && overlap >= 1;
    const claimReady =
      claimScore >= 0.55 && incomingHasNonGenericClaim && eventHasNonGenericClaim;
    const trustedPolicyReady =
      isTrustedPolicyPromotionSource(input.source) &&
      isTrustedPolicyEvent(event) &&
      incomingHasNonGenericClaim &&
      eventHasNonGenericClaim &&
      overlap >= 1 &&
      (titleScore >= 0.18 || claimScore >= 0.22);
    if (!exactCanonicalUrlMatch && !titleEntityReady && !claimReady && !trustedPolicyReady) continue;
    const score =
      (exactCanonicalUrlMatch ? 10 + event.signalIds.length * 0.1 + titleScore : 0) +
      (titleEntityReady ? 0.65 + titleScore + overlap * 0.12 : 0) +
      (claimReady ? 0.6 + claimScore : 0) +
      (trustedPolicyReady ? 0.44 + titleScore * 0.5 + claimScore * 0.35 + overlap * 0.08 : 0);
    if (!best || score > best.score) best = { event, score };
  }
  return best?.event ?? null;
}

async function findMatchingEventByLinkedClaims(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  events: IntelligenceEventClusterRecord[];
  semantics: Awaited<ReturnType<typeof extractEventSemantics>>;
  document: RawDocumentRecord;
  source: IntelligenceSourceRecord;
}): Promise<IntelligenceEventClusterRecord | null> {
  const existingLinkedClaims = await input.store.listIntelligenceLinkedClaims({
    workspaceId: input.workspaceId,
    limit: 400,
  });
  const matchedLinkedClaims = mergeUniqueById(
    input.semantics.semanticClaims
      .flatMap((claim) =>
        buildLinkedClaimShortlist({
          claim,
          existingLinkedClaims,
          signalObservedAt: input.document.publishedAt ?? input.document.observedAt ?? nowIso(),
        }).map((row) => row.claim),
      )
      .filter((row): row is LinkedClaimRecord => row !== null),
  );
  if (matchedLinkedClaims.length === 0) return null;

  const eventScoreMap = new Map<string, number>();
  const edgeCache = new Map<string, LinkedClaimEdgeRecord[]>();
  const claimLinkCache = new Map<string, ClaimLinkRecord[]>();
  const getEdgesForClaim = async (linkedClaimId: string) => {
    const cached = edgeCache.get(linkedClaimId);
    if (cached) return cached;
    const edges = await input.store.listIntelligenceLinkedClaimEdges({
      workspaceId: input.workspaceId,
      linkedClaimId,
      limit: 200,
    });
    edgeCache.set(linkedClaimId, edges);
    return edges;
  };
  const getClaimLinksForLinkedClaim = async (linkedClaimId: string) => {
    const cached = claimLinkCache.get(linkedClaimId);
    if (cached) return cached;
    const links = await input.store.listIntelligenceClaimLinks({
      workspaceId: input.workspaceId,
      linkedClaimId,
      limit: 200,
    });
    claimLinkCache.set(linkedClaimId, links);
    return links;
  };
  const documentMs = publishedMs(input.document.publishedAt ?? input.document.observedAt);
  const semanticsTopDomainId = input.semantics.domainPosteriors[0]?.domainId ?? null;

  for (const linkedClaim of matchedLinkedClaims) {
    const claimLinks = await getClaimLinksForLinkedClaim(linkedClaim.id);
    for (const link of claimLinks) {
      const event = input.events.find((row) => row.id === link.eventId);
      if (!event) continue;
      if (event.eventFamily !== input.semantics.eventFamily) continue;
      if (!eventDomainMatches(event.topDomainId, semanticsTopDomainId)) continue;
      const eventMs = publishedMs(event.timeWindowEnd ?? event.updatedAt);
      const trustedPolicyWindowMs =
        isTrustedPolicyPromotionSource(input.source) && isTrustedPolicyEvent(event) ? 7 * DAY_MS : DAY_MS;
      if (documentMs !== null && eventMs !== null && Math.abs(documentMs - eventMs) > trustedPolicyWindowMs) continue;
      const relationWeight =
        link.relation === 'supporting'
          ? 1
          : link.relation === 'contradicting'
            ? 0.65
            : 0.45;
      const sourceBoost = Math.min(0.45, linkedClaim.sourceCount * 0.08);
      const contradictionPenalty = Math.min(0.25, linkedClaim.contradictionCount * 0.04);
      const current = eventScoreMap.get(event.id) ?? 0;
      eventScoreMap.set(event.id, current + relationWeight + sourceBoost - contradictionPenalty);
    }

    const edges = await getEdgesForClaim(linkedClaim.id);
    for (const edge of edges) {
      const neighborLinkedClaimId =
        edge.leftLinkedClaimId === linkedClaim.id ? edge.rightLinkedClaimId : edge.leftLinkedClaimId;
      const neighborLinks = await getClaimLinksForLinkedClaim(neighborLinkedClaimId);
      const relationMultiplier =
        edge.relation === 'supports' ? 0.75 : edge.relation === 'related' ? 0.35 : -0.8;
      for (const neighborLink of neighborLinks) {
        const event = input.events.find((row) => row.id === neighborLink.eventId);
        if (!event) continue;
        if (event.eventFamily !== input.semantics.eventFamily) continue;
        if (!eventDomainMatches(event.topDomainId, semanticsTopDomainId)) continue;
        const eventMs = publishedMs(event.timeWindowEnd ?? event.updatedAt);
        const trustedPolicyWindowMs =
          isTrustedPolicyPromotionSource(input.source) && isTrustedPolicyEvent(event) ? 7 * DAY_MS : DAY_MS;
        if (documentMs !== null && eventMs !== null && Math.abs(documentMs - eventMs) > trustedPolicyWindowMs) continue;
        const current = eventScoreMap.get(event.id) ?? 0;
        eventScoreMap.set(
          event.id,
          current + relationMultiplier * clampScore(edge.edgeStrength * 0.9 + neighborLink.linkStrength * 0.1),
        );
      }

      if (edge.relation !== 'supports') continue;
      const neighborEdges = await getEdgesForClaim(neighborLinkedClaimId);
      for (const secondHopEdge of neighborEdges) {
        if (secondHopEdge.relation !== 'supports') continue;
        const secondHopLinkedClaimId =
          secondHopEdge.leftLinkedClaimId === neighborLinkedClaimId
            ? secondHopEdge.rightLinkedClaimId
            : secondHopEdge.leftLinkedClaimId;
        if (secondHopLinkedClaimId === linkedClaim.id) continue;
        const secondHopLinks = await getClaimLinksForLinkedClaim(secondHopLinkedClaimId);
        for (const secondHopLink of secondHopLinks) {
          const event = input.events.find((row) => row.id === secondHopLink.eventId);
          if (!event) continue;
          if (event.eventFamily !== input.semantics.eventFamily) continue;
          if (!eventDomainMatches(event.topDomainId, semanticsTopDomainId)) continue;
          const eventMs = publishedMs(event.timeWindowEnd ?? event.updatedAt);
          const trustedPolicyWindowMs =
            isTrustedPolicyPromotionSource(input.source) && isTrustedPolicyEvent(event) ? 7 * DAY_MS : DAY_MS;
          if (documentMs !== null && eventMs !== null && Math.abs(documentMs - eventMs) > trustedPolicyWindowMs) continue;
          const current = eventScoreMap.get(event.id) ?? 0;
          eventScoreMap.set(
            event.id,
            current + clampScore((edge.edgeStrength + secondHopEdge.edgeStrength + secondHopLink.linkStrength) / 3) * 0.24,
          );
        }
      }
    }
  }

  let best: { event: IntelligenceEventClusterRecord; score: number } | null = null;
  for (const [eventId, claimScore] of eventScoreMap.entries()) {
    const event = input.events.find((row) => row.id === eventId);
    if (!event) continue;
    if (platformProductAnchorMismatch(event, input.semantics) || policyNarrativeAnchorMismatch(event, input.semantics)) continue;
    const titleScore = similarity(event.title, input.semantics.title);
    const overlap =
      event.eventFamily === 'platform_ai_shift' || event.eventFamily === 'policy_change'
        ? narrativeEntityOverlap(event.entities, input.semantics.entities, event.eventFamily)
        : entityOverlap(event.entities, input.semantics.entities);
    const entityScore = Math.min(1, overlap / 2);
    const contradictionPenalty = event.linkedClaimCount > 0
      ? Math.min(0.35, event.contradictionCount / Math.max(1, event.linkedClaimCount + event.contradictionCount))
      : 0;
    const score =
      claimScore +
      titleScore +
      entityScore +
      event.graphSupportScore * 0.45 -
      contradictionPenalty -
      event.graphContradictionScore * 0.55 -
      Math.min(0.35, event.graphHotspotCount * 0.08);
    if (!best || score > best.score) best = { event, score };
  }

  return best?.score && best.score >= 1.35 ? best.event : null;
}

async function syncLinkedClaimEdgesForEvent(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  eventId: string;
  linkedClaims: LinkedClaimRecord[];
}): Promise<LinkedClaimEdgeRecord[]> {
  const createdKeys = new Set<string>();
  for (const claim of input.linkedClaims) {
    const shortlist = buildLinkedClaimEdgeShortlist({
      claim,
      existingLinkedClaims: input.linkedClaims,
    });
    for (const candidate of shortlist) {
      const canonicalPair = canonicalizeLinkedClaimEdgePair(claim.id, candidate.claim.id);
      const key = `${canonicalPair.leftLinkedClaimId}:${canonicalPair.rightLinkedClaimId}`;
      if (createdKeys.has(key)) continue;
      const heuristicRelation = inferLinkedClaimGraphRelation({
        claim,
        candidate: candidate.claim,
      });
      const pseudoSemanticClaim: SemanticClaim = {
        claimId: randomUUID(),
        subjectEntity: claim.canonicalSubject,
        predicate: claim.canonicalPredicate,
        object: claim.canonicalObject,
        evidenceSpan: null,
        timeScope: claim.timeScope,
        uncertainty: claim.contradictionCount > 0 ? 'medium' : 'low',
        stance: claim.contradictionCount > 0 ? 'contradicting' : 'supporting',
        claimType: 'signal',
      };
      const classification = heuristicRelation
        ? null
        : await classifyClaimLink({
            store: input.store as JarvisStore,
            env: input.env,
            providerRouter: input.providerRouter,
            workspaceId: input.workspaceId,
            claim: pseudoSemanticClaim,
            candidate: candidate.claim,
          });
      const relation = heuristicRelation
        ? heuristicRelation.relation
        : classification?.relation === 'contradicting'
          ? 'contradicts'
          : classification?.relation === 'same' || classification?.relation === 'supporting'
            ? 'supports'
            : null;
      if (!relation) continue;
      const evidenceSignalIds = mergeUniqueStrings([
        ...claim.supportingSignalIds,
        ...candidate.claim.supportingSignalIds,
      ]).slice(0, 16);
      await input.store.createIntelligenceLinkedClaimEdge({
        workspaceId: input.workspaceId,
        leftLinkedClaimId: canonicalPair.leftLinkedClaimId,
        rightLinkedClaimId: canonicalPair.rightLinkedClaimId,
        relation,
        edgeStrength: clampScore(
          Math.max(candidate.score / 1.2, heuristicRelation?.confidence ?? classification?.confidence ?? 0.58),
        ),
        evidenceSignalIds,
        lastObservedAt:
          claim.lastContradictedAt ??
          claim.lastSupportedAt ??
          candidate.claim.lastContradictedAt ??
          candidate.claim.lastSupportedAt ??
          nowIso(),
      });
      createdKeys.add(key);
    }
  }
  return input.store.listIntelligenceLinkedClaimEdges({
    workspaceId: input.workspaceId,
    eventId: input.eventId,
    limit: 200,
  });
}

function reconcileExpectedSignalAbsence(
  event: IntelligenceEventClusterRecord,
): { event: IntelligenceEventClusterRecord; changed: boolean } {
  const now = Date.now();
  let changed = false;
  let absentCount = 0;
  const nextOutcomeSummaries = new Set(event.outcomes.map((row) => row.summary));
  const nextExpectedSignals = event.expectedSignals.map((signal) => {
    if (signal.status !== 'pending' || !signal.dueAt) return signal;
    const dueMs = Date.parse(signal.dueAt);
    if (!Number.isFinite(dueMs) || dueMs > now) return signal;
    changed = true;
    absentCount += 1;
    return {
      ...signal,
      status: 'absent' as const,
    };
  });
  if (!changed) return { event, changed: false };

  const nextOutcomes = [...event.outcomes];
  for (const signal of nextExpectedSignals.filter((row) => row.status === 'absent')) {
    const summary = `Expected signal "${signal.description}" was absent past due date.`;
    if (nextOutcomeSummaries.has(summary)) continue;
    nextOutcomeSummaries.add(summary);
    nextOutcomes.push({
      id: randomUUID(),
      status: 'mixed',
      summary,
      createdAt: nowIso(),
    });
  }

  const primaryPenalty = 0.08 * absentCount;
  const counterBoost = 0.04 * absentCount;

  return {
    changed: true,
    event: {
      ...event,
      expectedSignals: nextExpectedSignals,
      primaryHypotheses: event.primaryHypotheses.map((row) => ({
        ...row,
        confidence: clampScore(row.confidence - primaryPenalty),
      })),
      counterHypotheses: event.counterHypotheses.map((row) => ({
        ...row,
        confidence: clampScore(row.confidence + counterBoost),
      })),
      outcomes: nextOutcomes.slice(-20),
      updatedAt: nowIso(),
    },
  };
}

function applyLinkedClaimWorldModelAdjustments(input: {
  event: IntelligenceEventClusterRecord;
  linkedClaims: LinkedClaimRecord[];
  edges: LinkedClaimEdgeRecord[];
}): IntelligenceEventClusterRecord {
  const summary = summarizeLinkedClaimHealth(input.linkedClaims);
  const graphSummary = summarizeLinkedClaimGraph({
    linkedClaims: input.linkedClaims,
    edges: input.edges,
  });
  const primaryBoost = Math.min(
    0.14,
    summary.nonSocialCorroborationCount * 0.03 +
      summary.recentSupportScore * 0.04 +
      summary.timeCoherence * 0.02 +
      graphSummary.graphSupportScore * 0.06,
  );
  const primaryPenalty = Math.min(
    0.22,
    summary.contradictionCount * 0.03 +
      summary.contradictionRatio * 0.14 +
      summary.recentContradictionScore * 0.05 +
      (1 - summary.timeCoherence) * 0.04 +
      graphSummary.graphContradictionScore * 0.08 +
      graphSummary.graphHotspotCount * 0.02,
  );
  const counterBoost = Math.min(
    0.18,
    summary.contradictionCount * 0.04 +
      summary.contradictionRatio * 0.1 +
      summary.recentContradictionScore * 0.06 +
      graphSummary.graphContradictionScore * 0.08,
  );
  const hypothesisConfidence = clampScore(
    Math.max(...input.event.primaryHypotheses.map((row) => row.confidence), 0.55) + primaryBoost - primaryPenalty,
  );
  const rescored = scoreEvent({
    sourceMix: input.event.sourceMix,
    topDomainScore: input.event.domainPosteriors[0]?.score ?? 0.4,
    noveltyScore: input.event.noveltyScore,
    hypothesisConfidence,
    expectedSignalCount: input.event.expectedSignals.length,
    nonSocialCorroborationCount: summary.nonSocialCorroborationCount,
    contradictionRatio: summary.contradictionRatio,
    linkedClaimHealthScore: summary.linkedClaimHealthScore,
    timeCoherence: summary.timeCoherence,
    graphSupportScore: graphSummary.graphSupportScore,
    graphContradictionScore: graphSummary.graphContradictionScore,
    graphHotspotCount: graphSummary.graphHotspotCount,
  });
  return {
    ...input.event,
    linkedClaimCount: summary.linkedClaimCount,
    contradictionCount: summary.contradictionCount,
    nonSocialCorroborationCount: summary.nonSocialCorroborationCount,
    linkedClaimHealthScore: summary.linkedClaimHealthScore,
    timeCoherenceScore: summary.timeCoherence,
    graphSupportScore: graphSummary.graphSupportScore,
    graphContradictionScore: graphSummary.graphContradictionScore,
    graphHotspotCount: graphSummary.graphHotspotCount,
    corroborationScore: rescored.corroborationScore,
    structuralityScore: rescored.structuralityScore,
    actionabilityScore: rescored.actionabilityScore,
    riskBand: rescored.riskBand,
    primaryHypotheses: input.event.primaryHypotheses.map((row) => ({
      ...row,
      confidence: clampScore(row.confidence + primaryBoost - primaryPenalty),
    })),
    counterHypotheses: input.event.counterHypotheses.map((row) => ({
      ...row,
      confidence: clampScore(row.confidence + counterBoost),
    })),
    updatedAt: nowIso(),
  };
}

export async function syncIntelligenceModelCatalog(input: {
  store: WorkspaceScopedStore;
  env: AppEnv;
  providerRouter?: ProviderRouter;
}): Promise<number> {
  const catalog = await fetchProviderModelCatalog(input.env);
  const entries = catalog.flatMap((provider) =>
    provider.models.map((modelId) => ({
      ...inferIntelligenceModelMetadata({
        provider: provider.provider,
        modelId,
      }),
      availability: 'active' as const,
      lastSeenAt: nowIso(),
    }))
  );
  if (entries.length === 0) return 0;
  await input.store.upsertIntelligenceModelRegistryEntries({ entries });
  if (input.providerRouter) {
    await input.store.replaceIntelligenceProviderHealth({
      entries: input.providerRouter.listProviderHealthStates().map((row) => ({
        provider: row.provider,
        available: row.cooldownUntil === null,
        cooldownUntil: row.cooldownUntil,
        reasonCode: row.reasonCode,
        failureCount: row.failureCount,
        updatedAt: row.updatedAt,
      })),
    });
  }
  return entries.length;
}

export async function runIntelligenceSourceScanPass(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  fetchTimeoutMs: number;
  sourceBatch: number;
  fetchImpl?: typeof fetch;
}): Promise<IntelligenceSourceScanSummary> {
  const [sources, cursors] = await Promise.all([
    input.store.listIntelligenceSources({ workspaceId: input.workspaceId, limit: 200 }),
    input.store.listIntelligenceSourceCursors({ workspaceId: input.workspaceId }),
  ]);
  const now = new Date();
  const nowMs = now.getTime();
  const cursorBySourceId = new Map(cursors.map((row) => [row.sourceId, row] as const));
  const dueSources = sources.filter((source) => shouldPollSource(source, nowMs)).slice(0, Math.max(1, input.sourceBatch));

  let fetchedCount = 0;
  let storedDocumentCount = 0;
  let signalCount = 0;
  let executionCount = 0;
  let failedCount = 0;
  const failedSources: string[] = [];

  for (const source of dueSources) {
    const cursor = cursorBySourceId.get(source.id) ?? null;
    const run = await input.store.createIntelligenceScanRun({
      workspaceId: input.workspaceId,
      sourceId: source.id,
      status: 'running',
      detailJson: { source_name: source.name },
      startedAt: nowIso(),
    });
    try {
      const fetched = await fetchIntelligenceSource({
        source,
        cursor,
        timeoutMs: input.fetchTimeoutMs,
        fetchImpl: input.fetchImpl,
      });
      const fetchFailed = fetched.fetchMeta.failed === true;
      const nextHealth = buildSourceHealthUpdate({
        source,
        status: fetchFailed ? (fetched.fetchMeta.blockedByRobots ? 'blocked' : 'error') : 'ok',
        latencyMs: fetched.fetchMeta.latencyMs ?? null,
        statusCode: fetched.fetchMeta.statusCode ?? null,
        reason: fetched.fetchMeta.failureReason ?? null,
        blockedByRobots: fetched.fetchMeta.blockedByRobots ?? false,
      });
      await input.store.updateIntelligenceSource({
        workspaceId: input.workspaceId,
        sourceId: source.id,
        health: nextHealth,
        lastFetchedAt: fetched.cursor.lastFetchedAt ?? nowIso(),
        lastSuccessAt: fetchFailed ? source.lastSuccessAt : nowIso(),
        lastError: fetchFailed ? fetched.fetchMeta.failureReason ?? 'source fetch failed' : null,
      });
      if (fetchFailed) {
        failedCount += 1;
        failedSources.push(source.id);
        await input.store.createIntelligenceFetchFailure({
          workspaceId: input.workspaceId,
          sourceId: source.id,
          url: source.url,
          reason: fetched.fetchMeta.failureReason ?? 'source fetch failed',
          statusCode: fetched.fetchMeta.statusCode ?? null,
          retryable: fetched.fetchMeta.blockedByRobots !== true,
          blockedByRobots: fetched.fetchMeta.blockedByRobots ?? false,
        });
        await input.store.completeIntelligenceScanRun({
          runId: run.id,
          workspaceId: input.workspaceId,
          status: fetched.fetchMeta.blockedByRobots ? 'ok' : 'error',
          fetchedCount: 0,
          storedDocumentCount: 0,
          signalCount: 0,
          clusteredEventCount: 0,
          executionCount: 0,
          failedCount: 1,
          error: fetched.fetchMeta.failureReason ?? 'source fetch failed',
          detailJson: {
            source_name: source.name,
            blocked_by_robots: fetched.fetchMeta.blockedByRobots ?? false,
            fetch_meta: fetched.fetchMeta,
          },
          finishedAt: nowIso(),
        });
        continue;
      }
      fetchedCount += fetched.documents.length;
      let storedForSource = 0;
      let signalsForSource = 0;
      for (const documentInput of fetched.documents.filter((row) => isFreshDocument(row, cursor))) {
        const existingIdentityDocument = await input.store.findIntelligenceRawDocumentByIdentityKey({
          workspaceId: input.workspaceId,
          documentIdentityKey: documentInput.documentIdentityKey,
        });
        if (existingIdentityDocument) {
          await input.store.updateIntelligenceRawDocumentObservation({
            workspaceId: input.workspaceId,
            documentId: existingIdentityDocument.id,
            observedAt: documentInput.observedAt,
            publishedAt: documentInput.publishedAt ?? existingIdentityDocument.publishedAt,
            metadataJson: {
              ...existingIdentityDocument.metadataJson,
              ...documentInput.metadataJson,
              last_seen_at: documentInput.observedAt,
              last_seen_published_at: documentInput.publishedAt,
              last_seen_source_url: documentInput.sourceUrl,
              last_seen_canonical_url: documentInput.canonicalUrl,
            },
          });
          continue;
        }
        const existingDocument = await input.store.findIntelligenceRawDocumentByFingerprint({
          workspaceId: input.workspaceId,
          documentFingerprint: documentInput.documentFingerprint,
        });
        if (existingDocument) {
          await input.store.updateIntelligenceRawDocumentObservation({
            workspaceId: input.workspaceId,
            documentId: existingDocument.id,
            observedAt: documentInput.observedAt,
            publishedAt: documentInput.publishedAt ?? existingDocument.publishedAt,
            metadataJson: {
              ...existingDocument.metadataJson,
              ...documentInput.metadataJson,
              last_seen_at: documentInput.observedAt,
              last_seen_published_at: documentInput.publishedAt,
              last_seen_source_url: documentInput.sourceUrl,
              last_seen_canonical_url: documentInput.canonicalUrl,
            },
          });
          continue;
        }
        const document = await input.store.createIntelligenceRawDocument({
          workspaceId: input.workspaceId,
          sourceId: source.id,
          sourceUrl: documentInput.sourceUrl,
          canonicalUrl: documentInput.canonicalUrl,
          documentIdentityKey: documentInput.documentIdentityKey,
          title: documentInput.title,
          summary: documentInput.summary,
          rawText: documentInput.rawText,
          rawHtml: documentInput.rawHtml,
          publishedAt: documentInput.publishedAt,
          observedAt: documentInput.observedAt,
          language: documentInput.language,
          sourceType: documentInput.sourceType,
          sourceTier: documentInput.sourceTier,
          documentFingerprint: documentInput.documentFingerprint,
          metadataJson: documentInput.metadataJson,
        });
        storedDocumentCount += 1;
        storedForSource += 1;

        await input.store.createIntelligenceSignal({
          workspaceId: input.workspaceId,
          sourceId: source.id,
          documentId: document.id,
          sourceType: document.sourceType,
          sourceTier: document.sourceTier,
          url: document.canonicalUrl,
          publishedAt: document.publishedAt,
          observedAt: document.observedAt,
          language: document.language,
          rawText: document.rawText,
          rawMetrics: document.metadataJson.raw_metrics && typeof document.metadataJson.raw_metrics === 'object'
            ? (document.metadataJson.raw_metrics as Record<string, unknown>)
            : documentInput.rawMetrics,
          entityHints: documentInput.entityHints,
          trustHint: documentInput.trustHint,
          processingStatus: 'pending',
        });
        signalCount += 1;
        signalsForSource += 1;
      }
      await input.store.upsertIntelligenceSourceCursor({
        workspaceId: input.workspaceId,
        sourceId: source.id,
        cursor: fetched.cursor.cursor ?? cursor?.cursor ?? null,
        etag: fetched.cursor.etag ?? cursor?.etag ?? null,
        lastModified: fetched.cursor.lastModified ?? cursor?.lastModified ?? null,
        lastSeenPublishedAt: fetched.cursor.lastSeenPublishedAt ?? cursor?.lastSeenPublishedAt ?? null,
        lastFetchedAt: fetched.cursor.lastFetchedAt ?? nowIso(),
      });
      await input.store.completeIntelligenceScanRun({
        runId: run.id,
        workspaceId: input.workspaceId,
        status: 'ok',
        fetchedCount: fetched.documents.length,
        storedDocumentCount: storedForSource,
        signalCount: signalsForSource,
        clusteredEventCount: 0,
        executionCount: 0,
        failedCount: 0,
        detailJson: {
          source_name: source.name,
          fetch_meta: fetched.fetchMeta,
        },
        finishedAt: nowIso(),
      });
    } catch (error) {
      failedCount += 1;
      failedSources.push(source.id);
      await input.store.createIntelligenceFetchFailure({
        workspaceId: input.workspaceId,
        sourceId: source.id,
        url: source.url,
        reason: error instanceof Error ? error.message : String(error),
        retryable: true,
        blockedByRobots: false,
      });
      await input.store.updateIntelligenceSource({
        workspaceId: input.workspaceId,
        sourceId: source.id,
        health: buildSourceHealthUpdate({
          source,
          status: 'error',
          latencyMs: null,
          statusCode: null,
          reason: error instanceof Error ? error.message : String(error),
        }),
        lastFetchedAt: nowIso(),
        lastError: error instanceof Error ? error.message : String(error),
      });
      await input.store.completeIntelligenceScanRun({
        runId: run.id,
        workspaceId: input.workspaceId,
        status: 'error',
        failedCount: 1,
        error: error instanceof Error ? error.message : String(error),
        detailJson: { source_name: source.name },
        finishedAt: nowIso(),
      });
    }
  }

  return {
    fetchedCount,
    storedDocumentCount,
    signalCount,
    clusteredEventCount: 0,
    executionCount: 0,
    failedCount,
    failedSources,
    sourceIds: dueSources.map((source) => source.id),
  };
}

async function runIntelligenceCouncilBridgeWithRuntime(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  userId: string;
  event: IntelligenceEventClusterRecord;
}): Promise<{ dispatch: IntelligenceBridgeDispatchRecord; deliberation: DeliberationResult | null }> {
  const fakeCtx = {
    store: input.store,
    env: input.env,
    providerRouter: input.providerRouter,
    loadRuntimeProviderApiKeys: async () =>
      Object.entries(buildRuntimeCredentialsFromEnv(input.env)).reduce<Partial<Record<ProviderCredentialProvider, string>>>((acc, [provider, credential]) => {
        if (credential.apiKey) acc[provider as ProviderCredentialProvider] = credential.apiKey;
        return acc;
      }, {}),
  } as unknown as RouteContext;
  return dispatchIntelligenceCouncilBridge({
    ctx: fakeCtx,
    workspaceId: input.workspaceId,
    event: input.event,
    userId: input.userId,
  });
}

async function syncLinkedClaimsForEvent(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  eventId: string;
  source: IntelligenceSourceRecord;
  document: RawDocumentRecord;
  signal: SignalEnvelopeRecord;
  semantics: Awaited<ReturnType<typeof extractEventSemantics>>;
}): Promise<{
  linkedClaims: LinkedClaimRecord[];
  contradictionCount: number;
}> {
  const existingLinkedClaims = await input.store.listIntelligenceLinkedClaims({
    workspaceId: input.workspaceId,
    limit: 400,
  });
  const existingMemberships = await input.store.listIntelligenceEventMemberships({
    workspaceId: input.workspaceId,
    eventId: input.eventId,
  });
  const membershipByLinkedClaimId = new Map(
    existingMemberships.map((row) => [row.linkedClaimId, row] as const),
  );
  const nextMemberships: Array<{
    workspaceId: string;
    eventId: string;
    linkedClaimId: string;
    role: 'core' | 'supporting' | 'contradicting';
  }> = [];
  const nextLinkedClaims: LinkedClaimRecord[] = [];
  const signalObservedAt = input.signal.publishedAt ?? input.signal.observedAt ?? input.document.publishedAt ?? input.document.observedAt ?? nowIso();
  const signalIsNonSocial = isNonSocialSignal({
    sourceType: input.source.sourceType,
    sourceTier: input.source.sourceTier,
  });

  for (const claim of input.semantics.semanticClaims) {
    const genericClaim = isGenericSemanticClaim(claim);
    const shortlist = buildLinkedClaimShortlist({
      claim,
      existingLinkedClaims,
      signalObservedAt,
    });
    let matched: LinkedClaimRecord | null = null;
    let linkStrength = claim.uncertainty === 'low' ? 0.82 : claim.uncertainty === 'high' ? 0.48 : 0.65;
    let resolvedRelation: 'same' | 'supporting' | 'contradicting' | 'unrelated' =
      claim.stance === 'contradicting' ? 'contradicting' : 'supporting';
    for (const candidate of shortlist) {
      const classification = await classifyClaimLink({
        store: input.store as JarvisStore,
        env: input.env,
        providerRouter: input.providerRouter,
        workspaceId: input.workspaceId,
        claim,
        candidate: candidate.claim,
      });
      if (classification.relation === 'unrelated') continue;
      linkStrength = clampScore(Math.max(candidate.score / 1.6, classification.confidence));
      resolvedRelation = classification.relation;
      if (classification.relation === 'same') {
        matched = candidate.claim;
      }
      break;
    }
    const supportingSignalIds = mergeUniqueStrings([...(matched?.supportingSignalIds ?? []), input.signal.id]);
    const timeBucket = buildClaimTimeBucket(claim.timeScope, signalObservedAt);
    const mergedTimeBucket = mergeTimeBucketBounds({
      currentStart: matched?.timeBucketStart ?? null,
      currentEnd: matched?.timeBucketEnd ?? null,
      nextStart: timeBucket.start,
      nextEnd: timeBucket.end,
    });
    const nextDistribution = {
      supporting: (matched?.stanceDistribution.supporting ?? 0) + (claim.stance === 'supporting' ? 1 : 0),
      neutral: (matched?.stanceDistribution.neutral ?? 0) + (claim.stance === 'neutral' ? 1 : 0),
      contradicting: (matched?.stanceDistribution.contradicting ?? 0) + (claim.stance === 'contradicting' ? 1 : 0),
    };
    const nonSocialSourceCount =
      (matched?.nonSocialSourceCount ?? 0) +
      (signalIsNonSocial && !(matched?.supportingSignalIds ?? []).includes(input.signal.id) ? 1 : 0);
    const linkedClaim = await input.store.createIntelligenceLinkedClaim({
      id: matched?.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      claimFingerprint:
        matched?.claimFingerprint ??
        (genericClaim
          ? buildEventScopedClaimFingerprint({
              claim,
              fallbackAt: signalObservedAt,
              eventId: input.eventId,
            })
          : buildClaimFingerprint(claim, signalObservedAt)),
      canonicalSubject: matched?.canonicalSubject ?? normalizeClaimPart(claim.subjectEntity),
      canonicalPredicate: matched?.canonicalPredicate ?? normalizeClaimPart(claim.predicate),
      canonicalObject: matched?.canonicalObject ?? normalizeClaimPart(claim.object),
      predicateFamily: matched?.predicateFamily ?? derivePredicateFamily(claim.predicate),
      timeScope: claim.timeScope ?? matched?.timeScope ?? null,
      timeBucketStart: mergedTimeBucket.start,
      timeBucketEnd: mergedTimeBucket.end,
      stanceDistribution: nextDistribution,
      sourceCount: supportingSignalIds.length,
      contradictionCount: nextDistribution.contradicting,
      nonSocialSourceCount,
      supportingSignalIds,
      lastSupportedAt:
        claim.stance === 'contradicting'
          ? matched?.lastSupportedAt ?? null
          : signalObservedAt,
      lastContradictedAt:
        claim.stance === 'contradicting'
          ? signalObservedAt
          : matched?.lastContradictedAt ?? null,
    });
    nextLinkedClaims.push(linkedClaim);
    const relation: ClaimLinkRecord['relation'] =
      claim.stance === 'contradicting' || resolvedRelation === 'contradicting'
        ? 'contradicting'
        : resolvedRelation === 'same' || resolvedRelation === 'supporting'
          ? 'supporting'
          : 'related';
    await input.store.createIntelligenceClaimLink({
      workspaceId: input.workspaceId,
      eventId: input.eventId,
      linkedClaimId: linkedClaim.id,
      signalId: input.signal.id,
      semanticClaimId: claim.claimId,
      relation,
      confidence: claim.uncertainty === 'low' ? 0.82 : claim.uncertainty === 'high' ? 0.48 : 0.65,
      linkStrength,
    });
    const nextRole =
      relation === 'contradicting'
        ? 'contradicting'
        : relation === 'supporting'
          ? 'core'
          : 'supporting';
    const previousMembership = membershipByLinkedClaimId.get(linkedClaim.id);
    nextMemberships.push({
      workspaceId: input.workspaceId,
      eventId: input.eventId,
      linkedClaimId: linkedClaim.id,
      role:
        previousMembership?.role === 'contradicting' || nextRole === 'contradicting'
          ? 'contradicting'
          : previousMembership?.role === 'core' || nextRole === 'core'
            ? 'core'
            : 'supporting',
    });
  }

  await input.store.replaceIntelligenceEventMemberships({
    workspaceId: input.workspaceId,
    eventId: input.eventId,
    memberships: [
      ...new Map(
        [...existingMemberships, ...nextMemberships].map((row) => [
          row.linkedClaimId,
          {
            workspaceId: row.workspaceId,
            eventId: row.eventId,
            linkedClaimId: row.linkedClaimId,
            role: row.role,
          },
        ]),
      ).values(),
    ],
  });

  const eventLinkedClaims = await input.store.listIntelligenceLinkedClaims({
    workspaceId: input.workspaceId,
    eventId: input.eventId,
    limit: 100,
  });

  return {
    linkedClaims: mergeUniqueById([...eventLinkedClaims, ...nextLinkedClaims]),
    contradictionCount: eventLinkedClaims.reduce((total, row) => total + row.contradictionCount, 0),
  };
}

async function syncHypothesisLedgerForEvent(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  event: IntelligenceEventClusterRecord;
  linkedClaims: LinkedClaimRecord[];
}): Promise<void> {
  const existingLedger = await input.store.listIntelligenceHypothesisLedgerEntries({
    workspaceId: input.workspaceId,
    eventId: input.event.id,
  });
  const ledgerKey = (kind: string, hypothesisId: string) => `${kind}:${hypothesisId}`;
  const existingLedgerKeys = new Set(existingLedger.map((row) => ledgerKey(row.kind, row.hypothesisId)));

  for (const row of input.event.primaryHypotheses) {
    if (!existingLedgerKeys.has(ledgerKey('primary', row.id))) {
      await input.store.createIntelligenceHypothesisLedgerEntry({
        workspaceId: input.workspaceId,
        eventId: input.event.id,
        hypothesisId: row.id,
        kind: 'primary',
        title: row.title,
        summary: row.summary,
        confidence: row.confidence,
        rationale: row.rationale,
        status: 'active',
      });
    }
  }
  for (const row of input.event.counterHypotheses) {
    if (!existingLedgerKeys.has(ledgerKey('counter', row.id))) {
      await input.store.createIntelligenceHypothesisLedgerEntry({
        workspaceId: input.workspaceId,
        eventId: input.event.id,
        hypothesisId: row.id,
        kind: 'counter',
        title: row.title,
        summary: row.summary,
        confidence: row.confidence,
        rationale: row.rationale,
        status: 'active',
      });
    }
  }

  const existingEvidence = await input.store.listIntelligenceHypothesisEvidenceLinks({
    workspaceId: input.workspaceId,
    eventId: input.event.id,
  });
  const existingEvidenceKeys = new Set(
    existingEvidence.map((row) => `${row.hypothesisId}:${row.linkedClaimId ?? 'none'}:${row.signalId ?? 'none'}:${row.relation}`),
  );
  const writeEvidence = async (
    hypothesisId: string,
    linkedClaim: LinkedClaimRecord,
    relation: 'supports' | 'contradicts' | 'monitors',
  ) => {
    const key = `${hypothesisId}:${linkedClaim.id}:none:${relation}`;
    if (existingEvidenceKeys.has(key)) return;
    const contradictionRatio = linkedClaim.sourceCount > 0 ? linkedClaim.contradictionCount / linkedClaim.sourceCount : 0;
    const evidenceStrength =
      relation === 'supports'
        ? clampScore(0.45 + Math.min(0.35, linkedClaim.nonSocialSourceCount * 0.12) - Math.min(0.2, contradictionRatio * 0.2))
        : relation === 'contradicts'
          ? clampScore(0.45 + Math.min(0.3, linkedClaim.contradictionCount * 0.12))
          : clampScore(0.4 + Math.min(0.2, linkedClaim.sourceCount * 0.05));
    await input.store.createIntelligenceHypothesisEvidenceLink({
      workspaceId: input.workspaceId,
      eventId: input.event.id,
      hypothesisId,
      linkedClaimId: linkedClaim.id,
      signalId: null,
      relation,
      evidenceStrength,
    });
    existingEvidenceKeys.add(key);
  };
  for (const row of input.event.primaryHypotheses) {
    for (const linkedClaim of input.linkedClaims) {
      await writeEvidence(row.id, linkedClaim, linkedClaim.contradictionCount > 0 ? 'contradicts' : 'supports');
    }
  }
  for (const row of input.event.counterHypotheses) {
    for (const linkedClaim of input.linkedClaims) {
      await writeEvidence(row.id, linkedClaim, linkedClaim.contradictionCount > 0 ? 'supports' : 'monitors');
    }
  }
}

async function syncWorldModelTracksForEvent(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  event: IntelligenceEventClusterRecord;
}): Promise<{
  invalidationEntries: IntelligenceInvalidationEntryRecord[];
  expectedSignalEntries: IntelligenceExpectedSignalEntryRecord[];
  outcomeEntries: IntelligenceOutcomeEntryRecord[];
}> {
  const [existingOutcomeEntries, invalidationEntries, expectedSignalEntries] = await Promise.all([
    input.store.listIntelligenceOutcomeEntries({
      workspaceId: input.workspaceId,
      eventId: input.event.id,
    }),
    input.store.replaceIntelligenceInvalidationEntries({
      workspaceId: input.workspaceId,
      eventId: input.event.id,
      entries: input.event.invalidationConditions.map((row) => ({
        id: row.id,
        workspaceId: input.workspaceId,
        eventId: input.event.id,
        title: row.title,
        description: row.description,
        matcherJson: row.matcherJson,
        status: row.status,
      })),
    }),
    input.store.replaceIntelligenceExpectedSignalEntries({
      workspaceId: input.workspaceId,
      eventId: input.event.id,
      entries: input.event.expectedSignals.map((row) => ({
        id: row.id,
        workspaceId: input.workspaceId,
        eventId: input.event.id,
        signalKey: row.signalKey,
        description: row.description,
        dueAt: row.dueAt,
        status: row.status,
      })),
    }),
  ]);

  const existingOutcomeIds = new Set(existingOutcomeEntries.map((row) => row.id));
  const createdOutcomeEntries: IntelligenceOutcomeEntryRecord[] = [];
  for (const row of input.event.outcomes) {
    if (existingOutcomeIds.has(row.id)) continue;
    createdOutcomeEntries.push(
      await input.store.createIntelligenceOutcomeEntry({
        id: row.id,
        workspaceId: input.workspaceId,
        eventId: input.event.id,
        status: row.status,
        summary: row.summary,
      }),
    );
  }

  return {
    invalidationEntries,
    expectedSignalEntries,
    outcomeEntries: [...createdOutcomeEntries, ...existingOutcomeEntries],
  };
}

export async function runIntelligenceSemanticPass(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  userId: string;
  signalBatch: number;
  signalIds?: string[];
  notificationService?: NotificationService;
}): Promise<IntelligenceSemanticSummary> {
  const [sources, signals, existingEvents] = await Promise.all([
    input.store.listIntelligenceSources({ workspaceId: input.workspaceId, limit: 200 }),
    input.signalIds && input.signalIds.length > 0
      ? input.store.listIntelligenceSignalsByIds({
          workspaceId: input.workspaceId,
          signalIds: input.signalIds,
        })
      : input.store.listIntelligenceSignals({
          workspaceId: input.workspaceId,
          limit: Math.max(1, input.signalBatch),
          processingStatus: 'pending',
        }),
    input.store.listIntelligenceEvents({ workspaceId: input.workspaceId, limit: SEMANTIC_MATCH_EVENT_LIMIT }),
  ]);
  const eventDocumentIds = mergeUniqueStrings(existingEvents.flatMap((event) => event.documentIds));
  const documents = await input.store.listIntelligenceRawDocumentsByIds({
    workspaceId: input.workspaceId,
    documentIds: mergeUniqueStrings([...signals.map((signal) => signal.documentId), ...eventDocumentIds]),
  });
  const sourceById = new Map(sources.map((row) => [row.id, row] as const));
  const documentById = new Map(documents.map((row) => [row.id, row] as const));
  const eventCanonicalUrlsById = new Map<string, Set<string>>();
  for (const event of existingEvents) {
    eventCanonicalUrlsById.set(
      event.id,
      new Set(
        event.documentIds
          .map((documentId) => documentById.get(documentId)?.canonicalUrl)
          .filter((canonicalUrl): canonicalUrl is string => Boolean(canonicalUrl)),
      ),
    );
  }
  const clusteredCanonicalEventIds = new Set<string>();
  let deliberationCount = 0;
  let executionCount = 0;
  let failedCount = 0;
  const failedSignalIds: string[] = [];
  const touchedEventIds = new Set<string>();

  for (const signal of signals) {
    const processingLeaseId = randomUUID();
    const claimedSignal = await input.store.updateIntelligenceSignalProcessing({
      workspaceId: input.workspaceId,
      signalId: signal.id,
      processingStatus: 'processing',
      expectedCurrentStatus: 'pending',
      processingLeaseId,
    });
    if (!claimedSignal) continue;
    try {
      const source = signal.sourceId ? sourceById.get(signal.sourceId) ?? null : null;
      const document = documentById.get(signal.documentId) ?? null;
      if (!source || !document) {
        throw new Error('signal dependencies missing');
      }
      const semantics = await extractEventSemantics({
        store: input.store as JarvisStore,
        env: input.env,
        providerRouter: input.providerRouter,
        workspaceId: input.workspaceId,
        title: document.title,
        rawText: document.rawText,
        entityHints: signal.entityHints,
        sourceEntityHints: source.entityHints,
      });
      const leaseStillActive = await hasActiveSignalProcessingLease({
        store: input.store,
        workspaceId: input.workspaceId,
        signalId: signal.id,
        processingLeaseId,
      });
      if (!leaseStillActive) continue;
      const canonicalEvents = existingEvents.filter((event) => event.lifecycleState === 'canonical');
      const exactCanonicalUrlMatch = findExactCanonicalUrlEvent({
        events: canonicalEvents,
        document,
        eventCanonicalUrlsById,
      });
      const exactAnyLifecycleMatch = findExactCanonicalUrlEvent({
        events: existingEvents,
        document,
        eventCanonicalUrlsById,
      });
      const restrictedSource = isRestrictedPromotionSource(source);
      const matchPool = restrictedSource ? canonicalEvents : existingEvents;
      const matchedByLinkedClaims = await findMatchingEventByLinkedClaims({
        store: input.store,
        workspaceId: input.workspaceId,
        events: matchPool,
        semantics,
        document,
        source,
      });
      const matched =
        exactCanonicalUrlMatch ??
        exactAnyLifecycleMatch ??
        matchedByLinkedClaims ??
        findMatchingEvent({
          events: matchPool,
          semantics,
          document,
          source,
          eventCanonicalUrlsById,
        });
      if (validationBlocksCanonicalWrite({
        validation: semantics.validation,
        hasExactCanonicalUrlMatch: Boolean(exactCanonicalUrlMatch),
      })) {
        await input.store.updateIntelligenceSignalProcessing({
          workspaceId: input.workspaceId,
          signalId: signal.id,
          processingStatus: 'processed',
          expectedCurrentStatus: 'processing',
          expectedCurrentLeaseId: processingLeaseId,
          processingLeaseId: null,
          promotionState: 'quarantined',
          promotionReasons: semantics.validation.reasons,
          linkedEventId: null,
          processingError: null,
          processedAt: nowIso(),
        });
        continue;
      }
      const merged = mergeEvent(matched, {
        source,
        signal,
        document,
        semantics,
      });
      const promotionPlan = determinePromotionPlan({
        existing: matched,
        merged,
        source,
        validation: semantics.validation,
        exactCanonicalUrlMatch,
      });
      const persisted = await input.store.upsertIntelligenceEvent({
        ...merged,
        lifecycleState: promotionPlan.lifecycleState,
        validationReasons: promotionPlan.promotionReasons,
        narrativeClusterId: promotionPlan.lifecycleState === 'canonical' ? merged.narrativeClusterId ?? null : null,
        narrativeClusterState: promotionPlan.lifecycleState === 'canonical' ? merged.narrativeClusterState ?? null : null,
        executionCandidates: promotionPlan.lifecycleState === 'canonical' ? merged.executionCandidates : [],
      });
      const existingIndex = existingEvents.findIndex((event) => event.id === persisted.id);
      if (existingIndex >= 0) {
        existingEvents.splice(existingIndex, 1, persisted);
      } else {
        existingEvents.unshift(persisted);
      }
      eventCanonicalUrlsById.set(
        persisted.id,
        new Set(
          persisted.documentIds
            .map((documentId) => documentById.get(documentId)?.canonicalUrl)
            .filter((canonicalUrl): canonicalUrl is string => Boolean(canonicalUrl)),
        ),
      );
      touchedEventIds.add(persisted.id);
      if (persisted.lifecycleState !== 'canonical') {
        await input.store.updateIntelligenceSignalProcessing({
          workspaceId: input.workspaceId,
          signalId: signal.id,
          processingStatus: 'processed',
          expectedCurrentStatus: 'processing',
          expectedCurrentLeaseId: processingLeaseId,
          processingLeaseId: null,
          promotionState: promotionPlan.promotionState,
          promotionReasons: promotionPlan.promotionReasons,
          linkedEventId: persisted.id,
          processingError: null,
          processedAt: nowIso(),
        });
        continue;
      }
      const linkedClaimSync = await syncLinkedClaimsForEvent({
        store: input.store,
        providerRouter: input.providerRouter,
        env: input.env,
        workspaceId: input.workspaceId,
        eventId: persisted.id,
        source,
        document,
        signal,
        semantics,
      });
      let eventLinkedClaims = linkedClaimSync.linkedClaims;
      if (matched?.lifecycleState !== 'canonical' && persisted.lifecycleState === 'canonical') {
        const currentClaimLinks = await input.store.listIntelligenceClaimLinks({
          workspaceId: input.workspaceId,
          eventId: persisted.id,
          limit: 400,
        });
        const linkedSignalIds = new Set(currentClaimLinks.map((row) => row.signalId));
        const backfillSignals = await input.store.listIntelligenceSignalsByIds({
          workspaceId: input.workspaceId,
          signalIds: persisted.signalIds.filter((signalId) => signalId !== signal.id && !linkedSignalIds.has(signalId)),
        });
        for (const backfillSignal of backfillSignals) {
          const backfillSource = backfillSignal.sourceId
            ? sourceById.get(backfillSignal.sourceId) ?? null
            : null;
          const backfillDocument = documentById.get(backfillSignal.documentId) ?? null;
          if (!backfillSource || !backfillDocument) continue;
          const backfillSemantics = await extractEventSemantics({
            store: input.store as JarvisStore,
            env: input.env,
            providerRouter: input.providerRouter,
            workspaceId: input.workspaceId,
            title: backfillDocument.title,
            rawText: backfillDocument.rawText,
            entityHints: backfillSignal.entityHints,
            sourceEntityHints: backfillSource.entityHints,
          });
          const backfillSync = await syncLinkedClaimsForEvent({
            store: input.store,
            providerRouter: input.providerRouter,
            env: input.env,
            workspaceId: input.workspaceId,
            eventId: persisted.id,
            source: backfillSource,
            document: backfillDocument,
            signal: backfillSignal,
            semantics: backfillSemantics,
          });
          eventLinkedClaims = backfillSync.linkedClaims;
        }
      }
      const linkedClaimEdges = await syncLinkedClaimEdgesForEvent({
        store: input.store,
        providerRouter: input.providerRouter,
        env: input.env,
        workspaceId: input.workspaceId,
        eventId: persisted.id,
        linkedClaims: eventLinkedClaims,
      });
      const memberships = await input.store.listIntelligenceEventMemberships({
        workspaceId: input.workspaceId,
        eventId: persisted.id,
      });
      const enrichedDraft = applyLinkedClaimWorldModelAdjustments({
        event: {
          ...persisted,
          linkedClaimCount: memberships.length,
          contradictionCount: Math.max(
            persisted.contradictionCount,
            eventLinkedClaims.reduce((total, row) => total + row.contradictionCount, 0),
          ),
          deliberationStatus: summarizeDeliberationStatus(persisted),
          updatedAt: nowIso(),
        },
        linkedClaims: eventLinkedClaims,
        edges: linkedClaimEdges,
      });
      const reconciled = reconcileExpectedSignalAbsence(enrichedDraft);
      const candidateBaseEvent = reconciled.changed ? reconciled.event : enrichedDraft;
      const enrichedEvent = await input.store.upsertIntelligenceEvent({
        ...candidateBaseEvent,
        executionCandidates: buildExecutionCandidate({
          event: candidateBaseEvent,
        }),
      });
      await syncHypothesisLedgerForEvent({
        store: input.store,
        workspaceId: input.workspaceId,
        event: enrichedEvent,
        linkedClaims: eventLinkedClaims,
      });
      await syncWorldModelTracksForEvent({
        store: input.store,
        workspaceId: input.workspaceId,
        event: enrichedEvent,
      });
      const currentCandidateEvents = await input.store.listIntelligenceEvents({
        workspaceId: input.workspaceId,
        limit: 200,
      });
      const temporal = await syncTemporalNarrativeLedgerForEvent({
        store: input.store,
        workspaceId: input.workspaceId,
        event: enrichedEvent,
        candidateEvents: currentCandidateEvents,
      });
      const narrativeClusterSync = await syncNarrativeClusterForEvent({
        store: input.store,
        workspaceId: input.workspaceId,
        event: enrichedEvent,
        temporal,
        candidateEvents: currentCandidateEvents,
      });
      let latestEvent = await input.store.upsertIntelligenceEvent({
        ...enrichedEvent,
        lifecycleState: 'canonical',
        validationReasons: [],
        narrativeClusterId: narrativeClusterSync.cluster.id,
        narrativeClusterState: narrativeClusterSync.cluster.state,
        executionCandidates: buildExecutionCandidate({
          event: {
            ...enrichedEvent,
            narrativeClusterId: narrativeClusterSync.cluster.id,
            narrativeClusterState: narrativeClusterSync.cluster.state,
          },
          cluster: narrativeClusterSync.cluster,
        }),
      });
      const existingIndexAfterCanonicalization = existingEvents.findIndex((event) => event.id === persisted.id);
      if (existingIndexAfterCanonicalization >= 0) {
        existingEvents.splice(existingIndexAfterCanonicalization, 1, latestEvent);
      } else {
        existingEvents.unshift(latestEvent);
      }
      eventCanonicalUrlsById.set(
        latestEvent.id,
        new Set(
          latestEvent.documentIds
            .map((documentId) => documentById.get(documentId)?.canonicalUrl)
            .filter((canonicalUrl): canonicalUrl is string => Boolean(canonicalUrl)),
        ),
      );
      touchedEventIds.add(latestEvent.id);
      clusteredCanonicalEventIds.add(latestEvent.id);
      await input.store.updateIntelligenceSignalProcessing({
        workspaceId: input.workspaceId,
        signalId: signal.id,
        processingStatus: 'processed',
        expectedCurrentStatus: 'processing',
        expectedCurrentLeaseId: processingLeaseId,
        processingLeaseId: null,
        promotionState: promotionPlan.promotionState,
        promotionReasons: promotionPlan.promotionReasons,
        linkedEventId: latestEvent.id,
        processingError: null,
        processedAt: nowIso(),
      });

      if (shouldAutoDeliberate(latestEvent)) {
        const result = await runIntelligenceCouncilBridgeWithRuntime({
          store: input.store,
          providerRouter: input.providerRouter,
          env: input.env,
          workspaceId: input.workspaceId,
          userId: input.userId,
          event: latestEvent,
        });
        if (result.deliberation) deliberationCount += 1;
        latestEvent = (await input.store.getIntelligenceEventById({ workspaceId: input.workspaceId, eventId: latestEvent.id })) ?? latestEvent;
      }

      for (const candidate of latestEvent.executionCandidates.filter((row) => row.status === 'pending' && row.executionMode === 'execute_auto')) {
        const executed = await executeIntelligenceCandidate({
          store: input.store,
          providerRouter: input.providerRouter,
          env: input.env,
          workspaceId: input.workspaceId,
          userId: input.userId,
          event: latestEvent,
          candidateId: candidate.id,
          notificationService: input.notificationService,
        });
        latestEvent = executed.event;
        executionCount += 1;
      }
    } catch (error) {
      if (isRetryableIntelligenceProcessingError(error)) {
        await input.store.updateIntelligenceSignalProcessing({
          workspaceId: input.workspaceId,
          signalId: signal.id,
          processingStatus: 'pending',
          expectedCurrentStatus: 'processing',
          expectedCurrentLeaseId: processingLeaseId,
          promotionState: 'pending_validation',
          promotionReasons: [],
          processingLeaseId: null,
          linkedEventId: null,
          processingError: null,
          processedAt: null,
        });
        continue;
      }
      failedCount += 1;
      failedSignalIds.push(signal.id);
      await input.store.updateIntelligenceSignalProcessing({
        workspaceId: input.workspaceId,
        signalId: signal.id,
        processingStatus: 'failed',
        expectedCurrentStatus: 'processing',
        expectedCurrentLeaseId: processingLeaseId,
        processingLeaseId: null,
        processingError: error instanceof Error ? error.message : String(error),
        processedAt: nowIso(),
      });
      }
    }

    for (let index = 0; index < existingEvents.length; index += 1) {
      const event = existingEvents[index]!;
      if (event.lifecycleState !== 'canonical') continue;
      const reconciled = reconcileExpectedSignalAbsence(event);
      if (!reconciled.changed) continue;
      const nextEvent = await input.store.upsertIntelligenceEvent({
        ...reconciled.event,
        executionCandidates: buildExecutionCandidate({
          event: reconciled.event,
        }),
      });
      await syncWorldModelTracksForEvent({
        store: input.store,
        workspaceId: input.workspaceId,
        event: nextEvent,
      });
      const currentCandidateEvents = await input.store.listIntelligenceEvents({
        workspaceId: input.workspaceId,
        limit: 200,
      });
      const temporal = await syncTemporalNarrativeLedgerForEvent({
        store: input.store,
        workspaceId: input.workspaceId,
        event: nextEvent,
        candidateEvents: currentCandidateEvents,
      });
      const narrativeClusterSync = await syncNarrativeClusterForEvent({
        store: input.store,
        workspaceId: input.workspaceId,
        event: nextEvent,
        temporal,
        candidateEvents: currentCandidateEvents,
      });
      const guardedEvent = await input.store.upsertIntelligenceEvent({
        ...nextEvent,
        narrativeClusterId: narrativeClusterSync.cluster.id,
        narrativeClusterState: narrativeClusterSync.cluster.state,
        executionCandidates: buildExecutionCandidate({
          event: {
            ...nextEvent,
            narrativeClusterId: narrativeClusterSync.cluster.id,
            narrativeClusterState: narrativeClusterSync.cluster.state,
          },
          cluster: narrativeClusterSync.cluster,
        }),
      });
      existingEvents.splice(index, 1, guardedEvent);
      eventCanonicalUrlsById.set(
        guardedEvent.id,
        new Set(
          guardedEvent.documentIds
            .map((documentId) => documentById.get(documentId)?.canonicalUrl)
            .filter((canonicalUrl): canonicalUrl is string => Boolean(canonicalUrl)),
        ),
      );
      touchedEventIds.add(guardedEvent.id);
    }

  return {
    processedSignalCount: signals.length - failedCount,
    clusteredEventCount: clusteredCanonicalEventIds.size,
    deliberationCount,
    executionCount,
    failedCount,
    failedSignalIds,
    eventIds: [...touchedEventIds],
  };
}

export async function runIntelligenceScannerPass(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  fetchTimeoutMs: number;
  sourceBatch: number;
  fetchImpl?: typeof fetch;
  notificationService?: NotificationService;
}): Promise<IntelligenceSourceScanSummary> {
  const scanSummary = await runIntelligenceSourceScanPass(input);
  const semanticSummary = await runIntelligenceSemanticPass({
    store: input.store,
    providerRouter: input.providerRouter,
    env: input.env,
    workspaceId: input.workspaceId,
    userId: input.env.DEFAULT_USER_ID,
    signalBatch: input.sourceBatch * 6,
    notificationService: input.notificationService,
  });
  return {
    fetchedCount: scanSummary.fetchedCount,
    storedDocumentCount: scanSummary.storedDocumentCount,
    signalCount: scanSummary.signalCount,
    clusteredEventCount: semanticSummary.clusteredEventCount,
    executionCount: semanticSummary.executionCount,
    failedCount: scanSummary.failedCount + semanticSummary.failedCount,
    failedSources: scanSummary.failedSources,
    sourceIds: scanSummary.sourceIds,
  };
}

export async function listSuspiciousIntelligenceEvents(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  limit: number;
}): Promise<IntelligenceStaleEventPreview[]> {
  const events = await input.store.listIntelligenceEvents({
    workspaceId: input.workspaceId,
    limit: Math.max(input.limit * 3, 150),
  });
  const previews: IntelligenceStaleEventPreview[] = [];

  for (const event of events) {
    const [linkedClaims, edges] = await Promise.all([
      input.store.listIntelligenceLinkedClaims({
        workspaceId: input.workspaceId,
        eventId: event.id,
        limit: 200,
      }),
      input.store.listIntelligenceLinkedClaimEdges({
        workspaceId: input.workspaceId,
        eventId: event.id,
        limit: 200,
      }),
    ]);
    const genericPredicateCount = linkedClaims.filter((row) => isGenericLinkedClaim(row)).length;
    const genericPredicateRatio = linkedClaims.length > 0 ? genericPredicateCount / linkedClaims.length : 0;
    const reasons: string[] = [];
    let staleScore = 0;
    if (event.graphSupportScore === 0 && event.graphContradictionScore === 0 && edges.length === 0) {
      reasons.push('zero_graph_scores');
      staleScore += 5;
    }
    if (genericPredicateRatio >= 0.6 && linkedClaims.length > 0) {
      reasons.push('generic_predicate_ratio');
      staleScore += 4;
    }
    if (linkedClaims.length >= 10) {
      reasons.push('inflated_claim_count');
      staleScore += 2;
    }
    if (event.nonSocialCorroborationCount < 1) {
      reasons.push('missing_non_social_corroboration');
      staleScore += 1;
    }
    if (event.linkedClaimHealthScore < 0.42) {
      reasons.push('linked_claim_health_too_low');
      staleScore += 2;
    }
    if (reasons.length === 0) continue;
    previews.push({
      eventId: event.id,
      title: event.title,
      topDomainId: event.topDomainId,
      staleScore,
      reasons,
      linkedClaimCount: linkedClaims.length,
      genericPredicateRatio: Number(genericPredicateRatio.toFixed(3)),
      nonSocialCorroborationCount: event.nonSocialCorroborationCount,
      edgeCount: edges.length,
      graphSupportScore: event.graphSupportScore,
      graphContradictionScore: event.graphContradictionScore,
      linkedClaimHealthScore: event.linkedClaimHealthScore,
      updatedAt: event.updatedAt,
    });
  }

  return previews
    .sort((left, right) => right.staleScore - left.staleScore || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, input.limit);
}

async function selectRebuiltEvent(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  eventIds: string[];
  signalIds: string[];
}): Promise<IntelligenceEventClusterRecord | null> {
  const signalIdSet = new Set(input.signalIds);
  let best: { event: IntelligenceEventClusterRecord; overlap: number } | null = null;
  for (const eventId of input.eventIds) {
    const event = await input.store.getIntelligenceEventById({
      workspaceId: input.workspaceId,
      eventId,
    });
    if (!event) continue;
    const overlap = event.signalIds.filter((signalId) => signalIdSet.has(signalId)).length;
    if (!best || overlap > best.overlap) {
      best = { event, overlap };
    }
  }
  return best?.event ?? null;
}

async function requeueWorkspaceSignals(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
}): Promise<string[]> {
  const signals = await input.store.listIntelligenceSignals({
    workspaceId: input.workspaceId,
    limit: 10_000,
  });
  for (const signal of signals) {
    await input.store.updateIntelligenceSignalProcessing({
      workspaceId: input.workspaceId,
      signalId: signal.id,
      processingStatus: 'pending',
      promotionState: 'pending_validation',
      promotionReasons: [],
      processingLeaseId: null,
      linkedEventId: null,
      processingError: null,
      processedAt: null,
    });
  }
  return signals.map((signal) => signal.id);
}

async function cleanupOrphanEvents(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  signalIds?: string[] | null;
}): Promise<string[]> {
  const signalIds = mergeUniqueStrings(input.signalIds ?? []);
  const signals =
    signalIds.length > 0
      ? await input.store.listIntelligenceSignalsByIds({
          workspaceId: input.workspaceId,
          signalIds,
        })
      : await input.store.listIntelligenceSignals({
          workspaceId: input.workspaceId,
          limit: 10_000,
        });
  const events = await input.store.listIntelligenceEvents({
    workspaceId: input.workspaceId,
    limit: 2_000,
  });
  const signalById = new Map(signals.map((signal) => [signal.id, signal] as const));
  const liveEventIds = new Set(
    signals.map((signal) => signal.linkedEventId).filter((eventId): eventId is string => Boolean(eventId)),
  );
  const orphanCandidates = events.filter((event) => {
    if (liveEventIds.has(event.id)) return false;
    if (signalIds.length === 0) {
      return event.signalIds.length === 0 || event.signalIds.some((signalId) => signalById.has(signalId));
    }
    return event.signalIds.some((signalId) => signalById.has(signalId));
  });
  const deletedEventIds: string[] = [];

  for (const event of orphanCandidates) {
    const overlappingSignalIds = event.signalIds.filter((signalId) => signalById.has(signalId));
    if (overlappingSignalIds.length === 0) continue;
    const stillLinked = overlappingSignalIds.some((signalId) => signalById.get(signalId)?.linkedEventId === event.id);
    if (stillLinked) continue;

    const memberships = await input.store.listIntelligenceNarrativeClusterMemberships({
      workspaceId: input.workspaceId,
      eventId: event.id,
      limit: 20,
    });
    await input.store.deleteIntelligenceEventById({
      workspaceId: input.workspaceId,
      eventId: event.id,
    });
    await Promise.all(
      mergeUniqueStrings(memberships.map((membership) => membership.clusterId)).map((clusterId) =>
        reconcileNarrativeClusterAfterEventRemoval({
          store: input.store,
          workspaceId: input.workspaceId,
          clusterId,
        }),
      ),
    );
    deletedEventIds.push(event.id);
  }

  return deletedEventIds;
}

export async function cleanupOrphanIntelligenceEvents(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
}): Promise<{ workspaceId: string; deletedEventIds: string[] }> {
  const deletedEventIds = await cleanupOrphanEvents({
    store: input.store,
    workspaceId: input.workspaceId,
  });
  return {
    workspaceId: input.workspaceId,
    deletedEventIds,
  };
}

async function cleanupWorkspaceOrphansIfIdle(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
}): Promise<{ ran: boolean; deletedEventIds: string[] }> {
  const [pendingSignals, processingSignals] = await Promise.all([
    input.store.listIntelligenceSignals({
      workspaceId: input.workspaceId,
      processingStatus: 'pending',
      limit: 1,
    }),
    input.store.listIntelligenceSignals({
      workspaceId: input.workspaceId,
      processingStatus: 'processing',
      limit: 1,
    }),
  ]);
  if (pendingSignals.length > 0 || processingSignals.length > 0) {
    return {
      ran: false,
      deletedEventIds: [],
    };
  }
  const deletedEventIds = await cleanupOrphanEvents({
    store: input.store,
    workspaceId: input.workspaceId,
  });
  return {
    ran: true,
    deletedEventIds,
  };
}

async function runWorkspaceSemanticBackgroundLoop(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  userId: string;
  notificationService?: NotificationService;
}) {
  const batchSize = Math.max(1, input.env.INTELLIGENCE_SEMANTIC_WORKER_BATCH);
  while (true) {
    const pendingSignals = await input.store.listIntelligenceSignals({
      workspaceId: input.workspaceId,
      limit: batchSize,
      processingStatus: 'pending',
    });
    if (pendingSignals.length === 0) break;
    const result = await runIntelligenceSemanticPass({
      store: input.store,
      providerRouter: input.providerRouter,
      env: input.env,
      workspaceId: input.workspaceId,
      userId: input.userId,
      signalBatch: batchSize,
      signalIds: pendingSignals.map((signal) => signal.id),
      notificationService: input.notificationService,
    });
    if (result.processedSignalCount === 0 && result.failedCount === 0) {
      break;
    }
  }
  await cleanupWorkspaceOrphansIfIdle({
    store: input.store,
    workspaceId: input.workspaceId,
  });
}

export async function rebuildIntelligenceWorkspace(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  userId: string;
  executionMode: 'worker' | 'background_loop';
  notificationService?: NotificationService;
}): Promise<IntelligenceWorkspaceRebuildResult> {
  const resetResult = await input.store.resetIntelligenceDerivedWorkspaceState({
    workspaceId: input.workspaceId,
  });
  const requeuedSignalIds = await requeueWorkspaceSignals({
    store: input.store,
    workspaceId: input.workspaceId,
  });
  if (input.executionMode === 'background_loop') {
    void runWorkspaceSemanticBackgroundLoop({
      store: input.store,
      providerRouter: input.providerRouter,
      env: input.env,
      workspaceId: input.workspaceId,
      userId: input.userId,
      notificationService: input.notificationService,
    });
  }
  return {
    ...resetResult,
    mode: 'hard_reset',
    queuedSignalCount: requeuedSignalIds.length,
    executionMode: input.executionMode,
  };
}

export async function rebuildIntelligenceEvent(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  userId: string;
  eventId: string;
  notificationService?: NotificationService;
}): Promise<IntelligenceEventRebuildResult> {
  const event = await input.store.getIntelligenceEventById({
    workspaceId: input.workspaceId,
    eventId: input.eventId,
  });
  if (!event) {
    throw new Error('intelligence event not found');
  }
  const signalIds = mergeUniqueStrings(event.signalIds);
  if (signalIds.length === 0) {
    throw new Error('intelligence event has no signals to rebuild');
  }

  const [signals, linkedClaims, narrativeMembership] = await Promise.all([
    input.store.listIntelligenceSignalsByIds({
      workspaceId: input.workspaceId,
      signalIds,
    }),
    input.store.listIntelligenceLinkedClaims({
      workspaceId: input.workspaceId,
      eventId: event.id,
      limit: 200,
    }),
    input.store.listIntelligenceNarrativeClusterMemberships({
      workspaceId: input.workspaceId,
      eventId: event.id,
      limit: 1,
    }),
  ]);
  const signalIdSet = new Set(signalIds);
  const deletableLinkedClaimIds = linkedClaims
    .filter((linkedClaim) => isEventScopedLinkedClaim({
      linkedClaim,
      signalIdSet,
    }))
    .map((linkedClaim) => linkedClaim.id);

  const previousClusterId = narrativeMembership[0]?.clusterId ?? null;
  await input.store.deleteIntelligenceEventById({
    workspaceId: input.workspaceId,
    eventId: event.id,
  });
  if (deletableLinkedClaimIds.length > 0) {
    await input.store.deleteIntelligenceLinkedClaimsByIds({
      workspaceId: input.workspaceId,
      linkedClaimIds: deletableLinkedClaimIds,
    });
  }
  if (previousClusterId) {
    await reconcileNarrativeClusterAfterEventRemoval({
      store: input.store,
      workspaceId: input.workspaceId,
      clusterId: previousClusterId,
    });
  }

  for (const signalId of signalIds) {
    await input.store.updateIntelligenceSignalProcessing({
      workspaceId: input.workspaceId,
      signalId,
      processingStatus: 'pending',
      promotionState: 'pending_validation',
      promotionReasons: [],
      processingLeaseId: null,
      linkedEventId: null,
      processingError: null,
      processedAt: null,
    });
  }

  const semanticSummary = await runIntelligenceSemanticPass({
    store: input.store,
    providerRouter: input.providerRouter,
    env: input.env,
    workspaceId: input.workspaceId,
    userId: input.userId,
    signalBatch: signalIds.length,
    signalIds,
    notificationService: input.notificationService,
  });
  const rebuiltEvent = await selectRebuiltEvent({
    store: input.store,
    workspaceId: input.workspaceId,
    eventIds: semanticSummary.eventIds,
    signalIds,
  });
  await cleanupOrphanEvents({
    store: input.store,
    workspaceId: input.workspaceId,
    signalIds,
  });

  return {
    workspaceId: input.workspaceId,
    previousEventId: event.id,
    rebuiltEventId: rebuiltEvent?.id ?? null,
    requeuedSignalIds: signals.map((signal) => signal.id),
    deletedLinkedClaimIds: deletableLinkedClaimIds,
    semanticSummary,
  };
}

export async function bulkRebuildIntelligenceEvents(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  userId: string;
  eventIds?: string[];
  limit?: number;
  notificationService?: NotificationService;
}): Promise<IntelligenceBulkEventRebuildResult> {
  const attemptedEventIds =
    input.eventIds && input.eventIds.length > 0
      ? mergeUniqueStrings(input.eventIds)
      : (
          await listSuspiciousIntelligenceEvents({
            store: input.store,
            workspaceId: input.workspaceId,
            limit: input.limit ?? 10,
          })
        ).map((event) => event.eventId);

  const results: IntelligenceEventRebuildResult[] = [];
  const failures: Array<{ eventId: string; message: string }> = [];

  for (const eventId of attemptedEventIds) {
    try {
      const result = await rebuildIntelligenceEvent({
        store: input.store,
        providerRouter: input.providerRouter,
        env: input.env,
        workspaceId: input.workspaceId,
        userId: input.userId,
        eventId,
        notificationService: input.notificationService,
      });
      results.push(result);
    } catch (error) {
      failures.push({
        eventId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    workspaceId: input.workspaceId,
    attemptedEventIds,
    rebuiltCount: results.length,
    failedCount: failures.length,
    results,
    failures,
  };
}

function buildCouncilQuestion(event: IntelligenceEventClusterRecord): string {
  return [
    `Review intelligence event: ${event.title}`,
    '',
    `Summary: ${event.summary}`,
    `Top domain: ${event.topDomainId ?? 'unknown'}`,
    `Primary hypotheses: ${event.primaryHypotheses.map((row) => `${row.title} (${row.confidence})`).join('; ')}`,
    `Counter hypotheses: ${event.counterHypotheses.map((row) => `${row.title} (${row.confidence})`).join('; ')}`,
    `Expected signals: ${event.expectedSignals.map((row) => row.description).join('; ')}`,
    'Return a concise analysis that stress-tests the primary hypothesis, the strongest counter-hypothesis, and whether execution should proceed.',
  ].join('\n');
}

export async function dispatchIntelligenceCouncilBridge(input: {
  ctx: RouteContext;
  workspaceId: string;
  event: IntelligenceEventClusterRecord;
  userId: string;
}): Promise<{
  dispatch: IntelligenceBridgeDispatchRecord;
  deliberation: IntelligenceEventClusterRecord['deliberations'][number] | null;
}> {
  const runtimeKeys = await input.ctx.loadRuntimeProviderApiKeys();
  const credentialsByProvider = Object.entries(runtimeKeys).reduce<ProviderCredentialsByProvider>((acc, [provider, apiKey]) => {
    if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
      const providerName = provider as ProviderCredentialProvider;
      acc[providerName] = {
        provider: providerName,
        source: 'env',
        selectedCredentialMode: 'api_key',
        credentialPriority: 'api_key_first',
        apiKey,
        authAccessTokenExpiresAt: null,
      };
    }
    return acc;
  }, {});
  try {
    const result = await startCouncilRun(input.ctx, {
      userId: input.userId,
      idempotencyKey: `intel-council-${randomUUID()}`,
      question: buildCouncilQuestion(input.event),
      maxRounds: 2,
      createTask: false,
      taskSource: 'intelligence_bridge',
      routeLabel: '/api/v1/intelligence/bridges/council',
      credentialsByProvider,
    });
    const deliberation: DeliberationResult = {
      id: randomUUID(),
      source: 'bridge_council' as const,
      status: 'completed' as const,
      proposedPrimary: input.event.primaryHypotheses[0]?.summary ?? result.run.summary,
      proposedCounter: input.event.counterHypotheses[0]?.summary ?? 'No counter-hypothesis returned.',
      weakestLink: input.event.invalidationConditions[0]?.description ?? 'No weakest link identified.',
      requiredNextSignals: input.event.expectedSignals.map((row) => row.description),
      executionStance: (input.event.riskBand === 'high' || input.event.riskBand === 'critical' ? 'hold' : 'proceed') as 'hold' | 'proceed',
      rawJson: {
        council_run_id: result.run.id,
        summary: result.run.summary,
        consensus_status: result.run.consensus_status,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const nextEvent = await input.ctx.store.upsertIntelligenceEvent({
      ...input.event,
      deliberationStatus: 'completed',
      deliberations: [...input.event.deliberations, deliberation],
      updatedAt: nowIso(),
    });
    const dispatch = await input.ctx.store.createIntelligenceBridgeDispatch({
      workspaceId: input.workspaceId,
      eventId: input.event.id,
      kind: 'council',
      status: 'dispatched',
      targetId: result.run.id,
      requestJson: {
        question: buildCouncilQuestion(input.event),
      },
      responseJson: {
        council_run_id: result.run.id,
        consensus_status: result.run.consensus_status,
      },
    });
    return {
      dispatch,
      deliberation: nextEvent.deliberations.at(-1) ?? deliberation,
    };
  } catch (error) {
    await input.ctx.store.upsertIntelligenceEvent({
      ...input.event,
      deliberationStatus: 'failed',
      updatedAt: nowIso(),
    });
    const dispatch = await input.ctx.store.createIntelligenceBridgeDispatch({
      workspaceId: input.workspaceId,
      eventId: input.event.id,
      kind: 'council',
      status: 'failed',
      requestJson: {
        question: buildCouncilQuestion(input.event),
      },
      responseJson: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { dispatch, deliberation: null };
  }
}

export async function bridgeIntelligenceEventToBrief(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  event: IntelligenceEventClusterRecord;
  userId: string;
}): Promise<IntelligenceBridgeDispatchRecord> {
  const briefing = await input.store.createBriefing({
    userId: input.userId,
    type: 'on_demand',
    status: 'completed',
    title: input.event.title,
    query: input.event.title,
    summary: input.event.summary,
    answerMarkdown: [
      `# ${input.event.title}`,
      '',
      input.event.summary,
      '',
      '## Primary Hypothesis',
      input.event.primaryHypotheses[0]?.summary ?? 'n/a',
      '',
      '## Counter Hypothesis',
      input.event.counterHypotheses[0]?.summary ?? 'n/a',
    ].join('\n'),
    sourceCount: input.event.signalIds.length,
    qualityJson: {
      source_mix: input.event.sourceMix,
      structurality_score: input.event.structuralityScore,
      actionability_score: input.event.actionabilityScore,
    },
  });
  const dossier = await input.store.createDossier({
    userId: input.userId,
    briefingId: briefing.id,
    title: input.event.title,
    query: input.event.title,
    status: 'ready',
    summary: input.event.summary,
    answerMarkdown: [
      `# ${input.event.title}`,
      '',
      input.event.summary,
      '',
      '## Domain Posterior',
      ...input.event.domainPosteriors.map((row) => `- ${row.domainId}: ${row.score}`),
      '',
      '## Expected Signals',
      ...input.event.expectedSignals.map((row) => `- ${row.description}`),
    ].join('\n'),
    qualityJson: {
      created_by: 'intelligence_bridge',
    },
    conflictsJson: {
      counter_hypotheses: input.event.counterHypotheses.map((row) => row.summary),
    },
  });
  return input.store.createIntelligenceBridgeDispatch({
    workspaceId: input.workspaceId,
    eventId: input.event.id,
    kind: 'brief',
    status: 'dispatched',
    targetId: dossier.id,
    requestJson: {
      title: input.event.title,
    },
    responseJson: {
      briefing_id: briefing.id,
      dossier_id: dossier.id,
    },
  });
}

export async function bridgeIntelligenceEventToAction(input: {
  store: WorkspaceScopedStore;
  workspaceId: string;
  event: IntelligenceEventClusterRecord;
  userId: string;
}): Promise<IntelligenceBridgeDispatchRecord> {
  const session = await input.store.createJarvisSession({
    userId: input.userId,
    title: input.event.title,
    prompt: input.event.summary,
    source: 'intelligence_bridge',
    intent: 'research',
    status: 'needs_approval',
    primaryTarget: 'execution',
  });
  const proposal = await input.store.createActionProposal({
    userId: input.userId,
    sessionId: session.id,
    kind: 'custom',
    title: `Action from intelligence event: ${input.event.title}`.slice(0, 180),
    summary: input.event.primaryHypotheses[0]?.summary ?? input.event.summary,
    payload: {
      event_id: input.event.id,
      execution_candidates: input.event.executionCandidates,
      top_domain_id: input.event.topDomainId,
    },
  });
  return input.store.createIntelligenceBridgeDispatch({
    workspaceId: input.workspaceId,
    eventId: input.event.id,
    kind: 'action',
    status: 'dispatched',
    targetId: proposal.id,
    requestJson: {
      session_id: session.id,
    },
    responseJson: {
      session_id: session.id,
      proposal_id: proposal.id,
    },
  });
}

export async function executeIntelligenceCandidate(input: {
  store: WorkspaceScopedStore;
  providerRouter: ProviderRouter;
  env: AppEnv;
  workspaceId: string;
  userId: string;
  event: IntelligenceEventClusterRecord;
  candidateId: string;
  logger?: LoggerLike;
  notificationService?: NotificationService;
}): Promise<{ event: IntelligenceEventClusterRecord; candidate: ExecutionCandidateRecord }> {
  const candidate = input.event.executionCandidates.find((row) => row.id === input.candidateId);
  if (!candidate) {
    throw new Error('execution candidate not found');
  }
  const toolName = typeof candidate.payload.mcp_tool_name === 'string' ? candidate.payload.mcp_tool_name : null;
  let status: IntelligenceExecutionStatus = candidate.status;
  let resultJson: Record<string, unknown> = { ...candidate.resultJson };
  let executedAt = candidate.executedAt;
  const toolArguments =
    typeof candidate.payload.arguments === 'object' && candidate.payload.arguments !== null && !Array.isArray(candidate.payload.arguments)
      ? candidate.payload.arguments as Record<string, unknown>
      : null;
  const connectorCapability =
    candidate.payload.connector_capability && typeof candidate.payload.connector_capability === 'object'
      ? candidate.payload.connector_capability as Record<string, unknown>
      : null;
  const schemaId = typeof connectorCapability?.schema_id === 'string' && connectorCapability.schema_id.trim().length > 0
    ? connectorCapability.schema_id
    : null;
  const allowedActions = Array.isArray(connectorCapability?.allowed_actions)
    ? connectorCapability.allowed_actions.filter((row): row is string => typeof row === 'string')
    : [];
  const connectorAllowsTool =
    connectorCapability &&
    connectorCapability.write_allowed === true &&
    connectorCapability.destructive !== true &&
    connectorCapability.requires_human !== true &&
    schemaId &&
    toolName &&
    allowedActions.includes(toolName);
  const completedDeliberation = input.event.deliberations.some((row) => row.status === 'completed');
  const deliberationRequired = shouldAutoDeliberate(input.event);

  if (candidate.riskBand === 'critical' || candidate.executionMode === 'approval_required') {
    status = 'blocked';
    resultJson = { ...resultJson, blocked_reason: 'approval_required' };
  } else if (!toolArguments) {
    status = 'blocked';
    resultJson = { ...resultJson, blocked_reason: 'schema_required' };
  } else if (candidate.executionMode === 'execute_auto' && deliberationRequired && !completedDeliberation) {
    status = 'blocked';
    resultJson = { ...resultJson, blocked_reason: 'deliberation_required' };
  } else if (!toolName || !(LOW_RISK_MCP_TOOLS.has(toolName) || connectorAllowsTool)) {
    status = 'blocked';
    resultJson = { ...resultJson, blocked_reason: 'mcp_tool_not_allowed', mcp_tool_name: toolName };
  } else {
    const response = await handleMcpStreamRequest(
      {
        origin: input.env.allowedOrigins[0],
        payload: {
          jsonrpc: '2.0',
          id: candidate.id,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: toolArguments,
          },
        },
      },
      { allowedOrigins: input.env.allowedOrigins },
      {
        store: input.store as JarvisStore,
        providerRouter: input.providerRouter,
        userId: input.userId,
        notificationService: input.notificationService,
      }
    );
    if (!response.accepted || response.response.error) {
      status = 'failed';
      resultJson = {
        ...resultJson,
        error: response.accepted ? response.response.error : { reason: response.reason },
      };
    } else {
      status = 'executed';
      executedAt = nowIso();
      resultJson = {
        ...resultJson,
        mcp_result: response.response.result,
      };
    }
  }

  const nextCandidate: ExecutionCandidateRecord = {
    ...candidate,
    status,
    resultJson,
    updatedAt: nowIso(),
    executedAt,
  };
  const outcome: IntelligenceOutcomeRecord =
    status === 'executed'
      ? {
          id: randomUUID(),
          status: 'confirmed',
          summary: `Execution candidate ${candidate.title} executed successfully.`,
          createdAt: nowIso(),
        }
      : {
          id: randomUUID(),
          status: 'mixed',
          summary: `Execution candidate ${candidate.title} did not auto-execute.`,
          createdAt: nowIso(),
        };
  const nextEvent = await input.store.upsertIntelligenceEvent({
    ...input.event,
    deliberationStatus: summarizeDeliberationStatus(input.event),
    executionCandidates: input.event.executionCandidates.map((row) => (row.id === candidate.id ? nextCandidate : row)),
    outcomes: [...input.event.outcomes, outcome].slice(-20),
    updatedAt: nowIso(),
  });
  await syncWorldModelTracksForEvent({
    store: input.store,
    workspaceId: input.workspaceId,
    event: nextEvent,
  });
  await input.store.createIntelligenceExecutionAudit({
    workspaceId: input.workspaceId,
    eventId: input.event.id,
    candidateId: candidate.id,
    connectorId:
      typeof connectorCapability?.connector_id === 'string' && connectorCapability.connector_id.trim().length > 0
        ? connectorCapability.connector_id
        : null,
    actionName: toolName,
    status,
    summary:
      status === 'executed'
        ? `Execution candidate "${candidate.title}" executed successfully.`
        : `Execution candidate "${candidate.title}" finished with status ${status}.`,
    resultJson,
  });
  input.logger?.info(
    {
      workspace_id: input.workspaceId,
      event_id: input.event.id,
      candidate_id: candidate.id,
      status,
    },
    'intelligence execution candidate handled'
  );
  return {
    event: nextEvent,
    candidate: nextCandidate,
  };
}
