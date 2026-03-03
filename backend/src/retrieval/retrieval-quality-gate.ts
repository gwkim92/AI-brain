import type { RetrievalEvidencePack } from './adapter-router';
import type { GroundingDecision } from './policy-router';

const RETRIEVAL_REASON_CANONICAL_MAP: Record<string, string> = {
  insufficient_sources: 'insufficient_retrieval_sources',
  insufficient_domains: 'insufficient_retrieval_domain_diversity',
  stale_retrieval_sources: 'insufficient_retrieval_freshness',
  freshness_ratio_low: 'low_retrieval_freshness_ratio'
};

export function normalizeRetrievalQualityReasons(reasons: string[]): string[] {
  return Array.from(
    new Set(
      reasons
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => RETRIEVAL_REASON_CANONICAL_MAP[item] ?? item)
    )
  );
}

export type RetrievalQualityGateInput = {
  decision: GroundingDecision;
  evidence: RetrievalEvidencePack;
};

export type RetrievalQualityGateResult = {
  passed: boolean;
  reasons: string[];
  metrics: {
    sourceCount: number;
    uniqueDomainCount: number;
    recentSourceCount: number;
    freshnessRatio: number;
    minSourcesRequired: number;
    minDomainsRequired: number;
    minRecentSourcesRequired: number;
  };
};

const RECENT_WINDOW_HOURS = 72;

function isRecent(publishedAt?: string): boolean {
  if (!publishedAt) return false;
  const ts = Date.parse(publishedAt);
  if (!Number.isFinite(ts)) return false;
  const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
  return ageHours >= 0 && ageHours <= RECENT_WINDOW_HOURS;
}

function resolveThresholds(decision: GroundingDecision): {
  minSources: number;
  minDomains: number;
  minRecentSources: number;
} {
  if (decision.signals.news) {
    return {
      minSources: 2,
      minDomains: 2,
      minRecentSources: 1
    };
  }
  if (decision.policy === 'high_risk_factual') {
    return {
      minSources: 3,
      minDomains: 2,
      minRecentSources: 1
    };
  }
  if (decision.policy === 'dynamic_factual') {
    return {
      minSources: 2,
      minDomains: 1,
      minRecentSources: 0
    };
  }
  return {
    minSources: 0,
    minDomains: 0,
    minRecentSources: 0
  };
}

export function evaluateRetrievalQualityGate(input: RetrievalQualityGateInput): RetrievalQualityGateResult {
  const reasons: string[] = [];
  const thresholds = resolveThresholds(input.decision);
  const sourceCount = input.evidence.items.length;
  const uniqueDomainCount = new Set(input.evidence.items.map((item) => item.domain.toLowerCase())).size;
  const recentSourceCount = input.evidence.items.filter((item) => isRecent(item.publishedAt)).length;
  const freshnessRatio = sourceCount > 0 ? recentSourceCount / sourceCount : 0;

  if (sourceCount < thresholds.minSources) {
    reasons.push('insufficient_retrieval_sources');
  }
  if (uniqueDomainCount < thresholds.minDomains) {
    reasons.push('insufficient_retrieval_domain_diversity');
  }
  if (recentSourceCount < thresholds.minRecentSources) {
    reasons.push('insufficient_retrieval_freshness');
  }
  if (input.decision.signals.news && freshnessRatio < 0.3) {
    reasons.push('low_retrieval_freshness_ratio');
  }

  const normalizedReasons = normalizeRetrievalQualityReasons(reasons);

  return {
    passed: normalizedReasons.length === 0,
    reasons: normalizedReasons,
    metrics: {
      sourceCount,
      uniqueDomainCount,
      recentSourceCount,
      freshnessRatio,
      minSourcesRequired: thresholds.minSources,
      minDomainsRequired: thresholds.minDomains,
      minRecentSourcesRequired: thresholds.minRecentSources
    }
  };
}

export function buildRetrievalQualityBlockedMessage(result: RetrievalQualityGateResult): string {
  const normalizedReasons = normalizeRetrievalQualityReasons(result.reasons);
  const reasonText = normalizedReasons.length > 0 ? normalizedReasons.join(', ') : 'retrieval_quality_policy';
  return [
    '검색 근거 품질 검증에 실패했습니다.',
    `사유: ${reasonText}`,
    '권장 조치: 질문 범위를 구체화하거나 신뢰 가능한 출처를 지정해 다시 요청하세요.'
  ].join('\n');
}
