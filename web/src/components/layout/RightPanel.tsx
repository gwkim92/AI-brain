"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertCircle, Clock3, PlayCircle, Sparkles, Layers, X } from "lucide-react";
import { useHUD } from "@/components/providers/HUDProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { ApiRequestError } from "@/lib/api/client";
import { getDashboardOverview, streamDashboardOverviewEvents } from "@/lib/api/endpoints";
import type { TaskRecord, UpgradeProposalRecord } from "@/lib/api/types";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getVisualCoreReasonMeta, type VisualCoreReasonSeverity } from "@/lib/visual-core/reason-meta";
import {
    VISUAL_CORE_RUNTIME_STATUS_EVENT,
    type VisualCoreRuntimeReason,
    type VisualCoreRuntimeStatus,
} from "@/components/ui/Jarvis3DCore";
import type { VisualCoreEngine, VisualCoreFailureCode } from "@/lib/visual-core/runtime";
import {
    emitRuntimeEvent,
    isRuntimeDebugEnabled,
    JARVIS_RUNTIME_DEBUG_CHANGED_EVENT,
    JARVIS_RUNTIME_EVENT_STREAM,
    type JarvisRuntimeEventDetail,
} from "@/lib/runtime-events";
import { dispatchSessionRerun } from "@/lib/hud/session-rerun";
const MAX_APPROVALS = 3;
const MAX_RUNNING_TASKS = 4;
const DASHBOARD_OVERVIEW_QUERY = {
    task_limit: 120,
    pending_approval_limit: 30,
    running_task_limit: 40,
};
const DASHBOARD_EVENTS_QUERY = {
    ...DASHBOARD_OVERVIEW_QUERY,
    poll_ms: 250,
    timeout_ms: 110000,
};

type RunningTaskCard = {
    id: string;
    mode: TaskRecord["mode"] | "execute";
    status: TaskRecord["status"] | "running";
    title: string;
    updatedAt: string;
    isOptimistic?: boolean;
    sessionId?: string | null;
    taskId?: string | null;
};

function formatRelativeTime(
    isoDate: string,
    t: (key: "tasks.relative.justNow" | "tasks.relative.minutesAgo" | "tasks.relative.hoursAgo" | "tasks.relative.daysAgo", values?: Record<string, string | number>) => string
): string {
    const target = new Date(isoDate).getTime();
    const diffSeconds = Math.round((Date.now() - target) / 1000);

    if (diffSeconds < 60) {
        return t("tasks.relative.justNow");
    }
    if (diffSeconds < 3600) {
        return t("tasks.relative.minutesAgo", { value: Math.round(diffSeconds / 60) });
    }
    if (diffSeconds < 86400) {
        return t("tasks.relative.hoursAgo", { value: Math.round(diffSeconds / 3600) });
    }
    return t("tasks.relative.daysAgo", { value: Math.round(diffSeconds / 86400) });
}

function classifyProposalRisk(proposal: UpgradeProposalRecord): "high" | "review" {
    const text = `${proposal.proposalTitle} ${proposal.id}`.toLowerCase();
    if (/(prod|production|deploy|migration|schema|security|auth|payment|rollback)/.test(text)) {
        return "high";
    }
    return "review";
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

function formatSessionIntent(
    intent: string | undefined,
    t: (key: "rightPanel.general") => string
): string {
    if (!intent || intent.trim().length === 0) {
        return t("rightPanel.general");
    }
    return intent.trim().toUpperCase();
}

function formatSessionWidget(
    widgetId: string | null | undefined,
    t: (key: "rightPanel.none") => string
): string {
    if (!widgetId || widgetId.trim().length === 0) {
        return t("rightPanel.none");
    }
    return widgetId.trim();
}

export function RightPanel() {
    const { t } = useLocale();
    const { visualCoreScene, sessions, activeSessionId, switchSession, archiveSession, openWidgets } = useHUD();
    const router = useRouter();
    const pathname = usePathname();
    const [pendingApprovals, setPendingApprovals] = useState<UpgradeProposalRecord[]>([]);
    const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
    const [pendingSessionApprovalCount, setPendingSessionApprovalCount] = useState(0);
    const [runningTasks, setRunningTasks] = useState<TaskRecord[]>([]);
    const [optimisticRunningTasks, setOptimisticRunningTasks] = useState<RunningTaskCard[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [runtimeStatus, setRuntimeStatus] = useState<VisualCoreRuntimeStatus>("probing");
    const [runtimeReason, setRuntimeReason] = useState<VisualCoreRuntimeReason>("capability_probe_pending");
    const [runtimeEngine, setRuntimeEngine] = useState<VisualCoreEngine>("cpu");
    const [runtimeFailureCode, setRuntimeFailureCode] = useState<VisualCoreFailureCode>("none");
    const [runtimeSwitchCount, setRuntimeSwitchCount] = useState(0);
    const [runtimeRecovered, setRuntimeRecovered] = useState(false);
    const [runtimeDebugEnabled, setRuntimeDebugEnabled] = useState(false);
    const [runtimeEvents, setRuntimeEvents] = useState<Array<JarvisRuntimeEventDetail>>([]);
    const optimisticRunningTaskEnabled = isFeatureEnabled("assistant.optimistic_running_task", true);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const applyOverviewSnapshot = useCallback(
        (snapshot: {
            signals?: {
                pending_approval_count?: number;
                pending_session_approval_count?: number;
            } | null;
            pending_approvals?: UpgradeProposalRecord[] | null;
            running_tasks?: TaskRecord[] | null;
        } | null | undefined) => {
            const nextPendingApprovals = Array.isArray(snapshot?.pending_approvals)
                ? snapshot.pending_approvals
                : [];
            const nextRunningTasks = Array.isArray(snapshot?.running_tasks)
                ? snapshot.running_tasks
                : [];
            setPendingApprovals(nextPendingApprovals);
            setPendingApprovalCount(typeof snapshot?.signals?.pending_approval_count === "number" ? snapshot.signals.pending_approval_count : nextPendingApprovals.length);
            setPendingSessionApprovalCount(
                typeof snapshot?.signals?.pending_session_approval_count === "number" ? snapshot.signals.pending_session_approval_count : 0
            );
            setRunningTasks(nextRunningTasks);
            setError(null);
            setIsLoading(false);
        },
        []
    );

    const refreshOverviewSnapshot = useCallback(async () => {
        try {
            const snapshot = await getDashboardOverview(DASHBOARD_OVERVIEW_QUERY);
            if (!mountedRef.current) {
                return;
            }
            applyOverviewSnapshot(snapshot);
        } catch (err) {
            if (!mountedRef.current) {
                return;
            }
            if (err instanceof ApiRequestError) {
                setError(`${err.code}: ${err.message}`);
            } else {
                setError(t("rightPanel.loadFailed"));
            }
            setIsLoading(false);
        }
    }, [applyOverviewSnapshot, t]);

    const resolveSessionFocus = (session: (typeof sessions)[number]): string => {
        if (session.focusedWidget && session.mountedWidgets.includes(session.focusedWidget)) {
            return session.focusedWidget;
        }
        const activeCandidate = session.activeWidgets.find((widgetId) => session.mountedWidgets.includes(widgetId));
        if (activeCandidate) {
            return activeCandidate;
        }
        if ((session.taskId || session.missionId) && session.mountedWidgets.includes("assistant")) {
            return "assistant";
        }
        if (session.mountedWidgets.includes("assistant")) {
            return "assistant";
        }
        if (session.mountedWidgets.includes("tasks")) {
            return "tasks";
        }
        return session.mountedWidgets[0] ?? "inbox";
    };

    const activateSession = (sessionId: string, restoreMode: "full" | "focus_only") => {
        const targetSession = sessions.find((session) => session.id === sessionId);
        switchSession(sessionId, { restoreMode });
        if (pathname !== "/") {
            const nextSearchParams = new URLSearchParams();
            if (targetSession) {
                const mounted = targetSession.mountedWidgets.length > 0 ? targetSession.mountedWidgets : ["inbox"];
                const focus = resolveSessionFocus(targetSession);
                const activation = restoreMode === "full" ? "all" : "focus_only";
                nextSearchParams.set("widgets", mounted.join(","));
                nextSearchParams.set("focus", focus);
                nextSearchParams.set("replace", "1");
                nextSearchParams.set("activation", activation);
            }
            const nextPath = nextSearchParams.size > 0 ? `/?${nextSearchParams.toString()}` : "/";
            router.push(nextPath);
        }
    };

    const activateRunningTask = (task: RunningTaskCard) => {
        if (task.sessionId) {
            activateSession(task.sessionId, "focus_only");
            return;
        }

        const targetTaskId = task.taskId ?? task.id;
        const linkedSession = sessions.find((session) => session.taskId === targetTaskId);
        if (linkedSession) {
            activateSession(linkedSession.id, "focus_only");
            return;
        }

        const fallbackWidgets = ["assistant", "tasks"];
        openWidgets(fallbackWidgets, {
            focus: "assistant",
            replace: true,
            activate: "focus_only",
            workspacePreset: null,
        });
        if (pathname !== "/") {
            const nextSearchParams = new URLSearchParams();
            nextSearchParams.set("widgets", fallbackWidgets.join(","));
            nextSearchParams.set("focus", "assistant");
            nextSearchParams.set("replace", "1");
            nextSearchParams.set("activation", "focus_only");
            router.push(`/?${nextSearchParams.toString()}`);
        }
    };

    const overlayLabel =
        visualCoreScene && visualCoreScene.overlayFx.length > 0 ? visualCoreScene.overlayFx.join(", ") : t("rightPanel.none");
    const reasonMeta = getVisualCoreReasonMeta(visualCoreScene?.reason);
    const visualReasonKey = visualCoreScene?.reason ?? "unknown";
    const reasonLabel = visualCoreScene?.reason
        ? t(`rightPanel.visualReason.${visualReasonKey}.label` as keyof typeof import("@/lib/locale").translations.en)
        : t("rightPanel.notInitialized");
    const translatedReasonHint = visualCoreScene?.reason
        ? t(`rightPanel.visualReason.${visualReasonKey}.hint` as keyof typeof import("@/lib/locale").translations.en)
        : t("rightPanel.waitingForScene");
    const reasonHint =
        translatedReasonHint.includes("rightPanel.visualReason.") ? (reasonMeta?.operatorHint ?? t("rightPanel.waitingForScene")) : translatedReasonHint;
    const fallbackReasonLabel =
        reasonLabel.includes("rightPanel.visualReason.") ? (reasonMeta?.label ?? t("rightPanel.notInitialized")) : reasonLabel;
    const reasonSeverityClass = getReasonSeverityClass(reasonMeta?.severity);
  const approvalCards = useMemo(() => pendingApprovals.slice(0, MAX_APPROVALS), [pendingApprovals]);
  const extraSessionApprovals = useMemo(
      () => Math.max(0, pendingApprovalCount - pendingApprovals.length),
      [pendingApprovalCount, pendingApprovals.length]
  );
  const activeTaskCards = useMemo(() => {
      const cards: RunningTaskCard[] = runningTasks.map((task) => ({
          id: task.id,
          mode: task.mode,
          status: task.status,
          title: task.title,
          updatedAt: task.updatedAt,
          taskId: task.id,
      }));
      const serverTaskIds = new Set(cards.map((task) => task.id));
      const optimistic = optimisticRunningTasks.filter((task) => {
          if (task.taskId && serverTaskIds.has(task.taskId)) {
              return false;
          }
          return !serverTaskIds.has(task.id);
      });
      return [...optimistic, ...cards].slice(0, MAX_RUNNING_TASKS);
  }, [optimisticRunningTasks, runningTasks]);

    useEffect(() => {
        let stopped = false;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let stream: { close: () => void } | null = null;
        let reconnectDelayMs = 600;

        const clearReconnectTimer = () => {
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
        };

        const scheduleReconnect = () => {
            if (stopped || reconnectTimer !== null) {
                return;
            }
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (stopped) {
                    return;
                }
                void refreshOverviewSnapshot();
                stream?.close();
                stream = openStream();
            }, reconnectDelayMs);
        };

        const openStream = () =>
            streamDashboardOverviewEvents(
                DASHBOARD_EVENTS_QUERY,
                {
                    onOpen: () => {
                        reconnectDelayMs = 600;
                    },
                    onUpdated: (payload) => {
                        applyOverviewSnapshot(payload?.data);
                        setError(null);
                        reconnectDelayMs = 600;
                    },
                    onClose: () => {
                        scheduleReconnect();
                    },
                    onError: (err) => {
                        if (stopped) {
                            return;
                        }
                        if (err instanceof ApiRequestError) {
                            setError(`${err.code}: ${err.message}`);
                            if (err.status === 429) {
                                reconnectDelayMs = Math.min(10_000, reconnectDelayMs * 2);
                            } else {
                                reconnectDelayMs = Math.min(4_000, Math.max(800, reconnectDelayMs));
                            }
                        } else {
                            setError(t("rightPanel.streamDisconnected"));
                            reconnectDelayMs = Math.min(4_000, Math.max(1000, reconnectDelayMs));
                        }
                        scheduleReconnect();
                    },
                }
            );

        const initialRefreshTimer = setTimeout(() => {
            void refreshOverviewSnapshot();
        }, 0);
        stream = openStream();

        return () => {
            stopped = true;
            clearTimeout(initialRefreshTimer);
            clearReconnectTimer();
            stream?.close();
        };
    }, [applyOverviewSnapshot, refreshOverviewSnapshot, t]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefresh = () => {
            if (refreshTimer !== null) {
                return;
            }
            refreshTimer = setTimeout(() => {
                refreshTimer = null;
                void refreshOverviewSnapshot();
            }, 80);
        };
        const onRuntimeEvent = (event: Event) => {
            const custom = event as CustomEvent<JarvisRuntimeEventDetail>;
            const name = custom.detail?.name;
            const payload = (custom.detail?.payload ?? {}) as Record<string, unknown>;
            if (name === "quick_command_started") {
                scheduleRefresh();
                if (!optimisticRunningTaskEnabled) {
                    return;
                }
                const intakeId = typeof payload.intakeId === "string" ? payload.intakeId : null;
                const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : intakeId;
                const prompt = typeof payload.prompt === "string" ? payload.prompt : "Quick command";
                const taskMode = typeof payload.taskMode === "string" ? payload.taskMode : "execute";
                if (!intakeId) {
                    return;
                }
                const optimisticId = `optimistic:${intakeId}`;
                const nowIso = new Date().toISOString();
                setOptimisticRunningTasks((prev) => {
                    const next = prev.filter((item) => item.id !== optimisticId);
                    next.unshift({
                        id: optimisticId,
                        mode: taskMode as RunningTaskCard["mode"],
                        status: "running",
                        title: prompt,
                        updatedAt: nowIso,
                        isOptimistic: true,
                        sessionId,
                        taskId: null,
                    });
                    return next.slice(0, MAX_RUNNING_TASKS * 2);
                });
                emitRuntimeEvent("running_task_visible", {
                    source: "optimistic",
                    intakeId,
                    taskId: null,
                    visible: true,
                });
                return;
            }

            if (name === "quick_command_completed") {
                scheduleRefresh();
                if (!optimisticRunningTaskEnabled) {
                    return;
                }
                const intakeId = typeof payload.intakeId === "string" ? payload.intakeId : null;
                const taskId = typeof payload.taskId === "string" ? payload.taskId : null;
                if (!intakeId) {
                    return;
                }
                const optimisticId = `optimistic:${intakeId}`;
                setOptimisticRunningTasks((prev) =>
                    prev.map((item) =>
                        item.id === optimisticId
                            ? {
                                ...item,
                                taskId: taskId ?? item.taskId ?? null,
                                updatedAt: new Date().toISOString(),
                            }
                            : item
                    )
                );
                emitRuntimeEvent("running_task_visible", {
                    source: "optimistic",
                    intakeId,
                    taskId,
                    visible: true,
                });
                return;
            }

            if (name === "quick_command_failed") {
                scheduleRefresh();
                if (!optimisticRunningTaskEnabled) {
                    return;
                }
                const intakeId = typeof payload.intakeId === "string" ? payload.intakeId : null;
                if (!intakeId) {
                    return;
                }
                const optimisticId = `optimistic:${intakeId}`;
                setOptimisticRunningTasks((prev) => prev.filter((item) => item.id !== optimisticId));
                emitRuntimeEvent("running_task_visible", {
                    source: "optimistic",
                    intakeId,
                    taskId: null,
                    visible: false,
                });
            }
        };
        window.addEventListener(JARVIS_RUNTIME_EVENT_STREAM, onRuntimeEvent as EventListener);
        return () => {
            if (refreshTimer !== null) {
                clearTimeout(refreshTimer);
            }
            window.removeEventListener(JARVIS_RUNTIME_EVENT_STREAM, onRuntimeEvent as EventListener);
        };
    }, [optimisticRunningTaskEnabled, refreshOverviewSnapshot]);

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

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const sync = () => {
            setRuntimeDebugEnabled(isRuntimeDebugEnabled());
        };
        sync();
        window.addEventListener(JARVIS_RUNTIME_DEBUG_CHANGED_EVENT, sync as EventListener);
        window.addEventListener("storage", sync);
        return () => {
            window.removeEventListener(JARVIS_RUNTIME_DEBUG_CHANGED_EVENT, sync as EventListener);
            window.removeEventListener("storage", sync);
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined" || !runtimeDebugEnabled) {
            return;
        }
        const onRuntimeEvent = (event: Event) => {
            const custom = event as CustomEvent<JarvisRuntimeEventDetail>;
            if (!custom.detail?.name) {
                return;
            }
            setRuntimeEvents((prev) => [...prev.slice(-11), custom.detail]);
        };
        window.addEventListener(JARVIS_RUNTIME_EVENT_STREAM, onRuntimeEvent as EventListener);
        return () => {
            window.removeEventListener(JARVIS_RUNTIME_EVENT_STREAM, onRuntimeEvent as EventListener);
        };
    }, [runtimeDebugEnabled]);

    return (
        <div className="flex flex-col p-6 w-full h-full">

            {/* Sessions */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,255,255,0.6)]"></span>
                        <h3 className="font-bold tracking-widest text-sm text-white/90">{t("rightPanel.sessions").toUpperCase()}</h3>
                    </div>
                    <Layers size={14} className="text-cyan-300" />
                </div>

                <div className="space-y-2">
                    {sessions.length === 0 && (
                        <div className="text-xs font-mono text-white/40 p-3 border border-white/10 rounded-md bg-white/5">
                            {t("rightPanel.sessionsEmpty")}
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
                                    onClick={() => activateSession(session.id, "full")}
                                    className="w-full text-left"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-xs font-medium truncate ${isActive ? "text-cyan-200" : "text-white/70"}`}>
                                                {session.prompt.length > 40 ? session.prompt.slice(0, 40) + "..." : session.prompt}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span className="text-[10px] font-mono text-white/40">
                                                    {formatRelativeTime(session.createdAt, t)}
                                                </span>
                                                {session.activeWidgets.length > 0 && (
                                                    <span className="text-[10px] font-mono text-white/30">
                                                        {t("rightPanel.widgetsCount", { value: session.activeWidgets.length })}
                                                    </span>
                                                )}
                                                {session.mountedWidgets.length > session.activeWidgets.length && (
                                                    <span className="text-[10px] font-mono text-white/25">
                                                        {t("rightPanel.mountedExtra", { value: session.mountedWidgets.length - session.activeWidgets.length })}
                                                    </span>
                                                )}
                                                {isActive && (
                                                    <span className="text-[9px] font-mono font-bold tracking-wider text-cyan-400">
                                                        {t("rightPanel.active")}
                                                    </span>
                                                )}
                                                {session.stale && (
                                                    <span className="text-[9px] font-mono font-bold tracking-wider text-amber-300">
                                                        {t("rightPanel.stale")}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] font-mono">
                                                <span className="rounded border border-white/15 px-1.5 py-0.5 text-white/50">
                                                    {formatSessionIntent(session.intent, t)}
                                                </span>
                                                <span className="rounded border border-white/15 px-1.5 py-0.5 text-white/45">
                                                    {t("rightPanel.focus")}:{formatSessionWidget(session.focusedWidget, t)}
                                                </span>
                                                <span className="rounded border border-white/15 px-1.5 py-0.5 text-white/45">
                                                    {t("rightPanel.restore")}:{session.restoreMode}
                                                </span>
                                                {session.stale && (
                                                    <span className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">
                                                        {t("rightPanel.staleReason", { value: session.staleReason ?? "server_state_lost" })}
                                                    </span>
                                                )}
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
                                            activateSession(session.id, "full");
                                        }}
                                        className="rounded border border-cyan-500/35 bg-cyan-500/10 px-2 py-1 text-[9px] font-mono text-cyan-200 hover:bg-cyan-500/20"
                                        data-testid={`session-restore-full-${session.id}`}
                                    >
                                        {t("rightPanel.restoreFull")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            activateSession(session.id, "focus_only");
                                        }}
                                        className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[9px] font-mono text-white/70 hover:bg-white/10"
                                        data-testid={`session-restore-focus-${session.id}`}
                                    >
                                        {t("rightPanel.focusOnly")}
                                    </button>
                                    {session.stale && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                dispatchSessionRerun({
                                                    sessionId: session.id,
                                                    prompt: session.prompt,
                                                    taskId: session.taskId,
                                                    missionId: session.missionId,
                                                });
                                            }}
                                            className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[9px] font-mono text-amber-200 hover:bg-amber-500/20"
                                            data-testid={`session-rerun-${session.id}`}
                                        >
                                            {t("rightPanel.rerun")}
                                        </button>
                                    )}
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
                        <h3 className="font-bold tracking-widest text-sm text-white/90">{t("rightPanel.runningTasks").toUpperCase()}</h3>
                    </div>
                    <span className="text-xs data-mono text-white/50">{isLoading ? "..." : t("rightPanel.activeCount", { value: activeTaskCards.length })}</span>
                </div>

                <div className="space-y-3">
                    {isLoading && <div className="text-xs font-mono text-white/50 p-3 border border-white/10 rounded-md bg-white/5">{t("rightPanel.loadingTasks")}</div>}
                    {!isLoading && activeTaskCards.length === 0 && (
                        <div className="text-xs font-mono text-white/50 p-3 border border-white/10 rounded-md bg-white/5">{t("rightPanel.noActiveTasks")}</div>
                    )}
                    {!isLoading &&
                        activeTaskCards.map((task) => (
                            <div
                                key={task.id}
                                className="p-4 rounded-md border border-cyan-500/20 bg-cyan-950/20 backdrop-blur-md transition-colors hover:bg-cyan-900/25"
                            >
                                <button
                                    type="button"
                                    onClick={() => activateRunningTask(task)}
                                    className="w-full text-left"
                                    data-testid={`running-task-restore-${task.id}`}
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
                                        {task.id.slice(0, 8)} · {formatRelativeTime(task.updatedAt, t)}{task.isOptimistic ? ` · ${t("rightPanel.pendingSync")}` : ""}
                                    </p>
                                </button>
                                {!task.isOptimistic && (
                                    <div className="mt-2 flex justify-end">
                                        <Link
                                            href={`/tasks/${task.taskId ?? task.id}`}
                                            className="rounded border border-white/20 bg-black/20 px-2 py-1 text-[9px] font-mono text-white/70 hover:bg-white/10"
                                            data-testid={`running-task-detail-${task.id}`}
                                        >
                                            {t("rightPanel.taskDetail")}
                                        </Link>
                                    </div>
                                )}
                            </div>
                        ))}
                </div>
            </div>

            {/* Pending Approvals */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]"></span>
                        <h3 className="font-bold tracking-widest text-sm text-white/90">{t("rightPanel.pendingApprovals").toUpperCase()}</h3>
                    </div>
                    <span className="text-xs data-mono text-white/50">{isLoading ? "..." : t("rightPanel.requestCount", { value: pendingApprovalCount })}</span>
                </div>

                <div className="space-y-3">
                    {isLoading && <div className="text-xs font-mono text-white/50 p-3 border border-white/10 rounded-md bg-white/5">{t("rightPanel.loadingApprovals")}</div>}
                    {!isLoading && approvalCards.length === 0 && extraSessionApprovals === 0 && (
                        <div className="text-xs font-mono text-white/50 p-3 border border-white/10 rounded-md bg-white/5">{t("rightPanel.noPendingApprovals")}</div>
                    )}
                    {!isLoading && extraSessionApprovals > 0 && (
                        <Link
                            href="/?widget=action_center"
                            className="block p-3 rounded-md border border-amber-500/20 bg-amber-950/20 text-xs font-mono text-amber-100/85 hover:bg-amber-900/25"
                        >
                            {t("rightPanel.sessionApprovalsWaiting", { value: extraSessionApprovals, suffix: extraSessionApprovals === 1 ? "" : "s" })}
                        </Link>
                    )}
                    {!isLoading &&
                        approvalCards.map((proposal) => {
                            const risk = classifyProposalRisk(proposal);
                            const isHighRisk = risk === "high";

                            return (
                                <Link
                                    key={proposal.id}
                                    href={`/approvals?proposal=${proposal.id}`}
                                    className={`block p-4 rounded-md border backdrop-blur-md transition-colors ${isHighRisk ? "border-amber-500/20 bg-amber-950/20 hover:bg-amber-900/25" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                                >
                                    <div className={`flex items-center gap-2 mb-2 ${isHighRisk ? "text-amber-500" : "text-blue-400"}`}>
                                        {isHighRisk ? <AlertCircle size={14} /> : <Clock3 size={14} />}
                                        <span className="text-xs font-bold tracking-wider">{risk === "high" ? t("rightPanel.risk.high") : t("rightPanel.risk.review")}</span>
                                    </div>
                                    <p className="text-sm font-medium text-white/90">{proposal.proposalTitle}</p>
                                    <p className="text-[10px] font-mono text-white/40 mt-2">
                                        {proposal.id.slice(0, 8)} · {formatRelativeTime(proposal.createdAt, t)}
                                    </p>
                                </Link>
                            );
                        })}
                    {!isLoading && pendingSessionApprovalCount > 0 && approvalCards.length > 0 && (
                        <Link
                            href="/?widget=action_center"
                            className="block p-3 rounded-md border border-white/10 bg-white/5 text-[10px] font-mono text-white/60 hover:bg-white/10"
                        >
                            {t("rightPanel.openActionCenter", { value: pendingSessionApprovalCount, suffix: pendingSessionApprovalCount === 1 ? "" : "s" })}
                        </Link>
                    )}
                </div>
            </div>

            {/* Visual Core Debug */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,0.6)]"></span>
                        <h3 className="font-bold tracking-widest text-sm text-white/90">{t("rightPanel.visualCore").toUpperCase()}</h3>
                    </div>
                    <Sparkles size={14} className="text-fuchsia-300" />
                </div>

                <div className="p-4 rounded-md border border-fuchsia-500/20 bg-fuchsia-950/20 backdrop-blur-md space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">{t("rightPanel.baseMode")}</span>
                        <span className="text-fuchsia-300">{visualCoreScene?.baseMode ?? "n/a"}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">{t("rightPanel.overlayFx")}</span>
                        <span className="text-fuchsia-200">{overlayLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">{t("rightPanel.priority")}</span>
                        <span className="text-fuchsia-100">{visualCoreScene?.priority ?? "-"}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">{t("rightPanel.runtimeStatus")}</span>
                        <span className="text-fuchsia-200">
                            {t(`rightPanel.runtimeStatus.${runtimeStatus}` as keyof typeof import("@/lib/locale").translations.en)}
                        </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">{t("rightPanel.engine")}</span>
                        <span className="text-fuchsia-200">{runtimeEngine}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">{t("rightPanel.failureCode")}</span>
                        <span className="text-fuchsia-100 break-all text-right">{runtimeFailureCode}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">{t("rightPanel.switchCount")}</span>
                        <span className="text-fuchsia-100">{runtimeSwitchCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white/40">{t("rightPanel.recovered")}</span>
                        <span className="text-fuchsia-100">{runtimeRecovered ? t("common.yes") : t("common.no")}</span>
                    </div>
                    <div className="pt-2 border-t border-fuchsia-500/20 grid grid-cols-2 gap-2 text-[10px] font-mono">
                        <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-white/40">{t("rightPanel.running")}</p>
                            <p className="text-white/80">{visualCoreScene?.signals.runningCount ?? 0}</p>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-white/40">{t("rightPanel.blocked")}</p>
                            <p className="text-white/80">{visualCoreScene?.signals.blockedCount ?? 0}</p>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-white/40">{t("rightPanel.failed")}</p>
                            <p className="text-white/80">{visualCoreScene?.signals.failedCount ?? 0}</p>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-white/40">{t("rightPanel.pending")}</p>
                            <p className="text-white/80">{visualCoreScene?.signals.pendingApprovalCount ?? 0}</p>
                        </div>
                    </div>
                    <div className="pt-2 border-t border-fuchsia-500/20">
                        <div className="mb-1 flex items-center justify-between">
                            <p className="text-[10px] font-mono text-white/40">{t("rightPanel.reason")}</p>
                            {reasonMeta && (
                                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${reasonSeverityClass}`}>
                                    {reasonMeta.severity.toUpperCase()}
                                </span>
                            )}
                        </div>
                        <p className="text-xs font-mono text-white/75 break-words">{fallbackReasonLabel}</p>
                        <p className="text-[10px] font-mono text-white/45 mt-1 break-words">{reasonHint}</p>
                        <p className="text-[10px] font-mono text-white/35 mt-1 break-words">{visualCoreScene?.reason ?? t("rightPanel.notInitialized")}</p>
                        <p className="text-[10px] font-mono text-white/30 mt-1 break-words">{t("rightPanel.runtimeReason")}: {runtimeReason}</p>
                    </div>
                </div>
            </div>

            {runtimeDebugEnabled && (
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.7)]"></span>
                            <h3 className="font-bold tracking-widest text-sm text-white/90">{t("rightPanel.runtimeTrace").toUpperCase()}</h3>
                        </div>
                        <span className="text-[10px] font-mono text-amber-200">{t("rightPanel.devOnly")}</span>
                    </div>
                    <div className="rounded-md border border-amber-400/20 bg-amber-950/15 backdrop-blur-md p-3 space-y-2">
                        {runtimeEvents.length === 0 && (
                            <p className="text-[10px] font-mono text-white/45">{t("rightPanel.noRuntimeEvents")}</p>
                        )}
                        {runtimeEvents.map((event, index) => (
                            <div key={`${event.timestamp}:${event.name}:${index}`} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[10px] font-mono text-amber-200">{event.name}</p>
                                    <p className="text-[9px] font-mono text-white/35">{formatRelativeTime(event.timestamp, t)}</p>
                                </div>
                                <p className="mt-1 text-[9px] font-mono text-white/45 break-all">
                                    {JSON.stringify(event.payload)}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {error && <p className="mt-6 text-[10px] font-mono text-rose-300/80">{t("rightPanel.dataSyncWarning", { value: error })}</p>}

        </div>
    );
}
