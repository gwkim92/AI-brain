import type { HyperAgentArtifactKey } from './types';

export const MUTABLE_FIELD_ALLOWLIST: Record<HyperAgentArtifactKey, string[]> = {
  radar_domain_pack: [
    'mechanismTemplates',
    'stateVariables',
    'invalidationTemplates',
    'watchMetrics',
    'keywordLexicon',
    'actionMapping.executionMode',
  ],
  world_model_dossier_config: [
    'maxBottlenecks',
    'maxInvalidationConditions',
    'maxNextWatchSignals',
    'bottleneckScoreThreshold',
  ],
};

function mutateStringArray(fieldName: string, values: string[]): string[] {
  const next = [...values];
  const seed = values[0]?.trim() || fieldName;
  const appended =
    fieldName === 'mechanismTemplates'
      ? `${seed} -> follow_up_validation`
      : fieldName === 'watchMetrics'
        ? `${seed}_follow_up`
        : fieldName === 'keywordLexicon'
          ? `${seed}_watch`
          : `${fieldName}_variant`;

  if (!next.includes(appended)) {
    next.push(appended);
  }

  return next;
}

function mutateNumber(fieldName: string, value: number): number {
  if (fieldName === 'bottleneckScoreThreshold') {
    return Math.max(0, Math.min(1, Number((value + 0.05).toFixed(3))));
  }

  return Math.max(1, Math.trunc(value) - 1);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mutateExecutionMode(current: unknown): unknown {
  if (current === 'execute_auto') return 'proposal_auto';
  if (current === 'proposal_auto') return 'approval_required';
  if (current === 'approval_required') return 'execute_auto';
  return current;
}

function mutateRadarDomainPackPayload(input: {
  payload: Record<string, unknown>;
  mutationBudget: number;
}): {
  payload: Record<string, unknown>;
  changedKeys: string[];
} {
  const domainPacks = cloneJson(input.payload.domainPacks);
  if (!Array.isArray(domainPacks) || domainPacks.length === 0) {
    return {
      payload: { ...input.payload },
      changedKeys: [],
    };
  }

  const firstPack = domainPacks[0];
  if (typeof firstPack !== 'object' || firstPack === null || Array.isArray(firstPack)) {
    return {
      payload: { ...input.payload },
      changedKeys: [],
    };
  }

  const nextPack = {
    ...(firstPack as Record<string, unknown>),
  };
  const changedKeys: string[] = [];

  for (const key of MUTABLE_FIELD_ALLOWLIST.radar_domain_pack.slice(0, input.mutationBudget)) {
    if (key === 'actionMapping.executionMode') {
      const currentActionMapping = nextPack.actionMapping;
      if (typeof currentActionMapping === 'object' && currentActionMapping !== null && !Array.isArray(currentActionMapping)) {
        const actionMapping = { ...(currentActionMapping as Record<string, unknown>) };
        actionMapping.executionMode = mutateExecutionMode(actionMapping.executionMode);
        nextPack.actionMapping = actionMapping;
        changedKeys.push(`domainPacks[0].${key}`);
      }
      continue;
    }

    const current = nextPack[key];
    if (Array.isArray(current) && current.every((value) => typeof value === 'string')) {
      nextPack[key] = mutateStringArray(key, current as string[]);
      changedKeys.push(`domainPacks[0].${key}`);
    }
  }

  domainPacks[0] = nextPack;

  return {
    payload: {
      ...cloneJson(input.payload),
      domainPacks,
    },
    changedKeys,
  };
}

export function applyBoundedMutations(input: {
  artifactKey: HyperAgentArtifactKey;
  basePayload: Record<string, unknown>;
  mutationBudget?: number;
}): {
  payload: Record<string, unknown>;
  changedKeys: string[];
} {
  const mutationBudget = Math.max(1, Math.trunc(input.mutationBudget ?? 1));

  if (input.artifactKey === 'radar_domain_pack' && Array.isArray(input.basePayload.domainPacks)) {
    return mutateRadarDomainPackPayload({
      payload: input.basePayload,
      mutationBudget,
    });
  }

  const mutableKeys = MUTABLE_FIELD_ALLOWLIST[input.artifactKey].filter((key) =>
    Object.prototype.hasOwnProperty.call(input.basePayload, key)
  );

  const payload: Record<string, unknown> = {
    ...input.basePayload,
  };
  const changedKeys: string[] = [];

  for (const key of mutableKeys.slice(0, mutationBudget)) {
    const current = payload[key];
    if (Array.isArray(current) && current.every((value) => typeof value === 'string')) {
      payload[key] = mutateStringArray(key, current as string[]);
      changedKeys.push(key);
      continue;
    }
    if (typeof current === 'number' && Number.isFinite(current)) {
      payload[key] = mutateNumber(key, current);
      changedKeys.push(key);
    }
  }

  return {
    payload,
    changedKeys,
  };
}
