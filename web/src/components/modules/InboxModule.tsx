"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { listBriefings, listJarvisSessions, listRadarRecommendations, listTasks, listUpgradeProposals } from "@/lib/api/endpoints";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";
import type { BriefingRecord, JarvisSessionRecord, TaskRecord } from "@/lib/api/types";
import { subscribeJarvisDataRefresh } from "@/lib/hud/data-refresh";
import { useLocale } from "@/components/providers/LocaleProvider";

function formatRelativeTime(value: string, t: ReturnType<typeof useLocale>["t"]): string {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return value;

  const diffSec = Math.max(0, Math.floor((Date.now() - target) / 1000));
  if (diffSec < 60) return t("tasks.relative.justNow");
  if (diffSec < 3600) return t("tasks.relative.minutesAgo", { value: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("tasks.relative.hoursAgo", { value: Math.floor(diffSec / 3600) });
  return t("tasks.relative.daysAgo", { value: Math.floor(diffSec / 86400) });
}

function mapSummaryStatus(status: TaskRecord["status"]): "done" | "running" | "queued" | "failed" | "blocked" {
  if (status === "done") return "done";
  if (status === "running" || status === "retrying") return "running";
  if (status === "blocked") return "blocked";
  if (status === "failed" || status === "cancelled") return "failed";
  return "queued";
}

type SummaryRow = {
  id: string;
  title: string;
  time: string;
  status: "done" | "running" | "queued" | "failed" | "blocked";
};

export function InboxModule() {
  const role = useCurrentRole();
  const { t } = useLocale();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [briefings, setBriefings] = useState<BriefingRecord[]>([]);
  const [sessions, setSessions] = useState<JarvisSessionRecord[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [adoptRecommendationCount, setAdoptRecommendationCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [taskRows, briefingRows, sessionRows] = await Promise.all([
        listTasks({ limit: 20 }),
        listBriefings({ limit: 8 }).then((result) => result.briefings).catch(() => []),
        listJarvisSessions({ limit: 12 }).then((result) => result.sessions).catch(() => []),
      ]);
      setTasks(Array.isArray(taskRows) ? taskRows : []);
      setBriefings(Array.isArray(briefingRows) ? briefingRows : []);
      setSessions(Array.isArray(sessionRows) ? sessionRows : []);

      // Operator-only signal APIs should not break inbox for member users.
      if (!hasMinRole(role, "operator")) {
        setPendingApprovalCount(sessionRows.filter((session) => session.status === "needs_approval").length);
        setAdoptRecommendationCount(0);
        return;
      }

      const [proposalsResult, recommendationsResult] = await Promise.allSettled([
        listUpgradeProposals({ status: "proposed" }),
        listRadarRecommendations({ decision: "adopt" }),
      ]);

      if (proposalsResult.status === "fulfilled") {
        const legacyCount = Array.isArray(proposalsResult.value.proposals) ? proposalsResult.value.proposals.length : 0;
        const sessionCount = sessionRows.filter((session) => session.status === "needs_approval").length;
        setPendingApprovalCount(legacyCount + sessionCount);
      } else {
        setPendingApprovalCount(sessionRows.filter((session) => session.status === "needs_approval").length);
      }

      if (recommendationsResult.status === "fulfilled") {
        setAdoptRecommendationCount(
          Array.isArray(recommendationsResult.value.recommendations) ? recommendationsResult.value.recommendations.length : 0
        );
      } else {
        setAdoptRecommendationCount(0);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setLoadError(`${err.code}: ${err.message}`);
      } else if (err instanceof Error && err.message.trim().length > 0) {
        setLoadError(err.message);
      } else {
        setLoadError(t("inbox.loadFailed"));
      }
      setTasks([]);
      setBriefings([]);
      setSessions([]);
      setPendingApprovalCount(0);
      setAdoptRecommendationCount(0);
    } finally {
      setLoading(false);
    }
  }, [role, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return subscribeJarvisDataRefresh((detail) => {
      if (detail.scope === "all" || detail.scope === "approvals" || detail.scope === "sessions" || detail.scope === "tasks") {
        void refresh();
      }
    });
  }, [refresh]);

  const summaryItems = useMemo<SummaryRow[]>(() => {
    const sessionRows: SummaryRow[] = sessions.slice(0, 4).map((session) => ({
      id: session.id,
      title: session.title,
      time: formatRelativeTime(session.updatedAt, t),
      status: (() => {
        const nextStatus: "done" | "running" | "queued" | "failed" | "blocked" =
          session.status === "completed"
            ? "done"
            : session.status === "failed"
              ? "failed"
              : session.status === "blocked" || session.status === "needs_approval"
                ? "blocked"
                : "running";
        return nextStatus;
      })(),
    }));
    const briefingRows: SummaryRow[] = briefings.slice(0, 4).map((briefing) => ({
      id: briefing.id,
      title: briefing.title,
      time: formatRelativeTime(briefing.updatedAt, t),
      status: briefing.status === "failed" ? "failed" : "done" as const,
    }));
    const taskRows: SummaryRow[] = tasks.slice(0, 4).map((task) => ({
      id: task.id,
      title: task.title,
      time: formatRelativeTime(task.updatedAt, t),
      status: mapSummaryStatus(task.status),
    }));
    return [...sessionRows, ...briefingRows, ...taskRows].slice(0, 8);
  }, [briefings, sessions, t, tasks]);

  const failedTaskCount = useMemo(() => tasks.filter((task) => task.status === "failed" || task.status === "cancelled").length, [tasks]);

  return (
    <main className="w-full h-full relative overflow-hidden bg-transparent text-white flex">
      <div className="relative z-10 w-full h-full p-6 flex flex-col pointer-events-none">
        <header className="mb-4 pl-4 border-l-2 border-cyan-500">
          <h1 className="text-2xl font-mono font-bold tracking-widest text-cyan-400">{t("inbox.title")}</h1>
          <p className="text-xs font-mono text-white/50 tracking-wide">{t("inbox.subtitle")}</p>
        </header>

        <div className="flex-1 flex flex-col gap-4 overflow-y-auto pointer-events-auto pr-2">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="col-span-2 glass-panel p-5 rounded-lg flex flex-col h-72">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-mono font-bold text-white/40 tracking-widest">{t("inbox.todaySummary")}</h2>
                <Clock size={14} className="text-white/30" />
              </div>

              <div className="flex-1 space-y-2.5 overflow-y-auto pr-2">
                {loadError && <p className="text-sm font-mono text-red-400">{loadError}</p>}
                {loading && <p className="text-sm font-mono text-white/40">{t("inbox.loading")}</p>}
                {!loading && !loadError && summaryItems.length === 0 && (
                  <p className="text-sm font-mono text-white/40">{t("inbox.empty")}</p>
                )}
                {!loading &&
                  summaryItems.map((item) => (
                    <SummaryItem key={item.id} title={item.title} time={item.time} status={item.status} />
                  ))}
              </div>
            </div>

            <div className="col-span-1 glass-panel p-5 rounded-lg flex flex-col h-72 border-t-2 border-t-amber-500">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-mono font-bold text-amber-500 tracking-widest">{t("inbox.alerts")}</h2>
                <AlertTriangle size={14} className="text-amber-500" />
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded">
                  <p className="text-xs font-mono text-amber-400 mb-1">{t("inbox.pendingActions")}</p>
                  <p className="text-xs text-white/70">{t("inbox.pendingActionsCount", { value: pendingApprovalCount })}</p>
                </div>
                <div className="p-3 bg-white/5 border border-white/10 rounded">
                  <p className="text-xs font-mono text-cyan-400 mb-1">{t("inbox.briefingsReady")}</p>
                  <p className="text-xs text-white/70">{t("inbox.briefingsReadyCount", { value: briefings.length })}</p>
                </div>
                <div className={`p-3 border rounded ${failedTaskCount > 0 ? "bg-red-950/30 border-red-500/20" : "bg-emerald-950/20 border-emerald-500/20"}`}>
                  <p className={`text-xs font-mono mb-1 ${failedTaskCount > 0 ? "text-red-300" : "text-emerald-300"}`}>{t("inbox.taskFailures")}</p>
                  <p className="text-xs text-white/70">
                    {failedTaskCount > 0 ? t("inbox.taskFailuresCount", { value: failedTaskCount }) : t("inbox.taskFailuresClear")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function SummaryItem({ title, time, status }: { title: string; time: string; status: "done" | "running" | "queued" | "failed" | "blocked" }) {
  const getStatusColor = () => {
    switch (status) {
      case "done":
        return "bg-emerald-500/20 border-emerald-500/50 text-emerald-400";
      case "running":
        return "bg-cyan-500/20 border-cyan-500/50 text-cyan-400 animate-pulse";
      case "blocked":
        return "bg-amber-500/20 border-amber-500/50 text-amber-400";
      case "failed":
        return "bg-red-500/20 border-red-500/50 text-red-300";
      case "queued":
      default:
        return "bg-white/5 border-white/20 text-white/40";
    }
  };

  const getStatusDot = () => {
    switch (status) {
      case "done":
        return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]";
      case "running":
        return "bg-cyan-500 shadow-[0_0_8px_rgba(0,255,255,0.5)]";
      case "blocked":
        return "bg-amber-500";
      case "failed":
        return "bg-red-500";
      case "queued":
      default:
        return "bg-white/30";
    }
  };

  return (
    <div className={`p-2.5 border rounded-md flex items-center justify-between ${getStatusColor()}`}>
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full shrink-0 ${getStatusDot()}`}></span>
        <span className="text-sm font-medium truncate max-w-[320px]">{title}</span>
      </div>
      <span className="text-xs font-mono opacity-70 shrink-0 ml-2">{time}</span>
    </div>
  );
}
