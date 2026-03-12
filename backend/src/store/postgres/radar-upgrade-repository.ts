import type { Pool } from 'pg';

import { buildRadarEvaluationBundle } from '../../radar/pipeline';
import {
  applyRadarEvaluationToMetric,
  applyRadarFeedbackToMetric,
  applyRadarOutcomeToMetric,
  applyRadarPolicyControls,
  createDefaultRadarDomainPackMetric,
  normalizeRadarControlSettings,
} from '../../radar/policy';
import type { RadarUpgradeRepositoryContract } from '../repository-contracts';
import type {
  RadarAutonomyDecisionRow,
  RadarControlSettingsRow,
  RadarFeedCursorRow,
  RadarFeedSourceRow,
  RadarDomainPackMetricRow,
  RadarDomainPosteriorRow,
  RadarEventRow,
  RadarIngestRunRow,
  RadarItemRow,
  RadarOperatorFeedbackRow,
  UpgradeProposalRow,
  UpgradeRunRow,
} from './types';
import type {
  RadarAutonomyDecisionRecord,
  RadarControlSettingsRecord,
  RadarCorroborationDetail,
  RadarFeedCursorRecord,
  RadarFeedSourceRecord,
  RadarDomainPackMetricRecord,
  RadarDomainPosteriorRecord,
  RadarEventRecord,
  RadarIngestRunRecord,
  RadarItemRecord,
  RadarItemStatus,
  RadarOperatorFeedbackRecord,
  RadarPromotionDecision,
  RadarRecommendationRecord,
  UpgradeProposalRecord,
  UpgradeRunApiRecord,
  UpgradeStatus,
} from '../types';

type RadarUpgradeRepositoryDeps = {
  pool: Pool;
  defaultUserId: string;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeMetricShocks(value: unknown): RadarEventRecord['metricShocks'] {
  return Array.isArray(value)
    ? value
        .filter((item): item is RadarEventRecord['metricShocks'][number] => typeof item === 'object' && item !== null)
        .map((item) => ({
          metricKey: typeof item.metricKey === 'string' ? item.metricKey : 'unknown',
          value:
            typeof item.value === 'number' || typeof item.value === 'string' || item.value === null ? item.value : null,
          unit: typeof item.unit === 'string' ? item.unit : null,
          direction:
            item.direction === 'up' || item.direction === 'down' || item.direction === 'flat' || item.direction === 'unknown'
              ? item.direction
              : 'unknown',
          observedAt: typeof item.observedAt === 'string' ? item.observedAt : null,
        }))
    : [];
}

function normalizeCorroborationDetail(value: unknown): RadarCorroborationDetail {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    sourceCount: typeof record.sourceCount === 'number' ? record.sourceCount : 0,
    uniqueSourceCount: typeof record.uniqueSourceCount === 'number' ? record.uniqueSourceCount : 0,
    nonSocialSourceCount: typeof record.nonSocialSourceCount === 'number' ? record.nonSocialSourceCount : 0,
    hasMetricCorroboration: record.hasMetricCorroboration === true,
    sourceTypeDiversity: typeof record.sourceTypeDiversity === 'number' ? record.sourceTypeDiversity : 0,
    sourceTierDiversity: typeof record.sourceTierDiversity === 'number' ? record.sourceTierDiversity : 0,
  };
}

function mapRadarItemRow(row: RadarItemRow): RadarItemRecord {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? '',
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    publishedAt: toIso(row.published_at),
    observedAt: toIso(row.observed_at),
    confidenceScore: Number(row.confidence_score),
    status: row.status,
    sourceType: row.source_type ? (row.source_type as RadarItemRecord['sourceType']) : undefined,
    sourceTier: row.source_tier ? (row.source_tier as RadarItemRecord['sourceTier']) : undefined,
    rawMetrics: row.raw_metrics_json ?? {},
    entityHints: normalizeStringArray(row.entity_hints_json),
    trustHint: row.trust_hint,
    payload: row.payload ?? {},
  };
}

function mapRadarFeedSourceRow(row: RadarFeedSourceRow): RadarFeedSourceRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    url: row.url,
    sourceType: row.source_type as RadarFeedSourceRecord['sourceType'],
    sourceTier: row.source_tier as RadarFeedSourceRecord['sourceTier'],
    pollMinutes: row.poll_minutes,
    enabled: row.enabled,
    parserHints: row.parser_hints_json ?? {},
    entityHints: normalizeStringArray(row.entity_hints_json),
    metricHints: normalizeStringArray(row.metric_hints_json),
    lastFetchedAt: toIso(row.last_fetched_at),
    lastSuccessAt: toIso(row.last_success_at),
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRadarFeedCursorRow(row: RadarFeedCursorRow): RadarFeedCursorRecord {
  return {
    sourceId: row.source_id,
    cursor: row.cursor_text,
    etag: row.etag,
    lastModified: row.last_modified,
    lastSeenPublishedAt: toIso(row.last_seen_published_at),
    lastFetchedAt: toIso(row.last_fetched_at),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRadarIngestRunRow(row: RadarIngestRunRow): RadarIngestRunRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    startedAt: row.started_at.toISOString(),
    finishedAt: toIso(row.finished_at),
    status: row.status,
    fetchedCount: row.fetched_count,
    ingestedCount: row.ingested_count,
    evaluatedCount: row.evaluated_count,
    promotedCount: row.promoted_count,
    autoExecutedCount: row.auto_executed_count,
    failedCount: row.failed_count,
    error: row.error_text,
    detailJson: row.detail_json ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRadarEventRow(row: RadarEventRow): RadarEventRecord {
  const sourceMix = row.source_mix_json ?? {};
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    eventType: row.event_type as RadarEventRecord['eventType'],
    geoScope: row.geo_scope,
    timeScope: row.time_scope,
    dedupeClusterId: row.dedupe_cluster_id,
    primaryItemId: row.primary_item_id,
    clusterSize: row.cluster_size,
    itemIds: normalizeStringArray(row.item_ids_json),
    entities: normalizeStringArray(row.entities_json),
    claims: normalizeStringArray(row.claims_json),
    metricShocks: normalizeMetricShocks(row.metric_shocks_json),
    sourceMix: {
      sourceTiers: normalizeStringArray(sourceMix.sourceTiers) as RadarEventRecord['sourceMix']['sourceTiers'],
      sourceTypes: normalizeStringArray(sourceMix.sourceTypes) as RadarEventRecord['sourceMix']['sourceTypes'],
      sourceCount: typeof sourceMix.sourceCount === 'number' ? sourceMix.sourceCount : undefined,
      uniqueSourceCount: typeof sourceMix.uniqueSourceCount === 'number' ? sourceMix.uniqueSourceCount : undefined,
      nonSocialSourceCount: typeof sourceMix.nonSocialSourceCount === 'number' ? sourceMix.nonSocialSourceCount : undefined,
      byTier:
        sourceMix.byTier && typeof sourceMix.byTier === 'object'
          ? (sourceMix.byTier as RadarEventRecord['sourceMix']['byTier'])
          : undefined,
      byType:
        sourceMix.byType && typeof sourceMix.byType === 'object'
          ? (sourceMix.byType as RadarEventRecord['sourceMix']['byType'])
          : undefined,
      hasMetricCorroboration:
        typeof sourceMix.hasMetricCorroboration === 'boolean' ? sourceMix.hasMetricCorroboration : undefined,
      diversityScore: typeof sourceMix.diversityScore === 'number' ? sourceMix.diversityScore : undefined,
    },
    sourceDiversityScore: Number(row.source_diversity_score),
    corroborationDetail: normalizeCorroborationDetail(row.corroboration_detail_json),
    noveltyScore: Number(row.novelty_score),
    corroborationScore: Number(row.corroboration_score),
    metricAlignmentScore: Number(row.metric_alignment_score),
    bottleneckProximityScore: Number(row.bottleneck_proximity_score),
    persistenceScore: Number(row.persistence_score),
    structuralityScore: Number(row.structurality_score),
    actionabilityScore: Number(row.actionability_score),
    decision: row.decision,
    overrideDecision: row.override_decision,
    expectedNextSignals: normalizeStringArray(row.expected_next_signals_json),
    acknowledgedAt: toIso(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRadarDomainPosteriorRow(row: RadarDomainPosteriorRow): RadarDomainPosteriorRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    domainId: row.domain_id,
    score: Number(row.score),
    evidenceFeatures: normalizeStringArray(row.evidence_features_json),
    counterFeatures: normalizeStringArray(row.counter_features_json),
    recommendedPackId: row.recommended_pack_id,
    createdAt: row.created_at.toISOString(),
  };
}

function mapRadarAutonomyDecisionRow(row: RadarAutonomyDecisionRow): RadarAutonomyDecisionRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    riskBand: row.risk_band,
    executionMode: row.execution_mode,
    policyReasons: normalizeStringArray(row.policy_reasons_json),
    requiresHuman: row.requires_human,
    killSwitchScope: row.kill_switch_scope as RadarAutonomyDecisionRecord['killSwitchScope'],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRadarOperatorFeedbackRow(row: RadarOperatorFeedbackRow): RadarOperatorFeedbackRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    kind: row.kind,
    note: row.note,
    overrideDecision: row.override_decision,
    createdAt: row.created_at.toISOString(),
  };
}

function mapRadarDomainPackMetricRow(row: RadarDomainPackMetricRow): RadarDomainPackMetricRecord {
  return {
    domainId: row.domain_id,
    calibrationScore: Number(row.calibration_score),
    evaluationCount: row.evaluation_count,
    promotionCount: row.promotion_count,
    dossierCount: row.dossier_count,
    actionCount: row.action_count,
    autoExecuteCount: row.auto_execute_count,
    overrideCount: row.override_count,
    ackCount: row.ack_count,
    confirmedCount: row.confirmed_count,
    invalidatedCount: row.invalidated_count,
    mixedCount: row.mixed_count,
    unresolvedCount: row.unresolved_count,
    lastEventAt: toIso(row.last_event_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRadarControlSettingsRow(row: RadarControlSettingsRow): RadarControlSettingsRecord {
  return normalizeRadarControlSettings(
    {
      globalKillSwitch: row.global_kill_switch,
      autoExecutionEnabled: row.auto_execution_enabled,
      dossierPromotionEnabled: row.dossier_promotion_enabled,
      tier3EscalationEnabled: row.tier3_escalation_enabled,
      disabledDomainIds: normalizeStringArray(row.disabled_domain_ids_json) as RadarControlSettingsRecord['disabledDomainIds'],
      disabledSourceTiers: normalizeStringArray(
        row.disabled_source_tiers_json
      ) as RadarControlSettingsRecord['disabledSourceTiers'],
      updatedBy: row.updated_by,
      updatedAt: row.updated_at.toISOString(),
    },
    row.updated_at.toISOString()
  );
}

export function createRadarUpgradeRepository({
  pool,
  defaultUserId,
}: RadarUpgradeRepositoryDeps): RadarUpgradeRepositoryContract {
  async function getRadarControlSettingsRow(): Promise<RadarControlSettingsRecord> {
    const { rows } = await pool.query<RadarControlSettingsRow>(
      `
        SELECT *
        FROM radar_control_settings
        WHERE singleton = true
        LIMIT 1
      `
    );
    return rows[0] ? mapRadarControlSettingsRow(rows[0]) : normalizeRadarControlSettings(null, new Date().toISOString());
  }

  async function listRadarDomainPackMetricRows(): Promise<RadarDomainPackMetricRecord[]> {
    const { rows } = await pool.query<RadarDomainPackMetricRow>(
      `
        SELECT *
        FROM radar_domain_pack_metrics
        ORDER BY updated_at DESC, domain_id ASC
      `
    );
    return rows.map(mapRadarDomainPackMetricRow);
  }

  async function upsertRadarDomainPackMetric(metric: RadarDomainPackMetricRecord): Promise<void> {
    await pool.query(
      `
        INSERT INTO radar_domain_pack_metrics (
          domain_id,
          calibration_score,
          evaluation_count,
          promotion_count,
          dossier_count,
          action_count,
          auto_execute_count,
          override_count,
          ack_count,
          confirmed_count,
          invalidated_count,
          mixed_count,
          unresolved_count,
          last_event_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $15::timestamptz, $16::timestamptz)
        ON CONFLICT (domain_id)
        DO UPDATE SET
          calibration_score = EXCLUDED.calibration_score,
          evaluation_count = EXCLUDED.evaluation_count,
          promotion_count = EXCLUDED.promotion_count,
          dossier_count = EXCLUDED.dossier_count,
          action_count = EXCLUDED.action_count,
          auto_execute_count = EXCLUDED.auto_execute_count,
          override_count = EXCLUDED.override_count,
          ack_count = EXCLUDED.ack_count,
          confirmed_count = EXCLUDED.confirmed_count,
          invalidated_count = EXCLUDED.invalidated_count,
          mixed_count = EXCLUDED.mixed_count,
          unresolved_count = EXCLUDED.unresolved_count,
          last_event_at = EXCLUDED.last_event_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        metric.domainId,
        metric.calibrationScore,
        metric.evaluationCount,
        metric.promotionCount,
        metric.dossierCount,
        metric.actionCount,
        metric.autoExecuteCount,
        metric.overrideCount,
        metric.ackCount,
        metric.confirmedCount,
        metric.invalidatedCount,
        metric.mixedCount,
        metric.unresolvedCount,
        metric.lastEventAt,
        metric.createdAt,
        metric.updatedAt,
      ]
    );
  }

  return {
    async upsertRadarFeedSources(input) {
      const rows: RadarFeedSourceRecord[] = [];
      for (const source of input.sources) {
        const { rows: persisted } = await pool.query<RadarFeedSourceRow>(
          `
            INSERT INTO radar_feed_sources (
              id,
              name,
              kind,
              url,
              source_type,
              source_tier,
              poll_minutes,
              enabled,
              parser_hints_json,
              entity_hints_json,
              metric_hints_json,
              last_fetched_at,
              last_success_at,
              last_error
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb,
              $12::timestamptz, $13::timestamptz, $14
            )
            ON CONFLICT (id)
            DO UPDATE SET
              name = EXCLUDED.name,
              kind = EXCLUDED.kind,
              url = EXCLUDED.url,
              source_type = EXCLUDED.source_type,
              source_tier = EXCLUDED.source_tier,
              poll_minutes = EXCLUDED.poll_minutes,
              enabled = EXCLUDED.enabled,
              parser_hints_json = EXCLUDED.parser_hints_json,
              entity_hints_json = EXCLUDED.entity_hints_json,
              metric_hints_json = EXCLUDED.metric_hints_json,
              last_fetched_at = COALESCE(EXCLUDED.last_fetched_at, radar_feed_sources.last_fetched_at),
              last_success_at = COALESCE(EXCLUDED.last_success_at, radar_feed_sources.last_success_at),
              last_error = COALESCE(EXCLUDED.last_error, radar_feed_sources.last_error),
              updated_at = now()
            RETURNING *
          `,
          [
            source.id,
            source.name,
            source.kind,
            source.url,
            source.sourceType,
            source.sourceTier,
            source.pollMinutes,
            source.enabled,
            JSON.stringify(source.parserHints ?? {}),
            JSON.stringify(source.entityHints ?? []),
            JSON.stringify(source.metricHints ?? []),
            source.lastFetchedAt ?? null,
            source.lastSuccessAt ?? null,
            source.lastError ?? null,
          ]
        );
        rows.push(mapRadarFeedSourceRow(persisted[0]!));
      }
      return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async listRadarFeedSources(input) {
      const params: unknown[] = [input?.limit ?? 200];
      let where = '';
      if (typeof input?.enabled === 'boolean') {
        params.push(input.enabled);
        where = 'WHERE enabled = $2';
      }
      const { rows } = await pool.query<RadarFeedSourceRow>(
        `
          SELECT *
          FROM radar_feed_sources
          ${where}
          ORDER BY updated_at DESC, id ASC
          LIMIT $1
        `,
        params
      );
      return rows.map(mapRadarFeedSourceRow);
    },

    async toggleRadarFeedSource(input) {
      const { rows } = await pool.query<RadarFeedSourceRow>(
        `
          UPDATE radar_feed_sources
          SET enabled = $2,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [input.sourceId, input.enabled]
      );
      return rows[0] ? mapRadarFeedSourceRow(rows[0]) : null;
    },

    async listRadarFeedCursors(input) {
      const params: unknown[] = [];
      let where = '';
      if (input?.sourceId) {
        params.push(input.sourceId);
        where = 'WHERE source_id = $1';
      }
      const { rows } = await pool.query<RadarFeedCursorRow>(
        `
          SELECT *
          FROM radar_feed_cursors
          ${where}
          ORDER BY updated_at DESC, source_id ASC
        `,
        params
      );
      return rows.map(mapRadarFeedCursorRow);
    },

    async upsertRadarFeedCursor(input) {
      const { rows } = await pool.query<RadarFeedCursorRow>(
        `
          INSERT INTO radar_feed_cursors (
            source_id,
            cursor_text,
            etag,
            last_modified,
            last_seen_published_at,
            last_fetched_at
          )
          VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
          ON CONFLICT (source_id)
          DO UPDATE SET
            cursor_text = COALESCE(EXCLUDED.cursor_text, radar_feed_cursors.cursor_text),
            etag = COALESCE(EXCLUDED.etag, radar_feed_cursors.etag),
            last_modified = COALESCE(EXCLUDED.last_modified, radar_feed_cursors.last_modified),
            last_seen_published_at = COALESCE(EXCLUDED.last_seen_published_at, radar_feed_cursors.last_seen_published_at),
            last_fetched_at = COALESCE(EXCLUDED.last_fetched_at, radar_feed_cursors.last_fetched_at),
            updated_at = now()
          RETURNING *
        `,
        [
          input.sourceId,
          input.cursor ?? null,
          input.etag ?? null,
          input.lastModified ?? null,
          input.lastSeenPublishedAt ?? null,
          input.lastFetchedAt ?? null,
        ]
      );
      return mapRadarFeedCursorRow(rows[0]!);
    },

    async createRadarIngestRun(input) {
      const { rows } = await pool.query<RadarIngestRunRow>(
        `
          INSERT INTO radar_ingest_runs (
            source_id,
            status,
            fetched_count,
            ingested_count,
            evaluated_count,
            promoted_count,
            auto_executed_count,
            failed_count,
            error_text,
            detail_json,
            started_at,
            finished_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz, $12::timestamptz
          )
          RETURNING *
        `,
        [
          input.sourceId ?? null,
          input.status ?? 'running',
          input.fetchedCount ?? 0,
          input.ingestedCount ?? 0,
          input.evaluatedCount ?? 0,
          input.promotedCount ?? 0,
          input.autoExecutedCount ?? 0,
          input.failedCount ?? 0,
          input.error ?? null,
          JSON.stringify(input.detailJson ?? {}),
          input.startedAt ?? new Date().toISOString(),
          null,
        ]
      );
      return mapRadarIngestRunRow(rows[0]!);
    },

    async completeRadarIngestRun(input) {
      const { rows } = await pool.query<RadarIngestRunRow>(
        `
          UPDATE radar_ingest_runs
          SET finished_at = COALESCE($2::timestamptz, finished_at, now()),
              status = $3,
              fetched_count = COALESCE($4, fetched_count),
              ingested_count = COALESCE($5, ingested_count),
              evaluated_count = COALESCE($6, evaluated_count),
              promoted_count = COALESCE($7, promoted_count),
              auto_executed_count = COALESCE($8, auto_executed_count),
              failed_count = COALESCE($9, failed_count),
              error_text = COALESCE($10, error_text),
              detail_json = CASE
                WHEN $11::jsonb IS NULL THEN detail_json
                ELSE COALESCE(detail_json, '{}'::jsonb) || $11::jsonb
              END,
              updated_at = now()
          WHERE id = $1::uuid
          RETURNING *
        `,
        [
          input.runId,
          input.finishedAt ?? new Date().toISOString(),
          input.status,
          input.fetchedCount ?? null,
          input.ingestedCount ?? null,
          input.evaluatedCount ?? null,
          input.promotedCount ?? null,
          input.autoExecutedCount ?? null,
          input.failedCount ?? null,
          input.error ?? null,
          input.detailJson ? JSON.stringify(input.detailJson) : null,
        ]
      );
      return rows[0] ? mapRadarIngestRunRow(rows[0]) : null;
    },

    async listRadarIngestRuns(input) {
      const params: unknown[] = [input?.limit ?? 50];
      let where = '';
      if (input?.sourceId) {
        params.push(input.sourceId);
        where = 'WHERE source_id = $2';
      }
      const { rows } = await pool.query<RadarIngestRunRow>(
        `
          SELECT *
          FROM radar_ingest_runs
          ${where}
          ORDER BY started_at DESC, created_at DESC
          LIMIT $1
        `,
        params
      );
      return rows.map(mapRadarIngestRunRow);
    },

    async ingestRadarItems(items: RadarItemRecord[]) {
      const persisted: RadarItemRecord[] = [];
      for (const item of items) {
        const { rows } = await pool.query<RadarItemRow>(
          `
            INSERT INTO tech_radar_items (
              source_url,
              source_name,
              title,
              summary,
              published_at,
              observed_at,
              item_hash,
              confidence_score,
              status,
              source_type,
              source_tier,
              raw_metrics_json,
              entity_hints_json,
              trust_hint,
              payload
            )
            VALUES (
              $1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9::radar_item_status, $10, $11, $12::jsonb, $13::jsonb, $14, $15::jsonb
            )
            ON CONFLICT (source_url, item_hash)
            DO UPDATE SET
              title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              published_at = EXCLUDED.published_at,
              observed_at = EXCLUDED.observed_at,
              confidence_score = EXCLUDED.confidence_score,
              status = EXCLUDED.status,
              source_type = EXCLUDED.source_type,
              source_tier = EXCLUDED.source_tier,
              raw_metrics_json = EXCLUDED.raw_metrics_json,
              entity_hints_json = EXCLUDED.entity_hints_json,
              trust_hint = EXCLUDED.trust_hint,
              payload = EXCLUDED.payload,
              updated_at = now()
            RETURNING id, title, summary, source_url, source_name, published_at, observed_at, confidence_score, status,
                      source_type, source_tier, raw_metrics_json, entity_hints_json, trust_hint, payload
          `,
          [
            item.sourceUrl,
            item.sourceName,
            item.title,
            item.summary,
            item.publishedAt,
            item.observedAt ?? item.publishedAt,
            item.id,
            item.confidenceScore,
            item.status,
            item.sourceType ?? null,
            item.sourceTier ?? null,
            JSON.stringify(item.rawMetrics ?? {}),
            JSON.stringify(item.entityHints ?? []),
            item.trustHint ?? null,
            JSON.stringify(item.payload ?? {}),
          ]
        );
        persisted.push(mapRadarItemRow(rows[0]!));
      }

      return persisted;
    },

    async listRadarItems(input: { status?: RadarItemStatus; limit: number }) {
      const params: unknown[] = [input.limit];
      let where = '';
      if (input.status) {
        params.push(input.status);
        where = 'WHERE status = $2::radar_item_status';
      }
      const { rows } = await pool.query<RadarItemRow>(
        `
          SELECT id, title, summary, source_url, source_name, published_at, observed_at, confidence_score, status,
                 source_type, source_tier, raw_metrics_json, entity_hints_json, trust_hint, payload
          FROM tech_radar_items
          ${where}
          ORDER BY published_at DESC NULLS LAST, created_at DESC
          LIMIT $1
        `,
        params
      );
      return rows.map(mapRadarItemRow);
    },

    async evaluateRadar(input: { itemIds: string[] }) {
      if (input.itemIds.length === 0) {
        return [];
      }
      const { rows } = await pool.query<RadarItemRow>(
        `
          SELECT id, title, summary, source_url, source_name, published_at, observed_at, confidence_score, status,
                 source_type, source_tier, raw_metrics_json, entity_hints_json, trust_hint, payload
          FROM tech_radar_items
          WHERE id = ANY($1::uuid[])
        `,
        [input.itemIds]
      );
      const items = rows.map(mapRadarItemRow);
      const evaluatedAt = new Date().toISOString();
      const baseBundle = buildRadarEvaluationBundle({
        items,
        now: evaluatedAt,
      });
      const [control, metrics] = await Promise.all([getRadarControlSettingsRow(), listRadarDomainPackMetricRows()]);
      const bundle = applyRadarPolicyControls({
        ...baseBundle,
        control,
        metricsByDomain: new Map(metrics.map((metric) => [metric.domainId, metric] as const)),
      });
      const topPosteriorByEventId = new Map(
        baseBundle.posteriors
          .slice()
          .sort((left, right) => right.score - left.score)
          .map((posterior) => [posterior.eventId, posterior] as const)
      );

      for (const event of bundle.events) {
        await pool.query(
          `
            INSERT INTO radar_event_candidates (
              id, title, summary, event_type, geo_scope, time_scope, dedupe_cluster_id, primary_item_id, cluster_size,
              item_ids_json, entities_json, claims_json, metric_shocks_json, source_mix_json, source_diversity_score,
              corroboration_detail_json, novelty_score, corroboration_score, metric_alignment_score,
              bottleneck_proximity_score, persistence_score, structurality_score, actionability_score, decision,
              override_decision, expected_next_signals_json, acknowledged_at, acknowledged_by
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
              $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26::jsonb, $27::timestamptz, $28
            )
            ON CONFLICT (id)
            DO UPDATE SET
              title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              event_type = EXCLUDED.event_type,
              geo_scope = EXCLUDED.geo_scope,
              time_scope = EXCLUDED.time_scope,
              dedupe_cluster_id = EXCLUDED.dedupe_cluster_id,
              primary_item_id = EXCLUDED.primary_item_id,
              cluster_size = EXCLUDED.cluster_size,
              item_ids_json = EXCLUDED.item_ids_json,
              entities_json = EXCLUDED.entities_json,
              claims_json = EXCLUDED.claims_json,
              metric_shocks_json = EXCLUDED.metric_shocks_json,
              source_mix_json = EXCLUDED.source_mix_json,
              source_diversity_score = EXCLUDED.source_diversity_score,
              corroboration_detail_json = EXCLUDED.corroboration_detail_json,
              novelty_score = EXCLUDED.novelty_score,
              corroboration_score = EXCLUDED.corroboration_score,
              metric_alignment_score = EXCLUDED.metric_alignment_score,
              bottleneck_proximity_score = EXCLUDED.bottleneck_proximity_score,
              persistence_score = EXCLUDED.persistence_score,
              structurality_score = EXCLUDED.structurality_score,
              actionability_score = EXCLUDED.actionability_score,
              decision = EXCLUDED.decision,
              expected_next_signals_json = EXCLUDED.expected_next_signals_json,
              updated_at = now()
          `,
          [
            event.id,
            event.title,
            event.summary,
            event.eventType,
            event.geoScope,
            event.timeScope,
            event.dedupeClusterId,
            event.primaryItemId,
            event.clusterSize,
            JSON.stringify(event.itemIds),
            JSON.stringify(event.entities),
            JSON.stringify(event.claims),
            JSON.stringify(event.metricShocks),
            JSON.stringify(event.sourceMix),
            event.sourceDiversityScore,
            JSON.stringify(event.corroborationDetail),
            event.noveltyScore,
            event.corroborationScore,
            event.metricAlignmentScore,
            event.bottleneckProximityScore,
            event.persistenceScore,
            event.structuralityScore,
            event.actionabilityScore,
            event.decision,
            event.overrideDecision,
            JSON.stringify(event.expectedNextSignals),
            event.acknowledgedAt,
            event.acknowledgedBy,
          ]
        );
        const topDomain = topPosteriorByEventId.get(event.id)?.domainId;
        if (topDomain) {
          const existing = metrics.find((metric) => metric.domainId === topDomain) ?? createDefaultRadarDomainPackMetric(topDomain, evaluatedAt);
          const nextMetric = applyRadarEvaluationToMetric({
            metric: existing,
            event,
          });
          await upsertRadarDomainPackMetric(nextMetric);
        }
      }

      for (const posterior of baseBundle.posteriors) {
        await pool.query(
          `
            INSERT INTO radar_domain_posteriors (
              id, event_id, domain_id, score, evidence_features_json, counter_features_json, recommended_pack_id
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
            ON CONFLICT (id)
            DO UPDATE SET
              score = EXCLUDED.score,
              evidence_features_json = EXCLUDED.evidence_features_json,
              counter_features_json = EXCLUDED.counter_features_json,
              recommended_pack_id = EXCLUDED.recommended_pack_id
          `,
          [
            posterior.id,
            posterior.eventId,
            posterior.domainId,
            posterior.score,
            JSON.stringify(posterior.evidenceFeatures),
            JSON.stringify(posterior.counterFeatures),
            posterior.recommendedPackId,
          ]
        );
      }

      for (const autonomy of bundle.autonomyDecisions) {
        await pool.query(
          `
            INSERT INTO radar_autonomy_decisions (
              id, event_id, risk_band, execution_mode, policy_reasons_json, requires_human, kill_switch_scope
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
            ON CONFLICT (event_id)
            DO UPDATE SET
              id = EXCLUDED.id,
              risk_band = EXCLUDED.risk_band,
              execution_mode = EXCLUDED.execution_mode,
              policy_reasons_json = EXCLUDED.policy_reasons_json,
              requires_human = EXCLUDED.requires_human,
              kill_switch_scope = EXCLUDED.kill_switch_scope,
              updated_at = now()
          `,
          [
            autonomy.id,
            autonomy.eventId,
            autonomy.riskBand,
            autonomy.executionMode,
            JSON.stringify(autonomy.policyReasons),
            autonomy.requiresHuman,
            autonomy.killSwitchScope,
          ]
        );
      }

      const recommendations: RadarRecommendationRecord[] = [];
      for (const recommendation of bundle.recommendations) {
        const event = bundle.events.find((row) => row.id === recommendation.eventId);
        const autonomy = bundle.autonomyDecisions.find((row) => row.eventId === recommendation.eventId);
        const { rows: scoreRows } = await pool.query<{ id: string; evaluated_at: Date }>(
          `
            INSERT INTO tech_radar_scores (
              radar_item_id,
              event_id,
              performance_gain,
              reliability_gain,
              adoption_difficulty,
              rollback_difficulty,
              security_risk,
              total_score,
              decision,
              rationale
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::radar_decision, $10::jsonb)
            RETURNING id, evaluated_at
          `,
          [
            recommendation.itemId,
            recommendation.eventId,
            recommendation.totalScore,
            recommendation.structuralityScore ?? recommendation.totalScore,
            recommendation.migrationCost === 'high' ? 4 : recommendation.migrationCost === 'medium' ? 2.5 : 1.5,
            recommendation.migrationCost === 'high' ? 4 : recommendation.migrationCost === 'medium' ? 2.5 : 1.5,
            autonomy?.riskBand === 'high' ? 4 : autonomy?.riskBand === 'medium' ? 2.5 : 1.2,
            recommendation.totalScore,
            recommendation.decision,
            JSON.stringify({
              expectedBenefit: recommendation.expectedBenefit,
              migrationCost: recommendation.migrationCost,
              riskLevel: recommendation.riskLevel,
              structuralityScore: recommendation.structuralityScore ?? null,
              actionabilityScore: recommendation.actionabilityScore ?? null,
              promotionDecision: recommendation.promotionDecision ?? null,
              domainIds: recommendation.domainIds ?? [],
              autonomyExecutionMode: recommendation.autonomyExecutionMode ?? null,
              autonomyRiskBand: recommendation.autonomyRiskBand ?? null,
              eventSummary: event?.summary ?? null,
            }),
          ]
        );

        await pool.query(
          `
            UPDATE tech_radar_items
            SET status = 'scored'::radar_item_status,
                updated_at = now()
            WHERE id = ANY($1::uuid[])
          `,
          [event?.itemIds ?? [recommendation.itemId]]
        );

        if (recommendation.decision !== 'discard') {
          await pool.query(
            `
              INSERT INTO upgrade_proposals (
                radar_score_id,
                proposal_title,
                change_plan,
                risk_plan,
                status
              )
              VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, 'proposed'::upgrade_status)
            `,
            [
              scoreRows[0]!.id,
              `Adopt candidate ${recommendation.itemId}`,
              JSON.stringify({ target: recommendation.itemId, eventId: recommendation.eventId }),
              JSON.stringify({ risk: recommendation.riskLevel, migrationCost: recommendation.migrationCost }),
            ]
          );
        }

        recommendations.push({
          ...recommendation,
          id: scoreRows[0]!.id,
          evaluatedAt: scoreRows[0]!.evaluated_at.toISOString(),
        });
      }

      return recommendations;
    },

    async listRadarRecommendations(decision?: 'adopt' | 'hold' | 'discard') {
      const params: unknown[] = [];
      let where = '';
      if (decision) {
        params.push(decision);
        where = 'WHERE decision = $1::radar_decision';
      }
      const { rows } = await pool.query<{
        id: string;
        radar_item_id: string;
        event_id: string | null;
        decision: 'adopt' | 'hold' | 'discard';
        total_score: string | number;
        rationale: Record<string, unknown>;
        evaluated_at: Date;
      }>(
        `
          SELECT id, radar_item_id, event_id, decision, total_score, rationale, evaluated_at
          FROM tech_radar_scores
          ${where}
          ORDER BY evaluated_at DESC
          LIMIT 200
        `,
        params
      );
      return rows.map((row) => ({
        id: row.id,
        itemId: row.radar_item_id,
        decision: row.decision,
        totalScore: Number(row.total_score),
        expectedBenefit: String(row.rationale.expectedBenefit ?? 'medium'),
        migrationCost: String(row.rationale.migrationCost ?? 'medium'),
        riskLevel: String(row.rationale.riskLevel ?? 'medium'),
        evaluatedAt: row.evaluated_at.toISOString(),
        eventId: row.event_id,
        structuralityScore:
          typeof row.rationale.structuralityScore === 'number' ? row.rationale.structuralityScore : undefined,
        actionabilityScore:
          typeof row.rationale.actionabilityScore === 'number' ? row.rationale.actionabilityScore : undefined,
        promotionDecision:
          typeof row.rationale.promotionDecision === 'string'
            ? (row.rationale.promotionDecision as RadarRecommendationRecord['promotionDecision'])
            : undefined,
        domainIds: Array.isArray(row.rationale.domainIds)
          ? (row.rationale.domainIds.filter((item): item is string => typeof item === 'string') as RadarRecommendationRecord['domainIds'])
          : undefined,
        autonomyExecutionMode:
          typeof row.rationale.autonomyExecutionMode === 'string'
            ? (row.rationale.autonomyExecutionMode as RadarRecommendationRecord['autonomyExecutionMode'])
            : undefined,
        autonomyRiskBand:
          typeof row.rationale.autonomyRiskBand === 'string'
            ? (row.rationale.autonomyRiskBand as RadarRecommendationRecord['autonomyRiskBand'])
            : undefined,
      }));
    },

    async listRadarEvents(input: { decision?: RadarPromotionDecision; limit: number }) {
      const params: unknown[] = [input.limit];
      let where = '';
      if (input.decision) {
        params.push(input.decision);
        where = 'WHERE COALESCE(override_decision, decision) = $2';
      }
      const { rows } = await pool.query<RadarEventRow>(
        `
          SELECT *
          FROM radar_event_candidates
          ${where}
          ORDER BY updated_at DESC
          LIMIT $1
        `,
        params
      );
      return rows.map(mapRadarEventRow);
    },

    async getRadarEventById(eventId: string) {
      const { rows } = await pool.query<RadarEventRow>(
        `
          SELECT *
          FROM radar_event_candidates
          WHERE id = $1
          LIMIT 1
        `,
        [eventId]
      );
      return rows[0] ? mapRadarEventRow(rows[0]) : null;
    },

    async listRadarDomainPosteriors(eventId: string) {
      const { rows } = await pool.query<RadarDomainPosteriorRow>(
        `
          SELECT *
          FROM radar_domain_posteriors
          WHERE event_id = $1
          ORDER BY score DESC, created_at DESC
        `,
        [eventId]
      );
      return rows.map(mapRadarDomainPosteriorRow);
    },

    async getRadarAutonomyDecision(eventId: string) {
      const { rows } = await pool.query<RadarAutonomyDecisionRow>(
        `
          SELECT *
          FROM radar_autonomy_decisions
          WHERE event_id = $1
          LIMIT 1
        `,
        [eventId]
      );
      return rows[0] ? mapRadarAutonomyDecisionRow(rows[0]) : null;
    },

    async getRadarControlSettings() {
      return getRadarControlSettingsRow();
    },

    async updateRadarControlSettings(input) {
      const current = await getRadarControlSettingsRow();
      const next = normalizeRadarControlSettings(
        {
          ...current,
          globalKillSwitch: input.globalKillSwitch ?? current.globalKillSwitch,
          autoExecutionEnabled: input.autoExecutionEnabled ?? current.autoExecutionEnabled,
          dossierPromotionEnabled: input.dossierPromotionEnabled ?? current.dossierPromotionEnabled,
          tier3EscalationEnabled: input.tier3EscalationEnabled ?? current.tier3EscalationEnabled,
          disabledDomainIds: input.disabledDomainIds ?? current.disabledDomainIds,
          disabledSourceTiers: input.disabledSourceTiers ?? current.disabledSourceTiers,
          updatedBy: input.userId,
          updatedAt: new Date().toISOString(),
        },
        new Date().toISOString()
      );
      const { rows } = await pool.query<RadarControlSettingsRow>(
        `
          INSERT INTO radar_control_settings (
            singleton,
            global_kill_switch,
            auto_execution_enabled,
            dossier_promotion_enabled,
            tier3_escalation_enabled,
            disabled_domain_ids_json,
            disabled_source_tiers_json,
            updated_by
          )
          VALUES (true, $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::uuid)
          ON CONFLICT (singleton)
          DO UPDATE SET
            global_kill_switch = EXCLUDED.global_kill_switch,
            auto_execution_enabled = EXCLUDED.auto_execution_enabled,
            dossier_promotion_enabled = EXCLUDED.dossier_promotion_enabled,
            tier3_escalation_enabled = EXCLUDED.tier3_escalation_enabled,
            disabled_domain_ids_json = EXCLUDED.disabled_domain_ids_json,
            disabled_source_tiers_json = EXCLUDED.disabled_source_tiers_json,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
          RETURNING *
        `,
        [
          next.globalKillSwitch,
          next.autoExecutionEnabled,
          next.dossierPromotionEnabled,
          next.tier3EscalationEnabled,
          JSON.stringify(next.disabledDomainIds),
          JSON.stringify(next.disabledSourceTiers),
          next.updatedBy,
        ]
      );
      return mapRadarControlSettingsRow(rows[0]!);
    },

    async listRadarDomainPackMetrics() {
      return listRadarDomainPackMetricRows();
    },

    async recordRadarDomainPackOutcome(input) {
      const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
      const existing = (await listRadarDomainPackMetricRows()).find((metric) => metric.domainId === input.domainId) ??
        createDefaultRadarDomainPackMetric(input.domainId, evaluatedAt);
      const next = applyRadarOutcomeToMetric({
        metric: existing,
        result: input.result,
        evaluatedAt,
      });
      await upsertRadarDomainPackMetric(next);
      return next;
    },

    async createRadarOperatorFeedback(input: {
      eventId: string;
      userId: string;
      kind: 'ack' | 'override';
      note?: string | null;
      overrideDecision?: RadarPromotionDecision | null;
    }) {
      const { rows } = await pool.query<RadarOperatorFeedbackRow>(
        `
          INSERT INTO radar_operator_feedback (
            event_id, user_id, kind, note, override_decision
          )
          VALUES ($1, $2::uuid, $3, $4, $5)
          RETURNING *
        `,
        [input.eventId, input.userId, input.kind, input.note ?? null, input.overrideDecision ?? null]
      );
      if (input.kind === 'ack') {
        await pool.query(
          `
            UPDATE radar_event_candidates
            SET acknowledged_at = now(),
                acknowledged_by = $2::uuid,
                updated_at = now()
            WHERE id = $1
          `,
          [input.eventId, input.userId]
        );
      } else {
        await pool.query(
          `
            UPDATE radar_event_candidates
            SET override_decision = $2,
                updated_at = now()
            WHERE id = $1
          `,
          [input.eventId, input.overrideDecision ?? null]
        );
      }
      const feedback = mapRadarOperatorFeedbackRow(rows[0]!);
      const { rows: posteriorRows } = await pool.query<RadarDomainPosteriorRow>(
        `
          SELECT *
          FROM radar_domain_posteriors
          WHERE event_id = $1
          ORDER BY score DESC, created_at DESC
          LIMIT 1
        `,
        [input.eventId]
      );
      const topDomain = posteriorRows[0]?.domain_id ?? null;
      if (topDomain) {
        const existing = (await listRadarDomainPackMetricRows()).find((metric) => metric.domainId === topDomain) ??
          createDefaultRadarDomainPackMetric(topDomain, feedback.createdAt);
        await upsertRadarDomainPackMetric(
          applyRadarFeedbackToMetric({
            metric: existing,
            feedback,
          })
        );
      }
      return feedback;
    },

    async listRadarOperatorFeedback(input: { eventId?: string; limit: number }) {
      const params: unknown[] = [input.limit];
      let where = '';
      if (input.eventId) {
        params.push(input.eventId);
        where = 'WHERE event_id = $2';
      }
      const { rows } = await pool.query<RadarOperatorFeedbackRow>(
        `
          SELECT *
          FROM radar_operator_feedback
          ${where}
          ORDER BY created_at DESC
          LIMIT $1
        `,
        params
      );
      return rows.map(mapRadarOperatorFeedbackRow);
    },

    async listUpgradeProposals(status?: UpgradeStatus) {
      const params: unknown[] = [];
      let where = '';
      if (status) {
        params.push(status);
        where = 'WHERE status = $1::upgrade_status';
      }
      const { rows } = await pool.query<UpgradeProposalRow>(
        `
          SELECT id, radar_score_id, proposal_title, status, created_at, approved_at
          FROM upgrade_proposals
          ${where}
          ORDER BY created_at DESC
          LIMIT 200
        `,
        params
      );
      return rows.map((row) => mapUpgradeProposalRow(row));
    },

    async findUpgradeProposalById(proposalId: string) {
      const { rows } = await pool.query<UpgradeProposalRow>(
        `
          SELECT id, radar_score_id, proposal_title, status, created_at, approved_at
          FROM upgrade_proposals
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [proposalId]
      );
      return rows[0] ? mapUpgradeProposalRow(rows[0]) : null;
    },

    async decideUpgradeProposal(proposalId: string, decision: 'approve' | 'reject', reason?: string) {
      const nextStatus: UpgradeStatus = decision === 'approve' ? 'approved' : 'rejected';
      const { rows } = await pool.query<UpgradeProposalRow>(
        `
          UPDATE upgrade_proposals
          SET status = $2::upgrade_status,
              approved_at = CASE WHEN $2::upgrade_status = 'approved'::upgrade_status THEN now() ELSE NULL END,
              updated_at = now()
          WHERE id = $1::uuid
          RETURNING id, radar_score_id, proposal_title, status, created_at, approved_at
        `,
        [proposalId, nextStatus]
      );
      if (!rows[0]) {
        return null;
      }
      await pool.query(
        `
          INSERT INTO audit_logs (
            actor_user_id,
            action,
            entity_type,
            entity_id,
            reason,
            after_data
          )
          VALUES ($1::uuid, 'upgrade_proposal.decide', 'upgrade_proposal', $2::uuid, $3, $4::jsonb)
        `,
        [defaultUserId, proposalId, reason ?? nextStatus, JSON.stringify({ status: nextStatus })]
      );
      return mapUpgradeProposalRow(rows[0]);
    },

    async createUpgradeRun(payload: { proposalId: string; startCommand: string }) {
      const { rows } = await pool.query<UpgradeRunRow>(
        `
          INSERT INTO upgrade_runs (
            proposal_id,
            triggered_by,
            start_command,
            status
          )
          VALUES ($1::uuid, $2::uuid, $3, 'planning'::upgrade_status)
          RETURNING id, proposal_id, status, start_command, created_at, updated_at
        `,
        [payload.proposalId, defaultUserId, payload.startCommand]
      );
      return mapUpgradeRunRow(rows[0]!);
    },

    async listUpgradeRuns(limit: number) {
      const { rows } = await pool.query<UpgradeRunRow>(
        `
          SELECT id, proposal_id, status, start_command, created_at, updated_at
          FROM upgrade_runs
          ORDER BY created_at DESC
          LIMIT $1
        `,
        [limit]
      );
      return rows.map((row) => mapUpgradeRunRow(row));
    },

    async getUpgradeRunById(runId: string) {
      const { rows } = await pool.query<UpgradeRunRow>(
        `
          SELECT id, proposal_id, status, start_command, created_at, updated_at
          FROM upgrade_runs
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [runId]
      );
      return rows[0] ? mapUpgradeRunRow(rows[0]) : null;
    },
  };
}

function mapUpgradeProposalRow(row: UpgradeProposalRow): UpgradeProposalRecord {
  return {
    id: row.id,
    recommendationId: row.radar_score_id,
    proposalTitle: row.proposal_title,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    approvedAt: toIso(row.approved_at),
  };
}

function mapUpgradeRunRow(row: UpgradeRunRow): UpgradeRunApiRecord {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    status: row.status,
    startCommand: row.start_command,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
