import type { AppEnv } from '../config/env';
import type { NotificationService } from '../notifications/proactive';
import { logSpanEvent } from '../observability/spans';
import type { JarvisStore } from '../store/types';
import { startWorkerSupervisor } from '../workers/supervisor';

import { executeWatcherRun, shouldRunWatcherNow } from './watchers';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type JarvisWatcherWorkerRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error' | 'timeout';
  scanned: number;
  due: number;
  completed: number;
  failed: number;
  durationMs: number;
  error?: string;
};

export type JarvisWatcherWorkerStatus = {
  enabled: boolean;
  inflight: boolean;
  lastRun: JarvisWatcherWorkerRun | null;
  history: JarvisWatcherWorkerRun[];
};

const runtimeState: JarvisWatcherWorkerStatus = {
  enabled: false,
  inflight: false,
  lastRun: null,
  history: []
};

function pushRun(run: JarvisWatcherWorkerRun): void {
  runtimeState.lastRun = run;
  runtimeState.history = [run, ...runtimeState.history].slice(0, 20);
}

export function getJarvisWatcherWorkerStatus(): JarvisWatcherWorkerStatus {
  return {
    enabled: runtimeState.enabled,
    inflight: runtimeState.inflight,
    lastRun: runtimeState.lastRun,
    history: [...runtimeState.history]
  };
}

export type JarvisWatcherWorkerHandle = {
  stop: () => void;
  status: () => JarvisWatcherWorkerStatus;
};

export function startJarvisWatcherWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  notificationService?: NotificationService;
  logger?: LoggerLike;
}): JarvisWatcherWorkerHandle {
  const enabled = input.env.JARVIS_WATCHER_WORKER_ENABLED;
  runtimeState.enabled = enabled;
  runtimeState.inflight = false;
  runtimeState.lastRun = null;
  runtimeState.history = [];

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getJarvisWatcherWorkerStatus
    };
  }

  const logger = input.logger;
  const pollMs = Math.max(1000, input.env.JARVIS_WATCHER_WORKER_POLL_MS);
  const batchSize = Math.max(1, input.env.JARVIS_WATCHER_WORKER_BATCH);
  const timeoutMs = Math.max(15_000, Math.min(5 * 60_000, pollMs * 2));

  const supervisor = startWorkerSupervisor<JarvisWatcherWorkerRun>({
    enabled,
    pollMs,
    timeoutMs,
    historyLimit: 20,
    runOnce: async (startedAt) => {
      const now = new Date();
      const watchers = await input.store.listActiveWatchers({ limit: batchSize });
      const dueWatchers = watchers.filter((watcher) => shouldRunWatcherNow(watcher, now));
      let completed = 0;
      let failed = 0;

      for (const watcher of dueWatchers) {
        const run = await input.store.createWatcherRun({
          watcherId: watcher.id,
          userId: watcher.userId,
          status: 'running',
          summary: 'Scheduled watcher run started'
        });
        try {
          await executeWatcherRun({
            store: input.store,
            watcher,
            run,
            notificationService: input.notificationService
          });
          completed += 1;
        } catch (error) {
          failed += 1;
          logger?.warn(
            {
              watcher_id: watcher.id,
              user_id: watcher.userId,
              error: error instanceof Error ? error.message : String(error)
            },
            'jarvis watcher execution failed'
          );
        }
      }

      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        scanned: watchers.length,
        due: dueWatchers.length,
        completed,
        failed,
        durationMs: finishedAt.getTime() - startedAt.getTime()
      };
    },
    onRunError: ({ startedAt, finishedAt, status, error }) => ({
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      scanned: 0,
      due: 0,
      completed: 0,
      failed: 0,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error)
    }),
    onAfterRun: (run) => {
      pushRun(run);
      logSpanEvent({
        logger,
        spanName: 'worker.jarvis_watchers',
        stage: run.status === 'ok' ? 'complete' : 'error',
        status: run.status === 'ok' ? 'ok' : run.status,
        durationMs: run.durationMs,
        attrs: {
          scanned: run.scanned,
          due: run.due,
          completed: run.completed,
          failed: run.failed,
          error: run.error
        }
      });
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
    status: getJarvisWatcherWorkerStatus
  };
}
