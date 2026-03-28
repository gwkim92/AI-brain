import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { evaluateHyperAgentRecommendationGate } from '../../evals/gate';
import {
  listEditableHyperAgentArtifacts,
  snapshotArtifactPayload,
} from '../../hyperagent/artifact-catalog';
import { buildHyperAgentArtifactDiff } from '../../hyperagent/diff';
import {
  DEFAULT_WORLD_MODEL_FIXTURE_SET_KEY,
  listWorldModelFixtureSets,
  resolveWorldModelEvaluationFixtures,
  WORLD_MODEL_FIXTURE_SET_KEYS,
} from '../../hyperagent/fixtures';
import {
  applyHyperAgentRecommendation,
  listAppliedHyperAgentArtifactOverrides,
} from '../../hyperagent/runtime';
import { generateBoundedVariant } from '../../hyperagent/optimizer';
import { evaluateWorldModelVariant } from '../../hyperagent/world-model-evaluator';
import { sendError, sendSuccess } from '../../lib/http';
import { getSharedMemoryV2Repository } from '../../store/memory/v2-repositories';
import { createPostgresV2Repository } from '../../store/postgres/v2-repositories';
import type { V2StoreRepositoryContract } from '../../store/repository-contracts';
import type { V2HyperAgentRecommendationRecord } from '../../store/types';
import type { ResearchProfile } from '../../retrieval/research-profile';
import type { HyperAgentArtifactKey } from '../../hyperagent/types';
import type { V2RouteContext } from './types';

const ARTIFACT_KEYS = ['radar_domain_pack', 'world_model_dossier_config'] as const satisfies readonly HyperAgentArtifactKey[];
const WorldModelFixtureSetSchema = z.enum(WORLD_MODEL_FIXTURE_SET_KEYS);
const RESEARCH_PROFILE_VALUES = [
  'broad_news',
  'topic_news',
  'entity_brief',
  'comparison_research',
  'repo_research',
  'market_research',
  'policy_regulation',
] as const satisfies readonly ResearchProfile[];

const ArtifactKeySchema = z.enum(ARTIFACT_KEYS);

const SummaryRecordSchema = z.record(z.string(), z.unknown());

const SnapshotCreateSchema = z.object({
  artifact_key: ArtifactKeySchema,
  artifact_version: z.string().min(1).max(120).optional(),
});

const SnapshotListQuerySchema = z.object({
  artifact_key: ArtifactKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const VariantCreateSchema = z.object({
  artifact_snapshot_id: z.string().uuid(),
  mutation_budget: z.coerce.number().int().min(1).max(6).default(1),
  parent_variant_id: z.string().uuid().nullable().optional(),
  lineage_run_id: z.string().min(1).max(120).optional(),
});

const VariantListQuerySchema = z.object({
  artifact_snapshot_id: z.string().uuid().optional(),
  lineage_run_id: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const SourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(240),
  domain: z.string().min(1).max(240),
  snippet: z.string().min(1).max(4000).optional(),
  publishedAt: z.string().datetime().optional(),
});

const ClaimSchema = z.object({
  claimText: z.string().min(1).max(4000),
  sourceUrls: z.array(z.string().url()).min(1).max(20),
});

const FixtureSchema = z.object({
  fixtureId: z.string().min(1).max(120),
  extractionInput: z.object({
    query: z.string().min(1).max(4000),
    researchProfile: z.enum(RESEARCH_PROFILE_VALUES),
    generatedAt: z.string().datetime().optional(),
    sources: z.array(SourceSchema).min(1).max(20),
    claims: z.array(ClaimSchema).min(1).max(40),
  }),
  expectedPrimaryThesisPresent: z.boolean().optional(),
  expectedCounterHypothesisPresent: z.boolean().optional(),
  minInvalidationConditions: z.coerce.number().int().min(0).max(50).optional(),
  minBottlenecks: z.coerce.number().int().min(0).max(20).optional(),
  maxNextWatchSignals: z.coerce.number().int().min(1).max(20).optional(),
});

const EvalCreateSchema = z.object({
  variant_id: z.string().uuid(),
  evaluator_key: z.literal('world_model_backtest_v1').default('world_model_backtest_v1'),
  fixture_set: WorldModelFixtureSetSchema.optional(),
  fixtures: z.array(FixtureSchema).min(1).max(50).optional(),
});

const EvalParamsSchema = z.object({
  id: z.string().uuid(),
});

const LineageParamsSchema = z.object({
  runId: z.string().min(1).max(120),
});

const RecommendationCreateSchema = z.object({
  eval_run_id: z.string().uuid(),
  summary: SummaryRecordSchema.optional(),
});

const RecommendationStatusSchema = z.enum(['proposed', 'accepted', 'rejected', 'applied']);

const RecommendationListQuerySchema = z.object({
  status: RecommendationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const OverviewListQuerySchema = z.object({
  status: RecommendationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

const RecommendationDecisionSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  summary: SummaryRecordSchema.optional(),
});

const RecommendationParamsSchema = z.object({
  recommendationId: z.string().uuid(),
});

function getRepository(ctx: V2RouteContext): V2StoreRepositoryContract {
  const pool = ctx.store.getPool();
  return pool ? createPostgresV2Repository(pool) : getSharedMemoryV2Repository();
}

function assertOperator(ctx: V2RouteContext, request: Parameters<V2RouteContext['ensureMinRole']>[0], reply: Parameters<V2RouteContext['ensureMinRole']>[1]) {
  return ctx.ensureMinRole(request, reply, 'operator');
}

function resolveArtifactKey(value: string): HyperAgentArtifactKey | null {
  if (value === 'radar_domain_pack' || value === 'world_model_dossier_config') {
    return value;
  }
  return null;
}

function buildRecommendationSummary(input: {
  recommendation: V2HyperAgentRecommendationRecord;
  gateReasons?: string[];
  appliedArtifactKey?: string;
}): Record<string, unknown> {
  return {
    ...input.recommendation.summary,
    gate: input.gateReasons ? { passed: input.gateReasons.length === 0, reasons: input.gateReasons } : undefined,
    appliedArtifactKey: input.appliedArtifactKey ?? (input.recommendation.summary.appliedArtifactKey as string | undefined),
  };
}

async function buildRecommendationOverviewItem(
  repo: V2StoreRepositoryContract,
  recommendation: V2HyperAgentRecommendationRecord
): Promise<{
  artifact: ReturnType<typeof listEditableHyperAgentArtifacts>[number] | null;
  snapshot: Awaited<ReturnType<V2StoreRepositoryContract['getHyperAgentArtifactSnapshotById']>>;
  variant: Awaited<ReturnType<V2StoreRepositoryContract['getHyperAgentVariantById']>>;
  evalRun: Awaited<ReturnType<V2StoreRepositoryContract['getHyperAgentEvalRunById']>>;
  lineageRunId: string | null;
  diff: ReturnType<typeof buildHyperAgentArtifactDiff> | null;
  gate: ReturnType<typeof evaluateHyperAgentRecommendationGate>;
  appliedOverride: ReturnType<typeof listAppliedHyperAgentArtifactOverrides>[number] | null;
  runtimeApplied: boolean;
  lineage: { nodeCount: number; edgeCount: number } | null;
}> {
  const [variant, evalRun] = await Promise.all([
    repo.getHyperAgentVariantById({ variantId: recommendation.variantId }),
    repo.getHyperAgentEvalRunById({ evalRunId: recommendation.evalRunId }),
  ]);

  const snapshot = variant
    ? await repo.getHyperAgentArtifactSnapshotById({
        artifactSnapshotId: variant.artifactSnapshotId,
      })
    : null;
  const artifact = snapshot
    ? listEditableHyperAgentArtifacts().find((entry) => entry.artifactKey === snapshot.artifactKey) ?? null
    : null;
  const diff = snapshot && variant
    ? buildHyperAgentArtifactDiff({
        beforePayload: snapshot.payload,
        afterPayload: variant.payload,
      })
    : null;
  const appliedOverride = snapshot
    ? listAppliedHyperAgentArtifactOverrides().find((entry) => entry.artifactKey === snapshot.artifactKey) ?? null
    : null;
  const runtimeApplied = appliedOverride?.recommendationId === recommendation.id;
  const lineage = variant
    ? await repo.listLineageByRun({
        runId: variant.lineageRunId,
      })
    : null;

  return {
    artifact,
    snapshot,
    variant,
    evalRun,
    lineageRunId: variant?.lineageRunId ?? null,
    diff,
    gate: evaluateHyperAgentRecommendationGate({
      recommendationStatus: recommendation.status,
      summary: recommendation.summary,
    }),
    appliedOverride,
    runtimeApplied,
    lineage: lineage
      ? {
          nodeCount: lineage.nodes.length,
          edgeCount: lineage.edges.length,
        }
      : null,
  };
}

export async function registerV2HyperAgentRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.get('/api/v2/hyperagents/artifacts', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const appliedByArtifact = new Map(
      listAppliedHyperAgentArtifactOverrides().map((entry) => [entry.artifactKey, entry] as const)
    );

    return sendSuccess(reply, request, 200, {
      artifacts: listEditableHyperAgentArtifacts().map((artifact) => ({
        ...artifact,
        applied_override: appliedByArtifact.get(artifact.artifactKey) ?? null,
      })),
    });
  });

  app.get('/api/v2/hyperagents/runtime', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    return sendSuccess(reply, request, 200, {
      applied_overrides: listAppliedHyperAgentArtifactOverrides(),
    });
  });

  app.get('/api/v2/hyperagents/overview', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = OverviewListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent overview query', parsed.error.flatten());
    }

    const repo = getRepository(ctx);
    const recommendations = await repo.listHyperAgentRecommendations({
      status: parsed.data.status,
      limit: parsed.data.limit,
    });
    const runs = await Promise.all(
      recommendations.map(async (recommendation) => {
        const item = await buildRecommendationOverviewItem(repo, recommendation);
        return {
          artifact: item.artifact,
          snapshot: item.snapshot,
          variant: item.variant,
          eval_run: item.evalRun,
          recommendation,
          lineage_run_id: item.lineageRunId,
          lineage: item.lineage,
          diff: item.diff,
          gate: item.gate,
          applied_override: item.appliedOverride,
          runtime_applied: item.runtimeApplied,
        };
      })
    );

    return sendSuccess(reply, request, 200, {
      summary: {
        total: runs.length,
        applied_count: runs.filter((run) => run.runtime_applied).length,
        statuses: runs.reduce<Record<string, number>>((acc, run) => {
          acc[run.recommendation.status] = (acc[run.recommendation.status] ?? 0) + 1;
          return acc;
        }, {}),
      },
      runs,
    });
  });

  app.get('/api/v2/hyperagents/world-model/fixtures', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    return sendSuccess(reply, request, 200, {
      default_fixture_set: DEFAULT_WORLD_MODEL_FIXTURE_SET_KEY,
      fixture_sets: listWorldModelFixtureSets(),
    });
  });

  app.get('/api/v2/hyperagents/lineage/:runId', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = LineageParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent lineage run id', parsed.error.flatten());
    }

    return sendSuccess(reply, request, 200, {
      run_id: parsed.data.runId,
      lineage: await getRepository(ctx).listLineageByRun({ runId: parsed.data.runId }),
    });
  });

  app.post('/api/v2/hyperagents/world-model/snapshots', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = SnapshotCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent snapshot payload', parsed.error.flatten());
    }

    const repo = getRepository(ctx);
    const createdBy = ctx.resolveRequestUserId(request);
    const artifactVersion = parsed.data.artifact_version ?? new Date().toISOString().slice(0, 10);
    const snapshot = await repo.createHyperAgentArtifactSnapshot({
      artifactKey: parsed.data.artifact_key,
      artifactVersion,
      scope: 'world_model',
      payload: snapshotArtifactPayload(parsed.data.artifact_key),
      createdBy,
    });

    return sendSuccess(reply, request, 201, {
      snapshot,
    });
  });

  app.get('/api/v2/hyperagents/world-model/snapshots', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = SnapshotListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent snapshot query', parsed.error.flatten());
    }

    const repo = getRepository(ctx);
    const snapshots = await repo.listHyperAgentArtifactSnapshots({
      artifactKey: parsed.data.artifact_key,
      limit: parsed.data.limit,
    });

    return sendSuccess(reply, request, 200, {
      snapshots,
    });
  });

  app.post('/api/v2/hyperagents/world-model/variants', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = VariantCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent variant payload', parsed.error.flatten());
    }

    const repo = getRepository(ctx);
    const snapshot = await repo.getHyperAgentArtifactSnapshotById({
      artifactSnapshotId: parsed.data.artifact_snapshot_id,
    });
    if (!snapshot) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent artifact snapshot not found');
    }
    const artifactKey = resolveArtifactKey(snapshot.artifactKey);
    if (!artifactKey) {
      return sendError(reply, request, 409, 'CONFLICT', 'unsupported hyperagent artifact key');
    }

    const generated = await generateBoundedVariant({
      artifactKey,
      basePayload: snapshot.payload,
      mutationBudget: parsed.data.mutation_budget,
      parentVariantId: parsed.data.parent_variant_id ?? null,
      lineageRunId: parsed.data.lineage_run_id,
    });

    const variant = await repo.createHyperAgentVariant({
      artifactSnapshotId: snapshot.id,
      strategy: generated.strategy,
      payload: generated.payload,
      parentVariantId: parsed.data.parent_variant_id ?? null,
      lineageRunId: generated.metadata.lineageRunId,
    });

    const snapshotNode = await repo.createLineageNode({
      runId: generated.metadata.lineageRunId,
      nodeType: 'hyperagent_snapshot',
      referenceId: snapshot.id,
      metadata: {
        artifactKey: snapshot.artifactKey,
        artifactVersion: snapshot.artifactVersion,
      },
    });
    const variantNode = await repo.createLineageNode({
      runId: generated.metadata.lineageRunId,
      nodeType: 'hyperagent_variant',
      referenceId: variant.id,
      metadata: {
        artifactKey,
        strategy: variant.strategy,
        changedKeys: generated.changedKeys,
        parentVariantId: variant.parentVariantId,
      },
    });
    await repo.createLineageEdge({
      runId: generated.metadata.lineageRunId,
      sourceNodeId: snapshotNode.id,
      targetNodeId: variantNode.id,
      edgeType: 'seed_snapshot',
      metadata: {
        artifactSnapshotId: snapshot.id,
      },
    });

    return sendSuccess(reply, request, 201, {
      variant,
      archive: generated.metadata,
      changed_keys: generated.changedKeys,
    });
  });

  app.get('/api/v2/hyperagents/world-model/variants', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = VariantListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent variant query', parsed.error.flatten());
    }

    const repo = getRepository(ctx);
    const variants = await repo.listHyperAgentVariants({
      artifactSnapshotId: parsed.data.artifact_snapshot_id,
      lineageRunId: parsed.data.lineage_run_id,
      limit: parsed.data.limit,
    });

    return sendSuccess(reply, request, 200, {
      variants,
    });
  });

  app.post('/api/v2/hyperagents/evals', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = EvalCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent eval payload', parsed.error.flatten());
    }

    const repo = getRepository(ctx);
    const variant = await repo.getHyperAgentVariantById({
      variantId: parsed.data.variant_id,
    });
    if (!variant) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent variant not found');
    }
    const snapshot = await repo.getHyperAgentArtifactSnapshotById({
      artifactSnapshotId: variant.artifactSnapshotId,
    });
    if (!snapshot) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent artifact snapshot not found');
    }
    if (snapshot.artifactKey !== 'world_model_dossier_config') {
      return sendError(reply, request, 409, 'CONFLICT', 'world-model evaluator only supports dossier config variants');
    }

    const evalRun = await repo.createHyperAgentEvalRun({
      variantId: variant.id,
      evaluatorKey: parsed.data.evaluator_key,
      status: 'running',
      summary: {},
    });

    try {
      const resolvedFixtures = resolveWorldModelEvaluationFixtures({
        fixtureSetKey: parsed.data.fixture_set,
        fixtures: parsed.data.fixtures,
      });
      const result = await evaluateWorldModelVariant({
        artifactKey: 'world_model_dossier_config',
        payload: variant.payload,
        fixtures: resolvedFixtures.fixtures,
      });

      const completed = await repo.updateHyperAgentEvalRun({
        evalRunId: evalRun.id,
        status: 'completed',
        summary: {
          artifactKey: snapshot.artifactKey,
          evaluatedAt: result.evaluatedAt,
          fixtureSetKey: resolvedFixtures.fixtureSetKey,
          fixtureCount: resolvedFixtures.fixtures.length,
          metrics: result.metrics,
          caseResults: result.caseResults,
          promotionScore: result.metrics.promotionScore,
        },
      });
      const variantNode = await repo.createLineageNode({
        runId: variant.lineageRunId,
        nodeType: 'hyperagent_variant_reference',
        referenceId: variant.id,
        metadata: {
          artifactSnapshotId: variant.artifactSnapshotId,
        },
      });
      const evalNode = await repo.createLineageNode({
        runId: variant.lineageRunId,
        nodeType: 'hyperagent_eval',
        referenceId: evalRun.id,
        metadata: {
          evaluatorKey: evalRun.evaluatorKey,
          fixtureSetKey: resolvedFixtures.fixtureSetKey,
          fixtureCount: resolvedFixtures.fixtures.length,
          promotionScore: result.metrics.promotionScore,
          status: completed?.status ?? 'completed',
        },
      });
      await repo.createLineageEdge({
        runId: variant.lineageRunId,
        sourceNodeId: variantNode.id,
        targetNodeId: evalNode.id,
        edgeType: 'evaluated_by',
        metadata: {},
      });

      return sendSuccess(reply, request, 200, {
        eval_run: completed,
        result,
      });
    } catch (error) {
      const failed = await repo.updateHyperAgentEvalRun({
        evalRunId: evalRun.id,
        status: 'failed',
        summary: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return sendError(reply, request, 409, 'CONFLICT', 'hyperagent eval failed', failed?.summary);
    }
  });

  app.get('/api/v2/hyperagents/evals/:id', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = EvalParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent eval id', parsed.error.flatten());
    }

    const repo = getRepository(ctx);
    const evalRun = await repo.getHyperAgentEvalRunById({
      evalRunId: parsed.data.id,
    });
    if (!evalRun) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent eval run not found');
    }

    return sendSuccess(reply, request, 200, {
      eval_run: evalRun,
    });
  });

  app.post('/api/v2/hyperagents/recommendations', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = RecommendationCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent recommendation payload', parsed.error.flatten());
    }

    const repo = getRepository(ctx);
    const evalRun = await repo.getHyperAgentEvalRunById({
      evalRunId: parsed.data.eval_run_id,
    });
    if (!evalRun) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent eval run not found');
    }

    const recommendation = await repo.createHyperAgentRecommendation({
      evalRunId: evalRun.id,
      variantId: evalRun.variantId,
      status: 'proposed',
      summary: parsed.data.summary ?? evalRun.summary,
    });
    const variant = await repo.getHyperAgentVariantById({
      variantId: evalRun.variantId,
    });
    if (variant) {
      const evalNode = await repo.createLineageNode({
        runId: variant.lineageRunId,
        nodeType: 'hyperagent_eval_reference',
        referenceId: evalRun.id,
        metadata: {
          status: evalRun.status,
        },
      });
      const recommendationNode = await repo.createLineageNode({
        runId: variant.lineageRunId,
        nodeType: 'hyperagent_recommendation',
        referenceId: recommendation.id,
        metadata: {
          status: recommendation.status,
          promotionScore: recommendation.summary.promotionScore ?? null,
        },
      });
      await repo.createLineageEdge({
        runId: variant.lineageRunId,
        sourceNodeId: evalNode.id,
        targetNodeId: recommendationNode.id,
        edgeType: 'proposed_from',
        metadata: {},
      });
    }

    return sendSuccess(reply, request, 201, {
      recommendation,
    });
  });

  app.get('/api/v2/hyperagents/recommendations/:recommendationId', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsedParams = RecommendationParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent recommendation id', parsedParams.error.flatten());
    }

    const repo = getRepository(ctx);
    const recommendation = await repo.getHyperAgentRecommendationById({
      recommendationId: parsedParams.data.recommendationId,
    });
    if (!recommendation) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent recommendation not found');
    }

    const [variant, evalRun] = await Promise.all([
      repo.getHyperAgentVariantById({ variantId: recommendation.variantId }),
      repo.getHyperAgentEvalRunById({ evalRunId: recommendation.evalRunId }),
    ]);
    if (!variant) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent variant not found');
    }
    const snapshot = await repo.getHyperAgentArtifactSnapshotById({
      artifactSnapshotId: variant.artifactSnapshotId,
    });
    if (!snapshot) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent artifact snapshot not found');
    }

    const artifact = listEditableHyperAgentArtifacts().find((entry) => entry.artifactKey === snapshot.artifactKey) ?? null;
    const diff = buildHyperAgentArtifactDiff({
      beforePayload: snapshot.payload,
      afterPayload: variant.payload,
    });

    return sendSuccess(reply, request, 200, {
      artifact,
      snapshot,
      variant,
      eval_run: evalRun,
      recommendation,
      lineage_run_id: variant.lineageRunId,
      diff,
    });
  });

  app.get('/api/v2/hyperagents/recommendations', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsed = RecommendationListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent recommendation query', parsed.error.flatten());
    }

    const repo = getRepository(ctx);
    const recommendations = await repo.listHyperAgentRecommendations({
      status: parsed.data.status,
      limit: parsed.data.limit,
    });

    return sendSuccess(reply, request, 200, {
      recommendations,
    });
  });

  app.post('/api/v2/hyperagents/recommendations/:recommendationId/decision', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsedParams = RecommendationParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent recommendation id', parsedParams.error.flatten());
    }
    const parsedBody = RecommendationDecisionSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent recommendation decision', parsedBody.error.flatten());
    }

    const repo = getRepository(ctx);
    const current = await repo.getHyperAgentRecommendationById({
      recommendationId: parsedParams.data.recommendationId,
    });
    if (!current) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent recommendation not found');
    }
    const variant = await repo.getHyperAgentVariantById({
      variantId: current.variantId,
    });

    const status = parsedBody.data.decision === 'accept' ? 'accepted' : 'rejected';
    const updated = await repo.decideHyperAgentRecommendation({
      recommendationId: current.id,
      status,
      decidedBy: ctx.resolveRequestUserId(request),
      summary: parsedBody.data.summary
        ? {
            ...current.summary,
            ...parsedBody.data.summary,
          }
        : current.summary,
    });
    if (variant && updated) {
      const recommendationNode = await repo.createLineageNode({
        runId: variant.lineageRunId,
        nodeType: 'hyperagent_recommendation_reference',
        referenceId: current.id,
        metadata: {
          priorStatus: current.status,
        },
      });
      const decisionNode = await repo.createLineageNode({
        runId: variant.lineageRunId,
        nodeType: 'hyperagent_recommendation_decision',
        referenceId: updated.id,
        metadata: {
          status: updated.status,
          decidedBy: updated.decidedBy,
        },
      });
      await repo.createLineageEdge({
        runId: variant.lineageRunId,
        sourceNodeId: recommendationNode.id,
        targetNodeId: decisionNode.id,
        edgeType: 'decision',
        metadata: {},
      });
    }

    return sendSuccess(reply, request, 200, {
      recommendation: updated,
    });
  });

  app.post('/api/v2/hyperagents/recommendations/:recommendationId/apply', async (request, reply) => {
    if (!ctx.v2Flags.hyperAgentEnabled) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'v2 hyperagent routes are disabled');
    }
    const minRoleError = assertOperator(ctx, request, reply);
    if (minRoleError) return minRoleError;

    const parsedParams = RecommendationParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid hyperagent recommendation id', parsedParams.error.flatten());
    }

    const repo = getRepository(ctx);
    const current = await repo.getHyperAgentRecommendationById({
      recommendationId: parsedParams.data.recommendationId,
    });
    if (!current) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent recommendation not found');
    }
    const variant = await repo.getHyperAgentVariantById({
      variantId: current.variantId,
    });

    const gate = evaluateHyperAgentRecommendationGate({
      recommendationStatus: current.status,
      summary: current.summary,
    });
    if (!gate.passed) {
      return sendError(reply, request, 409, 'CONFLICT', 'hyperagent recommendation failed apply gate', gate);
    }

    const appliedArtifact = await applyHyperAgentRecommendation(repo, current.id);
    if (!appliedArtifact) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'hyperagent recommendation apply target not found');
    }

    const appliedAt = new Date().toISOString();
    const updated = await repo.decideHyperAgentRecommendation({
      recommendationId: current.id,
      status: 'applied',
      decidedBy: ctx.resolveRequestUserId(request),
      appliedAt,
      summary: buildRecommendationSummary({
        recommendation: current,
        gateReasons: [],
      appliedArtifactKey: appliedArtifact.artifactKey,
      }),
    });
    if (variant && updated) {
      const recommendationNode = await repo.createLineageNode({
        runId: variant.lineageRunId,
        nodeType: 'hyperagent_recommendation_apply_source',
        referenceId: current.id,
        metadata: {
          status: current.status,
        },
      });
      const applyNode = await repo.createLineageNode({
        runId: variant.lineageRunId,
        nodeType: 'hyperagent_apply',
        referenceId: updated.id,
        metadata: {
          artifactKey: appliedArtifact.artifactKey,
          appliedAt,
          appliedVariantId: appliedArtifact.variantId,
        },
      });
      await repo.createLineageEdge({
        runId: variant.lineageRunId,
        sourceNodeId: recommendationNode.id,
        targetNodeId: applyNode.id,
        edgeType: 'applied',
        metadata: {},
      });
    }

    return sendSuccess(reply, request, 200, {
      recommendation: updated,
      applied_artifact: appliedArtifact,
    });
  });
}
