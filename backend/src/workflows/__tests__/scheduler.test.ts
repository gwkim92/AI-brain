import { describe, expect, it } from 'vitest';

import { parseWorkflowDsl } from '../dsl-parser';
import { scheduleWorkflowCandidates } from '../scheduler';

describe('scheduleWorkflowCandidates', () => {
  it('accepts candidates in budget and selects the best scored workflow', () => {
    const result = scheduleWorkflowCandidates({
      candidates: [
        { workflow_id: 'wf_a', quality: 0.94, latency_ms: 400, cost_usd: 2.5, risk: 0.2 },
        { workflow_id: 'wf_b', quality: 0.8, latency_ms: 300, cost_usd: 3, risk: 0.1 }
      ],
      budget: {
        max_cost_usd: 10,
        max_latency_ms: 1200,
        high_risk_request: false
      }
    });

    expect(result.accepted).toHaveLength(2);
    expect(result.selected?.workflow_id).toBe('wf_a');
  });

  it('rejects candidates when budget constraints are exceeded', () => {
    const result = scheduleWorkflowCandidates({
      candidates: [
        { workflow_id: 'wf_expensive', quality: 0.95, latency_ms: 500, cost_usd: 25, risk: 0.2 },
        { workflow_id: 'wf_slow', quality: 0.85, latency_ms: 8000, cost_usd: 2, risk: 0.1 }
      ],
      budget: {
        max_cost_usd: 10,
        max_latency_ms: 3000,
        high_risk_request: false
      }
    });

    expect(result.selected).toBeNull();
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.map((item) => item.reason)).toContain('budget_cost_exceeded');
    expect(result.rejected.map((item) => item.reason)).toContain('budget_latency_exceeded');
  });

  it('applies a doubled risk penalty for high-risk requests', () => {
    const normalRisk = scheduleWorkflowCandidates({
      candidates: [
        { workflow_id: 'higher_risk', quality: 1, latency_ms: 500, cost_usd: 3, risk: 0.8 },
        { workflow_id: 'lower_risk', quality: 0.72, latency_ms: 500, cost_usd: 3, risk: 0.1 }
      ],
      budget: {
        max_cost_usd: 10,
        max_latency_ms: 3000,
        high_risk_request: false
      }
    });
    const highRisk = scheduleWorkflowCandidates({
      candidates: [
        { workflow_id: 'higher_risk', quality: 1, latency_ms: 500, cost_usd: 3, risk: 0.8 },
        { workflow_id: 'lower_risk', quality: 0.72, latency_ms: 500, cost_usd: 3, risk: 0.1 }
      ],
      budget: {
        max_cost_usd: 10,
        max_latency_ms: 3000,
        high_risk_request: true
      }
    });

    expect(normalRisk.selected?.workflow_id).toBe('higher_risk');
    expect(highRisk.selected?.workflow_id).toBe('lower_risk');
  });
});

describe('parseWorkflowDsl', () => {
  it('parses workflow dsl and auto-links sequential dependencies', () => {
    const workflow = parseWorkflowDsl({
      workflow_id: 'eng_code_loop_default',
      entry_module: 'command.compiler@1',
      steps: [
        { id: 'compile', use: 'command.compiler@1' },
        { id: 'retrieve', use: 'retrieval.orchestrator@1' },
        { id: 'compose_team', use: 'team.composer@1' }
      ]
    });

    expect(workflow.steps[0]?.dependencies ?? []).toEqual([]);
    expect(workflow.steps[1]?.dependencies ?? []).toEqual(['compile']);
    expect(workflow.steps[2]?.dependencies ?? []).toEqual(['retrieve']);
  });
});
