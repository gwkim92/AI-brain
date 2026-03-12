import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { generateResearchArtifact, inferResearchStrictness } from '../jarvis/research';
import { sendError, sendSuccess } from '../lib/http';
import { buildDossierWorldModel } from '../world-model/dossier';
import { recordWorldModelProjectionOutcomes } from '../world-model/outcomes';
import { persistWorldModelProjection } from '../world-model/persistence';
import type { RouteContext } from './types';

const DossierListSchema = z.object({
  status: z.enum(['draft', 'ready', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const DossierRefreshSchema = z.object({
  query: z.string().min(1).max(4000).optional(),
  title: z.string().min(1).max(180).optional()
});

export async function dossierRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, resolveRequestUserId } = ctx;

  app.get('/api/v1/dossiers', async (request, reply) => {
    const parsed = DossierListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid dossier query', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const dossiers = await store.listDossiers({
      userId,
      status: parsed.data.status,
      limit: parsed.data.limit
    });
    return sendSuccess(reply, request, 200, { dossiers });
  });

  app.get('/api/v1/dossiers/:dossierId', async (request, reply) => {
    const { dossierId } = request.params as { dossierId: string };
    const userId = resolveRequestUserId(request);
    const dossier = await store.getDossierById({ userId, dossierId });
    if (!dossier) return sendError(reply, request, 404, 'NOT_FOUND', 'dossier not found');
    const [sources, claims] = await Promise.all([
      store.listDossierSources({ userId, dossierId, limit: 100 }),
      store.listDossierClaims({ userId, dossierId, limit: 100 })
    ]);
    const worldModel = buildDossierWorldModel({
      dossier,
      sources,
      claims,
    });
    return sendSuccess(reply, request, 200, { dossier, sources, claims, world_model: worldModel });
  });

  app.post('/api/v1/dossiers/:dossierId/refresh', async (request, reply) => {
    const parsed = DossierRefreshSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid dossier refresh payload', parsed.error.flatten());
    }
    const { dossierId } = request.params as { dossierId: string };
    const userId = resolveRequestUserId(request);
    const dossier = await store.getDossierById({ userId, dossierId });
    if (!dossier) return sendError(reply, request, 404, 'NOT_FOUND', 'dossier not found');
    const query = parsed.data.query ?? dossier.query;
    let artifact;
    try {
      artifact = await generateResearchArtifact(query, {
        strictness: inferResearchStrictness(query)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'dossier quality gate failed';
      return sendError(reply, request, 409, 'CONFLICT', message);
    }
    const updated = await store.updateDossier({
      dossierId,
      userId,
      title: parsed.data.title ?? artifact.title,
      query,
      status: 'ready',
      summary: artifact.summary,
      answerMarkdown: artifact.answerMarkdown,
      qualityJson: artifact.quality,
      conflictsJson: artifact.conflicts
    });
    if (!updated) return sendError(reply, request, 404, 'NOT_FOUND', 'dossier not found');
    await store.replaceDossierSources({ userId, dossierId, sources: artifact.sources });
    await store.replaceDossierClaims({ userId, dossierId, claims: artifact.claims });
    await recordWorldModelProjectionOutcomes({
      store,
      userId,
      dossierId,
      extraction: artifact.worldModelExtraction,
      evaluatedAt: updated.updatedAt,
      now: updated.updatedAt,
    });
    await persistWorldModelProjection({
      store,
      userId,
      dossierId,
      briefingId: updated.briefingId,
      extraction: artifact.worldModelExtraction,
      origin: 'dossier_refresh',
      snapshotTarget: {
        targetType: 'dossier',
        targetId: dossierId,
      },
    });
    const sources = await store.listDossierSources({ userId, dossierId, limit: 100 });
    const claims = await store.listDossierClaims({ userId, dossierId, limit: 100 });
    const worldModel = buildDossierWorldModel({
      dossier: updated,
      sources,
      claims,
    });
    return sendSuccess(reply, request, 200, { ...updated, world_model: worldModel });
  });

  app.post('/api/v1/dossiers/:dossierId/export', async (request, reply) => {
    const { dossierId } = request.params as { dossierId: string };
    const userId = resolveRequestUserId(request);
    const dossier = await store.getDossierById({ userId, dossierId });
    if (!dossier) return sendError(reply, request, 404, 'NOT_FOUND', 'dossier not found');
    const sources = await store.listDossierSources({ userId, dossierId, limit: 100 });
    const markdown = [
      `# ${dossier.title}`,
      '',
      dossier.answerMarkdown,
      '',
      '## Sources',
      ...sources.map((source, index) => `${index + 1}. [${source.title}](${source.url}) - ${source.domain}`)
    ].join('\n');
    return sendSuccess(reply, request, 200, {
      dossier_id: dossierId,
      title: dossier.title,
      format: 'markdown',
      content: markdown
    });
  });
}
