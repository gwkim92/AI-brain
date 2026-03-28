import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAppliedHyperAgentArtifactOverrides,
  listAppliedHyperAgentArtifactOverrides,
} from '../../hyperagent/runtime';
import { buildServer } from '../../server';
import { getSharedMemoryV2Repository, resetSharedMemoryV2Repository } from '../../store/memory/v2-repositories';
import { getWorldModelDossierConfig } from '../../world-model/config';

const ENV_SNAPSHOT = { ...process.env };

describe('v2 hyperagent routes', () => {
  beforeEach(() => {
    resetSharedMemoryV2Repository();
    clearAppliedHyperAgentArtifactOverrides();
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PORT = '4024';
    process.env.AUTH_REQUIRED = 'false';
    process.env.AUTH_TOKEN = 'test_auth_token';
    process.env.LOCAL_LLM_ENABLED = 'false';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';
    process.env.OPENAI_WEBHOOK_SECRET = 'openai_secret';
    process.env.HIGH_RISK_ALLOWED_ROLES = 'operator,admin';
    process.env.V2_ROUTES_ENABLED = 'true';
    process.env.V2_HYPERAGENT_ENABLED = 'true';
  });

  afterEach(() => {
    resetSharedMemoryV2Repository();
    clearAppliedHyperAgentArtifactOverrides();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ENV_SNAPSHOT };
  });

  it('enforces auth for v2 hyperagent routes while leaving v2 health public', async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN = '';
    process.env.ADMIN_BOOTSTRAP_EMAIL = 'admin@jarvis.local';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'Admin!234567';
    process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME = 'Jarvis Admin';

    const { app } = await buildServer();

    const health = await app.inject({
      method: 'GET',
      url: '/api/v2/health',
    });
    expect(health.statusCode).toBe(200);

    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/v2/hyperagents/artifacts',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@jarvis.local',
        password: 'Admin!234567',
      },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json() as { data: { token: string } };

    const authenticated = await app.inject({
      method: 'GET',
      url: '/api/v2/hyperagents/artifacts',
      headers: {
        authorization: `Bearer ${loginBody.data.token}`,
      },
    });
    expect(authenticated.statusCode).toBe(200);

    await app.close();
  });

  it('creates, evaluates, recommends, and applies a world-model variant', async () => {
    const { app } = await buildServer();

    const artifacts = await app.inject({
      method: 'GET',
      url: '/api/v2/hyperagents/artifacts',
      headers: { 'x-user-role': 'operator' },
    });
    expect(artifacts.statusCode).toBe(200);

    const fixtures = await app.inject({
      method: 'GET',
      url: '/api/v2/hyperagents/world-model/fixtures',
      headers: { 'x-user-role': 'operator' },
    });
    expect(fixtures.statusCode).toBe(200);
    const fixturesBody = fixtures.json() as {
      data: { default_fixture_set: string; fixture_sets: Array<{ key: string; fixtureCount: number }> };
    };
    expect(fixturesBody.data.default_fixture_set).toBe('world_model_smoke_v1');
    expect(fixturesBody.data.fixture_sets[0]?.fixtureCount).toBeGreaterThan(0);

    const snapshotResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/hyperagents/world-model/snapshots',
      headers: { 'x-user-role': 'operator' },
      payload: {
        artifact_key: 'world_model_dossier_config',
      },
    });
    expect(snapshotResponse.statusCode).toBe(201);
    const snapshotBody = snapshotResponse.json() as {
      data: { snapshot: { id: string } };
    };

    const variantResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/hyperagents/world-model/variants',
      headers: { 'x-user-role': 'operator' },
      payload: {
        artifact_snapshot_id: snapshotBody.data.snapshot.id,
        mutation_budget: 1,
      },
    });
    expect(variantResponse.statusCode).toBe(201);
    const variantBody = variantResponse.json() as {
      data: { variant: { id: string; payload: { maxBottlenecks: number }; lineageRunId: string } };
    };

    const evalResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/hyperagents/evals',
      headers: { 'x-user-role': 'operator' },
      payload: {
        variant_id: variantBody.data.variant.id,
      },
    });
    expect(evalResponse.statusCode).toBe(200);
    const evalBody = evalResponse.json() as {
      data: {
        eval_run: {
          id: string;
          status: string;
          summary: { promotionScore: number };
        };
      };
    };
    expect(evalBody.data.eval_run.status).toBe('completed');
    expect(evalBody.data.eval_run.summary.promotionScore).toBeGreaterThanOrEqual(0.8);

    const evalDetail = await app.inject({
      method: 'GET',
      url: `/api/v2/hyperagents/evals/${evalBody.data.eval_run.id}`,
      headers: { 'x-user-role': 'operator' },
    });
    expect(evalDetail.statusCode).toBe(200);

    const recommendationResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/hyperagents/recommendations',
      headers: { 'x-user-role': 'operator' },
      payload: {
        eval_run_id: evalBody.data.eval_run.id,
      },
    });
    expect(recommendationResponse.statusCode).toBe(201);
    const recommendationBody = recommendationResponse.json() as {
      data: { recommendation: { id: string; status: string } };
    };
    expect(recommendationBody.data.recommendation.status).toBe('proposed');

    const recommendationDetail = await app.inject({
      method: 'GET',
      url: `/api/v2/hyperagents/recommendations/${recommendationBody.data.recommendation.id}`,
      headers: { 'x-user-role': 'operator' },
    });
    expect(recommendationDetail.statusCode).toBe(200);
    const recommendationDetailBody = recommendationDetail.json() as {
      data: {
        lineage_run_id: string;
        diff: { changeCount: number; entries: Array<{ path: string }> };
      };
    };
    expect(recommendationDetailBody.data.lineage_run_id).toBe(variantBody.data.variant.lineageRunId);
    expect(recommendationDetailBody.data.diff.changeCount).toBeGreaterThan(0);
    expect(recommendationDetailBody.data.diff.entries[0]?.path).toBeTruthy();

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/hyperagents/recommendations/${recommendationBody.data.recommendation.id}/decision`,
      headers: { 'x-user-role': 'operator' },
      payload: {
        decision: 'accept',
        summary: {
          operatorNote: 'accept after review',
          operatorDecision: 'accept',
        },
      },
    });
    expect(acceptResponse.statusCode).toBe(200);
    const acceptBody = acceptResponse.json() as {
      data: { recommendation: { summary: { promotionScore: number; operatorNote: string } } };
    };
    expect(acceptBody.data.recommendation.summary.promotionScore).toBeGreaterThanOrEqual(0.8);
    expect(acceptBody.data.recommendation.summary.operatorNote).toBe('accept after review');

    const applyResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/hyperagents/recommendations/${recommendationBody.data.recommendation.id}/apply`,
      headers: { 'x-user-role': 'operator' },
    });
    expect(applyResponse.statusCode).toBe(200);

    const runtimeResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/hyperagents/runtime',
      headers: { 'x-user-role': 'operator' },
    });
    expect(runtimeResponse.statusCode).toBe(200);
    const runtimeBody = runtimeResponse.json() as {
      data: {
        applied_overrides: Array<{ artifactKey: string; recommendationId: string }>;
      };
    };
    expect(runtimeBody.data.applied_overrides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKey: 'world_model_dossier_config',
          recommendationId: recommendationBody.data.recommendation.id,
        }),
      ])
    );
    expect(getWorldModelDossierConfig().maxBottlenecks).toBe(variantBody.data.variant.payload.maxBottlenecks);

    const overviewResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/hyperagents/overview',
      headers: { 'x-user-role': 'operator' },
    });
    expect(overviewResponse.statusCode).toBe(200);
    const overviewBody = overviewResponse.json() as {
      data: {
        summary: { total: number; applied_count: number; statuses: Record<string, number> };
        runs: Array<{
          runtime_applied: boolean;
          lineage_run_id: string;
          gate: { passed: boolean };
          applied_override: { recommendationId: string } | null;
          diff: { changeCount: number };
          lineage: { nodeCount: number; edgeCount: number } | null;
        }>;
      };
    };
    expect(overviewBody.data.summary.total).toBeGreaterThanOrEqual(1);
    expect(overviewBody.data.summary.applied_count).toBe(1);
    expect(overviewBody.data.summary.statuses.applied).toBe(1);
    expect(overviewBody.data.runs[0]).toMatchObject({
      runtime_applied: true,
      lineage_run_id: variantBody.data.variant.lineageRunId,
      gate: { passed: true },
      applied_override: { recommendationId: recommendationBody.data.recommendation.id },
    });
    expect(overviewBody.data.runs[0]?.diff.changeCount).toBeGreaterThan(0);
    expect(overviewBody.data.runs[0]?.lineage?.nodeCount).toBeGreaterThan(0);
    expect(overviewBody.data.runs[0]?.lineage?.edgeCount).toBeGreaterThan(0);

    const lineageResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/hyperagents/lineage/${variantBody.data.variant.lineageRunId}`,
      headers: { 'x-user-role': 'operator' },
    });
    expect(lineageResponse.statusCode).toBe(200);
    const lineageBody = lineageResponse.json() as {
      data: {
        lineage: {
          nodes: Array<{ nodeType: string }>;
          edges: Array<{ edgeType: string }>;
        };
      };
    };
    expect(lineageBody.data.lineage.nodes.map((node) => node.nodeType)).toEqual(
      expect.arrayContaining(['hyperagent_variant', 'hyperagent_eval', 'hyperagent_recommendation', 'hyperagent_apply'])
    );
    expect(lineageBody.data.lineage.edges.map((edge) => edge.edgeType)).toEqual(
      expect.arrayContaining(['seed_snapshot', 'evaluated_by', 'proposed_from', 'applied'])
    );

    await app.close();
  });

  it('blocks apply when the recommendation promotion score is below threshold', async () => {
    const repo = getSharedMemoryV2Repository();
    const snapshot = await repo.createHyperAgentArtifactSnapshot({
      artifactKey: 'world_model_dossier_config',
      artifactVersion: '2026-03-24',
      scope: 'world_model',
      payload: { maxNextWatchSignals: 5 },
      createdBy: 'system',
    });
    const variant = await repo.createHyperAgentVariant({
      artifactSnapshotId: snapshot.id,
      strategy: 'manual_seed',
      payload: { maxNextWatchSignals: 2 },
      parentVariantId: null,
      lineageRunId: 'run-low-score',
    });
    const evalRun = await repo.createHyperAgentEvalRun({
      variantId: variant.id,
      evaluatorKey: 'world_model_backtest_v1',
      status: 'completed',
      summary: { promotionScore: 0.42 },
    });
    const recommendation = await repo.createHyperAgentRecommendation({
      evalRunId: evalRun.id,
      variantId: variant.id,
      status: 'accepted',
      summary: { promotionScore: 0.42 },
    });

    const { app } = await buildServer();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v2/hyperagents/recommendations/${recommendation.id}/apply`,
      headers: { 'x-user-role': 'operator' },
    });
    expect(response.statusCode).toBe(409);
    expect(listAppliedHyperAgentArtifactOverrides()).toHaveLength(0);

    await app.close();
  });
});
