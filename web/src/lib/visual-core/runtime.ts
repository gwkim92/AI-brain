export type WebGlRenderTier = "probing" | "full" | "lite" | "fallback";

export type VisualCoreEngine = "gpgpu" | "stable" | "lite" | "cpu";

export type VisualCoreFailureCode =
  | "none"
  | "forced_engine"
  | "probe_failed"
  | "gpgpu_runtime_error"
  | "gpgpu_context_lost"
  | "gpgpu_health_nan"
  | "gpgpu_health_inf"
  | "gpgpu_health_zero_flatline"
  | "gpgpu_health_stalled"
  | "gpgpu_health_readback_error"
  | "stable_runtime_error"
  | "stable_context_lost"
  | "lite_runtime_error"
  | "lite_context_lost"
  | "webgl_unavailable";

export function parseForcedCoreEngine(search: string): VisualCoreEngine | null {
  const params = new URLSearchParams(search);
  const value = (params.get("core_engine") ?? "").trim().toLowerCase();
  if (value === "gpgpu" || value === "stable" || value === "lite" || value === "cpu") {
    return value;
  }
  return null;
}

export function getInitialCoreEngine(tier: WebGlRenderTier, forced: VisualCoreEngine | null): VisualCoreEngine {
  if (forced) {
    return forced;
  }
  if (tier === "full") {
    return "gpgpu";
  }
  if (tier === "lite") {
    return "stable";
  }
  return "cpu";
}

export function getFallbackEngine(current: VisualCoreEngine): VisualCoreEngine {
  if (current === "gpgpu") {
    return "stable";
  }
  if (current === "stable") {
    return "lite";
  }
  return "cpu";
}

export function shouldRetryGpgpu(input: {
  forcedEngine: VisualCoreEngine | null;
  tier: WebGlRenderTier;
  currentEngine: VisualCoreEngine;
  lastSwitchAtMs: number;
  nowMs: number;
  retryDelayMs: number;
}): boolean {
  if (input.forcedEngine) {
    return false;
  }
  if (input.tier !== "full") {
    return false;
  }
  if (input.currentEngine === "gpgpu") {
    return false;
  }
  return input.nowMs - input.lastSwitchAtMs >= input.retryDelayMs;
}
