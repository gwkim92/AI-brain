import type { JarvisStore, TaskRecord, TaskStatus, WorkItem, WorkItemState } from '../store/types';

const DELIVERY_TASK_MODES = new Set(['execute', 'code', 'long_run', 'high_risk', 'upgrade_execution']);
const CANDIDATE_TASK_STATUSES = new Set<TaskStatus>(['queued', 'retrying']);

function slugify(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || 'delivery-task';
}

function mapTaskStatus(status: TaskStatus): WorkItemState {
  if (status === 'running') return 'running';
  if (status === 'blocked') return 'blocked';
  if (status === 'done') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'queued';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
}

export function mapTaskRecordToWorkItem(task: TaskRecord): WorkItem {
  const input = task.input ?? {};
  const description =
    typeof input['description'] === 'string'
      ? input['description']
      : typeof input['prompt'] === 'string'
        ? input['prompt']
        : typeof input['query'] === 'string'
          ? input['query']
          : task.title;
  const branchName =
    typeof input['branch_name'] === 'string' && input['branch_name'].trim().length > 0
      ? input['branch_name'].trim()
      : `task/${slugify(task.title)}-${task.id.slice(0, 8)}`;

  return {
    source: 'internal_task',
    externalId: task.id,
    identifier: `task:${task.id}`,
    userId: task.userId,
    taskId: task.id,
    title: task.title,
    description,
    state: mapTaskStatus(task.status),
    priority: typeof input['priority'] === 'number' ? input['priority'] : null,
    labels: readStringArray(input['labels']),
    branchName,
    url: typeof input['url'] === 'string' ? input['url'] : null,
    blockedBy: readStringArray(input['blocked_by']),
    workspaceKey:
      typeof input['workspace_key'] === 'string' && input['workspace_key'].trim().length > 0
        ? input['workspace_key'].trim()
        : `task-${task.id}`,
    payload: { ...input }
  };
}

export async function listInternalTaskWorkItems(store: JarvisStore, limit: number): Promise<WorkItem[]> {
  const tasks = await store.listTasks({
    limit: Math.max(limit * 3, 30)
  });

  return tasks
    .filter((task) => DELIVERY_TASK_MODES.has(task.mode))
    .filter((task) => CANDIDATE_TASK_STATUSES.has(task.status))
    .map((task) => mapTaskRecordToWorkItem(task))
    .slice(0, limit);
}
