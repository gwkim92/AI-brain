import type { Pool } from 'pg';

import type { TaskRepositoryContract } from '../repository-contracts';
import type { TaskEventRow, TaskRow } from './types';
import type { AppendTaskEventInput, CreateTaskInput, TaskEventRecord, TaskRecord, TaskStatus } from '../types';

type TaskRepositoryDeps = {
  pool: Pool;
  defaultUserId: string;
};

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    status: row.status,
    title: row.title,
    input: row.input,
    idempotencyKey: row.idempotency_key,
    traceId: row.trace_id ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapTaskEventRow(row: TaskEventRow): TaskEventRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    timestamp: row.created_at.toISOString(),
    data: row.data,
    traceId: row.trace_id ?? undefined,
    spanId: row.span_id ?? undefined
  };
}

async function appendTaskEventRecord(pool: Pool, event: AppendTaskEventInput): Promise<TaskEventRecord> {
  const { rows } = await pool.query<TaskEventRow>(
    `
      INSERT INTO task_events (
        task_id,
        type,
        data,
        trace_id,
        span_id
      )
      VALUES ($1::uuid, $2, $3::jsonb, $4, $5)
      RETURNING id, task_id, type, data, trace_id, span_id, created_at
    `,
    [event.taskId, event.type, JSON.stringify(event.data), event.traceId ?? null, event.spanId ?? null]
  );

  return mapTaskEventRow(rows[0]!);
}

export function createTaskRepository({ pool, defaultUserId }: TaskRepositoryDeps): TaskRepositoryContract {
  return {
    async createTask(input: CreateTaskInput) {
      const { rows } = await pool.query<TaskRow>(
        `
          INSERT INTO tasks (
            user_id,
            mode,
            status,
            title,
            input,
            idempotency_key,
            trace_id
          )
          VALUES ($1::uuid, $2::task_mode, 'queued'::task_status, $3, $4::jsonb, $5, $6)
          RETURNING *
        `,
        [
          input.userId || defaultUserId,
          input.mode,
          input.title,
          JSON.stringify(input.input),
          input.idempotencyKey,
          input.traceId ?? null
        ]
      );

      const task = mapTaskRow(rows[0]!);

      await appendTaskEventRecord(pool, {
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
      const { rows } = await pool.query<TaskRow>(
        `
          UPDATE tasks
          SET status = $2::task_status,
              updated_at = now()
          WHERE id = $1::uuid
          RETURNING *
        `,
        [input.taskId, input.status]
      );

      if (!rows[0]) {
        return null;
      }

      const task = mapTaskRow(rows[0]);

      await appendTaskEventRecord(pool, {
        taskId: task.id,
        type: input.eventType ?? 'task.updated',
        data: {
          status: task.status,
          ...(input.data ?? {})
        },
        traceId: input.traceId,
        spanId: input.spanId
      });

      return task;
    },

    async listTasks(input: { userId?: string; status?: TaskStatus; limit: number }) {
      const params: unknown[] = [];
      const whereParts: string[] = [];

      if (input.userId) {
        params.push(input.userId);
        whereParts.push(`user_id = $${params.length}::uuid`);
      }

      if (input.status) {
        params.push(input.status);
        whereParts.push(`status = $${params.length}::task_status`);
      }

      params.push(input.limit);
      const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
      const limitParam = `$${params.length}`;

      const { rows } = await pool.query<TaskRow>(
        `
          SELECT *
          FROM tasks
          ${where}
          ORDER BY created_at DESC
          LIMIT ${limitParam}
        `,
        params
      );

      return rows.map((row) => mapTaskRow(row));
    },

    async getTaskById(taskId: string) {
      const { rows } = await pool.query<TaskRow>(
        `
          SELECT *
          FROM tasks
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [taskId]
      );

      return rows[0] ? mapTaskRow(rows[0]) : null;
    },

    async appendTaskEvent(event: AppendTaskEventInput) {
      return appendTaskEventRecord(pool, event);
    },

    async listTaskEvents(taskId: string, limit: number) {
      const { rows } = await pool.query<TaskEventRow>(
        `
          SELECT id, task_id, type, data, trace_id, span_id, created_at
          FROM task_events
          WHERE task_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [taskId, limit]
      );

      return rows.reverse().map((row) => mapTaskEventRow(row));
    }
  };
}
