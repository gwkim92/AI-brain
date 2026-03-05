import { setTimeout as sleep } from 'node:timers/promises';

import type { AppEnv } from '../config/env';
import type { JarvisStore } from '../store/types';

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    sleep(timeoutMs).then(() => {
      throw new Error('provider token refresh worker timeout');
    })
  ]);
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

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getProviderTokenRefreshWorkerStatus
    };
  }

  let closed = false;
  let inflight = false;
  const pollMs = Math.max(1000, input.env.PROVIDER_TOKEN_REFRESH_WORKER_POLL_MS);
  const batchSize = Math.max(1, input.env.PROVIDER_TOKEN_REFRESH_WORKER_BATCH);
  const runTimeoutMs = Math.max(10_000, Math.min(120_000, pollMs * 3));

  const tick = async () => {
    if (closed || inflight) {
      return;
    }

    inflight = true;
    runtimeState.inflight = true;
    const startedAt = new Date();

    const counters = {
      refreshed: 0,
      failed: 0
    };

    try {
      const runPromise = (async () => {
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

        return {
          scannedUsers: userIds.length,
          scannedCredentials: rows.length
        };
      })();

      const { scannedUsers, scannedCredentials } = await withTimeout(runPromise, runTimeoutMs);
      const finishedAt = new Date();
      const run: ProviderTokenRefreshRun = {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        scannedUsers,
        scannedCredentials,
        refreshed: counters.refreshed,
        failed: counters.failed,
        durationMs: finishedAt.getTime() - startedAt.getTime()
      };
      pushRun(run);
      logger?.info({
        oauth_refresh: run
      }, 'provider oauth refresh worker run complete');
    } catch (error) {
      const finishedAt = new Date();
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = /timeout/u.test(message);
      const run: ProviderTokenRefreshRun = {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: isTimeout ? 'timeout' : 'error',
        scannedUsers: 0,
        scannedCredentials: 0,
        refreshed: counters.refreshed,
        failed: counters.failed,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: message
      };
      pushRun(run);
      logger?.error({
        oauth_refresh: run,
        err: error
      }, 'provider oauth refresh worker run failed');
    } finally {
      inflight = false;
      runtimeState.inflight = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, pollMs);
  void tick();

  return {
    stop: () => {
      closed = true;
      clearInterval(timer);
      runtimeState.enabled = false;
      runtimeState.inflight = false;
    },
    status: getProviderTokenRefreshWorkerStatus
  };
}
