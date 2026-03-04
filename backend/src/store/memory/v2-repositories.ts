import { randomUUID } from 'node:crypto';

import type { V2StoreRepositoryContract } from '../repository-contracts';
import type {
  V2CapabilityModuleRecord,
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
type V2TaskViewSchemaInsert = Omit<V2TaskViewSchemaRecord, 'id' | 'createdAt'>;

export function createMemoryV2Repository(): V2StoreRepositoryContract {
  const commandCompilations = new Map<string, V2ExecutionContractRecord>();
  const retrievalQueries = new Map<string, V2RetrievalQueryRecord>();
  const retrievalEvidenceItems = new Map<string, V2RetrievalEvidenceItemRecord>();
  const retrievalScores = new Map<string, V2RetrievalScoreRecord>();
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

let sharedMemoryV2Repository: V2StoreRepositoryContract | null = null;

export function getSharedMemoryV2Repository(): V2StoreRepositoryContract {
  if (!sharedMemoryV2Repository) {
    sharedMemoryV2Repository = createMemoryV2Repository();
  }
  return sharedMemoryV2Repository;
}
