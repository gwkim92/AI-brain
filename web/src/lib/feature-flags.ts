"use client";

export type JarvisFeatureFlag =
  | "hud.single_flight_quick_command"
  | "assistant.exactly_once_delivery"
  | "visual_core.auto_failover"
  | "assistant.quality_soft_gate_v2"
  | "assistant.ui_soft_warn_render"
  | "assistant.optimistic_running_task"
  | "assistant.stage_timeline_v1"
  | "session.restore_deterministic_v2"
  | "v2.command_compiler"
  | "v2.retrieval"
  | "v2.team"
  | "v2.code_loop"
  | "v2.finance"
  | "v2.schema_ui";

const STORAGE_PREFIX = "jarvis.ff.";

const ENV_BY_FLAG: Record<JarvisFeatureFlag, string> = {
  "hud.single_flight_quick_command": "NEXT_PUBLIC_FF_HUD_SINGLE_FLIGHT_QUICK_COMMAND",
  "assistant.exactly_once_delivery": "NEXT_PUBLIC_FF_ASSISTANT_EXACTLY_ONCE_DELIVERY",
  "visual_core.auto_failover": "NEXT_PUBLIC_FF_VISUAL_CORE_AUTO_FAILOVER",
  "assistant.quality_soft_gate_v2": "NEXT_PUBLIC_FF_ASSISTANT_QUALITY_SOFT_GATE_V2",
  "assistant.ui_soft_warn_render": "NEXT_PUBLIC_FF_ASSISTANT_UI_SOFT_WARN_RENDER",
  "assistant.optimistic_running_task": "NEXT_PUBLIC_FF_ASSISTANT_OPTIMISTIC_RUNNING_TASK",
  "assistant.stage_timeline_v1": "NEXT_PUBLIC_FF_ASSISTANT_STAGE_TIMELINE_V1",
  "session.restore_deterministic_v2": "NEXT_PUBLIC_FF_SESSION_RESTORE_DETERMINISTIC_V2",
  "v2.command_compiler": "NEXT_PUBLIC_FF_V2_COMMAND_COMPILER",
  "v2.retrieval": "NEXT_PUBLIC_FF_V2_RETRIEVAL",
  "v2.team": "NEXT_PUBLIC_FF_V2_TEAM",
  "v2.code_loop": "NEXT_PUBLIC_FF_V2_CODE_LOOP",
  "v2.finance": "NEXT_PUBLIC_FF_V2_FINANCE",
  "v2.schema_ui": "NEXT_PUBLIC_FF_V2_SCHEMA_UI",
};

function parseBoolean(value: string | null | undefined): boolean | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) {
    return false;
  }
  return null;
}

function getQueryOverride(flag: JarvisFeatureFlag): boolean | null {
  if (typeof window === "undefined") {
    return null;
  }
  const key = `ff_${flag.replace(/\./g, "_")}`;
  try {
    const params = new URLSearchParams(window.location.search);
    return parseBoolean(params.get(key));
  } catch {
    return null;
  }
}

function getStorageOverride(flag: JarvisFeatureFlag): boolean | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return parseBoolean(window.localStorage.getItem(`${STORAGE_PREFIX}${flag}`));
  } catch {
    return null;
  }
}

function getEnvValue(flag: JarvisFeatureFlag): boolean | null {
  const envKey = ENV_BY_FLAG[flag];
  const envValue = process.env[envKey];
  const parsed = parseBoolean(envValue);
  if (parsed !== null) {
    return parsed;
  }
  if (flag === "visual_core.auto_failover") {
    // Backward-compatible alias used by existing deployments.
    return parseBoolean(process.env.NEXT_PUBLIC_VISUAL_CORE_FAILOVER);
  }
  return null;
}

export function isFeatureEnabled(flag: JarvisFeatureFlag, fallback = true): boolean {
  const query = getQueryOverride(flag);
  if (query !== null) {
    return query;
  }

  const storage = getStorageOverride(flag);
  if (storage !== null) {
    return storage;
  }

  const env = getEnvValue(flag);
  if (env !== null) {
    return env;
  }

  return fallback;
}

export function setFeatureFlagOverride(flag: JarvisFeatureFlag, enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${flag}`, enabled ? "1" : "0");
  } catch {
    // localStorage can be unavailable
  }
}
