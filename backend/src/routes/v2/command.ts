import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { compileCommand } from '../../command/compiler';
import { sendError, sendSuccess } from '../../lib/http';
import { getSharedMemoryV2Repository } from '../../store/memory/v2-repositories';
import { createPostgresV2Repository } from '../../store/postgres/v2-repositories';
import type { V2RouteContext } from './types';

const CompileCommandSchema = z.object({
  prompt: z.string().min(1).max(12000),
  session_id: z.string().min(1).max(120).optional(),
  mode_hint: z.string().min(1).max(120).optional()
});

const memoryV2Repo = getSharedMemoryV2Repository();

export async function registerV2CommandRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.post('/api/v2/command/compile', async (request, reply) => {
    if (!ctx.v2Flags.commandCompilerEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 command compiler is disabled');
    }

    const parsed = CompileCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid v2 command compile payload', parsed.error.flatten());
    }

    const userId = ctx.resolveRequestUserId(request);
    const compiled = await compileCommand(ctx.providerRouter, userId, parsed.data.prompt);
    const pool = ctx.store.getPool();
    const repo = pool ? createPostgresV2Repository(pool) : memoryV2Repo;
    const persisted = await repo.createCommandCompilation(compiled.contract);

    return sendSuccess(reply, request, 200, {
      execution_contract: {
        id: persisted.id,
        goal: persisted.goal,
        success_criteria: persisted.successCriteria,
        constraints: persisted.constraints,
        risk: {
          level: persisted.riskLevel,
          reasons: persisted.riskReasons,
          requires_approval: persisted.riskLevel === 'high'
        },
        deliverables: persisted.deliverables,
        domain_mix: persisted.domainMix
      },
      routing: {
        intent: compiled.routing.intent,
        complexity: compiled.routing.complexity,
        confidence: compiled.routing.intentConfidence,
        uncertainty: compiled.routing.uncertainty
      },
      clarification: {
        required: compiled.clarification.required,
        questions: compiled.clarification.questions
      }
    });
  });
}
