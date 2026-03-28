"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, AlertTriangle, RefreshCw } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  listBriefings,
  listExternalWork,
  listJarvisSessions,
  listTasks,
  listUpgradeProposals,
  routeExternalWorkItem,
} from "@/lib/api/endpoints";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";
import type {
  BriefingRecord,
  ExternalRouteAction,
  ExternalWorkItemRecord,
  ExternalWorkTriageStatus,
  JarvisSessionRecord,
  TaskRecord,
} from "@/lib/api/types";
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

const EMPTY_EXTERNAL_COUNTS: Record<ExternalWorkTriageStatus, number> = {
  new: 0,
  imported: 0,
  ignored: 0,
  sync_error: 0,
};

const EXTERNAL_ROUTE_ACTIONS: ExternalRouteAction[] = [
  "task_code",
  "mission_code",
  "session_research",
  "mission_research",
  "session_council",
  "ignore",
];

function getExternalWorkStatusTone(status: ExternalWorkItemRecord["triageStatus"]): string {
  if (status === "imported") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "ignored") return "border-white/15 bg-white/[0.04] text-white/60";
  if (status === "sync_error") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
}

function getExternalWorkStatusLabel(status: ExternalWorkItemRecord["triageStatus"], t: ReturnType<typeof useLocale>["t"]): string {
  if (status === "imported") return t("inbox.externalWorkStatus.imported");
  if (status === "ignored") return t("inbox.externalWorkStatus.ignored");
  if (status === "sync_error") return t("inbox.externalWorkStatus.sync_error");
  return t("inbox.externalWorkStatus.new");
}

function getExternalWorkActionLabel(action: ExternalRouteAction, t: ReturnType<typeof useLocale>["t"]): string {
  if (action === "task_code") return t("inbox.externalWorkAction.taskCode");
  if (action === "mission_code") return t("inbox.externalWorkAction.missionCode");
  if (action === "session_research") return t("inbox.externalWorkAction.sessionResearch");
  if (action === "mission_research") return t("inbox.externalWorkAction.missionResearch");
  if (action === "session_council") return t("inbox.externalWorkAction.sessionCouncil");
  return t("inbox.externalWorkAction.ignore");
}

export function InboxModule() {
  const role = useCurrentRole();
  const { t } = useLocale();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [briefings, setBriefings] = useState<BriefingRecord[]>([]);
  const [sessions, setSessions] = useState<JarvisSessionRecord[]>([]);
  const [externalWork, setExternalWork] = useState<ExternalWorkItemRecord[]>([]);
  const [externalWorkEnabled, setExternalWorkEnabled] = useState(false);
  const [externalWorkCounts, setExternalWorkCounts] = useState<Record<ExternalWorkTriageStatus, number>>(EMPTY_EXTERNAL_COUNTS);
  const [externalWorkError, setExternalWorkError] = useState<string | null>(null);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [externalWorkBusy, setExternalWorkBusy] = useState<string | null>(null);

  const loadExternalWork = useCallback(async (refreshRemote = false) => {
    try {
      const result = await listExternalWork({
        limit: 8,
        refresh: refreshRemote ? 1 : 0,
      });
      setExternalWorkEnabled(result.enabled);
      setExternalWork(result.items);
      setExternalWorkCounts(result.counts ?? EMPTY_EXTERNAL_COUNTS);
      setExternalWorkError(result.refresh_error ?? null);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setExternalWorkError(`${err.code}: ${err.message}`);
      } else if (err instanceof Error && err.message.trim().length > 0) {
        setExternalWorkError(err.message);
      } else {
        setExternalWorkError(t("inbox.externalWorkLoadFailed"));
      }
      setExternalWork([]);
      setExternalWorkCounts(EMPTY_EXTERNAL_COUNTS);
      setExternalWorkEnabled(false);
    }
  }, [t]);

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
      } else {
        const proposalsResult = await Promise.allSettled([listUpgradeProposals({ status: "proposed" })]);
        const proposalResult = proposalsResult[0];

        if (proposalResult?.status === "fulfilled") {
          const legacyCount = Array.isArray(proposalResult.value.proposals) ? proposalResult.value.proposals.length : 0;
          const sessionCount = sessionRows.filter((session) => session.status === "needs_approval").length;
          setPendingApprovalCount(legacyCount + sessionCount);
        } else {
          setPendingApprovalCount(sessionRows.filter((session) => session.status === "needs_approval").length);
        }
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
    } finally {
      setLoading(false);
      await loadExternalWork(false);
    }
  }, [loadExternalWork, role, t]);

  const syncExternalQueue = useCallback(async () => {
    setExternalWorkBusy("sync");
    await loadExternalWork(true);
    setExternalWorkBusy(null);
  }, [loadExternalWork]);

  const handleExternalRoute = useCallback(async (itemId: string, action: ExternalRouteAction) => {
    setExternalWorkBusy(itemId);
    try {
      await routeExternalWorkItem(itemId, action);
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setExternalWorkError(`${err.code}: ${err.message}`);
      } else if (err instanceof Error && err.message.trim().length > 0) {
        setExternalWorkError(err.message);
      } else {
        setExternalWorkError(t("inbox.externalWorkRouteFailed"));
      }
    } finally {
      setExternalWorkBusy(null);
    }
  }, [refresh, t]);

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

          <div className="glass-panel rounded-lg border border-cyan-500/20 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-mono font-bold tracking-widest text-cyan-300">{t("inbox.externalWork")}</h2>
                <p className="mt-1 text-xs text-white/45">{t("inbox.externalWorkSubtitle")}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-white/50">
                  <span>{t("inbox.externalWorkCount.new", { value: externalWorkCounts.new })}</span>
                  <span>{t("inbox.externalWorkCount.imported", { value: externalWorkCounts.imported })}</span>
                  <span>{t("inbox.externalWorkCount.ignored", { value: externalWorkCounts.ignored })}</span>
                  <span>{t("inbox.externalWorkCount.sync_error", { value: externalWorkCounts.sync_error })}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void syncExternalQueue();
                  }}
                  disabled={externalWorkBusy === "sync"}
                  className="inline-flex items-center gap-2 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-mono text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={12} className={externalWorkBusy === "sync" ? "animate-spin" : ""} />
                  {externalWorkBusy === "sync" ? t("inbox.externalWorkSyncing") : t("inbox.externalWorkSync")}
                </button>
              </div>
            </div>

            {externalWorkError ? (
              <p className="mt-3 text-xs font-mono text-rose-300">{externalWorkError}</p>
            ) : null}

            {!externalWorkEnabled ? (
              <p className="mt-4 text-sm text-white/55">{t("inbox.externalWorkDisabled")}</p>
            ) : externalWork.length === 0 ? (
              <p className="mt-4 text-sm text-white/55">{t("inbox.externalWorkEmpty")}</p>
            ) : (
              <div className="mt-4 space-y-3">
                {externalWork.map((item) => {
                  const isBusy = externalWorkBusy === item.id;
                  return (
                    <div key={item.id} className="rounded border border-white/10 bg-black/25 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-cyan-300">
                              {item.identifier}
                            </span>
                            <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${getExternalWorkStatusTone(item.triageStatus)}`}>
                              {getExternalWorkStatusLabel(item.triageStatus, t)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-medium text-white">{item.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-white/60">{item.description}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-white/45">
                            <span>
                              {t("inbox.externalWorkState")}: {item.state}
                            </span>
                            {item.labels.length > 0 ? (
                              <span>
                                {t("inbox.externalWorkLabels")}: {item.labels.join(", ")}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-mono text-cyan-200 underline decoration-cyan-500/40 underline-offset-4"
                          >
                            {t("inbox.externalWorkOpen")}
                          </a>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {EXTERNAL_ROUTE_ACTIONS.map((action) => {
                          const disabled =
                            isBusy ||
                            (item.triageStatus === "imported" && action !== "ignore") ||
                            item.triageStatus === "ignored";
                          return (
                            <button
                              key={`${item.id}:${action}`}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                void handleExternalRoute(item.id, action);
                              }}
                              className="rounded border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-mono text-white/75 transition hover:border-cyan-500/30 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {getExternalWorkActionLabel(action, t)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
