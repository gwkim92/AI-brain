import { describe, expect, it } from 'vitest';

import { runWithChaosInjection, shouldFailDeterministically } from '../injectors';

describe('shouldFailDeterministically', () => {
  it('returns deterministic output for same seed and rate', () => {
    const first = shouldFailDeterministically({ seed: 77, failureRate: 0.4 });
    const second = shouldFailDeterministically({ seed: 77, failureRate: 0.4 });
    expect(first).toBe(second);
  });
});

describe('runWithChaosInjection', () => {
  it('injects connector failure when scenario is connector_down', async () => {
    await expect(
      runWithChaosInjection({
        scenario: 'connector_down',
        target: 'connector',
        seed: 1,
        failureRate: 1,
        task: async () => 'ok'
      })
    ).rejects.toThrow('chaos_connector_down');
  });

  it('runs task successfully with network latency scenario', async () => {
    const result = await runWithChaosInjection({
      scenario: 'network_latency',
      target: 'network',
      latencyMs: 1,
      task: async () => 'ok'
    });

    expect(result).toBe('ok');
  });
});
