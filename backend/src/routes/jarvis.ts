import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { executeJarvisRequest, mapMissionStatusToSessionStatus } from '../jarvis/request-service';
import { sendError, sendSuccess } from '../lib/http';
import type { JarvisSessionRecord } from '../store/types';
import { WorkspaceProposalPayloadSchema } from '../workspaces/proposal';
import { getWorkspaceRuntimeManager } from '../workspaces/runtime-manager';
import type { RouteContext } from './types';

const JarvisRequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  source: z.string().min(1).max(120).default('quick_command'),
  client_session_id: z.string().uuid().optional(),
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).optional(),
  strict_provider: z.boolean().optional(),
  model: z.string().max(160).optional()
});

const JarvisSessionListSchema = z.object({
  status: z.enum(['queued', 'running', 'blocked', 'needs_approval', 'completed', 'failed', 'stale']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const JarvisSessionEventsSchema = z.object({
  since_sequence: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

function isSessionLikelyStalled(session: JarvisSessionRecord): boolean {
  if (session.status !== 'running') return false;
  const updatedAtMs = Date.parse(session.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  return Date.now() - updatedAtMs >= 2 * 60_000;
}

async function hydrateLinkedSessionState(ctx: RouteContext, session: JarvisSessionRecord): Promise<JarvisSessionRecord> {
  if (session.assistantContextId) {
    const context = await ctx.store.getAssistantContextById({ userId: session.userId, contextId: session.assistantContextId });
    if (context) {
      if (context.status === 'completed' && session.status !== 'completed') {
        return (await ctx.store.updateJarvisSession({ sessionId: session.id, userId: session.userId, status: 'completed' })) ?? session;
      }
      if (context.status === 'failed' && session.status !== 'failed') {
        return (await ctx.store.updateJarvisSession({ sessionId: session.id, userId: session.userId, status: 'failed' })) ?? session;
      }
    }
  }

  if (session.missionId) {
    const mission = await ctx.store.getMissionById({ missionId: session.missionId, userId: session.userId });
    if (mission) {
      const nextStatus = mapMissionStatusToSessionStatus(mission.status);
      if (nextStatus !== session.status) {
        return (await ctx.store.updateJarvisSession({ sessionId: session.id, userId: session.userId, status: nextStatus })) ?? session;
      }
    }
  }

  if (session.councilRunId) {
    const run = await ctx.store.getCouncilRunById(session.councilRunId);
    if (run) {
      const nextStatus = run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'failed' : 'running';
      if (nextStatus !== session.status) {
        return (await ctx.store.updateJarvisSession({ sessionId: session.id, userId: session.userId, status: nextStatus })) ?? session;
      }
    }
  }

  if (session.dossierId) {
    const dossier = await ctx.store.getDossierById({ userId: session.userId, dossierId: session.dossierId });
    if (dossier) {
      const nextStatus = dossier.status === 'ready' ? 'completed' : dossier.status === 'failed' ? 'failed' : 'running';
      if (nextStatus !== session.status) {
        return (await ctx.store.updateJarvisSession({ sessionId: session.id, userId: session.userId, status: nextStatus })) ?? session;
      }
    }
  }

  return session;
}

export async function jarvisRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, resolveRequestUserId, resolveRequestTraceId, resolveRequestProviderCredentials } = ctx;
  const notificationService = ctx.notificationService;
  const workspaceRuntimeManager = getWorkspaceRuntimeManager();

  app.post('/api/v1/jarvis/requests', async (request, reply) => {
    const parsed = JarvisRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid jarvis request payload', parsed.error.flatten());
    }

    const userId = resolveRequestUserId(request);
    const resolvedCredentials = await resolveRequestProviderCredentials(request);
    const result = await executeJarvisRequest(ctx, {
      userId,
      prompt: parsed.data.prompt,
      source: parsed.data.source,
      clientSessionId: parsed.data.client_session_id,
      provider: parsed.data.provider,
      strictProvider: parsed.data.strict_provider,
      model: parsed.data.model,
      traceId: resolveRequestTraceId(request),
      credentialsByProvider: resolvedCredentials.credentialsByProvider
    });

    return sendSuccess(reply, request, 201, result);
  });

  app.get('/api/v1/jarvis/sessions', async (request, reply) => {
    const parsed = JarvisSessionListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid jarvis session query', parsed.error.flatten());
    }
    const userId = resolveRequestUserId(request);
    const sessions = await store.listJarvisSessions({
      userId,
      status: parsed.data.status,
      limit: parsed.data.limit
    });
    return sendSuccess(reply, request, 200, { sessions });
  });

  app.get('/api/v1/jarvis/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const userId = resolveRequestUserId(request);
    const session = await store.getJarvisSessionById({ userId, sessionId });
    if (!session) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'jarvis session not found');
    }
    const hydrated = await hydrateLinkedSessionState(ctx, session);
    if (isSessionLikelyStalled(hydrated)) {
      notificationService?.emitSessionStalled(hydrated.id, hydrated.title);
    }
    const events = await store.listJarvisSessionEvents({ userId, sessionId, limit: 50 });
    const actions = await store.listActionProposals({ userId, sessionId, limit: 20 });
    const briefing = hydrated.briefingId ? await store.getBriefingById({ userId, briefingId: hydrated.briefingId }) : null;
    const dossier = hydrated.dossierId ? await store.getDossierById({ userId, dossierId: hydrated.dossierId }) : null;
    return sendSuccess(reply, request, 200, {
      session: hydrated,
      events,
      actions,
      briefing,
      dossier
    });
  });

  app.get('/api/v1/jarvis/sessions/:sessionId/events', async (request, reply) => {
    const parsed = JarvisSessionEventsSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid jarvis session events query', parsed.error.flatten());
    }
    const { sessionId } = request.params as { sessionId: string };
    const userId = resolveRequestUserId(request);
    const session = await store.getJarvisSessionById({ userId, sessionId });
    if (!session) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'jarvis session not found');
    }
    const events = await store.listJarvisSessionEvents({
      userId,
      sessionId,
      sinceSequence: parsed.data.since_sequence,
      limit: parsed.data.limit
    });
    return sendSuccess(reply, request, 200, { events });
  });

  app.post('/api/v1/jarvis/sessions/:sessionId/actions/:actionId/approve', async (request, reply) => {
    const { sessionId, actionId } = request.params as { sessionId: string; actionId: string };
    const userId = resolveRequestUserId(request);
    const session = await store.getJarvisSessionById({ userId, sessionId });
    if (!session) return sendError(reply, request, 404, 'NOT_FOUND', 'jarvis session not found');
    const proposal = await store.decideActionProposal({
      proposalId: actionId,
      userId,
      decidedBy: userId,
      decision: 'approved'
    });
    if (!proposal) return sendError(reply, request, 404, 'NOT_FOUND', 'action proposal not found');
    await store.appendJarvisSessionEvent({
      userId,
      sessionId,
      eventType: 'action.approved',
      status: proposal.kind === 'workspace_prepare' ? 'running' : 'queued',
      summary: proposal.title,
      data: {
        action_id: proposal.id,
        kind: proposal.kind
      }
    });
    if (proposal.kind === 'workspace_prepare') {
      const parsedPayload = WorkspaceProposalPayloadSchema.safeParse(proposal.payload ?? {});
      if (!parsedPayload.success) {
        await store.updateJarvisSession({ sessionId, userId, status: 'failed' });
        await store.appendJarvisSessionEvent({
          userId,
          sessionId,
          eventType: 'workspace.failed',
          status: 'failed',
          summary: 'Workspace approval payload is invalid',
          data: {
            action_id: proposal.id,
            validation: parsedPayload.error.flatten()
          }
        });
        return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid workspace approval payload', parsedPayload.error.flatten());
      }

      try {
        const workspace = workspaceRuntimeManager.spawnCommand({
          workspaceId: parsedPayload.data.workspace_id,
          userId,
          command: parsedPayload.data.command,
          shell: parsedPayload.data.shell,
          linkedJarvisSessionId: sessionId,
          linkedActionProposalId: proposal.id
        });
        const updatedSession =
          (await store.updateJarvisSession({ sessionId, userId, status: 'running' })) ?? session;
        await store.appendJarvisSessionEvent({
          userId,
          sessionId,
          eventType: 'workspace.started',
          status: 'running',
          summary: `Running workspace command in ${parsedPayload.data.workspace_name ?? workspace.name}`,
          data: {
            action_id: proposal.id,
            workspace_id: workspace.id,
            command: parsedPayload.data.command,
            cwd: parsedPayload.data.cwd ?? workspace.cwd
          }
        });
        return sendSuccess(reply, request, 200, { session: updatedSession, action: proposal, workspace });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'failed to start workspace command';
        await store.updateJarvisSession({ sessionId, userId, status: 'failed' });
        await store.appendJarvisSessionEvent({
          userId,
          sessionId,
          eventType: 'workspace.failed',
          status: 'failed',
          summary: message,
          data: {
            action_id: proposal.id,
            workspace_id: parsedPayload.data.workspace_id
          }
        });
        const statusCode = message.includes('not found') ? 404 : message.includes('already has') ? 409 : 422;
        const code = statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'VALIDATION_ERROR';
        return sendError(reply, request, statusCode, code, message);
      }
    }

    const updatedSession =
      (await store.updateJarvisSession({ sessionId, userId, status: 'queued' })) ?? session;
    return sendSuccess(reply, request, 200, { session: updatedSession, action: proposal });
  });

  app.post('/api/v1/jarvis/sessions/:sessionId/actions/:actionId/reject', async (request, reply) => {
    const { sessionId, actionId } = request.params as { sessionId: string; actionId: string };
    const userId = resolveRequestUserId(request);
    const session = await store.getJarvisSessionById({ userId, sessionId });
    if (!session) return sendError(reply, request, 404, 'NOT_FOUND', 'jarvis session not found');
    const proposal = await store.decideActionProposal({
      proposalId: actionId,
      userId,
      decidedBy: userId,
      decision: 'rejected'
    });
    if (!proposal) return sendError(reply, request, 404, 'NOT_FOUND', 'action proposal not found');
    const updatedSession =
      (await store.updateJarvisSession({ sessionId, userId, status: 'blocked' })) ?? session;
    await store.appendJarvisSessionEvent({
      userId,
      sessionId,
      eventType: 'action.rejected',
      status: 'blocked',
      summary: proposal.title,
      data: {
        action_id: proposal.id,
        kind: proposal.kind
      }
    });
    return sendSuccess(reply, request, 200, { session: updatedSession, action: proposal });
  });
}
