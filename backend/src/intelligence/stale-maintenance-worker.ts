import type { AppEnv } from '../config/env';
import type { NotificationService } from '../notifications/proactive';
import { logSpanEvent } from '../observability/spans';
import type { ProviderRouter } from '../providers/router';
import type { JarvisStore } from '../store/types';
import { startWorkerSupervisor } from '../workers/supervisor';

import { bulkRebuildIntelligenceEvents } from './service';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type IntelligenceStaleMaintenanceWorkerRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error' | 'timeout';
  workspaceIds: string[];
  attemptedCount: number;
  rebuiltCount: number;
  failedCount: number;
  durationMs: number;
  error?: string;
};

export type IntelligenceStaleMaintenanceWorkerStatus = {
  enabled: boolean;
  inflight: boolean;
  lastRun: IntelligenceStaleMaintenanceWorkerRun | null;
  history: IntelligenceStaleMaintenanceWorkerRun[];
};

const runtimeState: IntelligenceStaleMaintenanceWorkerStatus = {
  enabled: false,
  inflight: false,
  lastRun: null,
  history: [],
};

function pushRun(run: IntelligenceStaleMaintenanceWorkerRun): void {
  runtimeState.lastRun = run;
  runtimeState.history = [run, ...runtimeState.history].slice(0, 20);
}

export function getIntelligenceStaleMaintenanceWorkerStatus(): IntelligenceStaleMaintenanceWorkerStatus {
  return {
    enabled: runtimeState.enabled,
    inflight: runtimeState.inflight,
    lastRun: runtimeState.lastRun,
    history: [...runtimeState.history],
  };
}

export type IntelligenceStaleMaintenanceWorkerHandle = {
  stop: () => void;
  status: () => IntelligenceStaleMaintenanceWorkerStatus;
};

export function startIntelligenceStaleMaintenanceWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  providerRouter: ProviderRouter;
  notificationService?: NotificationService;
  logger?: LoggerLike;
}): IntelligenceStaleMaintenanceWorkerHandle {
  const enabled = input.env.INTELLIGENCE_STALE_MAINTENANCE_WORKER_ENABLED && input.env.NODE_ENV !== 'test';
  runtimeState.enabled = enabled;
  runtimeState.inflight = false;
  runtimeState.lastRun = null;
  runtimeState.history = [];

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getIntelligenceStaleMaintenanceWorkerStatus,
    };
  }

  const pollMs = Math.max(1_000, input.env.INTELLIGENCE_STALE_MAINTENANCE_WORKER_POLL_MS);
  const batch = Math.max(1, input.env.INTELLIGENCE_STALE_MAINTENANCE_WORKER_BATCH);
  const logger = input.logger;

  const supervisor = startWorkerSupervisor<IntelligenceStaleMaintenanceWorkerRun>({
    enabled,
    pollMs,
    timeoutMs: Math.max(30_000, pollMs),
    historyLimit: 20,
    runOnce: async (startedAt) => {
      const allSources = await input.store.listAllIntelligenceSources({ limit: 500, enabled: true });
      const defaultWorkspace = await input.store.getOrCreateIntelligenceWorkspace({ userId: input.env.DEFAULT_USER_ID });
      const workspaceIds = [...new Set([defaultWorkspace.id, ...allSources.map((source) => source.workspaceId).filter(Boolean)])];
      let attemptedCount = 0;
      let rebuiltCount = 0;
      let failedCount = 0;

      for (const workspaceId of workspaceIds) {
        const result = await bulkRebuildIntelligenceEvents({
          store: input.store,
          providerRouter: input.providerRouter,
          env: input.env,
          workspaceId,
          userId: input.env.DEFAULT_USER_ID,
          limit: batch,
          notificationService: input.notificationService,
        });
        attemptedCount += result.attemptedEventIds.length;
        rebuiltCount += result.rebuiltCount;
        failedCount += result.failedCount;
      }

      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        workspaceIds,
        attemptedCount,
        rebuiltCount,
        failedCount,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
    },
    onRunError: ({ startedAt, finishedAt, status, error }) => ({
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      workspaceIds: [],
      attemptedCount: 0,
      rebuiltCount: 0,
      failedCount: 0,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error),
    }),
    onAfterRun: (run) => {
      pushRun(run);
      logSpanEvent({
        logger,
        spanName: 'worker.intelligence_stale_maintenance',
        stage: run.status === 'ok' ? 'complete' : 'error',
        status: run.status === 'ok' ? 'ok' : run.status,
        durationMs: run.durationMs,
        attrs: {
          workspace_ids: run.workspaceIds,
          attempted_count: run.attemptedCount,
          rebuilt_count: run.rebuiltCount,
          failed_count: run.failedCount,
          error: run.error,
        },
      });
    },
    onStatusChange: (status) => {
      runtimeState.enabled = status.enabled;
      runtimeState.inflight = status.inflight;
    },
  });

  return {
    stop: () => {
      supervisor.stop();
      runtimeState.enabled = false;
      runtimeState.inflight = false;
    },
    status: getIntelligenceStaleMaintenanceWorkerStatus,
  };
}
