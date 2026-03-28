"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ListTodo, RefreshCw, Search } from "lucide-react";

import { useHUD } from "@/components/providers/HUDProvider";
import { ApiRequestError } from "@/lib/api/client";
import { listJarvisSessions, listTasks, streamDashboardOverviewEvents } from "@/lib/api/endpoints";
import type { JarvisSessionRecord, TaskRecord, TaskStatus } from "@/lib/api/types";
import { AsyncState } from "@/components/ui/AsyncState";
import { TaskStatusBadge } from "@/components/ui/TaskStatusBadge";
import { subscribeJarvisDataRefresh } from "@/lib/hud/data-refresh";
import { useLocale } from "@/components/providers/LocaleProvider";
import type { TranslationKey } from "@/lib/locale";
import { mergeHudAndJarvisSessions } from "@/lib/jarvis/session-view";

function formatRelativeTime(
  isoDate: string,
  t: (key: "tasks.relative.justNow" | "tasks.relative.minutesAgo" | "tasks.relative.hoursAgo" | "tasks.relative.daysAgo", values?: Record<string, string | number>) => string
): string {
  const target = new Date(isoDate).getTime();
  const diffSeconds = Math.round((target - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);

  if (abs < 60) return t("tasks.relative.justNow");
  if (abs < 3600) return t("tasks.relative.minutesAgo", { value: Math.round(abs / 60) });
  if (abs < 86400) return t("tasks.relative.hoursAgo", { value: Math.round(abs / 3600) });
  return t("tasks.relative.daysAgo", { value: Math.round(abs / 86400) });
}

const PAGE_SIZE = 20;

function formatSessionTarget(
  target: JarvisSessionRecord["primaryTarget"],
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  if (target === "assistant") return t("actionCenter.target.assistant");
  if (target === "mission") return t("actionCenter.target.mission");
  if (target === "council") return t("actionCenter.target.council");
  if (target === "execution") return t("actionCenter.target.execution");
  if (target === "briefing") return t("actionCenter.target.briefing");
  return t("actionCenter.target.dossier");
}

function formatSessionQueueStatus(
  status: JarvisSessionRecord["status"],
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  if (status === "queued") return t("taskStatus.queued");
  if (status === "running") return t("taskStatus.running");
  if (status === "blocked" || status === "needs_approval") return t("taskStatus.blocked");
  if (status === "failed") return t("taskStatus.failed");
  if (status === "completed") return t("taskStatus.done");
  if (status === "stale") return t("actionCenter.stale");
  return status;
}

export function TasksModule() {
  const { sessions } = useHUD();
  const { t } = useLocale();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [jarvisSessions, setJarvisSessions] = useState<JarvisSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [hasMore, setHasMore] = useState(true);
  const [showRecentSessions, setShowRecentSessions] = useState(false);
  const [showTaskHistory, setShowTaskHistory] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, sessionRows] = await Promise.all([
        listTasks({
          limit: PAGE_SIZE,
          status: statusFilter === "all" ? undefined : statusFilter,
        }),
        listJarvisSessions({ limit: 12 }).then((result) => result.sessions).catch(() => []),
      ]);
      setTasks(rows);
      setJarvisSessions(Array.isArray(sessionRows) ? sessionRows : []);
      setHasMore(rows.length >= PAGE_SIZE);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("tasks.loadFailed"));
      }
      setTasks([]);
      setJarvisSessions([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await listTasks({
        limit: PAGE_SIZE + tasks.length,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setTasks(rows);
      setHasMore(rows.length > tasks.length);
    } catch {
      // keep existing
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const stream = streamDashboardOverviewEvents(
      { poll_ms: 2000, timeout_ms: 60000 },
      { onUpdated: () => void refresh() }
    );
    return () => stream.close();
  }, [refresh, statusFilter]);

  useEffect(() => {
    return subscribeJarvisDataRefresh((detail) => {
      if (detail.scope === "all" || detail.scope === "sessions" || detail.scope === "tasks" || detail.scope === "approvals") {
        void refresh();
      }
    });
  }, [refresh]);

  const mergedJarvisSessions = useMemo(() => {
    return mergeHudAndJarvisSessions(sessions, jarvisSessions);
  }, [jarvisSessions, sessions]);

  const staleSessionByTaskId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const session of mergedJarvisSessions) {
      if (session.status !== "stale" || !session.taskId) {
        continue;
      }
      map.set(session.taskId, true);
    }
    return map;
  }, [mergedJarvisSessions]);
  const staleCount = useMemo(() => mergedJarvisSessions.filter((session) => session.status === "stale").length, [mergedJarvisSessions]);

  const filtered = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return tasks;
    return tasks.filter((task) => {
      return (
        task.title.toLowerCase().includes(keyword) ||
        task.id.toLowerCase().includes(keyword) ||
        task.mode.toLowerCase().includes(keyword) ||
        task.status.toLowerCase().includes(keyword)
      );
    });
  }, [tasks, searchTerm]);

  const sessionGroups = useMemo(() => {
    const now = mergedJarvisSessions
      .filter((session) => session.status === "running" || session.status === "queued")
      .slice(0, 3);
    const needsAttention = mergedJarvisSessions.filter((session) =>
      session.status === "failed" ||
      session.status === "blocked" ||
      session.status === "needs_approval" ||
      session.status === "stale"
    );
    const allRecent = mergedJarvisSessions.filter(
      (session) => !now.some((row) => row.id === session.id) && !needsAttention.some((row) => row.id === session.id)
    );
    const recent = showRecentSessions ? allRecent.slice(0, 8) : [];
    return { now, needsAttention, recent, recentCount: allRecent.length };
  }, [mergedJarvisSessions, showRecentSessions]);

  const sessionStatusTone = (status: JarvisSessionRecord["status"]) => {
    if (status === "completed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    if (status === "failed") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
    if (status === "blocked" || status === "needs_approval" || status === "stale") {
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    }
    return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
  };

  return (
    <main className="w-full h-full bg-transparent text-white p-4 flex flex-col">
      <header className="mb-4 border-l-2 border-cyan-500 pl-3">
        <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-400 flex items-center gap-2">
          <ListTodo size={14} /> {t("tasks.title")}
          {staleCount > 0 && (
            <span className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-200">
              {t("tasks.staleCount", { value: staleCount })}
            </span>
          )}
        </h2>
      </header>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="relative md:col-span-2">
          <Search size={14} className="absolute left-3 top-2.5 text-white/30" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={t("tasks.searchPlaceholder")}
            className="w-full bg-black/40 border border-white/10 rounded px-9 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500/40"
          />
        </label>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as TaskStatus | "all")}
            className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-2 text-[11px] font-mono text-white/80"
          >
            <option value="all">{t("tasks.status.all")}</option>
            <option value="queued">{t("tasks.status.queued")}</option>
            <option value="running">{t("tasks.status.running")}</option>
            <option value="blocked">{t("tasks.status.blocked")}</option>
            <option value="retrying">{t("tasks.status.retrying")}</option>
            <option value="done">{t("tasks.status.done")}</option>
            <option value="failed">{t("tasks.status.failed")}</option>
            <option value="cancelled">{t("tasks.status.cancelled")}</option>
          </select>
          <button
            onClick={() => void refresh()}
            className="px-2.5 py-2 rounded border border-cyan-500/30 text-cyan-300 hover:text-cyan-100"
            title={t("tasks.refresh")}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="mb-4 rounded border border-cyan-500/20 bg-cyan-500/5 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-mono tracking-widest text-cyan-300 uppercase">{t("tasks.actionQueue")}</p>
          <span className="text-[10px] font-mono text-white/45">{t("tasks.sessionsCount", { value: mergedJarvisSessions.length })}</span>
        </div>
        <div className="space-y-3">
          {([
            ["tasks.queue.now", sessionGroups.now, "tasks.queue.emptyNow"],
            ["tasks.queue.needsAttention", sessionGroups.needsAttention, "tasks.queue.emptyNeedsAttention"],
            ["tasks.queue.recent", sessionGroups.recent, "tasks.queue.emptyRecent"],
          ] as const).map(([labelKey, rows, emptyKey]) => (
            <div key={labelKey}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/45">{t(labelKey)}</p>
                {labelKey === "tasks.queue.recent" && sessionGroups.recentCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowRecentSessions((prev) => !prev)}
                    className="text-[10px] font-mono text-cyan-300 hover:text-cyan-100"
                  >
                    {showRecentSessions ? t("tasks.queue.hideRecent") : t("tasks.queue.viewRecent")}
                  </button>
                ) : null}
              </div>
              {rows.length === 0 ? (
                <p className="text-xs text-white/40">{t(emptyKey)}</p>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {rows.map((session) => (
                    <div key={session.id} className={`rounded-lg border px-3 py-2 ${sessionStatusTone(session.status)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-[0.18em]">
                          {formatSessionTarget(session.primaryTarget, t)} · {formatSessionQueueStatus(session.status, t)}
                        </span>
                        <span className="text-[10px] font-mono text-white/60">{formatRelativeTime(session.updatedAt, t)}</span>
                      </div>
                      <p className="mt-1 truncate text-sm text-white/90">{session.title}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 border border-white/10 rounded overflow-hidden bg-black/30">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div className="font-mono text-[10px] text-white/40 tracking-wider uppercase">{t("tasks.table.title")}</div>
          <button
            type="button"
            onClick={() => setShowTaskHistory((prev) => !prev)}
            className="text-[10px] font-mono text-cyan-300 hover:text-cyan-100"
          >
            {showTaskHistory ? t("tasks.queue.hideRecent") : t("tasks.queue.viewRecent")}
          </button>
        </div>

        {!showTaskHistory ? (
          <div className="p-4 text-xs text-white/45">{t("tasks.queue.emptyRecent")}</div>
        ) : (
          <div className="h-full max-h-[560px] overflow-y-auto">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-white/10 font-mono text-[10px] text-white/40 tracking-wider uppercase">
              <div className="col-span-2">{t("tasks.table.id")}</div>
              <div className="col-span-5">{t("tasks.table.title")}</div>
              <div className="col-span-2">{t("tasks.table.mode")}</div>
              <div className="col-span-3 text-right">{t("tasks.table.state")}</div>
            </div>

            <AsyncState
              loading={loading}
              error={error}
              empty={!loading && !error && filtered.length === 0}
              emptyText={t("tasks.empty")}
              loadingText={t("tasks.loading")}
              onRetry={() => void refresh()}
              className="p-4"
            />

            {!loading &&
              !error &&
              filtered.map((task) => {
                const isStale = staleSessionByTaskId.get(task.id) === true;
                return (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="grid grid-cols-12 gap-2 px-3 py-2.5 border-b border-white/5 hover:bg-white/5 items-center"
                >
                  <div className="col-span-2 font-mono text-[10px] text-white/40">{task.id.slice(0, 8)}</div>
                  <div className="col-span-5 text-xs text-white/85 truncate">{task.title}</div>
                  <div className="col-span-2 font-mono text-[10px] text-white/40 uppercase">{task.mode}</div>
                  <div className="col-span-3 flex justify-end">
                    <TaskStatusBadge status={task.status} />
                    {isStale && (
                      <span className="ml-2 rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-mono text-amber-200">
                        STALE
                      </span>
                    )}
                  </div>
                  <div className="col-span-12 text-right font-mono text-[10px] text-white/35">
                    {formatRelativeTime(task.updatedAt, t)}
                  </div>
                </Link>
                );
              })}

            {!loading && !error && hasMore && filtered.length > 0 && (
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="w-full py-2 text-[11px] font-mono text-cyan-400 hover:text-cyan-200 border-t border-white/10 hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                {loadingMore ? t("tasks.loadingMore") : t("tasks.loadMore")}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
