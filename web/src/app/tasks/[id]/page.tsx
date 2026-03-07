"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw, Activity } from "lucide-react";

import { getTask, streamTaskEvents } from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/client";
import type { TaskRecord } from "@/lib/api/types";
import { useLocale } from "@/components/providers/LocaleProvider";
import { TaskStatusBadge } from "@/components/ui/TaskStatusBadge";

type TimelineEvent = {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
};

function formatShortId(value: string | undefined, size = 8): string {
  if (!value) return "-";
  return value.length <= size ? value : value.slice(0, size);
}

function parseTimelineEvent(payload: unknown, eventType: string): TimelineEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const row = payload as {
    event_id?: unknown;
    timestamp?: unknown;
    data?: unknown;
    trace_id?: unknown;
    span_id?: unknown;
  };

  if (typeof row.event_id !== "string" || typeof row.timestamp !== "string" || typeof row.data !== "object" || row.data === null) {
    return null;
  }

  return {
    id: row.event_id,
    type: eventType,
    timestamp: row.timestamp,
    data: row.data as Record<string, unknown>,
    traceId: typeof row.trace_id === "string" ? row.trace_id : undefined,
    spanId: typeof row.span_id === "string" ? row.span_id : undefined,
  };
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const taskId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { t, formatDateTime } = useLocale();

  const [task, setTask] = useState<TaskRecord | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "streaming" | "closed" | "error">("idle");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const loadTask = useCallback(async () => {
    if (!taskId) return;

    setLoading(true);
    setError(null);

    try {
      const row = await getTask(taskId);
      setTask(row);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("taskDetail.loadFailed"));
      }
      setTask(null);
    } finally {
      setLoading(false);
    }
  }, [taskId, t]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  useEffect(() => {
    if (!taskId) return;

    setEvents([]);
    setSelectedTraceId(null);
    setStreamState("streaming");

    const stream = streamTaskEvents(taskId, {
      onEvent: (eventType, payload) => {
        const parsed = parseTimelineEvent(payload, eventType);
        if (!parsed) return;

        setEvents((prev) => {
          if (prev.some((item) => item.id === parsed.id)) {
            return prev;
          }
          return [...prev, parsed];
        });
      },
      onClose: () => {
        setStreamState("closed");
      },
      onError: () => {
        setStreamState("error");
      },
    });

    return () => {
      stream.close();
    };
  }, [taskId]);

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [events]);

  const traceTimeline = useMemo(() => {
    const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const grouped = new Map<
      string,
      {
        traceId: string;
        events: TimelineEvent[];
        spans: Set<string>;
        lastTimestamp: string;
      }
    >();

    for (const event of ordered) {
      const traceId = event.traceId ?? task?.traceId;
      if (!traceId) continue;

      const row = grouped.get(traceId) ?? {
        traceId,
        events: [],
        spans: new Set<string>(),
        lastTimestamp: event.timestamp,
      };
      row.events.push(event);
      row.lastTimestamp = event.timestamp;
      if (event.spanId) {
        row.spans.add(event.spanId);
      }
      grouped.set(traceId, row);
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
      .map((item) => ({
        traceId: item.traceId,
        events: item.events,
        spanIds: Array.from(item.spans),
        lastTimestamp: item.lastTimestamp,
      }));
  }, [events, task?.traceId]);

  const traceFilterOptions = useMemo(() => traceTimeline.map((trace) => trace.traceId), [traceTimeline]);

  useEffect(() => {
    if (!selectedTraceId) return;
    if (!traceFilterOptions.includes(selectedTraceId)) {
      setSelectedTraceId(null);
    }
  }, [selectedTraceId, traceFilterOptions]);

  const filteredEvents = useMemo(() => {
    if (!selectedTraceId) {
      return sortedEvents;
    }
    return sortedEvents.filter((event) => (event.traceId ?? task?.traceId) === selectedTraceId);
  }, [selectedTraceId, sortedEvents, task?.traceId]);

  if (!taskId) {
    return (
      <main className="w-full h-full bg-black text-white p-8">
        <p className="text-red-400 font-mono text-sm">{t("taskDetail.invalidId")}</p>
      </main>
    );
  }

  return (
    <main className="w-full h-full bg-black text-white p-8 flex flex-col overflow-y-auto">
      <header className="mb-6 border-l-2 border-cyan-500 pl-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-widest text-white">{t("taskDetail.title")}</h1>
          <p className="text-sm font-mono text-white/50 tracking-wide mt-1">{taskId}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/?widget=tasks"
            className="px-3 py-2 text-xs font-mono rounded border border-white/20 text-white/70 hover:text-white hover:border-white/40 flex items-center gap-2"
          >
            <ArrowLeft size={14} /> {t("common.back")}
          </Link>
          <button
            onClick={() => void loadTask()}
            className="px-3 py-2 text-xs font-mono rounded border border-cyan-500/40 text-cyan-300 hover:text-cyan-100 flex items-center gap-2"
          >
            <RefreshCw size={14} /> {t("common.refresh")}
          </button>
        </div>
      </header>

      {loading && <div className="text-sm font-mono text-white/40">{t("taskDetail.loading")}</div>}

      {!loading && error && <div className="text-sm font-mono text-red-400">{error}</div>}

      {!loading && !error && task && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <section className="xl:col-span-1 bg-white/5 border border-white/10 rounded-lg p-5">
            <h2 className="text-[10px] font-mono tracking-widest text-white/40 uppercase mb-4">{t("taskDetail.metadata")}</h2>

            <div className="space-y-3 text-sm">
              <div>
                <p className="text-white/40 text-xs font-mono">{t("tasks.table.title")}</p>
                <p className="text-white/90">{task.title}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs font-mono">{t("tasks.table.mode")}</p>
                <p className="text-white/90 uppercase tracking-wide">{task.mode}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs font-mono">{t("common.status")}</p>
                <TaskStatusBadge status={task.status} />
              </div>
              <div>
                <p className="text-white/40 text-xs font-mono">{t("taskDetail.created")}</p>
                <p className="text-white/90">{formatDateTime(task.createdAt)}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs font-mono">{t("taskDetail.updated")}</p>
                <p className="text-white/90">{formatDateTime(task.updatedAt)}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs font-mono">{t("taskDetail.trace")}</p>
                <p className="text-white/90 font-mono text-xs">{task.traceId ?? "-"}</p>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-white/40 text-xs font-mono mb-2">{t("taskDetail.inputPayload")}</p>
              <pre className="text-[11px] leading-5 bg-black/50 border border-white/10 rounded p-3 overflow-auto text-cyan-200">
                {JSON.stringify(task.input, null, 2)}
              </pre>
            </div>
          </section>

          <section className="xl:col-span-2 flex flex-col gap-6">
            <div className="bg-white/5 border border-white/10 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] font-mono tracking-widest text-white/40 uppercase">{t("taskDetail.timeline")}</h2>
                <span className="text-xs font-mono text-white/50 flex items-center gap-2">
                  <Activity size={14} className={streamState === "streaming" ? "text-cyan-400 animate-pulse" : "text-white/40"} />
                  {t(`taskDetail.stream.${streamState}` as const)}
                </span>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`rounded border px-2 py-1 text-[10px] font-mono transition-colors ${
                    selectedTraceId === null
                      ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200"
                      : "border-white/15 bg-black/40 text-white/60 hover:text-white/80"
                  }`}
                  onClick={() => setSelectedTraceId(null)}
                >
                  {t("taskDetail.allTraces")}
                </button>
                {traceFilterOptions.map((traceId) => (
                  <button
                    key={traceId}
                    type="button"
                    className={`rounded border px-2 py-1 text-[10px] font-mono transition-colors ${
                      selectedTraceId === traceId
                        ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200"
                        : "border-white/15 bg-black/40 text-white/60 hover:text-white/80"
                    }`}
                    onClick={() => setSelectedTraceId(traceId)}
                  >
                    {formatShortId(traceId, 12)}
                  </button>
                ))}
              </div>

              {filteredEvents.length === 0 && (
                <div className="text-sm font-mono text-white/40">{t("taskDetail.noEvents")}</div>
              )}

              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {filteredEvents.map((event) => (
                  <div key={event.id} className="border border-white/10 rounded-md p-3 bg-black/40">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-cyan-300">{event.type}</span>
                      <span className="text-xs font-mono text-white/40">{formatDateTime(event.timestamp)}</span>
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] font-mono text-white/45">
                      <button
                        type="button"
                        onClick={() => {
                          const traceId = event.traceId ?? task.traceId;
                          if (!traceId) return;
                          setSelectedTraceId((current) => (current === traceId ? null : traceId));
                        }}
                        className="rounded border border-cyan-500/30 px-2 py-1 text-cyan-200 hover:bg-cyan-500/15"
                      >
                        {t("taskDetail.traceLabel")}={formatShortId(event.traceId ?? task.traceId)}
                      </button>
                      <span>{t("taskDetail.spanLabel")}={formatShortId(event.spanId)}</span>
                    </div>
                    <pre className="text-[11px] leading-5 text-white/80 overflow-auto">{JSON.stringify(event.data, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] font-mono tracking-widest text-white/40 uppercase">{t("taskDetail.traceTimeline")}</h2>
                <span className="text-xs font-mono text-white/45">{t("taskDetail.traceCount", { value: traceTimeline.length })}</span>
              </div>

              {traceTimeline.length === 0 && (
                <div className="text-sm font-mono text-white/40">{t("taskDetail.noTraceMetadata")}</div>
              )}

              <div className="space-y-3 max-h-[230px] overflow-y-auto pr-1">
                {traceTimeline.map((trace) => (
                  <button
                    key={trace.traceId}
                    type="button"
                    onClick={() => setSelectedTraceId((current) => (current === trace.traceId ? null : trace.traceId))}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      selectedTraceId === trace.traceId
                        ? "border-cyan-300/60 bg-cyan-500/15"
                        : "border-cyan-500/20 bg-cyan-500/5 hover:bg-cyan-500/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono text-cyan-300">{t("taskDetail.tracePrefix")} {formatShortId(trace.traceId, 12)}</span>
                      <span className="text-[10px] font-mono text-white/45">
                        {t("taskDetail.traceSummary", {
                          spans: trace.spanIds.length,
                          events: trace.events.length,
                          timestamp: formatDateTime(trace.lastTimestamp),
                        })}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {trace.events.map((event, index) => (
                        <React.Fragment key={event.id}>
                          <div className="rounded border border-white/10 bg-black/50 px-2 py-1 min-w-[120px]">
                            <p className="text-[10px] font-mono text-white/70">{event.type}</p>
                            <p className="text-[10px] font-mono text-cyan-300">{t("taskDetail.spanLabel")} {formatShortId(event.spanId, 10)}</p>
                          </div>
                          {index < trace.events.length - 1 && <span className="text-cyan-400/50 text-xs">→</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
