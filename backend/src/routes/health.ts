import type { FastifyInstance } from 'fastify';
import { sendSuccess } from '../lib/http';
import type { RouteContext } from './types';

export async function healthRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.get('/health', async (request, reply) => {
    const health = await ctx.store.health();
    return sendSuccess(reply, request, 200, {
      status: 'ok',
      service: 'jarvis-backend',
      env: ctx.env.NODE_ENV,
      store: health.store,
      db: health.db,
      now: new Date().toISOString()
    }, {});
  });
}
