import type { ModelControlFeatureKey } from '../store/types';

import type {
  SkillId,
  SkillMatchRecord,
  SkillRecord,
  SkillResourceRecord,
  SkillUsePreview
} from './types';

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/gu, ' ').trim();
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function cloneResources(records: SkillResourceRecord[]): SkillResourceRecord[] {
  return records.map((record) => ({ ...record }));
}

const SKILL_REGISTRY: Record<SkillId, SkillRecord> = {
  deep_research: {
    id: 'deep_research',
    title: 'Deep Research',
    summary: 'Grounded research dossier with citations, freshness checks, and conflict surfacing.',
    category: 'research',
    executionKind: 'jarvis_request',
    defaultFeatureKey: 'assistant_chat',
    suggestedWorkspacePreset: 'research',
    suggestedWidgets: ['dossier', 'watchers', 'assistant', 'notifications'],
    keywords: ['research', 'analyze', 'compare', 'deep dive', '조사', '분석', '비교', '근거', '인용', '리서치'],
    resources: cloneResources([
      {
        id: 'playbook',
        title: 'Research Playbook',
        kind: 'guide',
        contentType: 'text/markdown',
        content: [
          '# Deep Research Playbook',
          '',
          '- 최신성, 출처 다양성, 상충 지점 확인을 기본값으로 둔다.',
          '- 요약만 만들지 말고 claim-source 연결을 남긴다.',
          '- 결론보다 근거 품질을 먼저 평가한다.'
        ].join('\n')
      },
      {
        id: 'output_contract',
        title: 'Dossier Output Contract',
        kind: 'template',
        contentType: 'text/markdown',
        content: [
          '# Dossier Output Contract',
          '',
          '1. Executive summary',
          '2. Key claims with citations',
          '3. Source freshness and coverage',
          '4. Conflicts / unresolved points',
          '5. Suggested next actions'
        ].join('\n')
      }
    ])
  },
  news_briefing: {
    id: 'news_briefing',
    title: 'News Briefing',
    summary: 'Fast grounded briefing for current events with freshness bias and citation coverage.',
    category: 'research',
    executionKind: 'jarvis_request',
    defaultFeatureKey: 'assistant_chat',
    suggestedWorkspacePreset: 'research',
    suggestedWidgets: ['dossier', 'watchers', 'notifications', 'reports'],
    keywords: ['news', 'briefing', 'headline', 'war', '속보', '뉴스', '브리핑', '헤드라인', '전쟁'],
    resources: cloneResources([
      {
        id: 'briefing_checklist',
        title: 'Briefing Checklist',
        kind: 'checklist',
        contentType: 'text/markdown',
        content: [
          '# News Briefing Checklist',
          '',
          '- 7일 이내 출처 비중 확인',
          '- 주요 지역/이해관계자 누락 여부 확인',
          '- 상충 보도 존재 시 분리 표기',
          '- 추정과 확인 사실을 구분'
        ].join('\n')
      }
    ])
  },
  repo_health_review: {
    id: 'repo_health_review',
    title: 'Repo Health Review',
    summary: 'Review CI stability, flaky tests, dependency drift, and propose approval-gated remediation.',
    category: 'code',
    executionKind: 'jarvis_request',
    defaultFeatureKey: 'mission_plan_generation',
    suggestedWorkspacePreset: 'execution',
    suggestedWidgets: ['assistant', 'tasks', 'action_center', 'workbench'],
    keywords: ['repo', 'ci', 'flaky', 'test', 'dependency', 'drift', 'repository', '워크트리', '레포', '테스트', '배포'],
    resources: cloneResources([
      {
        id: 'review_axes',
        title: 'Review Axes',
        kind: 'guide',
        contentType: 'text/markdown',
        content: [
          '# Repo Health Review Axes',
          '',
          '- Build stability',
          '- Test flakiness',
          '- Dependency drift and security updates',
          '- Release friction and rollback readiness',
          '- Required approvals before code execution'
        ].join('\n')
      }
    ])
  },
  incident_triage: {
    id: 'incident_triage',
    title: 'Incident Triage',
    summary: 'Structure outage or auth incidents into impact, blast radius, mitigation, and approval-gated action plan.',
    category: 'operations',
    executionKind: 'jarvis_request',
    defaultFeatureKey: 'mission_plan_generation',
    suggestedWorkspacePreset: 'control',
    suggestedWidgets: ['assistant', 'action_center', 'notifications', 'tasks'],
    keywords: ['incident', 'outage', 'auth', 'failure', 'triage', '장애', '오류', '인증', '원인', '긴급'],
    resources: cloneResources([
      {
        id: 'triage_template',
        title: 'Incident Triage Template',
        kind: 'template',
        contentType: 'text/markdown',
        content: [
          '# Incident Triage Template',
          '',
          '1. Symptom',
          '2. Impact / blast radius',
          '3. Likely causes',
          '4. Immediate mitigation options',
          '5. Approval-gated next actions'
        ].join('\n')
      }
    ])
  },
  model_recommendation_reasoner: {
    id: 'model_recommendation_reasoner',
    title: 'Model Recommendation Reasoner',
    summary: 'Recommend the best provider/model pair with rationale and keep apply as a separate user decision.',
    category: 'routing',
    executionKind: 'model_recommendation',
    defaultFeatureKey: 'assistant_chat',
    suggestedWorkspacePreset: 'control',
    suggestedWidgets: ['model_control', 'notifications', 'assistant'],
    keywords: ['model', 'provider', 'routing', 'recommendation', 'oauth', 'api key', '모델', '프로바이더', '추천', '라우팅'],
    resources: cloneResources([
      {
        id: 'selection_policy',
        title: 'Selection Policy',
        kind: 'guide',
        contentType: 'text/markdown',
        content: [
          '# Model Selection Policy',
          '',
          '- 요청 성격에 따라 feature별로 모델을 분리한다.',
          '- 자동 추천은 근거를 남기고, 적용은 사용자가 확정한다.',
          '- provider/model 선택은 credential source와 분리해서 본다.'
        ].join('\n')
      }
    ])
  }
};

function buildAugmentedPrompt(skillId: SkillId, prompt: string): string {
  const normalized = normalizePrompt(prompt);
  switch (skillId) {
    case 'deep_research':
      return [
        normalized,
        '',
        '요구사항:',
        '1. 최신 근거와 인용을 우선한다.',
        '2. 핵심 주장별 출처 연결을 남긴다.',
        '3. 상충되는 정보가 있으면 분리 표기한다.',
        '4. 마지막에 다음 액션을 제안한다.'
      ].join('\n');
    case 'news_briefing':
      return [
        normalized,
        '',
        '요구사항:',
        '1. 최신 뉴스 중심으로 브리핑한다.',
        '2. 지역/주체별 핵심 변화와 전개를 요약한다.',
        '3. 출처와 최신성 신호를 같이 남긴다.'
      ].join('\n');
    case 'repo_health_review':
      return [
        normalized,
        '',
        '요구사항:',
        '1. CI 안정성, flaky test, dependency drift, 운영 리스크를 점검한다.',
        '2. 수정 제안은 만들되 실행은 승인 전까지 하지 않는다.',
        '3. 승인 필요한 액션과 즉시 가능한 read-only 점검을 구분한다.'
      ].join('\n');
    case 'incident_triage':
      return [
        normalized,
        '',
        '요구사항:',
        '1. 증상, 영향 범위, 추정 원인, 즉시 완화책을 구조화한다.',
        '2. 승인이 필요한 변경/실행은 별도 액션으로 분리한다.',
        '3. 운영 알림과 후속 점검 항목을 정리한다.'
      ].join('\n');
    case 'model_recommendation_reasoner':
      return normalized;
  }
}

function buildSuggestedTitle(skill: SkillRecord, prompt: string): string {
  const normalized = normalizePrompt(prompt);
  return normalized ? `${skill.title}: ${normalized.slice(0, 72)}` : skill.title;
}

export function listSkills(): SkillRecord[] {
  return Object.values(SKILL_REGISTRY).map((skill) => ({ ...skill, resources: cloneResources(skill.resources) }));
}

export function getSkill(skillId: string): SkillRecord | null {
  if (!(skillId in SKILL_REGISTRY)) return null;
  const skill = SKILL_REGISTRY[skillId as SkillId];
  return { ...skill, resources: cloneResources(skill.resources) };
}

export function getSkillResource(skillId: string, resourceId: string): SkillResourceRecord | null {
  const skill = getSkill(skillId);
  if (!skill) return null;
  return skill.resources.find((resource) => resource.id === resourceId) ?? null;
}

export function findSkills(prompt: string, limit = 5): SkillMatchRecord[] {
  const normalized = normalizePrompt(prompt).toLowerCase();
  const promptTokens = new Set(
    normalized
      .split(/[^a-z0-9가-힣]+/iu)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );

  const matches = listSkills()
    .map((skill) => {
      const matchedTerms = skill.keywords
        .map((keyword) => normalizeKeyword(keyword))
        .filter((keyword) => normalized.includes(keyword) || promptTokens.has(keyword));
      const score =
        matchedTerms.length * 20 +
        (skill.category === 'research' && /(news|briefing|research|조사|뉴스|브리핑|리서치)/iu.test(normalized) ? 8 : 0) +
        (skill.category === 'code' && /(repo|ci|test|code|레포|코드|테스트)/iu.test(normalized) ? 8 : 0) +
        (skill.category === 'operations' && /(incident|outage|auth|장애|인증|오류)/iu.test(normalized) ? 8 : 0) +
        (skill.category === 'routing' && /(model|provider|routing|모델|프로바이더|추천)/iu.test(normalized) ? 8 : 0);
      return {
        skill,
        score,
        matchedTerms,
        reason:
          matchedTerms.length > 0
            ? `matched keywords: ${matchedTerms.slice(0, 4).join(', ')}`
            : `fallback by ${skill.category} category bias`
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.title.localeCompare(right.skill.title))
    .slice(0, Math.max(1, Math.min(limit, 20)));

  if (matches.length > 0) return matches;

  const fallback = /(news|briefing|war|뉴스|브리핑|전쟁)/iu.test(normalized)
    ? SKILL_REGISTRY.news_briefing
    : /(repo|ci|test|incident|장애|레포|테스트)/iu.test(normalized)
      ? SKILL_REGISTRY.repo_health_review
      : SKILL_REGISTRY.deep_research;

  return [
    {
      skill: { ...fallback, resources: cloneResources(fallback.resources) },
      score: 1,
      matchedTerms: [],
      reason: 'fallback recommendation'
    }
  ];
}

export function buildSkillUsePreview(input: {
  skillId: SkillId;
  prompt: string;
  featureKey?: ModelControlFeatureKey;
  provider?: 'auto' | 'openai' | 'gemini' | 'anthropic' | 'local';
  model?: string;
}): SkillUsePreview {
  const skill = SKILL_REGISTRY[input.skillId];
  const normalizedPrompt = normalizePrompt(input.prompt);
  return {
    skillId: skill.id,
    title: skill.title,
    summary: skill.summary,
    executionKind: skill.executionKind,
    normalizedPrompt,
    suggestedPrompt: buildAugmentedPrompt(skill.id, normalizedPrompt),
    suggestedTitle: buildSuggestedTitle(skill, normalizedPrompt),
    suggestedWorkspacePreset: skill.suggestedWorkspacePreset,
    suggestedWidgets: [...skill.suggestedWidgets],
    featureKey: input.featureKey ?? skill.defaultFeatureKey,
    taskType:
      skill.id === 'repo_health_review'
        ? 'code'
        : skill.id === 'incident_triage'
          ? 'high_risk'
          : skill.id === 'model_recommendation_reasoner'
            ? 'execute'
            : 'radar_review',
    providerOverride: input.provider,
    modelOverride: input.model?.trim() || undefined,
    rationale:
      skill.executionKind === 'model_recommendation'
        ? 'This skill routes into Model Control recommendations and keeps apply as a separate user action.'
        : 'This skill routes into Jarvis sessions so the output stays visible in the shared HUD flow.'
  };
}
