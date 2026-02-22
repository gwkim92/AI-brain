import { randomUUID } from 'node:crypto';

import { evaluateRadarItems } from '../radar/scoring';
import type {
  CreateTaskInput,
  JarvisStore,
  RadarItemRecord,
  RadarItemStatus,
  RadarRecommendationRecord,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  UpgradeProposalRecord,
  UpgradeRunApiRecord,
  UpgradeStatus
} from './types';

export function createMemoryStore(defaultUserId: string): JarvisStore {
  const tasks = new Map<string, TaskRecord>();
  const taskEvents = new Map<string, TaskEventRecord[]>();

  const radarItems = new Map<string, RadarItemRecord>();
  const radarRecommendations = new Map<string, RadarRecommendationRecord>();

  const upgradeProposals = new Map<string, UpgradeProposalRecord>();
  const upgradeRuns = new Map<string, UpgradeRunApiRecord>();

  const nowIso = () => new Date().toISOString();

  const store: JarvisStore = {
    kind: 'memory',

    async initialize() {
      return;
    },

    async health() {
      return {
        store: 'memory',
        db: 'n/a'
      };
    },

    async createTask(input: CreateTaskInput) {
      const now = nowIso();
      const task: TaskRecord = {
        id: randomUUID(),
        userId: input.userId || defaultUserId,
        mode: input.mode,
        status: 'queued',
        title: input.title,
        input: input.input,
        idempotencyKey: input.idempotencyKey,
        traceId: input.traceId,
        createdAt: now,
        updatedAt: now
      };

      tasks.set(task.id, task);

      await store.appendTaskEvent({
        taskId: task.id,
        type: 'task.created',
        data: {
          mode: task.mode,
          status: task.status
        }
      });

      return task;
    },

    async listTasks(input: { status?: TaskStatus; limit: number }) {
      const rows = [...tasks.values()]
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit);

      return rows;
    },

    async getTaskById(taskId: string) {
      return tasks.get(taskId) ?? null;
    },

    async appendTaskEvent(event: Omit<TaskEventRecord, 'id' | 'timestamp'>) {
      const next: TaskEventRecord = {
        id: randomUUID(),
        taskId: event.taskId,
        type: event.type,
        timestamp: nowIso(),
        data: event.data
      };

      const prev = taskEvents.get(event.taskId) ?? [];
      prev.push(next);
      taskEvents.set(event.taskId, prev);

      return next;
    },

    async listTaskEvents(taskId: string, limit: number) {
      const rows = taskEvents.get(taskId) ?? [];
      return rows.slice(Math.max(0, rows.length - limit));
    },

    async ingestRadarItems(items: RadarItemRecord[]) {
      for (const item of items) {
        radarItems.set(item.id, item);
      }
      return items.length;
    },

    async listRadarItems(input: { status?: RadarItemStatus; limit: number }) {
      return [...radarItems.values()]
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''))
        .slice(0, input.limit);
    },

    async evaluateRadar(input: { itemIds: string[] }) {
      const selected = input.itemIds
        .map((itemId) => radarItems.get(itemId))
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
        radarRecommendations.set(recommendation.id, recommendation);

        if (recommendation.decision !== 'discard') {
          const proposalId = randomUUID();
          upgradeProposals.set(proposalId, {
            id: proposalId,
            recommendationId: recommendation.id,
            proposalTitle: `Adopt candidate ${recommendation.itemId}`,
            status: 'proposed',
            createdAt: nowIso(),
            approvedAt: null
          });
        }

        const sourceItem = radarItems.get(recommendation.itemId);
        if (sourceItem) {
          radarItems.set(recommendation.itemId, {
            ...sourceItem,
            status: 'scored'
          });
        }
      }

      return recommendations;
    },

    async listRadarRecommendations(decision?: 'adopt' | 'hold' | 'discard') {
      return [...radarRecommendations.values()]
        .filter((item) => (decision ? item.decision === decision : true))
        .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt));
    },

    async createTelegramReport(input: { chatId: string }) {
      return {
        id: randomUUID(),
        chatId: input.chatId,
        status: 'queued',
        createdAt: nowIso()
      };
    },

    async listUpgradeProposals(status?: UpgradeStatus) {
      return [...upgradeProposals.values()]
        .filter((item) => (status ? item.status === status : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    async findUpgradeProposalById(proposalId: string) {
      return upgradeProposals.get(proposalId) ?? null;
    },

    async decideUpgradeProposal(proposalId: string, decision: 'approve' | 'reject') {
      const current = upgradeProposals.get(proposalId);
      if (!current) {
        return null;
      }

      const nextStatus: UpgradeStatus = decision === 'approve' ? 'approved' : 'rejected';
      const next: UpgradeProposalRecord = {
        ...current,
        status: nextStatus,
        approvedAt: nextStatus === 'approved' ? nowIso() : null
      };
      upgradeProposals.set(proposalId, next);

      return next;
    },

    async createUpgradeRun(payload: { proposalId: string; startCommand: string }) {
      const now = nowIso();
      const run: UpgradeRunApiRecord = {
        id: randomUUID(),
        proposalId: payload.proposalId,
        status: 'planning',
        startCommand: payload.startCommand,
        createdAt: now,
        updatedAt: now
      };
      upgradeRuns.set(run.id, run);
      return run;
    },

    async getUpgradeRunById(runId: string) {
      return upgradeRuns.get(runId) ?? null;
    },

    createUpgradeExecutorGateway() {
      return {
        findProposalById: async (proposalId: string) => {
          const proposal = await store.findUpgradeProposalById(proposalId);
          if (!proposal) {
            return null;
          }
          return {
            id: proposal.id,
            status: proposal.status
          };
        },
        createRun: async (payload: { proposalId: string; startCommand: string }) => {
          const run = await store.createUpgradeRun(payload);
          return {
            id: run.id,
            proposalId: run.proposalId,
            status: run.status
          };
        },
        appendAuditLog: async () => {
          return;
        }
      };
    }
  };

  return store;
}
