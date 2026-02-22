import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { maybeCompactResponseContext } from '../../integrations/openai/responses-client';
import { handleResponsesWebhook } from '../../integrations/openai/webhook-handler';
import { handleTelegramCommand } from '../../integrations/telegram/commands';
import { handleMcpStreamRequest } from '../../protocol/mcp-transport';
import { negotiateA2AVersion } from '../../protocol/a2a-client';
import { evaluateRadarItems } from '../../radar/scoring';
import { evaluateEvalGate } from '../../evals/gate';
import { executeUpgradeRun, type UpgradeExecutorGateway } from '../../upgrades/executor';

describe('extended integration scenarios', () => {
  it('scenario A: long-run compact + webhook completion handling', async () => {
    const compactResult = await maybeCompactResponseContext(
      {
        responseId: 'resp_long_1',
        promptTokens: 3800,
        completionTokens: 1500,
        compactThresholdTokens: 4500
      },
      {
        async compactResponse() {
          return { id: 'resp_compacted_1' };
        }
      }
    );

    expect(compactResult.compacted).toBe(true);

    const payload = JSON.stringify({ id: 'evt_done_1', type: 'response.completed' });
    const secret = 'scenario_secret';
    const signature = createHmac('sha256', secret).update(payload).digest('hex');

    const received: Array<{ id: string; type: string }> = [];
    const webhookResult = await handleResponsesWebhook(
      {
        rawBody: payload,
        signature,
        secret
      },
      {
        async onEvent(event) {
          received.push(event);
        }
      }
    );

    expect(webhookResult.accepted).toBe(true);
    expect(received).toEqual([{ id: 'evt_done_1', type: 'response.completed' }]);
  });

  it('scenario B: radar recommendation + eval gate pass + start command + upgrade run', async () => {
    const recommendations = evaluateRadarItems([
      { id: 'stack_x', title: 'Stack X', benefit: 4.6, risk: 1.1, cost: 1.4 }
    ]);
    expect(recommendations[0]?.decision).toBe('adopt');

    const gate = evaluateEvalGate({
      accuracy: 0.91,
      safety: 0.95,
      costDeltaPct: 5
    });
    expect(gate.passed).toBe(true);

    const proposalStore = new Map<string, { id: string; status: string }>([
      ['prop_stack_x', { id: 'prop_stack_x', status: 'approved' }]
    ]);

    const commandResult = await handleTelegramCommand(
      { text: '작업 시작 prop_stack_x', actorId: 'u1', chatId: 'c1' },
      {
        async findProposalById(proposalId: string) {
          return proposalStore.get(proposalId) ?? null;
        },
        async createRun(payload: { proposalId: string; startCommand: '작업 시작' }) {
          return {
            id: 'run_cmd_1',
            proposalId: payload.proposalId,
            status: 'planning'
          };
        }
      }
    );
    expect(commandResult.status).toBe('accepted');

    const audits: Array<{ action: string; proposalId: string; reason: string }> = [];
    const gateway: UpgradeExecutorGateway = {
      async findProposalById(proposalId) {
        return proposalStore.get(proposalId) ?? null;
      },
      async createRun(payload) {
        return {
          id: 'run_exec_1',
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
        proposalId: 'prop_stack_x',
        actorId: 'u1',
        startCommand: '작업 시작'
      },
      gateway,
      {
        evaluateGate: async () => gate
      }
    );

    expect(runResult.status).toBe('accepted');
    expect(audits.some((entry) => entry.action === 'upgrade_run.accepted')).toBe(true);
  });

  it('scenario C: protocol guardrails (origin + version negotiation)', async () => {
    const denied = await handleMcpStreamRequest(
      {
        origin: 'https://unknown.host',
        payload: { method: 'tools/list' }
      },
      {
        allowedOrigins: ['https://jarvis.local']
      }
    );
    expect(denied.accepted).toBe(false);

    const allowed = await handleMcpStreamRequest(
      {
        origin: 'https://jarvis.local',
        payload: { method: 'tools/list' }
      },
      {
        allowedOrigins: ['https://jarvis.local']
      }
    );
    expect(allowed.accepted).toBe(true);

    const mismatch = negotiateA2AVersion(
      { supportedVersions: ['0.1'] },
      { supportedVersions: ['0.3'] }
    );
    expect(mismatch.ok).toBe(false);

    const matched = negotiateA2AVersion(
      { supportedVersions: ['0.2', '0.3'] },
      { supportedVersions: ['0.3', '0.4'] }
    );
    expect(matched.ok).toBe(true);
  });
});
