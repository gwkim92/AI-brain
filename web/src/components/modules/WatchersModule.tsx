"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { BellPlus, Play, RefreshCw, PauseCircle, RadioTower } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { useLocale } from "@/components/providers/LocaleProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { ApiRequestError } from "@/lib/api/client";
import { createWatcher, listWatchers, runWatcher, updateWatcher } from "@/lib/api/endpoints";
import type { WatcherKind, WatcherRecord } from "@/lib/api/types";

const WATCHER_KIND_OPTIONS: WatcherKind[] = [
  "external_topic",
  "company",
  "market",
  "war_region",
  "repo",
  "task_health",
  "mission_health",
  "approval_backlog",
];

export function WatchersModule() {
  const searchParams = useSearchParams();
  const { t, formatDateTime } = useLocale();
  const { pushToast } = useToast();
  const [watchers, setWatchers] = useState<WatcherRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WatcherKind>("external_topic");
  const [submitting, setSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [highlightedWatcherId, setHighlightedWatcherId] = useState<string | null>(null);
  const [prefillState, setPrefillState] = useState<"prefilled" | "success" | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const watcherRefs = useRef<Record<string, HTMLDivElement | null>>({});
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
        setError(t("watchers.error.load"));
      }
      setWatchers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const prefillTitle = searchParams.get("watcher_title")?.trim();
    const prefillQuery = searchParams.get("watcher_query")?.trim();
    const prefillKind = searchParams.get("watcher_kind")?.trim();

    if (prefillTitle) {
      setTitle(prefillTitle);
    }
    if (prefillQuery) {
      setQuery(prefillQuery);
    }
    if (
      prefillKind &&
      WATCHER_KIND_OPTIONS.some((option) => option === prefillKind)
    ) {
      setKind(prefillKind as WatcherKind);
    }
    if (prefillTitle || prefillQuery) {
      setFormError(null);
      setPrefillState("prefilled");
      window.requestAnimationFrame(() => {
        titleInputRef.current?.focus();
      });
    } else {
      setPrefillState(null);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!highlightedWatcherId) {
      return;
    }
    const target = watcherRefs.current[highlightedWatcherId];
    if (target) {
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    const timer = window.setTimeout(() => {
      setHighlightedWatcherId((current) => (current === highlightedWatcherId ? null : current));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [highlightedWatcherId]);

  const onCreate = async () => {
    if (!normalizedTitle || !normalizedQuery) {
      setFormError(t("watchers.requiredFields"));
      return;
    }
    setSubmitting(true);
    setError(null);
    setFormError(null);
    try {
      const created = await createWatcher({
        kind,
        title: normalizedTitle,
        query: normalizedQuery,
      });
      setWatchers((current) => [created, ...current.filter((watcher) => watcher.id !== created.id)]);
      setHighlightedWatcherId(created.id);
      pushToast({
        tone: "success",
        title: t("watchers.toast.createdTitle"),
        message: t("watchers.toast.createdMessage"),
      });
      setPrefillState((current) => (current ? "success" : current));
      setTitle("");
      setQuery("");
      setFormError(null);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("watchers.error.create"));
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
        setError(t("watchers.error.update"));
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
        setError(t("watchers.error.run"));
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
            <RadioTower size={14} /> {t("watchers.title").toUpperCase()}
          </h2>
          <p className="text-[10px] font-mono text-white/40">{t("watchers.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 h-7 px-2 rounded border border-white/20 text-[10px] font-mono text-white/70 hover:text-white"
        >
          <RefreshCw size={11} /> {t("common.refresh").toUpperCase()}
        </button>
      </header>

      <section className="rounded border border-white/10 bg-black/30 p-3 grid grid-cols-1 md:grid-cols-4 gap-2 shrink-0">
        {prefillState && (
          <div
            className={`md:col-span-4 rounded px-3 py-2 text-[10px] font-mono ${
              prefillState === "success"
                ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
                : "border border-cyan-500/20 bg-cyan-500/8 text-cyan-100"
            }`}
          >
            {prefillState === "success" ? t("watchers.success") : t("watchers.prefillNotice")}
          </div>
        )}
        <input
          ref={titleInputRef}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setFormError(null);
          }}
          placeholder={t("watchers.titlePlaceholder")}
          aria-invalid={Boolean(formError && !normalizedTitle)}
          className={`rounded border bg-black/40 px-3 py-2 text-xs ${formError && !normalizedTitle ? "border-amber-500/40" : "border-white/10"}`}
        />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setFormError(null);
          }}
          placeholder={t("watchers.queryPlaceholder")}
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
              <option key={option} value={option}>{t(`watchers.kind.${option}`)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={!canCreate}
            className="inline-flex items-center gap-1 rounded border border-cyan-500/40 px-3 py-2 text-[10px] font-mono text-cyan-300 disabled:opacity-50"
          >
            <BellPlus size={12} /> {t("common.add").toUpperCase()}
          </button>
        </div>
        <div className="md:col-span-4 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
          <span className={formError ? "text-amber-300" : "text-white/40"}>
            {formError ?? t("watchers.addHint")}
          </span>
          <span className="text-white/30">
            {normalizedTitle.length > 0 ? t("common.characters.title", { value: normalizedTitle.length }) : t("common.characters.titleEmpty")} ·{" "}
            {normalizedQuery.length > 0 ? t("common.characters.query", { value: normalizedQuery.length }) : t("common.characters.queryEmpty")}
          </span>
        </div>
      </section>

      {error && <p className="text-xs font-mono text-rose-300">{error}</p>}
      {loading ? (
        <p className="text-xs font-mono text-white/50">{t("watchers.loading")}</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {watchers.length === 0 && <p className="text-xs font-mono text-white/40">{t("watchers.empty")}</p>}
          {watchers.map((watcher) => (
            <div
              key={watcher.id}
              ref={(node) => {
                watcherRefs.current[watcher.id] = node;
              }}
              className={`rounded border bg-black/35 p-3 transition-[border,box-shadow,transform] duration-300 ${
                highlightedWatcherId === watcher.id
                  ? "border-cyan-400/40 shadow-[0_0_0_1px_rgba(34,211,238,0.35),0_0_32px_rgba(34,211,238,0.18)]"
                  : "border-white/10"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white/90 truncate">{watcher.title}</p>
                  <p className="text-[10px] font-mono text-white/45 truncate">{t(`watchers.kind.${watcher.kind}`)} · {watcher.query}</p>
                </div>
                <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${watcher.status === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : watcher.status === "paused" ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200"}`}>
                  {t(`watchers.status.${watcher.status}`)}
                </span>
              </div>
              {highlightedWatcherId === watcher.id ? (
                <div className="mt-2 inline-flex items-center rounded-full border border-cyan-400/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.24em] text-cyan-100">
                  {t("watchers.new")}
                </div>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onRun(watcher)}
                  disabled={runningId === watcher.id}
                  className="inline-flex items-center gap-1 rounded border border-cyan-500/40 px-2 py-1 text-[10px] font-mono text-cyan-300 disabled:opacity-50"
                >
                  <Play size={11} /> {runningId === watcher.id ? t("watchers.running").toUpperCase() : t("watchers.run").toUpperCase()}
                </button>
                <button
                  type="button"
                  onClick={() => void onToggle(watcher)}
                  className="inline-flex items-center gap-1 rounded border border-white/20 px-2 py-1 text-[10px] font-mono text-white/70"
                >
                  <PauseCircle size={11} /> {watcher.status === "active" ? t("watchers.pause").toUpperCase() : t("watchers.resume").toUpperCase()}
                </button>
              </div>
              <div className="mt-2 text-[10px] font-mono text-white/35">
                {t("watchers.lastRun")}: {watcher.lastRunAt ? formatDateTime(watcher.lastRunAt) : t("watchers.never")}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
