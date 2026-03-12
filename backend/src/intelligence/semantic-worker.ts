import type { AppEnv } from '../config/env';
import type { NotificationService } from '../notifications/proactive';
import { logSpanEvent } from '../observability/spans';
import type { ProviderRouter } from '../providers/router';
import type { JarvisStore } from '../store/types';
import { startWorkerSupervisor } from '../workers/supervisor';

import { runIntelligenceSemanticPass } from './service';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type IntelligenceSemanticWorkerRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error' | 'timeout';
  workspaceId: string;
  processedSignalCount: number;
  clusteredEventCount: number;
  deliberationCount: number;
  executionCount: number;
  failedCount: number;
  failedSignalIds: string[];
  durationMs: number;
  error?: string;
};

export type IntelligenceSemanticWorkerStatus = {
  enabled: boolean;
  inflight: boolean;
  lastRun: IntelligenceSemanticWorkerRun | null;
  history: IntelligenceSemanticWorkerRun[];
};

const runtimeState: IntelligenceSemanticWorkerStatus = {
  enabled: false,
  inflight: false,
  lastRun: null,
  history: [],
};

function pushRun(run: IntelligenceSemanticWorkerRun): void {
  runtimeState.lastRun = run;
  runtimeState.history = [run, ...runtimeState.history].slice(0, 20);
}

export function getIntelligenceSemanticWorkerStatus(): IntelligenceSemanticWorkerStatus {
  return {
    enabled: runtimeState.enabled,
    inflight: runtimeState.inflight,
    lastRun: runtimeState.lastRun,
    history: [...runtimeState.history],
  };
}

export type IntelligenceSemanticWorkerHandle = {
  stop: () => void;
  status: () => IntelligenceSemanticWorkerStatus;
};

export function startIntelligenceSemanticWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  providerRouter: ProviderRouter;
  notificationService?: NotificationService;
  logger?: LoggerLike;
}): IntelligenceSemanticWorkerHandle {
  const enabled = input.env.INTELLIGENCE_SEMANTIC_WORKER_ENABLED && input.env.NODE_ENV !== 'test';
  runtimeState.enabled = enabled;
  runtimeState.inflight = false;
  runtimeState.lastRun = null;
  runtimeState.history = [];

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getIntelligenceSemanticWorkerStatus,
    };
  }

  const pollMs = Math.max(1_000, input.env.INTELLIGENCE_SEMANTIC_WORKER_POLL_MS);
  const signalBatch = Math.max(1, input.env.INTELLIGENCE_SEMANTIC_WORKER_BATCH);
  const logger = input.logger;
  const supervisor = startWorkerSupervisor<IntelligenceSemanticWorkerRun>({
    enabled,
    pollMs,
    timeoutMs: Math.max(10_000, pollMs),
    historyLimit: 20,
    runOnce: async (startedAt) => {
      const allSources = await input.store.listAllIntelligenceSources({ limit: 500, enabled: true });
      const workspaceIds = [...new Set(allSources.map((source) => source.workspaceId).filter(Boolean))];
      let processedSignalCount = 0;
      let clusteredEventCount = 0;
      let deliberationCount = 0;
      let executionCount = 0;
      let failedCount = 0;
      const failedSignalIds: string[] = [];
      for (const workspaceId of workspaceIds) {
        const result = await runIntelligenceSemanticPass({
          store: input.store,
          providerRouter: input.providerRouter,
          env: input.env,
          workspaceId,
          userId: input.env.DEFAULT_USER_ID,
          signalBatch,
          notificationService: input.notificationService,
        });
        processedSignalCount += result.processedSignalCount;
        clusteredEventCount += result.clusteredEventCount;
        deliberationCount += result.deliberationCount;
        executionCount += result.executionCount;
        failedCount += result.failedCount;
        failedSignalIds.push(...result.failedSignalIds);
      }
      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        workspaceId: workspaceIds[0] ?? '',
        processedSignalCount,
        clusteredEventCount,
        deliberationCount,
        executionCount,
        failedCount,
        failedSignalIds,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
    },
    onRunError: ({ startedAt, finishedAt, status, error }) => ({
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      workspaceId: '',
      processedSignalCount: 0,
      clusteredEventCount: 0,
      deliberationCount: 0,
      executionCount: 0,
      failedCount: 0,
      failedSignalIds: [],
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error),
    }),
    onAfterRun: (run) => {
      pushRun(run);
      logSpanEvent({
        logger,
        spanName: 'worker.intelligence_semantic',
        stage: run.status === 'ok' ? 'complete' : 'error',
        status: run.status === 'ok' ? 'ok' : run.status,
        durationMs: run.durationMs,
        attrs: {
          workspace_id: run.workspaceId,
          processed_signal_count: run.processedSignalCount,
          clustered_event_count: run.clusteredEventCount,
          deliberation_count: run.deliberationCount,
          execution_count: run.executionCount,
          failed_count: run.failedCount,
          failed_signal_ids: run.failedSignalIds,
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
    status: getIntelligenceSemanticWorkerStatus,
  };
}
