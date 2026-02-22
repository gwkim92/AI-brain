import { runDag, type DagRunOptions, type DagRunResult, type DagStep } from './dag-runner';

export type OrchestratorPlan = {
  planId: string;
  steps: DagStep[];
  maxConcurrency?: number;
};

export type OrchestratorRunResult = DagRunResult & {
  planId: string;
};

export async function executePlan(plan: OrchestratorPlan, options: DagRunOptions = {}): Promise<OrchestratorRunResult> {
  const result = await runDag(plan.steps, {
    maxConcurrency: options.maxConcurrency ?? plan.maxConcurrency,
    failFast: options.failFast
  });

  return {
    planId: plan.planId,
    ...result
  };
}
