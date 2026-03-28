import { describe, expect, it } from 'vitest';

import { evaluateToolInvocationPolicy } from '../gateway';

describe('tool invocation gateway', () => {
  it('normalizes internal shell command policy', () => {
    const decision = evaluateToolInvocationPolicy({
      source: 'internal',
      name: 'runner.verification',
      command: 'pnpm install',
      workspaceKind: 'worktree'
    });

    expect(decision.disposition).toBe('approval_required');
    expect(decision.severity === 'medium' || decision.severity === 'high' || decision.severity === 'critical').toBe(true);
  });

  it('allows low-risk MCP calls unless metadata escalates them', () => {
    const allowDecision = evaluateToolInvocationPolicy({
      source: 'mcp',
      name: 'memory.search',
      metadata: {
        severity: 'low'
      }
    });
    expect(allowDecision.disposition).toBe('allow');

    const gatedDecision = evaluateToolInvocationPolicy({
      source: 'openapi',
      name: 'deploy.release',
      metadata: {
        severity: 'critical',
        requiresApproval: true
      }
    });
    expect(gatedDecision.disposition).toBe('approval_required');
  });
});
