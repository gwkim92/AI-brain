export type HyperAgentArtifactKey = 'radar_domain_pack' | 'world_model_dossier_config';
export type HyperAgentArtifactScope = 'world_model';

export type HyperAgentEditableArtifact = {
  artifactKey: HyperAgentArtifactKey;
  scope: HyperAgentArtifactScope;
  description: string;
  mutableFields: string[];
};
