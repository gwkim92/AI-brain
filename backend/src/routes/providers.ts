import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { decryptSecretValue, encryptSecretValue } from '../auth/secrets';
import { sendError, sendSuccess } from '../lib/http';
import { withAiInvocationTrace } from '../observability/ai-trace';
import { fetchProviderModelCatalog } from '../providers/catalog';
import {
  parseUserProviderCredentialPayload,
  resolveEffectiveProviderCredentials,
  serializeUserProviderCredentialPayload
} from '../providers/credentials-resolver';
import { resolveModelSelection } from '../providers/model-selection';
import { getAllModels } from '../providers/model-registry';
import {
  buildProviderAuthorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  getProviderOauthCallbackOrigins,
  getProviderOauthConfig
} from '../providers/oauth';
import { maskErrorForApi } from '../providers/router';
import { listAllPolicies, upsertPolicy } from '../providers/task-model-policy';
import type { ProviderName } from '../providers/types';

import type { RouteContext } from './types';

const ProviderSchema = z.enum(['openai', 'gemini', 'anthropic', 'local']);
const OauthProviderSchema = z.enum(['openai', 'gemini']);
const ProviderModelsQuerySchema = z.object({
  scope: z.enum(['user', 'workspace']).default('user')
});

const UserProviderCredentialUpsertSchema = z
  .object({
    api_key: z.string().min(8).max(400).optional(),
    credential_priority: z.enum(['api_key_first', 'auth_first']).optional(),
    selected_credential_mode: z.enum(['auto', 'api_key', 'oauth_official']).optional(),
    is_active: z.boolean().optional()
  })
  .refine(
    (value) =>
      typeof value.api_key === 'string'
      || typeof value.credential_priority !== 'undefined'
      || typeof value.selected_credential_mode !== 'undefined'
      || typeof value.is_active !== 'undefined',
    {
      message: 'at least one field must be provided'
    }
  );

const UserProviderOauthStartSchema = z.object({});

const UserProviderOauthCompleteSchema = z.object({
  state: z.string().min(8).max(400),
  code: z.string().min(4).max(4000)
});

type UserCredentialView = {
  provider: ProviderName;
  source: 'user' | 'workspace' | 'env' | 'none';
  selected_credential_mode: 'api_key' | 'oauth_official' | null;
  credential_priority: 'api_key_first' | 'auth_first';
  auth_access_token_expires_at: string | null;
  has_user_credential: boolean;
  selected_user_credential_mode: 'auto' | 'api_key' | 'oauth_official';
  has_user_api_key: boolean;
  has_user_oauth_official: boolean;
  has_user_oauth_token: boolean;
  user_updated_at: string | null;
};

function normalizeModelIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function getOpenAiOauthModelCandidates(rawAllowlist: string, configuredModel: string): {
  models: string[];
  recommendedModel: string;
} {
  const allowlist = rawAllowlist.split(',').map((value) => value.trim()).filter(Boolean);
  const models = normalizeModelIds([
    ...allowlist,
    configuredModel
  ]);
  return {
    models,
    recommendedModel: allowlist[0] ?? configuredModel
  };
}

function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '42P01';
}

function safeParseUserPayload(encryptedPayload: string, secret: string) {
  try {
    const decrypted = decryptSecretValue(encryptedPayload, secret);
    return parseUserProviderCredentialPayload(decrypted);
  } catch {
    return null;
  }
}

function buildCredentialView(input: {
  provider: ProviderName;
  resolved: NonNullable<Awaited<ReturnType<typeof resolveEffectiveProviderCredentials>>['credentialsByProvider'][ProviderName]>;
  userSnapshot?: {
    record: {
      isActive: boolean;
      updatedAt: string;
    };
    payload: ReturnType<typeof parseUserProviderCredentialPayload>;
  };
}): UserCredentialView {
  const payload = input.userSnapshot?.payload;
  return {
    provider: input.provider,
    source: input.resolved.source,
    selected_credential_mode: input.resolved.selectedCredentialMode,
    credential_priority: input.resolved.credentialPriority,
    auth_access_token_expires_at:
      input.resolved.authAccessTokenExpiresAt
      ?? payload?.oauth_official?.access_token_expires_at
      ?? null,
    has_user_credential: Boolean(input.userSnapshot?.record.isActive),
    selected_user_credential_mode: payload?.selected_credential_mode ?? 'auto',
    has_user_api_key: Boolean(payload?.api_key),
    has_user_oauth_official: Boolean(payload?.oauth_official?.access_token),
    has_user_oauth_token: Boolean(payload?.oauth_official?.access_token),
    user_updated_at: input.userSnapshot?.record.updatedAt ?? null
  };
}

export async function providerRoutes(app: FastifyInstance, ctx: RouteContext) {
  const {
    store,
    env,
    providerRouter,
    loadRuntimeProviderApiKeys,
    ensureMinRole,
    resolveRequestUserId,
    resolveRequestTraceId,
    resolveRequestProviderCredentials
  } = ctx;

  app.get('/api/v1/providers', async (request, reply) => {
    const resolvedCredentials = await resolveRequestProviderCredentials(request);
    return sendSuccess(reply, request, 200, {
      providers: providerRouter.listAvailability(resolvedCredentials.credentialsByProvider)
    });
  });

  app.get('/api/v1/providers/models', async (request, reply) => {
    const parsedQuery = ProviderModelsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid providers/models query', parsedQuery.error.flatten());
    }

    let catalog;
    if (parsedQuery.data.scope === 'workspace') {
      const runtimeKeys = await loadRuntimeProviderApiKeys();
      catalog = await fetchProviderModelCatalog({
        ...env,
        OPENAI_API_KEY: runtimeKeys.openai ?? env.OPENAI_API_KEY,
        GEMINI_API_KEY: runtimeKeys.gemini ?? env.GEMINI_API_KEY,
        ANTHROPIC_API_KEY: runtimeKeys.anthropic ?? env.ANTHROPIC_API_KEY,
        LOCAL_LLM_API_KEY: runtimeKeys.local ?? env.LOCAL_LLM_API_KEY
      });
    } else {
      const resolution = await resolveRequestProviderCredentials(request);
      catalog = await fetchProviderModelCatalog({
        ...env,
        OPENAI_API_KEY:
          resolution.credentialsByProvider.openai?.selectedCredentialMode === 'api_key'
            ? resolution.credentialsByProvider.openai.apiKey
            : undefined,
        GEMINI_API_KEY:
          resolution.credentialsByProvider.gemini?.selectedCredentialMode === 'api_key'
            ? resolution.credentialsByProvider.gemini.apiKey
            : undefined,
        ANTHROPIC_API_KEY:
          resolution.credentialsByProvider.anthropic?.selectedCredentialMode === 'api_key'
            ? resolution.credentialsByProvider.anthropic.apiKey
            : undefined,
        LOCAL_LLM_API_KEY:
          resolution.credentialsByProvider.local?.selectedCredentialMode === 'api_key'
            ? resolution.credentialsByProvider.local.apiKey
            : env.LOCAL_LLM_API_KEY
      });

      const openaiResolved = resolution.credentialsByProvider.openai;
      const openaiUserOauthToken = resolution.userCredentials.openai?.payload?.oauth_official?.access_token;
      if (openaiResolved?.selectedCredentialMode === 'oauth_official' || openaiUserOauthToken) {
        const oauthCandidates = getOpenAiOauthModelCandidates(env.OPENAI_CODEX_MODEL_ALLOWLIST, env.OPENAI_MODEL);
        catalog = catalog.map((entry) => (
          entry.provider === 'openai'
            ? {
                ...entry,
                models: normalizeModelIds([...entry.models, ...oauthCandidates.models]),
                recommended_model: oauthCandidates.recommendedModel
              }
            : entry
        ));
      }
    }
    return sendSuccess(reply, request, 200, { providers: catalog });
  });

  app.get('/api/v1/providers/credentials', async (request, reply) => {
    if (!env.PROVIDER_USER_CREDENTIALS_ENABLED) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'user provider credentials feature is disabled');
    }

    const resolution = await resolveRequestProviderCredentials(request);
    const providers = (['openai', 'gemini', 'anthropic', 'local'] as const).map((provider) => {
      const resolved = resolution.credentialsByProvider[provider];
      if (!resolved) {
        return buildCredentialView({
          provider,
          resolved: {
            provider,
            source: 'none',
            selectedCredentialMode: null,
            credentialPriority: 'api_key_first',
            authAccessTokenExpiresAt: null
          }
        });
      }

      return buildCredentialView({
        provider,
        resolved,
        userSnapshot: resolution.userCredentials[provider]
      });
    });

    return sendSuccess(reply, request, 200, { providers });
  });

  app.get('/api/v1/providers/credentials/:provider', async (request, reply) => {
    if (!env.PROVIDER_USER_CREDENTIALS_ENABLED) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'user provider credentials feature is disabled');
    }

    const parsedProvider = ProviderSchema.safeParse((request.params as { provider: string }).provider);
    if (!parsedProvider.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid provider');
    }

    const resolution = await resolveRequestProviderCredentials(request);
    const provider = parsedProvider.data;
    const resolved = resolution.credentialsByProvider[provider] ?? {
      provider,
      source: 'none',
      selectedCredentialMode: null,
      credentialPriority: 'api_key_first',
      authAccessTokenExpiresAt: null
    };

    return sendSuccess(reply, request, 200, buildCredentialView({
      provider,
      resolved,
      userSnapshot: resolution.userCredentials[provider]
    }));
  });

  app.put('/api/v1/providers/credentials/:provider', async (request, reply) => {
    if (!env.PROVIDER_USER_CREDENTIALS_ENABLED) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'user provider credentials feature is disabled');
    }

    const parsedProvider = ProviderSchema.safeParse((request.params as { provider: string }).provider);
    if (!parsedProvider.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid provider');
    }

    const parsedBody = UserProviderCredentialUpsertSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid provider credential payload', parsedBody.error.flatten());
    }

    const provider = parsedProvider.data;
    const userId = resolveRequestUserId(request);
    const existing = await store.getUserProviderCredential({
      userId,
      provider,
      includeInactive: true
    });
    const existingPayload = existing
      ? safeParseUserPayload(existing.encryptedPayload, env.SECRETS_ENCRYPTION_KEY)
      : null;

    const nextPayload = {
      selected_credential_mode:
        parsedBody.data.selected_credential_mode
        ?? existingPayload?.selected_credential_mode
        ?? 'auto',
      credential_priority: parsedBody.data.credential_priority ?? existingPayload?.credential_priority ?? 'api_key_first',
      api_key: parsedBody.data.api_key?.trim() || existingPayload?.api_key,
      oauth_official: existingPayload?.oauth_official
    };

    const encryptedPayload = encryptSecretValue(
      serializeUserProviderCredentialPayload(nextPayload),
      env.SECRETS_ENCRYPTION_KEY
    );

    await store.upsertUserProviderCredential({
      userId,
      provider,
      encryptedPayload,
      isActive: parsedBody.data.is_active ?? existing?.isActive ?? true,
      updatedBy: userId
    });

    const resolution = await resolveEffectiveProviderCredentials({
      store,
      env,
      userId,
      updatedBy: userId
    });

    const resolved = resolution.credentialsByProvider[provider] ?? {
      provider,
      source: 'none',
      selectedCredentialMode: null,
      credentialPriority: nextPayload.credential_priority,
      authAccessTokenExpiresAt: null
    };

    return sendSuccess(reply, request, 200, buildCredentialView({
      provider,
      resolved,
      userSnapshot: resolution.userCredentials[provider]
    }));
  });

  app.delete('/api/v1/providers/credentials/:provider', async (request, reply) => {
    if (!env.PROVIDER_USER_CREDENTIALS_ENABLED) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'user provider credentials feature is disabled');
    }

    const parsedProvider = ProviderSchema.safeParse((request.params as { provider: string }).provider);
    if (!parsedProvider.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid provider');
    }

    const provider = parsedProvider.data;
    const userId = resolveRequestUserId(request);
    const deleted = await store.deleteUserProviderCredential({ userId, provider });

    const resolution = await resolveEffectiveProviderCredentials({
      store,
      env,
      userId,
      updatedBy: userId
    });

    const resolved = resolution.credentialsByProvider[provider] ?? {
      provider,
      source: 'none',
      selectedCredentialMode: null,
      credentialPriority: 'api_key_first',
      authAccessTokenExpiresAt: null
    };

    return sendSuccess(reply, request, 200, {
      ...buildCredentialView({
        provider,
        resolved,
        userSnapshot: resolution.userCredentials[provider]
      }),
      deleted
    });
  });

  app.post('/api/v1/providers/credentials/:provider/test', async (request, reply) => {
    if (!env.PROVIDER_USER_CREDENTIALS_ENABLED) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'user provider credentials feature is disabled');
    }

    const parsedProvider = ProviderSchema.safeParse((request.params as { provider: string }).provider);
    if (!parsedProvider.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid provider');
    }

    const provider = parsedProvider.data;
    const traceId = resolveRequestTraceId(request);
    const startedAt = Date.now();
    const userId = resolveRequestUserId(request);
    const resolution = await resolveRequestProviderCredentials(request);
    const resolved = resolution.credentialsByProvider[provider] ?? {
      provider,
      source: 'none',
      selectedCredentialMode: null,
      credentialPriority: 'api_key_first',
      authAccessTokenExpiresAt: null
    };

    const availability = providerRouter.listAvailability(resolution.credentialsByProvider)
      .find((item) => item.provider === provider);

    if (!availability?.enabled) {
      return sendSuccess(reply, request, 200, {
        provider,
        ok: false,
        source: resolved.source,
        selected_credential_mode: resolved.selectedCredentialMode,
        credential_priority: resolved.credentialPriority,
        auth_access_token_expires_at: resolved.authAccessTokenExpiresAt ?? null,
        latency_ms: Date.now() - startedAt,
        reason: availability?.reason ?? 'provider_disabled'
      });
    }

    let diagnosticModel: string | undefined;
    if (provider === 'openai' && resolved.selectedCredentialMode === 'oauth_official') {
      const modelSelection = await resolveModelSelection({
        store,
        userId,
        featureKey: 'assistant_chat'
      });
      if (modelSelection.provider === 'openai' || modelSelection.provider === 'auto') {
        diagnosticModel = modelSelection.model ?? undefined;
      }
      if (!diagnosticModel) {
        diagnosticModel = 'gpt-5';
      }
    }

    try {
      const routed = await withAiInvocationTrace({
        store,
        env,
        userId,
        featureKey: 'diagnostic',
        taskType: 'chat',
        requestProvider: provider,
        requestModel: diagnosticModel ?? null,
        traceId,
        contextRefs: {
          route: '/api/v1/providers/credentials/:provider/test'
        },
        run: () =>
          providerRouter.generate({
            prompt: 'connection test: return pong',
            provider,
            strictProvider: true,
            model: diagnosticModel,
            taskType: 'chat',
            maxOutputTokens: 32,
            temperature: 0,
            credentialsByProvider: resolution.credentialsByProvider,
            traceId
          })
      });

      return sendSuccess(reply, request, 200, {
        provider,
        ok: true,
        source: resolved.source,
        selected_credential_mode: resolved.selectedCredentialMode,
        credential_priority: resolved.credentialPriority,
        auth_access_token_expires_at: resolved.authAccessTokenExpiresAt ?? null,
        model: routed.result.model,
        latency_ms: Date.now() - startedAt
      });
    } catch (error) {
      return sendSuccess(reply, request, 200, {
        provider,
        ok: false,
        source: resolved.source,
        selected_credential_mode: resolved.selectedCredentialMode,
        credential_priority: resolved.credentialPriority,
        auth_access_token_expires_at: resolved.authAccessTokenExpiresAt ?? null,
        latency_ms: Date.now() - startedAt,
        reason: maskErrorForApi(error)
      });
    }
  });

  app.post('/api/v1/providers/credentials/:provider/auth/start', async (request, reply) => {
    if (!env.PROVIDER_USER_CREDENTIALS_ENABLED) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'user provider credentials feature is disabled');
    }

    const parsedProvider = OauthProviderSchema.safeParse((request.params as { provider: string }).provider);
    if (!parsedProvider.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'oauth is supported only for openai/gemini');
    }

    const parsedBody = UserProviderOauthStartSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid oauth start payload', parsedBody.error.flatten());
    }

    const provider = parsedProvider.data;
    const requesterUserId = resolveRequestUserId(request);

    const config = getProviderOauthConfig(env, provider);
    if (!config) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'oauth provider is not configured or disabled');
    }

    const { codeVerifier, codeChallenge } = createPkcePair();
    const state = randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const userId = requesterUserId;
    const encryptedContext = encryptSecretValue(
      JSON.stringify({ code_verifier: codeVerifier, created_at: new Date().toISOString() }),
      env.SECRETS_ENCRYPTION_KEY
    );

    await store.createProviderOauthState({
      state,
      userId,
      provider,
      encryptedContext,
      expiresAt
    });

    void store.cleanupExpiredProviderOauthStates({ limit: 200 }).catch(() => undefined);

    request.log.info({ provider, user_id: userId, trace_id: resolveRequestTraceId(request) }, 'provider oauth start span');

    return sendSuccess(reply, request, 200, {
      provider,
      auth_url: buildProviderAuthorizationUrl({
        config,
        state,
        codeChallenge
      }),
      state,
      expires_at: expiresAt,
      callback_origins: getProviderOauthCallbackOrigins(config)
    });
  });

  app.post('/api/v1/providers/credentials/:provider/auth/complete', async (request, reply) => {
    if (!env.PROVIDER_USER_CREDENTIALS_ENABLED) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'user provider credentials feature is disabled');
    }

    const parsedProvider = OauthProviderSchema.safeParse((request.params as { provider: string }).provider);
    if (!parsedProvider.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'oauth is supported only for openai/gemini');
    }

    const parsedBody = UserProviderOauthCompleteSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid oauth complete payload', parsedBody.error.flatten());
    }

    const provider = parsedProvider.data;

    const consumed = await store.consumeProviderOauthState({
      state: parsedBody.data.state,
      provider
    });
    if (!consumed) {
      return sendError(reply, request, 400, 'VALIDATION_ERROR', 'invalid or expired oauth state');
    }

    const requesterUserId = resolveRequestUserId(request);
    if (consumed.userId !== requesterUserId) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'oauth state does not belong to requester');
    }

    const stateContextRaw = decryptSecretValue(consumed.encryptedContext, env.SECRETS_ENCRYPTION_KEY);
    const stateContext = JSON.parse(stateContextRaw) as {
      code_verifier?: string;
    };
    const codeVerifier = typeof stateContext.code_verifier === 'string' ? stateContext.code_verifier : null;
    if (!codeVerifier) {
      return sendError(reply, request, 400, 'VALIDATION_ERROR', 'oauth state context is invalid');
    }

    const config = getProviderOauthConfig(env, provider);
    if (!config) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'oauth provider is not configured or disabled');
    }

    request.log.info({ provider, user_id: requesterUserId, trace_id: resolveRequestTraceId(request) }, 'provider oauth complete span start');

    const tokenSet = await exchangeAuthorizationCode({
      config,
      code: parsedBody.data.code,
      codeVerifier,
      onRetry: (retry) => {
        request.log.warn(
          {
            provider,
            user_id: requesterUserId,
            attempt: retry.attempt,
            max_attempts: retry.maxAttempts,
            delay_ms: retry.delayMs,
            reason: retry.reason
          },
          'provider oauth token exchange retry'
        );
      }
    });

    const existing = await store.getUserProviderCredential({
      userId: requesterUserId,
      provider,
      includeInactive: true
    });
    const existingPayload = existing
      ? safeParseUserPayload(existing.encryptedPayload, env.SECRETS_ENCRYPTION_KEY)
      : null;

    const nextPayload = {
      selected_credential_mode:
        existingPayload?.selected_credential_mode && existingPayload.selected_credential_mode !== 'auto'
          ? existingPayload.selected_credential_mode
          : 'oauth_official',
      credential_priority: existingPayload?.credential_priority ?? 'auth_first',
      api_key: existingPayload?.api_key,
      oauth_official: {
        access_token: tokenSet.accessToken,
        refresh_token: tokenSet.refreshToken ?? existingPayload?.oauth_official?.refresh_token,
        access_token_expires_at: tokenSet.accessTokenExpiresAt,
        token_type: tokenSet.tokenType,
        scope: tokenSet.scope
      }
    };

    const encryptedPayload = encryptSecretValue(
      serializeUserProviderCredentialPayload(nextPayload),
      env.SECRETS_ENCRYPTION_KEY
    );

    await store.upsertUserProviderCredential({
      userId: requesterUserId,
      provider,
      encryptedPayload,
      isActive: true,
      updatedBy: requesterUserId
    });

    void store.cleanupExpiredProviderOauthStates({ limit: 200 }).catch(() => undefined);

    const resolution = await resolveEffectiveProviderCredentials({
      store,
      env,
      userId: requesterUserId,
      updatedBy: requesterUserId
    });

    const resolved = resolution.credentialsByProvider[provider] ?? {
      provider,
      source: 'none',
      selectedCredentialMode: null,
      credentialPriority: 'auth_first',
      authAccessTokenExpiresAt: null
    };

    request.log.info({ provider, user_id: requesterUserId, trace_id: resolveRequestTraceId(request) }, 'provider oauth complete span success');

    return sendSuccess(reply, request, 200, buildCredentialView({
      provider,
      resolved,
      userSnapshot: resolution.userCredentials[provider]
    }));
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
    const roleError = ensureMinRole(request, reply, 'admin');
    if (roleError) return roleError;

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
