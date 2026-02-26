import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encryptSecretValue } from '../auth/secrets';
import { sendError, sendSuccess } from '../lib/http';
import { fetchProviderModelCatalog } from '../providers/catalog';
import type { RouteContext } from './types';
import { PROVIDER_NAME_VALUES } from './types';

const ProviderCredentialBodySchema = z.object({
  api_key: z.string().min(8).max(400)
});
const ProviderCredentialProviderSchema = z.enum(['openai', 'gemini', 'anthropic', 'local']);

export async function adminCredentialRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, env, providerRouter, ensureMinRole, resolveRequestUserId, getEnvProviderApiKey, loadRuntimeProviderApiKeys } = ctx;

  app.get('/api/v1/admin/providers/credentials', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'admin');
    if (roleError) return roleError;

    const rows = await store.listProviderCredentials();
    const rowMap = new Map(rows.map((row) => [row.provider, row]));
    const providers = PROVIDER_NAME_VALUES.map((provider) => {
      const stored = rowMap.get(provider);
      const envKey = getEnvProviderApiKey(provider);
      const hasEnv = typeof envKey === 'string' && envKey.trim().length > 0;
      const hasStored = Boolean(stored);
      return {
        provider,
        has_key: hasStored || hasEnv,
        source: hasStored ? 'stored' : hasEnv ? 'env' : 'none',
        updated_at: stored?.updatedAt ?? null
      };
    });

    return sendSuccess(reply, request, 200, { providers });
  });

  app.put('/api/v1/admin/providers/credentials/:provider', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'admin');
    if (roleError) return roleError;

    const provider = ProviderCredentialProviderSchema.safeParse((request.params as { provider: string }).provider);
    if (!provider.success) return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid provider');

    const body = ProviderCredentialBodySchema.safeParse(request.body);
    if (!body.success) return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid provider credential payload', body.error.flatten());

    const encrypted = encryptSecretValue(body.data.api_key.trim(), env.SECRETS_ENCRYPTION_KEY);
    const saved = await store.upsertProviderCredential({
      provider: provider.data,
      encryptedApiKey: encrypted,
      updatedBy: resolveRequestUserId(request)
    });

    providerRouter.setProviderApiKey(provider.data, body.data.api_key.trim());

    return sendSuccess(reply, request, 200, {
      provider: saved.provider,
      updated_at: saved.updatedAt,
      source: 'stored',
      has_key: true
    });
  });

  app.delete('/api/v1/admin/providers/credentials/:provider', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'admin');
    if (roleError) return roleError;

    const provider = ProviderCredentialProviderSchema.safeParse((request.params as { provider: string }).provider);
    if (!provider.success) return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid provider');

    const deleted = await store.deleteProviderCredential(provider.data);
    providerRouter.setProviderApiKey(provider.data, getEnvProviderApiKey(provider.data));

    return sendSuccess(reply, request, 200, {
      provider: provider.data,
      deleted,
      source: getEnvProviderApiKey(provider.data) ? 'env' : 'none',
      has_key: Boolean(getEnvProviderApiKey(provider.data))
    });
  });

  app.post('/api/v1/admin/providers/credentials/:provider/test', async (request, reply) => {
    const roleError = ensureMinRole(request, reply, 'admin');
    if (roleError) return roleError;

    const provider = ProviderCredentialProviderSchema.safeParse((request.params as { provider: string }).provider);
    if (!provider.success) return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid provider');

    const startedAt = Date.now();
    const runtimeKeys = await loadRuntimeProviderApiKeys();
    const storedKey = runtimeKeys[provider.data];
    const envKey = getEnvProviderApiKey(provider.data);
    const source: 'stored' | 'env' | 'none' = storedKey ? 'stored' : envKey ? 'env' : 'none';

    const availability = providerRouter.listAvailability().find((item) => item.provider === provider.data);
    if (!availability?.enabled) {
      return sendSuccess(reply, request, 200, {
        provider: provider.data,
        ok: false,
        source,
        availability: { enabled: false, reason: availability?.reason ?? 'provider_disabled' },
        catalog_source: 'configured',
        configured_model: availability?.model ?? '',
        model_count: 0,
        sampled_models: [] as string[],
        latency_ms: Date.now() - startedAt,
        reason: availability?.reason ?? 'provider_disabled'
      });
    }

    const catalog = await fetchProviderModelCatalog({
      ...env,
      OPENAI_API_KEY: runtimeKeys.openai ?? env.OPENAI_API_KEY,
      GEMINI_API_KEY: runtimeKeys.gemini ?? env.GEMINI_API_KEY,
      ANTHROPIC_API_KEY: runtimeKeys.anthropic ?? env.ANTHROPIC_API_KEY,
      LOCAL_LLM_API_KEY: runtimeKeys.local ?? env.LOCAL_LLM_API_KEY
    });
    const entry = catalog.find((item) => item.provider === provider.data);

    if (!entry) {
      return sendSuccess(reply, request, 200, {
        provider: provider.data,
        ok: false,
        source,
        availability: { enabled: true },
        catalog_source: 'configured',
        configured_model: availability.model ?? '',
        model_count: 0,
        sampled_models: [] as string[],
        latency_ms: Date.now() - startedAt,
        reason: 'provider catalog entry missing'
      });
    }

    const latencyMs = Date.now() - startedAt;
    return sendSuccess(reply, request, 200, {
      provider: provider.data,
      ok: !entry.error,
      source,
      availability: { enabled: true },
      catalog_source: entry.source,
      configured_model: entry.configured_model,
      model_count: entry.models.length,
      sampled_models: entry.models.slice(0, 5),
      latency_ms: latencyMs,
      reason: entry.error
    });
  });
}
