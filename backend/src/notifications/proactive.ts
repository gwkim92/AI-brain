import type { JarvisStore } from '../store/types';

import type { NotificationChannel } from './channels';

export type NotificationEventType =
  | 'mission_step_completed'
  | 'radar_new_item'
  | 'eval_gate_degradation'
  | 'idle_reminder'
  | 'approval_required'
  | 'watcher_hit'
  | 'briefing_ready'
  | 'action_proposal_ready'
  | 'session_stalled';

export type SystemNotification = {
  id: string;
  type: NotificationEventType;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  actionUrl?: string;
  entityType?: string;
  entityId?: string;
  createdAt: string;
};

export type NotificationListener = (notification: SystemNotification) => void;

type EmitOptions = {
  dedupeKey?: string;
  dedupeWindowMs?: number;
};

type NotificationSeverity = SystemNotification['severity'];

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

type NotificationChannelRuntime = {
  name: string;
  sent: number;
  skipped: number;
  failed: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};

export type NotificationRuntimeStatus = {
  listeners: number;
  emitted: number;
  suppressed: number;
  lastEventAt: string | null;
  dedupeWindowMs: number;
  channels: NotificationChannelRuntime[];
};

const DEFAULT_DEDUPE_WINDOW_MS = 1_200;
const WATCHER_HIT_DEDUPE_WINDOW_MS = 60_000;

export function createNotificationService(input?: {
  channels?: NotificationChannel[];
  logger?: LoggerLike;
}) {
  const channels = input?.channels ?? [];
  const logger = input?.logger;
  const listeners = new Set<NotificationListener>();
  const dedupeCache = new Map<string, number>();
  const channelRuntime = new Map<string, NotificationChannelRuntime>();
  for (const channel of channels) {
    channelRuntime.set(channel.name, {
      name: channel.name,
      sent: 0,
      skipped: 0,
      failed: 0,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null
    });
  }
  const runtime = {
    emitted: 0,
    suppressed: 0,
    lastEventAtMs: null as number | null
  };

  function subscribe(listener: NotificationListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function buildDedupeKey(notification: SystemNotification): string {
    return [
      notification.type,
      notification.severity,
      notification.entityType ?? '-',
      notification.entityId ?? '-',
      notification.title,
      notification.message
    ].join('|');
  }

  function cleanupDedupeCache(nowMs: number, windowMs: number): void {
    const keepAfter = nowMs - Math.max(windowMs * 5, 5_000);
    for (const [key, emittedAt] of dedupeCache.entries()) {
      if (emittedAt < keepAfter) {
        dedupeCache.delete(key);
      }
    }
  }

  function emit(notification: SystemNotification, options?: EmitOptions): void {
    const nowMs = Date.now();
    const dedupeWindowMs = Math.max(0, options?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS);
    const dedupeKey = options?.dedupeKey ?? buildDedupeKey(notification);
    const lastEmittedAt = dedupeCache.get(dedupeKey);
    if (typeof lastEmittedAt === 'number' && nowMs - lastEmittedAt <= dedupeWindowMs) {
      runtime.suppressed += 1;
      return;
    }

    dedupeCache.set(dedupeKey, nowMs);
    cleanupDedupeCache(nowMs, dedupeWindowMs);
    runtime.emitted += 1;
    runtime.lastEventAtMs = nowMs;
    for (const listener of listeners) {
      try {
        listener(notification);
      } catch {
        // don't let listener errors crash the notification bus
      }
    }

    if (channels.length > 0) {
      void Promise.all(
        channels.map(async (channel) => {
          const startedAt = Date.now();
          const state = channelRuntime.get(channel.name);
          if (channel.shouldSend && !channel.shouldSend(notification)) {
            if (state) {
              state.skipped += 1;
            }
            return;
          }
          try {
            await channel.send(notification);
            if (state) {
              state.sent += 1;
              state.lastSuccessAt = new Date().toISOString();
              state.lastError = null;
            }
            logger?.info(
              {
                channel: channel.name,
                notification_type: notification.type,
                notification_id: notification.id,
                duration_ms: Date.now() - startedAt
              },
              'notification channel delivery succeeded'
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (state) {
              state.failed += 1;
              state.lastErrorAt = new Date().toISOString();
              state.lastError = message;
            }
            logger?.warn(
              {
                channel: channel.name,
                notification_type: notification.type,
                notification_id: notification.id,
                error: message,
                duration_ms: Date.now() - startedAt
              },
              'notification channel delivery failed'
            );
          }
        })
      );
    }
  }

  function emitMissionStepCompleted(missionId: string, stepTitle: string): void {
    emit({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'mission_step_completed',
      title: 'Step Completed',
      message: `Mission step "${stepTitle}" has completed. Ready for the next step?`,
      severity: 'info',
      entityType: 'mission',
      entityId: missionId,
      createdAt: new Date().toISOString()
    }, { dedupeKey: `mission_step_completed:${missionId}:${stepTitle}` });
  }

  function emitApprovalRequired(approvalId: string, action: string): void {
    emit({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'approval_required',
      title: 'Approval Required',
      message: `Action "${action}" requires your approval.`,
      severity: 'warning',
      entityType: 'approval',
      entityId: approvalId,
      createdAt: new Date().toISOString()
    }, { dedupeKey: `approval_required:${approvalId}:${action}` });
  }

  function emitEvalGateDegradation(provider: string): void {
    emit({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'eval_gate_degradation',
      title: 'Quality Degradation',
      message: `Provider "${provider}" is showing quality degradation in recent responses.`,
      severity: 'warning',
      entityType: 'provider',
      entityId: provider,
      createdAt: new Date().toISOString()
    }, { dedupeKey: `eval_gate_degradation:${provider}`, dedupeWindowMs: 5_000 });
  }

  function emitRadarNewItem(itemCount: number): void {
    emit({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'radar_new_item',
      title: 'New Radar Items',
      message: `${itemCount} new technology update(s) detected.`,
      severity: 'info',
      createdAt: new Date().toISOString()
    }, { dedupeKey: `radar_new_item:${itemCount}` });
  }

  function emitWatcherHit(
    watcherId: string,
    title: string,
    summary: string,
    dossierId?: string | null,
    options?: { severity?: NotificationSeverity }
  ): void {
    emit({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'watcher_hit',
      title: `Watcher Hit: ${title}`,
      message: summary,
      severity: options?.severity ?? 'info',
      entityType: 'watcher',
      entityId: watcherId,
      actionUrl: dossierId ? `/?widget=dossier&focus=dossier&dossier=${dossierId}` : '/?widget=watchers&focus=watchers',
      createdAt: new Date().toISOString()
    }, { dedupeKey: `watcher_hit:${watcherId}:${summary}`, dedupeWindowMs: WATCHER_HIT_DEDUPE_WINDOW_MS });
  }

  function emitBriefingReady(
    briefingId: string,
    title: string,
    sourceCount: number,
    dossierId?: string | null,
    options?: { severity?: NotificationSeverity; message?: string }
  ): void {
    emit({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'briefing_ready',
      title: `Briefing Ready: ${title}`,
      message: options?.message ?? `${sourceCount} source(s) compiled into a fresh briefing.`,
      severity: options?.severity ?? 'info',
      entityType: 'briefing',
      entityId: briefingId,
      actionUrl: dossierId ? `/?widget=dossier&focus=dossier&dossier=${dossierId}` : '/?widget=reports&focus=reports',
      createdAt: new Date().toISOString()
    }, { dedupeKey: `briefing_ready:${briefingId}` });
  }

  function emitActionProposalReady(
    sessionId: string,
    proposalId: string,
    title: string,
    options?: { severity?: NotificationSeverity; message?: string }
  ): void {
    emit({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'action_proposal_ready',
      title: 'Action Proposal Ready',
      message: options?.message ?? title,
      severity: options?.severity ?? 'warning',
      entityType: 'action_proposal',
      entityId: proposalId,
      actionUrl: `/?widget=action_center&focus=action_center&session=${sessionId}`,
      createdAt: new Date().toISOString()
    }, { dedupeKey: `action_proposal_ready:${proposalId}` });
  }

  function emitSessionStalled(sessionId: string, title: string): void {
    emit({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'session_stalled',
      title: 'Session Stalled',
      message: `${title} is still waiting for progress.`,
      severity: 'warning',
      entityType: 'jarvis_session',
      entityId: sessionId,
      actionUrl: `/?widget=assistant&focus=assistant&session=${sessionId}`,
      createdAt: new Date().toISOString()
    }, { dedupeKey: `session_stalled:${sessionId}`, dedupeWindowMs: 60_000 });
  }

  async function checkIdleReminder(store: JarvisStore, userId: string): Promise<void> {
    const missions = await store.listMissions({ userId, status: 'running', limit: 5 });
    if (missions.length > 0) {
      emit({
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'idle_reminder',
        title: 'Active Missions',
        message: `You have ${missions.length} mission(s) currently in progress.`,
        severity: 'info',
        createdAt: new Date().toISOString()
      }, { dedupeKey: `idle_reminder:${userId}:${missions.length}`, dedupeWindowMs: 30_000 });
    }
  }

  function getRuntimeStatus(): NotificationRuntimeStatus {
    return {
      listeners: listeners.size,
      emitted: runtime.emitted,
      suppressed: runtime.suppressed,
      lastEventAt: runtime.lastEventAtMs ? new Date(runtime.lastEventAtMs).toISOString() : null,
      dedupeWindowMs: DEFAULT_DEDUPE_WINDOW_MS,
      channels: Array.from(channelRuntime.values()).map((row) => ({ ...row }))
    };
  }

  return {
    subscribe,
    emit,
    emitMissionStepCompleted,
    emitApprovalRequired,
    emitEvalGateDegradation,
    emitRadarNewItem,
    emitWatcherHit,
    emitBriefingReady,
    emitActionProposalReady,
    emitSessionStalled,
    checkIdleReminder,
    getRuntimeStatus
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
