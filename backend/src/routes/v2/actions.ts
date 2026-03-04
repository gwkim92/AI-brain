import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getSharedActionMarketplace } from '../../actions/marketplace';
import { sendError, sendSuccess } from '../../lib/http';
import type { V2RouteContext } from './types';

const RegisterActionSchema = z.object({
  action_key: z.string().min(1).max(160),
  version: z.string().min(1).max(40),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  required_permissions: z.array(z.string().min(1).max(120)).max(100).optional(),
  enabled: z.boolean().optional()
});

const ActionParamsSchema = z.object({
  actionKey: z.string().min(1).max(160)
});

const AuthorizeSchema = z.object({
  granted_permissions: z.array(z.string().min(1).max(120)).max(100).default([])
});

const marketplace = getSharedActionMarketplace();

export async function registerV2ActionRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.post('/api/v2/actions/modules/register', async (request, reply) => {
    const minRoleError = ctx.ensureMinRole(request, reply, 'operator');
    if (minRoleError) return minRoleError;

    const parsed = RegisterActionSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid action module payload', parsed.error.flatten());
    }

    const record = marketplace.registerModule({
      actionKey: parsed.data.action_key,
      version: parsed.data.version,
      title: parsed.data.title,
      description: parsed.data.description,
      requiredPermissions: parsed.data.required_permissions,
      enabled: parsed.data.enabled
    });
    return sendSuccess(reply, request, 200, {
      module: record
    });
  });

  app.get('/api/v2/actions/modules', async (request, reply) => {
    return sendSuccess(reply, request, 200, {
      modules: marketplace.listModules()
    });
  });

  app.post('/api/v2/actions/modules/:actionKey/authorize', async (request, reply) => {
    const parsedParams = ActionParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid action key', parsedParams.error.flatten());
    }
    const parsedBody = AuthorizeSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid authorize payload', parsedBody.error.flatten());
    }

    const result = marketplace.authorize({
      actionKey: parsedParams.data.actionKey,
      grantedPermissions: parsedBody.data.granted_permissions
    });
    return sendSuccess(reply, request, 200, result);
  });
}
