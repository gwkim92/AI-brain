import { describe, expect, it } from 'vitest';

import { ProviderRouter } from '../router';
import type {
  LlmProvider,
  ProviderAvailability,
  ProviderGenerateRequest,
  ProviderGenerateResult,
  ProviderName
} from '../types';

type StubProviderConfig = {
  enabled?: boolean;
  reason?: string;
  outputText?: string;
  model?: string;
  throwMessage?: string;
  onGenerate?: (request: ProviderGenerateRequest) => void;
};

function createStubProvider(name: ProviderName, config: StubProviderConfig = {}): LlmProvider {
  const enabled = config.enabled ?? true;
  const model = config.model ?? `${name}-model`;

  return {
    name,
    availability(): ProviderAvailability {
      return {
        provider: name,
        enabled,
        model,
        reason: enabled ? undefined : (config.reason ?? 'disabled')
      };
    },
    async generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
      config.onGenerate?.(request);

      if (!enabled) {
        throw new Error(`${name} disabled`);
      }
      if (config.throwMessage) {
        throw new Error(config.throwMessage);
      }

      return {
        provider: name,
        model,
        outputText: config.outputText ?? `${name} response`
      };
    }
  };
}

function createDeterministicRouter(providers: Record<ProviderName, LlmProvider>): ProviderRouter {
  const router = new ProviderRouter(providers);
  router.setExplorationRate(0);
  return router;
}

describe('ProviderRouter', () => {
  it('falls back to the next provider in task order when the first fails', async () => {
    const calls: ProviderName[] = [];
    const router = createDeterministicRouter({
      openai: createStubProvider('openai', {
        onGenerate: () => calls.push('openai'),
        throwMessage: 'openai unavailable'
      }),
      gemini: createStubProvider('gemini', {
        onGenerate: () => calls.push('gemini')
      }),
      anthropic: createStubProvider('anthropic', {
        onGenerate: () => calls.push('anthropic'),
        outputText: 'anthropic success'
      }),
      local: createStubProvider('local', {
        onGenerate: () => calls.push('local')
      })
    });

    const result = await router.generate({
      prompt: 'test prompt',
      taskType: 'chat'
    });

    expect(result.result.provider).toBe('anthropic');
    expect(result.result.outputText).toBe('anthropic success');
    expect(result.usedFallback).toBe(true);
    expect(result.attempts.map((item) => `${item.provider}:${item.status}`)).toEqual(['openai:failed', 'anthropic:success']);
    expect(calls).toEqual(['openai', 'anthropic']);
  });

  it('does not fall back when strict provider mode is enabled', async () => {
    const calls: ProviderName[] = [];
    const router = createDeterministicRouter({
      openai: createStubProvider('openai', {
        onGenerate: () => calls.push('openai')
      }),
      gemini: createStubProvider('gemini', {
        onGenerate: () => calls.push('gemini'),
        throwMessage: 'gemini down'
      }),
      anthropic: createStubProvider('anthropic', {
        onGenerate: () => calls.push('anthropic')
      }),
      local: createStubProvider('local', {
        onGenerate: () => calls.push('local')
      })
    });

    await expect(
      router.generate({
        prompt: 'strict request',
        provider: 'gemini',
        strictProvider: true,
        taskType: 'chat'
      })
    ).rejects.toThrow('all providers failed: gemini:failed(gemini down)');

    expect(calls).toEqual(['gemini']);
  });

  it('uses requested provider first and then fallback order when strict mode is disabled', async () => {
    const calls: ProviderName[] = [];
    const router = createDeterministicRouter({
      openai: createStubProvider('openai', {
        onGenerate: () => calls.push('openai'),
        outputText: 'openai fallback success'
      }),
      gemini: createStubProvider('gemini', {
        onGenerate: () => calls.push('gemini')
      }),
      anthropic: createStubProvider('anthropic', {
        onGenerate: () => calls.push('anthropic')
      }),
      local: createStubProvider('local', {
        enabled: false,
        reason: 'disabled_by_config',
        onGenerate: () => calls.push('local')
      })
    });

    const result = await router.generate({
      prompt: 'prefer local first',
      provider: 'local',
      strictProvider: false,
      taskType: 'chat'
    });

    expect(result.result.provider).toBe('openai');
    expect(result.usedFallback).toBe(true);
    expect(result.attempts.map((item) => `${item.provider}:${item.status}`)).toEqual(['local:skipped', 'openai:success']);
    expect(calls).toEqual(['openai']);
  });

  it('returns provider availability in fixed API order', () => {
    const router = createDeterministicRouter({
      openai: createStubProvider('openai'),
      gemini: createStubProvider('gemini', {
        enabled: false,
        reason: 'missing_api_key'
      }),
      anthropic: createStubProvider('anthropic'),
      local: createStubProvider('local')
    });

    const providers = router.listAvailability();

    expect(providers.map((item) => item.provider)).toEqual(['openai', 'gemini', 'anthropic', 'local']);
    expect(providers[1]).toMatchObject({
      provider: 'gemini',
      enabled: false,
      reason: 'missing_api_key'
    });
  });

  it('skips excluded providers and routes to next available candidate', async () => {
    const calls: ProviderName[] = [];
    const router = createDeterministicRouter({
      openai: createStubProvider('openai', {
        onGenerate: () => calls.push('openai')
      }),
      gemini: createStubProvider('gemini', {
        onGenerate: () => calls.push('gemini'),
        outputText: 'gemini success'
      }),
      anthropic: createStubProvider('anthropic', {
        onGenerate: () => calls.push('anthropic')
      }),
      local: createStubProvider('local', {
        onGenerate: () => calls.push('local')
      })
    });

    const result = await router.generate({
      prompt: 'exclude openai and anthropic',
      taskType: 'chat',
      excludeProviders: ['openai', 'anthropic']
    });

    expect(result.result.provider).toBe('gemini');
    expect(result.attempts.map((item) => `${item.provider}:${item.status}`)).toEqual([
      'openai:skipped',
      'anthropic:skipped',
      'gemini:success'
    ]);
    expect(result.attempts[0]?.error).toBe('excluded_by_request');
    expect(result.attempts[1]?.error).toBe('excluded_by_request');
    expect(calls).toEqual(['gemini']);
  });

  it('fails immediately when strict provider is excluded by request', async () => {
    const calls: ProviderName[] = [];
    const router = createDeterministicRouter({
      openai: createStubProvider('openai', {
        onGenerate: () => calls.push('openai')
      }),
      gemini: createStubProvider('gemini', {
        onGenerate: () => calls.push('gemini')
      }),
      anthropic: createStubProvider('anthropic', {
        onGenerate: () => calls.push('anthropic')
      }),
      local: createStubProvider('local', {
        onGenerate: () => calls.push('local')
      })
    });

    await expect(
      router.generate({
        prompt: 'strict excluded',
        taskType: 'chat',
        provider: 'openai',
        strictProvider: true,
        excludeProviders: ['openai']
      })
    ).rejects.toThrow('all providers failed: openai:skipped(excluded_by_request)');

    expect(calls).toEqual([]);
  });

  it('adapts auto order based on runtime EMA outcomes', async () => {
    const calls: ProviderName[] = [];
    const router = createDeterministicRouter({
      openai: createStubProvider('openai', {
        onGenerate: () => calls.push('openai'),
        throwMessage: 'openai outage'
      }),
      gemini: createStubProvider('gemini', {
        onGenerate: () => calls.push('gemini'),
        outputText: 'gemini success'
      }),
      anthropic: createStubProvider('anthropic', {
        enabled: false,
        reason: 'missing_api_key',
        onGenerate: () => calls.push('anthropic')
      }),
      local: createStubProvider('local', {
        enabled: false,
        reason: 'disabled',
        onGenerate: () => calls.push('local')
      })
    });

    const first = await router.generate({
      prompt: 'first request',
      taskType: 'chat'
    });

    expect(first.attempts.map((item) => `${item.provider}:${item.status}`)).toEqual(['openai:failed', 'gemini:success']);
    expect(first.selection?.strategy).toBe('auto_orchestrator');
    expect(first.selection?.scores?.[0]?.breakdown).toMatchObject({
      domain_fit: expect.any(Number),
      recent_success: expect.any(Number),
      latency: expect.any(Number),
      cost: expect.any(Number),
      context_fit: expect.any(Number),
      prompt_fit: expect.any(Number),
      availability_penalty: expect.any(Number)
    });

    const second = await router.generate({
      prompt: 'second request',
      taskType: 'chat'
    });

    expect(second.attempts[0]?.provider).toBe('gemini');
    expect(second.result.provider).toBe('gemini');
  });

  it('loads runtime stats with EMA fields', () => {
    const router = createDeterministicRouter({
      openai: createStubProvider('openai'),
      gemini: createStubProvider('gemini'),
      anthropic: createStubProvider('anthropic'),
      local: createStubProvider('local')
    });

    router.loadRuntimeStats([
      { provider: 'openai', taskType: 'chat', successCount: 90, failureCount: 10, avgLatencyMs: 250, successEma: 0.9, latencyEma: 200 },
      { provider: 'gemini', taskType: 'chat', successCount: 80, failureCount: 20, avgLatencyMs: 180, successEma: 0.7, latencyEma: 180 }
    ]);

    const stats = router.getRuntimeStats();
    expect(stats.openai.successEma).toBe(0.9);
    expect(stats.openai.latencyEma).toBe(200);
    expect(stats.gemini.successEma).toBe(0.7);
  });

  it('enables policy routing when enablePolicyRouting is called', async () => {
    const router = createDeterministicRouter({
      openai: createStubProvider('openai', { outputText: 'ok' }),
      gemini: createStubProvider('gemini'),
      anthropic: createStubProvider('anthropic'),
      local: createStubProvider('local')
    });

    router.enablePolicyRouting();
    const result = await router.generate({ prompt: 'test', taskType: 'chat' });
    expect(result.selection?.reason).toContain('source=policy');
  });

  it('uses fallback scores when policy routing is not enabled', async () => {
    const router = createDeterministicRouter({
      openai: createStubProvider('openai', { outputText: 'ok' }),
      gemini: createStubProvider('gemini'),
      anthropic: createStubProvider('anthropic'),
      local: createStubProvider('local')
    });

    const result = await router.generate({ prompt: 'test', taskType: 'chat' });
    expect(result.selection?.reason).toContain('source=fallback');
  });
});
