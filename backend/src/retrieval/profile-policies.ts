import type {
  ResearchProfile,
  ResearchProfileFormatHint,
  ResearchProfileSourcePolicy,
} from './research-profile';

export type ResearchProfilePolicy = {
  profile: ResearchProfile;
  sourcePolicy: ResearchProfileSourcePolicy;
  formatHint: ResearchProfileFormatHint;
  freshnessTarget: 'live' | 'recent' | 'reference';
  diversityTarget: 'high' | 'medium' | 'low';
  significanceTarget: 'headline' | 'topic' | 'entity' | 'comparison' | 'repo' | 'market' | 'policy';
  officialSourceRequired: boolean;
  comparisonBalanceRequired: boolean;
  maxSecurityItems?: number;
  minimumSourceCount: number;
  minimumDomainCount: number;
};

export const RESEARCH_PROFILE_POLICIES: Record<ResearchProfile, ResearchProfilePolicy> = {
  broad_news: {
    profile: 'broad_news',
    sourcePolicy: 'headline_media',
    formatHint: 'headline_brief',
    freshnessTarget: 'live',
    diversityTarget: 'high',
    significanceTarget: 'headline',
    officialSourceRequired: false,
    comparisonBalanceRequired: false,
    maxSecurityItems: 1,
    minimumSourceCount: 4,
    minimumDomainCount: 3,
  },
  topic_news: {
    profile: 'topic_news',
    sourcePolicy: 'topic_media',
    formatHint: 'topic_timeline',
    freshnessTarget: 'live',
    diversityTarget: 'medium',
    significanceTarget: 'topic',
    officialSourceRequired: false,
    comparisonBalanceRequired: false,
    minimumSourceCount: 3,
    minimumDomainCount: 2,
  },
  entity_brief: {
    profile: 'entity_brief',
    sourcePolicy: 'official_first',
    formatHint: 'entity_snapshot',
    freshnessTarget: 'recent',
    diversityTarget: 'medium',
    significanceTarget: 'entity',
    officialSourceRequired: false,
    comparisonBalanceRequired: false,
    minimumSourceCount: 3,
    minimumDomainCount: 2,
  },
  comparison_research: {
    profile: 'comparison_research',
    sourcePolicy: 'topic_media',
    formatHint: 'comparison_brief',
    freshnessTarget: 'recent',
    diversityTarget: 'high',
    significanceTarget: 'comparison',
    officialSourceRequired: false,
    comparisonBalanceRequired: true,
    minimumSourceCount: 4,
    minimumDomainCount: 3,
  },
  repo_research: {
    profile: 'repo_research',
    sourcePolicy: 'repo_first',
    formatHint: 'repo_brief',
    freshnessTarget: 'recent',
    diversityTarget: 'medium',
    significanceTarget: 'repo',
    officialSourceRequired: false,
    comparisonBalanceRequired: false,
    minimumSourceCount: 3,
    minimumDomainCount: 2,
  },
  market_research: {
    profile: 'market_research',
    sourcePolicy: 'market_authority',
    formatHint: 'market_brief',
    freshnessTarget: 'recent',
    diversityTarget: 'medium',
    significanceTarget: 'market',
    officialSourceRequired: false,
    comparisonBalanceRequired: false,
    minimumSourceCount: 3,
    minimumDomainCount: 2,
  },
  policy_regulation: {
    profile: 'policy_regulation',
    sourcePolicy: 'official_first',
    formatHint: 'policy_brief',
    freshnessTarget: 'recent',
    diversityTarget: 'medium',
    significanceTarget: 'policy',
    officialSourceRequired: true,
    comparisonBalanceRequired: false,
    minimumSourceCount: 2,
    minimumDomainCount: 1,
  },
};

export function getResearchProfilePolicy(profile: ResearchProfile): ResearchProfilePolicy {
  return RESEARCH_PROFILE_POLICIES[profile];
}
