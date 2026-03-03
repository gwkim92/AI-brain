import type { TaskRecord } from "@/lib/api/types";
import type { Jarvis3DBaseMode, Jarvis3DScene } from "@/lib/visual-core/types";
import { getBaseModePriority } from "@/lib/visual-core/stability";

export type VisualCoreSignals = {
  activeWidgets: string[];
  focusedWidget: string | null;
  tasks: TaskRecord[];
  pendingApprovalCount: number;
  hasRecentEventPulse: boolean;
};

export function resolveJarvis3DScene(signals: VisualCoreSignals): Jarvis3DScene {
  let baseMode: Jarvis3DBaseMode = "default";
  let reason = "fallback_default";

  const tasks = Array.isArray(signals.tasks) ? signals.tasks : [];
  const activeWidgets = Array.isArray(signals.activeWidgets) ? signals.activeWidgets : [];
  const pendingApprovalCountRaw = Number(signals.pendingApprovalCount);
  const pendingApprovalCount = Number.isFinite(pendingApprovalCountRaw)
    ? Math.max(0, Math.trunc(pendingApprovalCountRaw))
    : 0;

  const runningCount = tasks.filter((task) => task?.status === "running" || task?.status === "retrying").length;
  const blockedCount = tasks.filter((task) => task?.status === "blocked").length;
  const failedCount = tasks.filter((task) => task?.status === "failed" || task?.status === "cancelled").length;

  const latestTask = [...tasks]
    .filter((task) => typeof task?.updatedAt === "string")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  if (failedCount > 0 || (pendingApprovalCount > 0 && blockedCount > 0)) {
    baseMode = "risk";
    reason = "failure_or_blocked_with_approvals";
  } else if (signals.focusedWidget === "council") {
    baseMode = "multi_attractor";
    reason = "focused_widget_council";
  } else if (signals.focusedWidget === "workbench") {
    if (latestTask?.mode === "compute") {
      baseMode = "cinematic_dof";
      reason = "focused_widget_workbench_compute";
    } else {
      baseMode = "sdf_crystal";
      reason = "focused_widget_workbench_code";
    }
  } else if (signals.focusedWidget === "memory") {
    baseMode = "sdf_brain";
    reason = "focused_widget_memory";
  } else if (signals.focusedWidget === "settings") {
    baseMode = "sdf_eye";
    reason = "focused_widget_settings";
  } else if (signals.focusedWidget === "reports" || latestTask?.mode === "radar_review") {
    baseMode = "sdf_infinity";
    reason = "reports_or_radar_review";
  } else if (pendingApprovalCount > 0 || signals.focusedWidget === "approvals") {
    baseMode = "risk";
    reason = "pending_approvals";
  } else if (runningCount > 0 || activeWidgets.includes("assistant")) {
    baseMode = "stream";
    reason = "running_tasks_or_assistant_open";
  } else if (latestTask?.mode === "council") {
    baseMode = "multi_attractor";
    reason = "latest_task_council";
  } else if (latestTask?.mode === "code") {
    baseMode = "sdf_crystal";
    reason = "latest_task_code";
  } else if (latestTask?.mode === "compute") {
    baseMode = "cinematic_dof";
    reason = "latest_task_compute";
  } else if (latestTask?.mode === "high_risk") {
    baseMode = "risk";
    reason = "latest_task_high_risk";
  }

  return {
    baseMode,
    overlayFx: signals.hasRecentEventPulse ? ["event_ripple"] : [],
    reason,
    priority: getBaseModePriority(baseMode),
    signals: {
      runningCount,
      blockedCount,
      failedCount,
      pendingApprovalCount,
      focusedWidget: signals.focusedWidget,
    },
  };
}

export function resolveJarvis3DMode(signals: VisualCoreSignals): Jarvis3DBaseMode {
  return resolveJarvis3DScene(signals).baseMode;
}
