import type { V2StoreRepositoryContract } from '../store/repository-contracts';
import { parseModuleManifest, type ModuleManifest } from './manifest';

function pickMetadataValue(metadata: Record<string, unknown>, key: string, fallback: string): string {
  const raw = metadata[key];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallback;
  }
  return raw;
}

export class CapabilityRegistry {
  constructor(private readonly repository: V2StoreRepositoryContract) {}

  async registerModule(input: unknown): Promise<ModuleManifest> {
    const manifest = parseModuleManifest(input);
    const registered = await this.repository.registerCapabilityModule({
      moduleId: manifest.module_id,
      title: manifest.title,
      description: manifest.description,
      owner: manifest.owner ?? null,
      moduleVersion: manifest.module_version,
      abiVersion: manifest.abi_version,
      inputSchemaRef: manifest.input_schema_ref,
      outputSchemaRef: manifest.output_schema_ref,
      requiredPermissions: manifest.required_permissions,
      dependencies: manifest.dependencies,
      failureModes: manifest.failure_modes,
      metadata: manifest.metadata
    });

    return {
      module_id: registered.module.moduleId,
      title: registered.module.title,
      description: registered.module.description,
      owner: registered.module.owner ?? undefined,
      module_version: registered.version.moduleVersion,
      abi_version: registered.version.abiVersion,
      input_schema_ref: registered.version.inputSchemaRef,
      output_schema_ref: registered.version.outputSchemaRef,
      required_permissions: registered.version.requiredPermissions,
      dependencies: registered.version.dependencies,
      failure_modes: registered.version.failureModes,
      metadata: registered.version.metadata
    };
  }

  async listModules() {
    return this.repository.listCapabilityModules();
  }

  async listModuleVersions(moduleId: string) {
    return this.repository.listCapabilityModuleVersions({ moduleId });
  }

  async resolveManifest(moduleId: string, moduleVersion: string): Promise<ModuleManifest | null> {
    const [modules, versions] = await Promise.all([
      this.repository.listCapabilityModules(),
      this.repository.listCapabilityModuleVersions({ moduleId })
    ]);
    const moduleRecord = modules.find((item) => item.moduleId === moduleId) ?? null;
    const versionRecord = versions.find((item) => item.moduleVersion === moduleVersion) ?? null;
    if (!moduleRecord || !versionRecord) return null;

    return {
      module_id: moduleId,
      title: moduleRecord.title,
      description: moduleRecord.description,
      owner: moduleRecord.owner ?? undefined,
      module_version: versionRecord.moduleVersion,
      abi_version: versionRecord.abiVersion,
      input_schema_ref: versionRecord.inputSchemaRef,
      output_schema_ref: versionRecord.outputSchemaRef,
      required_permissions: versionRecord.requiredPermissions,
      dependencies: versionRecord.dependencies,
      failure_modes: versionRecord.failureModes,
      metadata: {
        ...versionRecord.metadata,
        title: pickMetadataValue(versionRecord.metadata, 'title', moduleRecord.title),
        description: pickMetadataValue(versionRecord.metadata, 'description', moduleRecord.description)
      }
    };
  }
}
