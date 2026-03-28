import { listRadarDomainPacks } from '../radar/domain-packs';
import { getWorldModelDossierConfig } from '../world-model/config';

import type { HyperAgentArtifactKey, HyperAgentEditableArtifact } from './types';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function listEditableHyperAgentArtifacts(): HyperAgentEditableArtifact[] {
  return [
    {
      artifactKey: 'radar_domain_pack',
      scope: 'world_model',
      description: 'Radar domain packs used to classify structural events and suggest follow-up execution lanes.',
      mutableFields: [
        'domainPacks[].mechanismTemplates',
        'domainPacks[].stateVariables',
        'domainPacks[].invalidationTemplates',
        'domainPacks[].watchMetrics',
        'domainPacks[].keywordLexicon',
        'domainPacks[].actionMapping.executionMode',
      ],
    },
    {
      artifactKey: 'world_model_dossier_config',
      scope: 'world_model',
      description: 'Bounded dossier/world-model thresholds that shape bottleneck, invalidation, and watch-item output size.',
      mutableFields: [
        'maxBottlenecks',
        'maxInvalidationConditions',
        'maxNextWatchSignals',
        'bottleneckScoreThreshold',
      ],
    },
  ];
}

export function snapshotArtifactPayload(artifactKey: HyperAgentArtifactKey): Record<string, unknown> {
  if (artifactKey === 'radar_domain_pack') {
    return {
      domainPacks: cloneJson(listRadarDomainPacks()),
    };
  }

  return cloneJson(getWorldModelDossierConfig()) as Record<string, unknown>;
}
