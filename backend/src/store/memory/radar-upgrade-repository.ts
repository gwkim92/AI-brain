import { randomUUID } from 'node:crypto';

import { buildRadarEvaluationBundle } from '../../radar/pipeline';
import {
  applyRadarEvaluationToMetric,
  applyRadarFeedbackToMetric,
  applyRadarOutcomeToMetric,
  applyRadarPolicyControls,
  createDefaultRadarDomainPackMetric,
  normalizeRadarControlSettings,
} from '../../radar/policy';
import type {
  RadarFeedCursorRecord,
  RadarFeedSourceRecord,
  RadarIngestRunRecord,
  RadarItemRecord,
  RadarItemStatus,
  RadarOperatorFeedbackRecord,
  RadarRecommendationRecord,
  RadarPromotionDecision,
  UpgradeStatus
} from '../types';
import type { RadarUpgradeRepositoryContract } from '../repository-contracts';
import type { MemoryStoreState } from './state';

type MemoryRadarUpgradeRepositoryDeps = {
  state: MemoryStoreState;
  nowIso: () => string;
};

export function createMemoryRadarUpgradeRepository({
  state,
  nowIso
}: MemoryRadarUpgradeRepositoryDeps): RadarUpgradeRepositoryContract {
  const listByUpdatedAt = <T extends { createdAt?: string; updatedAt?: string; evaluatedAt?: string }>(rows: T[]): T[] =>
    rows.sort((left, right) =>
      (right.updatedAt ?? right.createdAt ?? right.evaluatedAt ?? '').localeCompare(
        left.updatedAt ?? left.createdAt ?? left.evaluatedAt ?? ''
      )
    );

  const listSorted = <T extends { createdAt?: string; updatedAt?: string; evaluatedAt?: string }>(rows: T[]): T[] =>
    rows.sort((left, right) =>
      (right.updatedAt ?? right.createdAt ?? right.evaluatedAt ?? '').localeCompare(
        left.updatedAt ?? left.createdAt ?? left.evaluatedAt ?? ''
      )
    );

  return {
    async upsertRadarFeedSources(input) {
      const now = nowIso();
      const rows: RadarFeedSourceRecord[] = [];
      for (const source of input.sources) {
        const current = state.radarFeedSources.get(source.id);
        const next: RadarFeedSourceRecord = {
          id: source.id,
          name: source.name,
          kind: source.kind,
          url: source.url,
          sourceType: source.sourceType,
          sourceTier: source.sourceTier,
          pollMinutes: source.pollMinutes,
          enabled: source.enabled,
          parserHints: { ...(source.parserHints ?? {}) },
          entityHints: [...(source.entityHints ?? [])],
          metricHints: [...(source.metricHints ?? [])],
          lastFetchedAt: source.lastFetchedAt ?? current?.lastFetchedAt ?? null,
          lastSuccessAt: source.lastSuccessAt ?? current?.lastSuccessAt ?? null,
          lastError: source.lastError ?? current?.lastError ?? null,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        };
        state.radarFeedSources.set(next.id, next);
        rows.push(next);
      }
      return listByUpdatedAt(rows);
    },

    async listRadarFeedSources(input) {
      return listByUpdatedAt(
        [...state.radarFeedSources.values()]
          .filter((source) => (typeof input?.enabled === 'boolean' ? source.enabled === input.enabled : true))
          .slice(0, input?.limit ?? 200)
      );
    },

    async toggleRadarFeedSource(input) {
      const current = state.radarFeedSources.get(input.sourceId);
      if (!current) {
        return null;
      }
      const next: RadarFeedSourceRecord = {
        ...current,
        enabled: input.enabled,
        updatedAt: nowIso(),
      };
      state.radarFeedSources.set(next.id, next);
      return next;
    },

    async listRadarFeedCursors(input) {
      return listByUpdatedAt(
        [...state.radarFeedCursors.values()]
          .filter((cursor) => (input?.sourceId ? cursor.sourceId === input.sourceId : true))
      );
    },

    async upsertRadarFeedCursor(input) {
      const now = nowIso();
      const current = state.radarFeedCursors.get(input.sourceId);
      const next: RadarFeedCursorRecord = {
        sourceId: input.sourceId,
        cursor: input.cursor ?? current?.cursor ?? null,
        etag: input.etag ?? current?.etag ?? null,
        lastModified: input.lastModified ?? current?.lastModified ?? null,
        lastSeenPublishedAt: input.lastSeenPublishedAt ?? current?.lastSeenPublishedAt ?? null,
        lastFetchedAt: input.lastFetchedAt ?? current?.lastFetchedAt ?? now,
        updatedAt: now,
      };
      state.radarFeedCursors.set(next.sourceId, next);
      return next;
    },

    async createRadarIngestRun(input) {
      const now = nowIso();
      const row: RadarIngestRunRecord = {
        id: randomUUID(),
        sourceId: input.sourceId ?? null,
        startedAt: input.startedAt ?? now,
        finishedAt: null,
        status: input.status ?? 'running',
        fetchedCount: input.fetchedCount ?? 0,
        ingestedCount: input.ingestedCount ?? 0,
        evaluatedCount: input.evaluatedCount ?? 0,
        promotedCount: input.promotedCount ?? 0,
        autoExecutedCount: input.autoExecutedCount ?? 0,
        failedCount: input.failedCount ?? 0,
        error: input.error ?? null,
        detailJson: { ...(input.detailJson ?? {}) },
        createdAt: now,
        updatedAt: now,
      };
      state.radarIngestRuns.set(row.id, row);
      return row;
    },

    async completeRadarIngestRun(input) {
      const current = state.radarIngestRuns.get(input.runId);
      if (!current) {
        return null;
      }
      const next: RadarIngestRunRecord = {
        ...current,
        finishedAt: input.finishedAt ?? nowIso(),
        status: input.status,
        fetchedCount: input.fetchedCount ?? current.fetchedCount,
        ingestedCount: input.ingestedCount ?? current.ingestedCount,
        evaluatedCount: input.evaluatedCount ?? current.evaluatedCount,
        promotedCount: input.promotedCount ?? current.promotedCount,
        autoExecutedCount: input.autoExecutedCount ?? current.autoExecutedCount,
        failedCount: input.failedCount ?? current.failedCount,
        error: input.error ?? current.error,
        detailJson: { ...current.detailJson, ...(input.detailJson ?? {}) },
        updatedAt: nowIso(),
      };
      state.radarIngestRuns.set(next.id, next);
      return next;
    },

    async listRadarIngestRuns(input) {
      return listByUpdatedAt(
        [...state.radarIngestRuns.values()]
          .filter((run) => (input?.sourceId ? run.sourceId === input.sourceId : true))
          .slice(0, input?.limit ?? 50)
      );
    },

    async ingestRadarItems(items: RadarItemRecord[]) {
      const rows: RadarItemRecord[] = [];
      for (const item of items) {
        const next = {
          ...item,
          sourceType: item.sourceType ?? 'manual',
          sourceTier: item.sourceTier ?? 'tier_2',
          observedAt: item.observedAt ?? item.publishedAt ?? null,
          rawMetrics: { ...(item.rawMetrics ?? {}) },
          entityHints: [...(item.entityHints ?? [])],
          trustHint: item.trustHint ?? null,
          payload: { ...(item.payload ?? {}) },
        };
        state.radarItems.set(item.id, next);
        rows.push(next);
      }
      return rows;
    },

    async listRadarItems(input: { status?: RadarItemStatus; limit: number }) {
      return [...state.radarItems.values()]
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''))
        .slice(0, input.limit);
    },

    async evaluateRadar(input: { itemIds: string[] }) {
      const selected = input.itemIds
        .map((itemId) => state.radarItems.get(itemId))
        .filter((item): item is RadarItemRecord => Boolean(item));

      const evaluatedAt = nowIso();
      const baseBundle = buildRadarEvaluationBundle({
        items: selected,
        now: evaluatedAt,
      });
      const control = normalizeRadarControlSettings(state.radarControlSettings, evaluatedAt);
      const metricsByDomain = new Map(
        [...state.radarDomainPackMetrics.values()].map((metric) => [metric.domainId, metric] as const)
      );
      const bundle = applyRadarPolicyControls({
        ...baseBundle,
        control,
        metricsByDomain,
      });

      const topPosteriorByEventId = new Map(
        baseBundle.posteriors
          .slice()
          .sort((left, right) => right.score - left.score)
          .map((posterior) => [posterior.eventId, posterior] as const)
      );

      for (const event of bundle.events) {
        state.radarEvents.set(event.id, event);
        const topDomain = topPosteriorByEventId.get(event.id)?.domainId;
        if (topDomain) {
          const existing = state.radarDomainPackMetrics.get(topDomain) ?? createDefaultRadarDomainPackMetric(topDomain, evaluatedAt);
          state.radarDomainPackMetrics.set(
            topDomain,
            applyRadarEvaluationToMetric({
              metric: existing,
              event,
            })
          );
        }
      }
      for (const posterior of baseBundle.posteriors) {
        state.radarDomainPosteriors.set(posterior.id, posterior);
      }
      for (const autonomy of bundle.autonomyDecisions) {
        state.radarAutonomyDecisions.set(autonomy.eventId, autonomy);
      }

      const recommendations: RadarRecommendationRecord[] = bundle.recommendations;

      for (const recommendation of recommendations) {
        state.radarRecommendations.set(recommendation.id, recommendation);

        if (recommendation.decision !== 'discard') {
          const proposalId = randomUUID();
          state.upgradeProposals.set(proposalId, {
            id: proposalId,
            recommendationId: recommendation.id,
            proposalTitle: `Adopt candidate ${recommendation.itemId}`,
            status: 'proposed',
            createdAt: nowIso(),
            approvedAt: null
          });
        }

        const event = bundle.events.find((row) => row.id === recommendation.eventId);
        for (const itemId of event?.itemIds ?? [recommendation.itemId]) {
          const sourceItem = state.radarItems.get(itemId);
          if (!sourceItem) continue;
          state.radarItems.set(itemId, {
            ...sourceItem,
            status: 'scored'
          });
        }
      }

      return recommendations;
    },

    async listRadarRecommendations(decision?: 'adopt' | 'hold' | 'discard') {
      return listSorted(
        [...state.radarRecommendations.values()].filter((item) => (decision ? item.decision === decision : true))
      );
    },

    async listRadarEvents(input: { decision?: RadarPromotionDecision; limit: number }) {
      return listSorted(
        [...state.radarEvents.values()]
          .filter((item) => (input.decision ? (item.overrideDecision ?? item.decision) === input.decision : true))
          .slice(0, input.limit)
      );
    },

    async getRadarEventById(eventId: string) {
      return state.radarEvents.get(eventId) ?? null;
    },

    async listRadarDomainPosteriors(eventId: string) {
      return [...state.radarDomainPosteriors.values()]
        .filter((item) => item.eventId === eventId)
        .sort((left, right) => right.score - left.score);
    },

    async getRadarAutonomyDecision(eventId: string) {
      return state.radarAutonomyDecisions.get(eventId) ?? null;
    },

    async getRadarControlSettings() {
      return normalizeRadarControlSettings(state.radarControlSettings, nowIso());
    },

    async updateRadarControlSettings(input) {
      const current = normalizeRadarControlSettings(state.radarControlSettings, nowIso());
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
          updatedAt: nowIso(),
        },
        nowIso()
      );
      state.radarControlSettings = next;
      return next;
    },

    async listRadarDomainPackMetrics() {
      return listSorted([...state.radarDomainPackMetrics.values()]);
    },

    async recordRadarDomainPackOutcome(input) {
      const evaluatedAt = input.evaluatedAt ?? nowIso();
      const existing = state.radarDomainPackMetrics.get(input.domainId) ?? createDefaultRadarDomainPackMetric(input.domainId, evaluatedAt);
      const next = applyRadarOutcomeToMetric({
        metric: existing,
        result: input.result,
        evaluatedAt,
      });
      state.radarDomainPackMetrics.set(input.domainId, next);
      return next;
    },

    async createRadarOperatorFeedback(input: {
      eventId: string;
      userId: string;
      kind: 'ack' | 'override';
      note?: string | null;
      overrideDecision?: RadarPromotionDecision | null;
    }) {
      const row: RadarOperatorFeedbackRecord = {
        id: randomUUID(),
        eventId: input.eventId,
        userId: input.userId,
        kind: input.kind,
        note: input.note ?? null,
        overrideDecision: input.overrideDecision ?? null,
        createdAt: nowIso(),
      };
      state.radarOperatorFeedback.set(row.id, row);
      const event = state.radarEvents.get(input.eventId);
      if (event) {
        state.radarEvents.set(input.eventId, {
          ...event,
          acknowledgedAt: input.kind === 'ack' ? row.createdAt : event.acknowledgedAt,
          acknowledgedBy: input.kind === 'ack' ? input.userId : event.acknowledgedBy,
          overrideDecision: input.kind === 'override' ? (input.overrideDecision ?? null) : event.overrideDecision,
          updatedAt: row.createdAt,
        });
        const topDomain = [...state.radarDomainPosteriors.values()]
          .filter((posterior) => posterior.eventId === input.eventId)
          .sort((left, right) => right.score - left.score)[0]?.domainId;
        if (topDomain) {
          const existing = state.radarDomainPackMetrics.get(topDomain) ?? createDefaultRadarDomainPackMetric(topDomain, row.createdAt);
          state.radarDomainPackMetrics.set(
            topDomain,
            applyRadarFeedbackToMetric({
              metric: existing,
              feedback: row,
            })
          );
        }
      }
      return row;
    },

    async listRadarOperatorFeedback(input: { eventId?: string; limit: number }) {
      return listSorted(
        [...state.radarOperatorFeedback.values()]
          .filter((item) => (input.eventId ? item.eventId === input.eventId : true))
          .slice(0, input.limit)
      );
    },

    async listUpgradeProposals(status?: UpgradeStatus) {
      return [...state.upgradeProposals.values()]
        .filter((item) => (status ? item.status === status : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    async findUpgradeProposalById(proposalId: string) {
      return state.upgradeProposals.get(proposalId) ?? null;
    },

    async decideUpgradeProposal(proposalId: string, decision: 'approve' | 'reject') {
      const current = state.upgradeProposals.get(proposalId);
      if (!current) {
        return null;
      }

      const nextStatus: UpgradeStatus = decision === 'approve' ? 'approved' : 'rejected';
      const next = {
        ...current,
        status: nextStatus,
        approvedAt: nextStatus === 'approved' ? nowIso() : null
      };
      state.upgradeProposals.set(proposalId, next);

      return next;
    },

    async createUpgradeRun(payload: { proposalId: string; startCommand: string }) {
      const now = nowIso();
      const run = {
        id: randomUUID(),
        proposalId: payload.proposalId,
        status: 'planning' as const,
        startCommand: payload.startCommand,
        createdAt: now,
        updatedAt: now
      };
      state.upgradeRuns.set(run.id, run);
      return run;
    },

    async listUpgradeRuns(limit: number) {
      return [...state.upgradeRuns.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    },

    async getUpgradeRunById(runId: string) {
      return state.upgradeRuns.get(runId) ?? null;
    }
  };
}
