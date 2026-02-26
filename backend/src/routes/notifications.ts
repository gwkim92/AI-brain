import type { FastifyInstance } from 'fastify';
import { sendError } from '../lib/http';
import { applySseCorsHeaders, type RouteContext } from './types';

export async function notificationRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.get('/api/v1/notifications/stream', async (request, reply) => {
    if (!ctx.notificationService) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'notification service unavailable');
    }

    reply.raw.statusCode = 200;
    applySseCorsHeaders(request, reply, ctx.env);
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.write(':\n\n');
    reply.hijack();

    const heartbeatTimer = setInterval(() => {
      reply.raw.write(':\n\n');
    }, 15_000);

    const unsubscribe = ctx.notificationService.subscribe((notification) => {
      reply.raw.write(`data: ${JSON.stringify(notification)}\n\n`);
    });

    request.raw.on('close', () => {
      clearInterval(heartbeatTimer);
      unsubscribe();
    });
  });
}
