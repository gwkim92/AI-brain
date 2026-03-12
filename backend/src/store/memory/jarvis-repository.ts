import { randomUUID } from 'node:crypto';

import type {
  ActionProposalRecord,
  BriefingRecord,
  DossierClaimRecord,
  DossierRecord,
  DossierSourceRecord,
  JarvisSessionEventRecord,
  JarvisSessionRecord,
  JarvisSessionStageRecord,
  WatcherRecord,
  WatcherRunRecord
} from '../types';
import type { JarvisRepositoryContract } from '../repository-contracts';
import type { MemoryStoreState } from './state';

type MemoryJarvisRepositoryDeps = {
  state: MemoryStoreState;
  nowIso: () => string;
};

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}

function nextSequence(state: MemoryStoreState): number {
  state.jarvisSessionEventSequence += 1;
  return state.jarvisSessionEventSequence;
}

function toSession(row: JarvisSessionRecord): JarvisSessionRecord {
  return { ...row };
}

function toEvent(row: JarvisSessionEventRecord): JarvisSessionEventRecord {
  return { ...row, data: { ...row.data } };
}

function toStage(row: JarvisSessionStageRecord): JarvisSessionStageRecord {
  return {
    ...row,
    dependsOnJson: [...row.dependsOnJson],
    artifactRefsJson: { ...row.artifactRefsJson }
  };
}

function toActionProposal(row: ActionProposalRecord): ActionProposalRecord {
  return { ...row, payload: { ...row.payload } };
}

function toWatcher(row: WatcherRecord): WatcherRecord {
  return { ...row, configJson: { ...row.configJson } };
}

function toWatcherRun(row: WatcherRunRecord): WatcherRunRecord {
  return { ...row };
}

function toBriefing(row: BriefingRecord): BriefingRecord {
  return { ...row, qualityJson: { ...row.qualityJson } };
}

function toDossier(row: DossierRecord): DossierRecord {
  return {
    ...row,
    qualityJson: { ...row.qualityJson },
    conflictsJson: { ...row.conflictsJson }
  };
}

function toDossierSource(row: DossierSourceRecord): DossierSourceRecord {
  return { ...row };
}

function toDossierClaim(row: DossierClaimRecord): DossierClaimRecord {
  return { ...row, sourceUrls: [...row.sourceUrls] };
}

export function createMemoryJarvisRepository({ state, nowIso }: MemoryJarvisRepositoryDeps): JarvisRepositoryContract {
  return {
    async createJarvisSession(input) {
      const now = nowIso();
      const id = input.id?.trim() || randomUUID();
      const row: JarvisSessionRecord = {
        id,
        userId: input.userId,
        title: input.title,
        prompt: input.prompt,
        source: input.source,
        intent: input.intent,
        status: input.status ?? 'queued',
        workspacePreset: input.workspacePreset ?? null,
        primaryTarget: input.primaryTarget,
        taskId: input.taskId ?? null,
        missionId: input.missionId ?? null,
        assistantContextId: input.assistantContextId ?? null,
        councilRunId: input.councilRunId ?? null,
        executionRunId: input.executionRunId ?? null,
        briefingId: input.briefingId ?? null,
        dossierId: input.dossierId ?? null,
        createdAt: now,
        updatedAt: now,
        lastEventAt: now
      };
      state.jarvisSessions.set(id, row);
      return toSession(row);
    },

    async listJarvisSessions(input) {
      const rows = [...state.jarvisSessions.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.status ? row.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit));
      return rows.map(toSession);
    },

    async getJarvisSessionById(input) {
      const row = state.jarvisSessions.get(input.sessionId);
      if (!row || row.userId !== input.userId) return null;
      return toSession(row);
    },

    async updateJarvisSession(input) {
      const row = state.jarvisSessions.get(input.sessionId);
      if (!row || row.userId !== input.userId) return null;
      const next: JarvisSessionRecord = {
        ...row,
        title: input.title ?? row.title,
        prompt: input.prompt ?? row.prompt,
        status: input.status ?? row.status,
        workspacePreset: Object.prototype.hasOwnProperty.call(input, 'workspacePreset') ? (input.workspacePreset ?? null) : row.workspacePreset,
        primaryTarget: input.primaryTarget ?? row.primaryTarget,
        taskId: Object.prototype.hasOwnProperty.call(input, 'taskId') ? (input.taskId ?? null) : row.taskId,
        missionId: Object.prototype.hasOwnProperty.call(input, 'missionId') ? (input.missionId ?? null) : row.missionId,
        assistantContextId: Object.prototype.hasOwnProperty.call(input, 'assistantContextId') ? (input.assistantContextId ?? null) : row.assistantContextId,
        councilRunId: Object.prototype.hasOwnProperty.call(input, 'councilRunId') ? (input.councilRunId ?? null) : row.councilRunId,
        executionRunId: Object.prototype.hasOwnProperty.call(input, 'executionRunId') ? (input.executionRunId ?? null) : row.executionRunId,
        briefingId: Object.prototype.hasOwnProperty.call(input, 'briefingId') ? (input.briefingId ?? null) : row.briefingId,
        dossierId: Object.prototype.hasOwnProperty.call(input, 'dossierId') ? (input.dossierId ?? null) : row.dossierId,
        updatedAt: nowIso()
      };
      state.jarvisSessions.set(input.sessionId, next);
      return toSession(next);
    },

    async appendJarvisSessionEvent(input) {
      const session = state.jarvisSessions.get(input.sessionId);
      if (!session || session.userId !== input.userId) return null;
      const now = nowIso();
      const row: JarvisSessionEventRecord = {
        id: randomUUID(),
        sessionId: input.sessionId,
        sequence: nextSequence(state),
        eventType: input.eventType,
        status: input.status ?? null,
        summary: input.summary ?? null,
        data: { ...(input.data ?? {}) },
        createdAt: now
      };
      const current = state.jarvisSessionEvents.get(input.sessionId) ?? [];
      state.jarvisSessionEvents.set(input.sessionId, [...current, row]);
      state.jarvisSessions.set(input.sessionId, {
        ...session,
        status: input.status ?? session.status,
        updatedAt: now,
        lastEventAt: now
      });
      return toEvent(row);
    },

    async listJarvisSessionEvents(input) {
      const session = state.jarvisSessions.get(input.sessionId);
      if (!session || session.userId !== input.userId) return [];
      const rows = (state.jarvisSessionEvents.get(input.sessionId) ?? [])
        .filter((row) => (typeof input.sinceSequence === 'number' ? row.sequence > input.sinceSequence : true))
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, normalizeLimit(input.limit));
      return rows.map(toEvent);
    },

    async upsertJarvisSessionStage(input) {
      const session = state.jarvisSessions.get(input.sessionId);
      if (!session || session.userId !== input.userId) return null;
      const existingRows = state.jarvisSessionStages.get(input.sessionId) ?? [];
      const existing = existingRows.find((row) => row.stageKey === input.stageKey) ?? null;
      const now = nowIso();
      const next: JarvisSessionStageRecord = {
        id: existing?.id ?? randomUUID(),
        sessionId: input.sessionId,
        stageKey: input.stageKey,
        capability: input.capability ?? existing?.capability ?? 'answer',
        title: input.title ?? existing?.title ?? input.stageKey,
        status: input.status ?? existing?.status ?? 'queued',
        orderIndex: typeof input.orderIndex === 'number' ? input.orderIndex : (existing?.orderIndex ?? existingRows.length),
        dependsOnJson: input.dependsOnJson ? [...input.dependsOnJson] : (existing?.dependsOnJson ? [...existing.dependsOnJson] : []),
        artifactRefsJson: input.artifactRefsJson ? { ...input.artifactRefsJson } : (existing?.artifactRefsJson ? { ...existing.artifactRefsJson } : {}),
        summary: Object.prototype.hasOwnProperty.call(input, 'summary') ? (input.summary ?? null) : (existing?.summary ?? null),
        errorCode: Object.prototype.hasOwnProperty.call(input, 'errorCode') ? (input.errorCode ?? null) : (existing?.errorCode ?? null),
        errorMessage: Object.prototype.hasOwnProperty.call(input, 'errorMessage') ? (input.errorMessage ?? null) : (existing?.errorMessage ?? null),
        startedAt: Object.prototype.hasOwnProperty.call(input, 'startedAt') ? (input.startedAt ?? null) : (existing?.startedAt ?? null),
        completedAt: Object.prototype.hasOwnProperty.call(input, 'completedAt') ? (input.completedAt ?? null) : (existing?.completedAt ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      const nextRows = existing
        ? existingRows.map((row) => (row.stageKey === input.stageKey ? next : row))
        : [...existingRows, next];
      state.jarvisSessionStages.set(
        input.sessionId,
        nextRows.sort((left, right) => (left.orderIndex === right.orderIndex ? left.createdAt.localeCompare(right.createdAt) : left.orderIndex - right.orderIndex))
      );
      return toStage(next);
    },

    async listJarvisSessionStages(input) {
      const session = state.jarvisSessions.get(input.sessionId);
      if (!session || session.userId !== input.userId) return [];
      const rows = (state.jarvisSessionStages.get(input.sessionId) ?? []).slice().sort((left, right) => {
        if (left.orderIndex === right.orderIndex) return left.createdAt.localeCompare(right.createdAt);
        return left.orderIndex - right.orderIndex;
      });
      return rows.map(toStage);
    },

    async createActionProposal(input) {
      const now = nowIso();
      const row: ActionProposalRecord = {
        id: randomUUID(),
        userId: input.userId,
        sessionId: input.sessionId,
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        status: 'pending',
        payload: { ...(input.payload ?? {}) },
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
        decidedBy: null
      };
      state.actionProposals.set(row.id, row);
      return toActionProposal(row);
    },

    async listActionProposals(input) {
      const rows = [...state.actionProposals.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.sessionId ? row.sessionId === input.sessionId : true))
        .filter((row) => (input.status ? row.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit));
      return rows.map(toActionProposal);
    },

    async decideActionProposal(input) {
      const row = state.actionProposals.get(input.proposalId);
      if (!row || row.userId !== input.userId) return null;
      const next: ActionProposalRecord = {
        ...row,
        status: input.decision,
        decidedAt: nowIso(),
        decidedBy: input.decidedBy,
        updatedAt: nowIso()
      };
      state.actionProposals.set(input.proposalId, next);
      return toActionProposal(next);
    },

    async createWatcher(input) {
      const now = nowIso();
      const row: WatcherRecord = {
        id: randomUUID(),
        userId: input.userId,
        kind: input.kind,
        status: input.status ?? 'active',
        title: input.title,
        query: input.query,
        configJson: { ...(input.configJson ?? {}) },
        lastRunAt: null,
        lastHitAt: null,
        createdAt: now,
        updatedAt: now
      };
      state.watchers.set(row.id, row);
      return toWatcher(row);
    },

    async listWatchers(input) {
      const rows = [...state.watchers.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.status ? row.status === input.status : true))
        .filter((row) => (input.kind ? row.kind === input.kind : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit));
      return rows.map(toWatcher);
    },

    async listActiveWatchers(input) {
      const rows = [...state.watchers.values()]
        .filter((row) => row.status === 'active')
        .sort((left, right) => {
          const leftAt = left.lastRunAt ?? left.updatedAt;
          const rightAt = right.lastRunAt ?? right.updatedAt;
          return leftAt.localeCompare(rightAt);
        })
        .slice(0, normalizeLimit(input.limit));
      return rows.map(toWatcher);
    },

    async getWatcherById(input) {
      const row = state.watchers.get(input.watcherId);
      if (!row || row.userId !== input.userId) return null;
      return toWatcher(row);
    },

    async updateWatcher(input) {
      const row = state.watchers.get(input.watcherId);
      if (!row || row.userId !== input.userId) return null;
      const next: WatcherRecord = {
        ...row,
        kind: input.kind ?? row.kind,
        status: input.status ?? row.status,
        title: input.title ?? row.title,
        query: input.query ?? row.query,
        configJson: typeof input.configJson === 'object' && input.configJson !== null ? { ...input.configJson } : row.configJson,
        lastRunAt: Object.prototype.hasOwnProperty.call(input, 'lastRunAt') ? (input.lastRunAt ?? null) : row.lastRunAt,
        lastHitAt: Object.prototype.hasOwnProperty.call(input, 'lastHitAt') ? (input.lastHitAt ?? null) : row.lastHitAt,
        updatedAt: nowIso()
      };
      state.watchers.set(input.watcherId, next);
      return toWatcher(next);
    },

    async deleteWatcher(input) {
      return state.watchers.delete(input.watcherId);
    },

    async createWatcherRun(input) {
      const now = nowIso();
      const row: WatcherRunRecord = {
        id: randomUUID(),
        watcherId: input.watcherId,
        userId: input.userId,
        status: input.status ?? 'running',
        summary: input.summary ?? '',
        briefingId: input.briefingId ?? null,
        dossierId: input.dossierId ?? null,
        error: input.error ?? null,
        createdAt: now,
        updatedAt: now
      };
      state.watcherRuns.set(row.id, row);
      return toWatcherRun(row);
    },

    async listWatcherRuns(input) {
      const rows = [...state.watcherRuns.values()]
        .filter((row) => row.userId === input.userId && row.watcherId === input.watcherId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit));
      return rows.map(toWatcherRun);
    },

    async updateWatcherRun(input) {
      const row = state.watcherRuns.get(input.runId);
      if (!row || row.userId !== input.userId) return null;
      const next: WatcherRunRecord = {
        ...row,
        status: input.status ?? row.status,
        summary: input.summary ?? row.summary,
        briefingId: Object.prototype.hasOwnProperty.call(input, 'briefingId') ? (input.briefingId ?? null) : row.briefingId,
        dossierId: Object.prototype.hasOwnProperty.call(input, 'dossierId') ? (input.dossierId ?? null) : row.dossierId,
        error: Object.prototype.hasOwnProperty.call(input, 'error') ? (input.error ?? null) : row.error,
        updatedAt: nowIso()
      };
      state.watcherRuns.set(input.runId, next);
      return toWatcherRun(next);
    },

    async createBriefing(input) {
      const now = nowIso();
      const row: BriefingRecord = {
        id: randomUUID(),
        userId: input.userId,
        watcherId: input.watcherId ?? null,
        sessionId: input.sessionId ?? null,
        type: input.type,
        status: input.status ?? 'completed',
        title: input.title,
        query: input.query,
        summary: input.summary,
        answerMarkdown: input.answerMarkdown,
        sourceCount: input.sourceCount ?? 0,
        qualityJson: { ...(input.qualityJson ?? {}) },
        createdAt: now,
        updatedAt: now
      };
      state.briefings.set(row.id, row);
      return toBriefing(row);
    },

    async listBriefings(input) {
      const rows = [...state.briefings.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.type ? row.type === input.type : true))
        .filter((row) => (input.status ? row.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit));
      return rows.map(toBriefing);
    },

    async getBriefingById(input) {
      const row = state.briefings.get(input.briefingId);
      if (!row || row.userId !== input.userId) return null;
      return toBriefing(row);
    },

    async createDossier(input) {
      const now = nowIso();
      const row: DossierRecord = {
        id: randomUUID(),
        userId: input.userId,
        sessionId: input.sessionId ?? null,
        briefingId: input.briefingId ?? null,
        title: input.title,
        query: input.query,
        status: input.status ?? 'draft',
        summary: input.summary ?? '',
        answerMarkdown: input.answerMarkdown ?? '',
        qualityJson: { ...(input.qualityJson ?? {}) },
        conflictsJson: { ...(input.conflictsJson ?? {}) },
        createdAt: now,
        updatedAt: now
      };
      state.dossiers.set(row.id, row);
      return toDossier(row);
    },

    async listDossiers(input) {
      const rows = [...state.dossiers.values()]
        .filter((row) => row.userId === input.userId)
        .filter((row) => (input.status ? row.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, normalizeLimit(input.limit));
      return rows.map(toDossier);
    },

    async getDossierById(input) {
      const row = state.dossiers.get(input.dossierId);
      if (!row || row.userId !== input.userId) return null;
      return toDossier(row);
    },

    async updateDossier(input) {
      const row = state.dossiers.get(input.dossierId);
      if (!row || row.userId !== input.userId) return null;
      const next: DossierRecord = {
        ...row,
        title: input.title ?? row.title,
        query: input.query ?? row.query,
        status: input.status ?? row.status,
        summary: input.summary ?? row.summary,
        answerMarkdown: input.answerMarkdown ?? row.answerMarkdown,
        qualityJson: typeof input.qualityJson === 'object' && input.qualityJson !== null ? { ...input.qualityJson } : row.qualityJson,
        conflictsJson: typeof input.conflictsJson === 'object' && input.conflictsJson !== null ? { ...input.conflictsJson } : row.conflictsJson,
        updatedAt: nowIso()
      };
      state.dossiers.set(input.dossierId, next);
      return toDossier(next);
    },

    async replaceDossierSources(input) {
      const dossier = state.dossiers.get(input.dossierId);
      if (!dossier || dossier.userId !== input.userId) return [];
      const now = nowIso();
      const rows: DossierSourceRecord[] = input.sources.map((source, index) => ({
        id: randomUUID(),
        dossierId: input.dossierId,
        url: source.url,
        title: source.title,
        domain: source.domain,
        snippet: source.snippet ?? '',
        publishedAt: source.publishedAt ?? null,
        sourceOrder: index + 1,
        createdAt: now
      }));
      state.dossierSources.set(input.dossierId, rows);
      return rows.map(toDossierSource);
    },

    async listDossierSources(input) {
      const dossier = state.dossiers.get(input.dossierId);
      if (!dossier || dossier.userId !== input.userId) return [];
      return (state.dossierSources.get(input.dossierId) ?? []).slice(0, normalizeLimit(input.limit)).map(toDossierSource);
    },

    async replaceDossierClaims(input) {
      const dossier = state.dossiers.get(input.dossierId);
      if (!dossier || dossier.userId !== input.userId) return [];
      const now = nowIso();
      const rows: DossierClaimRecord[] = input.claims.map((claim, index) => ({
        id: randomUUID(),
        dossierId: input.dossierId,
        claimText: claim.claimText,
        claimOrder: index + 1,
        sourceUrls: [...claim.sourceUrls],
        createdAt: now
      }));
      state.dossierClaims.set(input.dossierId, rows);
      return rows.map(toDossierClaim);
    },

    async listDossierClaims(input) {
      const dossier = state.dossiers.get(input.dossierId);
      if (!dossier || dossier.userId !== input.userId) return [];
      return (state.dossierClaims.get(input.dossierId) ?? []).slice(0, normalizeLimit(input.limit)).map(toDossierClaim);
    }
  };
}
