import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../config/env';
import { buildLinearQuery, listLinearWorkItems } from '../linear-adapter';

function makeEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    LINEAR_API_KEY: 'lin_api_test',
    LINEAR_BASE_URL: 'https://api.linear.app/graphql',
    LINEAR_TEAM_ID: 'team_123',
    LINEAR_PROJECT_ID: undefined,
    DEFAULT_USER_ID: '00000000-0000-4000-8000-000000000001',
    ...overrides
  } as unknown as AppEnv;
}

describe('linear adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits project filters when project id is not configured', () => {
    const env = makeEnv({
      LINEAR_PROJECT_ID: undefined
    });

    const built = buildLinearQuery(5, env);

    expect(built.query).toContain('team: { id: { eq: $teamId } }');
    expect(built.query).not.toContain('project: { id: { eq: $projectId } }');
    expect(built.query).toContain('query RunnerLinearIssues($first: Int!, $teamId: ID)');
    expect(built.query).not.toContain('$projectId: ID');
    expect(built.variables).toEqual({
      first: 5,
      teamId: 'team_123'
    });
  });

  it('maps fetched issues into work items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            issues: {
              nodes: [
                {
                  id: 'issue-1',
                  identifier: 'WOO-1',
                  title: 'Get familiar with Linear',
                  description: 'Read the docs',
                  url: 'https://linear.app/issue/WOO-1',
                  priority: 1,
                  branchName: null,
                  state: {
                    name: 'Todo',
                    type: 'unstarted'
                  },
                  team: {
                    id: 'team_123'
                  },
                  project: null,
                  labels: {
                    nodes: [{ name: 'onboarding' }]
                  },
                  relations: {
                    nodes: [
                      {
                        type: 'blocked_by',
                        relatedIssue: {
                          identifier: 'WOO-0'
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        })
      })
    );

    const env = makeEnv();
    const items = await listLinearWorkItems(env, 5, env.DEFAULT_USER_ID);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'linear',
      identifier: 'WOO-1',
      title: 'Get familiar with Linear',
      description: 'Read the docs',
      state: 'queued',
      labels: ['onboarding'],
      blockedBy: ['WOO-0'],
      workspaceKey: 'linear-woo-1'
    });
  });
});
