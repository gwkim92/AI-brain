import type { ProviderRouter } from '../providers/router';
import { classifyComplexity } from '../orchestrator/complexity';
import type { V2ExecutionContractRecord, V2RiskLevel, V2RoutingComplexity, V2RoutingIntent } from '../store/types';
import { runSemanticRouter } from './semantic-router';

type RuleRoutingResult = {
  intent: V2RoutingIntent;
  complexity: V2RoutingComplexity;
  confidence: {
    intent: number;
    contract: number;
  };
};

export type CompiledCommandResult = {
  contract: Omit<V2ExecutionContractRecord, 'id' | 'createdAt' | 'updatedAt'>;
  routing: {
    intent: V2RoutingIntent;
    complexity: V2RoutingComplexity;
    intentConfidence: number;
    contractConfidence: number;
    uncertainty: number;
  };
  clarification: {
    required: boolean;
    questions: string[];
  };
};

const CODE_PATTERN = /(코드|개발|버그|디버그|테스트|리팩토링|api|deploy|code|debug|test|refactor)/iu;
const RESEARCH_PATTERN = /(리서치|연구|근거|인용|분석|research|study|citation|compare)/iu;
const FINANCE_PATTERN = /(금융|주식|환율|거시|포트폴리오|finance|market|asset|stock|fx)/iu;
const NEWS_PATTERN = /(뉴스|속보|브리핑|헤드라인|news|headline|briefing)/iu;
const HIGH_RISK_PATTERN = /(결제|송금|환불|법률|의료|투자 조언|trading signal|payment|refund|legal|medical)/iu;

function inferRuleIntent(prompt: string): V2RoutingIntent {
  if (CODE_PATTERN.test(prompt)) return 'code';
  if (RESEARCH_PATTERN.test(prompt)) return 'research';
  if (FINANCE_PATTERN.test(prompt)) return 'finance';
  if (NEWS_PATTERN.test(prompt)) return 'news';
  return 'general';
}

function inferRuleRouting(prompt: string): RuleRoutingResult {
  const intent = inferRuleIntent(prompt);
  const complexity = classifyComplexity(prompt);
  const intentConfidence = intent === 'general' ? 0.58 : 0.74;
  const contractConfidence = complexity === 'complex' ? 0.62 : complexity === 'moderate' ? 0.7 : 0.78;
  return {
    intent,
    complexity,
    confidence: {
      intent: intentConfidence,
      contract: contractConfidence
    }
  };
}

function inferRisk(prompt: string): { level: V2RiskLevel; reasons: string[] } {
  if (HIGH_RISK_PATTERN.test(prompt)) {
    return {
      level: 'high',
      reasons: ['high_risk_signal']
    };
  }
  if (/(production|운영|live|real money|실거래)/iu.test(prompt)) {
    return {
      level: 'medium',
      reasons: ['production_or_real_world_impact']
    };
  }
  return {
    level: 'low',
    reasons: []
  };
}

function buildDefaultDeliverables(intent: V2RoutingIntent): Array<{ type: string; format: string }> {
  if (intent === 'code') return [{ type: 'code', format: 'diff' }];
  if (intent === 'research' || intent === 'news') return [{ type: 'report', format: 'markdown' }];
  if (intent === 'finance') return [{ type: 'analysis', format: 'markdown' }];
  return [{ type: 'response', format: 'markdown' }];
}

function inferDomainMix(intent: V2RoutingIntent, prompt: string): Record<string, number> {
  const base = {
    code: 0,
    research: 0,
    finance: 0,
    news: 0,
    general: 0
  };
  base[intent] = 0.75;

  if (CODE_PATTERN.test(prompt)) base.code += 0.25;
  if (RESEARCH_PATTERN.test(prompt)) base.research += 0.25;
  if (FINANCE_PATTERN.test(prompt)) base.finance += 0.25;
  if (NEWS_PATTERN.test(prompt)) base.news += 0.25;

  const sum = Object.values(base).reduce((acc, value) => acc + value, 0) || 1;
  const entries = Object.entries(base)
    .map(([key, value]) => [key, Math.round((value / sum) * 1000) / 1000] as [string, number])
    .filter((item): item is [string, number] => item[1] > 0);
  return Object.fromEntries(entries);
}

function buildGoal(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/gu, ' ');
  return normalized.length <= 300 ? normalized : `${normalized.slice(0, 297)}...`;
}

function defaultSuccessCriteria(intent: V2RoutingIntent): string[] {
  if (intent === 'code') return ['Provide a minimal safe patch', 'Explain verification steps'];
  if (intent === 'research' || intent === 'news') return ['Include sources', 'Provide concise synthesis'];
  if (intent === 'finance') return ['Include assumptions and risk caveats', 'Provide cited evidence'];
  return ['Provide an actionable response'];
}

export async function compileCommand(
  providerRouter: ProviderRouter,
  userId: string,
  prompt: string
): Promise<CompiledCommandResult> {
  const trimmedPrompt = prompt.trim();
  const rule = inferRuleRouting(trimmedPrompt);
  const semantic = await runSemanticRouter(providerRouter, trimmedPrompt);

  const intent = semantic?.intent ?? rule.intent;
  const complexity = semantic?.complexity ?? rule.complexity;
  const goal = semantic?.goal ?? buildGoal(trimmedPrompt);
  const successCriteria = semantic?.successCriteria?.length ? semantic.successCriteria : defaultSuccessCriteria(intent);
  const constraints = semantic?.constraints ?? {};
  const inferredRisk = inferRisk(trimmedPrompt);
  const risk = semantic?.risk ?? inferredRisk;
  const deliverables = semantic?.deliverables?.length ? semantic.deliverables : buildDefaultDeliverables(intent);
  const domainMix = inferDomainMix(intent, trimmedPrompt);
  const intentConfidence = semantic?.confidence.intent ?? rule.confidence.intent;
  const contractConfidence = semantic?.confidence.contract ?? rule.confidence.contract;
  const uncertainty = Number((1 - Math.min(intentConfidence, contractConfidence)).toFixed(3));
  const clarificationQuestions =
    uncertainty > 0.45
      ? (semantic?.clarifyingQuestions?.length
          ? semantic.clarifyingQuestions
          : [
              'What is the exact expected output format?',
              'Are there hard constraints (deadline, budget, tools) to enforce?'
            ])
      : [];

  return {
    contract: {
      userId,
      prompt: trimmedPrompt,
      goal,
      successCriteria,
      constraints,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
      deliverables,
      domainMix,
      intent,
      complexity,
      intentConfidence,
      contractConfidence,
      uncertainty,
      clarificationQuestions
    },
    routing: {
      intent,
      complexity,
      intentConfidence,
      contractConfidence,
      uncertainty
    },
    clarification: {
      required: uncertainty > 0.45,
      questions: clarificationQuestions.slice(0, 2)
    }
  };
}
