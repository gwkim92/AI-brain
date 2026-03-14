import { describe, expect, it } from 'vitest';

import type { V2ExecutionContractRecord } from '../../store/types';
import { arbitrateTeamOutputs } from '../arbitration';
import { composeTeamPlan } from '../composer';

function buildContract(overrides: Partial<V2ExecutionContractRecord> = {}): V2ExecutionContractRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '00000000-0000-4000-8000-000000000001',
    prompt: 'implement payment safety checks',
    goal: 'implement payment safety checks',
    successCriteria: ['safe patch'],
    constraints: {},
    riskLevel: 'high',
    riskReasons: ['high_risk_signal'],
    deliverables: [{ type: 'code', format: 'diff' }],
    domainMix: { code: 0.7, finance: 0.3 },
    intent: 'code',
    complexity: 'complex',
    intentConfidence: 0.8,
    contractConfidence: 0.78,
    uncertainty: 0.2,
    clarificationQuestions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe('composeTeamPlan', () => {
  it('selects domain and risk roles for high-risk code requests', () => {
    const plan = composeTeamPlan(buildContract());
    const roles = plan.roles.map((item) => item.role);

    expect(roles).toContain('planner');
    expect(roles).toContain('coder');
    expect(roles).toContain('critic');
    expect(roles).toContain('risk');
    expect(roles).toContain('synthesizer');
    expect(plan.arbitration.max_rounds).toBe(2);
  });

  it('escalates when arbitration conflict remains unresolved at max rounds', () => {
    const decision = arbitrateTeamOutputs({
      outputs: [
        { role: 'coder', output: 'ship patch A', confidence: 0.62 },
        { role: 'critic', output: 'ship patch B', confidence: 0.65 }
      ],
      round: 2,
      maxRounds: 2
    });

    expect(decision.status).toBe('escalated');
    expect(decision.rationale).toContain('unresolved_conflict');
  });
});
