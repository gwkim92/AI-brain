import type { AppEnv } from '../config/env';
import type { JarvisStore } from '../store/types';
import { startWorkerSupervisor } from '../workers/supervisor';
import { logSpanEvent } from './spans';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type AiTraceCleanupRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error' | 'timeout';
  tracesDeleted: number;
  recommendationsDeleted: number;
  durationMs: number;
  error?: string;
};

export type AiTraceCleanupWorkerStatus = {
  enabled: boolean;
  inflight: boolean;
  lastRun: AiTraceCleanupRun | null;
  history: AiTraceCleanupRun[];
};

const runtimeState: AiTraceCleanupWorkerStatus = {
  enabled: false,
  inflight: false,
  lastRun: null,
  history: []
};

function pushRun(run: AiTraceCleanupRun): void {
  runtimeState.lastRun = run;
  runtimeState.history = [run, ...runtimeState.history].slice(0, 20);
}

export function getAiTraceCleanupWorkerStatus(): AiTraceCleanupWorkerStatus {
  return {
    enabled: runtimeState.enabled,
    inflight: runtimeState.inflight,
    lastRun: runtimeState.lastRun,
    history: [...runtimeState.history]
  };
}

export type AiTraceCleanupWorkerHandle = {
  stop: () => void;
  status: () => AiTraceCleanupWorkerStatus;
};

export function startAiTraceCleanupWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  logger?: LoggerLike;
}): AiTraceCleanupWorkerHandle {
  const enabled = input.env.MODEL_CONTROL_ENABLED && input.env.AI_TRACE_LOGGING_ENABLED;
  runtimeState.enabled = enabled;
  runtimeState.inflight = false;
  runtimeState.lastRun = null;
  runtimeState.history = [];

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getAiTraceCleanupWorkerStatus
    };
  }

  const logger = input.logger;
  const pollMs = 10 * 60 * 1000;
  const runTimeoutMs = Math.max(30_000, Math.min(180_000, Math.trunc(pollMs / 2)));

  const supervisor = startWorkerSupervisor<AiTraceCleanupRun>({
    enabled,
    pollMs,
    timeoutMs: runTimeoutMs,
    historyLimit: 20,
    runOnce: async (startedAt) => {
      const [tracesDeleted, recommendationsDeleted] = await Promise.all([
        input.store.cleanupExpiredAiInvocationTraces({
          retentionDays: input.env.AI_TRACE_RETENTION_DAYS
        }),
        input.store.cleanupExpiredModelRecommendationRuns({
          retentionDays: input.env.AI_TRACE_RETENTION_DAYS
        })
      ]);
      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        tracesDeleted,
        recommendationsDeleted,
        durationMs: finishedAt.getTime() - startedAt.getTime()
      };
    },
    onRunError: ({ startedAt, finishedAt, status, error }) => {
      const message = error instanceof Error ? error.message : String(error);
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status,
        tracesDeleted: 0,
        recommendationsDeleted: 0,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: message
      };
    },
    onAfterRun: (run) => {
      pushRun(run);
      logSpanEvent({
        logger,
        spanName: 'worker.ai_trace_cleanup',
        stage: run.status === 'ok' ? 'complete' : 'error',
        status: run.status === 'ok' ? 'ok' : run.status,
        durationMs: run.durationMs,
        attrs: {
          traces_deleted: run.tracesDeleted,
          recommendations_deleted: run.recommendationsDeleted,
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
    status: getAiTraceCleanupWorkerStatus
  };
}
