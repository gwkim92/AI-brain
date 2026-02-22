import { describe, expect, it } from 'vitest';

import { executeUpgradeRun, type UpgradeExecutorGateway } from '../executor';

describe('executeUpgradeRun', () => {
  it('rejects run without approved proposal and records audit', async () => {
    const audits: Array<{ action: string; proposalId: string; reason: string }> = [];
    const createdRuns: Array<{ proposalId: string; startCommand: string }> = [];

    const gateway: UpgradeExecutorGateway = {
      async findProposalById(proposalId) {
        return {
          id: proposalId,
          status: 'proposed'
        };
      },
      async createRun(payload) {
        createdRuns.push(payload);
        return {
          id: 'run_1',
          proposalId: payload.proposalId,
          status: 'planning'
        };
      },
      async appendAuditLog(entry) {
        audits.push(entry);
      }
    };

    const result = await executeUpgradeRun(
      {
        proposalId: 'prop_1',
        actorId: 'user_1',
        startCommand: '작업 시작'
      },
      gateway
    );

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('approval_required');
    }

    expect(createdRuns).toHaveLength(0);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toEqual({
      action: 'upgrade_run.rejected',
      proposalId: 'prop_1',
      reason: 'approval_required'
    });
  });
});
