import type { JarvisStore, WorldModelSnapshotTargetType } from '../store/types';

import { buildHypothesisLedger } from './hypothesis-ledger';
import { buildInvalidationMatcherAttributes } from './invalidation';
import type { WorldModelExtraction } from './schemas';
import { buildWorldModelState, type WorldModelStateKey } from './state-model';

type ProjectionStore = Pick<
  JarvisStore,
  | 'upsertWorldModelEntity'
  | 'createWorldModelEvent'
  | 'createWorldModelObservation'
  | 'createWorldModelConstraint'
  | 'createWorldModelStateSnapshot'
  | 'createWorldModelProjection'
  | 'listWorldModelProjections'
  | 'updateWorldModelProjection'
  | 'createWorldModelHypothesis'
  | 'createWorldModelHypothesisEvidence'
  | 'createWorldModelInvalidationCondition'
>;

export type PersistWorldModelProjectionInput = {
  store: ProjectionStore;
  userId: string;
  extraction: WorldModelExtraction;
  dossierId?: string | null;
  briefingId?: string | null;
  snapshotTarget?: {
    targetType: WorldModelSnapshotTargetType;
    targetId: string;
  } | null;
  watcherId?: string | null;
  sessionId?: string | null;
  origin: 'briefing_generate' | 'dossier_refresh' | 'watcher_run' | 'outcome_backfill';
  now?: string;
};

function mapStateKeyToConstraintKind(
  key: WorldModelStateKey
): 'capacity' | 'logistics' | 'insurance' | 'regulatory' | 'settlement' | 'financing' | 'other' {
  if (key === 'freight_pressure' || key === 'route_risk') {
    return 'logistics';
  }
  if (key === 'insurance_pressure') {
    return 'insurance';
  }
  if (key === 'contract_urgency') {
    return 'capacity';
  }
  if (key === 'rate_repricing_pressure') {
    return 'financing';
  }
  return 'other';
}

export async function persistWorldModelProjection(
  input: PersistWorldModelProjectionInput
) {
  const state = buildWorldModelState({ extraction: input.extraction });
  const ledger = buildHypothesisLedger({
    extraction: input.extraction,
    state,
    now: input.now,
  });

  const activeProjections = await input.store.listWorldModelProjections({
    userId: input.userId,
    status: 'active',
    limit: 100,
  });

  const superseded = activeProjections.filter(
    (projection) =>
      (input.dossierId && projection.dossierId === input.dossierId) ||
      (input.watcherId && projection.watcherId === input.watcherId) ||
      (input.briefingId && projection.briefingId === input.briefingId)
  );

  const projection = await input.store.createWorldModelProjection({
    userId: input.userId,
    dossierId: input.dossierId ?? null,
    briefingId: input.briefingId ?? null,
    watcherId: input.watcherId ?? null,
    sessionId: input.sessionId ?? null,
    origin: input.origin,
    generatedAt: input.extraction.generatedAt,
    summaryJson: {
      dominant_signals: state.dominantSignals,
      bottlenecks: Object.values(state.variables)
        .filter((variable) => variable.score >= 0.3)
        .slice(0, 4)
        .map((variable) => variable.key),
      hypothesis_count: ledger.length,
      pending_invalidation_count: ledger.flatMap((draft) => draft.invalidationConditions).filter((condition) => condition.observedStatus === 'pending')
        .length,
      next_expected_by: ledger
        .flatMap((draft) => draft.invalidationConditions)
        .filter((condition) => condition.observedStatus === 'pending' && condition.expectedBy)
        .map((condition) => condition.expectedBy as string)
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null,
      research_profile: input.extraction.researchProfile,
    },
  });

  await Promise.all(
    superseded.map((previous) =>
      input.store.updateWorldModelProjection({
        projectionId: previous.id,
        userId: input.userId,
        status: 'superseded',
        supersededAt: input.now ?? input.extraction.generatedAt,
        supersededByProjectionId: projection.id,
      })
    )
  );

  await Promise.all(
    input.extraction.entities.map((entity) =>
      input.store.upsertWorldModelEntity({
        userId: input.userId,
        kind: entity.kind,
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        attributes: {
          projection_id: projection.id,
          source_urls: entity.sourceUrls,
          mention_count: entity.mentionCount,
          epistemic_status: entity.epistemicStatus,
          extraction_key: entity.key,
        },
      })
    )
  );

  await Promise.all(
    input.extraction.events.map((event) =>
      input.store.createWorldModelEvent({
        userId: input.userId,
        dossierId: input.dossierId ?? null,
        kind: event.kind,
        summary: event.summary,
        occurredAt: event.occurredAt,
        recordedAt: event.recordedAt,
        attributes: {
          projection_id: projection.id,
          source_urls: event.sourceUrls,
          entity_keys: event.entityKeys,
          claim_keys: event.claimKeys,
          channel: event.channel,
          epistemic_status: event.epistemicStatus,
          extraction_key: event.key,
        },
      })
    )
  );

  await Promise.all(
    input.extraction.observations.map((observation) =>
      input.store.createWorldModelObservation({
        userId: input.userId,
        dossierId: input.dossierId ?? null,
        metricKey: observation.metricKey,
        valueText: observation.valueText,
        unit: observation.unit,
        observedAt: observation.observedAt,
        recordedAt: observation.recordedAt,
        attributes: {
          projection_id: projection.id,
          source_urls: observation.sourceUrls,
          entity_keys: observation.entityKeys,
          claim_keys: observation.claimKeys,
          channel: observation.channel,
          epistemic_status: observation.epistemicStatus,
          extraction_key: observation.key,
        },
      })
    )
  );

  const constraintCandidates = Object.values(state.variables)
    .filter((variable) => variable.score >= 0.35)
    .slice(0, 4);
  await Promise.all(
    constraintCandidates.map((variable) =>
      input.store.createWorldModelConstraint({
        userId: input.userId,
        dossierId: input.dossierId ?? null,
        kind: mapStateKeyToConstraintKind(variable.key),
        description: `${variable.key} pressure is elevated: ${variable.drivers.join(', ')}`,
        severity: variable.score >= 0.7 ? 'high' : variable.score >= 0.5 ? 'medium' : 'low',
        status: variable.score >= 0.6 ? 'active' : 'watching',
        attributes: {
          projection_id: projection.id,
          state_key: variable.key,
          score: variable.score,
          drivers: variable.drivers,
        },
      })
    )
  );

  const stateSnapshot = input.snapshotTarget
    ? await input.store.createWorldModelStateSnapshot({
        userId: input.userId,
        targetType: input.snapshotTarget.targetType,
        targetId: input.snapshotTarget.targetId,
        stateJson: {
          projection_id: projection.id,
          generated_at: state.generatedAt,
          dominant_signals: state.dominantSignals,
          variables: Object.fromEntries(
            Object.entries(state.variables).map(([key, value]) => [
              key,
              {
                score: value.score,
                direction: value.direction,
                drivers: value.drivers,
              },
            ])
          ),
          notes: state.notes,
          research_profile: input.extraction.researchProfile,
        },
      })
    : null;

  const hypotheses = [];
  for (const draft of ledger) {
    const hypothesis = await input.store.createWorldModelHypothesis({
      userId: input.userId,
      projectionId: projection.id,
      dossierId: input.dossierId ?? null,
      briefingId: input.briefingId ?? null,
      thesis: draft.thesis,
      stance: draft.stance,
      confidence: draft.confidence,
      status: draft.status,
      summary: draft.summary,
    });
    hypotheses.push(hypothesis);

    await Promise.all(
      draft.evidence.map((evidence) =>
        input.store.createWorldModelHypothesisEvidence({
          hypothesisId: hypothesis.id,
          dossierId: input.dossierId ?? null,
          claimText: evidence.claimText,
          relation: evidence.relation,
          sourceUrls: evidence.sourceUrls,
          weight: evidence.weight,
        })
      )
    );

    await Promise.all(
      draft.invalidationConditions.map((condition) =>
        input.store.createWorldModelInvalidationCondition({
          hypothesisId: hypothesis.id,
          description: condition.description,
          expectedBy: condition.expectedBy,
          observedStatus: condition.observedStatus,
          severity: condition.severity,
          attributes: buildInvalidationMatcherAttributes(condition),
        })
      )
    );
  }

  return {
    state,
    ledger,
    projection,
    stateSnapshot,
    hypotheses,
  };
}
