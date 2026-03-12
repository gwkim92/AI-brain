import { describe, expect, it } from 'vitest';

import { evaluateEvalGate, summarizePromptOptimizerDiff } from '../gate';
import { executeUpgradeRun, type UpgradeExecutorGateway } from '../../upgrades/executor';

describe('evaluateEvalGate', () => {
  it('fails when accuracy is below threshold', () => {
    const result = evaluateEvalGate({
      accuracy: 0.71,
      safety: 0.96,
      costDeltaPct: 4
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('accuracy_below_threshold');
  });

  it('fails when world-model evaluation drops invalidation accuracy or loses the counter hypothesis', () => {
    const result = evaluateEvalGate({
      accuracy: 0.92,
      safety: 0.96,
      costDeltaPct: 3,
      worldModel: {
        extractionAccuracy: 0.82,
        linkAccuracy: 0.74,
        invalidationAccuracy: 0.51,
        counterHypothesisRetained: false,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('world_model_invalidation_below_threshold');
    expect(result.reasons).toContain('world_model_counter_hypothesis_missing');
  });

  it('summarizes prompt optimizer improvement', () => {
    const summary = summarizePromptOptimizerDiff({
      baselineScore: 0.78,
      optimizedScore: 0.86,
      baselinePrompt: 'v1 prompt',
      optimizedPrompt: 'v2 prompt'
    });

    expect(summary.recommendation).toBe('adopt_optimized');
    expect(summary.delta).toBeGreaterThan(0);
  });
});

describe('executeUpgradeRun with eval gate', () => {
  it('blocks deployment when eval gate does not pass', async () => {
    const audits: Array<{ action: string; proposalId: string; reason: string }> = [];

    const gateway: UpgradeExecutorGateway = {
      async findProposalById() {
        return { id: 'prop_eval_1', status: 'approved' };
      },
      async createRun() {
        return { id: 'run_eval_1', proposalId: 'prop_eval_1', status: 'planning' };
      },
      async appendAuditLog(entry) {
        audits.push(entry);
      }
    };

    const result = await executeUpgradeRun(
      {
        proposalId: 'prop_eval_1',
        actorId: 'user_1',
        startCommand: '작업 시작'
      },
      gateway,
      {
        evaluateGate: async () => ({
          passed: false,
          reasons: ['accuracy_below_threshold']
        })
      }
    );

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('eval_gate_failed');
    }
    expect(audits.some((entry) => entry.reason === 'eval_gate_failed')).toBe(true);
  });
});
