import { randomUUID } from 'node:crypto';

import type { V2StoreRepositoryContract } from '../repository-contracts';
import type {
  V2CapabilityModuleRegistrationInput,
  V2CapabilityModuleRegistrationRecord,
  V2CapabilityModuleRecord,
  V2CapabilityModuleVersionRecord,
  V2ExecutionContractRecord,
  V2RetrievalEvidenceItemRecord,
  V2RetrievalQueryRecord,
  V2RetrievalScoreRecord,
  V2TaskViewSchemaRecord
} from '../types';

type V2ExecutionContractInsert = Omit<V2ExecutionContractRecord, 'id' | 'createdAt' | 'updatedAt'>;
type V2RetrievalQueryInsert = Omit<V2RetrievalQueryRecord, 'id' | 'createdAt'>;
type V2RetrievalEvidenceInsert = Omit<V2RetrievalEvidenceItemRecord, 'id' | 'createdAt'>;
type V2RetrievalScoreInsert = Omit<V2RetrievalScoreRecord, 'id' | 'createdAt'>;
type V2CapabilityModuleRegistrationInsert = V2CapabilityModuleRegistrationInput;
type V2TaskViewSchemaInsert = Omit<V2TaskViewSchemaRecord, 'id' | 'createdAt'>;

export function createMemoryV2Repository(): V2StoreRepositoryContract {
  const commandCompilations = new Map<string, V2ExecutionContractRecord>();
  const retrievalQueries = new Map<string, V2RetrievalQueryRecord>();
  const retrievalEvidenceItems = new Map<string, V2RetrievalEvidenceItemRecord>();
  const retrievalScores = new Map<string, V2RetrievalScoreRecord>();
  const capabilityModules = new Map<string, V2CapabilityModuleRecord>();
  const capabilityModuleVersions = new Map<string, V2CapabilityModuleVersionRecord>();
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

    async getCommandCompilationById(input: { id: string; userId: string }) {
      const record = commandCompilations.get(input.id) ?? null;
      if (!record || record.userId !== input.userId) {
        return null;
      }
      return record;
    },

    async createRetrievalQuery(input: V2RetrievalQueryInsert) {
      const record: V2RetrievalQueryRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      };
      retrievalQueries.set(record.id, record);
      return record;
    },

    async createRetrievalEvidenceItems(input: V2RetrievalEvidenceInsert[]) {
      return input.map((item) => {
        const record: V2RetrievalEvidenceItemRecord = {
          ...item,
          id: randomUUID(),
          createdAt: new Date().toISOString()
        };
        retrievalEvidenceItems.set(record.id, record);
        return record;
      });
    },

    async createRetrievalScore(input: V2RetrievalScoreInsert) {
      const record: V2RetrievalScoreRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      };
      retrievalScores.set(record.id, record);
      return record;
    },

    async registerCapabilityModule(input: V2CapabilityModuleRegistrationInsert): Promise<V2CapabilityModuleRegistrationRecord> {
      const now = new Date().toISOString();
      const existingModule = Array.from(capabilityModules.values()).find((item) => item.moduleId === input.moduleId) ?? null;
      const moduleRecord: V2CapabilityModuleRecord = existingModule
        ? {
            ...existingModule,
            title: input.title,
            description: input.description,
            owner: input.owner ?? null,
            updatedAt: now
          }
        : {
            id: randomUUID(),
            moduleId: input.moduleId,
            title: input.title,
            description: input.description,
            owner: input.owner ?? null,
            createdAt: now,
            updatedAt: now
          };
      capabilityModules.set(moduleRecord.id, moduleRecord);

      const existingVersion = Array.from(capabilityModuleVersions.values()).find(
        (item) => item.moduleRecordId === moduleRecord.id && item.moduleVersion === input.moduleVersion
      );
      const versionRecord: V2CapabilityModuleVersionRecord = existingVersion
        ? {
            ...existingVersion,
            moduleId: moduleRecord.moduleId,
            abiVersion: input.abiVersion,
            inputSchemaRef: input.inputSchemaRef,
            outputSchemaRef: input.outputSchemaRef,
            requiredPermissions: [...input.requiredPermissions],
            dependencies: [...input.dependencies],
            failureModes: [...input.failureModes],
            metadata: { ...(input.metadata ?? {}) }
          }
        : {
            id: randomUUID(),
            moduleId: moduleRecord.moduleId,
            moduleRecordId: moduleRecord.id,
            moduleVersion: input.moduleVersion,
            abiVersion: input.abiVersion,
            inputSchemaRef: input.inputSchemaRef,
            outputSchemaRef: input.outputSchemaRef,
            requiredPermissions: [...input.requiredPermissions],
            dependencies: [...input.dependencies],
            failureModes: [...input.failureModes],
            metadata: { ...(input.metadata ?? {}) },
            createdAt: now
          };
      capabilityModuleVersions.set(versionRecord.id, versionRecord);

      return {
        module: moduleRecord,
        version: versionRecord
      };
    },

    async listCapabilityModules() {
      return Array.from(capabilityModules.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async listCapabilityModuleVersions(input: { moduleId: string }) {
      const moduleRecord = Array.from(capabilityModules.values()).find((item) => item.moduleId === input.moduleId) ?? null;
      if (!moduleRecord) return [];
      return Array.from(capabilityModuleVersions.values())
        .filter((item) => item.moduleRecordId === moduleRecord.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

let sharedMemoryV2Repository: V2StoreRepositoryContract | null = null;

export function getSharedMemoryV2Repository(): V2StoreRepositoryContract {
  if (!sharedMemoryV2Repository) {
    sharedMemoryV2Repository = createMemoryV2Repository();
  }
  return sharedMemoryV2Repository;
}
