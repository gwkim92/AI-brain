export const JARVIS_DATA_REFRESH_EVENT = "jarvis-data-refresh";

export type JarvisDataRefreshScope = "all" | "approvals" | "sessions" | "tasks" | "briefings";

export type JarvisDataRefreshDetail = {
  scope: JarvisDataRefreshScope;
  source?: string;
};

export function dispatchJarvisDataRefresh(detail: JarvisDataRefreshDetail): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<JarvisDataRefreshDetail>(JARVIS_DATA_REFRESH_EVENT, { detail }));
}

export function subscribeJarvisDataRefresh(
  listener: (detail: JarvisDataRefreshDetail) => void
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<JarvisDataRefreshDetail>).detail;
    if (!detail) {
      return;
    }
    listener(detail);
  };
  window.addEventListener(JARVIS_DATA_REFRESH_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(JARVIS_DATA_REFRESH_EVENT, handler as EventListener);
  };
}
