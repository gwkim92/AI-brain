export type ChaosScenario = 'none' | 'connector_down' | 'model_down' | 'network_latency';

function deterministicRoll(seed: number): number {
  // LCG deterministic pseudo-random in [0, 1)
  const a = 1664525;
  const c = 1013904223;
  const m = 2 ** 32;
  const next = (a * seed + c) % m;
  return next / m;
}

export function shouldFailDeterministically(input: {
  seed: number;
  failureRate: number;
}): boolean {
  const normalizedRate = Math.max(0, Math.min(1, input.failureRate));
  return deterministicRoll(input.seed) < normalizedRate;
}

export async function runWithChaosInjection<T>(input: {
  scenario: ChaosScenario;
  target: 'connector' | 'model' | 'network' | 'other';
  seed?: number;
  failureRate?: number;
  latencyMs?: number;
  task: () => Promise<T> | T;
}): Promise<T> {
  const seed = input.seed ?? 42;
  const failureRate = input.failureRate ?? 1;
  const shouldFail = shouldFailDeterministically({ seed, failureRate });

  if (input.scenario === 'connector_down' && input.target === 'connector' && shouldFail) {
    throw new Error('chaos_connector_down');
  }
  if (input.scenario === 'model_down' && input.target === 'model' && shouldFail) {
    throw new Error('chaos_model_down');
  }
  if (input.scenario === 'network_latency' && input.target === 'network') {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, input.latencyMs ?? 300)));
  }

  return await input.task();
}
