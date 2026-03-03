export const HUD_PREFERENCE_CHANGED_EVENT = "jarvis.hud.preference.changed";

export const HUD_MISSION_AUTO_FOCUS_KEY = "jarvis.hud.mission.auto_focus";
export const HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY = "jarvis.hud.mission.auto_focus_hold_seconds";

export const HUD_DEFAULT_MISSION_AUTO_FOCUS_ENABLED = true;
export const HUD_DEFAULT_MISSION_AUTO_FOCUS_HOLD_SECONDS = 90;
export const HUD_MIN_MISSION_AUTO_FOCUS_HOLD_SECONDS = 15;
export const HUD_MAX_MISSION_AUTO_FOCUS_HOLD_SECONDS = 600;

type HudPreferenceChangeDetail = {
  key: string;
  value: string;
};

function clampMissionAutoFocusHoldSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return HUD_DEFAULT_MISSION_AUTO_FOCUS_HOLD_SECONDS;
  }
  return Math.max(
    HUD_MIN_MISSION_AUTO_FOCUS_HOLD_SECONDS,
    Math.min(HUD_MAX_MISSION_AUTO_FOCUS_HOLD_SECONDS, Math.round(value))
  );
}

function dispatchPreferenceChanged(detail: HudPreferenceChangeDetail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<HudPreferenceChangeDetail>(HUD_PREFERENCE_CHANGED_EVENT, { detail }));
}

export function readMissionAutoFocusEnabledPreference(): boolean {
  if (typeof window === "undefined") {
    return HUD_DEFAULT_MISSION_AUTO_FOCUS_ENABLED;
  }
  const value = window.localStorage.getItem(HUD_MISSION_AUTO_FOCUS_KEY);
  if (value === "0") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  return HUD_DEFAULT_MISSION_AUTO_FOCUS_ENABLED;
}

export function writeMissionAutoFocusEnabledPreference(enabled: boolean): boolean {
  const normalized = Boolean(enabled);
  if (typeof window === "undefined") {
    return normalized;
  }
  const serialized = normalized ? "1" : "0";
  window.localStorage.setItem(HUD_MISSION_AUTO_FOCUS_KEY, serialized);
  dispatchPreferenceChanged({
    key: HUD_MISSION_AUTO_FOCUS_KEY,
    value: serialized,
  });
  return normalized;
}

export function readMissionAutoFocusHoldSecondsPreference(): number {
  if (typeof window === "undefined") {
    return HUD_DEFAULT_MISSION_AUTO_FOCUS_HOLD_SECONDS;
  }
  const raw = window.localStorage.getItem(HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY);
  if (!raw) {
    return HUD_DEFAULT_MISSION_AUTO_FOCUS_HOLD_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  return clampMissionAutoFocusHoldSeconds(parsed);
}

export function writeMissionAutoFocusHoldSecondsPreference(seconds: number): number {
  const normalized = clampMissionAutoFocusHoldSeconds(seconds);
  if (typeof window === "undefined") {
    return normalized;
  }
  const serialized = String(normalized);
  window.localStorage.setItem(HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY, serialized);
  dispatchPreferenceChanged({
    key: HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY,
    value: serialized,
  });
  return normalized;
}

export function parseMissionAutoFocusHoldSecondsInput(input: string): number {
  const parsed = Number.parseInt(input.trim(), 10);
  return clampMissionAutoFocusHoldSeconds(parsed);
}

export const HUD_VISUAL_CORE_ENABLED_KEY = "jarvis.hud.visual_core_enabled";

export function readVisualCoreEnabledPreference(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(HUD_VISUAL_CORE_ENABLED_KEY);
  if (raw === null) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    // Normalize legacy truthy values to a single canonical representation.
    if (normalized !== "true") {
      window.localStorage.setItem(HUD_VISUAL_CORE_ENABLED_KEY, "true");
    }
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    // Normalize legacy falsey values to a single canonical representation.
    if (normalized !== "false") {
      window.localStorage.setItem(HUD_VISUAL_CORE_ENABLED_KEY, "false");
    }
    return false;
  }
  window.localStorage.setItem(HUD_VISUAL_CORE_ENABLED_KEY, "true");
  return true;
}

export function writeVisualCoreEnabledPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  const serialized = String(enabled);
  window.localStorage.setItem(HUD_VISUAL_CORE_ENABLED_KEY, serialized);
  dispatchPreferenceChanged({ key: HUD_VISUAL_CORE_ENABLED_KEY, value: serialized });
}
