import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGraphRun, createRunnerExecutionGraph } from '../../graph-runtime/graph';
import { buildServer } from '../../server';
import { loadWorkflowContract } from '../../runner/workflow-contract';

const ENV_SNAPSHOT = { ...process.env };

describe('runner routes', () => {
  beforeEach(() => {
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PORT = '4012';
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

  it('validates the workflow contract and exposes runner state', async () => {
    const { app, store } = await buildServer();

    const validation = await app.inject({
      method: 'POST',
      url: '/api/v1/runner/workflow/validate',
      headers: {
        'x-user-role': 'operator'
      }
    });

    expect(validation.statusCode).toBe(200);
    const validationBody = validation.json() as {
      data: {
        valid: boolean;
        source_path: string;
        contract: {
          codex: {
            command: string;
          };
        } | null;
      };
    };
    expect(validationBody.data.valid).toBe(true);
    expect(validationBody.data.source_path).toContain('WORKFLOW.md');
    expect(validationBody.data.contract?.codex.command).toContain('codex exec');

    await store.createRunnerRun({
      userId: process.env.DEFAULT_USER_ID ?? '00000000-0000-4000-8000-000000000001',
      workItem: {
        source: 'internal_task',
        externalId: 'task-1',
        identifier: 'task:task-1',
        userId: process.env.DEFAULT_USER_ID ?? '00000000-0000-4000-8000-000000000001',
        taskId: null,
        title: 'Runner task',
        description: 'Drive a pull request',
        state: 'queued',
        priority: 1,
        labels: ['runner'],
        branchName: 'task/runner-task',
        url: null,
        blockedBy: [],
        workspaceKey: 'runner-task',
        payload: {}
      },
      status: 'claimed'
    });

    const state = await app.inject({
      method: 'GET',
      url: '/api/v1/runner/state',
      headers: {
        'x-user-role': 'operator'
      }
    });

    expect(state.statusCode).toBe(200);
    const stateBody = state.json() as {
      data: {
        stats: {
          claimed: number;
        };
        runs: Array<{ id: string }>;
      };
    };
    expect(stateBody.data.stats.claimed).toBe(1);
    expect(stateBody.data.runs.length).toBe(1);

    await app.close();
  });

  it('accepts refresh requests and cancels runner runs', async () => {
    const { app, store } = await buildServer();
    const userId = process.env.DEFAULT_USER_ID ?? '00000000-0000-4000-8000-000000000001';

    const run = await store.createRunnerRun({
      userId,
      workItem: {
        source: 'internal_task',
        externalId: 'task-2',
        identifier: 'task:task-2',
        userId,
        taskId: null,
        title: 'Cancel me',
        description: 'Runner cancellation',
        state: 'queued',
        priority: 1,
        labels: [],
        branchName: 'task/cancel-me',
        url: null,
        blockedBy: [],
        workspaceKey: 'cancel-me',
        payload: {}
      },
      status: 'running',
      lastProcessPid: 0
    });

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/runner/refresh',
      headers: {
        'x-user-role': 'operator'
      }
    });
    expect(refresh.statusCode).toBe(202);

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/runner/runs/${run.id}/cancel`,
      headers: {
        'x-user-role': 'operator'
      }
    });
    expect(cancel.statusCode).toBe(200);
    const cancelBody = cancel.json() as {
      data: {
        run: {
          status: string;
        };
      };
    };
    expect(cancelBody.data.run.status).toBe('cancelled');

    await app.close();
  });

  it('reports operational runner metrics in state responses', async () => {
    const { app, store } = await buildServer();
    const userId = process.env.DEFAULT_USER_ID ?? '00000000-0000-4000-8000-000000000001';
    const staleAt = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    const retryAt = new Date(Date.now() - 1000 * 60 * 10).toISOString();

    await store.upsertRunnerState({
      workflowErrors: [
        {
          path: 'tracker.sources',
          message: 'at least one source must be configured'
        }
      ],
      recentErrors: [
        {
          at: new Date().toISOString(),
          message: 'runner stalled after 600000ms; queued retry',
          runId: null,
          source: 'internal_task'
        }
      ]
    });

    await store.createRunnerRun({
      userId,
      workItem: {
        source: 'internal_task',
        externalId: 'task-metric-stalled',
        identifier: 'task:metric-stalled',
        userId,
        taskId: null,
        title: 'Stalled run',
        description: 'stalled',
        state: 'running',
        priority: 1,
        labels: [],
        branchName: 'task/stalled',
        url: null,
        blockedBy: [],
        workspaceKey: 'stalled',
        payload: {}
      },
      status: 'running',
      lastHeartbeatAt: staleAt
    });

    await store.createRunnerRun({
      userId,
      workItem: {
        source: 'internal_task',
        externalId: 'task-metric-retry',
        identifier: 'task:metric-retry',
        userId,
        taskId: null,
        title: 'Due retry',
        description: 'retry',
        state: 'queued',
        priority: 1,
        labels: [],
        branchName: 'task/retry',
        url: null,
        blockedBy: [],
        workspaceKey: 'retry',
        payload: {}
      },
      status: 'retry_queued',
      nextRetryAt: retryAt
    });

    await store.createRunnerRun({
      userId,
      workItem: {
        source: 'internal_task',
        externalId: 'task-metric-cleanup',
        identifier: 'task:metric-cleanup',
        userId,
        taskId: null,
        title: 'Cleanup pending',
        description: 'cleanup',
        state: 'completed',
        priority: 1,
        labels: [],
        branchName: 'task/cleanup',
        url: null,
        blockedBy: [],
        workspaceKey: 'cleanup',
        payload: {}
      },
      status: 'released',
      workspacePath: process.cwd()
    });

    const state = await app.inject({
      method: 'GET',
      url: '/api/v1/runner/state',
      headers: {
        'x-user-role': 'operator'
      }
    });

    expect(state.statusCode).toBe(200);
    const stateBody = state.json() as {
      data: {
        metrics: {
          dueRetryRuns: number;
          stalledRuns: number;
          terminalCleanupPending: number;
          workflowErrorCount: number;
          recentErrorCount: number;
        };
      };
    };
    expect(stateBody.data.metrics.dueRetryRuns).toBe(1);
    expect(stateBody.data.metrics.stalledRuns).toBe(1);
    expect(stateBody.data.metrics.terminalCleanupPending).toBe(1);
    expect(stateBody.data.metrics.workflowErrorCount).toBe(1);
    expect(stateBody.data.metrics.recentErrorCount).toBe(1);

    await app.close();
  });

  it('returns graph-aware runner details and artifact projections', async () => {
    const { app, store } = await buildServer();
    const userId = process.env.DEFAULT_USER_ID ?? '00000000-0000-4000-8000-000000000001';
    const workflow = loadWorkflowContract({
      repoRoot: path.resolve(process.cwd(), '..')
    }).contract;

    expect(workflow).not.toBeNull();

    const workItem = {
      source: 'internal_task' as const,
      externalId: 'task-graph',
      identifier: 'task:task-graph',
      userId,
      taskId: null,
      title: 'Graph run',
      description: 'Graph-aware runner detail',
      state: 'queued' as const,
      priority: 1,
      labels: ['runner'],
      branchName: 'task/graph-run',
      url: null,
      blockedBy: [],
      workspaceKey: 'graph-run',
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
      status: 'human_review_ready',
      graphSpec,
      graphRun,
      verificationSummary: {
        commands: [
          {
            command: 'pnpm test',
            ok: true,
            exitCode: 0,
            durationMs: 200,
            stdout: 'ok',
            stderr: ''
          }
        ]
      },
      proofOfWork: {
        verificationPassed: true,
        changedFiles: ['backend/src/runner/service.ts'],
        gitStatus: 'M backend/src/runner/service.ts',
        summary: ['branch=task/graph-run', 'changed_files=1']
      },
      prUrl: 'https://github.com/openai/symphony/pull/1',
      prNumber: 1
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/runner/runs/${run.id}`,
      headers: {
        'x-user-role': 'operator'
      }
    });

    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as {
      data: {
        graph: {
          nodes: Array<{ key: string }>;
        } | null;
        node_runs: Array<{ nodeKey: string }>;
        artifacts: Array<{ id: string; type: string }>;
        compat_steps: Array<{ key: string }>;
      };
    };
    expect(detailBody.data.graph?.nodes.some((node) => node.key === 'execute')).toBe(true);
    expect(detailBody.data.node_runs.length).toBeGreaterThan(0);
    expect(detailBody.data.compat_steps.length).toBeGreaterThan(0);
    expect(detailBody.data.artifacts.some((artifact) => artifact.type === 'pr_metadata')).toBe(true);

    const artifacts = await app.inject({
      method: 'GET',
      url: `/api/v1/runner/runs/${run.id}/artifacts`,
      headers: {
        'x-user-role': 'operator'
      }
    });

    expect(artifacts.statusCode).toBe(200);
    const artifactBody = artifacts.json() as {
      data: {
        artifacts: Array<{ id: string; type: string }>;
      };
    };
    expect(artifactBody.data.artifacts.some((artifact) => artifact.type === 'verification_log')).toBe(true);

    await app.close();
  });
});
