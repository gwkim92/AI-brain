import type { AppEnv } from '../config/env';

type ProviderModelCatalogEntry = {
  provider: 'openai' | 'gemini' | 'anthropic' | 'local';
  configured_model: string;
  recommended_model?: string;
  source: 'remote' | 'configured';
  models: string[];
  error?: string;
};

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeModelIds(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function localModelScore(model: string): number {
  const normalized = model.toLowerCase();
  let score = 0;
  if (/(embed|embedding|rerank|whisper|tts|transcribe|clip)/u.test(normalized)) {
    score -= 20;
  } else {
    score += 10;
  }
  if (/(chat|instruct)/u.test(normalized)) score += 3;
  if (/(qwen|llama|mistral|deepseek|gemma|mixtral|phi|yi|command-r)/u.test(normalized)) score += 2;
  return score;
}

function pickRecommendedLocalModel(configured: string, discoveredModels: string[]): string {
  if (discoveredModels.includes(configured)) {
    return configured;
  }
  if (discoveredModels.length === 0) {
    return configured;
  }
  const ranked = discoveredModels.slice().sort((left, right) => {
    const scoreDiff = localModelScore(right) - localModelScore(left);
    if (scoreDiff !== 0) return scoreDiff;
    return left.localeCompare(right);
  });
  return ranked[0] ?? configured;
}

async function fetchOpenAiModels(env: AppEnv): Promise<ProviderModelCatalogEntry> {
  const configured = env.OPENAI_MODEL;
  if (!env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      configured_model: configured,
      source: 'configured',
      models: [configured]
    };
  }

  try {
    const response = await fetch(`${stripTrailingSlash(env.OPENAI_BASE_URL)}/models`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`
      }
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`http ${response.status}: ${raw.slice(0, 240)}`);
    }

    const payload = JSON.parse(raw) as {
      data?: Array<{ id?: string }>;
    };

    const models = normalizeModelIds([configured, ...(payload.data ?? []).map((item) => item.id ?? '')]);
    return {
      provider: 'openai',
      configured_model: configured,
      source: 'remote',
      models
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      provider: 'openai',
      configured_model: configured,
      source: 'configured',
      models: [configured],
      error: message
    };
  }
}

async function fetchGeminiModels(env: AppEnv): Promise<ProviderModelCatalogEntry> {
  const configured = env.GEMINI_MODEL;
  if (!env.GEMINI_API_KEY) {
    return {
      provider: 'gemini',
      configured_model: configured,
      source: 'configured',
      models: [configured]
    };
  }

  try {
    const endpoint = `${stripTrailingSlash(env.GEMINI_BASE_URL)}/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
    const response = await fetch(endpoint, {
      method: 'GET'
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`http ${response.status}: ${raw.slice(0, 240)}`);
    }

    const payload = JSON.parse(raw) as {
      models?: Array<{ name?: string }>;
    };

    const models = normalizeModelIds([
      configured,
      ...(payload.models ?? []).map((item) => (item.name ?? '').replace(/^models\//, ''))
    ]);
    return {
      provider: 'gemini',
      configured_model: configured,
      source: 'remote',
      models
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      provider: 'gemini',
      configured_model: configured,
      source: 'configured',
      models: [configured],
      error: message
    };
  }
}

async function fetchAnthropicModels(env: AppEnv): Promise<ProviderModelCatalogEntry> {
  const configured = env.ANTHROPIC_MODEL;
  if (!env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      configured_model: configured,
      source: 'configured',
      models: [configured]
    };
  }

  try {
    const response = await fetch(`${stripTrailingSlash(env.ANTHROPIC_BASE_URL)}/v1/models`, {
      method: 'GET',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`http ${response.status}: ${raw.slice(0, 240)}`);
    }

    const payload = JSON.parse(raw) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ id?: string }>;
    };
    const modelRows = payload.data ?? payload.models ?? [];
    const models = normalizeModelIds([configured, ...modelRows.map((item) => item.id ?? '')]);

    return {
      provider: 'anthropic',
      configured_model: configured,
      source: 'remote',
      models
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      provider: 'anthropic',
      configured_model: configured,
      source: 'configured',
      models: [configured],
      error: message
    };
  }
}

async function fetchLocalModels(env: AppEnv): Promise<ProviderModelCatalogEntry> {
  const configured = env.LOCAL_LLM_MODEL;
  if (!env.LOCAL_LLM_ENABLED) {
    return {
      provider: 'local',
      configured_model: configured,
      recommended_model: configured,
      source: 'configured',
      models: [configured]
    };
  }

  try {
    const response = await fetch(`${stripTrailingSlash(env.LOCAL_LLM_BASE_URL)}/api/tags`, {
      method: 'GET',
      headers: env.LOCAL_LLM_API_KEY
        ? {
            authorization: `Bearer ${env.LOCAL_LLM_API_KEY}`
          }
        : undefined
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`http ${response.status}: ${raw.slice(0, 240)}`);
    }

    const payload = JSON.parse(raw) as {
      models?: Array<{ name?: string }>;
    };
    const discoveredModels = Array.from(
      new Set((payload.models ?? []).map((item) => (item.name ?? '').trim()).filter(Boolean))
    );
    const recommendedModel = pickRecommendedLocalModel(configured, discoveredModels);
    const models = normalizeModelIds([configured, ...discoveredModels]);

    return {
      provider: 'local',
      configured_model: configured,
      recommended_model: recommendedModel,
      source: 'remote',
      models
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      provider: 'local',
      configured_model: configured,
      recommended_model: configured,
      source: 'configured',
      models: [configured],
      error: message
    };
  }
}

export async function fetchProviderModelCatalog(env: AppEnv): Promise<ProviderModelCatalogEntry[]> {
  const [openai, gemini, anthropic, local] = await Promise.all([
    fetchOpenAiModels(env),
    fetchGeminiModels(env),
    fetchAnthropicModels(env),
    fetchLocalModels(env)
  ]);

  return [openai, gemini, anthropic, local];
}
