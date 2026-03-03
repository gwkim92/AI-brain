import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../config/env';
import { fetchProviderModelCatalog } from '../catalog';

function makeEnv(localModel: string): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    HOST: '127.0.0.1',
    DATABASE_URL: 'http://example.com',
    STORE_BACKEND: 'memory',
    DEFAULT_USER_ID: '00000000-0000-4000-8000-000000000001',
    DEFAULT_USER_EMAIL: 'jarvis-local@example.com',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    API_RATE_LIMIT_MAX: 200,
    API_RATE_LIMIT_WINDOW_SEC: 60,
    APPROVAL_MAX_AGE_HOURS: 24,
    AUTH_REQUIRED: false,
    AUTH_TOKEN: undefined,
    AUTH_ALLOW_SIGNUP: true,
    AUTH_SESSION_TTL_HOURS: 24,
    ADMIN_BOOTSTRAP_EMAIL: 'admin@jarvis.local',
    ADMIN_BOOTSTRAP_PASSWORD: 'Admin!234567',
    ADMIN_BOOTSTRAP_DISPLAY_NAME: 'Jarvis Admin',
    SECRETS_ENCRYPTION_KEY: 'jarvis-dev-secrets-key-change-me',
    HIGH_RISK_ALLOWED_ROLES: 'operator,admin',
    OPENAI_API_KEY: undefined,
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_MODEL: 'gpt-4.1-mini',
    OPENAI_WEBHOOK_SECRET: undefined,
    GEMINI_API_KEY: undefined,
    GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com',
    GEMINI_MODEL: 'gemini-2.5-pro',
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
    LOCAL_LLM_ENABLED: true,
    LOCAL_LLM_BASE_URL: 'http://127.0.0.1:11434',
    LOCAL_LLM_MODEL: localModel,
    LOCAL_LLM_API_KEY: undefined,
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_WEBHOOK_SECRET: undefined,
    TELEGRAM_REPORT_WORKER_ENABLED: true,
    TELEGRAM_REPORT_WORKER_POLL_MS: 1500,
    TELEGRAM_REPORT_WORKER_BATCH: 5,
    TELEGRAM_REPORT_MAX_ATTEMPTS: 3,
    TELEGRAM_REPORT_RETRY_BASE_MS: 2000,
    TELEGRAM_REPORT_RETRY_MAX_MS: 60000,
    MODEL_REGISTRY_REFRESH_MS: 300000,
    ROUTING_EXPLORATION_RATE: 0.05,
    allowedOrigins: ['http://localhost:3000'],
    highRiskAllowedRoles: ['operator', 'admin']
  };
}

describe('fetchProviderModelCatalog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recommends a chat-capable local model when configured model is missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [{ name: 'nomic-embed-text:latest' }, { name: 'qwen2.5:7b' }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const catalog = await fetchProviderModelCatalog(makeEnv('llama3.1:8b'));
    const local = catalog.find((entry) => entry.provider === 'local');

    expect(local).toBeDefined();
    expect(local?.configured_model).toBe('llama3.1:8b');
    expect(local?.recommended_model).toBe('qwen2.5:7b');
    expect(local?.models).toContain('llama3.1:8b');
    expect(local?.models).toContain('qwen2.5:7b');
  });
});
