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

describe('ProviderRouter', () => {
  it('falls back to the next provider in task order when the first fails', async () => {
    const calls: ProviderName[] = [];
    const router = new ProviderRouter({
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
    const router = new ProviderRouter({
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
    const router = new ProviderRouter({
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
    const router = new ProviderRouter({
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
});
