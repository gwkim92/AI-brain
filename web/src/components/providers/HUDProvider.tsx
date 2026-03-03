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

const STORE_KEY_ACTIVE = "hud-active-widgets";
const STORE_KEY_MOUNTED = "hud-mounted-widgets";
const STORE_KEY_FOCUSED = "hud-focused-widget";
const STORE_KEY_PRESET = "hud-workspace-preset";
const FALLBACK_WIDGET = "inbox";
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

interface HUDContextType {
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
    setActiveWorkspacePreset: (preset: HudWorkspacePreset | null) => void;
    visualCoreScene: Jarvis3DScene | null;
    setVisualCoreScene: (scene: Jarvis3DScene) => void;
}

const HUDContext = createContext<HUDContextType | undefined>(undefined);

export function HUDProvider({ children }: { children: ReactNode }) {
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
        const normalizedActive = savedActive.filter((widgetId) => savedMounted.includes(widgetId));
        const resolvedActive = normalizedActive.length > 0 ? normalizedActive : [...savedMounted];
        const savedFocused = readStoredString(STORE_KEY_FOCUSED);
        const resolvedFocused =
            savedFocused && resolvedActive.includes(savedFocused) ? savedFocused : resolvedActive[resolvedActive.length - 1] ?? FALLBACK_WIDGET;
        const savedPreset = readStoredString(STORE_KEY_PRESET) as HudWorkspacePreset | null;
        setActiveWidgets(resolvedActive);
        setMountedWidgets(savedMounted);
        setFocusedWidget(resolvedFocused);
        setActiveWorkspacePreset(savedPreset);
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

        const newSession = buildSession(prompt, resolvedActiveWidgets, resolvedMountedWidgets, nextFocused, nextPreset, {
            id: snapshot?.sessionId,
            intent: snapshot?.intent,
            restoreMode: snapshot?.restoreMode,
        });

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
            updated = [newSession, ...updated.filter((session) => session.id !== newSession.id)];
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

            const resolvedTargetMountedWidgets = Array.from(
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
            const restoreMode = options?.restoreMode ?? target.restoreMode ?? "full";
            const candidateFocused =
                target.focusedWidget && resolvedTargetMountedWidgets.includes(target.focusedWidget)
                    ? target.focusedWidget
                    : targetActiveWidgets.find((id) => resolvedTargetMountedWidgets.includes(id)) ??
                    resolvedTargetMountedWidgets[resolvedTargetMountedWidgets.length - 1] ??
                    null;
            const resolvedTargetActiveWidgets = restoreMode === "focus_only"
                ? [candidateFocused ?? resolvedTargetMountedWidgets[0] ?? "inbox"]
                : [...resolvedTargetMountedWidgets];
            const targetFocused =
                candidateFocused && resolvedTargetActiveWidgets.includes(candidateFocused)
                    ? candidateFocused
                    : resolvedTargetActiveWidgets[resolvedTargetActiveWidgets.length - 1] ?? null;

            const currentActive = prev.find((s) => s.status === "active");
            let updated = prev.map((s) => {
                if (s.id === sessionId) {
                    return {
                        ...s,
                        status: "active" as const,
                        activeWidgets: resolvedTargetActiveWidgets,
                        mountedWidgets: resolvedTargetMountedWidgets,
                        focusedWidget: targetFocused,
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

            setActiveWidgets(resolvedTargetActiveWidgets);
            setFocusedWidget(targetFocused);
            setActiveWorkspacePreset(targetPreset as HudWorkspacePreset | null);
            setMountedWidgets(resolvedTargetMountedWidgets);

            setActiveSessionId(sessionId);
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
        setSessions((prev) => patchSession(prev, sessionId, { taskId, missionId }));
    }, []);

    useEffect(() => {
        if (!activeSessionId) return;
        setSessions((prev) =>
            patchSession(prev, activeSessionId, {
                activeWidgets: [...activeWidgets],
                mountedWidgets: [...mountedWidgets],
                focusedWidget,
                workspacePreset: activeWorkspacePreset as string | null,
                lastWorkspacePreset: activeWorkspacePreset as string | null,
            })
        );
    }, [activeSessionId, activeWidgets, mountedWidgets, focusedWidget, activeWorkspacePreset]);

    return (
        <HUDContext.Provider value={{
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
