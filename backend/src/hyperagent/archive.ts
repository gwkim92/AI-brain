import type { HyperAgentArtifactKey } from './types';

export type HyperAgentArchiveMetadata = {
  artifactKey: HyperAgentArtifactKey;
  strategy: 'bounded_json_mutation';
  changedKeys: string[];
  parentVariantId: string | null;
  lineageRunId: string;
  changeCount: number;
  createdAt: string;
};

export function buildHyperAgentArchiveMetadata(input: {
  artifactKey: HyperAgentArtifactKey;
  changedKeys: string[];
  parentVariantId?: string | null;
  lineageRunId: string;
}): HyperAgentArchiveMetadata {
  return {
    artifactKey: input.artifactKey,
    strategy: 'bounded_json_mutation',
    changedKeys: [...input.changedKeys],
    parentVariantId: input.parentVariantId ?? null,
    lineageRunId: input.lineageRunId,
    changeCount: input.changedKeys.length,
    createdAt: new Date().toISOString(),
  };
}
