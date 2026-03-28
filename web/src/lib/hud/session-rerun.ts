export const SESSION_RERUN_EVENT = "jarvis:session-rerun";

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
  window.dispatchEvent(new CustomEvent<SessionRerunPayload>(SESSION_RERUN_EVENT, { detail: payload }));
}

export function subscribeSessionRerun(callback: (payload: SessionRerunPayload) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<SessionRerunPayload>;
    if (!customEvent.detail) {
      return;
    }
    callback(customEvent.detail);
  };

  window.addEventListener(SESSION_RERUN_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(SESSION_RERUN_EVENT, handler as EventListener);
  };
}
