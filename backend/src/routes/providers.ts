import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import { fetchProviderModelCatalog } from '../providers/catalog';
import { getAllModels } from '../providers/model-registry';
import { listAllPolicies, upsertPolicy } from '../providers/task-model-policy';
import type { ProviderName } from '../providers/types';
import type { RouteContext } from './types';

function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '42P01';
}

export async function providerRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, env, providerRouter, loadRuntimeProviderApiKeys } = ctx;

  app.get('/api/v1/providers', async (request, reply) => {
    return sendSuccess(reply, request, 200, { providers: providerRouter.listAvailability() });
  });

  app.get('/api/v1/providers/models', async (request, reply) => {
    const runtimeKeys = await loadRuntimeProviderApiKeys();
    const catalog = await fetchProviderModelCatalog({
      ...env,
      OPENAI_API_KEY: runtimeKeys.openai ?? env.OPENAI_API_KEY,
      GEMINI_API_KEY: runtimeKeys.gemini ?? env.GEMINI_API_KEY,
      ANTHROPIC_API_KEY: runtimeKeys.anthropic ?? env.ANTHROPIC_API_KEY,
      LOCAL_LLM_API_KEY: runtimeKeys.local ?? env.LOCAL_LLM_API_KEY
    });
    return sendSuccess(reply, request, 200, { providers: catalog });
  });

  app.get('/api/v1/providers/registry', async (request, reply) => {
    const pool = store.getPool();
    if (!pool) {
      return sendSuccess(reply, request, 200, { models: [], source: 'memory_store' });
    }

    try {
      const models = await getAllModels(pool);
      return sendSuccess(reply, request, 200, { models });
    } catch (error) {
      if (isMissingTableError(error)) {
        request.log.warn({ err: error }, 'provider registry table missing, returning empty registry');
        return sendSuccess(reply, request, 200, { models: [], source: 'postgres_missing_schema' });
      }
      throw error;
    }
  });

  app.get('/api/v1/providers/policies', async (request, reply) => {
    const pool = store.getPool();
    if (!pool) {
      return sendSuccess(reply, request, 200, { policies: [], source: 'memory_store' });
    }

    try {
      const policies = await listAllPolicies(pool);
      return sendSuccess(reply, request, 200, { policies });
    } catch (error) {
      if (isMissingTableError(error)) {
        request.log.warn({ err: error }, 'task model policy table missing, returning empty policies');
        return sendSuccess(reply, request, 200, { policies: [], source: 'postgres_missing_schema' });
      }
      throw error;
    }
  });

  app.put('/api/v1/providers/policies', async (request, reply) => {
    const schema = z.object({
      task_type: z.string().min(1).max(60),
      provider: z.enum(['openai', 'gemini', 'anthropic', 'local']),
      model_id: z.string().min(1).max(160),
      tier: z.number().int().min(1).max(3).optional(),
      priority: z.number().int().min(-100).max(100).optional(),
      is_active: z.boolean().optional()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid policy payload', parsed.error.flatten());
    }

    const pool = store.getPool();
    if (!pool) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'policies require postgres store');
    }

    try {
      const policy = await upsertPolicy(pool, {
        taskType: parsed.data.task_type,
        provider: parsed.data.provider as ProviderName,
        modelId: parsed.data.model_id,
        tier: parsed.data.tier,
        priority: parsed.data.priority,
        isActive: parsed.data.is_active
      });

      return sendSuccess(reply, request, 200, policy);
    } catch (error) {
      if (isMissingTableError(error)) {
        return sendError(reply, request, 503, 'INTERNAL_ERROR', 'provider policy schema is not initialized');
      }
      throw error;
    }
  });
}
