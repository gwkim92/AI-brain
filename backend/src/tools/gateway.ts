import { classifyWorkspaceCommand, type WorkspaceKind } from '../workspaces/runtime-manager';
import type { ToolInvocation, ToolPolicyDecision } from '../store/types';

function normalizeSeverity(input: unknown): ToolPolicyDecision['severity'] {
  if (input === 'critical' || input === 'high' || input === 'medium' || input === 'low') {
    return input;
  }
  return 'low';
}

export function evaluateToolInvocationPolicy(invocation: ToolInvocation): ToolPolicyDecision {
  if (invocation.source === 'internal' && invocation.command) {
    const workspaceKind = (invocation.workspaceKind ?? 'worktree') as WorkspaceKind;
    const workspacePolicy = classifyWorkspaceCommand(invocation.command, workspaceKind);
    return {
      source: invocation.source,
      name: invocation.name,
      disposition:
        workspacePolicy.disposition === 'auto_run'
          ? 'allow'
          : workspacePolicy.disposition === 'approval_required'
          ? 'approval_required'
          : 'deny',
      rationale: workspacePolicy.reason,
      severity: workspacePolicy.severity,
      metadata: {
        workspacePolicy
      }
    };
  }

  const explicitSeverity = normalizeSeverity(invocation.metadata?.severity);
  const requiresApproval = invocation.metadata?.requiresApproval === true || explicitSeverity === 'high' || explicitSeverity === 'critical';

  return {
    source: invocation.source,
    name: invocation.name,
    disposition: requiresApproval ? 'approval_required' : 'allow',
    rationale: requiresApproval ? 'tool metadata requires operator approval' : 'tool invocation is eligible for direct execution',
    severity: explicitSeverity,
    metadata: invocation.metadata ?? {}
  };
}
