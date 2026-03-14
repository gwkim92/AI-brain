import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getSharedIncidentService } from '../../incidents/service';
import { sendError, sendSuccess } from '../../lib/http';
import type { V2RouteContext } from './types';

const CreateIncidentSchema = z.object({
  incident_type: z.string().min(1).max(120),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: z.string().min(1).max(2000),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const RollbackSchema = z.object({
  action_type: z.string().min(1).max(120).default('policy_rollback')
});

const IncidentParamsSchema = z.object({
  id: z.string().uuid()
});

const incidentService = getSharedIncidentService();

export async function registerV2IncidentRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.post('/api/v2/incidents', async (request, reply) => {
    const minRoleError = ctx.ensureMinRole(request, reply, 'operator');
    if (minRoleError) return minRoleError;

    const parsed = CreateIncidentSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid incident payload', parsed.error.flatten());
    }

    const incident = incidentService.createIncident({
      incidentType: parsed.data.incident_type,
      severity: parsed.data.severity,
      summary: parsed.data.summary,
      metadata: parsed.data.metadata
    });

    return sendSuccess(reply, request, 200, {
      incident
    });
  });

  app.post('/api/v2/incidents/:id/rollback', async (request, reply) => {
    const parsedParams = IncidentParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid incident id', parsedParams.error.flatten());
    }
    const parsedBody = RollbackSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid rollback payload', parsedBody.error.flatten());
    }

    try {
      const action = incidentService.rollbackIncident({
        incidentId: parsedParams.data.id,
        actorUserId: ctx.resolveRequestUserId(request),
        actorRole: ctx.resolveRequestRole(request),
        actionType: parsedBody.data.action_type
      });
      return sendSuccess(reply, request, 200, {
        rollback_action: action
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'incident_not_found') {
        return sendError(reply, request, 404, 'NOT_FOUND', 'incident not found');
      }
      if (message === 'rollback_forbidden') {
        return sendError(reply, request, 403, 'FORBIDDEN', 'rollback requires operator/admin role');
      }
      return sendError(reply, request, 500, 'INTERNAL_ERROR', 'rollback failed');
    }
  });
}
