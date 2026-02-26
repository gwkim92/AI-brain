import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';
import { applySseCorsHeaders } from './types';

const DashboardOverviewQuerySchema = z.object({
  task_limit: z.coerce.number().int().min(20).max(200).default(120),
  pending_approval_limit: z.coerce.number().int().min(1).max(100).default(30),
  running_task_limit: z.coerce.number().int().min(1).max(100).default(40)
});

const DashboardEventsQuerySchema = DashboardOverviewQuerySchema.extend({
  poll_ms: z.coerce.number().int().min(150).max(10000).default(700),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).default(45000)
});

export async function dashboardRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.get('/api/v1/dashboard/overview', async (request, reply) => {
    const parsed = DashboardOverviewQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    const snapshot = await ctx.buildDashboardOverviewData(request, parsed.data);
    return sendSuccess(reply, request, 200, snapshot);
  });

  app.get('/api/v1/dashboard/events', async (request, reply) => {
    const parsed = DashboardEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }

    applySseCorsHeaders(request, reply, ctx.env);

    reply.raw.write('event: stream.open\n');
    reply.raw.write(`data: ${JSON.stringify({ request_id: request.id })}\n\n`);

    let closed = false;
    let lastSignature: string | null = null;

    const closeStream = (reason = 'closed') => {
      if (closed) return;
      closed = true;
      reply.raw.write('event: stream.close\n');
      reply.raw.write(`data: ${JSON.stringify({ request_id: request.id, reason })}\n\n`);
      reply.raw.end();
    };

    const emitSnapshot = async () => {
      if (closed) return;
      try {
        const snapshot = await ctx.buildDashboardOverviewData(request, parsed.data);
        const signature = ctx.buildDashboardOverviewSignature(snapshot);
        if (signature === lastSignature) return;
        lastSignature = signature;
        reply.raw.write('event: dashboard.updated\n');
        reply.raw.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString(), data: snapshot })}\n\n`);
      } catch (error) {
        request.log.error({ err: error }, 'dashboard events stream snapshot failed');
        reply.raw.write('event: stream.error\n');
        reply.raw.write(`data: ${JSON.stringify({ request_id: request.id, reason: 'snapshot_failed' })}\n\n`);
        closeStream('snapshot_failed');
      }
    };

    reply.raw.on('close', () => { closed = true; });

    await emitSnapshot();
    if (closed) return;

    const interval = setInterval(() => { void emitSnapshot(); }, parsed.data.poll_ms);
    const timeout = setTimeout(() => { closeStream('timeout'); }, parsed.data.timeout_ms);

    reply.raw.on('close', () => {
      clearInterval(interval);
      clearTimeout(timeout);
    });

    reply.hijack();
  });
}
