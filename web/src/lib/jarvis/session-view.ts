"use client";

import type { JarvisSessionPrimaryTarget, JarvisSessionRecord, JarvisWorkspacePreset } from "@/lib/api/types";
import type { HudSession, HudSessionRestoreMode } from "@/lib/hud/session";
import type { HudWorkspacePreset } from "@/lib/hud/widget-presets";

export type JarvisSessionView = JarvisSessionRecord & {
  hudSession: HudSession | null;
  localOnly: boolean;
};

export function resolveHudPrimaryTarget(intent?: string): JarvisSessionRecord["primaryTarget"] {
  if (intent === "council") return "council";
  if (intent === "code") return "execution";
  if (intent === "research" || intent === "news" || intent === "finance") return "dossier";
  return "assistant";
}

export function resolveHudWorkspacePreset(workspacePreset?: string | null): JarvisSessionRecord["workspacePreset"] {
  if (workspacePreset === "jarvis" || workspacePreset === "research" || workspacePreset === "execution" || workspacePreset === "control") {
    return workspacePreset;
  }
  return null;
}

export function mergeHudAndJarvisSessions(
  hudSessions: HudSession[],
  jarvisSessions: JarvisSessionRecord[],
): JarvisSessionView[] {
  const hudById = new Map(hudSessions.map((session) => [session.id, session]));
  const merged: JarvisSessionView[] = jarvisSessions.map((session) => ({
    ...session,
    hudSession: hudById.get(session.id) ?? null,
    localOnly: false,
  }));

  for (const hudSession of hudSessions) {
    if (merged.some((session) => session.id === hudSession.id)) {
      continue;
    }
    merged.push({
      id: hudSession.id,
      userId: "",
      title: hudSession.prompt,
      prompt: hudSession.prompt,
      source: "hud_runtime",
      intent:
        hudSession.intent === "code" ||
        hudSession.intent === "research" ||
        hudSession.intent === "finance" ||
        hudSession.intent === "news" ||
        hudSession.intent === "council"
          ? hudSession.intent
          : "general",
      status: hudSession.stale ? "stale" : hudSession.status === "active" ? "running" : "queued",
      workspacePreset: resolveHudWorkspacePreset(hudSession.workspacePreset),
      primaryTarget: resolveHudPrimaryTarget(hudSession.intent),
      taskId: hudSession.taskId ?? null,
      missionId: hudSession.missionId ?? null,
      assistantContextId: null,
      councilRunId: null,
      executionRunId: null,
      briefingId: null,
      dossierId: null,
      createdAt: hudSession.createdAt,
      updatedAt: hudSession.staleDetectedAt ?? hudSession.createdAt,
      lastEventAt: hudSession.staleDetectedAt ?? hudSession.createdAt,
      hudSession,
      localOnly: true,
    });
  }

  return merged.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function resolveFallbackWidgets(target: JarvisSessionPrimaryTarget): string[] {
  if (target === "council") return ["assistant", "tasks", "council"];
  if (target === "execution") return ["assistant", "tasks", "workbench"];
  if (target === "dossier" || target === "briefing") return ["assistant", "tasks", "dossier"];
  return ["assistant", "tasks"];
}

export function getSessionRestoreConfig(
  session: JarvisSessionView,
  restoreMode: HudSessionRestoreMode,
): {
  mountedWidgets: string[];
  activeWidgets: string[];
  focus: string;
  workspacePreset: HudWorkspacePreset | null;
  activation: "all" | "focus_only";
} {
  const hud = session.hudSession;
  const workspacePreset = resolveHudPreset(hud ? hud.lastWorkspacePreset ?? hud.workspacePreset : session.workspacePreset, session.primaryTarget);
  const mountedWidgets =
    hud?.mountedWidgets && hud.mountedWidgets.length > 0
      ? [...hud.mountedWidgets]
      : resolveFallbackWidgets(session.primaryTarget);

  const fallbackFocus =
    session.primaryTarget === "council"
      ? "council"
      : session.primaryTarget === "execution"
        ? "workbench"
        : session.primaryTarget === "dossier" || session.primaryTarget === "briefing"
          ? "dossier"
          : "assistant";
  const focus =
    hud?.focusedWidget && mountedWidgets.includes(hud.focusedWidget)
      ? hud.focusedWidget
      : mountedWidgets.includes(fallbackFocus)
        ? fallbackFocus
        : mountedWidgets[0] ?? "assistant";

  const activeWidgets =
    restoreMode === "focus_only"
      ? [focus]
      : hud?.activeWidgets && hud.activeWidgets.length > 0
        ? [...hud.activeWidgets]
        : mountedWidgets;

  return {
    mountedWidgets,
    activeWidgets,
    focus,
    workspacePreset,
    activation: restoreMode === "full" ? "all" : "focus_only",
  };
}

function resolveHudPreset(
  workspacePreset: string | JarvisWorkspacePreset | null | undefined,
  primaryTarget: JarvisSessionPrimaryTarget,
): HudWorkspacePreset | null {
  if (workspacePreset === "mission" || workspacePreset === "studio_code" || workspacePreset === "studio_research" || workspacePreset === "studio_intelligence" || workspacePreset === "studio_council") {
    return workspacePreset;
  }
  if (workspacePreset === "jarvis") {
    return "mission";
  }
  if (workspacePreset === "research") {
    return "studio_research";
  }
  if (workspacePreset === "execution") {
    return "studio_code";
  }
  if (workspacePreset === "control") {
    return "studio_intelligence";
  }
  if (primaryTarget === "council") {
    return "studio_council";
  }
  if (primaryTarget === "execution") {
    return "studio_code";
  }
  if (primaryTarget === "dossier" || primaryTarget === "briefing") {
    return "studio_research";
  }
  return "mission";
}
