import type { MissionRecord, MissionStepRecord, MissionStepType } from "@/lib/api/types";
import type { HudWidgetId } from "@/lib/hud/intent-router";

type MissionFocusResult = {
  widget: HudWidgetId;
  stepId: string;
  stepLabel: string;
  stepStatus: MissionStepRecord["status"];
  reason: string;
};

const STEP_TYPE_WIDGET_MAP: Record<MissionStepType, HudWidgetId> = {
  code: "workbench",
  research: "council",
  finance: "reports",
  news: "assistant",
  approval: "approvals",
  execute: "tasks",
  llm_generate: "tasks",
  council_debate: "council",
  human_gate: "approvals",
  tool_call: "workbench",
  sub_mission: "tasks",
};

function toWidgetFromRoute(route: string | undefined): HudWidgetId | null {
  if (!route) return null;
  const normalized = route.trim().toLowerCase();

  if (normalized.startsWith("/studio/code")) return "workbench";
  if (normalized.startsWith("/studio/research")) return "council";
  if (normalized.startsWith("/studio/finance")) return "reports";
  if (normalized.startsWith("/studio/news")) return "assistant";
  if (normalized.startsWith("/approvals")) return "approvals";
  if (normalized.startsWith("/reports")) return "reports";
  if (normalized.startsWith("/settings")) return "settings";
  if (normalized.startsWith("/memory")) return "memory";
  if (normalized.startsWith("/tasks")) return "tasks";
  if (normalized.startsWith("/mission")) return "tasks";
  return null;
}

function stepLabel(step: MissionStepRecord): string {
  return `${step.order}. ${step.title}`;
}

function selectStepByParam(steps: MissionStepRecord[], stepParam: string | null): MissionStepRecord | null {
  if (!stepParam) return null;

  const byId = steps.find((step) => step.id === stepParam);
  if (byId) return byId;

  const byType = steps.find((step) => step.type === stepParam);
  if (byType) return byType;

  const parsedOrder = Number.parseInt(stepParam, 10);
  if (Number.isFinite(parsedOrder)) {
    const byOrder = steps.find((step) => step.order === parsedOrder);
    if (byOrder) return byOrder;
  }

  return null;
}

function selectDefaultStep(steps: MissionStepRecord[]): MissionStepRecord | null {
  if (steps.length === 0) return null;

  const sorted = [...steps].sort((left, right) => left.order - right.order);
  const running = sorted.find((step) => step.status === "running");
  if (running) return running;

  const pending = sorted.find((step) => step.status === "pending");
  if (pending) return pending;

  const blocked = sorted.find((step) => step.status === "blocked");
  if (blocked) return blocked;

  return sorted[0] ?? null;
}

export function resolveMissionFocus(mission: MissionRecord | null, stepParam: string | null): MissionFocusResult | null {
  if (!mission) return null;

  const steps = mission.steps ?? [];
  const selectedStep = selectStepByParam(steps, stepParam) ?? selectDefaultStep(steps);
  if (!selectedStep) return null;

  const widgetFromRoute = toWidgetFromRoute(selectedStep.route);
  const widget = widgetFromRoute ?? STEP_TYPE_WIDGET_MAP[selectedStep.type];

  return {
    widget,
    stepId: selectedStep.id,
    stepLabel: stepLabel(selectedStep),
    stepStatus: selectedStep.status,
    reason: `mission_step:${selectedStep.type}`,
  };
}
