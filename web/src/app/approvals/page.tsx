"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { approveJarvisAction, decideUpgradeProposal, getJarvisSession, listJarvisSessions, listUpgradeProposals, rejectJarvisAction } from "@/lib/api/endpoints";
import type { ActionProposalRecord, BriefingRecord, DossierRecord, JarvisSessionDetail, JarvisSessionRecord, UpgradeProposalRecord } from "@/lib/api/types";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";
import { AsyncState } from "@/components/ui/AsyncState";
import { useLocale } from "@/components/providers/LocaleProvider";

type SessionDetailMap = Record<string, JarvisSessionDetail>;

function relativeTime(value: string, locale: ReturnType<typeof useLocale>): string {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return value;
  const diffSec = Math.max(0, Math.floor((Date.now() - target) / 1000));
  if (diffSec < 60) return locale.t("tasks.relative.justNow");
  if (diffSec < 3600) return locale.t("tasks.relative.minutesAgo", { value: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return locale.t("tasks.relative.hoursAgo", { value: Math.floor(diffSec / 3600) });
  return locale.t("tasks.relative.daysAgo", { value: Math.floor(diffSec / 86400) });
}

function taskHrefForSession(session: JarvisSessionRecord): string {
  if (session.taskId) {
    return `/tasks/${session.taskId}?session=${encodeURIComponent(session.id)}`;
  }
  return `/tasks?session=${encodeURIComponent(session.id)}`;
}

function describeSessionStatus(session: JarvisSessionRecord, locale: ReturnType<typeof useLocale>): string {
  if (session.status === "needs_approval") {
    return locale.locale === "ko"
      ? "이 세션은 사람 승인이 있어야 다음 단계로 진행된다."
      : "This session needs human approval before it can continue.";
  }
  if (session.status === "blocked") {
    return locale.locale === "ko"
      ? "세션이 막혀 있다. 아래 제안 액션이나 작업 상세를 보고 판단해야 한다."
      : "This session is blocked. Review the proposed action or open the task detail to decide what to do next.";
  }
  if (session.status === "completed") {
    return locale.locale === "ko"
      ? "승인이 반영됐고 결과가 생성됐다. 아래 결과를 바로 확인해라."
      : "The approval has been applied and results are ready below.";
  }
  return locale.locale === "ko"
    ? "세션이 오래되어 다시 판단이 필요하다."
    : "This session has gone stale and needs a fresh review.";
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
          title="Dossier"
          summary={dossier.summary}
          body={dossier.answerMarkdown}
          status={dossier.status}
          locale={locale}
        />
      ) : null}
    </div>
  );
}

function ProposalCard({
  proposal,
  onDecide,
  busy,
}: {
  proposal: UpgradeProposalRecord;
  onDecide: (proposalId: string, decision: "approve" | "reject") => void;
  busy: boolean;
}) {
  const locale = useLocale();
  return (
    <div className="rounded-3xl border border-black/10 bg-white p-5">
      <p className="text-sm font-semibold text-neutral-950">{proposal.proposalTitle}</p>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          {locale.locale === "ko"
            ? `상태 ${proposal.status.toUpperCase()} · ${relativeTime(proposal.approvedAt ?? proposal.createdAt, locale)}`
            : `${proposal.status.toUpperCase()} · ${relativeTime(proposal.approvedAt ?? proposal.createdAt, locale)}`}
        </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(proposal.id, "approve")}
          className="rounded-2xl bg-neutral-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {locale.locale === "ko" ? "승인" : "Approve"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(proposal.id, "reject")}
          className="rounded-2xl border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-40"
        >
          {locale.locale === "ko" ? "거절" : "Reject"}
        </button>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const locale = useLocale();
  const role = useCurrentRole();
  const canOperate = hasMinRole(role, "operator");
  const [sessions, setSessions] = useState<JarvisSessionRecord[]>([]);
  const [sessionDetails, setSessionDetails] = useState<SessionDetailMap>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<JarvisSessionDetail | null>(null);
  const [proposals, setProposals] = useState<UpgradeProposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [actingActionId, setActingActionId] = useState<string | null>(null);
  const selectedDetailRef = useRef<HTMLDivElement | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    const cached = sessionDetails[sessionId];
    if (cached) {
      setSelectedSessionId(sessionId);
      setSelectedSessionDetail(cached);
      return;
    }
    try {
      const detail = await getJarvisSession(sessionId);
      setSelectedSessionId(sessionId);
      setSessionDetails((current) => ({ ...current, [sessionId]: detail }));
      setSelectedSessionDetail(detail);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(locale.locale === "ko" ? "세션 상세를 불러오지 못했다." : "Failed to load the session detail.");
      }
      setSelectedSessionDetail(null);
    }
  }, [locale.locale, sessionDetails]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sessionResult, proposalResult] = await Promise.all([
        listJarvisSessions({ limit: 16 }),
        canOperate ? listUpgradeProposals({ status: "proposed" }) : Promise.resolve({ proposals: [] }),
      ]);
      const detailEntries = await Promise.all(
        sessionResult.sessions.map(async (session) => {
          try {
            const detail = await getJarvisSession(session.id);
            return [session.id, detail] as const;
          } catch {
            return [session.id, null] as const;
          }
        })
      );
      const nextSessionDetails = Object.fromEntries(
        detailEntries.filter((entry): entry is readonly [string, JarvisSessionDetail] => entry[1] !== null)
      );
      setSessions(sessionResult.sessions);
      setSessionDetails(nextSessionDetails);
      setProposals(proposalResult.proposals);
      const preservedSelection =
        selectedSessionIdRef.current && sessionResult.sessions.some((session) => session.id === selectedSessionIdRef.current)
          ? selectedSessionIdRef.current
          : null;
      setSelectedSessionId(preservedSelection);
      if (preservedSelection && nextSessionDetails[preservedSelection]) {
        setSelectedSessionDetail(nextSessionDetails[preservedSelection]);
      } else {
        setSelectedSessionDetail(null);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(locale.locale === "ko" ? "승인 허브를 불러오지 못했다." : "Failed to load approvals.");
      }
    } finally {
      setLoading(false);
    }
  }, [canOperate, locale.locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const sessionApprovals = useMemo(() => {
    return sessions.filter((session) => session.status === "needs_approval" || session.status === "blocked" || session.status === "stale");
  }, [sessions]);

  const actionableSessions = useMemo(() => {
    return sessionApprovals.filter((session) => (sessionDetails[session.id]?.actions ?? []).some((action) => action.status === "pending"));
  }, [sessionApprovals, sessionDetails]);

  const reviewOnlySessions = useMemo(() => {
    return sessionApprovals.filter((session) => !actionableSessions.some((row) => row.id === session.id));
  }, [actionableSessions, sessionApprovals]);

  const decide = async (proposalId: string, decision: "approve" | "reject") => {
    setBusyProposalId(proposalId);
    try {
      await decideUpgradeProposal(proposalId, { decision });
      await load();
    } finally {
      setBusyProposalId(null);
    }
  };

  const pendingActions = useMemo(() => {
    return selectedSessionDetail?.actions.filter((action) => action.status === "pending") ?? [];
  }, [selectedSessionDetail]);

  useEffect(() => {
    if (!selectedSessionDetail || !selectedDetailRef.current) {
      return;
    }
    selectedDetailRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedSessionDetail]);

  const decideSessionAction = async (
    sessionId: string,
    action: ActionProposalRecord,
    decision: "approve" | "reject"
  ) => {
    setActingActionId(action.id);
    setError(null);
    try {
      const targetDetail =
        selectedSessionDetail?.session.id === sessionId
          ? selectedSessionDetail
          : sessionDetails[sessionId] ?? await getJarvisSession(sessionId);
      setSelectedSessionId(sessionId);
      setSelectedSessionDetail(targetDetail);
      setSessionDetails((current) => ({
        ...current,
        [sessionId]: targetDetail,
      }));
      if (decision === "approve") {
        await approveJarvisAction(sessionId, action.id);
      } else {
        await rejectJarvisAction(sessionId, action.id);
      }
      await load();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(locale.locale === "ko" ? "세션 승인을 처리하지 못했다." : "Failed to process the session decision.");
      }
    } finally {
      setActingActionId(null);
    }
  };

  return (
    <main className="space-y-6">
      <section className="rounded-[32px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">
          {locale.locale === "ko" ? "판단 허브" : "Decision hub"}
        </p>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight text-neutral-950">
          <ShieldCheck size={28} />
          {locale.locale === "ko" ? "사람 판단이 필요한 일만 모은다." : "Only the items that need a human decision."}
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-neutral-600">
          {locale.locale === "ko"
            ? "여기서는 막힌 세션과 운영자 승인 제안을 같이 본다. Action Center를 따로 찾을 필요가 없다."
            : "Blocked sessions and upgrade proposals live together here. There is no separate action center to hunt for."}
        </p>
      </section>

      <AsyncState
        loading={loading}
        error={error}
        empty={false}
        loadingText={locale.locale === "ko" ? "승인 항목을 불러오는 중..." : "Loading approval items..."}
        onRetry={() => void load()}
      />

      {!loading && !error ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[28px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-neutral-950">
                {locale.locale === "ko" ? "세션 승인 / 막힌 작업" : "Session approvals / blocked work"}
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                {locale.locale === "ko" ? "여기서 세션을 고르고 바로 승인/거절하거나 작업 상세로 들어간다." : "Pick a session here, then approve, reject, or open the task detail immediately."}
              </p>
            </div>
            {sessionApprovals.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-4 py-6 text-sm text-neutral-500">
                {locale.locale === "ko" ? "현재 막힌 세션이 없다." : "There are no blocked sessions right now."}
              </p>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
                <div className="space-y-3">
                  {actionableSessions.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
                        {locale.locale === "ko" ? "바로 승인 가능한 세션" : "Ready-to-decide sessions"}
                      </p>
                      {actionableSessions.map((session) => {
                        const previewAction = sessionDetails[session.id]?.actions.find((action) => action.status === "pending") ?? null;
                        return (
                          <div
                            key={session.id}
                            className={`rounded-3xl border px-4 py-4 transition-transform hover:-translate-y-0.5 ${
                              selectedSessionId === session.id ? "border-cyan-300 bg-cyan-50 shadow-sm" : "border-amber-200 bg-amber-50"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-neutral-950">{session.title}</p>
                                <p className="mt-1 text-xs leading-5 text-neutral-700">
                                  {session.status} · {relativeTime(session.updatedAt, locale)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void loadSessionDetail(session.id)}
                                className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
                              >
                                <ArrowRight size={14} />
                                {locale.locale === "ko" ? "세션 보기" : "Inspect"}
                              </button>
                            </div>
                            {previewAction ? (
                              <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-4">
                                <p className="text-sm font-semibold text-neutral-950">{previewAction.title}</p>
                                <p className="mt-2 text-sm leading-6 text-neutral-600">{previewAction.summary}</p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={actingActionId === previewAction.id}
                                    onClick={() => void decideSessionAction(session.id, previewAction, "approve")}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                                  >
                                    <CheckCircle2 size={14} />
                                    {locale.locale === "ko" ? "승인" : "Approve"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={actingActionId === previewAction.id}
                                    onClick={() => void decideSessionAction(session.id, previewAction, "reject")}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40"
                                  >
                                    <XCircle size={14} />
                                    {locale.locale === "ko" ? "거절" : "Reject"}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {reviewOnlySessions.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
                        {locale.locale === "ko" ? "검토가 필요한 세션" : "Review-needed sessions"}
                      </p>
                      {reviewOnlySessions.map((session) => (
                        <div
                          key={session.id}
                          className={`rounded-3xl border px-4 py-4 transition-transform hover:-translate-y-0.5 ${
                            selectedSessionId === session.id ? "border-cyan-300 bg-cyan-50 shadow-sm" : "border-neutral-200 bg-white"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-neutral-950">{session.title}</p>
                              <p className="mt-1 text-xs leading-5 text-neutral-700">
                                {session.status} · {relativeTime(session.updatedAt, locale)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void loadSessionDetail(session.id)}
                              className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
                            >
                              <ArrowRight size={14} />
                              {locale.locale === "ko" ? "세션 보기" : "Inspect"}
                            </button>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-neutral-600">{describeSessionStatus(session, locale)}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link
                              href={taskHrefForSession(session)}
                              className="inline-flex items-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
                            >
                              <ArrowRight size={14} />
                              {locale.locale === "ko" ? "작업 상세 열기" : "Open task detail"}
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div
                  ref={selectedDetailRef}
                  className="rounded-3xl border border-cyan-200 bg-cyan-50 p-5 xl:sticky xl:top-24"
                >
                  {selectedSessionDetail ? (
                    <>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-700">
                        {locale.locale === "ko" ? "선택한 세션" : "Selected session"}
                      </p>
                      <h3 className="mt-2 text-base font-semibold text-neutral-950">{selectedSessionDetail.session.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-neutral-700">
                        {describeSessionStatus(selectedSessionDetail.session, locale)}
                      </p>
                      <p className="mt-3 text-xs leading-5 text-neutral-600">
                        {selectedSessionDetail.session.prompt}
                      </p>

                      {pendingActions.length === 0 ? (
                        <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-4">
                          <p className="text-sm font-semibold text-neutral-950">
                            {selectedSessionDetail.session.status === "completed"
                              ? locale.locale === "ko"
                                ? "승인이 반영됐고 결과가 생성됐다."
                                : "The approval has been applied and results are ready."
                              : locale.locale === "ko"
                                ? "지금 바로 승인할 액션은 없다."
                                : "There is no pending action to approve right now."}
                          </p>
                          <p className="mt-1 text-sm text-neutral-600">
                            {selectedSessionDetail.session.status === "completed"
                              ? locale.locale === "ko"
                                ? "아래 결과를 바로 확인하거나 작업 화면으로 이동해 전체 맥락을 봐라."
                                : "Review the generated results below or move to the task screen for the full context."
                              : locale.locale === "ko"
                                ? "작업 상세로 들어가 진행 기록과 출력, 타임라인을 확인해라."
                                : "Open the task detail to inspect the timeline, outputs, and recent state."}
                          </p>
                          <div className="mt-4">
                            <Link
                              href={taskHrefForSession(selectedSessionDetail.session)}
                              className="inline-flex items-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
                            >
                              <ArrowRight size={14} />
                              {locale.locale === "ko" ? "작업 상세 열기" : "Open task detail"}
                            </Link>
                          </div>
                          <ResultArtifacts
                            briefing={selectedSessionDetail.briefing}
                            dossier={selectedSessionDetail.dossier}
                            locale={locale}
                          />
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3">
                          {pendingActions.map((action) => (
                            <div key={action.id} className="rounded-2xl border border-black/10 bg-white px-4 py-4">
                              <p className="text-sm font-semibold text-neutral-950">{action.title}</p>
                              <p className="mt-2 text-sm leading-6 text-neutral-600">{action.summary}</p>
                              <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={actingActionId === action.id}
                                  onClick={() => void decideSessionAction(selectedSessionDetail.session.id, action, "approve")}
                                  className="inline-flex items-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                                >
                                  <CheckCircle2 size={14} />
                                  {locale.locale === "ko" ? "승인" : "Approve"}
                                </button>
                                <button
                                  type="button"
                                  disabled={actingActionId === action.id}
                                  onClick={() => void decideSessionAction(selectedSessionDetail.session.id, action, "reject")}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40"
                                >
                                  <XCircle size={14} />
                                  {locale.locale === "ko" ? "거절" : "Reject"}
                                </button>
                                <Link
                                  href={taskHrefForSession(selectedSessionDetail.session)}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
                                >
                                  <ArrowRight size={14} />
                                  {locale.locale === "ko" ? "작업 상세" : "Task detail"}
                                </Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-neutral-500">
                      {locale.locale === "ko"
                        ? "왼쪽에서 세션을 선택하면 여기서 바로 승인/거절과 다음 행동이 열린다."
                        : "Select a session on the left to open approvals and next actions here."}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-neutral-950">
                {locale.locale === "ko" ? "운영 제안" : "Operator proposals"}
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                {locale.locale === "ko"
                  ? "operator/admin만 보는 제안이다."
                  : "These upgrade proposals are visible to operator and admin roles."}
              </p>
            </div>
            {!canOperate ? (
              <p className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-4 py-6 text-sm text-neutral-500">
                {locale.locale === "ko" ? "이 섹션은 operator 이상 역할에서만 본다." : "This section is only visible to operator-level roles."}
              </p>
            ) : proposals.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-4 py-6 text-sm text-neutral-500">
                {locale.locale === "ko" ? "현재 대기 중인 운영 제안이 없다." : "There are no pending operator proposals."}
              </p>
            ) : (
              <div className="space-y-3">
                {proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    onDecide={(proposalId, decision) => void decide(proposalId, decision)}
                    busy={busyProposalId === proposal.id}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
