import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../server';

const ENV_SNAPSHOT = { ...process.env };

describe('Model control routing integration', () => {
  beforeEach(() => {
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PORT = '4011';
    process.env.AUTH_REQUIRED = 'false';
    process.env.AUTH_TOKEN = 'test_auth_token';
    process.env.HIGH_RISK_ALLOWED_ROLES = 'operator,admin';
    process.env.LOCAL_LLM_ENABLED = 'true';
    process.env.LOCAL_LLM_BASE_URL = 'http://127.0.0.1:11434';
    process.env.LOCAL_LLM_MODEL = 'qwen2.5:7b';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.TELEGRAM_REPORT_WORKER_ENABLED = 'false';
    process.env.PROVIDER_TOKEN_REFRESH_WORKER_ENABLED = 'false';
    process.env.AI_TRACE_LOGGING_ENABLED = 'true';
    process.env.MODEL_CONTROL_ENABLED = 'true';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ENV_SNAPSHOT };
  });

  it('persists orchestrator-managed preference and records requestProvider=auto in traces', async () => {
    const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/v1/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'local ok' } }],
            usage: { prompt_tokens: 12, completion_tokens: 8 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const preferenceUpsert = await app.inject({
      method: 'PUT',
      url: '/api/v1/model-control/preferences/assistant_chat',
      headers: {
        'x-user-id': userId
      },
      payload: {
        provider: 'openai',
        model: 'gpt-4.1',
        strict_provider: true,
        selection_mode: 'auto'
      }
    });
    expect(preferenceUpsert.statusCode).toBe(200);
    const preferenceBody = preferenceUpsert.json() as {
      data: {
        provider: string;
        modelId: string | null;
        strictProvider: boolean;
        selectionMode: 'auto' | 'manual';
      };
    };
    expect(preferenceBody.data.selectionMode).toBe('auto');
    expect(preferenceBody.data.provider).toBe('auto');
    expect(preferenceBody.data.modelId).toBeNull();
    expect(preferenceBody.data.strictProvider).toBe(false);

    const aiResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      headers: {
        'x-user-id': userId
      },
      payload: {
        prompt: 'simple ping'
      }
    });
    expect(aiResponse.statusCode).toBe(200);

    const tracesResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/model-control/traces?feature_key=assistant_chat&limit=10',
      headers: {
        'x-user-id': userId
      }
    });
    expect(tracesResponse.statusCode).toBe(200);
    const tracesBody = tracesResponse.json() as {
      data: {
        traces: Array<{
          requestProvider: string;
          requestModel: string | null;
          resolvedProvider: string | null;
        }>;
      };
    };
    expect(tracesBody.data.traces.length).toBeGreaterThan(0);
    expect(tracesBody.data.traces[0]?.requestProvider).toBe('auto');
    expect(tracesBody.data.traces[0]?.requestModel).toBeNull();
    expect(tracesBody.data.traces[0]?.resolvedProvider).toBe('local');

    await app.close();
  });
});
