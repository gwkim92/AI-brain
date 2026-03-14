import { getAbiMajor, type ModuleManifest } from './manifest';

export type CapabilityGraphNodeRef = {
  module_id: string;
  module_version: string;
};

export type CapabilityGraphEdge = {
  from: CapabilityGraphNodeRef;
  to: CapabilityGraphNodeRef;
};

export type CapabilityGraphValidationIssue = {
  code:
    | 'module_not_found'
    | 'dependency_missing'
    | 'abi_version_mismatch'
    | 'schema_mismatch';
  message: string;
  module_id?: string;
  module_version?: string;
  edge?: CapabilityGraphEdge;
};

export type CapabilityGraphValidationResult = {
  valid: boolean;
  errors: CapabilityGraphValidationIssue[];
  warnings: CapabilityGraphValidationIssue[];
};

function manifestKey(moduleId: string, moduleVersion: string): string {
  return `${moduleId}@${moduleVersion}`;
}

function parseDependencyRef(value: string): { moduleId: string; moduleVersion?: string } {
  const [moduleId, moduleVersion] = value.split('@', 2);
  return {
    moduleId: moduleId.trim(),
    moduleVersion: moduleVersion?.trim() || undefined
  };
}

export function validateCapabilityGraph(input: {
  manifests: ModuleManifest[];
  edges: CapabilityGraphEdge[];
}): CapabilityGraphValidationResult {
  const errors: CapabilityGraphValidationIssue[] = [];
  const warnings: CapabilityGraphValidationIssue[] = [];

  const byKey = new Map<string, ModuleManifest>();
  const versionsByModule = new Map<string, Set<string>>();
  for (const manifest of input.manifests) {
    byKey.set(manifestKey(manifest.module_id, manifest.module_version), manifest);
    const bucket = versionsByModule.get(manifest.module_id) ?? new Set<string>();
    bucket.add(manifest.module_version);
    versionsByModule.set(manifest.module_id, bucket);
  }

  for (const manifest of input.manifests) {
    for (const dependency of manifest.dependencies) {
      const parsed = parseDependencyRef(dependency);
      if (!parsed.moduleId) continue;
      if (!versionsByModule.has(parsed.moduleId)) {
        errors.push({
          code: 'dependency_missing',
          message: `Dependency module "${parsed.moduleId}" is missing`,
          module_id: manifest.module_id,
          module_version: manifest.module_version
        });
        continue;
      }
      if (parsed.moduleVersion && !byKey.has(manifestKey(parsed.moduleId, parsed.moduleVersion))) {
        errors.push({
          code: 'dependency_missing',
          message: `Dependency "${parsed.moduleId}@${parsed.moduleVersion}" is missing`,
          module_id: manifest.module_id,
          module_version: manifest.module_version
        });
      }
    }
  }

  for (const edge of input.edges) {
    const fromKey = manifestKey(edge.from.module_id, edge.from.module_version);
    const toKey = manifestKey(edge.to.module_id, edge.to.module_version);
    const fromManifest = byKey.get(fromKey);
    const toManifest = byKey.get(toKey);
    if (!fromManifest || !toManifest) {
      errors.push({
        code: 'module_not_found',
        message: `Edge references missing module(s): from=${fromKey}, to=${toKey}`,
        edge
      });
      continue;
    }

    const fromAbiMajor = getAbiMajor(fromManifest.abi_version);
    const toAbiMajor = getAbiMajor(toManifest.abi_version);
    if (fromAbiMajor === null || toAbiMajor === null || fromAbiMajor !== toAbiMajor) {
      errors.push({
        code: 'abi_version_mismatch',
        message: `ABI mismatch between ${fromKey} and ${toKey}`,
        edge
      });
    }

    if (fromManifest.output_schema_ref !== toManifest.input_schema_ref) {
      errors.push({
        code: 'schema_mismatch',
        message: `Schema mismatch: ${fromManifest.output_schema_ref} -> ${toManifest.input_schema_ref}`,
        edge
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
