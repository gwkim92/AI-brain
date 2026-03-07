import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createTelegramApprovalCallbackData, validateTelegramApprovalCallbackData } from '../../integrations/telegram/commands';
import { buildServer } from '../../server';

const ENV_SNAPSHOT = { ...process.env };
const dockerAvailable = (() => {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

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

  it('returns x-trace-id header and preserves provided trace ids', async () => {
    const { app } = await buildServer();

    const generated = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/overview'
    });
    expect(generated.statusCode).toBe(200);
    const generatedTrace = generated.headers['x-trace-id'];
    expect(typeof generatedTrace).toBe('string');
    expect((generatedTrace as string).length).toBeGreaterThan(0);

    const customTrace = 'trace-custom-0001';
    const forwarded = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/overview',
      headers: {
        'x-trace-id': customTrace
      }
    });
    expect(forwarded.statusCode).toBe(200);
    expect(forwarded.headers['x-trace-id']).toBe(customTrace);

    await app.close();
  });

  it('replays task create when idempotency-key is reused by same user', async () => {
    const { app } = await buildServer();
    const userId = '11111111-1111-4111-8111-111111111111';
    const idempotencyKey = 'idem-task-replay-0001';

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: {
        'x-user-id': userId,
        'idempotency-key': idempotencyKey,
      },
      payload: {
        mode: 'execute',
        title: 'Idempotent task',
        input: { source: 'test' }
      }
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { data: { id: string } };

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: {
        'x-user-id': userId,
        'idempotency-key': idempotencyKey,
      },
      payload: {
        mode: 'execute',
        title: 'Idempotent task',
        input: { source: 'test' }
      }
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { data: { id: string }; meta?: { idempotent_replay?: boolean } };
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(secondBody.meta?.idempotent_replay).toBe(true);

    await app.close();
  });

  it('scopes task list and task detail to requester by default', async () => {
    const { app } = await buildServer();
    const userA = '22222222-2222-4222-8222-222222222222';
    const userB = '33333333-3333-4333-8333-333333333333';

    const createA = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { 'x-user-id': userA, 'x-user-role': 'member' },
      payload: {
        mode: 'execute',
        title: 'Task A',
        input: { source: 'test' }
      }
    });
    expect(createA.statusCode).toBe(201);
    const createABody = createA.json() as { data: { id: string } };

    const createB = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { 'x-user-id': userB, 'x-user-role': 'member' },
      payload: {
        mode: 'execute',
        title: 'Task B',
        input: { source: 'test' }
      }
    });
    expect(createB.statusCode).toBe(201);
    const createBBody = createB.json() as { data: { id: string } };

    const listMine = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?limit=20',
      headers: { 'x-user-id': userA, 'x-user-role': 'member' }
    });
    expect(listMine.statusCode).toBe(200);
    const listMineBody = listMine.json() as { data: Array<{ id: string; userId: string }> };
    expect(listMineBody.data.length).toBe(1);
    expect(listMineBody.data[0]?.id).toBe(createABody.data.id);
    expect(listMineBody.data[0]?.userId).toBe(userA);

    const listAllDenied = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?limit=20&scope=all',
      headers: { 'x-user-id': userA, 'x-user-role': 'member' }
    });
    expect(listAllDenied.statusCode).toBe(403);

    const listAllAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?limit=20&scope=all',
      headers: { 'x-user-id': userA, 'x-user-role': 'admin' }
    });
    expect(listAllAdmin.statusCode).toBe(200);
    const listAllAdminBody = listAllAdmin.json() as { data: Array<{ id: string }> };
    const listedIds = new Set(listAllAdminBody.data.map((row) => row.id));
    expect(listedIds.has(createABody.data.id)).toBe(true);
    expect(listedIds.has(createBBody.data.id)).toBe(true);

    const detailDenied = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${createBBody.data.id}`,
      headers: { 'x-user-id': userA, 'x-user-role': 'member' }
    });
    expect(detailDenied.statusCode).toBe(404);

    const eventsDenied = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${createBBody.data.id}/events`,
      headers: { 'x-user-id': userA, 'x-user-role': 'member' }
    });
    expect(eventsDenied.statusCode).toBe(404);

    const detailAdmin = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${createBBody.data.id}`,
      headers: { 'x-user-id': userA, 'x-user-role': 'admin' }
    });
    expect(detailAdmin.statusCode).toBe(200);

    await app.close();
  });

  it('scopes dashboard overview task signals to requester unless admin scope=all', async () => {
    const { app } = await buildServer();
    const userA = '44444444-4444-4444-8444-444444444444';
    const userB = '55555555-5555-4555-8555-555555555555';

    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { 'x-user-id': userA, 'x-user-role': 'member' },
      payload: {
        mode: 'execute',
        title: 'Dashboard Task A',
        input: { source: 'test' }
      }
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { 'x-user-id': userB, 'x-user-role': 'member' },
      payload: {
        mode: 'execute',
        title: 'Dashboard Task B',
        input: { source: 'test' }
      }
    });

    const workspace = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { 'x-user-id': userA, 'x-user-role': 'member' },
      payload: {
        name: 'Dashboard Approval Runtime',
        cwd: '.'
      }
    });
    expect(workspace.statusCode).toBe(201);
    const workspaceId = (workspace.json() as { data: { id: string } }).data.id;

    const queuedApproval = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/pty/spawn`,
      headers: { 'x-user-id': userA, 'x-user-role': 'member' },
      payload: {
        command: 'node -p process.version'
      }
    });
    expect(queuedApproval.statusCode).toBe(202);

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/overview?task_limit=120&pending_approval_limit=30&running_task_limit=40',
      headers: { 'x-user-id': userA, 'x-user-role': 'member' }
    });
    expect(mine.statusCode).toBe(200);
    const mineBody = mine.json() as {
      data: {
        signals: { task_count: number; pending_approval_count: number; pending_session_approval_count: number };
        tasks: Array<{ userId: string }>;
      };
    };
    expect(mineBody.data.signals.task_count).toBe(1);
    expect(mineBody.data.signals.pending_approval_count).toBe(1);
    expect(mineBody.data.signals.pending_session_approval_count).toBe(1);
    expect(new Set(mineBody.data.tasks.map((task) => task.userId))).toEqual(new Set([userA]));

    const allDenied = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/overview?task_limit=120&pending_approval_limit=30&running_task_limit=40&task_scope=all',
      headers: { 'x-user-id': userA, 'x-user-role': 'member' }
    });
    expect(allDenied.statusCode).toBe(403);

    const allAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/overview?task_limit=120&pending_approval_limit=30&running_task_limit=40&task_scope=all',
      headers: { 'x-user-id': userA, 'x-user-role': 'admin' }
    });
    expect(allAdmin.statusCode).toBe(200);
    const allAdminBody = allAdmin.json() as { data: { signals: { task_count: number }; tasks: Array<{ userId: string }> } };
    expect(allAdminBody.data.signals.task_count).toBe(2);
    expect(new Set(allAdminBody.data.tasks.map((task) => task.userId))).toEqual(new Set([userA, userB]));

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

  it('rejects assistant context task ids that do not reference an existing user task', async () => {
    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/contexts',
      payload: {
        client_context_id: 'ctx-invalid-task-link-001',
        source: 'inbox_quick_command',
        intent: 'research',
        prompt: 'summarize the latest world news',
        widget_plan: ['assistant', 'tasks'],
        task_id: '11111111-1111-4111-8111-111111111111'
      }
    });

    expect(create.statusCode).toBe(422);
    const body = create.json() as {
      error: {
        code: string;
        message: string;
      };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('task_id');

    await app.close();
  });

  it('runs assistant context asynchronously on backend and syncs linked task status', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text:
            'Assistant context background run completed. [Reuters](https://www.reuters.com/world)\n\nSources:\n- [Reuters](https://www.reuters.com/world)',
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
        task_type: 'execute',
        client_run_nonce: 'ctx-run-async-001-nonce'
      }
    });
    expect(run.statusCode).toBe(202);
    expect((run.json() as { meta: { client_run_nonce: string } }).meta.client_run_nonce).toBe('ctx-run-async-001-nonce');

    const replayRun = await app.inject({
      method: 'POST',
      url: `/api/v1/assistant/contexts/${contextId}/run`,
      payload: {
        provider: 'openai',
        strict_provider: true,
        task_type: 'execute',
        client_run_nonce: 'ctx-run-async-001-nonce'
      }
    });
    expect([200, 202]).toContain(replayRun.statusCode);
    const replayBody = replayRun.json() as {
      meta: {
        accepted: boolean;
        reason: string;
        client_run_nonce: string;
      };
    };
    expect(replayBody.meta.accepted).toBe(false);
    expect(['nonce_replay', 'already_completed']).toContain(replayBody.meta.reason);
    expect(replayBody.meta.client_run_nonce).toBe('ctx-run-async-001-nonce');

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

    const groundingEvidence = await app.inject({
      method: 'GET',
      url: `/api/v1/assistant/contexts/${contextId}/grounding-evidence?limit=10`
    });
    expect(groundingEvidence.statusCode).toBe(200);
    const evidenceBody = groundingEvidence.json() as {
      data: {
        context_id: string;
        sources: Array<{ domain: string; url: string }>;
        claims: Array<{
          claimText: string;
          citations: Array<{ url: string }>;
        }>;
        summary: {
          source_count: number;
          claim_count: number;
          unique_domains: string[];
        };
      };
    };
    expect(evidenceBody.data.context_id).toBe(contextId);
    expect(evidenceBody.data.summary.source_count).toBeGreaterThanOrEqual(1);
    expect(evidenceBody.data.summary.claim_count).toBeGreaterThanOrEqual(0);
    expect(evidenceBody.data.summary.unique_domains).toContain('www.reuters.com');
    expect(evidenceBody.data.sources[0]?.url).toContain('reuters.com');
    expect(evidenceBody.data.claims[0]?.claimText).toContain('background run');
    expect(evidenceBody.data.claims[0]?.citations[0]?.url).toContain('reuters.com');

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
        events: Array<{ eventType: string; data: Record<string, unknown> }>;
      };
    };
    expect(eventBody.data.events.map((item) => item.eventType)).toContain('assistant.context.run.accepted');
    expect(eventBody.data.events.map((item) => item.eventType)).toContain('assistant.context.run.completed');
    const stageRows = eventBody.data.events.filter((item) => item.eventType === 'assistant.context.stage.updated');
    expect(stageRows.length).toBeGreaterThan(0);
    const stageNames = stageRows
      .map((item) => item.data.stage)
      .filter((item): item is string => typeof item === 'string');
    expect(stageNames).toContain('accepted');
    expect(stageNames).toContain('finalized');

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

  it('rejects news briefing run when external providers are unavailable', async () => {
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response('<?xml version="1.0" encoding="UTF-8"?><rss><channel></channel></rss>', {
        status: 200,
        headers: { 'content-type': 'application/xml' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const createContext = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/contexts',
      payload: {
        client_context_id: 'ctx-news-preflight-001',
        source: 'inbox_quick_command',
        intent: 'news',
        prompt: '최신 뉴스 중에 주요 뉴스 브리핑 해봐',
        widget_plan: ['assistant', 'reports', 'tasks']
      }
    });
    expect(createContext.statusCode).toBe(201);
    const contextId = (createContext.json() as { data: { id: string } }).data.id;

    const run = await app.inject({
      method: 'POST',
      url: `/api/v1/assistant/contexts/${contextId}/run`,
      payload: {
        provider: 'auto',
        task_type: 'radar_review'
      }
    });
    expect(run.statusCode).toBe(503);
    const runBody = run.json() as {
      error: {
        code: string;
        message: string;
        details?: {
          reason?: string;
          required_external_providers?: string[];
        };
      };
    };
    expect(runBody.error.code).toBe('INTERNAL_ERROR');
    expect(runBody.error.message).toContain('검색 근거 품질 검증에 실패했습니다');
    expect(runBody.error.details?.reason).toBe('INSUFFICIENT_EVIDENCE');
    expect(runBody.error.details?.required_external_providers).toEqual(['openai', 'gemini', 'anthropic']);

    const context = await app.inject({
      method: 'GET',
      url: `/api/v1/assistant/contexts/${contextId}`
    });
    expect(context.statusCode).toBe(200);
    const contextBody = context.json() as {
      data: {
        status: string;
        error: string | null;
        output: string;
      };
    };
    expect(contextBody.data.status).toBe('failed');
    expect(contextBody.data.error).toBe('INSUFFICIENT_EVIDENCE');
    expect(contextBody.data.output).toContain('검색 근거 품질 검증에 실패했습니다');

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
    expect(eventBody.data.events.map((item) => item.eventType)).toContain('assistant.context.run.rejected');

    await app.close();
  });

  it('completes assistant context with retrieval-only fallback when providers are unavailable but evidence exists', async () => {
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'false';

    const recentA = new Date(Date.now() - 30 * 60 * 1000).toUTCString();
    const recentB = new Date(Date.now() - 90 * 60 * 1000).toUTCString();
    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>Trump renewed pressure on allied defense spending</title>',
      '<link>https://www.reuters.com/world/trump-allies-defense</link>',
      '<description>Trump emphasized burden sharing and alliance defense costs.</description>',
      `<pubDate>${recentA}</pubDate>`,
      '</item>',
      '<item>',
      '<title>White House briefing on Middle East security posture</title>',
      '<link>https://apnews.com/article/white-house-middle-east-briefing</link>',
      '<description>The administration explained context around regional security remarks.</description>',
      `<pubDate>${recentB}</pubDate>`,
      '</item>',
      '</channel></rss>'
    ].join('');

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (
        url.includes('news.google.com/rss') ||
        url.includes('feeds.bbci.co.uk/news/rss.xml') ||
        url.includes('rss.nytimes.com/services/xml/rss/nyt/HomePage.xml') ||
        url.includes('www.aljazeera.com/xml/rss/all.xml') ||
        url.includes('www.yna.co.kr/rss/news.xml')
      ) {
        return new Response(rssXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' }
        });
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const createdTask = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        mode: 'execute',
        title: 'recency retrieval-only fallback task',
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
        client_context_id: 'ctx-recency-fallback-no-provider-001',
        source: 'inbox_quick_command',
        intent: 'general',
        prompt: '오늘 트럼프 주요 발언 뉴스 정리해줘',
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
        provider: 'auto',
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
        servedModel: string | null;
        output: string;
      };
    };
    expect(settledBody.data.status).toBe('completed');
    expect(settledBody.data.servedProvider).toBe('local');
    expect(settledBody.data.servedModel).toBe('retrieval-fallback-v1');
    expect(settledBody.data.output).toContain('주요 뉴스 브리핑');
    expect(settledBody.data.output).toContain('reuters.com/world/trump-allies-defense');
    expect(settledBody.data.output).toContain('apnews.com/article/white-house-middle-east-briefing');

    const events = await app.inject({
      method: 'GET',
      url: `/api/v1/assistant/contexts/${contextId}/events?limit=40`
    });
    expect(events.statusCode).toBe(200);
    const eventBody = events.json() as {
      data: {
        events: Array<{ eventType: string; data: Record<string, unknown> }>;
      };
    };
    const runCompleted = eventBody.data.events.find((item) => item.eventType === 'assistant.context.run.completed');
    expect(runCompleted).toBeDefined();
    expect(runCompleted?.data.provider).toBe('local');
    expect(runCompleted?.data.retrieval_only_fallback).toBe(true);
    expect(runCompleted?.data.grounding_status).toBe('served_with_limits');

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

    await app.close();
  });

  it('uses local grounded retrieval fallback for recency assistant context runs when external providers are unavailable', async () => {
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'true';

    const recentA = new Date(Date.now() - 30 * 60 * 1000).toUTCString();
    const recentB = new Date(Date.now() - 90 * 60 * 1000).toUTCString();
    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>Trump renewed pressure on allied defense spending</title>',
      '<link>https://www.reuters.com/world/trump-allies-defense</link>',
      '<description>Trump emphasized burden sharing and alliance defense costs.</description>',
      `<pubDate>${recentA}</pubDate>`,
      '</item>',
      '<item>',
      '<title>White House briefing on Middle East security posture</title>',
      '<link>https://apnews.com/article/white-house-middle-east-briefing</link>',
      '<description>The administration explained context around regional security remarks.</description>',
      `<pubDate>${recentB}</pubDate>`,
      '</item>',
      '</channel></rss>'
    ].join('');

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (
        url.includes('news.google.com/rss') ||
        url.includes('feeds.bbci.co.uk/news/rss.xml') ||
        url.includes('rss.nytimes.com/services/xml/rss/nyt/HomePage.xml') ||
        url.includes('www.aljazeera.com/xml/rss/all.xml') ||
        url.includes('www.yna.co.kr/rss/news.xml')
      ) {
        return new Response(rssXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' }
        });
      }
      if (url.includes('/v1/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    'Today reports frame Trump remarks around allied defense burden sharing and broader security posture.',
                    'Combined with White House briefings, the overall signaling remains assertive.'
                  ].join('\n')
                }
              }
            ],
            usage: {
              prompt_tokens: 19,
              completion_tokens: 28
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const createdTask = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        mode: 'execute',
        title: 'recency fallback task',
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
        client_context_id: 'ctx-recency-fallback-001',
        source: 'inbox_quick_command',
        intent: 'general',
        prompt: '오늘 트럼프 주요 발언 뉴스 정리해줘',
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
        provider: 'auto',
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
    expect(settledBody.data.servedProvider).toBe('local');
    expect(settledBody.data.output).not.toContain('근거 기반 응답 품질 검증에 실패했습니다.');
    expect(settledBody.data.output).toContain('Sources:');
    expect(settledBody.data.output).toContain('reuters.com/world/trump-allies-defense');
    expect(settledBody.data.output).toContain('apnews.com/article/white-house-middle-east-briefing');

    const evidence = await app.inject({
      method: 'GET',
      url: `/api/v1/assistant/contexts/${contextId}/grounding-evidence?limit=10`
    });
    expect(evidence.statusCode).toBe(200);
    const evidenceBody = evidence.json() as {
      data: {
        summary: {
          source_count: number;
          claim_count: number;
        };
      };
    };
    expect(evidenceBody.data.summary.source_count).toBeGreaterThanOrEqual(2);
    expect(evidenceBody.data.summary.claim_count).toBeGreaterThanOrEqual(0);

    const events = await app.inject({
      method: 'GET',
      url: `/api/v1/assistant/contexts/${contextId}/events?limit=30`
    });
    expect(events.statusCode).toBe(200);
    const eventBody = events.json() as {
      data: {
        events: Array<{ eventType: string; data: Record<string, unknown> }>;
      };
    };
    const policyResolved = eventBody.data.events.find((item) => item.eventType === 'assistant.context.policy.resolved');
    const runCompleted = eventBody.data.events.find((item) => item.eventType === 'assistant.context.run.completed');
    expect(policyResolved).toBeDefined();
    expect(runCompleted).toBeDefined();
    expect(policyResolved?.data.grounding_policy).toBe('dynamic_factual');
    expect(policyResolved?.data.retrieval_fallback_enabled).toBe(true);
    expect(runCompleted?.data.quality_guard_triggered).toBe(false);
    expect(runCompleted?.data.quality_gate_softened).toBe(false);

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

    await app.close();
  });

  it('rejects dynamic factual ai respond when no grounded provider is available', async () => {
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'false';
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response('<?xml version="1.0" encoding="UTF-8"?><rss><channel></channel></rss>', {
        status: 200,
        headers: { 'content-type': 'application/xml' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const respond = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      payload: {
        prompt: '오늘 환율과 주요 금융 지표 요약해줘',
        provider: 'auto',
        task_type: 'chat'
      }
    });

    expect(respond.statusCode).toBe(503);
    const body = respond.json() as {
      error: {
        code: string;
        details?: {
          reason?: string;
          grounding_policy?: string;
          required_external_providers?: string[];
        };
      };
    };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.details?.reason).toBe('INSUFFICIENT_EVIDENCE');
    expect(body.error.details?.grounding_policy).toBe('dynamic_factual');
    expect(body.error.details?.required_external_providers).toEqual(['openai', 'gemini', 'anthropic']);

    await app.close();
  });

  it('serves retrieval-only grounded response when providers are unavailable but evidence exists', async () => {
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'false';
    const recentA = new Date(Date.now() - 45 * 60 * 1000).toUTCString();
    const recentB = new Date(Date.now() - 95 * 60 * 1000).toUTCString();

    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>트럼프 오늘 발언: 동맹 방위비 기조 재확인</title>',
      '<link>https://www.reuters.com/world/trump-defense-posture</link>',
      '<description>트럼프 오늘 발언에서 동맹 방위비와 안보 책임 분담을 강조했다.</description>',
      `<pubDate>${recentA}</pubDate>`,
      '</item>',
      '<item>',
      '<title>미 행정부, 중동 안보 대응 브리핑 공개</title>',
      '<link>https://apnews.com/article/us-admin-middle-east-briefing</link>',
      '<description>행정부는 중동 안보 대응 관련 발언의 배경을 설명했다.</description>',
      `<pubDate>${recentB}</pubDate>`,
      '</item>',
      '</channel></rss>'
    ].join('');

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (
        url.includes('news.google.com/rss') ||
        url.includes('feeds.bbci.co.uk/news/rss.xml') ||
        url.includes('rss.nytimes.com/services/xml/rss/nyt/HomePage.xml') ||
        url.includes('www.aljazeera.com/xml/rss/all.xml') ||
        url.includes('www.yna.co.kr/rss/news.xml')
      ) {
        return new Response(rssXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' }
        });
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const respond = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      payload: {
        prompt: '오늘 트럼프 주요 발언 뉴스 정리해줘',
        provider: 'auto',
        task_type: 'chat'
      }
    });

    expect(respond.statusCode).toBe(200);
    const body = respond.json() as {
      data: {
        provider: string;
        model: string;
        output: string;
        delivery?: { mode?: string };
        grounding?: {
          status?: string;
          source_count?: number;
          domain_count?: number;
          quality_gate_result?: string;
        };
      };
    };
    expect(body.data.provider).toBe('local');
    expect(body.data.model).toBe('retrieval-fallback-v1');
    expect(body.data.output).toContain('주요 뉴스 브리핑');
    expect(body.data.output).toContain('reuters.com/world/trump-defense-posture');
    expect(body.data.output).toContain('apnews.com/article/us-admin-middle-east-briefing');
    expect(body.data.grounding?.status).toBe('served_with_limits');
    expect(body.data.grounding?.quality_gate_result).toBe('pass');
    expect((body.data.grounding?.source_count ?? 0)).toBeGreaterThanOrEqual(2);
    expect((body.data.grounding?.domain_count ?? 0)).toBeGreaterThanOrEqual(2);
    expect(body.data.delivery?.mode).toBe('degraded');

    await app.close();
  });

  it('uses local grounded retrieval fallback for dynamic factual prompts when external providers are unavailable', async () => {
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'true';
    const recentA = new Date(Date.now() - 45 * 60 * 1000).toUTCString();
    const recentB = new Date(Date.now() - 105 * 60 * 1000).toUTCString();

    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>트럼프 오늘 발언: 동맹 방위비 기조 재확인</title>',
      '<link>https://www.reuters.com/world/trump-defense-posture</link>',
      '<description>트럼프 오늘 발언에서 동맹 방위비와 안보 책임 분담을 강조했다.</description>',
      `<pubDate>${recentA}</pubDate>`,
      '</item>',
      '<item>',
      '<title>미 행정부, 중동 안보 대응 브리핑 공개</title>',
      '<link>https://apnews.com/article/us-admin-middle-east-briefing</link>',
      '<description>행정부는 중동 안보 대응 관련 발언의 배경을 설명했다.</description>',
      `<pubDate>${recentB}</pubDate>`,
      '</item>',
      '</channel></rss>'
    ].join('');

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (
        url.includes('news.google.com/rss') ||
        url.includes('feeds.bbci.co.uk/news/rss.xml') ||
        url.includes('rss.nytimes.com/services/xml/rss/nyt/HomePage.xml') ||
        url.includes('www.aljazeera.com/xml/rss/all.xml') ||
        url.includes('www.yna.co.kr/rss/news.xml')
      ) {
        return new Response(rssXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' }
        });
      }
      if (url.includes('/v1/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '오늘 트럼프 발언은 동맹 방위비 분담 압박과 중동 안보 대응을 동시에 강조한 것으로 해석됩니다.\n행정부 브리핑까지 종합하면 대외 안보 메시지의 강경 기조가 유지되는 흐름입니다.'
                }
              }
            ],
            usage: {
              prompt_tokens: 13,
              completion_tokens: 21
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const respond = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      payload: {
        prompt: '오늘 트럼프 주요 발언 뉴스 정리해줘',
        provider: 'auto',
        task_type: 'chat'
      }
    });

    expect(respond.statusCode).toBe(200);
    const body = respond.json() as {
      data: {
        provider: string;
        output: string;
        grounding?: {
          policy?: string;
          status?: string;
          source_count?: number;
          domain_count?: number;
          quality_gate_code?: string[];
          retrieval_quality_gate_code?: string[];
          quality_gate?: { passed?: boolean };
        };
      };
    };
    expect(body.data.provider).toBe('local');
    expect(body.data.output).toContain('Sources:');
    expect(body.data.output).toContain('reuters.com/world/trump-defense-posture');
    expect(body.data.output).toContain('apnews.com/article/us-admin-middle-east-briefing');
    expect(body.data.grounding?.policy).toBe('dynamic_factual');
    expect(body.data.grounding?.status).toBe('provider_only');
    expect(body.data.grounding?.quality_gate?.passed).toBe(true);
    expect(body.data.grounding?.quality_gate_code).toEqual([]);
    expect((body.data.grounding?.source_count ?? 0)).toBeGreaterThanOrEqual(2);
    expect((body.data.grounding?.domain_count ?? 0)).toBeGreaterThanOrEqual(2);
    expect(body.data.grounding?.retrieval_quality_gate_code).toEqual([]);

    await app.close();
  });

  it('uses local grounded retrieval fallback for news prompts when external providers are unavailable', async () => {
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'true';
    const recentA = new Date(Date.now() - 60 * 60 * 1000).toUTCString();
    const recentB = new Date(Date.now() - 2 * 60 * 60 * 1000).toUTCString();

    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>Global markets rebound as inflation slows</title>',
      '<link>https://www.reuters.com/world/markets-rebound</link>',
      '<description>Investors reacted to softer inflation data.</description>',
      `<pubDate>${recentA}</pubDate>`,
      '</item>',
      '<item>',
      '<title>Oil eases while equities rise in late trading</title>',
      '<link>https://www.bloomberg.com/markets/oil-equities-rise</link>',
      '<description>Late-session moves reflected easing commodity pressure.</description>',
      `<pubDate>${recentB}</pubDate>`,
      '</item>',
      '</channel></rss>'
    ].join('');

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('news.google.com/rss/search')) {
        return new Response(rssXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' }
        });
      }
      if (url.includes('/v1/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    facts: [
                      {
                        headline: '글로벌 시장 반등',
                        summary: '인플레이션 완화 신호 이후 글로벌 시장이 반등했습니다.',
                        why_it_matters: '위험자산 선호가 단기적으로 회복될 가능성이 커졌습니다.',
                        event_date: new Date().toISOString().slice(0, 10),
                        source_urls: ['https://www.reuters.com/world/markets-rebound']
                      },
                      {
                        headline: '유가 완화와 주식 상승',
                        summary: '장 후반 유가 압력이 완화되며 주식이 상승했습니다.',
                        source_urls: ['https://www.bloomberg.com/markets/oil-equities-rise']
                      }
                    ]
                  })
                }
              }
            ],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 18
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const respond = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      payload: {
        prompt: '최신 뉴스 중에 주요 뉴스 브리핑 해봐',
        provider: 'auto',
        task_type: 'chat'
      }
    });

    expect(respond.statusCode).toBe(200);
    const body = respond.json() as {
      data: {
        provider: string;
        output: string;
        grounding?: {
          render_mode?: string;
          status?: string;
          sources?: Array<{ url: string }>;
          source_count?: number;
          domain_count?: number;
          freshness_ratio?: number | null;
          quality_gate_code?: string[];
          retrieval_quality_gate_code?: string[];
          quality_gate?: { passed?: boolean };
        };
      };
    };
    expect(body.data.provider).toBe('local');
    expect(body.data.output).toContain('주요 뉴스 브리핑');
    expect(body.data.output).toContain('reuters.com/world/markets-rebound');
    expect(body.data.grounding?.status).toBe('provider_only');
    expect(body.data.grounding?.render_mode).toBe('user_mode');
    expect(body.data.grounding?.quality_gate?.passed).toBe(true);
    expect(body.data.grounding?.quality_gate_code).toEqual([]);
    expect((body.data.grounding?.source_count ?? 0)).toBeGreaterThanOrEqual(2);
    expect((body.data.grounding?.domain_count ?? 0)).toBeGreaterThanOrEqual(2);
    expect(
      body.data.grounding?.freshness_ratio === null || typeof body.data.grounding?.freshness_ratio === 'number'
    ).toBe(true);
    expect(body.data.grounding?.sources?.some((item) => item.url.includes('reuters.com/world/markets-rebound'))).toBe(true);
    expect(body.data.grounding?.sources?.some((item) => item.url.includes('bloomberg.com/markets/oil-equities-rise'))).toBe(true);

    await app.close();
  });

  it('blocks local news fallback when retrieval quality gate fails', async () => {
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'true';
    const staleDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toUTCString();

    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>Stale article</title>',
      '<link>https://www.reuters.com/world/stale-article</link>',
      '<description>Outdated briefing source.</description>',
      `<pubDate>${staleDate}</pubDate>`,
      '</item>',
      '</channel></rss>'
    ].join('');

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('news.google.com/rss/search')) {
        return new Response(rssXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' }
        });
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await buildServer();

    const respond = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      payload: {
        prompt: '최신 뉴스 중에 주요 뉴스 브리핑 해봐',
        provider: 'auto',
        task_type: 'chat'
      }
    });

    expect(respond.statusCode).toBe(503);
    const body = respond.json() as {
      error: {
        code: string;
        message: string;
        details?: {
          reason?: string;
          retrieval_quality_gate?: {
            passed: boolean;
            reasons: string[];
          };
        };
      };
    };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toContain('검색 근거 품질 검증에 실패했습니다');
    expect(body.error.details?.reason).toBe('INSUFFICIENT_EVIDENCE');
    expect(body.error.details?.retrieval_quality_gate?.passed).toBe(false);
    expect(body.error.details?.retrieval_quality_gate?.reasons).toContain('insufficient_retrieval_sources');

    await app.close();
  });

  it('returns quality-gate blocked output when dynamic factual response has no sources', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LOCAL_LLM_ENABLED = 'false';
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          output_text: '환율은 상승세입니다. 시장은 변동성이 큽니다.',
          usage: { input_tokens: 12, output_tokens: 20 }
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

    const respond = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      payload: {
        prompt: '오늘 환율 요약해줘',
        provider: 'openai',
        strict_provider: true,
        task_type: 'chat'
      }
    });

    expect(respond.statusCode).toBe(200);
    const body = respond.json() as {
      data: {
        output: string;
        grounding?: {
          status?: string;
          quality_gate_code?: string[];
          quality_gate_result?: string;
          quality_gate?: {
            passed?: boolean;
            reasons?: string[];
          };
        };
      };
    };
    expect(body.data.output).toContain('검색 근거 품질 검증에 실패했습니다.');
    expect(body.data.grounding?.status).toBe('blocked_due_to_quality_gate');
    expect(body.data.grounding?.quality_gate?.passed).toBe(false);
    expect(body.data.grounding?.quality_gate_code).toContain('insufficient_retrieval_sources');
    expect(body.data.grounding?.quality_gate?.reasons).toContain('insufficient_retrieval_sources');

    await app.close();
  });

  it('returns soft warning output when response language mismatches prompt language', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LOCAL_LLM_ENABLED = 'false';
    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>Markets react to sanctions</title>',
      '<link>https://www.bbc.com/news/world-00000001</link>',
      '<description>Markets rallied after sanctions update.</description>',
      '<pubDate>Tue, 03 Mar 2026 06:00:00 GMT</pubDate>',
      '</item>',
      '<item>',
      '<title>Diplomatic tensions rise</title>',
      '<link>https://www.reuters.com/world/diplomatic-tensions-rise-2026-03-03/</link>',
      '<description>Governments announced new sanctions.</description>',
      '<pubDate>Tue, 03 Mar 2026 06:10:00 GMT</pubDate>',
      '</item>',
      '</channel></rss>'
    ].join('');
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (
        url.includes('news.google.com/rss') ||
        url.includes('feeds.bbci.co.uk/news/rss.xml') ||
        url.includes('rss.nytimes.com/services/xml/rss/nyt/HomePage.xml') ||
        url.includes('www.aljazeera.com/xml/rss/all.xml') ||
        url.includes('www.yna.co.kr/rss/news.xml')
      ) {
        return new Response(rssXml, {
          status: 200,
          headers: {
            'content-type': 'application/xml'
          }
        });
      }
      return new Response(
        JSON.stringify({
          output_text: [
            'Top world news briefing: markets rallied and governments announced new sanctions.',
            '',
            'Sources:',
            '- [BBC](https://www.bbc.com/news/world-00000001)'
          ].join('\n'),
          usage: { input_tokens: 12, output_tokens: 24 }
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

    const respond = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      payload: {
        prompt: '오늘 주요 뉴스 브리핑 해줘',
        provider: 'openai',
        strict_provider: true,
        task_type: 'chat'
      }
    });

    expect(respond.statusCode).toBe(200);
    const body = respond.json() as {
      data: {
        output: string;
        grounding?: {
          status?: string;
          quality_gate_code?: string[];
          quality_gate_result?: string;
          quality_gate?: {
            passed?: boolean;
            reasons?: string[];
          };
        };
      };
    };
    expect(body.data.output).toContain('Top world news briefing');
    expect(body.data.grounding?.status).toBe('soft_warn');
    expect(body.data.grounding?.quality_gate?.passed).toBe(true);
    expect(body.data.grounding?.quality_gate_result).toBe('soft_warn');
    expect(body.data.grounding?.quality_gate_code).toContain('language_mismatch');
    expect(body.data.grounding?.quality_gate?.reasons).toContain('language_mismatch');

    await app.close();
  });

  it('returns soft warning output when claim citation coverage is insufficient', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LOCAL_LLM_ENABLED = 'false';
    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss><channel>',
      '<item>',
      '<title>Markets rally after policy shift</title>',
      '<link>https://www.bbc.com/news/world-00000001</link>',
      '<description>UK markets rallied after policy shift.</description>',
      '<pubDate>Tue, 03 Mar 2026 06:00:00 GMT</pubDate>',
      '</item>',
      '<item>',
      '<title>Oil prices shift on supply outlook</title>',
      '<link>https://www.reuters.com/world/oil-supply-outlook-2026-03-03/</link>',
      '<description>Global oil prices moved on renewed supply concerns.</description>',
      '<pubDate>Tue, 03 Mar 2026 06:15:00 GMT</pubDate>',
      '</item>',
      '</channel></rss>'
    ].join('');
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (
        url.includes('news.google.com/rss') ||
        url.includes('feeds.bbci.co.uk/news/rss.xml') ||
        url.includes('rss.nytimes.com/services/xml/rss/nyt/HomePage.xml') ||
        url.includes('www.aljazeera.com/xml/rss/all.xml') ||
        url.includes('www.yna.co.kr/rss/news.xml')
      ) {
        return new Response(rssXml, {
          status: 200,
          headers: {
            'content-type': 'application/xml'
          }
        });
      }
      return new Response(
        JSON.stringify({
          output_text: [
            '가상의 거시 경제 지표 A가 급등하면서 시장 변동성이 확대되었다.',
            '임의의 산업 지표 B가 급락하면서 투자 심리가 크게 위축되었다.',
            '',
            'Sources:',
            '- [Markets rally after policy shift](https://www.bbc.com/news/world-00000001)'
          ].join('\n'),
          usage: { input_tokens: 18, output_tokens: 30 }
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

    const respond = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/respond',
      payload: {
        prompt: 'latest market headlines briefing with sources',
        provider: 'openai',
        strict_provider: true,
        task_type: 'chat'
      }
    });

    expect(respond.statusCode).toBe(200);
    const body = respond.json() as {
      data: {
        output: string;
        grounding?: {
          status?: string;
          quality_gate_code?: string[];
          quality_gate_result?: string;
          quality_gate?: {
            passed?: boolean;
            reasons?: string[];
          };
        };
      };
    };
    expect(body.data.output).toContain('가상의 거시 경제 지표 A가 급등하면서 시장 변동성이 확대되었다.');
    expect(body.data.grounding?.status).toBe('soft_warn');
    expect(body.data.grounding?.quality_gate?.passed).toBe(true);
    expect(body.data.grounding?.quality_gate_result).toBe('soft_warn');
    expect(body.data.grounding?.quality_gate_code).toContain('insufficient_claim_citation_coverage');
    expect(body.data.grounding?.quality_gate?.reasons).toContain('insufficient_claim_citation_coverage');

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
          auth_allow_signup: boolean;
          auth_token_configured: boolean;
        };
        notification_runtime?: {
          channels: Array<{
            name: string;
            skipped: number;
          }>;
        } | null;
        notification_policy?: {
          in_app: {
            enabled: boolean;
            min_severity: string;
          };
          webhook: {
            enabled: boolean;
            event_types: string[];
          };
          telegram: {
            enabled: boolean;
            event_types: string[];
          };
        };
      };
    };

    expect(body.data.providers.map((item) => item.provider)).toEqual(['openai', 'gemini', 'anthropic', 'local']);
    expect(body.data.providers.every((item) => typeof item.attempts === 'number')).toBe(true);
    expect(body.data.providers.every((item) => typeof item.avg_latency_ms === 'number')).toBe(true);
    expect(body.data.policies.high_risk_requires_approval).toBe(true);
    expect(body.data.policies.provider_failover_auto).toBe(true);
    expect(typeof body.data.policies.approval_max_age_hours).toBe('number');
    expect(typeof body.data.policies.auth_allow_signup).toBe('boolean');
    expect(typeof body.data.policies.auth_token_configured).toBe('boolean');
    expect(body.data.notification_policy?.in_app.enabled).toBe(true);
    expect(body.data.notification_policy?.in_app.min_severity).toBe('info');
    expect(Array.isArray(body.data.notification_policy?.webhook.event_types)).toBe(true);
    expect(Array.isArray(body.data.notification_policy?.telegram.event_types)).toBe(true);
    expect(
      (body.data.notification_runtime?.channels ?? []).every((channel) => typeof channel.skipped === 'number')
    ).toBe(true);

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

  it('requires admin role to update provider policies', async () => {
    const { app } = await buildServer();

    const memberAttempt = await app.inject({
      method: 'PUT',
      url: '/api/v1/providers/policies',
      headers: {
        'x-user-role': 'member'
      },
      payload: {
        task_type: 'execute',
        provider: 'openai',
        model_id: 'gpt-4.1-mini'
      }
    });
    expect(memberAttempt.statusCode).toBe(403);

    const adminAttempt = await app.inject({
      method: 'PUT',
      url: '/api/v1/providers/policies',
      headers: {
        'x-user-role': 'admin'
      },
      payload: {
        task_type: 'execute',
        provider: 'openai',
        model_id: 'gpt-4.1-mini'
      }
    });
    expect(adminAttempt.statusCode).toBe(422);

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

    const authConfig = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/config'
    });
    expect(authConfig.statusCode).toBe(200);
    const authConfigBody = authConfig.json() as {
      data: {
        auth_required: boolean;
        auth_allow_signup: boolean;
        auth_token_configured: boolean;
      };
    };
    expect(authConfigBody.data.auth_required).toBe(true);
    expect(authConfigBody.data.auth_token_configured).toBe(true);

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

  it('supports static token login endpoint and issues auth cookie', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'auth_token_for_test';
    const { app } = await buildServer();

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/static-token/login',
      payload: {
        token: 'invalid_token'
      }
    });
    expect(denied.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/static-token/login',
      payload: {
        token: 'auth_token_for_test'
      }
    });
    expect(login.statusCode).toBe(200);
    const body = login.json() as {
      data: {
        user: {
          role: string;
        };
        auth_type: string;
        expires_at: string;
      };
    };
    expect(body.data.auth_type).toBe('static_token');
    expect(body.data.user.role).toBe('admin');
    expect(typeof body.data.expires_at).toBe('string');

    const setCookieHeader = login.headers['set-cookie'];
    const setCookie = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : String(setCookieHeader ?? '');
    expect(setCookie).toContain('jarvis_auth_token=');
    expect(setCookie).toContain('HttpOnly');

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?limit=10',
      headers: {
        cookie: setCookie
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
    const signupSetCookieHeader = signup.headers['set-cookie'];
    const signupSetCookie = Array.isArray(signupSetCookieHeader)
      ? signupSetCookieHeader.join('; ')
      : String(signupSetCookieHeader ?? '');
    expect(signupSetCookie).toContain('jarvis_auth_token=');
    expect(signupSetCookie).toContain('HttpOnly');

    const meWithCookie = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        cookie: signupSetCookie
      }
    });
    expect(meWithCookie.statusCode).toBe(200);

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
    const loginSetCookieHeader = login.headers['set-cookie'];
    const loginSetCookie = Array.isArray(loginSetCookieHeader)
      ? loginSetCookieHeader.join('; ')
      : String(loginSetCookieHeader ?? '');
    expect(loginSetCookie).toContain('jarvis_auth_token=');
    expect(loginSetCookie).toContain('HttpOnly');

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
    const logoutSetCookieHeader = logout.headers['set-cookie'];
    const logoutSetCookie = Array.isArray(logoutSetCookieHeader)
      ? logoutSetCookieHeader.join('; ')
      : String(logoutSetCookieHeader ?? '');
    expect(logoutSetCookie).toContain('jarvis_auth_token=');
    expect(logoutSetCookie).toContain('Max-Age=0');

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

  it('supports user-scoped provider credentials with user->workspace->env resolution', async () => {
    process.env.OPENAI_API_KEY = 'env-openai-key';
    process.env.LOCAL_LLM_ENABLED = 'false';

    const { app } = await buildServer();
    const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/providers/credentials/openai',
      headers: {
        'x-user-id': userA
      }
    });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as {
      data: {
        source: string;
        selected_credential_mode: string | null;
      };
    };
    expect(beforeBody.data.source).toBe('env');
    expect(beforeBody.data.selected_credential_mode).toBe('api_key');

    const upsert = await app.inject({
      method: 'PUT',
      url: '/api/v1/providers/credentials/openai',
      headers: {
        'x-user-id': userA
      },
      payload: {
        api_key: 'user-openai-key-123'
      }
    });
    expect(upsert.statusCode).toBe(200);
    const upsertBody = upsert.json() as {
      data: {
        source: string;
        has_user_api_key: boolean;
      };
    };
    expect(upsertBody.data.source).toBe('user');
    expect(upsertBody.data.has_user_api_key).toBe(true);

    const scopedOtherUser = await app.inject({
      method: 'GET',
      url: '/api/v1/providers/credentials/openai',
      headers: {
        'x-user-id': userB
      }
    });
    expect(scopedOtherUser.statusCode).toBe(200);
    const scopedOtherUserBody = scopedOtherUser.json() as {
      data: {
        source: string;
      };
    };
    expect(scopedOtherUserBody.data.source).toBe('env');

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/providers/credentials/openai',
      headers: {
        'x-user-id': userA
      }
    });
    expect(deleted.statusCode).toBe(200);
    const deletedBody = deleted.json() as {
      data: {
        deleted: boolean;
        source: string;
      };
    };
    expect(deletedBody.data.deleted).toBe(true);
    expect(deletedBody.data.source).toBe('env');

    await app.close();
  });

  it('supports oauth start/complete with single-use state for gemini', async () => {
    process.env.PROVIDER_USER_CREDENTIALS_ENABLED = 'true';
    process.env.PROVIDER_OAUTH_GEMINI_ENABLED = 'true';
    process.env.GEMINI_OAUTH_CLIENT_ID = 'gemini-oauth-client-id';
    process.env.GEMINI_OAUTH_CLIENT_SECRET = 'gemini-oauth-client-secret';
    process.env.GEMINI_OAUTH_REDIRECT_URI = 'http://localhost:3000/oauth/callback';
    process.env.GEMINI_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
    process.env.GEMINI_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
    process.env.GEMINI_OAUTH_SCOPES = 'https://www.googleapis.com/auth/generative-language';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'oauth-access-token',
          refresh_token: 'oauth-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/generative-language'
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
    const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/providers/credentials/gemini/auth/start',
      headers: {
        'x-user-id': userId
      }
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as {
      data: {
        state: string;
        auth_url: string;
      };
    };
    expect(startBody.data.state.length).toBeGreaterThan(10);
    expect(startBody.data.auth_url).toContain('code_challenge=');

    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/providers/credentials/gemini/auth/complete',
      headers: {
        'x-user-id': userId
      },
      payload: {
        state: startBody.data.state,
        code: 'oauth-code-123'
      }
    });
    expect(complete.statusCode).toBe(200);
    const completeBody = complete.json() as {
      data: {
        provider: string;
        source: string;
        selected_credential_mode: string | null;
        has_user_oauth_token: boolean;
      };
    };
    expect(completeBody.data.provider).toBe('gemini');
    expect(completeBody.data.source).toBe('user');
    expect(completeBody.data.selected_credential_mode).toBe('oauth_official');
    expect(completeBody.data.has_user_oauth_token).toBe(true);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/providers/credentials/gemini/auth/complete',
      headers: {
        'x-user-id': userId
      },
      payload: {
        state: startBody.data.state,
        code: 'oauth-code-123'
      }
    });
    expect(replay.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('includes codex allowlist models in user catalog when openai oauth is connected', async () => {
    process.env.PROVIDER_USER_CREDENTIALS_ENABLED = 'true';
    process.env.PROVIDER_OAUTH_OPENAI_ENABLED = 'true';
    process.env.OPENAI_OAUTH_CLIENT_ID = 'openai-oauth-client-id';
    process.env.OPENAI_OAUTH_CLIENT_SECRET = 'openai-oauth-client-secret';
    process.env.OPENAI_OAUTH_REDIRECT_URI = 'http://localhost:3000/oauth/callback';
    process.env.OPENAI_OAUTH_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
    process.env.OPENAI_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
    process.env.OPENAI_OAUTH_SCOPES = 'openid profile email offline_access';
    process.env.OPENAI_CODEX_MODEL_ALLOWLIST = 'gpt-5,gpt-5-mini,gpt-5-nano';
    process.env.OPENAI_MODEL = 'gpt-4.1-mini';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'openai-oauth-access-token',
          refresh_token: 'openai-oauth-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'openid profile email offline_access'
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
    const userId = 'f9f9f9f9-f9f9-49f9-89f9-f9f9f9f9f9f9';

    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/providers/credentials/openai/auth/start',
      headers: {
        'x-user-id': userId
      }
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as {
      data: {
        state: string;
      };
    };

    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/providers/credentials/openai/auth/complete',
      headers: {
        'x-user-id': userId
      },
      payload: {
        state: startBody.data.state,
        code: 'openai-oauth-code-123'
      }
    });
    expect(complete.statusCode).toBe(200);

    const catalog = await app.inject({
      method: 'GET',
      url: '/api/v1/providers/models?scope=user',
      headers: {
        'x-user-id': userId
      }
    });
    expect(catalog.statusCode).toBe(200);
    const catalogBody = catalog.json() as {
      data: {
        providers: Array<{ provider: string; models: string[]; recommended_model?: string }>;
      };
    };
    const openaiCatalog = catalogBody.data.providers.find((row) => row.provider === 'openai');
    expect(openaiCatalog).toBeTruthy();
    expect(openaiCatalog?.models).toContain('gpt-5');
    expect(openaiCatalog?.models).toContain('gpt-5-mini');
    expect(openaiCatalog?.models).toContain('gpt-5-nano');
    expect(openaiCatalog?.recommended_model).toBe('gpt-5');

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

  it('links manual council runs into jarvis sessions when client_session_id is provided', async () => {
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
    const userId = '0d1e2f30-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const sessionId = '3f64c09f-fb0d-4be1-b981-6350810c5a20';

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/councils/runs',
      headers: {
        'x-user-id': userId,
        'idempotency-key': 'idem-council-link-001',
        'x-trace-id': 'trace-council-link-001'
      },
      payload: {
        question: 'Should we centralize retries?',
        create_task: true,
        client_session_id: sessionId
      }
    });

    expect(create.statusCode).toBe(202);
    const createBody = create.json() as {
      data: {
        id: string;
        task_id: string | null;
        session: { id: string; councilRunId: string | null; taskId: string | null; primaryTarget: string; status: string } | null;
      };
    };
    expect(createBody.data.session?.id).toBe(sessionId);
    expect(createBody.data.session?.primaryTarget).toBe('council');
    expect(createBody.data.session?.councilRunId).toBe(createBody.data.id);
    expect(createBody.data.session?.taskId).toBe(createBody.data.task_id);

    const settled = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/jarvis/sessions/${sessionId}`,
          headers: {
            'x-user-id': userId
          }
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) return false;
          const body = response.json() as { data: { session: { status: string } } };
          return body.data.session.status === 'completed' || body.data.session.status === 'failed';
        }
      }
    );

    expect(settled.statusCode).toBe(200);
    const settledBody = settled.json() as {
      data: {
        session: { councilRunId: string | null; status: string };
      };
    };
    expect(settledBody.data.session.councilRunId).toBe(createBody.data.id);
    expect(settledBody.data.session.status).toBe('completed');

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

  it('links manual execution runs into jarvis sessions when client_session_id is provided', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: 'Execution output: return 42;',
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
    const userId = '0d1e2f30-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const sessionId = 'a25e43a1-5151-4c0d-a4ec-c2425f79f74a';

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/executions/runs',
      headers: {
        'x-user-id': userId,
        'idempotency-key': 'idem-execution-link-001',
        'x-trace-id': 'trace-execution-link-001'
      },
      payload: {
        mode: 'code',
        prompt: 'Write a concise helper.',
        create_task: true,
        client_session_id: sessionId
      }
    });

    expect(create.statusCode).toBe(202);
    const createBody = create.json() as {
      data: {
        id: string;
        task_id: string | null;
        session: { id: string; executionRunId: string | null; taskId: string | null; primaryTarget: string; status: string } | null;
      };
    };
    expect(createBody.data.session?.id).toBe(sessionId);
    expect(createBody.data.session?.primaryTarget).toBe('execution');
    expect(createBody.data.session?.executionRunId).toBe(createBody.data.id);
    expect(createBody.data.session?.taskId).toBe(createBody.data.task_id);

    const settled = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/jarvis/sessions/${sessionId}`,
          headers: {
            'x-user-id': userId
          }
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) return false;
          const body = response.json() as { data: { session: { status: string } } };
          return body.data.session.status === 'completed' || body.data.session.status === 'failed';
        }
      }
    );

    expect(settled.statusCode).toBe(200);
    const settledBody = settled.json() as {
      data: {
        session: { executionRunId: string | null; status: string };
      };
    };
    expect(settledBody.data.session.executionRunId).toBe(createBody.data.id);
    expect(settledBody.data.session.status).toBe('completed');

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

  it('verifies openai webhook signature using raw request body', async () => {
    process.env.OPENAI_WEBHOOK_SECRET = 'openai_secret';
    const { app } = await buildServer();

    const rawPayload = JSON.stringify({
      id: 'evt_123',
      type: 'response.completed'
    });
    const signature = createHmac('sha256', 'openai_secret').update(rawPayload).digest('hex');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/openai/webhook',
      headers: {
        'content-type': 'application/json',
        'x-jarvis-openai-signature': signature
      },
      payload: rawPayload
    });
    expect(accepted.statusCode).toBe(200);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/openai/webhook',
      headers: {
        'content-type': 'application/json',
        'x-jarvis-openai-signature': 'invalid'
      },
      payload: rawPayload
    });
    expect(rejected.statusCode).toBe(401);

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

  it('creates grounded jarvis dossier session for factual prompts', async () => {
    const { app } = await buildServer();
    const userId = '22222222-2222-4222-8222-222222222222';
    const rss = `
      <rss><channel>
        <item>
          <title>Major diplomatic talks continue</title>
          <link>https://example.com/world/diplomatic-talks</link>
          <description>Leaders confirmed new talks and sanctions review.</description>
          <pubDate>Thu, 05 Mar 2026 12:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Global markets react to security tensions</title>
          <link>https://example.org/markets/security-tensions</link>
          <description>Markets moved as investors priced in geopolitical risk.</description>
          <pubDate>Thu, 05 Mar 2026 10:00:00 GMT</pubDate>
        </item>
      </channel></rss>
    `;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => rss
      }))
    );

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/jarvis/requests',
      headers: {
        'x-user-id': userId
      },
      payload: {
        prompt: '오늘 세계 주요 뉴스와 전쟁 관련 최신 동향을 근거와 함께 브리핑해줘',
        client_session_id: '7a267773-fdc4-4f4d-b9b4-ebf09b0d2d74'
      }
    });

    expect(create.statusCode).toBe(201);
    const createBody = create.json() as {
      data: {
        session: { id: string; primaryTarget: string; dossierId: string | null; briefingId: string | null; status: string };
        delegation: { primary_target: string; dossier_id?: string; briefing_id?: string };
      };
    };
    expect(createBody.data.delegation.primary_target).toBe('dossier');
    expect(createBody.data.session.status).toBe('completed');
    expect(createBody.data.session.dossierId).toBeTruthy();
    expect(createBody.data.session.briefingId).toBeTruthy();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/jarvis/sessions/${createBody.data.session.id}`,
      headers: {
        'x-user-id': userId
      }
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as {
      data: {
        dossier: { id: string };
        briefing: { id: string };
        events: Array<{ eventType: string }>;
      };
    };
    expect(detailBody.data.dossier.id).toBe(createBody.data.session.dossierId);
    expect(detailBody.data.briefing.id).toBe(createBody.data.session.briefingId);
    expect(detailBody.data.events.some((event) => event.eventType === 'dossier.compiled')).toBe(true);

    await app.close();
  });

  it('creates approval-gated mission session and watcher runs', async () => {
    const { app } = await buildServer();
    const userId = '33333333-3333-4333-8333-333333333333';
    const rss = `
      <rss><channel>
        <item>
          <title>Repo health issue discovered</title>
          <link>https://example.com/engineering/repo-health</link>
          <description>CI instability and flaky test incidents are rising.</description>
          <pubDate>Thu, 05 Mar 2026 09:00:00 GMT</pubDate>
        </item>
      </channel></rss>
    `;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => rss
      }))
    );

    const sessionCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/jarvis/requests',
      headers: {
        'x-user-id': userId
      },
      payload: {
        prompt: '먼저 이슈를 조사하고 그 다음 계획을 세우고 마지막으로 승인 후 실행해줘',
        client_session_id: '24dc58c4-4ad5-4b16-95b9-b37ade421b7f'
      }
    });
    expect(sessionCreate.statusCode).toBe(201);
    const sessionBody = sessionCreate.json() as {
      data: {
        session: { id: string; status: string; missionId: string | null };
        delegation: { primary_target: string; action_proposal_id?: string };
      };
    };
    expect(sessionBody.data.delegation.primary_target).toBe('mission');
    expect(sessionBody.data.session.status).toBe('needs_approval');
    expect(sessionBody.data.session.missionId).toBeTruthy();
    expect(sessionBody.data.delegation.action_proposal_id).toBeTruthy();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/jarvis/sessions/${sessionBody.data.session.id}`,
      headers: {
        'x-user-id': userId
      }
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as { data: { actions: Array<{ id: string; status: string }> } };
    expect(detailBody.data.actions[0]?.status).toBe('pending');

    const watcherCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/watchers',
      headers: {
        'x-user-id': userId
      },
      payload: {
        kind: 'repo',
        title: 'Repo Health',
        query: 'CI failures and flaky tests latest updates'
      }
    });
    expect(watcherCreate.statusCode).toBe(201);
    const watcherBody = watcherCreate.json() as { data: { id: string } };

    const watcherRun = await app.inject({
      method: 'POST',
      url: `/api/v1/watchers/${watcherBody.data.id}/run`,
      headers: {
        'x-user-id': userId
      }
    });
    expect(watcherRun.statusCode).toBe(200);
    const watcherRunBody = watcherRun.json() as {
      data: {
        run: { status: string };
        briefing: { id: string };
        dossier: { id: string };
      };
    };
    expect(watcherRunBody.data.run.status).toBe('completed');
    expect(watcherRunBody.data.briefing.id).toBeTruthy();
    expect(watcherRunBody.data.dossier.id).toBeTruthy();

    await app.close();
  });

  it('routes explicit council jarvis requests into council runs', async () => {
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
    const userId = '34343434-3434-4343-8434-343434343434';

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/jarvis/requests',
      headers: {
        'x-user-id': userId,
        'x-trace-id': 'trace-jarvis-council-001'
      },
      payload: {
        prompt: '이 문제를 Agent Council로 보내서 찬성, 반대, 리스크 관점으로 토론하고 최종 결론을 내줘',
        client_session_id: '6f1964fb-6a9d-4751-b295-7b54bc2be0bb'
      }
    });

    expect(create.statusCode).toBe(201);
    const createBody = create.json() as {
      data: {
        session: {
          id: string;
          intent: string;
          primaryTarget: string;
          councilRunId: string | null;
          taskId: string | null;
          status: string;
        };
        delegation: {
          intent: string;
          primary_target: string;
          council_run_id?: string;
          task_id?: string;
        };
      };
    };

    expect(createBody.data.session.intent).toBe('council');
    expect(createBody.data.session.primaryTarget).toBe('council');
    expect(createBody.data.session.councilRunId).toBeTruthy();
    expect(createBody.data.session.taskId).toBeTruthy();
    expect(createBody.data.delegation.intent).toBe('council');
    expect(createBody.data.delegation.primary_target).toBe('council');
    expect(createBody.data.delegation.council_run_id).toBe(createBody.data.session.councilRunId);
    expect(createBody.data.delegation.task_id).toBe(createBody.data.session.taskId);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/jarvis/sessions/${createBody.data.session.id}`,
      headers: {
        'x-user-id': userId
      }
    });

    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as {
      data: {
        session: { councilRunId: string | null; status: string };
        events: Array<{ eventType: string }>;
      };
    };
    expect(detailBody.data.session.councilRunId).toBe(createBody.data.session.councilRunId);
    expect(detailBody.data.events.some((event) => event.eventType === 'council.run.created')).toBe(true);

    await app.close();
  });

  it('forces assistant target when jarvis request target_hint is assistant', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const { app } = await buildServer();
    const userId = '45454545-4545-4545-8545-454545454545';

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/jarvis/requests',
      headers: {
        'x-user-id': userId
      },
      payload: {
        prompt: '오늘 세계 주요 뉴스 정리해줘',
        client_session_id: '95a18c3b-7593-4c50-85d5-543d93c5df90',
        target_hint: 'assistant'
      }
    });

    expect(create.statusCode).toBe(201);
    const createBody = create.json() as {
      data: {
        session: {
          id: string;
          intent: string;
          primaryTarget: string;
          assistantContextId: string | null;
          taskId: string | null;
          status: string;
        };
        delegation: {
          intent: string;
          primary_target: string;
          assistant_context_id?: string;
          task_id?: string;
        };
      };
    };

    expect(createBody.data.session.intent).toBe('news');
    expect(createBody.data.session.primaryTarget).toBe('assistant');
    expect(createBody.data.session.assistantContextId).toBeTruthy();
    expect(createBody.data.session.taskId).toBeTruthy();
    expect(createBody.data.delegation.primary_target).toBe('assistant');
    expect(createBody.data.delegation.assistant_context_id).toBe(createBody.data.session.assistantContextId);
    expect(createBody.data.delegation.task_id).toBe(createBody.data.session.taskId);

    await app.close();
  });

  it('lists, finds, previews, and executes skills', async () => {
    const { app } = await buildServer();
    const userId = '44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const rss = `
      <rss><channel>
        <item>
          <title>Global headlines remain volatile</title>
          <link>https://example.com/world/global-headlines</link>
          <description>Diplomatic pressure and battlefield updates continued overnight.</description>
          <pubDate>Thu, 05 Mar 2026 13:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Markets respond to war risk</title>
          <link>https://example.org/markets/war-risk</link>
          <description>Investors repriced energy and defense-linked assets.</description>
          <pubDate>Thu, 05 Mar 2026 11:00:00 GMT</pubDate>
        </item>
      </channel></rss>
    `;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => rss
      }))
    );

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/skills',
      headers: {
        'x-user-id': userId
      }
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { data: { skills: Array<{ id: string }> } };
    expect(listBody.data.skills.some((skill) => skill.id === 'deep_research')).toBe(true);

    const find = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/find',
      headers: {
        'x-user-id': userId
      },
      payload: {
        prompt: '오늘 세계 주요 뉴스와 전쟁 관련 동향을 브리핑해줘'
      }
    });
    expect(find.statusCode).toBe(200);
    const findBody = find.json() as { data: { recommended_skill_id: string | null; matches: Array<{ skill: { id: string } }> } };
    expect(findBody.data.recommended_skill_id).toBe('news_briefing');
    expect(findBody.data.matches.length).toBeGreaterThan(0);

    const resource = await app.inject({
      method: 'GET',
      url: '/api/v1/skills/deep_research/resources/playbook',
      headers: {
        'x-user-id': userId
      }
    });
    expect(resource.statusCode).toBe(200);
    const resourceBody = resource.json() as { data: { resource: { title: string; content: string } } };
    expect(resourceBody.data.resource.title).toBe('Research Playbook');
    expect(resourceBody.data.resource.content).toContain('Deep Research Playbook');

    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/use',
      headers: {
        'x-user-id': userId
      },
      payload: {
        skill_id: 'deep_research',
        prompt: '세계 뉴스와 전쟁 동향을 최신 근거로 정리해줘'
      }
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as {
      data: {
        dry_run: boolean;
        result_type: string;
        preview: { suggestedWidgets: string[] };
      };
    };
    expect(previewBody.data.dry_run).toBe(true);
    expect(previewBody.data.result_type).toBe('preview');
    expect(previewBody.data.preview.suggestedWidgets).toContain('dossier');

    const executeResearch = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/use',
      headers: {
        'x-user-id': userId
      },
      payload: {
        skill_id: 'deep_research',
        prompt: '세계 뉴스와 전쟁 동향을 최신 근거로 정리해줘',
        execute: true
      }
    });
    expect(executeResearch.statusCode).toBe(200);
    const executeResearchBody = executeResearch.json() as {
      data: {
        result_type: string;
        session: { id: string; status: string; dossierId: string | null };
      };
    };
    expect(executeResearchBody.data.result_type).toBe('jarvis_request');
    expect(executeResearchBody.data.session.status).toBe('completed');
    expect(executeResearchBody.data.session.dossierId).toBeTruthy();

    const executeRecommendation = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/use',
      headers: {
        'x-user-id': userId
      },
      payload: {
        skill_id: 'model_recommendation_reasoner',
        prompt: '코드 수정 작업에 적합한 모델을 추천해줘',
        execute: true,
        feature_key: 'execution_code'
      }
    });
    expect(executeRecommendation.statusCode).toBe(200);
    const executeRecommendationBody = executeRecommendation.json() as {
      data: {
        result_type: string;
        recommendation: { featureKey: string; recommendedProvider: string; recommendedModelId: string };
      };
    };
    expect(executeRecommendationBody.data.result_type).toBe('model_recommendation');
    expect(executeRecommendationBody.data.recommendation.featureKey).toBe('execution_code');
    expect(executeRecommendationBody.data.recommendation.recommendedProvider).toBeTruthy();
    expect(executeRecommendationBody.data.recommendation.recommendedModelId).toBeTruthy();

    await app.close();
  });

  it('creates safe workspaces, runs low-risk commands, and routes high-risk member commands through approval proposals', async () => {
    const { app } = await buildServer();
    const userId = '55555555-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const createWorkspace = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: {
        'x-user-id': userId,
        'x-user-role': 'member'
      },
      payload: {
        name: 'E2E Runtime',
        cwd: '.'
      }
    });
    expect(createWorkspace.statusCode).toBe(201);
    const workspaceId = (createWorkspace.json() as { data: { id: string } }).data.id;

    const approvalQueued = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/pty/spawn`,
      headers: {
        'x-user-id': userId,
        'x-user-role': 'member'
      },
      payload: {
        command: 'node -p process.version'
      }
    });
    expect(approvalQueued.statusCode).toBe(202);
    const approvalBody = approvalQueued.json() as {
      data: {
        low_risk: boolean;
        requires_approval: boolean;
        policy: {
          riskLevel: string;
          impactProfile: string;
          severity: string;
          impact: {
            files: { level: string };
            network: { level: string };
            processes: { level: string };
            notes: string[];
          };
        };
        session: { id: string; status: string };
        action: { id: string; kind: string; status: string; title: string; summary: string };
      };
    };
    expect(approvalBody.data.low_risk).toBe(false);
    expect(approvalBody.data.requires_approval).toBe(true);
    expect(approvalBody.data.policy.riskLevel).toBe('build');
    expect(approvalBody.data.policy.impactProfile).toBe('process_launch');
    expect(approvalBody.data.policy.severity).toBe('high');
    expect(approvalBody.data.policy.impact.files.level).toBe('possible');
    expect(approvalBody.data.policy.impact.processes.level).toBe('expected');
    expect(approvalBody.data.policy.impact.notes[0]).toContain('primary repository checkout');
    expect(approvalBody.data.session.status).toBe('needs_approval');
    expect(approvalBody.data.action.kind).toBe('workspace_prepare');
    expect(approvalBody.data.action.status).toBe('pending');
    expect(approvalBody.data.action.title).toBe('Approve process launch in E2E Runtime');
    expect(approvalBody.data.action.summary).toContain('runtime or script process');
    expect(approvalBody.data.action.summary).toContain('node -p');

    const queuedSessionDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/jarvis/sessions/${approvalBody.data.session.id}`,
      headers: {
        'x-user-id': userId,
        'x-user-role': 'member'
      }
    });
    expect(queuedSessionDetail.statusCode).toBe(200);
    const queuedSessionBody = queuedSessionDetail.json() as {
      data: {
        actions: Array<{
          id: string;
          title: string;
          summary: string;
          payload: {
            impact_profile?: string;
            policy_severity?: string;
            impact?: {
              files?: { level?: string };
              processes?: { level?: string };
            };
          };
        }>;
      };
    };
    expect(queuedSessionBody.data.actions[0]?.id).toBe(approvalBody.data.action.id);
    expect(queuedSessionBody.data.actions[0]?.title).toBe('Approve process launch in E2E Runtime');
    expect(queuedSessionBody.data.actions[0]?.summary).toContain('runtime or script process');
    expect(queuedSessionBody.data.actions[0]?.payload.impact_profile).toBe('process_launch');
    expect(queuedSessionBody.data.actions[0]?.payload.policy_severity).toBe('high');
    expect(queuedSessionBody.data.actions[0]?.payload.impact?.files?.level).toBe('possible');
    expect(queuedSessionBody.data.actions[0]?.payload.impact?.processes?.level).toBe('expected');

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/jarvis/sessions/${approvalBody.data.session.id}/actions/${approvalBody.data.action.id}/approve`,
      headers: {
        'x-user-id': userId,
        'x-user-role': 'member'
      }
    });
    expect(approve.statusCode).toBe(200);

    const approvedRunSettled = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceId}/pty/read?after_sequence=0&limit=50`,
          headers: {
            'x-user-id': userId,
            'x-user-role': 'member'
          }
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) return false;
          const body = response.json() as { data: { workspace: { status: string }; chunks: Array<{ text: string }> } };
          return body.data.workspace.status !== 'running' && body.data.chunks.some((chunk) => chunk.text.includes('command exited'));
        }
      }
    );
    expect(approvedRunSettled.statusCode).toBe(200);

    const lowRiskSessionId = '8386ce13-7c94-4fb9-af65-8b999d4402aa';
    const spawn = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/pty/spawn`,
      headers: {
        'x-user-id': userId,
        'x-user-role': 'member'
      },
      payload: {
        command: 'pwd',
        client_session_id: lowRiskSessionId
      }
    });
    expect(spawn.statusCode).toBe(202);
    const spawnBody = spawn.json() as {
      data: {
        session?: { id: string; primaryTarget: string } | null;
      };
    };
    expect(spawnBody.data.session?.id).toBe(lowRiskSessionId);
    expect(spawnBody.data.session?.primaryTarget).toBe('execution');

    const settledRead = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceId}/pty/read?after_sequence=0&limit=50`,
          headers: {
            'x-user-id': userId,
            'x-user-role': 'member'
          }
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) return false;
          const body = response.json() as { data: { workspace: { status: string }; chunks: Array<{ text: string }> } };
          return body.data.workspace.status !== 'running' && body.data.chunks.some((chunk) => chunk.text.includes('/Users/woody/ai/brain'));
        }
      }
    );
    expect(settledRead.statusCode).toBe(200);
    const readBody = settledRead.json() as {
      data: {
        workspace: { status: string };
        chunks: Array<{ stream: string; text: string }>;
      };
    };
    expect(readBody.data.workspace.status).toBe('stopped');
    expect(readBody.data.chunks.some((chunk) => chunk.stream === 'stdout')).toBe(true);

    const lowRiskSession = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/jarvis/sessions/${lowRiskSessionId}`,
          headers: {
            'x-user-id': userId,
            'x-user-role': 'member'
          }
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) return false;
          const body = response.json() as { data: { session: { status: string } } };
          return body.data.session.status === 'completed';
        }
      }
    );
    expect(lowRiskSession.statusCode).toBe(200);

    const approvedSession = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/jarvis/sessions/${approvalBody.data.session.id}`,
          headers: {
            'x-user-id': userId,
            'x-user-role': 'member'
          }
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) return false;
          const body = response.json() as { data: { session: { status: string } } };
          return body.data.session.status === 'completed';
        }
      }
    );
    expect(approvedSession.statusCode).toBe(200);

    const shutdown = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/shutdown`,
      headers: {
        'x-user-id': userId,
        'x-user-role': 'member'
      }
    });
    expect(shutdown.statusCode).toBe(200);

    await app.close();
  });

  it('creates and deletes isolated git worktree workspaces for operators', async () => {
    const { app } = await buildServer();
    const userId = '66666666-cccc-4ccc-8ccc-cccccccccccc';

    const createWorktree = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: {
        'x-user-id': userId,
        'x-user-role': 'operator'
      },
      payload: {
        kind: 'worktree',
        name: 'Review Sandbox',
        base_ref: 'HEAD'
      }
    });
    expect(createWorktree.statusCode).toBe(201);
    const worktreeBody = createWorktree.json() as {
      data: {
        id: string;
        kind: string;
        cwd: string;
        baseRef: string | null;
      };
    };
    expect(worktreeBody.data.kind).toBe('worktree');
    expect(worktreeBody.data.baseRef).toBe('HEAD');
    expect(worktreeBody.data.cwd).toContain('/.worktrees/');

    const listWorkspaces = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: {
        'x-user-id': userId,
        'x-user-role': 'operator'
      }
    });
    expect(listWorkspaces.statusCode).toBe(200);
    const listBody = listWorkspaces.json() as { data: { workspaces: Array<{ id: string; kind: string }> } };
    expect(listBody.data.workspaces.some((workspace) => workspace.id === worktreeBody.data.id && workspace.kind === 'worktree')).toBe(
      true
    );

    const deleteWorktree = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${worktreeBody.data.id}`,
      headers: {
        'x-user-id': userId,
        'x-user-role': 'operator'
      }
    });
    expect(deleteWorktree.statusCode).toBe(200);

    await app.close();
  });

  it('blocks host process-control workspace commands for members without routing them through approval', async () => {
    const { app } = await buildServer();
    const userId = '67676767-cccc-4ccc-8ccc-cccccccccccc';

    const createWorkspace = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: {
        'x-user-id': userId,
        'x-user-role': 'member'
      },
      payload: {
        name: 'Host Runtime',
        cwd: '.'
      }
    });
    expect(createWorkspace.statusCode).toBe(201);
    const workspaceId = (createWorkspace.json() as { data: { id: string } }).data.id;

    const spawn = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/pty/spawn`,
      headers: {
        'x-user-id': userId,
        'x-user-role': 'member'
      },
      payload: {
        command: 'kill 123'
      }
    });

    expect(spawn.statusCode).toBe(403);
    const body = spawn.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('requires operator or admin role');

    await app.close();
  });

  it.skipIf(!dockerAvailable)('creates and deletes docker devcontainer workspaces for operators', async () => {
    const { app } = await buildServer();
    const userId = '77777777-dddd-4ddd-8ddd-dddddddddddd';

    const createDevcontainer = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: {
        'x-user-id': userId,
        'x-user-role': 'operator'
      },
      payload: {
        kind: 'devcontainer',
        name: 'Docker Sandbox',
        image: 'brain-backend:latest'
      }
    });
    expect(createDevcontainer.statusCode).toBe(201);
    const devcontainerBody = createDevcontainer.json() as {
      data: {
        id: string;
        kind: string;
        containerName: string | null;
        containerImage: string | null;
      };
    };
    expect(devcontainerBody.data.kind).toBe('devcontainer');
    expect(devcontainerBody.data.containerName).toBeTruthy();
    expect(devcontainerBody.data.containerImage).toBe('brain-backend:latest');

    const spawn = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${devcontainerBody.data.id}/pty/spawn`,
      headers: {
        'x-user-id': userId,
        'x-user-role': 'operator'
      },
      payload: {
        command: 'node -p process.version'
      }
    });
    expect(spawn.statusCode).toBe(202);
    const spawnBody = spawn.json() as {
      data: {
        requires_approval?: boolean;
        policy: { riskLevel: string; disposition: string };
      };
    };
    expect(spawnBody.data.requires_approval).not.toBe(true);
    expect(spawnBody.data.policy.riskLevel).toBe('build');
    expect(spawnBody.data.policy.disposition).toBe('auto_run');

    const settledRead = await waitFor(
      async () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${devcontainerBody.data.id}/pty/read?after_sequence=0&limit=50`,
          headers: {
            'x-user-id': userId,
            'x-user-role': 'operator'
          }
        }),
      {
        until: (response) => {
          if (response.statusCode !== 200) return false;
          const body = response.json() as { data: { workspace: { status: string }; chunks: Array<{ text: string }> } };
          return body.data.workspace.status !== 'running' && body.data.chunks.some((chunk) => chunk.text.includes('command exited'));
        }
      }
    );
    expect(settledRead.statusCode).toBe(200);

    const deleteDevcontainer = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${devcontainerBody.data.id}`,
      headers: {
        'x-user-id': userId,
        'x-user-role': 'operator'
      }
    });
    expect(deleteDevcontainer.statusCode).toBe(200);

    await app.close();
  }, 30_000);

  it.skipIf(!dockerAvailable)('builds dockerfile-based devcontainer runtimes from detected config', async () => {
    const { app } = await buildServer();
    const userId = '88888888-eeee-4eee-8eee-eeeeeeeeeeee';
    const repoRoot = path.resolve(process.cwd(), '..');
    const fixtureRelative = `.tmp-devcontainer-fixture-${randomUUID().slice(0, 8)}`;
    const fixturePath = path.join(repoRoot, fixtureRelative);
    mkdirSync(path.join(fixturePath, '.devcontainer'), { recursive: true });
    writeFileSync(
      path.join(fixturePath, '.devcontainer', 'Dockerfile'),
      'FROM brain-backend:latest\nWORKDIR /workspace\nRUN node --version >/tmp/node-version\n'
    );
    writeFileSync(
      path.join(fixturePath, '.devcontainer', 'devcontainer.json'),
      JSON.stringify(
        {
          build: {
            context: '..',
            dockerfile: 'Dockerfile',
            args: {
              NODE_ENV: 'test'
            }
          },
          workspaceFolder: '/workspace',
          runArgs: ['--init'],
          features: {
            'ghcr.io/devcontainers/features/git:1': {}
          }
        },
        null,
        2
      )
    );

    try {
      const sourceWorkspace = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        },
        payload: {
          name: 'Fixture Source',
          cwd: fixtureRelative
        }
      });
      expect(sourceWorkspace.statusCode).toBe(201);
      const sourceWorkspaceId = (sourceWorkspace.json() as { data: { id: string } }).data.id;

      const createDevcontainer = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        },
        payload: {
          kind: 'devcontainer',
          name: 'Built Sandbox',
          source_workspace_id: sourceWorkspaceId
        }
      });

      expect(createDevcontainer.statusCode).toBe(201);
      const devcontainerBody = createDevcontainer.json() as {
      data: {
        id: string;
        kind: string;
        containerSource: string | null;
        containerImage: string | null;
        containerAppliedFeatures: string[];
        containerDockerfile: string | null;
        containerBuildContext: string | null;
        containerFeatures: string[];
        containerWarnings: string[];
      };
      };
      expect(devcontainerBody.data.kind).toBe('devcontainer');
      expect(devcontainerBody.data.containerSource).toBe('dockerfile');
      expect(devcontainerBody.data.containerImage).toContain('jarvis-devcontainer-feature-');
      expect(devcontainerBody.data.containerDockerfile).toContain('.devcontainer/Dockerfile');
      expect(devcontainerBody.data.containerBuildContext).toBe(fixturePath);
      expect(devcontainerBody.data.containerFeatures).toContain('ghcr.io/devcontainers/features/git:1');
      expect(devcontainerBody.data.containerAppliedFeatures).toContain('ghcr.io/devcontainers/features/git:1');
      expect(devcontainerBody.data.containerWarnings).not.toContain('devcontainer features detected but not applied in raw docker runtime');

      const spawn = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${devcontainerBody.data.id}/pty/spawn`,
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        },
        payload: {
          command: 'node -p process.version'
        }
      });
      expect(spawn.statusCode).toBe(202);
      const spawnBody = spawn.json() as {
        data: {
          policy: { riskLevel: string; disposition: string };
        };
      };
      expect(spawnBody.data.policy.riskLevel).toBe('build');
      expect(spawnBody.data.policy.disposition).toBe('auto_run');

      const settledRead = await waitFor(
        async () =>
          app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${devcontainerBody.data.id}/pty/read?after_sequence=0&limit=50`,
            headers: {
              'x-user-id': userId,
              'x-user-role': 'operator'
            }
          }),
        {
          until: (response) => {
            if (response.statusCode !== 200) return false;
            const body = response.json() as { data: { workspace: { status: string }; chunks: Array<{ text: string }> } };
            return body.data.workspace.status !== 'running' && body.data.chunks.some((chunk) => chunk.text.includes('command exited'));
          }
        }
      );
      expect(settledRead.statusCode).toBe(200);

      const deleteDevcontainer = await app.inject({
        method: 'DELETE',
        url: `/api/v1/workspaces/${devcontainerBody.data.id}`,
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        }
      });
      expect(deleteDevcontainer.statusCode).toBe(200);

      const deleteSource = await app.inject({
        method: 'DELETE',
        url: `/api/v1/workspaces/${sourceWorkspaceId}`,
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        }
      });
      expect(deleteSource.statusCode).toBe(200);
    } finally {
      rmSync(fixturePath, { recursive: true, force: true });
      await app.close();
    }
  }, 90_000);

  it.skipIf(!dockerAvailable)('materializes allowlisted git feature for image-based devcontainers', async () => {
    const { app } = await buildServer();
    const userId = '99999999-ffff-4fff-8fff-ffffffffffff';
    const repoRoot = path.resolve(process.cwd(), '..');
    const fixtureRelative = `.tmp-devcontainer-image-fixture-${randomUUID().slice(0, 8)}`;
    const fixturePath = path.join(repoRoot, fixtureRelative);
    mkdirSync(path.join(fixturePath, '.devcontainer'), { recursive: true });
    writeFileSync(
      path.join(fixturePath, '.devcontainer', 'devcontainer.json'),
      JSON.stringify(
        {
          image: 'node:24-alpine',
          workspaceFolder: '/workspace',
          features: {
            'ghcr.io/devcontainers/features/git:1': {}
          }
        },
        null,
        2
      )
    );

    try {
      const sourceWorkspace = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        },
        payload: {
          name: 'Image Feature Source',
          cwd: fixtureRelative
        }
      });
      expect(sourceWorkspace.statusCode).toBe(201);
      const sourceWorkspaceId = (sourceWorkspace.json() as { data: { id: string } }).data.id;

      const createDevcontainer = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        },
        payload: {
          kind: 'devcontainer',
          name: 'Feature Sandbox',
          source_workspace_id: sourceWorkspaceId
        }
      });
      expect(createDevcontainer.statusCode).toBe(201);
      const devcontainerBody = createDevcontainer.json() as {
        data: {
          id: string;
          containerSource: string | null;
          containerAppliedFeatures: string[];
          containerImage: string | null;
        };
      };
      expect(devcontainerBody.data.containerSource).toBe('image');
      expect(devcontainerBody.data.containerAppliedFeatures).toEqual(['ghcr.io/devcontainers/features/git:1']);
      expect(devcontainerBody.data.containerImage).toContain('jarvis-devcontainer-feature-');

      const spawn = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${devcontainerBody.data.id}/pty/spawn`,
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        },
        payload: {
          command: 'git --version'
        }
      });
      expect(spawn.statusCode).toBe(202);

      const settledRead = await waitFor(
        async () =>
          app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${devcontainerBody.data.id}/pty/read?after_sequence=0&limit=50`,
            headers: {
              'x-user-id': userId,
              'x-user-role': 'operator'
            }
          }),
        {
          until: (response) => {
            if (response.statusCode !== 200) return false;
            const body = response.json() as { data: { workspace: { status: string }; chunks: Array<{ text: string }> } };
            return body.data.workspace.status !== 'running' && body.data.chunks.some((chunk) => chunk.text.toLowerCase().includes('git version'));
          }
        }
      );
      expect(settledRead.statusCode).toBe(200);

      await app.inject({
        method: 'DELETE',
        url: `/api/v1/workspaces/${devcontainerBody.data.id}`,
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        }
      });
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/workspaces/${sourceWorkspaceId}`,
        headers: {
          'x-user-id': userId,
          'x-user-role': 'operator'
        }
      });
    } finally {
      rmSync(fixturePath, { recursive: true, force: true });
      await app.close();
    }
  }, 60_000);
});
