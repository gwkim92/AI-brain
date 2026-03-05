import type { AppEnv } from '../config/env';
import type { JarvisStore } from '../store/types';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type AiTraceCleanupRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error';
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
  if (!enabled) {
    return {
      stop: () => undefined,
      status: getAiTraceCleanupWorkerStatus
    };
  }

  const logger = input.logger;
  let inflight = false;
  let closed = false;
  const pollMs = 10 * 60 * 1000;

  const tick = async () => {
    if (closed || inflight) {
      return;
    }
    inflight = true;
    runtimeState.inflight = true;
    const startedAt = new Date();
    try {
      const [tracesDeleted, recommendationsDeleted] = await Promise.all([
        input.store.cleanupExpiredAiInvocationTraces({
          retentionDays: input.env.AI_TRACE_RETENTION_DAYS
        }),
        input.store.cleanupExpiredModelRecommendationRuns({
          retentionDays: input.env.AI_TRACE_RETENTION_DAYS
        })
      ]);
      const finishedAt = new Date();
      const run: AiTraceCleanupRun = {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        tracesDeleted,
        recommendationsDeleted,
        durationMs: finishedAt.getTime() - startedAt.getTime()
      };
      pushRun(run);
      logger?.info({ ai_trace_cleanup: run }, 'ai trace cleanup worker completed');
    } catch (error) {
      const finishedAt = new Date();
      const run: AiTraceCleanupRun = {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'error',
        tracesDeleted: 0,
        recommendationsDeleted: 0,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: error instanceof Error ? error.message : String(error)
      };
      pushRun(run);
      logger?.error({ ai_trace_cleanup: run, err: error }, 'ai trace cleanup worker failed');
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
    status: getAiTraceCleanupWorkerStatus
  };
}
