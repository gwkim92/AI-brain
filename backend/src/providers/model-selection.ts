import type {
  JarvisStore,
  ModelControlFeatureKey,
  UserModelSelectionPreferenceRecord
} from '../store/types';

import type { ProviderName } from './types';

export type ModelSelectionOverrideInput = {
  provider?: ProviderName | 'auto';
  strictProvider?: boolean;
  model?: string;
};

export type ResolvedModelSelection = {
  featureKey: ModelControlFeatureKey;
  provider: ProviderName | 'auto';
  strictProvider: boolean;
  model: string | null;
  source: 'request_override' | 'feature_preference' | 'global_default' | 'auto';
  preference: UserModelSelectionPreferenceRecord | null;
};

function normalizeModelId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasExplicitOverride(input: ModelSelectionOverrideInput): boolean {
  return (
    typeof input.provider !== 'undefined'
    || typeof input.strictProvider === 'boolean'
    || normalizeModelId(input.model) !== null
  );
}

function mapPreference(
  featureKey: ModelControlFeatureKey,
  preference: UserModelSelectionPreferenceRecord,
  source: 'feature_preference' | 'global_default'
): ResolvedModelSelection {
  if (preference.selectionMode === 'auto') {
    return {
      featureKey,
      provider: 'auto',
      strictProvider: false,
      model: null,
      source,
      preference
    };
  }

  const provider = preference.provider;
  const strictProvider = provider === 'auto' ? false : preference.strictProvider;
  const model = provider === 'auto' ? null : (preference.modelId ?? null);

  return {
    featureKey,
    provider,
    strictProvider,
    model,
    source,
    preference
  };
}

export async function resolveModelSelection(input: {
  store: JarvisStore;
  userId: string;
  featureKey: ModelControlFeatureKey;
  override?: ModelSelectionOverrideInput;
}): Promise<ResolvedModelSelection> {
  const requestOverride = input.override ?? {};
  if (hasExplicitOverride(requestOverride)) {
    return {
      featureKey: input.featureKey,
      provider: requestOverride.provider ?? 'auto',
      strictProvider: requestOverride.strictProvider ?? false,
      model: normalizeModelId(requestOverride.model),
      source: 'request_override',
      preference: null
    };
  }

  const [featurePreference, globalPreference] = await Promise.all([
    input.store.getUserModelSelectionPreference({
      userId: input.userId,
      featureKey: input.featureKey
    }),
    input.featureKey === 'global_default'
      ? Promise.resolve(null)
      : input.store.getUserModelSelectionPreference({
          userId: input.userId,
          featureKey: 'global_default'
        })
  ]);

  if (featurePreference) {
    return mapPreference(input.featureKey, featurePreference, 'feature_preference');
  }

  if (globalPreference) {
    return mapPreference(input.featureKey, globalPreference, 'global_default');
  }

  return {
    featureKey: input.featureKey,
    provider: 'auto',
    strictProvider: false,
    model: null,
    source: 'auto',
    preference: null
  };
}
