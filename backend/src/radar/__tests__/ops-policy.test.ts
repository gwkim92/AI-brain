import { describe, expect, it } from 'vitest';

import { buildOpsUpgradeProposals } from '../ops-policy';

describe('buildOpsUpgradeProposals', () => {
  it('creates proposals when Node/PostgreSQL/Valkey drift from policy', () => {
    const proposals = buildOpsUpgradeProposals({
      node: {
        currentMajor: 22,
        preferredMajor: 24,
        maintenanceMajor: 22
      },
      postgres: {
        currentMinor: 0,
        latestMinor: 2,
        outOfCycleSecurityNotice: true
      },
      valkey: {
        currentPatch: 0,
        latestPatch: 3,
        vulnerabilityNotice: true
      }
    });

    const ids = proposals.map((item) => item.id);

    expect(ids).toContain('node_lts_upgrade');
    expect(ids).toContain('postgres_minor_patch');
    expect(ids).toContain('valkey_patch_update');
    expect(ids).toContain('valkey_security_notice');
    expect(proposals.length).toBeGreaterThanOrEqual(4);
  });
});
