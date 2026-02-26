export type UpgradeProposal = {
  id: string;
  status: string;
  approvedAt?: string | null;
};

export type UpgradeRunRecord = {
  id: string;
  proposalId: string;
  status: string;
};

export type UpgradeRunRequest = {
  proposalId: string;
  actorId: string;
  startCommand: '작업 시작';
};

export type AuditEntry = {
  action: string;
  proposalId: string;
  reason: string;
};

export type UpgradeExecutorGateway = {
  findProposalById: (proposalId: string) => Promise<UpgradeProposal | null>;
  createRun: (payload: { proposalId: string; startCommand: string }) => Promise<UpgradeRunRecord>;
  appendAuditLog: (entry: AuditEntry) => Promise<void>;
};

export type UpgradeGateResult = {
  passed: boolean;
  reasons?: string[];
};

export type UpgradeExecutionOptions = {
  evaluateGate?: (proposalId: string) => Promise<UpgradeGateResult>;
  isProposalExpired?: (proposal: UpgradeProposal) => boolean;
};

export type UpgradeExecutionResult =
  | { status: 'accepted'; run: UpgradeRunRecord }
  | { status: 'rejected'; reason: 'proposal_not_found' | 'approval_required' | 'approval_expired' | 'eval_gate_failed' };

export async function executeUpgradeRun(
  request: UpgradeRunRequest,
  gateway: UpgradeExecutorGateway,
  options: UpgradeExecutionOptions = {}
): Promise<UpgradeExecutionResult> {
  const proposal = await gateway.findProposalById(request.proposalId);

  if (!proposal) {
    await gateway.appendAuditLog({
      action: 'upgrade_run.rejected',
      proposalId: request.proposalId,
      reason: 'proposal_not_found'
    });

    return {
      status: 'rejected',
      reason: 'proposal_not_found'
    };
  }

  if (proposal.status !== 'approved') {
    await gateway.appendAuditLog({
      action: 'upgrade_run.rejected',
      proposalId: request.proposalId,
      reason: 'approval_required'
    });

    return {
      status: 'rejected',
      reason: 'approval_required'
    };
  }

  if (options.isProposalExpired?.(proposal)) {
    await gateway.appendAuditLog({
      action: 'upgrade_run.rejected',
      proposalId: request.proposalId,
      reason: 'approval_expired'
    });

    return {
      status: 'rejected',
      reason: 'approval_expired'
    };
  }

  if (options.evaluateGate) {
    const gateResult = await options.evaluateGate(request.proposalId);

    if (!gateResult.passed) {
      await gateway.appendAuditLog({
        action: 'upgrade_run.rejected',
        proposalId: request.proposalId,
        reason: 'eval_gate_failed'
      });

      return {
        status: 'rejected',
        reason: 'eval_gate_failed'
      };
    }
  }

  const run = await gateway.createRun({
    proposalId: request.proposalId,
    startCommand: request.startCommand
  });

  await gateway.appendAuditLog({
    action: 'upgrade_run.accepted',
    proposalId: request.proposalId,
    reason: 'approved'
  });

  return {
    status: 'accepted',
    run
  };
}
