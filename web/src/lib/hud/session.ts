const STORAGE_KEY = "hud-sessions";
const MAX_SESSIONS = 20;
const SESSION_PROMPT_DEDUPE_WINDOW_MS = 3 * 60 * 1000;

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
  lastDeliveredContextRevision?: Record<string, number>;
  stale?: boolean;
  staleReason?: string;
  staleDetectedAt?: string;
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

    const normalized = parsed
      .map((item) => normalizeSession(item))
      .filter((item): item is HudSession => item !== null)
      .slice(0, MAX_SESSIONS);
    return dedupeSessions(normalized);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: HudSession[]): void {
  try {
    const trimmed = dedupeSessions(sessions).slice(0, MAX_SESSIONS);
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
    lastDeliveredContextRevision: {},
    stale: false,
    staleReason: undefined,
    staleDetectedAt: undefined,
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
      | "lastDeliveredContextRevision"
      | "stale"
      | "staleReason"
      | "staleDetectedAt"
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

function dedupeSessions(sessions: HudSession[]): HudSession[] {
  const seenSessionIds = new Set<string>();
  const seenTaskIds = new Set<string>();
  const seenMissionIds = new Set<string>();
  const seenPromptCreatedAt = new Map<string, number>();
  let activeSessionConsumed = false;
  const deduped: HudSession[] = [];

  for (const session of sessions) {
    const sessionId = session.id.trim();
    if (!sessionId || seenSessionIds.has(sessionId)) {
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

    const promptKey = session.prompt.replace(/\s+/g, " ").trim().toLowerCase();
    if (promptKey) {
      const createdAtMs = Date.parse(session.createdAt);
      const existingPromptTs = seenPromptCreatedAt.get(promptKey);
      if (
        typeof existingPromptTs === "number" &&
        Number.isFinite(createdAtMs) &&
        Math.abs(existingPromptTs - createdAtMs) <= SESSION_PROMPT_DEDUPE_WINDOW_MS
      ) {
        continue;
      }
      if (Number.isFinite(createdAtMs)) {
        seenPromptCreatedAt.set(promptKey, createdAtMs);
      }
    }

    seenSessionIds.add(sessionId);
    if (taskId) {
      seenTaskIds.add(taskId);
    }
    if (missionId) {
      seenMissionIds.add(missionId);
    }

    if (session.status === "active") {
      if (activeSessionConsumed) {
        deduped.push({
          ...session,
          status: "background",
        });
      } else {
        deduped.push(session);
        activeSessionConsumed = true;
      }
    } else {
      deduped.push(session);
    }
  }

  return deduped.slice(0, MAX_SESSIONS);
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
  const lastDeliveredContextRevision =
    row.lastDeliveredContextRevision && typeof row.lastDeliveredContextRevision === "object"
      ? Object.fromEntries(
          Object.entries(row.lastDeliveredContextRevision as Record<string, unknown>).filter(
            (entry): entry is [string, number] =>
              typeof entry[0] === "string" && Number.isFinite(entry[1])
          )
        )
      : {};
  const stale = row.stale === true;
  const staleReason =
    typeof row.staleReason === "string" && row.staleReason.trim().length > 0 ? row.staleReason.trim() : undefined;
  const staleDetectedAt =
    typeof row.staleDetectedAt === "string" && row.staleDetectedAt.trim().length > 0
      ? row.staleDetectedAt
      : undefined;

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
    lastDeliveredContextRevision,
    stale,
    staleReason,
    staleDetectedAt,
    status: normalizedStatus,
  };
}
