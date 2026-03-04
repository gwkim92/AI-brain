import type { FastifyInstance } from 'fastify';

import type { RouteContext } from '../types';
import { registerV2CommandRoutes } from './command';
import { registerV2RetrievalRoutes } from './retrieval';
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
}
