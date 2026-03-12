import type { AppEnv } from '../config/env';
import type { NotificationService } from '../notifications/proactive';
import { logSpanEvent } from '../observability/spans';
import type { JarvisStore } from '../store/types';
import { startWorkerSupervisor } from '../workers/supervisor';

import { ensureDefaultIntelligenceSources } from './sources';
import { runIntelligenceSourceScanPass } from './service';
import type { ProviderRouter } from '../providers/router';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type IntelligenceScannerWorkerRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error' | 'timeout';
  workspaceId: string;
  scannedSources: number;
  fetchedCount: number;
  storedDocumentCount: number;
  signalCount: number;
  clusteredEventCount: number;
  executionCount: number;
  failedCount: number;
  failedSources: string[];
  durationMs: number;
  error?: string;
};

export type IntelligenceScannerWorkerStatus = {
  enabled: boolean;
  inflight: boolean;
  lastRun: IntelligenceScannerWorkerRun | null;
  history: IntelligenceScannerWorkerRun[];
};

const runtimeState: IntelligenceScannerWorkerStatus = {
  enabled: false,
  inflight: false,
  lastRun: null,
  history: [],
};

function pushRun(run: IntelligenceScannerWorkerRun): void {
  runtimeState.lastRun = run;
  runtimeState.history = [run, ...runtimeState.history].slice(0, 20);
}

export function getIntelligenceScannerWorkerStatus(): IntelligenceScannerWorkerStatus {
  return {
    enabled: runtimeState.enabled,
    inflight: runtimeState.inflight,
    lastRun: runtimeState.lastRun,
    history: [...runtimeState.history],
  };
}

export type IntelligenceScannerWorkerHandle = {
  stop: () => void;
  status: () => IntelligenceScannerWorkerStatus;
};

export function startIntelligenceScannerWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  providerRouter: ProviderRouter;
  notificationService?: NotificationService;
  logger?: LoggerLike;
}): IntelligenceScannerWorkerHandle {
  const enabled = input.env.INTELLIGENCE_SCANNER_WORKER_ENABLED && input.env.NODE_ENV !== 'test';
  runtimeState.enabled = enabled;
  runtimeState.inflight = false;
  runtimeState.lastRun = null;
  runtimeState.history = [];

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getIntelligenceScannerWorkerStatus,
    };
  }

  const pollMs = Math.max(1000, input.env.INTELLIGENCE_SCANNER_WORKER_POLL_MS);
  const sourceBatch = Math.max(1, input.env.INTELLIGENCE_SCANNER_WORKER_BATCH);
  const fetchTimeoutMs = Math.max(1000, input.env.INTELLIGENCE_SCANNER_FETCH_TIMEOUT_MS);
  const timeoutMs = Math.max(fetchTimeoutMs * Math.max(1, sourceBatch), pollMs);
  const logger = input.logger;

  const supervisor = startWorkerSupervisor<IntelligenceScannerWorkerRun>({
    enabled,
    pollMs,
    timeoutMs,
    historyLimit: 20,
    runOnce: async (startedAt) => {
      const workspace = await input.store.getOrCreateIntelligenceWorkspace({ userId: input.env.DEFAULT_USER_ID });
      await ensureDefaultIntelligenceSources({
        store: input.store,
        workspaceId: workspace.id,
      });
      const allSources = await input.store.listAllIntelligenceSources({ limit: 500, enabled: true });
      const workspaceIds = [...new Set(allSources.map((source) => source.workspaceId).filter(Boolean))];
      let scannedSources = 0;
      let fetchedCount = 0;
      let storedDocumentCount = 0;
      let signalCount = 0;
      let failedCount = 0;
      const failedSources: string[] = [];
      for (const workspaceId of workspaceIds) {
        const result = await runIntelligenceSourceScanPass({
          store: input.store,
          providerRouter: input.providerRouter,
        env: input.env,
        workspaceId,
        fetchTimeoutMs,
        sourceBatch,
      });
        scannedSources += result.sourceIds.length;
        fetchedCount += result.fetchedCount;
        storedDocumentCount += result.storedDocumentCount;
        signalCount += result.signalCount;
        failedCount += result.failedCount;
        failedSources.push(...result.failedSources);
      }
      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        workspaceId: workspace.id,
        scannedSources,
        fetchedCount,
        storedDocumentCount,
        signalCount,
        clusteredEventCount: 0,
        executionCount: 0,
        failedCount,
        failedSources,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
    },
    onRunError: ({ startedAt, finishedAt, status, error }) => ({
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      workspaceId: '',
      scannedSources: 0,
      fetchedCount: 0,
      storedDocumentCount: 0,
      signalCount: 0,
      clusteredEventCount: 0,
      executionCount: 0,
      failedCount: 0,
      failedSources: [],
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error),
    }),
    onAfterRun: (run) => {
      pushRun(run);
      logSpanEvent({
        logger,
        spanName: 'worker.intelligence_scanner',
        stage: run.status === 'ok' ? 'complete' : 'error',
        status: run.status === 'ok' ? 'ok' : run.status,
        durationMs: run.durationMs,
        attrs: {
          workspace_id: run.workspaceId,
          scanned_sources: run.scannedSources,
          fetched_count: run.fetchedCount,
          stored_document_count: run.storedDocumentCount,
          signal_count: run.signalCount,
          clustered_event_count: run.clusteredEventCount,
          execution_count: run.executionCount,
          failed_count: run.failedCount,
          failed_sources: run.failedSources,
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
    status: getIntelligenceScannerWorkerStatus,
  };
}
