import type { VisualCoreFailureCode } from "@/lib/visual-core/runtime";

const ZERO_FLATLINE_EPSILON = 1e-6;
const SAMPLE_DELTA_EPSILON = 1e-6;

export function classifyGpgpuSample(sample: ArrayLike<number>): VisualCoreFailureCode {
  for (let i = 0; i < sample.length; i += 1) {
    const value = Number(sample[i]);
    if (Number.isNaN(value)) {
      return "gpgpu_health_nan";
    }
    if (!Number.isFinite(value)) {
      return "gpgpu_health_inf";
    }
  }

  const magnitude =
    Math.abs(Number(sample[0] ?? 0)) + Math.abs(Number(sample[1] ?? 0)) + Math.abs(Number(sample[2] ?? 0));
  if (magnitude <= ZERO_FLATLINE_EPSILON) {
    return "gpgpu_health_zero_flatline";
  }

  return "none";
}

export function isSampleStalled(sample: ArrayLike<number>, previous: ArrayLike<number> | null): boolean {
  if (!previous || previous.length < 3 || sample.length < 3) {
    return false;
  }

  const delta =
    Math.abs(Number(sample[0]) - Number(previous[0])) +
    Math.abs(Number(sample[1]) - Number(previous[1])) +
    Math.abs(Number(sample[2]) - Number(previous[2]));
  return delta <= SAMPLE_DELTA_EPSILON;
}
