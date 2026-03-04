export type DagRunContext = {
  stepId: string;
  dependencyResults: Record<string, unknown>;
};

export type DagStep = {
  id: string;
  dependencies?: string[];
  run: (context: DagRunContext) => Promise<unknown> | unknown;
};

export type DagRunOptions = {
  maxConcurrency?: number;
  failFast?: boolean;
};

export type DagRunResult = {
  results: Record<string, unknown>;
  completedOrder: string[];
};

export function validateDagSteps(steps: DagStep[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stepById = new Map<string, DagStep>();

  for (const step of steps) {
    if (stepById.has(step.id)) {
      errors.push(`duplicate_step_id:${step.id}`);
      continue;
    }
    stepById.set(step.id, step);
  }

  for (const step of steps) {
    for (const depId of step.dependencies ?? []) {
      if (!stepById.has(depId)) {
        errors.push(`unknown_dependency:${step.id}->${depId}`);
      }
    }
  }

  const visitState = new Map<string, 'visiting' | 'visited'>();
  const visit = (stepId: string): void => {
    const state = visitState.get(stepId);
    if (state === 'visiting') {
      errors.push(`cycle_detected:${stepId}`);
      return;
    }
    if (state === 'visited') return;
    visitState.set(stepId, 'visiting');
    const step = stepById.get(stepId);
    for (const depId of step?.dependencies ?? []) {
      visit(depId);
    }
    visitState.set(stepId, 'visited');
  };

  for (const step of steps) {
    visit(step.id);
  }

  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors))
  };
}

export async function runDag(steps: DagStep[], options: DagRunOptions = {}): Promise<DagRunResult> {
  if (steps.length === 0) {
    return {
      results: {},
      completedOrder: []
    };
  }

  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 4);
  const failFast = options.failFast ?? true;

  const stepById = new Map<string, DagStep>();
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const step of steps) {
    if (stepById.has(step.id)) {
      throw new Error(`Duplicate DAG step id: ${step.id}`);
    }
    stepById.set(step.id, step);
    inDegree.set(step.id, step.dependencies?.length ?? 0);
    dependents.set(step.id, []);
  }

  for (const step of steps) {
    for (const depId of step.dependencies ?? []) {
      if (!stepById.has(depId)) {
        throw new Error(`Unknown dependency '${depId}' for step '${step.id}'`);
      }
      dependents.get(depId)!.push(step.id);
    }
  }

  const readyQueue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      readyQueue.push(id);
    }
  }

  const results: Record<string, unknown> = {};
  const completedOrder: string[] = [];
  let running = 0;
  let completed = 0;
  let fatalError: Error | null = null;

  return await new Promise<DagRunResult>((resolve, reject) => {
    const maybeFinish = () => {
      if (fatalError && (failFast || completed + running === steps.length) && running === 0) {
        reject(fatalError);
        return;
      }

      if (completed === steps.length) {
        resolve({
          results,
          completedOrder
        });
        return;
      }

      if (running === 0 && readyQueue.length === 0) {
        reject(new Error('DAG contains a cycle or unresolved dependency state'));
      }
    };

    const schedule = () => {
      while (
        running < maxConcurrency &&
        readyQueue.length > 0 &&
        !(fatalError && failFast)
      ) {
        const stepId = readyQueue.shift()!;
        const step = stepById.get(stepId)!;

        running += 1;

        const dependencyResults: Record<string, unknown> = {};
        for (const depId of step.dependencies ?? []) {
          dependencyResults[depId] = results[depId];
        }

        Promise.resolve(step.run({ stepId, dependencyResults }))
          .then((value) => {
            results[stepId] = value;
            completedOrder.push(stepId);
            completed += 1;

            for (const childId of dependents.get(stepId) ?? []) {
              const nextDegree = (inDegree.get(childId) ?? 0) - 1;
              inDegree.set(childId, nextDegree);
              if (nextDegree === 0) {
                readyQueue.push(childId);
              }
            }
          })
          .catch((error: unknown) => {
            fatalError = error instanceof Error ? error : new Error(String(error));
            completed += 1;
          })
          .finally(() => {
            running -= 1;
            schedule();
            maybeFinish();
          });
      }

      maybeFinish();
    };

    schedule();
  });
}
