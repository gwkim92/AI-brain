export type CouncilIntakePayload = {
  id: string;
  prompt: string;
  runId: string;
  taskId?: string;
  createdAt: string;
};

const COUNCIL_INTAKE_EVENT = "jarvis:council-intake";

export function dispatchCouncilIntake(payload: CouncilIntakePayload): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<CouncilIntakePayload>(COUNCIL_INTAKE_EVENT, { detail: payload }));
}

export function subscribeCouncilIntake(callback: (payload: CouncilIntakePayload) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<CouncilIntakePayload>;
    if (!customEvent.detail) {
      return;
    }
    callback(customEvent.detail);
  };

  window.addEventListener(COUNCIL_INTAKE_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(COUNCIL_INTAKE_EVENT, handler as EventListener);
  };
}
