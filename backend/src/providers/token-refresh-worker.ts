import type { AppEnv } from '../config/env';
import type { JarvisStore } from '../store/types';
import { startWorkerSupervisor } from '../workers/supervisor';

import { resolveEffectiveProviderCredentials } from './credentials-resolver';

export type ProviderTokenRefreshRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error' | 'timeout';
  scannedUsers: number;
  scannedCredentials: number;
  refreshed: number;
  failed: number;
  durationMs: number;
  error?: string;
};

export type ProviderTokenRefreshWorkerStatus = {
  enabled: boolean;
  inflight: boolean;
  lastRun: ProviderTokenRefreshRun | null;
  history: ProviderTokenRefreshRun[];
};

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

const runtimeState: ProviderTokenRefreshWorkerStatus = {
  enabled: false,
  inflight: false,
  lastRun: null,
  history: []
};

export function getProviderTokenRefreshWorkerStatus(): ProviderTokenRefreshWorkerStatus {
  return {
    enabled: runtimeState.enabled,
    inflight: runtimeState.inflight,
    lastRun: runtimeState.lastRun,
    history: [...runtimeState.history]
  };
}

export type ProviderTokenRefreshWorkerHandle = {
  stop: () => void;
  status: () => ProviderTokenRefreshWorkerStatus;
};

function pushRun(run: ProviderTokenRefreshRun): void {
  runtimeState.lastRun = run;
  runtimeState.history = [run, ...runtimeState.history].slice(0, 30);
}

export function startProviderTokenRefreshWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  logger?: LoggerLike;
}): ProviderTokenRefreshWorkerHandle {
  const logger = input.logger;

  const enabled = input.env.PROVIDER_USER_CREDENTIALS_ENABLED
    && input.env.PROVIDER_TOKEN_REFRESH_WORKER_ENABLED;
  runtimeState.enabled = enabled;
  runtimeState.inflight = false;
  runtimeState.lastRun = null;
  runtimeState.history = [];

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getProviderTokenRefreshWorkerStatus
    };
  }

  const pollMs = Math.max(1000, input.env.PROVIDER_TOKEN_REFRESH_WORKER_POLL_MS);
  const batchSize = Math.max(1, input.env.PROVIDER_TOKEN_REFRESH_WORKER_BATCH);
  const runTimeoutMs = Math.max(10_000, Math.min(120_000, pollMs * 3));

  const supervisor = startWorkerSupervisor<ProviderTokenRefreshRun>({
    enabled,
    pollMs,
    timeoutMs: runTimeoutMs,
    historyLimit: 30,
    runOnce: async (startedAt) => {
      const counters = {
        refreshed: 0,
        failed: 0
      };
      const rows = await input.store.listActiveUserProviderCredentials({
        limit: batchSize
      });

      const userIds = Array.from(new Set(rows.map((row) => row.userId)));
      for (const userId of userIds) {
        await resolveEffectiveProviderCredentials({
          store: input.store,
          env: input.env,
          userId,
          updatedBy: userId,
          onAuthEvent: (event) => {
            if (event.stage === 'refresh_complete') {
              counters.refreshed += 1;
            }
            if (event.stage === 'refresh_failed') {
              counters.failed += 1;
            }
          }
        });
      }

      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        scannedUsers: userIds.length,
        scannedCredentials: rows.length,
        refreshed: counters.refreshed,
        failed: counters.failed,
        durationMs: finishedAt.getTime() - startedAt.getTime()
      };
    },
    onRunError: ({ startedAt, finishedAt, status, error }) => {
      const message = error instanceof Error ? error.message : String(error);
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status,
        scannedUsers: 0,
        scannedCredentials: 0,
        refreshed: 0,
        failed: 0,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: message
      };
    },
    onAfterRun: (run) => {
      pushRun(run);
      if (run.status === 'ok') {
        logger?.info({
          oauth_refresh: run
        }, 'provider oauth refresh worker run complete');
      } else {
        logger?.error({
          oauth_refresh: run
        }, 'provider oauth refresh worker run failed');
      }
    },
    onStatusChange: (status) => {
      runtimeState.enabled = status.enabled;
      runtimeState.inflight = status.inflight;
    }
  });

  return {
    stop: () => {
      supervisor.stop();
      runtimeState.enabled = false;
      runtimeState.inflight = false;
    },
    status: getProviderTokenRefreshWorkerStatus
  };
}
