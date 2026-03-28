import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { sendError, sendSuccess } from '../lib/http';
import { recommendModelForPrompt } from '../providers/model-recommender';
import type { ModelControlFeatureKey } from '../store/types';

import type { RouteContext } from './types';

const FEATURE_KEYS = [
  'global_default',
  'assistant_chat',
  'assistant_context_run',
  'council_run',
  'execution_code',
  'execution_compute',
  'mission_plan_generation',
  'mission_execute_step'
] as const satisfies readonly ModelControlFeatureKey[];

const FeatureKeySchema = z.enum(FEATURE_KEYS);

const PreferenceUpsertSchema = z.object({
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).default('auto'),
  model: z.string().max(200).optional(),
  strict_provider: z.boolean().default(false),
  selection_mode: z.enum(['auto', 'manual']).default('manual')
});

const RecommendationCreateSchema = z.object({
  feature_key: FeatureKeySchema,
  prompt: z.string().min(1).max(16000),
  task_type: z.string().min(1).max(60).optional()
});

const RecommendationListQuerySchema = z.object({
  feature_key: FeatureKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const TraceListQuerySchema = z.object({
  feature_key: z.union([FeatureKeySchema, z.literal('diagnostic')]).optional(),
  success: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return undefined;
    }),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

const MetricsQuerySchema = z.object({
  since: z.string().datetime().optional()
});

export async function modelControlRoutes(app: FastifyInstance, ctx: RouteContext) {
  const {
    env,
    store,
    providerRouter,
    resolveRequestUserId,
    resolveRequestProviderCredentials,
    resolveRequestTraceId
  } = ctx;

  const ensureEnabled = (request: FastifyRequest, reply: FastifyReply) => {
    if (!env.MODEL_CONTROL_ENABLED) {
      return sendError(reply, request, 403, 'FORBIDDEN', 'model control feature is disabled');
    }
    return null;
  };

  app.get('/api/v1/model-control/preferences', async (request, reply) => {
    const disabled = ensureEnabled(request, reply);
    if (disabled) return disabled;
    const userId = resolveRequestUserId(request);
    const preferences = await store.listUserModelSelectionPreferences({ userId });
    return sendSuccess(reply, request, 200, { preferences });
  });

  app.put('/api/v1/model-control/preferences/:feature', async (request, reply) => {
    const disabled = ensureEnabled(request, reply);
    if (disabled) return disabled;
    const parsedFeature = FeatureKeySchema.safeParse((request.params as { feature: string }).feature);
    if (!parsedFeature.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid feature key');
    }
    const parsedBody = PreferenceUpsertSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid model preference payload', parsedBody.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const model = parsedBody.data.model?.trim();
    const isOrchestratorAuto = parsedBody.data.selection_mode === 'auto';
    const preference = await store.upsertUserModelSelectionPreference({
      userId,
      featureKey: parsedFeature.data,
      provider: isOrchestratorAuto ? 'auto' : parsedBody.data.provider,
      modelId: isOrchestratorAuto ? null : (model && model.length > 0 ? model : null),
      strictProvider: isOrchestratorAuto || parsedBody.data.provider === 'auto' ? false : parsedBody.data.strict_provider,
      selectionMode: parsedBody.data.selection_mode,
      updatedBy: userId
    });
    return sendSuccess(reply, request, 200, preference);
  });

  app.post('/api/v1/model-control/recommendations', async (request, reply) => {
    const disabled = ensureEnabled(request, reply);
    if (disabled) return disabled;
    const parsedBody = RecommendationCreateSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid recommendation payload', parsedBody.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const resolvedCredentials = await resolveRequestProviderCredentials(request);
    const draft = await recommendModelForPrompt({
      env,
      providerRouter,
      featureKey: parsedBody.data.feature_key,
      taskType: parsedBody.data.task_type ?? parsedBody.data.feature_key,
      prompt: parsedBody.data.prompt,
      credentialsByProvider: resolvedCredentials.credentialsByProvider,
      traceId: resolveRequestTraceId(request)
    });
    const row = await store.createModelRecommendationRun({
      userId,
      featureKey: parsedBody.data.feature_key,
      promptHash: draft.promptHash,
      promptExcerptRedacted: draft.promptExcerptRedacted,
      recommendedProvider: draft.recommendedProvider,
      recommendedModelId: draft.recommendedModelId,
      rationaleText: draft.rationaleText,
      evidenceJson: draft.evidenceJson,
      recommenderProvider: draft.recommenderProvider
    });
    return sendSuccess(reply, request, 201, row);
  });

  app.get('/api/v1/model-control/recommendations', async (request, reply) => {
    const disabled = ensureEnabled(request, reply);
    if (disabled) return disabled;
    const parsedQuery = RecommendationListQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid recommendations query', parsedQuery.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const rows = await store.listModelRecommendationRuns({
      userId,
      featureKey: parsedQuery.data.feature_key,
      limit: parsedQuery.data.limit
    });
    return sendSuccess(reply, request, 200, { recommendations: rows });
  });

  app.post('/api/v1/model-control/recommendations/:id/apply', async (request, reply) => {
    const disabled = ensureEnabled(request, reply);
    if (disabled) return disabled;
    const recommendationId = (request.params as { id: string }).id;
    const userId = resolveRequestUserId(request);
    const recommendation = await store.markModelRecommendationApplied({
      recommendationId,
      userId
    });
    if (!recommendation) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'recommendation not found');
    }
    const preference = await store.upsertUserModelSelectionPreference({
      userId,
      featureKey: recommendation.featureKey,
      provider: recommendation.recommendedProvider,
      modelId: recommendation.recommendedModelId,
      strictProvider: true,
      selectionMode: 'manual',
      updatedBy: userId
    });
    return sendSuccess(reply, request, 200, {
      recommendation,
      preference
    });
  });

  app.get('/api/v1/model-control/traces', async (request, reply) => {
    const disabled = ensureEnabled(request, reply);
    if (disabled) return disabled;
    const parsedQuery = TraceListQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid traces query', parsedQuery.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const rows = await store.listAiInvocationTraces({
      userId,
      featureKey: parsedQuery.data.feature_key,
      success: parsedQuery.data.success,
      limit: parsedQuery.data.limit
    });
    return sendSuccess(reply, request, 200, { traces: rows });
  });

  app.get('/api/v1/model-control/metrics', async (request, reply) => {
    const disabled = ensureEnabled(request, reply);
    if (disabled) return disabled;
    const parsedQuery = MetricsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid metrics query', parsedQuery.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const metrics = await store.getAiInvocationMetrics({
      userId,
      sinceIso: parsedQuery.data.since
    });
    return sendSuccess(reply, request, 200, metrics);
  });
}
