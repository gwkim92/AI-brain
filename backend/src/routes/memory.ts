import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveJarvisMemoryContext } from '../jarvis/memory-context';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';

const MemoryNoteKindSchema = z.enum(['user_preference', 'project_context', 'decision_memory', 'research_memory']);

const MemorySnapshotQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const MemorySummaryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8)
});

const MemoryContextQuerySchema = z.object({
  q: z.string().trim().min(1).max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(6),
  kind: MemoryNoteKindSchema.optional()
});

const MemoryNoteCreateSchema = z.object({
  kind: MemoryNoteKindSchema,
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(4000),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional().default([]),
  pinned: z.boolean().optional().default(false),
  source: z.enum(['manual', 'session', 'system']).optional().default('manual'),
  related_session_id: z.string().uuid().optional(),
  related_task_id: z.string().uuid().optional(),
  key: z.string().trim().min(1).max(80).optional(),
  value: z.string().trim().min(1).max(2000).optional(),
  attributes: z.record(z.string(), z.unknown()).optional().default({})
});

const MemoryNoteUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    content: z.string().trim().min(1).max(4000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    pinned: z.boolean().optional(),
    key: z.string().trim().min(1).max(80).optional(),
    value: z.string().trim().min(1).max(2000).optional(),
    attributes: z.record(z.string(), z.unknown()).optional()
  })
  .refine(
    (value) =>
      typeof value.title !== 'undefined' ||
      typeof value.content !== 'undefined' ||
      typeof value.tags !== 'undefined' ||
      typeof value.pinned !== 'undefined' ||
      typeof value.key !== 'undefined' ||
      typeof value.value !== 'undefined' ||
      typeof value.attributes !== 'undefined',
    {
      message: 'at least one field is required'
    }
  );

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreMemoryNote(queryTokens: string[], note: { title: string; content: string; tags: string[]; pinned: boolean; updatedAt: string }): number {
  const tokens = new Set([...tokenize(note.title), ...tokenize(note.content), ...note.tags.map((tag) => tag.toLowerCase())]);
  const overlaps = queryTokens.filter((token) => tokens.has(token)).length;
  const pinnedBoost = note.pinned ? 8 : 0;
  const recentBoost = Math.max(0, 2 - Math.floor((Date.now() - Date.parse(note.updatedAt)) / 86_400_000));
  return overlaps * 5 + pinnedBoost + recentBoost;
}

export async function memoryRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, providerRouter, resolveRequestUserId } = ctx;

  app.get('/api/v1/memory/summary', async (request, reply) => {
    const parsed = MemorySummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const userId = resolveRequestUserId(request);
    const notes = await store.listMemoryNotes({ userId, limit: Math.max(parsed.data.limit, 30) });
    const counts = {
      total: notes.length,
      pinned: notes.filter((note) => note.pinned).length,
      user_preference: notes.filter((note) => note.kind === 'user_preference').length,
      project_context: notes.filter((note) => note.kind === 'project_context').length,
      decision_memory: notes.filter((note) => note.kind === 'decision_memory').length,
      research_memory: notes.filter((note) => note.kind === 'research_memory').length
    };

    return sendSuccess(reply, request, 200, {
      counts,
      pinned_notes: notes.filter((note) => note.pinned).slice(0, parsed.data.limit),
      recent_notes: notes.slice(0, parsed.data.limit)
    });
  });

  app.get('/api/v1/memory/snapshot', async (request, reply) => {
    const parsed = MemorySnapshotQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const userId = resolveRequestUserId(request);
    const [tasks, recommendations] = await Promise.all([
      store.listTasks({ userId, limit: parsed.data.limit, status: undefined }),
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

  app.get('/api/v1/memory/context', async (request, reply) => {
    const parsed = MemoryContextQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const query = parsed.data.q?.trim() ?? '';
    const notes = await store.listMemoryNotes({
      userId,
      kind: parsed.data.kind,
      limit: 80
    });
    const ranked =
      query.length > 0
        ? notes
            .map((note) => ({ note, score: scoreMemoryNote(tokenize(query), note) }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score || Date.parse(right.note.updatedAt) - Date.parse(left.note.updatedAt))
            .slice(0, parsed.data.limit)
            .map((entry) => entry.note)
        : notes.slice(0, parsed.data.limit);
    const context = await resolveJarvisMemoryContext(store, {
      userId,
      prompt: query,
      limit: parsed.data.limit
    });

    return sendSuccess(reply, request, 200, {
      query,
      notes: ranked,
      total: ranked.length,
      structured_notes: context?.structuredNotes ?? [],
      preferences: context?.preferences ?? null,
      project_context: context?.projectContext ?? null,
      recent_decision_signals: context?.recentDecisionSignals ?? null
    });
  });

  app.post('/api/v1/memory/notes', async (request, reply) => {
    const parsed = MemoryNoteCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid memory note payload', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const note = await store.createMemoryNote({
      userId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      content: parsed.data.content,
      tags: parsed.data.tags,
      pinned: parsed.data.pinned,
      source: parsed.data.source,
      key: parsed.data.key,
      value: parsed.data.value,
      attributes: parsed.data.attributes,
      relatedSessionId: parsed.data.related_session_id ?? null,
      relatedTaskId: parsed.data.related_task_id ?? null
    });
    return sendSuccess(reply, request, 201, note);
  });

  app.patch('/api/v1/memory/notes/:noteId', async (request, reply) => {
    const parsed = MemoryNoteUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid memory note update payload', parsed.error.flatten());
    }
    const { noteId } = request.params as { noteId: string };
    const userId = resolveRequestUserId(request);
    const note = await store.updateMemoryNote({
      noteId,
      userId,
      title: parsed.data.title,
      content: parsed.data.content,
      tags: parsed.data.tags,
      pinned: parsed.data.pinned,
      key: parsed.data.key,
      value: parsed.data.value,
      attributes: parsed.data.attributes
    });
    if (!note) return sendError(reply, request, 404, 'NOT_FOUND', 'memory note not found');
    return sendSuccess(reply, request, 200, note);
  });

  app.delete('/api/v1/memory/notes/:noteId', async (request, reply) => {
    const { noteId } = request.params as { noteId: string };
    const userId = resolveRequestUserId(request);
    const deleted = await store.deleteMemoryNote({ noteId, userId });
    if (!deleted) return sendError(reply, request, 404, 'NOT_FOUND', 'memory note not found');
    return sendSuccess(reply, request, 200, { deleted: true });
  });

  app.get('/api/v1/memory/recent-decisions', async (request, reply) => {
    const parsed = MemorySummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const notes = await store.listMemoryNotes({
      userId,
      kind: 'decision_memory',
      limit: parsed.data.limit
    });
    return sendSuccess(reply, request, 200, {
      notes,
      total: notes.length
    });
  });
}
