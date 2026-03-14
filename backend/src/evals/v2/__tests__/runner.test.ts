import { describe, expect, it } from 'vitest';

import { EvalRunnerV2 } from '../runner';

describe('EvalRunnerV2', () => {
  it('runs dataset and completes when pass rate is above threshold', async () => {
    const runner = new EvalRunnerV2();
    const run = await runner.runSuite({
      suite: 'smoke',
      threshold: 0.6
    });

    expect(run.suite).toBe('smoke');
    expect(run.status).toBe('completed');
    expect(run.passRate).toBeGreaterThanOrEqual(0.6);
    expect(run.caseResults.length).toBeGreaterThan(0);
  });

  it('simulates deterministic failures with chaos model_down scenario', async () => {
    const runner = new EvalRunnerV2();
    const run = await runner.runSuite({
      suite: 'guardrails',
      threshold: 1,
      chaosScenario: 'model_down'
    });

    expect(run.status).toBe('failed');
    expect(run.caseResults.some((item) => item.error?.includes('chaos_model_down'))).toBe(true);
  });
});
