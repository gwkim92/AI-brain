import { randomUUID } from 'node:crypto';

import type { V2StoreRepositoryContract } from '../repository-contracts';
import type {
  V2CapabilityModuleRecord,
  V2ExecutionContractRecord,
  V2TaskViewSchemaRecord
} from '../types';

type V2ExecutionContractInsert = Omit<V2ExecutionContractRecord, 'id' | 'createdAt' | 'updatedAt'>;
type V2TaskViewSchemaInsert = Omit<V2TaskViewSchemaRecord, 'id' | 'createdAt'>;

export function createMemoryV2Repository(): V2StoreRepositoryContract {
  const commandCompilations = new Map<string, V2ExecutionContractRecord>();
  const capabilityModules = new Map<string, V2CapabilityModuleRecord>();
  const taskViewSchemas = new Map<string, V2TaskViewSchemaRecord>();

  return {
    async createCommandCompilation(input: V2ExecutionContractInsert) {
      const now = new Date().toISOString();
      const record: V2ExecutionContractRecord = {
        ...input,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
      };
      commandCompilations.set(record.id, record);
      return record;
    },

    async listCapabilityModules() {
      return Array.from(capabilityModules.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async saveTaskViewSchema(input: V2TaskViewSchemaInsert) {
      const record: V2TaskViewSchemaRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      };
      taskViewSchemas.set(record.id, record);
      return record;
    }
  };
}

