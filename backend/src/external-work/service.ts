import type { AppEnv } from '../config/env';
import { fetchLinearIssues, postLinearComment, type LinearIssueNode } from '../integrations/linear/client';
import type {
  ExternalLinkTargetType,
  ExternalWorkLinkRecord,
  ExternalWorkItemRecord,
  JarvisStore,
  LinkedExternalWorkSummary,
  UpsertExternalWorkItemInput
} from '../store/types';

function mapLinearState(stateType: string | null | undefined): ExternalWorkItemRecord['state'] {
  const normalized = stateType?.trim().toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'cancelled';
  if (normalized === 'started' || normalized === 'in_progress') return 'running';
  return 'queued';
}

function buildLinearExternalWorkInput(userId: string, issue: LinearIssueNode): UpsertExternalWorkItemInput {
  return {
    userId,
    source: 'linear',
    externalId: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description?.trim() || issue.title,
    url: issue.url?.trim() || null,
    state: mapLinearState(issue.state?.type),
    priority: typeof issue.priority === 'number' ? issue.priority : null,
    labels: issue.labels?.nodes?.map((label) => label.name?.trim() ?? '').filter((label) => label.length > 0) ?? [],
    displayMetadata: {
      state_name: issue.state?.name ?? null,
      team_id: issue.team?.id ?? null,
      team_key: issue.team?.key ?? null,
      team_name: issue.team?.name ?? null,
      project_id: issue.project?.id ?? null,
      project_name: issue.project?.name ?? null,
      assignee_id: issue.assignee?.id ?? null,
      assignee_name: issue.assignee?.name ?? null,
      assignee_email: issue.assignee?.email ?? null
    },
    rawPayload: {
      branch_name: issue.branchName ?? null,
      relations:
        issue.relations?.nodes?.map((relation) => ({
          type: relation.type ?? null,
          related_identifier: relation.relatedIssue?.identifier ?? null
        })) ?? []
    },
    lastSeenAt: new Date().toISOString()
  };
}

export async function refreshLinearExternalWork(
  store: JarvisStore,
  env: AppEnv,
  userId: string,
  limit: number
): Promise<ExternalWorkItemRecord[]> {
  if (!env.LINEAR_API_KEY?.trim()) {
    return store.listExternalWorkItems({
      userId,
      source: 'linear',
      limit
    });
  }
  const issues = await fetchLinearIssues(env, limit);
  return store.upsertExternalWorkItems({
    items: issues.map((issue) => buildLinearExternalWorkInput(userId, issue))
  });
}

export function buildLinkedExternalWorkSummary(item: ExternalWorkItemRecord): LinkedExternalWorkSummary {
  return {
    itemId: item.id,
    source: item.source,
    identifier: item.identifier,
    title: item.title,
    url: item.url,
    triageStatus: item.triageStatus
  };
}

async function resolveExternalWorkLinkForTarget(
  store: JarvisStore,
  input: {
    targetType: ExternalLinkTargetType;
    targetId: string;
  }
): Promise<ExternalWorkLinkRecord | null> {
  const links = await store.listExternalWorkLinksByTarget({
    targetType: input.targetType,
    targetId: input.targetId
  });
  if (links.length === 0) {
    return null;
  }
  return links.find((link) => link.role === 'primary') ?? links[0] ?? null;
}

export async function getLinkedExternalWorkSummary(
  store: JarvisStore,
  input: {
    userId: string;
    targetType: ExternalLinkTargetType;
    targetId: string;
  }
): Promise<LinkedExternalWorkSummary | null> {
  const link = await resolveExternalWorkLinkForTarget(store, input);
  if (!link) {
    return null;
  }
  const item = await store.getExternalWorkItemById({
    itemId: link.externalWorkItemId,
    userId: input.userId
  });
  return item ? buildLinkedExternalWorkSummary(item) : null;
}

export async function createDerivedExternalWorkLink(
  store: JarvisStore,
  input: {
    fromTargetType: ExternalLinkTargetType;
    fromTargetId: string;
    toTargetType: ExternalLinkTargetType;
    toTargetId: string;
  }
) {
  const primary = await store.getPrimaryExternalWorkLinkByTarget({
    targetType: input.fromTargetType,
    targetId: input.fromTargetId
  });
  if (!primary) {
    return null;
  }
  return store.createExternalWorkLink({
    externalWorkItemId: primary.externalWorkItemId,
    targetType: input.toTargetType,
    targetId: input.toTargetId,
    role: 'derived'
  });
}

export async function syncExternalWorkCommentByItem(
  store: JarvisStore,
  env: AppEnv,
  input: {
    userId: string;
    itemId: string;
    body: string;
    successTriageStatus?: ExternalWorkItemRecord['triageStatus'];
  }
): Promise<{ ok: boolean; error?: string }> {
  const item = await store.getExternalWorkItemById({
    itemId: input.itemId,
    userId: input.userId
  });
  if (!item) {
    return {
      ok: false,
      error: 'external_work_item_not_found'
    };
  }
  if (item.source !== 'linear' || !env.LINEAR_API_KEY?.trim()) {
    return { ok: true };
  }
  try {
    await postLinearComment(env, item.externalId, input.body);
    await store.updateExternalWorkItem({
      itemId: item.id,
      userId: item.userId,
      triageStatus: input.successTriageStatus,
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: null
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'linear_comment_failed';
    await store.updateExternalWorkItem({
      itemId: item.id,
      userId: item.userId,
      triageStatus: 'sync_error',
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: message
    });
    return {
      ok: false,
      error: message
    };
  }
}

export async function syncExternalWorkCommentByTarget(
  store: JarvisStore,
  env: AppEnv,
  input: {
    targetType: ExternalLinkTargetType;
    targetId: string;
    userId: string;
    body: string;
  }
): Promise<{ ok: boolean; error?: string } | null> {
  const link = await resolveExternalWorkLinkForTarget(store, input);
  if (!link) {
    return null;
  }
  return syncExternalWorkCommentByItem(store, env, {
    userId: input.userId,
    itemId: link.externalWorkItemId,
    body: input.body
  });
}
