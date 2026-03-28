import { afterEach, describe, expect, it } from 'vitest';

import { getRadarDomainPack } from '../../radar/domain-packs';
import { getWorldModelDossierConfig, WORLD_MODEL_DOSSIER_CONFIG } from '../../world-model/config';
import {
  clearAppliedHyperAgentArtifactOverrides,
  resolveAppliedArtifactOverride,
  setAppliedHyperAgentArtifactOverride,
} from '../runtime';

describe('hyperagent runtime', () => {
  afterEach(() => {
    clearAppliedHyperAgentArtifactOverrides();
  });

  it('falls back to static defaults when no applied override exists', () => {
    const resolved = resolveAppliedArtifactOverride({
      artifactKey: 'world_model_dossier_config',
      applied: null,
      fallback: { maxNextWatchSignals: 5 },
    });

    expect(resolved.maxNextWatchSignals).toBe(5);
  });

  it('hydrates world-model config and radar packs from applied overrides', () => {
    expect(getWorldModelDossierConfig().maxNextWatchSignals).toBe(
      WORLD_MODEL_DOSSIER_CONFIG.maxNextWatchSignals
    );

    setAppliedHyperAgentArtifactOverride({
      artifactKey: 'world_model_dossier_config',
      payload: {
        maxNextWatchSignals: 2,
      },
      recommendationId: 'rec-1',
      variantId: 'var-1',
      artifactSnapshotId: 'snap-1',
      appliedAt: '2026-03-24T00:00:00.000Z',
    });

    setAppliedHyperAgentArtifactOverride({
      artifactKey: 'radar_domain_pack',
      payload: {
        domainPacks: [
          {
            ...getRadarDomainPack('policy_regulation_platform_ai')!,
            keywordLexicon: ['regulation', 'sandbox_mode'],
          },
        ],
      },
      recommendationId: 'rec-2',
      variantId: 'var-2',
      artifactSnapshotId: 'snap-2',
      appliedAt: '2026-03-24T00:00:01.000Z',
    });

    expect(getWorldModelDossierConfig().maxNextWatchSignals).toBe(2);
    expect(getRadarDomainPack('policy_regulation_platform_ai')?.keywordLexicon).toContain('sandbox_mode');
  });
});
