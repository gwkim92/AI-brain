import { randomUUID } from 'node:crypto';

import type { MemorySegmentRecord } from '../types';
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
    }
  };
}
