import type { RoutingTaskType } from '../providers/types';

export type GroundingPolicy = 'static' | 'dynamic_factual' | 'high_risk_factual';

export type GroundingDecision = {
  policy: GroundingPolicy;
  requiresGrounding: boolean;
  reasons: string[];
  signals: {
    recency: boolean;
    factual: boolean;
    citations: boolean;
    highRisk: boolean;
    news: boolean;
  };
};

export type GroundingPolicyInput = {
  prompt: string;
  intent?: string;
  taskType?: RoutingTaskType | string;
};

const RECENCY_PATTERN =
  /(latest|recent|today|current|just now|live|real-time|breaking|업데이트|최신|요즘|실시간|방금|오늘|현재)/iu;
const FACTUAL_PATTERN =
  /(price|stock|market|fx|exchange rate|weather|score|schedule|headline|news|briefing|release|version|policy|regulation|법|정책|공시|주가|환율|날씨|스코어|일정|헤드라인|뉴스|브리핑|릴리즈|버전)/iu;
const CITATION_PATTERN = /(source|sources|citation|citations|link|links|근거|출처|링크|참조)/iu;
const NEWS_PATTERN = /(news|headline|briefing|속보|주요 뉴스|뉴스|브리핑|헤드라인)/iu;
const HIGH_RISK_PATTERN =
  /(medical|diagnosis|prescription|legal advice|lawsuit|compliance|investment advice|trading signal|신약|진단|처방|법률 자문|소송|규제 준수|투자 조언|매매 신호)/iu;

function includesSignal(pattern: RegExp, text: string): boolean {
  return pattern.test(text);
}

export function resolveGroundingPolicy(input: GroundingPolicyInput): GroundingDecision {
  const prompt = input.prompt.trim();
  const intent = (input.intent ?? '').trim().toLowerCase();
  const taskType = (input.taskType ?? '').trim().toLowerCase();
  const haystack = `${intent}\n${taskType}\n${prompt}`;

  const hasRecency = includesSignal(RECENCY_PATTERN, haystack);
  const hasFactual = includesSignal(FACTUAL_PATTERN, haystack);
  const hasCitationDemand = includesSignal(CITATION_PATTERN, haystack);
  const isNews = intent === 'news' || includesSignal(NEWS_PATTERN, haystack);
  const hasHighRisk = taskType === 'high_risk' || includesSignal(HIGH_RISK_PATTERN, haystack);
  const hasRecencyWithFactualIntent = hasRecency && (hasFactual || isNews || hasCitationDemand);

  const reasons: string[] = [];
  if (hasHighRisk) reasons.push('high_risk_signal');
  if (hasRecency) reasons.push('recency_signal');
  if (hasFactual) reasons.push('factual_signal');
  if (hasCitationDemand) reasons.push('citation_required');
  if (isNews) reasons.push('news_signal');

  const policy: GroundingPolicy = hasHighRisk
    ? 'high_risk_factual'
    : hasRecencyWithFactualIntent || hasFactual || hasCitationDemand || isNews || taskType === 'radar_review'
      ? 'dynamic_factual'
      : 'static';

  return {
    policy,
    requiresGrounding: policy !== 'static',
    reasons,
    signals: {
      recency: hasRecency,
      factual: hasFactual,
      citations: hasCitationDemand,
      highRisk: hasHighRisk,
      news: isNews
    }
  };
}

export function toGroundingUnavailableCode(decision: GroundingDecision): 'NEWS_BRIEFING_UNAVAILABLE' | 'GROUNDED_RETRIEVAL_UNAVAILABLE' {
  return decision.signals.news ? 'NEWS_BRIEFING_UNAVAILABLE' : 'GROUNDED_RETRIEVAL_UNAVAILABLE';
}

export function buildGroundingUnavailableMessage(decision: GroundingDecision): string {
  if (decision.signals.news) {
    return [
      '현재 뉴스 브리핑을 실행할 수 없습니다.',
      '외부 뉴스 품질 provider(OpenAI/Gemini/Anthropic)가 연결되어 있지 않아 신뢰 가능한 최신 브리핑을 생성할 수 없습니다.',
      '설정 > Providers에서 API 키를 연결한 뒤 다시 요청하세요.'
    ].join('\n');
  }

  return [
    '현재 최신성/사실성 검증이 필요한 요청을 실행할 수 없습니다.',
    '외부 grounding provider(OpenAI/Gemini/Anthropic)가 연결되어 있지 않아 근거 기반 응답을 생성할 수 없습니다.',
    '설정 > Providers에서 API 키를 연결한 뒤 다시 요청하세요.'
  ].join('\n');
}
