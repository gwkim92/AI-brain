import { describe, expect, it } from 'vitest';

import { listEditableHyperAgentArtifacts, snapshotArtifactPayload } from '../artifact-catalog';

describe('artifact catalog', () => {
  it('exposes radar domain packs and dossier config as editable artifacts', () => {
    const artifacts = listEditableHyperAgentArtifacts();

    expect(artifacts.map((item) => item.artifactKey)).toEqual([
      'radar_domain_pack',
      'world_model_dossier_config',
    ]);
  });

  it('serializes dossier config and radar domain packs from runtime values', () => {
    const dossierConfig = snapshotArtifactPayload('world_model_dossier_config');
    const radarPacks = snapshotArtifactPayload('radar_domain_pack');

    expect(dossierConfig.maxNextWatchSignals).toBeTypeOf('number');
    expect(Array.isArray(radarPacks.domainPacks)).toBe(true);
    expect((radarPacks.domainPacks as unknown[]).length).toBeGreaterThan(0);
  });
});
