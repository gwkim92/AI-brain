"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, BrainCircuit, Cable, Play, RefreshCw, ScanSearch, Send, ShieldCheck } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  bridgeIntelligenceEventToAction,
  bridgeIntelligenceEventToBrief,
  createIntelligenceOperatorNote,
  createIntelligenceWorkspace,
  deliberateIntelligenceEvent,
  executeIntelligenceEvent,
  getIntelligenceEvent,
  getIntelligenceEventGraph,
  getIntelligenceHypotheses,
  getIntelligenceNarrativeCluster,
  getIntelligenceNarrativeClusterGraph,
  getIntelligenceNarrativeClusterTimeline,
  listIntelligenceFetchFailures,
  listIntelligenceEvents,
  listIntelligenceNarrativeClusters,
  listIntelligenceRuntimeAliases,
  listIntelligenceRuntimeModels,
  listIntelligenceRuns,
  listIntelligenceSources,
  listIntelligenceWorkspaces,
  retryIntelligenceSignal,
  retryIntelligenceSource,
  toggleIntelligenceSource,
  updateIntelligenceAliasBindings,
  updateIntelligenceEventReviewState,
  updateIntelligenceHypothesisReviewState,
  updateIntelligenceLinkedClaimReviewState,
  updateIntelligenceNarrativeClusterReviewState,
} from "@/lib/api/endpoints";
import type {
  AliasRolloutRecord,
  ClaimLinkRecord,
  EventReviewState,
  ExecutionAuditRecord,
  HypothesisEvidenceLink,
  HypothesisLedgerEntry,
  IntelligenceBridgeDispatchRecord,
  IntelligenceCapabilityAlias,
  IntelligenceCapabilityAliasBinding,
  IntelligenceCatalogSyncRun,
  IntelligenceEventClusterRecord,
  IntelligenceEventGraphNeighborhood,
  IntelligenceEventGraphSummary,
  IntelligenceExpectedSignalEntryRecord,
  IntelligenceFetchFailureRecord,
  IntelligenceHotspotCluster,
  IntelligenceHypothesisEvidenceSummary,
  IntelligenceInvalidationEntryRecord,
  IntelligenceModelRegistryEntry,
  IntelligenceNarrativeClusterMemberSummary,
  IntelligenceNarrativeClusterLedgerEntryRecord,
  IntelligenceNarrativeClusterTimelineRecord,
  IntelligenceNarrativeClusterTrendSummary,
  IntelligenceNarrativeClusterGraphSummary,
  IntelligenceNarrativeClusterRecord,
  IntelligenceOutcomeEntryRecord,
  IntelligenceRelatedHistoricalEventSummary,
  IntelligenceTemporalNarrativeLedgerEntryRecord,
  IntelligenceSemanticWorkerRun,
  IntelligenceScanRunRecord,
  IntelligenceSourceRecord,
  IntelligenceWorkspaceRecord,
  IntelligenceWorkerStatus,
  IntelligenceScannerWorkerRun,
  LinkedClaimEdgeRecord,
  LinkedClaimRecord,
  OperatorNoteRecord,
  ProviderName,
  ProviderHealthRecord,
  SemanticBacklogStatus,
} from "@/lib/api/types";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readBlockedReason(candidate: IntelligenceEventClusterRecord["executionCandidates"][number]): string | null {
  const blockedReason = candidate.resultJson?.blocked_reason;
  return typeof blockedReason === "string" && blockedReason.length > 0 ? blockedReason : null;
}

type RuntimeSnapshot = {
  scannerWorker: IntelligenceWorkerStatus<IntelligenceScannerWorkerRun> | null;
  semanticWorker: IntelligenceWorkerStatus<IntelligenceSemanticWorkerRun> | null;
  syncWorker: IntelligenceWorkerStatus<IntelligenceCatalogSyncRun> | null;
  semanticBacklog: SemanticBacklogStatus;
  aliases: {
    workspace: IntelligenceCapabilityAliasBinding[];
    global: IntelligenceCapabilityAliasBinding[];
  };
  rollouts: {
    workspace: AliasRolloutRecord[];
    global: AliasRolloutRecord[];
  };
  models: IntelligenceModelRegistryEntry[];
  providerHealth: ProviderHealthRecord[];
};

type RuntimeBindingScope = "workspace" | "global";

type SelectedEventDetail = {
  event: IntelligenceEventClusterRecord;
  linkedClaims: LinkedClaimRecord[];
  claimLinks: ClaimLinkRecord[];
  reviewState: EventReviewState;
  bridgeDispatches: IntelligenceBridgeDispatchRecord[];
  executionAudit: ExecutionAuditRecord[];
  operatorNotes: OperatorNoteRecord[];
  invalidationEntries: IntelligenceInvalidationEntryRecord[];
  expectedSignalEntries: IntelligenceExpectedSignalEntryRecord[];
  outcomeEntries: IntelligenceOutcomeEntryRecord[];
  narrativeCluster: IntelligenceNarrativeClusterRecord | null;
  narrativeClusterMembers: IntelligenceNarrativeClusterMemberSummary[];
  temporalNarrativeLedger: IntelligenceTemporalNarrativeLedgerEntryRecord[];
  relatedHistoricalEvents: IntelligenceRelatedHistoricalEventSummary[];
};

type SelectedHypothesisDetail = {
  ledgerEntries: HypothesisLedgerEntry[];
  evidenceLinks: HypothesisEvidenceLink[];
  evidenceSummary: IntelligenceHypothesisEvidenceSummary[];
  invalidationEntries: IntelligenceInvalidationEntryRecord[];
  expectedSignalEntries: IntelligenceExpectedSignalEntryRecord[];
  outcomeEntries: IntelligenceOutcomeEntryRecord[];
};

type SelectedEventGraph = {
  summary: IntelligenceEventGraphSummary;
  nodes: LinkedClaimRecord[];
  edges: Array<LinkedClaimEdgeRecord & { evidence_signal_count: number }>;
  hotspots: string[];
  neighborhoods: IntelligenceEventGraphNeighborhood[];
  hotspotClusters: IntelligenceHotspotCluster[];
  relatedHistoricalEvents: IntelligenceRelatedHistoricalEventSummary[];
};

type SelectedNarrativeClusterDetail = {
  narrativeCluster: IntelligenceNarrativeClusterRecord;
  memberships: IntelligenceNarrativeClusterMemberSummary[];
  recentEvents: IntelligenceEventClusterRecord[];
  ledgerEntries: IntelligenceNarrativeClusterLedgerEntryRecord[];
  operatorNotes: OperatorNoteRecord[];
};

type SelectedNarrativeClusterGraph = {
  summary: IntelligenceNarrativeClusterGraphSummary;
  nodes: LinkedClaimRecord[];
  edges: Array<LinkedClaimEdgeRecord & { evidence_signal_count: number }>;
  hotspots: string[];
  neighborhoods: IntelligenceEventGraphNeighborhood[];
  hotspotClusters: IntelligenceHotspotCluster[];
  recentEvents: IntelligenceEventClusterRecord[];
};

export function IntelligenceModule() {
  const [workspaces, setWorkspaces] = useState<IntelligenceWorkspaceRecord[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [sources, setSources] = useState<IntelligenceSourceRecord[]>([]);
  const [runs, setRuns] = useState<IntelligenceScanRunRecord[]>([]);
  const [fetchFailures, setFetchFailures] = useState<IntelligenceFetchFailureRecord[]>([]);
  const [events, setEvents] = useState<IntelligenceEventClusterRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<IntelligenceEventClusterRecord | null>(null);
  const [selectedEventDetail, setSelectedEventDetail] = useState<SelectedEventDetail | null>(null);
  const [selectedHypothesisDetail, setSelectedHypothesisDetail] = useState<SelectedHypothesisDetail | null>(null);
  const [selectedEventGraph, setSelectedEventGraph] = useState<SelectedEventGraph | null>(null);
  const [narrativeClusters, setNarrativeClusters] = useState<IntelligenceNarrativeClusterRecord[]>([]);
  const [selectedNarrativeClusterId, setSelectedNarrativeClusterId] = useState<string | null>(null);
  const [selectedNarrativeClusterDetail, setSelectedNarrativeClusterDetail] = useState<SelectedNarrativeClusterDetail | null>(null);
  const [selectedNarrativeClusterTimeline, setSelectedNarrativeClusterTimeline] = useState<IntelligenceNarrativeClusterTimelineRecord[]>([]);
  const [selectedNarrativeClusterTrendSummary, setSelectedNarrativeClusterTrendSummary] = useState<IntelligenceNarrativeClusterTrendSummary | null>(null);
  const [selectedNarrativeClusterGraph, setSelectedNarrativeClusterGraph] = useState<SelectedNarrativeClusterGraph | null>(null);
  const [runtime, setRuntime] = useState<RuntimeSnapshot>({
    scannerWorker: null,
    semanticWorker: null,
    syncWorker: null,
    semanticBacklog: {
      pendingCount: 0,
      processingCount: 0,
      failedCount: 0,
      latestFailedSignalIds: [],
    },
    aliases: { workspace: [], global: [] },
    rollouts: { workspace: [], global: [] },
    models: [],
    providerHealth: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [executionStatusFilter, setExecutionStatusFilter] = useState<"all" | "pending" | "blocked" | "executed">("all");
  const [executionBlockedReasonFilter, setExecutionBlockedReasonFilter] = useState<string>("all");
  const [executionToolFilter, setExecutionToolFilter] = useState<string>("all");
  const [clusterStateFilter, setClusterStateFilter] = useState<"all" | "forming" | "recurring" | "diverging">("all");
  const [clusterReviewFilter, setClusterReviewFilter] = useState<"all" | EventReviewState>("all");
  const [clusterHotspotOnly, setClusterHotspotOnly] = useState(false);
  const [clusterBlockedOnly, setClusterBlockedOnly] = useState(false);

  const loadWorkspaceBundle = useCallback(async (nextWorkspaceId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const workspaceData = await listIntelligenceWorkspaces();
      const resolvedWorkspaceId = nextWorkspaceId ?? workspaceData.workspaces[0]?.id ?? null;
      setWorkspaces(workspaceData.workspaces);
      setWorkspaceId(resolvedWorkspaceId);

      if (!resolvedWorkspaceId) {
        setSources([]);
        setRuns([]);
        setFetchFailures([]);
        setEvents([]);
        setSelectedEvent(null);
        setSelectedEventDetail(null);
        setSelectedHypothesisDetail(null);
        setSelectedNarrativeClusterTrendSummary(null);
        setRuntime({
          scannerWorker: null,
          semanticWorker: null,
          syncWorker: null,
          semanticBacklog: {
            pendingCount: 0,
            processingCount: 0,
            failedCount: 0,
            latestFailedSignalIds: [],
          },
          aliases: { workspace: [], global: [] },
          rollouts: { workspace: [], global: [] },
          models: [],
          providerHealth: [],
        });
        return;
      }

      const [sourceData, runData, eventData, clusterData, modelData, aliasData, failureData] = await Promise.all([
        listIntelligenceSources({ workspace_id: resolvedWorkspaceId }),
        listIntelligenceRuns({ workspace_id: resolvedWorkspaceId, limit: 20 }),
        listIntelligenceEvents({ workspace_id: resolvedWorkspaceId, limit: 50 }),
        listIntelligenceNarrativeClusters({ workspace_id: resolvedWorkspaceId, limit: 50 }),
        listIntelligenceRuntimeModels({ workspace_id: resolvedWorkspaceId }),
        listIntelligenceRuntimeAliases({ workspace_id: resolvedWorkspaceId }),
        listIntelligenceFetchFailures({ workspace_id: resolvedWorkspaceId, limit: 20 }),
      ]);
      const nextSelectedEventId = selectedEventId && eventData.events.some((event) => event.id === selectedEventId)
        ? selectedEventId
        : eventData.events[0]?.id ?? null;
      const nextSelectedClusterId =
        selectedNarrativeClusterId && clusterData.narrative_clusters.some((cluster) => cluster.id === selectedNarrativeClusterId)
          ? selectedNarrativeClusterId
          : nextSelectedEventId
            ? eventData.events.find((event) => event.id === nextSelectedEventId)?.narrativeClusterId ?? clusterData.narrative_clusters[0]?.id ?? null
            : clusterData.narrative_clusters[0]?.id ?? null;

      setSources(sourceData.sources);
      setRuns(runData.runs);
      setFetchFailures(failureData.fetch_failures);
      setEvents(eventData.events);
      setNarrativeClusters(clusterData.narrative_clusters);
      setSelectedEventId(nextSelectedEventId);
      setSelectedNarrativeClusterId(nextSelectedClusterId);
      setRuntime({
        scannerWorker: sourceData.scanner_worker,
        semanticWorker: sourceData.semantic_worker,
        syncWorker: modelData.sync_worker,
        semanticBacklog: runData.semantic_backlog,
        aliases: aliasData.bindings,
        rollouts: aliasData.rollouts,
        models: modelData.models,
        providerHealth: modelData.provider_health,
      });

      if (nextSelectedEventId) {
        const [eventDetail, hypothesisDetail, eventGraph] = await Promise.all([
          getIntelligenceEvent(nextSelectedEventId, { workspace_id: resolvedWorkspaceId }),
          getIntelligenceHypotheses(nextSelectedEventId, { workspace_id: resolvedWorkspaceId }),
          getIntelligenceEventGraph(nextSelectedEventId, { workspace_id: resolvedWorkspaceId }),
        ]);
        setSelectedEvent(eventDetail.event);
        setSelectedEventDetail({
          event: eventDetail.event,
          linkedClaims: eventDetail.linked_claims,
          claimLinks: eventDetail.claim_links,
          reviewState: eventDetail.review_state,
          bridgeDispatches: eventDetail.bridge_dispatches,
          executionAudit: eventDetail.execution_audit,
          operatorNotes: eventDetail.operator_notes,
          invalidationEntries: eventDetail.invalidation_entries,
          expectedSignalEntries: eventDetail.expected_signal_entries,
          outcomeEntries: eventDetail.outcome_entries,
          narrativeCluster: eventDetail.narrative_cluster,
          narrativeClusterMembers: eventDetail.narrative_cluster_members,
          temporalNarrativeLedger: eventDetail.temporal_narrative_ledger,
          relatedHistoricalEvents: eventDetail.related_historical_events,
        });
        setSelectedHypothesisDetail({
          ledgerEntries: hypothesisDetail.ledger_entries,
          evidenceLinks: hypothesisDetail.evidence_links,
          evidenceSummary: hypothesisDetail.evidence_summary,
          invalidationEntries: hypothesisDetail.invalidation_entries,
          expectedSignalEntries: hypothesisDetail.expected_signal_entries,
          outcomeEntries: hypothesisDetail.outcome_entries,
        });
        setSelectedEventGraph({
          summary: eventGraph.summary,
          nodes: eventGraph.nodes,
          edges: eventGraph.edges,
          hotspots: eventGraph.hotspots,
          neighborhoods: eventGraph.neighborhoods,
          hotspotClusters: eventGraph.hotspot_clusters,
          relatedHistoricalEvents: eventGraph.related_historical_events,
        });
      } else {
        setSelectedEvent(null);
        setSelectedEventDetail(null);
        setSelectedHypothesisDetail(null);
        setSelectedEventGraph(null);
      }

      if (nextSelectedClusterId) {
        const [clusterDetail, clusterTimeline, clusterGraph] = await Promise.all([
          getIntelligenceNarrativeCluster(nextSelectedClusterId, { workspace_id: resolvedWorkspaceId }),
          getIntelligenceNarrativeClusterTimeline(nextSelectedClusterId, { workspace_id: resolvedWorkspaceId }),
          getIntelligenceNarrativeClusterGraph(nextSelectedClusterId, { workspace_id: resolvedWorkspaceId }),
        ]);
        setSelectedNarrativeClusterDetail({
          narrativeCluster: clusterDetail.narrative_cluster,
          memberships: clusterDetail.memberships,
          recentEvents: clusterDetail.recent_events,
          ledgerEntries: clusterDetail.ledger_entries,
          operatorNotes: clusterDetail.operator_notes,
        });
        setSelectedNarrativeClusterTimeline(clusterTimeline.timeline);
        setSelectedNarrativeClusterTrendSummary(clusterTimeline.trend_summary);
        setSelectedNarrativeClusterGraph({
          summary: clusterGraph.summary,
          nodes: clusterGraph.nodes,
          edges: clusterGraph.edges,
          hotspots: clusterGraph.hotspots,
          neighborhoods: clusterGraph.neighborhoods,
          hotspotClusters: clusterGraph.hotspot_clusters,
          recentEvents: clusterGraph.recent_events,
        });
      } else {
        setSelectedNarrativeClusterDetail(null);
        setSelectedNarrativeClusterTimeline([]);
        setSelectedNarrativeClusterTrendSummary(null);
        setSelectedNarrativeClusterGraph(null);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to load intelligence plane.");
      }
    } finally {
      setLoading(false);
    }
  }, [selectedEventId, selectedNarrativeClusterId]);

  useEffect(() => {
    void loadWorkspaceBundle();
  }, [loadWorkspaceBundle]);

  const selectEvent = useCallback(async (eventId: string) => {
    if (!workspaceId) return;
    setBusyKey(`event:${eventId}`);
    setSelectedEventId(eventId);
    try {
      const [detail, hypothesisDetail, eventGraph] = await Promise.all([
        getIntelligenceEvent(eventId, { workspace_id: workspaceId }),
        getIntelligenceHypotheses(eventId, { workspace_id: workspaceId }),
        getIntelligenceEventGraph(eventId, { workspace_id: workspaceId }),
      ]);
      setSelectedEvent(detail.event);
      setSelectedEventDetail({
        event: detail.event,
        linkedClaims: detail.linked_claims,
        claimLinks: detail.claim_links,
        reviewState: detail.review_state,
        bridgeDispatches: detail.bridge_dispatches,
        executionAudit: detail.execution_audit,
        operatorNotes: detail.operator_notes,
        invalidationEntries: detail.invalidation_entries,
        expectedSignalEntries: detail.expected_signal_entries,
        outcomeEntries: detail.outcome_entries,
        narrativeCluster: detail.narrative_cluster,
        narrativeClusterMembers: detail.narrative_cluster_members,
        temporalNarrativeLedger: detail.temporal_narrative_ledger,
        relatedHistoricalEvents: detail.related_historical_events,
      });
      setSelectedHypothesisDetail({
        ledgerEntries: hypothesisDetail.ledger_entries,
        evidenceLinks: hypothesisDetail.evidence_links,
        evidenceSummary: hypothesisDetail.evidence_summary,
        invalidationEntries: hypothesisDetail.invalidation_entries,
        expectedSignalEntries: hypothesisDetail.expected_signal_entries,
        outcomeEntries: hypothesisDetail.outcome_entries,
      });
      setSelectedEventGraph({
        summary: eventGraph.summary,
        nodes: eventGraph.nodes,
        edges: eventGraph.edges,
        hotspots: eventGraph.hotspots,
        neighborhoods: eventGraph.neighborhoods,
        hotspotClusters: eventGraph.hotspot_clusters,
        relatedHistoricalEvents: eventGraph.related_historical_events,
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to load event detail.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [workspaceId]);

  const selectNarrativeCluster = useCallback(async (clusterId: string) => {
    if (!workspaceId) return;
    setBusyKey(`cluster:${clusterId}`);
    setSelectedNarrativeClusterId(clusterId);
    try {
      const [clusterDetail, clusterTimeline, clusterGraph] = await Promise.all([
        getIntelligenceNarrativeCluster(clusterId, { workspace_id: workspaceId }),
        getIntelligenceNarrativeClusterTimeline(clusterId, { workspace_id: workspaceId }),
        getIntelligenceNarrativeClusterGraph(clusterId, { workspace_id: workspaceId }),
      ]);
      setSelectedNarrativeClusterDetail({
        narrativeCluster: clusterDetail.narrative_cluster,
        memberships: clusterDetail.memberships,
        recentEvents: clusterDetail.recent_events,
        ledgerEntries: clusterDetail.ledger_entries,
        operatorNotes: clusterDetail.operator_notes,
      });
      setSelectedNarrativeClusterTimeline(clusterTimeline.timeline);
      setSelectedNarrativeClusterTrendSummary(clusterTimeline.trend_summary);
      setSelectedNarrativeClusterGraph({
        summary: clusterGraph.summary,
        nodes: clusterGraph.nodes,
        edges: clusterGraph.edges,
        hotspots: clusterGraph.hotspots,
        neighborhoods: clusterGraph.neighborhoods,
        hotspotClusters: clusterGraph.hotspot_clusters,
        recentEvents: clusterGraph.recent_events,
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to load narrative cluster detail.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [workspaceId]);

  const toggleSource = useCallback(async (source: IntelligenceSourceRecord) => {
    if (!workspaceId) return;
    setBusyKey(`source:${source.id}`);
    try {
      await toggleIntelligenceSource(source.id, {
        workspace_id: workspaceId,
        enabled: !source.enabled,
      });
      await loadWorkspaceBundle(workspaceId);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to toggle source.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, workspaceId]);

  const retrySourceAction = useCallback(async (source: IntelligenceSourceRecord) => {
    if (!workspaceId) return;
    setBusyKey(`source-retry:${source.id}`);
    try {
      await retryIntelligenceSource(source.id, { workspace_id: workspaceId });
      await loadWorkspaceBundle(workspaceId);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to retry source.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, workspaceId]);

  const retrySignalAction = useCallback(async (signalId: string) => {
    if (!workspaceId) return;
    setBusyKey(`signal-retry:${signalId}`);
    try {
      await retryIntelligenceSignal(signalId, { workspace_id: workspaceId });
      await loadWorkspaceBundle(workspaceId);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to retry signal.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, workspaceId]);

  const runAction = useCallback(async (kind: "deliberate" | "brief" | "action" | "execute", candidateId?: string) => {
    if (!workspaceId || !selectedEvent) return;
    setBusyKey(`action:${kind}`);
    try {
      if (kind === "deliberate") {
        await deliberateIntelligenceEvent(selectedEvent.id, { workspace_id: workspaceId });
      } else if (kind === "brief") {
        await bridgeIntelligenceEventToBrief({ workspace_id: workspaceId, event_id: selectedEvent.id });
      } else if (kind === "action") {
        await bridgeIntelligenceEventToAction({ workspace_id: workspaceId, event_id: selectedEvent.id });
      } else if (kind === "execute" && candidateId) {
        await executeIntelligenceEvent(selectedEvent.id, {
          workspace_id: workspaceId,
          candidate_id: candidateId,
        });
      }
      await loadWorkspaceBundle(workspaceId);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Intelligence action failed.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, selectedEvent, workspaceId]);

  const updateReviewStateForEvent = useCallback(async (eventId: string, reviewState: EventReviewState) => {
    if (!workspaceId) return;
    const current = events.find((event) => event.id === eventId) ?? null;
    const reviewReason = typeof window !== "undefined" && reviewState !== "watch"
      ? window.prompt("review reason을 입력해라", current?.reviewReason ?? "")?.trim() ?? null
      : null;
    const reviewOwner = typeof window !== "undefined" && reviewState === "review"
      ? window.prompt("review owner(user id)를 입력해라", current?.reviewOwner ?? "")?.trim() ?? null
      : null;
    setBusyKey(`review:${eventId}:${reviewState}`);
    try {
      await updateIntelligenceEventReviewState(eventId, {
        workspace_id: workspaceId,
        review_state: reviewState,
        review_reason: reviewReason,
        review_owner: reviewOwner,
        review_resolved_at: reviewState === "ignore" ? new Date().toISOString() : null,
      });
      await loadWorkspaceBundle(workspaceId);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to update review state.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [events, loadWorkspaceBundle, workspaceId]);

  const updateReviewStateAction = useCallback(async (reviewState: EventReviewState) => {
    if (!selectedEvent) return;
    await updateReviewStateForEvent(selectedEvent.id, reviewState);
  }, [selectedEvent, updateReviewStateForEvent]);

  const updateReviewStateForLinkedClaim = useCallback(async (linkedClaimId: string, reviewState: EventReviewState) => {
    if (!workspaceId || !selectedEventDetail || !selectedEvent) return;
    const current = selectedEventDetail.linkedClaims.find((row) => row.id === linkedClaimId) ?? null;
    const reviewReason = typeof window !== "undefined" && reviewState !== "watch"
      ? window.prompt("linked claim review reason을 입력해라", current?.reviewReason ?? "")?.trim() ?? null
      : null;
    const reviewOwner = typeof window !== "undefined" && reviewState === "review"
      ? window.prompt("linked claim review owner(user id)를 입력해라", current?.reviewOwner ?? "")?.trim() ?? null
      : null;
    setBusyKey(`linked-claim-review:${linkedClaimId}:${reviewState}`);
    try {
      await updateIntelligenceLinkedClaimReviewState(linkedClaimId, {
        workspace_id: workspaceId,
        review_state: reviewState,
        review_reason: reviewReason,
        review_owner: reviewOwner,
        review_resolved_at: reviewState === "ignore" ? new Date().toISOString() : null,
      });
      await selectEvent(selectedEvent.id);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to update linked claim review state.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [selectedEvent, selectedEventDetail, selectEvent, workspaceId]);

  const updateReviewStateForHypothesis = useCallback(async (entryId: string, reviewState: EventReviewState) => {
    if (!workspaceId || !selectedHypothesisDetail || !selectedEvent) return;
    const current = selectedHypothesisDetail.ledgerEntries.find((row) => row.id === entryId) ?? null;
    const reviewReason = typeof window !== "undefined" && reviewState !== "watch"
      ? window.prompt("hypothesis review reason을 입력해라", current?.reviewReason ?? "")?.trim() ?? null
      : null;
    const reviewOwner = typeof window !== "undefined" && reviewState === "review"
      ? window.prompt("hypothesis review owner(user id)를 입력해라", current?.reviewOwner ?? "")?.trim() ?? null
      : null;
    setBusyKey(`hypothesis-review:${entryId}:${reviewState}`);
    try {
      await updateIntelligenceHypothesisReviewState(entryId, {
        workspace_id: workspaceId,
        review_state: reviewState,
        review_reason: reviewReason,
        review_owner: reviewOwner,
        review_resolved_at: reviewState === "ignore" ? new Date().toISOString() : null,
      });
      await selectEvent(selectedEvent.id);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to update hypothesis review state.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [selectedEvent, selectedHypothesisDetail, selectEvent, workspaceId]);

  const updateReviewStateForNarrativeCluster = useCallback(async (clusterId: string, reviewState: EventReviewState) => {
    const currentCluster =
      (selectedNarrativeClusterDetail?.narrativeCluster?.id === clusterId
        ? selectedNarrativeClusterDetail.narrativeCluster
        : null) ??
      (selectedEventDetail?.narrativeCluster?.id === clusterId ? selectedEventDetail.narrativeCluster : null);
    if (!workspaceId || !currentCluster) return;
    const reviewReason = typeof window !== "undefined" && reviewState !== "watch"
      ? window.prompt("narrative cluster review reason을 입력해라", currentCluster.reviewReason ?? "")?.trim() ?? null
      : null;
    const reviewOwner = typeof window !== "undefined" && reviewState === "review"
      ? window.prompt("narrative cluster review owner(user id)를 입력해라", currentCluster.reviewOwner ?? "")?.trim() ?? null
      : null;
    setBusyKey(`narrative-cluster-review:${clusterId}:${reviewState}`);
    try {
      await updateIntelligenceNarrativeClusterReviewState(clusterId, {
        workspace_id: workspaceId,
        review_state: reviewState,
        review_reason: reviewReason,
        review_owner: reviewOwner,
        review_resolved_at: reviewState === "ignore" ? new Date().toISOString() : null,
      });
      await loadWorkspaceBundle(workspaceId);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to update narrative cluster review state.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, selectedEventDetail, selectedNarrativeClusterDetail, workspaceId]);

  const addOperatorNoteAction = useCallback(async (
    scope: OperatorNoteRecord["scope"] = "event",
    scopeId: string | null = null,
    label = "이벤트",
    eventIdOverride: string | null = null,
  ) => {
    if (!workspaceId) return;
    const targetEventId =
      eventIdOverride ??
      selectedEvent?.id ??
      selectedNarrativeClusterDetail?.recentEvents[0]?.id ??
      null;
    if (!targetEventId) return;
    const note = typeof window !== "undefined" ? window.prompt(`${label} 메모를 입력해라`)?.trim() : null;
    if (!note) return;
    setBusyKey(`operator-note:create:${scope}:${scopeId ?? "event"}`);
    try {
      await createIntelligenceOperatorNote(targetEventId, {
        workspace_id: workspaceId,
        scope,
        scope_id: scopeId,
        note,
      });
      await loadWorkspaceBundle(workspaceId);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to create operator note.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, selectedEvent, selectedNarrativeClusterDetail, workspaceId]);

  const saveRuntimeAliasBindings = useCallback(async (input: {
    alias: IntelligenceCapabilityAlias;
    scope: RuntimeBindingScope;
    bindings: Array<{
      provider: ProviderName;
      model_id: string;
      weight?: number;
      fallback_rank?: number;
      canary_percent?: number;
      is_active?: boolean;
      requires_structured_output?: boolean;
      requires_tool_use?: boolean;
      requires_long_context?: boolean;
      max_cost_class?: "free" | "low" | "standard" | "premium" | null;
    }>;
  }) => {
    if (!workspaceId) return;
    setBusyKey(`runtime-alias:${input.scope}:${input.alias}`);
    try {
      await updateIntelligenceAliasBindings(input.alias, {
        workspace_id: workspaceId,
        scope: input.scope,
        bindings: input.bindings,
      });
      await loadWorkspaceBundle(workspaceId);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to update runtime alias bindings.");
      }
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, workspaceId]);

  const pendingExecutionCount = useMemo(
    () => events.reduce((total, event) => total + event.executionCandidates.filter((candidate) => candidate.status === "pending").length, 0),
    [events]
  );
  const degradedSources = useMemo(
    () => sources.filter((source) => source.health.lastStatus !== "ok" || source.health.consecutiveFailures > 0),
    [sources]
  );
  const robotsBlockedSources = useMemo(
    () => sources.filter((source) => source.health.robotsBlocked),
    [sources]
  );
  const throttledSources = useMemo(
    () => sources.filter((source) => source.health.status429Count > 0),
    [sources]
  );
  const fetchFailureSummary = useMemo(() => {
    const grouped = new Map<string, {
      sourceName: string;
      total: number;
      latestAt: string;
      reasons: string[];
      sourceId: string | null;
    }>();
    for (const failure of fetchFailures) {
      const sourceName = sources.find((source) => source.id === failure.sourceId)?.name ?? "unknown source";
      const key = `${failure.sourceId ?? "unknown"}:${sourceName}`;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          sourceName,
          total: 1,
          latestAt: failure.createdAt,
          reasons: [failure.reason],
          sourceId: failure.sourceId,
        });
        continue;
      }
      current.total += 1;
      if (new Date(failure.createdAt).getTime() > new Date(current.latestAt).getTime()) {
        current.latestAt = failure.createdAt;
      }
      if (!current.reasons.includes(failure.reason)) {
        current.reasons.push(failure.reason);
      }
    }
    return Array.from(grouped.values()).sort((left, right) => new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime());
  }, [fetchFailures, sources]);
  const reviewQueue = useMemo(
    () =>
      events
        .filter((event) => event.reviewState === "review" || event.deliberationStatus === "failed" || event.contradictionCount > 0)
        .sort((left, right) => {
          const leftScore = left.operatorPriorityScore ?? 0;
          const rightScore = right.operatorPriorityScore ?? 0;
          return rightScore - leftScore || right.structuralityScore - left.structuralityScore;
        })
        .slice(0, 12),
    [events]
  );
  const driftQueue = useMemo(
    () =>
      events
        .map((event) => {
          const primary = event.primaryHypotheses[0]?.confidence ?? 0;
          const counter = event.counterHypotheses[0]?.confidence ?? 0;
          const absentCount = event.expectedSignals.filter((signal) => signal.status === "absent").length;
          const invalidatedCount = event.outcomes.filter((outcome) => outcome.status === "invalidated").length;
          const drift = Math.abs(primary - counter);
          const attention = absentCount * 3 + invalidatedCount * 4 + event.contradictionCount * 2 + (drift < 0.15 ? 2 : 0);
          return { event, primary, counter, drift, absentCount, invalidatedCount, attention };
        })
        .sort((left, right) => right.attention - left.attention || left.drift - right.drift)
        .slice(0, 12),
    [events]
  );
  const executionInbox = useMemo(
    () =>
      events
        .flatMap((event) =>
          event.executionCandidates.map((candidate) => ({
            event,
            candidate,
          }))
        )
        .sort((left, right) => {
          const statusOrder = (status: string) => {
            if (status === "pending") return 0;
            if (status === "blocked") return 1;
            if (status === "executed") return 2;
            return 3;
          };
          return (
            statusOrder(left.candidate.status) - statusOrder(right.candidate.status) ||
            (right.event.operatorPriorityScore ?? 0) - (left.event.operatorPriorityScore ?? 0) ||
            right.event.structuralityScore - left.event.structuralityScore
          );
        })
        .slice(0, 16),
    [events]
  );
  const executionBlockedReasons = useMemo(
    () =>
      Array.from(
        new Set(
          executionInbox
            .map(({ candidate }) => readBlockedReason(candidate))
            .filter((reason): reason is string => Boolean(reason))
        )
      ).sort(),
    [executionInbox]
  );
  const executionTools = useMemo(
    () =>
      Array.from(
        new Set(
          executionInbox
            .map(({ candidate }) => candidate.payload?.mcp_tool_name)
            .filter((tool): tool is string => typeof tool === "string" && tool.length > 0)
        )
      ).sort(),
    [executionInbox]
  );
  const filteredExecutionInbox = useMemo(
    () =>
      executionInbox.filter(({ candidate }) => {
        const blockedReason = readBlockedReason(candidate);
        const toolName =
          typeof candidate.payload?.mcp_tool_name === "string" ? candidate.payload.mcp_tool_name : "unknown";
        if (executionStatusFilter !== "all" && candidate.status !== executionStatusFilter) {
          return false;
        }
        if (executionBlockedReasonFilter !== "all" && blockedReason !== executionBlockedReasonFilter) {
          return false;
        }
        if (executionToolFilter !== "all" && toolName !== executionToolFilter) {
          return false;
        }
        return true;
      }),
    [executionBlockedReasonFilter, executionInbox, executionStatusFilter, executionToolFilter]
  );
  const selectedEventFlags = useMemo(() => {
    if (!selectedEvent || !selectedHypothesisDetail) {
      return [];
    }
    const selectedCluster = selectedEventDetail?.narrativeCluster ?? null;
    const flags: string[] = [];
    const absentCount = selectedHypothesisDetail.expectedSignalEntries.filter((row) => row.status === "absent").length;
    const invalidatedCount = selectedHypothesisDetail.outcomeEntries.filter((row) => row.status === "invalidated").length;
    if (selectedEvent.reviewState === "review") {
      flags.push("review queue 대상");
    }
    if (selectedEvent.deliberationStatus === "failed") {
      flags.push("자동 토론 실패");
    }
    if (selectedEvent.contradictionCount > 0) {
      flags.push(`contradiction ${selectedEvent.contradictionCount}`);
    }
    if (selectedEvent.nonSocialCorroborationCount < 1) {
      flags.push("non-social corroboration 부족");
    }
    if (selectedEvent.linkedClaimHealthScore < 0.5) {
      flags.push(`linked-claim health ${selectedEvent.linkedClaimHealthScore.toFixed(2)}`);
    }
    if (selectedEvent.timeCoherenceScore < 0.55) {
      flags.push(`time coherence ${selectedEvent.timeCoherenceScore.toFixed(2)}`);
    }
    if (selectedCluster?.reviewState === "review") {
      flags.push("cluster review 대상");
    }
    if ((selectedCluster?.driftScore ?? 0) >= 0.45) {
      flags.push(`cluster drift ${selectedCluster?.driftScore.toFixed(2)}`);
    }
    if (selectedEvent.graphHotspotCount > 0) {
      flags.push(`graph hotspot ${selectedEvent.graphHotspotCount}`);
    }
    if (selectedEvent.graphContradictionScore > 0.25) {
      flags.push(`graph contradiction ${selectedEvent.graphContradictionScore.toFixed(2)}`);
    }
    if (selectedEvent.temporalNarrativeState === "diverging") {
      flags.push(`temporal divergence ${(selectedEvent.recurringNarrativeScore ?? 0).toFixed(2)}`);
    } else if ((selectedEvent.relatedHistoricalEventCount ?? 0) > 0) {
      flags.push(`related narratives ${selectedEvent.relatedHistoricalEventCount ?? 0}`);
    }
    if (absentCount > 0) {
      flags.push(`absence evidence ${absentCount}`);
    }
    if (invalidatedCount > 0) {
      flags.push(`invalidated outcomes ${invalidatedCount}`);
    }
    if (selectedEvent.executionCandidates.some((candidate) => candidate.status === "blocked")) {
      flags.push("blocked execution candidate 존재");
    }
    return flags;
  }, [selectedEvent, selectedEventDetail, selectedHypothesisDetail]);
  const selectedLedgerDrift = useMemo(() => {
    if (!selectedHypothesisDetail) {
      return {
        primaryLatest: null as HypothesisLedgerEntry | null,
        primaryPrevious: null as HypothesisLedgerEntry | null,
        counterLatest: null as HypothesisLedgerEntry | null,
        counterPrevious: null as HypothesisLedgerEntry | null,
        primaryDelta: null as number | null,
        counterDelta: null as number | null,
      };
    }
    const entries = [...selectedHypothesisDetail.ledgerEntries].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
    const primaryEntries = entries.filter((entry) => entry.kind === "primary");
    const counterEntries = entries.filter((entry) => entry.kind === "counter");
    const primaryLatest = primaryEntries[0] ?? null;
    const primaryPrevious = primaryEntries[1] ?? null;
    const counterLatest = counterEntries[0] ?? null;
    const counterPrevious = counterEntries[1] ?? null;
    return {
      primaryLatest,
      primaryPrevious,
      counterLatest,
      counterPrevious,
      primaryDelta:
        primaryLatest && primaryPrevious ? primaryLatest.confidence - primaryPrevious.confidence : null,
      counterDelta:
        counterLatest && counterPrevious ? counterLatest.confidence - counterPrevious.confidence : null,
    };
  }, [selectedHypothesisDetail]);
  const selectedLinkedClaims = useMemo(
    () =>
      [...(selectedEventDetail?.linkedClaims ?? [])].sort((left, right) => {
        const leftWeight = left.contradictionCount * 3 - left.nonSocialSourceCount;
        const rightWeight = right.contradictionCount * 3 - right.nonSocialSourceCount;
        return (
          rightWeight - leftWeight ||
          right.contradictionCount - left.contradictionCount ||
          right.sourceCount - left.sourceCount
        );
      }),
    [selectedEventDetail],
  );
  const selectedRelatedHistoricalEvents = useMemo(
    () => selectedEventDetail?.relatedHistoricalEvents ?? [],
    [selectedEventDetail],
  );
  const selectedTemporalNarrativeLedger = useMemo(
    () => selectedEventDetail?.temporalNarrativeLedger ?? [],
    [selectedEventDetail],
  );
  const selectedNarrativeCluster = useMemo(
    () => selectedEventDetail?.narrativeCluster ?? null,
    [selectedEventDetail],
  );
  const selectedNarrativeClusterMembers = useMemo(
    () => selectedEventDetail?.narrativeClusterMembers ?? [],
    [selectedEventDetail],
  );
  const selectedNarrativeClusterNotes = useMemo(
    () =>
      (selectedEventDetail?.operatorNotes ?? []).filter(
        (note) =>
          note.scope === "narrative_cluster" &&
          note.scopeId === (selectedEventDetail?.narrativeCluster?.id ?? null),
      ),
    [selectedEventDetail],
  );
  const clusterInbox = useMemo(
    () =>
      narrativeClusters
        .filter((cluster) => {
          if (clusterStateFilter !== "all" && cluster.state !== clusterStateFilter) return false;
          if (clusterReviewFilter !== "all" && cluster.reviewState !== clusterReviewFilter) return false;
          if (clusterHotspotOnly && cluster.hotspotEventCount < 1) return false;
          if (clusterBlockedOnly && cluster.recentExecutionBlockedCount < 1) return false;
          return true;
        })
        .sort((left, right) => {
          return (
            right.clusterPriorityScore - left.clusterPriorityScore ||
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
          );
        }),
    [clusterBlockedOnly, clusterHotspotOnly, clusterReviewFilter, clusterStateFilter, narrativeClusters],
  );
  const selectedClusterInboxNotes = useMemo(
    () =>
      (selectedNarrativeClusterDetail?.operatorNotes ?? []).filter(
        (note) =>
          note.scope === "narrative_cluster" &&
          note.scopeId === selectedNarrativeClusterDetail?.narrativeCluster.id,
      ),
    [selectedNarrativeClusterDetail],
  );
  const selectedClusterInboxRecentEvents = useMemo(
    () => selectedNarrativeClusterDetail?.recentEvents ?? [],
    [selectedNarrativeClusterDetail],
  );
  const hypothesisEvidenceSummaryMap = useMemo(
    () =>
      new Map(
        (selectedHypothesisDetail?.evidenceSummary ?? []).map((row) => [row.hypothesis_id, row] as const),
      ),
    [selectedHypothesisDetail],
  );
  const latestRun = runs[0] ?? null;

  const createWorkspaceAction = useCallback(async () => {
    const proposedName = typeof window !== "undefined" ? window.prompt("새 intelligence workspace 이름")?.trim() : null;
    setBusyKey("workspace:create");
    try {
      const result = await createIntelligenceWorkspace({ name: proposedName || undefined });
      await loadWorkspaceBundle(result.workspace.id);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to create workspace.");
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(83,208,255,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(68,255,181,0.12),_transparent_22%),linear-gradient(180deg,_#08111a_0%,_#05080f_100%)] text-white p-6">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="rounded-3xl border border-white/10 bg-black/35 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-[0.35em] text-cyan-300/80">Autonomous Intelligence Plane</p>
              <h1 className="text-3xl font-semibold tracking-tight">독립 스캐너와 추론 평면</h1>
              <p className="max-w-3xl text-sm text-white/70">
                기존 JARVIS와 분리된 이벤트 추적 시스템이다. 등록된 소스를 주기적으로 훑고, 문서를 사건으로 묶고,
                LLM semantic layer를 거쳐 가설과 실행 후보까지 만든다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-white/50">
                {loading ? "Loading intelligence plane..." : "Runtime snapshot ready"}
              </span>
              <select
                value={workspaceId ?? ""}
                onChange={(event) => {
                  const next = event.target.value || null;
                  void loadWorkspaceBundle(next);
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id} className="bg-slate-900">
                    {workspace.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void loadWorkspaceBundle(workspaceId)}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-400/20"
              >
                <RefreshCw size={14} /> 새로고침
              </button>
              <button
                type="button"
                onClick={() => void createWorkspaceAction()}
                className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.06] px-4 py-2 text-sm text-white/85 hover:border-white/25 hover:bg-white/[0.09]"
              >
                {busyKey === "workspace:create" ? <RefreshCw size={14} className="animate-spin" /> : <Bot size={14} />}
                새 워크스페이스
              </button>
            </div>
          </div>
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatCard icon={<ScanSearch size={16} />} label="Sources" value={String(sources.length)} note={runtime.scannerWorker?.enabled ? "scanner on" : "scanner off"} />
            <StatCard icon={<BrainCircuit size={16} />} label="Events" value={String(events.length)} note={latestRun ? `last scan ${formatDateTime(latestRun.startedAt)}` : "no runs"} />
            <StatCard icon={<ShieldCheck size={16} />} label="Pending Exec" value={String(pendingExecutionCount)} note={latestRun ? `${latestRun.executionCount} exec candidates` : "idle"} />
            <StatCard icon={<Cable size={16} />} label="Semantic" value={runtime.semanticWorker?.enabled ? "ON" : "OFF"} note={runtime.semanticWorker?.lastRun ? `last ${formatDateTime(runtime.semanticWorker.lastRun.finishedAt)}` : "not yet"} />
            <StatCard icon={<RefreshCw size={16} />} label="Backlog" value={String(runtime.semanticBacklog.pendingCount)} note={`${runtime.semanticBacklog.failedCount} failed`} />
            <StatCard icon={<Bot size={16} />} label="Models" value={String(runtime.models.length)} note={`${runtime.aliases.workspace.length + runtime.aliases.global.length} bindings`} />
            <StatCard icon={<ShieldCheck size={16} />} label="Sync" value={runtime.syncWorker?.enabled ? "ON" : "OFF"} note={runtime.syncWorker?.lastRun ? `last ${formatDateTime(runtime.syncWorker.lastRun.finishedAt)}` : "not yet"} />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,420px)_minmax(0,1fr)]">
          <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-mono uppercase tracking-[0.25em] text-white/70">Sources</h2>
              <span className="text-xs text-white/50">{runtime.scannerWorker?.inflight ? "Scanning..." : "Stable"}</span>
            </div>
            <div className="space-y-2">
              {sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => undefined}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left hover:border-white/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-white">{source.name}</p>
                      <p className="mt-1 text-xs text-white/50">{source.kind} · {source.sourceType} · {source.sourceTier}</p>
                      <p className="mt-1 text-[11px] text-white/40">poll {source.pollMinutes}m · last {formatDateTime(source.lastFetchedAt)}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/45">
                        <span>health {source.health.lastStatus}</span>
                        <span>robots {source.crawlPolicy.respectRobots ? "on" : "off"}</span>
                        <span>depth {source.crawlPolicy.maxDepth}</span>
                        <span>pages/run {source.crawlPolicy.maxPagesPerRun}</span>
                        <span>403 {source.health.status403Count}</span>
                        <span>429 {source.health.status429Count}</span>
                      </div>
                      <p className="mt-2 text-[11px] text-white/35">
                        allow {source.crawlPolicy.allowDomains.length || 0} · deny {source.crawlPolicy.denyDomains.length || 0} · latency {source.health.recentLatencyMs ?? "—"}ms
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-mono ${source.enabled ? "bg-emerald-400/15 text-emerald-200" : "bg-white/10 text-white/50"}`}>
                      {source.enabled ? "ON" : "OFF"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleSource(source);
                      }}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70"
                    >
                      {busyKey === `source:${source.id}` ? "..." : source.enabled ? "비활성" : "활성"}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void retrySourceAction(source);
                      }}
                      className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100"
                    >
                      {busyKey === `source-retry:${source.id}` ? "..." : "재시도"}
                    </button>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-mono uppercase tracking-[0.25em] text-white/70">Events</h2>
              <span className="text-xs text-white/50">{latestRun ? `${latestRun.clusteredEventCount} clustered` : "no run"}</span>
            </div>
            <div className="space-y-2">
              {events.map((event) => {
                const active = event.id === selectedEventId;
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => void selectEvent(event.id)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${active ? "border-cyan-300/60 bg-cyan-400/10" : "border-white/10 bg-white/[0.03] hover:border-white/20"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-white">{event.title}</p>
                        <p className="mt-1 text-xs text-white/55">{event.topDomainId ?? "unknown"} · {event.eventFamily}</p>
                        <p className="mt-1 text-[11px] text-white/40">
                          claims {event.linkedClaimCount} · contradictions {event.contradictionCount} · non-social {event.nonSocialCorroborationCount} · review {event.reviewState}
                        </p>
                        <p className="mt-1 text-[11px] text-white/35">
                          operator priority {event.operatorPriorityScore ?? 0} · claim health {event.linkedClaimHealthScore.toFixed(2)} · time {event.timeCoherenceScore.toFixed(2)} · graph +{event.graphSupportScore.toFixed(2)} / -{event.graphContradictionScore.toFixed(2)} / hot {event.graphHotspotCount}
                        </p>
                        <p className="mt-1 text-[11px] text-white/35">
                          temporal {event.temporalNarrativeState ?? "new"} · recurring {(event.recurringNarrativeScore ?? 0).toFixed(2)} · related {event.relatedHistoricalEventCount ?? 0}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono text-cyan-200">{Math.round(event.structuralityScore * 100)}</p>
                        <p className="text-[10px] text-white/45">{event.riskBand} · {event.deliberationStatus}</p>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/65">{event.summary}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-mono uppercase tracking-[0.25em] text-white/70">Event Detail</h2>
                <p className="mt-1 text-sm text-white/50">{selectedEvent ? selectedEvent.id : "선택된 이벤트 없음"}</p>
              </div>
              {selectedEvent ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton label="Deliberate" icon={<BrainCircuit size={14} />} busy={busyKey === "action:deliberate"} onClick={() => void runAction("deliberate")} />
                  <ActionButton label="Bridge Brief" icon={<Send size={14} />} busy={busyKey === "action:brief"} onClick={() => void runAction("brief")} />
                  <ActionButton label="Bridge Action" icon={<Cable size={14} />} busy={busyKey === "action:action"} onClick={() => void runAction("action")} />
                  <ActionButton
                    label="Event Note"
                    icon={<Bot size={14} />}
                    busy={busyKey === "operator-note:create:event:event"}
                    onClick={() => void addOperatorNoteAction()}
                  />
                </div>
              ) : null}
            </div>

            {!selectedEvent ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-sm text-white/45">
                좌측 이벤트를 선택하면 가설, 반대가설, invalidation, execution candidate를 볼 수 있다.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap gap-2 text-[11px] font-mono text-white/50">
                    <span>{selectedEvent.topDomainId ?? "unknown"}</span>
                    <span>structurality {selectedEvent.structuralityScore.toFixed(2)}</span>
                    <span>actionability {selectedEvent.actionabilityScore.toFixed(2)}</span>
                    <span>{selectedEvent.signalIds.length} signals</span>
                    <span>claims {selectedEvent.linkedClaimCount}</span>
                    <span>contradictions {selectedEvent.contradictionCount}</span>
                    <span>non-social {selectedEvent.nonSocialCorroborationCount}</span>
                    <span>claim health {selectedEvent.linkedClaimHealthScore.toFixed(2)}</span>
                    <span>time coherence {selectedEvent.timeCoherenceScore.toFixed(2)}</span>
                    <span>graph support {selectedEvent.graphSupportScore.toFixed(2)}</span>
                    <span>graph contradiction {selectedEvent.graphContradictionScore.toFixed(2)}</span>
                    <span>graph hotspots {selectedEvent.graphHotspotCount}</span>
                    <span>temporal {selectedEvent.temporalNarrativeState ?? "new"}</span>
                    <span>recurring {(selectedEvent.recurringNarrativeScore ?? 0).toFixed(2)}</span>
                    <span>related {selectedEvent.relatedHistoricalEventCount ?? 0}</span>
                    <span>deliberation {selectedEvent.deliberationStatus}</span>
                    <span>review {selectedEvent.reviewState}</span>
                    <span>priority {selectedEvent.operatorPriorityScore ?? 0}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/75">{selectedEvent.summary}</p>
                  {selectedEvent.reviewReason || selectedEvent.reviewOwner || selectedEvent.reviewResolvedAt ? (
                    <p className="mt-2 text-xs text-white/45">
                      review reason {selectedEvent.reviewReason ?? "—"} · owner {selectedEvent.reviewOwner ?? "—"} · resolved {formatDateTime(selectedEvent.reviewResolvedAt)}
                    </p>
                  ) : null}
                  {selectedEventFlags.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedEventFlags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded-full border border-amber-300/20 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100/85"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["watch", "review", "ignore"] as EventReviewState[]).map((state) => (
                      <button
                        key={state}
                        type="button"
                        onClick={() => void updateReviewStateAction(state)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] ${
                          selectedEvent.reviewState === state
                            ? "border-cyan-300/60 bg-cyan-400/10 text-cyan-100"
                            : "border-white/10 bg-white/[0.04] text-white/65"
                        }`}
                      >
                        {busyKey === `review:${selectedEvent.id}:${state}` ? "..." : state}
                      </button>
                    ))}
                  </div>
                </div>

                <DetailBlock title="Primary Hypotheses" items={selectedEvent.primaryHypotheses.map((row) => `${row.title} · ${row.summary}`)} />
                <DetailBlock title="Counter Hypotheses" items={selectedEvent.counterHypotheses.map((row) => `${row.title} · ${row.summary}`)} />
                <DetailBlock title="Invalidation Snapshot" items={selectedEvent.invalidationConditions.map((row) => `${row.title} · ${row.description} · ${row.status}`)} />
                <DetailBlock title="Expected Signals Snapshot" items={selectedEvent.expectedSignals.map((row) => `${row.signalKey} · ${row.description} · ${row.status}`)} />
                <DetailBlock
                  title="Linked Claims"
                  items={selectedLinkedClaims.map((row) => `${row.canonicalSubject} ${row.canonicalPredicate} ${row.canonicalObject} · family ${row.predicateFamily} · non-social ${row.nonSocialSourceCount} · contradictions ${row.contradictionCount}`)}
                />
                <RelatedNarrativesPanel
                  items={selectedRelatedHistoricalEvents}
                  onSelectEvent={(eventId) => void selectEvent(eventId)}
                />
                <NarrativeClusterPanel
                  cluster={selectedNarrativeCluster}
                  members={selectedNarrativeClusterMembers}
                  notes={selectedNarrativeClusterNotes}
                  onSelectEvent={(eventId) => void selectEvent(eventId)}
                  onOpenClusterInbox={(clusterId) => void selectNarrativeCluster(clusterId)}
                  onNoteClick={() => {
                    if (!selectedNarrativeCluster) return;
                    void addOperatorNoteAction("narrative_cluster", selectedNarrativeCluster.id, "narrative cluster");
                  }}
                  onReviewStateChange={(clusterId, state) => void updateReviewStateForNarrativeCluster(clusterId, state)}
                  reviewBusyState={
                    busyKey?.startsWith(`narrative-cluster-review:${selectedNarrativeCluster?.id ?? "na"}:`)
                      ? busyKey.split(":")[2] as EventReviewState
                      : null
                  }
                />
                <TemporalNarrativeLedgerPanel
                  items={selectedTemporalNarrativeLedger}
                  onSelectEvent={(eventId) => void selectEvent(eventId)}
                />
                <ClaimGraphPanel
                  graph={selectedEventGraph}
                  onNoteClick={(linkedClaimId) => void addOperatorNoteAction("linked_claim", linkedClaimId, "linked claim")}
                  onReviewStateChange={(linkedClaimId, state) => void updateReviewStateForLinkedClaim(linkedClaimId, state)}
                  busyKey={busyKey}
                />
                {selectedEventDetail && selectedLinkedClaims.length > 0 ? (
                  <ScopeActionBlock
                    title="Linked Claim Notes"
                    items={selectedLinkedClaims.slice(0, 6).map((row) => ({
                      id: row.id,
                      label: `${row.canonicalSubject} ${row.canonicalPredicate} ${row.canonicalObject}`,
                      meta: `family ${row.predicateFamily} · non-social ${row.nonSocialSourceCount} · contradictions ${row.contradictionCount} · review ${row.reviewState}`,
                      detail:
                        [
                          `bucket ${formatDateTime(row.timeBucketStart)} ~ ${formatDateTime(row.timeBucketEnd)}`,
                          `support ${formatDateTime(row.lastSupportedAt)}`,
                          `contradict ${formatDateTime(row.lastContradictedAt)}`,
                          row.reviewReason || row.reviewOwner || row.reviewResolvedAt
                            ? `reason ${row.reviewReason ?? "—"} · owner ${row.reviewOwner ?? "—"} · resolved ${formatDateTime(row.reviewResolvedAt)}`
                            : null,
                        ]
                          .filter((value): value is string => Boolean(value))
                          .join(" · "),
                      noteBusy: busyKey === `operator-note:create:linked_claim:${row.id}`,
                      onNoteClick: () => void addOperatorNoteAction("linked_claim", row.id, "linked claim"),
                      reviewState: row.reviewState,
                      onReviewStateChange: (state) => void updateReviewStateForLinkedClaim(row.id, state),
                      reviewBusyState: busyKey?.startsWith(`linked-claim-review:${row.id}:`) ? busyKey.split(":")[2] as EventReviewState : null,
                    }))}
                  />
                ) : null}
                <DetailBlock
                  title="Claim Links"
                  items={(selectedEventDetail?.claimLinks ?? []).map((row) => `${row.relation} · linked ${row.linkedClaimId.slice(0, 8)} · signal ${row.signalId.slice(0, 8)} · confidence ${row.confidence.toFixed(2)} · strength ${row.linkStrength.toFixed(2)}`)}
                />
                <DetailBlock
                  title="Hypothesis Ledger"
                  items={(selectedHypothesisDetail?.ledgerEntries ?? []).map((row) => {
                    const summary = hypothesisEvidenceSummaryMap.get(row.hypothesisId);
                    const supportStrength = summary ? summary.support_strength.toFixed(2) : "0.00";
                    const contradictStrength = summary ? summary.contradict_strength.toFixed(2) : "0.00";
                    return `${row.kind} · ${row.title} · ${row.confidence.toFixed(2)} · ${row.status} · support ${summary?.support_count ?? 0}/${supportStrength} · contradict ${summary?.contradict_count ?? 0}/${contradictStrength} · edge +${summary?.support_edge_count ?? 0}/${summary?.graph_support_strength?.toFixed?.(2) ?? "0.00"} · edge -${summary?.contradict_edge_count ?? 0}/${summary?.graph_contradict_strength?.toFixed?.(2) ?? "0.00"}`;
                  })}
                />
                {selectedHypothesisDetail && selectedHypothesisDetail.ledgerEntries.length > 0 ? (
                  <ScopeActionBlock
                    title="Hypothesis Notes"
                    items={selectedHypothesisDetail.ledgerEntries.slice(0, 6).map((row) => ({
                      id: row.id,
                      label: `${row.kind} · ${row.title}`,
                      meta: `${row.confidence.toFixed(2)} · ${row.status} · review ${row.reviewState}`,
                      detail:
                        row.reviewReason || row.reviewOwner || row.reviewResolvedAt
                          ? `reason ${row.reviewReason ?? "—"} · owner ${row.reviewOwner ?? "—"} · resolved ${formatDateTime(row.reviewResolvedAt)}`
                          : null,
                      noteBusy: busyKey === `operator-note:create:hypothesis:${row.id}`,
                      onNoteClick: () => void addOperatorNoteAction("hypothesis", row.id, "hypothesis"),
                      reviewState: row.reviewState,
                      onReviewStateChange: (state) => void updateReviewStateForHypothesis(row.id, state),
                      reviewBusyState: busyKey?.startsWith(`hypothesis-review:${row.id}:`) ? busyKey.split(":")[2] as EventReviewState : null,
                    }))}
                  />
                ) : null}
                <DetailBlock
                  title="Evidence Links"
                  items={(selectedHypothesisDetail?.evidenceLinks ?? []).map((row) => `${row.relation} · hypothesis ${row.hypothesisId.slice(0, 8)} · claim ${row.linkedClaimId?.slice(0, 8) ?? "—"} · strength ${(row.evidenceStrength ?? 0).toFixed(2)}`)}
                />
                <div className="grid gap-4 lg:grid-cols-3">
                  <DetailBlock
                    title="Invalidation Ledger"
                    items={(selectedHypothesisDetail?.invalidationEntries ?? []).map((row) => `${row.title} · ${row.description} · ${row.status} · ${formatDateTime(row.updatedAt)}`)}
                  />
                  <DetailBlock
                    title="Expected Signal Ledger"
                    items={(selectedHypothesisDetail?.expectedSignalEntries ?? []).map((row) => `${row.signalKey} · ${row.description} · ${row.status} · ${formatDateTime(row.dueAt)}`)}
                  />
                  <DetailBlock
                    title="Outcome Ledger"
                    items={(selectedHypothesisDetail?.outcomeEntries ?? []).map((row) => `${row.status} · ${row.summary} · ${formatDateTime(row.createdAt)}`)}
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailBlock
                    title="Primary Drift"
                    items={[
                      selectedLedgerDrift.primaryLatest
                        ? `latest · ${selectedLedgerDrift.primaryLatest.title} · ${selectedLedgerDrift.primaryLatest.confidence.toFixed(2)} · ${formatDateTime(selectedLedgerDrift.primaryLatest.updatedAt)}`
                        : "No primary ledger entry",
                      selectedLedgerDrift.primaryPrevious
                        ? `previous · ${selectedLedgerDrift.primaryPrevious.title} · ${selectedLedgerDrift.primaryPrevious.confidence.toFixed(2)} · ${formatDateTime(selectedLedgerDrift.primaryPrevious.updatedAt)}`
                        : "No previous primary entry",
                      selectedLedgerDrift.primaryDelta !== null
                        ? `delta · ${selectedLedgerDrift.primaryDelta >= 0 ? "+" : ""}${selectedLedgerDrift.primaryDelta.toFixed(2)}`
                        : "delta · —",
                    ]}
                  />
                  <DetailBlock
                    title="Counter Drift"
                    items={[
                      selectedLedgerDrift.counterLatest
                        ? `latest · ${selectedLedgerDrift.counterLatest.title} · ${selectedLedgerDrift.counterLatest.confidence.toFixed(2)} · ${formatDateTime(selectedLedgerDrift.counterLatest.updatedAt)}`
                        : "No counter ledger entry",
                      selectedLedgerDrift.counterPrevious
                        ? `previous · ${selectedLedgerDrift.counterPrevious.title} · ${selectedLedgerDrift.counterPrevious.confidence.toFixed(2)} · ${formatDateTime(selectedLedgerDrift.counterPrevious.updatedAt)}`
                        : "No previous counter entry",
                      selectedLedgerDrift.counterDelta !== null
                        ? `delta · ${selectedLedgerDrift.counterDelta >= 0 ? "+" : ""}${selectedLedgerDrift.counterDelta.toFixed(2)}`
                        : "delta · —",
                    ]}
                  />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">Execution Candidates</h3>
                    <span className="text-xs text-white/40">{selectedEvent.executionCandidates.length}</span>
                  </div>
                  <div className="space-y-2">
                    {selectedEvent.executionCandidates.map((candidate) => (
                      <div key={candidate.id} className="rounded-2xl border border-white/8 bg-black/25 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{candidate.title}</p>
                            <p className="mt-1 text-xs text-white/55">{candidate.executionMode} · {candidate.status} · {candidate.riskBand}</p>
                            <p className="mt-2 text-xs leading-5 text-white/65">{candidate.summary}</p>
                            {readBlockedReason(candidate) ? (
                              <p className="mt-2 text-[11px] text-amber-200/85">
                                blocked reason · {readBlockedReason(candidate)}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => void runAction("execute", candidate.id)}
                            disabled={candidate.status === "executed" || busyKey === "action:execute"}
                            className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Play size={12} /> Run
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailBlock title="Deliberations" items={selectedEvent.deliberations.map((row) => `${row.status} · ${row.executionStance} · ${row.weakestLink}`)} />
                  <DetailBlock title="Outcome Snapshot" items={selectedEvent.outcomes.map((row) => `${row.status} · ${row.summary}`)} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailBlock title="Bridge Dispatch Log" items={(selectedEventDetail?.bridgeDispatches ?? []).map((row) => `${row.kind} · ${row.status} · ${row.targetId ?? "no target"}`)} />
                  <DetailBlock title="Execution Audit" items={(selectedEventDetail?.executionAudit ?? []).map((row) => `${row.status} · ${row.actionName ?? "unknown"} · ${row.summary}`)} />
                </div>
                <DetailBlock title="Operator Notes" items={(selectedEventDetail?.operatorNotes ?? []).map((row) => `${formatDateTime(row.createdAt)} · ${row.scope} · ${row.note}`)} />
              </div>
            )}
          </section>
        </div>

        <section className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
            <h2 className="mb-3 text-sm font-mono uppercase tracking-[0.25em] text-white/70">Recent Runs</h2>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <MiniMetric label="pending" value={String(runtime.semanticBacklog.pendingCount)} />
              <MiniMetric label="processing" value={String(runtime.semanticBacklog.processingCount)} />
              <MiniMetric label="failed" value={String(runtime.semanticBacklog.failedCount)} />
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <MiniMetric label="degraded sources" value={String(degradedSources.length)} />
              <MiniMetric label="robots blocked" value={String(robotsBlockedSources.length)} />
              <MiniMetric label="429 throttled" value={String(throttledSources.length)} />
            </div>
            {runtime.semanticBacklog.latestFailedSignalIds.length > 0 ? (
              <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-amber-100/80">Failed Signals</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {runtime.semanticBacklog.latestFailedSignalIds.map((signalId) => (
                    <button
                      key={signalId}
                      type="button"
                      onClick={() => void retrySignalAction(signalId)}
                      className="rounded-lg border border-amber-300/30 bg-black/20 px-2.5 py-1 text-[11px] text-amber-100"
                    >
                      {busyKey === `signal-retry:${signalId}` ? "..." : signalId.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              {runs.map((run) => (
                <div key={run.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-white">{run.status}</p>
                    <p className="text-xs text-white/45">{formatDateTime(run.startedAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-white/55">
                    fetched {run.fetchedCount} · docs {run.storedDocumentCount} · signals {run.signalCount} · events {run.clusteredEventCount}
                  </p>
                  <p className="mt-1 text-[11px] text-white/40">
                    failed {run.failedCount} · exec {run.executionCount}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <RuntimeControlPlanePanel
            runtime={runtime}
            workspaceId={workspaceId}
            busyKey={busyKey}
            onSaveBindings={saveRuntimeAliasBindings}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-4">
          <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
            <h2 className="mb-3 text-sm font-mono uppercase tracking-[0.25em] text-white/70">Fetch Failures</h2>
            {fetchFailureSummary.length > 0 ? (
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                {fetchFailureSummary.slice(0, 4).map((row) => (
                  <div key={`${row.sourceId ?? "unknown"}-${row.sourceName}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-white">{row.sourceName}</p>
                      <span className="text-xs text-white/45">{row.total} failures</span>
                    </div>
                    <p className="mt-1 text-[11px] text-white/45">{formatDateTime(row.latestAt)}</p>
                    <p className="mt-2 text-xs text-white/60">{row.reasons.slice(0, 2).join(" / ")}</p>
                    {row.sourceId ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const source = sources.find((item) => item.id === row.sourceId);
                            if (source) void retrySourceAction(source);
                          }}
                          className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100"
                        >
                          {busyKey === `source-retry:${row.sourceId}` ? "..." : "재시도"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const source = sources.find((item) => item.id === row.sourceId);
                            if (source) void toggleSource(source);
                          }}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70"
                        >
                          {busyKey === `source:${row.sourceId}` ? "..." : "토글"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="space-y-2">
              {fetchFailures.length === 0 ? (
                <p className="text-xs text-white/40">No recent fetch failures</p>
              ) : (
                fetchFailures.map((failure) => (
                  <div key={failure.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-white/85">{failure.url}</p>
                        <p className="mt-1 text-white/45">{failure.reason}</p>
                        <p className="mt-1 text-[11px] text-white/35">
                          {formatDateTime(failure.createdAt)} · status {failure.statusCode ?? "—"} · robots {failure.blockedByRobots ? "blocked" : "ok"}
                        </p>
                      </div>
                      {failure.sourceId ? (
                        <button
                          type="button"
                          onClick={() => {
                            const source = sources.find((row) => row.id === failure.sourceId);
                            if (source) void retrySourceAction(source);
                          }}
                          className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100"
                        >
                          재시도
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
            <h2 className="mb-3 text-sm font-mono uppercase tracking-[0.25em] text-white/70">Review Queue</h2>
            <div className="space-y-2">
              {reviewQueue
                .map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => void selectEvent(event.id)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left"
                  >
                    <p className="text-sm text-white">{event.title}</p>
                    <p className="mt-1 text-[11px] text-white/45">
                      review {event.reviewState} · contradictions {event.contradictionCount} · non-social {event.nonSocialCorroborationCount} · deliberation {event.deliberationStatus}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      priority {event.operatorPriorityScore ?? 0} · structurality {event.structuralityScore.toFixed(2)} · actionability {event.actionabilityScore.toFixed(2)} · claim health {event.linkedClaimHealthScore.toFixed(2)} · time {event.timeCoherenceScore.toFixed(2)} · risk {event.riskBand}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      temporal {event.temporalNarrativeState ?? "new"} · recurring {(event.recurringNarrativeScore ?? 0).toFixed(2)} · related {event.relatedHistoricalEventCount ?? 0}
                    </p>
                    {event.reviewReason || event.reviewOwner || event.reviewResolvedAt ? (
                      <p className="mt-1 text-[11px] text-white/35">
                        reason {event.reviewReason ?? "—"} · owner {event.reviewOwner ?? "—"} · resolved {formatDateTime(event.reviewResolvedAt)}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["watch", "review", "ignore"] as EventReviewState[]).map((state) => (
                        <button
                          key={`${event.id}-${state}`}
                          type="button"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            void updateReviewStateForEvent(event.id, state);
                          }}
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            event.reviewState === state
                              ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
                              : "border-white/10 bg-black/20 text-white/50"
                          }`}
                        >
                          {busyKey === `review:${event.id}:${state}` ? "..." : state}
                        </button>
                      ))}
                    </div>
                  </button>
                ))}
              {reviewQueue.length === 0 ? (
                <p className="text-xs text-white/40">No items in review queue</p>
              ) : null}
            </div>
          </section>

          <NarrativeClusterInboxPanel
            clusters={clusterInbox}
            selectedClusterId={selectedNarrativeClusterId}
            selectedClusterDetail={selectedNarrativeClusterDetail}
            selectedClusterTimeline={selectedNarrativeClusterTimeline}
            selectedClusterTrendSummary={selectedNarrativeClusterTrendSummary}
            selectedClusterGraph={selectedNarrativeClusterGraph}
            notes={selectedClusterInboxNotes}
            recentEvents={selectedClusterInboxRecentEvents}
            busyKey={busyKey}
            stateFilter={clusterStateFilter}
            reviewFilter={clusterReviewFilter}
            hotspotOnly={clusterHotspotOnly}
            blockedOnly={clusterBlockedOnly}
            onStateFilterChange={setClusterStateFilter}
            onReviewFilterChange={setClusterReviewFilter}
            onHotspotOnlyChange={setClusterHotspotOnly}
            onBlockedOnlyChange={setClusterBlockedOnly}
            onSelectCluster={(clusterId) => void selectNarrativeCluster(clusterId)}
            onSelectEvent={(eventId) => void selectEvent(eventId)}
            onReviewStateChange={(clusterId, state) => void updateReviewStateForNarrativeCluster(clusterId, state)}
            onNoteClick={(clusterId, eventId) => void addOperatorNoteAction("narrative_cluster", clusterId, "narrative cluster", eventId)}
          />

          <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
            <h2 className="mb-3 text-sm font-mono uppercase tracking-[0.25em] text-white/70">Hypothesis Drift</h2>
            <div className="space-y-2">
              {driftQueue.map(({ event, primary, counter, drift, absentCount, invalidatedCount }) => (
                <div key={event.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
                  <p className="text-white">{event.title}</p>
                  <p className="mt-1 text-white/45">
                    primary {primary.toFixed(2)} · counter {counter.toFixed(2)} · drift {drift.toFixed(2)}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    absence {absentCount} · invalidated {invalidatedCount} · contradictions {event.contradictionCount} · non-social {event.nonSocialCorroborationCount} · health {event.linkedClaimHealthScore.toFixed(2)} · time {event.timeCoherenceScore.toFixed(2)} · temporal {event.temporalNarrativeState ?? "new"}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </section>

        <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-mono uppercase tracking-[0.25em] text-white/70">Execution Inbox</h2>
            <span className="text-xs text-white/45">{filteredExecutionInbox.length} visible / {executionInbox.length} total</span>
          </div>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-[11px] text-white/55">
              <span className="font-mono uppercase tracking-[0.18em]">Status</span>
              <select
                value={executionStatusFilter}
                onChange={(event) => setExecutionStatusFilter(event.target.value as typeof executionStatusFilter)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="all" className="bg-slate-900">all</option>
                <option value="pending" className="bg-slate-900">pending</option>
                <option value="blocked" className="bg-slate-900">blocked</option>
                <option value="executed" className="bg-slate-900">executed</option>
              </select>
            </label>
            <label className="space-y-1 text-[11px] text-white/55">
              <span className="font-mono uppercase tracking-[0.18em]">Blocked Reason</span>
              <select
                value={executionBlockedReasonFilter}
                onChange={(event) => setExecutionBlockedReasonFilter(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="all" className="bg-slate-900">all</option>
                {executionBlockedReasons.map((reason) => (
                  <option key={reason} value={reason} className="bg-slate-900">{reason}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-[11px] text-white/55">
              <span className="font-mono uppercase tracking-[0.18em]">Tool</span>
              <select
                value={executionToolFilter}
                onChange={(event) => setExecutionToolFilter(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="all" className="bg-slate-900">all</option>
                {executionTools.map((tool) => (
                  <option key={tool} value={tool} className="bg-slate-900">{tool}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {filteredExecutionInbox.length === 0 ? (
              <p className="text-xs text-white/40">No execution candidates</p>
            ) : (
              filteredExecutionInbox.map(({ event, candidate }) => (
                <div key={candidate.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-white">{candidate.title}</p>
                      <p className="mt-1 text-[11px] text-white/45">
                        {event.title} · {candidate.status} · {candidate.executionMode} · {candidate.riskBand}
                      </p>
                      <p className="mt-1 text-[11px] text-white/35">
                        priority {event.operatorPriorityScore ?? 0} · structurality {event.structuralityScore.toFixed(2)} · actionability {event.actionabilityScore.toFixed(2)} · time {event.timeCoherenceScore.toFixed(2)}
                      </p>
                      {readBlockedReason(candidate) ? (
                        <p className="mt-1 text-[11px] text-amber-200/85">
                          blocked reason · {readBlockedReason(candidate)}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-white/35">
                        tool {typeof candidate.payload?.mcp_tool_name === "string" ? candidate.payload.mcp_tool_name : "unknown"} · connector{" "}
                        {typeof candidate.payload?.connector_capability === "object" &&
                        candidate.payload.connector_capability !== null &&
                        typeof (candidate.payload.connector_capability as { connector_id?: unknown }).connector_id === "string"
                          ? (candidate.payload.connector_capability as { connector_id: string }).connector_id
                          : "builtin"}
                      </p>
                      <p className="mt-2 text-xs text-white/65">{candidate.summary}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => void selectEvent(event.id)}
                        className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/70"
                      >
                        열기
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAction("execute", candidate.id)}
                        disabled={candidate.status === "executed" || busyKey === "action:execute"}
                        className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyKey === "action:execute" ? "..." : "실행"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/45">
                    <span>review {event.reviewState}</span>
                    <span>deliberation {event.deliberationStatus}</span>
                    <span>claims {event.linkedClaimCount}</span>
                    <span>contradictions {event.contradictionCount}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between text-white/50">
        <span className="text-xs font-mono uppercase tracking-[0.2em]">{label}</span>
        <span>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-white/45">{note}</p>
    </div>
  );
}

function ActionButton({ label, icon, busy, onClick }: { label: string; icon: React.ReactNode; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-xs text-white/80 hover:border-white/25 hover:bg-white/[0.08]"
    >
      {busy ? <RefreshCw size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function DetailBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-white/60">{title}</h3>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-white/40">No data</p>
        ) : (
          items.map((item, index) => (
            <div key={`${title}-${index}`} className="rounded-xl border border-white/8 bg-black/25 px-3 py-2 text-xs leading-5 text-white/70">
              {item}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ScopeActionBlock({
  title,
  items,
}: {
  title: string;
  items: Array<{
    id: string;
    label: string;
    meta: string;
    detail?: string | null;
    noteBusy: boolean;
    onNoteClick: () => void;
    reviewState?: EventReviewState;
    reviewBusyState?: EventReviewState | null;
    onReviewStateChange?: (state: EventReviewState) => void;
  }>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-white/60">{title}</h3>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-white/40">No targets</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/8 bg-black/25 px-3 py-3 text-xs text-white/70">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-white/85">{item.label}</p>
                  <p className="mt-1 text-[11px] text-white/45">{item.meta}</p>
                  {item.detail ? (
                    <p className="mt-1 text-[11px] text-white/35">{item.detail}</p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button
                    type="button"
                    onClick={item.onNoteClick}
                    className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100"
                  >
                    {item.noteBusy ? "..." : "메모"}
                  </button>
                  {item.onReviewStateChange ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      {(["watch", "review", "ignore"] as EventReviewState[]).map((state) => (
                        <button
                          key={`${item.id}-${state}`}
                          type="button"
                          onClick={() => item.onReviewStateChange?.(state)}
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            item.reviewState === state
                              ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
                              : "border-white/10 bg-black/20 text-white/50"
                          }`}
                        >
                          {item.reviewBusyState === state ? "..." : state}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RelatedNarrativesPanel({
  items,
  onSelectEvent,
}: {
  items: IntelligenceRelatedHistoricalEventSummary[];
  onSelectEvent: (eventId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">Related Narratives</h3>
        <span className="text-[11px] text-white/40">{items.length} related</span>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-white/40">과거 반복 서사가 아직 없다.</p>
        ) : (
          items.map((item) => (
            <button
              key={item.eventId}
              type="button"
              onClick={() => onSelectEvent(item.eventId)}
              className="w-full rounded-xl border border-white/8 bg-black/25 px-3 py-3 text-left text-xs text-white/70 hover:border-white/15"
            >
              <p className="text-white/85">{item.title}</p>
              <p className="mt-1 text-[11px] text-white/45">
                {item.relation} · score {item.score.toFixed(2)} · {item.daysDelta ?? "—"}d ago
              </p>
              <p className="mt-1 text-[11px] text-white/35">
                domain {item.topDomainId ?? "unknown"} · graph +{item.graphSupportScore.toFixed(2)} / -{item.graphContradictionScore.toFixed(2)} / hot {item.graphHotspotCount} · time {item.timeCoherenceScore.toFixed(2)}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function NarrativeClusterPanel({
  cluster,
  members,
  notes,
  onSelectEvent,
  onOpenClusterInbox,
  onNoteClick,
  onReviewStateChange,
  reviewBusyState,
}: {
  cluster: IntelligenceNarrativeClusterRecord | null;
  members: IntelligenceNarrativeClusterMemberSummary[];
  notes: OperatorNoteRecord[];
  onSelectEvent: (eventId: string) => void;
  onOpenClusterInbox: (clusterId: string) => void;
  onNoteClick: () => void;
  onReviewStateChange: (clusterId: string, state: EventReviewState) => void;
  reviewBusyState: EventReviewState | null;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-mono uppercase tracking-[0.2em] text-white/70">Narrative Cluster</h3>
        <span className="text-[11px] text-white/45">{cluster ? `${cluster.eventCount} events` : "none"}</span>
      </div>
      {!cluster ? (
        <p className="text-sm text-white/45">반복 서사 클러스터가 아직 형성되지 않았다.</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <p className="text-sm font-medium text-white">{cluster.title}</p>
            <p className="mt-2 text-[11px] text-white/50">
              {cluster.state} · {cluster.eventFamily} · domain {cluster.topDomainId ?? "unknown"} · recurring score {cluster.latestRecurringScore.toFixed(2)} · hotspot events {cluster.hotspotEventCount}
            </p>
            <p className="mt-1 text-[11px] text-white/40">
              recurring {cluster.recurringEventCount} · diverging {cluster.divergingEventCount} · supportive {cluster.supportiveHistoryCount} · last {formatDateTime(cluster.lastEventAt)}
            </p>
            <p className="mt-1 text-[11px] text-white/35">
              drift {cluster.driftScore.toFixed(2)} · support {cluster.supportScore.toFixed(2)} · contradiction {cluster.contradictionScore.toFixed(2)} · time {cluster.timeCoherenceScore.toFixed(2)}
            </p>
            <p className="mt-1 text-[11px] text-white/35">
              review {cluster.reviewState} · reason {cluster.reviewReason ?? "—"} · owner {cluster.reviewOwner ?? "—"} · resolved {formatDateTime(cluster.reviewResolvedAt)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["watch", "review", "ignore"] as EventReviewState[]).map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => onReviewStateChange(cluster.id, state)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] ${
                    cluster.reviewState === state
                      ? "border-cyan-300/60 bg-cyan-400/10 text-cyan-100"
                      : "border-white/10 bg-white/[0.04] text-white/65"
                  }`}
                >
                  {reviewBusyState === state ? "..." : state}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onOpenClusterInbox(cluster.id)}
                className="rounded-lg border border-violet-300/25 bg-violet-400/10 px-2.5 py-1 text-[11px] text-violet-100"
              >
                cluster inbox
              </button>
              <button
                type="button"
                onClick={onNoteClick}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70"
              >
                cluster note
              </button>
            </div>
          </div>
          {notes.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">Cluster Notes</p>
              <div className="mt-2 space-y-2">
                {notes.slice(0, 4).map((note) => (
                  <div key={note.id} className="rounded-xl border border-white/8 bg-black/25 px-3 py-2 text-[11px] text-white/65">
                    <p>{note.note}</p>
                    <p className="mt-1 text-white/35">
                      by {note.userId} · {formatDateTime(note.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">Cluster Drift</p>
            <p className="mt-2 text-[11px] text-white/45">
              divergence pressure {cluster.divergingEventCount}/{cluster.eventCount} · hotspot pressure {cluster.hotspotEventCount}/{cluster.eventCount}
            </p>
            <p className="mt-1 text-[11px] text-white/35">
              recurring support {cluster.recurringEventCount + cluster.supportiveHistoryCount} · contradiction score {cluster.contradictionScore.toFixed(2)}
            </p>
          </div>
          <div className="space-y-2">
            {members.map((member) => (
              <button
                key={member.membershipId}
                type="button"
                onClick={() => onSelectEvent(member.eventId)}
                className="w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-left hover:border-white/20"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-white/50">
                  <span>{member.isLatest ? "latest" : member.relation}</span>
                  <span>score {member.score.toFixed(2)}</span>
                  <span>days Δ {member.daysDelta ?? "—"}</span>
                  <span>time {member.timeCoherenceScore.toFixed(2)}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-white">{member.title}</p>
                <p className="mt-2 text-[11px] text-white/45">
                  graph +{member.graphSupportScore.toFixed(2)} / -{member.graphContradictionScore.toFixed(2)} / hot {member.graphHotspotCount} · state {member.temporalNarrativeState ?? "unknown"} · last {formatDateTime(member.lastEventAt)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

type RuntimeBindingDraft = {
  id: string;
  provider: ProviderName;
  modelId: string;
  weight: number;
  fallbackRank: number;
  canaryPercent: number;
  isActive: boolean;
  requiresStructuredOutput: boolean;
  requiresToolUse: boolean;
  requiresLongContext: boolean;
  maxCostClass: "free" | "low" | "standard" | "premium" | null;
};

const RUNTIME_ALIAS_OPTIONS: IntelligenceCapabilityAlias[] = [
  "fast_triage",
  "structured_extraction",
  "cross_doc_linking",
  "skeptical_critique",
  "deep_synthesis",
  "policy_judgment",
  "deep_research",
  "execution_planning",
];

const PROVIDER_OPTIONS: ProviderName[] = ["openai", "gemini", "anthropic", "local"];

function toRuntimeBindingDraft(binding: IntelligenceCapabilityAliasBinding): RuntimeBindingDraft {
  return {
    id: binding.id,
    provider: binding.provider,
    modelId: binding.modelId,
    weight: binding.weight,
    fallbackRank: binding.fallbackRank,
    canaryPercent: binding.canaryPercent,
    isActive: binding.isActive,
    requiresStructuredOutput: binding.requiresStructuredOutput,
    requiresToolUse: binding.requiresToolUse,
    requiresLongContext: binding.requiresLongContext,
    maxCostClass: binding.maxCostClass,
  };
}

function createEmptyRuntimeBindingDraft(provider: ProviderName, modelId = ""): RuntimeBindingDraft {
  return {
    id: `draft-${provider}-${modelId || "new"}`,
    provider,
    modelId,
    weight: 1,
    fallbackRank: 1,
    canaryPercent: 0,
    isActive: true,
    requiresStructuredOutput: false,
    requiresToolUse: false,
    requiresLongContext: false,
    maxCostClass: null,
  };
}

function serializeRuntimeBindingDrafts(drafts: RuntimeBindingDraft[]): string {
  return JSON.stringify(
    drafts
      .map((draft) => ({
        provider: draft.provider,
        modelId: draft.modelId,
        weight: Number(draft.weight.toFixed(3)),
        fallbackRank: draft.fallbackRank,
        canaryPercent: draft.canaryPercent,
        isActive: draft.isActive,
        requiresStructuredOutput: draft.requiresStructuredOutput,
        requiresToolUse: draft.requiresToolUse,
        requiresLongContext: draft.requiresLongContext,
        maxCostClass: draft.maxCostClass,
      }))
      .sort((left, right) => left.fallbackRank - right.fallbackRank || left.provider.localeCompare(right.provider)),
  );
}

type RuntimeBindingChangeSummary = {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  rows: Array<{
    index: number;
    kind: "added" | "removed" | "changed";
    title: string;
    details: string[];
  }>;
};

function summarizeRuntimeBindingChanges(
  baselineDrafts: RuntimeBindingDraft[],
  drafts: RuntimeBindingDraft[],
): RuntimeBindingChangeSummary {
  const rows: RuntimeBindingChangeSummary["rows"] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  const maxLength = Math.max(baselineDrafts.length, drafts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const baseline = baselineDrafts[index] ?? null;
    const draft = drafts[index] ?? null;
    if (!baseline && draft) {
      added += 1;
      rows.push({
        index,
        kind: "added",
        title: `${draft.provider} / ${draft.modelId || "no-model"}`,
        details: [`weight ${draft.weight}`, `rank ${draft.fallbackRank}`],
      });
      continue;
    }
    if (baseline && !draft) {
      removed += 1;
      rows.push({
        index,
        kind: "removed",
        title: `${baseline.provider} / ${baseline.modelId || "no-model"}`,
        details: [`was rank ${baseline.fallbackRank}`],
      });
      continue;
    }
    if (!baseline || !draft) {
      continue;
    }

    const details: string[] = [];
    if (baseline.provider !== draft.provider) details.push(`provider ${baseline.provider} -> ${draft.provider}`);
    if (baseline.modelId !== draft.modelId) details.push(`model ${baseline.modelId || "none"} -> ${draft.modelId || "none"}`);
    if (baseline.weight !== draft.weight) details.push(`weight ${baseline.weight} -> ${draft.weight}`);
    if (baseline.fallbackRank !== draft.fallbackRank) details.push(`rank ${baseline.fallbackRank} -> ${draft.fallbackRank}`);
    if (baseline.canaryPercent !== draft.canaryPercent) details.push(`canary ${baseline.canaryPercent}% -> ${draft.canaryPercent}%`);
    if (baseline.isActive !== draft.isActive) details.push(`active ${baseline.isActive ? "on" : "off"} -> ${draft.isActive ? "on" : "off"}`);
    if (baseline.requiresStructuredOutput !== draft.requiresStructuredOutput) details.push(`structured ${baseline.requiresStructuredOutput ? "on" : "off"} -> ${draft.requiresStructuredOutput ? "on" : "off"}`);
    if (baseline.requiresToolUse !== draft.requiresToolUse) details.push(`tool use ${baseline.requiresToolUse ? "on" : "off"} -> ${draft.requiresToolUse ? "on" : "off"}`);
    if (baseline.requiresLongContext !== draft.requiresLongContext) details.push(`long context ${baseline.requiresLongContext ? "on" : "off"} -> ${draft.requiresLongContext ? "on" : "off"}`);
    if (baseline.maxCostClass !== draft.maxCostClass) details.push(`cost ${(baseline.maxCostClass ?? "none")} -> ${(draft.maxCostClass ?? "none")}`);

    if (details.length === 0) {
      unchanged += 1;
      continue;
    }

    changed += 1;
    rows.push({
      index,
      kind: "changed",
      title: `${baseline.provider} / ${baseline.modelId || "no-model"}`,
      details,
    });
  }

  return { added, removed, changed, unchanged, rows };
}

function RuntimeControlPlanePanel({
  runtime,
  workspaceId,
  busyKey,
  onSaveBindings,
}: {
  runtime: RuntimeSnapshot;
  workspaceId: string | null;
  busyKey: string | null;
  onSaveBindings: (input: {
    alias: IntelligenceCapabilityAlias;
    scope: RuntimeBindingScope;
    bindings: Array<{
      provider: ProviderName;
      model_id: string;
      weight?: number;
      fallback_rank?: number;
      canary_percent?: number;
      is_active?: boolean;
      requires_structured_output?: boolean;
      requires_tool_use?: boolean;
      requires_long_context?: boolean;
      max_cost_class?: "free" | "low" | "standard" | "premium" | null;
    }>;
  }) => Promise<void>;
}) {
  const [scope, setScope] = useState<RuntimeBindingScope>("workspace");
  const [alias, setAlias] = useState<IntelligenceCapabilityAlias>("structured_extraction");
  const [drafts, setDrafts] = useState<RuntimeBindingDraft[]>([]);
  const availableBindings = scope === "workspace" ? runtime.aliases.workspace : runtime.aliases.global;
  const aliasBindings = useMemo(
    () => availableBindings.filter((binding) => binding.alias === alias).sort((left, right) => left.fallbackRank - right.fallbackRank),
    [alias, availableBindings],
  );
  const modelIdsByProvider = useMemo(() => {
    const next = new Map<ProviderName, string[]>();
    for (const provider of PROVIDER_OPTIONS) {
      const values = runtime.models
        .filter((row) => row.provider === provider)
        .map((row) => row.modelId);
      next.set(provider, [...new Set(values)].sort());
    }
    return next;
  }, [runtime.models]);
  const baselineSerialized = useMemo(
    () => serializeRuntimeBindingDrafts(aliasBindings.map(toRuntimeBindingDraft)),
    [aliasBindings],
  );
  const draftSerialized = useMemo(() => serializeRuntimeBindingDrafts(drafts), [drafts]);
  const dirty = baselineSerialized !== draftSerialized;
  const effectiveBusyKey = `runtime-alias:${scope}:${alias}`;
  const changeSummary = useMemo(
    () => summarizeRuntimeBindingChanges(aliasBindings.map(toRuntimeBindingDraft), drafts),
    [aliasBindings, drafts],
  );
  const selectedRollouts = useMemo(() => {
    const rollouts = scope === "workspace" ? runtime.rollouts.workspace : runtime.rollouts.global;
    return rollouts
      .filter((rollout) => rollout.alias === alias)
      .slice(0, 6);
  }, [alias, runtime.rollouts.global, runtime.rollouts.workspace, scope]);

  useEffect(() => {
    let cancelled = false;
    const nextDrafts =
      aliasBindings.length > 0
        ? aliasBindings.map(toRuntimeBindingDraft)
        : [createEmptyRuntimeBindingDraft("openai", modelIdsByProvider.get("openai")?.[0] ?? "")];
    queueMicrotask(() => {
      if (!cancelled) {
        setDrafts(nextDrafts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [alias, aliasBindings, modelIdsByProvider, scope]);

  const updateDraft = useCallback((index: number, patch: Partial<RuntimeBindingDraft>) => {
    setDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)),
    );
  }, []);

  const addDraft = useCallback(() => {
    const provider: ProviderName = "openai";
    const modelId = modelIdsByProvider.get(provider)?.[0] ?? "";
    setDrafts((current) => [
      ...current,
      createEmptyRuntimeBindingDraft(provider, modelId),
    ]);
  }, [modelIdsByProvider]);

  const removeDraft = useCallback((index: number) => {
    setDrafts((current) => (current.length > 1 ? current.filter((_, draftIndex) => draftIndex !== index) : current));
  }, []);

  const submit = useCallback(async () => {
    const normalized = drafts
      .map((draft, index) => ({
        provider: draft.provider,
        model_id: draft.modelId.trim(),
        weight: draft.weight,
        fallback_rank: index + 1,
        canary_percent: draft.canaryPercent,
        is_active: draft.isActive,
        requires_structured_output: draft.requiresStructuredOutput,
        requires_tool_use: draft.requiresToolUse,
        requires_long_context: draft.requiresLongContext,
        max_cost_class: draft.maxCostClass,
      }))
      .filter((draft) => draft.model_id.length > 0);
    if (normalized.length === 0) {
      return;
    }
    await onSaveBindings({
      alias,
      scope,
      bindings: normalized,
    });
  }, [alias, drafts, onSaveBindings, scope]);

  return (
    <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
      <h2 className="mb-3 text-sm font-mono uppercase tracking-[0.25em] text-white/70">Model Control Plane</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/50">Registry</p>
          <p className="mt-2 text-2xl font-semibold text-white">{runtime.models.length}</p>
          <p className="mt-1 text-xs text-white/50">available model entries</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/50">Alias Bindings</p>
          <p className="mt-2 text-2xl font-semibold text-white">{runtime.aliases.workspace.length + runtime.aliases.global.length}</p>
          <p className="mt-1 text-xs text-white/50">workspace + global bindings</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/50">Provider Health</p>
          <div className="mt-3 space-y-2">
            {runtime.providerHealth.length === 0 ? (
              <p className="text-xs text-white/40">No provider health telemetry yet</p>
            ) : (
              runtime.providerHealth.map((row) => (
                <div key={row.provider} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-white/70">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-cyan-200">{row.provider}</span>
                    <span className={row.available ? "text-emerald-200" : "text-amber-200"}>
                      {row.available ? "available" : "degraded"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/45">
                    failures {row.failureCount} · cooldown {formatDateTime(row.cooldownUntil)} · {row.reasonCode ?? "ok"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/50">Alias Rollouts</p>
          <div className="mt-3 space-y-2">
            {runtime.rollouts.workspace.concat(runtime.rollouts.global).slice(0, 8).map((rollout) => (
              <div key={rollout.id} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-white/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-cyan-200">{rollout.alias}</span>
                  <span className="text-white/40">{formatDateTime(rollout.createdAt)}</span>
                </div>
                <p className="mt-1 text-[11px] text-white/45">
                  {rollout.workspaceId ? "workspace" : "global"} · bindings {rollout.bindingIds.length} · {rollout.note ?? "no note"}
                </p>
              </div>
            ))}
            {runtime.rollouts.workspace.length + runtime.rollouts.global.length === 0 ? (
              <p className="text-xs text-white/40">No rollout history yet</p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-[11px] text-white/55">
            <span className="font-mono uppercase tracking-[0.18em]">Alias</span>
            <select
              value={alias}
              onChange={(event) => setAlias(event.target.value as IntelligenceCapabilityAlias)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
            >
              {RUNTIME_ALIAS_OPTIONS.map((value) => (
                <option key={value} value={value} className="bg-slate-900">{value}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[11px] text-white/55">
            <span className="font-mono uppercase tracking-[0.18em]">Scope</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as RuntimeBindingScope)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
            >
              <option value="workspace" className="bg-slate-900">workspace</option>
              <option value="global" className="bg-slate-900">global</option>
            </select>
          </label>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">
            <p className="font-mono uppercase tracking-[0.18em] text-white/40">Diff Preview</p>
            <p className="mt-2">workspace {workspaceId ?? "—"}</p>
            <p className="mt-1">baseline {aliasBindings.length} · draft {drafts.length} · {dirty ? "changed" : "clean"}</p>
            <p className="mt-1 text-[11px] text-white/45">
              +{changeSummary.added} / -{changeSummary.removed} / ~{changeSummary.changed} / ={changeSummary.unchanged}
            </p>
          </div>
        </div>
        {changeSummary.rows.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Pending Changes</p>
            <div className="mt-2 space-y-2">
              {changeSummary.rows.slice(0, 6).map((row) => (
                <div key={`${row.kind}-${row.index}-${row.title}`} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-white/70">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-cyan-200">{row.title}</span>
                    <span
                      className={
                        row.kind === "added"
                          ? "text-emerald-200"
                          : row.kind === "removed"
                            ? "text-rose-200"
                            : "text-amber-200"
                      }
                    >
                      {row.kind}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/45">{row.details.join(" · ")}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Selected Alias Rollouts</p>
          <div className="mt-2 space-y-2">
            {selectedRollouts.length === 0 ? (
              <p className="text-xs text-white/40">No rollout history for this alias/scope yet</p>
            ) : (
              selectedRollouts.map((rollout) => (
                <div key={rollout.id} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-white/70">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-cyan-200">{rollout.alias}</span>
                    <span className="text-white/40">{formatDateTime(rollout.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/45">
                    {scope} · bindings {rollout.bindingIds.length} · {rollout.note ?? "no note"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {drafts.map((draft, index) => {
            const availableModelIds = modelIdsByProvider.get(draft.provider) ?? [];
            return (
              <div key={draft.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="grid gap-3 lg:grid-cols-4">
                  <label className="space-y-1 text-[11px] text-white/55">
                    <span className="font-mono uppercase tracking-[0.18em]">Provider</span>
                    <select
                      value={draft.provider}
                      onChange={(event) => {
                        const nextProvider = event.target.value as ProviderName;
                        const nextModel = modelIdsByProvider.get(nextProvider)?.[0] ?? draft.modelId;
                        updateDraft(index, { provider: nextProvider, modelId: nextModel });
                      }}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    >
                      {PROVIDER_OPTIONS.map((provider) => (
                        <option key={provider} value={provider} className="bg-slate-900">{provider}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-[11px] text-white/55">
                    <span className="font-mono uppercase tracking-[0.18em]">Model</span>
                    <select
                      value={draft.modelId}
                      onChange={(event) => updateDraft(index, { modelId: event.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    >
                      {availableModelIds.length === 0 ? (
                        <option value="" className="bg-slate-900">no models</option>
                      ) : null}
                      {availableModelIds.map((modelId) => (
                        <option key={modelId} value={modelId} className="bg-slate-900">{modelId}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-[11px] text-white/55">
                    <span className="font-mono uppercase tracking-[0.18em]">Weight</span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.05}
                      value={draft.weight}
                      onChange={(event) => updateDraft(index, { weight: Number(event.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-white/55">
                    <span className="font-mono uppercase tracking-[0.18em]">Canary %</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.canaryPercent}
                      onChange={(event) => updateDraft(index, { canaryPercent: Number(event.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    />
                  </label>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-4">
                  <label className="space-y-1 text-[11px] text-white/55">
                    <span className="font-mono uppercase tracking-[0.18em]">Fallback Rank</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      step={1}
                      value={draft.fallbackRank}
                      onChange={(event) => updateDraft(index, { fallbackRank: Number(event.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-white/55">
                    <span className="font-mono uppercase tracking-[0.18em]">Max Cost</span>
                    <select
                      value={draft.maxCostClass ?? "none"}
                      onChange={(event) =>
                        updateDraft(index, {
                          maxCostClass: event.target.value === "none" ? null : event.target.value as RuntimeBindingDraft["maxCostClass"],
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="none" className="bg-slate-900">none</option>
                      <option value="free" className="bg-slate-900">free</option>
                      <option value="low" className="bg-slate-900">low</option>
                      <option value="standard" className="bg-slate-900">standard</option>
                      <option value="premium" className="bg-slate-900">premium</option>
                    </select>
                  </label>
                  <div className="col-span-2 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-white/65">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={draft.isActive} onChange={(event) => updateDraft(index, { isActive: event.target.checked })} />
                      active
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={draft.requiresStructuredOutput} onChange={(event) => updateDraft(index, { requiresStructuredOutput: event.target.checked })} />
                      structured
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={draft.requiresToolUse} onChange={(event) => updateDraft(index, { requiresToolUse: event.target.checked })} />
                      tool use
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={draft.requiresLongContext} onChange={(event) => updateDraft(index, { requiresLongContext: event.target.checked })} />
                      long context
                    </label>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeDraft(index)}
                    disabled={drafts.length <= 1}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-white/45">
            수정은 additive rollout로 저장된다. global 편집도 backend 권한 검사를 그대로 탄다.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addDraft}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/70"
            >
              add binding
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!workspaceId || !dirty || busyKey === effectiveBusyKey}
              className="rounded-lg border border-cyan-300/40 bg-cyan-400/10 px-3 py-1.5 text-[11px] text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyKey === effectiveBusyKey ? "saving..." : "save bindings"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function NarrativeClusterInboxPanel({
  clusters,
  selectedClusterId,
  selectedClusterDetail,
  selectedClusterTimeline,
  selectedClusterTrendSummary,
  selectedClusterGraph,
  notes,
  recentEvents,
  busyKey,
  stateFilter,
  reviewFilter,
  hotspotOnly,
  blockedOnly,
  onStateFilterChange,
  onReviewFilterChange,
  onHotspotOnlyChange,
  onBlockedOnlyChange,
  onSelectCluster,
  onSelectEvent,
  onReviewStateChange,
  onNoteClick,
}: {
  clusters: IntelligenceNarrativeClusterRecord[];
  selectedClusterId: string | null;
  selectedClusterDetail: SelectedNarrativeClusterDetail | null;
  selectedClusterTimeline: IntelligenceNarrativeClusterTimelineRecord[];
  selectedClusterTrendSummary: IntelligenceNarrativeClusterTrendSummary | null;
  selectedClusterGraph: SelectedNarrativeClusterGraph | null;
  notes: OperatorNoteRecord[];
  recentEvents: IntelligenceEventClusterRecord[];
  busyKey: string | null;
  stateFilter: "all" | "forming" | "recurring" | "diverging";
  reviewFilter: "all" | EventReviewState;
  hotspotOnly: boolean;
  blockedOnly: boolean;
  onStateFilterChange: (value: "all" | "forming" | "recurring" | "diverging") => void;
  onReviewFilterChange: (value: "all" | EventReviewState) => void;
  onHotspotOnlyChange: (value: boolean) => void;
  onBlockedOnlyChange: (value: boolean) => void;
  onSelectCluster: (clusterId: string) => void;
  onSelectEvent: (eventId: string) => void;
  onReviewStateChange: (clusterId: string, state: EventReviewState) => void;
  onNoteClick: (clusterId: string, eventId: string | null) => void;
}) {
  const activeCluster = selectedClusterDetail?.narrativeCluster ?? null;
  const latestClusterLedgerEntry = selectedClusterDetail?.ledgerEntries?.[0] ?? null;
  return (
    <section className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-mono uppercase tracking-[0.25em] text-white/70">Narrative Cluster Inbox</h2>
        <span className="text-xs text-white/45">{clusters.length} clusters</span>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-[11px] text-white/55">
          <span className="font-mono uppercase tracking-[0.18em]">State</span>
          <select
            value={stateFilter}
            onChange={(event) => onStateFilterChange(event.target.value as "all" | "forming" | "recurring" | "diverging")}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
          >
            {["all", "forming", "recurring", "diverging"].map((value) => (
              <option key={value} value={value} className="bg-slate-900">{value}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-white/55">
          <span className="font-mono uppercase tracking-[0.18em]">Review</span>
          <select
            value={reviewFilter}
            onChange={(event) => onReviewFilterChange(event.target.value as "all" | EventReviewState)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
          >
            {["all", "watch", "review", "ignore"].map((value) => (
              <option key={value} value={value} className="bg-slate-900">{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-white/60">
        <button
          type="button"
          onClick={() => onHotspotOnlyChange(!hotspotOnly)}
          className={`rounded-full border px-3 py-1 ${hotspotOnly ? "border-rose-300/40 bg-rose-500/10 text-rose-100" : "border-white/10 bg-white/[0.04] text-white/60"}`}
        >
          hotspot only
        </button>
        <button
          type="button"
          onClick={() => onBlockedOnlyChange(!blockedOnly)}
          className={`rounded-full border px-3 py-1 ${blockedOnly ? "border-amber-300/40 bg-amber-500/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-white/60"}`}
        >
          blocked only
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="space-y-2">
          {clusters.length === 0 ? (
            <p className="text-xs text-white/40">No narrative clusters</p>
          ) : (
            clusters.map((cluster) => {
              const active = cluster.id === selectedClusterId;
              return (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() => onSelectCluster(cluster.id)}
                  className={`w-full rounded-2xl border p-3 text-left ${active ? "border-violet-300/50 bg-violet-500/10" : "border-white/10 bg-white/[0.03]"}`}
                >
                  <p className="text-sm text-white">{cluster.title}</p>
                  <p className="mt-1 text-[11px] text-white/45">
                    priority {cluster.clusterPriorityScore} · {cluster.state} · review {cluster.reviewState}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    drift {cluster.driftScore.toFixed(2)} · contradiction {cluster.contradictionScore.toFixed(2)} · hotspot {cluster.hotspotEventCount} · blocked {cluster.recentExecutionBlockedCount}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    recur trend {cluster.recurringStrengthTrend.toFixed(2)} · div trend {cluster.divergenceTrend.toFixed(2)} · decay {cluster.supportDecayScore.toFixed(2)} · accel {cluster.contradictionAcceleration.toFixed(2)}
                  </p>
                  <p className="mt-1 text-[11px] text-white/30">
                    last transition {formatDateTime(cluster.lastLedgerAt)}
                  </p>
                </button>
              );
            })
          )}
        </div>
        <div className="space-y-3">
          {!activeCluster ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-white/45">
              cluster를 선택하면 timeline, ledger, recent event, graph hotspot을 볼 수 있다.
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{activeCluster.title}</p>
                    <p className="mt-1 text-[11px] text-white/45">
                      priority {activeCluster.clusterPriorityScore} · {activeCluster.state} · review {activeCluster.reviewState}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      drift {activeCluster.driftScore.toFixed(2)} · support {activeCluster.supportScore.toFixed(2)} · contradiction {activeCluster.contradictionScore.toFixed(2)} · time {activeCluster.timeCoherenceScore.toFixed(2)}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      events {activeCluster.eventCount} · recurring {activeCluster.recurringEventCount} · diverging {activeCluster.divergingEventCount} · blocked {activeCluster.recentExecutionBlockedCount}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      recur trend {activeCluster.recurringStrengthTrend.toFixed(2)} · div trend {activeCluster.divergenceTrend.toFixed(2)} · support decay {activeCluster.supportDecayScore.toFixed(2)} · contradiction accel {activeCluster.contradictionAcceleration.toFixed(2)}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      last recurring {formatDateTime(activeCluster.lastRecurringAt)} · last diverging {formatDateTime(activeCluster.lastDivergingAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {(["watch", "review", "ignore"] as EventReviewState[]).map((state) => (
                      <button
                        key={`${activeCluster.id}-${state}`}
                        type="button"
                        onClick={() => onReviewStateChange(activeCluster.id, state)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] ${
                          activeCluster.reviewState === state
                            ? "border-cyan-300/60 bg-cyan-400/10 text-cyan-100"
                            : "border-white/10 bg-white/[0.04] text-white/65"
                        }`}
                      >
                        {busyKey === `narrative-cluster-review:${activeCluster.id}:${state}` ? "..." : state}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onNoteClick(activeCluster.id, recentEvents[0]?.id ?? null)}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70"
                    >
                      {busyKey === `operator-note:create:narrative_cluster:${activeCluster.id}` ? "..." : "note"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <DetailBlock
                  title="Cluster Timeline"
                  items={selectedClusterTimeline.map((entry) => `${formatDateTime(entry.bucketStart)} · events ${entry.eventCount} · recurring ${entry.recurringScore.toFixed(2)} · drift ${entry.driftScore.toFixed(2)} · contradiction ${entry.contradictionScore.toFixed(2)} · hotspot ${entry.hotspotEventCount}`)}
                />
                <DetailBlock
                  title="Cluster Ledger"
                  items={(selectedClusterDetail?.ledgerEntries ?? []).map((entry) => `${entry.entryType} · ${entry.summary} · Δ ${entry.scoreDelta.toFixed(2)} · ${formatDateTime(entry.createdAt)}`)}
                />
              </div>
              {selectedClusterTrendSummary ? (
                <DetailBlock
                  title="Trend Summary"
                  items={[
                    `recurring trend ${selectedClusterTrendSummary.recurring_strength_trend.toFixed(2)} · divergence trend ${selectedClusterTrendSummary.divergence_trend.toFixed(2)}`,
                    `support decay ${selectedClusterTrendSummary.support_decay_score.toFixed(2)} · contradiction acceleration ${selectedClusterTrendSummary.contradiction_acceleration.toFixed(2)}`,
                    `last recurring ${formatDateTime(selectedClusterTrendSummary.last_recurring_at)} · last diverging ${formatDateTime(selectedClusterTrendSummary.last_diverging_at)}`,
                  ]}
                />
              ) : null}
              {latestClusterLedgerEntry ? (
                <DetailBlock
                  title="Current Transition"
                  items={[
                    `${latestClusterLedgerEntry.entryType} · ${latestClusterLedgerEntry.summary}`,
                    `delta ${latestClusterLedgerEntry.scoreDelta.toFixed(2)} · events ${latestClusterLedgerEntry.sourceEventIds.length} · ${formatDateTime(latestClusterLedgerEntry.createdAt)}`,
                  ]}
                />
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <DetailBlock
                  title="Recent Events"
                  items={recentEvents.map((event) => `${event.title} · ${event.temporalNarrativeState ?? "new"} · graph +${event.graphSupportScore.toFixed(2)} / -${event.graphContradictionScore.toFixed(2)} / hot ${event.graphHotspotCount}`)}
                />
                <DetailBlock
                  title="Cluster Graph"
                  items={
                    selectedClusterGraph
                      ? [
                          `linked claims ${selectedClusterGraph.summary.linkedClaimCount} · edges ${selectedClusterGraph.summary.edgeCount}`,
                          `support ${selectedClusterGraph.summary.graphSupportScore.toFixed(2)} · contradiction ${selectedClusterGraph.summary.graphContradictionScore.toFixed(2)} · hotspots ${selectedClusterGraph.summary.graphHotspotCount}`,
                          ...selectedClusterGraph.hotspotClusters.slice(0, 4).map((cluster) => `${cluster.label} · hotspot ${cluster.hotspotScore.toFixed(2)} · members ${cluster.memberLinkedClaimIds.length}`),
                        ]
                      : []
                  }
                />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">Cluster Memberships</h3>
                  <span className="text-[11px] text-white/45">{selectedClusterDetail?.memberships.length ?? 0}</span>
                </div>
                <div className="space-y-2">
                  {(selectedClusterDetail?.memberships ?? []).map((member) => (
                    <button
                      key={member.membershipId}
                      type="button"
                      onClick={() => onSelectEvent(member.eventId)}
                      className="w-full rounded-xl border border-white/8 bg-black/25 px-3 py-3 text-left text-xs text-white/70"
                    >
                      <p className="text-white/85">{member.title}</p>
                      <p className="mt-1 text-[11px] text-white/45">
                        {member.relation} · score {member.score.toFixed(2)} · days Δ {member.daysDelta ?? "—"} · time {member.timeCoherenceScore.toFixed(2)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
              {notes.length > 0 ? (
                <DetailBlock
                  title="Cluster Notes"
                  items={notes.map((note) => `${formatDateTime(note.createdAt)} · ${note.note}`)}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function TemporalNarrativeLedgerPanel({
  items,
  onSelectEvent,
}: {
  items: IntelligenceTemporalNarrativeLedgerEntryRecord[];
  onSelectEvent: (eventId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-mono uppercase tracking-[0.2em] text-white/70">Temporal Narrative Ledger</h3>
        <span className="text-[11px] text-white/45">{items.length} entries</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-white/45">장기 반복 서사 원장 항목이 아직 없다.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectEvent(item.relatedEventId)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-left hover:border-white/20"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-white/50">
                <span>{item.relation}</span>
                <span>score {item.score.toFixed(2)}</span>
                <span>days Δ {item.daysDelta ?? "—"}</span>
                <span>domain {item.topDomainId ?? "unknown"}</span>
                <span>updated {formatDateTime(item.updatedAt)}</span>
              </div>
              <p className="mt-2 text-sm font-medium text-white">{item.relatedEventTitle}</p>
              <p className="mt-2 text-[11px] text-white/45">
                graph +{item.graphSupportScore.toFixed(2)} / -{item.graphContradictionScore.toFixed(2)} / hot {item.graphHotspotCount} · time {item.timeCoherenceScore.toFixed(2)}
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ClaimGraphPanel({
  graph,
  onNoteClick,
  onReviewStateChange,
  busyKey,
}: {
  graph: SelectedEventGraph | null;
  onNoteClick: (linkedClaimId: string) => void;
  onReviewStateChange: (linkedClaimId: string, state: EventReviewState) => void;
  busyKey: string | null;
}) {
  const layout = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return null;
    const centerId =
      graph.neighborhoods[0]?.centerLinkedClaimId ??
      graph.hotspots[0] ??
      graph.nodes[0]?.id ??
      null;
    if (!centerId) return null;
    const neighborhood =
      graph.neighborhoods.find((row) => row.centerLinkedClaimId === centerId) ??
      graph.neighborhoods[0] ??
      {
        centerLinkedClaimId: centerId,
        directNeighborIds: [],
        twoHopNeighborIds: [],
      };
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
    const center = nodeById.get(centerId) ?? graph.nodes[0] ?? null;
    if (!center) return null;
    const directNodes = neighborhood.directNeighborIds
      .map((id) => nodeById.get(id))
      .filter((node): node is LinkedClaimRecord => Boolean(node));
    const twoHopNodes = neighborhood.twoHopNeighborIds
      .map((id) => nodeById.get(id))
      .filter((node): node is LinkedClaimRecord => Boolean(node));
    const pinnedIds = new Set([center.id, ...directNodes.map((node) => node.id), ...twoHopNodes.map((node) => node.id)]);
    const extraNodes = graph.nodes.filter((node) => !pinnedIds.has(node.id));

    const positionRing = (
      nodes: LinkedClaimRecord[],
      radius: number,
      angleOffset: number,
      ring: "center" | "direct" | "twoHop" | "extra",
    ) =>
      nodes.map((node, index) => {
        const angle = angleOffset + (Math.PI * 2 * index) / Math.max(1, nodes.length);
        return {
          node,
          ring,
          x: 360 + Math.cos(angle) * radius,
          y: 220 + Math.sin(angle) * radius,
        };
      });

    return {
      centerId,
      positions: [
        {
          node: center,
          ring: "center" as const,
          x: 360,
          y: 220,
        },
        ...positionRing(directNodes, 120, -Math.PI / 2, "direct"),
        ...positionRing(twoHopNodes, 220, -Math.PI / 3, "twoHop"),
        ...positionRing(extraNodes, 300, -Math.PI / 4, "extra"),
      ],
    };
  }, [graph]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const positionById = useMemo(
    () => new Map((layout?.positions ?? []).map((entry) => [entry.node.id, entry] as const)),
    [layout],
  );
  const effectiveSelectedNodeId =
    selectedNodeId && positionById.has(selectedNodeId)
      ? selectedNodeId
      : layout?.centerId ?? null;
  const selectedNode = useMemo(
    () =>
      effectiveSelectedNodeId && graph
        ? graph.nodes.find((node) => node.id === effectiveSelectedNodeId) ?? null
        : null,
    [effectiveSelectedNodeId, graph],
  );

  if (!graph || !layout) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-white/60">Claim Graph</h3>
        <p className="text-xs text-white/40">그래프 데이터가 아직 없다.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">Claim Graph</h3>
          <p className="mt-1 text-[11px] text-white/40">
            support {graph.summary.graphSupportScore.toFixed(2)} · contradiction {graph.summary.graphContradictionScore.toFixed(2)} · hotspots {graph.summary.graphHotspotCount}
          </p>
          <p className="mt-1 text-[11px] text-white/35">
            temporal {graph.summary.temporalNarrativeState ?? "new"} · recurring {(graph.summary.recurringNarrativeScore ?? 0).toFixed(2)} · related {graph.summary.relatedHistoricalEventCount ?? 0} · clusters {graph.summary.hotspotClusterCount ?? graph.hotspotClusters.length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] text-white/45">
          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-100/80">support</span>
          <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-2 py-0.5 text-rose-100/80">contradict</span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-white/60">related</span>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.55fr_0.95fr]">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <svg viewBox="0 0 720 440" className="h-[440px] w-full">
            <defs>
              <filter id="claimHotspotGlow">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {graph.edges.map((edge) => {
              const left = positionById.get(edge.leftLinkedClaimId);
              const right = positionById.get(edge.rightLinkedClaimId);
              if (!left || !right) return null;
              const stroke =
                edge.relation === "supports"
                  ? "rgba(52, 211, 153, 0.68)"
                  : edge.relation === "contradicts"
                    ? "rgba(251, 113, 133, 0.72)"
                    : "rgba(148, 163, 184, 0.45)";
              return (
                <line
                  key={edge.id}
                  x1={left.x}
                  y1={left.y}
                  x2={right.x}
                  y2={right.y}
                  stroke={stroke}
                  strokeWidth={1 + edge.edgeStrength * 3}
                  strokeDasharray={edge.relation === "related" ? "4 5" : undefined}
                  opacity={0.9}
                />
              );
            })}
            {layout.positions.map(({ node, x, y, ring }) => {
              const hotspot = graph.hotspots.includes(node.id) || node.contradictionCount > 0;
              const selected = node.id === effectiveSelectedNodeId;
              const fill =
                hotspot
                  ? "rgba(251, 113, 133, 0.92)"
                  : ring === "center"
                    ? "rgba(34, 211, 238, 0.92)"
                    : "rgba(99, 102, 241, 0.85)";
              const radius = ring === "center" ? 18 : ring === "direct" ? 15 : 12;
              return (
                <g
                  key={node.id}
                  transform={`translate(${x}, ${y})`}
                  onClick={() => setSelectedNodeId(node.id)}
                  className="cursor-pointer"
                >
                  {hotspot ? <circle r={radius + 6} fill="rgba(251, 113, 133, 0.18)" filter="url(#claimHotspotGlow)" /> : null}
                  {selected ? <circle r={radius + 5} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.5" /> : null}
                  <circle r={radius} fill={fill} stroke="rgba(255,255,255,0.12)" strokeWidth="1.25" />
                  <text
                    y={radius + 18}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.72)"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {node.predicateFamily}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          {selectedNode ? (
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Selected Claim</p>
                <p className="mt-2 text-sm text-white/90">
                  {selectedNode.canonicalSubject} {selectedNode.canonicalPredicate} {selectedNode.canonicalObject}
                </p>
                <p className="mt-2 text-[11px] text-white/45">
                  family {selectedNode.predicateFamily} · non-social {selectedNode.nonSocialSourceCount} · contradictions {selectedNode.contradictionCount}
                </p>
                <p className="mt-1 text-[11px] text-white/35">
                  bucket {formatDateTime(selectedNode.timeBucketStart)} ~ {formatDateTime(selectedNode.timeBucketEnd)}
                </p>
                <p className="mt-1 text-[11px] text-white/35">
                  support {formatDateTime(selectedNode.lastSupportedAt)} · contradict {formatDateTime(selectedNode.lastContradictedAt)}
                </p>
                {selectedNode.reviewReason || selectedNode.reviewOwner || selectedNode.reviewResolvedAt ? (
                  <p className="mt-1 text-[11px] text-white/35">
                    reason {selectedNode.reviewReason ?? "—"} · owner {selectedNode.reviewOwner ?? "—"} · resolved {formatDateTime(selectedNode.reviewResolvedAt)}
                  </p>
                ) : null}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Connected Edges</p>
                <div className="mt-2 space-y-2">
                  {graph.edges
                    .filter((edge) => edge.leftLinkedClaimId === selectedNode.id || edge.rightLinkedClaimId === selectedNode.id)
                    .slice(0, 8)
                    .map((edge) => {
                      const neighborId =
                        edge.leftLinkedClaimId === selectedNode.id ? edge.rightLinkedClaimId : edge.leftLinkedClaimId;
                      return (
                        <div key={edge.id} className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[11px] text-white/65">
                          {edge.relation} · strength {edge.edgeStrength.toFixed(2)} · neighbor {neighborId.slice(0, 8)} · signals {edge.evidence_signal_count}
                        </div>
                      );
                    })}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["watch", "review", "ignore"] as EventReviewState[]).map((state) => (
                  <button
                    key={`${selectedNode.id}-${state}`}
                    type="button"
                    onClick={() => onReviewStateChange(selectedNode.id, state)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      selectedNode.reviewState === state
                        ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-black/20 text-white/55"
                    }`}
                  >
                    {busyKey === `linked-claim-review:${selectedNode.id}:${state}` ? "..." : state}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onNoteClick(selectedNode.id)}
                  className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100"
                >
                  {busyKey === `operator-note:create:linked_claim:${selectedNode.id}` ? "..." : "메모"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-white/40">노드를 선택하면 claim detail을 본다.</p>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h4 className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Hotspot Clusters</h4>
          <div className="mt-3 space-y-2">
            {graph.hotspotClusters.length === 0 ? (
              <p className="text-xs text-white/40">No contradiction hotspots</p>
            ) : (
              graph.hotspotClusters.map((cluster) => (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() => setSelectedNodeId(cluster.centerLinkedClaimId)}
                  className="w-full rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-left text-xs text-white/70 hover:border-white/15"
                >
                  <p className="text-white/85">{cluster.label}</p>
                  <p className="mt-1 text-[11px] text-white/45">
                    hotspot {cluster.hotspotScore.toFixed(2)} · members {cluster.memberLinkedClaimIds.length}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    contradict edges {cluster.contradictionEdgeCount} · support edges {cluster.supportEdgeCount}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h4 className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Related Narratives</h4>
          <div className="mt-3 space-y-2">
            {graph.relatedHistoricalEvents.length === 0 ? (
              <p className="text-xs text-white/40">No related historical events</p>
            ) : (
              graph.relatedHistoricalEvents.map((item) => (
                <div key={item.eventId} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-white/70">
                  <p className="text-white/85">{item.title}</p>
                  <p className="mt-1 text-[11px] text-white/45">
                    {item.relation} · score {item.score.toFixed(2)} · {item.daysDelta ?? "—"}d ago
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    graph +{item.graphSupportScore.toFixed(2)} / -{item.graphContradictionScore.toFixed(2)} / hot {item.graphHotspotCount} · time {item.timeCoherenceScore.toFixed(2)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
