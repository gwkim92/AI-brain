import { randomUUID } from 'node:crypto';

import type { ExternalWorkRepositoryContract } from '../repository-contracts';
import type {
  CreateExternalWorkLinkInput,
  ExternalLinkTargetType,
  ExternalWorkItemRecord,
  ExternalWorkLinkRecord,
  ExternalWorkSource,
  ExternalWorkTriageStatus,
  UpdateExternalWorkItemInput,
  UpsertExternalWorkItemInput
} from '../types';
import type { MemoryStoreState } from './state';

type MemoryExternalWorkRepositoryDeps = {
  state: MemoryStoreState;
  nowIso: () => string;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildSourceKey(userId: string, source: ExternalWorkSource, externalId: string): string {
  return `${userId}:${source}:${externalId}`;
}

function toItem(row: ExternalWorkItemRecord): ExternalWorkItemRecord {
  return clone(row);
}

function toLink(row: ExternalWorkLinkRecord): ExternalWorkLinkRecord {
  return clone(row);
}

export function createMemoryExternalWorkRepository({
  state,
  nowIso
}: MemoryExternalWorkRepositoryDeps): ExternalWorkRepositoryContract {
  return {
    async upsertExternalWorkItems(input: { items: UpsertExternalWorkItemInput[] }) {
      const rows: ExternalWorkItemRecord[] = [];
      for (const item of input.items) {
        const sourceKey = buildSourceKey(item.userId, item.source, item.externalId);
        const existingId = state.externalWorkItemBySource.get(sourceKey);
        const current = existingId ? state.externalWorkItems.get(existingId) ?? null : null;
        const now = nowIso();
        const next: ExternalWorkItemRecord = current
          ? {
              ...current,
              identifier: item.identifier,
              title: item.title,
              description: item.description,
              url: item.url === undefined ? current.url : item.url ?? null,
              state: item.state,
              priority: item.priority === undefined ? current.priority : item.priority ?? null,
              labels: item.labels ? [...item.labels] : [...current.labels],
              triageStatus: item.triageStatus ?? current.triageStatus,
              displayMetadata: item.displayMetadata ? clone(item.displayMetadata) : clone(current.displayMetadata),
              rawPayload: item.rawPayload ? clone(item.rawPayload) : clone(current.rawPayload),
              lastSeenAt: item.lastSeenAt ?? now,
              lastSyncedAt: item.lastSyncedAt === undefined ? current.lastSyncedAt : item.lastSyncedAt,
              lastSyncError: item.lastSyncError === undefined ? current.lastSyncError : item.lastSyncError,
              updatedAt: now
            }
          : {
              id: randomUUID(),
              userId: item.userId,
              source: item.source,
              externalId: item.externalId,
              identifier: item.identifier,
              title: item.title,
              description: item.description,
              url: item.url ?? null,
              state: item.state,
              priority: item.priority ?? null,
              labels: [...(item.labels ?? [])],
              triageStatus: item.triageStatus ?? 'new',
              displayMetadata: clone(item.displayMetadata ?? {}),
              rawPayload: clone(item.rawPayload ?? {}),
              lastSeenAt: item.lastSeenAt ?? now,
              lastSyncedAt: item.lastSyncedAt ?? null,
              lastSyncError: item.lastSyncError ?? null,
              createdAt: now,
              updatedAt: now
            };
        state.externalWorkItems.set(next.id, next);
        state.externalWorkItemBySource.set(sourceKey, next.id);
        rows.push(toItem(next));
      }
      return rows;
    },

    async listExternalWorkItems(input: {
      userId: string;
      source?: ExternalWorkSource;
      triageStatus?: ExternalWorkTriageStatus;
      limit: number;
    }) {
      return [...state.externalWorkItems.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.source ? row.source === input.source : true))
        .filter((row) => (input.triageStatus ? row.triageStatus === input.triageStatus : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit)
        .map(toItem);
    },

    async getExternalWorkItemById(input: { itemId: string; userId: string }) {
      const row = state.externalWorkItems.get(input.itemId);
      if (!row || row.userId !== input.userId) {
        return null;
      }
      return toItem(row);
    },

    async getExternalWorkItemBySource(input: {
      userId: string;
      source: ExternalWorkSource;
      externalId: string;
    }) {
      const itemId = state.externalWorkItemBySource.get(buildSourceKey(input.userId, input.source, input.externalId));
      if (!itemId) {
        return null;
      }
      const row = state.externalWorkItems.get(itemId);
      return row ? toItem(row) : null;
    },

    async updateExternalWorkItem(input: UpdateExternalWorkItemInput) {
      const current = state.externalWorkItems.get(input.itemId);
      if (!current || current.userId !== input.userId) {
        return null;
      }
      const next: ExternalWorkItemRecord = {
        ...current,
        triageStatus: input.triageStatus ?? current.triageStatus,
        lastSyncedAt: input.lastSyncedAt === undefined ? current.lastSyncedAt : input.lastSyncedAt,
        lastSyncError: input.lastSyncError === undefined ? current.lastSyncError : input.lastSyncError,
        updatedAt: nowIso()
      };
      state.externalWorkItems.set(next.id, next);
      return toItem(next);
    },

    async createExternalWorkLink(input: CreateExternalWorkLinkInput) {
      const existing = [...state.externalWorkLinks.values()].find(
        (row) =>
          row.externalWorkItemId === input.externalWorkItemId &&
          row.targetType === input.targetType &&
          row.targetId === input.targetId &&
          row.role === input.role
      );
      if (existing) {
        return toLink(existing);
      }
      const row: ExternalWorkLinkRecord = {
        id: randomUUID(),
        externalWorkItemId: input.externalWorkItemId,
        targetType: input.targetType,
        targetId: input.targetId,
        role: input.role,
        createdAt: nowIso()
      };
      state.externalWorkLinks.set(row.id, row);
      return toLink(row);
    },

    async listExternalWorkLinksByItem(input: { itemId: string }) {
      return [...state.externalWorkLinks.values()]
        .filter((row) => row.externalWorkItemId === input.itemId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(toLink);
    },

    async listExternalWorkLinksByTarget(input: { targetType: ExternalLinkTargetType; targetId: string }) {
      return [...state.externalWorkLinks.values()]
        .filter((row) => row.targetType === input.targetType && row.targetId === input.targetId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(toLink);
    },

    async getPrimaryExternalWorkLinkByItem(input: { itemId: string }) {
      const row = [...state.externalWorkLinks.values()]
        .filter((candidate) => candidate.externalWorkItemId === input.itemId && candidate.role === 'primary')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
      return row ? toLink(row) : null;
    },

    async getPrimaryExternalWorkLinkByTarget(input: { targetType: ExternalLinkTargetType; targetId: string }) {
      const row = [...state.externalWorkLinks.values()]
        .filter(
          (candidate) =>
            candidate.targetType === input.targetType &&
            candidate.targetId === input.targetId &&
            candidate.role === 'primary'
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
      return row ? toLink(row) : null;
    }
  };
}
