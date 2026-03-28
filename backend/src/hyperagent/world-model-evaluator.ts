import { buildWorldModelBlockFromExtraction } from '../world-model/dossier';
import { extractWorldModelCandidateFacts, type WorldModelExtractionInput } from '../world-model/extraction';
import type { WorldModelDossierConfigOverride } from '../world-model/config';

import { buildWorldModelEvalMetrics, type WorldModelEvalMetrics } from './scorecard';

type WorldModelVariantArtifactKey = 'world_model_dossier_config';

export type WorldModelEvaluationFixture = {
  fixtureId: string;
  extractionInput: WorldModelExtractionInput;
  expectedPrimaryThesisPresent?: boolean;
  expectedCounterHypothesisPresent?: boolean;
  minInvalidationConditions?: number;
  minBottlenecks?: number;
  maxNextWatchSignals?: number;
};

export type WorldModelFixtureEvaluationResult = {
  fixtureId: string;
  passed: boolean;
  score: number;
  details: {
    primaryThesisPresent: boolean;
    counterHypothesisPresent: boolean;
    invalidationConditionCount: number;
    bottleneckCount: number;
    nextWatchSignalCount: number;
    checks: Array<{
      key: string;
      passed: boolean;
      expected: unknown;
      actual: unknown;
    }>;
  };
};

export type WorldModelVariantEvaluationResult = {
  artifactKey: WorldModelVariantArtifactKey;
  evaluatedAt: string;
  metrics: WorldModelEvalMetrics;
  caseResults: WorldModelFixtureEvaluationResult[];
};

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toDossierConfigOverride(payload: Record<string, unknown>): WorldModelDossierConfigOverride {
  return {
    maxBottlenecks: typeof payload.maxBottlenecks === 'number' ? payload.maxBottlenecks : undefined,
    maxInvalidationConditions:
      typeof payload.maxInvalidationConditions === 'number' ? payload.maxInvalidationConditions : undefined,
    maxNextWatchSignals: typeof payload.maxNextWatchSignals === 'number' ? payload.maxNextWatchSignals : undefined,
    bottleneckScoreThreshold:
      typeof payload.bottleneckScoreThreshold === 'number' ? payload.bottleneckScoreThreshold : undefined,
  };
}

function evaluateFixture(input: {
  fixture: WorldModelEvaluationFixture;
  configOverride: WorldModelDossierConfigOverride;
}): WorldModelFixtureEvaluationResult {
  const extraction = extractWorldModelCandidateFacts(input.fixture.extractionInput);
  const block = buildWorldModelBlockFromExtraction({
    extraction,
    configOverride: input.configOverride,
  });

  const primaryThesisPresent = block.hypotheses.some((hypothesis) => hypothesis.stance === 'primary');
  const counterHypothesisPresent = block.hypotheses.some((hypothesis) => hypothesis.stance === 'counter');
  const invalidationConditionCount = block.invalidation_conditions.length;
  const bottleneckCount = block.bottlenecks.length;
  const nextWatchSignalCount = block.next_watch_signals.length;

  const checks: WorldModelFixtureEvaluationResult['details']['checks'] = [];

  if (typeof input.fixture.expectedPrimaryThesisPresent === 'boolean') {
    checks.push({
      key: 'expectedPrimaryThesisPresent',
      passed: primaryThesisPresent === input.fixture.expectedPrimaryThesisPresent,
      expected: input.fixture.expectedPrimaryThesisPresent,
      actual: primaryThesisPresent,
    });
  }

  if (typeof input.fixture.expectedCounterHypothesisPresent === 'boolean') {
    checks.push({
      key: 'expectedCounterHypothesisPresent',
      passed: counterHypothesisPresent === input.fixture.expectedCounterHypothesisPresent,
      expected: input.fixture.expectedCounterHypothesisPresent,
      actual: counterHypothesisPresent,
    });
  }

  if (typeof input.fixture.minInvalidationConditions === 'number') {
    checks.push({
      key: 'minInvalidationConditions',
      passed: invalidationConditionCount >= input.fixture.minInvalidationConditions,
      expected: input.fixture.minInvalidationConditions,
      actual: invalidationConditionCount,
    });
  }

  if (typeof input.fixture.minBottlenecks === 'number') {
    checks.push({
      key: 'minBottlenecks',
      passed: bottleneckCount >= input.fixture.minBottlenecks,
      expected: input.fixture.minBottlenecks,
      actual: bottleneckCount,
    });
  }

  if (typeof input.fixture.maxNextWatchSignals === 'number') {
    checks.push({
      key: 'maxNextWatchSignals',
      passed: nextWatchSignalCount <= input.fixture.maxNextWatchSignals,
      expected: input.fixture.maxNextWatchSignals,
      actual: nextWatchSignalCount,
    });
  }

  const passedChecks = checks.filter((check) => check.passed).length;
  const score = checks.length === 0 ? 1 : roundToFour(passedChecks / checks.length);

  return {
    fixtureId: input.fixture.fixtureId,
    passed: checks.every((check) => check.passed),
    score,
    details: {
      primaryThesisPresent,
      counterHypothesisPresent,
      invalidationConditionCount,
      bottleneckCount,
      nextWatchSignalCount,
      checks,
    },
  };
}

export async function evaluateWorldModelVariant(input: {
  artifactKey: WorldModelVariantArtifactKey;
  payload: Record<string, unknown>;
  fixtures: WorldModelEvaluationFixture[];
}): Promise<WorldModelVariantEvaluationResult> {
  if (input.artifactKey !== 'world_model_dossier_config') {
    throw new Error(`unsupported_world_model_artifact:${input.artifactKey}`);
  }

  const configOverride = toDossierConfigOverride(input.payload);
  const caseResults = input.fixtures.map((fixture) =>
    evaluateFixture({
      fixture,
      configOverride,
    })
  );

  const count = Math.max(1, caseResults.length);
  const primaryHits = caseResults.filter((result) => result.details.primaryThesisPresent).length;
  const counterHits = caseResults.filter((result) => result.details.counterHypothesisPresent).length;
  const invalidationHits = caseResults.filter((result) => result.details.invalidationConditionCount > 0).length;
  const bottleneckHits = caseResults.filter((result) => result.details.bottleneckCount > 0).length;
  const watchSignalDisciplineHits = caseResults.filter((result) => {
    const maxCheck = result.details.checks.find((check) => check.key === 'maxNextWatchSignals');
    return maxCheck ? maxCheck.passed : true;
  }).length;
  const averageCaseScore =
    caseResults.reduce((total, result) => total + result.score, 0) / count;

  return {
    artifactKey: input.artifactKey,
    evaluatedAt: new Date().toISOString(),
    metrics: buildWorldModelEvalMetrics({
      primaryThesisCoverage: roundToFour(primaryHits / count),
      counterHypothesisRetained: roundToFour(counterHits / count),
      invalidationConditionCoverage: roundToFour(invalidationHits / count),
      bottleneckCoverage: roundToFour(bottleneckHits / count),
      watchSignalDiscipline: roundToFour(watchSignalDisciplineHits / count),
      averageCaseScore: roundToFour(averageCaseScore),
    }),
    caseResults,
  };
}
