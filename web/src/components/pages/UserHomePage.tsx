"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleAlert, Clock3, Sparkles } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { listJarvisSessions, listTasks, listUpgradeProposals } from "@/lib/api/endpoints";
import type { JarvisSessionRecord, TaskRecord, UpgradeProposalRecord } from "@/lib/api/types";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";
import { useLocale } from "@/components/providers/LocaleProvider";
import { AsyncState } from "@/components/ui/AsyncState";

type WorkCard = {
  id: string;
  title: string;
  meta: string;
  href: string;
  tone: "neutral" | "attention" | "done";
};

function relativeTime(value: string, locale: ReturnType<typeof useLocale>): string {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return value;
  const diffSec = Math.max(0, Math.floor((Date.now() - target) / 1000));
  if (diffSec < 60) return locale.t("tasks.relative.justNow");
  if (diffSec < 3600) return locale.t("tasks.relative.minutesAgo", { value: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return locale.t("tasks.relative.hoursAgo", { value: Math.floor(diffSec / 3600) });
  return locale.t("tasks.relative.daysAgo", { value: Math.floor(diffSec / 86400) });
}

function buildTaskHref(taskId?: string | null, sessionId?: string | null): string {
  if (taskId && taskId.trim().length > 0) {
    return `/tasks/${taskId}`;
  }
  if (sessionId && sessionId.trim().length > 0) {
    return `/tasks?session=${encodeURIComponent(sessionId)}`;
  }
  return "/tasks";
}

function cardToneClass(tone: WorkCard["tone"]): string {
  if (tone === "attention") {
    return "border-amber-300/80 bg-amber-50";
  }
  if (tone === "done") {
    return "border-emerald-200 bg-emerald-50";
  }
  return "border-black/10 bg-white";
}

function SectionCard({
  title,
  description,
  items,
  emptyLabel,
}: {
  title: string;
  description: string;
  items: WorkCard[];
  emptyLabel: string;
}) {
  return (
    <section className="rounded-[28px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-950">{title}</h2>
        <p className="mt-1 text-sm text-neutral-600">{description}</p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-4 py-6 text-sm text-neutral-500">
          {emptyLabel}
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={`block rounded-3xl border px-4 py-4 transition-transform hover:-translate-y-0.5 ${cardToneClass(item.tone)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-950">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-600">{item.meta}</p>
                </div>
                <ArrowRight size={16} className="mt-0.5 shrink-0 text-neutral-500" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function UserHomePage() {
  const locale = useLocale();
  const role = useCurrentRole();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [sessions, setSessions] = useState<JarvisSessionRecord[]>([]);
  const [proposals, setProposals] = useState<UpgradeProposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [taskRows, sessionResult, proposalResult] = await Promise.all([
        listTasks({ limit: 16 }),
        listJarvisSessions({ limit: 12 }),
        hasMinRole(role, "operator") ? listUpgradeProposals({ status: "proposed" }) : Promise.resolve({ proposals: [] }),
      ]);
      setTasks(taskRows);
      setSessions(sessionResult.sessions);
      setProposals(proposalResult.proposals);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(locale.locale === "ko" ? "홈 상태를 불러오지 못했다." : "Failed to load the home overview.");
      }
    } finally {
      setLoading(false);
    }
  }, [locale.locale, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const continueItems = useMemo<WorkCard[]>(() => {
    const runningTasks = tasks
      .filter((task) => task.status === "running" || task.status === "queued" || task.status === "retrying")
      .slice(0, 4)
      .map((task) => ({
        id: `task-${task.id}`,
        title: task.title,
        meta: `${task.mode.toUpperCase()} · ${relativeTime(task.updatedAt, locale)}`,
        href: buildTaskHref(task.id),
        tone: "neutral" as const,
      }));
    const liveSessions = sessions
      .filter((session) => session.status === "running" || session.status === "queued")
      .slice(0, Math.max(0, 4 - runningTasks.length))
      .map((session) => ({
        id: `session-${session.id}`,
        title: session.title,
        meta: `${session.primaryTarget} · ${relativeTime(session.updatedAt, locale)}`,
        href: buildTaskHref(session.taskId, session.id),
        tone: "neutral" as const,
      }));
    return [...runningTasks, ...liveSessions].slice(0, 4);
  }, [locale, sessions, tasks]);

  const approvalItems = useMemo<WorkCard[]>(() => {
    const sessionApprovals = sessions
      .filter((session) => session.status === "needs_approval" || session.status === "blocked" || session.status === "stale")
      .slice(0, 4)
      .map((session) => ({
        id: `approval-session-${session.id}`,
        title: session.title,
        meta: `${session.status} · ${relativeTime(session.updatedAt, locale)}`,
        href: "/approvals",
        tone: "attention" as const,
      }));
    const proposalItems = proposals
      .slice(0, Math.max(0, 4 - sessionApprovals.length))
      .map((proposal) => ({
        id: `approval-proposal-${proposal.id}`,
        title: proposal.proposalTitle,
        meta: `${locale.locale === "ko" ? "운영자 제안" : "Operator proposal"} · ${relativeTime(proposal.approvedAt ?? proposal.createdAt, locale)}`,
        href: "/approvals",
        tone: "attention" as const,
      }));
    return [...sessionApprovals, ...proposalItems].slice(0, 4);
  }, [locale, proposals, sessions]);

  const recentItems = useMemo<WorkCard[]>(() => {
    const taskItems = tasks
      .filter((task) => task.status === "done")
      .slice(0, 4)
      .map((task) => ({
        id: `recent-task-${task.id}`,
        title: task.title,
        meta: `${task.mode.toUpperCase()} · ${relativeTime(task.updatedAt, locale)}`,
        href: buildTaskHref(task.id),
        tone: "done" as const,
      }));
    return taskItems;
  }, [locale, tasks]);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">
              {locale.locale === "ko" ? "기본 진입" : "Default entry"}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-950">
              {locale.locale === "ko" ? "지금 봐야 할 일부터 바로 시작한다." : "Start from what needs your attention now."}
            </h1>
            <p className="mt-3 text-base leading-7 text-neutral-600">
              {locale.locale === "ko"
                ? "Home은 더 이상 HUD가 아니다. 위 입력창으로 새 작업을 시작하고, 아래에서 이어서 할 일과 승인 항목, 최근 결과를 바로 확인한다."
                : "Home is no longer a widget desktop. Start new work from the prompt above, then continue active work, approvals, and recent outputs below."}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm text-neutral-700 sm:grid-cols-3">
            <div className="rounded-3xl border border-black/10 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-neutral-500"><Clock3 size={16} /> {locale.locale === "ko" ? "진행 중" : "In flight"}</div>
              <p className="mt-3 text-2xl font-semibold text-neutral-950">{continueItems.length}</p>
            </div>
            <div className="rounded-3xl border border-black/10 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-neutral-500"><CircleAlert size={16} /> {locale.locale === "ko" ? "판단 필요" : "Needs review"}</div>
              <p className="mt-3 text-2xl font-semibold text-neutral-950">{approvalItems.length}</p>
            </div>
            <div className="rounded-3xl border border-black/10 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-neutral-500"><Sparkles size={16} /> {locale.locale === "ko" ? "최근 결과" : "Recent output"}</div>
              <p className="mt-3 text-2xl font-semibold text-neutral-950">{recentItems.length}</p>
            </div>
          </div>
        </div>
      </section>

      <AsyncState
        loading={loading}
        error={error}
        empty={false}
        loadingText={locale.locale === "ko" ? "홈 상태를 불러오는 중..." : "Loading the home overview..."}
        onRetry={() => void load()}
      />

      {!loading && !error ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <SectionCard
            title={locale.locale === "ko" ? "지금 이어서 할 일" : "Continue work"}
            description={locale.locale === "ko" ? "현재 진행 중이거나 바로 다시 볼 가치가 있는 작업이다." : "Work that is actively moving or worth reopening now."}
            items={continueItems}
            emptyLabel={locale.locale === "ko" ? "현재 진행 중인 작업이 없다." : "There is no active work right now."}
          />
          <SectionCard
            title={locale.locale === "ko" ? "응답/승인이 필요한 일" : "Needs your decision"}
            description={locale.locale === "ko" ? "막힌 세션, 승인 필요 액션, 운영 제안을 한곳에서 본다." : "Review blocked sessions, approvals, and operator proposals in one place."}
            items={approvalItems}
            emptyLabel={locale.locale === "ko" ? "지금 판단이 필요한 항목이 없다." : "Nothing needs your decision right now."}
          />
          <SectionCard
            title={locale.locale === "ko" ? "최근 결과" : "Recent outputs"}
            description={locale.locale === "ko" ? "방금 끝난 작업과 다시 참조할 결과를 빠르게 연다." : "Open the latest completed work without hunting through system state."}
            items={recentItems}
            emptyLabel={locale.locale === "ko" ? "아직 최근 결과가 없다." : "No recent outputs yet."}
          />
        </div>
      ) : null}
    </div>
  );
}
