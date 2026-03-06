import type { ModelControlFeatureKey } from '../store/types';
import type { ProviderName } from '../providers/types';

export type SkillId =
  | 'deep_research'
  | 'news_briefing'
  | 'repo_health_review'
  | 'incident_triage'
  | 'model_recommendation_reasoner';

export type SkillCategory = 'research' | 'operations' | 'code' | 'routing';
export type SkillExecutionKind = 'jarvis_request' | 'model_recommendation';
export type SkillResourceKind = 'guide' | 'checklist' | 'template';

export type SkillResourceRecord = {
  id: string;
  title: string;
  kind: SkillResourceKind;
  contentType: 'text/markdown';
  content: string;
};

export type SkillRecord = {
  id: SkillId;
  title: string;
  summary: string;
  category: SkillCategory;
  keywords: string[];
  executionKind: SkillExecutionKind;
  defaultFeatureKey?: ModelControlFeatureKey;
  suggestedWorkspacePreset: 'jarvis' | 'research' | 'execution' | 'control';
  suggestedWidgets: string[];
  resources: SkillResourceRecord[];
};

export type SkillMatchRecord = {
  skill: SkillRecord;
  score: number;
  reason: string;
  matchedTerms: string[];
};

export type SkillUsePreview = {
  skillId: SkillId;
  title: string;
  summary: string;
  executionKind: SkillExecutionKind;
  normalizedPrompt: string;
  suggestedPrompt: string;
  suggestedTitle: string;
  suggestedWorkspacePreset: SkillRecord['suggestedWorkspacePreset'];
  suggestedWidgets: string[];
  featureKey?: ModelControlFeatureKey;
  taskType?: string;
  providerOverride?: ProviderName | 'auto';
  modelOverride?: string;
  rationale: string;
};
