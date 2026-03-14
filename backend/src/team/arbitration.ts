import type { V2TeamRole } from '../store/types';

export type TeamRoleOutputV2 = {
  role: V2TeamRole;
  output: string;
  confidence: number;
};

export type ArbitrationDecisionV2 = {
  round: number;
  status: 'resolved' | 'replan' | 'escalated';
  selected?: TeamRoleOutputV2;
  rationale: string;
  scores: Array<{ role: V2TeamRole; score: number }>;
};

const ROLE_WEIGHTS: Record<V2TeamRole, number> = {
  planner: 1,
  researcher: 1,
  coder: 1,
  critic: 0.95,
  risk: 1.05,
  synthesizer: 1
};

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function arbitrateTeamOutputs(input: {
  outputs: TeamRoleOutputV2[];
  round: number;
  maxRounds: number;
}): ArbitrationDecisionV2 {
  if (input.outputs.length === 0) {
    return {
      round: input.round,
      status: input.round >= input.maxRounds ? 'escalated' : 'replan',
      rationale: 'no_outputs_to_arbitrate',
      scores: []
    };
  }

  const scored = input.outputs
    .map((item) => ({
      ...item,
      weightedScore: Number((item.confidence * (ROLE_WEIGHTS[item.role] ?? 1)).toFixed(4))
    }))
    .sort((left, right) => right.weightedScore - left.weightedScore);
  const top = scored[0];
  const runnerUp = scored[1] ?? null;

  const topText = normalizeText(top.output);
  const runnerUpText = runnerUp ? normalizeText(runnerUp.output) : '';
  const conflictingTopAnswers = runnerUp !== null && Math.abs(top.weightedScore - runnerUp.weightedScore) < 0.08 && topText !== runnerUpText;
  const lowConfidence = top.weightedScore < 0.55;

  if (conflictingTopAnswers || lowConfidence) {
    if (input.round >= input.maxRounds) {
      return {
        round: input.round,
        status: 'escalated',
        rationale: conflictingTopAnswers ? 'unresolved_conflict_after_max_rounds' : 'insufficient_confidence_after_max_rounds',
        scores: scored.map((item) => ({ role: item.role, score: item.weightedScore }))
      };
    }
    return {
      round: input.round,
      status: 'replan',
      rationale: conflictingTopAnswers ? 'conflicting_top_candidates' : 'insufficient_confidence',
      scores: scored.map((item) => ({ role: item.role, score: item.weightedScore }))
    };
  }

  return {
    round: input.round,
    status: 'resolved',
    selected: {
      role: top.role,
      output: top.output,
      confidence: top.confidence
    },
    rationale: 'highest_weighted_confidence',
    scores: scored.map((item) => ({ role: item.role, score: item.weightedScore }))
  };
}
