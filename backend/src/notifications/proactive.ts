import type { JarvisStore } from '../store/types';

export type NotificationEventType =
  | 'mission_step_completed'
  | 'radar_new_item'
  | 'eval_gate_degradation'
  | 'idle_reminder'
  | 'approval_required';

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

export type NotificationRuntimeStatus = {
  listeners: number;
  emitted: number;
  suppressed: number;
  lastEventAt: string | null;
  dedupeWindowMs: number;
};

const DEFAULT_DEDUPE_WINDOW_MS = 1_200;

export function createNotificationService() {
  const listeners = new Set<NotificationListener>();
  const dedupeCache = new Map<string, number>();
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
      dedupeWindowMs: DEFAULT_DEDUPE_WINDOW_MS
    };
  }

  return {
    subscribe,
    emit,
    emitMissionStepCompleted,
    emitApprovalRequired,
    emitEvalGateDegradation,
    emitRadarNewItem,
    checkIdleReminder,
    getRuntimeStatus
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
