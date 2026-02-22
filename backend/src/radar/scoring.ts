export type RadarDecision = 'adopt' | 'hold' | 'discard';

export type RadarCandidate = {
  id: string;
  title: string;
  benefit: number;
  risk: number;
  cost: number;
};

export type RadarRecommendation = {
  id: string;
  itemId: string;
  decision: RadarDecision;
  totalScore: number;
  expectedBenefit: string;
  migrationCost: string;
  riskLevel: string;
};

export function scoreRadarCandidate(candidate: RadarCandidate): RadarRecommendation {
  const benefit = clampToFive(candidate.benefit);
  const risk = clampToFive(candidate.risk);
  const cost = clampToFive(candidate.cost);

  // Weighted utility score: high benefit + low risk + low cost.
  const rawScore = benefit * 0.55 + (5 - risk) * 0.30 + (5 - cost) * 0.15;
  const totalScore = roundToTwo(rawScore);

  return {
    id: `rec_${candidate.id}`,
    itemId: candidate.id,
    decision: toDecision(totalScore),
    totalScore,
    expectedBenefit: describeLevel(benefit),
    migrationCost: describeLevel(cost),
    riskLevel: describeLevel(risk)
  };
}

export function evaluateRadarItems(candidates: RadarCandidate[]): RadarRecommendation[] {
  return candidates
    .map((candidate) => scoreRadarCandidate(candidate))
    .sort((left, right) => right.totalScore - left.totalScore);
}

function toDecision(totalScore: number): RadarDecision {
  if (totalScore >= 3.3) {
    return 'adopt';
  }
  if (totalScore >= 2.3) {
    return 'hold';
  }
  return 'discard';
}

function describeLevel(value: number): string {
  if (value >= 4) {
    return 'high';
  }
  if (value >= 2.5) {
    return 'medium';
  }
  return 'low';
}

function clampToFive(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 5) {
    return 5;
  }
  return value;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
