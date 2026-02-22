export type ParallelEfficiencyInput = {
  sequentialMs: number;
  parallelMs: number;
};

export type TokenReductionInput = {
  baselineTokens: number;
  optimizedTokens: number;
};

export type RadarMissRateInput = {
  expectedReports: number;
  deliveredReports: number;
};

export type CoreSloInput = ParallelEfficiencyInput & TokenReductionInput & RadarMissRateInput;

export type CoreSloSummary = {
  parallelEfficiencyPct: number;
  tokenReductionPct: number;
  radarMissRatePct: number;
};

export function calculateParallelEfficiency(input: ParallelEfficiencyInput): number {
  if (input.sequentialMs <= 0) {
    return 0;
  }
  const improvement = ((input.sequentialMs - input.parallelMs) / input.sequentialMs) * 100;
  return roundToTwo(clampPercent(improvement));
}

export function calculateTokenReduction(input: TokenReductionInput): number {
  if (input.baselineTokens <= 0) {
    return 0;
  }
  const reduction = ((input.baselineTokens - input.optimizedTokens) / input.baselineTokens) * 100;
  return roundToTwo(clampPercent(reduction));
}

export function calculateRadarMissRate(input: RadarMissRateInput): number {
  if (input.expectedReports <= 0) {
    return 0;
  }
  const missCount = input.expectedReports - input.deliveredReports;
  const missRate = (missCount / input.expectedReports) * 100;
  return roundToTwo(clampPercent(missRate));
}

export function summarizeCoreSlo(input: CoreSloInput): CoreSloSummary {
  return {
    parallelEfficiencyPct: calculateParallelEfficiency(input),
    tokenReductionPct: calculateTokenReduction(input),
    radarMissRatePct: calculateRadarMissRate(input)
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
