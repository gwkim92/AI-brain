import { z } from 'zod';

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

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_WEBHOOK_SECRET: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com'),
  GEMINI_MODEL: z.string().default('gemini-2.5-pro'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  ANTHROPIC_MODEL: z.string().default('claude-3-7-sonnet-latest'),

  LOCAL_LLM_ENABLED: EnvBooleanSchema.default(true),
  LOCAL_LLM_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  LOCAL_LLM_MODEL: z.string().default('llama3.1:8b'),
  LOCAL_LLM_API_KEY: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional()
});

export type AppEnv = z.infer<typeof EnvSchema> & {
  allowedOrigins: string[];
};

export function loadEnv(): AppEnv {
  const parsed = EnvSchema.parse(process.env);

  const allowedOrigins = parsed.ALLOWED_ORIGINS.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    ...parsed,
    allowedOrigins
  };
}
