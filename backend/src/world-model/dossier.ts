import { resolveResearchProfile, type ResearchProfile } from '../retrieval/research-profile';
import type { DossierClaimRecord, DossierRecord, DossierSourceRecord } from '../store/types';

import { extractWorldModelCandidateFacts } from './extraction';
import { resolveWorldModelDossierConfig, type WorldModelDossierConfigOverride } from './config';
import { buildHypothesisLedger } from './hypothesis-ledger';
import { buildWorldModelState } from './state-model';

const VALID_RESEARCH_PROFILES = new Set<ResearchProfile>([
  'broad_news',
  'topic_news',
  'entity_brief',
  'comparison_research',
  'repo_research',
  'market_research',
  'policy_regulation',
]);

function resolveStoredResearchProfile(dossier: DossierRecord): ResearchProfile {
  const raw = dossier.qualityJson?.research_profile;
  return typeof raw === 'string' && VALID_RESEARCH_PROFILES.has(raw as ResearchProfile)
    ? (raw as ResearchProfile)
    : resolveResearchProfile({ prompt: dossier.query }).profile;
}

export type DossierWorldModelBlock = {
  state_snapshot: {
    generated_at: string;
    dominant_signals: string[];
    variables: Record<string, { score: number; direction: 'up' | 'flat'; drivers: string[] }>;
    notes: string[];
  };
  bottlenecks: Array<{
    key: string;
    score: number;
    drivers: string[];
  }>;
  hypotheses: Array<{
    thesis: string;
    stance: 'primary' | 'counter';
    confidence: number;
    status: 'active' | 'weakened' | 'invalidated';
    summary: string;
    watch_state_keys: string[];
    evidence: Array<{
      claim_text: string;
      relation: 'supports' | 'contradicts' | 'context';
      source_urls: string[];
      weight: number;
    }>;
  }>;
  invalidation_conditions: Array<{
    hypothesis_thesis: string;
    stance: 'primary' | 'counter';
    description: string;
    expected_by: string | null;
    observed_status: 'pending' | 'hit' | 'missed';
    severity: 'low' | 'medium' | 'high';
    matched_evidence: string[];
  }>;
  next_watch_signals: Array<{
    description: string;
    expected_by: string | null;
    severity: 'low' | 'medium' | 'high';
    stance: 'primary' | 'counter';
  }>;
};

export function buildStoredDossierWorldModelExtraction(input: {
  dossier: DossierRecord;
  sources: DossierSourceRecord[];
  claims: DossierClaimRecord[];
}): ReturnType<typeof extractWorldModelCandidateFacts> {
  return extractWorldModelCandidateFacts({
    query: input.dossier.query,
    researchProfile: resolveStoredResearchProfile(input.dossier),
    generatedAt: input.dossier.updatedAt,
    sources: input.sources.map((source) => ({
      url: source.url,
      title: source.title,
      domain: source.domain,
      snippet: source.snippet,
      publishedAt: source.publishedAt ?? undefined,
    })),
    claims: input.claims.map((claim) => ({
      claimText: claim.claimText,
      sourceUrls: [...claim.sourceUrls],
    })),
  });
}

export function buildWorldModelBlockFromExtraction(input: {
  extraction: ReturnType<typeof extractWorldModelCandidateFacts>;
  now?: string;
  configOverride?: WorldModelDossierConfigOverride;
}): DossierWorldModelBlock {
  const config = resolveWorldModelDossierConfig(input.configOverride);
  const state = buildWorldModelState({ extraction: input.extraction });
  const ledger = buildHypothesisLedger({ extraction: input.extraction, state, now: input.now });

  const bottlenecks = Object.values(state.variables)
    .filter((variable) => variable.score >= config.bottleneckScoreThreshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, config.maxBottlenecks)
    .map((variable) => ({
      key: variable.key,
      score: variable.score,
      drivers: variable.drivers,
    }));

  const invalidationConditions = ledger.flatMap((hypothesis) =>
    hypothesis.invalidationConditions.map((condition) => ({
      hypothesis_thesis: hypothesis.thesis,
      stance: hypothesis.stance,
      description: condition.description,
      expected_by: condition.expectedBy,
      observed_status: condition.observedStatus,
      severity: condition.severity,
      matched_evidence: condition.matchedEvidence,
    }))
  ).slice(0, config.maxInvalidationConditions);

  const nextWatchSignals = invalidationConditions
    .filter((condition) => condition.observed_status === 'pending')
    .map((condition) => ({
      description: condition.description,
      expected_by: condition.expected_by,
      severity: condition.severity,
      stance: condition.stance,
    }))
    .slice(0, config.maxNextWatchSignals);

  return {
    state_snapshot: {
      generated_at: state.generatedAt,
      dominant_signals: [...state.dominantSignals],
      variables: Object.fromEntries(
        Object.entries(state.variables).map(([key, value]) => [
          key,
          {
            score: value.score,
            direction: value.direction,
            drivers: value.drivers,
          },
        ])
      ),
      notes: [...state.notes],
    },
    bottlenecks,
    hypotheses: ledger.map((hypothesis) => ({
      thesis: hypothesis.thesis,
      stance: hypothesis.stance,
      confidence: hypothesis.confidence,
      status: hypothesis.status,
      summary: hypothesis.summary,
      watch_state_keys: [...hypothesis.watchStateKeys],
      evidence: hypothesis.evidence.map((evidence) => ({
        claim_text: evidence.claimText,
        relation: evidence.relation,
        source_urls: [...evidence.sourceUrls],
        weight: evidence.weight,
      })),
    })),
    invalidation_conditions: invalidationConditions,
    next_watch_signals: nextWatchSignals,
  };
}

export function buildDossierWorldModel(input: {
  dossier: DossierRecord;
  sources: DossierSourceRecord[];
  claims: DossierClaimRecord[];
  now?: string;
  configOverride?: WorldModelDossierConfigOverride;
}): DossierWorldModelBlock {
  const extraction = buildStoredDossierWorldModelExtraction({
    dossier: input.dossier,
    sources: input.sources,
    claims: input.claims,
  });
  return buildWorldModelBlockFromExtraction({
    extraction,
    now: input.now,
    configOverride: input.configOverride,
  });
}
