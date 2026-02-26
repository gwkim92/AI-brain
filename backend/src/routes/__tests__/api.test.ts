import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTelegramApprovalCallbackData, validateTelegramApprovalCallbackData } from '../../integrations/telegram/commands';
import { buildServer } from '../../server';

const ENV_SNAPSHOT = { ...process.env };

describe('API routes', () => {
  const waitFor = async <T>(
    fn: () => Promise<T>,
    options: {
      until: (value: T) => boolean;
      timeoutMs?: number;
      intervalMs?: number;
    }
  ): Promise<T> => {
    const timeoutMs = options.timeoutMs ?? 3_000;
    const intervalMs = options.intervalMs ?? 60;
    const startedAt = Date.now();

    while (true) {
      const value = await fn();
      if (options.until(value)) {
        return value;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('waitFor timed out');
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  };

  beforeEach(() => {
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PORT = '4001';
    process.env.LOCAL_LLM_ENABLED = 'false';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    process.env.TELEGRAM_REPORT_WORKER_ENABLED = 'true';
    process.env.TELEGRAM_REPORT_WORKER_POLL_MS = '25';
    process.env.TELEGRAM_REPORT_WORKER_BATCH = '5';
    process.env.TELEGRAM_REPORT_MAX_ATTEMPTS = '3';
    process.env.TELEGRAM_REPORT_RETRY_BASE_MS = '200';
    process.env.TELEGRAM_REPORT_RETRY_MAX_MS = '1000';
    process.env.OPENAI_WEBHOOK_SECRET = 'openai_secret';
    process.env.APPROVAL_MAX_AGE_HOURS = '24';
    process.env.AUTH_REQUIRED = 'false';
    process.env.AUTH_TOKEN = 'test_auth_token';
    process.env.HIGH_RISK_ALLOWED_ROLES = 'operator,admin';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it('returns memory snapshot rows', async () => {
    const { app } = await buildServer();

    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        mode: 'execute',
        title: 'Memory snapshot seed task',
        input: {
          source: 'test'
        }
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/memory/snapshot?limit=20'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        rows: Array<{ id: string; category: string; content: string }>;
        generated_at: string;
      };
    };

    expect(body.data.rows.length).toBeGreaterThan(0);
    expect(body.data.generated_at).toBeTruthy();
    expect(body.data.rows[0]?.id).toBeTruthy();
    expect(body.data.rows[0]?.category).toBeTruthy();
    expect(body.data.rows[0]?.content).toBeTruthy();

    await app.close();
  });

  it('creates, updates, and lists assistant contexts with events', async () => {
    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/contexts',
      payload: {
        client_context_id: 'ctx-quick-command-001',
        source: 'inbox_quick_command',
        intent: 'research',
        prompt: 'summarize ai service context persistence patterns',
        widget_plan: ['assistant', 'tasks']
      }
    });

    expect(create.statusCode).toBe(201);
    const created = create.json() as {
      data: {
        id: string;
        clientContextId: string;
        status: string;
        revision: number;
      };
      meta: {
        idempotent_replay?: boolean;
      };
    };

    expect(created.data.id).toBeTruthy();
    expect(created.data.clientContextId).toBe('ctx-quick-command-001');
    expect(created.data.status).toBe('running');
    expect(created.meta.idempotent_replay).toBe(false);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/contexts',
      payload: {
        client_context_id: 'ctx-quick-command-001',
        source: 'inbox_quick_command',
        intent: 'research',
        prompt: 'summarize ai service context persistence patterns',
        widget_plan: ['assistant', 'tasks']
      }
    });

    expect(replay.statusCode).toBe(200);
    const replayBody = replay.json() as { data: { id: string }; meta: { idempotent_replay?: boolean } };
    expect(replayBody.data.id).toBe(created.data.id);
    expect(replayBody.meta.idempotent_replay).toBe(true);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/assistant/contexts/${created.data.id}`,
      payload: {
        status: 'completed',
        served_provider: 'openai',
        served_model: 'gpt-4.1-mini',
        output: 'context should use hybrid local + durable server'
      }
    });

    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json() as {
      data: {
        status: string;
        servedProvider: string | null;
        output: string;
      };
    };
    expect(updatedBody.data.status).toBe('completed');
    expect(updatedBody.data.servedProvider).toBe('openai');
    expect(updatedBody.data.output).toContain('hybrid');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/assistant/contexts?limit=20'
    });

    expect(list.statusCode).toBe(200);
    const listed = list.json() as {
      data: {
        contexts: Array<{ id: string; status: string }>;
      };
    };
    expect(listed.data.contexts.length).toBeGreaterThanOrEqual(1);
    expect(listed.data.contexts[0]?.id).toBe(created.data.id);

    const events = await app.inject({
      method: 'GET',
      url: `/api/v1/assistant/contexts/${created.data.id}/events?limit=20`
    });

    expect(events.statusCode).toBe(200);
    const eventBody = events.json() as {
      data: {
        events: Array<{ eventType: string }>;
      };
    };
    expect(eventBody.data.events.length).toBeGreaterThanOrEqual(2);
    expect(eventBody.data.events.map((item) => item.eventType)).toContain('assistant.context.updated');

    await app.close();
  });

  it('runs assistant context asynchronously on backend and syncs linked task status', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: 'Assistant context background run completed.',
          usage: {
            input_tokens: 14,
            output_tokens: 21
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const createdTask = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        mode: 'execute',
        title: 'Background assistant context task',
        input: {
          source: 'test'
        }
      }
    });
    expect(createdTask.statusCode).toBe(201);
    const taskId = (createdTask.json() as { data: { id: string } }).data.id;

    const createContext = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/contexts',
      payload: {
        client_context_id: 'ctx-run-async-001',
        source: 'inbox_quick_command',
        intent: 'general',
        prompt: 'run context execution in backend',
        widget_plan: ['assistant', 'tasks'],
        task_id: taskId
      }
    });
    expect(createContext.statusCode).toBe(201);
    const contextId = (createContext.json() as { data: { id: string } }).data.id;

    const run = await app.inject({
      method: 'POST',
      url: `/api/v1/assistant/contexts/${contextId}/run`,
      payload: {
        provider: 'openai',
        strict_provider: true,
        task_type: 'execute'
      }
    });
    expect(run.statusCode).toBe(202);

    const settledContext = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/assistant/contexts/${contextId}`
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) {
            return false;
          }
          const body = response.json() as { data: { status: string } };
          return body.data.status === 'completed' || body.data.status === 'failed';
        }
      }
    );
    expect(settledContext.statusCode).toBe(200);
    const settledBody = settledContext.json() as {
      data: {
        status: string;
        servedProvider: string | null;
        output: string;
      };
    };
    expect(settledBody.data.status).toBe('completed');
    expect(settledBody.data.servedProvider).toBe('openai');
    expect(settledBody.data.output).toContain('background run');

    const settledTask = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/tasks/${taskId}`
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) {
            return false;
          }
          const body = response.json() as { data: { status: string } };
          return body.data.status === 'done' || body.data.status === 'failed';
        }
      }
    );
    expect(settledTask.statusCode).toBe(200);
    expect((settledTask.json() as { data: { status: string } }).data.status).toBe('done');

    const events = await app.inject({
      method: 'GET',
      url: `/api/v1/assistant/contexts/${contextId}/events?limit=20`
    });
    expect(events.statusCode).toBe(200);
    const eventBody = events.json() as {
      data: {
        events: Array<{ eventType: string }>;
      };
    };
    expect(eventBody.data.events.map((item) => item.eventType)).toContain('assistant.context.run.accepted');
    expect(eventBody.data.events.map((item) => item.eventType)).toContain('assistant.context.run.completed');

    const stream = await app.inject({
      method: 'GET',
      url: `/api/v1/assistant/contexts/${contextId}/events/stream`,
      headers: {
        origin: 'http://localhost:3000'
      }
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(stream.headers['access-control-allow-credentials']).toBe('true');
    expect(stream.body).toContain('event: stream.open');
    expect(stream.body).toContain('event: assistant.context.event');
    expect(stream.body).toContain('"eventType":"assistant.context.run.completed"');
    expect(stream.body).toContain('event: stream.close');

    expect(fetchMock).toHaveBeenCalled();

    await app.close();
  });

  it('returns reports overview metrics', async () => {
    const { app } = await buildServer();

    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        mode: 'chat',
        title: 'Reports seed task A',
        input: {
          source: 'test'
        }
      }
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        mode: 'code',
        title: 'Reports seed task B',
        input: {
          source: 'test'
        }
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/overview?task_limit=120&run_limit=80',
      headers: {
        'x-user-role': 'operator'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        sampled_limits: { task_limit: number; run_limit: number };
        tasks: {
          total: number;
          by_status: { queued: number };
          by_mode: { chat: number; code: number };
        };
        providers: {
          items: Array<{ provider: string }>;
        };
      };
    };

    expect(body.data.sampled_limits.task_limit).toBe(120);
    expect(body.data.sampled_limits.run_limit).toBe(80);
    expect(body.data.tasks.total).toBeGreaterThanOrEqual(2);
    expect(body.data.tasks.by_status.queued).toBeGreaterThanOrEqual(2);
    expect(body.data.tasks.by_mode.chat).toBeGreaterThanOrEqual(1);
    expect(body.data.tasks.by_mode.code).toBeGreaterThanOrEqual(1);
    expect(body.data.providers.items.map((item) => item.provider)).toEqual(['openai', 'gemini', 'anthropic', 'local']);

    await app.close();
  });

  it('returns settings overview with measured provider runtime metadata', async () => {
    const { app } = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/overview'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        providers: Array<{
          provider: string;
          attempts: number;
          avg_latency_ms: number;
        }>;
        policies: {
          approval_max_age_hours: number;
          provider_failover_auto: boolean;
          high_risk_requires_approval: boolean;
        };
      };
    };

    expect(body.data.providers.map((item) => item.provider)).toEqual(['openai', 'gemini', 'anthropic', 'local']);
    expect(body.data.providers.every((item) => typeof item.attempts === 'number')).toBe(true);
    expect(body.data.providers.every((item) => typeof item.avg_latency_ms === 'number')).toBe(true);
    expect(body.data.policies.high_risk_requires_approval).toBe(true);
    expect(body.data.policies.provider_failover_auto).toBe(true);
    expect(typeof body.data.policies.approval_max_age_hours).toBe('number');

    await app.close();
  });

  it('returns provider registry and policies for memory store', async () => {
    const { app } = await buildServer();

    const registry = await app.inject({
      method: 'GET',
      url: '/api/v1/providers/registry'
    });
    expect(registry.statusCode).toBe(200);
    const registryBody = registry.json() as {
      data: {
        models: unknown[];
        source?: string;
      };
    };
    expect(Array.isArray(registryBody.data.models)).toBe(true);
    expect(registryBody.data.source).toBe('memory_store');

    const policies = await app.inject({
      method: 'GET',
      url: '/api/v1/providers/policies'
    });
    expect(policies.statusCode).toBe(200);
    const policiesBody = policies.json() as {
      data: {
        policies: unknown[];
        source?: string;
      };
    };
    expect(Array.isArray(policiesBody.data.policies)).toBe(true);
    expect(policiesBody.data.source).toBe('memory_store');

    await app.close();
  });

  it('streams dashboard overview snapshots over SSE', async () => {
    const { app } = await buildServer();

    const stream = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/events?task_limit=20&pending_approval_limit=10&running_task_limit=10&poll_ms=3000&timeout_ms=1200',
      headers: {
        'x-user-role': 'operator',
        origin: 'http://localhost:3000'
      }
    });

    expect(stream.statusCode).toBe(200);
    expect(stream.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(stream.headers['access-control-allow-credentials']).toBe('true');
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.body).toContain('event: stream.open');
    expect(stream.body).toContain('event: dashboard.updated');
    expect(stream.body).toContain('event: stream.close');

    await app.close();
  });

  it('enforces bearer auth when AUTH_REQUIRED is enabled', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    const { app } = await buildServer();

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?limit=10'
    });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?limit=10',
      headers: {
        authorization: 'Bearer auth_token_for_test'
      }
    });
    expect(allowed.statusCode).toBe(200);

    await app.close();
  });

  it('supports signup, login, and session auth flow', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = '';
    process.env.AUTH_ALLOW_SIGNUP = 'true';
    process.env.AUTH_SESSION_TTL_HOURS = '24';
    const { app } = await buildServer();

    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'member@example.com',
        password: 'strong-pass-123',
        display_name: 'Member One'
      }
    });
    expect(signup.statusCode).toBe(201);
    const signupBody = signup.json() as {
      data: {
        token: string;
        user: {
          email: string;
          role: string;
        };
      };
    };
    expect(signupBody.data.token.length).toBeGreaterThan(20);
    expect(signupBody.data.user.email).toBe('member@example.com');
    expect(signupBody.data.user.role).toBe('member');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${signupBody.data.token}`
      }
    });
    expect(me.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'member@example.com',
        password: 'strong-pass-123'
      }
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json() as { data: { token: string } };

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        authorization: `Bearer ${loginBody.data.token}`
      }
    });
    expect(logout.statusCode).toBe(200);
    const logoutBody = logout.json() as { data: { revoked: boolean } };
    expect(logoutBody.data.revoked).toBe(true);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${loginBody.data.token}`
      }
    });
    expect(afterLogout.statusCode).toBe(401);

    await app.close();
  });

  it('blocks member role from operator-only endpoints', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = '';
    process.env.AUTH_ALLOW_SIGNUP = 'true';
    const { app } = await buildServer();

    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'member-role@example.com',
        password: 'strong-pass-123'
      }
    });
    expect(signup.statusCode).toBe(201);
    const token = (signup.json() as { data: { token: string } }).data.token;

    const deniedReports = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/overview',
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(deniedReports.statusCode).toBe(403);

    const spoofedReports = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/overview',
      headers: {
        authorization: `Bearer ${token}`,
        'x-user-role': 'admin',
        'x-user-id': '00000000-0000-4000-8000-000000000001'
      }
    });
    expect(spoofedReports.statusCode).toBe(403);

    const deniedRadar = await app.inject({
      method: 'POST',
      url: '/api/v1/radar/ingest',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        source_name: 'member-denied',
        items: [
          {
            title: 'Denied',
            source_url: 'https://example.com/denied',
            confidence_score: 0.7
          }
        ]
      }
    });
    expect(deniedRadar.statusCode).toBe(403);

    await app.close();
  });

  it('bootstraps dedicated admin account from env defaults', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = '';
    process.env.ADMIN_BOOTSTRAP_EMAIL = 'admin@jarvis.local';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'Admin!234567';
    process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME = 'Jarvis Admin';
    const { app } = await buildServer();

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@jarvis.local',
        password: 'Admin!234567'
      }
    });

    expect(login.statusCode).toBe(200);
    const body = login.json() as {
      data: {
        token: string;
        user: {
          role: string;
          email: string;
        };
      };
    };
    expect(body.data.token.length).toBeGreaterThan(20);
    expect(body.data.user.role).toBe('admin');
    expect(body.data.user.email).toBe('admin@jarvis.local');

    await app.close();
  });

  it('supports provider credential connection testing for admin', async () => {
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'false';

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/models')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 'gpt-5' }, { id: 'gpt-4.1-mini' }]
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      }

      return new Response(JSON.stringify({}), {
        status: 404,
        headers: {
          'content-type': 'application/json'
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const noKeyTest = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/providers/credentials/openai/test',
      headers: {
        'x-user-role': 'admin'
      }
    });
    expect(noKeyTest.statusCode).toBe(200);
    const noKeyBody = noKeyTest.json() as {
      data: {
        ok: boolean;
        reason?: string;
      };
    };
    expect(noKeyBody.data.ok).toBe(false);
    expect(noKeyBody.data.reason ?? '').toContain('missing_api_key');

    const upsert = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/providers/credentials/openai',
      headers: {
        'x-user-role': 'admin'
      },
      payload: {
        api_key: 'openai-test-key'
      }
    });
    expect(upsert.statusCode).toBe(200);

    const successTest = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/providers/credentials/openai/test',
      headers: {
        'x-user-role': 'admin'
      }
    });
    expect(successTest.statusCode).toBe(200);
    const successBody = successTest.json() as {
      data: {
        ok: boolean;
        provider: string;
        model_count: number;
        sampled_models: string[];
      };
    };
    expect(successBody.data.ok).toBe(true);
    expect(successBody.data.provider).toBe('openai');
    expect(successBody.data.model_count).toBeGreaterThan(0);
    expect(successBody.data.sampled_models).toContain('gpt-5');
    expect(fetchMock).toHaveBeenCalled();

    await app.close();
  });

  it('creates council run with dedicated endpoint', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          output_text: 'Council synthesis output',
          usage: {
            input_tokens: 12,
            output_tokens: 24
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/councils/runs',
      headers: {
        'idempotency-key': 'idem-council-001',
        'x-trace-id': 'trace-council-001'
      },
      payload: {
        question: 'Should we split monolith into services?',
        create_task: true
      }
    });

    expect(create.statusCode).toBe(202);
    const createBody = create.json() as {
      data: {
        id: string;
        summary: string;
        consensus_status: string;
        participants: Array<{ role: string }>;
        task_id: string | null;
      };
    };

    expect(createBody.data.id).toBeTruthy();
    expect(createBody.data.summary).toContain('started');
    expect(createBody.data.task_id).toBeTruthy();

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/councils/runs',
      headers: {
        'idempotency-key': 'idem-council-001',
        'x-trace-id': 'trace-council-001'
      },
      payload: {
        question: 'Should we split monolith into services?',
        create_task: true
      }
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { data: { id: string } }).data.id).toBe(createBody.data.id);

    const getOneSettled = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/councils/runs/${createBody.data.id}`
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) {
            return false;
          }
          const body = response.json() as { data: { status: string } };
          return body.data.status === 'completed' || body.data.status === 'failed';
        }
      }
    );

    expect(getOneSettled.statusCode).toBe(200);
    const settledRun = getOneSettled.json() as { data: { status: string; summary: string; participants: Array<unknown> } };
    expect(settledRun.data.status).toBe('completed');
    expect(settledRun.data.summary).toContain('Council synthesis output');
    expect(settledRun.data.participants.length).toBeGreaterThan(0);

    const councilTask = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/tasks/${createBody.data.task_id}`
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) {
            return false;
          }
          const body = response.json() as { data: { status: string } };
          return body.data.status === 'done' || body.data.status === 'failed';
        }
      }
    );
    expect(councilTask.statusCode).toBe(200);
    expect((councilTask.json() as { data: { status: string } }).data.status).toBe('done');

    const councilTaskEvents = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${createBody.data.task_id}/events`
    });
    expect(councilTaskEvents.statusCode).toBe(200);
    expect(councilTaskEvents.body).toContain('event: task.done');

    const councilStream = await app.inject({
      method: 'GET',
      url: `/api/v1/councils/runs/${createBody.data.id}/events`
    });
    expect(councilStream.statusCode).toBe(200);
    expect(councilStream.body).toContain('event: council.round.started');
    expect(councilStream.body).toContain('event: council.agent.responded');
    expect(councilStream.body).toContain('event: council.round.completed');
    expect(councilStream.body).toContain('event: council.run.completed');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/councils/runs?limit=10'
    });

    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { data: { runs: Array<{ id: string }> } };
    expect(listBody.data.runs.some((row) => row.id === createBody.data.id)).toBe(true);

    await app.close();
  });

  it('supports council rerun with excluded providers', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(':generateContent')) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Gemini council synthesis output' }]
                }
              }
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 20
            }
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          output_text: 'OpenAI council synthesis output',
          usage: {
            input_tokens: 12,
            output_tokens: 24
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/councils/runs',
      headers: {
        'idempotency-key': 'idem-council-exclude-001',
        'x-trace-id': 'trace-council-exclude-001'
      },
      payload: {
        question: 'Retry while excluding failed provider',
        exclude_providers: ['openai']
      }
    });

    expect(response.statusCode).toBe(202);
    const runId = (response.json() as { data: { id: string } }).data.id;
    expect(runId).toBeTruthy();

    const settled = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/councils/runs/${runId}`
        }),
      {
        until: (res) => {
          if (res.statusCode !== 200) return false;
          const body = res.json() as { data: { status: string } };
          return body.data.status === 'completed' || body.data.status === 'failed';
        }
      }
    );

    expect(settled.statusCode).toBe(200);
    const settledBody = settled.json() as {
      data: {
        status: string;
        provider: string | null;
        attempts: Array<{ provider: string; status: string; error?: string }>;
        summary: string;
      };
    };
    expect(settledBody.data.status).toBe('completed');
    expect(settledBody.data.provider).toBe('gemini');
    expect(settledBody.data.summary).toContain('Gemini council synthesis output');
    expect(
      settledBody.data.attempts.some(
        (attempt) => attempt.provider === 'openai' && attempt.status === 'skipped' && attempt.error === 'excluded_by_request'
      )
    ).toBe(true);

    await app.close();
  });

  it('creates execution run with dedicated endpoint', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: 'Execution output: function foo() { return 42; }',
          usage: {
            input_tokens: 20,
            output_tokens: 30
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/executions/runs',
      headers: {
        'idempotency-key': 'idem-execution-001',
        'x-trace-id': 'trace-execution-001'
      },
      payload: {
        mode: 'code',
        prompt: 'Write fibonacci in TypeScript',
        create_task: true
      }
    });

    expect(create.statusCode).toBe(202);
    const createBody = create.json() as {
      data: {
        id: string;
        mode: string;
        output: string;
        task_id: string | null;
      };
    };

    expect(createBody.data.id).toBeTruthy();
    expect(createBody.data.mode).toBe('code');
    expect(createBody.data.output).toContain('started');
    expect(createBody.data.task_id).toBeTruthy();

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/executions/runs',
      headers: {
        'idempotency-key': 'idem-execution-001',
        'x-trace-id': 'trace-execution-001'
      },
      payload: {
        mode: 'code',
        prompt: 'Write fibonacci in TypeScript',
        create_task: true
      }
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { data: { id: string } }).data.id).toBe(createBody.data.id);

    const getOne = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/executions/runs/${createBody.data.id}`
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) {
            return false;
          }
          const body = response.json() as { data: { status: string } };
          return body.data.status === 'completed' || body.data.status === 'failed';
        }
      }
    );
    expect(getOne.statusCode).toBe(200);
    const getOneBody = getOne.json() as { data: { status: string; output: string } };
    expect(getOneBody.data.status).toBe('completed');
    expect(getOneBody.data.output).toContain('Execution output');

    const executionTask = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/tasks/${createBody.data.task_id}`
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) {
            return false;
          }
          const body = response.json() as { data: { status: string } };
          return body.data.status === 'done' || body.data.status === 'failed';
        }
      }
    );
    expect(executionTask.statusCode).toBe(200);
    expect((executionTask.json() as { data: { status: string } }).data.status).toBe('done');

    const executionTaskEvents = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${createBody.data.task_id}/events`
    });
    expect(executionTaskEvents.statusCode).toBe(200);
    expect(executionTaskEvents.body).toContain('event: task.done');

    const stream = await app.inject({
      method: 'GET',
      url: `/api/v1/executions/runs/${createBody.data.id}/events`
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('event: execution.run.completed');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/executions/runs?limit=10'
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { data: { runs: Array<{ id: string }> } };
    expect(listBody.data.runs.some((row) => row.id === createBody.data.id)).toBe(true);

    await app.close();
  });

  it('ingests radar, evaluates items, and lists recommendations', async () => {
    const { app } = await buildServer();
    const operatorHeaders = {
      'x-user-role': 'operator'
    };

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/v1/radar/ingest',
      headers: operatorHeaders,
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
      url: '/api/v1/radar/items?limit=10',
      headers: operatorHeaders
    });
    expect(items.statusCode).toBe(200);

    const itemsBody = items.json() as { data: { items: Array<{ id: string }> } };
    const firstId = itemsBody.data.items[0]?.id;
    expect(firstId).toBeTruthy();

    const evaluate = await app.inject({
      method: 'POST',
      url: '/api/v1/radar/evaluate',
      headers: operatorHeaders,
      payload: {
        item_ids: [firstId]
      }
    });

    expect(evaluate.statusCode).toBe(202);

    const recommendations = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/recommendations',
      headers: operatorHeaders
    });

    expect(recommendations.statusCode).toBe(200);
    const recBody = recommendations.json() as { data: { recommendations: Array<{ itemId: string }> } };
    expect(recBody.data.recommendations[0]?.itemId).toBe(firstId);

    await app.close();
  });

  it('rejects upgrade run when approval is expired by policy', async () => {
    process.env.APPROVAL_MAX_AGE_HOURS = '0';
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    const { app } = await buildServer();
    const authHeaders = {
      authorization: 'Bearer auth_token_for_test'
    };

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/ingest',
      headers: authHeaders,
      payload: {
        source_name: 'expiry-test',
        items: [
          {
            title: 'Candidate Expiry',
            source_url: 'https://example.com/expiry',
            confidence_score: 0.8
          }
        ]
      }
    });

    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/items?limit=10',
      headers: authHeaders
    });
    const itemId = (items.json() as { data: { items: Array<{ id: string }> } }).data.items[0]?.id;
    expect(itemId).toBeTruthy();

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/evaluate',
      headers: authHeaders,
      payload: {
        item_ids: [itemId]
      }
    });

    const proposals = await app.inject({
      method: 'GET',
      url: '/api/v1/upgrades/proposals',
      headers: authHeaders
    });
    expect(proposals.statusCode).toBe(200);
    const proposalId = (proposals.json() as { data: { proposals: Array<{ id: string }> } }).data.proposals[0]?.id;
    expect(proposalId).toBeTruthy();

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/upgrades/proposals/${proposalId}/approve`,
      headers: {
        ...authHeaders,
        'x-user-role': 'operator'
      },
      payload: {
        decision: 'approve'
      }
    });
    expect(approve.statusCode).toBe(200);

    const run = await app.inject({
      method: 'POST',
      url: '/api/v1/upgrades/runs',
      headers: {
        ...authHeaders,
        'x-user-role': 'admin'
      },
      payload: {
        proposal_id: proposalId,
        start_command: '작업 시작'
      }
    });

    expect(run.statusCode).toBe(409);
    const runBody = run.json() as {
      error: {
        details?: {
          reason?: string;
          approval_max_age_hours?: number;
        };
      };
    };
    expect(runBody.error.details?.reason).toBe('approval_expired');
    expect(runBody.error.details?.approval_max_age_hours).toBe(0);

    await app.close();
  });

  it('enforces high-risk roles for proposal approval and upgrade run', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    process.env.HIGH_RISK_ALLOWED_ROLES = 'operator,admin';
    const { app } = await buildServer();
    const authHeaders = {
      authorization: 'Bearer auth_token_for_test'
    };

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/ingest',
      headers: authHeaders,
      payload: {
        source_name: 'rbac-test',
        items: [
          {
            title: 'Candidate RBAC',
            source_url: 'https://example.com/rbac',
            confidence_score: 0.8
          }
        ]
      }
    });

    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/items?limit=10',
      headers: authHeaders
    });
    const itemId = (items.json() as { data: { items: Array<{ id: string }> } }).data.items[0]?.id;
    expect(itemId).toBeTruthy();

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/evaluate',
      headers: authHeaders,
      payload: {
        item_ids: [itemId]
      }
    });

    const proposals = await app.inject({
      method: 'GET',
      url: '/api/v1/upgrades/proposals',
      headers: authHeaders
    });
    const proposalId = (proposals.json() as { data: { proposals: Array<{ id: string }> } }).data.proposals[0]?.id;
    expect(proposalId).toBeTruthy();

    const deniedApproval = await app.inject({
      method: 'POST',
      url: `/api/v1/upgrades/proposals/${proposalId}/approve`,
      headers: {
        ...authHeaders,
        'x-user-role': 'viewer'
      },
      payload: {
        decision: 'approve'
      }
    });
    expect(deniedApproval.statusCode).toBe(403);

    const allowedApproval = await app.inject({
      method: 'POST',
      url: `/api/v1/upgrades/proposals/${proposalId}/approve`,
      headers: {
        ...authHeaders,
        'x-user-role': 'operator'
      },
      payload: {
        decision: 'approve'
      }
    });
    expect(allowedApproval.statusCode).toBe(200);

    const deniedRun = await app.inject({
      method: 'POST',
      url: '/api/v1/upgrades/runs',
      headers: {
        ...authHeaders,
        'x-user-role': 'viewer'
      },
      payload: {
        proposal_id: proposalId,
        start_command: '작업 시작'
      }
    });
    expect(deniedRun.statusCode).toBe(403);

    const allowedRun = await app.inject({
      method: 'POST',
      url: '/api/v1/upgrades/runs',
      headers: {
        ...authHeaders,
        'x-user-role': 'admin'
      },
      payload: {
        proposal_id: proposalId,
        start_command: '작업 시작'
      }
    });
    expect(allowedRun.statusCode).toBe(202);

    const listRuns = await app.inject({
      method: 'GET',
      url: '/api/v1/upgrades/runs?limit=5',
      headers: {
        ...authHeaders,
        'x-user-role': 'operator'
      }
    });
    expect(listRuns.statusCode).toBe(200);
    const listRunsBody = listRuns.json() as {
      data: {
        runs: Array<{ id: string }>;
      };
    };
    expect(listRunsBody.data.runs.length).toBeGreaterThan(0);

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

  it('returns provider model catalog endpoint', async () => {
    const { app } = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/providers/models'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        providers: Array<{
          provider: string;
          configured_model: string;
          models: string[];
        }>;
      };
    };

    expect(body.data.providers.map((item) => item.provider)).toEqual(['openai', 'gemini', 'anthropic', 'local']);
    expect(body.data.providers.every((item) => item.models.includes(item.configured_model))).toBe(true);

    await app.close();
  });

  it('handles telegram callback approve_and_start flow', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    const { app } = await buildServer();
    const authHeaders = {
      authorization: 'Bearer auth_token_for_test'
    };

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/ingest',
      headers: authHeaders,
      payload: {
        source_name: 'telegram-callback-test',
        items: [
          {
            title: 'Candidate Callback',
            source_url: 'https://example.com/callback',
            confidence_score: 0.9
          }
        ]
      }
    });

    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/items?limit=10',
      headers: authHeaders
    });
    const itemId = (items.json() as { data: { items: Array<{ id: string }> } }).data.items[0]?.id;
    expect(itemId).toBeTruthy();

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/evaluate',
      headers: authHeaders,
      payload: {
        item_ids: [itemId]
      }
    });

    const proposals = await app.inject({
      method: 'GET',
      url: '/api/v1/upgrades/proposals',
      headers: authHeaders
    });
    const proposalId = (proposals.json() as { data: { proposals: Array<{ id: string }> } }).data.proposals[0]?.id;
    expect(proposalId).toBeTruthy();

    const callbackData = createTelegramApprovalCallbackData({
      action: 'approve_and_start',
      proposalId,
      secret: 'telegram_secret',
      nowMs: Date.now(),
      expiresInSec: 600,
      nonce: '1122334455667788'
    });

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/telegram/webhook',
      headers: {
        'x-telegram-bot-api-secret-token': 'telegram_secret'
      },
      payload: {
        callback_query: {
          data: callbackData
        }
      }
    });

    expect(webhook.statusCode).toBe(200);
    const webhookBody = webhook.json() as { data: { accepted: boolean; run_id?: string } };
    expect(webhookBody.data.accepted).toBe(true);
    expect(webhookBody.data.run_id).toBeTruthy();

    await app.close();
  });

  it('returns signed telegram approval action payloads with report enqueue', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    const { app } = await buildServer();
    const authHeaders = {
      authorization: 'Bearer auth_token_for_test'
    };

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/ingest',
      headers: authHeaders,
      payload: {
        source_name: 'telegram-report-action-test',
        items: [
          {
            title: 'Candidate For Action',
            source_url: 'https://example.com/action',
            confidence_score: 0.9
          }
        ]
      }
    });

    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/items?limit=10',
      headers: authHeaders
    });
    const itemId = (items.json() as { data: { items: Array<{ id: string }> } }).data.items[0]?.id;
    expect(itemId).toBeTruthy();

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/evaluate',
      headers: authHeaders,
      payload: {
        item_ids: [itemId]
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/radar/reports/telegram',
      headers: authHeaders,
      payload: {
        chat_id: 'telegram'
      }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json() as {
      data: {
        id: string;
        chatId: string;
        status: string;
      };
      meta: {
        approval_action_payloads?: Array<{
          proposal_id: string;
          reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> };
        }>;
        telegram_delivery?: {
          attempted: boolean;
          delivered: boolean;
          reason?: string;
        };
      };
    };

    expect(body.data.chatId).toBe('telegram');
    expect(body.data.status).toBe('queued');
    expect(body.meta.approval_action_payloads?.length ?? 0).toBeGreaterThan(0);
    expect(body.meta.telegram_delivery).toMatchObject({
      attempted: false,
      delivered: false,
      reason: 'missing_bot_token'
    });

    const firstCallback = body.meta.approval_action_payloads?.[0]?.reply_markup.inline_keyboard?.[0]?.[0]?.callback_data;
    expect(firstCallback).toBeTruthy();
    if (firstCallback) {
      const parsed = validateTelegramApprovalCallbackData({
        data: firstCallback,
        secret: 'telegram_secret',
        nowMs: Date.now()
      });
      expect(parsed).toMatchObject({
        accepted: true
      });
    }

    await app.close();
  });

  it('lists and gets telegram report status records', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    process.env.TELEGRAM_BOT_TOKEN = '';
    const { app } = await buildServer();
    const authHeaders = {
      authorization: 'Bearer auth_token_for_test',
      'x-user-role': 'operator'
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/radar/reports/telegram',
      headers: authHeaders,
      payload: {
        chat_id: 'telegram'
      }
    });
    expect(created.statusCode).toBe(202);
    const createdBody = created.json() as {
      data: { id: string; status: string };
    };
    expect(createdBody.data.id).toBeTruthy();
    expect(createdBody.data.status).toBe('queued');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/reports/telegram?status=queued&limit=20',
      headers: authHeaders
    });
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.json() as {
      data: {
        reports: Array<{
          id: string;
          status: string;
          attemptCount: number;
          maxAttempts: number;
          nextAttemptAt: string | null;
        }>;
      };
    };
    expect(listedBody.data.reports.some((report) => report.id === createdBody.data.id)).toBe(true);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/radar/reports/telegram/${createdBody.data.id}`,
      headers: authHeaders
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as {
      data: {
        id: string;
        status: string;
        attemptCount: number;
        maxAttempts: number;
      };
    };
    expect(detailBody.data.id).toBe(createdBody.data.id);
    expect(detailBody.data.status).toBe('queued');
    expect(detailBody.data.attemptCount).toBeGreaterThanOrEqual(0);
    expect(detailBody.data.maxAttempts).toBeGreaterThan(0);

    await app.close();
  });

  it('retries failed telegram report and resets queue metadata', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:test-bot-token';
    process.env.TELEGRAM_REPORT_MAX_ATTEMPTS = '1';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          description: 'forced send failure'
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();
    const authHeaders = {
      authorization: 'Bearer auth_token_for_test',
      'x-user-role': 'operator'
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/radar/reports/telegram',
      headers: authHeaders,
      payload: {
        chat_id: 'telegram'
      }
    });
    expect(created.statusCode).toBe(202);
    const createdBody = created.json() as {
      data: { id: string };
    };

    const failedDetail = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/radar/reports/telegram/${createdBody.data.id}`,
          headers: authHeaders
        }),
      {
        until: (response) => (response.json() as { data: { status: string } }).data.status === 'failed',
        timeoutMs: 3_000,
        intervalMs: 50
      }
    );
    expect(failedDetail.statusCode).toBe(200);

    const retried = await app.inject({
      method: 'POST',
      url: `/api/v1/radar/reports/telegram/${createdBody.data.id}/retry`,
      headers: authHeaders,
      payload: {
        max_attempts: 4
      }
    });
    expect(retried.statusCode).toBe(202);
    const retriedBody = retried.json() as {
      data: {
        id: string;
        status: string;
        attemptCount: number;
        maxAttempts: number;
        lastError: string | null;
      };
      meta: {
        retried: boolean;
      };
    };
    expect(retriedBody.data.id).toBe(createdBody.data.id);
    expect(retriedBody.data.status).toBe('queued');
    expect(retriedBody.data.attemptCount).toBe(0);
    expect(retriedBody.data.maxAttempts).toBe(4);
    expect(retriedBody.data.lastError).toBeNull();
    expect(retriedBody.meta.retried).toBe(true);

    await app.close();
  });

  it('delivers telegram report when bot token is configured', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:test-bot-token';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 777001
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();
    const authHeaders = {
      authorization: 'Bearer auth_token_for_test'
    };

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/ingest',
      headers: authHeaders,
      payload: {
        source_name: 'telegram-live-delivery-test',
        items: [
          {
            title: 'Candidate For Delivery',
            source_url: 'https://example.com/delivery',
            confidence_score: 0.95
          }
        ]
      }
    });

    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/items?limit=10',
      headers: authHeaders
    });
    const itemId = (items.json() as { data: { items: Array<{ id: string }> } }).data.items[0]?.id;
    expect(itemId).toBeTruthy();

    await app.inject({
      method: 'POST',
      url: '/api/v1/radar/evaluate',
      headers: authHeaders,
      payload: {
        item_ids: [itemId]
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/radar/reports/telegram',
      headers: authHeaders,
      payload: {
        chat_id: 'telegram'
      }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json() as {
      data: {
        id: string;
        chatId: string;
        status: string;
        telegramMessageId?: string | null;
      };
      meta: {
        telegram_delivery?: {
          attempted: boolean;
          delivered: boolean;
          reason?: string;
          message_id?: string | null;
        };
        approval_action_payloads?: Array<{
          proposal_id: string;
          reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> };
        }>;
      };
    };

    expect(body.data.chatId).toBe('telegram');
    expect(body.data.status).toBe('queued');
    expect(body.meta.telegram_delivery).toMatchObject({
      attempted: false,
      delivered: false,
      reason: 'queued_for_worker'
    });
    expect(body.meta.approval_action_payloads?.length ?? 0).toBeGreaterThan(0);

    await waitFor(
      async () => fetchMock.mock.calls.length,
      {
        until: (count) => count > 0,
        timeoutMs: 2_000,
        intervalMs: 25
      }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/bot123456789:test-bot-token/sendMessage');
    const requestBody = JSON.parse(String(init?.body ?? '{}')) as {
      chat_id?: string;
      parse_mode?: string;
      reply_markup?: { inline_keyboard?: Array<Array<{ callback_data: string }>> };
    };
    expect(requestBody.chat_id).toBe('telegram');
    expect(requestBody.parse_mode).toBe('MarkdownV2');
    expect(requestBody.reply_markup?.inline_keyboard?.length ?? 0).toBeGreaterThan(0);

    const firstCallback = requestBody.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
    expect(firstCallback).toBeTruthy();
    if (firstCallback) {
      const parsed = validateTelegramApprovalCallbackData({
        data: firstCallback,
        secret: 'telegram_secret',
        nowMs: Date.now()
      });
      expect(parsed).toMatchObject({
        accepted: true
      });
    }

    const approveAndStartCallback = requestBody.reply_markup?.inline_keyboard?.[0]?.[1]?.callback_data;
    expect(approveAndStartCallback).toBeTruthy();
    if (approveAndStartCallback) {
      const webhook = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/telegram/webhook',
        headers: {
          'x-telegram-bot-api-secret-token': 'telegram_secret'
        },
        payload: {
          callback_query: {
            data: approveAndStartCallback
          }
        }
      });
      expect(webhook.statusCode).toBe(200);
      const webhookBody = webhook.json() as {
        data: {
          accepted: boolean;
          type: string;
          run_id?: string;
        };
      };
      expect(webhookBody.data.accepted).toBe(true);
      expect(webhookBody.data.type).toBe('approve_and_start');
      expect(webhookBody.data.run_id).toBeTruthy();
    }

    const reportId = body.data.id;
    const deliveredReport = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/radar/reports/telegram/${reportId}`,
          headers: authHeaders
        }),
      {
        until: (result) => (result.json() as { data: { status: string } }).data.status === 'sent',
        timeoutMs: 3_000,
        intervalMs: 50
      }
    );
    expect(deliveredReport.statusCode).toBe(200);

    const retrySent = await app.inject({
      method: 'POST',
      url: `/api/v1/radar/reports/telegram/${reportId}/retry`,
      headers: authHeaders
    });
    expect(retrySent.statusCode).toBe(409);

    const listEvents = await app.inject({
      method: 'GET',
      url: '/api/v1/radar/reports/telegram/events?limit=10',
      headers: {
        ...authHeaders,
        origin: 'http://localhost:3000'
      }
    });
    expect(listEvents.statusCode).toBe(200);
    expect(listEvents.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(listEvents.headers['access-control-allow-credentials']).toBe('true');
    expect(listEvents.headers['content-type']).toContain('text/event-stream');
    expect(listEvents.body).toContain('event: stream.open');
    expect(listEvents.body).toContain('event: telegram.reports.updated');
    expect(listEvents.body).toContain('event: stream.close');

    const detailEvents = await app.inject({
      method: 'GET',
      url: `/api/v1/radar/reports/telegram/${reportId}/events`,
      headers: {
        ...authHeaders,
        origin: 'http://localhost:3000'
      }
    });
    expect(detailEvents.statusCode).toBe(200);
    expect(detailEvents.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(detailEvents.headers['access-control-allow-credentials']).toBe('true');
    expect(detailEvents.headers['content-type']).toContain('text/event-stream');
    expect(detailEvents.body).toContain('event: stream.open');
    expect(detailEvents.body).toContain('event: telegram.report.updated');
    expect(detailEvents.body).toContain('event: stream.close');

    await app.close();
  });

  it('rejects unsigned telegram callback payload', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    const { app } = await buildServer();

    const signed = createTelegramApprovalCallbackData({
      action: 'approve',
      proposalId: '123e4567-e89b-12d3-a456-426614174000',
      secret: 'telegram_secret',
      nowMs: Date.now(),
      expiresInSec: 600,
      nonce: '1029384756abcdef'
    });
    const unsigned = signed.split('|').slice(0, 5).join('|');

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/telegram/webhook',
      headers: {
        'x-telegram-bot-api-secret-token': 'telegram_secret'
      },
      payload: {
        callback_query: {
          data: unsigned
        }
      }
    });

    expect(webhook.statusCode).toBe(200);
    const body = webhook.json() as {
      data: { accepted: boolean; ignored: boolean; reason: string };
    };
    expect(body.data.accepted).toBe(false);
    expect(body.data.ignored).toBe(true);
    expect(body.data.reason).toBe('missing_signature');

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

  it('rejects council/execution run creation when idempotency-key is missing', async () => {
    const { app } = await buildServer();

    const council = await app.inject({
      method: 'POST',
      url: '/api/v1/councils/runs',
      payload: {
        question: 'missing header'
      }
    });
    expect(council.statusCode).toBe(422);

    const execution = await app.inject({
      method: 'POST',
      url: '/api/v1/executions/runs',
      payload: {
        mode: 'code',
        prompt: 'missing header'
      }
    });
    expect(execution.statusCode).toBe(422);

    await app.close();
  });
});
