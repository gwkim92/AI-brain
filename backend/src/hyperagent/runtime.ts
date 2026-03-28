import type { V2StoreRepositoryContract } from '../store/repository-contracts';
import type { V2HyperAgentRecommendationRecord } from '../store/types';

import type { HyperAgentArtifactKey } from './types';

export type AppliedHyperAgentArtifactRecord = {
  artifactKey: HyperAgentArtifactKey;
  payload: Record<string, unknown>;
  recommendationId: string;
  variantId: string;
  artifactSnapshotId: string;
  appliedAt: string;
};

const runtimeOverrides = new Map<HyperAgentArtifactKey, AppliedHyperAgentArtifactRecord>();

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAppliedPayload(
  artifactKey: HyperAgentArtifactKey,
  payload: Record<string, unknown>
): Record<string, unknown> | null {
  if (artifactKey === 'world_model_dossier_config') {
    const normalized: Record<string, unknown> = {};
    if (typeof payload.maxBottlenecks === 'number' && Number.isFinite(payload.maxBottlenecks)) {
      normalized.maxBottlenecks = payload.maxBottlenecks;
    }
    if (
      typeof payload.maxInvalidationConditions === 'number' &&
      Number.isFinite(payload.maxInvalidationConditions)
    ) {
      normalized.maxInvalidationConditions = payload.maxInvalidationConditions;
    }
    if (typeof payload.maxNextWatchSignals === 'number' && Number.isFinite(payload.maxNextWatchSignals)) {
      normalized.maxNextWatchSignals = payload.maxNextWatchSignals;
    }
    if (
      typeof payload.bottleneckScoreThreshold === 'number' &&
      Number.isFinite(payload.bottleneckScoreThreshold)
    ) {
      normalized.bottleneckScoreThreshold = payload.bottleneckScoreThreshold;
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  const domainPacks = payload.domainPacks;
  if (!Array.isArray(domainPacks) || !domainPacks.every((entry) => isRecord(entry) && typeof entry.id === 'string')) {
    return null;
  }

  return {
    domainPacks: cloneJson(domainPacks),
  };
}

function resolveAppliedTimestamp(recommendation: Pick<V2HyperAgentRecommendationRecord, 'appliedAt' | 'updatedAt'>): string {
  return recommendation.appliedAt ?? recommendation.updatedAt;
}

export function resolveAppliedArtifactOverride<T extends Record<string, unknown>>(input: {
  artifactKey: HyperAgentArtifactKey;
  applied: Record<string, unknown> | null;
  fallback: T;
}): T {
  if (!input.applied) {
    return cloneJson(input.fallback);
  }

  return {
    ...cloneJson(input.fallback),
    ...cloneJson(input.applied),
  } as T;
}

export function getAppliedHyperAgentArtifactOverride(
  artifactKey: HyperAgentArtifactKey
): Record<string, unknown> | null {
  const match = runtimeOverrides.get(artifactKey);
  return match ? cloneJson(match.payload) : null;
}

export function listAppliedHyperAgentArtifactOverrides(): AppliedHyperAgentArtifactRecord[] {
  return [...runtimeOverrides.values()]
    .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt))
    .map((entry) => cloneJson(entry));
}

export function setAppliedHyperAgentArtifactOverride(input: AppliedHyperAgentArtifactRecord): AppliedHyperAgentArtifactRecord {
  const normalizedPayload = normalizeAppliedPayload(input.artifactKey, input.payload);
  if (!normalizedPayload) {
    throw new Error(`invalid_hyperagent_payload:${input.artifactKey}`);
  }

  const record: AppliedHyperAgentArtifactRecord = {
    artifactKey: input.artifactKey,
    payload: normalizedPayload,
    recommendationId: input.recommendationId,
    variantId: input.variantId,
    artifactSnapshotId: input.artifactSnapshotId,
    appliedAt: input.appliedAt,
  };
  runtimeOverrides.set(input.artifactKey, cloneJson(record));
  return cloneJson(record);
}

export function clearAppliedHyperAgentArtifactOverrides(): void {
  runtimeOverrides.clear();
}

export async function applyHyperAgentRecommendation(
  repository: V2StoreRepositoryContract,
  recommendationId: string
): Promise<AppliedHyperAgentArtifactRecord | null> {
  const recommendation = await repository.getHyperAgentRecommendationById({
    recommendationId,
  });
  if (!recommendation) {
    return null;
  }

  const variant = await repository.getHyperAgentVariantById({
    variantId: recommendation.variantId,
  });
  if (!variant) {
    return null;
  }

  const snapshot = await repository.getHyperAgentArtifactSnapshotById({
    artifactSnapshotId: variant.artifactSnapshotId,
  });
  if (!snapshot) {
    return null;
  }
  if (
    snapshot.artifactKey !== 'radar_domain_pack' &&
    snapshot.artifactKey !== 'world_model_dossier_config'
  ) {
    return null;
  }

  return setAppliedHyperAgentArtifactOverride({
    artifactKey: snapshot.artifactKey as HyperAgentArtifactKey,
    payload: variant.payload,
    recommendationId: recommendation.id,
    variantId: variant.id,
    artifactSnapshotId: snapshot.id,
    appliedAt: resolveAppliedTimestamp(recommendation),
  });
}

export async function hydrateAppliedHyperAgentOverrides(
  repository: V2StoreRepositoryContract
): Promise<AppliedHyperAgentArtifactRecord[]> {
  clearAppliedHyperAgentArtifactOverrides();

  const appliedRecommendations = await repository.listHyperAgentRecommendations({
    status: 'applied',
    limit: 100,
  });

  for (const recommendation of appliedRecommendations) {
    const variant = await repository.getHyperAgentVariantById({
      variantId: recommendation.variantId,
    });
    if (!variant) {
      continue;
    }
    const snapshot = await repository.getHyperAgentArtifactSnapshotById({
      artifactSnapshotId: variant.artifactSnapshotId,
    });
    if (!snapshot) {
      continue;
    }
    if (
      snapshot.artifactKey !== 'radar_domain_pack' &&
      snapshot.artifactKey !== 'world_model_dossier_config'
    ) {
      continue;
    }

    const artifactKey = snapshot.artifactKey as HyperAgentArtifactKey;
    const existing = runtimeOverrides.get(artifactKey);
    const appliedAt = resolveAppliedTimestamp(recommendation);
    if (existing && existing.appliedAt >= appliedAt) {
      continue;
    }

    const normalizedPayload = normalizeAppliedPayload(artifactKey, variant.payload);
    if (!normalizedPayload) {
      continue;
    }

    runtimeOverrides.set(artifactKey, {
      artifactKey,
      payload: normalizedPayload,
      recommendationId: recommendation.id,
      variantId: variant.id,
      artifactSnapshotId: snapshot.id,
      appliedAt,
    });
  }

  return listAppliedHyperAgentArtifactOverrides();
}
