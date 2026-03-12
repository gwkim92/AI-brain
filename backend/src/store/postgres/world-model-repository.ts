import type { Pool } from 'pg';

import type { JarvisStore } from '../types';
import type {
  WorldModelConstraintRow,
  WorldModelEntityRow,
  WorldModelEventRow,
  WorldModelHypothesisEvidenceRow,
  WorldModelHypothesisRow,
  WorldModelInvalidationConditionRow,
  WorldModelObservationRow,
  WorldModelOutcomeRow,
  WorldModelProjectionRow,
  WorldModelStateSnapshotRow,
} from './types';

type WorldModelRepositoryContract = Pick<
  JarvisStore,
  | 'upsertWorldModelEntity'
  | 'listWorldModelEntities'
  | 'createWorldModelEvent'
  | 'listWorldModelEvents'
  | 'createWorldModelObservation'
  | 'listWorldModelObservations'
  | 'createWorldModelConstraint'
  | 'listWorldModelConstraints'
  | 'updateWorldModelConstraint'
  | 'createWorldModelHypothesis'
  | 'listWorldModelHypotheses'
  | 'updateWorldModelHypothesis'
  | 'createWorldModelHypothesisEvidence'
  | 'listWorldModelHypothesisEvidence'
  | 'createWorldModelInvalidationCondition'
  | 'listWorldModelInvalidationConditions'
  | 'updateWorldModelInvalidationCondition'
  | 'createWorldModelStateSnapshot'
  | 'listWorldModelStateSnapshots'
  | 'createWorldModelProjection'
  | 'listWorldModelProjections'
  | 'updateWorldModelProjection'
  | 'createWorldModelOutcome'
  | 'listWorldModelOutcomes'
>;

const DEFAULT_LIMIT = 100;

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}

function mapWorldModelEntityRow(row: WorldModelEntityRow) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    canonicalName: row.canonical_name,
    aliases: Array.isArray(row.aliases_json) ? row.aliases_json.map((value) => String(value)) : [],
    attributes: row.attributes_json ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapWorldModelEventRow(row: WorldModelEventRow) {
  return {
    id: row.id,
    userId: row.user_id,
    dossierId: row.dossier_id,
    kind: row.kind,
    summary: row.summary,
    occurredAt: row.occurred_at?.toISOString() ?? null,
    recordedAt: row.recorded_at?.toISOString() ?? null,
    attributes: row.attributes_json ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

function mapWorldModelObservationRow(row: WorldModelObservationRow) {
  return {
    id: row.id,
    userId: row.user_id,
    dossierId: row.dossier_id,
    metricKey: row.metric_key,
    valueText: row.value_text,
    unit: row.unit,
    observedAt: row.observed_at?.toISOString() ?? null,
    recordedAt: row.recorded_at?.toISOString() ?? null,
    attributes: row.attributes_json ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

function mapWorldModelConstraintRow(row: WorldModelConstraintRow) {
  return {
    id: row.id,
    userId: row.user_id,
    dossierId: row.dossier_id,
    kind: row.kind,
    description: row.description,
    severity: row.severity,
    status: row.status,
    attributes: row.attributes_json ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapWorldModelHypothesisRow(row: WorldModelHypothesisRow) {
  return {
    id: row.id,
    userId: row.user_id,
    projectionId: row.projection_id,
    dossierId: row.dossier_id,
    briefingId: row.briefing_id,
    thesis: row.thesis,
    stance: row.stance,
    confidence: row.confidence,
    status: row.status,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapWorldModelHypothesisEvidenceRow(row: WorldModelHypothesisEvidenceRow) {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    dossierId: row.dossier_id,
    claimText: row.claim_text,
    relation: row.relation,
    sourceUrls: Array.isArray(row.source_urls) ? row.source_urls : [],
    weight: row.weight,
    createdAt: row.created_at.toISOString(),
  };
}

function mapWorldModelInvalidationConditionRow(row: WorldModelInvalidationConditionRow) {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    description: row.description,
    expectedBy: row.expected_by?.toISOString() ?? null,
    observedStatus: row.observed_status,
    severity: row.severity,
    attributes: row.attributes_json ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapWorldModelStateSnapshotRow(row: WorldModelStateSnapshotRow) {
  return {
    id: row.id,
    userId: row.user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    stateJson: row.state_json ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

function mapWorldModelProjectionRow(row: WorldModelProjectionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    dossierId: row.dossier_id,
    briefingId: row.briefing_id,
    watcherId: row.watcher_id,
    sessionId: row.session_id,
    origin: row.origin,
    status: row.status,
    generatedAt: row.generated_at.toISOString(),
    supersededAt: row.superseded_at?.toISOString() ?? null,
    supersededByProjectionId: row.superseded_by_projection_id,
    summaryJson: row.summary_json ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapWorldModelOutcomeRow(row: WorldModelOutcomeRow) {
  return {
    id: row.id,
    userId: row.user_id,
    hypothesisId: row.hypothesis_id,
    evaluatedAt: row.evaluated_at.toISOString(),
    result: row.result,
    errorNotes: row.error_notes,
    horizonRealized: row.horizon_realized,
    missedInvalidators: Array.isArray(row.missed_invalidators_json) ? row.missed_invalidators_json.map((value) => String(value)) : [],
    createdAt: row.created_at.toISOString(),
  };
}

export function createPostgresWorldModelRepository({ pool }: { pool: Pool }): WorldModelRepositoryContract {
  return {
    async upsertWorldModelEntity(input) {
      const { rows } = await pool.query<WorldModelEntityRow>(
        `
          INSERT INTO world_model_entities (user_id, kind, canonical_name, aliases_json, attributes_json)
          VALUES ($1::uuid, $2, $3, COALESCE($4::jsonb, '[]'::jsonb), COALESCE($5::jsonb, '{}'::jsonb))
          ON CONFLICT (user_id, kind, canonical_name)
          DO UPDATE SET
            aliases_json = EXCLUDED.aliases_json,
            attributes_json = EXCLUDED.attributes_json,
            updated_at = now()
          RETURNING *
        `,
        [
          input.userId,
          input.kind,
          input.canonicalName.trim(),
          JSON.stringify(Array.from(new Set((input.aliases ?? []).map((value) => value.trim()).filter(Boolean)))),
          JSON.stringify(input.attributes ?? {}),
        ]
      );
      if (!rows[0]) throw new Error('failed to upsert world model entity');
      return mapWorldModelEntityRow(rows[0]);
    },

    async listWorldModelEntities(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.kind) {
        values.push(input.kind);
        filters.push(`kind = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<WorldModelEntityRow>(
        `SELECT * FROM world_model_entities WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapWorldModelEntityRow);
    },

    async createWorldModelEvent(input) {
      const { rows } = await pool.query<WorldModelEventRow>(
        `
          INSERT INTO world_model_events (user_id, dossier_id, kind, summary, occurred_at, recorded_at, attributes_json)
          VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz, COALESCE($7::jsonb, '{}'::jsonb))
          RETURNING *
        `,
        [
          input.userId,
          input.dossierId ?? null,
          input.kind,
          input.summary,
          input.occurredAt ?? null,
          input.recordedAt ?? null,
          JSON.stringify(input.attributes ?? {}),
        ]
      );
      if (!rows[0]) throw new Error('failed to create world model event');
      return mapWorldModelEventRow(rows[0]);
    },

    async listWorldModelEvents(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.dossierId) {
        values.push(input.dossierId);
        filters.push(`dossier_id = $${values.length}::uuid`);
      }
      if (input.kind) {
        values.push(input.kind);
        filters.push(`kind = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<WorldModelEventRow>(
        `SELECT * FROM world_model_events WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapWorldModelEventRow);
    },

    async createWorldModelObservation(input) {
      const { rows } = await pool.query<WorldModelObservationRow>(
        `
          INSERT INTO world_model_observations (
            user_id, dossier_id, metric_key, value_text, unit, observed_at, recorded_at, attributes_json
          )
          VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz, COALESCE($8::jsonb, '{}'::jsonb))
          RETURNING *
        `,
        [
          input.userId,
          input.dossierId ?? null,
          input.metricKey,
          input.valueText,
          input.unit ?? null,
          input.observedAt ?? null,
          input.recordedAt ?? null,
          JSON.stringify(input.attributes ?? {}),
        ]
      );
      if (!rows[0]) throw new Error('failed to create world model observation');
      return mapWorldModelObservationRow(rows[0]);
    },

    async listWorldModelObservations(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.dossierId) {
        values.push(input.dossierId);
        filters.push(`dossier_id = $${values.length}::uuid`);
      }
      if (input.metricKey) {
        values.push(input.metricKey);
        filters.push(`metric_key = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<WorldModelObservationRow>(
        `SELECT * FROM world_model_observations WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapWorldModelObservationRow);
    },

    async createWorldModelConstraint(input) {
      const { rows } = await pool.query<WorldModelConstraintRow>(
        `
          INSERT INTO world_model_constraints (user_id, dossier_id, kind, description, severity, status, attributes_json)
          VALUES ($1::uuid, $2::uuid, $3, $4, COALESCE($5, 'medium'), COALESCE($6, 'active'), COALESCE($7::jsonb, '{}'::jsonb))
          RETURNING *
        `,
        [
          input.userId,
          input.dossierId ?? null,
          input.kind,
          input.description,
          input.severity ?? 'medium',
          input.status ?? 'active',
          JSON.stringify(input.attributes ?? {}),
        ]
      );
      if (!rows[0]) throw new Error('failed to create world model constraint');
      return mapWorldModelConstraintRow(rows[0]);
    },

    async listWorldModelConstraints(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.dossierId) {
        values.push(input.dossierId);
        filters.push(`dossier_id = $${values.length}::uuid`);
      }
      if (input.kind) {
        values.push(input.kind);
        filters.push(`kind = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<WorldModelConstraintRow>(
        `SELECT * FROM world_model_constraints WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapWorldModelConstraintRow);
    },

    async updateWorldModelConstraint(input) {
      const { rows } = await pool.query<WorldModelConstraintRow>(
        `
          UPDATE world_model_constraints
          SET
            description = COALESCE($3, description),
            severity = COALESCE($4, severity),
            status = COALESCE($5, status),
            attributes_json = COALESCE($6::jsonb, attributes_json),
            updated_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING *
        `,
        [
          input.constraintId,
          input.userId,
          input.description ?? null,
          input.severity ?? null,
          input.status ?? null,
          typeof input.attributes === 'object' && input.attributes !== null ? JSON.stringify(input.attributes) : null,
        ]
      );
      return rows[0] ? mapWorldModelConstraintRow(rows[0]) : null;
    },

    async createWorldModelHypothesis(input) {
      const { rows } = await pool.query<WorldModelHypothesisRow>(
        `
          INSERT INTO world_model_hypotheses (user_id, projection_id, dossier_id, briefing_id, thesis, stance, confidence, status, summary)
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, COALESCE($7, 0.5), COALESCE($8, 'active'), $9)
          RETURNING *
        `,
        [
          input.userId,
          input.projectionId ?? null,
          input.dossierId ?? null,
          input.briefingId ?? null,
          input.thesis,
          input.stance,
          typeof input.confidence === 'number' ? input.confidence : 0.5,
          input.status ?? 'active',
          input.summary ?? null,
        ]
      );
      if (!rows[0]) throw new Error('failed to create world model hypothesis');
      return mapWorldModelHypothesisRow(rows[0]);
    },

    async listWorldModelHypotheses(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.hypothesisId) {
        values.push(input.hypothesisId);
        filters.push(`id = $${values.length}::uuid`);
      }
      if (input.projectionId) {
        values.push(input.projectionId);
        filters.push(`projection_id = $${values.length}::uuid`);
      }
      if (input.dossierId) {
        values.push(input.dossierId);
        filters.push(`dossier_id = $${values.length}::uuid`);
      }
      if (input.briefingId) {
        values.push(input.briefingId);
        filters.push(`briefing_id = $${values.length}::uuid`);
      }
      if (input.status) {
        values.push(input.status);
        filters.push(`status = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<WorldModelHypothesisRow>(
        `SELECT * FROM world_model_hypotheses WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapWorldModelHypothesisRow);
    },

    async updateWorldModelHypothesis(input) {
      const { rows } = await pool.query<WorldModelHypothesisRow>(
        `
          UPDATE world_model_hypotheses
          SET
            confidence = COALESCE($3, confidence),
            status = COALESCE($4, status),
            summary = CASE
              WHEN $6 = true THEN $5
              ELSE summary
            END,
            updated_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING *
        `,
        [
          input.hypothesisId,
          input.userId,
          typeof input.confidence === 'number' ? input.confidence : null,
          input.status ?? null,
          Object.prototype.hasOwnProperty.call(input, 'summary') ? (input.summary ?? null) : null,
          Object.prototype.hasOwnProperty.call(input, 'summary'),
        ]
      );
      return rows[0] ? mapWorldModelHypothesisRow(rows[0]) : null;
    },

    async createWorldModelHypothesisEvidence(input) {
      const { rows } = await pool.query<WorldModelHypothesisEvidenceRow>(
        `
          INSERT INTO world_model_hypothesis_evidence (hypothesis_id, dossier_id, claim_text, relation, source_urls, weight)
          VALUES ($1::uuid, $2::uuid, $3, COALESCE($4, 'supports'), COALESCE($5::text[], '{}'), COALESCE($6, 0.5))
          RETURNING *
        `,
        [
          input.hypothesisId,
          input.dossierId ?? null,
          input.claimText,
          input.relation ?? 'supports',
          input.sourceUrls ?? [],
          typeof input.weight === 'number' ? input.weight : 0.5,
        ]
      );
      if (!rows[0]) throw new Error('failed to create world model hypothesis evidence');
      return mapWorldModelHypothesisEvidenceRow(rows[0]);
    },

    async listWorldModelHypothesisEvidence(input) {
      const { rows } = await pool.query<WorldModelHypothesisEvidenceRow>(
        `
          SELECT *
          FROM world_model_hypothesis_evidence
          WHERE hypothesis_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [input.hypothesisId, normalizeLimit(input.limit)]
      );
      return rows.map(mapWorldModelHypothesisEvidenceRow);
    },

    async createWorldModelInvalidationCondition(input) {
      const { rows } = await pool.query<WorldModelInvalidationConditionRow>(
        `
          INSERT INTO world_model_invalidation_conditions (
            hypothesis_id, description, expected_by, observed_status, severity, attributes_json
          )
          VALUES ($1::uuid, $2, $3::timestamptz, COALESCE($4, 'pending'), COALESCE($5, 'medium'), COALESCE($6::jsonb, '{}'::jsonb))
          RETURNING *
        `,
        [
          input.hypothesisId,
          input.description,
          input.expectedBy ?? null,
          input.observedStatus ?? 'pending',
          input.severity ?? 'medium',
          JSON.stringify(input.attributes ?? {}),
        ]
      );
      if (!rows[0]) throw new Error('failed to create world model invalidation condition');
      return mapWorldModelInvalidationConditionRow(rows[0]);
    },

    async listWorldModelInvalidationConditions(input) {
      const { rows } = await pool.query<WorldModelInvalidationConditionRow>(
        `
          SELECT *
          FROM world_model_invalidation_conditions
          WHERE hypothesis_id = $1::uuid
          ORDER BY updated_at DESC
          LIMIT $2
        `,
        [input.hypothesisId, normalizeLimit(input.limit)]
      );
      return rows.map(mapWorldModelInvalidationConditionRow);
    },

    async updateWorldModelInvalidationCondition(input) {
      const { rows } = await pool.query<WorldModelInvalidationConditionRow>(
        `
          UPDATE world_model_invalidation_conditions
          SET
            observed_status = COALESCE($2, observed_status),
            expected_by = CASE
              WHEN $5 = true THEN $3::timestamptz
              ELSE expected_by
            END,
            severity = COALESCE($4, severity),
            attributes_json = CASE
              WHEN $7 = true THEN COALESCE($6::jsonb, '{}'::jsonb)
              ELSE attributes_json
            END,
            updated_at = now()
          WHERE id = $1::uuid
          RETURNING *
        `,
        [
          input.invalidationConditionId,
          input.observedStatus ?? null,
          Object.prototype.hasOwnProperty.call(input, 'expectedBy') ? (input.expectedBy ?? null) : null,
          input.severity ?? null,
          Object.prototype.hasOwnProperty.call(input, 'expectedBy'),
          Object.prototype.hasOwnProperty.call(input, 'attributes') ? JSON.stringify(input.attributes ?? {}) : null,
          Object.prototype.hasOwnProperty.call(input, 'attributes'),
        ]
      );
      return rows[0] ? mapWorldModelInvalidationConditionRow(rows[0]) : null;
    },

    async createWorldModelStateSnapshot(input) {
      const { rows } = await pool.query<WorldModelStateSnapshotRow>(
        `
          INSERT INTO world_model_state_snapshots (user_id, target_type, target_id, state_json)
          VALUES ($1::uuid, $2, $3::uuid, COALESCE($4::jsonb, '{}'::jsonb))
          RETURNING *
        `,
        [input.userId, input.targetType, input.targetId, JSON.stringify(input.stateJson ?? {})]
      );
      if (!rows[0]) throw new Error('failed to create world model state snapshot');
      return mapWorldModelStateSnapshotRow(rows[0]);
    },

    async listWorldModelStateSnapshots(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.targetType) {
        values.push(input.targetType);
        filters.push(`target_type = $${values.length}`);
      }
      if (input.targetId) {
        values.push(input.targetId);
        filters.push(`target_id = $${values.length}::uuid`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<WorldModelStateSnapshotRow>(
        `SELECT * FROM world_model_state_snapshots WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapWorldModelStateSnapshotRow);
    },

    async createWorldModelProjection(input) {
      const { rows } = await pool.query<WorldModelProjectionRow>(
        `
          INSERT INTO world_model_projections (
            user_id, dossier_id, briefing_id, watcher_id, session_id, origin, status, generated_at, summary_json
          )
          VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, COALESCE($7, 'active'), COALESCE($8::timestamptz, now()), COALESCE($9::jsonb, '{}'::jsonb)
          )
          RETURNING *
        `,
        [
          input.userId,
          input.dossierId ?? null,
          input.briefingId ?? null,
          input.watcherId ?? null,
          input.sessionId ?? null,
          input.origin,
          input.status ?? 'active',
          input.generatedAt ?? null,
          JSON.stringify(input.summaryJson ?? {}),
        ]
      );
      if (!rows[0]) throw new Error('failed to create world model projection');
      return mapWorldModelProjectionRow(rows[0]);
    },

    async listWorldModelProjections(input) {
      const values: unknown[] = [];
      const filters: string[] = [];
      if (input.userId) {
        values.push(input.userId);
        filters.push(`user_id = $${values.length}::uuid`);
      }
      if (input.projectionId) {
        values.push(input.projectionId);
        filters.push(`id = $${values.length}::uuid`);
      }
      if (input.dossierId) {
        values.push(input.dossierId);
        filters.push(`dossier_id = $${values.length}::uuid`);
      }
      if (input.briefingId) {
        values.push(input.briefingId);
        filters.push(`briefing_id = $${values.length}::uuid`);
      }
      if (input.watcherId) {
        values.push(input.watcherId);
        filters.push(`watcher_id = $${values.length}::uuid`);
      }
      if (input.sessionId) {
        values.push(input.sessionId);
        filters.push(`session_id = $${values.length}::uuid`);
      }
      if (input.status) {
        values.push(input.status);
        filters.push(`status = $${values.length}`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<WorldModelProjectionRow>(
        `SELECT * FROM world_model_projections ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY generated_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapWorldModelProjectionRow);
    },

    async updateWorldModelProjection(input) {
      const { rows } = await pool.query<WorldModelProjectionRow>(
        `
          UPDATE world_model_projections
          SET
            status = COALESCE($3, status),
            superseded_at = CASE
              WHEN $6 = true THEN $4::timestamptz
              ELSE superseded_at
            END,
            superseded_by_projection_id = CASE
              WHEN $7 = true THEN $5::uuid
              ELSE superseded_by_projection_id
            END,
            summary_json = CASE
              WHEN $9 = true THEN COALESCE($8::jsonb, '{}'::jsonb)
              ELSE summary_json
            END,
            updated_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid
          RETURNING *
        `,
        [
          input.projectionId,
          input.userId,
          input.status ?? null,
          Object.prototype.hasOwnProperty.call(input, 'supersededAt') ? (input.supersededAt ?? null) : null,
          Object.prototype.hasOwnProperty.call(input, 'supersededByProjectionId') ? (input.supersededByProjectionId ?? null) : null,
          Object.prototype.hasOwnProperty.call(input, 'supersededAt'),
          Object.prototype.hasOwnProperty.call(input, 'supersededByProjectionId'),
          Object.prototype.hasOwnProperty.call(input, 'summaryJson') ? JSON.stringify(input.summaryJson ?? {}) : null,
          Object.prototype.hasOwnProperty.call(input, 'summaryJson'),
        ]
      );
      return rows[0] ? mapWorldModelProjectionRow(rows[0]) : null;
    },

    async createWorldModelOutcome(input) {
      const { rows } = await pool.query<WorldModelOutcomeRow>(
        `
          INSERT INTO world_model_outcomes (
            user_id, hypothesis_id, evaluated_at, result, error_notes, horizon_realized, missed_invalidators_json
          )
          VALUES ($1::uuid, $2::uuid, COALESCE($3::timestamptz, now()), $4, $5, $6, COALESCE($7::jsonb, '[]'::jsonb))
          RETURNING *
        `,
        [
          input.userId,
          input.hypothesisId,
          input.evaluatedAt ?? null,
          input.result,
          input.errorNotes ?? null,
          input.horizonRealized ?? null,
          JSON.stringify(input.missedInvalidators ?? []),
        ]
      );
      if (!rows[0]) throw new Error('failed to create world model outcome');
      return mapWorldModelOutcomeRow(rows[0]);
    },

    async listWorldModelOutcomes(input) {
      const values: unknown[] = [input.userId];
      const filters = ['user_id = $1::uuid'];
      if (input.hypothesisId) {
        values.push(input.hypothesisId);
        filters.push(`hypothesis_id = $${values.length}::uuid`);
      }
      values.push(normalizeLimit(input.limit));
      const { rows } = await pool.query<WorldModelOutcomeRow>(
        `SELECT * FROM world_model_outcomes WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,
        values
      );
      return rows.map(mapWorldModelOutcomeRow);
    },
  };
}
