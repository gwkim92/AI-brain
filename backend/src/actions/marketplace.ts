import { randomUUID } from 'node:crypto';

export type ActionModuleRecord = {
  id: string;
  actionKey: string;
  version: string;
  title: string;
  description: string;
  requiredPermissions: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export class ActionMarketplaceV2 {
  private readonly modules = new Map<string, ActionModuleRecord>();

  registerModule(input: {
    actionKey: string;
    version: string;
    title: string;
    description: string;
    requiredPermissions?: string[];
    enabled?: boolean;
  }): ActionModuleRecord {
    const now = new Date().toISOString();
    const existing = Array.from(this.modules.values()).find(
      (item) => item.actionKey === input.actionKey && item.version === input.version
    );

    const record: ActionModuleRecord = existing
      ? {
          ...existing,
          title: input.title,
          description: input.description,
          requiredPermissions: input.requiredPermissions ?? existing.requiredPermissions,
          enabled: input.enabled ?? existing.enabled,
          updatedAt: now
        }
      : {
          id: randomUUID(),
          actionKey: input.actionKey,
          version: input.version,
          title: input.title,
          description: input.description,
          requiredPermissions: input.requiredPermissions ?? [],
          enabled: input.enabled ?? true,
          createdAt: now,
          updatedAt: now
        };
    this.modules.set(record.id, record);
    return record;
  }

  listModules(): ActionModuleRecord[] {
    return Array.from(this.modules.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  authorize(input: {
    actionKey: string;
    grantedPermissions: string[];
  }): { allowed: boolean; missingPermissions: string[]; module: ActionModuleRecord | null } {
    const module = this.listModules().find((item) => item.actionKey === input.actionKey && item.enabled) ?? null;
    if (!module) {
      return {
        allowed: false,
        missingPermissions: ['module_not_found_or_disabled'],
        module: null
      };
    }
    const missingPermissions = module.requiredPermissions.filter((permission) => !input.grantedPermissions.includes(permission));
    return {
      allowed: missingPermissions.length === 0,
      missingPermissions,
      module
    };
  }
}

let sharedActionMarketplace: ActionMarketplaceV2 | null = null;

export function getSharedActionMarketplace(): ActionMarketplaceV2 {
  if (!sharedActionMarketplace) {
    sharedActionMarketplace = new ActionMarketplaceV2();
  }
  return sharedActionMarketplace;
}
