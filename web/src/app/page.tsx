"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type VisualCoreRuntimeReason,
  VISUAL_CORE_RUNTIME_STATUS_EVENT,
  type VisualCoreRuntimeStatus,
} from "@/components/ui/Jarvis3DCore";
import type { VisualCoreEngine, VisualCoreFailureCode } from "@/lib/visual-core/runtime";
import { useHUD } from "@/components/providers/HUDProvider";
import { GlassWidget } from "@/components/ui/GlassWidget";
import { WidgetErrorBoundary } from "@/components/ui/WidgetErrorBoundary";
import { AnimatePresence } from "framer-motion";
import { getDashboardOverview, getMission, streamDashboardOverviewEvents, streamMissionEvents } from "@/lib/api/endpoints";
import type { DashboardOverviewData, MissionRecord, TaskRecord } from "@/lib/api/types";
import { resolveJarvis3DScene } from "@/lib/visual-core/resolve-mode";
import { canTransitionBaseMode, getBaseModePriority, getRemainingHoldMs } from "@/lib/visual-core/stability";
import type { Jarvis3DBaseMode, Jarvis3DScene } from "@/lib/visual-core/types";
import { canAccessWidget, useCurrentRoleState } from "@/lib/auth/role";
import { resolveMissionFocus } from "@/lib/hud/mission-focus";
import { ContextDockBar } from "@/components/layout/ContextDockBar";
import {
  HUD_DEFAULT_MISSION_AUTO_FOCUS_HOLD_SECONDS,
  HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY,
  HUD_MISSION_AUTO_FOCUS_KEY,
  HUD_PREFERENCE_CHANGED_EVENT,
  HUD_VISUAL_CORE_ENABLED_KEY,
  readMissionAutoFocusEnabledPreference,
  readMissionAutoFocusHoldSecondsPreference,
  writeVisualCoreEnabledPreference,
  writeMissionAutoFocusEnabledPreference,
} from "@/lib/hud/preferences";

import { InboxModule } from "@/components/modules/InboxModule";
import { AssistantModule } from "@/components/modules/AssistantModule";
import { CouncilModule } from "@/components/modules/CouncilModule";
import { WorkbenchModule } from "@/components/modules/WorkbenchModule";
import { TasksModule } from "@/components/modules/TasksModule";
import { ReportsModule } from "@/components/modules/ReportsModule";
import { ApprovalsModule } from "@/components/modules/ApprovalsModule";
import { MemoryModule } from "@/components/modules/MemoryModule";
import { SettingsModule } from "@/components/modules/SettingsModule";
import { ModelControlModule } from "@/components/modules/ModelControlModule";
import { IdeationModule } from "@/components/modules/IdeationModule";

const EVENT_PULSE_MS = 2200;
const KNOWN_WIDGET_IDS = new Set([
  "inbox",
  "assistant",
  "tasks",
  "council",
  "workbench",
  "reports",
  "approvals",
  "memory",
  "settings",
  "model_control",
  "ideation",
]);

type VisualSignalSnapshot = {
  taskCount: number;
  runningCount: number;
  failedCount: number;
  blockedCount: number;
  pendingApprovalCount: number;
};

type RequestedWidgetPlan = {
  ids: string[];
  replace: boolean;
  focus: string | null;
  activate: "all" | "focus_only";
};

type RequestedMissionPlan = {
  missionId: string | null;
  step: string | null;
};

const WIDGET_DEFAULTS: Record<string, { x: number; y: number; w: number; h: number }> = {
  inbox:     { x: 24,  y: 56,  w: 380, h: 360 },
  tasks:     { x: 420, y: 56,  w: 360, h: 360 },
  assistant: { x: 24,  y: 300, w: 420, h: 520 },
  council:   { x: 400, y: 300, w: 380, h: 360 },
  workbench: { x: 200, y: 80,  w: 400, h: 380 },
  reports:   { x: 240, y: 70,  w: 380, h: 360 },
  approvals: { x: 60,  y: 120, w: 360, h: 340 },
  memory:    { x: 280, y: 140, w: 360, h: 340 },
  settings:  { x: 140, y: 72,  w: 620, h: 760 },
  model_control: { x: 180, y: 72, w: 760, h: 760 },
  ideation: { x: 120, y: 72, w: 920, h: 780 },
};

const WIDGET_TITLES: Record<string, string> = {
  inbox: "ORCHESTRATION HUB",
  assistant: "AI ASSISTANT",
  council: "AGENT COUNCIL",
  workbench: "WORKBENCH",
  tasks: "TASK MANAGER",
  reports: "SYSTEM REPORTS",
  approvals: "PENDING APPROVALS",
  memory: "SEMANTIC MEMORY",
  settings: "SYSTEM SETTINGS",
  model_control: "MODEL CONTROL",
  ideation: "IDEATION LAB",
};

const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  inbox: InboxModule,
  assistant: AssistantModule,
  council: CouncilModule,
  workbench: WorkbenchModule,
  tasks: TasksModule,
  reports: ReportsModule,
  approvals: ApprovalsModule,
  memory: MemoryModule,
  settings: SettingsModule,
  model_control: ModelControlModule,
  ideation: IdeationModule,
};

function HUDWidgetRenderer({ mountedWidgets, activeWidgets }: { mountedWidgets: string[]; activeWidgets: string[] }) {
  const constraintsRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={constraintsRef} className="w-full h-full relative overflow-hidden pointer-events-none">
      <AnimatePresence>
        {mountedWidgets.map((widgetId) => {
          const isVisible = activeWidgets.includes(widgetId);
          const defaults = WIDGET_DEFAULTS[widgetId];
          const title = WIDGET_TITLES[widgetId];
          const Component = WIDGET_COMPONENTS[widgetId];
          if (!defaults || !title || !Component) return null;
          const orderIndex = activeWidgets.indexOf(widgetId);
          return (
            <div key={widgetId} className="absolute inset-0 pointer-events-none">
              <GlassWidget
                id={widgetId}
                visible={isVisible}
                title={title}
                initialWidth={defaults.w}
                initialHeight={defaults.h}
                defaultPosition={{ x: defaults.x, y: defaults.y }}
                orderIndex={orderIndex >= 0 ? orderIndex : 0}
                constraintsRef={constraintsRef}
              >
                <WidgetErrorBoundary widgetId={widgetId} widgetTitle={title}>
                  <Component />
                </WidgetErrorBoundary>
              </GlassWidget>
            </div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function parseRequestedWidgets(search: string): RequestedWidgetPlan {
  const params = new URLSearchParams(search);
  const single = params.get("widget");
  const many = params.get("widgets");
  const focus = params.get("focus");
  const replaceParam = params.get("replace");
  const activationParam = params.get("activation");
  const hasSingle = typeof single === "string" && single.trim().length > 0;
  const hasMany = typeof many === "string" && many.trim().length > 0;
  const merged = [single, many]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && KNOWN_WIDGET_IDS.has(value));

  const ids = Array.from(new Set(merged));
  const normalizedFocus =
    typeof focus === "string" && focus.trim().length > 0 && ids.includes(focus.trim()) ? focus.trim() : null;
  const activation: "all" | "focus_only" = activationParam === "focus_only" ? "focus_only" : "all";
  const replace =
    replaceParam === "1" || replaceParam === "true"
      ? true
      : hasSingle && !hasMany && ids.length === 1;
  return {
    ids,
    replace,
    focus: normalizedFocus,
    activate: activation,
  };
}

function parseRequestedMission(search: string): RequestedMissionPlan {
  const params = new URLSearchParams(search);
  const missionRaw = params.get("mission");
  const stepRaw = params.get("step");
  return {
    missionId: missionRaw && missionRaw.trim().length > 0 ? missionRaw.trim() : null,
    step: stepRaw && stepRaw.trim().length > 0 ? stepRaw.trim() : null,
  };
}

function useVisualCoreSignals() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [hasRecentEventPulse, setHasRecentEventPulse] = useState(false);

  const lastSnapshotRef = useRef<VisualSignalSnapshot | null>(null);
  const pulseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;

    const applySnapshot = (snapshot: DashboardOverviewData | null | undefined) => {
      if (stopped) {
        return;
      }

      const nextTasks = Array.isArray(snapshot?.tasks) ? (snapshot.tasks as TaskRecord[]) : [];
      const signals =
        snapshot && typeof snapshot === "object" && snapshot.signals && typeof snapshot.signals === "object"
          ? snapshot.signals
          : null;
      const nextPendingApprovalCountRaw = Number(signals?.pending_approval_count ?? 0);
      const nextPendingApprovalCount = Number.isFinite(nextPendingApprovalCountRaw)
        ? Math.max(0, Math.trunc(nextPendingApprovalCountRaw))
        : 0;
      const nextTaskCountRaw = Number(signals?.task_count ?? nextTasks.length);
      const nextTaskCount = Number.isFinite(nextTaskCountRaw) ? Math.max(0, Math.trunc(nextTaskCountRaw)) : nextTasks.length;
      const nextRunningCountRaw = Number(signals?.running_count ?? 0);
      const nextRunningCount = Number.isFinite(nextRunningCountRaw) ? Math.max(0, Math.trunc(nextRunningCountRaw)) : 0;
      const nextFailedCountRaw = Number(signals?.failed_count ?? 0);
      const nextFailedCount = Number.isFinite(nextFailedCountRaw) ? Math.max(0, Math.trunc(nextFailedCountRaw)) : 0;
      const nextBlockedCountRaw = Number(signals?.blocked_count ?? 0);
      const nextBlockedCount = Number.isFinite(nextBlockedCountRaw) ? Math.max(0, Math.trunc(nextBlockedCountRaw)) : 0;

      setTasks(nextTasks);
      setPendingApprovalCount(nextPendingApprovalCount);

      const nextSnapshot: VisualSignalSnapshot = {
        taskCount: nextTaskCount,
        runningCount: nextRunningCount,
        failedCount: nextFailedCount,
        blockedCount: nextBlockedCount,
        pendingApprovalCount: nextPendingApprovalCount,
      };

      const prev = lastSnapshotRef.current;
      const changed =
        prev &&
        (nextSnapshot.taskCount !== prev.taskCount ||
          nextSnapshot.runningCount !== prev.runningCount ||
          nextSnapshot.failedCount !== prev.failedCount ||
          nextSnapshot.blockedCount !== prev.blockedCount ||
          nextSnapshot.pendingApprovalCount !== prev.pendingApprovalCount);

      if (changed) {
        setHasRecentEventPulse(true);
        if (pulseTimerRef.current !== null) {
          window.clearTimeout(pulseTimerRef.current);
        }
        pulseTimerRef.current = window.setTimeout(() => {
          setHasRecentEventPulse(false);
          pulseTimerRef.current = null;
        }, EVENT_PULSE_MS);
      }

      lastSnapshotRef.current = nextSnapshot;
    };

    void getDashboardOverview({
      task_limit: 120,
      pending_approval_limit: 40,
      running_task_limit: 40,
    })
      .then((snapshot) => {
        applySnapshot(snapshot);
      })
      .catch(() => undefined);

    const stream = streamDashboardOverviewEvents(
      {
        task_limit: 120,
        pending_approval_limit: 40,
        running_task_limit: 40,
        poll_ms: 2000,
        timeout_ms: 45000,
      },
      {
        onUpdated: (payload) => {
          applySnapshot(payload.data);
        },
      }
    );

    return () => {
      stopped = true;
      stream.close();
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current);
      }
    };
  }, []);

  return {
    tasks,
    pendingApprovalCount,
    hasRecentEventPulse,
  };
}

function useStableVisualCoreScene(input: {
  activeWidgets: string[];
  focusedWidget: string | null;
  tasks: TaskRecord[];
  pendingApprovalCount: number;
  hasRecentEventPulse: boolean;
}): Jarvis3DScene {
  const candidateScene = resolveJarvis3DScene(input);

  const [stableBaseMode, setStableBaseMode] = useState<Jarvis3DBaseMode>(candidateScene.baseMode);
  const [lastSwitchAt, setLastSwitchAt] = useState<number>(0);

  useEffect(() => {
    if (candidateScene.baseMode === stableBaseMode) {
      return;
    }

    const elapsedMs = lastSwitchAt === 0 ? Number.MAX_SAFE_INTEGER : Date.now() - lastSwitchAt;

    if (canTransitionBaseMode({ from: stableBaseMode, to: candidateScene.baseMode, elapsedMs })) {
      const timer = window.setTimeout(() => {
        setStableBaseMode(candidateScene.baseMode);
        setLastSwitchAt(Date.now());
      }, 0);

      return () => {
        window.clearTimeout(timer);
      };
    }

    const waitMs = getRemainingHoldMs(stableBaseMode, elapsedMs);
    const timer = window.setTimeout(() => {
      setStableBaseMode(candidateScene.baseMode);
      setLastSwitchAt(Date.now());
    }, waitMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [candidateScene.baseMode, stableBaseMode, lastSwitchAt]);

  return {
    ...candidateScene,
    baseMode: stableBaseMode,
    priority: getBaseModePriority(stableBaseMode),
  };
}

export default function JarvisHUD() {
  const { activeWidgets, mountedWidgets, focusedWidget, openWidgets, dropWidget, setVisualCoreScene } = useHUD();
  const { role, hydrated: roleHydrated } = useCurrentRoleState();
  const { tasks, pendingApprovalCount, hasRecentEventPulse } = useVisualCoreSignals();
  const requestedWidgetsRef = useRef<RequestedWidgetPlan | null>(null);
  const requestedMissionRef = useRef<RequestedMissionPlan | null>(null);
  const requestedWidgetsConsumedRef = useRef(false);
  const [requestedMission, setRequestedMission] = useState<RequestedMissionPlan>({ missionId: null, step: null });
  const [missionRecord, setMissionRecord] = useState<MissionRecord | null>(null);
  const [missionAutoFocusEnabled, setMissionAutoFocusEnabled] = useState(true);
  const [missionAutoFocusHoldSeconds, setMissionAutoFocusHoldSeconds] = useState(HUD_DEFAULT_MISSION_AUTO_FOCUS_HOLD_SECONDS);
  const [visualCoreEnabled, setVisualCoreEnabled] = useState(true);
  const [hudPreferencesHydrated, setHudPreferencesHydrated] = useState(false);
  const [visualCoreRuntimeStatus, setVisualCoreRuntimeStatus] = useState<VisualCoreRuntimeStatus>("probing");
  const [visualCoreRuntimeReason, setVisualCoreRuntimeReason] = useState<VisualCoreRuntimeReason>("capability_probe_pending");
  const [visualCoreEngine, setVisualCoreEngine] = useState<VisualCoreEngine>("cpu");
  const [visualCoreFailureCode, setVisualCoreFailureCode] = useState<VisualCoreFailureCode>("none");
  const [visualCoreSwitchCount, setVisualCoreSwitchCount] = useState(0);
  const [visualCoreRecovered, setVisualCoreRecovered] = useState(false);
  const [missionAutoFocusHoldUntil, setMissionAutoFocusHoldUntil] = useState(0);
  const [missionAutoFocusClockMs, setMissionAutoFocusClockMs] = useState(() => Date.now());
  const missionAutoFocusRef = useRef<string>("");

  const roleFilteredWidgets = useMemo(
    () => activeWidgets.filter((widgetId) => canAccessWidget(role, widgetId)),
    [activeWidgets, role]
  );

  useEffect(() => {
    for (const widgetId of mountedWidgets) {
      if (!canAccessWidget(role, widgetId)) {
        dropWidget(widgetId);
      }
    }
  }, [dropWidget, mountedWidgets, role]);

  useEffect(() => {
    if (typeof window === "undefined" || requestedWidgetsRef.current !== null) {
      return;
    }
    requestedWidgetsRef.current = parseRequestedWidgets(window.location.search);
    requestedMissionRef.current = parseRequestedMission(window.location.search);
    setRequestedMission(requestedMissionRef.current);
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
      const status = custom.detail?.status;
      if (!status) {
        return;
      }
      setVisualCoreRuntimeStatus(status);
      setVisualCoreRuntimeReason(custom.detail?.reason ?? "capability_probe_pending");
      setVisualCoreEngine(custom.detail?.engine ?? "cpu");
      setVisualCoreFailureCode(custom.detail?.failureCode ?? "none");
      setVisualCoreSwitchCount(
        Number.isFinite(custom.detail?.switchCount) ? Number(custom.detail?.switchCount) : 0
      );
      setVisualCoreRecovered(Boolean(custom.detail?.isRecovered));
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
    const timer = window.setTimeout(() => {
      setMissionAutoFocusEnabled(readMissionAutoFocusEnabledPreference());
      setMissionAutoFocusHoldSeconds(readMissionAutoFocusHoldSecondsPreference());
      setHudPreferencesHydrated(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!hudPreferencesHydrated) {
      return;
    }
    writeMissionAutoFocusEnabledPreference(missionAutoFocusEnabled);
    if (missionAutoFocusEnabled) {
      missionAutoFocusRef.current = "";
    } else if (missionAutoFocusHoldUntil !== 0) {
      const resetTimer = window.setTimeout(() => {
        setMissionAutoFocusHoldUntil(0);
      }, 0);
      return () => {
        window.clearTimeout(resetTimer);
      };
    }
  }, [hudPreferencesHydrated, missionAutoFocusEnabled, missionAutoFocusHoldUntil]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onHudPreferenceChanged = (event: Event) => {
      const custom = event as CustomEvent<{ key?: string; value?: string }>;
      if (!custom.detail || typeof custom.detail.key !== "string") {
        return;
      }

      if (custom.detail.key === HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY) {
        setMissionAutoFocusHoldSeconds(readMissionAutoFocusHoldSecondsPreference());
        return;
      }
      if (custom.detail.key === HUD_MISSION_AUTO_FOCUS_KEY) {
        setMissionAutoFocusEnabled(readMissionAutoFocusEnabledPreference());
        return;
      }
      if (custom.detail.key === HUD_VISUAL_CORE_ENABLED_KEY) {
        setVisualCoreEnabled(true);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY) {
        setMissionAutoFocusHoldSeconds(readMissionAutoFocusHoldSecondsPreference());
        return;
      }
      if (event.key === HUD_MISSION_AUTO_FOCUS_KEY) {
        setMissionAutoFocusEnabled(readMissionAutoFocusEnabledPreference());
        return;
      }
      if (event.key === HUD_VISUAL_CORE_ENABLED_KEY) {
        setVisualCoreEnabled(true);
      }
    };

    window.addEventListener(HUD_PREFERENCE_CHANGED_EVENT, onHudPreferenceChanged as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HUD_PREFERENCE_CHANGED_EVENT, onHudPreferenceChanged as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (missionAutoFocusHoldUntil <= Date.now()) {
      if (missionAutoFocusHoldUntil !== 0) {
        const clearTimer = window.setTimeout(() => {
          setMissionAutoFocusHoldUntil(0);
        }, 0);
        return () => {
          window.clearTimeout(clearTimer);
        };
      }
      return;
    }

    const interval = window.setInterval(() => {
      setMissionAutoFocusClockMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [missionAutoFocusHoldUntil]);

  useEffect(() => {
    if (!roleHydrated) {
      return;
    }

    const missionId = requestedMission.missionId;
    if (!missionId) {
      const clearTimer = window.setTimeout(() => {
        setMissionRecord(null);
      }, 0);
      return () => {
        window.clearTimeout(clearTimer);
      };
    }

    if (typeof window === "undefined") {
      return;
    }

    let stopped = false;
    let reconnectTimer: number | null = null;
    let stream: { close: () => void } | null = null;

    const syncMissionOnce = async () => {
      try {
        const mission = await getMission(missionId);
        if (stopped) {
          return;
        }
        setMissionRecord(mission);
      } catch {
        if (!stopped) {
          setMissionRecord(null);
        }
      }
    };

    const scheduleReconnect = (delayMs = 1200) => {
      if (stopped || reconnectTimer !== null) {
        return;
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectStream();
      }, delayMs);
    };

    const connectStream = () => {
      if (stopped) {
        return;
      }
      stream = streamMissionEvents(
        missionId,
        {
          poll_ms: 1200,
          timeout_ms: 45000,
        },
        {
          onUpdated: (payload) => {
            if (stopped) {
              return;
            }
            setMissionRecord(payload.data);
          },
          onClose: () => {
            scheduleReconnect(300);
          },
          onError: () => {
            scheduleReconnect(1200);
          },
        }
      );
    };

    void syncMissionOnce();
    connectStream();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      stream?.close();
    };
  }, [requestedMission.missionId, roleHydrated]);

  const missionFocus = useMemo(
    () => resolveMissionFocus(missionRecord, requestedMission.step),
    [missionRecord, requestedMission.step]
  );

  const missionRecommendedWidget = useMemo(() => {
    if (!missionFocus) {
      return null;
    }
    if (!canAccessWidget(role, missionFocus.widget)) {
      return null;
    }
    return missionFocus.widget;
  }, [missionFocus, role]);

  const missionStepTimeline = useMemo(() => {
    const steps = missionRecord?.steps ?? [];
    return [...steps]
      .sort((left, right) => left.order - right.order)
      .map((step) => ({
        id: step.id,
        order: step.order,
        title: step.title,
        type: step.type,
        status: step.status,
      }));
  }, [missionRecord]);

  const missionAutoFocusHoldRemainingSec = useMemo(() => {
    if (missionAutoFocusHoldUntil <= missionAutoFocusClockMs) {
      return 0;
    }
    return Math.ceil((missionAutoFocusHoldUntil - missionAutoFocusClockMs) / 1000);
  }, [missionAutoFocusClockMs, missionAutoFocusHoldUntil]);

  const handleUserFocusWidget = useCallback(
    (widgetId: string) => {
      if (!missionAutoFocusEnabled || !missionRecommendedWidget) {
        return;
      }
      if (widgetId === missionRecommendedWidget) {
        return;
      }
      setMissionAutoFocusHoldUntil(Date.now() + missionAutoFocusHoldSeconds * 1000);
      setMissionAutoFocusClockMs(Date.now());
    },
    [missionAutoFocusEnabled, missionAutoFocusHoldSeconds, missionRecommendedWidget]
  );

  const handleEnableVisualCore = useCallback(() => {
    writeVisualCoreEnabledPreference(true);
    setVisualCoreEnabled(true);
  }, []);

  const visualCoreBadge = useMemo(() => {
    const runtimeMeta = `ENG:${visualCoreEngine.toUpperCase()} SW:${visualCoreSwitchCount}`;
    if (!hudPreferencesHydrated) {
      return {
        className:
          "border-white/30 bg-black/65 text-white/80 shadow-[0_0_16px_rgba(148,163,184,0.12)]",
        label: "VISUAL CORE INIT",
        detail: "SYNCING",
        meta: runtimeMeta,
        showEnable: false,
      };
    }
    if (!visualCoreEnabled) {
      return {
        className:
          "border-amber-400/50 bg-black/70 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.2)]",
        label: "VISUAL CORE OFF",
        detail: "DISABLED",
        meta: runtimeMeta,
        showEnable: true,
      };
    }
    if (visualCoreRuntimeStatus === "fallback") {
      return {
        className:
          "border-rose-400/50 bg-black/70 text-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.2)]",
        label: "VISUAL CORE DEGRADED",
        detail:
          visualCoreRuntimeReason === "canvas_runtime_error"
            ? "AUTO FAILOVER ACTIVE"
            : visualCoreRuntimeReason === "webgl_unavailable"
              ? "WEBGL UNAVAILABLE"
              : "CPU CORE ACTIVE",
        meta: visualCoreFailureCode === "none" ? runtimeMeta : `${runtimeMeta} ERR:${visualCoreFailureCode}`,
        showEnable: false,
      };
    }
    if (visualCoreRuntimeStatus === "ready" && visualCoreEngine === "stable") {
      return {
        className:
          "border-emerald-400/50 bg-black/70 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.22)]",
        label: "VISUAL CORE STABLE",
        detail: "STABLE ENGINE ACTIVE",
        meta:
          visualCoreFailureCode === "none"
            ? `${runtimeMeta}${visualCoreRecovered ? " RECOVERED" : ""}`
            : `${runtimeMeta} ERR:${visualCoreFailureCode}`,
        showEnable: false,
      };
    }
    if (visualCoreRuntimeStatus === "ready" && visualCoreEngine === "lite") {
      return {
        className:
          "border-amber-400/50 bg-black/70 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.2)]",
        label: "VISUAL CORE SAFE MODE",
        detail: "LITE 3D ACTIVE",
        meta:
          visualCoreFailureCode === "none"
            ? `${runtimeMeta}${visualCoreRecovered ? " RECOVERED" : ""}`
            : `${runtimeMeta} ERR:${visualCoreFailureCode}`,
        showEnable: false,
      };
    }
    if (visualCoreRuntimeStatus === "ready") {
      return {
        className:
          "border-cyan-400/50 bg-black/70 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.2)]",
        label: "VISUAL CORE OK",
        detail: visualCoreRuntimeReason === "forced_engine" ? "FORCED ENGINE ACTIVE" : "FULL 3D ACTIVE",
        meta:
          visualCoreFailureCode === "none"
            ? `${runtimeMeta}${visualCoreRecovered ? " RECOVERED" : ""}`
            : `${runtimeMeta} ERR:${visualCoreFailureCode}`,
        showEnable: false,
      };
    }
    return {
      className:
        "border-white/30 bg-black/65 text-white/80 shadow-[0_0_16px_rgba(148,163,184,0.12)]",
      label: "VISUAL CORE INIT",
      detail: "PROBING",
      meta: runtimeMeta,
      showEnable: false,
    };
  }, [
    hudPreferencesHydrated,
    visualCoreEnabled,
    visualCoreEngine,
    visualCoreFailureCode,
    visualCoreRecovered,
    visualCoreRuntimeReason,
    visualCoreRuntimeStatus,
    visualCoreSwitchCount,
  ]);

  useEffect(() => {
    if (!missionAutoFocusEnabled || !missionRecord || !missionFocus || !missionRecommendedWidget) {
      return;
    }
    if (missionAutoFocusHoldUntil > Date.now()) {
      return;
    }

    const signature = `${missionRecord.id}:${missionRecord.updatedAt}:${missionFocus.stepId}:${missionRecommendedWidget}`;
    if (missionAutoFocusRef.current === signature) {
      return;
    }

    const nextMounted = Array.from(new Set([...mountedWidgets, missionRecommendedWidget, "tasks"])).filter((widgetId) =>
      canAccessWidget(role, widgetId)
    );

    openWidgets(nextMounted, {
      focus: missionRecommendedWidget,
      replace: false,
      activate: "focus_only",
    });

    missionAutoFocusRef.current = signature;
  }, [
    missionAutoFocusEnabled,
    missionAutoFocusHoldUntil,
    missionFocus,
    missionRecommendedWidget,
    missionRecord,
    mountedWidgets,
    openWidgets,
    role,
  ]);

  useEffect(() => {
    if (requestedWidgetsConsumedRef.current || !roleHydrated || typeof window === "undefined") {
      return;
    }

    const requestedPlan = requestedWidgetsRef.current;
    if (requestedPlan && requestedPlan.ids.length > 0) {
      const allowed = requestedPlan.ids.filter((widgetId) => canAccessWidget(role, widgetId));
      if (allowed.length > 0) {
        const focusWidget =
          requestedPlan.focus && allowed.includes(requestedPlan.focus)
            ? requestedPlan.focus
            : allowed[allowed.length - 1];
        openWidgets(allowed, {
          focus: focusWidget,
          replace: requestedPlan.replace,
          activate: requestedPlan.activate,
        });
      }
    }

    const currentUrl = new URL(window.location.href);
    if (
      currentUrl.searchParams.has("widget") ||
      currentUrl.searchParams.has("widgets") ||
      currentUrl.searchParams.has("focus") ||
      currentUrl.searchParams.has("replace") ||
      currentUrl.searchParams.has("activation")
    ) {
      currentUrl.searchParams.delete("widget");
      currentUrl.searchParams.delete("widgets");
      currentUrl.searchParams.delete("focus");
      currentUrl.searchParams.delete("replace");
      currentUrl.searchParams.delete("activation");
      const nextSearch = currentUrl.searchParams.toString();
      const nextPath = `${currentUrl.pathname}${nextSearch ? `?${nextSearch}` : ""}${currentUrl.hash}`;
      window.history.replaceState(window.history.state, "", nextPath);
    }

    requestedWidgetsConsumedRef.current = true;
  }, [openWidgets, role, roleHydrated]);

  const coreScene = useStableVisualCoreScene({
    activeWidgets: roleFilteredWidgets,
    focusedWidget,
    tasks,
    pendingApprovalCount,
    hasRecentEventPulse,
  });

  const publishedSceneSignatureRef = useRef<string>("");

  useEffect(() => {
    const overlayKey = coreScene.overlayFx.join(",");
    const signature = [
      coreScene.baseMode,
      overlayKey,
      coreScene.reason,
      String(coreScene.priority),
      String(coreScene.signals.runningCount),
      String(coreScene.signals.blockedCount),
      String(coreScene.signals.failedCount),
      String(coreScene.signals.pendingApprovalCount),
      coreScene.signals.focusedWidget ?? "none",
    ].join("|");

    if (publishedSceneSignatureRef.current === signature) {
      return;
    }

    publishedSceneSignatureRef.current = signature;
    setVisualCoreScene({
      baseMode: coreScene.baseMode,
      overlayFx: [...coreScene.overlayFx],
      reason: coreScene.reason,
      priority: coreScene.priority,
      signals: {
        runningCount: coreScene.signals.runningCount,
        blockedCount: coreScene.signals.blockedCount,
        failedCount: coreScene.signals.failedCount,
        pendingApprovalCount: coreScene.signals.pendingApprovalCount,
        focusedWidget: coreScene.signals.focusedWidget,
      },
    });
  }, [
    coreScene.baseMode,
    coreScene.overlayFx,
    coreScene.reason,
    coreScene.priority,
    coreScene.signals.runningCount,
    coreScene.signals.blockedCount,
    coreScene.signals.failedCount,
    coreScene.signals.pendingApprovalCount,
    coreScene.signals.focusedWidget,
    setVisualCoreScene,
  ]);

  return (
    <main className="w-full h-full relative overflow-hidden bg-transparent flex">
      <div className="absolute top-16 right-72 z-[65] pointer-events-auto">
        <div className={`rounded-md border px-3 py-2 text-[10px] font-mono tracking-widest ${visualCoreBadge.className}`}>
          {visualCoreBadge.label}
          <span className="ml-2 text-[9px] text-white/85">{visualCoreBadge.detail}</span>
          <span className="ml-2 text-[9px] text-white/60">{visualCoreBadge.meta}</span>
          {visualCoreBadge.showEnable && (
            <button
              type="button"
              onClick={handleEnableVisualCore}
              className="ml-2 rounded border border-amber-300/60 px-2 py-0.5 text-[9px] text-amber-100 hover:bg-amber-300/15 transition-colors"
            >
              ENABLE
            </button>
          )}
        </div>
      </div>

      {/* Dynamic Module Layer */}
      <div className="relative z-10 w-full h-full flex flex-col pointer-events-none pt-12">
        <div className="w-full h-full pointer-events-none">
          <HUDWidgetRenderer mountedWidgets={mountedWidgets} activeWidgets={roleFilteredWidgets} />
        </div>
        <ContextDockBar
          mountedWidgets={mountedWidgets}
          activeWidgets={roleFilteredWidgets}
          focusedWidget={focusedWidget}
          recommendedWidget={missionRecommendedWidget}
          recommendedReason={missionFocus?.reason ?? null}
          missionTitle={missionRecord?.title ?? null}
          missionStepLabel={missionFocus?.stepLabel ?? null}
          missionStepStatus={missionFocus?.stepStatus ?? null}
          missionSteps={missionStepTimeline}
          activeMissionStepId={missionFocus?.stepId ?? null}
          missionAutoFocusEnabled={missionAutoFocusEnabled}
          missionAutoFocusHoldRemainingSec={missionAutoFocusHoldRemainingSec}
          onMissionAutoFocusChange={setMissionAutoFocusEnabled}
          onUserFocusWidget={handleUserFocusWidget}
        />
      </div>
    </main>
  );
}
