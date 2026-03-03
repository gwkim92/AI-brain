import { buildWidgetPlan, inferHudIntent, resolveTaskModeForIntent, type HudIntent, type HudTaskMode, type HudWidgetId } from "@/lib/hud/intent-router";
import type { MissionApprovalPolicyInput, MissionContractConstraintsInput } from "@/lib/api/types";

export type MissionIntakeSource = "inbox_quick_command";

export type MissionIntakePayload = {
  id: string;
  prompt: string;
  source: MissionIntakeSource;
  intent: HudIntent;
  taskMode: HudTaskMode;
  widgetPlan: HudWidgetId[];
  prestarted?: boolean;
  requestNonce?: string;
  prestartedContextId?: string;
  missionContract?: {
    constraints?: MissionContractConstraintsInput;
    approval_policy?: MissionApprovalPolicyInput;
  };
  createdAt: string;
};

export type MissionIntakeTaskLinkPayload = {
  id: string;
  taskId: string;
};

const MISSION_INTAKE_EVENT = "jarvis:mission-intake";
const MISSION_INTAKE_TASK_LINK_EVENT = "jarvis:mission-intake-task-link";

function createIntakeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `intake_${Date.now()}`;
}

export function buildMissionIntake(
  prompt: string,
  source: MissionIntakeSource = "inbox_quick_command",
  options?: {
    requestNonce?: string;
    prestartedContextId?: string;
  }
): MissionIntakePayload {
  const intent = inferHudIntent(prompt);
  return {
    id: createIntakeId(),
    prompt,
    source,
    intent,
    taskMode: resolveTaskModeForIntent(intent),
    widgetPlan: buildWidgetPlan(intent, prompt),
    requestNonce: options?.requestNonce,
    prestartedContextId: options?.prestartedContextId,
    createdAt: new Date().toISOString(),
  };
}

export function dispatchMissionIntake(payload: MissionIntakePayload): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<MissionIntakePayload>(MISSION_INTAKE_EVENT, { detail: payload }));
}

export function subscribeMissionIntake(callback: (payload: MissionIntakePayload) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<MissionIntakePayload>;
    if (!customEvent.detail) {
      return;
    }
    callback(customEvent.detail);
  };

  window.addEventListener(MISSION_INTAKE_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(MISSION_INTAKE_EVENT, handler as EventListener);
  };
}

export function dispatchMissionIntakeTaskLink(payload: MissionIntakeTaskLinkPayload): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<MissionIntakeTaskLinkPayload>(MISSION_INTAKE_TASK_LINK_EVENT, { detail: payload }));
}

export function subscribeMissionIntakeTaskLink(callback: (payload: MissionIntakeTaskLinkPayload) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<MissionIntakeTaskLinkPayload>;
    if (!customEvent.detail) {
      return;
    }
    callback(customEvent.detail);
  };

  window.addEventListener(MISSION_INTAKE_TASK_LINK_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(MISSION_INTAKE_TASK_LINK_EVENT, handler as EventListener);
  };
}
