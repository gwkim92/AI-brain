import { describe, expect, it } from 'vitest';

import { handleTelegramCommand, parseTelegramCommand, type UpgradeGateway } from '../commands';

describe('parseTelegramCommand', () => {
  it('parses start command with proposal id', () => {
    const parsed = parseTelegramCommand('작업 시작 prop_approved_01');
    expect(parsed).toEqual({
      type: 'start',
      proposalId: 'prop_approved_01'
    });
  });
});

describe('handleTelegramCommand', () => {
  it('starts run only when proposal is approved', async () => {
    const proposals = new Map<string, { id: string; status: string }>([
      ['prop_approved_01', { id: 'prop_approved_01', status: 'approved' }],
      ['prop_pending_01', { id: 'prop_pending_01', status: 'proposed' }]
    ]);
    const runs: Array<{ proposalId: string; startCommand: string }> = [];

    const gateway: UpgradeGateway = {
      async findProposalById(proposalId) {
        return proposals.get(proposalId) ?? null;
      },
      async createRun(payload) {
        runs.push(payload);
        return {
          id: `run_${runs.length}`,
          proposalId: payload.proposalId,
          status: 'planning'
        };
      }
    };

    const approvedResult = await handleTelegramCommand(
      { text: '작업 시작 prop_approved_01', actorId: 'u1', chatId: 'c1' },
      gateway
    );
    const pendingResult = await handleTelegramCommand(
      { text: '작업 시작 prop_pending_01', actorId: 'u1', chatId: 'c1' },
      gateway
    );

    expect(approvedResult.status).toBe('accepted');
    expect(pendingResult.status).toBe('rejected');
    if (pendingResult.status === 'rejected') {
      expect(pendingResult.reason).toBe('proposal_not_approved');
    }
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ proposalId: 'prop_approved_01', startCommand: '작업 시작' });
  });
});
