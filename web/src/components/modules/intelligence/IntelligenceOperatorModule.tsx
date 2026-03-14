"use client";

import Link from "next/link";
import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, BrainCircuit, Eye, FileText, Play, Send, ShieldAlert } from "lucide-react";

import { useLocale } from "@/components/providers/LocaleProvider";
import { ApiRequestError } from "@/lib/api/client";
import {
  bridgeIntelligenceEventToBrief,
  createIntelligenceOperatorNote,
  deliberateIntelligenceEvent,
  executeIntelligenceEvent,
  getIntelligenceEvent,
  getIntelligenceEventGraph,
  getIntelligenceHypotheses,
  getIntelligenceNarrativeCluster,
  getIntelligenceNarrativeClusterGraph,
  getIntelligenceNarrativeClusterTimeline,
  listIntelligenceEvents,
  listIntelligenceFetchFailures,
  listIntelligenceNarrativeClusters,
  listIntelligenceRuns,
  listIntelligenceStaleEvents,
  updateIntelligenceEventReviewState,
  updateIntelligenceLinkedClaimReviewState,
  updateIntelligenceNarrativeClusterReviewState,
} from "@/lib/api/endpoints";
import type {
  EventReviewState,
  HypothesisLedgerEntry,
  IntelligenceEventClusterRecord,
  IntelligenceExpectedSignalEntryRecord,
  IntelligenceFetchFailureRecord,
  IntelligenceHypothesisEvidenceSummary,
  IntelligenceInvalidationEntryRecord,
  IntelligenceNarrativeClusterRecord,
  IntelligenceNarrativeClusterTimelineRecord,
  IntelligenceRelatedHistoricalEventSummary,
  IntelligenceStaleEventPreview,
  LinkedClaimRecord,
  OperatorNoteRecord,
  SemanticBacklogStatus,
} from "@/lib/api/types";

import {
  ClaimGraphPanel,
  DetailBlock,
  readBlockedReason,
  type SelectedEventGraph,
} from "@/components/modules/IntelligenceModule";
import {
  ActionButton,
  BreadcrumbChain,
  EmptyPanel,
  executionStatusLabel,
  formatDateTime,
  genericStatusLabel,
  graphRelationLabel,
  IntelligenceShell,
  IntelligenceTabs,
  narrativeStateLabel,
  Panel,
  reviewStateLabel,
  StatusPill,
  SynopsisBlock,
  temporalRelationLabel,
  text,
  type IntelligenceDetailTab,
  useIntelligenceWorkspace,
} from "@/components/modules/intelligence/shared";

type InboxState = {
  clusters: IntelligenceNarrativeClusterRecord[];
  events: IntelligenceEventClusterRecord[];
  failures: IntelligenceFetchFailureRecord[];
  staleEvents: IntelligenceStaleEventPreview[];
  backlog: SemanticBacklogStatus;
};

type ClusterDetailState = {
  cluster: IntelligenceNarrativeClusterRecord;
  memberships: Awaited<ReturnType<typeof getIntelligenceNarrativeCluster>>["memberships"];
  recentEvents: IntelligenceEventClusterRecord[];
  ledgerEntries: Awaited<ReturnType<typeof getIntelligenceNarrativeCluster>>["ledger_entries"];
  operatorNotes: OperatorNoteRecord[];
};

type EventDetailState = {
  event: IntelligenceEventClusterRecord;
  linkedClaims: LinkedClaimRecord[];
  claimLinks: Awaited<ReturnType<typeof getIntelligenceEvent>>["claim_links"];
  bridgeDispatches: Awaited<ReturnType<typeof getIntelligenceEvent>>["bridge_dispatches"];
  executionAudit: Awaited<ReturnType<typeof getIntelligenceEvent>>["execution_audit"];
  operatorNotes: OperatorNoteRecord[];
  invalidationEntries: IntelligenceInvalidationEntryRecord[];
  expectedSignalEntries: IntelligenceExpectedSignalEntryRecord[];
  outcomeEntries: Awaited<ReturnType<typeof getIntelligenceEvent>>["outcome_entries"];
  narrativeCluster: IntelligenceNarrativeClusterRecord | null;
  temporalNarrativeLedger: Awaited<ReturnType<typeof getIntelligenceEvent>>["temporal_narrative_ledger"];
  relatedHistoricalEvents: IntelligenceRelatedHistoricalEventSummary[];
};

type HypothesisDetailState = {
  ledgerEntries: HypothesisLedgerEntry[];
  evidenceSummary: IntelligenceHypothesisEvidenceSummary[];
  invalidationEntries: IntelligenceInvalidationEntryRecord[];
  expectedSignalEntries: IntelligenceExpectedSignalEntryRecord[];
  outcomeEntries: Awaited<ReturnType<typeof getIntelligenceHypotheses>>["outcome_entries"];
  evidenceLinks: Awaited<ReturnType<typeof getIntelligenceHypotheses>>["evidence_links"];
};

type OperatorInboxNarrativeItem = {
  cluster: IntelligenceNarrativeClusterRecord;
  whyNow: string;
};

type OperatorInboxExecutionItem = {
  clusterId: string | null;
  event: IntelligenceEventClusterRecord;
  candidate: IntelligenceEventClusterRecord["executionCandidates"][number];
  candidateCount: number;
  whyNow: string;
  blockedReason: string | null;
};

type OperatorInboxSystemIssueItem =
  | {
      id: string;
      kind: "backlog";
      title: string;
      summary: string;
      severity: number;
      updatedAt: string;
    }
  | {
      id: string;
      kind: "failure";
      title: string;
      summary: string;
      severity: number;
      sourceId: string | null;
      updatedAt: string;
    }
  | {
      id: string;
      kind: "stale";
      title: string;
      summary: string;
      severity: number;
      eventId: string;
      clusterId: string | null;
      updatedAt: string;
    };

const NARRATIVE_QUEUE_PRIORITY_THRESHOLD = 8;
const NARRATIVE_QUEUE_CONTRADICTION_THRESHOLD = 0.35;
const STALE_HOME_THRESHOLD = 11;

function resolveTab(searchParams: ReadonlyURLSearchParams): IntelligenceDetailTab {
  const raw = searchParams.get("tab");
  return raw === "evidence" || raw === "timeline" || raw === "execution" ? raw : "summary";
}

function severityFromRiskBand(riskBand: string): number {
  if (riskBand === "critical") return 4;
  if (riskBand === "high") return 3;
  if (riskBand === "medium") return 2;
  return 1;
}

function normalizeQueueKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isSuspectQuality(record: { quality?: { state: "healthy" | "suspect" } } | null | undefined): boolean {
  return record?.quality?.state === "suspect";
}

function humanizeBlockedReason(locale: "ko" | "en", reason: string | null | undefined, mcpToolName?: string | null): string | null {
  if (!reason) return null;
  const labels: Record<string, { ko: string; en: string }> = {
    approval_required: {
      ko: "사람 승인 없이는 실행할 수 없다.",
      en: "This action requires human approval before it can run.",
    },
    schema_required: {
      ko: "실행에 필요한 입력 구조가 아직 확정되지 않았다.",
      en: "The execution payload schema is not settled yet.",
    },
    deliberation_required: {
      ko: "실행 전에 토론 결과를 먼저 고정해야 한다.",
      en: "Deliberation must complete before this can execute.",
    },
    mcp_tool_not_allowed: {
      ko: mcpToolName ? `${mcpToolName} 도구는 현재 허용되지 않는다.` : "현재 허용되지 않는 실행 도구가 필요하다.",
      en: mcpToolName ? `The ${mcpToolName} tool is not allowed here.` : "This action needs a tool that is not allowed here.",
    },
    cluster_diverging: {
      ko: "상위 서사가 분기 중이라 자동 실행을 열 수 없다.",
      en: "The parent narrative is diverging, so automation stays blocked.",
    },
    cluster_drift_too_high: {
      ko: "상위 서사의 드리프트가 커서 실행 판단이 불안정하다.",
      en: "Narrative drift is too high to trust execution yet.",
    },
    cluster_contradiction_too_high: {
      ko: "상위 서사의 반박 압력이 높아 실행을 열 수 없다.",
      en: "Contradiction pressure is too high to allow execution.",
    },
    cluster_recent_blocked_executions: {
      ko: "같은 서사에서 최근 차단 실행이 누적돼 다시 확인이 필요하다.",
      en: "This narrative has accumulated recent blocked executions and needs review first.",
    },
    social_only: {
      ko: "사회관계망 기반 신호만 있어 비소셜 보강이 없다.",
      en: "The evidence is still social-only and lacks non-social corroboration.",
    },
    non_social_corroboration_required: {
      ko: "비소셜 출처의 추가 보강이 필요하다.",
      en: "A non-social corroborating source is still required.",
    },
    contradiction_ratio_too_high: {
      ko: "반박 비율이 높아 실행 근거가 흔들린다.",
      en: "Too much of the evidence is contradictory for execution.",
    },
    linked_claim_health_too_low: {
      ko: "연결 클레임 건전도가 낮아 근거망이 약하다.",
      en: "Linked-claim health is too weak to support action.",
    },
    time_coherence_too_low: {
      ko: "시간 일관성이 낮아 하나의 사건 흐름으로 보기 어렵다.",
      en: "Time coherence is too low to treat this as one reliable storyline.",
    },
    graph_hotspot_present: {
      ko: "그래프 충돌 지점이 남아 있어 먼저 확인해야 한다.",
      en: "A graph hotspot is still unresolved and must be checked first.",
    },
    graph_contradiction_too_high: {
      ko: "그래프 반박 강도가 너무 높다.",
      en: "Graph contradiction pressure is too high.",
    },
    insufficient_claim_evidence: {
      ko: "연결 클레임 보강이 아직 부족하다.",
      en: "Linked-claim corroboration is still insufficient.",
    },
  };
  const translated = labels[reason];
  if (translated) return translated[locale];
  return reason;
}

function readCandidateToolName(candidate: IntelligenceEventClusterRecord["executionCandidates"][number]): string | null {
  const resultToolName = candidate.resultJson?.mcp_tool_name;
  if (typeof resultToolName === "string" && resultToolName.trim().length > 0) {
    return resultToolName;
  }
  const payloadToolName = candidate.payload?.mcp_tool_name;
  return typeof payloadToolName === "string" && payloadToolName.trim().length > 0 ? payloadToolName : null;
}

function describeBlockedReason(locale: "ko" | "en", candidate: IntelligenceEventClusterRecord["executionCandidates"][number]): string | null {
  return humanizeBlockedReason(locale, readBlockedReason(candidate), readCandidateToolName(candidate));
}

function humanizeStaleReason(locale: "ko" | "en", reason: string): string {
  const labels: Record<string, { ko: string; en: string }> = {
    zero_graph_scores: {
      ko: "그래프 지지·반박 점수와 엣지가 비어 있다",
      en: "Graph support, contradiction, and edges are still empty",
    },
    generic_predicate_ratio: {
      ko: "일반화된 predicate 비율이 너무 높다",
      en: "Too many claims use generic predicates",
    },
    missing_non_social_corroboration: {
      ko: "비소셜 보강 출처가 없다",
      en: "There is no non-social corroboration",
    },
    linked_claim_health_too_low: {
      ko: "연결 클레임 건전도가 낮다",
      en: "Linked-claim health is low",
    },
    inflated_claim_count: {
      ko: "클레임 수가 과하게 부풀어 있다",
      en: "Claim count looks inflated",
    },
  };
  const translated = labels[reason];
  return translated ? translated[locale] : reason;
}

function buildNarrativeQueueWhyNow(locale: "ko" | "en", cluster: IntelligenceNarrativeClusterRecord): string {
  const reasons: string[] = [];
  if (cluster.reviewState === "review") {
    reasons.push(text(locale, "운영자 검토가 아직 닫히지 않았다.", "Operator review is still open."));
  }
  if (cluster.recentExecutionBlockedCount > 0) {
    reasons.push(
      text(
        locale,
        `최근 차단된 실행 ${cluster.recentExecutionBlockedCount}건이 이 서사에 걸려 있다.`,
        `${cluster.recentExecutionBlockedCount} recent blocked executions are attached to this narrative.`,
      ),
    );
  }
  if (cluster.state === "diverging" || cluster.divergingEventCount > 0) {
    reasons.push(text(locale, "반박과 드리프트가 늘어 서사가 분기 중이다.", "Contradiction and drift are pushing this narrative into divergence."));
  }
  if (cluster.contradictionScore >= NARRATIVE_QUEUE_CONTRADICTION_THRESHOLD) {
    reasons.push(text(locale, "반박 압력이 높아 현재 해석이 흔들리고 있다.", "Contradiction pressure is destabilizing the current interpretation."));
  }
  if (reasons.length === 0 && cluster.clusterPriorityScore >= NARRATIVE_QUEUE_PRIORITY_THRESHOLD) {
    reasons.push(
      text(
        locale,
        `우선순위 점수 ${cluster.clusterPriorityScore}로 다음 검토 묶음의 선두다.`,
        `Its priority score of ${cluster.clusterPriorityScore} puts it at the front of the next review batch.`,
      ),
    );
  }
  if (reasons.length === 0) {
    reasons.push(text(locale, "다음 검토 묶음에 올릴 만큼 신호가 충분히 쌓였다.", "Enough pressure has accumulated to put this into the next review batch."));
  }
  return reasons.slice(0, 2).join(" ");
}

function shouldIncludeNarrativeCluster(cluster: IntelligenceNarrativeClusterRecord): boolean {
  if (isSuspectQuality(cluster)) return false;
  return (
    cluster.reviewState === "review" ||
    cluster.recentExecutionBlockedCount > 0 ||
    cluster.state === "diverging" ||
    cluster.divergingEventCount > 0 ||
    cluster.clusterPriorityScore >= NARRATIVE_QUEUE_PRIORITY_THRESHOLD ||
    cluster.contradictionScore >= NARRATIVE_QUEUE_CONTRADICTION_THRESHOLD
  );
}

function buildNarrativeQueue(locale: "ko" | "en", clusters: IntelligenceNarrativeClusterRecord[]): OperatorInboxNarrativeItem[] {
  const sorted = [...clusters].sort((left, right) => {
    const reviewScore = (cluster: IntelligenceNarrativeClusterRecord) => (cluster.reviewState === "review" ? 2 : cluster.reviewState === "watch" ? 1 : 0);
    const divergingScore = (cluster: IntelligenceNarrativeClusterRecord) => (cluster.state === "diverging" || cluster.divergingEventCount > 0 ? 1 : 0);
    return (
      reviewScore(right) - reviewScore(left) ||
      right.recentExecutionBlockedCount - left.recentExecutionBlockedCount ||
      divergingScore(right) - divergingScore(left) ||
      right.clusterPriorityScore - left.clusterPriorityScore ||
      right.contradictionScore - left.contradictionScore ||
      right.driftScore - left.driftScore ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    );
  });

  const seen = new Set<string>();
  const items: OperatorInboxNarrativeItem[] = [];
  for (const cluster of sorted) {
    if (!shouldIncludeNarrativeCluster(cluster)) continue;
    const dedupeKey = normalizeQueueKey(cluster.title) || normalizeQueueKey(cluster.clusterKey) || cluster.id;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    items.push({
      cluster,
      whyNow: buildNarrativeQueueWhyNow(locale, cluster),
    });
  }
  return items;
}

function buildExecutionWhyNow(locale: "ko" | "en", event: IntelligenceEventClusterRecord, candidate: IntelligenceEventClusterRecord["executionCandidates"][number], candidateCount: number, blockedReason: string | null): string {
  if (candidate.status === "blocked") {
    return blockedReason
      ? text(locale, `자동 실행이 막혀 있다. ${blockedReason}`, `Automation is blocked. ${blockedReason}`)
      : text(locale, "자동 실행이 막혀 있어 운영자 검토가 먼저 필요하다.", "Automation is blocked and needs operator review first.");
  }
  if (severityFromRiskBand(candidate.riskBand) >= 3) {
    return text(locale, "고위험 실행 후보라 사람 판단을 거친 뒤 진행해야 한다.", "This is a high-risk execution candidate and should be reviewed before running.");
  }
  if (candidateCount > 1) {
    return text(
      locale,
      `같은 이벤트에 실행 후보 ${candidateCount}개가 열려 있어 대표 후보부터 정리해야 한다.`,
      `${candidateCount} execution candidates are open for this event, so the lead option should be reviewed first.`,
    );
  }
  return text(
    locale,
    `우선순위 ${event.operatorPriorityScore ?? 0}의 대표 실행 후보다.`,
    `This is the lead execution candidate for an event with priority ${event.operatorPriorityScore ?? 0}.`,
  );
}

function buildExecutionQueue(
  locale: "ko" | "en",
  events: IntelligenceEventClusterRecord[],
  clustersById: Map<string, IntelligenceNarrativeClusterRecord>,
): OperatorInboxExecutionItem[] {
  return events
    .map((event) => {
      if (isSuspectQuality(event)) return null;
      const parentCluster = event.narrativeClusterId ? clustersById.get(event.narrativeClusterId) ?? null : null;
      if (parentCluster && isSuspectQuality(parentCluster)) return null;
      const candidates = [...event.executionCandidates]
        .filter((candidate) => candidate.status === "blocked" || severityFromRiskBand(candidate.riskBand) >= 2)
        .sort((left, right) => {
          const leftBlocked = left.status === "blocked" ? 1 : 0;
          const rightBlocked = right.status === "blocked" ? 1 : 0;
          return (
            rightBlocked - leftBlocked ||
            severityFromRiskBand(right.riskBand) - severityFromRiskBand(left.riskBand) ||
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
          );
        });
      if (candidates.length === 0) return null;
      const candidate = candidates[0];
      const blockedReason = describeBlockedReason(locale, candidate);
      return {
        clusterId: event.narrativeClusterId ?? null,
        event,
        candidate,
        candidateCount: event.executionCandidates.length,
        blockedReason,
        whyNow: buildExecutionWhyNow(locale, event, candidate, event.executionCandidates.length, blockedReason),
      };
    })
    .filter((row): row is OperatorInboxExecutionItem => row !== null)
    .sort((left, right) => {
      const leftBlocked = left.candidate.status === "blocked" ? 1 : 0;
      const rightBlocked = right.candidate.status === "blocked" ? 1 : 0;
      return (
        rightBlocked - leftBlocked ||
        severityFromRiskBand(right.candidate.riskBand) - severityFromRiskBand(left.candidate.riskBand) ||
        (right.event.operatorPriorityScore ?? 0) - (left.event.operatorPriorityScore ?? 0) ||
        Date.parse(right.candidate.updatedAt) - Date.parse(left.candidate.updatedAt)
      );
    });
}

function groupFailureSummary(failures: IntelligenceFetchFailureRecord[]) {
  const grouped = new Map<string, { title: string; sourceId: string | null; latestAt: string; total: number; reasons: string[] }>();
  for (const failure of failures) {
    const key = failure.sourceId ?? failure.url;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        title: failure.sourceId ? failure.sourceId : failure.url,
        sourceId: failure.sourceId,
        latestAt: failure.createdAt,
        total: 1,
        reasons: [failure.reason],
      });
      continue;
    }
    current.total += 1;
    if (Date.parse(failure.createdAt) > Date.parse(current.latestAt)) {
      current.latestAt = failure.createdAt;
    }
    if (!current.reasons.includes(failure.reason)) {
      current.reasons.push(failure.reason);
    }
  }
  return [...grouped.values()].sort((left, right) => Date.parse(right.latestAt) - Date.parse(left.latestAt));
}

function buildSystemIssues(
  locale: "ko" | "en",
  events: IntelligenceEventClusterRecord[],
  failures: IntelligenceFetchFailureRecord[],
  staleEvents: IntelligenceStaleEventPreview[],
  backlog: SemanticBacklogStatus,
): OperatorInboxSystemIssueItem[] {
  const issues: OperatorInboxSystemIssueItem[] = [];
  if (backlog.pendingCount > 0 || backlog.failedCount > 0) {
    issues.push({
      id: "semantic-backlog",
      kind: "backlog",
      title: text(locale, "시맨틱 백로그 적체", "Semantic backlog pressure"),
      summary: text(
        locale,
        `대기 ${backlog.pendingCount} · 실패 ${backlog.failedCount}. Operator가 보기 전에 시스템 상태를 정리해야 한다.`,
        `${backlog.pendingCount} pending and ${backlog.failedCount} failed semantic items are delaying clean review.`,
      ),
      severity: backlog.failedCount > 0 ? 4 : 2,
      updatedAt: new Date().toISOString(),
    });
  }
  for (const failure of groupFailureSummary(failures).slice(0, 3)) {
    issues.push({
      id: `failure-${failure.sourceId ?? failure.title}`,
      kind: "failure",
      title: failure.title,
      summary: `${failure.total} ${text(locale, "실패", "failures")} · ${failure.reasons.slice(0, 2).join(" / ")}`,
      severity: failure.total >= 3 ? 4 : 3,
      sourceId: failure.sourceId,
      updatedAt: failure.latestAt,
    });
  }
  for (const stale of [...staleEvents]
    .filter((item) => item.staleScore >= STALE_HOME_THRESHOLD)
    .sort((left, right) => right.staleScore - left.staleScore || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 3)) {
    const relatedEvent = events.find((event) => event.id === stale.eventId) ?? null;
    const reasons = stale.reasons.map((reason) => humanizeStaleReason(locale, reason));
    const contaminationPrefix =
      relatedEvent?.quality?.state === "suspect"
        ? text(locale, "저장 오염 의심", "suspect stored contamination")
        : text(locale, "시스템 이슈", "system issue");
    issues.push({
      id: `stale-${stale.eventId}`,
      kind: "stale",
      title: stale.title,
      summary: `${contaminationPrefix} · ${text(locale, "오염 점수", "stale score")} ${stale.staleScore} · ${reasons.slice(0, 2).join(" · ")}`,
      severity: stale.staleScore >= 14 ? 4 : 3,
      eventId: stale.eventId,
      clusterId: relatedEvent?.narrativeClusterId ?? null,
      updatedAt: stale.updatedAt,
    });
  }
  return issues.sort((left, right) => right.severity - left.severity || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function buildClusterSynopsis(locale: "ko" | "en", cluster: IntelligenceNarrativeClusterRecord, recentEvents: IntelligenceEventClusterRecord[]) {
  const transition = cluster.lastTransition?.summary ?? text(locale, "최근 전이가 아직 없다.", "No recent transition recorded yet.");
  const leadingEvent = recentEvents[0];
  return [
    {
      label: text(locale, "이 서사는 무엇인가", "What is this narrative"),
      value: text(
        locale,
        `${cluster.title} 서사는 ${cluster.eventCount}개 이벤트를 묶고 있으며 현재 ${narrativeStateLabel(cluster.state, locale)} 상태다.`,
        `${cluster.title} groups ${cluster.eventCount} events and is currently ${narrativeStateLabel(cluster.state, locale)}.`,
      ),
    },
    {
      label: text(locale, "왜 지금 중요한가", "Why it matters now"),
      value: text(
        locale,
        `우선순위 ${cluster.clusterPriorityScore}, 분기 ${cluster.divergingEventCount}, 최근 차단 실행 ${cluster.recentExecutionBlockedCount}건 때문에 먼저 봐야 한다.`,
        `Priority ${cluster.clusterPriorityScore}, ${cluster.divergingEventCount} diverging events, and ${cluster.recentExecutionBlockedCount} blocked executions push this to the top.`,
      ),
    },
    {
      label: text(locale, "가장 유력한 해석", "Leading interpretation"),
      value: transition,
    },
    {
      label: text(locale, "지금 필요한 행동", "Next required action"),
      value: leadingEvent
        ? text(locale, `관련 이벤트 "${leadingEvent.title}"를 열고 검토 상태를 확정해라.`, `Open "${leadingEvent.title}" and lock the review state.`)
        : text(locale, "클러스터 상태를 검토로 고정하고 최근 이벤트를 확인해라.", "Mark the cluster for review and inspect recent events."),
    },
  ];
}

function buildEventSynopsis(locale: "ko" | "en", event: IntelligenceEventClusterRecord, detail: EventDetailState | null, hypothesisDetail: HypothesisDetailState | null) {
  const primary = event.primaryHypotheses[0];
  const blockedCandidate = event.executionCandidates.find((candidate) => candidate.status === "blocked");
  const absentSignals = hypothesisDetail?.expectedSignalEntries.filter((signal) => signal.status === "absent").length ?? 0;
  const blockedReason = blockedCandidate ? describeBlockedReason(locale, blockedCandidate) : null;
  return [
    {
      label: text(locale, "이 사건은 무엇인가", "What is this event"),
      value: event.summary,
    },
    {
      label: text(locale, "왜 지금 중요한가", "Why it matters now"),
      value: text(
        locale,
        `반박 ${event.contradictionCount}, 클레임 건전도 ${event.linkedClaimHealthScore.toFixed(2)}, 시간 일관성 ${event.timeCoherenceScore.toFixed(2)}를 기준으로 운영자 검토가 필요하다.`,
        `It needs operator attention because contradictions are ${event.contradictionCount}, claim health is ${event.linkedClaimHealthScore.toFixed(2)}, and time coherence is ${event.timeCoherenceScore.toFixed(2)}.`,
      ),
    },
    {
      label: text(locale, "가장 유력한 해석", "Leading interpretation"),
      value: primary
        ? `${primary.title} · ${primary.summary}`
        : text(locale, "주 가설이 아직 명확하지 않다.", "The primary hypothesis is not stable yet."),
    },
    {
      label: text(locale, "지금 필요한 행동", "Next required action"),
      value: blockedCandidate
        ? text(locale, `자동 실행은 막혀 있다. ${blockedReason ?? text(locale, "차단 사유를 검토해라.", "Review the blocked reason before acting.")}`, `Automation is blocked. ${blockedReason ?? "Review the blocked reason before acting."}`)
        : absentSignals > 0
          ? text(locale, `예상 신호 ${absentSignals}개가 비어 있다. 토론 또는 브리프 생성을 먼저 수행해라.`, `${absentSignals} expected signals are absent. Run deliberation or generate a brief before acting.`)
          : text(locale, "토론과 브리프를 통해 실행 전 판단을 고정해라.", "Run deliberation and generate a brief before execution."),
    },
  ];
}

function buildEvidenceExplainer(locale: "ko" | "en", detail: EventDetailState, event: IntelligenceEventClusterRecord, hypothesisDetail: HypothesisDetailState | null, graph: SelectedEventGraph | null) {
  const strongestSupport = [...detail.linkedClaims]
    .sort((left, right) => right.nonSocialSourceCount - left.nonSocialSourceCount || left.contradictionCount - right.contradictionCount)
    .slice(0, 3)
    .map((claim) => `${claim.canonicalSubject} ${claim.canonicalPredicate} ${claim.canonicalObject}`);
  const strongestContradictions = [...detail.linkedClaims]
    .sort((left, right) => right.contradictionCount - left.contradictionCount || right.sourceCount - left.sourceCount)
    .slice(0, 2)
    .map((claim) => `${claim.canonicalSubject} ${claim.canonicalPredicate} ${claim.canonicalObject}`);
  const divergingEdge = graph?.hotspotClusters[0]
    ? `${graph.hotspotClusters[0].label} · ${text(locale, "핫스팟", "hotspot")} ${graph.hotspotClusters[0].hotspotScore.toFixed(2)}`
    : graph?.edges.find((edge) => edge.relation === "contradicts")
      ? `${graphRelationLabel("contradicts", locale)} · ${graph?.edges.find((edge) => edge.relation === "contradicts")?.edgeStrength.toFixed(2)}`
      : text(locale, "아직 없음", "none yet");
  const blockedEvidence = event.executionCandidates.find((candidate) => candidate.status === "blocked");
  const absentSignal = hypothesisDetail?.expectedSignalEntries.find((signal) => signal.status === "absent");
  return [
    {
      label: text(locale, "가장 강한 지지 3개", "Top 3 supporting claims"),
      items: strongestSupport.length > 0 ? strongestSupport : [text(locale, "지지 클레임이 아직 없다.", "No supporting claims yet.")],
    },
    {
      label: text(locale, "가장 위험한 반박 2개", "Top 2 contradictions"),
      items: strongestContradictions.length > 0 ? strongestContradictions : [text(locale, "반박 클레임이 아직 없다.", "No contradiction claims yet.")],
    },
    {
      label: text(locale, "분기를 만든 엣지", "Edge driving divergence"),
      items: [divergingEdge],
    },
    {
      label: text(locale, "실행을 막는 근거", "Evidence blocking execution"),
      items: [
        blockedEvidence
          ? describeBlockedReason(locale, blockedEvidence) ?? blockedEvidence.summary
          : absentSignal
            ? absentSignal.description
            : text(locale, "현재 차단 근거 없음", "No blocking evidence right now"),
      ],
    },
  ];
}

function routeClusterId(clusterId: string | null | undefined, fallback: string) {
  return clusterId && clusterId.length > 0 ? clusterId : fallback;
}

function useInboxData(workspaceId: string | null, locale: "ko" | "en") {
  const [state, setState] = useState<InboxState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [clusters, events, failures, staleEvents, runs] = await Promise.all([
        listIntelligenceNarrativeClusters({ workspace_id: workspaceId, limit: 50 }),
        listIntelligenceEvents({ workspace_id: workspaceId, limit: 50 }),
        listIntelligenceFetchFailures({ workspace_id: workspaceId, limit: 20 }),
        listIntelligenceStaleEvents({ workspace_id: workspaceId, limit: 20 }),
        listIntelligenceRuns({ workspace_id: workspaceId, limit: 20 }),
      ]);
      setState({
        clusters: clusters.narrative_clusters,
        events: events.events,
        failures: failures.fetch_failures,
        staleEvents: staleEvents.stale_events,
        backlog: runs.semantic_backlog,
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(text(locale, "인텔리전스 인박스를 불러오지 못했다.", "Failed to load the intelligence inbox."));
      }
    } finally {
      setLoading(false);
    }
  }, [locale, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, loading, error, refresh: load };
}

function useClusterDetail(workspaceId: string | null, clusterId: string, locale: "ko" | "en", tab: IntelligenceDetailTab) {
  const [detail, setDetail] = useState<ClusterDetailState | null>(null);
  const [timeline, setTimeline] = useState<IntelligenceNarrativeClusterTimelineRecord[]>([]);
  const [trend, setTrend] = useState<Awaited<ReturnType<typeof getIntelligenceNarrativeClusterTimeline>>["trend_summary"] | null>(null);
  const [graph, setGraph] = useState<Awaited<ReturnType<typeof getIntelligenceNarrativeClusterGraph>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const clusterDetail = await getIntelligenceNarrativeCluster(clusterId, { workspace_id: workspaceId });
      setDetail({
        cluster: clusterDetail.narrative_cluster,
        memberships: clusterDetail.memberships,
        recentEvents: clusterDetail.recent_events,
        ledgerEntries: clusterDetail.ledger_entries,
        operatorNotes: clusterDetail.operator_notes,
      });
      if (tab === "timeline") {
        const clusterTimeline = await getIntelligenceNarrativeClusterTimeline(clusterId, { workspace_id: workspaceId });
        setTimeline(clusterTimeline.timeline);
        setTrend(clusterTimeline.trend_summary);
      } else {
        setTimeline([]);
        setTrend(null);
      }
      if (tab === "evidence") {
        setGraph(await getIntelligenceNarrativeClusterGraph(clusterId, { workspace_id: workspaceId }));
      } else {
        setGraph(null);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(text(locale, "서사 클러스터를 불러오지 못했다.", "Failed to load the narrative cluster."));
      }
    } finally {
      setLoading(false);
    }
  }, [clusterId, locale, tab, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { detail, timeline, trend, graph, loading, error, refresh: load };
}

function useEventDetail(workspaceId: string | null, eventId: string, locale: "ko" | "en", tab: IntelligenceDetailTab) {
  const [detail, setDetail] = useState<EventDetailState | null>(null);
  const [hypothesisDetail, setHypothesisDetail] = useState<HypothesisDetailState | null>(null);
  const [graph, setGraph] = useState<SelectedEventGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const eventDetail = await getIntelligenceEvent(eventId, { workspace_id: workspaceId });
      setDetail({
        event: eventDetail.event,
        linkedClaims: eventDetail.linked_claims,
        claimLinks: eventDetail.claim_links,
        bridgeDispatches: eventDetail.bridge_dispatches,
        executionAudit: eventDetail.execution_audit,
        operatorNotes: eventDetail.operator_notes,
        invalidationEntries: eventDetail.invalidation_entries,
        expectedSignalEntries: eventDetail.expected_signal_entries,
        outcomeEntries: eventDetail.outcome_entries,
        narrativeCluster: eventDetail.narrative_cluster,
        temporalNarrativeLedger: eventDetail.temporal_narrative_ledger,
        relatedHistoricalEvents: eventDetail.related_historical_events,
      });
      if (tab === "evidence") {
        const [hypotheses, eventGraph] = await Promise.all([
          getIntelligenceHypotheses(eventId, { workspace_id: workspaceId }),
          getIntelligenceEventGraph(eventId, { workspace_id: workspaceId }),
        ]);
        setHypothesisDetail({
          ledgerEntries: hypotheses.ledger_entries,
          evidenceSummary: hypotheses.evidence_summary,
          invalidationEntries: hypotheses.invalidation_entries,
          expectedSignalEntries: hypotheses.expected_signal_entries,
          outcomeEntries: hypotheses.outcome_entries,
          evidenceLinks: hypotheses.evidence_links,
        });
        setGraph({
          summary: eventGraph.summary,
          nodes: eventGraph.nodes,
          edges: eventGraph.edges,
          hotspots: eventGraph.hotspots,
          neighborhoods: eventGraph.neighborhoods,
          hotspotClusters: eventGraph.hotspot_clusters,
          relatedHistoricalEvents: eventGraph.related_historical_events,
        });
      } else {
        setHypothesisDetail(null);
        setGraph(null);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(text(locale, "이벤트를 불러오지 못했다.", "Failed to load the event."));
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, locale, tab, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { detail, hypothesisDetail, graph, loading, error, refresh: load };
}

function useExecutionDetail(workspaceId: string | null, eventId: string, locale: "ko" | "en") {
  const [detail, setDetail] = useState<EventDetailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const eventDetail = await getIntelligenceEvent(eventId, { workspace_id: workspaceId });
      setDetail({
        event: eventDetail.event,
        linkedClaims: eventDetail.linked_claims,
        claimLinks: eventDetail.claim_links,
        bridgeDispatches: eventDetail.bridge_dispatches,
        executionAudit: eventDetail.execution_audit,
        operatorNotes: eventDetail.operator_notes,
        invalidationEntries: eventDetail.invalidation_entries,
        expectedSignalEntries: eventDetail.expected_signal_entries,
        outcomeEntries: eventDetail.outcome_entries,
        narrativeCluster: eventDetail.narrative_cluster,
        temporalNarrativeLedger: eventDetail.temporal_narrative_ledger,
        relatedHistoricalEvents: eventDetail.related_historical_events,
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(text(locale, "실행 후보를 불러오지 못했다.", "Failed to load the execution candidate."));
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, locale, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { detail, loading, error, refresh: load };
}

async function promptReviewPayload(locale: "ko" | "en", reviewState: EventReviewState, currentReason: string | null, currentOwner: string | null) {
  const reviewReason =
    typeof window !== "undefined" && reviewState !== "watch"
      ? window.prompt(text(locale, "검토 사유를 입력해라", "Enter a review reason"), currentReason ?? "")?.trim() ?? null
      : null;
  const reviewOwner =
    typeof window !== "undefined" && reviewState === "review"
      ? window.prompt(text(locale, "담당자(user id)를 입력해라", "Enter a review owner (user id)"), currentOwner ?? "")?.trim() ?? null
      : null;
  return {
    review_reason: reviewReason,
    review_owner: reviewOwner,
    review_resolved_at: reviewState === "ignore" ? new Date().toISOString() : null,
  };
}

export function IntelligenceInboxModule() {
  const { locale } = useLocale();
  const workspace = useIntelligenceWorkspace();
  const { state, loading, error, refresh } = useInboxData(workspace.workspaceId, locale);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const clusterById = useMemo(
    () => new Map((state?.clusters ?? []).map((cluster) => [cluster.id, cluster] as const)),
    [state?.clusters],
  );

  const narrativeQueue = useMemo(() => buildNarrativeQueue(locale, state?.clusters ?? []).slice(0, 8), [locale, state?.clusters]);
  const executionQueue = useMemo(
    () => buildExecutionQueue(locale, state?.events ?? [], clusterById).slice(0, 8),
    [clusterById, locale, state?.events],
  );
  const systemIssues = useMemo(
    () => buildSystemIssues(locale, state?.events ?? [], state?.failures ?? [], state?.staleEvents ?? [], state?.backlog ?? { pendingCount: 0, processingCount: 0, failedCount: 0, latestFailedSignalIds: [] }).slice(0, 8),
    [locale, state?.backlog, state?.events, state?.failures, state?.staleEvents],
  );

  const markClusterForReview = useCallback(async (cluster: IntelligenceNarrativeClusterRecord) => {
    if (!workspace.workspaceId) return;
    const payload = await promptReviewPayload(locale, "review", cluster.reviewReason, cluster.reviewOwner);
    setBusyKey(`cluster:${cluster.id}:review`);
    try {
      await updateIntelligenceNarrativeClusterReviewState(cluster.id, {
        workspace_id: workspace.workspaceId,
        review_state: "review",
        ...payload,
      });
      await refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setBusyKey(null);
    }
  }, [locale, refresh, workspace.workspaceId]);

  const buildClusterHref = useCallback((clusterId: string, tab: IntelligenceDetailTab = "summary") => {
    return workspace.buildHref(`/intelligence/clusters/${clusterId}`, { workspace: workspace.workspaceId, tab });
  }, [workspace]);

  const buildExecutionHref = useCallback((row: OperatorInboxExecutionItem) => {
    const clusterId = routeClusterId(row.clusterId, "unassigned");
    return workspace.buildHref(`/intelligence/clusters/${clusterId}/events/${row.event.id}/execution/${row.candidate.id}`, { workspace: workspace.workspaceId });
  }, [workspace]);

  return (
    <IntelligenceShell
      title={text(locale, "Intelligence Inbox", "Intelligence Inbox")}
      description={text(
        locale,
        "홈은 Inbox만 보여준다. 지금 검토할 서사, 지금 위험한 실행 후보, 지금 고장난 시스템 이슈만 남기고 나머지는 상세와 System으로 보낸다.",
        "Home is inbox-only. It shows the narrative to review, the risky execution candidate, and the broken system issue first.",
      )}
      workspaceId={workspace.workspaceId}
      workspaces={workspace.workspaces}
      buildHref={workspace.buildHref}
      onWorkspaceChange={workspace.setWorkspaceSelection}
      onRefresh={() => {
        void workspace.refreshWorkspaces();
        void refresh();
      }}
      loading={loading || workspace.loadingWorkspace}
      error={error ?? workspace.workspaceError}
    >
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title={text(locale, "지금 검토할 서사", "Narrative Review")}
          meta={`${narrativeQueue.length} ${text(locale, "개 표시", "visible")}`}
        >
          <div className="space-y-3">
            {narrativeQueue.length === 0 ? (
              <EmptyPanel
                title={text(locale, "검토할 서사가 없다.", "No narratives need review.")}
                body={text(locale, "현재 우선순위가 높은 클러스터가 없다.", "No high-priority narrative cluster is waiting for review.")}
              />
            ) : (
              narrativeQueue.map(({ cluster, whyNow }) => (
                <div key={cluster.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={cluster.state === "diverging" ? "rose" : "cyan"}>{narrativeStateLabel(cluster.state, locale)}</StatusPill>
                    <StatusPill>{reviewStateLabel(cluster.reviewState, locale)}</StatusPill>
                  </div>
                  <p className="mt-3 text-base font-medium text-white">{cluster.title}</p>
                  <p className="mt-2 text-sm text-white/72">{whyNow}</p>
                  <p className="mt-2 text-xs text-white/45">
                    {cluster.lastTransition?.summary ?? text(locale, "최근 전이 기록 없음", "No recent transition")}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionButton
                      onClick={() => void markClusterForReview(cluster)}
                      tone="primary"
                      icon={busyKey === `cluster:${cluster.id}:review` ? <Send size={12} /> : <Eye size={12} />}
                    >
                      {busyKey === `cluster:${cluster.id}:review` ? "..." : text(locale, "검토", "Review")}
                    </ActionButton>
                    <ActionButton href={buildClusterHref(cluster.id)} icon={<ArrowRight size={12} />}>
                      {text(locale, "관련 이벤트 보기", "View related events")}
                    </ActionButton>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel
          title={text(locale, "지금 위험한 실행 후보", "Risky Execution Candidates")}
          meta={`${executionQueue.length} ${text(locale, "개 표시", "visible")}`}
        >
          <div className="space-y-3">
            {executionQueue.length === 0 ? (
              <EmptyPanel
                title={text(locale, "검토할 실행 후보가 없다.", "No execution candidates need attention.")}
                body={text(locale, "현재 고위험 또는 차단된 실행 후보가 없다.", "There are no risky or blocked execution candidates right now.")}
              />
            ) : (
              executionQueue.map((row) => (
                <div key={row.candidate.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={row.candidate.status === "blocked" ? "amber" : "emerald"}>{executionStatusLabel(row.candidate.status, locale)}</StatusPill>
                    <StatusPill>{row.candidate.riskBand}</StatusPill>
                  </div>
                  <p className="mt-3 text-base font-medium text-white">{row.event.title}</p>
                  <p className="mt-1 text-xs text-white/50">
                    {text(locale, "대표 실행 후보", "Lead candidate")} · {row.candidate.title}
                    {row.candidateCount > 1 ? ` · ${text(locale, "후보", "candidates")} ${row.candidateCount}` : ""}
                  </p>
                  <p className="mt-2 text-sm text-white/72">{row.whyNow}</p>
                  <p className="mt-2 text-xs text-white/45">
                    {row.blockedReason
                      ? `${text(locale, "차단 사유", "blocked reason")} · ${row.blockedReason}`
                      : text(locale, "즉시 실행 가능 후보", "Ready to run candidate")}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionButton href={buildExecutionHref(row)} tone="primary" icon={<Play size={12} />}>
                      {text(locale, row.candidate.status === "blocked" ? "차단 사유 보기" : "실행", row.candidate.status === "blocked" ? "View blocked reason" : "Run")}
                    </ActionButton>
                    <ActionButton href={buildExecutionHref(row)} icon={<ArrowRight size={12} />}>
                      {text(locale, "세부 보기", "Open detail")}
                    </ActionButton>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel
          title={text(locale, "지금 고장난 시스템 이슈", "Broken System Issues")}
          meta={`${systemIssues.length} ${text(locale, "개 표시", "visible")}`}
        >
          <div className="space-y-3">
            {systemIssues.length === 0 ? (
              <EmptyPanel
                title={text(locale, "긴급 시스템 이슈가 없다.", "No urgent system issues.")}
                body={text(locale, "오퍼레이터가 먼저 볼 시스템 문제는 없다.", "There are no urgent system problems competing with operator work right now.")}
                href={workspace.buildHref("/intelligence/system")}
                ctaLabel={text(locale, "System 보기", "Open System")}
              />
            ) : (
              systemIssues.map((issue) => (
                <div key={issue.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={issue.severity >= 4 ? "rose" : issue.severity >= 3 ? "amber" : "neutral"}>
                      {text(locale, "심각도", "Severity")} {issue.severity}
                    </StatusPill>
                    <StatusPill>{issue.kind}</StatusPill>
                  </div>
                  <p className="mt-3 text-base font-medium text-white">{issue.title}</p>
                  <p className="mt-2 text-sm text-white/72">{issue.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionButton href={workspace.buildHref("/intelligence/system")} tone="primary" icon={<ShieldAlert size={12} />}>
                      {text(locale, "System 보기", "Open System")}
                    </ActionButton>
                    {issue.kind === "stale" && issue.clusterId ? (
                      <ActionButton
                        href={workspace.buildHref(`/intelligence/clusters/${issue.clusterId}/events/${issue.eventId}`, { workspace: workspace.workspaceId, tab: "execution" })}
                        icon={<ArrowRight size={12} />}
                      >
                        {text(locale, "관련 이벤트 보기", "View related event")}
                      </ActionButton>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </IntelligenceShell>
  );
}

export function IntelligenceClusterDetailModule({ clusterId }: { clusterId: string }) {
  const { locale } = useLocale();
  const workspace = useIntelligenceWorkspace();
  const searchParams = useSearchParams();
  const tab = resolveTab(searchParams);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { detail, timeline, trend, graph, loading, error, refresh } = useClusterDetail(workspace.workspaceId, clusterId, locale, tab);

  const updateClusterReview = useCallback(async (reviewState: EventReviewState) => {
    if (!workspace.workspaceId || !detail) return;
    const payload = await promptReviewPayload(locale, reviewState, detail.cluster.reviewReason, detail.cluster.reviewOwner);
    setBusyKey(`cluster-review:${reviewState}`);
    try {
      await updateIntelligenceNarrativeClusterReviewState(detail.cluster.id, {
        workspace_id: workspace.workspaceId,
        review_state: reviewState,
        ...payload,
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [detail, locale, refresh, workspace.workspaceId]);

  const addClusterNote = useCallback(async () => {
    if (!workspace.workspaceId || !detail) return;
    const note = typeof window !== "undefined"
      ? window.prompt(text(locale, "서사 클러스터 메모를 입력해라", "Enter a note for this narrative cluster"))?.trim()
      : null;
    if (!note) return;
    setBusyKey("cluster-note");
    try {
      const targetEventId = detail.recentEvents[0]?.id;
      if (!targetEventId) return;
      await createIntelligenceOperatorNote(targetEventId, {
        workspace_id: workspace.workspaceId,
        scope: "narrative_cluster",
        scope_id: detail.cluster.id,
        note,
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [detail, locale, refresh, workspace.workspaceId]);

  const tabs = useMemo(() => (
    [
      { key: "summary", label: text(locale, "요약", "Summary"), href: workspace.buildHref(`/intelligence/clusters/${clusterId}`, { workspace: workspace.workspaceId, tab: "summary" }) },
      { key: "evidence", label: text(locale, "근거", "Evidence"), href: workspace.buildHref(`/intelligence/clusters/${clusterId}`, { workspace: workspace.workspaceId, tab: "evidence" }) },
      { key: "timeline", label: text(locale, "시간축", "Timeline"), href: workspace.buildHref(`/intelligence/clusters/${clusterId}`, { workspace: workspace.workspaceId, tab: "timeline" }) },
      { key: "execution", label: text(locale, "실행", "Execution"), href: workspace.buildHref(`/intelligence/clusters/${clusterId}`, { workspace: workspace.workspaceId, tab: "execution" }) },
    ] as Array<{ key: IntelligenceDetailTab; label: string; href: string }>
  ), [clusterId, locale, workspace]);

  const recentExecutionRows = useMemo(() => {
    const recentClusters = detail?.cluster ? new Map([[detail.cluster.id, detail.cluster] as const]) : new Map<string, IntelligenceNarrativeClusterRecord>();
    return buildExecutionQueue(locale, detail?.recentEvents ?? [], recentClusters).slice(0, 8);
  }, [detail?.cluster, detail?.recentEvents, locale]);
  const synopsis = detail ? buildClusterSynopsis(locale, detail.cluster, detail.recentEvents) : [];
  const actualClusterId = detail?.cluster.id ?? clusterId;

  return (
    <IntelligenceShell
      title={text(locale, "Narrative Cluster Detail", "Narrative Cluster Detail")}
      description={text(
        locale,
        "상세는 요약, 근거, 시간축, 실행 탭으로 나눈다. 여기서는 서사를 먼저 이해하고, 왜 중요한지와 다음 행동을 고정한다.",
        "The detail view is split into summary, evidence, timeline, and execution so the operator can understand the narrative before diving into raw evidence.",
      )}
      workspaceId={workspace.workspaceId}
      workspaces={workspace.workspaces}
      buildHref={workspace.buildHref}
      onWorkspaceChange={workspace.setWorkspaceSelection}
      onRefresh={() => {
        void workspace.refreshWorkspaces();
        void refresh();
      }}
      loading={loading || workspace.loadingWorkspace}
      error={error ?? workspace.workspaceError}
      breadcrumb={
        <BreadcrumbChain
          items={[
            { label: detail?.cluster.title ?? text(locale, "Narrative Cluster", "Narrative Cluster"), href: workspace.buildHref(`/intelligence/clusters/${actualClusterId}`, { workspace: workspace.workspaceId, tab: "summary" }) },
            { label: detail?.recentEvents[0]?.title ?? text(locale, "Event", "Event"), href: detail?.recentEvents[0] ? workspace.buildHref(`/intelligence/clusters/${actualClusterId}/events/${detail.recentEvents[0].id}`, { workspace: workspace.workspaceId, tab: "summary" }) : undefined },
            { label: detail?.recentEvents[0]?.primaryHypotheses[0]?.title ?? text(locale, "Primary Hypothesis", "Primary Hypothesis") },
            { label: `${detail?.recentEvents[0]?.linkedClaimCount ?? 0} ${text(locale, "Key Claims", "Key Claims")}` },
            { label: `${recentExecutionRows[0]?.candidate.title ?? text(locale, "Execution", "Execution")}` },
          ]}
        />
      }
      right={
        detail ? (
          <>
            <ActionButton onClick={() => void updateClusterReview("review")} tone="primary" icon={<Eye size={12} />}>
              {busyKey === "cluster-review:review" ? "..." : text(locale, "검토", "Review")}
            </ActionButton>
            <ActionButton
              href={detail.recentEvents[0] ? workspace.buildHref(`/intelligence/clusters/${actualClusterId}/events/${detail.recentEvents[0].id}`, { workspace: workspace.workspaceId, tab: "summary" }) : undefined}
              icon={<ArrowRight size={12} />}
            >
              {text(locale, "관련 이벤트 보기", "View related events")}
            </ActionButton>
          </>
        ) : null
      }
    >
      {!detail ? (
        <EmptyPanel
          title={text(locale, "서사 클러스터를 찾을 수 없다.", "Cluster not found.")}
          body={text(locale, "현재 워크스페이스에서 이 클러스터를 찾지 못했다.", "The cluster could not be found in the selected workspace.")}
        />
      ) : (
        <>
          <SynopsisBlock lines={synopsis} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <IntelligenceTabs activeTab={tab} tabs={tabs} />
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={() => void addClusterNote()} icon={<FileText size={12} />}>
                {busyKey === "cluster-note" ? "..." : text(locale, "메모", "Note")}
              </ActionButton>
              <ActionButton onClick={() => void updateClusterReview("ignore")}>
                {busyKey === "cluster-review:ignore" ? "..." : text(locale, "무시", "Ignore")}
              </ActionButton>
            </div>
          </div>

          {tab === "summary" ? (
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Panel title={text(locale, "Current Transition", "Current Transition")}>
                <div className="space-y-3 text-sm text-white/75">
                  <p>{detail.cluster.lastTransition?.summary ?? text(locale, "최근 전이가 아직 없다.", "No recent transition recorded yet.")}</p>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill>{reviewStateLabel(detail.cluster.reviewState, locale)}</StatusPill>
                    <StatusPill tone={detail.cluster.state === "diverging" ? "rose" : "cyan"}>{narrativeStateLabel(detail.cluster.state, locale)}</StatusPill>
                    <StatusPill>{text(locale, "우선순위", "Priority")} {detail.cluster.clusterPriorityScore}</StatusPill>
                  </div>
                  <p className="text-xs text-white/45">
                    {text(locale, "반복", "recurring")} {detail.cluster.recurringEventCount} · {text(locale, "분기", "diverging")} {detail.cluster.divergingEventCount} · {text(locale, "차단", "blocked")} {detail.cluster.recentExecutionBlockedCount}
                  </p>
                </div>
              </Panel>
              <Panel title={text(locale, "Recommended Next Action", "Recommended Next Action")}>
                <div className="space-y-3 text-sm text-white/75">
                  <p>
                    {detail.recentEvents[0]
                      ? text(locale, `최근 이벤트 "${detail.recentEvents[0].title}"를 열고, 이 서사의 검토 상태를 고정해라.`, `Open "${detail.recentEvents[0].title}" and lock the review state for this narrative.`)
                      : text(locale, "클러스터 상태를 검토로 전환하고 다음 신호를 기다려라.", "Move the cluster into review and wait for the next signal.")}
                  </p>
                  {detail.recentEvents[0] ? (
                    <ActionButton
                      href={workspace.buildHref(`/intelligence/clusters/${actualClusterId}/events/${detail.recentEvents[0].id}`, { workspace: workspace.workspaceId, tab: "summary" })}
                      tone="primary"
                      icon={<ArrowRight size={12} />}
                    >
                      {text(locale, "대표 이벤트 열기", "Open lead event")}
                    </ActionButton>
                  ) : null}
                </div>
              </Panel>
              <Panel title={text(locale, "Related Events", "Related Events")} className="xl:col-span-2">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {detail.recentEvents.map((event) => (
                    <Link
                      key={event.id}
                      href={workspace.buildHref(`/intelligence/clusters/${actualClusterId}/events/${event.id}`, { workspace: workspace.workspaceId, tab: "summary" })}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/20"
                    >
                      <p className="text-sm font-medium text-white">{event.title}</p>
                      <p className="mt-2 text-xs text-white/45">
                        {narrativeStateLabel(event.temporalNarrativeState ?? "new", locale)} · {text(locale, "반박", "contradictions")} {event.contradictionCount}
                      </p>
                      <p className="mt-2 text-sm text-white/72 line-clamp-4">{event.summary}</p>
                    </Link>
                  ))}
                </div>
              </Panel>
            </div>
          ) : null}

          {tab === "evidence" ? (
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Panel title={text(locale, "Cluster Evidence", "Cluster Evidence")}>
                <div className="grid gap-3 md:grid-cols-2">
                  <DetailBlock
                    title={text(locale, "최근 이벤트", "Recent events")}
                    locale={locale}
                    items={detail.recentEvents.map((event) => `${event.title} · ${narrativeStateLabel(event.temporalNarrativeState ?? "new", locale)} · ${text(locale, "그래프", "graph")} +${event.graphSupportScore.toFixed(2)} / -${event.graphContradictionScore.toFixed(2)}`)}
                  />
                  <DetailBlock
                    title={text(locale, "현재 전이", "Current transition")}
                    locale={locale}
                    items={detail.ledgerEntries.slice(0, 4).map((entry) => `${temporalRelationLabel(entry.entryType, locale)} · ${entry.summary} · Δ ${entry.scoreDelta.toFixed(2)}`)}
                  />
                </div>
              </Panel>
              <Panel title={text(locale, "Graph Summary", "Graph Summary")}>
                <div className="space-y-3 text-sm text-white/75">
                  <p>
                    {graph
                      ? `${text(locale, "연결 클레임", "linked claims")} ${graph.summary.linkedClaimCount} · ${text(locale, "엣지", "edges")} ${graph.summary.edgeCount}`
                      : text(locale, "그래프를 불러오는 중이거나 아직 데이터가 없다.", "Graph data is loading or not available yet.")}
                  </p>
                  {graph?.hotspot_clusters?.slice(0, 4).map((cluster) => (
                    <div key={cluster.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-sm text-white">{cluster.label}</p>
                      <p className="mt-1 text-xs text-white/45">
                        {text(locale, "핫스팟", "hotspot")} {cluster.hotspotScore.toFixed(2)} · {text(locale, "반박 엣지", "contradiction edges")} {cluster.contradictionEdgeCount}
                      </p>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          ) : null}

          {tab === "timeline" ? (
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Panel title={text(locale, "Timeline", "Timeline")}>
                <DetailBlock
                  title={text(locale, "클러스터 타임라인", "Cluster timeline")}
                  locale={locale}
                  items={timeline.map((entry) => `${formatDateTime(entry.bucketStart)} · ${text(locale, "이벤트", "events")} ${entry.eventCount} · ${text(locale, "반복", "recurring")} ${entry.recurringScore.toFixed(2)} · ${text(locale, "드리프트", "drift")} ${entry.driftScore.toFixed(2)}`)}
                />
              </Panel>
              <Panel title={text(locale, "Cluster History", "Cluster History")}>
                <DetailBlock
                  title={text(locale, "원장", "Ledger")}
                  locale={locale}
                  items={detail.ledgerEntries.map((entry) => `${temporalRelationLabel(entry.entryType, locale)} · ${entry.summary} · ${formatDateTime(entry.createdAt)}`)}
                />
                {trend ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/75">
                    <p>{text(locale, "반복 추세", "Recurring trend")} {trend.recurring_strength_trend.toFixed(2)}</p>
                    <p className="mt-2">{text(locale, "분기 추세", "Divergence trend")} {trend.divergence_trend.toFixed(2)}</p>
                  </div>
                ) : null}
              </Panel>
            </div>
          ) : null}

          {tab === "execution" ? (
            <Panel title={text(locale, "Execution Candidates", "Execution Candidates")} meta={`${recentExecutionRows.length} ${text(locale, "개", "items")}`}>
              <div className="grid gap-3 xl:grid-cols-2">
                {recentExecutionRows.length === 0 ? (
                  <EmptyPanel
                    title={text(locale, "실행 후보가 없다.", "No execution candidates.")}
                    body={text(locale, "이 서사에는 아직 실행 후보가 없다.", "This narrative does not have execution candidates yet.")}
                  />
                ) : (
                  recentExecutionRows.map((row) => (
                    <div key={row.candidate.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill tone={row.candidate.status === "blocked" ? "amber" : "emerald"}>{executionStatusLabel(row.candidate.status, locale)}</StatusPill>
                        <StatusPill>{row.candidate.riskBand}</StatusPill>
                      </div>
                      <p className="mt-3 text-sm font-medium text-white">{row.candidate.title}</p>
                      <p className="mt-2 text-sm text-white/72">{row.candidate.summary}</p>
                      {row.blockedReason ? (
                        <p className="mt-2 text-xs text-amber-200/80">
                          {text(locale, "차단 사유", "Blocked reason")} · {row.blockedReason}
                        </p>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <ActionButton
                          href={workspace.buildHref(`/intelligence/clusters/${actualClusterId}/events/${row.event.id}/execution/${row.candidate.id}`, { workspace: workspace.workspaceId })}
                          tone="primary"
                          icon={<ArrowRight size={12} />}
                        >
                          {text(locale, "세부 보기", "Open detail")}
                        </ActionButton>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          ) : null}
        </>
      )}
    </IntelligenceShell>
  );
}

export function IntelligenceEventDetailModule({ clusterId, eventId }: { clusterId: string; eventId: string }) {
  const { locale } = useLocale();
  const workspace = useIntelligenceWorkspace();
  const searchParams = useSearchParams();
  const tab = resolveTab(searchParams);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { detail, hypothesisDetail, graph, loading, error, refresh } = useEventDetail(workspace.workspaceId, eventId, locale, tab);

  const updateEventReview = useCallback(async (reviewState: EventReviewState) => {
    if (!workspace.workspaceId || !detail) return;
    const payload = await promptReviewPayload(locale, reviewState, detail.event.reviewReason, detail.event.reviewOwner);
    setBusyKey(`event-review:${reviewState}`);
    try {
      await updateIntelligenceEventReviewState(detail.event.id, {
        workspace_id: workspace.workspaceId,
        review_state: reviewState,
        ...payload,
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [detail, locale, refresh, workspace.workspaceId]);

  const runBrief = useCallback(async () => {
    if (!workspace.workspaceId || !detail) return;
    setBusyKey("event-brief");
    try {
      await bridgeIntelligenceEventToBrief({ workspace_id: workspace.workspaceId, event_id: detail.event.id });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [detail, refresh, workspace.workspaceId]);

  const runDeliberation = useCallback(async () => {
    if (!workspace.workspaceId || !detail) return;
    setBusyKey("event-deliberate");
    try {
      await deliberateIntelligenceEvent(detail.event.id, { workspace_id: workspace.workspaceId });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [detail, refresh, workspace.workspaceId]);

  const addEventNote = useCallback(async () => {
    if (!workspace.workspaceId || !detail) return;
    const note = typeof window !== "undefined"
      ? window.prompt(text(locale, "이벤트 메모를 입력해라", "Enter a note for this event"))?.trim()
      : null;
    if (!note) return;
    setBusyKey("event-note");
    try {
      await createIntelligenceOperatorNote(detail.event.id, {
        workspace_id: workspace.workspaceId,
        scope: "event",
        scope_id: null,
        note,
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [detail, locale, refresh, workspace.workspaceId]);

  const updateLinkedClaimReview = useCallback(async (linkedClaimId: string, reviewState: EventReviewState) => {
    if (!workspace.workspaceId) return;
    setBusyKey(`linked-claim:${linkedClaimId}:${reviewState}`);
    try {
      const current = detail?.linkedClaims.find((claim) => claim.id === linkedClaimId) ?? null;
      const payload = await promptReviewPayload(locale, reviewState, current?.reviewReason ?? null, current?.reviewOwner ?? null);
      await updateIntelligenceLinkedClaimReviewState(linkedClaimId, {
        workspace_id: workspace.workspaceId,
        review_state: reviewState,
        ...payload,
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [detail?.linkedClaims, locale, refresh, workspace.workspaceId]);

  const addLinkedClaimNote = useCallback(async (linkedClaimId: string) => {
    if (!workspace.workspaceId || !detail) return;
    const note = typeof window !== "undefined"
      ? window.prompt(text(locale, "연결 클레임 메모를 입력해라", "Enter a note for this linked claim"))?.trim()
      : null;
    if (!note) return;
    setBusyKey(`linked-note:${linkedClaimId}`);
    try {
      await createIntelligenceOperatorNote(detail.event.id, {
        workspace_id: workspace.workspaceId,
        scope: "linked_claim",
        scope_id: linkedClaimId,
        note,
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [detail, locale, refresh, workspace.workspaceId]);

  const tabs = useMemo(() => (
    [
      { key: "summary", label: text(locale, "요약", "Summary"), href: workspace.buildHref(`/intelligence/clusters/${clusterId}/events/${eventId}`, { workspace: workspace.workspaceId, tab: "summary" }) },
      { key: "evidence", label: text(locale, "근거", "Evidence"), href: workspace.buildHref(`/intelligence/clusters/${clusterId}/events/${eventId}`, { workspace: workspace.workspaceId, tab: "evidence" }) },
      { key: "timeline", label: text(locale, "시간축", "Timeline"), href: workspace.buildHref(`/intelligence/clusters/${clusterId}/events/${eventId}`, { workspace: workspace.workspaceId, tab: "timeline" }) },
      { key: "execution", label: text(locale, "실행", "Execution"), href: workspace.buildHref(`/intelligence/clusters/${clusterId}/events/${eventId}`, { workspace: workspace.workspaceId, tab: "execution" }) },
    ] as Array<{ key: IntelligenceDetailTab; label: string; href: string }>
  ), [clusterId, eventId, locale, workspace]);

  const actualClusterId = detail?.narrativeCluster?.id ?? detail?.event.narrativeClusterId ?? clusterId;
  const synopsis = detail ? buildEventSynopsis(locale, detail.event, detail, hypothesisDetail) : [];
  const evidenceExplainer = detail ? buildEvidenceExplainer(locale, detail, detail.event, hypothesisDetail, graph) : [];

  return (
    <IntelligenceShell
      title={text(locale, "Event Detail", "Event Detail")}
      description={text(
        locale,
        "이벤트 상세는 무엇을 읽어야 하는지 먼저 알려주고, 그 다음에 근거와 시간축, 실행으로 내려간다.",
        "Event detail leads with what to read first, why it matters, and only then opens evidence, timeline, and execution.",
      )}
      workspaceId={workspace.workspaceId}
      workspaces={workspace.workspaces}
      buildHref={workspace.buildHref}
      onWorkspaceChange={workspace.setWorkspaceSelection}
      onRefresh={() => {
        void workspace.refreshWorkspaces();
        void refresh();
      }}
      loading={loading || workspace.loadingWorkspace}
      error={error ?? workspace.workspaceError}
      breadcrumb={
        <BreadcrumbChain
          items={[
            { label: detail?.narrativeCluster?.title ?? text(locale, "Narrative Cluster", "Narrative Cluster"), href: workspace.buildHref(`/intelligence/clusters/${actualClusterId}`, { workspace: workspace.workspaceId, tab: "summary" }) },
            { label: detail?.event.title ?? text(locale, "Event", "Event"), href: workspace.buildHref(`/intelligence/clusters/${actualClusterId}/events/${eventId}`, { workspace: workspace.workspaceId, tab: "summary" }) },
            { label: detail?.event.primaryHypotheses[0]?.title ?? text(locale, "Primary Hypothesis", "Primary Hypothesis") },
            { label: `${detail?.linkedClaims.length ?? 0} ${text(locale, "Key Claims", "Key Claims")}` },
            { label: detail?.event.executionCandidates[0]?.title ?? text(locale, "Execution", "Execution") },
          ]}
        />
      }
      right={
        detail ? (
          <>
            <ActionButton onClick={() => void runDeliberation()} tone="primary" icon={<BrainCircuit size={12} />}>
              {busyKey === "event-deliberate" ? "..." : text(locale, "토론", "Deliberate")}
            </ActionButton>
            <ActionButton onClick={() => void runBrief()} icon={<Send size={12} />}>
              {busyKey === "event-brief" ? "..." : text(locale, "브리프 생성", "Generate brief")}
            </ActionButton>
          </>
        ) : null
      }
    >
      {!detail ? (
        <EmptyPanel
          title={text(locale, "이벤트를 찾을 수 없다.", "Event not found.")}
          body={text(locale, "현재 워크스페이스에서 이 이벤트를 찾지 못했다.", "The event could not be found in the selected workspace.")}
        />
      ) : (
        <>
          <SynopsisBlock lines={synopsis} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <IntelligenceTabs activeTab={tab} tabs={tabs} />
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={() => void addEventNote()} icon={<FileText size={12} />}>
                {busyKey === "event-note" ? "..." : text(locale, "메모", "Note")}
              </ActionButton>
              <ActionButton onClick={() => void updateEventReview("review")} tone="primary">
                {busyKey === "event-review:review" ? "..." : text(locale, "검토 상태", "Set review")}
              </ActionButton>
            </div>
          </div>

          {tab === "summary" ? (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <Panel title={text(locale, "Why It Matters", "Why It Matters")}>
                <div className="space-y-3 text-sm text-white/75">
                  <p>{detail.event.summary}</p>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill>{reviewStateLabel(detail.event.reviewState, locale)}</StatusPill>
                    <StatusPill tone={detail.event.temporalNarrativeState === "diverging" ? "rose" : "cyan"}>
                      {narrativeStateLabel(detail.event.temporalNarrativeState ?? "new", locale)}
                    </StatusPill>
                    <StatusPill>{detail.event.riskBand}</StatusPill>
                  </div>
                  <p className="text-xs text-white/45">
                    {text(locale, "클레임", "claims")} {detail.event.linkedClaimCount} · {text(locale, "반박", "contradictions")} {detail.event.contradictionCount} · {text(locale, "우선순위", "priority")} {detail.event.operatorPriorityScore ?? 0}
                  </p>
                </div>
              </Panel>
              <Panel title={text(locale, "Review Controls", "Review Controls")}>
                <div className="flex flex-wrap gap-2">
                  {(["watch", "review", "ignore"] as EventReviewState[]).map((state) => (
                    <ActionButton key={state} onClick={() => void updateEventReview(state)} tone={state === "review" ? "primary" : "neutral"}>
                      {busyKey === `event-review:${state}` ? "..." : reviewStateLabel(state, locale)}
                    </ActionButton>
                  ))}
                </div>
              </Panel>
            </div>
          ) : null}

          {tab === "evidence" ? (
            <div className="grid gap-6">
              <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <Panel title={text(locale, "Hypotheses & Claims", "Hypotheses & Claims")}>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <DetailBlock
                      title={text(locale, "주 가설", "Primary hypothesis")}
                      locale={locale}
                      items={detail.event.primaryHypotheses.map((row) => `${row.title} · ${row.summary}`)}
                    />
                    <DetailBlock
                      title={text(locale, "대안 가설", "Counter hypothesis")}
                      locale={locale}
                      items={detail.event.counterHypotheses.map((row) => `${row.title} · ${row.summary}`)}
                    />
                    <DetailBlock
                      title={text(locale, "Linked Claims", "Linked Claims")}
                      locale={locale}
                      items={detail.linkedClaims.map((row) => `${row.canonicalSubject} ${row.canonicalPredicate} ${row.canonicalObject} · ${text(locale, "반박", "contradictions")} ${row.contradictionCount}`)}
                    />
                    <DetailBlock
                      title={text(locale, "Evidence Summary", "Evidence Summary")}
                      locale={locale}
                      items={(hypothesisDetail?.evidenceSummary ?? []).map((row) => `${row.hypothesis_id.slice(0, 8)} · ${text(locale, "지지", "support")} ${row.support_count}/${row.support_strength.toFixed(2)} · ${text(locale, "반박", "contradiction")} ${row.contradict_count}/${row.contradict_strength.toFixed(2)}`)}
                    />
                  </div>
                </Panel>
                <Panel title={text(locale, "Evidence Explainer", "Evidence Explainer")}>
                  <div className="space-y-4">
                    {evidenceExplainer.map((group) => (
                      <div key={group.label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{group.label}</p>
                        <div className="mt-3 space-y-2">
                          {group.items.map((item) => (
                            <p key={item} className="text-sm text-white/78">{item}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
              <ClaimGraphPanel
                locale={locale}
                graph={graph}
                onNoteClick={(linkedClaimId) => void addLinkedClaimNote(linkedClaimId)}
                onReviewStateChange={(linkedClaimId, reviewState) => void updateLinkedClaimReview(linkedClaimId, reviewState)}
                busyKey={busyKey}
              />
            </div>
          ) : null}

          {tab === "timeline" ? (
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Panel title={text(locale, "Timeline", "Timeline")}>
                <DetailBlock
                  title={text(locale, "Temporal Ledger", "Temporal Ledger")}
                  locale={locale}
                  items={detail.temporalNarrativeLedger.map((row) => `${temporalRelationLabel(row.relation, locale)} · ${row.relatedEventTitle} · ${formatDateTime(row.updatedAt)}`)}
                />
              </Panel>
              <Panel title={text(locale, "Narrative History", "Narrative History")}>
                <DetailBlock
                  title={text(locale, "Related Narratives", "Related narratives")}
                  locale={locale}
                  items={detail.relatedHistoricalEvents.map((row) => `${row.title} · ${temporalRelationLabel(row.relation, locale)} · ${text(locale, "점수", "score")} ${row.score.toFixed(2)}`)}
                />
              </Panel>
            </div>
          ) : null}

          {tab === "execution" ? (
            <Panel title={text(locale, "Execution Candidates", "Execution Candidates")} meta={`${detail.event.executionCandidates.length} ${text(locale, "개", "items")}`}>
              <div className="grid gap-3 xl:grid-cols-2">
                {detail.event.executionCandidates.length === 0 ? (
                  <EmptyPanel
                    title={text(locale, "실행 후보가 없다.", "No execution candidates.")}
                    body={text(locale, "이 이벤트에는 아직 실행 후보가 없다.", "This event does not have execution candidates yet.")}
                  />
                ) : (
                  detail.event.executionCandidates.map((candidate) => (
                    <div key={candidate.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill tone={candidate.status === "blocked" ? "amber" : "emerald"}>{executionStatusLabel(candidate.status, locale)}</StatusPill>
                        <StatusPill>{candidate.riskBand}</StatusPill>
                      </div>
                      <p className="mt-3 text-sm font-medium text-white">{candidate.title}</p>
                      <p className="mt-2 text-sm text-white/72">{candidate.summary}</p>
                      {describeBlockedReason(locale, candidate) ? (
                        <p className="mt-2 text-xs text-amber-200/80">
                          {text(locale, "차단 사유", "Blocked reason")} · {describeBlockedReason(locale, candidate)}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-white/45">
                        {hypothesisDetail?.expectedSignalEntries.filter((row) => row.status === "absent").length ?? detail.expectedSignalEntries.filter((row) => row.status === "absent").length} {text(locale, "필요 신호 대기", "required signals waiting")}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <ActionButton
                          href={workspace.buildHref(`/intelligence/clusters/${actualClusterId}/events/${detail.event.id}/execution/${candidate.id}`, { workspace: workspace.workspaceId })}
                          tone="primary"
                          icon={<Play size={12} />}
                        >
                          {text(locale, candidate.status === "blocked" ? "차단 사유 보기" : "실행", candidate.status === "blocked" ? "View blocked reason" : "Run")}
                        </ActionButton>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          ) : null}
        </>
      )}
    </IntelligenceShell>
  );
}

export function IntelligenceExecutionDetailModule({
  clusterId,
  eventId,
  candidateId,
}: {
  clusterId: string;
  eventId: string;
  candidateId: string;
}) {
  const { locale } = useLocale();
  const workspace = useIntelligenceWorkspace();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { detail, loading, error, refresh } = useExecutionDetail(workspace.workspaceId, eventId, locale);
  const candidate = detail?.event.executionCandidates.find((item) => item.id === candidateId) ?? null;
  const actualClusterId = detail?.narrativeCluster?.id ?? detail?.event.narrativeClusterId ?? clusterId;

  const runExecution = useCallback(async () => {
    if (!workspace.workspaceId || !detail || !candidate) return;
    setBusyKey("execute");
    try {
      await executeIntelligenceEvent(detail.event.id, {
        workspace_id: workspace.workspaceId,
        candidate_id: candidate.id,
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [candidate, detail, refresh, workspace.workspaceId]);

  const synopsis = detail && candidate
    ? [
        {
          label: text(locale, "이 실행은 무엇인가", "What is this execution"),
          value: candidate.summary,
        },
        {
          label: text(locale, "왜 지금 중요한가", "Why it matters now"),
          value: text(locale, `${detail.event.title}의 다음 행동이며 위험도는 ${candidate.riskBand}다.`, `This is the next action proposed for ${detail.event.title} and carries ${candidate.riskBand} risk.`),
        },
        {
          label: text(locale, "가장 유력한 해석", "Leading interpretation"),
          value: detail.event.primaryHypotheses[0]?.summary ?? text(locale, "주 가설이 아직 명확하지 않다.", "The primary hypothesis is not stable yet."),
        },
        {
          label: text(locale, "지금 필요한 행동", "Next required action"),
          value: candidate.status === "blocked"
            ? text(locale, `${describeBlockedReason(locale, candidate) ?? text(locale, "차단 사유를 먼저 해소해야 한다.", "Resolve the blocked reason before running.")}`, describeBlockedReason(locale, candidate) ?? "Resolve the blocked reason before running.")
            : text(locale, "실행 전 필요한 신호를 확인한 뒤 실행한다.", "Verify required signals, then run."),
        },
      ]
    : [];

  return (
    <IntelligenceShell
      title={text(locale, "Execution Detail", "Execution Detail")}
      description={text(
        locale,
        "실행 상세는 이 후보를 왜 지금 실행하면 되는지 또는 왜 막혀 있는지를 명확하게 보여줘야 한다.",
        "Execution detail should make it obvious why this candidate can run now or why it is blocked.",
      )}
      workspaceId={workspace.workspaceId}
      workspaces={workspace.workspaces}
      buildHref={workspace.buildHref}
      onWorkspaceChange={workspace.setWorkspaceSelection}
      onRefresh={() => {
        void workspace.refreshWorkspaces();
        void refresh();
      }}
      loading={loading || workspace.loadingWorkspace}
      error={error ?? workspace.workspaceError}
      breadcrumb={
        <BreadcrumbChain
          items={[
            { label: detail?.narrativeCluster?.title ?? text(locale, "Narrative Cluster", "Narrative Cluster"), href: workspace.buildHref(`/intelligence/clusters/${actualClusterId}`, { workspace: workspace.workspaceId, tab: "summary" }) },
            { label: detail?.event.title ?? text(locale, "Event", "Event"), href: workspace.buildHref(`/intelligence/clusters/${actualClusterId}/events/${eventId}`, { workspace: workspace.workspaceId, tab: "summary" }) },
            { label: detail?.event.primaryHypotheses[0]?.title ?? text(locale, "Primary Hypothesis", "Primary Hypothesis") },
            { label: `${detail?.linkedClaims.length ?? 0} ${text(locale, "Key Claims", "Key Claims")}` },
            { label: candidate?.title ?? text(locale, "Execution", "Execution") },
          ]}
        />
      }
      right={
        candidate ? (
          <>
            <ActionButton onClick={() => void runExecution()} tone="primary" icon={<Play size={12} />} disabled={candidate.status === "executed" || candidate.status === "blocked"}>
              {busyKey === "execute" ? "..." : text(locale, "실행", "Run")}
            </ActionButton>
            {describeBlockedReason(locale, candidate) ? (
              <ActionButton href="#blocked-reason" icon={<ArrowRight size={12} />}>
                {text(locale, "차단 사유 보기", "View blocked reason")}
              </ActionButton>
            ) : null}
          </>
        ) : null
      }
    >
      {!detail || !candidate ? (
        <EmptyPanel
          title={text(locale, "실행 후보를 찾을 수 없다.", "Execution candidate not found.")}
          body={text(locale, "현재 워크스페이스에서 이 실행 후보를 찾지 못했다.", "The execution candidate could not be found in the selected workspace.")}
        />
      ) : (
        <>
          <SynopsisBlock lines={synopsis} />
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel title={text(locale, "Execution Candidate", "Execution Candidate")}>
              <div className="space-y-3 text-sm text-white/75">
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={candidate.status === "blocked" ? "amber" : "emerald"}>{executionStatusLabel(candidate.status, locale)}</StatusPill>
                  <StatusPill>{candidate.executionMode}</StatusPill>
                  <StatusPill>{candidate.riskBand}</StatusPill>
                </div>
                <p>{candidate.summary}</p>
                <p className="text-xs text-white/45">
                  {text(locale, "생성", "created")} {formatDateTime(candidate.createdAt)} · {text(locale, "업데이트", "updated")} {formatDateTime(candidate.updatedAt)}
                </p>
              </div>
            </Panel>
            <Panel title={text(locale, "Required Next Signals", "Required Next Signals")}>
              <DetailBlock
                title={text(locale, "대기 신호", "Waiting signals")}
                locale={locale}
                items={detail.expectedSignalEntries.length > 0
                  ? detail.expectedSignalEntries.map((row) => `${row.signalKey} · ${genericStatusLabel(row.status, locale)} · ${row.description}`)
                  : [text(locale, "기다리는 신호가 없다.", "No pending signals.")]}
              />
            </Panel>
            <Panel title={text(locale, "Blocked Reason", "Blocked Reason")} className="xl:col-span-2">
              <div id="blocked-reason" className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/78">
                {describeBlockedReason(locale, candidate) ?? text(locale, "현재 차단 사유가 없다.", "There is no active blocked reason.")}
              </div>
            </Panel>
            <Panel title={text(locale, "Event Context", "Event Context")} className="xl:col-span-2">
              <div className="grid gap-4 lg:grid-cols-2">
                <DetailBlock
                  title={text(locale, "현재 해석", "Current interpretation")}
                  locale={locale}
                  items={detail.event.primaryHypotheses.map((row) => `${row.title} · ${row.summary}`)}
                />
                <DetailBlock
                  title={text(locale, "실행 감사 로그", "Execution audit")}
                  locale={locale}
                  items={detail.executionAudit.map((row) => `${genericStatusLabel(row.status, locale)} · ${row.summary} · ${formatDateTime(row.createdAt)}`)}
                />
              </div>
            </Panel>
          </div>
        </>
      )}
    </IntelligenceShell>
  );
}
