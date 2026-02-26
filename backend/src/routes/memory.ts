import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';

const MemorySnapshotQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export async function memoryRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, providerRouter, resolveRequestUserId } = ctx;

  app.get('/api/v1/memory/snapshot', async (request, reply) => {
    const parsed = MemorySnapshotQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const [tasks, recommendations] = await Promise.all([
      store.listTasks({ limit: parsed.data.limit, status: undefined }),
      store.listRadarRecommendations(undefined)
    ]);
    const providers = providerRouter.listAvailability();
    const now = new Date().toISOString();

    const rows: Array<{
      id: string;
      category: 'fact' | 'rule' | 'preference';
      content: string;
      source: string;
      timestamp: string;
    }> = [];

    const modeCounts = new Map<string, number>();
    for (const task of tasks) {
      modeCounts.set(task.mode, (modeCounts.get(task.mode) ?? 0) + 1);
    }

    const topMode = [...modeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topMode) {
      rows.push({
        id: `pref_${topMode[0]}`,
        category: 'preference',
        content: `Recent workflow indicates a preference for '${topMode[0]}' tasks (${topMode[1]} recent tasks).`,
        source: 'Task telemetry',
        timestamp: tasks[0]?.updatedAt ?? now
      });
    }

    const failedCount = tasks.filter((t) => t.status === 'failed' || t.status === 'cancelled').length;
    if (failedCount > 0) {
      rows.push({
        id: 'rule_failures',
        category: 'rule',
        content: `${failedCount} task(s) recently failed/cancelled. Enforce retry and approval checks before high-risk execution.`,
        source: 'Task reliability policy',
        timestamp: now
      });
    }

    for (const rec of recommendations.slice(0, 4)) {
      rows.push({
        id: `fact_${rec.id}`,
        category: 'fact',
        content: `Radar recommendation: ${rec.decision.toUpperCase()} (${rec.totalScore.toFixed(2)}). Benefit=${rec.expectedBenefit}, Cost=${rec.migrationCost}, Risk=${rec.riskLevel}.`,
        source: 'Tech radar scoring',
        timestamp: rec.evaluatedAt
      });
    }

    for (const provider of providers.filter((item) => !item.enabled)) {
      rows.push({
        id: `rule_provider_${provider.provider}`,
        category: 'rule',
        content: `Provider '${provider.provider}' is disabled${provider.reason ? ` (${provider.reason})` : ''}. Avoid routing critical tasks to unavailable providers.`,
        source: 'Provider health',
        timestamp: now
      });
    }

    if (rows.length === 0) {
      rows.push({
        id: 'memory_empty',
        category: 'fact',
        content: 'No memory snapshot is available yet. Create tasks or evaluate radar items to populate memory.',
        source: 'System',
        timestamp: now
      });
    }

    return sendSuccess(reply, request, 200, {
      rows: rows.slice(0, parsed.data.limit),
      generated_at: now
    });
  });

  app.get('/api/v1/memory/search', async (request, reply) => {
    const querySchema = z.object({
      q: z.string().min(1).max(2000),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      min_confidence: z.coerce.number().min(0).max(1).default(0.3)
    });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const userId = resolveRequestUserId(request);
    const segments = await store.listMemorySegments({ userId, limit: parsed.data.limit });

    return sendSuccess(reply, request, 200, {
      segments: segments.map((s) => ({
        id: s.id,
        segment_type: s.segmentType,
        content: s.content,
        confidence: s.confidence,
        created_at: s.createdAt,
        similarity: s.similarity ?? null
      })),
      query: parsed.data.q,
      total: segments.length
    });
  });
}
