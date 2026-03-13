import { describe, expect, it, vi } from 'vitest';

import { resolveCapabilityModel } from '../runtime';
import type { JarvisStore, ModelRegistryEntryRecord, CapabilityAliasBindingRecord, ProviderHealthRecord } from '../../store/types';

function makeStore(overrides?: {
  bindings?: CapabilityAliasBindingRecord[];
  registry?: ModelRegistryEntryRecord[];
  health?: ProviderHealthRecord[];
}): Pick<
  JarvisStore,
  'listIntelligenceAliasBindings' | 'listIntelligenceModelRegistryEntries' | 'listIntelligenceProviderHealth'
> {
  const bindings = overrides?.bindings ?? [];
  const registry = overrides?.registry ?? [];
  const health = overrides?.health ?? [];
  return {
    listIntelligenceAliasBindings: vi.fn(async (input?: { workspaceId?: string | null; alias?: string }) => {
      const workspaceId = input?.workspaceId ?? null;
      const alias = input?.alias;
      return bindings.filter((row) => row.workspaceId === workspaceId && (!alias || row.alias === alias));
    }),
    listIntelligenceModelRegistryEntries: vi.fn(async () => registry),
    listIntelligenceProviderHealth: vi.fn(async () => health),
  };
}

describe('resolveCapabilityModel', () => {
  it('skips providers that are disabled in the provider router', async () => {
    const now = new Date().toISOString();
    const bindings: CapabilityAliasBindingRecord[] = [
      {
        id: 'b-openai',
        workspaceId: null,
        alias: 'structured_extraction',
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
        weight: 1,
        fallbackRank: 1,
        canaryPercent: 0,
        isActive: true,
        requiresStructuredOutput: true,
        requiresToolUse: false,
        requiresLongContext: false,
        maxCostClass: 'standard',
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'b-local',
        workspaceId: null,
        alias: 'structured_extraction',
        provider: 'local',
        modelId: 'qwen2.5:7b',
        weight: 0.8,
        fallbackRank: 2,
        canaryPercent: 0,
        isActive: true,
        requiresStructuredOutput: true,
        requiresToolUse: false,
        requiresLongContext: false,
        maxCostClass: 'standard',
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const registry: ModelRegistryEntryRecord[] = [
      {
        id: 'r-openai',
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
        availability: 'active',
        contextWindow: 128_000,
        supportsStructuredOutput: true,
        supportsToolUse: true,
        supportsLongContext: false,
        supportsReasoning: true,
        costClass: 'standard',
        latencyClass: 'fast',
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'r-local',
        provider: 'local',
        modelId: 'qwen2.5:7b',
        availability: 'active',
        contextWindow: 200_000,
        supportsStructuredOutput: false,
        supportsToolUse: false,
        supportsLongContext: false,
        supportsReasoning: false,
        costClass: 'premium',
        latencyClass: 'balanced',
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const health: ProviderHealthRecord[] = [
      { provider: 'openai', available: true, cooldownUntil: null, reasonCode: null, failureCount: 0, updatedAt: now },
      { provider: 'local', available: true, cooldownUntil: null, reasonCode: null, failureCount: 0, updatedAt: now },
    ];
    const store = makeStore({ bindings, registry, health });
    const providerRouter = {
      listAvailability: () => [
        { provider: 'openai', enabled: false, model: 'gpt-4.1-mini', reason: 'missing_api_key' },
        { provider: 'local', enabled: true, model: 'qwen2.5:7b' },
      ],
    } as const;
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const resolved = await resolveCapabilityModel({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      alias: 'structured_extraction',
      requirements: {
        structuredOutputRequired: true,
        maxCostClass: 'standard',
      },
    });

    expect(resolved?.provider).toBe('local');
    expect(resolved?.modelId).toBe('qwen2.5:7b');
  });
});
