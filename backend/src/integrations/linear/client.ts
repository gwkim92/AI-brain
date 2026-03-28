import type { AppEnv } from '../../config/env';

export type LinearIssueNode = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url?: string | null;
  priority?: number | null;
  branchName?: string | null;
  labels?: {
    nodes?: Array<{ name?: string | null }>;
  } | null;
  state?: {
    type?: string | null;
    name?: string | null;
  } | null;
  team?: {
    id?: string | null;
    key?: string | null;
    name?: string | null;
  } | null;
  project?: {
    id?: string | null;
    name?: string | null;
  } | null;
  assignee?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
  relations?: {
    nodes?: Array<{
      type?: string | null;
      relatedIssue?: {
        identifier?: string | null;
      } | null;
    }>;
  } | null;
};

type LinearIssuesResponse = {
  data?: {
    issues?: {
      nodes?: LinearIssueNode[];
    };
  };
  errors?: Array<{ message?: string }>;
};

type LinearCommentResponse = {
  errors?: Array<{ message?: string }>;
};

function assertLinearConfigured(env: AppEnv): string {
  const apiKey = env.LINEAR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('linear_api_key_missing');
  }
  return apiKey;
}

export function buildLinearIssuesQuery(limit: number, env: AppEnv): { query: string; variables: Record<string, unknown> } {
  const filters = ['state: { type: { nin: ["completed", "canceled"] } }'];
  const variableDefinitions = ['$first: Int!'];
  const variables: Record<string, unknown> = {
    first: limit
  };

  if (env.LINEAR_TEAM_ID?.trim()) {
    filters.unshift('team: { id: { eq: $teamId } }');
    variableDefinitions.push('$teamId: ID');
    variables.teamId = env.LINEAR_TEAM_ID;
  }
  if (env.LINEAR_PROJECT_ID?.trim()) {
    filters.unshift('project: { id: { eq: $projectId } }');
    variableDefinitions.push('$projectId: ID');
    variables.projectId = env.LINEAR_PROJECT_ID;
  }

  return {
    query: `
      query RunnerLinearIssues(${variableDefinitions.join(', ')}) {
        issues(
          first: $first
          filter: {
            ${filters.join('\n            ')}
          }
        ) {
          nodes {
            id
            identifier
            title
            description
            url
            priority
            branchName
            state { type name }
            team { id key name }
            project { id name }
            assignee { id name email }
            labels { nodes { name } }
            relations { nodes { type relatedIssue { identifier } } }
          }
        }
      }
    `,
    variables
  };
}

export async function fetchLinearIssues(env: AppEnv, limit: number): Promise<LinearIssueNode[]> {
  const apiKey = assertLinearConfigured(env);
  const response = await fetch(env.LINEAR_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey
    },
    body: JSON.stringify(buildLinearIssuesQuery(limit, env))
  });
  if (!response.ok) {
    throw new Error(`linear_fetch_failed:${response.status}`);
  }

  const payload = (await response.json()) as LinearIssuesResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message ?? 'unknown linear error').join('; '));
  }

  return payload.data?.issues?.nodes ?? [];
}

export function buildLinearCommentMutation(issueId: string, body: string): {
  query: string;
  variables: Record<string, unknown>;
} {
  return {
    query: `
      mutation JarvisLinearComment($issueId: String!, $body: String!) {
        commentCreate(input: {
          issueId: $issueId
          body: $body
        }) {
          success
        }
      }
    `,
    variables: {
      issueId,
      body
    }
  };
}

export async function postLinearComment(env: AppEnv, issueId: string, body: string): Promise<void> {
  const apiKey = assertLinearConfigured(env);
  const response = await fetch(env.LINEAR_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey
    },
    body: JSON.stringify(buildLinearCommentMutation(issueId, body))
  });
  if (!response.ok) {
    throw new Error(`linear_comment_failed:${response.status}`);
  }
  const payload = (await response.json()) as LinearCommentResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message ?? 'unknown linear error').join('; '));
  }
}
