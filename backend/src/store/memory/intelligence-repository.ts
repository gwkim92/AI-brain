import { randomUUID } from 'node:crypto';

import type { IntelligenceRepositoryContract } from '../repository-contracts';
import type {
  AliasRolloutRecord,
  CapabilityAliasBindingRecord,
  ClaimLinkRecord,
  ConnectorCapabilityRecord,
  EventMembershipRecord,
  ExecutionAuditRecord,
  IntelligenceFetchFailureRecord,
  IntelligenceBridgeDispatchRecord,
  IntelligenceCrawlPolicy,
  IntelligenceExpectedSignalEntryRecord,
  IntelligenceEventClusterRecord,
  IntelligenceInvalidationEntryRecord,
  IntelligenceNarrativeClusterLedgerEntryRecord,
  IntelligenceNarrativeClusterMembershipRecord,
  IntelligenceNarrativeClusterRecord,
  IntelligenceNarrativeClusterTimelineRecord,
  IntelligenceOutcomeEntryRecord,
  IntelligenceTemporalNarrativeLedgerEntryRecord,
  IntelligenceSourceHealth,
  HypothesisEvidenceLink,
  HypothesisLedgerEntry,
  LinkedClaimRecord,
  LinkedClaimEdgeRecord,
  OperatorNoteRecord,
  IntelligenceScanRunRecord,
  IntelligenceSourceCursorRecord,
  IntelligenceSourceRecord,
  IntelligenceWorkspaceMemberRecord,
  IntelligenceWorkspaceRecord,
  ModelRegistryEntryRecord,
  ProviderHealthRecord,
  RawDocumentRecord,
  SignalEnvelopeRecord,
} from '../types';
import type { MemoryStoreState } from './state';

type MemoryIntelligenceRepositoryDeps = {
  state: MemoryStoreState;
  nowIso: () => string;
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'workspace';
}

function membershipKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`;
}

function registryKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

function aliasMatch(row: CapabilityAliasBindingRecord, workspaceId: string | null | undefined, alias?: string): boolean {
  if ((workspaceId ?? null) !== row.workspaceId) return false;
  if (alias && row.alias !== alias) return false;
  return true;
}

function defaultCrawlPolicy(partial?: Partial<IntelligenceCrawlPolicy>): IntelligenceCrawlPolicy {
  return {
    allowDomains: [...(partial?.allowDomains ?? [])],
    denyDomains: [...(partial?.denyDomains ?? [])],
    respectRobots: partial?.respectRobots ?? true,
    maxDepth: partial?.maxDepth ?? 1,
    maxPagesPerRun: partial?.maxPagesPerRun ?? 3,
    revisitCooldownMinutes: partial?.revisitCooldownMinutes ?? 30,
    perDomainRateLimitPerMinute: partial?.perDomainRateLimitPerMinute ?? 12,
  };
}

function defaultSourceHealth(partial?: Partial<IntelligenceSourceHealth>): IntelligenceSourceHealth {
  return {
    lastStatus: partial?.lastStatus ?? 'idle',
    lastSuccessAt: partial?.lastSuccessAt ?? null,
    lastFailureAt: partial?.lastFailureAt ?? null,
    consecutiveFailures: partial?.consecutiveFailures ?? 0,
    recentLatencyMs: partial?.recentLatencyMs ?? null,
    status403Count: partial?.status403Count ?? 0,
    status429Count: partial?.status429Count ?? 0,
    robotsBlocked: partial?.robotsBlocked ?? false,
    lastFailureReason: partial?.lastFailureReason ?? null,
    updatedAt: partial?.updatedAt ?? null,
  };
}

function normalizeConnectorCapability(value?: ConnectorCapabilityRecord | null): ConnectorCapabilityRecord | null {
  if (!value) return null;
  return {
    connectorId: value.connectorId,
    writeAllowed: value.writeAllowed,
    destructive: value.destructive,
    requiresHuman: value.requiresHuman,
    schemaId: value.schemaId ?? null,
    allowedActions: [...value.allowedActions],
  };
}

export function createMemoryIntelligenceRepository({
  state,
  nowIso,
}: MemoryIntelligenceRepositoryDeps): IntelligenceRepositoryContract {
  const sortByUpdated = <T extends { updatedAt?: string; createdAt?: string }>(rows: T[]): T[] =>
    rows.sort((left, right) => (right.updatedAt ?? right.createdAt ?? '').localeCompare(left.updatedAt ?? left.createdAt ?? ''));

  return {
    async getOrCreateIntelligenceWorkspace(input) {
      const existingMembership = [...state.intelligenceWorkspaceMembers.values()].find(
        (member) => member.userId === input.userId && (member.role === 'owner' || member.role === 'admin')
      );
      if (existingMembership) {
        return state.intelligenceWorkspaces.get(existingMembership.workspaceId)!;
      }
      const now = nowIso();
      const name = input.name?.trim() || 'My Intelligence';
      const workspace: IntelligenceWorkspaceRecord = {
        id: randomUUID(),
        ownerUserId: input.userId,
        name,
        slug: slugify(name || `workspace-${input.userId.slice(0, 8)}`),
        createdAt: now,
        updatedAt: now,
      };
      const membership: IntelligenceWorkspaceMemberRecord = {
        workspaceId: workspace.id,
        userId: input.userId,
        role: 'owner',
        createdAt: now,
        updatedAt: now,
      };
      state.intelligenceWorkspaces.set(workspace.id, workspace);
      state.intelligenceWorkspaceMembers.set(membershipKey(workspace.id, input.userId), membership);
      return workspace;
    },

    async createIntelligenceWorkspace(input) {
      const now = nowIso();
      const workspace: IntelligenceWorkspaceRecord = {
        id: randomUUID(),
        ownerUserId: input.userId,
        name: input.name.trim(),
        slug: slugify(input.name.trim() || `workspace-${input.userId.slice(0, 8)}`),
        createdAt: now,
        updatedAt: now,
      };
      const membership: IntelligenceWorkspaceMemberRecord = {
        workspaceId: workspace.id,
        userId: input.userId,
        role: 'owner',
        createdAt: now,
        updatedAt: now,
      };
      state.intelligenceWorkspaces.set(workspace.id, workspace);
      state.intelligenceWorkspaceMembers.set(membershipKey(workspace.id, input.userId), membership);
      return workspace;
    },

    async listIntelligenceWorkspaces(input) {
      const workspaceIds = [...state.intelligenceWorkspaceMembers.values()]
        .filter((member) => member.userId === input.userId)
        .map((member) => member.workspaceId);
      return sortByUpdated(
        workspaceIds
          .map((workspaceId) => state.intelligenceWorkspaces.get(workspaceId))
          .filter((row): row is IntelligenceWorkspaceRecord => Boolean(row))
      );
    },

    async getIntelligenceWorkspaceMembership(input) {
      return state.intelligenceWorkspaceMembers.get(membershipKey(input.workspaceId, input.userId)) ?? null;
    },

    async createIntelligenceSource(input) {
      const now = nowIso();
      const row: IntelligenceSourceRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        kind: input.kind,
        url: input.url,
        sourceType: input.sourceType,
        sourceTier: input.sourceTier,
        pollMinutes: input.pollMinutes ?? 5,
        enabled: input.enabled ?? true,
        parserConfigJson: { ...(input.parserConfigJson ?? {}) },
        crawlConfigJson: { ...(input.crawlConfigJson ?? {}) },
        crawlPolicy: defaultCrawlPolicy(input.crawlPolicy),
        health: defaultSourceHealth(),
        connectorCapability: normalizeConnectorCapability(input.connectorCapability),
        entityHints: [...(input.entityHints ?? [])],
        metricHints: [...(input.metricHints ?? [])],
        lastFetchedAt: null,
        lastSuccessAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      state.intelligenceSources.set(row.id, row);
      return row;
    },

    async updateIntelligenceSource(input) {
      const current = state.intelligenceSources.get(input.sourceId);
      if (!current || current.workspaceId !== input.workspaceId) return null;
      const next: IntelligenceSourceRecord = {
        ...current,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
        pollMinutes: input.pollMinutes ?? current.pollMinutes,
        parserConfigJson: input.parserConfigJson ? { ...input.parserConfigJson } : current.parserConfigJson,
        crawlConfigJson: input.crawlConfigJson ? { ...input.crawlConfigJson } : current.crawlConfigJson,
        crawlPolicy: input.crawlPolicy ? defaultCrawlPolicy({ ...current.crawlPolicy, ...input.crawlPolicy }) : current.crawlPolicy,
        health: input.health ? defaultSourceHealth({ ...current.health, ...input.health }) : current.health,
        connectorCapability:
          typeof input.connectorCapability === 'undefined'
            ? current.connectorCapability
            : normalizeConnectorCapability(input.connectorCapability),
        lastFetchedAt: typeof input.lastFetchedAt === 'undefined' ? current.lastFetchedAt : input.lastFetchedAt,
        lastSuccessAt: typeof input.lastSuccessAt === 'undefined' ? current.lastSuccessAt : input.lastSuccessAt,
        lastError: typeof input.lastError === 'undefined' ? current.lastError : input.lastError,
        updatedAt: nowIso(),
      };
      state.intelligenceSources.set(next.id, next);
      return next;
    },

    async listAllIntelligenceSources(input) {
      return sortByUpdated(
        [...state.intelligenceSources.values()]
          .filter((row) => (typeof input.enabled === 'boolean' ? row.enabled === input.enabled : true))
          .slice(0, input.limit)
      );
    },

    async listIntelligenceSources(input) {
      return sortByUpdated(
        [...state.intelligenceSources.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (typeof input.enabled === 'boolean' ? row.enabled === input.enabled : true))
          .slice(0, input.limit)
      );
    },

    async toggleIntelligenceSource(input) {
      const current = state.intelligenceSources.get(input.sourceId);
      if (!current || current.workspaceId !== input.workspaceId) return null;
      const next: IntelligenceSourceRecord = { ...current, enabled: input.enabled, updatedAt: nowIso() };
      state.intelligenceSources.set(next.id, next);
      return next;
    },

    async listIntelligenceSourceCursors(input) {
      return sortByUpdated(
        [...state.intelligenceSourceCursors.values()].filter((row) => {
          if (row.workspaceId !== input.workspaceId) return false;
          if (input.sourceId && row.sourceId !== input.sourceId) return false;
          return true;
        })
      );
    },

    async upsertIntelligenceSourceCursor(input) {
      const now = nowIso();
      const key = membershipKey(input.workspaceId, input.sourceId);
      const current = state.intelligenceSourceCursors.get(key);
      const next: IntelligenceSourceCursorRecord = {
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
        cursor: input.cursor ?? current?.cursor ?? null,
        etag: input.etag ?? current?.etag ?? null,
        lastModified: input.lastModified ?? current?.lastModified ?? null,
        lastSeenPublishedAt: input.lastSeenPublishedAt ?? current?.lastSeenPublishedAt ?? null,
        lastFetchedAt: input.lastFetchedAt ?? current?.lastFetchedAt ?? now,
        updatedAt: now,
      };
      state.intelligenceSourceCursors.set(key, next);
      return next;
    },

    async createIntelligenceScanRun(input) {
      const now = nowIso();
      const row: IntelligenceScanRunRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        sourceId: input.sourceId ?? null,
        status: input.status ?? 'running',
        fetchedCount: input.fetchedCount ?? 0,
        storedDocumentCount: input.storedDocumentCount ?? 0,
        signalCount: input.signalCount ?? 0,
        clusteredEventCount: input.clusteredEventCount ?? 0,
        executionCount: input.executionCount ?? 0,
        failedCount: input.failedCount ?? 0,
        error: input.error ?? null,
        detailJson: { ...(input.detailJson ?? {}) },
        startedAt: input.startedAt ?? now,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      state.intelligenceScanRuns.set(row.id, row);
      return row;
    },

    async completeIntelligenceScanRun(input) {
      const current = state.intelligenceScanRuns.get(input.runId);
      if (!current || current.workspaceId !== input.workspaceId) return null;
      const next: IntelligenceScanRunRecord = {
        ...current,
        status: input.status,
        fetchedCount: input.fetchedCount ?? current.fetchedCount,
        storedDocumentCount: input.storedDocumentCount ?? current.storedDocumentCount,
        signalCount: input.signalCount ?? current.signalCount,
        clusteredEventCount: input.clusteredEventCount ?? current.clusteredEventCount,
        executionCount: input.executionCount ?? current.executionCount,
        failedCount: input.failedCount ?? current.failedCount,
        error: input.error ?? current.error,
        detailJson: { ...current.detailJson, ...(input.detailJson ?? {}) },
        finishedAt: input.finishedAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      state.intelligenceScanRuns.set(next.id, next);
      return next;
    },

    async listIntelligenceScanRuns(input) {
      return sortByUpdated(
        [...state.intelligenceScanRuns.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (input.sourceId ? row.sourceId === input.sourceId : true))
          .slice(0, input.limit)
      );
    },

    async createIntelligenceFetchFailure(input) {
      const row: IntelligenceFetchFailureRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        sourceId: input.sourceId ?? null,
        url: input.url,
        reason: input.reason,
        statusCode: input.statusCode ?? null,
        retryable: input.retryable ?? false,
        blockedByRobots: input.blockedByRobots ?? false,
        createdAt: nowIso(),
      };
      state.intelligenceFetchFailures.set(row.id, row);
      return row;
    },

    async listIntelligenceFetchFailures(input) {
      return sortByUpdated(
        [...state.intelligenceFetchFailures.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (input.sourceId ? row.sourceId === input.sourceId : true))
          .slice(0, input.limit)
      );
    },

    async findIntelligenceRawDocumentByFingerprint(input) {
      return (
        [...state.intelligenceRawDocuments.values()].find(
          (row) => row.workspaceId === input.workspaceId && row.documentFingerprint === input.documentFingerprint
        ) ?? null
      );
    },

    async createIntelligenceRawDocument(input) {
      const row: RawDocumentRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        sourceId: input.sourceId ?? null,
        sourceUrl: input.sourceUrl,
        canonicalUrl: input.canonicalUrl,
        title: input.title,
        summary: input.summary ?? '',
        rawText: input.rawText,
        rawHtml: input.rawHtml ?? null,
        publishedAt: input.publishedAt ?? null,
        observedAt: input.observedAt ?? null,
        language: input.language ?? null,
        sourceType: input.sourceType,
        sourceTier: input.sourceTier,
        documentFingerprint: input.documentFingerprint,
        metadataJson: { ...(input.metadataJson ?? {}) },
        createdAt: nowIso(),
      };
      state.intelligenceRawDocuments.set(row.id, row);
      return row;
    },

    async listIntelligenceRawDocuments(input) {
      return sortByUpdated(
        [...state.intelligenceRawDocuments.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .slice(0, input.limit)
      );
    },

    async listIntelligenceRawDocumentsByIds(input) {
      const idSet = new Set(input.documentIds);
      return sortByUpdated(
        [...state.intelligenceRawDocuments.values()].filter(
          (row) => row.workspaceId === input.workspaceId && idSet.has(row.id)
        )
      );
    },

    async createIntelligenceSignal(input) {
      const row: SignalEnvelopeRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        sourceId: input.sourceId ?? null,
        documentId: input.documentId,
        sourceType: input.sourceType,
        sourceTier: input.sourceTier,
        url: input.url,
        publishedAt: input.publishedAt ?? null,
        observedAt: input.observedAt ?? null,
        language: input.language ?? null,
        rawText: input.rawText,
        rawMetrics: { ...(input.rawMetrics ?? {}) },
        entityHints: [...(input.entityHints ?? [])],
        trustHint: input.trustHint ?? null,
        processingStatus: input.processingStatus ?? 'pending',
        linkedEventId: input.linkedEventId ?? null,
        processingError: input.processingError ?? null,
        processedAt: input.processedAt ?? null,
        createdAt: nowIso(),
      };
      state.intelligenceSignals.set(row.id, row);
      return row;
    },

    async listIntelligenceSignals(input) {
      return sortByUpdated(
        [...state.intelligenceSignals.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (input.sourceId ? row.sourceId === input.sourceId : true))
          .filter((row) => (input.processingStatus ? row.processingStatus === input.processingStatus : true))
          .slice(0, input.limit)
      );
    },

    async listIntelligenceSignalsByIds(
      input: Parameters<IntelligenceRepositoryContract['listIntelligenceSignalsByIds']>[0],
    ) {
      const signalIdSet = new Set(input.signalIds);
      return sortByUpdated(
        [...state.intelligenceSignals.values()].filter(
          (row) => row.workspaceId === input.workspaceId && signalIdSet.has(row.id),
        ),
      );
    },

    async updateIntelligenceSignalProcessing(input) {
      const current = state.intelligenceSignals.get(input.signalId);
      if (!current || current.workspaceId !== input.workspaceId) return null;
      const next: SignalEnvelopeRecord = {
        ...current,
        processingStatus: input.processingStatus,
        linkedEventId: typeof input.linkedEventId === 'undefined' ? current.linkedEventId : input.linkedEventId,
        processingError: typeof input.processingError === 'undefined' ? current.processingError : input.processingError,
        processedAt: typeof input.processedAt === 'undefined' ? current.processedAt : input.processedAt,
      };
      state.intelligenceSignals.set(next.id, next);
      return next;
    },

    async createIntelligenceLinkedClaim(input) {
      const now = nowIso();
      const existing = [...state.intelligenceLinkedClaims.values()].find(
        (row) => row.workspaceId === input.workspaceId && row.claimFingerprint === input.claimFingerprint,
      );
      const row: LinkedClaimRecord = {
        id: existing?.id ?? input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        claimFingerprint: input.claimFingerprint,
        canonicalSubject: input.canonicalSubject,
        canonicalPredicate: input.canonicalPredicate,
        canonicalObject: input.canonicalObject,
        predicateFamily: input.predicateFamily,
        timeScope: input.timeScope ?? null,
        timeBucketStart: input.timeBucketStart ?? null,
        timeBucketEnd: input.timeBucketEnd ?? null,
        stanceDistribution: { ...input.stanceDistribution },
        sourceCount: input.sourceCount,
        contradictionCount: input.contradictionCount,
        nonSocialSourceCount: input.nonSocialSourceCount,
        supportingSignalIds: [...input.supportingSignalIds],
        lastSupportedAt: input.lastSupportedAt ?? null,
        lastContradictedAt: input.lastContradictedAt ?? null,
        reviewState: input.reviewState ?? existing?.reviewState ?? 'watch',
        reviewReason: input.reviewReason ?? existing?.reviewReason ?? null,
        reviewOwner: input.reviewOwner ?? existing?.reviewOwner ?? null,
        reviewUpdatedAt: input.reviewUpdatedAt ?? existing?.reviewUpdatedAt ?? null,
        reviewUpdatedBy: input.reviewUpdatedBy ?? existing?.reviewUpdatedBy ?? null,
        reviewResolvedAt: input.reviewResolvedAt ?? existing?.reviewResolvedAt ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      state.intelligenceLinkedClaims.set(row.id, row);
      return row;
    },

    async listIntelligenceLinkedClaims(input) {
      const claimIds = input.eventId
        ? new Set(
            [...state.intelligenceEventMemberships.values()]
              .filter((row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId)
              .map((row) => row.linkedClaimId),
          )
        : null;
      return sortByUpdated(
        [...state.intelligenceLinkedClaims.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (claimIds ? claimIds.has(row.id) : true))
          .slice(0, input.limit),
      );
    },

    async updateIntelligenceLinkedClaimReviewState(input) {
      const current = state.intelligenceLinkedClaims.get(input.linkedClaimId);
      if (!current || current.workspaceId !== input.workspaceId) return null;
      const next: LinkedClaimRecord = {
        ...current,
        reviewState: input.reviewState,
        reviewReason: input.reviewReason ?? current.reviewReason ?? null,
        reviewOwner: input.reviewOwner ?? current.reviewOwner ?? null,
        reviewUpdatedAt: nowIso(),
        reviewUpdatedBy: input.updatedBy,
        reviewResolvedAt: input.reviewResolvedAt ?? (input.reviewState === 'ignore' ? nowIso() : null),
        updatedAt: nowIso(),
      };
      state.intelligenceLinkedClaims.set(next.id, next);
      return next;
    },

    async createIntelligenceClaimLink(input) {
      const row: ClaimLinkRecord = {
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        eventId: input.eventId,
        linkedClaimId: input.linkedClaimId,
        signalId: input.signalId,
        semanticClaimId: input.semanticClaimId,
        relation: input.relation,
        confidence: input.confidence,
        linkStrength: input.linkStrength,
        createdAt: nowIso(),
      };
      state.intelligenceClaimLinks.set(row.id, row);
      return row;
    },

    async listIntelligenceClaimLinks(input) {
      return sortByUpdated(
        [...state.intelligenceClaimLinks.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (input.eventId ? row.eventId === input.eventId : true))
          .filter((row) => (input.linkedClaimId ? row.linkedClaimId === input.linkedClaimId : true))
          .slice(0, input.limit),
      );
    },

    async createIntelligenceLinkedClaimEdge(input) {
      const now = nowIso();
      const [leftLinkedClaimId, rightLinkedClaimId] =
        input.leftLinkedClaimId.localeCompare(input.rightLinkedClaimId) <= 0
          ? [input.leftLinkedClaimId, input.rightLinkedClaimId]
          : [input.rightLinkedClaimId, input.leftLinkedClaimId];
      const existing = [...state.intelligenceLinkedClaimEdges.values()].find(
        (row) =>
          row.workspaceId === input.workspaceId &&
          row.leftLinkedClaimId === leftLinkedClaimId &&
          row.rightLinkedClaimId === rightLinkedClaimId,
      );
      const row: LinkedClaimEdgeRecord = {
        id: existing?.id ?? input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        leftLinkedClaimId,
        rightLinkedClaimId,
        relation: input.relation,
        edgeStrength: input.edgeStrength,
        evidenceSignalIds: [...input.evidenceSignalIds],
        lastObservedAt: input.lastObservedAt ?? existing?.lastObservedAt ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      state.intelligenceLinkedClaimEdges.set(row.id, row);
      return row;
    },

    async listIntelligenceLinkedClaimEdges(input) {
      let allowedClaimIds: Set<string> | null = null;
      if (input.eventId) {
        allowedClaimIds = new Set(
          [...state.intelligenceEventMemberships.values()]
            .filter((row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId)
            .map((row) => row.linkedClaimId),
        );
      }
      return sortByUpdated(
        [...state.intelligenceLinkedClaimEdges.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) =>
            input.linkedClaimId
              ? row.leftLinkedClaimId === input.linkedClaimId || row.rightLinkedClaimId === input.linkedClaimId
              : true,
          )
          .filter((row) =>
            allowedClaimIds
              ? allowedClaimIds.has(row.leftLinkedClaimId) && allowedClaimIds.has(row.rightLinkedClaimId)
              : true,
          )
          .slice(0, input.limit),
      );
    },

    async replaceIntelligenceEventMemberships(input) {
      for (const row of [...state.intelligenceEventMemberships.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceEventMemberships.delete(row.id);
        }
      }
      const rows = input.memberships.map((membership) => {
        const row: EventMembershipRecord = {
          id: membership.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          eventId: input.eventId,
          linkedClaimId: membership.linkedClaimId,
          role: membership.role,
          createdAt: nowIso(),
        };
        state.intelligenceEventMemberships.set(row.id, row);
        return row;
      });
      return rows;
    },

    async listIntelligenceEventMemberships(input) {
      return sortByUpdated(
        [...state.intelligenceEventMemberships.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId,
        ),
      );
    },

    async deleteIntelligenceLinkedClaimsByIds(
      input: Parameters<IntelligenceRepositoryContract['deleteIntelligenceLinkedClaimsByIds']>[0],
    ) {
      const linkedClaimIdSet = new Set(input.linkedClaimIds);
      let deleted = 0;
      for (const row of [...state.intelligenceLinkedClaims.values()]) {
        if (row.workspaceId === input.workspaceId && linkedClaimIdSet.has(row.id)) {
          state.intelligenceLinkedClaims.delete(row.id);
          deleted += 1;
        }
      }
      for (const row of [...state.intelligenceClaimLinks.values()]) {
        if (row.workspaceId === input.workspaceId && linkedClaimIdSet.has(row.linkedClaimId)) {
          state.intelligenceClaimLinks.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceLinkedClaimEdges.values()]) {
        if (
          row.workspaceId === input.workspaceId &&
          (linkedClaimIdSet.has(row.leftLinkedClaimId) || linkedClaimIdSet.has(row.rightLinkedClaimId))
        ) {
          state.intelligenceLinkedClaimEdges.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceEventMemberships.values()]) {
        if (row.workspaceId === input.workspaceId && linkedClaimIdSet.has(row.linkedClaimId)) {
          state.intelligenceEventMemberships.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceHypothesisEvidenceLinks.values()]) {
        if (row.workspaceId === input.workspaceId && row.linkedClaimId && linkedClaimIdSet.has(row.linkedClaimId)) {
          state.intelligenceHypothesisEvidenceLinks.delete(row.id);
        }
      }
      return deleted;
    },

    async upsertIntelligenceEvent(input) {
      const current = state.intelligenceEvents.get(input.id);
      const now = nowIso();
      const row: IntelligenceEventClusterRecord = {
        ...input,
        sourceMix: { ...(input.sourceMix ?? {}) },
        semanticClaims: [...input.semanticClaims],
        metricShocks: [...input.metricShocks],
        domainPosteriors: [...input.domainPosteriors],
        worldStates: [...input.worldStates],
        primaryHypotheses: [...input.primaryHypotheses],
        counterHypotheses: [...input.counterHypotheses],
        invalidationConditions: [...input.invalidationConditions],
        expectedSignals: [...input.expectedSignals],
        deliberations: [...input.deliberations],
        executionCandidates: [...input.executionCandidates],
        outcomes: [...input.outcomes],
        linkedClaimCount: input.linkedClaimCount,
        contradictionCount: input.contradictionCount,
        nonSocialCorroborationCount: input.nonSocialCorroborationCount,
        linkedClaimHealthScore: input.linkedClaimHealthScore,
        timeCoherenceScore: input.timeCoherenceScore,
        graphSupportScore: input.graphSupportScore,
        graphContradictionScore: input.graphContradictionScore,
        graphHotspotCount: input.graphHotspotCount,
        deliberationStatus: input.deliberationStatus,
        reviewState: input.reviewState,
        reviewReason: input.reviewReason ?? null,
        reviewOwner: input.reviewOwner ?? null,
        reviewUpdatedAt: input.reviewUpdatedAt ?? null,
        reviewUpdatedBy: input.reviewUpdatedBy ?? null,
        reviewResolvedAt: input.reviewResolvedAt ?? null,
        operatorNoteCount: input.operatorNoteCount,
        createdAt: current?.createdAt ?? input.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
      };
      state.intelligenceEvents.set(row.id, row);
      return row;
    },

    async listIntelligenceEvents(input) {
      return sortByUpdated(
        [...state.intelligenceEvents.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (input.domainId ? row.topDomainId === input.domainId : true))
          .slice(0, input.limit)
      );
    },

    async getIntelligenceEventById(input) {
      const row = state.intelligenceEvents.get(input.eventId);
      if (!row || row.workspaceId !== input.workspaceId) return null;
      return row;
    },

    async deleteIntelligenceEventById(
      input: Parameters<IntelligenceRepositoryContract['deleteIntelligenceEventById']>[0],
    ) {
      const current = state.intelligenceEvents.get(input.eventId);
      if (!current || current.workspaceId !== input.workspaceId) return false;
      state.intelligenceEvents.delete(input.eventId);
      for (const row of [...state.intelligenceClaimLinks.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceClaimLinks.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceEventMemberships.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceEventMemberships.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceHypothesisLedger.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceHypothesisLedger.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceHypothesisEvidenceLinks.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceHypothesisEvidenceLinks.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceInvalidationEntries.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceInvalidationEntries.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceExpectedSignalEntries.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceExpectedSignalEntries.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceOutcomeEntries.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceOutcomeEntries.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceNarrativeClusterMemberships.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceNarrativeClusterMemberships.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceTemporalNarrativeLedger.values()]) {
        if (
          row.workspaceId === input.workspaceId &&
          (row.eventId === input.eventId || row.relatedEventId === input.eventId)
        ) {
          state.intelligenceTemporalNarrativeLedger.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceExecutionAudits.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceExecutionAudits.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceBridgeDispatches.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceBridgeDispatches.delete(row.id);
        }
      }
      for (const row of [...state.intelligenceOperatorNotes.values()]) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceOperatorNotes.delete(row.id);
        }
      }
      return true;
    },

    async updateIntelligenceEventReviewState(input) {
      const current = state.intelligenceEvents.get(input.eventId);
      if (!current || current.workspaceId !== input.workspaceId) return null;
      const next: IntelligenceEventClusterRecord = {
        ...current,
        reviewState: input.reviewState,
        reviewReason: input.reviewReason ?? current.reviewReason ?? null,
        reviewOwner: input.reviewOwner ?? current.reviewOwner ?? null,
        reviewUpdatedAt: nowIso(),
        reviewUpdatedBy: input.updatedBy,
        reviewResolvedAt: input.reviewResolvedAt ?? (input.reviewState === 'ignore' ? nowIso() : null),
        updatedAt: nowIso(),
      };
      state.intelligenceEvents.set(next.id, next);
      return next;
    },

    async createIntelligenceOperatorNote(input) {
      const row: OperatorNoteRecord = {
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        eventId: input.eventId,
        userId: input.userId,
        scope: input.scope,
        scopeId: input.scopeId ?? null,
        note: input.note,
        createdAt: nowIso(),
      };
      state.intelligenceOperatorNotes.set(row.id, row);
      const event = state.intelligenceEvents.get(input.eventId);
      if (event && event.workspaceId === input.workspaceId) {
        state.intelligenceEvents.set(event.id, {
          ...event,
          operatorNoteCount: event.operatorNoteCount + 1,
          updatedAt: nowIso(),
        });
      }
      return row;
    },

    async listIntelligenceOperatorNotes(input) {
      return sortByUpdated(
        [...state.intelligenceOperatorNotes.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (input.eventId ? row.eventId === input.eventId : true))
          .filter((row) => (input.scope ? row.scope === input.scope : true))
          .slice(0, input.limit),
      );
    },

    async createIntelligenceHypothesisLedgerEntry(input) {
      const now = nowIso();
      const row: HypothesisLedgerEntry = {
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        eventId: input.eventId,
        hypothesisId: input.hypothesisId,
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        confidence: input.confidence,
        rationale: input.rationale,
        status: input.status,
        reviewState: input.reviewState ?? 'watch',
        reviewReason: input.reviewReason ?? null,
        reviewOwner: input.reviewOwner ?? null,
        reviewUpdatedAt: input.reviewUpdatedAt ?? null,
        reviewUpdatedBy: input.reviewUpdatedBy ?? null,
        reviewResolvedAt: input.reviewResolvedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      state.intelligenceHypothesisLedger.set(row.id, row);
      return row;
    },

    async listIntelligenceHypothesisLedgerEntries(input) {
      return sortByUpdated(
        [...state.intelligenceHypothesisLedger.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId,
        ),
      );
    },

    async updateIntelligenceHypothesisLedgerReviewState(input) {
      const current = state.intelligenceHypothesisLedger.get(input.entryId);
      if (!current || current.workspaceId !== input.workspaceId) return null;
      const next: HypothesisLedgerEntry = {
        ...current,
        reviewState: input.reviewState,
        reviewReason: input.reviewReason ?? current.reviewReason ?? null,
        reviewOwner: input.reviewOwner ?? current.reviewOwner ?? null,
        reviewUpdatedAt: nowIso(),
        reviewUpdatedBy: input.updatedBy,
        reviewResolvedAt: input.reviewResolvedAt ?? (input.reviewState === 'ignore' ? nowIso() : null),
        updatedAt: nowIso(),
      };
      state.intelligenceHypothesisLedger.set(next.id, next);
      return next;
    },

    async createIntelligenceHypothesisEvidenceLink(input) {
      const row: HypothesisEvidenceLink = {
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        eventId: input.eventId,
        hypothesisId: input.hypothesisId,
        linkedClaimId: input.linkedClaimId ?? null,
        signalId: input.signalId ?? null,
        relation: input.relation,
        evidenceStrength: input.evidenceStrength ?? null,
        createdAt: nowIso(),
      };
      state.intelligenceHypothesisEvidenceLinks.set(row.id, row);
      return row;
    },

    async listIntelligenceHypothesisEvidenceLinks(input) {
      return sortByUpdated(
        [...state.intelligenceHypothesisEvidenceLinks.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId,
        ),
      );
    },

    async replaceIntelligenceInvalidationEntries(input) {
      for (const [id, row] of state.intelligenceInvalidationEntries.entries()) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceInvalidationEntries.delete(id);
        }
      }
      const now = nowIso();
      const rows = input.entries.map((entry) => {
        const row: IntelligenceInvalidationEntryRecord = {
          id: entry.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          eventId: input.eventId,
          title: entry.title,
          description: entry.description,
          matcherJson: { ...(entry.matcherJson ?? {}) },
          status: entry.status,
          createdAt: now,
          updatedAt: now,
        };
        state.intelligenceInvalidationEntries.set(row.id, row);
        return row;
      });
      return rows;
    },

    async listIntelligenceInvalidationEntries(input) {
      return sortByUpdated(
        [...state.intelligenceInvalidationEntries.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId,
        ),
      );
    },

    async replaceIntelligenceExpectedSignalEntries(input) {
      for (const [id, row] of state.intelligenceExpectedSignalEntries.entries()) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceExpectedSignalEntries.delete(id);
        }
      }
      const now = nowIso();
      const rows = input.entries.map((entry) => {
        const row: IntelligenceExpectedSignalEntryRecord = {
          id: entry.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          eventId: input.eventId,
          signalKey: entry.signalKey,
          description: entry.description,
          dueAt: entry.dueAt ?? null,
          status: entry.status,
          createdAt: now,
          updatedAt: now,
        };
        state.intelligenceExpectedSignalEntries.set(row.id, row);
        return row;
      });
      return rows;
    },

    async listIntelligenceExpectedSignalEntries(input) {
      return sortByUpdated(
        [...state.intelligenceExpectedSignalEntries.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId,
        ),
      );
    },

    async createIntelligenceOutcomeEntry(input) {
      const row: IntelligenceOutcomeEntryRecord = {
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        eventId: input.eventId,
        status: input.status,
        summary: input.summary,
        createdAt: nowIso(),
      };
      state.intelligenceOutcomeEntries.set(row.id, row);
      return row;
    },

    async listIntelligenceOutcomeEntries(input) {
      return sortByUpdated(
        [...state.intelligenceOutcomeEntries.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId,
        ),
      );
    },

    async upsertIntelligenceNarrativeCluster(input) {
      const existing = [...state.intelligenceNarrativeClusters.values()].find(
        (row) => row.workspaceId === input.workspaceId && row.clusterKey === input.clusterKey,
      );
      const now = nowIso();
      const row: IntelligenceNarrativeClusterRecord = {
        id: existing?.id ?? input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        clusterKey: input.clusterKey,
        title: input.title,
        eventFamily: input.eventFamily,
        topDomainId: input.topDomainId ?? null,
        anchorEntities: [...input.anchorEntities],
        state: input.state,
        eventCount: input.eventCount,
        recurringEventCount: input.recurringEventCount,
        divergingEventCount: input.divergingEventCount,
        supportiveHistoryCount: input.supportiveHistoryCount,
        hotspotEventCount: input.hotspotEventCount,
        latestRecurringScore: input.latestRecurringScore,
        driftScore: input.driftScore,
        supportScore: input.supportScore,
        contradictionScore: input.contradictionScore,
        timeCoherenceScore: input.timeCoherenceScore,
        recurringStrengthTrend: input.recurringStrengthTrend,
        divergenceTrend: input.divergenceTrend,
        supportDecayScore: input.supportDecayScore,
        contradictionAcceleration: input.contradictionAcceleration,
        clusterPriorityScore: input.clusterPriorityScore,
        recentExecutionBlockedCount: input.recentExecutionBlockedCount,
        reviewState: input.reviewState ?? existing?.reviewState ?? 'watch',
        reviewReason: input.reviewReason ?? existing?.reviewReason ?? null,
        reviewOwner: input.reviewOwner ?? existing?.reviewOwner ?? null,
        reviewUpdatedAt: input.reviewUpdatedAt ?? existing?.reviewUpdatedAt ?? null,
        reviewUpdatedBy: input.reviewUpdatedBy ?? existing?.reviewUpdatedBy ?? null,
        reviewResolvedAt: input.reviewResolvedAt ?? existing?.reviewResolvedAt ?? null,
        lastLedgerAt: input.lastLedgerAt ?? existing?.lastLedgerAt ?? null,
        lastEventAt: input.lastEventAt ?? null,
        lastRecurringAt: input.lastRecurringAt ?? existing?.lastRecurringAt ?? null,
        lastDivergingAt: input.lastDivergingAt ?? existing?.lastDivergingAt ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      state.intelligenceNarrativeClusters.set(row.id, row);
      return row;
    },

    async listIntelligenceNarrativeClusters(input) {
      return sortByUpdated(
        [...state.intelligenceNarrativeClusters.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .slice(0, input.limit),
      );
    },

    async getIntelligenceNarrativeClusterById(input) {
      const row = state.intelligenceNarrativeClusters.get(input.clusterId);
      return row && row.workspaceId === input.workspaceId ? row : null;
    },

    async deleteIntelligenceNarrativeCluster(input) {
      const current = state.intelligenceNarrativeClusters.get(input.clusterId);
      if (!current || current.workspaceId !== input.workspaceId) return false;
      state.intelligenceNarrativeClusters.delete(input.clusterId);
      for (const [id, membership] of state.intelligenceNarrativeClusterMemberships.entries()) {
        if (membership.workspaceId === input.workspaceId && membership.clusterId === input.clusterId) {
          state.intelligenceNarrativeClusterMemberships.delete(id);
        }
      }
      for (const [id, entry] of state.intelligenceNarrativeClusterLedger.entries()) {
        if (entry.workspaceId === input.workspaceId && entry.clusterId === input.clusterId) {
          state.intelligenceNarrativeClusterLedger.delete(id);
        }
      }
      for (const [id, entry] of state.intelligenceNarrativeClusterTimeline.entries()) {
        if (entry.workspaceId === input.workspaceId && entry.clusterId === input.clusterId) {
          state.intelligenceNarrativeClusterTimeline.delete(id);
        }
      }
      return true;
    },

    async updateIntelligenceNarrativeClusterReviewState(input) {
      const current = state.intelligenceNarrativeClusters.get(input.clusterId);
      if (!current || current.workspaceId !== input.workspaceId) return null;
      const now = nowIso();
      const next: IntelligenceNarrativeClusterRecord = {
        ...current,
        reviewState: input.reviewState,
        reviewReason: input.reviewReason ?? current.reviewReason ?? null,
        reviewOwner: input.reviewOwner ?? current.reviewOwner ?? null,
        reviewUpdatedAt: now,
        reviewUpdatedBy: input.updatedBy,
        reviewResolvedAt: input.reviewResolvedAt ?? (input.reviewState === 'ignore' ? now : null),
        updatedAt: now,
      };
      state.intelligenceNarrativeClusters.set(next.id, next);
      return next;
    },

    async upsertIntelligenceNarrativeClusterMembership(input) {
      const existing = [...state.intelligenceNarrativeClusterMemberships.values()].find(
        (row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId,
      );
      const now = nowIso();
      const row: IntelligenceNarrativeClusterMembershipRecord = {
        id: existing?.id ?? input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        clusterId: input.clusterId,
        eventId: input.eventId,
        relation: input.relation,
        score: input.score,
        daysDelta: input.daysDelta ?? null,
        isLatest: input.isLatest,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      state.intelligenceNarrativeClusterMemberships.set(row.id, row);
      return row;
    },

    async listIntelligenceNarrativeClusterMemberships(input) {
      return sortByUpdated(
        [...state.intelligenceNarrativeClusterMemberships.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (input.clusterId ? row.clusterId === input.clusterId : true))
          .filter((row) => (input.eventId ? row.eventId === input.eventId : true))
          .slice(0, input.limit),
      );
    },

    async replaceIntelligenceTemporalNarrativeLedgerEntries(input) {
      for (const [id, row] of state.intelligenceTemporalNarrativeLedger.entries()) {
        if (row.workspaceId === input.workspaceId && row.eventId === input.eventId) {
          state.intelligenceTemporalNarrativeLedger.delete(id);
        }
      }
      const now = nowIso();
      const rows = input.entries.map((entry) => {
        const row: IntelligenceTemporalNarrativeLedgerEntryRecord = {
          id: entry.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          eventId: input.eventId,
          relatedEventId: entry.relatedEventId,
          relatedEventTitle: entry.relatedEventTitle,
          relation: entry.relation,
          score: entry.score,
          daysDelta: entry.daysDelta ?? null,
          topDomainId: entry.topDomainId ?? null,
          graphSupportScore: entry.graphSupportScore,
          graphContradictionScore: entry.graphContradictionScore,
          graphHotspotCount: entry.graphHotspotCount,
          timeCoherenceScore: entry.timeCoherenceScore,
          createdAt: now,
          updatedAt: now,
        };
        state.intelligenceTemporalNarrativeLedger.set(row.id, row);
        return row;
      });
      return rows;
    },

    async listIntelligenceTemporalNarrativeLedgerEntries(input) {
      return sortByUpdated(
        [...state.intelligenceTemporalNarrativeLedger.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.eventId === input.eventId,
        ),
      );
    },

    async createIntelligenceNarrativeClusterLedgerEntry(input) {
      const row: IntelligenceNarrativeClusterLedgerEntryRecord = {
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        clusterId: input.clusterId,
        entryType: input.entryType,
        summary: input.summary,
        scoreDelta: input.scoreDelta,
        sourceEventIds: [...input.sourceEventIds],
        createdAt: input.createdAt ?? nowIso(),
      };
      state.intelligenceNarrativeClusterLedger.set(row.id, row);
      return row;
    },

    async listIntelligenceNarrativeClusterLedgerEntries(input) {
      const rows = sortByUpdated(
        [...state.intelligenceNarrativeClusterLedger.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.clusterId === input.clusterId,
        ),
      );
      return typeof input.limit === 'number' ? rows.slice(0, input.limit) : rows;
    },

    async replaceIntelligenceNarrativeClusterTimelineEntries(input) {
      for (const [id, row] of state.intelligenceNarrativeClusterTimeline.entries()) {
        if (row.workspaceId === input.workspaceId && row.clusterId === input.clusterId) {
          state.intelligenceNarrativeClusterTimeline.delete(id);
        }
      }
      const now = nowIso();
      const rows = input.entries.map((entry) => {
        const row: IntelligenceNarrativeClusterTimelineRecord = {
          id: entry.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          clusterId: input.clusterId,
          bucketStart: entry.bucketStart,
          eventCount: entry.eventCount,
          recurringScore: entry.recurringScore,
          driftScore: entry.driftScore,
          supportScore: entry.supportScore,
          contradictionScore: entry.contradictionScore,
          timeCoherenceScore: entry.timeCoherenceScore,
          hotspotEventCount: entry.hotspotEventCount,
          createdAt: entry.createdAt ?? now,
          updatedAt: entry.updatedAt ?? now,
        };
        state.intelligenceNarrativeClusterTimeline.set(row.id, row);
        return row;
      });
      return rows.sort((left, right) => right.bucketStart.localeCompare(left.bucketStart));
    },

    async listIntelligenceNarrativeClusterTimelineEntries(input) {
      return sortByUpdated(
        [...state.intelligenceNarrativeClusterTimeline.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.clusterId === input.clusterId,
        ),
      );
    },

    async createIntelligenceExecutionAudit(input) {
      const row: ExecutionAuditRecord = {
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        eventId: input.eventId,
        candidateId: input.candidateId,
        connectorId: input.connectorId ?? null,
        actionName: input.actionName ?? null,
        status: input.status,
        summary: input.summary,
        resultJson: { ...(input.resultJson ?? {}) },
        createdAt: nowIso(),
      };
      state.intelligenceExecutionAudits.set(row.id, row);
      return row;
    },

    async listIntelligenceExecutionAudits(input) {
      return sortByUpdated(
        [...state.intelligenceExecutionAudits.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (input.eventId ? row.eventId === input.eventId : true))
          .slice(0, input.limit),
      );
    },

    async createIntelligenceBridgeDispatch(input) {
      const now = nowIso();
      const row: IntelligenceBridgeDispatchRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        eventId: input.eventId,
        kind: input.kind,
        status: input.status ?? 'pending',
        targetId: input.targetId ?? null,
        requestJson: { ...(input.requestJson ?? {}) },
        responseJson: { ...(input.responseJson ?? {}) },
        createdAt: now,
        updatedAt: now,
      };
      state.intelligenceBridgeDispatches.set(row.id, row);
      return row;
    },

    async listIntelligenceBridgeDispatches(input) {
      return sortByUpdated(
        [...state.intelligenceBridgeDispatches.values()]
          .filter((row) => row.workspaceId === input.workspaceId)
          .filter((row) => (input.eventId ? row.eventId === input.eventId : true))
          .slice(0, input.limit)
      );
    },

    async upsertIntelligenceModelRegistryEntries(input) {
      const rows: ModelRegistryEntryRecord[] = [];
      const now = nowIso();
      for (const entry of input.entries) {
        const key = registryKey(entry.provider, entry.modelId);
        const current = state.intelligenceModelRegistry.get(key);
        const next: ModelRegistryEntryRecord = {
          id: current?.id ?? randomUUID(),
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          ...entry,
        };
        state.intelligenceModelRegistry.set(key, next);
        rows.push(next);
      }
      return rows;
    },

    async listIntelligenceModelRegistryEntries(input) {
      return sortByUpdated(
        [...state.intelligenceModelRegistry.values()].filter((row) => (input?.provider ? row.provider === input.provider : true))
      );
    },

    async replaceIntelligenceProviderHealth(input) {
      for (const row of input.entries) {
        state.intelligenceProviderHealth.set(row.provider, { ...row });
      }
      return [...state.intelligenceProviderHealth.values()].sort((left, right) => left.provider.localeCompare(right.provider));
    },

    async listIntelligenceProviderHealth() {
      return [...state.intelligenceProviderHealth.values()].sort((left, right) => left.provider.localeCompare(right.provider));
    },

    async replaceIntelligenceAliasBindings(input) {
      const now = nowIso();
      for (const row of [...state.intelligenceAliasBindings.values()]) {
        if (aliasMatch(row, input.workspaceId ?? null, input.alias)) {
          state.intelligenceAliasBindings.delete(row.id);
        }
      }
      const rows: CapabilityAliasBindingRecord[] = [];
      for (const binding of input.bindings) {
        const row: CapabilityAliasBindingRecord = {
          id: randomUUID(),
          workspaceId: input.workspaceId ?? null,
          alias: input.alias,
          provider: binding.provider,
          modelId: binding.modelId,
          weight: binding.weight ?? 1,
          fallbackRank: binding.fallbackRank ?? 1,
          canaryPercent: binding.canaryPercent ?? 0,
          isActive: binding.isActive ?? true,
          requiresStructuredOutput: binding.requiresStructuredOutput ?? false,
          requiresToolUse: binding.requiresToolUse ?? false,
          requiresLongContext: binding.requiresLongContext ?? false,
          maxCostClass: binding.maxCostClass ?? null,
          updatedBy: input.updatedBy ?? binding.updatedBy ?? null,
          createdAt: now,
          updatedAt: now,
        };
        state.intelligenceAliasBindings.set(row.id, row);
        rows.push(row);
      }
      return sortByUpdated(rows);
    },

    async listIntelligenceAliasBindings(input) {
      return sortByUpdated(
        [...state.intelligenceAliasBindings.values()].filter((row) => {
          if (typeof input?.workspaceId !== 'undefined' && (input.workspaceId ?? null) !== row.workspaceId) return false;
          if (input?.alias && row.alias !== input.alias) return false;
          return true;
        })
      );
    },

    async createIntelligenceAliasRollout(input) {
      const row: AliasRolloutRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId ?? null,
        alias: input.alias,
        bindingIds: [...input.bindingIds],
        createdBy: input.createdBy ?? null,
        note: input.note ?? null,
        createdAt: nowIso(),
      };
      state.intelligenceAliasRollouts.set(row.id, row);
      return row;
    },

    async listIntelligenceAliasRollouts(input) {
      return sortByUpdated(
        [...state.intelligenceAliasRollouts.values()]
          .filter((row) => (typeof input?.workspaceId !== 'undefined' ? row.workspaceId === (input.workspaceId ?? null) : true))
          .filter((row) => (input?.alias ? row.alias === input.alias : true))
          .slice(0, input?.limit ?? 50)
      );
    },
  };
}
