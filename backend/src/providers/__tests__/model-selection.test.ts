import { describe, expect, it, vi } from 'vitest';

import { resolveModelSelection } from '../model-selection';
import type { JarvisStore, ModelControlFeatureKey, UserModelSelectionPreferenceRecord } from '../../store/types';

function createPreference(
  input: Partial<UserModelSelectionPreferenceRecord> & Pick<UserModelSelectionPreferenceRecord, 'featureKey'>
): UserModelSelectionPreferenceRecord {
  return {
    userId: input.userId ?? '00000000-0000-4000-8000-000000000001',
    featureKey: input.featureKey,
    provider: input.provider ?? 'auto',
    modelId: input.modelId ?? null,
    strictProvider: input.strictProvider ?? false,
    selectionMode: input.selectionMode ?? 'manual',
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    updatedBy: input.updatedBy ?? null
  };
}

function createStoreWithPreferences(
  rows: Partial<Record<ModelControlFeatureKey, UserModelSelectionPreferenceRecord | null>>
): JarvisStore {
  const getter = vi.fn(async ({ featureKey }: { userId: string; featureKey: ModelControlFeatureKey }) => {
    return rows[featureKey] ?? null;
  });
  return {
    getUserModelSelectionPreference: getter
  } as unknown as JarvisStore;
}

describe('resolveModelSelection', () => {
  it('returns orchestrator-owned selection when preference selection_mode is auto', async () => {
    const store = createStoreWithPreferences({
      assistant_chat: createPreference({
        featureKey: 'assistant_chat',
        provider: 'openai',
        modelId: 'gpt-4.1',
        strictProvider: true,
        selectionMode: 'auto'
      })
    });

    const result = await resolveModelSelection({
      store,
      userId: 'u1',
      featureKey: 'assistant_chat'
    });

    expect(result.provider).toBe('auto');
    expect(result.model).toBeNull();
    expect(result.strictProvider).toBe(false);
    expect(result.source).toBe('feature_preference');
  });

  it('uses global orchestrator mode when feature-specific preference is absent', async () => {
    const store = createStoreWithPreferences({
      global_default: createPreference({
        featureKey: 'global_default',
        provider: 'gemini',
        modelId: 'gemini-2.5-pro',
        strictProvider: true,
        selectionMode: 'auto'
      })
    });

    const result = await resolveModelSelection({
      store,
      userId: 'u1',
      featureKey: 'council_run'
    });

    expect(result.provider).toBe('auto');
    expect(result.model).toBeNull();
    expect(result.strictProvider).toBe(false);
    expect(result.source).toBe('global_default');
  });

  it('keeps manual preference values when selection_mode is manual', async () => {
    const store = createStoreWithPreferences({
      execution_code: createPreference({
        featureKey: 'execution_code',
        provider: 'anthropic',
        modelId: 'claude-3-7-sonnet-latest',
        strictProvider: true,
        selectionMode: 'manual'
      })
    });

    const result = await resolveModelSelection({
      store,
      userId: 'u1',
      featureKey: 'execution_code'
    });

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-3-7-sonnet-latest');
    expect(result.strictProvider).toBe(true);
    expect(result.source).toBe('feature_preference');
  });
});
