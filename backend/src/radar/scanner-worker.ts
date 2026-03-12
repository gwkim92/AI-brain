import type { AppEnv } from '../config/env';
import type { NotificationService } from '../notifications/proactive';
import { logSpanEvent } from '../observability/spans';
import type { JarvisStore, RadarFeedSourceRecord, RadarItemRecord } from '../store/types';
import { startWorkerSupervisor } from '../workers/supervisor';

import { executeRadarEvaluationAndPromotion } from './evaluation-service';
import { fetchRadarFeed } from './feed-fetchers';
import { listDefaultRadarFeedSources } from './feed-sources';
import { normalizeRadarItems } from './ingest';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type RadarScannerWorkerRun = {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error' | 'timeout';
  scannedSources: number;
  dueSources: number;
  fetchedCount: number;
  ingestedCount: number;
  evaluatedCount: number;
  promotedCount: number;
  autoExecutedCount: number;
  failedCount: number;
  failedSources: string[];
  durationMs: number;
  error?: string;
};

export type RadarScannerWorkerStatus = {
  enabled: boolean;
  inflight: boolean;
  lastRun: RadarScannerWorkerRun | null;
  history: RadarScannerWorkerRun[];
};

const runtimeState: RadarScannerWorkerStatus = {
  enabled: false,
  inflight: false,
  lastRun: null,
  history: [],
};

function pushRun(run: RadarScannerWorkerRun): void {
  runtimeState.lastRun = run;
  runtimeState.history = [run, ...runtimeState.history].slice(0, 20);
}

export function getRadarScannerWorkerStatus(): RadarScannerWorkerStatus {
  return {
    enabled: runtimeState.enabled,
    inflight: runtimeState.inflight,
    lastRun: runtimeState.lastRun,
    history: [...runtimeState.history],
  };
}

export type RadarScannerWorkerHandle = {
  stop: () => void;
  status: () => RadarScannerWorkerStatus;
};

function shouldPollSource(source: RadarFeedSourceRecord, nowMs: number): boolean {
  if (!source.enabled) {
    return false;
  }
  if (!source.lastFetchedAt) {
    return true;
  }
  const lastFetchedMs = Date.parse(source.lastFetchedAt);
  if (!Number.isFinite(lastFetchedMs)) {
    return true;
  }
  return nowMs - lastFetchedMs >= Math.max(1, source.pollMinutes) * 60_000;
}

function isNewerThanCursor(publishedAt: string | undefined, lastSeenPublishedAt: string | null): boolean {
  if (!publishedAt || !lastSeenPublishedAt) {
    return true;
  }
  const publishedMs = Date.parse(publishedAt);
  const lastSeenMs = Date.parse(lastSeenPublishedAt);
  if (!Number.isFinite(publishedMs) || !Number.isFinite(lastSeenMs)) {
    return true;
  }
  return publishedMs > lastSeenMs;
}

export async function runRadarScannerPass(input: {
  store: Pick<
    JarvisStore,
    | 'upsertRadarFeedSources'
    | 'listRadarFeedSources'
    | 'listRadarFeedCursors'
    | 'upsertRadarFeedCursor'
    | 'createRadarIngestRun'
    | 'completeRadarIngestRun'
    | 'ingestRadarItems'
    | 'evaluateRadar'
    | 'listRadarItems'
    | 'getRadarEventById'
    | 'listRadarDomainPosteriors'
    | 'getRadarAutonomyDecision'
    | 'listWatchers'
    | 'createWatcher'
    | 'createBriefing'
    | 'createDossier'
    | 'replaceDossierSources'
    | 'replaceDossierClaims'
    | 'createJarvisSession'
    | 'updateJarvisSession'
    | 'appendJarvisSessionEvent'
    | 'upsertJarvisSessionStage'
    | 'createActionProposal'
    | 'decideActionProposal'
    | 'createWorldModelProjection'
    | 'listWorldModelProjections'
    | 'updateWorldModelProjection'
    | 'upsertWorldModelEntity'
    | 'createWorldModelEvent'
    | 'createWorldModelObservation'
    | 'createWorldModelConstraint'
    | 'createWorldModelStateSnapshot'
    | 'createWorldModelHypothesis'
    | 'createWorldModelHypothesisEvidence'
    | 'createWorldModelInvalidationCondition'
  >;
  notificationService?: NotificationService;
  fetchTimeoutMs: number;
  sourceBatch: number;
  userId: string;
  nowIso?: string;
  fetchImpl?: typeof fetch;
  seedDefaultSources?: boolean;
}): Promise<Omit<RadarScannerWorkerRun, 'startedAt' | 'finishedAt' | 'status' | 'durationMs'>> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  if (input.seedDefaultSources !== false) {
    await input.store.upsertRadarFeedSources({
      sources: listDefaultRadarFeedSources(),
    });
  }

  const [sources, cursors] = await Promise.all([
    input.store.listRadarFeedSources({ enabled: true, limit: 200 }),
    input.store.listRadarFeedCursors(),
  ]);
  const cursorBySourceId = new Map(cursors.map((cursor) => [cursor.sourceId, cursor] as const));
  const dueSources = sources.filter((source) => shouldPollSource(source, nowMs)).slice(0, Math.max(1, input.sourceBatch));
  const run = await input.store.createRadarIngestRun({
    sourceId: null,
    status: 'running',
    startedAt: nowIso,
    detailJson: {
      mode: 'scanner_tick',
      due_source_ids: dueSources.map((source) => source.id),
    },
  });

  let fetchedCount = 0;
  let ingestedCount = 0;
  let failedCount = 0;
  const failedSources: string[] = [];
  const ingestedItems: RadarItemRecord[] = [];
  const sourceDetails: Array<Record<string, unknown>> = [];

  for (const source of dueSources) {
    const cursor = cursorBySourceId.get(source.id) ?? null;
    try {
      const fetched = await fetchRadarFeed({
        source,
        cursor,
        timeoutMs: input.fetchTimeoutMs,
        now: nowIso,
        fetchImpl: input.fetchImpl,
      });
      const freshItems = fetched.items.filter((item) => isNewerThanCursor(item.publishedAt, cursor?.lastSeenPublishedAt ?? null));
      const normalized = normalizeRadarItems(source.name, freshItems);
      const stored = await input.store.ingestRadarItems(
        normalized.map((item) => ({
          id: item.id,
          title: item.title,
          summary: item.summary,
          sourceUrl: item.sourceUrl,
          sourceName: item.sourceName,
          publishedAt: item.publishedAt,
          observedAt: item.observedAt,
          confidenceScore: item.confidenceScore,
          status: 'new',
          sourceType: item.sourceType,
          sourceTier: item.sourceTier,
          rawMetrics: item.rawMetrics,
          entityHints: item.entityHints,
          trustHint: item.trustHint,
          payload: item.payload,
        }))
      );

      fetchedCount += fetched.items.length;
      ingestedCount += stored.length;
      ingestedItems.push(...stored);

      await Promise.all([
        input.store.upsertRadarFeedCursor({
          sourceId: source.id,
          cursor: fetched.cursor.cursor ?? null,
          etag: fetched.cursor.etag ?? null,
          lastModified: fetched.cursor.lastModified ?? null,
          lastSeenPublishedAt: fetched.cursor.lastSeenPublishedAt ?? cursor?.lastSeenPublishedAt ?? null,
          lastFetchedAt: fetched.cursor.lastFetchedAt ?? nowIso,
        }),
        input.store.upsertRadarFeedSources({
          sources: [
            {
              ...source,
              lastFetchedAt: fetched.cursor.lastFetchedAt ?? nowIso,
              lastSuccessAt: nowIso,
              lastError: null,
            },
          ],
        }),
      ]);

      sourceDetails.push({
        source_id: source.id,
        fetched_count: fetched.items.length,
        ingested_count: stored.length,
        not_modified: fetched.fetchMeta.notModified,
        status_code: fetched.fetchMeta.statusCode,
      });
    } catch (error) {
      failedCount += 1;
      failedSources.push(source.id);
      const message = error instanceof Error ? error.message : String(error);
      await input.store.upsertRadarFeedSources({
        sources: [
          {
            ...source,
            lastFetchedAt: nowIso,
            lastError: message,
          },
        ],
      });
      sourceDetails.push({
        source_id: source.id,
        error: message,
      });
    }
  }

  if (ingestedItems.length > 0) {
    input.notificationService?.emitRadarNewItem(ingestedItems.length);
  }

  const evaluation = ingestedItems.length
    ? await executeRadarEvaluationAndPromotion({
        store: input.store,
        userId: input.userId,
        itemIds: ingestedItems.map((item) => item.id),
        notificationService: input.notificationService,
        knownItems: ingestedItems,
      })
    : { recommendations: [], promotions: [] };

  const autoExecutedCount = evaluation.promotions.filter((promotion) => promotion.autoExecuted).length;
  await input.store.completeRadarIngestRun({
    runId: run.id,
    finishedAt: new Date().toISOString(),
    status: failedCount > 0 && dueSources.length === failedCount ? 'error' : 'ok',
    fetchedCount,
    ingestedCount,
    evaluatedCount: evaluation.recommendations.length,
    promotedCount: evaluation.promotions.length,
    autoExecutedCount,
    failedCount,
    error: failedSources.length > 0 ? `failed_sources:${failedSources.join(',')}` : null,
    detailJson: {
      source_details: sourceDetails,
      promotion_event_ids: evaluation.promotions.map((promotion) => promotion.eventId),
    },
  });

  return {
    scannedSources: sources.length,
    dueSources: dueSources.length,
    fetchedCount,
    ingestedCount,
    evaluatedCount: evaluation.recommendations.length,
    promotedCount: evaluation.promotions.length,
    autoExecutedCount,
    failedCount,
    failedSources,
  };
}

export function startRadarScannerWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  notificationService?: NotificationService;
  logger?: LoggerLike;
}): RadarScannerWorkerHandle {
  const enabled = input.env.RADAR_SCANNER_WORKER_ENABLED && input.env.NODE_ENV !== 'test';
  runtimeState.enabled = enabled;
  runtimeState.inflight = false;
  runtimeState.lastRun = null;
  runtimeState.history = [];

  if (!enabled) {
    return {
      stop: () => undefined,
      status: getRadarScannerWorkerStatus,
    };
  }

  const logger = input.logger;
  const pollMs = Math.max(1000, input.env.RADAR_SCANNER_WORKER_POLL_MS);
  const sourceBatch = Math.max(1, input.env.RADAR_SCANNER_WORKER_BATCH);
  const fetchTimeoutMs = Math.max(1000, input.env.RADAR_SCANNER_FETCH_TIMEOUT_MS);
  const timeoutMs = Math.max(fetchTimeoutMs * Math.max(1, sourceBatch), pollMs);

  const supervisor = startWorkerSupervisor<RadarScannerWorkerRun>({
    enabled,
    pollMs,
    timeoutMs,
    historyLimit: 20,
    runOnce: async (startedAt) => {
      const result = await runRadarScannerPass({
        store: input.store,
        notificationService: input.notificationService,
        fetchTimeoutMs,
        sourceBatch,
        userId: input.env.DEFAULT_USER_ID,
        nowIso: startedAt.toISOString(),
      });
      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'ok',
        scannedSources: result.scannedSources,
        dueSources: result.dueSources,
        fetchedCount: result.fetchedCount,
        ingestedCount: result.ingestedCount,
        evaluatedCount: result.evaluatedCount,
        promotedCount: result.promotedCount,
        autoExecutedCount: result.autoExecutedCount,
        failedCount: result.failedCount,
        failedSources: result.failedSources,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
    },
    onRunError: ({ startedAt, finishedAt, status, error }) => ({
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      scannedSources: 0,
      dueSources: 0,
      fetchedCount: 0,
      ingestedCount: 0,
      evaluatedCount: 0,
      promotedCount: 0,
      autoExecutedCount: 0,
      failedCount: 0,
      failedSources: [],
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error),
    }),
    onAfterRun: (run) => {
      pushRun(run);
      logSpanEvent({
        logger,
        spanName: 'worker.radar_scanner',
        stage: run.status === 'ok' ? 'complete' : 'error',
        status: run.status === 'ok' ? 'ok' : run.status,
        durationMs: run.durationMs,
        attrs: {
          scanned_sources: run.scannedSources,
          due_sources: run.dueSources,
          fetched_count: run.fetchedCount,
          ingested_count: run.ingestedCount,
          evaluated_count: run.evaluatedCount,
          promoted_count: run.promotedCount,
          auto_executed_count: run.autoExecutedCount,
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
    status: getRadarScannerWorkerStatus,
  };
}
