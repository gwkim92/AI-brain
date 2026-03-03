const STORAGE_KEY = "hud-sessions";
const MAX_SESSIONS = 20;

export type HudSessionStatus = "active" | "background";
export type HudSessionRestoreMode = "full" | "focus_only";

export type HudSession = {
  id: string;
  prompt: string;
  createdAt: string;
  activeWidgets: string[];
  mountedWidgets: string[];
  focusedWidget: string | null;
  workspacePreset: string | null;
  taskId?: string;
  missionId?: string;
  intent?: string;
  restoreMode: HudSessionRestoreMode;
  lastWorkspacePreset: string | null;
  status: HudSessionStatus;
};

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadSessions(): HudSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalizeSession(item))
      .filter((item): item is HudSession => item !== null)
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: HudSession[]): void {
  try {
    const trimmed = sessions.slice(0, MAX_SESSIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage may be unavailable
  }
}

export function createSession(
  prompt: string,
  activeWidgets: string[],
  mountedWidgets: string[],
  focusedWidget: string | null,
  workspacePreset: string | null,
  options?: {
    id?: string;
    intent?: string | null;
    restoreMode?: HudSessionRestoreMode;
  }
): HudSession {
  const normalizedActive = normalizeWidgetList(activeWidgets);
  const normalizedMounted = normalizeWidgetList(mountedWidgets);
  const mergedMounted =
    normalizedMounted.length > 0 ? normalizedMounted : [...normalizedActive];
  const resolvedActive = normalizedActive.length > 0 ? normalizedActive : ["inbox"];
  const resolvedMounted =
    mergedMounted.length > 0 ? Array.from(new Set([...mergedMounted, ...resolvedActive])) : [...resolvedActive];
  const resolvedFocused =
    focusedWidget && resolvedMounted.includes(focusedWidget)
      ? focusedWidget
      : resolvedActive[resolvedActive.length - 1] ?? null;

  return {
    id: options?.id && options.id.trim().length > 0 ? options.id.trim() : generateId(),
    prompt,
    createdAt: new Date().toISOString(),
    activeWidgets: resolvedActive,
    mountedWidgets: resolvedMounted,
    focusedWidget: resolvedFocused,
    workspacePreset,
    intent: options?.intent?.trim() || undefined,
    restoreMode: options?.restoreMode ?? "full",
    lastWorkspacePreset: workspacePreset,
    status: "active",
  };
}

export function updateSession(
  sessions: HudSession[],
  sessionId: string,
  patch: Partial<
    Pick<
      HudSession,
      | "activeWidgets"
      | "mountedWidgets"
      | "focusedWidget"
      | "workspacePreset"
      | "taskId"
      | "missionId"
      | "status"
      | "intent"
      | "restoreMode"
      | "lastWorkspacePreset"
    >
  >,
): HudSession[] {
  return sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s));
}

export function removeSession(sessions: HudSession[], sessionId: string): HudSession[] {
  return sessions.filter((s) => s.id !== sessionId);
}

function normalizeWidgetList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  );
}

function normalizeSession(value: unknown): HudSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.trim().length === 0) {
    return null;
  }
  if (typeof row.prompt !== "string") {
    return null;
  }

  const activeWidgets = normalizeWidgetList(row.activeWidgets);
  let mountedWidgets = normalizeWidgetList(row.mountedWidgets);
  const focusedWidget =
    typeof row.focusedWidget === "string" && row.focusedWidget.trim().length > 0 ? row.focusedWidget.trim() : null;
  const workspacePreset =
    typeof row.workspacePreset === "string" && row.workspacePreset.trim().length > 0 ? row.workspacePreset.trim() : null;
  const normalizedStatus: HudSessionStatus = row.status === "active" ? "active" : "background";
  const normalizedRestoreMode: HudSessionRestoreMode = row.restoreMode === "focus_only" ? "focus_only" : "full";
  const createdAtValue = typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString();
  const lastWorkspacePreset =
    typeof row.lastWorkspacePreset === "string" && row.lastWorkspacePreset.trim().length > 0
      ? row.lastWorkspacePreset.trim()
      : workspacePreset;

  const resolvedActive = activeWidgets.length > 0 ? activeWidgets : focusedWidget ? [focusedWidget] : ["inbox"];
  if (mountedWidgets.length === 0) {
    mountedWidgets = [...resolvedActive];
  } else {
    mountedWidgets = Array.from(new Set([...mountedWidgets, ...resolvedActive]));
  }
  if (focusedWidget && !mountedWidgets.includes(focusedWidget)) {
    mountedWidgets.push(focusedWidget);
  }
  const resolvedFocused =
    focusedWidget && resolvedActive.includes(focusedWidget)
      ? focusedWidget
      : resolvedActive[resolvedActive.length - 1] ?? null;

  return {
    id: row.id.trim(),
    prompt: row.prompt,
    createdAt: createdAtValue,
    activeWidgets: resolvedActive,
    mountedWidgets,
    focusedWidget: resolvedFocused,
    workspacePreset,
    taskId: typeof row.taskId === "string" ? row.taskId : undefined,
    missionId: typeof row.missionId === "string" ? row.missionId : undefined,
    intent: typeof row.intent === "string" && row.intent.trim().length > 0 ? row.intent.trim() : undefined,
    restoreMode: normalizedRestoreMode,
    lastWorkspacePreset,
    status: normalizedStatus,
  };
}
