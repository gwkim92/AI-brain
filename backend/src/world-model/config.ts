import { getAppliedHyperAgentArtifactOverride, resolveAppliedArtifactOverride } from '../hyperagent/runtime';

export type WorldModelDossierConfig = {
  maxBottlenecks: number;
  maxInvalidationConditions: number;
  maxNextWatchSignals: number;
  bottleneckScoreThreshold: number;
};

export const WORLD_MODEL_DOSSIER_CONFIG: WorldModelDossierConfig = {
  maxBottlenecks: 4,
  maxInvalidationConditions: 12,
  maxNextWatchSignals: 5,
  bottleneckScoreThreshold: 0.3,
};
export type WorldModelDossierConfigOverride = Partial<WorldModelDossierConfig>;

export function getWorldModelDossierConfig(): WorldModelDossierConfig {
  const applied = getAppliedHyperAgentArtifactOverride('world_model_dossier_config');
  return resolveAppliedArtifactOverride({
    artifactKey: 'world_model_dossier_config',
    applied,
    fallback: WORLD_MODEL_DOSSIER_CONFIG,
  });
}

function normalizeCount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeThreshold(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

export function resolveWorldModelDossierConfig(
  override?: WorldModelDossierConfigOverride | null
): WorldModelDossierConfig {
  const fallback = getWorldModelDossierConfig();
  if (!override) {
    return fallback;
  }

  return {
    maxBottlenecks: normalizeCount(override.maxBottlenecks, fallback.maxBottlenecks),
    maxInvalidationConditions: normalizeCount(
      override.maxInvalidationConditions,
      fallback.maxInvalidationConditions
    ),
    maxNextWatchSignals: normalizeCount(override.maxNextWatchSignals, fallback.maxNextWatchSignals),
    bottleneckScoreThreshold: normalizeThreshold(
      override.bottleneckScoreThreshold,
      fallback.bottleneckScoreThreshold
    ),
  };
}
