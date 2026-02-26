import type { FastifyInstance } from 'fastify';
import { sendError } from '../lib/http';
import { handleMcpStreamRequest, type JsonRpcRequest } from '../protocol/mcp-transport';
import type { RouteContext } from './types';

export async function mcpRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.post('/api/v1/mcp/stream', async (request, reply) => {
    const userId = ctx.resolveRequestUserId(request);
    const body = request.body as { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> } | undefined;

    if (!body || body.jsonrpc !== '2.0' || !body.method) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid JSON-RPC 2.0 payload');
    }

    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: body.id ?? 0,
      method: body.method,
      params: body.params
    };

    const origin = request.headers.origin ?? request.headers.referer ?? '';
    const result = await handleMcpStreamRequest(
      { origin: typeof origin === 'string' ? origin : origin[0], payload },
      { allowedOrigins: ctx.env.allowedOrigins },
      { store: ctx.store, providerRouter: ctx.providerRouter, userId }
    );

    if (!result.accepted) {
      return sendError(reply, request, 403, 'FORBIDDEN', result.reason);
    }

    return reply.status(200).send(result.response);
  });
}
