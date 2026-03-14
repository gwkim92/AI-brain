import { describe, expect, it } from 'vitest';

import { CodeLoopEngineV2 } from '../engine';

describe('CodeLoopEngineV2', () => {
  it('completes run with a single auto-repair retry', async () => {
    const engine = new CodeLoopEngineV2();
    const run = await engine.startRun({
      userId: '00000000-0000-4000-8000-000000000001',
      contractId: '11111111-1111-4111-8111-111111111111',
      prompt: 'fix flaky tests',
      riskLevel: 'low',
      changedFiles: ['src/service.ts'],
      simulate: {
        test_failures: 1
      }
    });

    expect(run.retryCount).toBe(1);
    expect(run.status).toBe('completed');
    expect(run.steps.some((step) => step.step === 'pr_open' && step.status === 'completed')).toBe(true);
  });

  it('blocks run when tests keep failing after one auto-repair', async () => {
    const engine = new CodeLoopEngineV2();
    const run = await engine.startRun({
      userId: '00000000-0000-4000-8000-000000000001',
      contractId: '11111111-1111-4111-8111-111111111111',
      prompt: 'fix failing tests',
      riskLevel: 'low',
      changedFiles: ['src/service.ts'],
      simulate: {
        test_failures: 2
      }
    });

    expect(run.retryCount).toBe(1);
    expect(run.status).toBe('blocked');
    expect(run.blockedReasons).toContain('test_failed_after_auto_repair');
  });

  it('requires approval for sensitive changes and resumes after approval', async () => {
    const engine = new CodeLoopEngineV2();
    const run = await engine.startRun({
      userId: '00000000-0000-4000-8000-000000000001',
      contractId: '11111111-1111-4111-8111-111111111111',
      prompt: 'update auth policy',
      riskLevel: 'medium',
      changedFiles: ['src/auth/token-manager.ts']
    });

    expect(run.status).toBe('blocked');
    expect(run.blockedReasons).toContain('approval_required');

    const approved = await engine.approveRun({
      runId: run.id,
      userId: run.userId
    });

    expect(approved?.status).toBe('completed');
    expect(approved?.approvedAt).toBeTruthy();
  });
});
