function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export type WorldModelEvalMetrics = {
  primaryThesisCoverage: number;
  counterHypothesisRetained: number;
  invalidationConditionCoverage: number;
  bottleneckCoverage: number;
  watchSignalDiscipline: number;
  averageCaseScore: number;
  promotionScore: number;
};

export function computeWorldModelPromotionScore(
  input: Omit<WorldModelEvalMetrics, 'promotionScore'>
): number {
  const score =
    input.primaryThesisCoverage * 0.3 +
    input.counterHypothesisRetained * 0.25 +
    input.invalidationConditionCoverage * 0.2 +
    input.bottleneckCoverage * 0.1 +
    input.watchSignalDiscipline * 0.05 +
    input.averageCaseScore * 0.1;

  return roundToFour(score);
}

export function buildWorldModelEvalMetrics(input: Omit<WorldModelEvalMetrics, 'promotionScore'>): WorldModelEvalMetrics {
  return {
    ...input,
    promotionScore: computeWorldModelPromotionScore(input),
  };
}
