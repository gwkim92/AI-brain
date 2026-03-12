import type { AppEnv } from '../config/env';
import { logSpanEvent } from '../observability/spans';
import type { JarvisStore, WorldModelProjectionRecord } from '../store/types';
import { startWorkerSupervisor } from '../workers/supervisor';

import { buildStoredDossierWorldModelExtraction } from './dossier';
import { recordWorldModelProjectionOutcomes } from './outcomes';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type WorldModelOutcomeWorkerRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error' | 'timeout';
  scanned: number;
  due: number;
  completed: number;
  failed: number;
  recordedOutcomes: number;
  durationMs: number;
  error?: string;
};

export type WorldModelOutcomeWorkerStatus = {
  enabled: boolean;
  inflight: boolean;
  lastRun: WorldModelOutcomeWorkerRun | null;
  history: WorldModelOutcomeWorkerRun[];
};

const runtimeState: WorldModelOutcomeWorkerStatus = {
  enabled: false,
  inflight: false,
  lastRun: null,
  history: [],
};

function pushRun(run: WorldModelOutcomeWorkerRun): void {
  runtimeState.lastRun = run;
  runtimeState.history = [run, ...runtimeState.history].slice(0, 20);
}

export function getWorldModelOutcomeWorkerStatus(): WorldModelOutcomeWorkerStatus {
  return {
    enabled: runtimeState.enabled,
    inflight: runtimeState.inflight,
    lastRun: runtimeState.lastRun,
    history: [...runtimeState.history],
  };
}

export type WorldModelOutcomeWorkerHandle = {
  stop: () => void;
  status: () => WorldModelOutcomeWorkerStatus;
};

function hasExpiredPendingCondition(projection: WorldModelProjectionRecord, nowIso: string): boolean {
  const pendingCount = Number(projection.summaryJson.pending_invalidation_count ?? 0);
  const nextExpectedBy = projection.summaryJson.next_expected_by;
  if (pendingCount <= 0 || typeof nextExpectedBy !== 'string') {
    return false;
  }
  const expectedMs = Date.parse(nextExpectedBy);
  return Number.isFinite(expectedMs) && Date.parse(nowIso) >= expectedMs;
}

export async function runWorldModelOutcomeBackfillPass(input: {
  store: Pick<
    JarvisStore,
    | 'listWorldModelProjections'
    | 'listWorldModelHypotheses'
    | 'listWorldModelInvalidationConditions'
    | 'getDossierById'
    | 'listDossierSources'
    | 'listDossierClaims'
    | 'updateWorldModelProjection'
    | 'listWorldModelOutcomes'
    | 'updateWorldModelInvalidationCondition'
    | 'updateWorldModelHypothesis'
    | 'createWorldModelOutcome'
    | 'recordRadarDomainPackOutcome'
  >;
  batchSize: number;
  nowIso?: string;
}): Promise<Omit<WorldModelOutcomeWorkerRun, 'startedAt' | 'finishedAt' | 'status' | 'durationMs'>> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const projections = await input.store.listWorldModelProjections({
    status: 'active',
    limit: Math.max(1, input.batchSize),
  });

  let due = 0;
  let completed = 0;
  let failed = 0;
  let recordedOutcomes = 0;

  for (const projection of projections) {
    if (!projection.dossierId || !hasExpiredPendingCondition(projection, nowIso)) {
      continue;
    }
    due += 1;

    try {
      const dossier = await input.store.getDossierById({
        userId: projection.userId,
        dossierId: projection.dossierId,
      });
      if (!dossier) {
        failed += 1;
        continue;
      }

      const [sources, claims] = await Promise.all([
        input.store.listDossierSources({ userId: projection.userId, dossierId: dossier.id, limit: 100 }),
        input.store.listDossierClaims({ userId: projection.userId, dossierId: dossier.id, limit: 100 }),
      ]);
      const extraction = buildStoredDossierWorldModelExtraction({
        dossier,
        sources,
        claims,
      });
      const recorded = await recordWorldModelProjectionOutcomes({
        store: input.store,
        userId: projection.userId,
        dossierId: dossier.id,
        projectionId: projection.id,
        extraction,
        evaluatedAt: nowIso,
        now: nowIso,
      });
      recordedOutcomes += recorded.length;
      completed += 1;

      await input.store.updateWorldModelProjection({
        projectionId: projection.id,
        userId: projection.userId,
        summaryJson: {
          ...projection.summaryJson,
          last_backfill_at: nowIso,
          last_backfill_recorded_outcomes: recorded.length,
        },
      });
    } catch {
      failed += 1;
    }
  }

  return {
    scanned: projections.length,
    due,
    completed,
    failed,
    recordedOutcomes,
  };
}

export function startWorldModelOutcomeWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  logger?: LoggerLike;
}): WorldModelOutcomeWorkerHandle {
  const enabled = input.env.WORLD_MODEL_OUTCOME_WORKER_ENABLED;
  runtimeState.enabled = enabled;
  runtimeState.inflight = false;
  runtimeState.lastRun = null;
  runtimeState.history = [];

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getWorldModelOutcomeWorkerStatus,
    };
  }

  const logger = input.logger;
  const pollMs = Math.max(1000, input.env.WORLD_MODEL_OUTCOME_WORKER_POLL_MS);
  const batchSize = Math.max(1, input.env.WORLD_MODEL_OUTCOME_WORKER_BATCH);
  const timeoutMs = Math.max(10_000, Math.min(5 * 60_000, pollMs * 2));

  const supervisor = startWorkerSupervisor<WorldModelOutcomeWorkerRun>({
    enabled,
    pollMs,
    timeoutMs,
    historyLimit: 20,
    runOnce: async (startedAt) => {
      const nowIso = new Date().toISOString();
      const result = await runWorldModelOutcomeBackfillPass({
        store: input.store,
        batchSize,
        nowIso,
      });
      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        scanned: result.scanned,
        due: result.due,
        completed: result.completed,
        failed: result.failed,
        recordedOutcomes: result.recordedOutcomes,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
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
      recordedOutcomes: 0,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error),
    }),
    onAfterRun: (run) => {
      pushRun(run);
      logSpanEvent({
        logger,
        spanName: 'worker.world_model_outcomes',
        stage: run.status === 'ok' ? 'complete' : 'error',
        status: run.status === 'ok' ? 'ok' : run.status,
        durationMs: run.durationMs,
        attrs: {
          scanned: run.scanned,
          due: run.due,
          completed: run.completed,
          failed: run.failed,
          recorded_outcomes: run.recordedOutcomes,
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
    status: getWorldModelOutcomeWorkerStatus,
  };
}
