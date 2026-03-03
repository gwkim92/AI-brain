"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ListTodo, RefreshCw, Search } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { listTasks, streamDashboardOverviewEvents } from "@/lib/api/endpoints";
import type { TaskRecord, TaskStatus } from "@/lib/api/types";
import { AsyncState } from "@/components/ui/AsyncState";
import { TaskStatusBadge } from "@/components/ui/TaskStatusBadge";

function formatRelativeTime(isoDate: string): string {
  const target = new Date(isoDate).getTime();
  const diffSeconds = Math.round((target - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);

  if (abs < 60) return "just now";
  if (abs < 3600) return `${Math.round(abs / 60)}m ago`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ago`;
  return `${Math.round(abs / 86400)}d ago`;
}

const PAGE_SIZE = 20;

export function TasksModule() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [hasMore, setHasMore] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listTasks({
        limit: PAGE_SIZE,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setTasks(rows);
      setHasMore(rows.length >= PAGE_SIZE);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to load tasks");
      }
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    const stream = streamDashboardOverviewEvents(
      { poll_ms: 2000, timeout_ms: 60000 },
      { onUpdated: () => void refresh() }
    );
    return () => stream.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

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

  return (
    <main className="w-full h-full bg-transparent text-white p-4 flex flex-col">
      <header className="mb-4 border-l-2 border-cyan-500 pl-3">
        <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-400 flex items-center gap-2">
          <ListTodo size={14} /> TASK MANAGER
        </h2>
      </header>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="relative md:col-span-2">
          <Search size={14} className="absolute left-3 top-2.5 text-white/30" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search tasks..."
            className="w-full bg-black/40 border border-white/10 rounded px-9 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500/40"
          />
        </label>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as TaskStatus | "all")}
            className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-2 text-[11px] font-mono text-white/80"
          >
            <option value="all">ALL</option>
            <option value="queued">QUEUED</option>
            <option value="running">RUNNING</option>
            <option value="blocked">BLOCKED</option>
            <option value="retrying">RETRYING</option>
            <option value="done">DONE</option>
            <option value="failed">FAILED</option>
            <option value="cancelled">CANCELLED</option>
          </select>
          <button
            onClick={() => void refresh()}
            className="px-2.5 py-2 rounded border border-cyan-500/30 text-cyan-300 hover:text-cyan-100"
            title="Refresh tasks"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 border border-white/10 rounded overflow-hidden bg-black/30">
        <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-white/10 font-mono text-[10px] text-white/40 tracking-wider uppercase">
          <div className="col-span-2">ID</div>
          <div className="col-span-5">Title</div>
          <div className="col-span-2">Mode</div>
          <div className="col-span-3 text-right">State</div>
        </div>

        <div className="h-full max-h-[560px] overflow-y-auto">
          <AsyncState
            loading={loading}
            error={error}
            empty={!loading && !error && filtered.length === 0}
            emptyText="No matching tasks."
            loadingText="Loading tasks..."
            onRetry={() => void refresh()}
            className="p-4"
          />

          {!loading &&
            !error &&
            filtered.map((task) => (
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
                </div>
                <div className="col-span-12 text-right font-mono text-[10px] text-white/35">
                  {formatRelativeTime(task.updatedAt)}
                </div>
              </Link>
            ))}

          {!loading && !error && hasMore && filtered.length > 0 && (
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full py-2 text-[11px] font-mono text-cyan-400 hover:text-cyan-200 border-t border-white/10 hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load More"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
