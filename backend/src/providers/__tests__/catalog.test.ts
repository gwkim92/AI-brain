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
    PROVIDER_USER_CREDENTIALS_ENABLED: true,
    PROVIDER_OAUTH_OPENAI_ENABLED: false,
    PROVIDER_OAUTH_GEMINI_ENABLED: false,
    PROVIDER_TOKEN_REFRESH_WORKER_ENABLED: false,
    PROVIDER_TOKEN_REFRESH_WORKER_POLL_MS: 60000,
    PROVIDER_TOKEN_REFRESH_WORKER_BATCH: 100,
    PROVIDER_OAUTH_PUBLIC_CLIENT_FALLBACK: false,
    MODEL_CONTROL_ENABLED: true,
    MODEL_RECOMMENDER_ENABLED: true,
    AI_TRACE_LOGGING_ENABLED: true,
    AI_TRACE_RETENTION_DAYS: 30,
    MODEL_RECOMMENDER_PROVIDER: 'openai',
    MODEL_RECOMMENDER_MODEL: 'gpt-4.1-mini',
    JARVIS_SKILLS_ENABLED: true,
    JARVIS_WATCHER_WORKER_ENABLED: true,
    JARVIS_WATCHER_WORKER_POLL_MS: 120000,
    JARVIS_WATCHER_WORKER_BATCH: 20,
    RUNNER_ENABLED: false,
    RUNNER_POLL_INTERVAL_MS: 60000,
    RUNNER_REPO_ROOT: undefined,
    RUNNER_MAX_ATTEMPTS: 2,
    RUNNER_STALL_TERMINATE_ENABLED: true,
    RUNNER_LINEAR_DIRECT_ENABLED: false,
    RADAR_SCANNER_WORKER_ENABLED: true,
    RADAR_SCANNER_WORKER_POLL_MS: 300000,
    RADAR_SCANNER_WORKER_BATCH: 12,
    RADAR_SCANNER_FETCH_TIMEOUT_MS: 8000,
    INTELLIGENCE_SCANNER_WORKER_ENABLED: true,
    INTELLIGENCE_SCANNER_WORKER_POLL_MS: 300000,
    INTELLIGENCE_SCANNER_WORKER_BATCH: 10,
    INTELLIGENCE_SCANNER_FETCH_TIMEOUT_MS: 12000,
    INTELLIGENCE_SEMANTIC_WORKER_ENABLED: true,
    INTELLIGENCE_SEMANTIC_WORKER_POLL_MS: 120000,
    INTELLIGENCE_SEMANTIC_WORKER_BATCH: 60,
    INTELLIGENCE_STALE_MAINTENANCE_WORKER_ENABLED: true,
    INTELLIGENCE_STALE_MAINTENANCE_WORKER_POLL_MS: 600000,
    INTELLIGENCE_STALE_MAINTENANCE_WORKER_BATCH: 5,
    INTELLIGENCE_MODEL_SYNC_WORKER_ENABLED: true,
    INTELLIGENCE_MODEL_SYNC_WORKER_POLL_MS: 21600000,
    WORLD_MODEL_OUTCOME_WORKER_ENABLED: true,
    WORLD_MODEL_OUTCOME_WORKER_POLL_MS: 300000,
    WORLD_MODEL_OUTCOME_WORKER_BATCH: 20,
    WORKSPACE_DEVCONTAINER_ENABLED: true,
    WORKSPACE_DEVCONTAINER_IMAGE: 'node:24-alpine',
    WORKSPACE_DEVCONTAINER_WORKDIR: '/workspace',
    OPENAI_API_KEY: undefined,
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_MODEL: 'gpt-4.1-mini',
    OPENAI_WEBHOOK_SECRET: undefined,
    OPENAI_OAUTH_CLIENT_ID: undefined,
    OPENAI_OAUTH_CLIENT_SECRET: undefined,
    OPENAI_OAUTH_REDIRECT_URI: undefined,
    OPENAI_OAUTH_AUTH_URL: 'https://auth.openai.com/oauth/authorize',
    OPENAI_OAUTH_TOKEN_URL: 'https://auth.openai.com/oauth/token',
    OPENAI_OAUTH_SCOPES: 'openid profile email offline_access',
    OPENAI_OAUTH_GATEWAY_URL: 'https://chatgpt.com/backend-api/codex/responses',
    OPENAI_CODEX_MODEL_ALLOWLIST: 'gpt-5,gpt-5-mini,gpt-5-nano',
    GEMINI_API_KEY: undefined,
    GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com',
    GEMINI_MODEL: 'gemini-2.5-pro',
    GEMINI_OAUTH_CLIENT_ID: undefined,
    GEMINI_OAUTH_CLIENT_SECRET: undefined,
    GEMINI_OAUTH_REDIRECT_URI: undefined,
    GEMINI_OAUTH_AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
    GEMINI_OAUTH_TOKEN_URL: 'https://oauth2.googleapis.com/token',
    GEMINI_OAUTH_SCOPES: 'https://www.googleapis.com/auth/generative-language',
    GEMINI_OAUTH_GATEWAY_URL: 'https://cloudcode-pa.googleapis.com/v1/codeassist:generateContent',
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
    NOTIFICATION_WEBHOOK_ENABLED: false,
    NOTIFICATION_WEBHOOK_URL: undefined,
    NOTIFICATION_WEBHOOK_TIMEOUT_MS: 4000,
    NOTIFICATION_WEBHOOK_BEARER_TOKEN: undefined,
    NOTIFICATION_WEBHOOK_EVENT_TYPES: '*',
    NOTIFICATION_WEBHOOK_MIN_SEVERITY: 'critical',
    NOTIFICATION_TELEGRAM_ENABLED: false,
    NOTIFICATION_TELEGRAM_CHAT_ID: undefined,
    NOTIFICATION_TELEGRAM_EVENT_TYPES: '*',
    NOTIFICATION_TELEGRAM_MIN_SEVERITY: 'critical',
    MODEL_REGISTRY_REFRESH_MS: 300000,
    ROUTING_EXPLORATION_RATE: 0.05,
    V2_ROUTES_ENABLED: false,
    V2_COMMAND_COMPILER_ENABLED: false,
    V2_RETRIEVAL_ENABLED: false,
    V2_TEAM_ENABLED: false,
    V2_CODE_LOOP_ENABLED: false,
    V2_FINANCE_ENABLED: false,
    V2_SCHEMA_UI_ENABLED: false,
    BRAVE_API_KEY: undefined,
    CROSSREF_MAILTO: undefined,
    GITHUB_TOKEN: undefined,
    GITHUB_OWNER: undefined,
    GITHUB_REPO: undefined,
    LINEAR_API_KEY: undefined,
    LINEAR_BASE_URL: 'https://api.linear.app/graphql',
    LINEAR_TEAM_ID: undefined,
    LINEAR_PROJECT_ID: undefined,
    CODE_LOOP_LOCAL_EXEC_ENABLED: false,
    FRED_API_KEY: undefined,
    SEC_USER_AGENT: undefined,
    ALPHAVANTAGE_API_KEY: undefined,
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
