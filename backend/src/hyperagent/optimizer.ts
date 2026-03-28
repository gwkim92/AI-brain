import { randomUUID } from 'node:crypto';

import { buildHyperAgentArchiveMetadata, type HyperAgentArchiveMetadata } from './archive';
import { applyBoundedMutations } from './mutators';
import type { HyperAgentArtifactKey } from './types';

export type GeneratedBoundedVariant = {
  strategy: 'bounded_json_mutation';
  payload: Record<string, unknown>;
  changedKeys: string[];
  metadata: HyperAgentArchiveMetadata;
};

export async function generateBoundedVariant(input: {
  artifactKey: HyperAgentArtifactKey;
  basePayload: Record<string, unknown>;
  mutationBudget?: number;
  parentVariantId?: string | null;
  lineageRunId?: string;
}): Promise<GeneratedBoundedVariant> {
  const { payload, changedKeys } = applyBoundedMutations({
    artifactKey: input.artifactKey,
    basePayload: input.basePayload,
    mutationBudget: input.mutationBudget,
  });

  const lineageRunId = input.lineageRunId ?? randomUUID();

  return {
    strategy: 'bounded_json_mutation',
    payload,
    changedKeys,
    metadata: buildHyperAgentArchiveMetadata({
      artifactKey: input.artifactKey,
      changedKeys,
      parentVariantId: input.parentVariantId,
      lineageRunId,
    }),
  };
}
