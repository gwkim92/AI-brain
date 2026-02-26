import type { JarvisStore } from '../store/types';

export type SystemNotification = {
  id: string;
  type: 'mission_step_completed' | 'radar_new_item' | 'eval_gate_degradation' | 'idle_reminder' | 'approval_required';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  actionUrl?: string;
  entityType?: string;
  entityId?: string;
  createdAt: string;
};

export type NotificationListener = (notification: SystemNotification) => void;

export function createNotificationService() {
  const listeners = new Set<NotificationListener>();

  function subscribe(listener: NotificationListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emit(notification: SystemNotification): void {
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
    });
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
    });
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
    });
  }

  function emitRadarNewItem(itemCount: number): void {
    emit({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'radar_new_item',
      title: 'New Radar Items',
      message: `${itemCount} new technology update(s) detected.`,
      severity: 'info',
      createdAt: new Date().toISOString()
    });
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
      });
    }
  }

  return {
    subscribe,
    emit,
    emitMissionStepCompleted,
    emitApprovalRequired,
    emitEvalGateDegradation,
    emitRadarNewItem,
    checkIdleReminder
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
