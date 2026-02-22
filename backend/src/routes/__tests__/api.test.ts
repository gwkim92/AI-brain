import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../server';

const ENV_SNAPSHOT = { ...process.env };

describe('API routes', () => {
  beforeEach(() => {
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PORT = '4001';
    process.env.LOCAL_LLM_ENABLED = 'false';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    process.env.OPENAI_WEBHOOK_SECRET = 'openai_secret';
  });

  afterEach(() => {
    process.env = { ...ENV_SNAPSHOT };
  });

  it('creates and lists tasks', async () => {
    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        mode: 'execute',
        title: 'Run radar sync',
        input: {
          force: true
        }
      }
    });

    expect(create.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?limit=20'
    });

    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: Array<{ title: string }> };
    expect(body.data[0]?.title).toBe('Run radar sync');

    await app.close();
  });

  it('ingests radar, evaluates items, and lists recommendations', async () => {
    const { app } = await buildServer();

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/v1/radar/ingest',
      payload: {
        source_name: 'test-suite',
        items: [
          {
            title: 'Candidate A',
            source_url: 'https://example.com/a',
            confidence_score: 0.9
          }
        ]
      }
    });

    expect(ingest.statusCode).toBe(202);

    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/items?limit=10'
    });
    expect(items.statusCode).toBe(200);

    const itemsBody = items.json() as { data: { items: Array<{ id: string }> } };
    const firstId = itemsBody.data.items[0]?.id;
    expect(firstId).toBeTruthy();

    const evaluate = await app.inject({
      method: 'POST',
      url: '/api/v1/radar/evaluate',
      payload: {
        item_ids: [firstId]
      }
    });

    expect(evaluate.statusCode).toBe(202);

    const recommendations = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/recommendations'
    });

    expect(recommendations.statusCode).toBe(200);
    const recBody = recommendations.json() as { data: { recommendations: Array<{ itemId: string }> } };
    expect(recBody.data.recommendations[0]?.itemId).toBe(firstId);

    await app.close();
  });

  it('enforces telegram webhook secret', async () => {
    const { app } = await buildServer();

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/telegram/webhook',
      payload: {
        message: {
          text: '작업 시작 test'
        }
      }
    });

    expect(denied.statusCode).toBe(401);

    await app.close();
  });

  it('returns provider availability list', async () => {
    const { app } = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/providers'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        providers: Array<{ provider: string; enabled: boolean; reason?: string }>;
      };
    };

    expect(body.data.providers.map((item) => item.provider)).toEqual(['openai', 'gemini', 'anthropic', 'local']);
    expect(body.data.providers.find((item) => item.provider === 'openai')?.enabled).toBe(false);
    expect(body.data.providers.find((item) => item.provider === 'local')).toMatchObject({
      provider: 'local',
      enabled: false,
      reason: 'disabled'
    });

    await app.close();
  });

  it('returns 503 when ai response is requested but all providers are unavailable', async () => {
    const { app } = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      payload: {
        prompt: 'hello'
      }
    });

    expect(response.statusCode).toBe(503);
    const body = response.json() as {
      error: {
        code: string;
        message: string;
        details?: {
          reason?: string;
        };
      };
    };

    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('all providers failed');
    expect(body.error.details?.reason).toContain('all providers failed');

    await app.close();
  });
});
