import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import { summarizeResult, maskErrorForApi } from '../providers/router';
import type { RouteContext } from './types';

const AiRespondSchema = z.object({
  prompt: z.string().min(1),
  system_prompt: z.string().optional(),
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).default('auto'),
  strict_provider: z.boolean().default(false),
  task_type: z
    .enum(['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'])
    .default('chat'),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().max(32000).optional()
});

export async function aiRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.post('/api/v1/ai/respond', async (request, reply) => {
    const parsed = AiRespondSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid AI respond payload', parsed.error.flatten());
    }

    try {
      const routed = await ctx.providerRouter.generate({
        prompt: parsed.data.prompt,
        systemPrompt: parsed.data.system_prompt,
        provider: parsed.data.provider,
        strictProvider: parsed.data.strict_provider,
        taskType: parsed.data.task_type,
        model: parsed.data.model,
        temperature: parsed.data.temperature,
        maxOutputTokens: parsed.data.max_output_tokens
      });

      return sendSuccess(reply, request, 200, {
        ...summarizeResult(routed.result),
        attempts: routed.attempts,
        used_fallback: routed.usedFallback,
        selection: routed.selection
      });
    } catch (error) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'all providers failed', {
        reason: maskErrorForApi(error)
      });
    }
  });
}
