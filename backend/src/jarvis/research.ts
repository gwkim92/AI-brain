import { retrieveWebEvidence } from '../retrieval/adapter-router';
import { buildLanguageSystemInstruction, type ResponseLanguage } from '../retrieval/language-policy';
import {
  buildFallbackNewsFactsFromSources,
  detectBriefingTopic,
  ensureFactDomainCoverage,
  renderNewsBriefingFromFacts,
  type BriefingTopic,
  type NewsBriefingFact,
  type NewsBriefingQualityProfile,
} from '../retrieval/news-briefing';
import { getResearchProfilePolicy } from '../retrieval/profile-policies';
import {
  extractEntitySubject,
  isNewsLikeResearchProfile,
  resolveResearchProfile,
  type ResearchProfile,
  type ResearchProfileDecision,
  type ResearchProfileFormatHint,
  type ResearchQualityMode,
} from '../retrieval/research-profile';
import { generateQueryRewriteCandidates } from '../retrieval/query-rewrite';
import { extractWorldModelCandidateFacts } from '../world-model/extraction';
import type { WorldModelExtraction } from '../world-model/schemas';

export type JarvisResearchArtifact = {
  title: string;
  query: string;
  summary: string;
  answerMarkdown: string;
  worldModelExtraction: WorldModelExtraction;
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
  researchProfile: ResearchProfile;
  profileReasons: string[];
  formatHint: ResearchProfileFormatHint;
  qualityMode: ResearchQualityMode;
};

export type ResearchStrictness = 'default' | 'news';

type GenerateResearchArtifactOptions = {
  strictness?: ResearchStrictness;
  intent?: string;
  taskType?: string;
  targetHint?: string;
  responseStyle?: 'concise' | 'balanced' | 'detailed' | null;
};

type ResearchAttemptOptions = {
  maxVariants: number;
  maxItems: number;
  profileDecision: ResearchProfileDecision;
  expandedCoverage?: boolean;
  responseStyle?: 'concise' | 'balanced' | 'detailed' | null;
};

type FreshnessStats = {
  ratio: number | null;
  recentCount: number;
  staleCount: number;
  unknownCount: number;
  bucket: 'fresh' | 'mixed' | 'stale' | 'unknown';
};

type ComparisonEntityStats = {
  entities: string[];
  mentionCounts: Array<{ entity: string; count: number }>;
  sideBalance: number | null;
  axes: Array<{
    axis: string;
    count: number;
    entityMentions: Array<{ entity: string; count: number }>;
    representativeEvidence?: string;
    representativeSourceTitle?: string;
  }>;
};

const COMPARISON_AXIS_DEFINITIONS = [
  {
    key: 'capabilities',
    koLabel: '모델 역량',
    enLabel: 'Model capabilities',
    pattern: /(reasoning|capability|feature|multimodal|benchmark|quality|context window|tool use|추론|역량|성능|기능|멀티모달|컨텍스트 윈도)/iu,
  },
  {
    key: 'developer_experience',
    koLabel: '개발자 경험',
    enLabel: 'Developer experience',
    pattern: /(api|sdk|documentation|docs|developer|migration|compatibility|tooling|integration|api reference|문서|개발자|호환|마이그레이션|툴링)/iu,
  },
  {
    key: 'pricing_access',
    koLabel: '가격·접근성',
    enLabel: 'Pricing and access',
    pattern: /(pricing|price|cost|tier|subscription|access|quota|rate limit|usage limit|가격|요금|비용|구독|접근|쿼터|요율 제한)/iu,
  },
  {
    key: 'enterprise_governance',
    koLabel: '엔터프라이즈·정책',
    enLabel: 'Enterprise and governance',
    pattern: /(enterprise|security|privacy|governance|admin|compliance|policy|guardrail|workspace|sso|보안|프라이버시|정책|컴플라이언스|관리|거버넌스|워크스페이스)/iu,
  },
  {
    key: 'ecosystem_delivery',
    koLabel: '생태계·배포',
    enLabel: 'Ecosystem and delivery',
    pattern: /(github|copilot|vertex|azure|aws|cloud|deployment|connector|plugin|cli|ecosystem|github actions|배포|클라우드|연동|플러그인|생태계|커넥터|cli)/iu,
  },
] as const;

export function inferResearchStrictness(query: string): ResearchStrictness {
  return /(뉴스|속보|전쟁|헤드라인|breaking|latest|news|headline|war)/iu.test(query) ? 'news' : 'default';
}

function mapResearchProfileToNewsQualityProfile(profile: ResearchProfile, query: string): NewsBriefingQualityProfile {
  if ((profile === 'broad_news' || profile === 'topic_news') && /(전쟁|war|conflict|안보|security|미사일|공습|attack|strike)/iu.test(query)) {
    return 'major_with_war';
  }
  if (profile === 'broad_news') return 'major';
  return 'standard';
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

function freshnessStats(sources: Array<{ publishedAt?: string }>): FreshnessStats {
  if (sources.length === 0) {
    return { ratio: null, recentCount: 0, staleCount: 0, unknownCount: 0, bucket: 'unknown' };
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
    bucket: ratio >= 0.7 ? 'fresh' : ratio >= 0.35 ? 'mixed' : recentCount === 0 && unknownCount === sources.length ? 'unknown' : 'stale',
  };
}

function topDomains(sources: Array<{ domain: string }>): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const domain = source.domain.trim().toLowerCase();
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }));
}

function topicDistribution(facts: NewsBriefingFact[]) {
  if (facts.length === 0) {
    return {
      topicCount: 0,
      nonSecurityTopicCount: 0,
      securityShare: 0,
      dominantTopic: null as BriefingTopic | null,
      dominantTopicShare: 0,
      distribution: [] as Array<{ topic: BriefingTopic; count: number }>,
    };
  }
  const counts = new Map<BriefingTopic, number>();
  for (const fact of facts) {
    const topic = detectBriefingTopic(`${fact.headline} ${fact.summary} ${fact.whyItMatters ?? ''}`);
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  const distribution = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([topic, count]) => ({ topic, count }));
  const dominant = distribution[0] ?? null;
  const securityCount = counts.get('security') ?? 0;
  return {
    topicCount: counts.size,
    nonSecurityTopicCount: distribution.filter((row) => row.topic !== 'security' && row.topic !== 'general').length,
    securityShare: Number((securityCount / facts.length).toFixed(3)),
    dominantTopic: dominant?.topic ?? null,
    dominantTopicShare: dominant ? Number((dominant.count / facts.length).toFixed(3)) : 0,
    distribution,
  };
}

function citationCoverage(claims: Array<{ sourceUrls: string[] }>) {
  if (claims.length === 0) {
    return { citationCoverage: 0, averageSourcesPerClaim: 0, supportedClaimCount: 0 };
  }
  const supportedClaimCount = claims.filter((claim) => claim.sourceUrls.length > 0).length;
  const totalSources = claims.reduce((sum, claim) => sum + claim.sourceUrls.length, 0);
  return {
    citationCoverage: Number((supportedClaimCount / claims.length).toFixed(3)),
    averageSourcesPerClaim: Number((totalSources / claims.length).toFixed(3)),
    supportedClaimCount,
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

function isOfficialDomain(domain: string): boolean {
  return /(\.gov\b|\.go\.kr\b|europa\.eu\b|sec\.gov\b|federalreserve\.gov\b|ecb\.europa\.eu\b|gov\.uk\b|who\.int\b|imf\.org\b|worldbank\.org\b)/iu.test(
    domain
  );
}

function buildEntitySubjectTokens(query: string): string[] {
  const subject = extractEntitySubject(query) ?? query;
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s.-]/gu, ' ')
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !['요약해줘', '정리해줘', '설명해줘', '브리프', 'official', 'company'].includes(token));
}

function isEntityOfficialSource(source: JarvisResearchArtifact['sources'][number], query: string): boolean {
  if (isOfficialDomain(source.domain)) {
    return true;
  }
  const entityTokens = buildEntitySubjectTokens(query);
  if (entityTokens.length === 0) {
    return false;
  }
  const haystack = `${source.domain} ${source.title} ${source.snippet ?? ''}`.toLowerCase();
  const mentionsEntity = entityTokens.some((token) => haystack.includes(token));
  if (!mentionsEntity) {
    return false;
  }
  return /(official|investor relations|newsroom|press release|company overview|공식|보도자료|뉴스룸|ir|investor)/iu.test(
    `${source.title} ${source.snippet ?? ''} ${source.url}`
  );
}

function isEntityOfficialUpdateSource(source: JarvisResearchArtifact['sources'][number], query: string): boolean {
  if (!isEntityOfficialSource(source, query)) {
    return false;
  }
  return /(newsroom|press release|announcement|launch|investor|earnings|quarterly|results|update|blog|news|보도자료|뉴스룸|실적|발표|공지|출시|업데이트|파트너십|capacity|expansion|roadmap)/iu.test(
    `${source.title} ${source.snippet ?? ''} ${source.url}`
  );
}

function isRepoDomain(domain: string): boolean {
  return /(github\.com|gitlab\.com|readthedocs\.io|docs\.[^/]+|npmjs\.com|pypi\.org|crates\.io)/iu.test(domain);
}

function sourcePolicyStats(
  sources: JarvisResearchArtifact['sources'],
  options?: { profile?: ResearchProfile; query?: string }
) {
  let officialSourceCount = 0;
  let repoSourceCount = 0;
  let mediaSourceCount = 0;
  let authoritySourceCount = 0;
  let authorityDomainCount = 0;
  let releaseLikeCount = 0;
  let issueLikeCount = 0;
  let effectiveDateSourceCount = 0;
  let docsLikeCount = 0;
  const authorityDomains = new Set<string>();

  for (const source of sources) {
    const text = `${source.title} ${source.snippet ?? ''}`.toLowerCase();
    const entityOfficial =
      options?.profile === 'entity_brief' && options.query ? isEntityOfficialSource(source, options.query) : false;
    if (isOfficialDomain(source.domain) || entityOfficial) {
      officialSourceCount += 1;
      authoritySourceCount += 1;
      authorityDomains.add(source.domain);
    } else if (/(reuters\.com|apnews\.com|bbc\.com|nytimes\.com|ft\.com|bloomberg\.com|wsj\.com|aljazeera\.com|yonhapnews\.co\.kr)/iu.test(source.domain)) {
      mediaSourceCount += 1;
      authoritySourceCount += 1;
      authorityDomains.add(source.domain);
    }
    if (isRepoDomain(source.domain)) {
      repoSourceCount += 1;
    }
    if (/(docs|readme|guide|manual|documentation)/iu.test(text)) {
      docsLikeCount += 1;
    }
    if (/(release|changelog|version|tag|배포|릴리즈|출시)/iu.test(text)) {
      releaseLikeCount += 1;
    }
    if (/(issue|pull request|bug|ticket|이슈|pr)/iu.test(text)) {
      issueLikeCount += 1;
    }
    if (extractEffectiveDateCandidatesForSource(source).length > 0) {
      effectiveDateSourceCount += 1;
    }
  }

  const officialSourceRatio = sources.length > 0 ? Number((officialSourceCount / sources.length).toFixed(3)) : 0;
  return {
    officialSourceCount,
    officialSourceRatio,
    repoSourceCount,
    mediaSourceCount,
    authoritySourceCount,
    authorityDomainCount: authorityDomains.size,
    releaseLikeCount,
    issueLikeCount,
    effectiveDateSourceCount,
    docsLikeCount,
  };
}

function extractComparisonEntities(query: string): string[] {
  const vsMatch = query.match(/(.+?)\s+\bvs\b\s+(.+)/iu);
  if (vsMatch?.[1] && vsMatch[2]) {
    return [vsMatch[1].trim(), vsMatch[2].trim()].filter(Boolean).slice(0, 2);
  }
  const compareMatch = query.match(/(.+?)와\s+(.+?)\s+(비교|차이|장단점)/u);
  if (compareMatch?.[1] && compareMatch[2]) {
    return [compareMatch[1].trim(), compareMatch[2].trim()].filter(Boolean).slice(0, 2);
  }
  return [];
}

function buildComparisonStats(query: string, sources: JarvisResearchArtifact['sources']): ComparisonEntityStats {
  const entities = extractComparisonEntities(query);
  if (entities.length < 2) {
    return { entities, mentionCounts: [], sideBalance: null, axes: [] };
  }
  const mentionCounts = entities.map((entity) => {
    const regex = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu');
    const count = sources.filter((source) => regex.test(`${source.title} ${source.snippet ?? ''}`)).length;
    return { entity, count };
  });
  const axes = COMPARISON_AXIS_DEFINITIONS.map((definition) => {
    const matchingSources = sources.filter((source) => definition.pattern.test(`${source.title} ${source.snippet ?? ''}`));
    const entityMentions = entities.map((entity) => {
      const entityRegex = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu');
      const count = matchingSources.filter((source) => entityRegex.test(`${source.title} ${source.snippet ?? ''}`)).length;
      return { entity, count };
    });
    return {
      axis: definition.key,
      count: matchingSources.length,
      entityMentions,
      representativeEvidence: matchingSources[0]?.snippet?.trim() || matchingSources[0]?.title?.trim() || undefined,
      representativeSourceTitle: matchingSources[0]?.title?.trim() || undefined,
    };
  }).filter((axis) => axis.count > 0);
  const total = mentionCounts.reduce((sum, row) => sum + row.count, 0);
  const sideBalance =
    total === 0 ? 0 : Number((Math.min(...mentionCounts.map((row) => row.count)) / Math.max(...mentionCounts.map((row) => row.count), 1)).toFixed(3));
  return { entities, mentionCounts, sideBalance, axes };
}

function countMajorPublisherSources(sources: JarvisResearchArtifact['sources']): number {
  return sources.filter((source) =>
    /(reuters\.com|apnews\.com|bbc\.com|nytimes\.com|ft\.com|bloomberg\.com|wsj\.com|aljazeera\.com|theguardian\.com|yonhapnews\.co\.kr|yna\.co\.kr)/iu.test(
      source.domain
    )
  ).length;
}

function countHighSignificanceBroadNewsSources(sources: JarvisResearchArtifact['sources']): number {
  return sources.filter((source) => {
    const text = `${source.title} ${source.snippet ?? ''}`;
    const topic = detectBriefingTopic(text);
    return (
      /(central bank|rate cut|rate hike|trade talks|summit|sanction|ceasefire|tariff|ai model|semiconductor|외교|정상회담|금리|관세|제재|휴전|반도체|인공지능 모델|무역 협상)/iu.test(
        text
      ) ||
      (/(reuters\.com|apnews\.com|bbc\.com|nytimes\.com|ft\.com|bloomberg\.com|wsj\.com|aljazeera\.com|theguardian\.com|yonhapnews\.co\.kr|yna\.co\.kr)/iu.test(
        source.domain
      ) &&
        topic !== 'general')
    );
  }).length;
}

function buildProfileDimensions(input: {
  profile: ResearchProfile;
  query: string;
  facts: NewsBriefingFact[];
  sources: JarvisResearchArtifact['sources'];
  conflicts: string[];
}) {
  const topicStats = topicDistribution(input.facts);
  const policyStats = sourcePolicyStats(input.sources, { profile: input.profile, query: input.query });
  const comparisonStats = buildComparisonStats(input.query, input.sources);
  if (input.profile === 'broad_news') {
    return {
      category_distribution: topicStats.distribution,
      non_security_topic_count: topicStats.nonSecurityTopicCount,
      security_share: topicStats.securityShare,
      major_publisher_count: countMajorPublisherSources(input.sources),
      high_significance_headline_count: countHighSignificanceBroadNewsSources(input.sources),
      top_domains: topDomains(input.sources),
    };
  }
  if (input.profile === 'topic_news') {
    return {
      timeline_ready: input.sources.filter((source) => Boolean(source.publishedAt)).length,
      conflict_topics: input.conflicts,
      top_domains: topDomains(input.sources),
    };
  }
  if (input.profile === 'entity_brief') {
    return {
      official_source_ratio: policyStats.officialSourceRatio,
      official_source_count: policyStats.officialSourceCount,
      media_source_count: policyStats.mediaSourceCount,
    };
  }
  if (input.profile === 'comparison_research') {
    return {
      comparison_entities: comparisonStats.entities,
      comparison_entity_mentions: comparisonStats.mentionCounts,
      side_balance: comparisonStats.sideBalance,
      comparison_axes: comparisonStats.axes.length,
      comparison_axis_labels: comparisonStats.axes.map((axis) => axis.axis),
      comparison_axis_breakdown: comparisonStats.axes,
    };
  }
  if (input.profile === 'repo_research') {
    return {
      repo_source_count: policyStats.repoSourceCount,
      docs_source_count: policyStats.docsLikeCount,
      release_source_count: policyStats.releaseLikeCount,
      issue_source_count: policyStats.issueLikeCount,
      repo_coverage_channels: [
        policyStats.repoSourceCount > 0,
        policyStats.docsLikeCount > 0,
        policyStats.releaseLikeCount > 0,
        policyStats.issueLikeCount > 0,
      ].filter(Boolean).length,
    };
  }
  if (input.profile === 'market_research') {
    const sectorSignalCount = input.sources.filter((source) =>
      /(ai|인공지능|infra|infrastructure|data center|데이터센터|gpu|반도체|semiconductor|hyperscaler|cloud|aws|azure|tsmc|nvidia|엔비디아|capex|capacity|demand|orders|packaging|foundry|server|compute|investment|수요|캐파|증설|첨단 패키징|파운드리|클라우드|서버)/iu.test(
        `${source.title} ${source.snippet ?? ''}`
      )
    ).length;
    const macroSignalCount = input.sources.filter((source) =>
      /(central bank|fed|ecb|inflation|yield|interest rate|rates|monetary policy|macro|거시|금리|인플레이션|중앙은행|통화정책|국채)/iu.test(
        `${source.title} ${source.snippet ?? ''}`
      )
    ).length;
    return {
      authority_source_count: policyStats.authoritySourceCount,
      authority_domain_count: policyStats.authorityDomainCount,
      official_source_count: policyStats.officialSourceCount,
      media_source_count: policyStats.mediaSourceCount,
      sector_signal_count: sectorSignalCount,
      macro_signal_count: macroSignalCount,
    };
  }
  return {
    official_source_count: policyStats.officialSourceCount,
    effective_date_source_count: policyStats.effectiveDateSourceCount,
    jurisdiction_signal_count: input.sources.filter((source) => /(eu|us|uk|korea|한국|europe|미국|영국|유럽|정부|위원회)/iu.test(`${source.title} ${source.snippet ?? ''}`)).length,
  };
}

function buildQualityEnvelope(input: {
  query: string;
  rewrittenQueries: string[];
  facts: NewsBriefingFact[];
  sources: JarvisResearchArtifact['sources'];
  claims: JarvisResearchArtifact['claims'];
  conflicts: string[];
  profileDecision: ResearchProfileDecision;
}) {
  const policy = getResearchProfilePolicy(input.profileDecision.profile);
  const freshness = freshnessStats(input.sources);
  const domains = topDomains(input.sources);
  const domainCount = new Set(input.sources.map((source) => source.domain)).size;
  const domainDiversityScore = input.sources.length === 0 ? 0 : Number((domainCount / input.sources.length).toFixed(3));
  const citation = citationCoverage(input.claims);
  const topics = topicDistribution(input.facts);
  const topDomainShare = input.sources.length === 0 || domains.length === 0 ? 0 : Number((domains[0]!.count / input.sources.length).toFixed(3));
  const policyStats = sourcePolicyStats(input.sources, { profile: input.profileDecision.profile, query: input.query });
  const comparisonStats = buildComparisonStats(input.query, input.sources);
  const majorPublisherCount = countMajorPublisherSources(input.sources);
  const highSignificanceHeadlineCount = countHighSignificanceBroadNewsSources(input.sources);
  const repoCoverageChannels = [
    policyStats.repoSourceCount > 0,
    policyStats.docsLikeCount > 0,
    policyStats.releaseLikeCount > 0,
    policyStats.issueLikeCount > 0,
  ].filter(Boolean).length;
  const profileDimensions = buildProfileDimensions({
    profile: input.profileDecision.profile,
    query: input.query,
    facts: input.facts,
    sources: input.sources,
    conflicts: input.conflicts,
  });
  const softWarnings: string[] = [];
  const softWarningCodes: string[] = [];
  const addWarning = (code: string, message: string) => {
    softWarningCodes.push(code);
    softWarnings.push(message);
  };

  if (input.sources.length < policy.minimumSourceCount) {
    addWarning('low_source_count', `source count is below the preferred minimum of ${policy.minimumSourceCount}`);
  }
  const shouldWarnLowDomainDiversity =
    domainCount < policy.minimumDomainCount &&
    !(
      input.profileDecision.profile === 'repo_research' &&
      repoCoverageChannels >= 3 &&
      policyStats.repoSourceCount >= 2
    );
  if (shouldWarnLowDomainDiversity) {
    addWarning('low_domain_diversity', 'domain diversity is low; results may depend on too few publishers');
  }
  if (citation.citationCoverage < 0.8) {
    addWarning('low_citation_coverage', 'citation coverage is below target; some claims have weak source support');
  }
  if (freshness.bucket === 'stale' && (policy.freshnessTarget === 'live' || policy.freshnessTarget === 'recent')) {
    addWarning('stale_news_freshness', 'source freshness is stale for the requested briefing type');
  }
  if (input.conflicts.length > 0) {
    addWarning('conflicting_summaries', 'conflicting summaries detected across retrieved sources');
  }

  if (input.profileDecision.profile === 'broad_news') {
    const strongMajorCoverage = majorPublisherCount >= 4 && highSignificanceHeadlineCount >= 3;
    const requiredTopicCount = strongMajorCoverage ? 2 : 3;
    const requiredNonSecurityTopicCount = strongMajorCoverage ? 1 : 2;
    if (majorPublisherCount < 2) addWarning('major_needs_more_publishers', 'major world news should rely on multiple major publishers');
    if (topics.topicCount < requiredTopicCount) addWarning('major_needs_broader_topics', 'major world news requests need broader topic coverage');
    if (topics.nonSecurityTopicCount < requiredNonSecurityTopicCount) addWarning('major_needs_non_security_categories', 'major world news should include at least two non-security categories');
    if (topDomainShare > 0.55) addWarning('publisher_concentration_major', 'publisher concentration is too high for a balanced major-news briefing');
    if (topics.securityShare > (strongMajorCoverage ? 0.72 : 0.6)) addWarning('security_overweight_major', 'major world news is too concentrated on security and conflict coverage');
    if (highSignificanceHeadlineCount < 2) addWarning('major_needs_broader_topics', 'major world news should elevate more globally significant headlines');
  }

  if (input.profileDecision.profile === 'topic_news' && topics.topicCount < 1) {
    addWarning('topic_news_needs_focus', 'topic news brief should preserve a clear event focus');
  }

  if (
    input.profileDecision.profile === 'entity_brief' &&
    policyStats.officialSourceCount < 2 &&
    policyStats.officialSourceRatio < 0.34
  ) {
    addWarning('entity_needs_more_official_sources', 'entity brief relies too heavily on media instead of official sources');
  }

  if (input.profileDecision.profile === 'comparison_research') {
    if ((comparisonStats.entities.length >= 2 && (comparisonStats.sideBalance ?? 0) < 0.4) || comparisonStats.entities.length < 2) {
      addWarning('comparison_side_imbalance', 'comparison evidence is too skewed toward one side');
    }
    if (comparisonStats.axes.length < 3) {
      addWarning('comparison_axes_thin', 'comparison brief should cover at least three comparison axes');
    }
  }

  if (input.profileDecision.profile === 'repo_research') {
    if (policyStats.repoSourceCount < 1) addWarning('repo_needs_repo_sources', 'repo research should include repository-native sources');
    if (policyStats.releaseLikeCount < 1) addWarning('repo_needs_release_signal', 'repo research should mention release or version activity');
    if (repoCoverageChannels < 3) addWarning('repo_needs_broader_repo_coverage', 'repo research should cover docs, releases, and maintenance signals together');
  }

  if (input.profileDecision.profile === 'market_research') {
    if (policyStats.authoritySourceCount < 2) addWarning('market_needs_authority_source', 'market research should include at least two authority-grade sources');
    if (policyStats.authorityDomainCount < 2) addWarning('market_needs_authority_diversity', 'market research should rely on more than one authority publisher or institution');
  }

  if (input.profileDecision.profile === 'policy_regulation') {
    if (policyStats.effectiveDateSourceCount < 1) addWarning('policy_needs_effective_date', 'policy research should surface an effective date or dated official notice');
  }

  const trustFailure =
    input.sources.length === 0 ||
    (input.claims.length > 0 && citation.citationCoverage < 0.34) ||
    (input.profileDecision.profile === 'topic_news' && freshness.bucket === 'stale');

  const qualityMode: ResearchQualityMode = trustFailure ? 'block' : softWarnings.length > 0 ? 'warn' : 'pass';

  return {
    query_rewrites: input.rewrittenQueries,
    research_profile: input.profileDecision.profile,
    profile_reasons: input.profileDecision.reasons,
    source_policy: input.profileDecision.sourcePolicy,
    format_hint: input.profileDecision.formatHint,
    quality_mode: qualityMode,
    quality_profile: mapResearchProfileToNewsQualityProfile(input.profileDecision.profile, input.query),
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
    topic_count: topics.topicCount,
    non_security_topic_count: topics.nonSecurityTopicCount,
    topic_distribution: topics.distribution,
    dominant_topic: topics.dominantTopic,
    dominant_topic_share: topics.dominantTopicShare,
    security_share: topics.securityShare,
    top_domain_share: topDomainShare,
    quality_gate_passed: qualityMode === 'pass',
    soft_warnings: softWarnings,
    soft_warning_codes: Array.from(new Set(softWarningCodes)),
    top_domains: domains,
    quality_dimensions: profileDimensions,
  };
}

function qualityGateFailureReason(quality: Record<string, unknown>): string {
  const warnings = Array.isArray(quality.soft_warnings)
    ? quality.soft_warnings.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return warnings.length > 0 ? warnings.slice(0, 2).join('; ') : 'grounded evidence did not meet the required quality gate';
}

function buildProfileExpansionQueries(query: string, profileDecision: ResearchProfileDecision): string[] {
  const normalized = query.trim();
  if (!normalized) return [];
  switch (profileDecision.profile) {
    case 'broad_news':
      return [
        `${normalized} 정치 정부 외교`,
        `${normalized} 경제 시장 금리`,
        `${normalized} 기술 인공지능 반도체`,
        `${normalized} world politics economy technology`,
        ...(/(전쟁|war|conflict|안보|security|미사일|공습|attack|strike)/iu.test(normalized)
          ? [`${normalized} 전쟁 안보 지정학`]
          : []),
      ];
    case 'topic_news':
      return [`${normalized} latest timeline`, `${normalized} source links`, `${normalized} 최근 변화`];
    case 'entity_brief':
      return [`${normalized} official site`, `${normalized} press release`, `${normalized} 위키 백과 공식 발표`];
    case 'comparison_research':
      return [
        `${normalized} compare differences`,
        `${normalized} official documentation`,
        `${normalized} pricing api enterprise comparison`,
        `${normalized} developer experience integration comparison`,
        `${normalized} 장단점 비교표`,
      ];
    case 'repo_research':
      return [`${normalized} GitHub README releases issues`, `${normalized} docs changelog`, `${normalized} 레포 README 릴리즈 이슈`];
    case 'market_research':
      return [`${normalized} Reuters Bloomberg FT`, `${normalized} official market release`, `${normalized} 시장 동향 공식 발표`];
    case 'policy_regulation':
      return [`${normalized} official notice`, `${normalized} law guidance`, `${normalized} 공식 정책 규제 공지`];
    default:
      return [];
  }
}

function buildResearchQueries(query: string, options: ResearchAttemptOptions): string[] {
  const base = generateQueryRewriteCandidates({
    prompt: query,
    maxVariants: options.maxVariants,
    profile: options.profileDecision.profile,
  });
  if (!options.expandedCoverage) {
    return base;
  }
  const expansion = buildProfileExpansionQueries(query, options.profileDecision);
  return Array.from(new Set([query.trim(), ...expansion, ...base].filter(Boolean))).slice(0, 8);
}

function sectionTitle(expectedLanguage: ResponseLanguage | null, ko: string, en: string): string {
  return expectedLanguage === 'en' ? en : ko;
}

function applyResearchResponseStyle(input: {
  markdown: string;
  responseStyle: GenerateResearchArtifactOptions['responseStyle'];
  expectedLanguage: ResponseLanguage | null;
  sources: JarvisResearchArtifact['sources'];
}): string {
  if (!input.responseStyle) {
    return input.markdown;
  }

  if (input.responseStyle === 'detailed') {
    const extraSources = renderSourceSummaryLines({
      sources: input.sources,
      expectedLanguage: input.expectedLanguage,
      limit: 3,
    });
    if (extraSources.length === 0) {
      return input.markdown;
    }
    const appendixHeading = sectionTitle(input.expectedLanguage, '#### 추가 근거', '#### Additional evidence');
    if (input.markdown.includes(appendixHeading)) {
      return input.markdown;
    }
    return `${input.markdown}\n\n${appendixHeading}\n${extraSources.join('\n')}`;
  }

  const lines = input.markdown.split('\n');
  const output: string[] = [];
  let currentSectionKind: 'body' | 'sources' = 'body';
  let bodyEntries = 0;
  let sourceEntries = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      output.push(line);
      currentSectionKind = 'body';
      bodyEntries = 0;
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      output.push(line);
      currentSectionKind = 'body';
      bodyEntries = 0;
      continue;
    }
    if (trimmed === 'Sources:') {
      output.push(line);
      currentSectionKind = 'sources';
      sourceEntries = 0;
      continue;
    }
    if (!trimmed) {
      if (output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }
    if (currentSectionKind === 'sources') {
      if (sourceEntries >= 2) {
        continue;
      }
      output.push(line);
      sourceEntries += 1;
      continue;
    }
    if (bodyEntries >= 2) {
      continue;
    }
    output.push(line);
    bodyEntries += 1;
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function comparisonAxisLabel(expectedLanguage: ResponseLanguage | null, axis: string): string {
  const definition = COMPARISON_AXIS_DEFINITIONS.find((row) => row.key === axis);
  if (!definition) {
    return axis;
  }
  return expectedLanguage === 'en' ? definition.enLabel : definition.koLabel;
}

function percentLabel(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : null;
}

function splitRenderedBriefing(markdown: string): { body: string[]; sources: string[] } {
  const lines = markdown.split('\n');
  const sourceIndex = lines.findIndex((line) => line.trim() === 'Sources:');
  if (sourceIndex === -1) {
    return { body: lines.slice(1).filter(Boolean), sources: [] };
  }
  return {
    body: lines.slice(1, sourceIndex).filter(Boolean),
    sources: lines.slice(sourceIndex).filter(Boolean),
  };
}

function normalizeReferenceUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

const NAMED_MONTH_MAP: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  sept: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

const ISO_DATE_PATTERN = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/giu;
const KOREAN_DATE_PATTERN = /\b(20\d{2})\s*년\s*(0?[1-9]|1[0-2])\s*월\s*(0?[1-9]|[12]\d|3[01])\s*일\b/giu;
const MONTH_NAME_DATE_PATTERN =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(0?[1-9]|[12]\d|3[01]),?\s+(20\d{2})\b/giu;
const DAY_MONTH_NAME_DATE_PATTERN =
  /\b(0?[1-9]|[12]\d|3[01])\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?,?\s+(20\d{2})\b/giu;
const POLICY_EFFECTIVE_SIGNAL_PATTERN =
  /(entry into force|enters into force|entered into force|effective(?:ly)?|effective date|takes effect|applies from|apply from|applicable from|starts applying|start applying|시행|발효|적용(?:일| 시점| 예정)?|효력)\b/iu;

function zeroPadDatePart(value: string): string {
  return value.padStart(2, '0');
}

function pushUniqueDate(target: string[], date: string | null) {
  if (!date || target.includes(date)) {
    return;
  }
  target.push(date);
}

function normalizeExtractedDateParts(year: string, month: string, day: string): string | null {
  const y = year.trim();
  const m = zeroPadDatePart(month.trim());
  const d = zeroPadDatePart(day.trim());
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) {
    return null;
  }
  const parsed = Date.parse(`${y}-${m}-${d}T00:00:00Z`);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

function extractDateCandidatesFromText(value: string): string[] {
  const dates: string[] = [];
  for (const match of value.matchAll(ISO_DATE_PATTERN)) {
    pushUniqueDate(dates, normalizeExtractedDateParts(match[1] ?? '', match[2] ?? '', match[3] ?? ''));
  }
  for (const match of value.matchAll(KOREAN_DATE_PATTERN)) {
    pushUniqueDate(dates, normalizeExtractedDateParts(match[1] ?? '', match[2] ?? '', match[3] ?? ''));
  }
  for (const match of value.matchAll(MONTH_NAME_DATE_PATTERN)) {
    const monthKey = (match[1] ?? '').toLowerCase();
    pushUniqueDate(dates, normalizeExtractedDateParts(match[3] ?? '', NAMED_MONTH_MAP[monthKey] ?? '', match[2] ?? ''));
  }
  for (const match of value.matchAll(DAY_MONTH_NAME_DATE_PATTERN)) {
    const monthKey = (match[2] ?? '').toLowerCase();
    pushUniqueDate(dates, normalizeExtractedDateParts(match[3] ?? '', NAMED_MONTH_MAP[monthKey] ?? '', match[1] ?? ''));
  }
  return dates;
}

function extractPolicyEffectiveDateFromText(value: string): string | null {
  if (!POLICY_EFFECTIVE_SIGNAL_PATTERN.test(value)) {
    return null;
  }
  const dates = extractDateCandidatesFromText(value);
  return dates[0] ?? null;
}

function extractEffectiveDateCandidatesForSource(source: JarvisResearchArtifact['sources'][number]): string[] {
  const text = `${source.title} ${source.snippet ?? ''}`.trim();
  const dates: string[] = [];
  pushUniqueDate(dates, extractPolicyEffectiveDateFromText(text));
  for (const candidate of extractDateCandidatesFromText(text).slice(0, 2)) {
    pushUniqueDate(dates, candidate);
  }
  if (source.publishedAt) {
    const parsed = Date.parse(source.publishedAt);
    if (Number.isFinite(parsed)) {
      pushUniqueDate(dates, new Date(parsed).toISOString().slice(0, 10));
    }
  }
  return dates;
}

function collectPolicyTimelineEntries(
  sources: JarvisResearchArtifact['sources'],
  expectedLanguage: ResponseLanguage | null
): string[] {
  const entries: Array<{ date: string; title: string; url: string }> = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const date of extractEffectiveDateCandidatesForSource(source).slice(0, 3)) {
      const key = `${date}::${source.title}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        date,
        title: source.title,
        url: source.url,
      });
    }
  }
  entries.sort((left, right) => left.date.localeCompare(right.date));
  const sourceLabel = expectedLanguage === 'en' ? 'source' : '출처';
  return entries.slice(0, 5).map((entry) => `- **${entry.date}**: ${entry.title} ([${sourceLabel}](${entry.url}))`);
}

function buildResearchSourceLookup(sources: JarvisResearchArtifact['sources']) {
  const byUrl = new Map<string, JarvisResearchArtifact['sources'][number]>();
  for (const source of sources) {
    const normalized = normalizeReferenceUrl(source.url);
    if (normalized && !byUrl.has(normalized)) {
      byUrl.set(normalized, source);
    }
  }
  return byUrl;
}

function sourceLinkLabel(expectedLanguage: ResponseLanguage | null, index: number): string {
  return expectedLanguage === 'en' ? `source ${index}` : `출처 ${index}`;
}

function renderInlineSourceLinks(
  urls: string[],
  expectedLanguage: ResponseLanguage | null,
  limit = 2
): string {
  const entries = urls
    .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    .slice(0, limit)
    .map((url, index) => `[${sourceLinkLabel(expectedLanguage, index + 1)}](${url})`);
  return entries.join(', ');
}

function inferFactReferenceDate(
  fact: NewsBriefingFact,
  sourceLookup: Map<string, JarvisResearchArtifact['sources'][number]>
): string | null {
  for (const rawUrl of fact.sourceUrls) {
    const url = normalizeReferenceUrl(rawUrl);
    if (!url) continue;
    const source = sourceLookup.get(url);
    if (!source) continue;
    const candidates = extractEffectiveDateCandidatesForSource(source);
    if (candidates.length > 0) {
      return candidates[0]!;
    }
  }
  if (fact.eventDate?.trim()) {
    return fact.eventDate.trim();
  }
  return null;
}

function renderFactSummaryLines(input: {
  facts: NewsBriefingFact[];
  expectedLanguage: ResponseLanguage | null;
  kind: 'summary' | 'impact';
  limit?: number;
}): string[] {
  const limit = input.limit ?? 3;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const fact of input.facts) {
    const content = input.kind === 'impact' ? fact.whyItMatters?.trim() ?? '' : fact.summary.trim();
    if (!content) continue;
    const dedupeKey = `${fact.headline}::${content}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const links = renderInlineSourceLinks(fact.sourceUrls, input.expectedLanguage);
    lines.push(
      input.kind === 'impact'
        ? `- **${fact.headline}**: ${content}${links ? ` (${links})` : ''}`
        : `- **${fact.headline}**: ${content}${links ? ` (${links})` : ''}`
    );
    if (lines.length >= limit) break;
  }
  return lines;
}

function isGenericFallbackLine(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  return (
    /새 업데이트가 확인됐습니다/u.test(text) ||
    /세부 내용은 원문 확인이 필요합니다/u.test(text) ||
    /분야 간 파급 가능성이 있어 후속 동향 확인이 필요합니다/u.test(text) ||
    /authority-grade coverage/iu.test(text) ||
    /official .* (company|organizational|entity) overview/iu.test(text) ||
    /official .* (newsroom|documentation|investor relations)/iu.test(text) ||
    /official .* (overview|links)\./iu.test(text) ||
    /new updates? (were|was) identified/iu.test(text) ||
    /details require source review/iu.test(text) ||
    /follow-up monitoring is needed/iu.test(text)
  );
}

function renderSourceSnippetLines(input: {
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
  limit?: number;
  pattern?: RegExp;
}): string[] {
  const lines: string[] = [];
  const limit = input.limit ?? 3;
  for (const source of dedupeSourcesByUrl(input.sources)) {
    const blob = `${source.title} ${source.snippet ?? ''} ${source.url}`;
    if (input.pattern && !input.pattern.test(blob)) {
      continue;
    }
    const snippet = source.snippet?.trim();
    if (!snippet || snippet.length < 16) {
      continue;
    }
    if (isGenericFallbackLine(`${source.title}: ${snippet}`)) {
      continue;
    }
    const sourceLabel = input.expectedLanguage === 'en' ? 'Source' : '출처';
    lines.push(`- **${source.title}**: ${truncateText(snippet, 180)} ([${sourceLabel}](${source.url}))`);
    if (lines.length >= limit) {
      break;
    }
  }
  return lines;
}

function preferSourceSnippetLines(primary: string[], fallback: string[]): string[] {
  const meaningfulPrimary = primary.filter((line) => !isGenericFallbackLine(line));
  if (meaningfulPrimary.length > 0) {
    return meaningfulPrimary;
  }
  const meaningfulFallback = fallback.filter((line) => !isGenericFallbackLine(line));
  if (meaningfulFallback.length > 0) {
    return meaningfulFallback;
  }
  return [];
}

function selectFactsByPattern(facts: NewsBriefingFact[], pattern: RegExp): NewsBriefingFact[] {
  return facts.filter((fact) => pattern.test(`${fact.headline} ${fact.summary} ${fact.whyItMatters ?? ''}`));
}

function isDocsLikeRepoSource(source: JarvisResearchArtifact['sources'][number]): boolean {
  const text = `${source.title} ${source.snippet ?? ''} ${source.url}`.toLowerCase();
  return /(docs|readme|guide|manual|documentation|get started|getting started|installation|install|quickstart)/iu.test(text);
}

function isReleaseLikeRepoSource(source: JarvisResearchArtifact['sources'][number]): boolean {
  const text = `${source.title} ${source.snippet ?? ''} ${source.url}`.toLowerCase();
  return /(release|releases|changelog|version|tag|what's new|whats new|배포|릴리즈|출시)/iu.test(text);
}

function isIssueLikeRepoSource(source: JarvisResearchArtifact['sources'][number]): boolean {
  const text = `${source.title} ${source.snippet ?? ''} ${source.url}`.toLowerCase();
  return /(issue|issues|pull request|pull requests|\bpr\b|bug|ticket|maintenance|roadmap|discussion|이슈)/iu.test(text);
}

function dedupeSourcesByUrl(sources: JarvisResearchArtifact['sources']): JarvisResearchArtifact['sources'] {
  const seen = new Set<string>();
  const deduped: JarvisResearchArtifact['sources'] = [];
  for (const source of sources) {
    const key = normalizeReferenceUrl(source.url) ?? source.url;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

function renderSourceSummaryLines(input: {
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
  limit?: number;
}): string[] {
  const lines: string[] = [];
  const limit = input.limit ?? 3;
  for (const source of dedupeSourcesByUrl(input.sources).slice(0, limit)) {
    const snippet = source.snippet?.trim();
    const sourceLabel = input.expectedLanguage === 'en' ? 'Source' : '출처';
    const summary = snippet && !isGenericFallbackLine(`${source.title}: ${snippet}`) ? ` — ${snippet}` : '';
    lines.push(`- **${source.title}** ([${sourceLabel}](${source.url}))${summary}`);
  }
  return lines;
}

function deriveEntityCoverageLines(input: {
  query: string;
  subject: string;
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  const sourceText = input.sources.map((source) => `${source.title} ${source.snippet ?? ''} ${source.url}`).join(' ');
  const officialCount = input.sources.filter((source) => isEntityOfficialSource(source, input.query)).length;
  const newsroomCount = input.sources.filter((source) => /(newsroom|press release|announcement|뉴스룸|보도자료)/iu.test(`${source.title} ${source.snippet ?? ''} ${source.url}`)).length;
  const investorCount = input.sources.filter((source) => /(investor|earnings|\bir\b|quarterly|실적|투자자|ir)/iu.test(`${source.title} ${source.snippet ?? ''} ${source.url}`)).length;
  const mediaCount = input.sources.filter((source) => /(reuters\.com|bbc\.com|ft\.com|bloomberg\.com|wsj\.com|nytimes\.com|apnews\.com|theguardian\.com|yonhapnews\.co\.kr|yna\.co\.kr)/iu.test(source.domain)).length;
  const lines: string[] = [];

  if (officialCount > 0 || newsroomCount > 0 || investorCount > 0) {
    lines.push(
      input.expectedLanguage === 'en'
        ? `- **${input.subject}** is currently best understood through official materials${newsroomCount > 0 ? ', newsroom updates' : ''}${investorCount > 0 ? ', and investor disclosures' : ''}.`
        : `- **${input.subject}**은 현재 공식 자료${newsroomCount > 0 ? ', 뉴스룸 공지' : ''}${investorCount > 0 ? ', IR·실적 자료' : ''}를 중심으로 읽는 것이 가장 정확합니다.`
    );
  }
  if (mediaCount > 0) {
    if (/(demand|orders|adoption|수요|주문|도입)/iu.test(sourceText)) {
      lines.push(
        input.expectedLanguage === 'en'
          ? `- External coverage is concentrated on demand, adoption, and customer pull rather than pure corporate background.`
          : `- 외부 보도는 단순 회사 소개보다 수요, 도입, 고객 반응 같은 실질 시그널에 더 집중돼 있습니다.`
      );
    } else if (/(capacity|expansion|investment|공급망|캐파|확장|투자)/iu.test(sourceText)) {
      lines.push(
        input.expectedLanguage === 'en'
          ? `- Media coverage is emphasizing capacity, expansion, and investment signals around the entity.`
          : `- 언론 보도는 이 대상의 증설, 캐파, 투자 움직임을 중심으로 읽히고 있습니다.`
      );
    }
  }
  return lines.slice(0, 2);
}

const MARKET_QUANT_SIGNAL_PATTERN =
  /(\$ ?\d+(?:\.\d+)?\s?(?:billion|million|bn|mn)|\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s?(?:bp|bps|basis points)|\d+(?:\.\d+)?\s?(?:x|배|조 원|억원|달러))/iu;

function extractMarketQuantitativeSignalLines(input: {
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  const lines: string[] = [];
  for (const source of dedupeSourcesByUrl(input.sources)) {
    const text = `${source.title} ${source.snippet ?? ''}`.trim();
    if (!/(capex|spending|investment|rate|yield|inflation|revenue|growth|orders|demand|capacity|시장|수요|투자|지출|금리|수익|성장|주문|캐파)/iu.test(text)) {
      continue;
    }
    const quantMatch = text.match(MARKET_QUANT_SIGNAL_PATTERN);
    const sourceLabel = input.expectedLanguage === 'en' ? 'Source' : '출처';
    if (quantMatch?.[1]) {
      lines.push(`- **${source.title}**: ${quantMatch[1]} (${sourceLabel}: [link](${source.url}))`);
    } else if (/(capex|investment|spending|투자|지출)/iu.test(text)) {
      lines.push(
        input.expectedLanguage === 'en'
          ? `- **${source.title}**: capital spending and investment posture are explicitly discussed ([${sourceLabel.toLowerCase()}](${source.url}))`
          : `- **${source.title}**: 자본지출과 투자 기조가 직접 언급됩니다. ([${sourceLabel}](${source.url}))`
      );
    } else if (/(demand|orders|adoption|수요|주문|도입)/iu.test(text)) {
      lines.push(
        input.expectedLanguage === 'en'
          ? `- **${source.title}**: demand and adoption signals are explicit in the source ([${sourceLabel.toLowerCase()}](${source.url}))`
          : `- **${source.title}**: 수요와 도입 신호가 직접 드러납니다. ([${sourceLabel}](${source.url}))`
      );
    }
    if (lines.length >= 2) {
      break;
    }
  }
  return lines;
}

function extractLineKey(line: string): string {
  const match = line.match(/\*\*([^*]+)\*\*/u);
  return (match?.[1] ?? line).trim().toLowerCase();
}

function mergeDistinctLines(primary: string[], secondary: string[], limit: number): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const line of [...primary, ...secondary]) {
    const key = extractLineKey(line);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(line);
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}

function renderRepoResearchSections(input: {
  facts: NewsBriefingFact[];
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  const docsSources = input.sources.filter((source) => isDocsLikeRepoSource(source));
  const releaseSources = input.sources.filter((source) => isReleaseLikeRepoSource(source));
  const issueSources = input.sources.filter((source) => isIssueLikeRepoSource(source));
  const overviewFacts = renderFactSummaryLines({
    facts: input.facts,
    expectedLanguage: input.expectedLanguage,
    kind: 'summary',
    limit: 3,
  });
  const sections: string[] = [];

  if (docsSources.length > 0) {
    sections.push(
      sectionTitle(input.expectedLanguage, '#### README·문서', '#### README and docs'),
      ...renderSourceSummaryLines({ sources: docsSources, expectedLanguage: input.expectedLanguage, limit: 2 }),
      ''
    );
  }
  if (releaseSources.length > 0) {
    sections.push(
      sectionTitle(input.expectedLanguage, '#### 릴리즈·변경 이력', '#### Releases and changelog'),
      ...renderSourceSummaryLines({ sources: releaseSources, expectedLanguage: input.expectedLanguage, limit: 2 }),
      ''
    );
  }
  if (issueSources.length > 0) {
    sections.push(
      sectionTitle(input.expectedLanguage, '#### 이슈·유지보수', '#### Issues and maintenance'),
      ...renderSourceSummaryLines({ sources: issueSources, expectedLanguage: input.expectedLanguage, limit: 2 }),
      ''
    );
  }
  sections.push(
    sectionTitle(input.expectedLanguage, '#### 핵심 프로젝트 신호', '#### Core project signals'),
    ...(overviewFacts.length > 0
      ? overviewFacts
      : [sectionTitle(input.expectedLanguage, '- 대표 신호가 아직 충분하지 않습니다.', '- Project signals are still sparse.')])
  );

  return sections;
}

function renderEntityBriefSections(input: {
  query: string;
  facts: NewsBriefingFact[];
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  const officialSources = input.sources.filter((source) => isOfficialDomain(source.domain) || isEntityOfficialSource(source, input.query));
  const officialUpdateSources = input.sources.filter((source) => isEntityOfficialUpdateSource(source, input.query));
  const subject = extractEntitySubject(input.query) ?? input.query.trim();
  const roleLines = deriveEntityCoverageLines({
    query: input.query,
    subject,
    sources: input.sources,
    expectedLanguage: input.expectedLanguage,
  });
  const overviewLines = preferSourceSnippetLines(
    renderFactSummaryLines({
      facts: input.facts,
      expectedLanguage: input.expectedLanguage,
      kind: 'summary',
      limit: 2,
    }),
    renderSourceSnippetLines({
      sources: officialSources.length > 0 ? officialSources : input.sources,
      expectedLanguage: input.expectedLanguage,
      limit: 2,
    })
  );
  const latestMoveLines = preferSourceSnippetLines(
    renderFactSummaryLines({
      facts: input.facts,
      expectedLanguage: input.expectedLanguage,
      kind: 'impact',
      limit: 2,
    }),
    renderSourceSnippetLines({
      sources: officialUpdateSources.length > 0 ? officialUpdateSources : input.sources,
      expectedLanguage: input.expectedLanguage,
      limit: 2,
      pattern: /(launch|release|expand|capacity|investment|partnership|demand|adoption|earnings|roadmap|뉴스룸|newsroom|investor|실적|수요|투자|제휴|출시|확장)/iu,
    })
  );
  const changeLines = preferSourceSnippetLines(
    renderFactSummaryLines({
      facts: selectFactsByPattern(
        input.facts,
        /(launch|release|expand|capacity|investment|partnership|demand|adoption|earnings|roadmap|출시|확장|투자|수요|실적|제휴|도입)/iu
      ),
      expectedLanguage: input.expectedLanguage,
      kind: 'summary',
      limit: 2,
    }),
    renderSourceSnippetLines({
      sources: officialUpdateSources.length > 0 ? officialUpdateSources : input.sources,
      expectedLanguage: input.expectedLanguage,
      limit: 2,
      pattern: /(launch|release|expand|capacity|investment|partnership|demand|adoption|earnings|roadmap|출시|확장|투자|수요|실적|제휴|도입)/iu,
    })
  );
  const combined = `${input.facts.map((fact) => `${fact.headline} ${fact.summary} ${fact.whyItMatters ?? ''}`).join(' ')} ${input.sources
    .map((source) => `${source.title} ${source.snippet ?? ''}`)
    .join(' ')}`.toLowerCase();
  const riskLines: string[] = [];
  if (/(regulation|policy|export control|compliance|antitrust|규제|정책|수출 통제|반독점|컴플라이언스)/iu.test(combined)) {
    riskLines.push(
      input.expectedLanguage === 'en'
        ? '- Regulation and compliance shifts remain a key watchpoint for the entity.'
        : '- 규제와 컴플라이언스 변화가 이 대상의 핵심 관찰 포인트로 남아 있습니다.'
    );
  }
  if (/(supply|capacity|lead time|constraint|shortage|yield|공급망|캐파|납기|제약|수율)/iu.test(combined)) {
    riskLines.push(
      input.expectedLanguage === 'en'
        ? '- Supply, capacity, or delivery constraints could affect execution quality.'
        : '- 공급망, 생산 캐파, 납기 제약이 실제 실행력에 영향을 줄 수 있습니다.'
    );
  }
  if (/(demand|orders|enterprise|competition|pricing|수요|주문|경쟁|가격|엔터프라이즈)/iu.test(combined)) {
    riskLines.push(
      input.expectedLanguage === 'en'
        ? '- Demand momentum and competitive pricing should be checked in the next update cycle.'
        : '- 수요 모멘텀과 경쟁 환경, 가격 변화는 다음 업데이트에서 다시 확인해야 합니다.'
    );
  }
  const checkpointLines: string[] = [];
  if (input.sources.some((source) => /(investor|earnings|ir|실적|투자자)/iu.test(`${source.title} ${source.snippet ?? ''}`))) {
    checkpointLines.push(
      input.expectedLanguage === 'en'
        ? '- Next checkpoint: investor-relations and earnings updates.'
        : '- 다음 체크포인트: IR 자료와 실적 업데이트.'
    );
  }
  if (input.sources.some((source) => /(newsroom|press release|announcement|launch|보도자료|뉴스룸|출시)/iu.test(`${source.title} ${source.snippet ?? ''}`))) {
    checkpointLines.push(
      input.expectedLanguage === 'en'
        ? '- Next checkpoint: official newsroom and launch announcements.'
        : '- 다음 체크포인트: 공식 뉴스룸과 제품 발표 공지.'
    );
  }
  return [
    sectionTitle(input.expectedLanguage, '#### 대상 스냅샷', '#### Entity snapshot'),
    ...(overviewLines.length > 0
      ? overviewLines
      : roleLines.length > 0
        ? roleLines
        : [sectionTitle(input.expectedLanguage, '- 대상 개요를 구성할 신호가 아직 충분하지 않습니다.', '- The entity overview is still sparse.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 최근 움직임', '#### Recent moves'),
    ...(latestMoveLines.length > 0
      ? latestMoveLines
      : [sectionTitle(input.expectedLanguage, '- 최근 움직임을 요약할 신호가 아직 제한적입니다.', '- Recent moves are still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 핵심 변화', '#### Core changes'),
    ...(changeLines.length > 0
      ? changeLines
      : [sectionTitle(input.expectedLanguage, '- 핵심 변화를 압축할 신호가 아직 충분하지 않습니다.', '- Core-change signals are still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 리스크·체크포인트', '#### Risks and checkpoints'),
    ...((riskLines.length > 0 || checkpointLines.length > 0)
      ? [...riskLines.slice(0, 2), ...checkpointLines.slice(0, 2)]
      : [sectionTitle(input.expectedLanguage, '- 다음 점검 포인트가 아직 충분히 드러나지 않았습니다.', '- Follow-up checkpoints are still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 근거 구성', '#### Evidence mix'),
    ...(officialSources.length > 0
      ? renderSourceSummaryLines({ sources: officialSources, expectedLanguage: input.expectedLanguage, limit: 2 })
      : renderSourceSummaryLines({ sources: input.sources, expectedLanguage: input.expectedLanguage, limit: 2 })),
  ];
}

function renderComparisonResearchSections(input: {
  facts: NewsBriefingFact[];
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
  quality: Record<string, unknown>;
}): string[] {
  const dimensions =
    input.quality.quality_dimensions && typeof input.quality.quality_dimensions === 'object' && !Array.isArray(input.quality.quality_dimensions)
      ? (input.quality.quality_dimensions as Record<string, unknown>)
      : null;
  const entities = Array.isArray(dimensions?.comparison_entities)
    ? dimensions?.comparison_entities.filter((row): row is string => typeof row === 'string').join(' vs ')
    : '';
  const axisLabels = Array.isArray(dimensions?.comparison_axis_labels)
    ? dimensions?.comparison_axis_labels
        .filter((row): row is string => typeof row === 'string')
        .slice(0, 4)
        .map((axis) => comparisonAxisLabel(input.expectedLanguage, axis))
    : [];
  const axisBreakdown = Array.isArray(dimensions?.comparison_axis_breakdown)
    ? dimensions.comparison_axis_breakdown
        .filter(
          (
            row
          ): row is {
            axis: string;
            count: number;
            entityMentions?: Array<{ entity: string; count: number }>;
            representativeEvidence?: string;
            representativeSourceTitle?: string;
          } =>
            Boolean(row) &&
            typeof row === 'object' &&
            typeof (row as Record<string, unknown>).axis === 'string' &&
            typeof (row as Record<string, unknown>).count === 'number'
        )
        .slice(0, 4)
    : [];
  const differenceLines = renderFactSummaryLines({
    facts: input.facts,
    expectedLanguage: input.expectedLanguage,
    kind: 'summary',
    limit: 3,
  });

  return [
    sectionTitle(input.expectedLanguage, '#### 비교 대상', '#### Compared entities'),
    entities
      ? `- ${entities}`
      : sectionTitle(input.expectedLanguage, '- 비교 대상이 아직 선명하지 않습니다.', '- Compared entities are still unclear.'),
    '',
    sectionTitle(input.expectedLanguage, '#### 핵심 비교축', '#### Comparison axes'),
    ...(axisLabels.length > 0
      ? axisLabels.map((label) => `- ${label}`)
      : [sectionTitle(input.expectedLanguage, '- 비교축 신호가 아직 충분하지 않습니다.', '- Comparison-axis signals are still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 축별 근거', '#### Axis evidence'),
    ...(axisBreakdown.length > 0
      ? axisBreakdown.map((row) => {
          const mentions = Array.isArray(row.entityMentions)
            ? row.entityMentions
                .filter((entry) => entry && typeof entry.entity === 'string' && typeof entry.count === 'number')
                .filter((entry) => entry.count > 0)
                .map((entry) => `${entry.entity} ${entry.count}`)
                .join(', ')
            : '';
          const detail = mentions
            ? `${sectionTitle(input.expectedLanguage, '근거 분포', 'Evidence split')}: ${mentions}`
            : `${sectionTitle(input.expectedLanguage, '근거 수', 'Evidence count')}: ${row.count}`;
          const evidence = typeof row.representativeEvidence === 'string' && row.representativeEvidence.trim()
            ? row.representativeEvidence.trim()
            : null;
          const sourceTitle =
            typeof row.representativeSourceTitle === 'string' && row.representativeSourceTitle.trim()
              ? row.representativeSourceTitle.trim()
              : null;
          const example = evidence
            ? `${sectionTitle(input.expectedLanguage, '대표 근거', 'Representative evidence')}: ${evidence}${sourceTitle ? ` — ${sourceTitle}` : ''}`
            : null;
          return `- **${comparisonAxisLabel(input.expectedLanguage, row.axis)}**: ${detail}${example ? ` / ${example}` : ''}`;
        })
      : [sectionTitle(input.expectedLanguage, '- 축별 근거를 분해할 신호가 아직 충분하지 않습니다.', '- Axis-level evidence is still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 차이 요약', '#### Difference summary'),
    ...(differenceLines.length > 0
      ? differenceLines
      : [sectionTitle(input.expectedLanguage, '- 차이 요약을 만들 신호가 아직 부족합니다.', '- Difference-summary signals are still limited.')]),
  ];
}

function deriveMarketRiskLines(input: {
  facts: NewsBriefingFact[];
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  const combined = `${input.facts.map((fact) => `${fact.headline} ${fact.summary} ${fact.whyItMatters ?? ''}`).join(' ')} ${input.sources
    .map((source) => `${source.title} ${source.snippet ?? ''}`)
    .join(' ')}`.toLowerCase();
  const lines: string[] = [];
  if (/(rate|inflation|yield|central bank|fed|ecb|금리|인플레이션|통화정책|수익률)/iu.test(combined)) {
    lines.push(
      input.expectedLanguage === 'en'
        ? '- Monetary policy and rate expectations can quickly change valuation and demand assumptions.'
        : '- 통화정책과 금리 기대가 바뀌면 밸류에이션과 수요 가정이 빠르게 흔들릴 수 있습니다.'
    );
  }
  if (/(supply|capacity|constraint|shortage|semiconductor|gpu|memory|supply chain|공급망|캐파|용량|부족)/iu.test(combined)) {
    lines.push(
      input.expectedLanguage === 'en'
        ? '- Supply-chain and capacity constraints remain a watchpoint for actual delivery and lead times.'
        : '- 공급망과 생산 캐파 제약이 실제 납기와 출하 속도를 좌우하는 관찰 포인트로 남아 있습니다.'
    );
  }
  if (/(regulation|policy|export control|tariff|sanction|규제|정책|관세|제재|수출 통제)/iu.test(combined)) {
    lines.push(
      input.expectedLanguage === 'en'
        ? '- Policy and export-control changes can alter spending plans and vendor choice faster than demand headlines suggest.'
        : '- 규제와 수출 통제 변화가 수요 기사보다 더 빠르게 투자 계획과 벤더 선택을 바꿀 수 있습니다.'
    );
  }
  return lines.slice(0, 3);
}

function isSectorSpecificMarketPrompt(query: string): boolean {
  return /(ai|인공지능|infra|infrastructure|데이터센터|data center|gpu|반도체|semiconductor|hyperscaler|cloud|aws|azure|tsmc|nvidia|엔비디아|아마존|마이크로소프트)/iu.test(
    query
  );
}

function extractMacroMarketIndicatorLines(input: {
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  return renderSourceSnippetLines({
    sources: input.sources,
    expectedLanguage: input.expectedLanguage,
    limit: 2,
    pattern: /(central bank|fed|ecb|inflation|yield|interest rate|rates|monetary policy|macro|거시|금리|인플레이션|중앙은행|통화정책|국채)/iu,
  });
}

function extractSectorMarketIndicatorLines(input: {
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  return renderSourceSnippetLines({
    sources: input.sources,
    expectedLanguage: input.expectedLanguage,
    limit: 2,
    pattern: /(ai|인공지능|infra|infrastructure|data center|데이터센터|gpu|반도체|semiconductor|hyperscaler|cloud|aws|azure|tsmc|nvidia|엔비디아|capex|capacity|demand|orders|packaging|foundry|server|compute|investment|수요|캐파|증설|첨단 패키징|파운드리|클라우드|서버)/iu,
  });
}

function renderMarketResearchSections(input: {
  query: string;
  facts: NewsBriefingFact[];
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  const sectorSpecific = isSectorSpecificMarketPrompt(input.query);
  const quantitativeLines = extractMarketQuantitativeSignalLines({
    sources: input.sources,
    expectedLanguage: input.expectedLanguage,
  });
  const macroIndicatorLines = extractMacroMarketIndicatorLines({
    sources: input.sources,
    expectedLanguage: input.expectedLanguage,
  });
  const sectorIndicatorLines = extractSectorMarketIndicatorLines({
    sources: input.sources,
    expectedLanguage: input.expectedLanguage,
  });
  const metricLines = preferSourceSnippetLines(
    renderFactSummaryLines({
      facts: selectFactsByPattern(
        input.facts,
        /(price|pricing|valuation|capex|spending|revenue|growth|orders|demand|investment|금리|가격|밸류에이션|투자|지출|수익|성장|주문|수요)/iu
      ),
      expectedLanguage: input.expectedLanguage,
      kind: 'summary',
      limit: 2,
    }),
    renderSourceSnippetLines({
      sources: input.sources,
      expectedLanguage: input.expectedLanguage,
      limit: 2,
      pattern: /(price|pricing|valuation|capex|spending|revenue|growth|orders|demand|investment|rate|yield|market|금리|가격|밸류에이션|투자|지출|수익|성장|주문|수요)/iu,
    })
  );
  const supplyLines = preferSourceSnippetLines(
    renderFactSummaryLines({
      facts: selectFactsByPattern(
        input.facts,
        /(supply|supply chain|capacity|lead time|constraint|shortage|build-?out|hyperscaler|semiconductor|gpu|공급망|캐파|납기|제약|증설|반도체|gpu)/iu
      ),
      expectedLanguage: input.expectedLanguage,
      kind: 'summary',
      limit: 2,
    }),
    renderSourceSnippetLines({
      sources: input.sources,
      expectedLanguage: input.expectedLanguage,
      limit: 2,
      pattern: /(supply|supply chain|capacity|lead time|constraint|shortage|build-?out|hyperscaler|semiconductor|gpu|공급망|캐파|납기|제약|증설|반도체|gpu)/iu,
    })
  );
  const policyLines = preferSourceSnippetLines(
    renderFactSummaryLines({
      facts: selectFactsByPattern(
        input.facts,
        /(regulation|policy|central bank|export control|tariff|sanction|rate|fed|ecb|규제|정책|중앙은행|수출 통제|관세|제재|금리)/iu
      ),
      expectedLanguage: input.expectedLanguage,
      kind: 'impact',
      limit: 2,
    }),
    renderSourceSnippetLines({
      sources: input.sources,
      expectedLanguage: input.expectedLanguage,
      limit: 2,
      pattern: /(regulation|policy|central bank|export control|tariff|sanction|rate|fed|ecb|규제|정책|중앙은행|수출 통제|관세|제재|금리)/iu,
    })
  );
  const factLines = preferSourceSnippetLines(
    renderFactSummaryLines({
      facts: input.facts,
      expectedLanguage: input.expectedLanguage,
      kind: 'summary',
      limit: 3,
    }),
    renderSourceSnippetLines({
      sources: input.sources,
      expectedLanguage: input.expectedLanguage,
      limit: 3,
      pattern: /(demand|capex|spending|build-?out|hyperscaler|semiconductor|gpu|rate|inflation|yield|policy|market|investment|공급망|캐파|금리|투자|수요|시장|증설|반도체)/iu,
    })
  );
  const interpretationLines = renderFactSummaryLines({
    facts: input.facts,
    expectedLanguage: input.expectedLanguage,
    kind: 'impact',
    limit: 3,
  });
  const riskLines = deriveMarketRiskLines(input);
  const coreIndicatorLines = sectorSpecific
    ? [
        sectionTitle(input.expectedLanguage, '##### 섹터 지표', '##### Sector indicators'),
        ...(sectorIndicatorLines.length > 0
          ? mergeDistinctLines(sectorIndicatorLines, quantitativeLines, 2)
          : [sectionTitle(input.expectedLanguage, '- 섹터 지표 신호가 아직 제한적입니다.', '- Sector-indicator signals are still limited.')]),
        '',
        sectionTitle(input.expectedLanguage, '##### 거시 지표', '##### Macro indicators'),
        ...(macroIndicatorLines.length > 0
          ? macroIndicatorLines
          : metricLines.length > 0
            ? metricLines.slice(0, 2)
            : [sectionTitle(input.expectedLanguage, '- 거시 지표 신호가 아직 제한적입니다.', '- Macro-indicator signals are still limited.')]),
      ]
    : metricLines.length > 0
      ? mergeDistinctLines(metricLines, quantitativeLines, 3)
      : quantitativeLines.length > 0
        ? quantitativeLines
        : [sectionTitle(input.expectedLanguage, '- 핵심 지표를 분리할 신호가 아직 충분하지 않습니다.', '- Core-indicator signals are still limited.')];
  return [
    sectionTitle(input.expectedLanguage, '#### 핵심 지표', '#### Core indicators'),
    ...coreIndicatorLines,
    '',
    sectionTitle(input.expectedLanguage, '#### 수급 신호', '#### Supply and demand signals'),
    ...(supplyLines.length > 0
      ? supplyLines
      : [sectionTitle(input.expectedLanguage, '- 수급 신호가 아직 제한적입니다.', '- Supply-demand signals are still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 정책 변수', '#### Policy variables'),
    ...(policyLines.length > 0
      ? policyLines
      : [sectionTitle(input.expectedLanguage, '- 정책 변수 신호가 아직 제한적입니다.', '- Policy-variable signals are still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 확인된 사실', '#### Verified facts'),
    ...(factLines.length > 0 ? factLines : [sectionTitle(input.expectedLanguage, '- 확인된 사실이 아직 충분하지 않습니다.', '- Verified facts are still sparse.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 해석', '#### Interpretation'),
    ...(interpretationLines.length > 0
      ? interpretationLines
      : [sectionTitle(input.expectedLanguage, '- 해석 가능한 시그널이 아직 적습니다.', '- Interpretable signals are still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 리스크 관찰 포인트', '#### Risk watchpoints'),
    ...(riskLines.length > 0
      ? riskLines
      : [sectionTitle(input.expectedLanguage, '- 현재 단계에서는 추가 리스크 신호가 제한적입니다.', '- Additional market watchpoints remain limited at this stage.')]),
  ];
}

function isPolicyOfficialSource(source: JarvisResearchArtifact['sources'][number]): boolean {
  return isOfficialDomain(source.domain);
}

function renderPolicyRegulationSections(input: {
  facts: NewsBriefingFact[];
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  const officialSources = input.sources.filter((source) => isPolicyOfficialSource(source));
  const sourceLookup = buildResearchSourceLookup(input.sources);
  const phasedTimelineLines = collectPolicyTimelineEntries(officialSources, input.expectedLanguage);
  const effectiveDateLines = input.facts
    .map((fact) => {
      const date = inferFactReferenceDate(fact, sourceLookup);
      if (!date) return null;
      const links = renderInlineSourceLinks(fact.sourceUrls, input.expectedLanguage, 1);
      return `- **${fact.headline}**: ${date}${links ? ` (${links})` : ''}`;
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 3);
  const fallbackEffectiveDateLines =
    effectiveDateLines.length > 0
      ? effectiveDateLines
      : officialSources
          .map((source) => {
            const date = extractEffectiveDateCandidatesForSource(source)[0];
            if (!date) return null;
            return `- **${source.title}**: ${date} ([${input.expectedLanguage === 'en' ? 'source' : '출처'}](${source.url}))`;
          })
          .filter((line): line is string => Boolean(line))
          .slice(0, 2);
  const coreChangeLines = renderFactSummaryLines({
    facts: input.facts,
    expectedLanguage: input.expectedLanguage,
    kind: 'summary',
    limit: 3,
  });
  const impactLines = renderFactSummaryLines({
    facts: input.facts,
    expectedLanguage: input.expectedLanguage,
    kind: 'impact',
    limit: 3,
  });

  return [
    sectionTitle(input.expectedLanguage, '#### 관할·문서', '#### Jurisdiction and documents'),
    ...(officialSources.length > 0
      ? renderSourceSummaryLines({ sources: officialSources, expectedLanguage: input.expectedLanguage, limit: 2 })
      : [sectionTitle(input.expectedLanguage, '- 공식 문서 연결이 아직 충분하지 않습니다.', '- Official documents are still sparse.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 발효 일정', '#### Effective timeline'),
    ...(fallbackEffectiveDateLines.length > 0
      ? fallbackEffectiveDateLines
      : [sectionTitle(input.expectedLanguage, '- 발효일 또는 시행 시점 신호가 아직 부족합니다.', '- Effective-date signals are still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 단계별 적용일', '#### Phased application dates'),
    ...(phasedTimelineLines.length > 0
      ? phasedTimelineLines
      : [sectionTitle(input.expectedLanguage, '- 단계별 적용일 신호가 아직 충분하지 않습니다.', '- Phased application dates are still limited.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 핵심 변경 사항', '#### Core changes'),
    ...(coreChangeLines.length > 0
      ? coreChangeLines
      : [sectionTitle(input.expectedLanguage, '- 핵심 변경 사항이 아직 충분히 정리되지 않았습니다.', '- Core changes are still sparse.')]),
    '',
    sectionTitle(input.expectedLanguage, '#### 영향 범위', '#### Impact scope'),
    ...(impactLines.length > 0
      ? impactLines
      : [sectionTitle(input.expectedLanguage, '- 영향 범위에 대한 해석 신호가 아직 제한적입니다.', '- Impact-scope signals are still limited.')]),
  ];
}

function buildProfileSnapshotLines(input: {
  profileDecision: ResearchProfileDecision;
  quality: Record<string, unknown>;
  expectedLanguage: ResponseLanguage | null;
}): string[] {
  const dimensions =
    input.quality.quality_dimensions && typeof input.quality.quality_dimensions === 'object' && !Array.isArray(input.quality.quality_dimensions)
      ? (input.quality.quality_dimensions as Record<string, unknown>)
      : null;
  if (!dimensions) {
    return [];
  }

  switch (input.profileDecision.profile) {
    case 'broad_news': {
      const topicCount = typeof dimensions.non_security_topic_count === 'number' ? dimensions.non_security_topic_count : null;
      const securityShare = percentLabel(dimensions.security_share);
      const majorPublisherCount = typeof dimensions.major_publisher_count === 'number' ? dimensions.major_publisher_count : null;
      const highSignificanceHeadlineCount =
        typeof dimensions.high_significance_headline_count === 'number' ? dimensions.high_significance_headline_count : null;
      const topDomains = Array.isArray(dimensions.top_domains)
        ? dimensions.top_domains
            .map((row) => (row && typeof row === 'object' && typeof (row as Record<string, unknown>).domain === 'string' ? (row as Record<string, unknown>).domain : null))
            .filter((row): row is string => Boolean(row))
            .slice(0, 3)
            .join(', ')
        : '';
      return [
        topicCount !== null ? `- ${sectionTitle(input.expectedLanguage, '비안보 카테고리', 'Non-security categories')}: ${topicCount}` : '',
        securityShare ? `- ${sectionTitle(input.expectedLanguage, '안보 비중', 'Security share')}: ${securityShare}` : '',
        majorPublisherCount !== null
          ? `- ${sectionTitle(input.expectedLanguage, '주요 퍼블리셔 수', 'Major publishers')}: ${majorPublisherCount}`
          : '',
        highSignificanceHeadlineCount !== null
          ? `- ${sectionTitle(input.expectedLanguage, '핵심 헤드라인 수', 'High-significance headlines')}: ${highSignificanceHeadlineCount}`
          : '',
        topDomains ? `- ${sectionTitle(input.expectedLanguage, '핵심 출처', 'Top publishers')}: ${topDomains}` : '',
      ].filter(Boolean);
    }
    case 'topic_news': {
      const timelineReady = typeof dimensions.timeline_ready === 'number' ? dimensions.timeline_ready : null;
      const conflicts = Array.isArray(dimensions.conflict_topics)
        ? dimensions.conflict_topics.filter((row): row is string => typeof row === 'string').slice(0, 3).join(', ')
        : '';
      return [
        timelineReady !== null ? `- ${sectionTitle(input.expectedLanguage, '타임라인 신호', 'Timeline-ready sources')}: ${timelineReady}` : '',
        conflicts
          ? `- ${sectionTitle(input.expectedLanguage, '충돌 주제', 'Conflict topics')}: ${conflicts}`
          : `- ${sectionTitle(input.expectedLanguage, '충돌 주제', 'Conflict topics')}: ${sectionTitle(input.expectedLanguage, '큰 충돌 없음', 'No major conflicts detected')}`,
      ].filter(Boolean);
    }
    case 'entity_brief': {
      const officialRatio = percentLabel(dimensions.official_source_ratio);
      const officialCount = typeof dimensions.official_source_count === 'number' ? dimensions.official_source_count : null;
      const mediaCount = typeof dimensions.media_source_count === 'number' ? dimensions.media_source_count : null;
      return [
        officialRatio ? `- ${sectionTitle(input.expectedLanguage, '공식 출처 비중', 'Official-source ratio')}: ${officialRatio}` : '',
        officialCount !== null ? `- ${sectionTitle(input.expectedLanguage, '공식 출처 수', 'Official sources')}: ${officialCount}` : '',
        mediaCount !== null ? `- ${sectionTitle(input.expectedLanguage, '언론 출처 수', 'Media sources')}: ${mediaCount}` : '',
      ].filter(Boolean);
    }
    case 'comparison_research': {
      const entities = Array.isArray(dimensions.comparison_entities)
        ? dimensions.comparison_entities.filter((row): row is string => typeof row === 'string').join(' vs ')
        : '';
      const axes = typeof dimensions.comparison_axes === 'number' ? dimensions.comparison_axes : null;
      const sideBalance = percentLabel(dimensions.side_balance);
      const axisLabels = Array.isArray(dimensions.comparison_axis_labels)
        ? dimensions.comparison_axis_labels
            .filter((row): row is string => typeof row === 'string')
            .slice(0, 4)
            .map((axis) => comparisonAxisLabel(input.expectedLanguage, axis))
            .join(', ')
        : '';
      return [
        entities ? `- ${sectionTitle(input.expectedLanguage, '비교 대상', 'Compared entities')}: ${entities}` : '',
        axes !== null ? `- ${sectionTitle(input.expectedLanguage, '비교 축 수', 'Comparison axes')}: ${axes}` : '',
        axisLabels ? `- ${sectionTitle(input.expectedLanguage, '다룬 비교 축', 'Covered axes')}: ${axisLabels}` : '',
        sideBalance ? `- ${sectionTitle(input.expectedLanguage, '근거 균형', 'Evidence balance')}: ${sideBalance}` : '',
      ].filter(Boolean);
    }
    case 'repo_research': {
      const repoCount = typeof dimensions.repo_source_count === 'number' ? dimensions.repo_source_count : null;
      const docsCount = typeof dimensions.docs_source_count === 'number' ? dimensions.docs_source_count : null;
      const releaseCount = typeof dimensions.release_source_count === 'number' ? dimensions.release_source_count : null;
      const issueCount = typeof dimensions.issue_source_count === 'number' ? dimensions.issue_source_count : null;
      const channelCount = typeof dimensions.repo_coverage_channels === 'number' ? dimensions.repo_coverage_channels : null;
      return [
        repoCount !== null ? `- ${sectionTitle(input.expectedLanguage, '레포 원천 출처', 'Repo-native sources')}: ${repoCount}` : '',
        docsCount !== null ? `- ${sectionTitle(input.expectedLanguage, '문서 커버리지', 'Docs coverage')}: ${docsCount}` : '',
        releaseCount !== null ? `- ${sectionTitle(input.expectedLanguage, '릴리즈 신호', 'Release signals')}: ${releaseCount}` : '',
        issueCount !== null ? `- ${sectionTitle(input.expectedLanguage, '이슈·PR 신호', 'Issue/PR signals')}: ${issueCount}` : '',
        channelCount !== null ? `- ${sectionTitle(input.expectedLanguage, '커버리지 채널', 'Coverage channels')}: ${channelCount}` : '',
      ].filter(Boolean);
    }
    case 'market_research': {
      const authorityCount = typeof dimensions.authority_source_count === 'number' ? dimensions.authority_source_count : null;
      const authorityDomainCount = typeof dimensions.authority_domain_count === 'number' ? dimensions.authority_domain_count : null;
      const officialCount = typeof dimensions.official_source_count === 'number' ? dimensions.official_source_count : null;
      const mediaCount = typeof dimensions.media_source_count === 'number' ? dimensions.media_source_count : null;
      const sectorSignalCount = typeof dimensions.sector_signal_count === 'number' ? dimensions.sector_signal_count : null;
      const macroSignalCount = typeof dimensions.macro_signal_count === 'number' ? dimensions.macro_signal_count : null;
      return [
        authorityCount !== null ? `- ${sectionTitle(input.expectedLanguage, '권위 출처 수', 'Authority sources')}: ${authorityCount}` : '',
        authorityDomainCount !== null ? `- ${sectionTitle(input.expectedLanguage, '권위 도메인 수', 'Authority domains')}: ${authorityDomainCount}` : '',
        officialCount !== null ? `- ${sectionTitle(input.expectedLanguage, '공식 출처 수', 'Official sources')}: ${officialCount}` : '',
        mediaCount !== null ? `- ${sectionTitle(input.expectedLanguage, '언론 출처 수', 'Media sources')}: ${mediaCount}` : '',
        sectorSignalCount !== null ? `- ${sectionTitle(input.expectedLanguage, '섹터 신호', 'Sector signals')}: ${sectorSignalCount}` : '',
        macroSignalCount !== null ? `- ${sectionTitle(input.expectedLanguage, '거시 신호', 'Macro signals')}: ${macroSignalCount}` : '',
      ].filter(Boolean);
    }
    case 'policy_regulation': {
      const officialCount = typeof dimensions.official_source_count === 'number' ? dimensions.official_source_count : null;
      const effectiveDateCount = typeof dimensions.effective_date_source_count === 'number' ? dimensions.effective_date_source_count : null;
      const jurisdictionCount = typeof dimensions.jurisdiction_signal_count === 'number' ? dimensions.jurisdiction_signal_count : null;
      return [
        officialCount !== null ? `- ${sectionTitle(input.expectedLanguage, '공식 문서 수', 'Official documents')}: ${officialCount}` : '',
        effectiveDateCount !== null ? `- ${sectionTitle(input.expectedLanguage, '발효일 신호', 'Effective-date signals')}: ${effectiveDateCount}` : '',
        jurisdictionCount !== null ? `- ${sectionTitle(input.expectedLanguage, '관할 신호', 'Jurisdiction signals')}: ${jurisdictionCount}` : '',
      ].filter(Boolean);
    }
    default:
      return [];
  }
}

function renderResearchMarkdown(input: {
  query: string;
  profileDecision: ResearchProfileDecision;
  facts: NewsBriefingFact[];
  sources: JarvisResearchArtifact['sources'];
  expectedLanguage: ResponseLanguage | null;
  quality: Record<string, unknown>;
}): string {
  const rendered = renderNewsBriefingFromFacts({
    facts: input.facts,
    sources: input.sources,
    expectedLanguage: input.expectedLanguage,
    retrievedAt: new Date().toISOString(),
  });
  const heading =
    input.profileDecision.profile === 'comparison_research'
      ? '### 비교 브리프'
      : input.profileDecision.profile === 'repo_research'
        ? '### 레포 브리프'
        : input.profileDecision.profile === 'market_research'
          ? '### 시장 브리프'
          : input.profileDecision.profile === 'policy_regulation'
            ? '### 정책 브리프'
            : input.profileDecision.profile === 'entity_brief'
              ? '### 대상 브리프'
              : '### 주요 뉴스 브리프';
  const sections = splitRenderedBriefing(rendered);
  const snapshotLines = buildProfileSnapshotLines(input);
  const snapshotHeading =
    input.profileDecision.profile === 'comparison_research'
      ? sectionTitle(input.expectedLanguage, '#### 비교 구조', '#### Comparison structure')
      : input.profileDecision.profile === 'repo_research'
        ? sectionTitle(input.expectedLanguage, '#### 레포 커버리지', '#### Repository coverage')
        : input.profileDecision.profile === 'policy_regulation'
          ? sectionTitle(input.expectedLanguage, '#### 규정 적용 범위', '#### Policy scope')
          : input.profileDecision.profile === 'entity_brief'
          ? sectionTitle(input.expectedLanguage, '#### 대상 신호', '#### Entity signals')
            : input.profileDecision.profile === 'market_research'
              ? sectionTitle(input.expectedLanguage, '#### 시장 관찰 포인트', '#### Market signals')
              : input.profileDecision.profile === 'topic_news'
                ? sectionTitle(input.expectedLanguage, '#### 사건 전개 포인트', '#### Event progression')
                : sectionTitle(input.expectedLanguage, '#### 커버리지 상태', '#### Coverage snapshot');
  const lines: string[] = [heading, ''];
  if (snapshotLines.length > 0) {
    lines.push(snapshotHeading, ...snapshotLines, '');
  }

  if (input.profileDecision.profile === 'repo_research') {
    lines.push(...renderRepoResearchSections(input));
  } else if (input.profileDecision.profile === 'entity_brief') {
    lines.push(...renderEntityBriefSections(input));
  } else if (input.profileDecision.profile === 'comparison_research') {
    lines.push(...renderComparisonResearchSections(input));
  } else if (input.profileDecision.profile === 'market_research') {
    lines.push(...renderMarketResearchSections(input));
  } else if (input.profileDecision.profile === 'policy_regulation') {
    lines.push(...renderPolicyRegulationSections(input));
  } else {
    const coreHeading =
      input.profileDecision.profile === 'topic_news'
        ? sectionTitle(input.expectedLanguage, '#### 핵심 타임라인', '#### Core timeline')
        : sectionTitle(input.expectedLanguage, '#### 핵심 헤드라인', '#### Core headlines');
    lines.push(coreHeading, ...sections.body);
  }

  if (sections.sources.length > 0) {
    lines.push('', ...sections.sources);
  }
  return lines.join('\n');
}

async function generateResearchArtifactAttempt(query: string, options: ResearchAttemptOptions): Promise<JarvisResearchArtifact> {
  const rewrittenQueries = buildResearchQueries(query, options);
  const retrievalPack = await retrieveWebEvidence({
    prompt: query,
    rewrittenQueries,
    maxItems: options.maxItems,
    profile: options.profileDecision.profile,
    sourcePolicy: options.profileDecision.sourcePolicy,
  });
  const languagePolicy = buildLanguageSystemInstruction(query);
  const qualityProfile = mapResearchProfileToNewsQualityProfile(options.profileDecision.profile, query);
  const factLimit = qualityProfile === 'standard' ? 5 : 6;
  const facts = ensureFactDomainCoverage({
    facts: buildFallbackNewsFactsFromSources({
      sources: retrievalPack.sources,
      expectedLanguage: languagePolicy.expectedLanguage,
      maxFacts: factLimit,
      qualityProfile,
    }),
    sources: retrievalPack.sources,
    expectedLanguage: languagePolicy.expectedLanguage,
    maxFacts: factLimit,
    qualityProfile,
  });
  const summary = buildSummaryFromFacts(facts);
  const claims = facts.map((fact) => ({
    claimText: `${fact.headline}: ${fact.summary}`,
    sourceUrls: [...fact.sourceUrls],
  }));
  const worldModelExtraction = extractWorldModelCandidateFacts({
    query,
    researchProfile: options.profileDecision.profile,
    sources: retrievalPack.sources,
    claims,
  });
  const conflicts = detectConflicts(facts);
  const quality = buildQualityEnvelope({
    query,
    rewrittenQueries,
    facts,
    sources: retrievalPack.sources,
    claims,
    conflicts,
    profileDecision: options.profileDecision,
  });
  const answerMarkdown = applyResearchResponseStyle({
    markdown: renderResearchMarkdown({
      query,
      profileDecision: options.profileDecision,
      facts,
      sources: retrievalPack.sources,
      expectedLanguage: languagePolicy.expectedLanguage,
      quality,
    }),
    responseStyle: options.responseStyle ?? null,
    expectedLanguage: languagePolicy.expectedLanguage,
    sources: retrievalPack.sources,
  });

  return {
    title: truncateText(query, 90),
    query,
    summary,
    answerMarkdown,
    worldModelExtraction,
    sources: retrievalPack.sources,
    claims,
    quality,
    conflicts: {
      topics: conflicts,
      count: conflicts.length,
    },
    researchProfile: options.profileDecision.profile,
    profileReasons: options.profileDecision.reasons,
    formatHint: options.profileDecision.formatHint,
    qualityMode: (quality.quality_mode as ResearchQualityMode | undefined) ?? options.profileDecision.qualityMode,
  };
}

export async function generateResearchArtifact(
  query: string,
  options?: GenerateResearchArtifactOptions
): Promise<JarvisResearchArtifact> {
  const strictness = options?.strictness ?? inferResearchStrictness(query);
  const profileDecision = resolveResearchProfile({
    prompt: query,
    intent: options?.intent,
    taskType: options?.taskType,
    targetHint: options?.targetHint,
  });
  const policy = getResearchProfilePolicy(profileDecision.profile);
  const firstAttempt = await generateResearchArtifactAttempt(query, {
    maxVariants: strictness === 'news' || isNewsLikeResearchProfile(profileDecision.profile) ? 6 : 5,
    maxItems: strictness === 'news' || isNewsLikeResearchProfile(profileDecision.profile) ? 14 : 10,
    profileDecision,
    responseStyle: options?.responseStyle ?? null,
  });

  if (firstAttempt.qualityMode === 'pass') {
    return firstAttempt;
  }

  const retryAttempt = await generateResearchArtifactAttempt(query, {
    maxVariants: strictness === 'news' || isNewsLikeResearchProfile(profileDecision.profile) ? 7 : 6,
    maxItems: strictness === 'news' || isNewsLikeResearchProfile(profileDecision.profile) ? 18 : 12,
    profileDecision,
    expandedCoverage: true,
    responseStyle: options?.responseStyle ?? null,
  });

  if (retryAttempt.qualityMode !== 'block') {
    return retryAttempt;
  }

  throw new Error(`quality gate failed: ${qualityGateFailureReason(retryAttempt.quality)} (${policy.profile})`);
}
