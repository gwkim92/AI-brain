"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BellPlus, Play, RefreshCw, PauseCircle, RadioTower } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { createWatcher, listWatchers, runWatcher, updateWatcher } from "@/lib/api/endpoints";
import type { WatcherKind, WatcherRecord } from "@/lib/api/types";

const WATCHER_KIND_OPTIONS: Array<{ value: WatcherKind; label: string }> = [
  { value: "external_topic", label: "External Topic" },
  { value: "company", label: "Company" },
  { value: "market", label: "Market" },
  { value: "war_region", label: "War Region" },
  { value: "repo", label: "Repo" },
  { value: "task_health", label: "Task Health" },
  { value: "mission_health", label: "Mission Health" },
  { value: "approval_backlog", label: "Approval Backlog" },
];

export function WatchersModule() {
  const [watchers, setWatchers] = useState<WatcherRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WatcherKind>("external_topic");
  const [submitting, setSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const normalizedTitle = title.trim();
  const normalizedQuery = query.trim();
  const canCreate = normalizedTitle.length > 0 && normalizedQuery.length > 0 && !submitting;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listWatchers({ limit: 30 });
      setWatchers(result.watchers);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to load watchers");
      }
      setWatchers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = async () => {
    if (!normalizedTitle || !normalizedQuery) {
      setFormError("Watcher title and monitoring query are both required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setFormError(null);
    try {
      await createWatcher({
        kind,
        title: normalizedTitle,
        query: normalizedQuery,
      });
      setTitle("");
      setQuery("");
      setFormError(null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to create watcher");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onToggle = async (watcher: WatcherRecord) => {
    try {
      await updateWatcher(watcher.id, {
        status: watcher.status === "active" ? "paused" : "active",
      });
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to update watcher");
      }
    }
  };

  const onRun = async (watcher: WatcherRecord) => {
    setRunningId(watcher.id);
    setError(null);
    try {
      await runWatcher(watcher.id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to run watcher");
      }
    } finally {
      setRunningId(null);
    }
  };

  return (
    <main className="w-full h-full min-h-0 overflow-hidden bg-transparent p-4 text-white flex flex-col gap-4">
      <header className="border-l-2 border-cyan-500 pl-3 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-400 flex items-center gap-2">
            <RadioTower size={14} /> WATCHERS
          </h2>
          <p className="text-[10px] font-mono text-white/40">Proactive monitoring lanes</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 h-7 px-2 rounded border border-white/20 text-[10px] font-mono text-white/70 hover:text-white"
        >
          <RefreshCw size={11} /> REFRESH
        </button>
      </header>

      <section className="rounded border border-white/10 bg-black/30 p-3 grid grid-cols-1 md:grid-cols-4 gap-2 shrink-0">
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setFormError(null);
          }}
          placeholder="Watcher title"
          aria-invalid={Boolean(formError && !normalizedTitle)}
          className={`rounded border bg-black/40 px-3 py-2 text-xs ${formError && !normalizedTitle ? "border-amber-500/40" : "border-white/10"}`}
        />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setFormError(null);
          }}
          placeholder="What should Jarvis monitor?"
          aria-invalid={Boolean(formError && !normalizedQuery)}
          className={`rounded border bg-black/40 px-3 py-2 text-xs md:col-span-2 ${formError && !normalizedQuery ? "border-amber-500/40" : "border-white/10"}`}
        />
        <div className="flex gap-2">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as WatcherKind)}
            className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-2 text-[11px] font-mono"
          >
            {WATCHER_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={!canCreate}
            className="inline-flex items-center gap-1 rounded border border-cyan-500/40 px-3 py-2 text-[10px] font-mono text-cyan-300 disabled:opacity-50"
          >
            <BellPlus size={12} /> ADD
          </button>
        </div>
        <div className="md:col-span-4 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
          <span className={formError ? "text-amber-300" : "text-white/40"}>
            {formError ?? "Enter a title and query to enable ADD."}
          </span>
          <span className="text-white/30">
            {normalizedTitle.length > 0 ? `${normalizedTitle.length} title chars` : "title empty"} ·{" "}
            {normalizedQuery.length > 0 ? `${normalizedQuery.length} query chars` : "query empty"}
          </span>
        </div>
      </section>

      {error && <p className="text-xs font-mono text-rose-300">{error}</p>}
      {loading ? (
        <p className="text-xs font-mono text-white/50">Loading watchers...</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {watchers.length === 0 && <p className="text-xs font-mono text-white/40">No watchers registered.</p>}
          {watchers.map((watcher) => (
            <div key={watcher.id} className="rounded border border-white/10 bg-black/35 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white/90 truncate">{watcher.title}</p>
                  <p className="text-[10px] font-mono text-white/45 truncate">{watcher.kind} · {watcher.query}</p>
                </div>
                <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${watcher.status === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : watcher.status === "paused" ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200"}`}>
                  {watcher.status}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onRun(watcher)}
                  disabled={runningId === watcher.id}
                  className="inline-flex items-center gap-1 rounded border border-cyan-500/40 px-2 py-1 text-[10px] font-mono text-cyan-300 disabled:opacity-50"
                >
                  <Play size={11} /> {runningId === watcher.id ? "RUNNING" : "RUN"}
                </button>
                <button
                  type="button"
                  onClick={() => void onToggle(watcher)}
                  className="inline-flex items-center gap-1 rounded border border-white/20 px-2 py-1 text-[10px] font-mono text-white/70"
                >
                  <PauseCircle size={11} /> {watcher.status === "active" ? "PAUSE" : "RESUME"}
                </button>
              </div>
              <div className="mt-2 text-[10px] font-mono text-white/35">
                last run: {watcher.lastRunAt ? new Date(watcher.lastRunAt).toLocaleString() : "never"}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
