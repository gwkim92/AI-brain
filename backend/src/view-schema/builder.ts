import type { TaskStatus, V2RiskLevel } from '../store/types';

export type TaskViewSchema = {
  version: '1.0';
  task_id: string;
  layout: 'single' | 'split' | 'board';
  widgets: Array<{
    id: string;
    type: string;
    title: string;
    props: Record<string, unknown>;
    visible_when?: string;
  }>;
  actions: Array<{
    id: 'pause' | 'resume' | 'retry' | 'replan' | 'approve' | 'rollback';
    enabled: boolean;
    reason?: string;
  }>;
};

function canRetry(status: TaskStatus): boolean {
  return status === 'failed' || status === 'blocked' || status === 'retrying';
}

export function buildTaskViewSchema(input: {
  taskId: string;
  mode: string;
  status: TaskStatus;
  riskLevel: V2RiskLevel;
  policyDecision: 'allow' | 'deny' | 'approval_required';
}): TaskViewSchema {
  const needsApproval = input.policyDecision === 'approval_required';
  const blockedByPolicy = input.policyDecision === 'deny';
  const running = input.status === 'running';

  return {
    version: '1.0',
    task_id: input.taskId,
    layout: input.mode === 'council' || input.mode === 'code' ? 'split' : 'single',
    widgets: [
      {
        id: 'task-status',
        type: 'status_card',
        title: 'Task Status',
        props: {
          status: input.status,
          mode: input.mode
        }
      },
      {
        id: 'risk-policy',
        type: 'risk_policy',
        title: 'Risk & Policy',
        props: {
          risk_level: input.riskLevel,
          policy_decision: input.policyDecision
        }
      },
      {
        id: 'activity-timeline',
        type: 'timeline',
        title: 'Activity',
        props: {
          source: `/api/v1/tasks/${input.taskId}/events`
        }
      }
    ],
    actions: [
      {
        id: 'pause',
        enabled: running
      },
      {
        id: 'resume',
        enabled: input.status === 'blocked' && !blockedByPolicy
      },
      {
        id: 'retry',
        enabled: canRetry(input.status)
      },
      {
        id: 'replan',
        enabled: input.status === 'blocked' || input.status === 'failed'
      },
      {
        id: 'approve',
        enabled: needsApproval,
        reason: needsApproval ? undefined : 'approval_not_required'
      },
      {
        id: 'rollback',
        enabled: input.status === 'failed' || input.status === 'done'
      }
    ]
  };
}
