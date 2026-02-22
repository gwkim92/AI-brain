import type { AppEnv } from '../config/env';

import { AnthropicProvider } from './adapters/anthropic-provider';
import { GeminiProvider } from './adapters/gemini-provider';
import { LocalProvider } from './adapters/local-provider';
import { OpenAIProvider } from './adapters/openai-provider';
import { ProviderRouter } from './router';

export function createProviderRouter(env: AppEnv): ProviderRouter {
  return new ProviderRouter({
    openai: new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      model: env.OPENAI_MODEL
    }),
    gemini: new GeminiProvider({
      apiKey: env.GEMINI_API_KEY,
      baseUrl: env.GEMINI_BASE_URL,
      model: env.GEMINI_MODEL
    }),
    anthropic: new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: env.ANTHROPIC_BASE_URL,
      model: env.ANTHROPIC_MODEL
    }),
    local: new LocalProvider({
      enabled: env.LOCAL_LLM_ENABLED,
      baseUrl: env.LOCAL_LLM_BASE_URL,
      model: env.LOCAL_LLM_MODEL,
      apiKey: env.LOCAL_LLM_API_KEY
    })
  });
}
