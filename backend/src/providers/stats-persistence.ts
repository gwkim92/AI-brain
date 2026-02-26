import type { Pool } from 'pg';

export type ProviderStatEntry = {
  provider: string;
  taskType: string;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  successEma: number;
  latencyEma: number;
};

export async function loadProviderStats(pool: Pool): Promise<ProviderStatEntry[]> {
  try {
    const { rows } = await pool.query(
      `SELECT provider, task_type, success_count, failure_count,
              avg_latency_ms, success_ema, latency_ema
       FROM provider_stats`
    );
    return rows.map((row: Record<string, unknown>) => ({
      provider: String(row.provider),
      taskType: String(row.task_type),
      successCount: Number(row.success_count),
      failureCount: Number(row.failure_count),
      avgLatencyMs: Number(row.avg_latency_ms),
      successEma: Number(row.success_ema ?? 0.5),
      latencyEma: Number(row.latency_ema ?? 0)
    }));
  } catch {
    return [];
  }
}

export async function flushProviderStats(pool: Pool, entries: ProviderStatEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const entry of entries) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`);
    values.push(
      entry.provider,
      entry.taskType,
      entry.successCount,
      entry.failureCount,
      entry.avgLatencyMs,
      entry.successEma,
      entry.latencyEma
    );
    idx += 7;
  }

  await pool.query(
    `
      INSERT INTO provider_stats (provider, task_type, success_count, failure_count, avg_latency_ms, success_ema, latency_ema, last_updated_at)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (provider, task_type)
      DO UPDATE SET
        success_count = EXCLUDED.success_count,
        failure_count = EXCLUDED.failure_count,
        avg_latency_ms = EXCLUDED.avg_latency_ms,
        success_ema = EXCLUDED.success_ema,
        latency_ema = EXCLUDED.latency_ema,
        last_updated_at = now()
    `,
    values
  );
}

export function createStatsFlushInterval(
  pool: Pool,
  getStats: () => ProviderStatEntry[],
  intervalMs = 30000
): { stop: () => void } {
  const timer = setInterval(() => {
    const stats = getStats();
    if (stats.length > 0) {
      void flushProviderStats(pool, stats).catch(() => undefined);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer)
  };
}
