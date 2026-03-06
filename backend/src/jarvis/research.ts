import { retrieveWebEvidence } from '../retrieval/adapter-router';
import { buildLanguageSystemInstruction } from '../retrieval/language-policy';
import {
  buildFallbackNewsFactsFromSources,
  ensureFactDomainCoverage,
  renderNewsBriefingFromFacts,
  type NewsBriefingFact
} from '../retrieval/news-briefing';
import { generateQueryRewriteCandidates } from '../retrieval/query-rewrite';

export type JarvisResearchArtifact = {
  title: string;
  query: string;
  summary: string;
  answerMarkdown: string;
  sources: Array<{
    url: string;
    title: string;
    domain: string;
    snippet?: string;
    publishedAt?: string;
  }>;
  claims: Array<{
    claimText: string;
    sourceUrls: string[];
  }>;
  quality: Record<string, unknown>;
  conflicts: Record<string, unknown>;
};

export type ResearchStrictness = 'default' | 'news';

type GenerateResearchArtifactOptions = {
  strictness?: ResearchStrictness;
};

export function inferResearchStrictness(query: string): ResearchStrictness {
  return /(뉴스|속보|전쟁|헤드라인|breaking|latest|news|headline|war)/iu.test(query) ? 'news' : 'default';
}

function truncateText(value: string, maxLength = 120): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function buildSummaryFromFacts(facts: NewsBriefingFact[]): string {
  if (facts.length === 0) return 'No grounded evidence available yet.';
  return facts
    .slice(0, 3)
    .map((fact, index) => `${index + 1}. ${fact.headline} - ${fact.summary}`)
    .join('\n');
}

function freshnessStats(sources: Array<{ publishedAt?: string }>): {
  ratio: number | null;
  recentCount: number;
  staleCount: number;
  unknownCount: number;
  bucket: 'fresh' | 'mixed' | 'stale' | 'unknown';
} {
  if (sources.length === 0) {
    return {
      ratio: null,
      recentCount: 0,
      staleCount: 0,
      unknownCount: 0,
      bucket: 'unknown'
    };
  }

  let recentCount = 0;
  let staleCount = 0;
  let unknownCount = 0;
  for (const source of sources) {
    const publishedAtMs = source.publishedAt ? Date.parse(source.publishedAt) : Number.NaN;
    if (!Number.isFinite(publishedAtMs)) {
      unknownCount += 1;
      continue;
    }
    if (Date.now() - publishedAtMs <= 7 * 24 * 60 * 60 * 1000) {
      recentCount += 1;
    } else {
      staleCount += 1;
    }
  }
  const ratio = Number((recentCount / sources.length).toFixed(3));
  return {
    ratio,
    recentCount,
    staleCount,
    unknownCount,
    bucket: ratio >= 0.7 ? 'fresh' : ratio >= 0.35 ? 'mixed' : recentCount === 0 && unknownCount === sources.length ? 'unknown' : 'stale'
  };
}

function topDomains(sources: Array<{ domain: string }>): Array<{ domain: string; count: number }> {
  const domainCounts = new Map<string, number>();
  for (const source of sources) {
    const domain = source.domain.trim().toLowerCase();
    if (!domain) continue;
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  return [...domainCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }));
}

function citationCoverage(claims: Array<{ sourceUrls: string[] }>): {
  citationCoverage: number;
  averageSourcesPerClaim: number;
  supportedClaimCount: number;
} {
  if (claims.length === 0) {
    return {
      citationCoverage: 0,
      averageSourcesPerClaim: 0,
      supportedClaimCount: 0
    };
  }
  const supportedClaimCount = claims.filter((claim) => claim.sourceUrls.length > 0).length;
  const totalSources = claims.reduce((sum, claim) => sum + claim.sourceUrls.length, 0);
  return {
    citationCoverage: Number((supportedClaimCount / claims.length).toFixed(3)),
    averageSourcesPerClaim: Number((totalSources / claims.length).toFixed(3)),
    supportedClaimCount
  };
}

function buildQualityEnvelope(input: {
  query: string;
  rewrittenQueries: string[];
  sources: JarvisResearchArtifact['sources'];
  claims: JarvisResearchArtifact['claims'];
  conflicts: string[];
}) {
  const freshness = freshnessStats(input.sources);
  const domains = topDomains(input.sources);
  const domainCount = new Set(input.sources.map((source) => source.domain)).size;
  const domainDiversityScore = input.sources.length === 0 ? 0 : Number((domainCount / input.sources.length).toFixed(3));
  const citation = citationCoverage(input.claims);
  const softWarnings: string[] = [];

  if (input.sources.length < 3) {
    softWarnings.push('source count is below the preferred minimum of 3');
  }
  if (domainCount < 2 && input.sources.length > 1) {
    softWarnings.push('domain diversity is low; results may depend on too few publishers');
  }
  if (citation.citationCoverage < 0.8) {
    softWarnings.push('citation coverage is below target; some claims have weak source support');
  }
  if (freshness.bucket === 'stale') {
    softWarnings.push('source freshness is stale for a news-oriented briefing');
  }
  if (input.conflicts.length > 0) {
    softWarnings.push('conflicting summaries detected across retrieved sources');
  }

  return {
    query_rewrites: input.rewrittenQueries,
    query_rewrite_count: input.rewrittenQueries.length,
    source_count: input.sources.length,
    claim_count: input.claims.length,
    supported_claim_count: citation.supportedClaimCount,
    domain_count: domainCount,
    domain_diversity_score: domainDiversityScore,
    freshness_ratio: freshness.ratio,
    freshness_bucket: freshness.bucket,
    recent_source_count: freshness.recentCount,
    stale_source_count: freshness.staleCount,
    unknown_date_source_count: freshness.unknownCount,
    citation_coverage: citation.citationCoverage,
    average_sources_per_claim: citation.averageSourcesPerClaim,
    coverage: Math.min(1, Number((input.claims.length / Math.max(1, input.sources.length)).toFixed(3))),
    quality_gate_passed:
      input.sources.length >= 2 &&
      domainCount >= 2 &&
      citation.citationCoverage >= 0.8 &&
      freshness.bucket !== 'stale',
    soft_warnings: softWarnings,
    top_domains: domains
  };
}

function detectConflicts(facts: NewsBriefingFact[]): string[] {
  const topicMap = new Map<string, Set<string>>();
  for (const fact of facts) {
    const key = fact.headline.toLowerCase().replace(/[^a-z0-9가-힣]+/giu, ' ').trim();
    if (!key) continue;
    const bucket = topicMap.get(key) ?? new Set<string>();
    bucket.add(fact.summary);
    topicMap.set(key, bucket);
  }
  return [...topicMap.entries()]
    .filter(([, summaries]) => summaries.size > 1)
    .map(([key]) => key)
    .slice(0, 5);
}

function qualityGateFailureReason(quality: Record<string, unknown>): string {
  const warnings = Array.isArray(quality.soft_warnings)
    ? quality.soft_warnings.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return warnings.length > 0 ? warnings.slice(0, 2).join('; ') : 'grounded evidence did not meet the required quality gate';
}

function shouldBlockResearchArtifact(quality: Record<string, unknown>, strictness: ResearchStrictness): boolean {
  const sourceCount = typeof quality.source_count === 'number' ? quality.source_count : 0;
  const domainCount = typeof quality.domain_count === 'number' ? quality.domain_count : 0;
  const citationCoverage = typeof quality.citation_coverage === 'number' ? quality.citation_coverage : 0;
  const freshnessBucket = typeof quality.freshness_bucket === 'string' ? quality.freshness_bucket : 'unknown';
  const qualityGatePassed = quality.quality_gate_passed === true;

  if (qualityGatePassed) return false;

  if (strictness === 'news') {
    return sourceCount < 2 || domainCount < 2 || citationCoverage < 0.7 || freshnessBucket === 'stale';
  }

  return false;
}

async function generateResearchArtifactAttempt(query: string, options: {
  maxVariants: number;
  maxItems: number;
}): Promise<JarvisResearchArtifact> {
  const rewrittenQueries = generateQueryRewriteCandidates({ prompt: query, maxVariants: options.maxVariants });
  const retrievalPack = await retrieveWebEvidence({
    prompt: query,
    rewrittenQueries,
    maxItems: options.maxItems
  });
  const languagePolicy = buildLanguageSystemInstruction(query);
  const facts = ensureFactDomainCoverage({
    facts: buildFallbackNewsFactsFromSources({
      sources: retrievalPack.sources,
      expectedLanguage: languagePolicy.expectedLanguage,
      maxFacts: 5
    }),
    sources: retrievalPack.sources,
    expectedLanguage: languagePolicy.expectedLanguage,
    maxFacts: 5
  });
  const answerMarkdown = renderNewsBriefingFromFacts({
    facts,
    sources: retrievalPack.sources,
    expectedLanguage: languagePolicy.expectedLanguage,
    retrievedAt: new Date().toISOString()
  });
  const summary = buildSummaryFromFacts(facts);
  const claims = facts.map((fact) => ({
    claimText: `${fact.headline}: ${fact.summary}`,
    sourceUrls: [...fact.sourceUrls]
  }));
  const conflicts = detectConflicts(facts);
  const quality = buildQualityEnvelope({
    query,
    rewrittenQueries,
    sources: retrievalPack.sources,
    claims,
    conflicts
  });

  return {
    title: truncateText(query, 90),
    query,
    summary,
    answerMarkdown,
    sources: retrievalPack.sources,
    claims,
    quality,
    conflicts: {
      topics: conflicts,
      count: conflicts.length
    }
  };
}

export async function generateResearchArtifact(
  query: string,
  options?: GenerateResearchArtifactOptions
): Promise<JarvisResearchArtifact> {
  const strictness = options?.strictness ?? 'default';
  const firstAttempt = await generateResearchArtifactAttempt(query, {
    maxVariants: strictness === 'news' ? 5 : 4,
    maxItems: strictness === 'news' ? 10 : 8
  });

  if (firstAttempt.quality.quality_gate_passed === true) {
    return firstAttempt;
  }

  const retryAttempt = await generateResearchArtifactAttempt(query, {
    maxVariants: strictness === 'news' ? 6 : 5,
    maxItems: strictness === 'news' ? 14 : 10
  });

  if (retryAttempt.quality.quality_gate_passed === true || !shouldBlockResearchArtifact(retryAttempt.quality, strictness)) {
    return retryAttempt;
  }

  throw new Error(`quality gate failed: ${qualityGateFailureReason(retryAttempt.quality)}`);
}
