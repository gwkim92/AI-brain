import { describe, expect, it, vi } from 'vitest';

import { extractEventSemantics } from '../semantic';
import type { CapabilityAliasBindingRecord, JarvisStore, ModelRegistryEntryRecord, ProviderHealthRecord } from '../../store/types';

function makeStore(): Pick<
  JarvisStore,
  'listIntelligenceAliasBindings' | 'listIntelligenceModelRegistryEntries' | 'listIntelligenceProviderHealth'
> {
  const now = new Date().toISOString();
  const bindings: CapabilityAliasBindingRecord[] = [
    {
      id: 'binding-local-structured',
      workspaceId: null,
      alias: 'structured_extraction',
      provider: 'local',
      modelId: 'qwen2.5:7b',
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
  ];
  const registry: ModelRegistryEntryRecord[] = [
    {
      id: 'registry-local-structured',
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
    { provider: 'local', available: true, cooldownUntil: null, reasonCode: null, failureCount: 0, updatedAt: now },
  ];

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

describe('extractEventSemantics', () => {
  it('normalizes fenced loose local JSON into structured event semantics', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => ({
        result: {
          provider: 'local',
          model: 'qwen2.5:7b',
          outputText: [
            '```json',
            '{',
            '  "title": "Meta Acquires Moltbook, AI-Driven Social Network",',
            '  "summary": "Meta has acquired Moltbook, a social network where AI agents interact.",',
            '  "event_family": "Corporate Acquisition",',
            '  "entities": [{"name":"Meta"},{"name":"Moltbook"},{"name":"AI agents"}],',
            '  "semantic_claims": ["Meta has acquired Moltbook.","Moltbook is a social network where AI agents interact."],',
            '  "metric_shocks": ["Increase in Meta market share"],',
            '  "domain_posteriors": ["Higher likelihood of Meta expanding AI capabilities"],',
            '  "primary_hypotheses": ["Meta integrates Moltbook AI technology into its platforms."],',
            '  "counter_hypotheses": ["Meta keeps Moltbook separate."],',
            '  "invalidation_conditions": ["Meta discontinues Moltbook.","Moltbook user base declines."],',
            '  "expected_signals": ["Increased Meta AI investment.","New AI social features launched."],',
            '  "world_states": ["Meta expands AI social network footprint."]',
            '}',
            '```',
          ].join('\n'),
        },
      })),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'Meta buys Moltbook, viral social network where AI agents interact',
      rawText:
        'Meta buys Moltbook, viral social network where AI agents interact. The acquisition is described as a platform AI shift and social network move.',
      entityHints: ['Meta', 'Moltbook', 'AI'],
    });

    expect(semantics.usedModel).toEqual({ provider: 'local', modelId: 'qwen2.5:7b' });
    expect(semantics.eventFamily).not.toBe('general_signal');
    expect(semantics.entities).toContain('Meta');
    expect(semantics.semanticClaims.length).toBeGreaterThanOrEqual(2);
    expect(semantics.primaryHypotheses[0]?.summary).toContain('Meta integrates Moltbook');
    expect(semantics.expectedSignals).toHaveLength(2);
  });
});
