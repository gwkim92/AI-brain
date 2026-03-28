"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  FileStack,
  GitBranch,
  RefreshCw,
  ShieldAlert,
  TimerReset,
  TriangleAlert,
  Workflow,
  XCircle,
} from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { cancelRunnerRun, getRunnerRun, getRunnerState, requestRunnerRefresh, validateRunnerWorkflow } from "@/lib/api/endpoints";
import type {
  ArtifactRecord,
  ExecutionGraphNode,
  ExecutionGraphNodeStatus,
  GraphNodeRunRecord,
  RunnerRunDetail,
  RunnerRunRecord,
  RunnerSnapshot,
  RunnerWorkflowValidationResult,
} from "@/lib/api/runner-types";
import { useLocale } from "@/components/providers/LocaleProvider";

function formatDateTime(input: string | null, locale: "ko" | "en"): string {
  if (!input) return locale === "ko" ? "없음" : "None";
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(input));
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateValue(value: unknown, maxLength = 220): string {
  const text = formatValue(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function statusTone(status: RunnerRunRecord["status"]): string {
  if (status === "human_review_ready") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "failed_terminal" || status === "cancelled") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  if (status === "blocked_needs_approval") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "retry_queued") return "border-orange-500/30 bg-orange-500/10 text-orange-200";
  return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
}

function nodeTone(status: ExecutionGraphNodeStatus): string {
  if (status === "completed") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-100";
  if (status === "running") return "border-cyan-500/25 bg-cyan-500/10 text-cyan-100";
  if (status === "blocked") return "border-amber-500/25 bg-amber-500/10 text-amber-100";
  if (status === "failed") return "border-rose-500/25 bg-rose-500/10 text-rose-100";
  if (status === "skipped") return "border-white/10 bg-white/[0.03] text-white/60";
  return "border-white/10 bg-black/30 text-white/70";
}

function buildTimeline(detail: RunnerRunDetail | null): Array<{ node: ExecutionGraphNode; run: GraphNodeRunRecord | null }> {
  if (!detail?.graph) return [];
  const nodeRuns = new Map(detail.node_runs.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
  return [...detail.graph.nodes]
    .sort((left, right) => left.order - right.order)
    .map((node) => ({
      node,
      run: nodeRuns.get(node.id) ?? null,
    }));
}

function resolveCurrentNode(detail: RunnerRunDetail | null): { node: ExecutionGraphNode; run: GraphNodeRunRecord | null } | null {
  const timeline = buildTimeline(detail);
  if (!detail) return null;
  return (
    timeline.find((entry) => entry.node.id === detail.run.currentNodeId) ??
    timeline.find((entry) => entry.run?.status === "running" || entry.run?.status === "blocked") ??
    null
  );
}

function resolveHaltedReason(detail: RunnerRunDetail | null): string | null {
  if (!detail) return null;
  return (
    detail.run.blockedReason ||
    detail.run.failureReason ||
    detail.node_runs.find((nodeRun) => nodeRun.status === "blocked" || nodeRun.status === "failed")?.error ||
    null
  );
}

function ArtifactCard({
  artifact,
  locale,
}: {
  artifact: ArtifactRecord;
  locale: "ko" | "en";
}) {
  const metadataEntries = Object.entries(artifact.metadata ?? {});

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{artifact.label}</p>
          <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/40">{artifact.type}</p>
        </div>
        <span className="text-[11px] text-white/45">{formatDateTime(artifact.createdAt, locale)}</span>
      </div>

      {artifact.content ? (
        <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-black/50 p-3 text-xs leading-6 text-white/75">
          {truncateValue(artifact.content, 900)}
        </pre>
      ) : null}

      {metadataEntries.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {metadataEntries.map(([key, value]) => (
            <span key={`${artifact.id}:${key}`} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/70">
              {key}={truncateValue(value, 72)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RunnerModule() {
  const { locale } = useLocale();
  const copy = locale === "ko"
    ? {
        title: "Delivery Runner",
        subtitle: "작업 큐, 재시도, 승인 대기, PR 핸드오프를 한 화면에서 본다.",
        refresh: "새로고침",
        requesting: "요청 중...",
        workflow: "Workflow 계약",
        runs: "최근 런",
        runDetail: "선택한 런",
        noRuns: "표시할 runner 런이 없다.",
        noSelection: "상세를 보려면 런 하나를 선택해라.",
        recentErrors: "최근 오류",
        opsMetrics: "운영 Metrics",
        noErrors: "최근 오류 없음",
        validationValid: "유효",
        validationInvalid: "오류",
        cancel: "취소",
        activeSources: "활성 소스",
        dispatchEnabled: "Dispatch",
        command: "명령",
        verification: "검증",
        branch: "브랜치",
        workspace: "워크스페이스",
        updated: "업데이트",
        failed: "실패 사유",
        blocked: "차단 사유",
        noWorkflowErrors: "workflow 오류 없음",
        selectRun: "상세 보기",
        viewing: "선택됨",
        graphStatus: "Graph 상태",
        currentNode: "현재 노드",
        artifacts: "Artifacts",
        nodeTimeline: "Node Timeline",
        sessionState: "Session State",
        haltedReason: "중단 사유",
        artifactCount: "Artifacts 수",
        sessionValues: "State 값",
        promotionKeys: "승격 키",
        noArtifacts: "artifact 없음",
        noStateValues: "표시할 state 값 없음",
        detailLoading: "상세를 불러오는 중...",
        detailLoadFailed: "runner 상세를 불러오지 못했다.",
        none: "없음",
        graphRoute: "Route",
        started: "시작",
        completed: "완료",
        dueRetryRuns: "즉시 재시도 가능",
        stalledRuns: "정체 런",
        terminalCleanupPending: "정리 대기 워크스페이스",
        workflowErrorCount: "Workflow 오류 수",
        recentErrorCount: "최근 오류 수",
      }
    : {
        title: "Delivery Runner",
        subtitle: "Track queue state, retries, approval blocks, and PR handoff in one surface.",
        refresh: "Refresh",
        requesting: "Requesting...",
        workflow: "Workflow Contract",
        runs: "Recent Runs",
        runDetail: "Selected Run",
        noRuns: "No runner runs to display.",
        noSelection: "Select a run to inspect graph execution and artifacts.",
        recentErrors: "Recent Errors",
        opsMetrics: "Operational Metrics",
        noErrors: "No recent runner errors.",
        validationValid: "Valid",
        validationInvalid: "Invalid",
        cancel: "Cancel",
        activeSources: "Active Sources",
        dispatchEnabled: "Dispatch",
        command: "Command",
        verification: "Verification",
        branch: "Branch",
        workspace: "Workspace",
        updated: "Updated",
        failed: "Failure",
        blocked: "Blocked",
        noWorkflowErrors: "No workflow validation errors.",
        selectRun: "Inspect",
        viewing: "Viewing",
        graphStatus: "Graph Status",
        currentNode: "Current Node",
        artifacts: "Artifacts",
        nodeTimeline: "Node Timeline",
        sessionState: "Session State",
        haltedReason: "Halted Reason",
        artifactCount: "Artifacts",
        sessionValues: "State Values",
        promotionKeys: "Promotion Keys",
        noArtifacts: "No artifacts recorded.",
        noStateValues: "No session state values recorded.",
        detailLoading: "Loading run detail...",
        detailLoadFailed: "Failed to load runner detail.",
        none: "None",
        graphRoute: "Route",
        started: "Started",
        completed: "Completed",
        dueRetryRuns: "Due Retries",
        stalledRuns: "Stalled Runs",
        terminalCleanupPending: "Cleanup Pending",
        workflowErrorCount: "Workflow Errors",
        recentErrorCount: "Recent Errors",
      };

  const [snapshot, setSnapshot] = useState<RunnerSnapshot | null>(null);
  const [workflow, setWorkflow] = useState<RunnerWorkflowValidationResult | null>(null);
  const [detail, setDetail] = useState<RunnerRunDetail | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const requestReload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const [runnerState, workflowState] = await Promise.all([
          getRunnerState(),
          validateRunnerWorkflow(),
        ]);

        if (cancelled) return;
        setSnapshot(runnerState);
        setWorkflow(workflowState);
        setSelectedRunId((current) => {
          if (current && runnerState.runs.some((run) => run.id === current)) {
            return current;
          }
          return runnerState.runs[0]?.id ?? null;
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiRequestError) {
          setError(`${err.code}: ${err.message}`);
        } else {
          setError(locale === "ko" ? "runner 상태를 불러오지 못했다." : "Failed to load runner state.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [locale, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedRunId) {
      setDetail(null);
      setDetailError(null);
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const nextDetail = await getRunnerRun(selectedRunId);
        if (cancelled) return;
        setDetail(nextDetail);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiRequestError) {
          setDetailError(`${err.code}: ${err.message}`);
        } else {
          setDetailError(copy.detailLoadFailed);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, reloadToken, copy.detailLoadFailed]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await requestRunnerRefresh();
      requestReload();
    } finally {
      setRefreshing(false);
    }
  }, [requestReload]);

  const handleCancel = useCallback(async (runId: string) => {
    setBusyRunId(runId);
    try {
      await cancelRunnerRun(runId);
      requestReload();
    } finally {
      setBusyRunId(null);
    }
  }, [requestReload]);

  const selectedRun = snapshot?.runs.find((run) => run.id === selectedRunId) ?? null;
  const selectedDetail = detail?.run.id === selectedRunId ? detail : null;
  const timeline = buildTimeline(selectedDetail);
  const currentNode = resolveCurrentNode(selectedDetail);
  const haltedReason = resolveHaltedReason(selectedDetail);
  const sessionEntries = Object.entries(selectedDetail?.session_state_summary?.values ?? {});
  const promotionKeys = selectedDetail?.session_state_summary?.promotionKeys ?? [];

  return (
    <main className="min-h-screen bg-transparent px-6 py-8 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-cyan-500/20 bg-black/45 p-6 backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.32em] text-cyan-300">System Surface</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{copy.title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">{copy.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-2 self-start rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:border-cyan-400/50 hover:text-cyan-100"
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? copy.requesting : copy.refresh}
            </button>
          </div>
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
          ) : null}
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Claimed", value: snapshot?.stats.claimed ?? 0, icon: <GitBranch size={16} /> },
            { label: "Running", value: snapshot?.stats.running ?? 0, icon: <RefreshCw size={16} /> },
            { label: "Retry Queue", value: snapshot?.stats.retryQueued ?? 0, icon: <TimerReset size={16} /> },
            { label: "Human Review", value: snapshot?.stats.humanReviewReady ?? 0, icon: <CheckCircle2 size={16} /> },
            { label: "Blocked", value: snapshot?.stats.blocked ?? 0, icon: <ShieldAlert size={16} /> },
            { label: "Failed", value: snapshot?.stats.failed ?? 0, icon: <XCircle size={16} /> },
            { label: "Cancelled", value: snapshot?.stats.cancelled ?? 0, icon: <TriangleAlert size={16} /> },
            { label: copy.dispatchEnabled, value: snapshot?.state.dispatchEnabled ? "ON" : "OFF", icon: <Activity size={16} /> },
          ].map((card) => (
            <div key={card.label} className="rounded-3xl border border-white/10 bg-black/40 p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between text-cyan-300">
                {card.icon}
                <span className="text-[10px] font-mono uppercase tracking-[0.28em] text-white/35">{card.label}</span>
              </div>
              <p className="mt-5 text-3xl font-semibold text-white">{card.value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-mono uppercase tracking-[0.28em] text-cyan-300">{copy.opsMetrics}</h2>
            <span className="text-xs text-white/45">{copy.updated}: {formatDateTime(snapshot?.state.updatedAt ?? null, locale)}</span>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {[
              { label: copy.dueRetryRuns, value: snapshot?.metrics.dueRetryRuns ?? 0, icon: <TimerReset size={16} /> },
              { label: copy.stalledRuns, value: snapshot?.metrics.stalledRuns ?? 0, icon: <RefreshCw size={16} /> },
              { label: copy.terminalCleanupPending, value: snapshot?.metrics.terminalCleanupPending ?? 0, icon: <FileStack size={16} /> },
              { label: copy.workflowErrorCount, value: snapshot?.metrics.workflowErrorCount ?? 0, icon: <Workflow size={16} /> },
              { label: copy.recentErrorCount, value: snapshot?.metrics.recentErrorCount ?? 0, icon: <TriangleAlert size={16} /> },
            ].map((card) => (
              <div key={card.label} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center justify-between text-cyan-300">
                  {card.icon}
                  <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/35">{card.label}</span>
                </div>
                <p className="mt-5 text-3xl font-semibold text-white">{card.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono uppercase tracking-[0.28em] text-cyan-300">{copy.workflow}</h2>
              <span
                className={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.2em] ${
                  workflow?.valid
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-200"
                }`}
              >
                {workflow?.valid ? copy.validationValid : copy.validationInvalid}
              </span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/45">{copy.activeSources}</p>
                <p className="mt-2 text-sm text-white">{snapshot?.state.activeSources.join(", ") || "internal_task"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/45">{copy.command}</p>
                <p className="mt-2 break-all text-sm text-white/80">{workflow?.contract?.codex.command ?? "-"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/45">{copy.verification}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(workflow?.contract?.codex.verificationCommands ?? []).map((command) => (
                    <span key={command} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100">
                      {command}
                    </span>
                  ))}
                  {(workflow?.contract?.codex.verificationCommands ?? []).length === 0 ? (
                    <span className="text-sm text-white/60">-</span>
                  ) : null}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/45">Workflow Path</p>
                <p className="mt-2 break-all text-sm text-white/80">{workflow?.source_path ?? snapshot?.state.workflowPath ?? "-"}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/45">Validation</p>
              <div className="mt-3 space-y-2">
                {(workflow?.errors ?? []).length === 0 ? (
                  <p className="text-sm text-white/60">{copy.noWorkflowErrors}</p>
                ) : (
                  workflow?.errors.map((entry) => (
                    <div key={`${entry.path}:${entry.message}`} className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                      <span className="font-mono text-[11px] text-rose-200">{entry.path}</span>
                      <p className="mt-1">{entry.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
            <h2 className="text-sm font-mono uppercase tracking-[0.28em] text-cyan-300">{copy.recentErrors}</h2>
            <div className="mt-5 space-y-3">
              {(snapshot?.state.recentErrors ?? []).length === 0 ? (
                <p className="text-sm text-white/60">{copy.noErrors}</p>
              ) : (
                snapshot?.state.recentErrors.map((entry) => (
                  <div key={`${entry.at}:${entry.message}`} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono text-amber-100">{entry.source ?? "runner"}</span>
                      <span className="text-[11px] text-white/45">{formatDateTime(entry.at, locale)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/80">{entry.message}</p>
                    {entry.runId ? <p className="mt-2 text-[11px] font-mono text-white/45">{entry.runId}</p> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono uppercase tracking-[0.28em] text-cyan-300">{copy.runs}</h2>
              <span className="text-xs text-white/45">{loading ? "..." : `${snapshot?.runs.length ?? 0}`}</span>
            </div>

            <div className="mt-5 space-y-4">
              {!loading && (snapshot?.runs.length ?? 0) === 0 ? (
                <p className="text-sm text-white/60">{copy.noRuns}</p>
              ) : null}

              {snapshot?.runs.map((run) => {
                const selected = run.id === selectedRunId;
                return (
                  <article
                    key={run.id}
                    className={`rounded-3xl border p-5 transition ${
                      selected
                        ? "border-cyan-400/40 bg-cyan-500/10"
                        : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.2em] ${statusTone(run.status)}`}>
                            {run.status.replaceAll("_", " ")}
                          </span>
                          <span className="text-[11px] font-mono text-white/45">{run.workItem.source}</span>
                          <span className="text-[11px] font-mono text-white/45">attempt {run.attemptCount + 1}</span>
                        </div>
                        <h3 className="mt-3 text-lg font-semibold text-white">{run.workItem.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-white/65">{run.workItem.description}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedRunId(run.id)}
                          className={`inline-flex items-center justify-center rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                            selected
                              ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                              : "border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400/50"
                          }`}
                        >
                          {selected ? copy.viewing : copy.selectRun}
                        </button>

                        {(run.status === "running" || run.status === "claimed" || run.status === "retry_queued" || run.status === "blocked_needs_approval") ? (
                          <button
                            type="button"
                            onClick={() => void handleCancel(run.id)}
                            disabled={busyRunId === run.id}
                            className="inline-flex items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition hover:border-rose-400/50 hover:text-rose-100 disabled:cursor-wait disabled:opacity-60"
                          >
                            {busyRunId === run.id ? copy.requesting : copy.cancel}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">{copy.branch}</p>
                        <p className="mt-2 break-all text-sm text-white/85">{run.branchName ?? "-"}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">{copy.workspace}</p>
                        <p className="mt-2 break-all text-sm text-white/85">{run.workspacePath ?? "-"}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">{copy.updated}</p>
                        <p className="mt-2 text-sm text-white/85">{formatDateTime(run.updatedAt, locale)}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">PR</p>
                        {run.prUrl ? (
                          <Link href={run.prUrl} target="_blank" className="mt-2 inline-flex text-sm text-cyan-200 underline decoration-cyan-500/40 underline-offset-4">
                            #{run.prNumber ?? "-"}
                          </Link>
                        ) : (
                          <p className="mt-2 text-sm text-white/60">-</p>
                        )}
                      </div>
                    </div>

                    {run.failureReason ? (
                      <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                        <span className="font-mono text-[11px] text-rose-200">{copy.failed}</span>
                        <p className="mt-1">{run.failureReason}</p>
                      </div>
                    ) : null}

                    {run.blockedReason ? (
                      <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                        <span className="font-mono text-[11px] text-amber-200">{copy.blocked}</span>
                        <p className="mt-1">{run.blockedReason}</p>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono uppercase tracking-[0.28em] text-cyan-300">{copy.runDetail}</h2>
              {selectedRun ? (
                <span className={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.2em] ${statusTone(selectedRun.status)}`}>
                  {selectedRun.status.replaceAll("_", " ")}
                </span>
              ) : null}
            </div>

            {!selectedRun ? (
              <p className="mt-5 text-sm text-white/60">{copy.noSelection}</p>
            ) : null}

            {selectedRun && detailLoading ? (
              <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">{copy.detailLoading}</div>
            ) : null}

            {selectedRun && detailError ? (
              <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{detailError}</div>
            ) : null}

            {selectedRun && selectedDetail ? (
              <div className="mt-5 space-y-5">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{selectedDetail.run.workItem.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-white/65">{selectedDetail.run.workItem.description}</p>
                    </div>
                    <div className="text-right text-[11px] font-mono text-white/45">
                      <p>{selectedDetail.run.id}</p>
                      <p className="mt-1">{selectedDetail.run.graphRunId ?? copy.none}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">{copy.graphStatus}</p>
                    <p className="mt-2 text-base font-semibold text-white">{selectedDetail.run.graphRun?.status ?? copy.none}</p>
                    <p className="mt-1 text-xs text-white/45">{formatDateTime(selectedDetail.run.graphRun?.updatedAt ?? selectedDetail.run.updatedAt, locale)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">{copy.currentNode}</p>
                    <p className="mt-2 text-base font-semibold text-white">{currentNode?.node.title ?? copy.none}</p>
                    <p className="mt-1 text-xs text-white/45">{currentNode?.node.key ?? "-"}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">{copy.haltedReason}</p>
                    <p className="mt-2 text-sm leading-6 text-white/80">{haltedReason ?? copy.none}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">{copy.artifactCount}</p>
                    <p className="mt-2 text-base font-semibold text-white">{selectedDetail.artifacts.length}</p>
                    <p className="mt-1 text-xs text-white/45">
                      {copy.started}: {formatDateTime(selectedDetail.run.startedAt, locale)} / {copy.completed}: {formatDateTime(selectedDetail.run.completedAt, locale)}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center gap-2 text-cyan-200">
                    <Workflow size={16} />
                    <h3 className="text-sm font-mono uppercase tracking-[0.2em]">{copy.nodeTimeline}</h3>
                  </div>
                  <div className="mt-4 space-y-3">
                    {timeline.map((entry) => (
                      <div key={entry.node.id} className={`rounded-2xl border p-4 ${nodeTone(entry.run?.status ?? "pending")}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">#{entry.node.order}</span>
                              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-white/70">
                                {entry.node.kind}
                              </span>
                              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-white/70">
                                {entry.run?.status ?? "pending"}
                              </span>
                            </div>
                            <p className="mt-3 text-sm font-semibold text-white">{entry.node.title}</p>
                            <p className="mt-1 text-sm leading-6 text-white/70">{entry.node.description}</p>
                          </div>
                          <div className="text-right text-[11px] text-white/45">
                            <p>{copy.started}: {formatDateTime(entry.run?.startedAt ?? null, locale)}</p>
                            <p className="mt-1">{copy.completed}: {formatDateTime(entry.run?.completedAt ?? null, locale)}</p>
                          </div>
                        </div>

                        {entry.node.route ? (
                          <p className="mt-3 text-[11px] font-mono text-white/45">{copy.graphRoute}: {entry.node.route}</p>
                        ) : null}
                        {entry.run?.summary ? (
                          <p className="mt-3 text-sm leading-6 text-white/80">{entry.run.summary}</p>
                        ) : null}
                        {entry.run?.error ? (
                          <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{entry.run.error}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center gap-2 text-cyan-200">
                    <Activity size={16} />
                    <h3 className="text-sm font-mono uppercase tracking-[0.2em]">{copy.sessionState}</h3>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">Status</p>
                      <p className="mt-2 text-sm font-semibold text-white">{selectedDetail.session_state_summary?.status ?? copy.none}</p>
                      <p className="mt-1 text-xs text-white/45">{formatDateTime(selectedDetail.session_state_summary?.updatedAt ?? null, locale)}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">{copy.promotionKeys}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {promotionKeys.length === 0 ? (
                          <span className="text-sm text-white/60">{copy.none}</span>
                        ) : (
                          promotionKeys.map((key) => (
                            <span key={key} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100">
                              {key}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">{copy.sessionValues}</p>
                    {sessionEntries.length === 0 ? (
                      <p className="mt-3 text-sm text-white/60">{copy.noStateValues}</p>
                    ) : (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {sessionEntries.map(([key, value]) => (
                          <div key={key} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">{key}</p>
                            <p className="mt-2 break-words text-sm leading-6 text-white/80">{truncateValue(value, 240)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center gap-2 text-cyan-200">
                    <FileStack size={16} />
                    <h3 className="text-sm font-mono uppercase tracking-[0.2em]">{copy.artifacts}</h3>
                  </div>
                  {selectedDetail.artifacts.length === 0 ? (
                    <p className="mt-4 text-sm text-white/60">{copy.noArtifacts}</p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {selectedDetail.artifacts.map((artifact) => (
                        <ArtifactCard key={artifact.id} artifact={artifact} locale={locale} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
