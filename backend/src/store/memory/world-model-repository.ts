import { randomUUID } from 'node:crypto';

import type {
  WorldModelConstraintRecord,
  WorldModelEntityRecord,
  WorldModelEventRecord,
  WorldModelHypothesisEvidenceRecord,
  WorldModelHypothesisRecord,
  WorldModelInvalidationConditionRecord,
  WorldModelObservationRecord,
  WorldModelOutcomeRecord,
  WorldModelProjectionRecord,
  WorldModelStateSnapshotRecord,
} from '../types';
import type { JarvisStore } from '../types';
import type { MemoryStoreState } from './state';

type MemoryWorldModelRepositoryDeps = {
  state: MemoryStoreState;
  nowIso: () => string;
};

type WorldModelRepositoryContract = Pick<
  JarvisStore,
  | 'upsertWorldModelEntity'
  | 'listWorldModelEntities'
  | 'createWorldModelEvent'
  | 'listWorldModelEvents'
  | 'createWorldModelObservation'
  | 'listWorldModelObservations'
  | 'createWorldModelConstraint'
  | 'listWorldModelConstraints'
  | 'updateWorldModelConstraint'
  | 'createWorldModelHypothesis'
  | 'listWorldModelHypotheses'
  | 'updateWorldModelHypothesis'
  | 'createWorldModelHypothesisEvidence'
  | 'listWorldModelHypothesisEvidence'
  | 'createWorldModelInvalidationCondition'
  | 'listWorldModelInvalidationConditions'
  | 'updateWorldModelInvalidationCondition'
  | 'createWorldModelStateSnapshot'
  | 'listWorldModelStateSnapshots'
  | 'createWorldModelProjection'
  | 'listWorldModelProjections'
  | 'updateWorldModelProjection'
  | 'createWorldModelOutcome'
  | 'listWorldModelOutcomes'
>;

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}

function copyEntity(row: WorldModelEntityRecord): WorldModelEntityRecord {
  return { ...row, aliases: [...row.aliases], attributes: { ...row.attributes } };
}

function copyEvent(row: WorldModelEventRecord): WorldModelEventRecord {
  return { ...row, attributes: { ...row.attributes } };
}

function copyObservation(row: WorldModelObservationRecord): WorldModelObservationRecord {
  return { ...row, attributes: { ...row.attributes } };
}

function copyConstraint(row: WorldModelConstraintRecord): WorldModelConstraintRecord {
  return { ...row, attributes: { ...row.attributes } };
}

function copyHypothesis(row: WorldModelHypothesisRecord): WorldModelHypothesisRecord {
  return { ...row };
}

function copyHypothesisEvidence(row: WorldModelHypothesisEvidenceRecord): WorldModelHypothesisEvidenceRecord {
  return { ...row, sourceUrls: [...row.sourceUrls] };
}

function copyInvalidationCondition(
  row: WorldModelInvalidationConditionRecord
): WorldModelInvalidationConditionRecord {
  return { ...row, attributes: { ...row.attributes } };
}

function copyStateSnapshot(row: WorldModelStateSnapshotRecord): WorldModelStateSnapshotRecord {
  return { ...row, stateJson: { ...row.stateJson } };
}

function copyProjection(row: WorldModelProjectionRecord): WorldModelProjectionRecord {
  return { ...row, summaryJson: { ...row.summaryJson } };
}

function copyOutcome(row: WorldModelOutcomeRecord): WorldModelOutcomeRecord {
  return { ...row, missedInvalidators: [...row.missedInvalidators] };
}

export function createMemoryWorldModelRepository({
  state,
  nowIso,
}: MemoryWorldModelRepositoryDeps): WorldModelRepositoryContract {
  return {
    async upsertWorldModelEntity(input) {
      const normalizedName = input.canonicalName.trim().toLowerCase();
      const existing = [...state.worldModelEntities.values()].find(
        (row) =>
          row.userId === input.userId &&
          row.kind === input.kind &&
          row.canonicalName.trim().toLowerCase() === normalizedName
      );
      const now = nowIso();
      const aliases = Array.from(new Set((input.aliases ?? []).map((value) => value.trim()).filter(Boolean)));
      if (existing) {
        const next: WorldModelEntityRecord = {
          ...existing,
          aliases,
          attributes: { ...(input.attributes ?? {}) },
          updatedAt: now,
        };
        state.worldModelEntities.set(next.id, next);
        return copyEntity(next);
      }

      const row: WorldModelEntityRecord = {
        id: randomUUID(),
        userId: input.userId,
        kind: input.kind,
        canonicalName: input.canonicalName.trim(),
        aliases,
        attributes: { ...(input.attributes ?? {}) },
        createdAt: now,
        updatedAt: now,
      };
      state.worldModelEntities.set(row.id, row);
      return copyEntity(row);
    },

    async listWorldModelEntities(input) {
      return [...state.worldModelEntities.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.kind ? row.kind === input.kind : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyEntity);
    },

    async createWorldModelEvent(input) {
      const row: WorldModelEventRecord = {
        id: randomUUID(),
        userId: input.userId,
        dossierId: input.dossierId ?? null,
        kind: input.kind,
        summary: input.summary,
        occurredAt: input.occurredAt ?? null,
        recordedAt: input.recordedAt ?? null,
        attributes: { ...(input.attributes ?? {}) },
        createdAt: nowIso(),
      };
      state.worldModelEvents.set(row.id, row);
      return copyEvent(row);
    },

    async listWorldModelEvents(input) {
      return [...state.worldModelEvents.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.dossierId ? row.dossierId === input.dossierId : true))
        .filter((row) => (input.kind ? row.kind === input.kind : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyEvent);
    },

    async createWorldModelObservation(input) {
      const row: WorldModelObservationRecord = {
        id: randomUUID(),
        userId: input.userId,
        dossierId: input.dossierId ?? null,
        metricKey: input.metricKey,
        valueText: input.valueText,
        unit: input.unit ?? null,
        observedAt: input.observedAt ?? null,
        recordedAt: input.recordedAt ?? null,
        attributes: { ...(input.attributes ?? {}) },
        createdAt: nowIso(),
      };
      state.worldModelObservations.set(row.id, row);
      return copyObservation(row);
    },

    async listWorldModelObservations(input) {
      return [...state.worldModelObservations.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.dossierId ? row.dossierId === input.dossierId : true))
        .filter((row) => (input.metricKey ? row.metricKey === input.metricKey : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyObservation);
    },

    async createWorldModelConstraint(input) {
      const now = nowIso();
      const row: WorldModelConstraintRecord = {
        id: randomUUID(),
        userId: input.userId,
        dossierId: input.dossierId ?? null,
        kind: input.kind,
        description: input.description,
        severity: input.severity ?? 'medium',
        status: input.status ?? 'active',
        attributes: { ...(input.attributes ?? {}) },
        createdAt: now,
        updatedAt: now,
      };
      state.worldModelConstraints.set(row.id, row);
      return copyConstraint(row);
    },

    async listWorldModelConstraints(input) {
      return [...state.worldModelConstraints.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.dossierId ? row.dossierId === input.dossierId : true))
        .filter((row) => (input.kind ? row.kind === input.kind : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyConstraint);
    },

    async updateWorldModelConstraint(input) {
      const existing = state.worldModelConstraints.get(input.constraintId);
      if (!existing || existing.userId !== input.userId) return null;
      const next: WorldModelConstraintRecord = {
        ...existing,
        description: input.description ?? existing.description,
        severity: input.severity ?? existing.severity,
        status: input.status ?? existing.status,
        attributes: typeof input.attributes === 'object' && input.attributes !== null
          ? { ...input.attributes }
          : existing.attributes,
        updatedAt: nowIso(),
      };
      state.worldModelConstraints.set(next.id, next);
      return copyConstraint(next);
    },

    async createWorldModelHypothesis(input) {
      const now = nowIso();
      const row: WorldModelHypothesisRecord = {
        id: randomUUID(),
        userId: input.userId,
        projectionId: input.projectionId ?? null,
        dossierId: input.dossierId ?? null,
        briefingId: input.briefingId ?? null,
        thesis: input.thesis,
        stance: input.stance,
        confidence: input.confidence ?? 0.5,
        status: input.status ?? 'active',
        summary: input.summary ?? null,
        createdAt: now,
        updatedAt: now,
      };
      state.worldModelHypotheses.set(row.id, row);
      return copyHypothesis(row);
    },

    async listWorldModelHypotheses(input) {
      return [...state.worldModelHypotheses.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.hypothesisId ? row.id === input.hypothesisId : true))
        .filter((row) => (input.projectionId ? row.projectionId === input.projectionId : true))
        .filter((row) => (input.dossierId ? row.dossierId === input.dossierId : true))
        .filter((row) => (input.briefingId ? row.briefingId === input.briefingId : true))
        .filter((row) => (input.status ? row.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyHypothesis);
    },

    async updateWorldModelHypothesis(input) {
      const existing = state.worldModelHypotheses.get(input.hypothesisId);
      if (!existing || existing.userId !== input.userId) return null;
      const next: WorldModelHypothesisRecord = {
        ...existing,
        confidence: typeof input.confidence === 'number' ? input.confidence : existing.confidence,
        status: input.status ?? existing.status,
        summary: Object.prototype.hasOwnProperty.call(input, 'summary')
          ? (input.summary ?? null)
          : existing.summary,
        updatedAt: nowIso(),
      };
      state.worldModelHypotheses.set(next.id, next);
      return copyHypothesis(next);
    },

    async createWorldModelHypothesisEvidence(input) {
      const row: WorldModelHypothesisEvidenceRecord = {
        id: randomUUID(),
        hypothesisId: input.hypothesisId,
        dossierId: input.dossierId ?? null,
        claimText: input.claimText,
        relation: input.relation ?? 'supports',
        sourceUrls: [...(input.sourceUrls ?? [])],
        weight: typeof input.weight === 'number' ? input.weight : 0.5,
        createdAt: nowIso(),
      };
      state.worldModelHypothesisEvidence.set(row.id, row);
      return copyHypothesisEvidence(row);
    },

    async listWorldModelHypothesisEvidence(input) {
      return [...state.worldModelHypothesisEvidence.values()]
        .filter((row) => row.hypothesisId === input.hypothesisId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyHypothesisEvidence);
    },

    async createWorldModelInvalidationCondition(input) {
      const now = nowIso();
      const row: WorldModelInvalidationConditionRecord = {
        id: randomUUID(),
        hypothesisId: input.hypothesisId,
        description: input.description,
        expectedBy: input.expectedBy ?? null,
        observedStatus: input.observedStatus ?? 'pending',
        severity: input.severity ?? 'medium',
        attributes: { ...(input.attributes ?? {}) },
        createdAt: now,
        updatedAt: now,
      };
      state.worldModelInvalidationConditions.set(row.id, row);
      return copyInvalidationCondition(row);
    },

    async listWorldModelInvalidationConditions(input) {
      return [...state.worldModelInvalidationConditions.values()]
        .filter((row) => row.hypothesisId === input.hypothesisId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyInvalidationCondition);
    },

    async updateWorldModelInvalidationCondition(input) {
      const existing = state.worldModelInvalidationConditions.get(input.invalidationConditionId);
      if (!existing) return null;
      const next: WorldModelInvalidationConditionRecord = {
        ...existing,
        observedStatus: input.observedStatus ?? existing.observedStatus,
        expectedBy: Object.prototype.hasOwnProperty.call(input, 'expectedBy')
          ? (input.expectedBy ?? null)
          : existing.expectedBy,
        severity: input.severity ?? existing.severity,
        attributes: Object.prototype.hasOwnProperty.call(input, 'attributes')
          ? { ...(input.attributes ?? {}) }
          : existing.attributes,
        updatedAt: nowIso(),
      };
      state.worldModelInvalidationConditions.set(next.id, next);
      return copyInvalidationCondition(next);
    },

    async createWorldModelStateSnapshot(input) {
      const row: WorldModelStateSnapshotRecord = {
        id: randomUUID(),
        userId: input.userId,
        targetType: input.targetType,
        targetId: input.targetId,
        stateJson: { ...input.stateJson },
        createdAt: nowIso(),
      };
      state.worldModelStateSnapshots.set(row.id, row);
      return copyStateSnapshot(row);
    },

    async listWorldModelStateSnapshots(input) {
      return [...state.worldModelStateSnapshots.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.targetType ? row.targetType === input.targetType : true))
        .filter((row) => (input.targetId ? row.targetId === input.targetId : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyStateSnapshot);
    },

    async createWorldModelProjection(input) {
      const now = nowIso();
      const row: WorldModelProjectionRecord = {
        id: randomUUID(),
        userId: input.userId,
        dossierId: input.dossierId ?? null,
        briefingId: input.briefingId ?? null,
        watcherId: input.watcherId ?? null,
        sessionId: input.sessionId ?? null,
        origin: input.origin,
        status: input.status ?? 'active',
        generatedAt: input.generatedAt ?? now,
        supersededAt: null,
        supersededByProjectionId: null,
        summaryJson: { ...(input.summaryJson ?? {}) },
        createdAt: now,
        updatedAt: now,
      };
      state.worldModelProjections.set(row.id, row);
      return copyProjection(row);
    },

    async listWorldModelProjections(input) {
      return [...state.worldModelProjections.values()]
        .filter((row) => (input.userId ? row.userId === input.userId : true))
        .filter((row) => (input.projectionId ? row.id === input.projectionId : true))
        .filter((row) => (input.dossierId ? row.dossierId === input.dossierId : true))
        .filter((row) => (input.briefingId ? row.briefingId === input.briefingId : true))
        .filter((row) => (input.watcherId ? row.watcherId === input.watcherId : true))
        .filter((row) => (input.sessionId ? row.sessionId === input.sessionId : true))
        .filter((row) => (input.status ? row.status === input.status : true))
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyProjection);
    },

    async updateWorldModelProjection(input) {
      const existing = state.worldModelProjections.get(input.projectionId);
      if (!existing || existing.userId !== input.userId) return null;
      const next: WorldModelProjectionRecord = {
        ...existing,
        status: input.status ?? existing.status,
        supersededAt: Object.prototype.hasOwnProperty.call(input, 'supersededAt')
          ? (input.supersededAt ?? null)
          : existing.supersededAt,
        supersededByProjectionId: Object.prototype.hasOwnProperty.call(input, 'supersededByProjectionId')
          ? (input.supersededByProjectionId ?? null)
          : existing.supersededByProjectionId,
        summaryJson: Object.prototype.hasOwnProperty.call(input, 'summaryJson')
          ? { ...(input.summaryJson ?? {}) }
          : existing.summaryJson,
        updatedAt: nowIso(),
      };
      state.worldModelProjections.set(next.id, next);
      return copyProjection(next);
    },

    async createWorldModelOutcome(input) {
      const row: WorldModelOutcomeRecord = {
        id: randomUUID(),
        userId: input.userId,
        hypothesisId: input.hypothesisId,
        evaluatedAt: input.evaluatedAt ?? nowIso(),
        result: input.result,
        errorNotes: input.errorNotes ?? null,
        horizonRealized: input.horizonRealized ?? null,
        missedInvalidators: [...(input.missedInvalidators ?? [])],
        createdAt: nowIso(),
      };
      state.worldModelOutcomes.set(row.id, row);
      return copyOutcome(row);
    },

    async listWorldModelOutcomes(input) {
      return [...state.worldModelOutcomes.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.hypothesisId ? row.hypothesisId === input.hypothesisId : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, normalizeLimit(input.limit))
        .map(copyOutcome);
    },
  };
}
