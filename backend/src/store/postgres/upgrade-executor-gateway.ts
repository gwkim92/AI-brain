import type { Pool } from 'pg';

import type {
  UpgradeExecutorGatewayContract,
  UpgradeExecutorGatewayStoreDepsContract
} from '../repository-contracts';

type CreateUpgradeExecutorGatewayDeps = {
  pool: Pool;
  defaultUserId: string;
  store: UpgradeExecutorGatewayStoreDepsContract;
};

export function createPostgresUpgradeExecutorGateway({
  pool,
  defaultUserId,
  store
}: CreateUpgradeExecutorGatewayDeps): UpgradeExecutorGatewayContract {
  return {
    findProposalById: async (proposalId: string) => {
      const proposal = await store.findUpgradeProposalById(proposalId);
      if (!proposal) {
        return null;
      }
      return {
        id: proposal.id,
        status: proposal.status,
        approvedAt: proposal.approvedAt
      };
    },

    createRun: async (payload: { proposalId: string; startCommand: string }) => {
      const run = await store.createUpgradeRun(payload);
      return {
        id: run.id,
        proposalId: run.proposalId,
        status: run.status
      };
    },

    appendAuditLog: async (entry: { action: string; proposalId: string; reason: string }) => {
      await pool.query(
        `
          INSERT INTO audit_logs (
            actor_user_id,
            action,
            entity_type,
            entity_id,
            reason,
            after_data
          )
          VALUES ($1::uuid, $2, 'upgrade_proposal', $3::uuid, $4, $5::jsonb)
        `,
        [defaultUserId, entry.action, entry.proposalId, entry.reason, JSON.stringify({ reason: entry.reason })]
      );
    }
  };
}
