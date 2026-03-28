import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../server';

const ENV_SNAPSHOT = { ...process.env };
const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';

function createLinearFetchMock(input?: {
  issues?: Array<{
    id: string;
    identifier: string;
    title: string;
    description?: string;
    url?: string;
    priority?: number;
    labels?: string[];
    stateType?: string;
    stateName?: string;
  }>;
}) {
  const issues = input?.issues ?? [];
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { query?: string } : {};
    if (body.query?.includes('RunnerLinearIssues')) {
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: issues.map((issue) => ({
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                description: issue.description ?? issue.title,
                url: issue.url ?? `https://linear.app/example/issue/${issue.identifier.toLowerCase()}`,
                priority: issue.priority ?? 1,
                branchName: null,
                state: {
                  type: issue.stateType ?? 'unstarted',
                  name: issue.stateName ?? 'Backlog',
                },
                team: {
                  id: 'team-1',
                  key: 'WOO',
                  name: 'Woo Team',
                },
                project: {
                  id: 'project-1',
                  name: 'Mission Control',
                },
                assignee: {
                  id: 'user-1',
                  name: 'Jarvis Operator',
                  email: 'operator@example.com',
                },
                labels: {
                  nodes: (issue.labels ?? []).map((label) => ({ name: label })),
                },
                relations: {
                  nodes: [],
                },
              })),
            },
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      );
    }
    if (body.query?.includes('JarvisLinearComment')) {
      return new Response(JSON.stringify({ data: { commentCreate: { success: true } } }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

describe('external work routes', () => {
  beforeEach(() => {
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PORT = '4017';
    process.env.AUTH_REQUIRED = 'false';
    process.env.LOCAL_LLM_ENABLED = 'false';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    process.env.OPENAI_WEBHOOK_SECRET = 'openai_secret';
    process.env.LINEAR_API_KEY = 'lin_api_test';
    process.env.LINEAR_TEAM_ID = 'team-1';
    process.env.RUNNER_LINEAR_DIRECT_ENABLED = 'false';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ENV_SNAPSHOT };
  });

  it('refreshes external work cache without auto-creating internal records', async () => {
    createLinearFetchMock({
      issues: [
        { id: 'linear-1', identifier: 'WOO-1', title: 'Code issue', labels: ['code'] },
        { id: 'linear-2', identifier: 'WOO-2', title: 'Research issue', labels: ['research'] },
      ],
    });
    const { app, store } = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox/external-work?refresh=1&limit=10',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        enabled: boolean;
        counts: Record<string, number>;
        items: Array<{ id: string; identifier: string }>;
      };
    };

    expect(body.data.enabled).toBe(true);
    expect(body.data.items.map((item) => item.identifier)).toEqual(['WOO-1', 'WOO-2']);
    expect(body.data.counts.new).toBe(2);

    const tasks = await store.listTasks({ userId: DEFAULT_USER_ID, limit: 20 });
    const sessions = await store.listJarvisSessions({ userId: DEFAULT_USER_ID, limit: 20 });
    const missions = await store.listMissions({ userId: DEFAULT_USER_ID, limit: 20 });

    expect(tasks).toHaveLength(0);
    expect(sessions).toHaveLength(0);
    expect(missions).toHaveLength(0);

    await app.close();
  });

  it('routes external work into internal objects idempotently and preserves triage state', async () => {
    createLinearFetchMock();
    const { app, store } = await buildServer();
    const [taskItem, missionCodeItem, missionResearchItem, sessionResearchItem, sessionCouncilItem, ignoredItem] =
      await store.upsertExternalWorkItems({
        items: [
          {
            userId: DEFAULT_USER_ID,
            source: 'linear',
            externalId: 'linear-task',
            identifier: 'WOO-10',
            title: 'Implement inbox intake',
            description: 'Create code task',
            state: 'queued',
            labels: ['code'],
            lastSeenAt: new Date().toISOString(),
          },
          {
            userId: DEFAULT_USER_ID,
            source: 'linear',
            externalId: 'linear-mission-code',
            identifier: 'WOO-11',
            title: 'Mission code',
            description: 'Create code mission',
            state: 'queued',
            labels: ['feature'],
            lastSeenAt: new Date().toISOString(),
          },
          {
            userId: DEFAULT_USER_ID,
            source: 'linear',
            externalId: 'linear-mission-research',
            identifier: 'WOO-12',
            title: 'Mission research',
            description: 'Create research mission',
            state: 'queued',
            labels: ['research'],
            lastSeenAt: new Date().toISOString(),
          },
          {
            userId: DEFAULT_USER_ID,
            source: 'linear',
            externalId: 'linear-session-research',
            identifier: 'WOO-13',
            title: 'Session research',
            description: 'Create research session',
            state: 'queued',
            labels: ['research'],
            lastSeenAt: new Date().toISOString(),
          },
          {
            userId: DEFAULT_USER_ID,
            source: 'linear',
            externalId: 'linear-session-council',
            identifier: 'WOO-14',
            title: 'Session council',
            description: 'Create council session',
            state: 'queued',
            labels: ['decision'],
            lastSeenAt: new Date().toISOString(),
          },
          {
            userId: DEFAULT_USER_ID,
            source: 'linear',
            externalId: 'linear-ignore',
            identifier: 'WOO-15',
            title: 'Ignore me',
            description: 'Ignore external work',
            state: 'queued',
            labels: ['noise'],
            lastSeenAt: new Date().toISOString(),
          },
        ],
      });

    const taskImport = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/external-work/${taskItem.id}/route`,
      payload: {
        action: 'task_code',
      },
    });
    expect(taskImport.statusCode).toBe(201);
    const taskImportBody = taskImport.json() as {
      data: {
        target_id: string;
        existing: boolean;
      };
    };
    expect(taskImportBody.data.existing).toBe(false);

    const taskReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/external-work/${taskItem.id}/route`,
      payload: {
        action: 'task_code',
      },
    });
    expect(taskReplay.statusCode).toBe(200);
    const taskReplayBody = taskReplay.json() as {
      data: {
        target_id: string;
        existing: boolean;
      };
    };
    expect(taskReplayBody.data.existing).toBe(true);
    expect(taskReplayBody.data.target_id).toBe(taskImportBody.data.target_id);

    const taskDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskImportBody.data.target_id}`,
    });
    expect(taskDetail.statusCode).toBe(200);
    expect((taskDetail.json() as { data: { linked_external_work: { identifier: string } | null } }).data.linked_external_work?.identifier).toBe('WOO-10');

    const missionCodeImport = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/external-work/${missionCodeItem.id}/route`,
      payload: {
        action: 'mission_code',
      },
    });
    expect(missionCodeImport.statusCode).toBe(201);
    const missionCodeId = (missionCodeImport.json() as { data: { target_id: string } }).data.target_id;

    const missionCodeDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/missions/${missionCodeId}`,
    });
    expect(missionCodeDetail.statusCode).toBe(200);
    expect((missionCodeDetail.json() as { data: { domain: string; linked_external_work: { identifier: string } | null } }).data.domain).toBe('code');
    expect((missionCodeDetail.json() as { data: { linked_external_work: { identifier: string } | null } }).data.linked_external_work?.identifier).toBe('WOO-11');

    const missionResearchImport = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/external-work/${missionResearchItem.id}/route`,
      payload: {
        action: 'mission_research',
      },
    });
    expect(missionResearchImport.statusCode).toBe(201);
    const missionResearchId = (missionResearchImport.json() as { data: { target_id: string } }).data.target_id;
    const missionResearchDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/missions/${missionResearchId}`,
    });
    expect((missionResearchDetail.json() as { data: { domain: string } }).data.domain).toBe('research');

    const researchSessionImport = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/external-work/${sessionResearchItem.id}/route`,
      payload: {
        action: 'session_research',
      },
    });
    expect(researchSessionImport.statusCode).toBe(201);
    const researchSessionId = (researchSessionImport.json() as { data: { target_id: string } }).data.target_id;
    const researchSessionDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/jarvis/sessions/${researchSessionId}`,
    });
    expect(researchSessionDetail.statusCode).toBe(200);
    const researchSessionBody = researchSessionDetail.json() as {
      data: {
        session: {
          intent: string;
          primaryTarget: string;
        };
        linked_external_work: { identifier: string } | null;
      };
    };
    expect(researchSessionBody.data.session.intent).toBe('research');
    expect(researchSessionBody.data.session.primaryTarget).toBe('assistant');
    expect(researchSessionBody.data.linked_external_work?.identifier).toBe('WOO-13');

    const councilSessionImport = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/external-work/${sessionCouncilItem.id}/route`,
      payload: {
        action: 'session_council',
      },
    });
    expect(councilSessionImport.statusCode).toBe(201);
    const councilSessionId = (councilSessionImport.json() as { data: { target_id: string } }).data.target_id;
    const councilSessionDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/jarvis/sessions/${councilSessionId}`,
    });
    const councilSessionBody = councilSessionDetail.json() as {
      data: {
        session: {
          intent: string;
          primaryTarget: string;
        };
        linked_external_work: { identifier: string } | null;
      };
    };
    expect(councilSessionBody.data.session.intent).toBe('council');
    expect(councilSessionBody.data.session.primaryTarget).toBe('council');
    expect(councilSessionBody.data.linked_external_work?.identifier).toBe('WOO-14');

    const councilRuns = await app.inject({
      method: 'GET',
      url: '/api/v1/councils/runs?limit=20',
    });
    expect((councilRuns.json() as { data: { runs: unknown[] } }).data.runs).toHaveLength(0);

    const ignoreResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/external-work/${ignoredItem.id}/route`,
      payload: {
        action: 'ignore',
      },
    });
    expect(ignoreResponse.statusCode).toBe(200);

    const ignoredDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/external-work/${ignoredItem.id}`,
    });
    const ignoredBody = ignoredDetail.json() as {
      data: {
        item: {
          triageStatus: string;
        };
        links: unknown[];
      };
    };
    expect(ignoredBody.data.item.triageStatus).toBe('ignored');
    expect(ignoredBody.data.links).toHaveLength(0);

    await app.close();
  });

  it('hydrates linked external work for derived council and runner targets', async () => {
    createLinearFetchMock();
    const { app, store } = await buildServer();

    const [sessionItem, taskItem] = await store.upsertExternalWorkItems({
      items: [
        {
          userId: DEFAULT_USER_ID,
          source: 'linear',
          externalId: 'linear-council',
          identifier: 'WOO-20',
          title: 'Council derived link',
          description: 'Council run should hydrate external work',
          state: 'queued',
          labels: ['decision'],
          triageStatus: 'imported',
          lastSeenAt: new Date().toISOString(),
        },
        {
          userId: DEFAULT_USER_ID,
          source: 'linear',
          externalId: 'linear-runner',
          identifier: 'WOO-21',
          title: 'Runner derived link',
          description: 'Runner detail should hydrate external work',
          state: 'queued',
          labels: ['code'],
          triageStatus: 'imported',
          lastSeenAt: new Date().toISOString(),
        },
      ],
    });

    const session = await store.createJarvisSession({
      userId: DEFAULT_USER_ID,
      title: 'Council session',
      prompt: 'Run council',
      source: 'linear_external_work',
      intent: 'council',
      primaryTarget: 'council',
    });
    await store.createExternalWorkLink({
      externalWorkItemId: sessionItem.id,
      targetType: 'session',
      targetId: session.id,
      role: 'primary',
    });

    const councilRun = await store.createCouncilRun({
      user_id: DEFAULT_USER_ID,
      idempotency_key: 'external-work:council',
      trace_id: 'trace-council',
      question: 'What should we do?',
      status: 'completed',
      consensus_status: 'consensus_reached',
      summary: 'Council done',
      participants: [],
      attempts: [],
      provider: null,
      model: 'pending',
      used_fallback: false,
      task_id: null,
    });
    await store.createExternalWorkLink({
      externalWorkItemId: sessionItem.id,
      targetType: 'council_run',
      targetId: councilRun.id,
      role: 'derived',
    });

    const task = await store.createTask({
      userId: DEFAULT_USER_ID,
      mode: 'code',
      title: 'Runner task',
      input: {},
      idempotencyKey: 'external-work:runner-task',
      traceId: 'trace-runner',
    });
    await store.createExternalWorkLink({
      externalWorkItemId: taskItem.id,
      targetType: 'task',
      targetId: task.id,
      role: 'primary',
    });
    const runnerRun = await store.createRunnerRun({
      userId: DEFAULT_USER_ID,
      workItem: {
        source: 'internal_task',
        externalId: task.id,
        identifier: `task:${task.id}`,
        userId: DEFAULT_USER_ID,
        taskId: task.id,
        title: task.title,
        description: 'Runner derived link',
        state: 'queued',
        priority: 1,
        labels: ['code'],
        branchName: 'task/external-runner',
        url: null,
        blockedBy: [],
        workspaceKey: 'external-runner',
        payload: {},
      },
      status: 'claimed',
    });
    await store.createExternalWorkLink({
      externalWorkItemId: taskItem.id,
      targetType: 'runner',
      targetId: runnerRun.id,
      role: 'derived',
    });

    const councilDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/councils/runs/${councilRun.id}`,
    });
    expect(councilDetail.statusCode).toBe(200);
    expect((councilDetail.json() as { data: { linked_external_work: { identifier: string } | null } }).data.linked_external_work?.identifier).toBe('WOO-20');

    const runnerDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/runner/runs/${runnerRun.id}`,
      headers: {
        'x-user-role': 'operator',
      },
    });
    expect(runnerDetail.statusCode).toBe(200);
    expect((runnerDetail.json() as { data: { linked_external_work: { identifier: string } | null } }).data.linked_external_work?.identifier).toBe('WOO-21');

    await app.close();
  });
});
