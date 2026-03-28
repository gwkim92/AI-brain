"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, ListTodo, RefreshCw } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { getJarvisSession, listJarvisSessions, listTasks } from "@/lib/api/endpoints";
import type { BriefingRecord, DossierRecord, JarvisNextAction, JarvisSessionDetail, JarvisSessionRecord, TaskRecord } from "@/lib/api/types";
import { AsyncState } from "@/components/ui/AsyncState";
import { TaskStatusBadge } from "@/components/ui/TaskStatusBadge";
import { useLocale } from "@/components/providers/LocaleProvider";

function relativeTime(value: string, locale: ReturnType<typeof useLocale>): string {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return value;
  const diffSec = Math.max(0, Math.floor((Date.now() - target) / 1000));
  if (diffSec < 60) return locale.t("tasks.relative.justNow");
  if (diffSec < 3600) return locale.t("tasks.relative.minutesAgo", { value: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return locale.t("tasks.relative.hoursAgo", { value: Math.floor(diffSec / 3600) });
  return locale.t("tasks.relative.daysAgo", { value: Math.floor(diffSec / 86400) });
}

function hrefForTask(taskId?: string | null, sessionId?: string | null): string {
  if (taskId && taskId.trim().length > 0) {
    return `/tasks/${taskId}${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`;
  }
  if (sessionId && sessionId.trim().length > 0) {
    return `/tasks?session=${encodeURIComponent(sessionId)}`;
  }
  return "/tasks";
}

function formatSessionStatusLabel(session: JarvisSessionRecord, locale: ReturnType<typeof useLocale>): string {
  if (session.status === "needs_approval") {
    return locale.locale === "ko" ? "사람 승인이 필요하다." : "This session needs human approval.";
  }
  if (session.status === "blocked") {
    return locale.locale === "ko" ? "작업이 막혀 있어 다음 판단이 필요하다." : "This work is blocked and needs the next decision.";
  }
  if (session.status === "stale") {
    return locale.locale === "ko" ? "세션이 오래되어 다시 확인해야 한다." : "This session has gone stale and needs a review.";
  }
  if (session.status === "completed") {
    return locale.locale === "ko" ? "승인이 반영됐고 결과가 생성됐다. 아래 결과를 바로 확인해라." : "The approval has been applied and results are ready below.";
  }
  return locale.locale === "ko" ? "세션 상태를 다시 확인해라." : "Review the session state before continuing.";
}

function describeNextAction(action: JarvisNextAction | null | undefined, locale: ReturnType<typeof useLocale>): string {
  if (!action) {
    return locale.locale === "ko" ? "다음 행동 정보가 아직 없다. 세션 상세를 열어 상태와 타임라인을 확인해라." : "No explicit next step is available yet. Open the session detail and inspect the state and timeline.";
  }
  if (action.kind === "open_action_center") {
    return locale.locale === "ko" ? "대기 중인 액션과 승인 판단을 검토해라." : "Review the pending actions and approval decisions.";
  }
  if (action.kind === "open_workbench") {
    return locale.locale === "ko" ? "워크벤치에서 세션 진행 상태와 산출물을 확인해라." : "Open the workbench and inspect the session progress and outputs.";
  }
  if (action.kind === "open_brief") {
    return locale.locale === "ko" ? "브리핑 결과를 먼저 확인해라." : "Review the generated briefing before continuing.";
  }
  if (action.kind === "create_monitor") {
    return locale.locale === "ko" ? "이 세션을 바탕으로 모니터를 만들어 후속 변화를 추적해라." : "Create a monitor from this session to track follow-up changes.";
  }
  return locale.locale === "ko" ? "세션 상세를 열어 다음 행동을 확인해라." : "Open the session detail to review the next step.";
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-950">{title}</p>
          <p className="mt-1 text-xs text-neutral-500">{status}</p>
        </div>
      </div>
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
      <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-700">
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

export default function TasksPage() {
  const locale = useLocale();
  const searchParams = useSearchParams();
  const focusedSessionId = searchParams.get("session");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [sessions, setSessions] = useState<JarvisSessionRecord[]>([]);
  const [focusedSessionDetail, setFocusedSessionDetail] = useState<JarvisSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [taskRows, sessionResult] = await Promise.all([
        listTasks({ limit: 24 }),
        listJarvisSessions({ limit: 16 }),
      ]);
      setTasks(taskRows);
      setSessions(sessionResult.sessions);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(locale.locale === "ko" ? "작업 목록을 불러오지 못했다." : "Failed to load tasks.");
      }
    } finally {
      setLoading(false);
    }
  }, [locale.locale]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const activeSessions = useMemo(() => {
    return sessions.filter((session) =>
      session.status === "running" ||
      session.status === "queued" ||
      session.status === "blocked" ||
      session.status === "needs_approval" ||
      session.status === "stale"
    );
  }, [sessions]);

  const focusedSession = useMemo(() => {
    if (!focusedSessionId) return null;
    return sessions.find((session) => session.id === focusedSessionId) ?? null;
  }, [focusedSessionId, sessions]);

  const taskRows = useMemo(() => {
    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      mode: task.mode,
      status: task.status,
      updatedAt: task.updatedAt,
      href: `/tasks/${task.id}`,
    }));
  }, [tasks]);

  return (
    <main className="space-y-6">
      <section className="rounded-[32px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">
              {locale.locale === "ko" ? "작업 허브" : "Task hub"}
            </p>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight text-neutral-950">
              <ListTodo size={26} />
              {locale.locale === "ko" ? "모든 작업과 세션을 한곳에서 본다." : "See all work and sessions in one place."}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-neutral-600">
              {locale.locale === "ko"
                ? "여기가 작업의 원본이다. 진행 중 세션, 막힌 작업, 최근 완료 결과를 같은 흐름으로 확인하고 각 task detail로 들어간다."
                : "This is the canonical work surface. Review active sessions, blocked work, and recent completions, then drill into the task detail."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-neutral-700 shadow-sm hover:bg-neutral-100"
          >
            <RefreshCw size={15} />
            {locale.locale === "ko" ? "새로고침" : "Refresh"}
          </button>
        </div>
      </section>

      {focusedSession ? (
        <section className="rounded-[28px] border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-700">
            {locale.locale === "ko" ? "집중 세션" : "Focused session"}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-neutral-950">{focusedSession.title}</h2>
          <p className="mt-1 text-sm text-neutral-700">
            {focusedSession.primaryTarget} · {focusedSession.status} · {relativeTime(focusedSession.updatedAt, locale)}
          </p>
          <p className="mt-3 text-sm leading-6 text-neutral-700">
            {formatSessionStatusLabel(focusedSession, locale)}
          </p>
          <div className="mt-3 rounded-2xl border border-cyan-200 bg-white px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-700">
              {locale.locale === "ko" ? "다음 행동" : "Next action"}
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-800">
              {describeNextAction(focusedSessionDetail?.next_action, locale)}
            </p>
            {focusedSession.prompt ? (
              <p className="mt-3 line-clamp-2 text-xs leading-5 text-neutral-600">
                {locale.locale === "ko" ? "원본 요청" : "Original prompt"} · {focusedSession.prompt}
              </p>
            ) : null}
          </div>
          <ResultArtifacts
            briefing={focusedSessionDetail?.briefing ?? null}
            dossier={focusedSessionDetail?.dossier ?? null}
            locale={locale}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {focusedSession.taskId ? (
              <Link
                href={`/tasks/${focusedSession.taskId}?session=${encodeURIComponent(focusedSession.id)}`}
                className="inline-flex items-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
              >
                <ArrowRight size={14} />
                {locale.locale === "ko" ? "작업 상세 열기" : "Open task detail"}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <AsyncState
        loading={loading}
        error={error}
        empty={false}
        loadingText={locale.locale === "ko" ? "작업 목록을 불러오는 중..." : "Loading tasks..."}
        onRetry={() => void load()}
      />

      {!loading && !error ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr,1.4fr]">
          <section className="rounded-[28px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-950">
                  {locale.locale === "ko" ? "진행 중 세션" : "Active sessions"}
                </h2>
                <p className="mt-1 text-sm text-neutral-600">
                  {locale.locale === "ko" ? "지금 사람이 다시 봐야 하는 세션만 모아둔다." : "Sessions that still need attention."}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] px-3 py-1 text-xs text-neutral-600">
                <Clock3 size={12} />
                {activeSessions.length}
              </span>
            </div>
            <div className="space-y-3">
              {activeSessions.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-4 py-6 text-sm text-neutral-500">
                  {locale.locale === "ko" ? "현재 진행 중이거나 막힌 세션이 없다." : "There are no active or blocked sessions right now."}
                </p>
              ) : (
                activeSessions.map((session) => (
                  <Link
                    key={session.id}
                    href={hrefForTask(session.taskId, session.id)}
                    id={`session-${session.id}`}
                    className={`block rounded-3xl border px-4 py-4 transition-transform hover:-translate-y-0.5 ${
                      session.id === focusedSessionId ? "border-cyan-300 bg-cyan-50 shadow-sm" : "border-black/10 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-950">{session.title}</p>
                        <p className="mt-1 text-xs leading-5 text-neutral-600">
                          {session.primaryTarget} · {session.status} · {relativeTime(session.updatedAt, locale)}
                        </p>
                      </div>
                      <ArrowRight size={16} className="mt-0.5 shrink-0 text-neutral-500" />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-neutral-950">
                {locale.locale === "ko" ? "Task 목록" : "Task list"}
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                {locale.locale === "ko" ? "세션보다 오래 남는 원본 작업은 여기서 확인한다." : "This is the durable record behind each session."}
              </p>
            </div>
            <div className="space-y-3">
              {taskRows.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-4 py-6 text-sm text-neutral-500">
                  {locale.locale === "ko" ? "아직 생성된 작업이 없다." : "No tasks have been created yet."}
                </p>
              ) : (
                taskRows.map((task) => (
                  <Link
                    key={task.id}
                    href={task.href}
                    className="block rounded-3xl border border-black/10 bg-white px-4 py-4 transition-transform hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-950">{task.title}</p>
                        <p className="mt-1 text-xs leading-5 text-neutral-600">
                          {task.mode.toUpperCase()} · {relativeTime(task.updatedAt, locale)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <TaskStatusBadge status={task.status} />
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
