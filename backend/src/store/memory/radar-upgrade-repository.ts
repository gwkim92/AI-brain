import { randomUUID } from 'node:crypto';

import { evaluateRadarItems } from '../../radar/scoring';
import type {
  RadarItemRecord,
  RadarItemStatus,
  RadarRecommendationRecord,
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
  return {
    async ingestRadarItems(items: RadarItemRecord[]) {
      for (const item of items) {
        state.radarItems.set(item.id, item);
      }
      return items.length;
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

      const candidates = selected.map((item) => ({
        id: item.id,
        title: item.title,
        benefit: Math.max(1.5, Math.min(5, item.confidenceScore * 5)),
        risk: Math.max(0.5, 3.2 - item.confidenceScore * 2),
        cost: 2.5
      }));

      const scored = evaluateRadarItems(candidates);
      const evaluatedAt = nowIso();

      const recommendations: RadarRecommendationRecord[] = scored.map((row) => ({
        id: row.id,
        itemId: row.itemId,
        decision: row.decision,
        totalScore: row.totalScore,
        expectedBenefit: row.expectedBenefit,
        migrationCost: row.migrationCost,
        riskLevel: row.riskLevel,
        evaluatedAt
      }));

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

        const sourceItem = state.radarItems.get(recommendation.itemId);
        if (sourceItem) {
          state.radarItems.set(recommendation.itemId, {
            ...sourceItem,
            status: 'scored'
          });
        }
      }

      return recommendations;
    },

    async listRadarRecommendations(decision?: 'adopt' | 'hold' | 'discard') {
      return [...state.radarRecommendations.values()]
        .filter((item) => (decision ? item.decision === decision : true))
        .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt));
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
