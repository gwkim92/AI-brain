"use client";

import React from "react";
import type { TaskViewSchema } from "@/lib/api/types";

type TaskWidget = TaskViewSchema["widgets"][number];

function StatusCardWidget({ widget }: { widget: TaskWidget }) {
  return (
    <div className="rounded-lg border border-cyan-300/35 bg-slate-900/70 p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200/80">{widget.title}</div>
      <div className="mt-2 text-xs text-slate-100">status: {String(widget.props.status ?? "unknown")}</div>
      <div className="text-xs text-slate-300">mode: {String(widget.props.mode ?? "unknown")}</div>
    </div>
  );
}

function RiskPolicyWidget({ widget }: { widget: TaskWidget }) {
  return (
    <div className="rounded-lg border border-amber-300/35 bg-slate-900/70 p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-amber-200/85">{widget.title}</div>
      <div className="mt-2 text-xs text-slate-100">risk: {String(widget.props.risk_level ?? "unknown")}</div>
      <div className="text-xs text-slate-300">policy: {String(widget.props.policy_decision ?? "allow")}</div>
    </div>
  );
}

function TimelineWidget({ widget }: { widget: TaskWidget }) {
  return (
    <div className="rounded-lg border border-slate-300/30 bg-slate-950/70 p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-200/80">{widget.title}</div>
      <div className="mt-2 text-xs text-slate-300">event source: {String(widget.props.source ?? "n/a")}</div>
    </div>
  );
}

function UnknownWidget({ widget }: { widget: TaskWidget }) {
  return (
    <div className="rounded-lg border border-white/20 bg-black/50 p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-white/70">{widget.title}</div>
      <pre className="mt-2 overflow-auto text-[11px] text-white/60">{JSON.stringify(widget.props, null, 2)}</pre>
    </div>
  );
}

const WIDGET_REGISTRY: Record<string, React.ComponentType<{ widget: TaskWidget }>> = {
  status_card: StatusCardWidget,
  risk_policy: RiskPolicyWidget,
  timeline: TimelineWidget,
};

export function renderRuntimeWidget(widget: TaskWidget): React.ReactNode {
  const Component = WIDGET_REGISTRY[widget.type] ?? UnknownWidget;
  return <Component key={widget.id} widget={widget} />;
}
