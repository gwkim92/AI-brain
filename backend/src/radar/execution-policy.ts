import type { ActionProposalKind, ExecutionPolicyDecision } from '../store/types';

export function buildRadarExecutionPolicy(input: {
  actionKind: ActionProposalKind;
  payload?: Record<string, unknown>;
}): ExecutionPolicyDecision {
  if (input.actionKind === 'notify') {
    return {
      mode: 'internal_only',
      requiresHuman: false,
      reasons: ['internal_notify_only'],
      target: 'internal',
      mcpToolName: null,
    };
  }

  const mcpAction = input.payload?.mcp_action;
  if (
    mcpAction &&
    typeof mcpAction === 'object' &&
    !Array.isArray(mcpAction) &&
    typeof (mcpAction as Record<string, unknown>).tool_name === 'string' &&
    (mcpAction as Record<string, unknown>).destructive !== true
  ) {
    return {
      mode: 'mcp_write_allowed',
      requiresHuman: false,
      reasons: ['mcp_write_capability_verified'],
      target: 'mcp_write',
      mcpToolName: (mcpAction as Record<string, unknown>).tool_name as string,
    };
  }

  return {
    mode: 'blocked',
    requiresHuman: true,
    reasons: ['mcp_write_capability_missing'],
    target: 'none',
    mcpToolName: null,
  };
}
