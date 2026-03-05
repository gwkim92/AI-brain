import type { Pool } from 'pg';

export type ProviderHealthEntry = {
  provider: string;
  cooldownUntil: string | null;
  reasonCode: string | null;
  failureCount: number;
  updatedAt: string | null;
};

export async function loadProviderRoutingHealth(pool: Pool): Promise<ProviderHealthEntry[]> {
  try {
    const { rows } = await pool.query<{
      provider: string;
      cooldown_until: Date | null;
      reason_code: string | null;
      failure_count: number;
      updated_at: Date;
    }>(
      `SELECT provider, cooldown_until, reason_code, failure_count, updated_at
       FROM provider_routing_health`
    );
    return rows.map((row) => ({
      provider: row.provider,
      cooldownUntil: row.cooldown_until ? row.cooldown_until.toISOString() : null,
      reasonCode: row.reason_code,
      failureCount: Number(row.failure_count ?? 0),
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null
    }));
  } catch {
    return [];
  }
}

export async function flushProviderRoutingHealth(pool: Pool, entries: ProviderHealthEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const entry of entries) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
    values.push(entry.provider, entry.cooldownUntil, entry.reasonCode, Math.max(0, Math.trunc(entry.failureCount)));
    idx += 4;
  }

  await pool.query(
    `
      INSERT INTO provider_routing_health (provider, cooldown_until, reason_code, failure_count, updated_at)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (provider)
      DO UPDATE SET
        cooldown_until = EXCLUDED.cooldown_until,
        reason_code = EXCLUDED.reason_code,
        failure_count = EXCLUDED.failure_count,
        updated_at = now()
    `,
    values
  );
}

export function createProviderHealthFlushInterval(
  pool: Pool,
  getHealth: () => ProviderHealthEntry[],
  intervalMs = 30000
): { stop: () => void } {
  const timer = setInterval(() => {
    const health = getHealth();
    if (health.length > 0) {
      void flushProviderRoutingHealth(pool, health).catch(() => undefined);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer)
  };
}

