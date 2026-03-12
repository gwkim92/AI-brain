import type { TranslationKey } from "@/lib/locale";

const RESEARCH_WARNING_KEY_MAP: Record<string, TranslationKey> = {
  low_source_count: "researchWarning.lowSourceCount",
  low_domain_diversity: "researchWarning.lowDomainDiversity",
  low_citation_coverage: "researchWarning.lowCitationCoverage",
  stale_news_freshness: "researchWarning.staleNewsFreshness",
  conflicting_summaries: "researchWarning.conflictingSummaries",
  major_needs_more_publishers: "researchWarning.majorNeedsMorePublishers",
  major_needs_broader_topics: "researchWarning.majorNeedsBroaderTopics",
  major_needs_non_security_categories: "researchWarning.majorNeedsNonSecurityCategories",
  major_with_war_needs_topic_balance: "researchWarning.majorWithWarNeedsTopicBalance",
  major_with_war_needs_non_security_category: "researchWarning.majorWithWarNeedsNonSecurityCategory",
  security_overweight_major: "researchWarning.securityOverweightMajor",
  security_overweight_major_with_war: "researchWarning.securityOverweightMajorWithWar",
  publisher_concentration_major: "researchWarning.publisherConcentrationMajor",
  topic_news_needs_focus: "researchWarning.topicNewsNeedsFocus",
  entity_needs_more_official_sources: "researchWarning.entityNeedsMoreOfficialSources",
  comparison_side_imbalance: "researchWarning.comparisonSideImbalance",
  comparison_axes_thin: "researchWarning.comparisonAxesThin",
  repo_needs_repo_sources: "researchWarning.repoNeedsRepoSources",
  repo_needs_release_signal: "researchWarning.repoNeedsReleaseSignal",
  market_needs_authority_source: "researchWarning.marketNeedsAuthoritySource",
  policy_needs_effective_date: "researchWarning.policyNeedsEffectiveDate",
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export function readResearchWarningCodes(record: Record<string, unknown>): string[] {
  return normalizeStringArray(record.soft_warning_codes);
}

export function readResearchWarnings(record: Record<string, unknown>): string[] {
  return normalizeStringArray(record.soft_warnings);
}

export function mapResearchWarningLabel(
  code: string,
  fallback: string | undefined,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
): string {
  const translationKey = RESEARCH_WARNING_KEY_MAP[code];
  if (translationKey) {
    return t(translationKey);
  }
  return fallback?.trim() || code;
}

export function resolveResearchWarningLabels(input: {
  record: Record<string, unknown>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}): string[] {
  const warnings = readResearchWarnings(input.record);
  const codes = readResearchWarningCodes(input.record);
  const maxLength = Math.max(warnings.length, codes.length);
  const labels: string[] = [];
  for (let index = 0; index < maxLength; index += 1) {
    const code = codes[index] ?? "";
    const fallback = warnings[index];
    if (!code && !fallback) {
      continue;
    }
    labels.push(mapResearchWarningLabel(code, fallback, input.t));
  }
  if (labels.length > 0) {
    return Array.from(new Set(labels));
  }
  return warnings;
}

export function readResearchProfile(record: Record<string, unknown>): string | null {
  return typeof record.research_profile === "string" ? record.research_profile : null;
}

export function readResearchProfileReasons(record: Record<string, unknown>): string[] {
  return normalizeStringArray(record.profile_reasons);
}

export function readResearchFormatHint(record: Record<string, unknown>): string | null {
  return typeof record.format_hint === "string" ? record.format_hint : null;
}

export function readResearchQualityMode(record: Record<string, unknown>): "pass" | "warn" | "block" | null {
  return record.quality_mode === "pass" || record.quality_mode === "warn" || record.quality_mode === "block"
    ? record.quality_mode
    : null;
}

export function describeResearchProfile(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  profile: string | null | undefined
): string {
  switch (profile) {
    case "broad_news":
      return t("researchProfile.broadNews");
    case "topic_news":
      return t("researchProfile.topicNews");
    case "entity_brief":
      return t("researchProfile.entityBrief");
    case "comparison_research":
      return t("researchProfile.comparisonResearch");
    case "repo_research":
      return t("researchProfile.repoResearch");
    case "market_research":
      return t("researchProfile.marketResearch");
    case "policy_regulation":
      return t("researchProfile.policyRegulation");
    default:
      return t("researchProfile.unknown");
  }
}

export function describeResearchProfileReason(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  reason: string
): string {
  switch (reason) {
    case "broad_news_signal":
      return t("researchProfileReason.broadNewsSignal");
    case "topic_news_signal":
      return t("researchProfileReason.topicNewsSignal");
    case "entity_signal_or_research_intent":
    case "entity_named_subject_signal":
    case "research_intent_signal":
      return t("researchProfileReason.entitySignal");
    case "comparison_signal":
      return t("researchProfileReason.comparisonSignal");
    case "repo_signal":
      return t("researchProfileReason.repoSignal");
    case "market_signal":
      return t("researchProfileReason.marketSignal");
    case "policy_signal":
      return t("researchProfileReason.policySignal");
    case "default_profile_fallback":
      return t("researchProfileReason.defaultFallback");
    default:
      return reason.replace(/_/g, " ");
  }
}

export function describeResearchQualityMode(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  mode: "pass" | "warn" | "block" | null | undefined
): string {
  if (mode === "pass") return t("researchQuality.pass");
  if (mode === "warn") return t("researchQuality.warn");
  if (mode === "block") return t("researchQuality.block");
  return t("researchQuality.unknown");
}

export function describeResearchFormatHint(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  hint: string | null | undefined
): string {
  switch (hint) {
    case "headline_brief":
      return t("researchFormat.headlineBrief");
    case "topic_timeline":
      return t("researchFormat.topicTimeline");
    case "entity_snapshot":
      return t("researchFormat.entitySnapshot");
    case "comparison_brief":
      return t("researchFormat.comparisonBrief");
    case "repo_brief":
      return t("researchFormat.repoBrief");
    case "market_brief":
      return t("researchFormat.marketBrief");
    case "policy_brief":
      return t("researchFormat.policyBrief");
    default:
      return t("researchFormat.unknown");
  }
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summarizeResearchQualityDimensions(input: {
  profile: string | null | undefined;
  dimensions: Record<string, unknown> | null | undefined;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}): string[] {
  const { profile, dimensions, t } = input;
  if (!dimensions) return [];

  if (profile === "broad_news") {
    const topicCount = toFiniteNumber(dimensions.topic_count) ?? toFiniteNumber(dimensions.non_security_topic_count);
    const securityShare = toFiniteNumber(dimensions.security_share);
    const majorPublishers = toFiniteNumber(dimensions.major_publisher_count);
    const highSignificance = toFiniteNumber(dimensions.high_significance_headline_count);
    const topDomains = Array.isArray(dimensions.top_domains) ? dimensions.top_domains.length : null;
    return [
      typeof topicCount === "number" ? t("researchDimension.topicCount", { value: topicCount }) : "",
      typeof securityShare === "number" ? t("researchDimension.securityShare", { value: Math.round(securityShare * 100) }) : "",
      typeof majorPublishers === "number" ? t("researchDimension.majorPublishers", { value: majorPublishers }) : "",
      typeof highSignificance === "number" ? t("researchDimension.highSignificanceHeadlines", { value: highSignificance }) : "",
      typeof topDomains === "number" ? t("researchDimension.topDomains", { value: topDomains }) : "",
    ].filter(Boolean);
  }

  if (profile === "topic_news") {
    const timelineReady = toFiniteNumber(dimensions.timeline_ready);
    const conflicts = Array.isArray(dimensions.conflict_topics) ? dimensions.conflict_topics.length : 0;
    return [
      typeof timelineReady === "number" ? t("researchDimension.timelineReady", { value: timelineReady }) : "",
      conflicts > 0 ? t("researchDimension.conflictTopics", { value: conflicts }) : t("researchDimension.noMajorConflicts"),
    ].filter(Boolean);
  }

  if (profile === "entity_brief") {
    const officialRatio = toFiniteNumber(dimensions.official_source_ratio);
    const officialCount = toFiniteNumber(dimensions.official_source_count);
    return [
      typeof officialRatio === "number" ? t("researchDimension.officialRatio", { value: Math.round(officialRatio * 100) }) : "",
      typeof officialCount === "number" ? t("researchDimension.officialCount", { value: officialCount }) : "",
    ].filter(Boolean);
  }

  if (profile === "comparison_research") {
    const axes = toFiniteNumber(dimensions.comparison_axes);
    const sideBalance = toFiniteNumber(dimensions.side_balance);
    const axisLabels = Array.isArray(dimensions.comparison_axis_labels)
      ? dimensions.comparison_axis_labels.filter((entry): entry is string => typeof entry === "string").slice(0, 3)
      : [];
    return [
      typeof axes === "number" ? t("researchDimension.comparisonAxes", { value: axes }) : "",
      axisLabels.length > 0 ? t("researchDimension.comparisonAxisLabels", { value: axisLabels.join(", ") }) : "",
      typeof sideBalance === "number" ? t("researchDimension.sideBalance", { value: Math.round(sideBalance * 100) }) : "",
    ].filter(Boolean);
  }

  if (profile === "repo_research") {
    const repoSources = toFiniteNumber(dimensions.repo_source_count);
    const docsSources = toFiniteNumber(dimensions.docs_source_count);
    const releaseSources = toFiniteNumber(dimensions.release_source_count);
    const issueSources = toFiniteNumber(dimensions.issue_source_count);
    const coverageChannels = toFiniteNumber(dimensions.repo_coverage_channels);
    return [
      typeof repoSources === "number" ? t("researchDimension.repoSources", { value: repoSources }) : "",
      typeof docsSources === "number" ? t("researchDimension.docsCoverage", { value: docsSources }) : "",
      typeof releaseSources === "number" ? t("researchDimension.releaseSignals", { value: releaseSources }) : "",
      typeof issueSources === "number" ? t("researchDimension.issueSignals", { value: issueSources }) : "",
      typeof coverageChannels === "number" ? t("researchDimension.repoCoverageChannels", { value: coverageChannels }) : "",
    ].filter(Boolean);
  }

  if (profile === "market_research") {
    const authorityCount = toFiniteNumber(dimensions.authority_source_count);
    const authorityDomains = toFiniteNumber(dimensions.authority_domain_count);
    const officialCount = toFiniteNumber(dimensions.official_source_count);
    const mediaCount = toFiniteNumber(dimensions.media_source_count);
    return [
      typeof authorityCount === "number" ? t("researchDimension.authoritySources", { value: authorityCount }) : "",
      typeof authorityDomains === "number" ? t("researchDimension.authorityDomains", { value: authorityDomains }) : "",
      typeof officialCount === "number" ? t("researchDimension.officialCount", { value: officialCount }) : "",
      typeof mediaCount === "number" ? t("researchDimension.mediaSources", { value: mediaCount }) : "",
    ].filter(Boolean);
  }

  if (profile === "policy_regulation") {
    const officialCount = toFiniteNumber(dimensions.official_source_count);
    const effectiveDateCount = toFiniteNumber(dimensions.effective_date_source_count);
    const jurisdictionCount = toFiniteNumber(dimensions.jurisdiction_signal_count);
    return [
      typeof officialCount === "number" ? t("researchDimension.officialCount", { value: officialCount }) : "",
      typeof effectiveDateCount === "number" ? t("researchDimension.effectiveDates", { value: effectiveDateCount }) : "",
      typeof jurisdictionCount === "number" ? t("researchDimension.jurisdictionSignals", { value: jurisdictionCount }) : "",
    ].filter(Boolean);
  }

  return [];
}
