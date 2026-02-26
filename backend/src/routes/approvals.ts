import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import type { RouteContext } from './types';

export async function approvalRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, resolveRequestUserId, notificationService } = ctx;

  app.post('/api/v1/approvals', async (request, reply) => {
    const schema = z.object({
      entity_type: z.string().min(1),
      entity_id: z.string().uuid(),
      action: z.string().min(1),
      expires_at: z.string().optional()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid approval payload', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const approval = await store.createApproval({
      entityType: parsed.data.entity_type,
      entityId: parsed.data.entity_id,
      action: parsed.data.action,
      requestedBy: userId,
      expiresAt: parsed.data.expires_at ?? null
    });
    notificationService?.emitApprovalRequired(approval.id, parsed.data.action);
    return sendSuccess(reply, request, 201, approval);
  });

  app.get('/api/v1/approvals', async (request, reply) => {
    const schema = z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50)
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid query', parsed.error.flatten());
    }
    const list = await store.listApprovals({ status: parsed.data.status, limit: parsed.data.limit });
    return sendSuccess(reply, request, 200, { approvals: list });
  });

  app.post('/api/v1/approvals/:approvalId/decision', async (request, reply) => {
    const approvalId = (request.params as { approvalId: string }).approvalId;
    const schema = z.object({
      decision: z.enum(['approved', 'rejected']),
      reason: z.string().optional()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid decision payload', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const result = await store.decideApproval({
      approvalId,
      decidedBy: userId,
      decision: parsed.data.decision,
      reason: parsed.data.reason
    });
    if (!result) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'approval not found or already decided');
    }
    return sendSuccess(reply, request, 200, result);
  });
}
