import type { FastifyInstance } from 'fastify';

import type { RouteContext } from '../types';
import { registerV2ActionRoutes } from './actions';
import { registerV2CapabilityRoutes } from './capabilities';
import { registerV2CodeLoopRoutes } from './code-loops';
import { registerV2CommandRoutes } from './command';
import { registerV2EvalRoutes } from './evals';
import { registerV2FinanceRoutes } from './finance';
import { registerV2HyperAgentRoutes } from './hyperagents';
import { registerV2IncidentRoutes } from './incidents';
import { registerV2KgRoutes } from './kg';
import { registerV2PolicyRoutes } from './policies';
import { registerV2RetrievalRoutes } from './retrieval';
import { registerV2TaskViewRoutes } from './task-view';
import { registerV2TeamRoutes } from './teams';
import { resolveV2FeatureFlags, type V2RouteContext } from './types';

export async function registerV2Routes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const v2Flags = resolveV2FeatureFlags(ctx);

  if (!v2Flags.routesEnabled) {
    return;
  }

  const v2Ctx: V2RouteContext = {
    ...ctx,
    v2Flags
  };

  app.get('/api/v2/health', async (request, reply) => {
    return reply.status(200).send({
      request_id: request.id,
      data: {
        status: 'ok',
        version: 'v2',
        flags: v2Ctx.v2Flags
      },
      meta: {}
    });
  });

  await registerV2CommandRoutes(app, v2Ctx);
  await registerV2RetrievalRoutes(app, v2Ctx);
  await registerV2CapabilityRoutes(app, v2Ctx);
  await registerV2TeamRoutes(app, v2Ctx);
  await registerV2CodeLoopRoutes(app, v2Ctx);
  await registerV2FinanceRoutes(app, v2Ctx);
  await registerV2HyperAgentRoutes(app, v2Ctx);
  await registerV2TaskViewRoutes(app, v2Ctx);
  await registerV2PolicyRoutes(app, v2Ctx);
  await registerV2EvalRoutes(app);
  await registerV2IncidentRoutes(app, v2Ctx);
  await registerV2ActionRoutes(app, v2Ctx);
  await registerV2KgRoutes(app, v2Ctx);
}
