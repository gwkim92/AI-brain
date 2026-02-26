import type { Pool } from 'pg';

import type { ProviderName, RoutingTaskType } from './types';

export type TaskModelPolicyEntry = {
  id: string;
  taskType: string;
  provider: ProviderName;
  modelId: string;
  tier: number;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PolicyScoreEntry = {
  provider: ProviderName;
  score: number;
};

let cachedPolicies: TaskModelPolicyEntry[] = [];

export function getCachedPolicies(): TaskModelPolicyEntry[] {
  return cachedPolicies;
}

export function getPolicyScoresForTask(taskType: RoutingTaskType): PolicyScoreEntry[] {
  const matching = cachedPolicies
    .filter((p) => p.taskType === taskType && p.isActive)
    .sort((a, b) => a.tier - b.tier || b.priority - a.priority);

  const providerScores = new Map<ProviderName, number>();
  for (const policy of matching) {
    if (!providerScores.has(policy.provider)) {
      const score = tierToScore(policy.tier) + policy.priority * 0.01;
      providerScores.set(policy.provider, score);
    }
  }

  return Array.from(providerScores.entries())
    .map(([provider, score]) => ({ provider, score }))
    .sort((a, b) => b.score - a.score);
}

function tierToScore(tier: number): number {
  if (tier === 1) return 1.0;
  if (tier === 2) return 0.85;
  return 0.7;
}

export async function getModelsForTask(
  pool: Pool,
  taskType: string,
  provider?: ProviderName
): Promise<TaskModelPolicyEntry[]> {
  const where = provider
    ? 'WHERE task_type = $1 AND provider = $2 AND is_active = true'
    : 'WHERE task_type = $1 AND is_active = true';
  const params = provider ? [taskType, provider] : [taskType];

  const { rows } = await pool.query(
    `SELECT id, task_type, provider, model_id, tier, priority, is_active, created_at, updated_at
     FROM task_model_policy ${where}
     ORDER BY tier ASC, priority DESC`,
    params
  );

  return rows.map(mapRow);
}

export async function listAllPolicies(pool: Pool): Promise<TaskModelPolicyEntry[]> {
  const { rows } = await pool.query(
    `SELECT id, task_type, provider, model_id, tier, priority, is_active, created_at, updated_at
     FROM task_model_policy
     ORDER BY task_type, tier ASC, priority DESC`
  );
  return rows.map(mapRow);
}

export async function upsertPolicy(
  pool: Pool,
  entry: {
    taskType: string;
    provider: ProviderName;
    modelId: string;
    tier?: number;
    priority?: number;
    isActive?: boolean;
  }
): Promise<TaskModelPolicyEntry> {
  const { rows } = await pool.query(
    `INSERT INTO task_model_policy (task_type, provider, model_id, tier, priority, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (task_type, provider, model_id)
     DO UPDATE SET
       tier = COALESCE($4, task_model_policy.tier),
       priority = COALESCE($5, task_model_policy.priority),
       is_active = COALESCE($6, task_model_policy.is_active),
       updated_at = now()
     RETURNING id, task_type, provider, model_id, tier, priority, is_active, created_at, updated_at`,
    [
      entry.taskType,
      entry.provider,
      entry.modelId,
      entry.tier ?? 1,
      entry.priority ?? 0,
      entry.isActive ?? true
    ]
  );

  return mapRow(rows[0]);
}

export async function loadPoliciesIntoCache(pool: Pool): Promise<TaskModelPolicyEntry[]> {
  const all = await listAllPolicies(pool);
  cachedPolicies = all;
  return all;
}

const DEFAULT_POLICIES: Array<{
  taskType: RoutingTaskType;
  provider: ProviderName;
  tier: number;
  priority: number;
}> = [
  { taskType: 'chat', provider: 'openai', tier: 1, priority: 10 },
  { taskType: 'chat', provider: 'anthropic', tier: 1, priority: 8 },
  { taskType: 'chat', provider: 'gemini', tier: 2, priority: 6 },
  { taskType: 'chat', provider: 'local', tier: 3, priority: 4 },

  { taskType: 'execute', provider: 'openai', tier: 1, priority: 10 },
  { taskType: 'execute', provider: 'anthropic', tier: 1, priority: 9 },
  { taskType: 'execute', provider: 'gemini', tier: 2, priority: 7 },
  { taskType: 'execute', provider: 'local', tier: 2, priority: 5 },

  { taskType: 'council', provider: 'anthropic', tier: 1, priority: 10 },
  { taskType: 'council', provider: 'openai', tier: 1, priority: 9 },
  { taskType: 'council', provider: 'gemini', tier: 2, priority: 7 },
  { taskType: 'council', provider: 'local', tier: 3, priority: 4 },

  { taskType: 'code', provider: 'openai', tier: 1, priority: 10 },
  { taskType: 'code', provider: 'local', tier: 1, priority: 9 },
  { taskType: 'code', provider: 'anthropic', tier: 2, priority: 7 },
  { taskType: 'code', provider: 'gemini', tier: 2, priority: 5 },

  { taskType: 'compute', provider: 'openai', tier: 1, priority: 10 },
  { taskType: 'compute', provider: 'gemini', tier: 1, priority: 9 },
  { taskType: 'compute', provider: 'anthropic', tier: 2, priority: 7 },
  { taskType: 'compute', provider: 'local', tier: 2, priority: 5 },

  { taskType: 'long_run', provider: 'openai', tier: 1, priority: 10 },
  { taskType: 'long_run', provider: 'anthropic', tier: 1, priority: 9 },
  { taskType: 'long_run', provider: 'gemini', tier: 2, priority: 7 },
  { taskType: 'long_run', provider: 'local', tier: 2, priority: 5 },

  { taskType: 'high_risk', provider: 'anthropic', tier: 1, priority: 10 },
  { taskType: 'high_risk', provider: 'openai', tier: 1, priority: 9 },
  { taskType: 'high_risk', provider: 'gemini', tier: 2, priority: 7 },
  { taskType: 'high_risk', provider: 'local', tier: 3, priority: 3 },

  { taskType: 'radar_review', provider: 'openai', tier: 1, priority: 10 },
  { taskType: 'radar_review', provider: 'gemini', tier: 1, priority: 9 },
  { taskType: 'radar_review', provider: 'anthropic', tier: 2, priority: 7 },
  { taskType: 'radar_review', provider: 'local', tier: 3, priority: 4 },

  { taskType: 'upgrade_execution', provider: 'openai', tier: 1, priority: 10 },
  { taskType: 'upgrade_execution', provider: 'anthropic', tier: 1, priority: 9 },
  { taskType: 'upgrade_execution', provider: 'gemini', tier: 2, priority: 7 },
  { taskType: 'upgrade_execution', provider: 'local', tier: 2, priority: 5 }
];

export async function seedDefaultPolicies(pool: Pool, env: { OPENAI_MODEL: string; GEMINI_MODEL: string; ANTHROPIC_MODEL: string; LOCAL_LLM_MODEL: string }): Promise<number> {
  const { rows } = await pool.query('SELECT count(*)::int AS cnt FROM task_model_policy');
  if (Number(rows[0].cnt) > 0) return 0;

  const modelByProvider: Record<ProviderName, string> = {
    openai: env.OPENAI_MODEL,
    gemini: env.GEMINI_MODEL,
    anthropic: env.ANTHROPIC_MODEL,
    local: env.LOCAL_LLM_MODEL
  };

  let seeded = 0;
  for (const policy of DEFAULT_POLICIES) {
    await upsertPolicy(pool, {
      taskType: policy.taskType,
      provider: policy.provider,
      modelId: modelByProvider[policy.provider],
      tier: policy.tier,
      priority: policy.priority
    });
    seeded++;
  }

  cachedPolicies = await listAllPolicies(pool);
  return seeded;
}

function mapRow(row: Record<string, unknown>): TaskModelPolicyEntry {
  return {
    id: String(row.id),
    taskType: String(row.task_type),
    provider: String(row.provider) as ProviderName,
    modelId: String(row.model_id),
    tier: Number(row.tier),
    priority: Number(row.priority),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
