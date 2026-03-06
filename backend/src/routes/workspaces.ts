import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sendError, sendSuccess } from '../lib/http';
import { classifyWorkspaceCommand, getWorkspaceRuntimeManager } from '../workspaces/runtime-manager';
import type { WorkspaceCommandImpactDimension, WorkspaceCommandPolicy } from '../workspaces/runtime-manager';

import type { RouteContext } from './types';
import { truncateText } from './types';

const WorkspaceCreateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  cwd: z.string().max(400).optional(),
  kind: z.enum(['current', 'worktree', 'devcontainer']).default('current'),
  base_ref: z.string().min(1).max(160).optional(),
  source_workspace_id: z.string().uuid().optional(),
  image: z.string().min(1).max(240).optional(),
  approval_required: z.boolean().default(true)
});

const WorkspaceSpawnSchema = z.object({
  command: z.string().min(1).max(2000),
  shell: z.string().min(1).max(200).optional()
});

const WorkspaceWriteSchema = z.object({
  data: z.string().min(1).max(4000)
});

const WorkspaceReadQuerySchema = z.object({
  after_sequence: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

function buildWorkspaceApprovalCopy(input: {
  workspaceName: string;
  workspaceKind: 'current' | 'worktree' | 'devcontainer';
  policy: WorkspaceCommandPolicy;
}) {
  const { policy } = input;
  const impact = policy.impact;
  const summarize = (dimension: WorkspaceCommandImpactDimension) => {
    const targetSummary = dimension.targets.length > 0 ? ` Targets: ${dimension.targets.join(', ')}.` : '';
    return `${dimension.summary}${targetSummary}`;
  };

  const filesActive = impact.files.level !== 'none';
  const filesExpected = impact.files.level === 'expected';
  const networkActive = impact.network.level !== 'none';
  const processesActive = impact.processes.level !== 'none';

  if (networkActive && filesActive) {
    return {
      title: `Approve remote sync and local changes in ${input.workspaceName}`,
      summary: `${summarize(impact.network)} ${summarize(impact.files)} Severity: ${policy.severity}. Explicit approval is required before execution.`
    };
  }

  if (networkActive) {
    return {
      title: `Approve external access in ${input.workspaceName}`,
      summary: `${summarize(impact.network)} Severity: ${policy.severity}. Explicit approval is required before execution.`
    };
  }

  if (filesExpected) {
    return {
      title: `Approve file changes in ${input.workspaceName}`,
      summary: `${summarize(impact.files)} ${input.workspaceKind === 'worktree' ? 'The isolated worktree keeps the primary checkout untouched until you merge.' : ''} Severity: ${policy.severity}. Explicit approval is required before execution.`
    };
  }

  if (processesActive) {
    const processTitle =
      policy.riskLevel === 'process_control'
        ? `Approve process control in ${input.workspaceName}`
        : `Approve process launch in ${input.workspaceName}`;
    return {
      title: processTitle,
      summary: `${summarize(impact.processes)} Severity: ${policy.severity}. Explicit approval is required before execution.`
    };
  }

  return {
    title: `Review unclassified command in ${input.workspaceName}`,
    summary: `${policy.reason} ${impact.notes.join(' ')} Severity: ${policy.severity}. Explicit approval is required before execution.`
  };
}

function mapPolicySeverityToNotificationSeverity(severity: WorkspaceCommandPolicy['severity']): 'info' | 'warning' | 'critical' {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'warning';
  return 'info';
}

export async function workspaceRoutes(app: FastifyInstance, ctx: RouteContext) {
  const manager = getWorkspaceRuntimeManager();

  const unsubscribe = manager.subscribe(async (event) => {
    const sessionId = event.linkedJarvisSessionId;
    if (!sessionId) return;
    const userId = event.workspace.userId;
    if (event.type === 'error') {
      await ctx.store.updateJarvisSession({ sessionId, userId, status: 'failed' });
      await ctx.store.appendJarvisSessionEvent({
        userId,
        sessionId,
        eventType: 'workspace.failed',
        status: 'failed',
        summary: `Workspace error: ${event.error}`,
        data: {
          workspace_id: event.workspace.id,
          action_proposal_id: event.linkedActionProposalId,
          error: event.error
        }
      });
      return;
    }

    const nextStatus =
      event.reason === 'completed'
        ? 'completed'
        : event.reason === 'terminated'
          ? 'blocked'
          : 'failed';
    await ctx.store.updateJarvisSession({ sessionId, userId, status: nextStatus });
    await ctx.store.appendJarvisSessionEvent({
      userId,
      sessionId,
      eventType:
        event.reason === 'completed'
          ? 'workspace.completed'
          : event.reason === 'terminated'
            ? 'workspace.terminated'
            : 'workspace.failed',
      status: nextStatus,
      summary:
        event.reason === 'completed'
          ? 'Workspace command completed'
          : event.reason === 'terminated'
            ? 'Workspace command terminated'
            : 'Workspace command failed',
      data: {
        workspace_id: event.workspace.id,
        action_proposal_id: event.linkedActionProposalId,
        exit_code: event.exitCode,
        command: event.workspace.activeCommand
      }
    });
  });

  app.addHook('onClose', async () => {
    unsubscribe();
  });

  app.get('/api/v1/workspaces', async (request, reply) => {
    const userId = ctx.resolveRequestUserId(request);
    return sendSuccess(reply, request, 200, {
      workspaces: manager.listWorkspaces(userId)
    });
  });

  app.post('/api/v1/workspaces', async (request, reply) => {
    const parsed = WorkspaceCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid workspace payload', parsed.error.flatten());
    }

    try {
      const role = ctx.resolveRequestRole(request);
      let workspace;
      if (parsed.data.kind === 'worktree') {
        if (role === 'member') {
          const authError = ctx.ensureMinRole(request, reply, 'operator');
          if (authError) return authError;
        }
        workspace = manager.createWorktreeWorkspace({
          userId: ctx.resolveRequestUserId(request),
          name: parsed.data.name,
          approvalRequired: parsed.data.approval_required,
          baseRef: parsed.data.base_ref
        });
      } else if (parsed.data.kind === 'devcontainer') {
        if (!ctx.env.WORKSPACE_DEVCONTAINER_ENABLED) {
          return sendError(reply, request, 422, 'VALIDATION_ERROR', 'devcontainer runtime is disabled');
        }
        const authError = ctx.ensureMinRole(request, reply, 'operator');
        if (authError) return authError;
        workspace = manager.createDevcontainerWorkspace({
          userId: ctx.resolveRequestUserId(request),
          name: parsed.data.name,
          approvalRequired: parsed.data.approval_required,
          image: parsed.data.image,
          sourceWorkspaceId: parsed.data.source_workspace_id ?? null
        });
      } else {
        workspace = manager.createWorkspace({
          userId: ctx.resolveRequestUserId(request),
          name: parsed.data.name,
          cwd: parsed.data.cwd,
          approvalRequired: parsed.data.approval_required
        });
      }
      return sendSuccess(reply, request, 201, workspace);
    } catch (error) {
      return sendError(
        reply,
        request,
        422,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'failed to create workspace'
      );
    }
  });

  app.post('/api/v1/workspaces/:workspaceId/pty/spawn', async (request, reply) => {
    const parsed = WorkspaceSpawnSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid workspace spawn payload', parsed.error.flatten());
    }
    const { workspaceId } = request.params as { workspaceId: string };
    const userId = ctx.resolveRequestUserId(request);
    const command = parsed.data.command.trim();
    const workspace = manager.getWorkspaceRecord({ workspaceId, userId });
    if (!workspace) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'workspace not found');
    }
    const policy = classifyWorkspaceCommand(command, workspace.kind);
    const lowRisk = policy.riskLevel === 'read_only';
    if (policy.disposition !== 'auto_run') {
      const role = ctx.resolveRequestRole(request);
      if (policy.disposition === 'role_required' && !ctx.env.highRiskAllowedRoles.includes(role)) {
        return sendError(reply, request, 403, 'FORBIDDEN', `workspace command requires operator or admin role: ${policy.reason}`, {
          workspace_id: workspace.id,
          workspace_kind: workspace.kind,
          risk_level: policy.riskLevel,
          policy_reason: policy.reason,
          required_roles: ctx.env.highRiskAllowedRoles
        });
      }
      if (policy.disposition === 'approval_required' && workspace.approvalRequired && role === 'member') {
        if (workspace.status === 'running') {
          return sendError(reply, request, 409, 'CONFLICT', 'workspace already has a running session');
        }
        const approvalCopy = buildWorkspaceApprovalCopy({
          workspaceName: workspace.name,
          workspaceKind: workspace.kind,
          policy
        });
        const session = await ctx.store.createJarvisSession({
          userId,
          title: approvalCopy.title,
          prompt: command,
          source: 'workspace_runtime',
          intent: 'code',
          status: 'needs_approval',
          workspacePreset: 'execution',
          primaryTarget: 'execution'
        });
        const proposal = await ctx.store.createActionProposal({
          userId,
          sessionId: session.id,
          kind: 'workspace_prepare',
          title: approvalCopy.title,
          summary: approvalCopy.summary,
          payload: {
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            workspace_kind: workspace.kind,
            cwd: workspace.cwd,
            command,
            shell: parsed.data.shell,
            risk_level: policy.riskLevel,
            impact_profile: policy.impactProfile,
            policy_severity: policy.severity,
            policy_reason: policy.reason,
            policy_disposition: policy.disposition,
            impact: policy.impact
          }
        });
        await ctx.store.appendJarvisSessionEvent({
          userId,
          sessionId: session.id,
          eventType: 'workspace.approval_requested',
          status: 'needs_approval',
          summary: `${approvalCopy.title}: ${truncateText(command, 96)}`,
          data: {
            workspace_id: workspace.id,
            action_proposal_id: proposal.id,
            cwd: workspace.cwd,
            command,
            risk_level: policy.riskLevel,
            impact_profile: policy.impactProfile,
            policy_severity: policy.severity,
            policy_reason: policy.reason,
            policy_disposition: policy.disposition,
            impact: policy.impact
          }
        });
        ctx.notificationService?.emitActionProposalReady(session.id, proposal.id, proposal.title, {
          severity: mapPolicySeverityToNotificationSeverity(policy.severity),
          message: `${proposal.title} · ${policy.impactProfile} · ${policy.severity}`
        });
        return sendSuccess(reply, request, 202, {
          workspace,
          low_risk: false,
          requires_approval: true,
          policy,
          session,
          action: proposal
        });
      }
      if (!ctx.env.highRiskAllowedRoles.includes(role)) {
        const authError = ctx.ensureHighRiskRole(request, reply);
        if (authError) return authError;
      }
    }

    try {
      const workspace = manager.spawnCommand({
        workspaceId,
        userId,
        command,
        shell: parsed.data.shell
      });
      return sendSuccess(reply, request, 202, {
        workspace,
        low_risk: lowRisk,
        policy
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to spawn workspace session';
      const statusCode = message.includes('not found') ? 404 : message.includes('already has') ? 409 : 422;
      const code = statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'VALIDATION_ERROR';
      return sendError(reply, request, statusCode, code, message);
    }
  });

  app.post('/api/v1/workspaces/:workspaceId/pty/write', async (request, reply) => {
    const parsed = WorkspaceWriteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid workspace write payload', parsed.error.flatten());
    }
    const { workspaceId } = request.params as { workspaceId: string };
    const userId = ctx.resolveRequestUserId(request);

    try {
      const workspace = manager.writeToSession({
        workspaceId,
        userId,
        data: parsed.data.data
      });
      return sendSuccess(reply, request, 200, { workspace });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to write to workspace session';
      const statusCode = message.includes('not found') ? 404 : 409;
      const code = statusCode === 404 ? 'NOT_FOUND' : 'CONFLICT';
      return sendError(reply, request, statusCode, code, message);
    }
  });

  app.get('/api/v1/workspaces/:workspaceId/pty/read', async (request, reply) => {
    const parsed = WorkspaceReadQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid workspace read query', parsed.error.flatten());
    }
    const { workspaceId } = request.params as { workspaceId: string };
    const userId = ctx.resolveRequestUserId(request);

    try {
      const result = manager.readChunks({
        workspaceId,
        userId,
        afterSequence: parsed.data.after_sequence,
        limit: parsed.data.limit
      });
      return sendSuccess(reply, request, 200, result);
    } catch (error) {
      return sendError(
        reply,
        request,
        404,
        'NOT_FOUND',
        error instanceof Error ? error.message : 'workspace not found'
      );
    }
  });

  app.post('/api/v1/workspaces/:workspaceId/shutdown', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const userId = ctx.resolveRequestUserId(request);
    try {
      const workspace = manager.shutdownWorkspace({ workspaceId, userId });
      return sendSuccess(reply, request, 200, { workspace, shutdown: true });
    } catch (error) {
      return sendError(
        reply,
        request,
        404,
        'NOT_FOUND',
        error instanceof Error ? error.message : 'workspace not found'
      );
    }
  });

  app.delete('/api/v1/workspaces/:workspaceId', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const userId = ctx.resolveRequestUserId(request);
    const workspace = manager.getWorkspaceRecord({ workspaceId, userId });
    if (!workspace) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'workspace not found');
    }
    if (workspace.kind === 'worktree') {
      const authError = ctx.ensureMinRole(request, reply, 'operator');
      if (authError) return authError;
    }
    try {
      const deletedWorkspace = manager.deleteWorkspace({ workspaceId, userId });
      return sendSuccess(reply, request, 200, { workspace: deletedWorkspace, deleted: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to delete workspace';
      const statusCode = message.includes('not found') ? 404 : message.includes('already has') ? 409 : 422;
      const code = statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'VALIDATION_ERROR';
      return sendError(reply, request, statusCode, code, message);
    }
  });
}
