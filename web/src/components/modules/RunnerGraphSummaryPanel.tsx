"use client";

import Link from "next/link";
import { GitBranch, Workflow } from "lucide-react";

import { useLocale } from "@/components/providers/LocaleProvider";
import type { RunnerRunDetail } from "@/lib/api/runner-types";

type RunnerGraphSummaryPanelProps = {
  detail: RunnerRunDetail | null;
  emptyMessage?: string;
  maxNodes?: number;
  className?: string;
};

function getRunnerStatusTone(status: RunnerRunDetail["run"]["status"]): string {
  if (status === "human_review_ready") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "failed_terminal" || status === "cancelled") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  }
  if (status === "blocked_needs_approval") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  if (status === "retry_queued") {
    return "border-orange-500/30 bg-orange-500/10 text-orange-200";
  }
  return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
}

function getRunnerNodeTone(status: RunnerRunDetail["compat_steps"][number]["status"]): string {
  if (status === "completed") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-100";
  if (status === "running") return "border-cyan-500/25 bg-cyan-500/10 text-cyan-100";
  if (status === "blocked") return "border-amber-500/25 bg-amber-500/10 text-amber-100";
  if (status === "failed") return "border-rose-500/25 bg-rose-500/10 text-rose-100";
  if (status === "skipped") return "border-white/10 bg-white/[0.03] text-white/60";
  return "border-white/10 bg-black/30 text-white/70";
}

function resolveCurrentNode(detail: RunnerRunDetail) {
  return (
    detail.compat_steps.find((step) => step.id === detail.run.currentNodeId) ??
    detail.compat_steps.find((step) => step.status === "running" || step.status === "blocked") ??
    null
  );
}

function resolveHaltedReason(detail: RunnerRunDetail): string | null {
  return (
    detail.run.blockedReason ||
    detail.run.failureReason ||
    detail.node_runs.find((nodeRun) => nodeRun.status === "blocked" || nodeRun.status === "failed")?.error ||
    null
  );
}

export function RunnerGraphSummaryPanel({
  detail,
  emptyMessage,
  maxNodes = 4,
  className,
}: RunnerGraphSummaryPanelProps) {
  const { t, formatDateTime } = useLocale();

  if (!detail) {
    return (
      <div className={className ?? "rounded border border-cyan-500/20 bg-cyan-500/5 p-3"}>
        <div className="flex items-center gap-2">
          <Workflow size={14} className="text-cyan-300" />
          <h4 className="text-[10px] font-mono uppercase tracking-[0.24em] text-cyan-200">
            {t("actionCenter.runner.title")}
          </h4>
        </div>
        <p className="mt-3 text-xs text-white/60">{emptyMessage ?? t("actionCenter.runner.empty")}</p>
      </div>
    );
  }

  const currentNode = resolveCurrentNode(detail);
  const haltedReason = resolveHaltedReason(detail);

  return (
    <div className={className ?? "rounded border border-cyan-500/20 bg-cyan-500/5 p-3"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Workflow size={14} className="text-cyan-300" />
          <h4 className="text-[10px] font-mono uppercase tracking-[0.24em] text-cyan-200">
            {t("actionCenter.runner.title")}
          </h4>
        </div>
        <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${getRunnerStatusTone(detail.run.status)}`}>
          {detail.run.status.replaceAll("_", " ")}
        </span>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded border border-white/10 bg-black/30 p-2">
          <p className="text-[10px] font-mono text-white/45">{t("actionCenter.runner.graphStatus")}</p>
          <p className="mt-1 text-xs text-white/90">{detail.run.graphRun?.status ?? "-"}</p>
        </div>
        <div className="rounded border border-white/10 bg-black/30 p-2">
          <p className="text-[10px] font-mono text-white/45">{t("actionCenter.runner.currentNode")}</p>
          <p className="mt-1 text-xs text-white/90">{currentNode?.title ?? "-"}</p>
        </div>
        <div className="rounded border border-white/10 bg-black/30 p-2">
          <p className="text-[10px] font-mono text-white/45">{t("actionCenter.runner.haltedReason")}</p>
          <p className="mt-1 text-xs text-white/90">{haltedReason ?? "-"}</p>
        </div>
        <div className="rounded border border-white/10 bg-black/30 p-2">
          <p className="text-[10px] font-mono text-white/45">{t("actionCenter.runner.artifacts")}</p>
          <p className="mt-1 text-xs text-white/90">{detail.artifacts.length}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded border border-white/10 bg-black/30 p-2">
          <p className="text-[10px] font-mono text-white/45">{t("actionCenter.runner.branch")}</p>
          <p className="mt-1 break-all text-xs text-white/90">{detail.run.branchName ?? "-"}</p>
        </div>
        <div className="rounded border border-white/10 bg-black/30 p-2">
          <p className="text-[10px] font-mono text-white/45">{t("actionCenter.runner.pr")}</p>
          {detail.run.prUrl ? (
            <Link
              href={detail.run.prUrl}
              target="_blank"
              className="mt-1 inline-flex items-center gap-1 text-xs text-cyan-200 underline decoration-cyan-500/40 underline-offset-4"
            >
              <GitBranch size={12} />
              #{detail.run.prNumber ?? "-"}
            </Link>
          ) : (
            <p className="mt-1 text-xs text-white/60">-</p>
          )}
        </div>
      </div>

      {detail.linked_external_work ? (
        <div className="mt-3 rounded border border-white/10 bg-black/30 p-2">
          <p className="text-[10px] font-mono text-white/45">{t("inbox.externalWork")}</p>
          {detail.linked_external_work.url ? (
            <Link
              href={detail.linked_external_work.url}
              target="_blank"
              className="mt-1 inline-flex items-center gap-1 text-xs text-cyan-200 underline decoration-cyan-500/40 underline-offset-4"
            >
              {detail.linked_external_work.identifier}
            </Link>
          ) : (
            <p className="mt-1 text-xs text-white/90">{detail.linked_external_work.identifier}</p>
          )}
          <p className="mt-1 text-xs text-white/60">{detail.linked_external_work.title}</p>
        </div>
      ) : null}

      <div className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-white/45">
            {t("actionCenter.runner.nodes")}
          </p>
          <span className="text-[10px] font-mono text-white/35">
            {formatDateTime(detail.run.updatedAt, {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="mt-2 space-y-2">
          {detail.compat_steps.length === 0 ? (
            <p className="text-xs text-white/60">{t("actionCenter.runner.noNodes")}</p>
          ) : (
            detail.compat_steps.slice(0, maxNodes).map((step) => (
              <div key={step.id} className={`rounded border p-2 ${getRunnerNodeTone(step.status)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">
                      #{step.order} {step.kind}
                    </p>
                    <p className="mt-1 text-xs text-white/90">{step.title}</p>
                  </div>
                  <span className="text-[10px] font-mono uppercase text-white/45">{step.status}</span>
                </div>
                {step.summary ? <p className="mt-2 text-[11px] text-white/70">{step.summary}</p> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
