import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getSharedPersonalGraph } from '../../kg/personal-graph';
import { sendError, sendSuccess } from '../../lib/http';
import type { V2RouteContext } from './types';

const IngestSchema = z.object({
  task_id: z.string().min(1).max(120),
  goal: z.string().min(1).max(2000),
  decision: z.string().min(1).max(2000),
  outcome: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(120)).max(100).optional()
});

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200)
});

const personalGraph = getSharedPersonalGraph();

export async function registerV2KgRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.post('/api/v2/kg/ingest', async (request, reply) => {
    const parsed = IngestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid kg ingest payload', parsed.error.flatten());
    }

    const userId = ctx.resolveRequestUserId(request);
    const result = personalGraph.ingestTaskOutcome({
      userId,
      taskId: parsed.data.task_id,
      goal: parsed.data.goal,
      decision: parsed.data.decision,
      outcome: parsed.data.outcome,
      tags: parsed.data.tags
    });

    return sendSuccess(reply, request, 200, result);
  });

  app.get('/api/v2/kg/personal', async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid kg query', parsed.error.flatten());
    }

    const userId = ctx.resolveRequestUserId(request);
    const graph = personalGraph.getGraph({
      userId,
      limit: parsed.data.limit
    });

    return sendSuccess(reply, request, 200, graph);
  });
}
