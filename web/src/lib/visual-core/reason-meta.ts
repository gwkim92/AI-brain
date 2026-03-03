export type VisualCoreReasonSeverity = "info" | "warn" | "critical";

export type VisualCoreReasonMeta = {
  label: string;
  operatorHint: string;
  severity: VisualCoreReasonSeverity;
};

const VISUAL_CORE_REASON_META: Record<string, VisualCoreReasonMeta> = {
  fallback_default: {
    label: "Baseline monitor",
    operatorHint: "No urgent signal. Keep normal monitoring.",
    severity: "info",
  },
  failure_or_blocked_with_approvals: {
    label: "Escalated risk gate",
    operatorHint: "Investigate failures and clear blocked approvals first.",
    severity: "critical",
  },
  focused_widget_council: {
    label: "Council-focused reasoning",
    operatorHint: "Multi-agent analysis is currently prioritized.",
    severity: "info",
  },
  focused_widget_workbench_compute: {
    label: "Compute workbench focus",
    operatorHint: "Compute-heavy workflow is active in workbench.",
    severity: "warn",
  },
  focused_widget_workbench_code: {
    label: "Code workbench focus",
    operatorHint: "Code workflow is active in workbench.",
    severity: "info",
  },
  focused_widget_memory: {
    label: "Memory analysis focus",
    operatorHint: "Knowledge/memory context is currently emphasized.",
    severity: "info",
  },
  focused_widget_settings: {
    label: "Settings focus",
    operatorHint: "Configuration workspace is currently active.",
    severity: "info",
  },
  reports_or_radar_review: {
    label: "Reports or radar review",
    operatorHint: "Evaluation/reporting workflow is active.",
    severity: "info",
  },
  pending_approvals: {
    label: "Human approval pending",
    operatorHint: "Open approvals and decide to unblock next actions.",
    severity: "warn",
  },
  running_tasks_or_assistant_open: {
    label: "Execution stream active",
    operatorHint: "Tasks are actively running or assistant is engaged.",
    severity: "info",
  },
  latest_task_council: {
    label: "Latest task: council",
    operatorHint: "Recent task context is council-oriented.",
    severity: "info",
  },
  latest_task_code: {
    label: "Latest task: code",
    operatorHint: "Recent task context is code-oriented.",
    severity: "info",
  },
  latest_task_compute: {
    label: "Latest task: compute",
    operatorHint: "Recent task context is compute-oriented.",
    severity: "warn",
  },
  latest_task_high_risk: {
    label: "Latest task: high risk",
    operatorHint: "Treat follow-up actions as high-risk operations.",
    severity: "critical",
  },
};

export function getVisualCoreReasonMeta(reason: string | null | undefined): VisualCoreReasonMeta | null {
  if (!reason) {
    return null;
  }

  const known = VISUAL_CORE_REASON_META[reason];
  if (known) {
    return known;
  }

  return {
    label: "Uncataloged reason",
    operatorHint: "Add this reason to the visual-core reason catalog.",
    severity: "warn",
  };
}
