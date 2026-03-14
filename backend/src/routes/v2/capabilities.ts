import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { validateCapabilityGraph, type CapabilityGraphValidationIssue } from '../../capabilities/graph-validator';
import { ModuleManifestSchema } from '../../capabilities/manifest';
import { CapabilityRegistry } from '../../capabilities/registry';
import { sendError, sendSuccess } from '../../lib/http';
import { getSharedMemoryV2Repository } from '../../store/memory/v2-repositories';
import { createPostgresV2Repository } from '../../store/postgres/v2-repositories';
import type { V2RouteContext } from './types';

const GraphNodeSchema = z.object({
  module_id: z.string().min(1).max(120),
  module_version: z.string().min(1).max(40)
});

const GraphValidateSchema = z.object({
  nodes: z.array(GraphNodeSchema).min(1).max(200),
  edges: z
    .array(
      z.object({
        from: GraphNodeSchema,
        to: GraphNodeSchema
      })
    )
    .max(400)
    .default([])
});

const ParamsSchema = z.object({
  moduleId: z.string().min(1).max(120)
});

const memoryV2Repo = getSharedMemoryV2Repository();

function buildRegistry(ctx: V2RouteContext): CapabilityRegistry {
  const pool = ctx.store.getPool();
  const repo = pool ? createPostgresV2Repository(pool) : memoryV2Repo;
  return new CapabilityRegistry(repo);
}

export async function registerV2CapabilityRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.post('/api/v2/capabilities/modules/register', async (request, reply) => {
    const parsed = ModuleManifestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid module manifest payload', parsed.error.flatten());
    }

    const registry = buildRegistry(ctx);
    const manifest = await registry.registerModule(parsed.data);
    return sendSuccess(reply, request, 200, { module: manifest });
  });

  app.get('/api/v2/capabilities/modules', async (request, reply) => {
    const registry = buildRegistry(ctx);
    const modules = await registry.listModules();
    return sendSuccess(reply, request, 200, { modules });
  });

  app.get('/api/v2/capabilities/modules/:moduleId/versions', async (request, reply) => {
    const parsedParams = ParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid module id', parsedParams.error.flatten());
    }

    const registry = buildRegistry(ctx);
    const versions = await registry.listModuleVersions(parsedParams.data.moduleId);
    return sendSuccess(reply, request, 200, { module_id: parsedParams.data.moduleId, versions });
  });

  app.post('/api/v2/capabilities/graph/validate', async (request, reply) => {
    const parsed = GraphValidateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid graph validation payload', parsed.error.flatten());
    }

    const registry = buildRegistry(ctx);
    const uniqueNodes = Array.from(
      new Map(parsed.data.nodes.map((node) => [`${node.module_id}@${node.module_version}`, node])).values()
    );

    const resolvedManifests = await Promise.all(
      uniqueNodes.map(async (node) => {
        const manifest = await registry.resolveManifest(node.module_id, node.module_version);
        return { node, manifest };
      })
    );

    const missingIssues: CapabilityGraphValidationIssue[] = resolvedManifests
      .filter((item) => !item.manifest)
      .map((item) => ({
        code: 'module_not_found',
        message: `Module not registered: ${item.node.module_id}@${item.node.module_version}`,
        module_id: item.node.module_id,
        module_version: item.node.module_version
      }));

    const graphResult = validateCapabilityGraph({
      manifests: resolvedManifests.flatMap((item) => (item.manifest ? [item.manifest] : [])),
      edges: parsed.data.edges
    });

    return sendSuccess(reply, request, 200, {
      valid: graphResult.valid && missingIssues.length === 0,
      errors: [...missingIssues, ...graphResult.errors],
      warnings: graphResult.warnings
    });
  });
}
