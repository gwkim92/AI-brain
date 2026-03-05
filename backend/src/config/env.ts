import { z } from 'zod';

const DEFAULT_ADMIN_BOOTSTRAP_PASSWORD = 'Admin!234567';
const DEFAULT_SECRETS_ENCRYPTION_KEY = 'jarvis-dev-secrets-key-change-me';

const EnvBooleanSchema = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().optional(),
  STORE_BACKEND: z.enum(['auto', 'memory', 'postgres']).default('auto'),
  DEFAULT_USER_ID: z
    .string()
    .uuid()
    .default('00000000-0000-4000-8000-000000000001'),
  DEFAULT_USER_EMAIL: z.string().email().default('jarvis-local@example.com'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(200),
  API_RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  APPROVAL_MAX_AGE_HOURS: z.coerce.number().min(0).default(24),
  AUTH_REQUIRED: EnvBooleanSchema.default(true),
  AUTH_TOKEN: z.string().optional(),
  AUTH_ALLOW_SIGNUP: EnvBooleanSchema.default(true),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().default('admin@jarvis.local'),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(8).max(200).default(DEFAULT_ADMIN_BOOTSTRAP_PASSWORD),
  ADMIN_BOOTSTRAP_DISPLAY_NAME: z.string().min(1).max(120).default('Jarvis Admin'),
  SECRETS_ENCRYPTION_KEY: z.string().min(16).default(DEFAULT_SECRETS_ENCRYPTION_KEY),
  HIGH_RISK_ALLOWED_ROLES: z.string().default('operator,admin'),
  PROVIDER_USER_CREDENTIALS_ENABLED: EnvBooleanSchema.default(true),
  PROVIDER_OAUTH_OPENAI_ENABLED: EnvBooleanSchema.default(false),
  PROVIDER_OAUTH_GEMINI_ENABLED: EnvBooleanSchema.default(false),
  PROVIDER_TOKEN_REFRESH_WORKER_ENABLED: EnvBooleanSchema.default(false),
  PROVIDER_TOKEN_REFRESH_WORKER_POLL_MS: z.coerce.number().int().min(1000).default(60000),
  PROVIDER_TOKEN_REFRESH_WORKER_BATCH: z.coerce.number().int().min(1).max(500).default(100),
  PROVIDER_OAUTH_PUBLIC_CLIENT_FALLBACK: EnvBooleanSchema.default(false),
  MODEL_CONTROL_ENABLED: EnvBooleanSchema.default(true),
  MODEL_RECOMMENDER_ENABLED: EnvBooleanSchema.default(true),
  AI_TRACE_LOGGING_ENABLED: EnvBooleanSchema.default(true),
  AI_TRACE_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  MODEL_RECOMMENDER_PROVIDER: z.enum(['openai']).default('openai'),
  MODEL_RECOMMENDER_MODEL: z.string().default('gpt-4.1-mini'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_WEBHOOK_SECRET: z.string().optional(),
  OPENAI_OAUTH_CLIENT_ID: z.string().optional(),
  OPENAI_OAUTH_CLIENT_SECRET: z.string().optional(),
  OPENAI_OAUTH_REDIRECT_URI: z.string().url().optional(),
  OPENAI_OAUTH_AUTH_URL: z.string().url().default('https://auth.openai.com/oauth/authorize'),
  OPENAI_OAUTH_TOKEN_URL: z.string().url().default('https://auth.openai.com/oauth/token'),
  OPENAI_OAUTH_SCOPES: z.string().default('openid profile email offline_access'),
  OPENAI_OAUTH_GATEWAY_URL: z.string().url().default('https://chatgpt.com/backend-api/codex/responses'),
  OPENAI_CODEX_MODEL_ALLOWLIST: z.string().default('gpt-5,gpt-5-mini,gpt-5-nano'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com'),
  GEMINI_MODEL: z.string().default('gemini-2.5-pro'),
  GEMINI_OAUTH_CLIENT_ID: z.string().optional(),
  GEMINI_OAUTH_CLIENT_SECRET: z.string().optional(),
  GEMINI_OAUTH_REDIRECT_URI: z.string().url().optional(),
  GEMINI_OAUTH_AUTH_URL: z.string().url().default('https://accounts.google.com/o/oauth2/v2/auth'),
  GEMINI_OAUTH_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
  GEMINI_OAUTH_SCOPES: z.string().default('https://www.googleapis.com/auth/generative-language'),
  GEMINI_OAUTH_GATEWAY_URL: z.string().url().default('https://cloudcode-pa.googleapis.com/v1/codeassist:generateContent'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  ANTHROPIC_MODEL: z.string().default('claude-3-7-sonnet-latest'),

  LOCAL_LLM_ENABLED: EnvBooleanSchema.default(true),
  LOCAL_LLM_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  LOCAL_LLM_MODEL: z.string().default('qwen2.5:7b'),
  LOCAL_LLM_API_KEY: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_REPORT_WORKER_ENABLED: EnvBooleanSchema.default(true),
  TELEGRAM_REPORT_WORKER_POLL_MS: z.coerce.number().int().min(20).default(1500),
  TELEGRAM_REPORT_WORKER_BATCH: z.coerce.number().int().min(1).max(50).default(5),
  TELEGRAM_REPORT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  TELEGRAM_REPORT_RETRY_BASE_MS: z.coerce.number().int().min(100).default(2000),
  TELEGRAM_REPORT_RETRY_MAX_MS: z.coerce.number().int().min(200).default(60000),

  MODEL_REGISTRY_REFRESH_MS: z.coerce.number().int().min(10000).default(300000),
  ROUTING_EXPLORATION_RATE: z.coerce.number().min(0).max(1).default(0.05)
});

export type AppEnv = z.infer<typeof EnvSchema> & {
  allowedOrigins: string[];
  highRiskAllowedRoles: string[];
};

export function loadEnv(): AppEnv {
  const parsed = EnvSchema.parse(process.env);
  if (parsed.NODE_ENV === 'production') {
    if (parsed.ADMIN_BOOTSTRAP_PASSWORD === DEFAULT_ADMIN_BOOTSTRAP_PASSWORD) {
      throw new Error('Invalid production configuration: ADMIN_BOOTSTRAP_PASSWORD must be changed from default value.');
    }
    if (parsed.SECRETS_ENCRYPTION_KEY === DEFAULT_SECRETS_ENCRYPTION_KEY) {
      throw new Error('Invalid production configuration: SECRETS_ENCRYPTION_KEY must be changed from default value.');
    }
  }

  const allowedOrigins = parsed.ALLOWED_ORIGINS.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const highRiskAllowedRoles = parsed.HIGH_RISK_ALLOWED_ROLES.split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return {
    ...parsed,
    TELEGRAM_REPORT_RETRY_MAX_MS: Math.max(parsed.TELEGRAM_REPORT_RETRY_BASE_MS, parsed.TELEGRAM_REPORT_RETRY_MAX_MS),
    allowedOrigins,
    highRiskAllowedRoles
  };
}
