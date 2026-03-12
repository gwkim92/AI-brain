import { randomUUID } from 'node:crypto';

import type { MemoryNoteRecord, MemorySegmentRecord } from '../types';
import type { MemoryRepositoryContract } from '../repository-contracts';
import type { MemoryStoreState } from './state';

type MemoryMemoryRepositoryDeps = {
  state: MemoryStoreState;
};

export function createMemoryMemoryRepository({ state }: MemoryMemoryRepositoryDeps): MemoryRepositoryContract {
  return {
    async createMemorySegment(input) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const record: MemorySegmentRecord = {
        id,
        userId: input.userId,
        taskId: input.taskId ?? null,
        segmentType: input.segmentType,
        content: input.content,
        confidence: input.confidence ?? 0.5,
        createdAt: now,
        expiresAt: input.expiresAt ?? null
      };
      state.memorySegments.set(id, record);
      return record;
    },

    async searchMemoryByEmbedding(input) {
      const minConf = input.minConfidence ?? 0;
      return Array.from(state.memorySegments.values())
        .filter((segment) => segment.userId === input.userId && segment.confidence >= minConf)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, input.limit);
    },

    async listMemorySegments(input) {
      return Array.from(state.memorySegments.values())
        .filter((segment) => segment.userId === input.userId)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, input.limit);
    },

    async createMemoryNote(input) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const record: MemoryNoteRecord = {
        id,
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        content: input.content,
        key: input.key ?? null,
        value: input.value ?? null,
        attributes: input.attributes ?? {},
        tags: Array.from(new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))),
        pinned: input.pinned ?? false,
        source: input.source ?? 'manual',
        relatedSessionId: input.relatedSessionId ?? null,
        relatedTaskId: input.relatedTaskId ?? null,
        createdAt: now,
        updatedAt: now
      };
      state.memoryNotes.set(id, record);
      return record;
    },

    async listMemoryNotes(input) {
      return Array.from(state.memoryNotes.values())
        .filter((note) => note.userId === input.userId)
        .filter((note) => (input.kind ? note.kind === input.kind : true))
        .filter((note) => (typeof input.pinned === 'boolean' ? note.pinned === input.pinned : true))
        .sort((left, right) => {
          if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
          return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        })
        .slice(0, input.limit);
    },

    async updateMemoryNote(input) {
      const existing = state.memoryNotes.get(input.noteId);
      if (!existing || existing.userId !== input.userId) return null;
      const updated: MemoryNoteRecord = {
        ...existing,
        title: typeof input.title === 'string' ? input.title : existing.title,
        content: typeof input.content === 'string' ? input.content : existing.content,
        key: Object.prototype.hasOwnProperty.call(input, 'key') ? input.key ?? null : existing.key,
        value: Object.prototype.hasOwnProperty.call(input, 'value') ? input.value ?? null : existing.value,
        attributes: Object.prototype.hasOwnProperty.call(input, 'attributes') ? input.attributes ?? {} : existing.attributes,
        tags: Array.isArray(input.tags)
          ? Array.from(new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)))
          : existing.tags,
        pinned: typeof input.pinned === 'boolean' ? input.pinned : existing.pinned,
        updatedAt: new Date().toISOString()
      };
      state.memoryNotes.set(input.noteId, updated);
      return updated;
    },

    async deleteMemoryNote(input) {
      const existing = state.memoryNotes.get(input.noteId);
      if (!existing || existing.userId !== input.userId) return false;
      state.memoryNotes.delete(input.noteId);
      return true;
    }
  };
}
