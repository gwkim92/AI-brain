import type {
  UpgradeExecutorGatewayContract,
  UpgradeExecutorGatewayStoreDepsContract
} from '../repository-contracts';

export function createMemoryUpgradeExecutorGateway(
  store: UpgradeExecutorGatewayStoreDepsContract
): UpgradeExecutorGatewayContract {
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
    async appendAuditLog() {
      return;
    }
  };
}
