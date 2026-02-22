export type RuntimeOpsState = {
  node: {
    currentMajor: number;
    preferredMajor: number;
    maintenanceMajor: number;
  };
  postgres: {
    currentMinor: number;
    latestMinor: number;
    outOfCycleSecurityNotice: boolean;
  };
  valkey: {
    currentPatch: number;
    latestPatch: number;
    vulnerabilityNotice: boolean;
  };
};

export type OpsUpgradeProposal = {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  reason: string;
  recommendedAction: string;
};

export function buildOpsUpgradeProposals(state: RuntimeOpsState): OpsUpgradeProposal[] {
  const proposals: OpsUpgradeProposal[] = [];

  if (state.node.currentMajor < state.node.preferredMajor) {
    proposals.push({
      id: 'node_lts_upgrade',
      severity: 'high',
      title: `Upgrade Node.js to v${state.node.preferredMajor} Active LTS`,
      reason: `Current major v${state.node.currentMajor} is behind preferred LTS`,
      recommendedAction: `Plan runtime upgrade from v${state.node.currentMajor} to v${state.node.preferredMajor}`
    });
  }

  if (state.node.currentMajor < state.node.maintenanceMajor) {
    proposals.push({
      id: 'node_unsupported_runtime',
      severity: 'critical',
      title: 'Node.js runtime is below maintenance baseline',
      reason: `Current major v${state.node.currentMajor} is below maintenance baseline v${state.node.maintenanceMajor}`,
      recommendedAction: 'Immediate runtime upgrade and canary validation'
    });
  }

  if (state.postgres.currentMinor < state.postgres.latestMinor) {
    proposals.push({
      id: 'postgres_minor_patch',
      severity: 'high',
      title: 'Apply PostgreSQL minor update',
      reason: `Current minor ${state.postgres.currentMinor} is behind latest ${state.postgres.latestMinor}`,
      recommendedAction: 'Schedule rolling minor patch with compatibility checks'
    });
  }

  if (state.postgres.outOfCycleSecurityNotice) {
    proposals.push({
      id: 'postgres_security_notice',
      severity: 'critical',
      title: 'PostgreSQL out-of-cycle security advisory',
      reason: 'Security advisory requires immediate review',
      recommendedAction: 'Open emergency patch workflow and run rollback drill'
    });
  }

  if (state.valkey.currentPatch < state.valkey.latestPatch) {
    proposals.push({
      id: 'valkey_patch_update',
      severity: 'medium',
      title: 'Apply Valkey patch release',
      reason: `Current patch ${state.valkey.currentPatch} is behind latest ${state.valkey.latestPatch}`,
      recommendedAction: 'Apply patch in staging and verify cache failover behavior'
    });
  }

  if (state.valkey.vulnerabilityNotice) {
    proposals.push({
      id: 'valkey_security_notice',
      severity: 'high',
      title: 'Valkey vulnerability advisory detected',
      reason: 'Security notice indicates potential risk in current patch level',
      recommendedAction: 'Assess exposure and decide patch rollout within 24 hours'
    });
  }

  return proposals;
}
