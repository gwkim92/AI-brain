export type ResearchProfile =
  | 'broad_news'
  | 'topic_news'
  | 'entity_brief'
  | 'comparison_research'
  | 'repo_research'
  | 'market_research'
  | 'policy_regulation';

export type ResearchProfileSourcePolicy = 'headline_media' | 'topic_media' | 'official_first' | 'repo_first' | 'market_authority';
export type ResearchProfileFormatHint =
  | 'headline_brief'
  | 'topic_timeline'
  | 'entity_snapshot'
  | 'comparison_brief'
  | 'repo_brief'
  | 'market_brief'
  | 'policy_brief';
export type ResearchQualityMode = 'pass' | 'warn' | 'block';

export type ResearchProfileDecision = {
  profile: ResearchProfile;
  confidence: number;
  reasons: string[];
  sourcePolicy: ResearchProfileSourcePolicy;
  formatHint: ResearchProfileFormatHint;
  qualityMode: ResearchQualityMode;
};

export type ResearchProfileRouteInput = {
  prompt: string;
  intent?: string;
  taskType?: string;
  targetHint?: string;
};

const BROAD_NEWS_PATTERN =
  /(오늘\s*(세계\s*)?(주요\s*뉴스|뉴스)|최신\s*(뉴스|헤드라인)|최근\s*(뉴스|헤드라인)|주요\s*뉴스|세계\s*뉴스|world\s*news|global\s*headlines?|top\s*news|major\s*news|headlines?)/iu;
const TOPIC_NEWS_PATTERN =
  /(전쟁|분쟁|공습|공격|제재|속보|최신\s*동향|릴리즈|출시|사건|war|conflict|attack|strike|sanction|release|breaking|latest\s+updates)/iu;
const ENTITY_DESCRIPTOR_PATTERN =
  /(회사|기업|기관|인물|국가|정부|브랜드|제품|서비스|플랫폼|모델|조직|단체|company|organization|person|country|brand|product|service|platform|model|who\s+is|what\s+is)/iu;
const ENTITY_SUMMARY_REQUEST_PATTERN =
  /(요약해|정리해|설명해|소개해|브리프|개요|알려줘|summary|summarize|overview|brief|explain)/iu;
const COMPARISON_PATTERN =
  /(\bvs\b|비교|장단점|차이점|pros?\s+and\s+cons|compare|difference|trade-?off)/iu;
const REPO_PATTERN =
  /(repo|repository|github|gitlab|readme|release note|releases|issue|pull request|codebase|레포|리포지토리|깃허브|코드베이스)/iu;
const MARKET_PATTERN =
  /(시장|매크로|산업|금리|환율|주식|섹터|수급|거시|market|macro|sector|stocks?|fx|rates?|yield|industry)/iu;
const POLICY_PATTERN =
  /(정책|규제|법|법안|가이드라인|공식\s*공지|발효|규정|directive|ordinance|bill|ai\s*act|policy|regulation|act|law|guideline|official notice|compliance)/iu;
const ENTITY_NAME_HINT_PATTERN =
  /\b(?:[A-Z]{2,}(?:\s+[A-Z][A-Za-z0-9-]+)*(?:\s+Act)?|[A-Z][a-z]+(?:\s+[A-Z][A-Za-z0-9-]+)+)\b/u;
const GENERIC_SUMMARY_OBJECT_PATTERN =
  /(이\s*(문서|내용|텍스트|페이지|기사|자료|코드|레포|리포지토리|저장소)|지금\s*시스템\s*상태|현재\s*상태|전체|결과|위\s*내용|아래\s*내용|현황|서비스\s*상태|system\s*status|current\s*status|this\s*(document|content|text|page|article|repo|repository))/iu;

function normalizedIntent(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function extractEntitySubject(prompt: string): string | null {
  const match = prompt.match(/^\s*["'“”]?(.{1,80}?)["'“”]?(?:를|을|은|는|이|가)\s*(?:요약해|정리해|설명해|소개해|브리프|개요|알려줘)/u);
  const subject = match?.[1]?.trim();
  return subject && subject.length > 0 ? subject : null;
}

function looksLikeEntityBriefPrompt(prompt: string, intent: string): boolean {
  if (ENTITY_DESCRIPTOR_PATTERN.test(prompt)) {
    return true;
  }
  if (intent === 'research') {
    return true;
  }
  if (!ENTITY_SUMMARY_REQUEST_PATTERN.test(prompt)) {
    return false;
  }
  const subject = extractEntitySubject(prompt);
  if (!subject || GENERIC_SUMMARY_OBJECT_PATTERN.test(subject)) {
    return false;
  }
  if (ENTITY_NAME_HINT_PATTERN.test(subject)) {
    return true;
  }
  return /([A-Za-z]{2,}|\d{2,})/.test(subject);
}

export function shouldRouteByResearchProfile(decision: ResearchProfileDecision): boolean {
  return !decision.reasons.includes('default_profile_fallback');
}

export function mapResearchProfileToJarvisIntent(profile: ResearchProfile): 'news' | 'research' | 'finance' {
  if (profile === 'broad_news' || profile === 'topic_news') return 'news';
  if (profile === 'market_research') return 'finance';
  return 'research';
}

function buildDecision(
  profile: ResearchProfile,
  confidence: number,
  reasons: string[],
  sourcePolicy: ResearchProfileSourcePolicy,
  formatHint: ResearchProfileFormatHint,
  qualityMode: ResearchQualityMode = 'pass'
): ResearchProfileDecision {
  return {
    profile,
    confidence,
    reasons,
    sourcePolicy,
    formatHint,
    qualityMode
  };
}

export function resolveResearchProfile(input: ResearchProfileRouteInput): ResearchProfileDecision {
  const prompt = input.prompt.trim();
  const intent = normalizedIntent(input.intent);
  const taskType = normalizedIntent(input.taskType);
  const haystack = `${prompt}\n${intent}\n${taskType}\n${input.targetHint ?? ''}`;
  const hasBroadNewsSignal = BROAD_NEWS_PATTERN.test(haystack);
  const hasTopicNewsSignal = TOPIC_NEWS_PATTERN.test(haystack);

  if (taskType === 'repo') {
    return buildDecision('repo_research', 0.98, ['repo_task_type_signal'], 'repo_first', 'repo_brief');
  }
  if (REPO_PATTERN.test(haystack)) {
    return buildDecision('repo_research', 0.96, ['repo_signal'], 'repo_first', 'repo_brief');
  }
  if (COMPARISON_PATTERN.test(haystack)) {
    return buildDecision('comparison_research', 0.94, ['comparison_signal'], 'topic_media', 'comparison_brief');
  }
  if (POLICY_PATTERN.test(haystack)) {
    return buildDecision('policy_regulation', 0.94, ['policy_signal'], 'official_first', 'policy_brief');
  }
  if (MARKET_PATTERN.test(haystack) || intent === 'finance') {
    return buildDecision('market_research', 0.92, ['market_signal'], 'market_authority', 'market_brief');
  }
  if (hasBroadNewsSignal) {
    return buildDecision(
      'broad_news',
      hasTopicNewsSignal ? 0.94 : 0.9,
      hasTopicNewsSignal ? ['broad_news_signal', 'topic_news_signal'] : ['broad_news_signal'],
      'headline_media',
      'headline_brief'
    );
  }
  if (hasTopicNewsSignal || intent === 'news') {
    return buildDecision('topic_news', 0.9, ['topic_news_signal'], 'topic_media', 'topic_timeline');
  }
  if (looksLikeEntityBriefPrompt(prompt, intent)) {
    return buildDecision(
      'entity_brief',
      intent === 'research' ? 0.74 : 0.78,
      intent === 'research' ? ['research_intent_signal'] : ['entity_named_subject_signal'],
      'official_first',
      'entity_snapshot'
    );
  }
  if (intent === 'research') {
    return buildDecision('entity_brief', 0.62, ['research_intent_signal'], 'official_first', 'entity_snapshot');
  }
  return buildDecision('entity_brief', 0.45, ['default_profile_fallback'], 'official_first', 'entity_snapshot', 'warn');
}

export function isNewsLikeResearchProfile(profile: ResearchProfile): boolean {
  return profile === 'broad_news' || profile === 'topic_news';
}

export function shouldOfferMonitor(profile: ResearchProfile): boolean {
  return (
    profile === 'topic_news' ||
    profile === 'entity_brief' ||
    profile === 'market_research' ||
    profile === 'policy_regulation'
  );
}
