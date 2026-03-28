"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw, Activity } from "lucide-react";

import { RunnerGraphSummaryPanel } from "@/components/modules/RunnerGraphSummaryPanel";
import { getJarvisSession, getRunnerRun, getTask, streamTaskEvents } from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/client";
import type { BriefingRecord, DossierRecord, JarvisNextAction, JarvisSessionDetail, TaskRecord } from "@/lib/api/types";
import type { RunnerRunDetail } from "@/lib/api/runner-types";
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

function describeNextAction(action: JarvisNextAction | null | undefined, locale: ReturnType<typeof useLocale>): string {
  if (!action) {
    return locale.locale === "ko" ? "세션 다음 행동 정보가 아직 없다. 타임라인과 입력 payload를 먼저 확인해라." : "There is no explicit next step yet. Review the timeline and input payload first.";
  }
  if (action.kind === "open_action_center") {
    return locale.locale === "ko" ? "대기 중인 액션과 승인 항목을 먼저 검토해라." : "Review the pending actions and approval items first.";
  }
  if (action.kind === "open_workbench") {
    return locale.locale === "ko" ? "워크벤치를 열어 이 세션의 진행 상태와 산출물을 확인해라." : "Open the workbench and inspect the session progress and outputs.";
  }
  if (action.kind === "open_brief") {
    return locale.locale === "ko" ? "브리핑 산출물을 먼저 확인해라." : "Review the generated briefing first.";
  }
  if (action.kind === "create_monitor") {
    return locale.locale === "ko" ? "이 세션에서 모니터를 만들어 후속 변화를 추적해라." : "Create a monitor from this session to track follow-up changes.";
  }
  return locale.locale === "ko" ? "세션 상태를 다시 점검해라." : "Review the session state before continuing.";
}

function previewArtifactText(...values: string[]): string {
  const lines = values.flatMap((value) =>
    value
      .split("\n")
      .map((line) =>
        line
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/\*\*/g, "")
          .replace(/^#+\s*/, "")
          .replace(/^[-*]\s*/, "")
          .replace(/^\d+\.\s*/, "")
          .trim()
      )
  );

  const meaningful = lines.filter((line) => {
    if (line.length < 18) return false;
    if (/^(정책 브리프|policy brief|briefing|dossier)$/i.test(line)) return false;
    if (/^(sources?|출처)[:\s]?/i.test(line)) return false;
    return true;
  });

  return meaningful.slice(0, 3).join(" ");
}

function ArtifactPreview({
  title,
  summary,
  body,
  status,
  locale,
}: {
  title: string;
  summary: string;
  body: string;
  status: string;
  locale: ReturnType<typeof useLocale>;
}) {
  const preview = previewArtifactText(summary, body) || (locale.locale === "ko" ? "미리 볼 수 있는 요약이 아직 없다." : "No preview is available yet.");
  return (
    <div className="rounded-2xl border border-black/10 bg-white px-4 py-4">
      <p className="text-sm font-semibold text-neutral-950">{title}</p>
      <p className="mt-1 text-xs text-neutral-500">{status}</p>
      <p className="mt-3 text-sm leading-6 text-neutral-700">{preview}</p>
    </div>
  );
}

function ResultArtifacts({
  briefing,
  dossier,
  locale,
}: {
  briefing: BriefingRecord | null;
  dossier: DossierRecord | null;
  locale: ReturnType<typeof useLocale>;
}) {
  if (!briefing && !dossier) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-cyan-700">
        {locale.locale === "ko" ? "생성된 결과" : "Generated results"}
      </p>
      {briefing ? (
        <ArtifactPreview
          title={locale.locale === "ko" ? "브리핑" : "Briefing"}
          summary={briefing.summary}
          body={briefing.answerMarkdown}
          status={briefing.status}
          locale={locale}
        />
      ) : null}
      {dossier ? (
        <ArtifactPreview
          title={locale.locale === "ko" ? "Dossier" : "Dossier"}
          summary={dossier.summary}
          body={dossier.answerMarkdown}
          status={dossier.status}
          locale={locale}
        />
      ) : null}
    </div>
  );
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const taskId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const focusedSessionId = searchParams.get("session");
  const locale = useLocale();
  const { t, formatDateTime } = locale;
  const runnerCopy = locale.locale === "ko"
    ? {
        empty: "이 task에는 아직 runner 실행이 연결되지 않았다.",
        loading: "runner 상세를 불러오는 중...",
        loadFailed: "runner 상세를 불러오지 못했다.",
        latestRun: "최근 런",
      }
    : {
        empty: "No runner execution is linked to this task yet.",
        loading: "Loading runner detail...",
        loadFailed: "Failed to load runner detail.",
        latestRun: "Latest Run",
      };

  const [task, setTask] = useState<TaskRecord | null>(null);
  const [focusedSessionDetail, setFocusedSessionDetail] = useState<JarvisSessionDetail | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [runnerDetail, setRunnerDetail] = useState<RunnerRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "streaming" | "closed" | "error">("idle");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedRunnerRunId, setSelectedRunnerRunId] = useState<string | null>(null);

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
    let cancelled = false;
    if (!focusedSessionId) {
      setFocusedSessionDetail(null);
      return;
    }
    void getJarvisSession(focusedSessionId)
      .then((detail) => {
        if (!cancelled) {
          setFocusedSessionDetail(detail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFocusedSessionDetail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [focusedSessionId]);

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

  const runnerRunIds = useMemo(() => {
    const ids: string[] = [];
    const pushId = (value: unknown) => {
      if (typeof value !== "string" || ids.includes(value)) return;
      ids.push(value);
    };

    for (const event of sortedEvents) {
      pushId(event.data.runner_run_id);
    }
    pushId(task?.input?.runner_run_id);

    return ids;
  }, [sortedEvents, task?.input]);

  useEffect(() => {
    setSelectedRunnerRunId((current) => {
      if (current && runnerRunIds.includes(current)) {
        return current;
      }
      return runnerRunIds[0] ?? null;
    });
  }, [runnerRunIds]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedRunnerRunId) {
      setRunnerDetail(null);
      setRunnerError(null);
      return () => {
        cancelled = true;
      };
    }

    const loadRunnerDetail = async () => {
      setRunnerLoading(true);
      setRunnerError(null);
      try {
        const detail = await getRunnerRun(selectedRunnerRunId);
        if (cancelled) return;
        setRunnerDetail(detail);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiRequestError) {
          setRunnerError(`${err.code}: ${err.message}`);
        } else {
          setRunnerError(runnerCopy.loadFailed);
        }
        setRunnerDetail(null);
      } finally {
        if (!cancelled) {
          setRunnerLoading(false);
        }
      }
    };

    void loadRunnerDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedRunnerRunId, runnerCopy.loadFailed]);

  const activeRunnerDetail = runnerDetail?.run.id === selectedRunnerRunId ? runnerDetail : null;
  if (!taskId) {
    return (
      <main className="rounded-[32px] border border-black/10 bg-[#fffdf8] p-8 text-neutral-950 shadow-sm">
        <p className="text-red-400 font-mono text-sm">{t("taskDetail.invalidId")}</p>
      </main>
    );
  }

  return (
    <main className="rounded-[32px] border border-black/10 bg-[#fffdf8] p-8 text-neutral-950 shadow-sm flex flex-col overflow-y-auto">
      <header className="mb-6 border-l-2 border-neutral-950 pl-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-widest text-neutral-950">{t("taskDetail.title")}</h1>
          <p className="text-sm font-mono text-neutral-500 tracking-wide mt-1">{taskId}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/tasks"
            className="px-3 py-2 text-xs font-mono rounded border border-black/10 text-neutral-700 hover:text-neutral-950 hover:border-black/30 flex items-center gap-2"
          >
            <ArrowLeft size={14} /> {t("common.back")}
          </Link>
          <button
            onClick={() => void loadTask()}
            className="px-3 py-2 text-xs font-mono rounded border border-black/10 text-neutral-700 hover:text-neutral-950 flex items-center gap-2"
          >
            <RefreshCw size={14} /> {t("common.refresh")}
          </button>
        </div>
      </header>

      {loading && <div className="text-sm font-mono text-neutral-500">{t("taskDetail.loading")}</div>}

      {!loading && error && <div className="text-sm font-mono text-red-400">{error}</div>}

      {!loading && !error && task && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <section className="xl:col-span-1 bg-white border border-black/10 rounded-3xl p-5">
            <h2 className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase mb-4">{t("taskDetail.metadata")}</h2>

            <div className="space-y-3 text-sm">
              <div>
                <p className="text-neutral-500 text-xs font-mono">{t("tasks.table.title")}</p>
                <p className="text-neutral-950">{task.title}</p>
              </div>
              <div>
                <p className="text-neutral-500 text-xs font-mono">{t("tasks.table.mode")}</p>
                <p className="text-neutral-950 uppercase tracking-wide">{task.mode}</p>
              </div>
              <div>
                <p className="text-neutral-500 text-xs font-mono">{t("common.status")}</p>
                <TaskStatusBadge status={task.status} />
              </div>
              <div>
                <p className="text-neutral-500 text-xs font-mono">{t("taskDetail.created")}</p>
                <p className="text-neutral-950">{formatDateTime(task.createdAt)}</p>
              </div>
              <div>
                <p className="text-neutral-500 text-xs font-mono">{t("taskDetail.updated")}</p>
                <p className="text-neutral-950">{formatDateTime(task.updatedAt)}</p>
              </div>
              <div>
                <p className="text-neutral-500 text-xs font-mono">{t("taskDetail.trace")}</p>
                <p className="text-neutral-950 font-mono text-xs">{task.traceId ?? "-"}</p>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-neutral-500 text-xs font-mono mb-2">{t("taskDetail.inputPayload")}</p>
              <pre className="text-[11px] leading-5 bg-neutral-950 border border-black/10 rounded p-3 overflow-auto text-amber-100">
                {JSON.stringify(task.input, null, 2)}
              </pre>
            </div>

            {focusedSessionDetail ? (
              <div className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-cyan-700">
                  {t("common.status")} · {focusedSessionDetail.session.status}
                </p>
                <h3 className="mt-2 text-sm font-semibold text-neutral-950">
                  {focusedSessionDetail.session.title}
                </h3>
                <p className="mt-2 text-xs leading-5 text-neutral-700">
                  {describeNextAction(focusedSessionDetail.next_action, locale)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-neutral-700">
                  <span className="rounded-full border border-cyan-200 bg-white px-2 py-1">
                    {focusedSessionDetail.session.primaryTarget}
                  </span>
                  <span className="rounded-full border border-cyan-200 bg-white px-2 py-1">
                    {locale.locale === "ko" ? "활성 능력" : "Active capabilities"} {focusedSessionDetail.active_capabilities.length}
                  </span>
                  <span className="rounded-full border border-cyan-200 bg-white px-2 py-1">
                    {locale.locale === "ko" ? "대기 액션" : "Pending actions"} {focusedSessionDetail.actions.length}
                  </span>
                </div>
                <ResultArtifacts
                  briefing={focusedSessionDetail.briefing}
                  dossier={focusedSessionDetail.dossier}
                  locale={locale}
                />
              </div>
            ) : null}
          </section>

          <section className="xl:col-span-2 flex flex-col gap-6">
            <div className="bg-white border border-black/10 rounded-3xl p-5">
              {runnerRunIds.length > 1 ? (
                <div className="mb-4 flex flex-wrap gap-2">
                  {runnerRunIds.map((runnerRunId, index) => (
                    <button
                      key={runnerRunId}
                      type="button"
                      onClick={() => setSelectedRunnerRunId(runnerRunId)}
                      className={`rounded border px-2 py-1 text-[10px] font-mono transition-colors ${
                        selectedRunnerRunId === runnerRunId
                          ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200"
                          : "border-white/15 bg-black/40 text-white/60 hover:text-white/80"
                      }`}
                    >
                      {runnerCopy.latestRun} {index + 1}
                    </button>
                  ))}
                </div>
              ) : null}

              {runnerRunIds.length > 0 && runnerLoading ? (
                <p className="text-sm font-mono text-cyan-200">{runnerCopy.loading}</p>
              ) : null}

              {runnerRunIds.length > 0 && runnerError ? (
                <p className="text-sm font-mono text-red-400">{runnerError}</p>
              ) : null}

              {(runnerRunIds.length === 0 || activeRunnerDetail) && (
                <RunnerGraphSummaryPanel
                  detail={activeRunnerDetail}
                  emptyMessage={runnerCopy.empty}
                  maxNodes={6}
                  className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3"
                />
              )}
            </div>

            <div className="bg-white border border-black/10 rounded-3xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">{t("taskDetail.timeline")}</h2>
                <span className="text-xs font-mono text-neutral-500 flex items-center gap-2">
                  <Activity size={14} className={streamState === "streaming" ? "text-neutral-950 animate-pulse" : "text-neutral-400"} />
                  {t(`taskDetail.stream.${streamState}` as const)}
                </span>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`rounded border px-2 py-1 text-[10px] font-mono transition-colors ${
                    selectedTraceId === null
                      ? "border-neutral-950 bg-neutral-950 text-white"
                      : "border-black/10 bg-white text-neutral-600 hover:text-neutral-950"
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
                        ? "border-neutral-950 bg-neutral-950 text-white"
                        : "border-black/10 bg-white text-neutral-600 hover:text-neutral-950"
                    }`}
                    onClick={() => setSelectedTraceId(traceId)}
                  >
                    {formatShortId(traceId, 12)}
                  </button>
                ))}
              </div>

              {filteredEvents.length === 0 && (
                <div className="text-sm font-mono text-neutral-500">{t("taskDetail.noEvents")}</div>
              )}

              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {filteredEvents.map((event) => (
                  <div key={event.id} className="border border-black/10 rounded-2xl p-3 bg-white">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-neutral-950">{event.type}</span>
                      <span className="text-xs font-mono text-neutral-500">{formatDateTime(event.timestamp)}</span>
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] font-mono text-neutral-500">
                      <button
                        type="button"
                        onClick={() => {
                          const traceId = event.traceId ?? task.traceId;
                          if (!traceId) return;
                          setSelectedTraceId((current) => (current === traceId ? null : traceId));
                        }}
                        className="rounded border border-black/10 px-2 py-1 text-neutral-700 hover:bg-neutral-100"
                      >
                        {t("taskDetail.traceLabel")}={formatShortId(event.traceId ?? task.traceId)}
                      </button>
                      <span>{t("taskDetail.spanLabel")}={formatShortId(event.spanId)}</span>
                    </div>
                    <pre className="text-[11px] leading-5 text-neutral-800 overflow-auto">{JSON.stringify(event.data, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-black/10 rounded-3xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">{t("taskDetail.traceTimeline")}</h2>
                <span className="text-xs font-mono text-neutral-500">{t("taskDetail.traceCount", { value: traceTimeline.length })}</span>
              </div>

              {traceTimeline.length === 0 && (
                <div className="text-sm font-mono text-neutral-500">{t("taskDetail.noTraceMetadata")}</div>
              )}

              <div className="space-y-3 max-h-[230px] overflow-y-auto pr-1">
                {traceTimeline.map((trace) => (
                  <button
                    key={trace.traceId}
                    type="button"
                    onClick={() => setSelectedTraceId((current) => (current === trace.traceId ? null : trace.traceId))}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      selectedTraceId === trace.traceId
                        ? "border-neutral-950 bg-neutral-950/5"
                        : "border-black/10 bg-white hover:bg-neutral-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono text-neutral-950">{t("taskDetail.tracePrefix")} {formatShortId(trace.traceId, 12)}</span>
                      <span className="text-[10px] font-mono text-neutral-500">
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
                          <div className="rounded border border-black/10 bg-white px-2 py-1 min-w-[120px]">
                            <p className="text-[10px] font-mono text-neutral-700">{event.type}</p>
                            <p className="text-[10px] font-mono text-neutral-950">{t("taskDetail.spanLabel")} {formatShortId(event.spanId, 10)}</p>
                          </div>
                          {index < trace.events.length - 1 && <span className="text-neutral-400 text-xs">→</span>}
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
