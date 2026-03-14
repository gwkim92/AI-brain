import { z } from 'zod';

import { validateDagSteps } from '../orchestrator/dag-runner';

const WorkflowStepSchema = z.object({
  id: z.string().min(1).max(120),
  use: z.string().min(3).max(240),
  when: z.string().max(500).optional(),
  depends_on: z.array(z.string().min(1).max(120)).max(30).optional()
});

const WorkflowDslSchema = z.object({
  workflow_id: z.string().min(1).max(120),
  entry_module: z.string().min(3).max(240),
  steps: z.array(WorkflowStepSchema).min(1).max(200)
});

export type WorkflowDslSpec = z.infer<typeof WorkflowDslSchema>;

export type WorkflowDagStep = {
  id: string;
  use: string;
  when?: string;
  dependencies: string[];
};

export type WorkflowDagSpec = {
  workflowId: string;
  entryModule: string;
  steps: WorkflowDagStep[];
};

export function parseWorkflowDsl(input: unknown): WorkflowDagSpec {
  const parsed = WorkflowDslSchema.parse(input);

  const steps: WorkflowDagStep[] = parsed.steps.map((step, index) => {
    const previousStepId = parsed.steps[index - 1]?.id;
    return {
      id: step.id,
      use: step.use,
      when: step.when,
      dependencies: step.depends_on ?? (previousStepId ? [previousStepId] : [])
    };
  });

  const dagValidation = validateDagSteps(
    steps.map((step) => ({
      id: step.id,
      dependencies: step.dependencies,
      run: async () => null
    }))
  );
  if (!dagValidation.valid) {
    throw new Error(`invalid_workflow_dag:${dagValidation.errors.join(',')}`);
  }

  return {
    workflowId: parsed.workflow_id,
    entryModule: parsed.entry_module,
    steps
  };
}
