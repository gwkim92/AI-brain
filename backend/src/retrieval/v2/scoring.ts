import type { V2RiskLevel, V2RoutingIntent } from '../../store/types';
import type { RetrievalEvidenceCandidateV2, RetrievalScoreSummaryV2, RetrievalSubQueryV2 } from './types';

const DOMAIN_TRUST_HINTS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /(reuters\.com|apnews\.com|bloomberg\.com|ft\.com|wsj\.com|nytimes\.com)/iu, score: 0.95 },
  { pattern: /(sec\.gov|fred\.stlouisfed\.org|worldbank\.org|imf\.org|oecd\.org)/iu, score: 0.98 },
  { pattern: /(arxiv\.org|doi\.org|crossref\.org|nature\.com|science\.org)/iu, score: 0.92 },
  { pattern: /(github\.com|gitlab\.com|npmjs\.com|pypi\.org)/iu, score: 0.88 }
];

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function scoreDomainTrust(domain: string): number {
  const normalized = domain.trim().toLowerCase();
  if (!normalized) return 0.5;
  for (const hint of DOMAIN_TRUST_HINTS) {
    if (hint.pattern.test(normalized)) {
      return hint.score;
    }
  }
  return 0.7;
}

function scoreFreshnessFromDate(publishedAt: string | null): number {
  if (!publishedAt) return 0.5;
  const ts = Date.parse(publishedAt);
  if (!Number.isFinite(ts)) return 0.5;

  const ageHours = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
  if (ageHours <= 24) return 1;
  if (ageHours <= 24 * 7) return 0.9;
  if (ageHours <= 24 * 30) return 0.75;
  if (ageHours <= 24 * 90) return 0.6;
  return 0.45;
}

export function scoreRetrievalV2(input: {
  subQueries: RetrievalSubQueryV2[];
  evidenceItems: RetrievalEvidenceCandidateV2[];
}): RetrievalScoreSummaryV2 {
  const totalSubQueries = Math.max(1, input.subQueries.length);
  const matchedSubQueryCount = new Set(input.evidenceItems.map((item) => item.subQueryId)).size;
  const coverageScore = clamp01(matchedSubQueryCount / totalSubQueries);

  if (input.evidenceItems.length === 0) {
    return {
      trustScore: 0,
      coverageScore,
      freshnessScore: 0,
      diversityScore: 0
    };
  }

  let trustSum = 0;
  let freshnessSum = 0;
  const domains = new Set<string>();
  const connectors = new Set<string>();
  for (const item of input.evidenceItems) {
    trustSum += scoreDomainTrust(item.domain);
    freshnessSum += scoreFreshnessFromDate(item.publishedAt);
    if (item.domain) domains.add(item.domain.toLowerCase());
    if (item.connector) connectors.add(item.connector.toLowerCase());
  }

  const avgTrust = trustSum / input.evidenceItems.length;
  const corroboration = clamp01(domains.size / Math.max(2, totalSubQueries));
  const trustScore = clamp01(avgTrust * 0.8 + corroboration * 0.2);

  const freshnessScore = clamp01(freshnessSum / input.evidenceItems.length);
  const domainDiversity = clamp01(domains.size / input.evidenceItems.length);
  const connectorDiversity = clamp01(connectors.size / 3);
  const diversityScore = clamp01(domainDiversity * 0.7 + connectorDiversity * 0.3);

  return {
    trustScore: Number(trustScore.toFixed(3)),
    coverageScore: Number(coverageScore.toFixed(3)),
    freshnessScore: Number(freshnessScore.toFixed(3)),
    diversityScore: Number(diversityScore.toFixed(3))
  };
}

export function evaluateCoverageGate(input: {
  intent: V2RoutingIntent;
  riskLevel: V2RiskLevel;
  score: RetrievalScoreSummaryV2;
}): { blocked: boolean; blockedReasons: string[] } {
  const blockedReasons: string[] = [];
  const highRiskRequest = input.intent === 'finance' || input.riskLevel === 'high';

  if (highRiskRequest && input.score.coverageScore < 0.75) {
    blockedReasons.push('insufficient_evidence_coverage');
  }

  return {
    blocked: blockedReasons.length > 0,
    blockedReasons
  };
}
