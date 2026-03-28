import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGraphRun, createRunnerExecutionGraph } from '../../graph-runtime/graph';
import { loadWorkflowContract } from '../../runner/workflow-contract';
import { buildServer } from '../../server';

const ENV_SNAPSHOT = { ...process.env };

describe('jarvis routes', () => {
  beforeEach(() => {
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PORT = '4013';
    process.env.AUTH_REQUIRED = 'false';
    process.env.LOCAL_LLM_ENABLED = 'false';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    process.env.OPENAI_WEBHOOK_SECRET = 'openai_secret';
    process.env.RUNNER_REPO_ROOT = path.resolve(process.cwd(), '..');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ENV_SNAPSHOT };
  });

  it('includes linked runner detail on jarvis session detail when runner events are present', async () => {
    const { app, store } = await buildServer();
    const userId = process.env.DEFAULT_USER_ID ?? '00000000-0000-4000-8000-000000000001';
    const workflow = loadWorkflowContract({
      repoRoot: path.resolve(process.cwd(), '..')
    }).contract;

    expect(workflow).not.toBeNull();

    const session = await store.createJarvisSession({
      userId,
      title: 'Runner linked session',
      prompt: 'Review runner output',
      source: 'delivery_runner:internal_task',
      intent: 'code',
      primaryTarget: 'execution'
    });

    const workItem = {
      source: 'internal_task' as const,
      externalId: 'task-linked-runner',
      identifier: 'task:task-linked-runner',
      userId,
      taskId: null,
      title: 'Linked runner task',
      description: 'Runner linked to jarvis session detail',
      state: 'queued' as const,
      priority: 1,
      labels: ['runner'],
      branchName: 'task/linked-runner',
      url: null,
      blockedBy: [],
      workspaceKey: 'linked-runner',
      payload: {}
    };

    const graphSpec = createRunnerExecutionGraph({
      workflow: workflow!,
      workItem,
      createdAt: new Date().toISOString()
    });
    const graphRun = createGraphRun(graphSpec, new Date().toISOString());

    const run = await store.createRunnerRun({
      userId,
      workItem,
      status: 'running',
      graphSpec,
      graphRun,
      sessionSnapshot: {
        sessionId: session.id,
        actionProposalId: null,
        status: 'running',
        updatedAt: new Date().toISOString()
      }
    });

    await store.appendJarvisSessionEvent({
      userId,
      sessionId: session.id,
      eventType: 'runner.run.started',
      status: 'running',
      summary: 'Runner execution started',
      data: {
        runner_run_id: run.id
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/jarvis/sessions/${session.id}`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        runner_detail: {
          run: {
            id: string;
          };
          graph: {
            nodes: Array<{ key: string }>;
          } | null;
          compat_steps: Array<{ key: string }>;
        } | null;
      };
    };

    expect(body.data.runner_detail?.run.id).toBe(run.id);
    expect(body.data.runner_detail?.graph?.nodes.some((node) => node.key === 'execute')).toBe(true);
    expect(body.data.runner_detail?.compat_steps.some((step) => step.key === 'execute')).toBe(true);

    await app.close();
  });
});
