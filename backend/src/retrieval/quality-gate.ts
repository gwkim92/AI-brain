import type { GroundingDecision } from './policy-router';
import type { GroundingClaim, GroundingSource } from './grounding';
import { evaluateLanguageAlignment, type ResponseLanguage } from './language-policy';

const GROUNDING_REASON_CANONICAL_MAP: Record<string, string> = {
  missing_grounding_claims: 'missing_grounded_claims',
  insufficient_claim_coverage: 'insufficient_claim_citation_coverage',
  insufficient_domains: 'insufficient_domain_diversity',
  insufficient_sources_count: 'insufficient_sources',
  template_token_artifact: 'template_artifact',
  language_not_aligned: 'language_mismatch'
};

export function normalizeGroundingQualityReasons(reasons: string[]): string[] {
  return Array.from(
    new Set(
      reasons
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => GROUNDING_REASON_CANONICAL_MAP[item] ?? item)
    )
  );
}

export type GroundingQualityGateInput = {
  decision: GroundingDecision;
  sources: GroundingSource[];
  claims?: GroundingClaim[];
  hasTemplateArtifact: boolean;
  outputText?: string;
  expectedLanguage?: ResponseLanguage | null;
};

export type GroundingQualityGateResult = {
  passed: boolean;
  reasons: string[];
  metrics: {
    sourceCount: number;
    uniqueDomainCount: number;
    minSourcesRequired: number;
    minDomainsRequired: number;
    claimCount?: number;
    citedClaimCount?: number;
    claimCitationCoverage?: number;
    minClaimCitationCoverageRequired?: number;
    expectedLanguage?: ResponseLanguage | null;
    detectedLanguage?: ResponseLanguage;
    languageAlignmentScore?: number;
  };
};

function resolveThresholds(decision: GroundingDecision): { minSources: number; minDomains: number } {
  if (decision.signals.news) {
    return { minSources: 2, minDomains: 2 };
  }
  if (decision.policy === 'high_risk_factual') {
    return { minSources: 2, minDomains: 2 };
  }
  if (decision.policy === 'dynamic_factual') {
    return { minSources: 1, minDomains: 1 };
  }
  return { minSources: 0, minDomains: 0 };
}

function resolveMinClaimCoverage(decision: GroundingDecision): number {
  if (decision.signals.news) {
    return 0.75;
  }
  if (decision.policy === 'high_risk_factual') {
    return 0.8;
  }
  if (decision.policy === 'dynamic_factual') {
    return 0.6;
  }
  return 0;
}

export function evaluateGroundingQualityGate(input: GroundingQualityGateInput): GroundingQualityGateResult {
  const reasons: string[] = [];
  const uniqueDomains = new Set(input.sources.map((item) => item.domain.toLowerCase()));
  const thresholds = resolveThresholds(input.decision);
  const minClaimCoverage = resolveMinClaimCoverage(input.decision);
  const claims = input.claims ?? [];
  const citedClaimCount = claims.filter((claim) => claim.sourceUrls.length > 0).length;
  const claimCitationCoverage = claims.length > 0 ? citedClaimCount / claims.length : 0;
  const shouldCheckClaimCoverage = Boolean(input.outputText);
  const languageAlignment =
    input.outputText && input.expectedLanguage
      ? evaluateLanguageAlignment(input.expectedLanguage, input.outputText)
      : null;

  if (input.hasTemplateArtifact) {
    reasons.push('template_artifact');
  }

  if (input.decision.requiresGrounding) {
    if (input.sources.length < thresholds.minSources) {
      reasons.push('insufficient_sources');
    }
    if (uniqueDomains.size < thresholds.minDomains) {
      reasons.push('insufficient_domain_diversity');
    }
    if (shouldCheckClaimCoverage) {
      if (claims.length === 0) {
        reasons.push('missing_grounded_claims');
      } else if (claimCitationCoverage < minClaimCoverage) {
        reasons.push('insufficient_claim_citation_coverage');
      }
    }
  }
  if (languageAlignment && !languageAlignment.passed) {
    reasons.push('language_mismatch');
  }

  const normalizedReasons = normalizeGroundingQualityReasons(reasons);

  return {
    passed: normalizedReasons.length === 0,
    reasons: normalizedReasons,
    metrics: {
      sourceCount: input.sources.length,
      uniqueDomainCount: uniqueDomains.size,
      minSourcesRequired: thresholds.minSources,
      minDomainsRequired: thresholds.minDomains,
      claimCount: claims.length,
      citedClaimCount,
      claimCitationCoverage: shouldCheckClaimCoverage ? claimCitationCoverage : undefined,
      minClaimCitationCoverageRequired: shouldCheckClaimCoverage ? minClaimCoverage : undefined,
      expectedLanguage: input.expectedLanguage ?? null,
      detectedLanguage: languageAlignment?.detectedLanguage,
      languageAlignmentScore: languageAlignment?.score
    }
  };
}

export function buildGroundingQualityBlockedMessage(result: GroundingQualityGateResult): string {
  const normalizedReasons = normalizeGroundingQualityReasons(result.reasons);
  const reasonText = normalizedReasons.length > 0 ? normalizedReasons.join(', ') : 'quality_policy';
  return [
    '근거 기반 응답 품질 검증에 실패했습니다.',
    `사유: ${reasonText}`,
    '권장 조치: 최신 질문 범위를 좁히거나, 신뢰 가능한 출처를 함께 지정해 다시 요청하세요.'
  ].join('\n');
}
