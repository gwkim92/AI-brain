import { describe, expect, it } from 'vitest';

import { PolicyEngineV2 } from '../engine';

describe('PolicyEngineV2', () => {
  it('returns allow when no rules match', () => {
    const engine = new PolicyEngineV2();
    const result = engine.evaluate({
      action: 'team.run.start',
      riskLevel: 'low'
    });

    expect(result.decision).toBe('allow');
    expect(result.matchedRuleIds).toHaveLength(0);
  });

  it('returns deny when a deny rule matches', () => {
    const engine = new PolicyEngineV2();
    engine.upsertRule({
      policyKey: 'deny-code-loop-high-risk',
      actionPattern: 'code_loop.*',
      minRiskLevel: 'medium',
      decision: 'deny',
      reason: 'high_risk_code_loop_disabled'
    });

    const result = engine.evaluate({
      action: 'code_loop.run.start',
      riskLevel: 'high'
    });

    expect(result.decision).toBe('deny');
    expect(result.reasons).toContain('high_risk_code_loop_disabled');
  });

  it('returns approval_required when approval rule matches and deny does not', () => {
    const engine = new PolicyEngineV2();
    engine.upsertRule({
      policyKey: 'approval-team-high-risk',
      actionPattern: 'team.run.*',
      minRiskLevel: 'high',
      decision: 'approval_required',
      reason: 'human_approval_required'
    });

    const result = engine.evaluate({
      action: 'team.run.start',
      riskLevel: 'high'
    });

    expect(result.decision).toBe('approval_required');
    expect(result.reasons).toContain('human_approval_required');
    expect(engine.listAudits(10).length).toBeGreaterThan(0);
  });
});
