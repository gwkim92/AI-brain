import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { executeJarvisRequest } from '../jarvis/request-service';
import { sendError, sendSuccess } from '../lib/http';
import { recommendModelForPrompt } from '../providers/model-recommender';
import { buildSkillUsePreview, findSkills, getSkill, getSkillResource, listSkills } from '../skills/registry';
import type { SkillId } from '../skills/types';
import type { ModelControlFeatureKey } from '../store/types';

import type { RouteContext } from './types';

const SkillIdSchema = z.enum([
  'deep_research',
  'news_briefing',
  'repo_health_review',
  'incident_triage',
  'model_recommendation_reasoner'
] as const);

const FeatureKeySchema = z.enum([
  'global_default',
  'assistant_chat',
  'assistant_context_run',
  'council_run',
  'execution_code',
  'execution_compute',
  'mission_plan_generation',
  'mission_execute_step'
] as const);

const FindSkillsSchema = z.object({
  prompt: z.string().min(1).max(8000),
  limit: z.coerce.number().int().min(1).max(20).default(5)
});

const UseSkillSchema = z.object({
  skill_id: SkillIdSchema,
  prompt: z.string().min(1).max(16000),
  execute: z.boolean().default(false),
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).optional(),
  strict_provider: z.boolean().default(false),
  model: z.string().max(200).optional(),
  feature_key: FeatureKeySchema.optional(),
  task_type: z.string().min(1).max(80).optional()
});

function ensureEnabled(envEnabled: boolean, request: FastifyRequest, reply: FastifyReply) {
  if (!envEnabled) {
    return sendError(reply, request, 403, 'FORBIDDEN', 'skills feature is disabled');
  }
  return null;
}

export async function skillRoutes(app: FastifyInstance, ctx: RouteContext) {
  const {
    env,
    store,
    providerRouter,
    resolveRequestUserId,
    resolveRequestTraceId,
    resolveRequestProviderCredentials
  } = ctx;

  app.get('/api/v1/skills', async (request, reply) => {
    const disabled = ensureEnabled(env.JARVIS_SKILLS_ENABLED, request, reply);
    if (disabled) return disabled;
    return sendSuccess(reply, request, 200, { skills: listSkills() });
  });

  app.post('/api/v1/skills/find', async (request, reply) => {
    const disabled = ensureEnabled(env.JARVIS_SKILLS_ENABLED, request, reply);
    if (disabled) return disabled;
    const parsed = FindSkillsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid skill search payload', parsed.error.flatten());
    }
    const matches = findSkills(parsed.data.prompt, parsed.data.limit);
    return sendSuccess(reply, request, 200, {
      normalized_prompt: parsed.data.prompt.trim(),
      recommended_skill_id: matches[0]?.skill.id ?? null,
      matches
    });
  });

  app.get('/api/v1/skills/:skillId/resources/:resourceId', async (request, reply) => {
    const disabled = ensureEnabled(env.JARVIS_SKILLS_ENABLED, request, reply);
    if (disabled) return disabled;
    const { skillId, resourceId } = request.params as { skillId: string; resourceId: string };
    if (!SkillIdSchema.safeParse(skillId).success) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'skill not found');
    }
    const resource = getSkillResource(skillId, resourceId);
    if (!resource) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'skill resource not found');
    }
    return sendSuccess(reply, request, 200, {
      skill_id: skillId,
      resource
    });
  });

  app.post('/api/v1/skills/use', async (request, reply) => {
    const disabled = ensureEnabled(env.JARVIS_SKILLS_ENABLED, request, reply);
    if (disabled) return disabled;
    const parsed = UseSkillSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid skill use payload', parsed.error.flatten());
    }
    const skill = getSkill(parsed.data.skill_id);
    if (!skill) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'skill not found');
    }

    const preview = buildSkillUsePreview({
      skillId: parsed.data.skill_id as SkillId,
      prompt: parsed.data.prompt,
      featureKey: parsed.data.feature_key as ModelControlFeatureKey | undefined,
      provider: parsed.data.provider,
      model: parsed.data.model
    });

    if (!parsed.data.execute) {
      return sendSuccess(reply, request, 200, {
        dry_run: true,
        result_type: 'preview',
        preview
      });
    }

    const userId = resolveRequestUserId(request);
    const traceId = resolveRequestTraceId(request);
    const resolvedCredentials = await resolveRequestProviderCredentials(request);

    if (skill.executionKind === 'model_recommendation') {
      const draft = await recommendModelForPrompt({
        env,
        providerRouter,
        featureKey: preview.featureKey ?? 'assistant_chat',
        taskType: parsed.data.task_type ?? preview.taskType ?? 'execute',
        prompt: preview.suggestedPrompt,
        credentialsByProvider: resolvedCredentials.credentialsByProvider,
        traceId
      });
      const recommendation = await store.createModelRecommendationRun({
        userId,
        featureKey: preview.featureKey ?? 'assistant_chat',
        promptHash: draft.promptHash,
        promptExcerptRedacted: draft.promptExcerptRedacted,
        recommendedProvider: draft.recommendedProvider,
        recommendedModelId: draft.recommendedModelId,
        rationaleText: draft.rationaleText,
        evidenceJson: {
          ...draft.evidenceJson,
          source_skill: skill.id
        },
        recommenderProvider: draft.recommenderProvider
      });
      return sendSuccess(reply, request, 200, {
        dry_run: false,
        result_type: 'model_recommendation',
        preview,
        recommendation
      });
    }

    const result = await executeJarvisRequest(ctx, {
      userId,
      prompt: preview.suggestedPrompt,
      source: `skill:${skill.id}`,
      provider: parsed.data.provider,
      strictProvider: parsed.data.strict_provider,
      model: parsed.data.model?.trim() || undefined,
      traceId,
      credentialsByProvider: resolvedCredentials.credentialsByProvider
    });
    return sendSuccess(reply, request, 200, {
      dry_run: false,
      result_type: 'jarvis_request',
      preview,
      session: result.session,
      delegation: result.delegation
    });
  });
}
