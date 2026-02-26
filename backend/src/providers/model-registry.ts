import type { Pool } from 'pg';

import type { AppEnv } from '../config/env';
import { fetchProviderModelCatalog } from './catalog';
import type { ProviderName } from './types';

export type ModelRegistryEntry = {
  id: string;
  provider: ProviderName;
  modelId: string;
  displayName: string | null;
  isAvailable: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsStreaming: boolean;
  costTier: 'free' | 'low' | 'standard' | 'premium';
  lastSeenAt: string;
  createdAt: string;
};

let cachedModels: ModelRegistryEntry[] = [];

export function getCachedModels(): ModelRegistryEntry[] {
  return cachedModels;
}

export function getCachedModelsByProvider(provider: ProviderName): ModelRegistryEntry[] {
  return cachedModels.filter((m) => m.provider === provider && m.isAvailable);
}

export async function syncModelRegistry(pool: Pool, env: AppEnv): Promise<ModelRegistryEntry[]> {
  const catalog = await fetchProviderModelCatalog(env);
  const now = new Date().toISOString();
  const seenKeys = new Set<string>();

  for (const entry of catalog) {
    for (const modelId of entry.models) {
      seenKeys.add(`${entry.provider}::${modelId}`);
      await pool.query(
        `INSERT INTO model_registry (provider, model_id, is_available, last_seen_at)
         VALUES ($1, $2, true, $3)
         ON CONFLICT (provider, model_id)
         DO UPDATE SET is_available = true, last_seen_at = $3`,
        [entry.provider, modelId, now]
      );
    }
  }

  await pool.query(
    `UPDATE model_registry SET is_available = false
     WHERE last_seen_at < $1::timestamptz - interval '1 hour'`,
    [now]
  );

  const updated = await getAvailableModels(pool);
  cachedModels = updated;
  return updated;
}

export async function getAvailableModels(
  pool: Pool,
  provider?: ProviderName
): Promise<ModelRegistryEntry[]> {
  const where = provider
    ? 'WHERE is_available = true AND provider = $1'
    : 'WHERE is_available = true';
  const params = provider ? [provider] : [];

  const { rows } = await pool.query(
    `SELECT id, provider, model_id, display_name, is_available,
            context_window, max_output_tokens, supports_vision,
            supports_streaming, cost_tier, last_seen_at, created_at
     FROM model_registry ${where}
     ORDER BY provider, model_id`,
    params
  );

  return rows.map(mapRow);
}

export async function getAllModels(pool: Pool): Promise<ModelRegistryEntry[]> {
  const { rows } = await pool.query(
    `SELECT id, provider, model_id, display_name, is_available,
            context_window, max_output_tokens, supports_vision,
            supports_streaming, cost_tier, last_seen_at, created_at
     FROM model_registry
     ORDER BY provider, model_id`
  );

  return rows.map(mapRow);
}

export function createRegistryRefreshInterval(
  pool: Pool,
  env: AppEnv,
  intervalMs?: number
): { stop: () => void } {
  const ms = intervalMs ?? (env as Record<string, unknown>).MODEL_REGISTRY_REFRESH_MS as number ?? 300000;
  const timer = setInterval(() => {
    void syncModelRegistry(pool, env).catch(() => undefined);
  }, ms);

  return { stop: () => clearInterval(timer) };
}

function mapRow(row: Record<string, unknown>): ModelRegistryEntry {
  return {
    id: String(row.id),
    provider: String(row.provider) as ProviderName,
    modelId: String(row.model_id),
    displayName: row.display_name ? String(row.display_name) : null,
    isAvailable: Boolean(row.is_available),
    contextWindow: row.context_window != null ? Number(row.context_window) : null,
    maxOutputTokens: row.max_output_tokens != null ? Number(row.max_output_tokens) : null,
    supportsVision: Boolean(row.supports_vision),
    supportsStreaming: Boolean(row.supports_streaming),
    costTier: String(row.cost_tier) as ModelRegistryEntry['costTier'],
    lastSeenAt: String(row.last_seen_at),
    createdAt: String(row.created_at)
  };
}
