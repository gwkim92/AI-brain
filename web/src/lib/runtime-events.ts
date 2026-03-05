"use client";

export const JARVIS_RUNTIME_EVENT_STREAM = "jarvis.runtime.event";
export const JARVIS_RUNTIME_DEBUG_CHANGED_EVENT = "jarvis.runtime.debug.changed";
export const JARVIS_RUNTIME_DEBUG_ENABLED_KEY = "jarvis.runtime.debug.enabled";

export type JarvisRuntimeEventName =
  | "quick_command_started"
  | "quick_command_ignored_duplicate"
  | "quick_command_completed"
  | "quick_command_failed"
  | "session_switched"
  | "auto_context_delivered"
  | "assistant_stage_updated"
  | "assistant_quality_evaluated"
  | "assistant_quality_softened"
  | "assistant_delivery_rendered"
  | "assistant_stream_closed"
  | "assistant_stream_reconnect_scheduled"
  | "assistant_stage_stalled_detected"
  | "assistant_message_delivered"
  | "running_task_visible"
  | "visual_core_engine_switched";

export type JarvisRuntimeEventDetail<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: JarvisRuntimeEventName;
  timestamp: string;
  payload: TPayload;
};

function readRuntimeDebugEnabledUnsafe(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(JARVIS_RUNTIME_DEBUG_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function isRuntimeDebugEnabled(): boolean {
  return readRuntimeDebugEnabledUnsafe();
}

export function setRuntimeDebugEnabled(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(JARVIS_RUNTIME_DEBUG_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // localStorage can be unavailable
  }
  window.dispatchEvent(
    new CustomEvent(JARVIS_RUNTIME_DEBUG_CHANGED_EVENT, {
      detail: {
        enabled,
      },
    })
  );
}

export function emitRuntimeEvent<TPayload extends Record<string, unknown>>(
  name: JarvisRuntimeEventName,
  payload: TPayload
): void {
  if (typeof window === "undefined") {
    return;
  }
  const detail: JarvisRuntimeEventDetail<TPayload> = {
    name,
    timestamp: new Date().toISOString(),
    payload,
  };
  window.dispatchEvent(
    new CustomEvent<JarvisRuntimeEventDetail<TPayload>>(JARVIS_RUNTIME_EVENT_STREAM, {
      detail,
    })
  );

  if (readRuntimeDebugEnabledUnsafe()) {
    console.debug(`[jarvis-runtime] ${name}`, payload);
  }
}
