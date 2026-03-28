import { describe, expect, it } from 'vitest';

import { createMemoryV2Repository } from '../memory/v2-repositories';

describe('hyperagent v2 repository', () => {
  it('stores artifact snapshots, variants, eval runs, and recommendations', async () => {
    const repo = createMemoryV2Repository();

    const snapshot = await repo.createHyperAgentArtifactSnapshot({
      artifactKey: 'radar_domain_pack',
      artifactVersion: '2026-03-24',
      scope: 'world_model',
      payload: {
        domainId: 'policy_regulation_platform_ai',
        keywordLexicon: ['policy'],
      },
      createdBy: 'system',
    });

    const variant = await repo.createHyperAgentVariant({
      artifactSnapshotId: snapshot.id,
      strategy: 'bounded_json_mutation',
      payload: {
        domainId: 'policy_regulation_platform_ai',
        keywordLexicon: ['policy', 'regulation'],
      },
      parentVariantId: null,
      lineageRunId: 'run-1',
    });

    const evalRun = await repo.createHyperAgentEvalRun({
      variantId: variant.id,
      evaluatorKey: 'world_model_backtest_v1',
      status: 'running',
      summary: {},
    });

    const completed = await repo.updateHyperAgentEvalRun({
      evalRunId: evalRun.id,
      status: 'completed',
      summary: { promotionScore: 0.84 },
    });

    const recommendation = await repo.createHyperAgentRecommendation({
      evalRunId: evalRun.id,
      variantId: variant.id,
      status: 'proposed',
      summary: { promotionScore: 0.84 },
    });

    const accepted = await repo.decideHyperAgentRecommendation({
      recommendationId: recommendation.id,
      status: 'accepted',
      decidedBy: 'operator-1',
      summary: { promotionScore: 0.84, accepted: true },
    });

    const snapshots = await repo.listHyperAgentArtifactSnapshots({
      artifactKey: 'radar_domain_pack',
      limit: 10,
    });
    const fetchedSnapshot = await repo.getHyperAgentArtifactSnapshotById({
      artifactSnapshotId: snapshot.id,
    });
    const variants = await repo.listHyperAgentVariants({
      artifactSnapshotId: snapshot.id,
      limit: 10,
    });
    const fetchedVariant = await repo.getHyperAgentVariantById({
      variantId: variant.id,
    });
    const fetchedEvalRun = await repo.getHyperAgentEvalRunById({
      evalRunId: evalRun.id,
    });
    const fetchedRecommendation = await repo.getHyperAgentRecommendationById({
      recommendationId: recommendation.id,
    });
    const recommendations = await repo.listHyperAgentRecommendations({
      status: 'accepted',
      limit: 10,
    });

    expect(snapshot.artifactKey).toBe('radar_domain_pack');
    expect(variant.parentVariantId).toBeNull();
    expect(completed?.summary.promotionScore).toBe(0.84);
    expect(fetchedSnapshot?.id).toBe(snapshot.id);
    expect(fetchedVariant?.id).toBe(variant.id);
    expect(fetchedEvalRun?.status).toBe('completed');
    expect(snapshots).toHaveLength(1);
    expect(variants).toHaveLength(1);
    expect(accepted?.decidedBy).toBe('operator-1');
    expect(fetchedRecommendation?.id).toBe(recommendation.id);
    expect(recommendations).toHaveLength(1);
  });
});
