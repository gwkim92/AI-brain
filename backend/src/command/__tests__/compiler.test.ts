import { describe, expect, it, vi } from 'vitest';

import type { ProviderRouter } from '../../providers/router';
import { compileCommand } from '../compiler';

function makeRouterReturning(outputText: string): ProviderRouter {
  return {
    generate: vi.fn().mockResolvedValue({
      result: {
        provider: 'local',
        model: 'test-model',
        outputText
      }
    }),
    listAvailability: vi.fn().mockReturnValue([])
  } as unknown as ProviderRouter;
}

describe('compileCommand', () => {
  it('emits clarification questions for low-confidence mixed-domain requests', async () => {
    const router = {
      generate: vi.fn().mockRejectedValue(new Error('semantic unavailable')),
      listAvailability: vi.fn().mockReturnValue([])
    } as unknown as ProviderRouter;

    const result = await compileCommand(
      router,
      '00000000-0000-4000-8000-000000000001',
      '코드 분석도 해주고 금융 리스크 비교도 해줘'
    );

    expect(result.routing.intent).toBe('code');
    expect(result.routing.uncertainty).toBeGreaterThan(0.2);
    expect(result.clarification.questions.length).toBeLessThanOrEqual(2);
  });

  it('uses semantic routing output when valid JSON is returned', async () => {
    const router = makeRouterReturning(
      JSON.stringify({
        intent: 'finance',
        complexity: 'complex',
        goal: 'Build an evidence-based financial risk summary',
        success_criteria: ['Include assumptions', 'Include cited sources'],
        constraints: { max_cost_usd: 20 },
        risk: { level: 'high', reasons: ['financial_advice_risk'] },
        deliverables: [{ type: 'analysis', format: 'markdown' }],
        confidence: { intent: 0.82, contract: 0.77 },
        clarifying_questions: ['What time horizon should be used?']
      })
    );

    const result = await compileCommand(
      router,
      '00000000-0000-4000-8000-000000000001',
      '포트폴리오 리스크를 분석해줘'
    );

    expect(result.routing.intent).toBe('finance');
    expect(result.routing.complexity).toBe('complex');
    expect(result.contract.riskLevel).toBe('high');
    expect(result.contract.constraints.max_cost_usd).toBe(20);
    expect(result.routing.uncertainty).toBeCloseTo(0.23, 2);
    expect(result.clarification.required).toBe(false);
    expect(result.clarification.questions).toEqual([]);
  });
});
