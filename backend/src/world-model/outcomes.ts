import type {
  JarvisStore,
  RadarDomainId,
  WorldModelHypothesisRecord,
  WorldModelHypothesisStatus,
  WorldModelInvalidationConditionRecord,
  WorldModelOutcomeRecord,
  WorldModelOutcomeResult,
} from '../store/types';
import type { WorldModelExtraction } from './schemas';
import { reevaluateStoredInvalidationCondition } from './invalidation';

type OutcomeStore = Pick<
  JarvisStore,
  | 'listWorldModelHypotheses'
  | 'listWorldModelInvalidationConditions'
  | 'createWorldModelOutcome'
  | 'updateWorldModelHypothesis'
  | 'updateWorldModelInvalidationCondition'
  | 'listWorldModelOutcomes'
  | 'listWorldModelProjections'
  | 'recordRadarDomainPackOutcome'
>;

export type RecordWorldModelOutcomeInput = {
  store: OutcomeStore;
  userId: string;
  hypothesisId: string;
  result: WorldModelOutcomeResult;
  evaluatedAt?: string;
  horizonRealized?: string | null;
  revisionNotes?: string | null;
};

export type RecordWorldModelOutcomeResult = {
  outcome: WorldModelOutcomeRecord;
  hypothesis: WorldModelHypothesisRecord;
  missedInvalidators: string[];
};

export type RecordWorldModelProjectionOutcomesInput = {
  store: OutcomeStore;
  userId: string;
  dossierId?: string;
  projectionId?: string;
  extraction: WorldModelExtraction;
  evaluatedAt?: string;
  now?: string;
};

function deriveProjectionOutcomeResult(results: WorldModelOutcomeResult[]): WorldModelOutcomeResult {
  if (results.includes('invalidated')) {
    return 'invalidated';
  }
  if (results.includes('mixed')) {
    return 'mixed';
  }
  if (results.includes('confirmed')) {
    return 'confirmed';
  }
  return 'unresolved';
}

async function recordRadarCalibrationOutcome(input: {
  store: OutcomeStore;
  projectionId?: string;
  dossierId?: string;
  results: WorldModelOutcomeResult[];
  evaluatedAt?: string;
}): Promise<void> {
  if (input.results.length === 0) {
    return;
  }
  const [projection] = await input.store.listWorldModelProjections({
    projectionId: input.projectionId,
    dossierId: input.projectionId ? undefined : input.dossierId,
    limit: 1,
  });
  const domainId = typeof projection?.summaryJson.radar_domain_id === 'string'
    ? (projection.summaryJson.radar_domain_id as RadarDomainId)
    : null;
  if (!domainId) {
    return;
  }
  await input.store.recordRadarDomainPackOutcome({
    domainId,
    result: deriveProjectionOutcomeResult(input.results),
    evaluatedAt: input.evaluatedAt ?? null,
    eventId: typeof projection?.summaryJson.radar_event_id === 'string' ? (projection.summaryJson.radar_event_id as string) : null,
  });
}

function deriveOutcomeResult(
  conditions: WorldModelInvalidationConditionRecord[]
): WorldModelOutcomeResult {
  const hitCount = conditions.filter((condition) => condition.observedStatus === 'hit').length;
  const highHitCount = conditions.filter(
    (condition) => condition.observedStatus === 'hit' && condition.severity === 'high'
  ).length;
  const missedCount = conditions.filter((condition) => condition.observedStatus === 'missed').length;

  if (highHitCount > 0 || hitCount >= 2) {
    return 'invalidated';
  }
  if (hitCount > 0) {
    return 'mixed';
  }
  if (missedCount > 0) {
    return 'confirmed';
  }
  return 'unresolved';
}

function clampConfidence(value: number): number {
  return Math.max(0.05, Math.min(0.95, Number(value.toFixed(3))));
}

function deriveHypothesisUpdate(input: {
  hypothesis: WorldModelHypothesisRecord;
  result: WorldModelOutcomeResult;
  revisionNotes: string | null;
  missedInvalidators: string[];
}): {
  confidence: number;
  status: WorldModelHypothesisStatus;
  summary: string | null;
} {
  const { hypothesis, result, revisionNotes, missedInvalidators } = input;
  const hasInvalidators = missedInvalidators.length > 0;

  if (result === 'invalidated') {
    return {
      confidence: clampConfidence(Math.min(hypothesis.confidence, 0.18)),
      status: 'invalidated',
      summary:
        revisionNotes ??
        `Outcome review invalidated this hypothesis after ${missedInvalidators.length || 1} contradictory follow-up signal(s).`,
    };
  }

  if (result === 'mixed' || (result === 'unresolved' && hasInvalidators)) {
    return {
      confidence: clampConfidence(hypothesis.confidence - (hasInvalidators ? 0.18 : 0.12)),
      status: 'weakened',
      summary:
        revisionNotes ??
        `Outcome review weakened this hypothesis because ${missedInvalidators.length} invalidation signal(s) landed.`,
    };
  }

  if (result === 'confirmed') {
    return {
      confidence: clampConfidence(hypothesis.confidence + 0.08),
      status: 'active',
      summary: revisionNotes ?? hypothesis.summary,
    };
  }

  return {
    confidence: clampConfidence(hypothesis.confidence),
    status: hypothesis.status,
    summary: revisionNotes ?? hypothesis.summary,
  };
}

export async function recordWorldModelOutcome(
  input: RecordWorldModelOutcomeInput
): Promise<RecordWorldModelOutcomeResult> {
  const hypothesis = (
    await input.store.listWorldModelHypotheses({
      userId: input.userId,
      hypothesisId: input.hypothesisId,
      limit: 1,
    })
  )[0];

  if (!hypothesis) {
    throw new Error(`world model hypothesis not found: ${input.hypothesisId}`);
  }

  const invalidationConditions = await input.store.listWorldModelInvalidationConditions({
    hypothesisId: input.hypothesisId,
    limit: 100,
  });
  const missedInvalidators = invalidationConditions
    .filter((condition) => condition.observedStatus === 'hit')
    .map((condition) => condition.description);

  const outcome = await input.store.createWorldModelOutcome({
    userId: input.userId,
    hypothesisId: input.hypothesisId,
    evaluatedAt: input.evaluatedAt,
    result: input.result,
    horizonRealized: input.horizonRealized ?? null,
    errorNotes: input.revisionNotes ?? null,
    missedInvalidators,
  });

  const next = deriveHypothesisUpdate({
    hypothesis,
    result: input.result,
    revisionNotes: input.revisionNotes ?? null,
    missedInvalidators,
  });

  const updatedHypothesis = await input.store.updateWorldModelHypothesis({
    hypothesisId: input.hypothesisId,
    userId: input.userId,
    confidence: next.confidence,
    status: next.status,
    summary: next.summary,
  });

  if (!updatedHypothesis) {
    throw new Error(`failed to update hypothesis outcome state: ${input.hypothesisId}`);
  }

  return {
    outcome,
    hypothesis: updatedHypothesis,
    missedInvalidators,
  };
}

export async function recordWorldModelProjectionOutcomes(
  input: RecordWorldModelProjectionOutcomesInput
): Promise<RecordWorldModelOutcomeResult[]> {
  if (!input.dossierId && !input.projectionId) {
    throw new Error('recordWorldModelProjectionOutcomes requires dossierId or projectionId');
  }
  const hypotheses = await input.store.listWorldModelHypotheses({
    userId: input.userId,
    dossierId: input.dossierId,
    projectionId: input.projectionId,
    limit: 100,
  });
  const recorded: RecordWorldModelOutcomeResult[] = [];

  for (const hypothesis of hypotheses) {
    const conditions = await input.store.listWorldModelInvalidationConditions({
      hypothesisId: hypothesis.id,
      limit: 100,
    });
    if (conditions.length === 0) {
      continue;
    }

    const reevaluated = await Promise.all(
      conditions.map(async (condition) => {
        const next = reevaluateStoredInvalidationCondition({
          condition,
          extraction: input.extraction,
          now: input.now ?? input.evaluatedAt,
        });
        if (next.observedStatus !== condition.observedStatus) {
          const updated = await input.store.updateWorldModelInvalidationCondition({
            invalidationConditionId: condition.id,
            observedStatus: next.observedStatus,
          });
          return updated ?? { ...condition, observedStatus: next.observedStatus };
        }
        return condition;
      })
    );

    const result = deriveOutcomeResult(reevaluated);
    const latestOutcome = (await input.store.listWorldModelOutcomes({
      userId: input.userId,
      hypothesisId: hypothesis.id,
      limit: 1,
    }))[0];

    if (result === 'unresolved' && !latestOutcome) {
      continue;
    }
    if (latestOutcome?.result === result) {
      continue;
    }

    recorded.push(
      await recordWorldModelOutcome({
        store: input.store,
        userId: input.userId,
        hypothesisId: hypothesis.id,
        result,
        evaluatedAt: input.evaluatedAt,
      })
    );
  }

  if (recorded.length > 0) {
    await recordRadarCalibrationOutcome({
      store: input.store,
      projectionId: input.projectionId,
      dossierId: input.dossierId,
      results: recorded.map((item) => item.outcome.result),
      evaluatedAt: input.evaluatedAt,
    });
  }

  return recorded;
}
