import { describe, expect, it } from 'vitest';

import type { TaskRecord } from '../../store/types';
import { mapTaskRecordToWorkItem } from '../internal-task-adapter';

describe('mapTaskRecordToWorkItem', () => {
  it('normalizes internal task records into work items', () => {
    const task: TaskRecord = {
      id: 'task-123',
      userId: '00000000-0000-4000-8000-000000000001',
      mode: 'code',
      status: 'queued',
      title: 'Implement runner routes',
      input: {
        description: 'Add runner APIs and wire them into the web client',
        labels: ['runner', 'backend'],
        priority: 2,
        branch_name: 'feature/runner-routes',
        workspace_key: 'runner-routes'
      },
      idempotencyKey: 'idem-1',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z'
    };

    const workItem = mapTaskRecordToWorkItem(task);

    expect(workItem.source).toBe('internal_task');
    expect(workItem.identifier).toBe('task:task-123');
    expect(workItem.title).toBe('Implement runner routes');
    expect(workItem.description).toContain('runner APIs');
    expect(workItem.labels).toEqual(['runner', 'backend']);
    expect(workItem.branchName).toBe('feature/runner-routes');
    expect(workItem.workspaceKey).toBe('runner-routes');
  });
});
