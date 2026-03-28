import { randomUUID } from 'node:crypto';

import type { V2StoreRepositoryContract } from '../repository-contracts';
import type {
  V2CapabilityModuleRegistrationInput,
  V2CapabilityModuleRegistrationRecord,
  V2CapabilityModuleRecord,
  V2CapabilityModuleVersionRecord,
  V2ExecutionContractRecord,
  V2HyperAgentArtifactSnapshotRecord,
  V2HyperAgentEvalRunRecord,
  V2HyperAgentRecommendationRecord,
  V2HyperAgentVariantRecord,
  V2LineageEdgeRecord,
  V2LineageNodeRecord,
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
type V2HyperAgentArtifactSnapshotInsert = Omit<V2HyperAgentArtifactSnapshotRecord, 'id' | 'createdAt'>;
type V2HyperAgentVariantInsert = Omit<V2HyperAgentVariantRecord, 'id' | 'createdAt'>;
type V2HyperAgentEvalRunInsert = Omit<V2HyperAgentEvalRunRecord, 'id' | 'createdAt' | 'updatedAt'>;
type V2HyperAgentRecommendationInsert = Omit<
  V2HyperAgentRecommendationRecord,
  'id' | 'decidedBy' | 'decidedAt' | 'appliedAt' | 'createdAt' | 'updatedAt'
>;
type V2LineageNodeInsert = Omit<V2LineageNodeRecord, 'id' | 'createdAt'>;
type V2LineageEdgeInsert = Omit<V2LineageEdgeRecord, 'id' | 'createdAt'>;

export function createMemoryV2Repository(): V2StoreRepositoryContract {
  const commandCompilations = new Map<string, V2ExecutionContractRecord>();
  const retrievalQueries = new Map<string, V2RetrievalQueryRecord>();
  const retrievalEvidenceItems = new Map<string, V2RetrievalEvidenceItemRecord>();
  const retrievalScores = new Map<string, V2RetrievalScoreRecord>();
  const capabilityModules = new Map<string, V2CapabilityModuleRecord>();
  const capabilityModuleVersions = new Map<string, V2CapabilityModuleVersionRecord>();
  const taskViewSchemas = new Map<string, V2TaskViewSchemaRecord>();
  const hyperAgentArtifactSnapshots = new Map<string, V2HyperAgentArtifactSnapshotRecord>();
  const hyperAgentVariants = new Map<string, V2HyperAgentVariantRecord>();
  const hyperAgentEvalRuns = new Map<string, V2HyperAgentEvalRunRecord>();
  const hyperAgentRecommendations = new Map<string, V2HyperAgentRecommendationRecord>();
  const lineageNodes = new Map<string, V2LineageNodeRecord>();
  const lineageEdges = new Map<string, V2LineageEdgeRecord>();

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
    },

    async createHyperAgentArtifactSnapshot(input: V2HyperAgentArtifactSnapshotInsert) {
      const record: V2HyperAgentArtifactSnapshotRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      };
      hyperAgentArtifactSnapshots.set(record.id, record);
      return record;
    },

    async getHyperAgentArtifactSnapshotById(input: { artifactSnapshotId: string }) {
      return hyperAgentArtifactSnapshots.get(input.artifactSnapshotId) ?? null;
    },

    async listHyperAgentArtifactSnapshots(input: {
      scope?: V2HyperAgentArtifactSnapshotRecord['scope'];
      artifactKey?: string;
      limit: number;
    }) {
      return Array.from(hyperAgentArtifactSnapshots.values())
        .filter((record) => (input.scope ? record.scope === input.scope : true))
        .filter((record) => (input.artifactKey ? record.artifactKey === input.artifactKey : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit);
    },

    async createHyperAgentVariant(input: V2HyperAgentVariantInsert) {
      const record: V2HyperAgentVariantRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      };
      hyperAgentVariants.set(record.id, record);
      return record;
    },

    async getHyperAgentVariantById(input: { variantId: string }) {
      return hyperAgentVariants.get(input.variantId) ?? null;
    },

    async listHyperAgentVariants(input: {
      artifactSnapshotId?: string;
      lineageRunId?: string;
      limit: number;
    }) {
      return Array.from(hyperAgentVariants.values())
        .filter((record) => (input.artifactSnapshotId ? record.artifactSnapshotId === input.artifactSnapshotId : true))
        .filter((record) => (input.lineageRunId ? record.lineageRunId === input.lineageRunId : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit);
    },

    async createHyperAgentEvalRun(input: V2HyperAgentEvalRunInsert) {
      const now = new Date().toISOString();
      const record: V2HyperAgentEvalRunRecord = {
        ...input,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
      };
      hyperAgentEvalRuns.set(record.id, record);
      return record;
    },

    async updateHyperAgentEvalRun(input: {
      evalRunId: string;
      status?: V2HyperAgentEvalRunRecord['status'];
      summary?: Record<string, unknown>;
    }) {
      const current = hyperAgentEvalRuns.get(input.evalRunId) ?? null;
      if (!current) {
        return null;
      }
      const updated: V2HyperAgentEvalRunRecord = {
        ...current,
        status: input.status ?? current.status,
        summary: input.summary ?? current.summary,
        updatedAt: new Date().toISOString()
      };
      hyperAgentEvalRuns.set(updated.id, updated);
      return updated;
    },

    async getHyperAgentEvalRunById(input: { evalRunId: string }) {
      return hyperAgentEvalRuns.get(input.evalRunId) ?? null;
    },

    async createHyperAgentRecommendation(input: V2HyperAgentRecommendationInsert) {
      const now = new Date().toISOString();
      const record: V2HyperAgentRecommendationRecord = {
        ...input,
        id: randomUUID(),
        decidedBy: null,
        decidedAt: null,
        appliedAt: null,
        createdAt: now,
        updatedAt: now
      };
      hyperAgentRecommendations.set(record.id, record);
      return record;
    },

    async getHyperAgentRecommendationById(input: { recommendationId: string }) {
      return hyperAgentRecommendations.get(input.recommendationId) ?? null;
    },

    async listHyperAgentRecommendations(input: {
      status?: V2HyperAgentRecommendationRecord['status'];
      limit: number;
    }) {
      return Array.from(hyperAgentRecommendations.values())
        .filter((record) => (input.status ? record.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit);
    },

    async decideHyperAgentRecommendation(input: {
      recommendationId: string;
      status: V2HyperAgentRecommendationRecord['status'];
      decidedBy?: string | null;
      summary?: Record<string, unknown>;
      appliedAt?: string | null;
    }) {
      const current = hyperAgentRecommendations.get(input.recommendationId) ?? null;
      if (!current) {
        return null;
      }
      const decidedAt = input.status === 'proposed' ? null : new Date().toISOString();
      const updated: V2HyperAgentRecommendationRecord = {
        ...current,
        status: input.status,
        decidedBy: typeof input.decidedBy === 'undefined' ? current.decidedBy : input.decidedBy,
        decidedAt,
        appliedAt: typeof input.appliedAt === 'undefined' ? current.appliedAt : input.appliedAt,
        summary: input.summary ?? current.summary,
        updatedAt: new Date().toISOString()
      };
      hyperAgentRecommendations.set(updated.id, updated);
      return updated;
    },

    async createLineageNode(input: V2LineageNodeInsert) {
      const record: V2LineageNodeRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      };
      lineageNodes.set(record.id, record);
      return record;
    },

    async createLineageEdge(input: V2LineageEdgeInsert) {
      const record: V2LineageEdgeRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      };
      lineageEdges.set(record.id, record);
      return record;
    },

    async listLineageByRun(input: { runId: string }) {
      return {
        nodes: Array.from(lineageNodes.values())
          .filter((record) => record.runId === input.runId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
        edges: Array.from(lineageEdges.values())
          .filter((record) => record.runId === input.runId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      };
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

export function resetSharedMemoryV2Repository(): void {
  sharedMemoryV2Repository = null;
}
