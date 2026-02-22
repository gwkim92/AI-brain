import { describe, expect, it } from 'vitest';

import { buildRadarDigestMessage } from '../../integrations/telegram/reporter';
import { handleTelegramCommand } from '../../integrations/telegram/commands';
import { evaluateRadarItems } from '../../radar/scoring';
import { createUpgradeProposalDraft } from '../../upgrades/planner';
import { executeUpgradeRun, type UpgradeExecutorGateway } from '../../upgrades/executor';

describe('radar -> telegram -> upgrade integration flow', () => {
  it('creates recommendation, prepares digest, and starts approved upgrade', async () => {
    const recommendations = evaluateRadarItems([
      { id: 'tech_1', title: 'Runtime optimization', benefit: 4.7, risk: 1.4, cost: 1.6 }
    ]);

    const top = recommendations[0];
    expect(top).toBeDefined();
    if (!top) {
      return;
    }

    const proposalDraft = createUpgradeProposalDraft({
      recommendationId: top.id,
      title: 'Upgrade runtime stack',
      expectedBenefit: top.expectedBenefit,
      migrationCost: top.migrationCost,
      riskLevel: top.riskLevel
    });

    expect(proposalDraft.status).toBe('proposed');

    const digest = buildRadarDigestMessage({
      title: 'Weekly Radar Digest',
      generatedAt: '2026-02-22T00:00:00Z',
      lines: [`${top.itemId} -> ${top.decision} (${top.totalScore})`]
    });
    expect(digest).toContain('Weekly Radar Digest');

    const proposalStore = new Map<string, { id: string; status: string }>([
      ['prop_approved_1', { id: 'prop_approved_1', status: 'approved' }]
    ]);

    const commandGateway = {
      async findProposalById(proposalId: string) {
        return proposalStore.get(proposalId) ?? null;
      },
      async createRun(payload: { proposalId: string; startCommand: '작업 시작' }) {
        return {
          id: 'run_from_command_1',
          proposalId: payload.proposalId,
          status: 'planning'
        };
      }
    };

    const commandResult = await handleTelegramCommand(
      { text: '작업 시작 prop_approved_1', actorId: 'user_1', chatId: 'chat_1' },
      commandGateway
    );

    expect(commandResult.status).toBe('accepted');

    const audits: Array<{ action: string; proposalId: string; reason: string }> = [];
    const executorGateway: UpgradeExecutorGateway = {
      async findProposalById(proposalId) {
        return proposalStore.get(proposalId) ?? null;
      },
      async createRun(payload) {
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

    const runResult = await executeUpgradeRun(
      {
        proposalId: 'prop_approved_1',
        actorId: 'user_1',
        startCommand: '작업 시작'
      },
      executorGateway
    );

    expect(runResult.status).toBe('accepted');
    expect(audits.some((entry) => entry.action === 'upgrade_run.accepted')).toBe(true);
  });
});
