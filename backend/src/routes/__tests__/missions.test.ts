import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../server';

const ENV_SNAPSHOT = { ...process.env };

async function waitForMissionTerminalState(app: Awaited<ReturnType<typeof buildServer>>["app"], missionId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/missions/${missionId}`
    });
    const body = detail.json() as {
      data: {
        status: string;
        steps: Array<{ status: string }>;
      };
    };
    if (body.data.status !== 'running' && body.data.status !== 'draft') {
      return body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`mission ${missionId} did not reach a terminal state`);
}

describe('missions api', () => {
  beforeEach(() => {
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PORT = '4011';
    process.env.AUTH_REQUIRED = 'false';
    process.env.AUTH_TOKEN = 'test_auth_token';
    process.env.LOCAL_LLM_ENABLED = 'false';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    process.env.OPENAI_WEBHOOK_SECRET = 'openai_secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ENV_SNAPSHOT };
  });

  it('creates mission and supports list/detail read', async () => {
    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      payload: {
        title: 'Codebase refactor plan',
        objective: 'Split studio views and keep runtime unified',
        domain: 'code',
        constraints: {
          max_cost_usd: 250,
          deadline_at: '2026-03-01T00:00:00.000Z',
          allowed_tools: ['git', 'pnpm']
        },
        approval_policy: {
          mode: 'required_for_high_risk'
        }
      }
    });

    expect(create.statusCode).toBe(201);
    const created = create.json() as {
      data: {
        id: string;
        title: string;
        domain: string;
        status: string;
        missionContract: {
          constraints: {
            maxCostUsd?: number;
            deadlineAt?: string;
            allowedTools?: string[];
          };
          approvalPolicy: {
            mode: string;
            approverRoles?: string[];
          };
        };
        steps: Array<{ id: string; route: string; type: string }>;
      };
    };

    expect(created.data.id).toBeTruthy();
    expect(created.data.title).toBe('Codebase refactor plan');
    expect(created.data.domain).toBe('code');
    expect(created.data.status).toBe('draft');
    expect(created.data.missionContract.constraints.maxCostUsd).toBe(250);
    expect(created.data.missionContract.constraints.deadlineAt).toBe('2026-03-01T00:00:00.000Z');
    expect(created.data.missionContract.constraints.allowedTools).toEqual(['git', 'pnpm']);
    expect(created.data.missionContract.approvalPolicy.mode).toBe('required_for_high_risk');
    expect(created.data.steps.length).toBeGreaterThan(0);
    expect(created.data.steps[0]?.type).toBe('code');
    expect(created.data.steps[0]?.route).toBe('/studio/code');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/missions?limit=10'
    });

    expect(list.statusCode).toBe(200);
    const listed = list.json() as {
      data: {
        missions: Array<{ id: string; title: string }>;
      };
    };

    expect(listed.data.missions.length).toBe(1);
    expect(listed.data.missions[0]?.id).toBe(created.data.id);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/missions/${created.data.id}`
    });

    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as {
      data: {
        id: string;
        title: string;
        graph: {
          nodes: Array<{ key: string }>;
        };
        missionContract: {
          constraints: {
            maxCostUsd?: number;
          };
        };
      };
    };
    expect(detailBody.data.id).toBe(created.data.id);
    expect(detailBody.data.title).toBe('Codebase refactor plan');
    expect(detailBody.data.missionContract.constraints.maxCostUsd).toBe(250);
    expect(detailBody.data.graph.nodes.length).toBeGreaterThan(0);

    const graph = await app.inject({
      method: 'GET',
      url: `/api/v1/missions/${created.data.id}/graph`
    });

    expect(graph.statusCode).toBe(200);
    const graphBody = graph.json() as {
      data: {
        mission_id: string;
        graph: {
          nodes: Array<{ key: string }>;
        };
        compat_steps: Array<{ id: string }>;
      };
    };
    expect(graphBody.data.mission_id).toBe(created.data.id);
    expect(graphBody.data.graph.nodes.length).toBe(detailBody.data.graph.nodes.length);
    expect(graphBody.data.compat_steps.length).toBeGreaterThan(0);

    await app.close();
  });

  it('rejects mission create without auth when auth is required', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = 'hard_token';

    const { app } = await buildServer();

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      payload: {
        title: 'Unauthorized mission',
        objective: 'Should fail',
        domain: 'mixed'
      }
    });

    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      headers: {
        authorization: 'Bearer hard_token'
      },
      payload: {
        title: 'Authorized mission',
        objective: 'Should pass',
        domain: 'mixed'
      }
    });

    expect(allowed.statusCode).toBe(201);

    await app.close();
  });

  it('updates mission status and step statuses', async () => {
    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      payload: {
        title: 'Mission update target',
        objective: 'Verify mission patch endpoint',
        domain: 'mixed'
      }
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as {
      data: {
        id: string;
        steps: Array<{ id: string }>;
      };
    };

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/missions/${created.data.id}`,
      payload: {
        status: 'running',
        constraints: {
          max_retries_per_step: 2
        },
        approval_policy: {
          mode: 'required_for_all'
        },
        step_statuses: [
          {
            step_id: created.data.steps[0]!.id,
            status: 'running'
          }
        ]
      }
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json() as {
      data: {
        id: string;
        status: string;
        missionContract: {
          constraints: {
            maxRetriesPerStep?: number;
          };
          approvalPolicy: {
            mode: string;
          };
        };
        steps: Array<{ status: string }>;
      };
    };
    expect(patched.data.id).toBe(created.data.id);
    expect(patched.data.status).toBe('running');
    expect(patched.data.missionContract.constraints.maxRetriesPerStep).toBe(2);
    expect(patched.data.missionContract.approvalPolicy.mode).toBe('required_for_all');
    expect(patched.data.steps[0]?.status).toBe('running');

    await app.close();
  });

  it('executes missions through the graph runtime and blocks human gate steps', async () => {
    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      payload: {
        title: 'Approval mission',
        objective: 'Pause at human gate',
        domain: 'mixed',
        steps: [
          {
            type: 'human_gate',
            title: 'Need approval',
            description: 'Stop before executing'
          }
        ]
      }
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as {
      data: {
        id: string;
        steps: Array<{ id: string }>;
      };
    };

    const execute = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${created.data.id}/execute`,
      payload: {}
    });
    expect(execute.statusCode).toBe(202);

    const detail = await waitForMissionTerminalState(app, created.data.id);
    expect(detail.status).toBe('blocked');
    expect(detail.steps[0]?.status).toBe('blocked');

    await app.close();
  });

  it('blocks tool_call missions when gateway policy requires approval', async () => {
    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      payload: {
        title: 'Tool gateway mission',
        objective: 'Respect tool policy',
        domain: 'mixed',
        steps: [
          {
            type: 'tool_call',
            title: 'Protected tool',
            description: 'Do not run directly',
            metadata: {
              tool_name: 'git.push',
              requiresApproval: true,
              severity: 'high'
            }
          }
        ]
      }
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as {
      data: {
        id: string;
      };
    };

    const execute = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${created.data.id}/execute`,
      payload: {}
    });
    expect(execute.statusCode).toBe(202);

    const detail = await waitForMissionTerminalState(app, created.data.id);
    expect(detail.status).toBe('blocked');
    expect(detail.steps[0]?.status).toBe('blocked');

    await app.close();
  });

  it('streams mission snapshots over SSE', async () => {
    const { app } = await buildServer();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      payload: {
        title: 'Mission stream test',
        objective: 'Verify mission SSE stream emits updates',
        domain: 'research'
      }
    });

    expect(create.statusCode).toBe(201);
    const created = create.json() as { data: { id: string } };

    const stream = await app.inject({
      method: 'GET',
      url: `/api/v1/missions/${created.data.id}/events?poll_ms=300&timeout_ms=1200`,
      headers: {
        origin: 'http://localhost:3000'
      }
    });

    expect(stream.statusCode).toBe(200);
    expect(stream.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(stream.headers['access-control-allow-credentials']).toBe('true');
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.body).toContain('event: stream.open');
    expect(stream.body).toContain('event: mission.updated');
    expect(stream.body).toContain('"mission_id"');
    expect(stream.body).toContain('event: stream.close');

    await app.close();
  });

  it('auto-creates mission from simple generated plan with UUID step ids', async () => {
    const { app } = await buildServer();

    const generated = await app.inject({
      method: 'POST',
      url: '/api/v1/missions/generate-plan',
      payload: {
        prompt: '오늘 세계 주요 뉴스와 전쟁 관련 최신 뉴스를 정리해줘',
        auto_create: true,
        complexity_hint: 'simple'
      }
    });

    expect(generated.statusCode).toBe(201);
    const body = generated.json() as {
      data: {
        plan: {
          steps: Array<{ id: string }>;
        };
        mission: {
          steps: Array<{ id: string }>;
        };
      };
    };

    expect(body.data.plan.steps.length).toBeGreaterThan(0);
    expect(body.data.mission.steps.length).toBeGreaterThan(0);
    expect(body.data.plan.steps[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    );
    expect(body.data.mission.steps[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    );

    await app.close();
  });
});
