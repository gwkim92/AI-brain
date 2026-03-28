"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import type { Jarvis3DScene } from "@/lib/visual-core/types";
import { getHudWorkspacePresetConfig, type HudWorkspacePreset } from "@/lib/hud/widget-presets";
import {
    loadSessions as loadPersistedSessions,
    saveSessions as persistSessions,
    createSession as buildSession,
    updateSession as patchSession,
    removeSession as dropSession,
    type HudSessionRestoreMode,
    type HudSession,
} from "@/lib/hud/session";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { emitRuntimeEvent } from "@/lib/runtime-events";

const STORE_KEY_ACTIVE = "hud-active-widgets";
const STORE_KEY_MOUNTED = "hud-mounted-widgets";
const STORE_KEY_FOCUSED = "hud-focused-widget";
const STORE_KEY_PRESET = "hud-workspace-preset";
const FALLBACK_WIDGET = "inbox";
const SESSION_PROMPT_DEDUPE_WINDOW_MS = 3 * 60 * 1000;
const KNOWN_WIDGET_IDS = new Set([
    "inbox",
    "assistant",
    "tasks",
    "council",
    "workbench",
    "reports",
    "watchers",
    "dossier",
    "action_center",
    "notifications",
    "skills",
    "approvals",
    "memory",
    "settings",
    "model_control",
    "ideation",
]);

function readStoredArray(key: string, fallback: string[]): string[] {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return fallback;
        }
        const normalized = Array.from(
            new Set(
                parsed
                    .filter((value): value is string => typeof value === "string")
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0 && KNOWN_WIDGET_IDS.has(value))
            )
        );
        return normalized.length > 0 ? normalized : fallback;
    } catch {
        return fallback;
    }
}

function readStoredString(key: string): string | null {
    try {
        return localStorage.getItem(key) ?? null;
    } catch {
        return null;
    }
}

function writeStore(key: string, value: unknown): void {
    try {
        if (value === null || value === undefined) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
        }
    } catch {
        // localStorage may be unavailable
    }
}

function normalizeWidgetIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(
        new Set(
            value
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
        )
    );
}

function normalizeWidgetSnapshot(input: {
    activeWidgets: string[];
    mountedWidgets: string[];
    focusedWidget: string | null;
}): {
    activeWidgets: string[];
    mountedWidgets: string[];
    focusedWidget: string | null;
} {
    const normalizedMounted = normalizeWidgetIds(input.mountedWidgets).filter((id) => KNOWN_WIDGET_IDS.has(id));
    const normalizedActive = normalizeWidgetIds(input.activeWidgets).filter((id) => KNOWN_WIDGET_IDS.has(id));
    const mountedWidgets =
        normalizedMounted.length > 0
            ? normalizedMounted
            : normalizedActive.length > 0
                ? [...normalizedActive]
                : [FALLBACK_WIDGET];
    const activeFromMounted = normalizedActive.filter((id) => mountedWidgets.includes(id));
    const activeWidgets =
        activeFromMounted.length > 0
            ? activeFromMounted
            : [input.focusedWidget && mountedWidgets.includes(input.focusedWidget) ? input.focusedWidget : mountedWidgets[0] ?? FALLBACK_WIDGET];
    const focusedWidget =
        input.focusedWidget && activeWidgets.includes(input.focusedWidget)
            ? input.focusedWidget
            : activeWidgets[activeWidgets.length - 1] ?? mountedWidgets[0] ?? FALLBACK_WIDGET;

    return {
        activeWidgets,
        mountedWidgets: Array.from(new Set([...mountedWidgets, ...activeWidgets])),
        focusedWidget,
    };
}

function normalizePromptKey(prompt: string): string {
    return prompt.replace(/\s+/g, " ").trim().toLowerCase();
}

function resolvePreferredSessionFocus(
    mountedWidgets: string[],
    activeWidgets: string[],
    fallbackFocusedWidget: string | null | undefined,
    options?: {
        taskLinked?: boolean;
        preferAssistant?: boolean;
    }
): string | null {
    if (options?.preferAssistant && mountedWidgets.includes("assistant")) {
        return "assistant";
    }
    if (options?.taskLinked && mountedWidgets.includes("assistant")) {
        return "assistant";
    }
    if (fallbackFocusedWidget && mountedWidgets.includes(fallbackFocusedWidget)) {
        return fallbackFocusedWidget;
    }
    const activeCandidate = activeWidgets.find((widgetId) => mountedWidgets.includes(widgetId));
    if (activeCandidate) {
        return activeCandidate;
    }
    if (mountedWidgets.includes("assistant")) {
        return "assistant";
    }
    if (mountedWidgets.includes("tasks")) {
        return "tasks";
    }
    return mountedWidgets[mountedWidgets.length - 1] ?? null;
}

function dedupeRuntimeSessions(sessions: HudSession[]): HudSession[] {
    const seenIds = new Set<string>();
    const seenTaskIds = new Set<string>();
    const seenMissionIds = new Set<string>();
    const seenPromptTs = new Map<string, number>();
    let activeConsumed = false;
    const next: HudSession[] = [];

    for (const session of sessions) {
        const id = session.id.trim();
        if (!id || seenIds.has(id)) {
            continue;
        }

        const taskId = typeof session.taskId === "string" && session.taskId.trim().length > 0 ? session.taskId.trim() : null;
        if (taskId && seenTaskIds.has(taskId)) {
            continue;
        }
        const missionId =
            typeof session.missionId === "string" && session.missionId.trim().length > 0 ? session.missionId.trim() : null;
        if (missionId && seenMissionIds.has(missionId)) {
            continue;
        }

        const promptKey = normalizePromptKey(session.prompt);
        if (promptKey) {
            const createdAtMs = Date.parse(session.createdAt);
            const seenCreatedAtMs = seenPromptTs.get(promptKey);
            if (
                typeof seenCreatedAtMs === "number" &&
                Number.isFinite(createdAtMs) &&
                Math.abs(createdAtMs - seenCreatedAtMs) <= SESSION_PROMPT_DEDUPE_WINDOW_MS
            ) {
                continue;
            }
            if (Number.isFinite(createdAtMs)) {
                seenPromptTs.set(promptKey, createdAtMs);
            }
        }

        seenIds.add(id);
        if (taskId) {
            seenTaskIds.add(taskId);
        }
        if (missionId) {
            seenMissionIds.add(missionId);
        }

        if (session.status === "active") {
            if (activeConsumed) {
                next.push({
                    ...session,
                    status: "background",
                });
            } else {
                next.push(session);
                activeConsumed = true;
            }
        } else {
            next.push(session);
        }
    }

    return next.slice(0, 20);
}

interface HUDContextType {
    hydrated: boolean;
    activeWidgets: string[];
    mountedWidgets: string[];
    focusedWidget: string | null;
    activeWorkspacePreset: HudWorkspacePreset | null;
    toggleWidget: (id: string) => void;
    closeWidget: (id: string) => void;
    dropWidget: (id: string) => void;
    openWidget: (id: string) => void;
    openWidgets: (
        ids: string[],
        options?: {
            focus?: string;
            replace?: boolean;
            activate?: "all" | "focus_only";
            workspacePreset?: HudWorkspacePreset | null;
        }
    ) => void;
    focusWidget: (id: string) => void;
    closeAll: () => void;
    sessions: HudSession[];
    activeSessionId: string | null;
    startSession: (
        prompt: string,
        snapshot?: {
            activeWidgets?: string[];
            mountedWidgets?: string[];
            focusedWidget?: string | null;
            workspacePreset?: HudWorkspacePreset | null;
            intent?: string | null;
            sessionId?: string;
            restoreMode?: HudSessionRestoreMode;
        }
    ) => string;
    switchSession: (sessionId: string, options?: { restoreMode?: HudSessionRestoreMode }) => void;
    archiveSession: (sessionId: string) => void;
    linkSessionTask: (sessionId: string, taskId?: string, missionId?: string) => void;
    markSessionContextDelivered: (sessionId: string, contextId: string, revision: number) => void;
    updateSessionStaleState: (
        sessionId: string,
        state: {
            stale: boolean;
            reason?: string | null;
            detectedAt?: string | null;
        }
    ) => void;
    setActiveWorkspacePreset: (preset: HudWorkspacePreset | null) => void;
    visualCoreScene: Jarvis3DScene | null;
    setVisualCoreScene: (scene: Jarvis3DScene) => void;
}

const HUDContext = createContext<HUDContextType | undefined>(undefined);

export function HUDProvider({ children }: { children: ReactNode }) {
    const [hydrated, setHydrated] = useState(false);
    const [activeWidgets, setActiveWidgets] = useState<string[]>([FALLBACK_WIDGET]);
    const [mountedWidgets, setMountedWidgets] = useState<string[]>([FALLBACK_WIDGET]);
    const [focusedWidget, setFocusedWidget] = useState<string | null>(FALLBACK_WIDGET);
    const [activeWorkspacePreset, setActiveWorkspacePreset] = useState<HudWorkspacePreset | null>(null);
    const [visualCoreScene, setVisualCoreScene] = useState<Jarvis3DScene | null>(null);

    // Restore persisted state after hydration (client-only)
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        const savedMounted = readStoredArray(STORE_KEY_MOUNTED, [FALLBACK_WIDGET]);
        const savedActive = readStoredArray(STORE_KEY_ACTIVE, savedMounted);
        const savedFocused = readStoredString(STORE_KEY_FOCUSED);
        const normalized = normalizeWidgetSnapshot({
            activeWidgets: savedActive,
            mountedWidgets: savedMounted,
            focusedWidget: savedFocused,
        });
        const savedPreset = readStoredString(STORE_KEY_PRESET) as HudWorkspacePreset | null;
        setActiveWidgets(normalized.activeWidgets);
        setMountedWidgets(normalized.mountedWidgets);
        setFocusedWidget(normalized.focusedWidget);
        setActiveWorkspacePreset(savedPreset);
        setHydrated(true);
    }, []);

    // Persist to localStorage when state changes (skip the initial restore frame)
    const skipFirstPersist = useRef(true);
    useEffect(() => {
        if (skipFirstPersist.current) { skipFirstPersist.current = false; return; }
        writeStore(STORE_KEY_ACTIVE, activeWidgets);
    }, [activeWidgets]);
    useEffect(() => { writeStore(STORE_KEY_MOUNTED, mountedWidgets); }, [mountedWidgets]);
    useEffect(() => { writeStore(STORE_KEY_FOCUSED, focusedWidget); }, [focusedWidget]);
    useEffect(() => { writeStore(STORE_KEY_PRESET, activeWorkspacePreset); }, [activeWorkspacePreset]);

    const focusWidget = useCallback((id: string) => {
        setActiveWidgets((prev) => {
            if (!prev.includes(id)) return prev;
            const filtered = prev.filter(w => w !== id);
            return [...filtered, id];
        });
        setFocusedWidget(id);
    }, []);

    const toggleWidget = useCallback((id: string) => {
        setActiveWorkspacePreset(null);
        setActiveWidgets((prev) => {
            const isClosing = prev.includes(id);
            if (isClosing) {
                setFocusedWidget((f) => f === id ? (prev.length > 1 ? prev[prev.length - 2] ?? null : null) : f);
                return prev.filter((w) => w !== id);
            } else {
                setFocusedWidget(id);
                return [...prev, id];
            }
        });
        setMountedWidgets((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }, []);

    const closeWidget = useCallback((id: string) => {
        setActiveWorkspacePreset(null);
        setActiveWidgets((prev) => {
            setFocusedWidget((f) => f === id ? (prev.length > 1 ? prev[prev.length - 2] ?? null : null) : f);
            return prev.filter((w) => w !== id);
        });
    }, []);

    const dropWidget = useCallback((id: string) => {
        setActiveWorkspacePreset(null);
        setActiveWidgets((prev) => {
            setFocusedWidget((f) => f === id ? (prev.length > 1 ? prev[prev.length - 2] ?? null : null) : f);
            return prev.filter((w) => w !== id);
        });
        setMountedWidgets((prev) => prev.filter((w) => w !== id));
    }, []);

    const openWidget = useCallback((id: string) => {
        setActiveWorkspacePreset(null);
        setMountedWidgets((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setActiveWidgets((prev) => {
            if (!prev.includes(id)) {
                setFocusedWidget(id);
                return [...prev, id];
            }
            setFocusedWidget(id);
            const filtered = prev.filter(w => w !== id);
            return [...filtered, id];
        });
    }, []);

    const openWidgets = useCallback((
        ids: string[],
        options?: {
            focus?: string;
            replace?: boolean;
            activate?: "all" | "focus_only";
            workspacePreset?: HudWorkspacePreset | null;
        }
    ) => {
        const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.trim().length > 0)));
        if (uniqueIds.length === 0) return;

        if (Object.prototype.hasOwnProperty.call(options ?? {}, "workspacePreset")) {
            setActiveWorkspacePreset(options?.workspacePreset ?? null);
        } else {
            setActiveWorkspacePreset(null);
        }

        setMountedWidgets((prev) => {
            if (options?.replace === true) {
                return [...uniqueIds];
            }
            const next = [...prev];
            for (const id of uniqueIds) {
                if (!next.includes(id)) next.push(id);
            }
            return next;
        });

        setActiveWidgets((prev) => {
            const replace = options?.replace === true;
            const activateMode = options?.activate ?? "all";
            const requestedFocus = options?.focus;
            const fallbackFocus = uniqueIds[uniqueIds.length - 1] ?? null;
            const nextFocus =
                requestedFocus && uniqueIds.includes(requestedFocus) ? requestedFocus : fallbackFocus;
            const next = replace ? [] : [...prev];

            if (activateMode === "focus_only") {
                if (nextFocus) {
                    if (!next.includes(nextFocus)) next.push(nextFocus);
                    const focusIndex = next.indexOf(nextFocus);
                    if (focusIndex >= 0) {
                        next.splice(focusIndex, 1);
                        next.push(nextFocus);
                    }
                }
            } else {
                for (const id of uniqueIds) {
                    if (!next.includes(id)) next.push(id);
                }
                if (nextFocus && next.includes(nextFocus)) {
                    const focusIndex = next.indexOf(nextFocus);
                    next.splice(focusIndex, 1);
                    next.push(nextFocus);
                }
            }

            setFocusedWidget(nextFocus ?? null);
            return next;
        });
    }, []);

    const closeAll = useCallback(() => {
        setActiveWidgets([]);
        setFocusedWidget(null);
        setActiveWorkspacePreset(null);
    }, []);

    // --- Session management ---
    const [sessions, setSessions] = useState<HudSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [sessionsLoaded, setSessionsLoaded] = useState(false);

    useEffect(() => {
        if (!restoredRef.current) return;
        const saved = loadPersistedSessions();
        setSessions(saved);
        const active = saved.find((s) => s.status === "active");
        setActiveSessionId(active?.id ?? null);
        setSessionsLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restoredRef.current]);

    useEffect(() => {
        if (!sessionsLoaded) return;
        persistSessions(sessions);
    }, [sessions, sessionsLoaded]);

    useEffect(() => {
        if (!sessionsLoaded) {
            return;
        }
        setSessions((prev) => {
            const deduped = dedupeRuntimeSessions(prev);
            if (deduped.length !== prev.length) {
                return deduped;
            }
            for (let index = 0; index < deduped.length; index += 1) {
                if (deduped[index]?.id !== prev[index]?.id || deduped[index]?.status !== prev[index]?.status) {
                    return deduped;
                }
            }
            return prev;
        });
    }, [sessionsLoaded]);

    const startSession = useCallback((
        prompt: string,
        snapshot?: {
            activeWidgets?: string[];
            mountedWidgets?: string[];
            focusedWidget?: string | null;
            workspacePreset?: HudWorkspacePreset | null;
            intent?: string | null;
            sessionId?: string;
            restoreMode?: HudSessionRestoreMode;
        }
    ): string => {
        const requestedActiveWidgets = normalizeWidgetIds(snapshot?.activeWidgets);
        const requestedMountedWidgets = normalizeWidgetIds(snapshot?.mountedWidgets);
        const nextActiveWidgets = Array.from(
            new Set(requestedActiveWidgets.length > 0 ? requestedActiveWidgets : activeWidgets)
        );
        const resolvedActiveWidgets = nextActiveWidgets.length > 0 ? nextActiveWidgets : ["inbox"];
        const nextMountedWidgets = Array.from(
            new Set(requestedMountedWidgets.length > 0 ? requestedMountedWidgets : mountedWidgets)
        );
        const resolvedMountedWidgets =
            nextMountedWidgets.length > 0
                ? Array.from(new Set([...nextMountedWidgets, ...resolvedActiveWidgets]))
                : [...resolvedActiveWidgets];
        const nextFocusedCandidate = Object.prototype.hasOwnProperty.call(snapshot ?? {}, "focusedWidget")
            ? snapshot?.focusedWidget ?? null
            : focusedWidget;
        const nextFocused =
            nextFocusedCandidate && resolvedActiveWidgets.includes(nextFocusedCandidate)
                ? nextFocusedCandidate
                : resolvedActiveWidgets[resolvedActiveWidgets.length - 1] ?? null;
        const nextPreset = Object.prototype.hasOwnProperty.call(snapshot ?? {}, "workspacePreset")
            ? snapshot?.workspacePreset ?? null
            : activeWorkspacePreset;
        const normalizedSnapshot = normalizeWidgetSnapshot({
            activeWidgets: resolvedActiveWidgets,
            mountedWidgets: resolvedMountedWidgets,
            focusedWidget: nextFocused,
        });

        const newSession = buildSession(
            prompt,
            normalizedSnapshot.activeWidgets,
            normalizedSnapshot.mountedWidgets,
            normalizedSnapshot.focusedWidget,
            nextPreset,
            {
            id: snapshot?.sessionId,
            intent: snapshot?.intent,
            restoreMode: snapshot?.restoreMode,
            }
        );

        setSessions((prev) => {
            let updated = prev.map((s) =>
                s.status === "active"
                    ? {
                        ...s,
                        status: "background" as const,
                        activeWidgets: [...activeWidgets],
                        mountedWidgets: [...mountedWidgets],
                        focusedWidget,
                        workspacePreset: activeWorkspacePreset as string | null,
                        lastWorkspacePreset: activeWorkspacePreset as string | null,
                    }
                    : s,
            );
            const newPromptKey = normalizePromptKey(newSession.prompt);
            const newCreatedAtMs = Date.parse(newSession.createdAt);
            updated = [
                newSession,
                ...updated.filter((session) => {
                    if (session.id === newSession.id) {
                        return false;
                    }
                    const existingPromptKey = normalizePromptKey(session.prompt);
                    if (!newPromptKey || newPromptKey !== existingPromptKey) {
                        return true;
                    }
                    const existingCreatedAtMs = Date.parse(session.createdAt);
                    if (Number.isNaN(newCreatedAtMs) || Number.isNaN(existingCreatedAtMs)) {
                        return false;
                    }
                    return Math.abs(newCreatedAtMs - existingCreatedAtMs) > SESSION_PROMPT_DEDUPE_WINDOW_MS;
                }),
            ];
            return updated.slice(0, 20);
        });
        setActiveSessionId(newSession.id);
        return newSession.id;
    }, [activeWidgets, mountedWidgets, focusedWidget, activeWorkspacePreset]);

    const switchSession = useCallback((sessionId: string, options?: { restoreMode?: HudSessionRestoreMode }) => {
        setSessions((prev) => {
            const target = prev.find((s) => s.id === sessionId);
            if (!target) return prev;
            const targetActiveWidgets = normalizeWidgetIds(target.activeWidgets);
            const targetMountedWidgets = normalizeWidgetIds(target.mountedWidgets);
            const targetPreset = (target.lastWorkspacePreset ?? target.workspacePreset) ?? null;
            const hasOnlyInboxActive = targetActiveWidgets.length === 1 && targetActiveWidgets[0] === "inbox";
            const hasOnlyInboxMounted = targetMountedWidgets.length === 1 && targetMountedWidgets[0] === "inbox";

            let derivedWidgets: string[] = [];
            if ((targetMountedWidgets.length === 0 || hasOnlyInboxMounted) && targetPreset) {
                try {
                    derivedWidgets = [...getHudWorkspacePresetConfig(targetPreset as HudWorkspacePreset).widgets];
                } catch {
                    derivedWidgets = [];
                }
            }
            if (
                targetActiveWidgets.length > 0 &&
                !hasOnlyInboxActive &&
                targetMountedWidgets.length === 0
            ) {
                derivedWidgets = [...targetActiveWidgets];
            }
            if (derivedWidgets.length === 0 && (target.taskId || target.missionId)) {
                derivedWidgets = ["assistant", "tasks"];
            }

            let resolvedTargetMountedWidgets = Array.from(
                new Set(
                    (targetMountedWidgets.length > 0 && !hasOnlyInboxMounted
                        ? targetMountedWidgets
                        : targetActiveWidgets.length > 0 && !hasOnlyInboxActive
                            ? targetActiveWidgets
                            : derivedWidgets.length > 0
                                ? derivedWidgets
                                : ["inbox"]
                    )
                )
            );
            const deterministicRestoreEnabled = isFeatureEnabled("session.restore_deterministic_v2", true);
            const restoreMode =
                options?.restoreMode ??
                (deterministicRestoreEnabled ? "focus_only" : target.restoreMode ?? "full");
            if (restoreMode === "full" && (target.taskId || target.missionId)) {
                resolvedTargetMountedWidgets = Array.from(
                    new Set([...resolvedTargetMountedWidgets, "assistant", "tasks", "approvals"])
                );
            }
            const candidateFocused = resolvePreferredSessionFocus(
                resolvedTargetMountedWidgets,
                targetActiveWidgets,
                target.focusedWidget,
                {
                    taskLinked: Boolean(target.taskId || target.missionId),
                    preferAssistant: restoreMode === "focus_only",
                }
            );
            const resolvedTargetActiveWidgets = restoreMode === "focus_only"
                ? [candidateFocused ?? resolvedTargetMountedWidgets[0] ?? "inbox"]
                : [...resolvedTargetMountedWidgets];
            const targetFocused =
                candidateFocused && resolvedTargetActiveWidgets.includes(candidateFocused)
                    ? candidateFocused
                    : resolvedTargetActiveWidgets[resolvedTargetActiveWidgets.length - 1] ?? null;
            const normalizedTarget = normalizeWidgetSnapshot({
                activeWidgets: resolvedTargetActiveWidgets,
                mountedWidgets: resolvedTargetMountedWidgets,
                focusedWidget: targetFocused,
            });

            const currentActive = prev.find((s) => s.status === "active");
            let updated = prev.map((s) => {
                if (s.id === sessionId) {
                    return {
                        ...s,
                        status: "active" as const,
                        activeWidgets: normalizedTarget.activeWidgets,
                        mountedWidgets: normalizedTarget.mountedWidgets,
                        focusedWidget: normalizedTarget.focusedWidget,
                        workspacePreset: targetPreset,
                        lastWorkspacePreset: targetPreset,
                        restoreMode,
                    };
                }
                if (s.status === "active") {
                    return {
                        ...s,
                        status: "background" as const,
                        activeWidgets: [...activeWidgets],
                        mountedWidgets: [...mountedWidgets],
                        focusedWidget: focusedWidget,
                        workspacePreset: activeWorkspacePreset as string | null,
                        lastWorkspacePreset: activeWorkspacePreset as string | null,
                    };
                }
                return s;
            });

            if (currentActive && currentActive.id !== sessionId) {
                updated = patchSession(updated, currentActive.id, {
                    activeWidgets: [...activeWidgets],
                    mountedWidgets: [...mountedWidgets],
                    focusedWidget,
                    workspacePreset: activeWorkspacePreset as string | null,
                    lastWorkspacePreset: activeWorkspacePreset as string | null,
                });
            }

            setActiveWidgets(normalizedTarget.activeWidgets);
            setFocusedWidget(normalizedTarget.focusedWidget);
            setActiveWorkspacePreset(targetPreset as HudWorkspacePreset | null);
            setMountedWidgets(normalizedTarget.mountedWidgets);

            setActiveSessionId(sessionId);
            emitRuntimeEvent("session_switched", {
                fromSessionId: currentActive?.id ?? null,
                toSessionId: sessionId,
                restoreMode,
                activeWidgets: normalizedTarget.activeWidgets,
                mountedWidgets: normalizedTarget.mountedWidgets,
                focusedWidget: normalizedTarget.focusedWidget,
            });
            return updated;
        });
    }, [activeWidgets, mountedWidgets, focusedWidget, activeWorkspacePreset]);

    const archiveSession = useCallback((sessionId: string) => {
        setSessions((prev) => {
            const updated = dropSession(prev, sessionId);
            if (sessionId === activeSessionId) {
                setActiveSessionId(null);
            }
            return updated;
        });
    }, [activeSessionId]);

    const linkSessionTask = useCallback((sessionId: string, taskId?: string, missionId?: string) => {
        setSessions((prev) => {
            const patched = patchSession(prev, sessionId, { taskId, missionId });
            return patched
                .filter((session) => {
                    if (session.id === sessionId) {
                        return true;
                    }
                    if (taskId && session.taskId === taskId) {
                        return false;
                    }
                    if (missionId && session.missionId === missionId) {
                        return false;
                    }
                    return true;
                })
                .slice(0, 20);
        });
    }, []);

    const markSessionContextDelivered = useCallback((sessionId: string, contextId: string, revision: number) => {
        if (!sessionId || !contextId || !Number.isFinite(revision)) {
            return;
        }
        setSessions((prev) => {
            const target = prev.find((session) => session.id === sessionId);
            if (!target) {
                return prev;
            }
            const currentMap = target.lastDeliveredContextRevision ?? {};
            const currentRevision = currentMap[contextId];
            if (typeof currentRevision === "number" && revision <= currentRevision) {
                return prev;
            }
            return patchSession(prev, sessionId, {
                lastDeliveredContextRevision: {
                    ...currentMap,
                    [contextId]: revision,
                },
            });
        });
    }, []);

    const updateSessionStaleState = useCallback((
        sessionId: string,
        state: {
            stale: boolean;
            reason?: string | null;
            detectedAt?: string | null;
        }
    ) => {
        if (!sessionId) {
            return;
        }
        setSessions((prev) => {
            const target = prev.find((session) => session.id === sessionId);
            if (!target) {
                return prev;
            }

            const nextStale = state.stale === true;
            const nextReason =
                nextStale
                    ? (typeof state.reason === "string" && state.reason.trim().length > 0
                        ? state.reason.trim()
                        : target.staleReason ?? "server_state_lost")
                    : undefined;
            const nextDetectedAt =
                nextStale
                    ? (typeof state.detectedAt === "string" && state.detectedAt.trim().length > 0
                        ? state.detectedAt
                        : target.staleDetectedAt ?? new Date().toISOString())
                    : undefined;

            if (
                Boolean(target.stale) === nextStale &&
                (target.staleReason ?? undefined) === nextReason &&
                (target.staleDetectedAt ?? undefined) === nextDetectedAt
            ) {
                return prev;
            }

            return patchSession(prev, sessionId, {
                stale: nextStale,
                staleReason: nextReason,
                staleDetectedAt: nextDetectedAt,
            });
        });
    }, []);

    useEffect(() => {
        if (!activeSessionId) return;
        setSessions((prev) =>
            {
                const current = prev.find((session) => session.id === activeSessionId);
                if (!current) {
                    return prev;
                }
                const hasVisibleActiveWidgets = activeWidgets.length > 0;
                const nextMountedWidgets = [...mountedWidgets];
                const nextActiveWidgets = hasVisibleActiveWidgets
                    ? [...activeWidgets]
                    : current.activeWidgets.length > 0
                        ? [...current.activeWidgets]
                        : [resolvePreferredSessionFocus(nextMountedWidgets, [], current.focusedWidget) ?? "inbox"];
                const nextFocusedWidget = hasVisibleActiveWidgets
                    ? focusedWidget
                    : current.focusedWidget ?? resolvePreferredSessionFocus(nextMountedWidgets, nextActiveWidgets, null);

                return patchSession(prev, activeSessionId, {
                    activeWidgets: nextActiveWidgets,
                    mountedWidgets: nextMountedWidgets,
                    focusedWidget: nextFocusedWidget,
                    workspacePreset: activeWorkspacePreset as string | null,
                    lastWorkspacePreset: activeWorkspacePreset as string | null,
                });
            }
        );
    }, [activeSessionId, activeWidgets, mountedWidgets, focusedWidget, activeWorkspacePreset]);

    return (
        <HUDContext.Provider value={{
            hydrated,
            activeWidgets,
            mountedWidgets,
            focusedWidget,
            activeWorkspacePreset,
            toggleWidget,
            closeWidget,
            dropWidget,
            openWidget,
            openWidgets,
            focusWidget,
            closeAll,
            sessions,
            activeSessionId,
            startSession,
            switchSession,
            archiveSession,
            linkSessionTask,
            markSessionContextDelivered,
            updateSessionStaleState,
            setActiveWorkspacePreset,
            visualCoreScene,
            setVisualCoreScene
        }}>
            {children}
        </HUDContext.Provider>
    );
}

export function useHUD() {
    const context = useContext(HUDContext);
    if (context === undefined) {
        throw new Error("useHUD must be used within a HUDProvider");
    }
    return context;
}
