import type { Jarvis3DBaseMode } from "@/lib/visual-core/types";

const BASE_MODE_PRIORITY: Record<Jarvis3DBaseMode, number> = {
  risk: 100,
  cinematic_dof: 80,
  multi_attractor: 70,
  sdf_crystal: 60,
  sdf_brain: 55,
  sdf_eye: 50,
  sdf_infinity: 45,
  stream: 35,
  default: 10,
};

const BASE_MODE_MIN_HOLD_MS: Record<Jarvis3DBaseMode, number> = {
  risk: 5000,
  cinematic_dof: 4000,
  multi_attractor: 3500,
  sdf_crystal: 3200,
  sdf_brain: 3000,
  sdf_eye: 3000,
  sdf_infinity: 3000,
  stream: 2500,
  default: 1800,
};

export function getBaseModeMinHoldMs(mode: Jarvis3DBaseMode): number {
  return BASE_MODE_MIN_HOLD_MS[mode];
}

export function getBaseModePriority(mode: Jarvis3DBaseMode): number {
  return BASE_MODE_PRIORITY[mode];
}

export function canTransitionBaseMode(input: {
  from: Jarvis3DBaseMode;
  to: Jarvis3DBaseMode;
  elapsedMs: number;
}): boolean {
  if (input.from === input.to) {
    return true;
  }

  if (BASE_MODE_PRIORITY[input.to] > BASE_MODE_PRIORITY[input.from]) {
    return true;
  }

  return input.elapsedMs >= getBaseModeMinHoldMs(input.from);
}

export function getRemainingHoldMs(mode: Jarvis3DBaseMode, elapsedMs: number): number {
  return Math.max(0, getBaseModeMinHoldMs(mode) - elapsedMs);
}
