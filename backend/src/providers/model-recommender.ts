import { createHash } from 'node:crypto';

import type { AppEnv } from '../config/env';
import { redactSecretsInText } from '../lib/redaction';
import type { ModelControlFeatureKey } from '../store/types';

import { maskErrorForApi, type ProviderRouter } from './router';
import type { ProviderCredentialsByProvider, ProviderName } from './types';

export type ModelRecommendationDraft = {
  promptHash: string;
  promptExcerptRedacted: string;
  recommendedProvider: ProviderName;
  recommendedModelId: string;
  rationaleText: string;
  evidenceJson: Record<string, unknown>;
  recommenderProvider: 'openai';
};

function buildPromptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

function redactPromptExcerpt(prompt: string): string {
  return redactSecretsInText(prompt).slice(0, 600);
}

function fallbackByFeature(featureKey: ModelControlFeatureKey, env: AppEnv): {
  provider: ProviderName;
  modelId: string;
  rationale: string;
} {
  switch (featureKey) {
    case 'council_run':
      return {
        provider: 'anthropic',
        modelId: env.ANTHROPIC_MODEL,
        rationale: 'Council runs prioritize deliberation quality and contradiction analysis.'
      };
    case 'execution_compute':
      return {
        provider: 'gemini',
        modelId: env.GEMINI_MODEL,
        rationale: 'Compute-heavy prompts favor math/reasoning throughput.'
      };
    case 'execution_code':
      return {
        provider: 'openai',
        modelId: env.OPENAI_MODEL,
        rationale: 'Code generation paths default to highest reliability for patching and execution plans.'
      };
    case 'mission_execute_step':
      return {
        provider: 'openai',
        modelId: env.OPENAI_MODEL,
        rationale: 'Mission step execution balances reliability and tool-invocation compatibility.'
      };
    default:
      return {
        provider: 'openai',
        modelId: env.OPENAI_MODEL,
        rationale: 'Default fallback keeps predictable latency and response quality.'
      };
  }
}

function parseRecommendationOutput(raw: string): {
  provider: ProviderName;
  modelId: string;
  rationale: string;
  evidence: Record<string, unknown>;
} | null {
  const match = raw.match(/\{[\s\S]*\}/u);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]) as {
      provider?: unknown;
      model_id?: unknown;
      rationale?: unknown;
      evidence?: unknown;
    };
    const providerRaw = typeof parsed.provider === 'string' ? parsed.provider.trim().toLowerCase() : '';
    const modelId = typeof parsed.model_id === 'string' ? parsed.model_id.trim() : '';
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
    if (!modelId || !rationale) {
      return null;
    }
    if (providerRaw !== 'openai' && providerRaw !== 'gemini' && providerRaw !== 'anthropic' && providerRaw !== 'local') {
      return null;
    }
    const evidence =
      parsed.evidence && typeof parsed.evidence === 'object'
        ? (parsed.evidence as Record<string, unknown>)
        : {};
    return {
      provider: providerRaw,
      modelId,
      rationale,
      evidence
    };
  } catch {
    return null;
  }
}

export async function recommendModelForPrompt(input: {
  env: AppEnv;
  providerRouter: ProviderRouter;
  featureKey: ModelControlFeatureKey;
  taskType: string;
  prompt: string;
  credentialsByProvider?: ProviderCredentialsByProvider;
  traceId?: string;
}): Promise<ModelRecommendationDraft> {
  const promptHash = buildPromptHash(input.prompt);
  const promptExcerptRedacted = redactPromptExcerpt(input.prompt);
  const fallback = fallbackByFeature(input.featureKey, input.env);

  if (!input.env.MODEL_RECOMMENDER_ENABLED) {
    return {
      promptHash,
      promptExcerptRedacted,
      recommendedProvider: fallback.provider,
      recommendedModelId: fallback.modelId,
      rationaleText: fallback.rationale,
      evidenceJson: {
        method: 'rules_fallback',
        feature_key: input.featureKey,
        task_type: input.taskType,
        recommender_enabled: false
      },
      recommenderProvider: 'openai'
    };
  }

  try {
    const result = await input.providerRouter.generate({
      prompt: [
        'Choose the best provider/model for this task.',
        `feature_key=${input.featureKey}`,
        `task_type=${input.taskType}`,
        `prompt_excerpt=${promptExcerptRedacted}`
      ].join('\n'),
      systemPrompt: [
        'You are a model routing assistant.',
        'Return only JSON.',
        'Schema: {"provider":"openai|gemini|anthropic|local","model_id":"string","rationale":"string","evidence":{"latency":"low|medium|high","quality":"low|medium|high","cost":"low|medium|high"}}'
      ].join(' '),
      provider: input.env.MODEL_RECOMMENDER_PROVIDER,
      strictProvider: true,
      model: input.env.MODEL_RECOMMENDER_MODEL,
      temperature: 0.2,
      maxOutputTokens: 400,
      taskType: 'execute',
      credentialsByProvider: input.credentialsByProvider,
      traceId: input.traceId
    });
    const parsed = parseRecommendationOutput(result.result.outputText);
    if (!parsed) {
      throw new Error('invalid_recommender_output');
    }

    return {
      promptHash,
      promptExcerptRedacted,
      recommendedProvider: parsed.provider,
      recommendedModelId: parsed.modelId,
      rationaleText: parsed.rationale,
      evidenceJson: {
        ...parsed.evidence,
        method: 'openai_recommender',
        recommender_model: input.env.MODEL_RECOMMENDER_MODEL,
        selected_provider: result.result.provider,
        selected_model: result.result.model
      },
      recommenderProvider: 'openai'
    };
  } catch (error) {
    return {
      promptHash,
      promptExcerptRedacted,
      recommendedProvider: fallback.provider,
      recommendedModelId: fallback.modelId,
      rationaleText: fallback.rationale,
      evidenceJson: {
        method: 'rules_fallback',
        fallback_reason: maskErrorForApi(error),
        feature_key: input.featureKey,
        task_type: input.taskType
      },
      recommenderProvider: 'openai'
    };
  }
}
