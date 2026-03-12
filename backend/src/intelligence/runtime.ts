import type { AppEnv } from '../config/env';
import type { ProviderRouter } from '../providers/router';
import type { ProviderCredentialProvider, JarvisStore } from '../store/types';
import type {
  CapabilityAliasBindingRecord,
  IntelligenceCapabilityAlias,
  IntelligenceCostClass,
  ModelRegistryEntryRecord,
  CreateCapabilityAliasBindingInput,
} from '../store/types';

const CAPABILITY_ALIASES: IntelligenceCapabilityAlias[] = [
  'fast_triage',
  'structured_extraction',
  'cross_doc_linking',
  'skeptical_critique',
  'deep_synthesis',
  'policy_judgment',
  'deep_research',
  'execution_planning',
];

type CapabilityRequirements = {
  structuredOutputRequired?: boolean;
  toolUseRequired?: boolean;
  longContextRequired?: boolean;
  maxCostClass?: IntelligenceCostClass | null;
};

export type ResolvedCapabilityModel = {
  alias: IntelligenceCapabilityAlias;
  provider: ProviderCredentialProvider;
  modelId: string;
  binding: CapabilityAliasBindingRecord;
  registryEntry: ModelRegistryEntryRecord | null;
};

function costRank(value: IntelligenceCostClass | null | undefined): number {
  if (value === 'free') return 0;
  if (value === 'low') return 1;
  if (value === 'standard') return 2;
  if (value === 'premium') return 3;
  return 99;
}

function canSatisfyRequirements(
  binding: CapabilityAliasBindingRecord,
  registryEntry: ModelRegistryEntryRecord | null,
  requirements: CapabilityRequirements
): boolean {
  if (!binding.isActive) return false;
  if (requirements.structuredOutputRequired && !(binding.requiresStructuredOutput || registryEntry?.supportsStructuredOutput)) {
    return false;
  }
  if (requirements.toolUseRequired && !(binding.requiresToolUse || registryEntry?.supportsToolUse)) {
    return false;
  }
  if (requirements.longContextRequired && !(binding.requiresLongContext || registryEntry?.supportsLongContext)) {
    return false;
  }
  const bindingCost = binding.maxCostClass ?? registryEntry?.costClass ?? null;
  if (requirements.maxCostClass && costRank(bindingCost) > costRank(requirements.maxCostClass)) {
    return false;
  }
  return true;
}

function defaultModelForProvider(provider: ProviderCredentialProvider, env: AppEnv): string {
  if (provider === 'openai') return env.OPENAI_MODEL;
  if (provider === 'gemini') return env.GEMINI_MODEL;
  if (provider === 'anthropic') return env.ANTHROPIC_MODEL;
  return env.LOCAL_LLM_MODEL;
}

export async function ensureDefaultIntelligenceAliasBindings(store: JarvisStore, env: AppEnv): Promise<void> {
  const existing = await store.listIntelligenceAliasBindings();
  const globalBindings = existing.filter((row) => row.workspaceId === null);
  if (globalBindings.length > 0) return;

  const defaultBindings = CAPABILITY_ALIASES.map((alias) => {
    const providers: ProviderCredentialProvider[] = ['openai', 'gemini', 'anthropic', 'local'];
    return {
      alias,
      bindings: providers.map((provider, index): CreateCapabilityAliasBindingInput => ({
        alias,
        provider,
        modelId: defaultModelForProvider(provider, env),
        weight: provider === 'openai' ? 1.0 : provider === 'gemini' ? 0.92 : provider === 'anthropic' ? 0.88 : 0.72,
        fallbackRank: index + 1,
        canaryPercent: 0,
        isActive: true,
        requiresStructuredOutput:
          alias === 'structured_extraction' || alias === 'cross_doc_linking' || alias === 'deep_synthesis',
        requiresToolUse: alias === 'execution_planning' || alias === 'deep_research',
        requiresLongContext: alias === 'cross_doc_linking' || alias === 'deep_research',
        maxCostClass: alias === 'fast_triage'
          ? 'low'
          : alias === 'deep_research'
            ? 'premium'
            : 'standard',
      })),
    };
  });

  for (const row of defaultBindings) {
    await store.replaceIntelligenceAliasBindings({
      alias: row.alias,
      workspaceId: null,
      bindings: row.bindings,
      updatedBy: null,
    });
  }
}

export async function resolveCapabilityModel(input: {
  store: JarvisStore;
  env: AppEnv;
  alias: IntelligenceCapabilityAlias;
  workspaceId?: string | null;
  requirements?: CapabilityRequirements;
}): Promise<ResolvedCapabilityModel | null> {
  await ensureDefaultIntelligenceAliasBindings(input.store, input.env);
  const [workspaceBindings, globalBindings, registry, providerHealth] = await Promise.all([
    input.workspaceId
      ? input.store.listIntelligenceAliasBindings({ workspaceId: input.workspaceId, alias: input.alias })
      : Promise.resolve([]),
    input.store.listIntelligenceAliasBindings({ workspaceId: null, alias: input.alias }),
    input.store.listIntelligenceModelRegistryEntries(),
    input.store.listIntelligenceProviderHealth(),
  ]);
  const registryByKey = new Map(registry.map((row) => [`${row.provider}:${row.modelId}`, row] as const));
  const providerHealthByProvider = new Map(providerHealth.map((row) => [row.provider, row] as const));
  const ordered = [...workspaceBindings, ...globalBindings].sort((left, right) => {
    const leftHealth = providerHealthByProvider.get(left.provider);
    const rightHealth = providerHealthByProvider.get(right.provider);
    if ((leftHealth?.available ?? true) !== (rightHealth?.available ?? true)) {
      return (rightHealth?.available ?? true ? 1 : 0) - (leftHealth?.available ?? true ? 1 : 0);
    }
    if (left.fallbackRank !== right.fallbackRank) return left.fallbackRank - right.fallbackRank;
    return right.weight - left.weight;
  });
  const requirements = input.requirements ?? {};
  for (const binding of ordered) {
    const health = providerHealthByProvider.get(binding.provider);
    if (health && !health.available) continue;
    const registryEntry = registryByKey.get(`${binding.provider}:${binding.modelId}`) ?? null;
    if (!canSatisfyRequirements(binding, registryEntry, requirements)) continue;
    return {
      alias: input.alias,
      provider: binding.provider,
      modelId: binding.modelId,
      binding,
      registryEntry,
    };
  }
  return null;
}

export function inferIntelligenceModelMetadata(input: {
  provider: ProviderCredentialProvider;
  modelId: string;
}): Omit<ModelRegistryEntryRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastSeenAt'> {
  const model = input.modelId.toLowerCase();
  const longContext =
    input.provider === 'gemini' ||
    model.includes('128k') ||
    model.includes('1m') ||
    model.includes('long') ||
    model.includes('flash');
  return {
    provider: input.provider,
    modelId: input.modelId,
    availability: 'active',
    contextWindow: longContext ? 1_000_000 : input.provider === 'openai' ? 128_000 : 200_000,
    supportsStructuredOutput: input.provider !== 'local' || model.includes('json'),
    supportsToolUse: input.provider !== 'local' || model.includes('tool'),
    supportsLongContext: longContext,
    supportsReasoning: input.provider !== 'local' || model.includes('reason'),
    costClass:
      model.includes('nano') || model.includes('lite')
        ? 'low'
        : model.includes('mini') || model.includes('flash')
          ? 'standard'
          : 'premium',
    latencyClass:
      model.includes('flash') || model.includes('mini') || model.includes('nano')
        ? 'fast'
        : model.includes('opus') || model.includes('deep')
          ? 'slow'
          : 'balanced',
  };
}

export function providerEnabled(providerRouter: ProviderRouter, provider: ProviderCredentialProvider): boolean {
  const availability = providerRouter.listAvailability().find((row) => row.provider === provider);
  return availability?.enabled === true;
}
