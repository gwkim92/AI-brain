export type WorkflowCandidate = {
  workflow_id: string;
  quality: number; // 0..1
  latency_ms: number;
  cost_usd: number;
  risk: number; // 0..1
};

export type SchedulerBudget = {
  max_cost_usd: number;
  max_latency_ms: number;
  high_risk_request: boolean;
};

export type SchedulerDecision = {
  workflow_id: string;
  accepted: boolean;
  reason?: string;
  score: number;
  metrics: {
    quality: number;
    latency_ms: number;
    cost_usd: number;
    risk: number;
  };
};

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function scoreWorkflowCandidate(input: {
  candidate: WorkflowCandidate;
  budget: SchedulerBudget;
}): number {
  const latencyNormalized = clamp01(input.candidate.latency_ms / Math.max(1, input.budget.max_latency_ms));
  const costNormalized = clamp01(input.candidate.cost_usd / Math.max(0.01, input.budget.max_cost_usd));
  const riskWeight = input.budget.high_risk_request ? 0.3 : 0.15;
  const quality = clamp01(input.candidate.quality);
  const risk = clamp01(input.candidate.risk);

  return Number((0.45 * quality - 0.2 * latencyNormalized - 0.2 * costNormalized - riskWeight * risk).toFixed(6));
}

export function scheduleWorkflowCandidates(input: {
  candidates: WorkflowCandidate[];
  budget: SchedulerBudget;
}): {
  selected: SchedulerDecision | null;
  accepted: SchedulerDecision[];
  rejected: SchedulerDecision[];
} {
  const decisions: SchedulerDecision[] = input.candidates.map((candidate) => {
    const overCost = candidate.cost_usd > input.budget.max_cost_usd;
    const overLatency = candidate.latency_ms > input.budget.max_latency_ms;
    const score = scoreWorkflowCandidate({
      candidate,
      budget: input.budget
    });

    if (overCost || overLatency) {
      return {
        workflow_id: candidate.workflow_id,
        accepted: false,
        reason: overCost ? 'budget_cost_exceeded' : 'budget_latency_exceeded',
        score,
        metrics: {
          quality: candidate.quality,
          latency_ms: candidate.latency_ms,
          cost_usd: candidate.cost_usd,
          risk: candidate.risk
        }
      };
    }

    return {
      workflow_id: candidate.workflow_id,
      accepted: true,
      score,
      metrics: {
        quality: candidate.quality,
        latency_ms: candidate.latency_ms,
        cost_usd: candidate.cost_usd,
        risk: candidate.risk
      }
    };
  });

  const accepted = decisions
    .filter((item) => item.accepted)
    .sort((left, right) => right.score - left.score);
  const rejected = decisions
    .filter((item) => !item.accepted)
    .sort((left, right) => right.score - left.score);

  return {
    selected: accepted[0] ?? null,
    accepted,
    rejected
  };
}
