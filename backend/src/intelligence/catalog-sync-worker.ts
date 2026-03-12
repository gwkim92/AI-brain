import type { AppEnv } from '../config/env';
import { logSpanEvent } from '../observability/spans';
import type { ProviderRouter } from '../providers/router';
import type { JarvisStore } from '../store/types';
import { startWorkerSupervisor } from '../workers/supervisor';

import { syncIntelligenceModelCatalog } from './service';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type IntelligenceCatalogSyncRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error' | 'timeout';
  syncedEntries: number;
  durationMs: number;
  error?: string;
};

export type IntelligenceCatalogSyncStatus = {
  enabled: boolean;
  inflight: boolean;
  lastRun: IntelligenceCatalogSyncRun | null;
  history: IntelligenceCatalogSyncRun[];
};

const runtimeState: IntelligenceCatalogSyncStatus = {
  enabled: false,
  inflight: false,
  lastRun: null,
  history: [],
};

function pushRun(run: IntelligenceCatalogSyncRun): void {
  runtimeState.lastRun = run;
  runtimeState.history = [run, ...runtimeState.history].slice(0, 20);
}

export function getIntelligenceCatalogSyncWorkerStatus(): IntelligenceCatalogSyncStatus {
  return {
    enabled: runtimeState.enabled,
    inflight: runtimeState.inflight,
    lastRun: runtimeState.lastRun,
    history: [...runtimeState.history],
  };
}

export type IntelligenceCatalogSyncWorkerHandle = {
  stop: () => void;
  status: () => IntelligenceCatalogSyncStatus;
};

export function startIntelligenceCatalogSyncWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  providerRouter: ProviderRouter;
  logger?: LoggerLike;
}): IntelligenceCatalogSyncWorkerHandle {
  const enabled = input.env.INTELLIGENCE_MODEL_SYNC_WORKER_ENABLED && input.env.NODE_ENV !== 'test';
  runtimeState.enabled = enabled;
  runtimeState.inflight = false;
  runtimeState.lastRun = null;
  runtimeState.history = [];

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getIntelligenceCatalogSyncWorkerStatus,
    };
  }

  const pollMs = Math.max(10_000, input.env.INTELLIGENCE_MODEL_SYNC_WORKER_POLL_MS);
  const logger = input.logger;
  const supervisor = startWorkerSupervisor<IntelligenceCatalogSyncRun>({
    enabled,
    pollMs,
    timeoutMs: Math.max(10_000, pollMs),
    historyLimit: 20,
    runOnce: async (startedAt) => {
      const syncedEntries = await syncIntelligenceModelCatalog({
        store: input.store,
        env: input.env,
        providerRouter: input.providerRouter,
      });
      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        syncedEntries,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
    },
    onRunError: ({ startedAt, finishedAt, status, error }) => ({
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      syncedEntries: 0,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error),
    }),
    onAfterRun: (run) => {
      pushRun(run);
      logSpanEvent({
        logger,
        spanName: 'worker.intelligence_model_sync',
        stage: run.status === 'ok' ? 'complete' : 'error',
        status: run.status === 'ok' ? 'ok' : run.status,
        durationMs: run.durationMs,
        attrs: {
          synced_entries: run.syncedEntries,
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
    status: getIntelligenceCatalogSyncWorkerStatus,
  };
}
