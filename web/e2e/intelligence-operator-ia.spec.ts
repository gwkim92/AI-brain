import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";
const NOW = "2026-03-13T08:30:00.000Z";

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-intelligence-e2e",
    data,
    meta,
  };
}

const workspace = {
  id: "ws-1",
  ownerUserId: "user-1",
  name: "Macro Ops",
  slug: "macro-ops",
  createdAt: NOW,
  updatedAt: NOW,
};

const cluster = {
  id: "cluster-1",
  workspaceId: "ws-1",
  clusterKey: "supply-chain-reroute",
  title: "Supply Chain Reroute Signals",
  eventFamily: "supply_chain",
  topDomainId: "macro",
  anchorEntities: ["Port of LA", "Shenzhen"],
  state: "diverging",
  eventCount: 3,
  recurringEventCount: 1,
  divergingEventCount: 2,
  supportiveHistoryCount: 1,
  hotspotEventCount: 1,
  latestRecurringScore: 0.54,
  driftScore: 0.68,
  supportScore: 0.61,
  contradictionScore: 0.47,
  timeCoherenceScore: 0.64,
  recurringStrengthTrend: 0.12,
  divergenceTrend: 0.31,
  supportDecayScore: 0.2,
  contradictionAcceleration: 0.29,
  clusterPriorityScore: 92,
  recentExecutionBlockedCount: 1,
  reviewState: "review",
  reviewReason: "Contradictions outpacing support",
  reviewOwner: "operator-1",
  reviewUpdatedAt: NOW,
  reviewUpdatedBy: "operator-1",
  reviewResolvedAt: null,
  lastLedgerAt: NOW,
  lastTransition: {
    entry_type: "diverging_strengthened",
    summary: "Contradictions are outpacing support across port and freight signals.",
    score_delta: 0.31,
    created_at: NOW,
  },
  lastEventAt: NOW,
  lastRecurringAt: "2026-03-06T08:30:00.000Z",
  lastDivergingAt: NOW,
  quality: {
    state: "healthy",
    score: 0.18,
    reasons: [],
  },
  createdAt: NOW,
  updatedAt: NOW,
};

const duplicateTitleCluster = {
  ...cluster,
  id: "cluster-2",
  clusterKey: "supply-chain-reroute-shadow",
  state: "recurring",
  divergingEventCount: 0,
  recentExecutionBlockedCount: 0,
  clusterPriorityScore: 70,
  reviewState: "watch",
  quality: {
    state: "suspect",
    score: 0.78,
    reasons: ["duplicate_title_collision"],
  },
  updatedAt: "2026-03-12T08:30:00.000Z",
};

const lowSignalCluster = {
  ...cluster,
  id: "cluster-3",
  clusterKey: "quiet-watchlist",
  title: "Quiet Watchlist Narrative",
  state: "recurring",
  divergingEventCount: 0,
  recentExecutionBlockedCount: 0,
  clusterPriorityScore: 2,
  contradictionScore: 0.1,
  reviewState: "watch",
  quality: {
    state: "healthy",
    score: 0.12,
    reasons: [],
  },
  updatedAt: "2026-03-11T08:30:00.000Z",
};

const event = {
  id: "event-1",
  workspaceId: "ws-1",
  title: "Port congestion signals conflict with carrier capacity narrative",
  summary: "Freight, port, and shipping signals suggest a repeating supply chain reroute, but contradiction is accelerating faster than support.",
  eventFamily: "supply_chain",
  signalIds: ["sig-1", "sig-2", "sig-3"],
  documentIds: ["doc-1", "doc-2"],
  entities: ["Port of LA", "Carrier Capacity"],
  linkedClaimCount: 3,
  contradictionCount: 2,
  nonSocialCorroborationCount: 1,
  linkedClaimHealthScore: 0.44,
  timeCoherenceScore: 0.58,
  graphSupportScore: 0.45,
  graphContradictionScore: 0.52,
  graphHotspotCount: 1,
  semanticClaims: [],
  metricShocks: [],
  sourceMix: {},
  corroborationScore: 0.42,
  noveltyScore: 0.66,
  structuralityScore: 0.77,
  actionabilityScore: 0.71,
  riskBand: "high",
  topDomainId: "macro",
  timeWindowStart: "2026-03-01T00:00:00.000Z",
  timeWindowEnd: NOW,
  domainPosteriors: [],
  worldStates: [],
  primaryHypotheses: [
    {
      id: "hyp-1",
      title: "A regional supply reroute is underway",
      summary: "Carriers are shifting routes and creating temporary congestion in west coast nodes.",
      confidence: 0.67,
      rationale: "Carrier, freight, and customs signals align around a reroute pattern.",
    },
  ],
  counterHypotheses: [
    {
      id: "hyp-2",
      title: "The congestion is transient noise",
      summary: "Current anomalies are temporary and do not imply a structural reroute.",
      confidence: 0.51,
      rationale: "Capacity indicators remain inconsistent across major ports.",
    },
  ],
  invalidationConditions: [
    {
      id: "inv-1",
      title: "Capacity normalizes across ports",
      description: "If throughput and vessel wait times normalize, the reroute hypothesis weakens.",
      matcherJson: {},
      status: "pending",
    },
  ],
  expectedSignals: [
    {
      id: "exp-1",
      signalKey: "carrier-guidance",
      description: "Carrier guidance should explicitly mention route rebalancing.",
      dueAt: NOW,
      status: "absent",
    },
  ],
  deliberationStatus: "completed",
  reviewState: "review",
  reviewReason: "Operator review required before execution.",
  reviewOwner: "operator-1",
  reviewUpdatedAt: NOW,
  reviewUpdatedBy: "operator-1",
  reviewResolvedAt: null,
  deliberations: [
    {
      id: "delib-1",
      source: "local",
      status: "completed",
      proposedPrimary: "A regional supply reroute is underway",
      proposedCounter: "The congestion is transient noise",
      weakestLink: "Carrier guidance is still absent.",
      requiredNextSignals: ["carrier-guidance"],
      executionStance: "hold",
      rawJson: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  executionCandidates: [
    {
      id: "exec-1",
      title: "Escalate reroute watch to operator brief",
      summary: "Generate a brief and keep automated execution blocked until carrier guidance lands.",
      riskBand: "high",
      executionMode: "approval_required",
      payload: {
        mcp_tool_name: "brief.generate",
        connector_capability: {
          connector_id: "briefing-connector",
        },
      },
      policyJson: {},
      status: "blocked",
      resultJson: {
        blocked_reason: "Carrier guidance signal is still absent.",
      },
      createdAt: NOW,
      updatedAt: NOW,
      executedAt: null,
    },
    {
      id: "exec-2",
      title: "Broadcast reroute watch",
      summary: "Send a low-risk watch notification to downstream operators.",
      riskBand: "medium",
      executionMode: "proposal",
      payload: {
        mcp_tool_name: "notification_emit",
      },
      policyJson: {},
      status: "pending",
      resultJson: {},
      createdAt: NOW,
      updatedAt: NOW,
      executedAt: null,
    },
  ],
  outcomes: [
    {
      id: "outcome-1",
      status: "unresolved",
      summary: "Signal conflict remains unresolved.",
      createdAt: NOW,
    },
  ],
  operatorNoteCount: 1,
  operatorPriorityScore: 94,
  recurringNarrativeScore: 0.62,
  relatedHistoricalEventCount: 2,
  temporalNarrativeState: "diverging",
  narrativeClusterId: "cluster-1",
  narrativeClusterState: "diverging",
  quality: {
    state: "healthy",
    score: 0.22,
    reasons: [],
  },
  createdAt: NOW,
  updatedAt: NOW,
};

const linkedClaims = [
  {
    id: "claim-1",
    workspaceId: "ws-1",
    claimFingerprint: "claim-1",
    canonicalSubject: "Port of LA",
    canonicalPredicate: "shows",
    canonicalObject: "rising congestion",
    predicateFamily: "throughput",
    timeScope: null,
    timeBucketStart: NOW,
    timeBucketEnd: NOW,
    stanceDistribution: {
      supporting: 2,
      neutral: 0,
      contradicting: 0,
    },
    sourceCount: 3,
    contradictionCount: 0,
    nonSocialSourceCount: 2,
    supportingSignalIds: ["sig-1"],
    lastSupportedAt: NOW,
    lastContradictedAt: null,
    reviewState: "watch",
    reviewReason: null,
    reviewOwner: null,
    reviewUpdatedAt: NOW,
    reviewUpdatedBy: "operator-1",
    reviewResolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "claim-2",
    workspaceId: "ws-1",
    claimFingerprint: "claim-2",
    canonicalSubject: "Carrier guidance",
    canonicalPredicate: "does not mention",
    canonicalObject: "route rebalancing",
    predicateFamily: "guidance",
    timeScope: null,
    timeBucketStart: NOW,
    timeBucketEnd: NOW,
    stanceDistribution: {
      supporting: 0,
      neutral: 0,
      contradicting: 2,
    },
    sourceCount: 2,
    contradictionCount: 2,
    nonSocialSourceCount: 1,
    supportingSignalIds: ["sig-2"],
    lastSupportedAt: null,
    lastContradictedAt: NOW,
    reviewState: "review",
    reviewReason: "Missing confirmation",
    reviewOwner: "operator-1",
    reviewUpdatedAt: NOW,
    reviewUpdatedBy: "operator-1",
    reviewResolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "claim-3",
    workspaceId: "ws-1",
    claimFingerprint: "claim-3",
    canonicalSubject: "Freight pricing",
    canonicalPredicate: "signals",
    canonicalObject: "eastbound squeeze",
    predicateFamily: "pricing",
    timeScope: null,
    timeBucketStart: NOW,
    timeBucketEnd: NOW,
    stanceDistribution: {
      supporting: 1,
      neutral: 0,
      contradicting: 1,
    },
    sourceCount: 2,
    contradictionCount: 1,
    nonSocialSourceCount: 1,
    supportingSignalIds: ["sig-3"],
    lastSupportedAt: NOW,
    lastContradictedAt: NOW,
    reviewState: "watch",
    reviewReason: null,
    reviewOwner: null,
    reviewUpdatedAt: NOW,
    reviewUpdatedBy: "operator-1",
    reviewResolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const eventDetail = {
  workspace_id: "ws-1",
  event,
  linked_claims: linkedClaims,
  claim_links: [
    {
      id: "clink-1",
      workspaceId: "ws-1",
      eventId: "event-1",
      linkedClaimId: "claim-1",
      signalId: "sig-1",
      semanticClaimId: "semantic-1",
      relation: "supporting",
      confidence: 0.82,
      linkStrength: 0.74,
      createdAt: NOW,
    },
  ],
  review_state: "review",
  bridge_dispatches: [],
  execution_audit: [
    {
      id: "audit-1",
      workspaceId: "ws-1",
      eventId: "event-1",
      candidateId: "exec-1",
      connectorId: "briefing-connector",
      actionName: "brief.generate",
      status: "blocked",
      summary: "Execution was held pending carrier guidance.",
      resultJson: {},
      createdAt: NOW,
    },
  ],
  operator_notes: [
    {
      id: "note-1",
      workspaceId: "ws-1",
      eventId: "event-1",
      userId: "operator-1",
      scope: "event",
      scopeId: null,
      note: "Support is no longer keeping up with contradiction.",
      createdAt: NOW,
    },
  ],
  invalidation_entries: [
    {
      id: "inv-entry-1",
      workspaceId: "ws-1",
      eventId: "event-1",
      title: "Capacity normalizes across ports",
      description: "Would invalidate the reroute hypothesis.",
      matcherJson: {},
      status: "pending",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  expected_signal_entries: [
    {
      id: "expected-entry-1",
      workspaceId: "ws-1",
      eventId: "event-1",
      signalKey: "carrier-guidance",
      description: "Carrier guidance should confirm rebalancing.",
      dueAt: NOW,
      status: "absent",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  outcome_entries: [
    {
      id: "outcome-entry-1",
      workspaceId: "ws-1",
      eventId: "event-1",
      status: "unresolved",
      summary: "No outcome yet.",
      createdAt: NOW,
    },
  ],
  narrative_cluster: cluster,
  narrative_cluster_members: [],
  temporal_narrative_ledger: [
    {
      id: "ledger-1",
      workspaceId: "ws-1",
      eventId: "event-1",
      relatedEventId: "event-historical-1",
      relatedEventTitle: "Prior freight reroute signal cluster",
      relation: "diverging",
      score: 0.61,
      daysDelta: 8,
      topDomainId: "macro",
      graphSupportScore: 0.33,
      graphContradictionScore: 0.52,
      graphHotspotCount: 1,
      timeCoherenceScore: 0.57,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  related_historical_events: [
    {
      eventId: "event-historical-1",
      title: "Prior freight reroute signal cluster",
      relation: "diverging",
      score: 0.61,
      daysDelta: 8,
      topDomainId: "macro",
      graphSupportScore: 0.33,
      graphContradictionScore: 0.52,
      graphHotspotCount: 1,
      timeCoherenceScore: 0.57,
    },
  ],
};

const hypotheses = {
  workspace_id: "ws-1",
  event_id: "event-1",
  primary_hypotheses: event.primaryHypotheses,
  counter_hypotheses: event.counterHypotheses,
  invalidation_conditions: event.invalidationConditions,
  expected_signals: event.expectedSignals,
  world_states: [],
  deliberations: event.deliberations,
  outcomes: event.outcomes,
  ledger_entries: [
    {
      id: "ledger-primary-1",
      workspaceId: "ws-1",
      eventId: "event-1",
      hypothesisId: "hyp-1",
      kind: "primary",
      title: "A regional supply reroute is underway",
      summary: "Structural reroute remains the lead explanation.",
      confidence: 0.67,
      rationale: "Freight and congestion signals still align.",
      status: "active",
      reviewState: "review",
      reviewReason: "Needs operator confirmation",
      reviewOwner: "operator-1",
      reviewUpdatedAt: NOW,
      reviewUpdatedBy: "operator-1",
      reviewResolvedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  evidence_links: [
    {
      id: "evidence-1",
      workspaceId: "ws-1",
      eventId: "event-1",
      hypothesisId: "hyp-1",
      linkedClaimId: "claim-1",
      signalId: "sig-1",
      relation: "supports",
      evidenceStrength: 0.72,
      createdAt: NOW,
    },
  ],
  evidence_summary: [
    {
      hypothesis_id: "hyp-1",
      support_count: 2,
      contradict_count: 1,
      monitor_count: 1,
      support_strength: 0.74,
      contradict_strength: 0.48,
      monitor_strength: 0.2,
      linked_claim_ids: ["claim-1", "claim-3"],
      support_edge_count: 1,
      contradict_edge_count: 1,
      edge_linked_claim_ids: ["claim-2"],
      graph_support_strength: 0.71,
      graph_contradict_strength: 0.53,
    },
  ],
  invalidation_entries: eventDetail.invalidation_entries,
  expected_signal_entries: eventDetail.expected_signal_entries,
  outcome_entries: eventDetail.outcome_entries,
};

const eventGraph = {
  workspace_id: "ws-1",
  event_id: "event-1",
  summary: {
    eventId: "event-1",
    linkedClaimCount: 3,
    edgeCount: 2,
    graphSupportScore: 0.45,
    graphContradictionScore: 0.52,
    graphHotspotCount: 1,
    recurringNarrativeScore: 0.62,
    relatedHistoricalEventCount: 1,
    temporalNarrativeState: "diverging",
    hotspotClusterCount: 1,
  },
  nodes: linkedClaims,
  edges: [
    {
      id: "edge-1",
      workspaceId: "ws-1",
      leftLinkedClaimId: "claim-1",
      rightLinkedClaimId: "claim-2",
      relation: "contradicts",
      edgeStrength: 0.71,
      evidenceSignalIds: ["sig-1", "sig-2"],
      evidence_signal_count: 2,
      lastObservedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "edge-2",
      workspaceId: "ws-1",
      leftLinkedClaimId: "claim-1",
      rightLinkedClaimId: "claim-3",
      relation: "supports",
      edgeStrength: 0.64,
      evidenceSignalIds: ["sig-1", "sig-3"],
      evidence_signal_count: 2,
      lastObservedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  hotspots: ["claim-2"],
  neighborhoods: [
    {
      centerLinkedClaimId: "claim-2",
      directNeighborIds: ["claim-1", "claim-3"],
      twoHopNeighborIds: [],
    },
  ],
  hotspot_clusters: [
    {
      id: "hotspot-1",
      centerLinkedClaimId: "claim-2",
      label: "Carrier guidance contradiction",
      memberLinkedClaimIds: ["claim-2", "claim-3"],
      supportEdgeCount: 0,
      contradictionEdgeCount: 1,
      hotspotScore: 0.78,
    },
  ],
  related_historical_events: eventDetail.related_historical_events,
};

const clusterDetail = {
  workspace_id: "ws-1",
  narrative_cluster: cluster,
  memberships: [
    {
      membershipId: "membership-1",
      eventId: "event-1",
      title: event.title,
      relation: "diverging",
      score: 0.82,
      daysDelta: 0,
      isLatest: true,
      temporalNarrativeState: "diverging",
      graphSupportScore: event.graphSupportScore,
      graphContradictionScore: event.graphContradictionScore,
      graphHotspotCount: event.graphHotspotCount,
      timeCoherenceScore: event.timeCoherenceScore,
      lastEventAt: NOW,
    },
  ],
  recent_events: [event],
  ledger_entries: [
    {
      id: "cluster-ledger-1",
      workspaceId: "ws-1",
      clusterId: "cluster-1",
      entryType: "diverging_strengthened",
      summary: "Contradiction accelerated after freight and port signals split.",
      scoreDelta: 0.31,
      sourceEventIds: ["event-1"],
      createdAt: NOW,
    },
  ],
  operator_notes: [],
};

const clusterTimeline = {
  workspace_id: "ws-1",
  cluster_id: "cluster-1",
  trend_summary: {
    recurring_strength_trend: 0.12,
    divergence_trend: 0.31,
    support_decay_score: 0.2,
    contradiction_acceleration: 0.29,
    last_recurring_at: "2026-03-06T08:30:00.000Z",
    last_diverging_at: NOW,
  },
  timeline: [
    {
      id: "timeline-1",
      workspaceId: "ws-1",
      clusterId: "cluster-1",
      bucketStart: "2026-03-06T00:00:00.000Z",
      eventCount: 1,
      recurringScore: 0.52,
      driftScore: 0.68,
      supportScore: 0.61,
      contradictionScore: 0.47,
      timeCoherenceScore: 0.64,
      hotspotEventCount: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
};

const clusterGraph = {
  workspace_id: "ws-1",
  cluster_id: "cluster-1",
  summary: {
    clusterId: "cluster-1",
    eventCount: 1,
    linkedClaimCount: 3,
    edgeCount: 2,
    graphSupportScore: 0.45,
    graphContradictionScore: 0.52,
    graphHotspotCount: 1,
    hotspotClusterCount: 1,
  },
  nodes: linkedClaims,
  edges: eventGraph.edges,
  hotspots: ["claim-2"],
  neighborhoods: eventGraph.neighborhoods,
  hotspot_clusters: eventGraph.hotspot_clusters,
  recent_events: [event],
};

const source = {
  id: "source-1",
  workspaceId: "ws-1",
  name: "Freight Feed",
  kind: "api",
  url: "https://example.com/freight",
  sourceType: "market_data",
  sourceTier: "tier_1",
  pollMinutes: 15,
  enabled: true,
  parserConfigJson: {},
  crawlConfigJson: {},
  crawlPolicy: {
    allowDomains: ["example.com"],
    denyDomains: [],
    respectRobots: true,
    maxDepth: 2,
    maxPagesPerRun: 10,
    revisitCooldownMinutes: 15,
    perDomainRateLimitPerMinute: 20,
  },
  health: {
    lastStatus: "ok",
    lastSuccessAt: NOW,
    lastFailureAt: null,
    consecutiveFailures: 0,
    recentLatencyMs: 120,
    status403Count: 0,
    status429Count: 1,
    robotsBlocked: false,
    lastFailureReason: null,
    updatedAt: NOW,
  },
  connectorCapability: null,
  entityHints: [],
  metricHints: [],
  lastFetchedAt: NOW,
  lastSuccessAt: NOW,
  lastError: null,
  createdAt: NOW,
  updatedAt: NOW,
};

async function installAuth(page: Page, context: BrowserContext) {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
  });

  await context.addCookies([
    {
      name: "jarvis_auth_token",
      value: "e2e-token",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function installIntelligenceMocks(page: Page) {
  await page.route(`${API_BASE}/health`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          status: "ok",
          service: "jarvis-backend",
          env: "test",
          store: "memory",
          db: "n/a",
          now: NOW,
        }),
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/v1/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            id: "user-1",
            email: "operator@example.com",
            role: "admin",
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/workspaces") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ workspaces: [workspace] })),
      });
      return;
    }

    if (path === "/api/v1/intelligence/narrative-clusters") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ workspace_id: "ws-1", narrative_clusters: [cluster, duplicateTitleCluster, lowSignalCluster] })),
      });
      return;
    }

    if (path === "/api/v1/intelligence/events") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ workspace_id: "ws-1", events: [event] })),
      });
      return;
    }

    if (path === "/api/v1/intelligence/fetch-failures") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            fetch_failures: [
              {
                id: "failure-1",
                workspaceId: "ws-1",
                sourceId: "source-1",
                url: "https://example.com/freight",
                reason: "429 rate limited",
                statusCode: 429,
                retryable: true,
                blockedByRobots: false,
                createdAt: NOW,
              },
            ],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/maintenance/stale-events") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            stale_events: [
              {
                eventId: "event-1",
                title: event.title,
                staleScore: 72,
                genericPredicateRatio: 0.48,
                linkedClaimCount: 3,
                edgeCount: 2,
                graphSupportScore: 0.45,
                graphContradictionScore: 0.52,
                linkedClaimHealthScore: 0.44,
                reasons: ["generic predicate spike", "graph contradiction hotspot"],
                updatedAt: NOW,
              },
              {
                eventId: "event-low",
                title: "Low signal stale event",
                staleScore: 10,
                genericPredicateRatio: 0.62,
                linkedClaimCount: 8,
                edgeCount: 0,
                graphSupportScore: 0,
                graphContradictionScore: 0,
                linkedClaimHealthScore: 0.5,
                reasons: ["zero_graph_scores", "generic_predicate_ratio", "missing_non_social_corroboration"],
                updatedAt: NOW,
              },
            ],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/maintenance/rebuild-workspace") {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            result: {
              workspaceId: "ws-1",
              deletedEventCount: 12,
              deletedClusterCount: 4,
              deletedLinkedClaimCount: 28,
              mode: "hard_reset",
              queuedSignalCount: 19,
              executionMode: "worker",
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/runs") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            runs: [
              {
                id: "run-1",
                workspaceId: "ws-1",
                sourceId: "source-1",
                status: "ok",
                fetchedCount: 3,
                storedDocumentCount: 3,
                signalCount: 3,
                clusteredEventCount: 1,
                executionCount: 1,
                failedCount: 0,
                error: null,
                detailJson: {},
                startedAt: NOW,
                finishedAt: NOW,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
            scanner_worker: {
              enabled: true,
              inflight: false,
              lastRun: {
                workspaceId: "ws-1",
                scannedSources: 1,
                fetchedCount: 3,
                storedDocumentCount: 3,
                signalCount: 3,
                clusteredEventCount: 1,
                executionCount: 1,
                failedCount: 0,
                failedSources: [],
                startedAt: NOW,
                finishedAt: NOW,
                status: "ok",
                durationMs: 1200,
              },
            },
            semantic_worker: {
              enabled: true,
              inflight: false,
              lastRun: {
                workspaceId: "ws-1",
                processedSignalCount: 3,
                clusteredEventCount: 1,
                deliberationCount: 1,
                executionCount: 1,
                failedCount: 0,
                failedSignalIds: [],
                startedAt: NOW,
                finishedAt: NOW,
                status: "ok",
                durationMs: 1300,
              },
            },
            stale_maintenance_worker: {
              enabled: true,
              inflight: false,
              lastRun: {
                workspaceIds: ["ws-1"],
                attemptedCount: 1,
                rebuiltCount: 0,
                failedCount: 0,
                startedAt: NOW,
                finishedAt: NOW,
                status: "ok",
                durationMs: 1000,
              },
            },
            model_sync_worker: {
              enabled: true,
              inflight: false,
              lastRun: {
                syncedEntries: 2,
                startedAt: NOW,
                finishedAt: NOW,
                status: "ok",
                durationMs: 900,
              },
            },
            semantic_backlog: {
              pendingCount: 5,
              processingCount: 1,
              failedCount: 1,
              latestFailedSignalIds: ["sig-x"],
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/narrative-clusters/cluster-1") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope(clusterDetail)),
      });
      return;
    }

    if (path === "/api/v1/intelligence/narrative-clusters/cluster-1/timeline") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope(clusterTimeline)),
      });
      return;
    }

    if (path === "/api/v1/intelligence/narrative-clusters/cluster-1/graph") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope(clusterGraph)),
      });
      return;
    }

    if (path === "/api/v1/intelligence/events/event-1") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope(eventDetail)),
      });
      return;
    }

    if (path === "/api/v1/intelligence/hypotheses/event-1") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope(hypotheses)),
      });
      return;
    }

    if (path === "/api/v1/intelligence/events/event-1/graph") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope(eventGraph)),
      });
      return;
    }

    if (path === "/api/v1/intelligence/sources") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            workspaces: [workspace],
            sources: [source],
            scanner_worker: {
              enabled: true,
              inflight: false,
              lastRun: {
                workspaceId: "ws-1",
                scannedSources: 1,
                fetchedCount: 3,
                storedDocumentCount: 3,
                signalCount: 3,
                clusteredEventCount: 1,
                executionCount: 1,
                failedCount: 0,
                failedSources: [],
                startedAt: NOW,
                finishedAt: NOW,
                status: "ok",
                durationMs: 1200,
              },
            },
            semantic_worker: {
              enabled: true,
              inflight: false,
              lastRun: {
                workspaceId: "ws-1",
                processedSignalCount: 3,
                clusteredEventCount: 1,
                deliberationCount: 1,
                executionCount: 1,
                failedCount: 0,
                failedSignalIds: [],
                startedAt: NOW,
                finishedAt: NOW,
                status: "ok",
                durationMs: 1300,
              },
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/runtime/models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            models: [
              {
                id: "model-1",
                provider: "openai",
                modelId: "gpt-5.2",
                availability: "active",
                contextWindow: 128000,
                supportsStructuredOutput: true,
                supportsToolUse: true,
                supportsLongContext: true,
                supportsReasoning: true,
                costClass: "premium",
                latencyClass: "balanced",
                lastSeenAt: NOW,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
            provider_health: [
              {
                provider: "openai",
                available: true,
                cooldownUntil: null,
                reasonCode: null,
                failureCount: 0,
                updatedAt: NOW,
              },
            ],
            sync_worker: {
              enabled: true,
              inflight: false,
              lastRun: {
                syncedEntries: 2,
                startedAt: NOW,
                finishedAt: NOW,
                status: "ok",
                durationMs: 900,
              },
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/runtime/aliases") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            alias: null,
            bindings: {
              workspace: [
                {
                  id: "binding-1",
                  workspaceId: "ws-1",
                  alias: "structured_extraction",
                  provider: "openai",
                  modelId: "gpt-5.2",
                  weight: 1,
                  fallbackRank: 1,
                  canaryPercent: 100,
                  isActive: true,
                  requiresStructuredOutput: true,
                  requiresToolUse: true,
                  requiresLongContext: true,
                  maxCostClass: "premium",
                  updatedBy: "user-1",
                  createdAt: NOW,
                  updatedAt: NOW,
                },
              ],
              global: [],
            },
            rollouts: {
              workspace: [
                {
                  id: "rollout-1",
                  workspaceId: "ws-1",
                  alias: "structured_extraction",
                  bindingIds: ["binding-1"],
                  createdBy: "user-1",
                  note: "Initial rollout",
                  createdAt: NOW,
                },
              ],
              global: [],
            },
          }),
        ),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({})),
    });
  });
}

test("intelligence home focuses on inbox queues and opens cluster detail via narrative queue", async ({ page, context }) => {
  await installAuth(page, context);
  await installIntelligenceMocks(page);

  await page.goto("/intelligence?workspace=ws-1");

  await expect(page.getByRole("heading", { name: /Narrative Review|지금 검토할 서사/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Risky Execution Candidates|지금 위험한 실행 후보/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Broken System Issues|지금 고장난 시스템 이슈/ })).toBeVisible();
  await expect(page.getByText(/System Snapshot|시스템 스냅샷/)).toHaveCount(0);
  await expect(page.getByText("Quiet Watchlist Narrative")).toHaveCount(0);
  await expect(page.getByText("Supply Chain Reroute Signals")).toHaveCount(1);
  await expect(page.getByText("Low signal stale event")).toHaveCount(0);
  await expect(page.getByText(/후보 2|candidates 2/)).toHaveCount(1);

  await Promise.all([
    page.waitForURL(/\/intelligence\/clusters\/cluster-1/, { timeout: 20_000 }),
    page.getByRole("link", { name: /View related events|관련 이벤트 보기/ }).first().click(),
  ]);
  await expect(page.getByText(/What is this narrative|이 서사는 무엇인가/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Summary|요약/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Evidence|근거/ })).toBeVisible();
});

test("event evidence, execution detail, and system route expose the new IA", async ({ page, context }) => {
  test.slow();
  await installAuth(page, context);
  await installIntelligenceMocks(page);

  await page.goto("/intelligence/clusters/cluster-1/events/event-1?workspace=ws-1&tab=evidence");
  await expect(page.getByText(/Evidence Explainer|근거 해설/)).toBeVisible();
  await expect(page.getByText(/Top 3 supporting claims|가장 강한 지지 3개/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Claim Graph|클레임 그래프/ })).toBeVisible();

  await page.goto("/intelligence/clusters/cluster-1/events/event-1/execution/exec-1?workspace=ws-1");
  await expect(page.getByRole("heading", { name: /Blocked Reason|차단 사유/ })).toBeVisible();
  await expect(page.locator("#blocked-reason")).toContainText("Carrier guidance signal is still absent.");

  await page.goto("/intelligence/system?workspace=ws-1");
  await expect(page.getByRole("heading", { name: /System Snapshot|시스템 스냅샷/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Sources|소스/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Stale Maintenance|오염 이벤트 정비/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Rebuild workspace|전체 재빌드/ })).toBeVisible();
  await expect(page.getByText(/Narrative Review|지금 검토할 서사/)).toHaveCount(0);
});
