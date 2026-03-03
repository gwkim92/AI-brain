"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Clock3, PlayCircle, Sparkles, Layers, X } from "lucide-react";
import { useHUD } from "@/components/providers/HUDProvider";
import { ApiRequestError } from "@/lib/api/client";
import { getDashboardOverview, streamDashboardOverviewEvents } from "@/lib/api/endpoints";
import type { TaskRecord, UpgradeProposalRecord } from "@/lib/api/types";
import { getVisualCoreReasonMeta, type VisualCoreReasonSeverity } from "@/lib/visual-core/reason-meta";
import {
    VISUAL_CORE_RUNTIME_STATUS_EVENT,
    type VisualCoreRuntimeReason,
    type VisualCoreRuntimeStatus,
} from "@/components/ui/Jarvis3DCore";
import type { VisualCoreEngine, VisualCoreFailureCode } from "@/lib/visual-core/runtime";
const MAX_APPROVALS = 3;
const MAX_RUNNING_TASKS = 4;

function formatRelativeTime(isoDate: string): string {
    const target = new Date(isoDate).getTime();
    const diffSeconds = Math.round((Date.now() - target) / 1000);

    if (diffSeconds < 60) {
        return "just now";
    }
    if (diffSeconds < 3600) {
        return `${Math.round(diffSeconds / 60)}m ago`;
    }
    if (diffSeconds < 86400) {
        return `${Math.round(diffSeconds / 3600)}h ago`;
    }
    return `${Math.round(diffSeconds / 86400)}d ago`;
}

function classifyProposalRisk(proposal: UpgradeProposalRecord): "HIGH RISK" | "REVIEW" {
    const text = `${proposal.proposalTitle} ${proposal.id}`.toLowerCase();
    if (/(prod|production|deploy|migration|schema|security|auth|payment|rollback)/.test(text)) {
        return "HIGH RISK";
    }
    return "REVIEW";
}

function getReasonSeverityClass(severity: VisualCoreReasonSeverity | undefined): string {
    if (severity === "critical") {
        return "text-rose-300 border-rose-400/30 bg-rose-500/10";
    }
    if (severity === "warn") {
        return "text-amber-300 border-amber-400/30 bg-amber-500/10";
    }
    return "text-cyan-300 border-cyan-400/30 bg-cyan-500/10";
}

function formatSessionIntent(intent?: string): string {
    if (!intent || intent.trim().length === 0) {
        return "GENERAL";
    }
    return intent.trim().toUpperCase();
}

function formatSessionWidget(widgetId: string | null | undefined): string {
    if (!widgetId || widgetId.trim().length === 0) {
        return "none";
    }
    return widgetId.trim();
}

export function RightPanel() {
    const { visualCoreScene, sessions, activeSessionId, switchSession, archiveSession } = useHUD();
    const [pendingApprovals, setPendingApprovals] = useState<UpgradeProposalRecord[]>([]);
    const [runningTasks, setRunningTasks] = useState<TaskRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [runtimeStatus, setRuntimeStatus] = useState<VisualCoreRuntimeStatus>("probing");
    const [runtimeReason, setRuntimeReason] = useState<VisualCoreRuntimeReason>("capability_probe_pending");
    const [runtimeEngine, setRuntimeEngine] = useState<VisualCoreEngine>("cpu");
    const [runtimeFailureCode, setRuntimeFailureCode] = useState<VisualCoreFailureCode>("none");
    const [runtimeSwitchCount, setRuntimeSwitchCount] = useState(0);
    const [runtimeRecovered, setRuntimeRecovered] = useState(false);

    const overlayLabel =
        visualCoreScene && visualCoreScene.overlayFx.length > 0 ? visualCoreScene.overlayFx.join(", ") : "none";
    const reasonMeta = getVisualCoreReasonMeta(visualCoreScene?.reason);
    const reasonLabel = reasonMeta?.label ?? "not initialized";
    const reasonHint = reasonMeta?.operatorHint ?? "Waiting for first scene resolution.";
    const reasonSeverityClass = getReasonSeverityClass(reasonMeta?.severity);
  const approvalCards = useMemo(() => pendingApprovals.slice(0, MAX_APPROVALS), [pendingApprovals]);
  const activeTaskCards = useMemo(() => runningTasks.slice(0, MAX_RUNNING_TASKS), [runningTasks]);

    useEffect(() => {
        let stopped = false;

        const applySnapshot = (snapshot: {
            pending_approvals?: UpgradeProposalRecord[] | null;
            running_tasks?: TaskRecord[] | null;
        } | null | undefined) => {
            if (stopped) {
                return;
            }
            const nextPendingApprovals = Array.isArray(snapshot?.pending_approvals)
                ? snapshot.pending_approvals
                : [];
            const nextRunningTasks = Array.isArray(snapshot?.running_tasks)
                ? snapshot.running_tasks
                : [];
            setPendingApprovals(nextPendingApprovals);
            setRunningTasks(nextRunningTasks);
            setError(null);
            setIsLoading(false);
        };

        const loadInitial = async () => {
            try {
                const snapshot = await getDashboardOverview({
                    task_limit: 120,
                    pending_approval_limit: 30,
                    running_task_limit: 40,
                });
                applySnapshot(snapshot);
            } catch (err) {
                if (stopped) {
                    return;
                }
                if (err instanceof ApiRequestError) {
                    setError(`${err.code}: ${err.message}`);
                } else {
                    setError("failed to load right-panel data");
                }
                setIsLoading(false);
            }
        };

        void loadInitial();

        const stream = streamDashboardOverviewEvents(
            {
                task_limit: 120,
                pending_approval_limit: 30,
                running_task_limit: 40,
                poll_ms: 2000,
                timeout_ms: 45000,
            },
            {
                onUpdated: (payload) => {
                    applySnapshot(payload?.data);
                },
                onError: (err) => {
                    if (stopped) {
                        return;
                    }
                    if (err instanceof ApiRequestError) {
                        setError(`${err.code}: ${err.message}`);
                    } else {
                        setError("dashboard stream disconnected");
                    }
                },
            }
        );

        return () => {
            stopped = true;
            stream.close();
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const onVisualCoreStatus = (event: Event) => {
            const custom = event as CustomEvent<{
                status?: VisualCoreRuntimeStatus;
                reason?: VisualCoreRuntimeReason;
                engine?: VisualCoreEngine;
                failureCode?: VisualCoreFailureCode;
                switchCount?: number;
                isRecovered?: boolean;
            }>;
            if (!custom.detail?.status) {
                return;
            }
            setRuntimeStatus(custom.detail.status);
            setRuntimeReason(custom.detail.reason ?? "capability_probe_pending");
            setRuntimeEngine(custom.detail.engine ?? "cpu");
            setRuntimeFailureCode(custom.detail.failureCode ?? "none");
            setRuntimeSwitchCount(Number.isFinite(custom.detail.switchCount) ? Number(custom.detail.switchCount) : 0);
            setRuntimeRecovered(Boolean(custom.detail.isRecovered));
        };
        window.addEventListener(VISUAL_CORE_RUNTIME_STATUS_EVENT, onVisualCoreStatus as EventListener);
        return () => {
            window.removeEventListener(VISUAL_CORE_RUNTIME_STATUS_EVENT, onVisualCoreStatus as EventListener);
        };
    }, []);

    return (
        <div className="flex flex-col p-6 w-full h-full">

            {/* Sessions */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,255,255,0.6)]"></span>
                        <h3 className="font-bold tracking-widest text-sm text-white/90">SESSIONS</h3>
                    </div>
                    <Layers size={14} className="text-cyan-300" />
                </div>

                <div className="space-y-2">
                    {sessions.length === 0 && (
                        <div className="text-xs font-mono text-white/40 p-3 border border-white/10 rounded-md bg-white/5">
                            No active sessions. Use the command bar to start one.
                        </div>
                    )}
                    {sessions.map((session) => {
                        const isActive = session.id === activeSessionId;
                        return (
                            <div
                                key={session.id}
                                className={`group relative p-3 rounded-md border backdrop-blur-md transition-all ${
                                    isActive
                                        ? "border-cyan-500/40 bg-cyan-950/30 hover:bg-cyan-900/35"
                                        : "border-white/10 border-dashed bg-white/[0.03] hover:bg-white/[0.07] opacity-60 hover:opacity-90"
                                }`}
                                data-testid={`session-card-${session.id}`}
                            >
                                <button
                                    type="button"
                                    onClick={() => switchSession(session.id, { restoreMode: "focus_only" })}
                                    className="w-full text-left"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-xs font-medium truncate ${isActive ? "text-cyan-200" : "text-white/70"}`}>
                                                {session.prompt.length > 40 ? session.prompt.slice(0, 40) + "..." : session.prompt}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span className="text-[10px] font-mono text-white/40">
                                                    {formatRelativeTime(session.createdAt)}
                                                </span>
                                                {session.activeWidgets.length > 0 && (
                                                    <span className="text-[10px] font-mono text-white/30">
                                                        {session.activeWidgets.length} widgets
                                                    </span>
                                                )}
                                                {session.mountedWidgets.length > session.activeWidgets.length && (
                                                    <span className="text-[10px] font-mono text-white/25">
                                                        +{session.mountedWidgets.length - session.activeWidgets.length} mounted
                                                    </span>
                                                )}
                                                {isActive && (
                                                    <span className="text-[9px] font-mono font-bold tracking-wider text-cyan-400">
                                                        ACTIVE
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] font-mono">
                                                <span className="rounded border border-white/15 px-1.5 py-0.5 text-white/50">
                                                    {formatSessionIntent(session.intent)}
                                                </span>
                                                <span className="rounded border border-white/15 px-1.5 py-0.5 text-white/45">
                                                    focus:{formatSessionWidget(session.focusedWidget)}
                                                </span>
                                                <span className="rounded border border-white/15 px-1.5 py-0.5 text-white/45">
                                                    restore:{session.restoreMode}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                                <div className="mt-2 flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            switchSession(session.id, { restoreMode: "full" });
                                        }}
                                        className="rounded border border-cyan-500/35 bg-cyan-500/10 px-2 py-1 text-[9px] font-mono text-cyan-200 hover:bg-cyan-500/20"
                                        data-testid={`session-restore-full-${session.id}`}
                                    >
                                        restore full
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            switchSession(session.id, { restoreMode: "focus_only" });
                                        }}
                                        className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[9px] font-mono text-white/70 hover:bg-white/10"
                                        data-testid={`session-restore-focus-${session.id}`}
                                    >
                                        focus only
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            archiveSession(session.id);
                                        }}
                                        className="ml-auto text-white/40 hover:text-white p-1 rounded"
                                        aria-label={`Archive session ${session.id}`}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Running Tasks */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(0,255,255,0.6)] animate-pulse"></span>
                        <h3 className="font-bold tracking-widest text-sm text-white/90">RUNNING TASKS</h3>
                    </div>
                    <span className="text-xs data-mono text-white/50">{isLoading ? "..." : `${runningTasks.length} Active`}</span>
                </div>

                <div className="space-y-3">
                    {isLoading && <div className="text-xs font-mono text-white/50 p-3 border border-white/10 rounded-md bg-white/5">Loading active tasks...</div>}
                    {!isLoading && activeTaskCards.length === 0 && (
                        <div className="text-xs font-mono text-white/50 p-3 border border-white/10 rounded-md bg-white/5">No active tasks.</div>
                    )}
                    {!isLoading &&
                        activeTaskCards.map((task) => (
                            <Link
                                key={task.id}
                                href={`/tasks/${task.id}`}
                                className="block p-4 rounded-md border border-cyan-500/20 bg-cyan-950/20 backdrop-blur-md transition-colors hover:bg-cyan-900/25"
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2 text-cyan-300">
                                        <PlayCircle size={14} />
                                        <span className="text-xs font-bold tracking-wider font-mono uppercase">{task.mode}</span>
                                    </div>
                                    <span className="text-[10px] font-mono text-white/50 uppercase">{task.status}</span>
                                </div>
                                <p className="text-sm font-medium text-white/90 line-clamp-2">{task.title}</p>
                                <p className="text-[10px] font-mono text-white/40 mt-2">
                                    {task.id.slice(0, 8)} · {formatRelativeTime(task.updatedAt)}
                                </p>
                            </Link>
                        ))}
                </div>
            </div>

            {/* Pending Approvals */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]"></span>
                        <h3 className="font-bold tracking-widest text-sm text-white/90">PENDING APPROVALS</h3>
                    </div>
                    <span className="text-xs data-mono text-white/50">{isLoading ? "..." : `${pendingApprovals.length} Req`}</span>
                </div>

                <div className="space-y-3">
                    {isLoading && <div className="text-xs font-mono text-white/50 p-3 border border-white/10 rounded-md bg-white/5">Loading approvals...</div>}
                    {!isLoading && approvalCards.length === 0 && (
                        <div className="text-xs font-mono text-white/50 p-3 border border-white/10 rounded-md bg-white/5">No pending approvals.</div>
                    )}
                    {!isLoading &&
                        approvalCards.map((proposal) => {
                            const risk = classifyProposalRisk(proposal);
                            const isHighRisk = risk === "HIGH RISK";

                            return (
                                <Link
                                    key={proposal.id}
                                    href={`/approvals?proposal=${proposal.id}`}
                                    className={`block p-4 rounded-md border backdrop-blur-md transition-colors ${isHighRisk ? "border-amber-500/20 bg-amber-950/20 hover:bg-amber-900/25" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                                >
                                    <div className={`flex items-center gap-2 mb-2 ${isHighRisk ? "text-amber-500" : "text-blue-400"}`}>
                                        {isHighRisk ? <AlertCircle size={14} /> : <Clock3 size={14} />}
                                        <span className="text-xs font-bold tracking-wider">{risk}</span>
                                    </div>
                                    <p className="text-sm font-medium text-white/90">{proposal.proposalTitle}</p>
                                    <p className="text-[10px] font-mono text-white/40 mt-2">
                                        {proposal.id.slice(0, 8)} · {formatRelativeTime(proposal.createdAt)}
                                    </p>
                                </Link>
                            );
                        })}
                </div>
            </div>

            {/* Visual Core Debug */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,0.6)]"></span>
                        <h3 className="font-bold tracking-widest text-sm text-white/90">VISUAL CORE</h3>
                    </div>
                    <Sparkles size={14} className="text-fuchsia-300" />
                </div>

                <div className="p-4 rounded-md border border-fuchsia-500/20 bg-fuchsia-950/20 backdrop-blur-md space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">BASE MODE</span>
                        <span className="text-fuchsia-300">{visualCoreScene?.baseMode ?? "n/a"}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">OVERLAY FX</span>
                        <span className="text-fuchsia-200">{overlayLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">PRIORITY</span>
                        <span className="text-fuchsia-100">{visualCoreScene?.priority ?? "-"}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">RUNTIME STATUS</span>
                        <span className="text-fuchsia-200">{runtimeStatus}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">ENGINE</span>
                        <span className="text-fuchsia-200">{runtimeEngine}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">FAILURE CODE</span>
                        <span className="text-fuchsia-100 break-all text-right">{runtimeFailureCode}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">SWITCH COUNT</span>
                        <span className="text-fuchsia-100">{runtimeSwitchCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">RECOVERED</span>
                        <span className="text-fuchsia-100">{runtimeRecovered ? "yes" : "no"}</span>
                    </div>
                    <div className="pt-2 border-t border-fuchsia-500/20 grid grid-cols-2 gap-2 text-[10px] font-mono">
                        <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-white/40">RUNNING</p>
                            <p className="text-white/80">{visualCoreScene?.signals.runningCount ?? 0}</p>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-white/40">BLOCKED</p>
                            <p className="text-white/80">{visualCoreScene?.signals.blockedCount ?? 0}</p>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-white/40">FAILED</p>
                            <p className="text-white/80">{visualCoreScene?.signals.failedCount ?? 0}</p>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-white/40">PENDING</p>
                            <p className="text-white/80">{visualCoreScene?.signals.pendingApprovalCount ?? 0}</p>
                        </div>
                    </div>
                    <div className="pt-2 border-t border-fuchsia-500/20">
                        <div className="mb-1 flex items-center justify-between">
                            <p className="text-[10px] font-mono text-white/40">REASON</p>
                            {reasonMeta && (
                                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${reasonSeverityClass}`}>
                                    {reasonMeta.severity.toUpperCase()}
                                </span>
                            )}
                        </div>
                        <p className="text-xs font-mono text-white/75 break-words">{reasonLabel}</p>
                        <p className="text-[10px] font-mono text-white/45 mt-1 break-words">{reasonHint}</p>
                        <p className="text-[10px] font-mono text-white/35 mt-1 break-words">{visualCoreScene?.reason ?? "not initialized"}</p>
                        <p className="text-[10px] font-mono text-white/30 mt-1 break-words">runtime reason: {runtimeReason}</p>
                    </div>
                </div>
            </div>

            {error && <p className="mt-6 text-[10px] font-mono text-rose-300/80">Data sync warning: {error}</p>}

        </div>
    );
}
