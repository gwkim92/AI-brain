import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getSharedEvalRunner } from '../../evals/v2/runner';
import { sendError, sendSuccess } from '../../lib/http';

const EvalRunCreateSchema = z.object({
  suite: z.string().min(1).max(120).default('smoke'),
  threshold: z.number().min(0).max(1).optional(),
  chaos_scenario: z.enum(['none', 'connector_down', 'model_down', 'network_latency']).optional()
});

const EvalRunParamsSchema = z.object({
  id: z.string().uuid()
});

const evalRunner = getSharedEvalRunner();

export async function registerV2EvalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v2/evals/runs', async (request, reply) => {
    const parsed = EvalRunCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid eval run payload', parsed.error.flatten());
    }

    const run = await evalRunner.runSuite({
      suite: parsed.data.suite,
      threshold: parsed.data.threshold,
      chaosScenario: parsed.data.chaos_scenario
    });

    return sendSuccess(reply, request, 200, {
      run_id: run.id,
      suite: run.suite,
      status: run.status,
      pass_rate: run.passRate,
      threshold: run.threshold
    });
  });

  app.get('/api/v2/evals/runs/:id', async (request, reply) => {
    const parsedParams = EvalRunParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid eval run id', parsedParams.error.flatten());
    }

    const run = evalRunner.getRun(parsedParams.data.id);
    if (!run) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'eval run not found');
    }
    return sendSuccess(reply, request, 200, {
      run
    });
  });
}
