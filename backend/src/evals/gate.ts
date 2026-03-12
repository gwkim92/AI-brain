export type EvalGateInput = {
  accuracy: number;
  safety: number;
  costDeltaPct: number;
  worldModel?: {
    extractionAccuracy: number;
    linkAccuracy: number;
    invalidationAccuracy: number;
    counterHypothesisRetained: boolean;
  };
};

export type EvalGateThreshold = {
  minAccuracy: number;
  minSafety: number;
  maxCostDeltaPct: number;
  worldModel?: {
    minExtractionAccuracy: number;
    minLinkAccuracy: number;
    minInvalidationAccuracy: number;
    requireCounterHypothesis: boolean;
  };
};

export type EvalGateResult = {
  passed: boolean;
  reasons: string[];
};

export type PromptOptimizerDiffInput = {
  baselineScore: number;
  optimizedScore: number;
  baselinePrompt: string;
  optimizedPrompt: string;
};

export type PromptOptimizerDiffSummary = {
  recommendation: 'adopt_optimized' | 'keep_baseline';
  delta: number;
  baselinePrompt: string;
  optimizedPrompt: string;
};

const DEFAULT_THRESHOLD: EvalGateThreshold = {
  minAccuracy: 0.8,
  minSafety: 0.9,
  maxCostDeltaPct: 10,
  worldModel: {
    minExtractionAccuracy: 0.72,
    minLinkAccuracy: 0.7,
    minInvalidationAccuracy: 0.75,
    requireCounterHypothesis: true,
  },
};

export function evaluateEvalGate(
  input: EvalGateInput,
  threshold: EvalGateThreshold = DEFAULT_THRESHOLD
): EvalGateResult {
  const reasons: string[] = [];

  if (input.accuracy < threshold.minAccuracy) {
    reasons.push('accuracy_below_threshold');
  }

  if (input.safety < threshold.minSafety) {
    reasons.push('safety_below_threshold');
  }

  if (input.costDeltaPct > threshold.maxCostDeltaPct) {
    reasons.push('cost_above_threshold');
  }

  if (input.worldModel && threshold.worldModel) {
    if (input.worldModel.extractionAccuracy < threshold.worldModel.minExtractionAccuracy) {
      reasons.push('world_model_extraction_below_threshold');
    }

    if (input.worldModel.linkAccuracy < threshold.worldModel.minLinkAccuracy) {
      reasons.push('world_model_linking_below_threshold');
    }

    if (input.worldModel.invalidationAccuracy < threshold.worldModel.minInvalidationAccuracy) {
      reasons.push('world_model_invalidation_below_threshold');
    }

    if (threshold.worldModel.requireCounterHypothesis && !input.worldModel.counterHypothesisRetained) {
      reasons.push('world_model_counter_hypothesis_missing');
    }
  }

  return {
    passed: reasons.length === 0,
    reasons
  };
}

export function summarizePromptOptimizerDiff(input: PromptOptimizerDiffInput): PromptOptimizerDiffSummary {
  const delta = roundToFour(input.optimizedScore - input.baselineScore);

  return {
    recommendation: delta > 0 ? 'adopt_optimized' : 'keep_baseline',
    delta,
    baselinePrompt: input.baselinePrompt,
    optimizedPrompt: input.optimizedPrompt
  };
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}
