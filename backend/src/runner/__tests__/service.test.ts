import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../config/env';
import { createNotificationService } from '../../notifications/proactive';
import { createMemoryStore } from '../../store/memory-store';
import { DeliveryRunnerService } from '../service';

const ENV_SNAPSHOT = { ...process.env };
const TEMP_DIRS: string[] = [];

function createTempRepo(workflowContent: string): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'runner-service-'));
  TEMP_DIRS.push(repoRoot);
  writeFileSync(path.join(repoRoot, 'WORKFLOW.md'), workflowContent, 'utf8');
  return repoRoot;
}

function configureEnv(repoRoot: string): ReturnType<typeof loadEnv> {
  process.env = {
    ...ENV_SNAPSHOT,
    NODE_ENV: 'test',
    STORE_BACKEND: 'memory',
    AUTH_REQUIRED: 'false',
    RUNNER_ENABLED: 'true',
    RUNNER_REPO_ROOT: repoRoot,
    RUNNER_POLL_INTERVAL_MS: '1000',
    RUNNER_MAX_ATTEMPTS: '3',
    RUNNER_STALL_TERMINATE_ENABLED: 'false',
    DEFAULT_USER_ID: '00000000-0000-4000-8000-000000000001',
    DEFAULT_USER_EMAIL: 'jarvis-local@example.com'
  };
  return loadEnv();
}

describe('DeliveryRunnerService', () => {
  beforeEach(() => {
    process.env = { ...ENV_SNAPSHOT };
  });

  afterEach(() => {
    process.env = { ...ENV_SNAPSHOT };
    for (const dir of TEMP_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits a notification when WORKFLOW.md is invalid', async () => {
    const repoRoot = createTempRepo(`---
tracker:
  sources:
    - internal_task
---
Prompt only
`);
    const env = configureEnv(repoRoot);
    const store = createMemoryStore(env.DEFAULT_USER_ID, env.DEFAULT_USER_EMAIL);
    await store.initialize();
    const notificationService = createNotificationService();
    const events: string[] = [];
    notificationService.subscribe((event) => {
      events.push(event.type);
    });

    const service = new DeliveryRunnerService(store, env, notificationService);
    const snapshot = await service.refreshOnce('test-invalid-workflow');

    expect(snapshot.state.workflowValidation).toBe('invalid');
    expect(snapshot.state.dispatchEnabled).toBe(false);
    expect(events).toContain('runner_workflow_invalid');
  });

  it('marks stalled runs for retry and emits a stalled notification', async () => {
    const repoRoot = createTempRepo(`---
codex:
  command: codex exec "echo smoke"
---
Implement {{ workItem.title }}
`);
    const env = configureEnv(repoRoot);
    const store = createMemoryStore(env.DEFAULT_USER_ID, env.DEFAULT_USER_EMAIL);
    await store.initialize();
    const notificationService = createNotificationService();
    const events: Array<{ type: string; message: string }> = [];
    notificationService.subscribe((event) => {
      events.push({ type: event.type, message: event.message });
    });

    const stalledAt = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    const run = await store.createRunnerRun({
      userId: env.DEFAULT_USER_ID,
      workItem: {
        source: 'internal_task',
        externalId: 'task-stalled',
        identifier: 'task:task-stalled',
        userId: env.DEFAULT_USER_ID,
        taskId: null,
        title: 'Stalled task',
        description: 'simulate stale heartbeat',
        state: 'running',
        priority: 1,
        labels: ['runner'],
        branchName: 'task/stalled-task',
        url: null,
        blockedBy: [],
        workspaceKey: 'stalled-task',
        payload: {}
      },
      status: 'running',
      lastHeartbeatAt: stalledAt,
      lastProcessPid: 0
    });

    const service = new DeliveryRunnerService(store, env, notificationService);
    await service.refreshOnce('test-stalled-run');
    const updated = await store.getRunnerRunById({
      runId: run.id,
      userId: env.DEFAULT_USER_ID
    });

    expect(updated?.status).toBe('retry_queued');
    expect(updated?.failureReason).toContain('runner_stall_detected');
    expect(updated?.nextRetryAt).not.toBeNull();
    expect(events.some((event) => event.type === 'runner_run_stalled')).toBe(true);
    expect(events.find((event) => event.type === 'runner_run_stalled')?.message).toContain('queued retry');
  });
});
