import { randomUUID } from 'node:crypto';

import { createExecutionGraphFromPlan } from '../graph-runtime/graph';

export type ComplexityLevel = 'simple' | 'moderate' | 'complex';

const MULTI_STEP_KEYWORDS =
  /그리고|그 다음|이후에|먼저.*그 다음|첫째.*둘째|then|after that|and also|first.*then|next|subsequently|finally|step \d|phase \d/i;

const ENUMERATION_PATTERN = /(?:^|\n)\s*(?:\d+[.)]\s|[-*]\s)/m;

const DOMAIN_CODE = /코드|개발|버그|api|code|debug|refactor|test|deploy|build/i;
const DOMAIN_RESEARCH = /리서치|연구|논문|분석|research|study|analyze|compare/i;
const DOMAIN_DATA = /데이터|차트|그래프|통계|금융|주식|data|chart|statistic|finance|market/i;

export function classifyComplexity(prompt: string): ComplexityLevel {
  const trimmed = prompt.trim();
  if (!trimmed) return 'simple';

  let score = 0;

  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 80) score += 2;
  else if (wordCount > 30) score += 1;

  const sentenceCount = trimmed.split(/[.!?。？！]\s*/).filter(Boolean).length;
  if (sentenceCount > 5) score += 1;

  if (MULTI_STEP_KEYWORDS.test(trimmed)) score += 2;

  if (ENUMERATION_PATTERN.test(trimmed)) {
    const bulletCount = (trimmed.match(/(?:^|\n)\s*(?:\d+[.)]\s|[-*]\s)/gm) ?? []).length;
    if (bulletCount >= 3) score += 2;
    else score += 1;
  }

  const domainCount = [DOMAIN_CODE, DOMAIN_RESEARCH, DOMAIN_DATA].filter((re) => re.test(trimmed)).length;
  if (domainCount >= 2) score += 2;

  if (score >= 4) return 'complex';
  if (score >= 2) return 'moderate';
  return 'simple';
}

export function buildSimplePlan(prompt: string) {
  const steps = [
    {
      id: randomUUID(),
      type: 'llm_generate' as const,
      taskType: 'execute',
      title: 'Execute request',
      description: prompt,
      order: 1,
      dependencies: []
    }
  ];

  return {
    title: prompt.slice(0, 80),
    objective: prompt,
    domain: 'mixed',
    graph: createExecutionGraphFromPlan({
      title: prompt.slice(0, 80),
      objective: prompt,
      domain: 'mixed',
      steps: steps.map((step) => ({
        ...step,
        route: '/api/v1/tasks'
      }))
    }),
    steps
  };
}
