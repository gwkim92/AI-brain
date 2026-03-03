import { randomUUID } from 'node:crypto';

import type { AppendTaskEventInput, CreateTaskInput, TaskEventRecord, TaskStatus } from '../types';
import type { TaskRepositoryContract } from '../repository-contracts';
import type { MemoryStoreState } from './state';

type MemoryTaskRepositoryDeps = {
  state: MemoryStoreState;
  defaultUserId: string;
  nowIso: () => string;
};

async function appendTaskEventRecord(state: MemoryStoreState, nowIso: () => string, event: AppendTaskEventInput) {
  const next: TaskEventRecord = {
    id: randomUUID(),
    taskId: event.taskId,
    type: event.type,
    timestamp: nowIso(),
    data: event.data,
    traceId: event.traceId,
    spanId: event.spanId
  };

  const prev = state.taskEvents.get(event.taskId) ?? [];
  prev.push(next);
  state.taskEvents.set(event.taskId, prev);

  return next;
}

export function createMemoryTaskRepository({
  state,
  defaultUserId,
  nowIso
}: MemoryTaskRepositoryDeps): TaskRepositoryContract {
  return {
    async createTask(input: CreateTaskInput) {
      const now = nowIso();
      const task = {
        id: randomUUID(),
        userId: input.userId || defaultUserId,
        mode: input.mode,
        status: 'queued' as const,
        title: input.title,
        input: input.input,
        idempotencyKey: input.idempotencyKey,
        traceId: input.traceId,
        createdAt: now,
        updatedAt: now
      };

      state.tasks.set(task.id, task);

      await appendTaskEventRecord(state, nowIso, {
        taskId: task.id,
        type: 'task.created',
        data: {
          mode: task.mode,
          status: task.status
        }
      });

      return task;
    },

    async setTaskStatus(input: {
      taskId: string;
      status: TaskStatus;
      eventType?: string;
      data?: Record<string, unknown>;
      traceId?: string;
      spanId?: string;
    }) {
      const current = state.tasks.get(input.taskId);
      if (!current) {
        return null;
      }

      const next = {
        ...current,
        status: input.status,
        updatedAt: nowIso()
      };
      state.tasks.set(current.id, next);

      await appendTaskEventRecord(state, nowIso, {
        taskId: current.id,
        type: input.eventType ?? 'task.updated',
        data: {
          status: input.status,
          ...(input.data ?? {})
        },
        traceId: input.traceId,
        spanId: input.spanId
      });

      return next;
    },

    async listTasks(input: { userId?: string; status?: TaskStatus; limit: number }) {
      return [...state.tasks.values()]
        .filter((item) => (input.userId ? item.userId === input.userId : true))
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit);
    },

    async getTaskById(taskId: string) {
      return state.tasks.get(taskId) ?? null;
    },

    async appendTaskEvent(event: AppendTaskEventInput) {
      return appendTaskEventRecord(state, nowIso, event);
    },

    async listTaskEvents(taskId: string, limit: number) {
      const rows = state.taskEvents.get(taskId) ?? [];
      return rows.slice(Math.max(0, rows.length - limit));
    }
  };
}
