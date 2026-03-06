import type { NotificationService } from '../notifications/proactive';
import type { BriefingRecord, DossierRecord, JarvisStore, WatcherRecord, WatcherRunRecord } from '../store/types';

import { generateResearchArtifact } from './research';

export type WatcherExecutionResult = {
  run: WatcherRunRecord | null;
  briefing: BriefingRecord;
  dossier: DossierRecord;
};

export function resolveWatcherPollMinutes(watcher: WatcherRecord): number {
  const raw = watcher.configJson?.poll_minutes;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(value) || value <= 0) {
    return 60;
  }
  return Math.max(5, Math.min(24 * 60, Math.trunc(value)));
}

export function shouldRunWatcherNow(watcher: WatcherRecord, now: Date): boolean {
  if (watcher.status !== 'active') return false;
  if (!watcher.lastRunAt) return true;
  const lastRunMs = Date.parse(watcher.lastRunAt);
  if (!Number.isFinite(lastRunMs)) return true;
  const nextRunMs = lastRunMs + resolveWatcherPollMinutes(watcher) * 60_000;
  return now.getTime() >= nextRunMs;
}

export async function executeWatcherRun(input: {
  store: JarvisStore;
  watcher: WatcherRecord;
  run: WatcherRunRecord;
  notificationService?: NotificationService;
}): Promise<WatcherExecutionResult> {
  const { store, watcher, run, notificationService } = input;
  const nowIso = new Date().toISOString();

  try {
    const artifact = await generateResearchArtifact(watcher.query, {
      strictness:
        watcher.kind === 'external_topic' ||
        watcher.kind === 'company' ||
        watcher.kind === 'market' ||
        watcher.kind === 'war_region'
          ? 'news'
          : 'default'
    });
    const briefing = await store.createBriefing({
      userId: watcher.userId,
      watcherId: watcher.id,
      type: 'on_change',
      status: 'completed',
      title: artifact.title,
      query: watcher.query,
      summary: artifact.summary,
      answerMarkdown: artifact.answerMarkdown,
      sourceCount: artifact.sources.length,
      qualityJson: artifact.quality
    });
    const dossier = await store.createDossier({
      userId: watcher.userId,
      briefingId: briefing.id,
      title: artifact.title,
      query: watcher.query,
      status: 'ready',
      summary: artifact.summary,
      answerMarkdown: artifact.answerMarkdown,
      qualityJson: artifact.quality,
      conflictsJson: artifact.conflicts
    });
    await store.replaceDossierSources({ userId: watcher.userId, dossierId: dossier.id, sources: artifact.sources });
    await store.replaceDossierClaims({ userId: watcher.userId, dossierId: dossier.id, claims: artifact.claims });
    const updatedRun = await store.updateWatcherRun({
      runId: run.id,
      userId: watcher.userId,
      status: 'completed',
      summary: artifact.summary,
      briefingId: briefing.id,
      dossierId: dossier.id,
      error: null
    });
    await store.updateWatcher({
      watcherId: watcher.id,
      userId: watcher.userId,
      status: 'active',
      lastRunAt: nowIso,
      lastHitAt: nowIso
    });
    const qualityWarning = artifact.quality.quality_gate_passed === false || Number(artifact.conflicts.count ?? 0) > 0;
    notificationService?.emitWatcherHit(watcher.id, watcher.title, artifact.summary, dossier.id, {
      severity: qualityWarning ? 'warning' : 'info'
    });
    notificationService?.emitBriefingReady(briefing.id, artifact.title, artifact.sources.length, dossier.id, {
      severity: qualityWarning ? 'warning' : 'info',
      message:
        artifact.quality.quality_gate_passed === false
          ? `${artifact.sources.length} source(s) compiled with quality warnings.`
          : undefined
    });
    return {
      run: updatedRun,
      briefing,
      dossier
    };
  } catch (error) {
    await store.updateWatcherRun({
      runId: run.id,
      userId: watcher.userId,
      status: 'failed',
      summary: 'Watcher run failed',
      error: error instanceof Error ? error.message : 'failed'
    });
    await store.updateWatcher({
      watcherId: watcher.id,
      userId: watcher.userId,
      status: 'error',
      lastRunAt: nowIso
    });
    throw error;
  }
}
