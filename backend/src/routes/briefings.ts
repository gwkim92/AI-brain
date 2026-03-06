import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { generateResearchArtifact, inferResearchStrictness } from '../jarvis/research';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';

const BriefingListSchema = z.object({
  type: z.enum(['daily', 'on_change', 'on_demand']).optional(),
  status: z.enum(['draft', 'completed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const BriefingGenerateSchema = z.object({
  query: z.string().min(1).max(4000),
  title: z.string().min(1).max(180).optional(),
  type: z.enum(['daily', 'on_change', 'on_demand']).default('on_demand')
});

export async function briefingRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, resolveRequestUserId } = ctx;

  app.get('/api/v1/briefings', async (request, reply) => {
    const parsed = BriefingListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid briefing query', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const briefings = await store.listBriefings({
      userId,
      type: parsed.data.type,
      status: parsed.data.status,
      limit: parsed.data.limit
    });
    return sendSuccess(reply, request, 200, { briefings });
  });

  app.post('/api/v1/briefings/generate', async (request, reply) => {
    const parsed = BriefingGenerateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid briefing payload', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    let artifact;
    try {
      artifact = await generateResearchArtifact(parsed.data.query, {
        strictness: parsed.data.type === 'on_change' || parsed.data.type === 'daily' ? 'news' : inferResearchStrictness(parsed.data.query)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'briefing quality gate failed';
      return sendError(reply, request, 409, 'CONFLICT', message);
    }
    const briefing = await store.createBriefing({
      userId,
      type: parsed.data.type,
      status: 'completed',
      title: parsed.data.title ?? artifact.title,
      query: parsed.data.query,
      summary: artifact.summary,
      answerMarkdown: artifact.answerMarkdown,
      sourceCount: artifact.sources.length,
      qualityJson: artifact.quality
    });
    return sendSuccess(reply, request, 201, briefing);
  });
}
