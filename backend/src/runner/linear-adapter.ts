import type { AppEnv } from '../config/env';
import { buildLinearIssuesQuery, fetchLinearIssues } from '../integrations/linear/client';
import type { WorkItem, WorkItemState } from '../store/types';

function mapLinearState(stateType: string | null | undefined): WorkItemState {
  const normalized = stateType?.trim().toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'cancelled';
  if (normalized === 'started' || normalized === 'in_progress') return 'running';
  return 'queued';
}

export const buildLinearQuery = buildLinearIssuesQuery;

export async function listLinearWorkItems(env: AppEnv, limit: number, userId: string): Promise<WorkItem[]> {
  if (!env.LINEAR_API_KEY?.trim()) {
    return [];
  }

  const issues = await fetchLinearIssues(env, limit);
  return issues.map((issue) => {
    const blockedBy = issue.relations?.nodes
      ?.filter((relation) => relation.type?.trim().toLowerCase() === 'blocked_by')
      .map((relation) => relation.relatedIssue?.identifier ?? '')
      .filter((identifier) => identifier.trim().length > 0) ?? [];

    return {
      source: 'linear',
      externalId: issue.id,
      identifier: issue.identifier,
      userId,
      taskId: null,
      title: issue.title,
      description: issue.description?.trim() || issue.title,
      state: mapLinearState(issue.state?.type),
      priority: typeof issue.priority === 'number' ? issue.priority : null,
      labels: issue.labels?.nodes?.map((label) => label.name?.trim() ?? '').filter((label) => label.length > 0) ?? [],
      branchName: issue.branchName?.trim() || `linear/${issue.identifier.toLowerCase()}`,
      url: issue.url?.trim() || null,
      blockedBy,
      workspaceKey: `linear-${issue.identifier.toLowerCase()}`,
      payload: {
        team_id: issue.team?.id ?? null,
        project_id: issue.project?.id ?? null,
        state_name: issue.state?.name ?? null
      }
    };
  });
}
