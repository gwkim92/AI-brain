export const JARVIS_SESSION_RERUN_EVENT = "jarvis:session-rerun";

export type SessionRerunPayload = {
  sessionId: string;
  prompt: string;
  taskId?: string;
  missionId?: string;
};

export function dispatchSessionRerun(payload: SessionRerunPayload): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<SessionRerunPayload>(JARVIS_SESSION_RERUN_EVENT, { detail: payload }));
}

export function subscribeSessionRerun(listener: (payload: SessionRerunPayload) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const custom = event as CustomEvent<SessionRerunPayload>;
    if (!custom.detail) {
      return;
    }
    listener(custom.detail);
  };

  window.addEventListener(JARVIS_SESSION_RERUN_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(JARVIS_SESSION_RERUN_EVENT, handler as EventListener);
  };
}
