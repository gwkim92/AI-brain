"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, BrainCircuit, Cable, ChevronDown, ChevronRight, Play, RefreshCw, ScanSearch, Send, ShieldCheck } from "lucide-react";

import { useLocale } from "@/components/providers/LocaleProvider";
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
  listIntelligenceStaleEvents,
  bulkRebuildIntelligenceEvents,
  listIntelligenceRuntimeAliases,
  listIntelligenceRuntimeModels,
  listIntelligenceRuns,
  listIntelligenceSources,
  listIntelligenceWorkspaces,
  rebuildIntelligenceEventById,
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
  IntelligenceBulkEventRebuildResult,
  IntelligenceEventRebuildResult,
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
  IntelligenceStaleMaintenanceWorkerRun,
  IntelligenceTemporalNarrativeLedgerEntryRecord,
  IntelligenceSemanticWorkerRun,
  IntelligenceScanRunRecord,
  IntelligenceSourceRecord,
  IntelligenceStaleEventPreview,
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

function formatDateTime(value: string | null | undefined, emptyLabel = "—"): string {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const localeTag =
    typeof document !== "undefined" && document.documentElement.lang
      ? document.documentElement.lang
      : undefined;
  return new Intl.DateTimeFormat(localeTag, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type IntelligenceCopy = {
  titleEyebrow: string;
  title: string;
  subtitle: string;
  runtimeReady: string;
  loadingRuntime: string;
  refresh: string;
  newWorkspace: string;
  stats: {
    sources: string;
    loadedEvents: string;
    pendingExec: string;
    semantic: string;
    stale: string;
    backlog: string;
    models: string;
    sync: string;
  };
  sections: {
    sources: string;
    events: string;
    eventDetail: string;
    recentRuns: string;
    fetchFailures: string;
    reviewQueue: string;
    clusterInbox: string;
    hypothesisDrift: string;
    executionInbox: string;
  };
  explainer: {
    heading: string;
    loadedEvents: string;
    backlog: string;
    primary: string;
    counter: string;
    invalidation: string;
    expectedSignals: string;
  };
  empty: string;
  selectedEventEmpty: string;
  noReviewItems: string;
  noExecutionCandidates: string;
};

function getIntelligenceCopy(locale: "ko" | "en"): IntelligenceCopy {
  if (locale === "en") {
    return {
      titleEyebrow: "Autonomous Intelligence Plane",
      title: "Independent Scanner and Reasoning Plane",
      subtitle:
        "A separate event-tracking system from JARVIS. It scans registered sources, groups documents into events, and produces hypotheses and execution candidates through the semantic layer.",
      runtimeReady: "Runtime snapshot ready",
      loadingRuntime: "Loading intelligence plane...",
      refresh: "Refresh",
      newWorkspace: "New Workspace",
      stats: {
        sources: "Sources",
        loadedEvents: "Loaded Events",
        pendingExec: "Pending Exec",
        semantic: "Semantic",
        stale: "Stale",
        backlog: "Semantic Backlog",
        models: "Models",
        sync: "Sync",
      },
      sections: {
        sources: "Sources",
        events: "Events",
        eventDetail: "Event Detail",
        recentRuns: "Recent Runs",
        fetchFailures: "Fetch Failures",
        reviewQueue: "Review Queue",
        clusterInbox: "Narrative Cluster Inbox",
        hypothesisDrift: "Hypothesis Drift",
        executionInbox: "Execution Inbox",
      },
      explainer: {
        heading: "What these numbers mean",
        loadedEvents: "Loaded Events: the latest 50 events currently fetched for this workspace, not the total database count.",
        backlog: "Semantic Backlog: signals waiting for semantic processing and claim linking.",
        primary: "Primary: the system's current main hypothesis.",
        counter: "Counter: the strongest competing explanation.",
        invalidation: "Invalidation: conditions that weaken or break the current hypothesis.",
        expectedSignals: "Expected Signals: observations the system expects next if the hypothesis is right.",
      },
      empty: "No data",
      selectedEventEmpty: "Select an event on the left to inspect hypotheses, counter-hypotheses, invalidation, and execution candidates.",
      noReviewItems: "No items in review queue",
      noExecutionCandidates: "No execution candidates",
    };
  }
  return {
    titleEyebrow: "자율 인텔리전스 평면",
    title: "독립 스캐너와 추론 평면",
    subtitle:
      "기존 JARVIS와 분리된 이벤트 추적 시스템이다. 등록된 소스를 주기적으로 훑고, 문서를 사건으로 묶고, 시맨틱 계층을 거쳐 가설과 실행 후보까지 만든다.",
    runtimeReady: "런타임 스냅샷 준비 완료",
    loadingRuntime: "인텔리전스 평면을 불러오는 중...",
    refresh: "새로고침",
    newWorkspace: "새 워크스페이스",
    stats: {
      sources: "소스",
      loadedEvents: "불러온 이벤트",
      pendingExec: "대기 실행",
      semantic: "시맨틱",
      stale: "정리",
      backlog: "시맨틱 백로그",
      models: "모델",
      sync: "동기화",
    },
    sections: {
      sources: "소스",
      events: "이벤트",
      eventDetail: "이벤트 상세",
      recentRuns: "최근 실행",
      fetchFailures: "수집 실패",
      reviewQueue: "검토 큐",
      clusterInbox: "서사 클러스터 인박스",
      hypothesisDrift: "가설 드리프트",
      executionInbox: "실행 인박스",
    },
    explainer: {
      heading: "현재 숫자 의미",
      loadedEvents: "불러온 이벤트: 이 워크스페이스에서 지금 화면에 가져온 최신 50개 이벤트다. DB 전체 개수는 아니다.",
      backlog: "시맨틱 백로그: 시맨틱 처리와 클레임 연결을 아직 기다리는 신호 수다.",
      primary: "주 가설: 시스템이 현재 가장 유력하게 보는 설명이다.",
      counter: "대안 가설: 주 가설과 경쟁하는 다른 설명이다.",
      invalidation: "무효화 조건: 현재 가설을 약화시키거나 깨는 조건이다.",
      expectedSignals: "예상 신호: 가설이 맞다면 다음에 보여야 하는 관측 신호다.",
    },
    empty: "데이터 없음",
    selectedEventEmpty: "좌측 이벤트를 선택하면 주 가설, 대안 가설, 무효화 조건, 실행 후보를 볼 수 있다.",
    noReviewItems: "검토 큐 항목이 없다",
    noExecutionCandidates: "실행 후보가 없다",
  };
}

function reviewStateLabel(state: EventReviewState, locale: "ko" | "en"): string {
  if (locale === "ko") {
    if (state === "watch") return "주시";
    if (state === "review") return "검토";
    return "무시";
  }
  return state;
}

function text(locale: "ko" | "en", ko: string, en: string): string {
  return locale === "ko" ? ko : en;
}

function narrativeStateLabel(state: string | null | undefined, locale: "ko" | "en"): string {
  if (!state) return locale === "ko" ? "없음" : "none";
  if (locale === "ko") {
    if (state === "forming") return "형성중";
    if (state === "recurring") return "반복";
    if (state === "diverging") return "분기";
    if (state === "new") return "신규";
  }
  return state;
}

function temporalRelationLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    recurring: { ko: "반복", en: "recurring" },
    diverging: { ko: "분기", en: "diverging" },
    supportive_history: { ko: "지지 이력", en: "supportive history" },
    merge: { ko: "병합", en: "merge" },
    split: { ko: "분리", en: "split" },
    recurring_strengthened: { ko: "반복 강화", en: "recurring strengthened" },
    diverging_strengthened: { ko: "분기 강화", en: "diverging strengthened" },
    supportive_history_added: { ko: "지지 이력 추가", en: "supportive history added" },
    stability_drop: { ko: "안정성 하락", en: "stability drop" },
    latest: { ko: "최신", en: "latest" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function graphRelationLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    supports: { ko: "지지", en: "supports" },
    contradicts: { ko: "반박", en: "contradicts" },
    related: { ko: "관련", en: "related" },
    same: { ko: "동일", en: "same" },
    supporting: { ko: "보강", en: "supporting" },
    contradicting: { ko: "반박", en: "contradicting" },
    unrelated: { ko: "무관", en: "unrelated" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function executionStatusLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    pending: { ko: "대기", en: "pending" },
    approved: { ko: "승인", en: "approved" },
    blocked: { ko: "차단", en: "blocked" },
    executed: { ko: "실행됨", en: "executed" },
    failed: { ko: "실패", en: "failed" },
    proposal: { ko: "제안", en: "proposal" },
    proceed: { ko: "진행", en: "proceed" },
    hold: { ko: "보류", en: "hold" },
    reject: { ko: "거절", en: "reject" },
    active: { ko: "활성", en: "active" },
    inactive: { ko: "비활성", en: "inactive" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function workerStatusLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    ok: { ko: "정상", en: "ok" },
    degraded: { ko: "저하", en: "degraded" },
    failed: { ko: "실패", en: "failed" },
    scanning: { ko: "스캔중", en: "scanning" },
    stable: { ko: "안정", en: "stable" },
    on: { ko: "켜짐", en: "on" },
    off: { ko: "꺼짐", en: "off" },
    available: { ko: "사용 가능", en: "available" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function sourceKindLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    rss: { ko: "RSS", en: "RSS" },
    atom: { ko: "Atom", en: "Atom" },
    json: { ko: "JSON", en: "JSON" },
    api: { ko: "API", en: "API" },
    search: { ko: "검색", en: "search" },
    headless: { ko: "브라우저", en: "headless" },
    mcp_connector: { ko: "MCP 커넥터", en: "MCP connector" },
    synthetic: { ko: "합성", en: "synthetic" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function sourceTypeLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    news: { ko: "뉴스", en: "news" },
    filing: { ko: "공시", en: "filing" },
    policy: { ko: "정책", en: "policy" },
    market_tick: { ko: "시장 틱", en: "market tick" },
    freight: { ko: "운임", en: "freight" },
    inventory: { ko: "재고", en: "inventory" },
    blog: { ko: "블로그", en: "blog" },
    forum: { ko: "포럼", en: "forum" },
    social: { ko: "소셜", en: "social" },
    search_result: { ko: "검색 결과", en: "search result" },
    web_page: { ko: "웹 페이지", en: "web page" },
    manual: { ko: "수동", en: "manual" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function sourceTierLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    tier_0: { ko: "티어 0", en: "tier 0" },
    tier_1: { ko: "티어 1", en: "tier 1" },
    tier_2: { ko: "티어 2", en: "tier 2" },
    tier_3: { ko: "티어 3", en: "tier 3" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function eventFamilyLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    geopolitical_flashpoint: { ko: "지정학 충돌", en: "geopolitical flashpoint" },
    policy_change: { ko: "정책 변화", en: "policy change" },
    earnings_guidance: { ko: "실적 가이던스", en: "earnings guidance" },
    supply_chain_shift: { ko: "공급망 변화", en: "supply chain shift" },
    rate_repricing: { ko: "금리 재평가", en: "rate repricing" },
    commodity_move: { ko: "원자재 변동", en: "commodity move" },
    platform_ai_shift: { ko: "플랫폼/AI 변화", en: "platform AI shift" },
    general_signal: { ko: "일반 신호", en: "general signal" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function domainLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "알수없음" : "unknown";
  const labels: Record<string, { ko: string; en: string }> = {
    geopolitics_energy_lng: { ko: "지정학·에너지·LNG", en: "geopolitics · energy · LNG" },
    macro_rates_inflation_fx: { ko: "거시·금리·인플레·환율", en: "macro · rates · inflation · FX" },
    shipping_supply_chain: { ko: "해운·공급망", en: "shipping · supply chain" },
    policy_regulation_platform_ai: { ko: "정책·규제·플랫폼·AI", en: "policy · regulation · platform · AI" },
    company_earnings_guidance: { ko: "기업 실적·가이던스", en: "company earnings · guidance" },
    commodities_raw_materials: { ko: "원자재·상품", en: "commodities · raw materials" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function capabilityAliasLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    fast_triage: { ko: "빠른 분류", en: "fast triage" },
    structured_extraction: { ko: "구조화 추출", en: "structured extraction" },
    cross_doc_linking: { ko: "문서 간 연결", en: "cross-document linking" },
    skeptical_critique: { ko: "비판 검토", en: "skeptical critique" },
    deep_synthesis: { ko: "심층 합성", en: "deep synthesis" },
    policy_judgment: { ko: "정책 판단", en: "policy judgment" },
    deep_research: { ko: "심층 리서치", en: "deep research" },
    execution_planning: { ko: "실행 계획", en: "execution planning" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function providerLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    openai: { ko: "OpenAI", en: "OpenAI" },
    gemini: { ko: "Gemini", en: "Gemini" },
    anthropic: { ko: "Anthropic", en: "Anthropic" },
    local: { ko: "로컬", en: "local" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function hypothesisKindLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    primary: { ko: "주 가설", en: "primary" },
    counter: { ko: "대안 가설", en: "counter" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function bridgeKindLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    council: { ko: "토론", en: "council" },
    brief: { ko: "브리프", en: "brief" },
    action: { ko: "액션", en: "action" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function genericStatusLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    pending: { ko: "대기", en: "pending" },
    blocked: { ko: "차단", en: "blocked" },
    executed: { ko: "실행됨", en: "executed" },
    failed: { ko: "실패", en: "failed" },
    proposal: { ko: "제안", en: "proposal" },
    active: { ko: "활성", en: "active" },
    inactive: { ko: "비활성", en: "inactive" },
    hit: { ko: "적중", en: "hit" },
    missed: { ko: "미적중", en: "missed" },
    observed: { ko: "관측됨", en: "observed" },
    absent: { ko: "부재", en: "absent" },
    completed: { ko: "완료", en: "completed" },
    superseded: { ko: "대체됨", en: "superseded" },
    weakened: { ko: "약화", en: "weakened" },
    invalidated: { ko: "무효화", en: "invalidated" },
    confirmed: { ko: "확인됨", en: "confirmed" },
    mixed: { ko: "혼합", en: "mixed" },
    unresolved: { ko: "미해결", en: "unresolved" },
    dispatched: { ko: "전달됨", en: "dispatched" },
  };
  const row = labels[value];
  return row ? row[locale] : value;
}

function readBlockedReason(candidate: IntelligenceEventClusterRecord["executionCandidates"][number]): string | null {
  const blockedReason = candidate.resultJson?.blocked_reason;
  return typeof blockedReason === "string" && blockedReason.length > 0 ? blockedReason : null;
}

type RuntimeSnapshot = {
  scannerWorker: IntelligenceWorkerStatus<IntelligenceScannerWorkerRun> | null;
  semanticWorker: IntelligenceWorkerStatus<IntelligenceSemanticWorkerRun> | null;
  staleMaintenanceWorker: IntelligenceWorkerStatus<IntelligenceStaleMaintenanceWorkerRun> | null;
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
  const { locale } = useLocale();
  const copy = useMemo(() => getIntelligenceCopy(locale), [locale]);
  const [workspaces, setWorkspaces] = useState<IntelligenceWorkspaceRecord[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [sources, setSources] = useState<IntelligenceSourceRecord[]>([]);
  const [runs, setRuns] = useState<IntelligenceScanRunRecord[]>([]);
  const [fetchFailures, setFetchFailures] = useState<IntelligenceFetchFailureRecord[]>([]);
  const [staleEvents, setStaleEvents] = useState<IntelligenceStaleEventPreview[]>([]);
  const [lastRebuildResult, setLastRebuildResult] = useState<IntelligenceEventRebuildResult | null>(null);
  const [lastBulkRebuildResult, setLastBulkRebuildResult] = useState<IntelligenceBulkEventRebuildResult | null>(null);
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
    staleMaintenanceWorker: null,
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
  const [metricHelpOpen, setMetricHelpOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState({
    sources: true,
    events: true,
    eventDetail: true,
    recentRuns: true,
    fetchFailures: false,
    reviewQueue: true,
    clusterInbox: true,
    hypothesisDrift: false,
    executionInbox: true,
  });

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
        setStaleEvents([]);
        setLastRebuildResult(null);
        setEvents([]);
        setSelectedEvent(null);
        setSelectedEventDetail(null);
        setSelectedHypothesisDetail(null);
        setSelectedNarrativeClusterTrendSummary(null);
        setRuntime({
          scannerWorker: null,
          semanticWorker: null,
          staleMaintenanceWorker: null,
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

      const [sourceData, runData, eventData, clusterData, modelData, aliasData, failureData, staleData] = await Promise.all([
        listIntelligenceSources({ workspace_id: resolvedWorkspaceId }),
        listIntelligenceRuns({ workspace_id: resolvedWorkspaceId, limit: 20 }),
        listIntelligenceEvents({ workspace_id: resolvedWorkspaceId, limit: 50 }),
        listIntelligenceNarrativeClusters({ workspace_id: resolvedWorkspaceId, limit: 50 }),
        listIntelligenceRuntimeModels({ workspace_id: resolvedWorkspaceId }),
        listIntelligenceRuntimeAliases({ workspace_id: resolvedWorkspaceId }),
        listIntelligenceFetchFailures({ workspace_id: resolvedWorkspaceId, limit: 20 }),
        listIntelligenceStaleEvents({ workspace_id: resolvedWorkspaceId, limit: 20 }),
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
      setStaleEvents(staleData.stale_events);
      setEvents(eventData.events);
      setNarrativeClusters(clusterData.narrative_clusters);
      setSelectedEventId(nextSelectedEventId);
      setSelectedNarrativeClusterId(nextSelectedClusterId);
      setRuntime({
        scannerWorker: sourceData.scanner_worker,
        semanticWorker: sourceData.semantic_worker,
        staleMaintenanceWorker: runData.stale_maintenance_worker,
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
        setError(text(locale, "인텔리전스 평면을 불러오지 못했다.", "Failed to load intelligence plane."));
      }
    } finally {
      setLoading(false);
    }
  }, [locale, selectedEventId, selectedNarrativeClusterId]);

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
        setError(text(locale, "이벤트 상세를 불러오지 못했다.", "Failed to load event detail."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [locale, workspaceId]);

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
        setError(text(locale, "서사 클러스터 상세를 불러오지 못했다.", "Failed to load narrative cluster detail."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [locale, workspaceId]);

  const rebuildEventAction = useCallback(async (eventId: string) => {
    if (!workspaceId) return;
    setBusyKey(`event-rebuild:${eventId}`);
    try {
      const response = await rebuildIntelligenceEventById(eventId, {
        workspace_id: workspaceId,
      });
      setLastRebuildResult(response.result);
      await loadWorkspaceBundle(workspaceId);
      if (response.result.rebuiltEventId) {
        await selectEvent(response.result.rebuiltEventId);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(text(locale, "오래된 이벤트를 다시 빌드하지 못했다.", "Failed to rebuild stale event."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale, selectEvent, workspaceId]);

  const bulkRebuildStaleEventsAction = useCallback(async () => {
    if (!workspaceId || staleEvents.length === 0) return;
    setBusyKey("stale-bulk-rebuild");
    try {
      const eventIds = staleEvents.slice(0, 5).map((event) => event.eventId);
      const response = await bulkRebuildIntelligenceEvents({
        workspace_id: workspaceId,
        event_ids: eventIds,
        limit: eventIds.length,
      });
      setLastBulkRebuildResult(response.result);
      if (response.result.results.length > 0) {
        setLastRebuildResult(response.result.results.at(-1) ?? null);
      }
      await loadWorkspaceBundle(workspaceId);
      const firstRebuiltEventId = response.result.results.find((row) => row.rebuiltEventId)?.rebuiltEventId ?? null;
      if (firstRebuiltEventId) {
        await selectEvent(firstRebuiltEventId);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(text(locale, "오래된 이벤트 일괄 재빌드에 실패했다.", "Failed to bulk rebuild stale events."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale, selectEvent, staleEvents, workspaceId]);

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
        setError(text(locale, "소스 상태를 바꾸지 못했다.", "Failed to toggle source."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale, workspaceId]);

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
        setError(text(locale, "소스 재시도에 실패했다.", "Failed to retry source."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale, workspaceId]);

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
        setError(text(locale, "신호 재시도에 실패했다.", "Failed to retry signal."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale, workspaceId]);

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
        setError(text(locale, "인텔리전스 작업 실행에 실패했다.", "Intelligence action failed."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale, selectedEvent, workspaceId]);

  const updateReviewStateForEvent = useCallback(async (eventId: string, reviewState: EventReviewState) => {
    if (!workspaceId) return;
    const current = events.find((event) => event.id === eventId) ?? null;
    const reviewReason = typeof window !== "undefined" && reviewState !== "watch"
      ? window.prompt(text(locale, "검토 사유를 입력해라", "Enter a review reason"), current?.reviewReason ?? "")?.trim() ?? null
      : null;
    const reviewOwner = typeof window !== "undefined" && reviewState === "review"
      ? window.prompt(text(locale, "검토 담당자(user id)를 입력해라", "Enter a review owner (user id)"), current?.reviewOwner ?? "")?.trim() ?? null
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
        setError(text(locale, "검토 상태를 바꾸지 못했다.", "Failed to update review state."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [events, loadWorkspaceBundle, locale, workspaceId]);

  const updateReviewStateAction = useCallback(async (reviewState: EventReviewState) => {
    if (!selectedEvent) return;
    await updateReviewStateForEvent(selectedEvent.id, reviewState);
  }, [selectedEvent, updateReviewStateForEvent]);

  const updateReviewStateForLinkedClaim = useCallback(async (linkedClaimId: string, reviewState: EventReviewState) => {
    if (!workspaceId || !selectedEventDetail || !selectedEvent) return;
    const current = selectedEventDetail.linkedClaims.find((row) => row.id === linkedClaimId) ?? null;
    const reviewReason = typeof window !== "undefined" && reviewState !== "watch"
      ? window.prompt(text(locale, "연결 클레임 검토 사유를 입력해라", "Enter a linked claim review reason"), current?.reviewReason ?? "")?.trim() ?? null
      : null;
    const reviewOwner = typeof window !== "undefined" && reviewState === "review"
      ? window.prompt(text(locale, "연결 클레임 담당자(user id)를 입력해라", "Enter a linked claim review owner (user id)"), current?.reviewOwner ?? "")?.trim() ?? null
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
        setError(text(locale, "연결 클레임 검토 상태를 바꾸지 못했다.", "Failed to update linked claim review state."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [locale, selectedEvent, selectedEventDetail, selectEvent, workspaceId]);

  const updateReviewStateForHypothesis = useCallback(async (entryId: string, reviewState: EventReviewState) => {
    if (!workspaceId || !selectedHypothesisDetail || !selectedEvent) return;
    const current = selectedHypothesisDetail.ledgerEntries.find((row) => row.id === entryId) ?? null;
    const reviewReason = typeof window !== "undefined" && reviewState !== "watch"
      ? window.prompt(text(locale, "가설 검토 사유를 입력해라", "Enter a hypothesis review reason"), current?.reviewReason ?? "")?.trim() ?? null
      : null;
    const reviewOwner = typeof window !== "undefined" && reviewState === "review"
      ? window.prompt(text(locale, "가설 담당자(user id)를 입력해라", "Enter a hypothesis review owner (user id)"), current?.reviewOwner ?? "")?.trim() ?? null
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
        setError(text(locale, "가설 검토 상태를 바꾸지 못했다.", "Failed to update hypothesis review state."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [locale, selectedEvent, selectedHypothesisDetail, selectEvent, workspaceId]);

  const updateReviewStateForNarrativeCluster = useCallback(async (clusterId: string, reviewState: EventReviewState) => {
    const currentCluster =
      (selectedNarrativeClusterDetail?.narrativeCluster?.id === clusterId
        ? selectedNarrativeClusterDetail.narrativeCluster
        : null) ??
      (selectedEventDetail?.narrativeCluster?.id === clusterId ? selectedEventDetail.narrativeCluster : null);
    if (!workspaceId || !currentCluster) return;
    const reviewReason = typeof window !== "undefined" && reviewState !== "watch"
      ? window.prompt(text(locale, "서사 클러스터 검토 사유를 입력해라", "Enter a narrative cluster review reason"), currentCluster.reviewReason ?? "")?.trim() ?? null
      : null;
    const reviewOwner = typeof window !== "undefined" && reviewState === "review"
      ? window.prompt(text(locale, "서사 클러스터 담당자(user id)를 입력해라", "Enter a narrative cluster review owner (user id)"), currentCluster.reviewOwner ?? "")?.trim() ?? null
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
        setError(text(locale, "서사 클러스터 검토 상태를 바꾸지 못했다.", "Failed to update narrative cluster review state."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale, selectedEventDetail, selectedNarrativeClusterDetail, workspaceId]);

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
    const note = typeof window !== "undefined"
      ? window.prompt(locale === "ko" ? `${label} 메모를 입력해라` : `Enter a note for ${label}`)?.trim()
      : null;
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
        setError(text(locale, "운영자 메모를 만들지 못했다.", "Failed to create operator note."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale, selectedEvent, selectedNarrativeClusterDetail, workspaceId]);

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
        setError(text(locale, "런타임 별칭 바인딩을 바꾸지 못했다.", "Failed to update runtime alias bindings."));
      }
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale, workspaceId]);

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
      const sourceName = sources.find((source) => source.id === failure.sourceId)?.name ?? text(locale, "알수없는 소스", "unknown source");
      const key = `${failure.sourceId ?? text(locale, "알수없음", "unknown")}:${sourceName}`;
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
  }, [fetchFailures, locale, sources]);
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
  const formatDisplayDateTime = useCallback((value: string | null | undefined) => formatDateTime(value, copy.empty), [copy.empty]);
  const toggleSection = useCallback((key: keyof typeof sectionOpen) => {
    setSectionOpen((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const createWorkspaceAction = useCallback(async () => {
    const proposedName = typeof window !== "undefined"
      ? window.prompt(text(locale, "새 인텔리전스 워크스페이스 이름", "New intelligence workspace name"))?.trim()
      : null;
    setBusyKey("workspace:create");
    try {
      const result = await createIntelligenceWorkspace({ name: proposedName || undefined });
      await loadWorkspaceBundle(result.workspace.id);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(text(locale, "워크스페이스를 만들지 못했다.", "Failed to create workspace."));
      }
    } finally {
      setBusyKey(null);
    }
  }, [loadWorkspaceBundle, locale]);

  return (
    <main className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,_rgba(83,208,255,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(68,255,181,0.12),_transparent_22%),linear-gradient(180deg,_#08111a_0%,_#05080f_100%)] text-white">
      <div className="mx-auto max-w-[1500px] space-y-6 p-6">
        <section className="rounded-3xl border border-white/10 bg-black/35 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-[0.35em] text-cyan-300/80">{copy.titleEyebrow}</p>
              <h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1>
              <p className="max-w-3xl text-sm text-white/70">{copy.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-white/50">
                {loading ? copy.loadingRuntime : copy.runtimeReady}
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
                <RefreshCw size={14} /> {copy.refresh}
              </button>
              <button
                type="button"
                onClick={() => void createWorkspaceAction()}
                className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.06] px-4 py-2 text-sm text-white/85 hover:border-white/25 hover:bg-white/[0.09]"
              >
                {busyKey === "workspace:create" ? <RefreshCw size={14} className="animate-spin" /> : <Bot size={14} />}
                {copy.newWorkspace}
              </button>
            </div>
          </div>
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatCard icon={<ScanSearch size={16} />} label={copy.stats.sources} value={String(sources.length)} note={runtime.scannerWorker?.enabled ? text(locale, "스캐너 켜짐", "scanner on") : text(locale, "스캐너 꺼짐", "scanner off")} />
            <StatCard icon={<BrainCircuit size={16} />} label={copy.stats.loadedEvents} value={String(events.length)} note={latestRun ? `${formatDisplayDateTime(latestRun.startedAt)} · ${text(locale, "최신 50개", "latest 50")}` : copy.empty} />
            <StatCard icon={<ShieldCheck size={16} />} label={copy.stats.pendingExec} value={String(pendingExecutionCount)} note={latestRun ? `${latestRun.executionCount} ${text(locale, "실행 후보", "exec candidates")}` : text(locale, "유휴", "idle")} />
            <StatCard icon={<Cable size={16} />} label={copy.stats.semantic} value={runtime.semanticWorker?.enabled ? text(locale, "켜짐", "ON") : text(locale, "꺼짐", "OFF")} note={runtime.semanticWorker?.lastRun ? `${text(locale, "최근", "last")} ${formatDisplayDateTime(runtime.semanticWorker.lastRun.finishedAt)}` : text(locale, "아직 없음", "not yet")} />
            <StatCard icon={<RefreshCw size={16} />} label={copy.stats.stale} value={runtime.staleMaintenanceWorker?.enabled ? text(locale, "켜짐", "ON") : text(locale, "꺼짐", "OFF")} note={runtime.staleMaintenanceWorker?.lastRun ? `${text(locale, "최근", "last")} ${formatDisplayDateTime(runtime.staleMaintenanceWorker.lastRun.finishedAt)}` : text(locale, "아직 없음", "not yet")} />
            <StatCard icon={<RefreshCw size={16} />} label={copy.stats.backlog} value={String(runtime.semanticBacklog.pendingCount)} note={`${text(locale, "시맨틱 대기열", "pending semantic queue")} · ${runtime.semanticBacklog.failedCount} ${text(locale, "실패", "failed")}`} />
            <StatCard icon={<Bot size={16} />} label={copy.stats.models} value={String(runtime.models.length)} note={`${runtime.aliases.workspace.length + runtime.aliases.global.length} ${text(locale, "바인딩", "bindings")}`} />
            <StatCard icon={<ShieldCheck size={16} />} label={copy.stats.sync} value={runtime.syncWorker?.enabled ? text(locale, "켜짐", "ON") : text(locale, "꺼짐", "OFF")} note={runtime.syncWorker?.lastRun ? `${text(locale, "최근", "last")} ${formatDisplayDateTime(runtime.syncWorker.lastRun.finishedAt)}` : text(locale, "아직 없음", "not yet")} />
          </div>
          <div className="mt-4 flex items-center justify-end">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMetricHelpOpen((current) => !current)}
                title={text(locale, "지표 의미 보기", "Show metric help")}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70 hover:border-white/20 hover:bg-white/[0.08]"
              >
                {locale === "ko" ? "? 도움말" : "? Help"}
              </button>
              {metricHelpOpen ? (
                <div className="absolute right-0 z-20 mt-2 w-[360px] rounded-2xl border border-white/10 bg-[#09121a]/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-cyan-200/80">{copy.explainer.heading}</p>
                  <div className="mt-3 space-y-2">
                    {[copy.explainer.loadedEvents, copy.explainer.backlog, copy.explainer.primary, copy.explainer.counter, copy.explainer.invalidation, copy.explainer.expectedSignals].map((line) => (
                      <div key={line} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs leading-5 text-white/70">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,420px)_minmax(0,1fr)]">
          <CollapsiblePanel
            title={copy.sections.sources}
            meta={runtime.scannerWorker?.inflight ? text(locale, "스캔중...", "Scanning...") : text(locale, "안정", "Stable")}
            open={sectionOpen.sources}
            onToggle={() => toggleSection("sources")}
          >
            <div className="space-y-2">
              {sources.map((source) => (
                <div
                  key={source.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => undefined}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                    }
                  }}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left hover:border-white/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-white">{source.name}</p>
                      <p className="mt-1 text-xs text-white/50">
                        {sourceKindLabel(source.kind, locale)} · {sourceTypeLabel(source.sourceType, locale)} · {sourceTierLabel(source.sourceTier, locale)}
                      </p>
                      <p className="mt-1 text-[11px] text-white/40">{text(locale, "주기", "poll")} {source.pollMinutes}m · {text(locale, "최근", "last")} {formatDateTime(source.lastFetchedAt)}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/45">
                        <span>{text(locale, "상태", "health")} {workerStatusLabel(source.health.lastStatus, locale)}</span>
                        <span>robots {source.crawlPolicy.respectRobots ? text(locale, "켜짐", "on") : text(locale, "꺼짐", "off")}</span>
                        <span>{text(locale, "깊이", "depth")} {source.crawlPolicy.maxDepth}</span>
                        <span>{text(locale, "실행당 페이지", "pages/run")} {source.crawlPolicy.maxPagesPerRun}</span>
                        <span>403 {source.health.status403Count}</span>
                        <span>429 {source.health.status429Count}</span>
                      </div>
                      <p className="mt-2 text-[11px] text-white/35">
                        {text(locale, "허용", "allow")} {source.crawlPolicy.allowDomains.length || 0} · {text(locale, "차단", "deny")} {source.crawlPolicy.denyDomains.length || 0} · {text(locale, "지연", "latency")} {source.health.recentLatencyMs ?? "—"}ms
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-mono ${source.enabled ? "bg-emerald-400/15 text-emerald-200" : "bg-white/10 text-white/50"}`}>
                      {source.enabled ? text(locale, "켜짐", "ON") : text(locale, "꺼짐", "OFF")}
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
                </div>
              ))}
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title={copy.sections.events}
            meta={latestRun ? `${latestRun.clusteredEventCount} ${text(locale, "클러스터링", "clustered")} · ${text(locale, "최신 50개 로드", "latest 50 loaded")}` : copy.empty}
            open={sectionOpen.events}
            onToggle={() => toggleSection("events")}
          >
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
                        <p className="mt-1 text-xs text-white/55">{domainLabel(event.topDomainId, locale)} · {eventFamilyLabel(event.eventFamily, locale)}</p>
                        <p className="mt-1 text-[11px] text-white/40">
                          {text(locale, "클레임", "claims")} {event.linkedClaimCount} · {text(locale, "반박", "contradictions")} {event.contradictionCount} · {text(locale, "비소셜", "non-social")} {event.nonSocialCorroborationCount} · {text(locale, "검토", "review")} {reviewStateLabel(event.reviewState, locale)}
                        </p>
                        <p className="mt-1 text-[11px] text-white/35">
                          {text(locale, "운영 우선순위", "operator priority")} {event.operatorPriorityScore ?? 0} · {text(locale, "클레임 건전도", "claim health")} {event.linkedClaimHealthScore.toFixed(2)} · {text(locale, "시간", "time")} {event.timeCoherenceScore.toFixed(2)} · {text(locale, "그래프", "graph")} +{event.graphSupportScore.toFixed(2)} / -{event.graphContradictionScore.toFixed(2)} / {text(locale, "핫스팟", "hot")} {event.graphHotspotCount}
                        </p>
                        <p className="mt-1 text-[11px] text-white/35">
                          {text(locale, "시간축", "temporal")} {narrativeStateLabel(event.temporalNarrativeState ?? "new", locale)} · {text(locale, "반복", "recurring")} {(event.recurringNarrativeScore ?? 0).toFixed(2)} · {text(locale, "연결", "related")} {event.relatedHistoricalEventCount ?? 0}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono text-cyan-200">{Math.round(event.structuralityScore * 100)}</p>
                        <p className="text-[10px] text-white/45">{event.riskBand} · {executionStatusLabel(event.deliberationStatus, locale)}</p>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/65">{event.summary}</p>
                  </button>
                );
              })}
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title={copy.sections.eventDetail}
            meta={selectedEvent ? selectedEvent.id : copy.empty}
            open={sectionOpen.eventDetail}
            onToggle={() => toggleSection("eventDetail")}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-mono uppercase tracking-[0.25em] text-white/70">{copy.sections.eventDetail}</h2>
                <p className="mt-1 text-sm text-white/50">{selectedEvent ? selectedEvent.id : copy.empty}</p>
              </div>
              {selectedEvent ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton label={locale === "ko" ? "토론" : "Deliberate"} icon={<BrainCircuit size={14} />} busy={busyKey === "action:deliberate"} onClick={() => void runAction("deliberate")} />
                  <ActionButton label={locale === "ko" ? "브리프 브리지" : "Bridge Brief"} icon={<Send size={14} />} busy={busyKey === "action:brief"} onClick={() => void runAction("brief")} />
                  <ActionButton label={locale === "ko" ? "액션 브리지" : "Bridge Action"} icon={<Cable size={14} />} busy={busyKey === "action:action"} onClick={() => void runAction("action")} />
                  <ActionButton
                    label={locale === "ko" ? "이벤트 메모" : "Event Note"}
                    icon={<Bot size={14} />}
                    busy={busyKey === "operator-note:create:event:event"}
                    onClick={() => void addOperatorNoteAction()}
                  />
                </div>
              ) : null}
            </div>

            {!selectedEvent ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-sm text-white/45">
                {copy.selectedEventEmpty}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap gap-2 text-[11px] font-mono text-white/50">
                    <span>{domainLabel(selectedEvent.topDomainId, locale)}</span>
                    <span>{text(locale, "구조성", "structurality")} {selectedEvent.structuralityScore.toFixed(2)}</span>
                    <span>{text(locale, "행동성", "actionability")} {selectedEvent.actionabilityScore.toFixed(2)}</span>
                    <span>{selectedEvent.signalIds.length} {text(locale, "신호", "signals")}</span>
                    <span>{text(locale, "클레임", "claims")} {selectedEvent.linkedClaimCount}</span>
                    <span>{text(locale, "반박", "contradictions")} {selectedEvent.contradictionCount}</span>
                    <span>{text(locale, "비소셜", "non-social")} {selectedEvent.nonSocialCorroborationCount}</span>
                    <span>{text(locale, "클레임 건전도", "claim health")} {selectedEvent.linkedClaimHealthScore.toFixed(2)}</span>
                    <span>{text(locale, "시간 일관성", "time coherence")} {selectedEvent.timeCoherenceScore.toFixed(2)}</span>
                    <span>{text(locale, "그래프 지지", "graph support")} {selectedEvent.graphSupportScore.toFixed(2)}</span>
                    <span>{text(locale, "그래프 반박", "graph contradiction")} {selectedEvent.graphContradictionScore.toFixed(2)}</span>
                    <span>{text(locale, "그래프 핫스팟", "graph hotspots")} {selectedEvent.graphHotspotCount}</span>
                    <span>{text(locale, "시간축", "temporal")} {narrativeStateLabel(selectedEvent.temporalNarrativeState ?? "new", locale)}</span>
                    <span>{text(locale, "반복", "recurring")} {(selectedEvent.recurringNarrativeScore ?? 0).toFixed(2)}</span>
                    <span>{text(locale, "연결", "related")} {selectedEvent.relatedHistoricalEventCount ?? 0}</span>
                    <span>{text(locale, "토론", "deliberation")} {executionStatusLabel(selectedEvent.deliberationStatus, locale)}</span>
                    <span>{text(locale, "검토", "review")} {reviewStateLabel(selectedEvent.reviewState, locale)}</span>
                    <span>{text(locale, "우선순위", "priority")} {selectedEvent.operatorPriorityScore ?? 0}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/75">{selectedEvent.summary}</p>
                  {selectedEvent.reviewReason || selectedEvent.reviewOwner || selectedEvent.reviewResolvedAt ? (
                    <p className="mt-2 text-xs text-white/45">
                      {text(locale, "검토 사유", "review reason")} {selectedEvent.reviewReason ?? "—"} · {text(locale, "담당", "owner")} {selectedEvent.reviewOwner ?? "—"} · {text(locale, "해결", "resolved")} {formatDateTime(selectedEvent.reviewResolvedAt)}
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
                        {busyKey === `review:${selectedEvent.id}:${state}` ? "..." : reviewStateLabel(state, locale)}
                      </button>
                    ))}
                  </div>
                </div>

                <DetailBlock title={locale === "ko" ? "주 가설" : "Primary Hypotheses"} items={selectedEvent.primaryHypotheses.map((row) => `${row.title} · ${row.summary}`)} />
                <DetailBlock title={locale === "ko" ? "대안 가설" : "Counter Hypotheses"} items={selectedEvent.counterHypotheses.map((row) => `${row.title} · ${row.summary}`)} />
                <DetailBlock title={locale === "ko" ? "무효화 스냅샷" : "Invalidation Snapshot"} locale={locale} items={selectedEvent.invalidationConditions.map((row) => `${row.title} · ${row.description} · ${genericStatusLabel(row.status, locale)}`)} />
                <DetailBlock title={locale === "ko" ? "예상 신호 스냅샷" : "Expected Signals Snapshot"} locale={locale} items={selectedEvent.expectedSignals.map((row) => `${row.signalKey} · ${row.description} · ${genericStatusLabel(row.status, locale)}`)} />
                <DetailBlock
                  title={locale === "ko" ? "연결된 클레임" : "Linked Claims"}
                  locale={locale}
                  items={selectedLinkedClaims.map((row) => `${row.canonicalSubject} ${row.canonicalPredicate} ${row.canonicalObject} · ${text(locale, "패밀리", "family")} ${row.predicateFamily} · ${text(locale, "비소셜", "non-social")} ${row.nonSocialSourceCount} · ${text(locale, "반박", "contradictions")} ${row.contradictionCount}`)}
                />
                <RelatedNarrativesPanel
                  locale={locale}
                  items={selectedRelatedHistoricalEvents}
                  onSelectEvent={(eventId) => void selectEvent(eventId)}
                />
                <NarrativeClusterPanel
                  locale={locale}
                  cluster={selectedNarrativeCluster}
                  members={selectedNarrativeClusterMembers}
                  notes={selectedNarrativeClusterNotes}
                  onSelectEvent={(eventId) => void selectEvent(eventId)}
                  onOpenClusterInbox={(clusterId) => void selectNarrativeCluster(clusterId)}
                  onNoteClick={() => {
                    if (!selectedNarrativeCluster) return;
                    void addOperatorNoteAction("narrative_cluster", selectedNarrativeCluster.id, text(locale, "서사 클러스터", "narrative cluster"));
                  }}
                  onReviewStateChange={(clusterId, state) => void updateReviewStateForNarrativeCluster(clusterId, state)}
                  reviewBusyState={
                    busyKey?.startsWith(`narrative-cluster-review:${selectedNarrativeCluster?.id ?? "na"}:`)
                      ? busyKey.split(":")[2] as EventReviewState
                      : null
                  }
                />
                <TemporalNarrativeLedgerPanel
                  locale={locale}
                  items={selectedTemporalNarrativeLedger}
                  onSelectEvent={(eventId) => void selectEvent(eventId)}
                />
                <ClaimGraphPanel
                  locale={locale}
                  graph={selectedEventGraph}
                  onNoteClick={(linkedClaimId) => void addOperatorNoteAction("linked_claim", linkedClaimId, text(locale, "연결 클레임", "linked claim"))}
                  onReviewStateChange={(linkedClaimId, state) => void updateReviewStateForLinkedClaim(linkedClaimId, state)}
                  busyKey={busyKey}
                />
                {selectedEventDetail && selectedLinkedClaims.length > 0 ? (
                  <ScopeActionBlock
                    locale={locale}
                    title={locale === "ko" ? "연결된 클레임 메모" : "Linked Claim Notes"}
                    items={selectedLinkedClaims.slice(0, 6).map((row) => ({
                      id: row.id,
                      label: `${row.canonicalSubject} ${row.canonicalPredicate} ${row.canonicalObject}`,
                      meta: `${text(locale, "패밀리", "family")} ${row.predicateFamily} · ${text(locale, "비소셜", "non-social")} ${row.nonSocialSourceCount} · ${text(locale, "반박", "contradictions")} ${row.contradictionCount} · ${text(locale, "검토", "review")} ${reviewStateLabel(row.reviewState, locale)}`,
                      detail:
                        [
                          `${text(locale, "버킷", "bucket")} ${formatDateTime(row.timeBucketStart)} ~ ${formatDateTime(row.timeBucketEnd)}`,
                          `${text(locale, "지지", "support")} ${formatDateTime(row.lastSupportedAt)}`,
                          `${text(locale, "반박", "contradict")} ${formatDateTime(row.lastContradictedAt)}`,
                          row.reviewReason || row.reviewOwner || row.reviewResolvedAt
                            ? `${text(locale, "사유", "reason")} ${row.reviewReason ?? "—"} · ${text(locale, "담당", "owner")} ${row.reviewOwner ?? "—"} · ${text(locale, "해결", "resolved")} ${formatDateTime(row.reviewResolvedAt)}`
                            : null,
                        ]
                          .filter((value): value is string => Boolean(value))
                          .join(" · "),
                      noteBusy: busyKey === `operator-note:create:linked_claim:${row.id}`,
                      onNoteClick: () => void addOperatorNoteAction("linked_claim", row.id, text(locale, "연결 클레임", "linked claim")),
                      reviewState: row.reviewState,
                      onReviewStateChange: (state) => void updateReviewStateForLinkedClaim(row.id, state),
                      reviewBusyState: busyKey?.startsWith(`linked-claim-review:${row.id}:`) ? busyKey.split(":")[2] as EventReviewState : null,
                    }))}
                  />
                ) : null}
                <DetailBlock
                  title={locale === "ko" ? "클레임 링크" : "Claim Links"}
                  locale={locale}
                  items={(selectedEventDetail?.claimLinks ?? []).map((row) => `${graphRelationLabel(row.relation, locale)} · ${text(locale, "연결", "linked")} ${row.linkedClaimId.slice(0, 8)} · ${text(locale, "신호", "signal")} ${row.signalId.slice(0, 8)} · ${text(locale, "신뢰도", "confidence")} ${row.confidence.toFixed(2)} · ${text(locale, "강도", "strength")} ${row.linkStrength.toFixed(2)}`)}
                />
                <DetailBlock
                  title={locale === "ko" ? "가설 원장" : "Hypothesis Ledger"}
                  locale={locale}
                  items={(selectedHypothesisDetail?.ledgerEntries ?? []).map((row) => {
                    const summary = hypothesisEvidenceSummaryMap.get(row.hypothesisId);
                    const supportStrength = summary ? summary.support_strength.toFixed(2) : "0.00";
                    const contradictStrength = summary ? summary.contradict_strength.toFixed(2) : "0.00";
                    return `${hypothesisKindLabel(row.kind, locale)} · ${row.title} · ${row.confidence.toFixed(2)} · ${genericStatusLabel(row.status, locale)} · ${text(locale, "지지", "support")} ${summary?.support_count ?? 0}/${supportStrength} · ${text(locale, "반박", "contradict")} ${summary?.contradict_count ?? 0}/${contradictStrength} · ${text(locale, "엣지", "edge")} +${summary?.support_edge_count ?? 0}/${summary?.graph_support_strength?.toFixed?.(2) ?? "0.00"} · ${text(locale, "엣지", "edge")} -${summary?.contradict_edge_count ?? 0}/${summary?.graph_contradict_strength?.toFixed?.(2) ?? "0.00"}`;
                  })}
                />
                {selectedHypothesisDetail && selectedHypothesisDetail.ledgerEntries.length > 0 ? (
                  <ScopeActionBlock
                    locale={locale}
                    title={locale === "ko" ? "가설 메모" : "Hypothesis Notes"}
                    items={selectedHypothesisDetail.ledgerEntries.slice(0, 6).map((row) => ({
                      id: row.id,
                      label: `${hypothesisKindLabel(row.kind, locale)} · ${row.title}`,
                      meta: `${row.confidence.toFixed(2)} · ${genericStatusLabel(row.status, locale)} · ${text(locale, "검토", "review")} ${reviewStateLabel(row.reviewState, locale)}`,
                      detail:
                        row.reviewReason || row.reviewOwner || row.reviewResolvedAt
                          ? `${text(locale, "사유", "reason")} ${row.reviewReason ?? "—"} · ${text(locale, "담당", "owner")} ${row.reviewOwner ?? "—"} · ${text(locale, "해결", "resolved")} ${formatDateTime(row.reviewResolvedAt)}`
                          : null,
                      noteBusy: busyKey === `operator-note:create:hypothesis:${row.id}`,
                      onNoteClick: () => void addOperatorNoteAction("hypothesis", row.id, text(locale, "가설", "hypothesis")),
                      reviewState: row.reviewState,
                      onReviewStateChange: (state) => void updateReviewStateForHypothesis(row.id, state),
                      reviewBusyState: busyKey?.startsWith(`hypothesis-review:${row.id}:`) ? busyKey.split(":")[2] as EventReviewState : null,
                    }))}
                  />
                ) : null}
                <DetailBlock
                  title={locale === "ko" ? "근거 링크" : "Evidence Links"}
                  locale={locale}
                  items={(selectedHypothesisDetail?.evidenceLinks ?? []).map((row) => `${graphRelationLabel(row.relation, locale)} · ${text(locale, "가설", "hypothesis")} ${row.hypothesisId.slice(0, 8)} · ${text(locale, "클레임", "claim")} ${row.linkedClaimId?.slice(0, 8) ?? "—"} · ${text(locale, "강도", "strength")} ${(row.evidenceStrength ?? 0).toFixed(2)}`)}
                />
                <div className="grid gap-4 lg:grid-cols-3">
                  <DetailBlock
                    title={locale === "ko" ? "무효화 원장" : "Invalidation Ledger"}
                    locale={locale}
                    items={(selectedHypothesisDetail?.invalidationEntries ?? []).map((row) => `${row.title} · ${row.description} · ${genericStatusLabel(row.status, locale)} · ${formatDateTime(row.updatedAt)}`)}
                  />
                  <DetailBlock
                    title={locale === "ko" ? "예상 신호 원장" : "Expected Signal Ledger"}
                    locale={locale}
                    items={(selectedHypothesisDetail?.expectedSignalEntries ?? []).map((row) => `${row.signalKey} · ${row.description} · ${genericStatusLabel(row.status, locale)} · ${formatDateTime(row.dueAt)}`)}
                  />
                  <DetailBlock
                    title={locale === "ko" ? "결과 원장" : "Outcome Ledger"}
                    locale={locale}
                    items={(selectedHypothesisDetail?.outcomeEntries ?? []).map((row) => `${genericStatusLabel(row.status, locale)} · ${row.summary} · ${formatDateTime(row.createdAt)}`)}
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailBlock
                    title={locale === "ko" ? "주 가설 드리프트" : "Primary Drift"}
                    locale={locale}
                    items={[
                      selectedLedgerDrift.primaryLatest
                        ? `${text(locale, "최신", "latest")} · ${selectedLedgerDrift.primaryLatest.title} · ${selectedLedgerDrift.primaryLatest.confidence.toFixed(2)} · ${formatDateTime(selectedLedgerDrift.primaryLatest.updatedAt)}`
                        : text(locale, "주 가설 원장 항목 없음", "No primary ledger entry"),
                      selectedLedgerDrift.primaryPrevious
                        ? `${text(locale, "이전", "previous")} · ${selectedLedgerDrift.primaryPrevious.title} · ${selectedLedgerDrift.primaryPrevious.confidence.toFixed(2)} · ${formatDateTime(selectedLedgerDrift.primaryPrevious.updatedAt)}`
                        : text(locale, "이전 주 가설 원장 항목 없음", "No previous primary entry"),
                      selectedLedgerDrift.primaryDelta !== null
                        ? `${text(locale, "변화", "delta")} · ${selectedLedgerDrift.primaryDelta >= 0 ? "+" : ""}${selectedLedgerDrift.primaryDelta.toFixed(2)}`
                        : `${text(locale, "변화", "delta")} · —`,
                    ]}
                  />
                  <DetailBlock
                    title={locale === "ko" ? "대안 가설 드리프트" : "Counter Drift"}
                    locale={locale}
                    items={[
                      selectedLedgerDrift.counterLatest
                        ? `${text(locale, "최신", "latest")} · ${selectedLedgerDrift.counterLatest.title} · ${selectedLedgerDrift.counterLatest.confidence.toFixed(2)} · ${formatDateTime(selectedLedgerDrift.counterLatest.updatedAt)}`
                        : text(locale, "대안 가설 원장 항목 없음", "No counter ledger entry"),
                      selectedLedgerDrift.counterPrevious
                        ? `${text(locale, "이전", "previous")} · ${selectedLedgerDrift.counterPrevious.title} · ${selectedLedgerDrift.counterPrevious.confidence.toFixed(2)} · ${formatDateTime(selectedLedgerDrift.counterPrevious.updatedAt)}`
                        : text(locale, "이전 대안 가설 원장 항목 없음", "No previous counter entry"),
                      selectedLedgerDrift.counterDelta !== null
                        ? `${text(locale, "변화", "delta")} · ${selectedLedgerDrift.counterDelta >= 0 ? "+" : ""}${selectedLedgerDrift.counterDelta.toFixed(2)}`
                        : `${text(locale, "변화", "delta")} · —`,
                    ]}
                  />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">{locale === "ko" ? "실행 후보" : "Execution Candidates"}</h3>
                    <span className="text-xs text-white/40">{selectedEvent.executionCandidates.length}</span>
                  </div>
                  <div className="space-y-2">
                    {selectedEvent.executionCandidates.map((candidate) => (
                      <div key={candidate.id} className="rounded-2xl border border-white/8 bg-black/25 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{candidate.title}</p>
                            <p className="mt-1 text-xs text-white/55">{candidate.executionMode} · {executionStatusLabel(candidate.status, locale)} · {candidate.riskBand}</p>
                            <p className="mt-2 text-xs leading-5 text-white/65">{candidate.summary}</p>
                            {readBlockedReason(candidate) ? (
                              <p className="mt-2 text-[11px] text-amber-200/85">
                                {text(locale, "차단 사유", "blocked reason")} · {readBlockedReason(candidate)}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => void runAction("execute", candidate.id)}
                            disabled={candidate.status === "executed" || busyKey === "action:execute"}
                            className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Play size={12} /> {text(locale, "실행", "Run")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailBlock title={locale === "ko" ? "토론 결과" : "Deliberations"} locale={locale} items={selectedEvent.deliberations.map((row) => `${genericStatusLabel(row.status, locale)} · ${executionStatusLabel(row.executionStance, locale)} · ${row.weakestLink}`)} />
                  <DetailBlock title={locale === "ko" ? "결과 스냅샷" : "Outcome Snapshot"} locale={locale} items={selectedEvent.outcomes.map((row) => `${genericStatusLabel(row.status, locale)} · ${row.summary}`)} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailBlock title={locale === "ko" ? "브리지 디스패치 로그" : "Bridge Dispatch Log"} locale={locale} items={(selectedEventDetail?.bridgeDispatches ?? []).map((row) => `${bridgeKindLabel(row.kind, locale)} · ${genericStatusLabel(row.status, locale)} · ${row.targetId ?? text(locale, "대상 없음", "no target")}`)} />
                  <DetailBlock title={locale === "ko" ? "실행 감사 로그" : "Execution Audit"} locale={locale} items={(selectedEventDetail?.executionAudit ?? []).map((row) => `${genericStatusLabel(row.status, locale)} · ${row.actionName ?? text(locale, "알수없음", "unknown")} · ${row.summary}`)} />
                </div>
                <DetailBlock title={locale === "ko" ? "운영자 메모" : "Operator Notes"} items={(selectedEventDetail?.operatorNotes ?? []).map((row) => `${formatDateTime(row.createdAt)} · ${row.scope} · ${row.note}`)} />
              </div>
            )}
          </CollapsiblePanel>
        </div>

        <section className="grid gap-6 xl:grid-cols-2">
          <CollapsiblePanel
            title={copy.sections.recentRuns}
            meta={`${runtime.semanticBacklog.pendingCount} pending · ${runtime.semanticBacklog.failedCount} failed`}
            open={sectionOpen.recentRuns}
            onToggle={() => toggleSection("recentRuns")}
          >
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <MiniMetric label={text(locale, "대기", "pending")} value={String(runtime.semanticBacklog.pendingCount)} />
              <MiniMetric label={text(locale, "처리중", "processing")} value={String(runtime.semanticBacklog.processingCount)} />
              <MiniMetric label={text(locale, "실패", "failed")} value={String(runtime.semanticBacklog.failedCount)} />
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <MiniMetric label={text(locale, "저하된 소스", "degraded sources")} value={String(degradedSources.length)} />
              <MiniMetric label={text(locale, "robots 차단", "robots blocked")} value={String(robotsBlockedSources.length)} />
              <MiniMetric label={text(locale, "429 제한", "429 throttled")} value={String(throttledSources.length)} />
            </div>
            {runtime.semanticBacklog.latestFailedSignalIds.length > 0 ? (
              <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-amber-100/80">{text(locale, "실패한 신호", "Failed Signals")}</p>
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
                    <p className="text-sm text-white">{genericStatusLabel(run.status, locale)}</p>
                    <p className="text-xs text-white/45">{formatDateTime(run.startedAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-white/55">
                    {text(locale, "수집", "fetched")} {run.fetchedCount} · {text(locale, "문서", "docs")} {run.storedDocumentCount} · {text(locale, "신호", "signals")} {run.signalCount} · {text(locale, "이벤트", "events")} {run.clusteredEventCount}
                  </p>
                  <p className="mt-1 text-[11px] text-white/40">
                    {text(locale, "실패", "failed")} {run.failedCount} · {text(locale, "실행", "exec")} {run.executionCount}
                  </p>
                </div>
                ))}
              </div>
          </CollapsiblePanel>

          <RuntimeControlPlanePanel
            locale={locale}
            runtime={runtime}
            workspaceId={workspaceId}
            busyKey={busyKey}
            onSaveBindings={saveRuntimeAliasBindings}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-4">
          <CollapsiblePanel
            title={copy.sections.fetchFailures}
            meta={`${fetchFailures.length} ${text(locale, "최근 실패", "recent failures")} · ${staleEvents.length} ${text(locale, "오염 후보", "stale candidates")}`}
            open={sectionOpen.fetchFailures}
            onToggle={() => toggleSection("fetchFailures")}
          >
            <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-amber-100/80">{text(locale, "오염 이벤트 정비", "Stale Event Maintenance")}</p>
                  <p className="mt-1 text-xs text-amber-100/70">
                    {text(locale, "예전 폴백 산출물로 보이는 인텔리전스 이벤트를 선별해서 정리 후 다시 빌드한다.", "Select suspicious fallback-generated intelligence events and rebuild them cleanly.")}
                  </p>
                  <p className="mt-1 text-[11px] text-amber-100/55">
                    {text(locale, "자동 워커", "auto worker")}: {runtime.staleMaintenanceWorker?.enabled ? text(locale, "켜짐", "on") : text(locale, "꺼짐", "off")}
                    {runtime.staleMaintenanceWorker?.lastRun
                      ? ` · ${text(locale, "재빌드", "rebuilt")} ${runtime.staleMaintenanceWorker.lastRun.rebuiltCount}/${runtime.staleMaintenanceWorker.lastRun.attemptedCount} · ${formatDateTime(runtime.staleMaintenanceWorker.lastRun.finishedAt)}`
                      : ` · ${text(locale, "아직 없음", "not yet")}`}
                  </p>
                </div>
                <span className="text-xs text-amber-100/75">{staleEvents.length} {text(locale, "후보", "candidates")}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void bulkRebuildStaleEventsAction()}
                  disabled={staleEvents.length === 0 || busyKey === "stale-bulk-rebuild"}
                  className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyKey === "stale-bulk-rebuild" ? "..." : locale === "ko" ? `상위 ${Math.min(5, staleEvents.length)}개 일괄 재빌드` : `top ${Math.min(5, staleEvents.length)} bulk rebuild`}
                </button>
              </div>
              {lastBulkRebuildResult ? (
                <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-100/85">
                  {text(locale, "시도", "attempted")} {lastBulkRebuildResult.attemptedEventIds.length} · {text(locale, "재빌드", "rebuilt")} {lastBulkRebuildResult.rebuiltCount} · {text(locale, "실패", "failed")} {lastBulkRebuildResult.failedCount}
                </div>
              ) : null}
              {lastRebuildResult ? (
                <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100/85">
                  {text(locale, "재빌드", "rebuilt")} {lastRebuildResult.previousEventId.slice(0, 8)} → {lastRebuildResult.rebuiltEventId?.slice(0, 8) ?? text(locale, "없음", "none")} ·
                  {text(locale, "재대기", "requeued")} {lastRebuildResult.requeuedSignalIds.length} · {text(locale, "삭제된 클레임", "deleted claims")} {lastRebuildResult.deletedLinkedClaimIds.length}
                </div>
              ) : null}
              <div className="mt-3 space-y-2">
                {staleEvents.length === 0 ? (
                  <p className="text-xs text-amber-100/60">{text(locale, "의심스러운 오염 이벤트가 없다.", "No suspicious stale events detected.")}</p>
                ) : (
                  staleEvents.slice(0, 6).map((event) => (
                    <div key={event.eventId} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-white">{event.title}</p>
                          <p className="mt-1 text-[11px] text-white/45">
                            {text(locale, "오염 점수", "stale")} {event.staleScore} · {text(locale, "클레임", "claims")} {event.linkedClaimCount} · {text(locale, "일반 비율", "generic")} {Math.round(event.genericPredicateRatio * 100)}% · {text(locale, "엣지", "edges")} {event.edgeCount}
                          </p>
                          <p className="mt-1 text-[11px] text-white/35">
                            {text(locale, "그래프", "graph")} +{event.graphSupportScore.toFixed(2)} / -{event.graphContradictionScore.toFixed(2)} · {text(locale, "건전도", "health")} {event.linkedClaimHealthScore.toFixed(2)} · {text(locale, "갱신", "updated")} {formatDateTime(event.updatedAt)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {event.reasons.map((reason) => (
                              <span
                                key={`${event.eventId}-${reason}`}
                                className="rounded-full border border-amber-300/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-100/80"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => void selectEvent(event.eventId)}
                            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70"
                          >
                            {text(locale, "열기", "open")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void rebuildEventAction(event.eventId)}
                            className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100"
                          >
                            {busyKey === `event-rebuild:${event.eventId}` ? "..." : text(locale, "정리 후 재빌드", "clean rebuild")}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            {fetchFailureSummary.length > 0 ? (
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                {fetchFailureSummary.slice(0, 4).map((row) => (
                  <div key={`${row.sourceId ?? "unknown"}-${row.sourceName}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-white">{row.sourceName}</p>
                      <span className="text-xs text-white/45">{row.total} {text(locale, "실패", "failures")}</span>
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
                <p className="text-xs text-white/40">{text(locale, "최근 수집 실패가 없다.", "No recent fetch failures")}</p>
              ) : (
                fetchFailures.map((failure) => (
                  <div key={failure.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-white/85">{failure.url}</p>
                        <p className="mt-1 text-white/45">{failure.reason}</p>
                        <p className="mt-1 text-[11px] text-white/35">
                          {formatDateTime(failure.createdAt)} · {text(locale, "상태", "status")} {failure.statusCode ?? "—"} · robots {failure.blockedByRobots ? text(locale, "차단", "blocked") : text(locale, "정상", "ok")}
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
                          {text(locale, "재시도", "retry")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title={copy.sections.reviewQueue}
            meta={`${reviewQueue.length} ${text(locale, "항목", "items")}`}
            open={sectionOpen.reviewQueue}
            onToggle={() => toggleSection("reviewQueue")}
          >
            <div className="space-y-2">
              {reviewQueue
                .map((event) => (
                  <div
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void selectEvent(event.id)}
                    onKeyDown={(keyboardEvent) => {
                      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                        keyboardEvent.preventDefault();
                        void selectEvent(event.id);
                      }
                    }}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left"
                  >
                    <p className="text-sm text-white">{event.title}</p>
                    <p className="mt-1 text-[11px] text-white/45">
                      {text(locale, "검토", "review")} {reviewStateLabel(event.reviewState, locale)} · {text(locale, "반박", "contradictions")} {event.contradictionCount} · {text(locale, "비소셜", "non-social")} {event.nonSocialCorroborationCount} · {text(locale, "토론", "deliberation")} {executionStatusLabel(event.deliberationStatus, locale)}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      {text(locale, "우선순위", "priority")} {event.operatorPriorityScore ?? 0} · {text(locale, "구조성", "structurality")} {event.structuralityScore.toFixed(2)} · {text(locale, "행동성", "actionability")} {event.actionabilityScore.toFixed(2)} · {text(locale, "클레임 건전도", "claim health")} {event.linkedClaimHealthScore.toFixed(2)} · {text(locale, "시간", "time")} {event.timeCoherenceScore.toFixed(2)} · {text(locale, "위험", "risk")} {event.riskBand}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      {text(locale, "시간축", "temporal")} {narrativeStateLabel(event.temporalNarrativeState ?? "new", locale)} · {text(locale, "반복", "recurring")} {(event.recurringNarrativeScore ?? 0).toFixed(2)} · {text(locale, "연결", "related")} {event.relatedHistoricalEventCount ?? 0}
                    </p>
                    {event.reviewReason || event.reviewOwner || event.reviewResolvedAt ? (
                      <p className="mt-1 text-[11px] text-white/35">
                        {text(locale, "사유", "reason")} {event.reviewReason ?? "—"} · {text(locale, "담당", "owner")} {event.reviewOwner ?? "—"} · {text(locale, "해결", "resolved")} {formatDateTime(event.reviewResolvedAt)}
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
                        {busyKey === `review:${event.id}:${state}` ? "..." : reviewStateLabel(state, locale)}
                      </button>
                    ))}
                    </div>
                  </div>
                ))}
              {reviewQueue.length === 0 ? (
                <p className="text-xs text-white/40">{copy.noReviewItems}</p>
              ) : null}
            </div>
          </CollapsiblePanel>

          <NarrativeClusterInboxPanel
            locale={locale}
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
            onNoteClick={(clusterId, eventId) => void addOperatorNoteAction("narrative_cluster", clusterId, text(locale, "서사 클러스터", "narrative cluster"), eventId)}
            panelTitle={copy.sections.clusterInbox}
            panelOpen={sectionOpen.clusterInbox}
            onTogglePanel={() => toggleSection("clusterInbox")}
          />

          <CollapsiblePanel
            title={copy.sections.hypothesisDrift}
            meta={`${driftQueue.length} ${text(locale, "항목", "items")}`}
            open={sectionOpen.hypothesisDrift}
            onToggle={() => toggleSection("hypothesisDrift")}
          >
            <div className="space-y-2">
              {driftQueue.map(({ event, primary, counter, drift, absentCount, invalidatedCount }) => (
                <div key={event.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
                  <p className="text-white">{event.title}</p>
                  <p className="mt-1 text-white/45">
                    {text(locale, "주 가설", "primary")} {primary.toFixed(2)} · {text(locale, "대안", "counter")} {counter.toFixed(2)} · {text(locale, "드리프트", "drift")} {drift.toFixed(2)}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    {text(locale, "부재", "absence")} {absentCount} · {text(locale, "무효화", "invalidated")} {invalidatedCount} · {text(locale, "반박", "contradictions")} {event.contradictionCount} · {text(locale, "비소셜", "non-social")} {event.nonSocialCorroborationCount} · {text(locale, "건전도", "health")} {event.linkedClaimHealthScore.toFixed(2)} · {text(locale, "시간", "time")} {event.timeCoherenceScore.toFixed(2)} · {text(locale, "시간축", "temporal")} {narrativeStateLabel(event.temporalNarrativeState ?? "new", locale)}
                  </p>
                </div>
              ))}
            </div>
          </CollapsiblePanel>
        </section>

          <CollapsiblePanel
            title={copy.sections.executionInbox}
            meta={`${filteredExecutionInbox.length} ${text(locale, "표시", "visible")} / ${executionInbox.length} ${text(locale, "전체", "total")}`}
          open={sectionOpen.executionInbox}
          onToggle={() => toggleSection("executionInbox")}
        >
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-[11px] text-white/55">
              <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "상태", "Status")}</span>
              <select
                value={executionStatusFilter}
                onChange={(event) => setExecutionStatusFilter(event.target.value as typeof executionStatusFilter)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="all" className="bg-slate-900">{text(locale, "전체", "all")}</option>
                <option value="pending" className="bg-slate-900">{text(locale, "대기", "pending")}</option>
                <option value="blocked" className="bg-slate-900">{text(locale, "차단", "blocked")}</option>
                <option value="executed" className="bg-slate-900">{text(locale, "실행됨", "executed")}</option>
              </select>
            </label>
            <label className="space-y-1 text-[11px] text-white/55">
              <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "차단 사유", "Blocked Reason")}</span>
              <select
                value={executionBlockedReasonFilter}
                onChange={(event) => setExecutionBlockedReasonFilter(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="all" className="bg-slate-900">{text(locale, "전체", "all")}</option>
                {executionBlockedReasons.map((reason) => (
                  <option key={reason} value={reason} className="bg-slate-900">{reason}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-[11px] text-white/55">
              <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "도구", "Tool")}</span>
              <select
                value={executionToolFilter}
                onChange={(event) => setExecutionToolFilter(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="all" className="bg-slate-900">{text(locale, "전체", "all")}</option>
                {executionTools.map((tool) => (
                  <option key={tool} value={tool} className="bg-slate-900">{tool}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {filteredExecutionInbox.length === 0 ? (
              <p className="text-xs text-white/40">{copy.noExecutionCandidates}</p>
            ) : (
              filteredExecutionInbox.map(({ event, candidate }) => (
                <div key={candidate.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-white">{candidate.title}</p>
                      <p className="mt-1 text-[11px] text-white/45">
                        {event.title} · {executionStatusLabel(candidate.status, locale)} · {candidate.executionMode} · {candidate.riskBand}
                      </p>
                      <p className="mt-1 text-[11px] text-white/35">
                        {text(locale, "우선순위", "priority")} {event.operatorPriorityScore ?? 0} · {text(locale, "구조성", "structurality")} {event.structuralityScore.toFixed(2)} · {text(locale, "행동성", "actionability")} {event.actionabilityScore.toFixed(2)} · {text(locale, "시간", "time")} {event.timeCoherenceScore.toFixed(2)}
                      </p>
                      {readBlockedReason(candidate) ? (
                        <p className="mt-1 text-[11px] text-amber-200/85">
                          {text(locale, "차단 사유", "blocked reason")} · {readBlockedReason(candidate)}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-white/35">
                        {text(locale, "도구", "tool")} {typeof candidate.payload?.mcp_tool_name === "string" ? candidate.payload.mcp_tool_name : text(locale, "알수없음", "unknown")} · {text(locale, "커넥터", "connector")}{" "}
                        {typeof candidate.payload?.connector_capability === "object" &&
                        candidate.payload.connector_capability !== null &&
                        typeof (candidate.payload.connector_capability as { connector_id?: unknown }).connector_id === "string"
                          ? (candidate.payload.connector_capability as { connector_id: string }).connector_id
                          : text(locale, "내장", "builtin")}
                      </p>
                      <p className="mt-2 text-xs text-white/65">{candidate.summary}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => void selectEvent(event.id)}
                        className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/70"
                      >
                        {text(locale, "열기", "Open")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAction("execute", candidate.id)}
                        disabled={candidate.status === "executed" || busyKey === "action:execute"}
                        className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyKey === "action:execute" ? "..." : text(locale, "실행", "Run")}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/45">
                    <span>{text(locale, "검토", "review")} {reviewStateLabel(event.reviewState, locale)}</span>
                    <span>{text(locale, "토론", "deliberation")} {executionStatusLabel(event.deliberationStatus, locale)}</span>
                    <span>{text(locale, "클레임", "claims")} {event.linkedClaimCount}</span>
                    <span>{text(locale, "반박", "contradictions")} {event.contradictionCount}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </CollapsiblePanel>
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

function CollapsiblePanel({
  title,
  meta,
  open,
  onToggle,
  children,
  className = "",
}: {
  title: string;
  meta?: string | null;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const isKorean =
    typeof document !== "undefined" ? document.documentElement.lang.startsWith("ko") : true;
  return (
    <section className={`rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl ${className}`.trim()}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-white">{title}</h2>
          {meta ? <p className="mt-1 text-xs text-white/45">{meta}</p> : null}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70 hover:border-white/20 hover:bg-white/[0.08]"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open ? (isKorean ? "접기" : "Hide") : isKorean ? "펼치기" : "Show"}
        </button>
      </div>
      {open ? children : null}
    </section>
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

function DetailBlock({ title, items, locale }: { title: string; items: string[]; locale?: "ko" | "en" }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">{title}</h3>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/60"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>
      {open ? (
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-white/40">{locale === "ko" ? "데이터 없음" : "No data"}</p>
          ) : (
            items.map((item, index) => (
              <div key={`${title}-${index}`} className="rounded-xl border border-white/8 bg-black/25 px-3 py-2 text-xs leading-5 text-white/70">
                {item}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function ScopeActionBlock({
  title,
  items,
  locale,
}: {
  title: string;
  locale: "ko" | "en";
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
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">{title}</h3>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/60"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>
      {open ? (
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-white/40">{locale === "ko" ? "대상 없음" : "No targets"}</p>
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
                      {item.noteBusy ? "..." : text(locale, "메모", "Note")}
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
                            {item.reviewBusyState === state ? "..." : reviewStateLabel(state, locale)}
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
      ) : null}
    </div>
  );
}

function RelatedNarrativesPanel({
  locale,
  items,
  onSelectEvent,
}: {
  locale: "ko" | "en";
  items: IntelligenceRelatedHistoricalEventSummary[];
  onSelectEvent: (eventId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">{text(locale, "연결 서사", "Related Narratives")}</h3>
        <span className="text-[11px] text-white/40">{items.length} {text(locale, "연결", "related")}</span>
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
                {temporalRelationLabel(item.relation, locale)} · {text(locale, "점수", "score")} {item.score.toFixed(2)} · {item.daysDelta ?? "—"}{locale === "ko" ? "일 전" : "d ago"}
              </p>
              <p className="mt-1 text-[11px] text-white/35">
                {text(locale, "도메인", "domain")} {domainLabel(item.topDomainId, locale)} · {text(locale, "그래프", "graph")} +{item.graphSupportScore.toFixed(2)} / -{item.graphContradictionScore.toFixed(2)} / {text(locale, "핫스팟", "hot")} {item.graphHotspotCount} · {text(locale, "시간", "time")} {item.timeCoherenceScore.toFixed(2)}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function NarrativeClusterPanel({
  locale,
  cluster,
  members,
  notes,
  onSelectEvent,
  onOpenClusterInbox,
  onNoteClick,
  onReviewStateChange,
  reviewBusyState,
}: {
  locale: "ko" | "en";
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
        <h3 className="text-sm font-mono uppercase tracking-[0.2em] text-white/70">{text(locale, "서사 클러스터", "Narrative Cluster")}</h3>
        <span className="text-[11px] text-white/45">{cluster ? `${cluster.eventCount} ${text(locale, "이벤트", "events")}` : text(locale, "없음", "none")}</span>
      </div>
      {!cluster ? (
        <p className="text-sm text-white/45">반복 서사 클러스터가 아직 형성되지 않았다.</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <p className="text-sm font-medium text-white">{cluster.title}</p>
            <p className="mt-2 text-[11px] text-white/50">
              {narrativeStateLabel(cluster.state, locale)} · {eventFamilyLabel(cluster.eventFamily, locale)} · {text(locale, "도메인", "domain")} {domainLabel(cluster.topDomainId, locale)} · {text(locale, "반복 점수", "recurring score")} {cluster.latestRecurringScore.toFixed(2)} · {text(locale, "핫스팟 이벤트", "hotspot events")} {cluster.hotspotEventCount}
            </p>
            <p className="mt-1 text-[11px] text-white/40">
              {text(locale, "반복", "recurring")} {cluster.recurringEventCount} · {text(locale, "분기", "diverging")} {cluster.divergingEventCount} · {text(locale, "지지 이력", "supportive")} {cluster.supportiveHistoryCount} · {text(locale, "최근", "last")} {formatDateTime(cluster.lastEventAt)}
            </p>
            <p className="mt-1 text-[11px] text-white/35">
              {text(locale, "드리프트", "drift")} {cluster.driftScore.toFixed(2)} · {text(locale, "지지", "support")} {cluster.supportScore.toFixed(2)} · {text(locale, "반박", "contradiction")} {cluster.contradictionScore.toFixed(2)} · {text(locale, "시간", "time")} {cluster.timeCoherenceScore.toFixed(2)}
            </p>
            <p className="mt-1 text-[11px] text-white/35">
              {text(locale, "검토", "review")} {reviewStateLabel(cluster.reviewState, locale)} · {text(locale, "사유", "reason")} {cluster.reviewReason ?? "—"} · {text(locale, "담당", "owner")} {cluster.reviewOwner ?? "—"} · {text(locale, "해결", "resolved")} {formatDateTime(cluster.reviewResolvedAt)}
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
                  {reviewBusyState === state ? "..." : reviewStateLabel(state, locale)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onOpenClusterInbox(cluster.id)}
                className="rounded-lg border border-violet-300/25 bg-violet-400/10 px-2.5 py-1 text-[11px] text-violet-100"
              >
                {text(locale, "클러스터 인박스", "cluster inbox")}
              </button>
              <button
                type="button"
                onClick={onNoteClick}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70"
              >
                {text(locale, "클러스터 메모", "cluster note")}
              </button>
            </div>
          </div>
          {notes.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">{text(locale, "클러스터 메모", "Cluster Notes")}</p>
              <div className="mt-2 space-y-2">
                {notes.slice(0, 4).map((note) => (
                  <div key={note.id} className="rounded-xl border border-white/8 bg-black/25 px-3 py-2 text-[11px] text-white/65">
                    <p>{note.note}</p>
                    <p className="mt-1 text-white/35">
                      {text(locale, "작성자", "by")} {note.userId} · {formatDateTime(note.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">{text(locale, "클러스터 드리프트", "Cluster Drift")}</p>
            <p className="mt-2 text-[11px] text-white/45">
              {text(locale, "분기 압력", "divergence pressure")} {cluster.divergingEventCount}/{cluster.eventCount} · {text(locale, "핫스팟 압력", "hotspot pressure")} {cluster.hotspotEventCount}/{cluster.eventCount}
            </p>
            <p className="mt-1 text-[11px] text-white/35">
              {text(locale, "반복 지지", "recurring support")} {cluster.recurringEventCount + cluster.supportiveHistoryCount} · {text(locale, "반박 점수", "contradiction score")} {cluster.contradictionScore.toFixed(2)}
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
                  <span>{member.isLatest ? text(locale, "최신", "latest") : temporalRelationLabel(member.relation, locale)}</span>
                  <span>{text(locale, "점수", "score")} {member.score.toFixed(2)}</span>
                  <span>{text(locale, "일 차이", "days Δ")} {member.daysDelta ?? "—"}</span>
                  <span>{text(locale, "시간", "time")} {member.timeCoherenceScore.toFixed(2)}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-white">{member.title}</p>
                <p className="mt-2 text-[11px] text-white/45">
                  {text(locale, "그래프", "graph")} +{member.graphSupportScore.toFixed(2)} / -{member.graphContradictionScore.toFixed(2)} / {text(locale, "핫스팟", "hot")} {member.graphHotspotCount} · {text(locale, "상태", "state")} {narrativeStateLabel(member.temporalNarrativeState ?? "unknown", locale)} · {text(locale, "최근", "last")} {formatDateTime(member.lastEventAt)}
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
  locale,
  runtime,
  workspaceId,
  busyKey,
  onSaveBindings,
}: {
  locale: "ko" | "en";
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
      <h2 className="mb-3 text-sm font-mono uppercase tracking-[0.25em] text-white/70">{text(locale, "모델 제어판", "Model Control Plane")}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/50">{text(locale, "레지스트리", "Registry")}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{runtime.models.length}</p>
          <p className="mt-1 text-xs text-white/50">{text(locale, "사용 가능한 모델 항목", "available model entries")}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/50">{text(locale, "별칭 바인딩", "Alias Bindings")}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{runtime.aliases.workspace.length + runtime.aliases.global.length}</p>
          <p className="mt-1 text-xs text-white/50">{text(locale, "워크스페이스 + 글로벌 바인딩", "workspace + global bindings")}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/50">{text(locale, "프로바이더 상태", "Provider Health")}</p>
          <div className="mt-3 space-y-2">
            {runtime.providerHealth.length === 0 ? (
              <p className="text-xs text-white/40">{text(locale, "프로바이더 상태 텔레메트리가 아직 없다.", "No provider health telemetry yet")}</p>
            ) : (
              runtime.providerHealth.map((row) => (
                <div key={row.provider} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-white/70">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-cyan-200">{providerLabel(row.provider, locale)}</span>
                    <span className={row.available ? "text-emerald-200" : "text-amber-200"}>
                      {row.available ? text(locale, "사용 가능", "available") : text(locale, "저하", "degraded")}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/45">
                    {text(locale, "실패", "failures")} {row.failureCount} · {text(locale, "쿨다운", "cooldown")} {formatDateTime(row.cooldownUntil)} · {row.reasonCode ?? workerStatusLabel("ok", locale)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/50">{text(locale, "별칭 롤아웃", "Alias Rollouts")}</p>
          <div className="mt-3 space-y-2">
            {runtime.rollouts.workspace.concat(runtime.rollouts.global).slice(0, 8).map((rollout) => (
              <div key={rollout.id} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-white/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-cyan-200">{capabilityAliasLabel(rollout.alias, locale)}</span>
                  <span className="text-white/40">{formatDateTime(rollout.createdAt)}</span>
                </div>
                <p className="mt-1 text-[11px] text-white/45">
                  {rollout.workspaceId ? text(locale, "워크스페이스", "workspace") : text(locale, "글로벌", "global")} · {text(locale, "바인딩", "bindings")} {rollout.bindingIds.length} · {rollout.note ?? text(locale, "메모 없음", "no note")}
                </p>
              </div>
            ))}
            {runtime.rollouts.workspace.length + runtime.rollouts.global.length === 0 ? (
              <p className="text-xs text-white/40">{text(locale, "롤아웃 이력이 아직 없다.", "No rollout history yet")}</p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-[11px] text-white/55">
            <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "별칭", "Alias")}</span>
            <select
              value={alias}
              onChange={(event) => setAlias(event.target.value as IntelligenceCapabilityAlias)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
            >
              {RUNTIME_ALIAS_OPTIONS.map((value) => (
                <option key={value} value={value} className="bg-slate-900">{capabilityAliasLabel(value, locale)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[11px] text-white/55">
            <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "범위", "Scope")}</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as RuntimeBindingScope)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
            >
              <option value="workspace" className="bg-slate-900">{text(locale, "워크스페이스", "workspace")}</option>
              <option value="global" className="bg-slate-900">{text(locale, "글로벌", "global")}</option>
            </select>
          </label>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">
            <p className="font-mono uppercase tracking-[0.18em] text-white/40">{text(locale, "변경 미리보기", "Diff Preview")}</p>
            <p className="mt-2">{text(locale, "워크스페이스", "workspace")} {workspaceId ?? "—"}</p>
            <p className="mt-1">{text(locale, "기준", "baseline")} {aliasBindings.length} · {text(locale, "초안", "draft")} {drafts.length} · {dirty ? text(locale, "변경됨", "changed") : text(locale, "깨끗함", "clean")}</p>
            <p className="mt-1 text-[11px] text-white/45">
              +{changeSummary.added} / -{changeSummary.removed} / ~{changeSummary.changed} / ={changeSummary.unchanged}
            </p>
          </div>
        </div>
        {changeSummary.rows.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{text(locale, "대기 변경", "Pending Changes")}</p>
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
                      {text(locale, row.kind === "added" ? "추가" : row.kind === "removed" ? "제거" : "변경", row.kind)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/45">{row.details.join(" · ")}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{text(locale, "선택된 별칭 롤아웃", "Selected Alias Rollouts")}</p>
          <div className="mt-2 space-y-2">
            {selectedRollouts.length === 0 ? (
              <p className="text-xs text-white/40">{text(locale, "이 별칭/범위의 롤아웃 이력이 아직 없다.", "No rollout history for this alias/scope yet")}</p>
            ) : (
              selectedRollouts.map((rollout) => (
                <div key={rollout.id} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-white/70">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-cyan-200">{rollout.alias}</span>
                    <span className="text-white/40">{formatDateTime(rollout.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/45">
                    {scope === "workspace" ? text(locale, "워크스페이스", "workspace") : text(locale, "글로벌", "global")} · {text(locale, "바인딩", "bindings")} {rollout.bindingIds.length} · {rollout.note ?? text(locale, "메모 없음", "no note")}
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
                    <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "프로바이더", "Provider")}</span>
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
                        <option key={provider} value={provider} className="bg-slate-900">{providerLabel(provider, locale)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-[11px] text-white/55">
                    <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "모델", "Model")}</span>
                    <select
                      value={draft.modelId}
                      onChange={(event) => updateDraft(index, { modelId: event.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    >
                      {availableModelIds.length === 0 ? (
                        <option value="" className="bg-slate-900">{text(locale, "모델 없음", "no models")}</option>
                      ) : null}
                      {availableModelIds.map((modelId) => (
                        <option key={modelId} value={modelId} className="bg-slate-900">{modelId}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-[11px] text-white/55">
                    <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "가중치", "Weight")}</span>
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
                    <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "카나리 %", "Canary %")}</span>
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
                    <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "폴백 순위", "Fallback Rank")}</span>
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
                    <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "최대 비용", "Max Cost")}</span>
                    <select
                      value={draft.maxCostClass ?? "none"}
                      onChange={(event) =>
                        updateDraft(index, {
                          maxCostClass: event.target.value === "none" ? null : event.target.value as RuntimeBindingDraft["maxCostClass"],
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="none" className="bg-slate-900">{text(locale, "없음", "none")}</option>
                      <option value="free" className="bg-slate-900">{text(locale, "무료", "free")}</option>
                      <option value="low" className="bg-slate-900">{text(locale, "낮음", "low")}</option>
                      <option value="standard" className="bg-slate-900">{text(locale, "표준", "standard")}</option>
                      <option value="premium" className="bg-slate-900">{text(locale, "고급", "premium")}</option>
                    </select>
                  </label>
                  <div className="col-span-2 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-white/65">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={draft.isActive} onChange={(event) => updateDraft(index, { isActive: event.target.checked })} />
                      {text(locale, "활성", "active")}
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={draft.requiresStructuredOutput} onChange={(event) => updateDraft(index, { requiresStructuredOutput: event.target.checked })} />
                      {text(locale, "구조화", "structured")}
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={draft.requiresToolUse} onChange={(event) => updateDraft(index, { requiresToolUse: event.target.checked })} />
                      {text(locale, "툴 사용", "tool use")}
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={draft.requiresLongContext} onChange={(event) => updateDraft(index, { requiresLongContext: event.target.checked })} />
                      {text(locale, "긴 컨텍스트", "long context")}
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
                    {text(locale, "제거", "remove")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-white/45">
            {text(locale, "수정은 additive rollout로 저장된다. global 편집도 backend 권한 검사를 그대로 탄다.", "Changes are saved as additive rollouts. Global edits still use backend permission checks.")}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addDraft}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/70"
            >
              {text(locale, "바인딩 추가", "add binding")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!workspaceId || !dirty || busyKey === effectiveBusyKey}
              className="rounded-lg border border-cyan-300/40 bg-cyan-400/10 px-3 py-1.5 text-[11px] text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyKey === effectiveBusyKey ? text(locale, "저장중...", "saving...") : text(locale, "바인딩 저장", "save bindings")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function NarrativeClusterInboxPanel({
  locale,
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
  panelTitle,
  panelOpen,
  onTogglePanel,
}: {
  locale: "ko" | "en";
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
  panelTitle: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const activeCluster = selectedClusterDetail?.narrativeCluster ?? null;
  const latestClusterLedgerEntry = selectedClusterDetail?.ledgerEntries?.[0] ?? null;
  const currentClusterTransition = activeCluster?.lastTransition
    ? {
        entryType: activeCluster.lastTransition.entry_type,
        summary: activeCluster.lastTransition.summary,
        scoreDelta: activeCluster.lastTransition.score_delta,
        createdAt: activeCluster.lastTransition.created_at,
      }
    : latestClusterLedgerEntry;
  return (
    <CollapsiblePanel
      title={panelTitle}
      meta={`${clusters.length} clusters`}
      open={panelOpen}
      onToggle={onTogglePanel}
    >
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-[11px] text-white/55">
          <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "상태", "State")}</span>
          <select
            value={stateFilter}
            onChange={(event) => onStateFilterChange(event.target.value as "all" | "forming" | "recurring" | "diverging")}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
          >
            {["all", "forming", "recurring", "diverging"].map((value) => (
              <option key={value} value={value} className="bg-slate-900">{value === "all" ? text(locale, "전체", "all") : narrativeStateLabel(value, locale)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-white/55">
          <span className="font-mono uppercase tracking-[0.18em]">{text(locale, "검토", "Review")}</span>
          <select
            value={reviewFilter}
            onChange={(event) => onReviewFilterChange(event.target.value as "all" | EventReviewState)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
          >
            {["all", "watch", "review", "ignore"].map((value) => (
              <option key={value} value={value} className="bg-slate-900">{value === "all" ? text(locale, "전체", "all") : reviewStateLabel(value as EventReviewState, locale)}</option>
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
          {text(locale, "핫스팟만", "hotspot only")}
        </button>
        <button
          type="button"
          onClick={() => onBlockedOnlyChange(!blockedOnly)}
          className={`rounded-full border px-3 py-1 ${blockedOnly ? "border-amber-300/40 bg-amber-500/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-white/60"}`}
        >
          {text(locale, "차단만", "blocked only")}
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="space-y-2">
          {clusters.length === 0 ? (
            <p className="text-xs text-white/40">{text(locale, "서사 클러스터가 없다.", "No narrative clusters")}</p>
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
                    {text(locale, "우선순위", "priority")} {cluster.clusterPriorityScore} · {narrativeStateLabel(cluster.state, locale)} · {text(locale, "검토", "review")} {reviewStateLabel(cluster.reviewState, locale)}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    {text(locale, "드리프트", "drift")} {cluster.driftScore.toFixed(2)} · {text(locale, "반박", "contradiction")} {cluster.contradictionScore.toFixed(2)} · {text(locale, "핫스팟", "hotspot")} {cluster.hotspotEventCount} · {text(locale, "차단", "blocked")} {cluster.recentExecutionBlockedCount}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    {text(locale, "반복 추세", "recur trend")} {cluster.recurringStrengthTrend.toFixed(2)} · {text(locale, "분기 추세", "div trend")} {cluster.divergenceTrend.toFixed(2)} · {text(locale, "감쇠", "decay")} {cluster.supportDecayScore.toFixed(2)} · {text(locale, "가속", "accel")} {cluster.contradictionAcceleration.toFixed(2)}
                  </p>
                  {cluster.lastTransition ? (
                    <p className="mt-1 text-[11px] text-white/30">
                      {temporalRelationLabel(cluster.lastTransition.entry_type, locale)} · {cluster.lastTransition.summary} · {formatDateTime(cluster.lastTransition.created_at)}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-white/30">
                      {text(locale, "최근 전이", "last transition")} {formatDateTime(cluster.lastLedgerAt)}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="space-y-3">
          {!activeCluster ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-white/45">
              {text(locale, "cluster를 선택하면 timeline, ledger, recent event, graph hotspot을 볼 수 있다.", "Select a cluster to inspect its timeline, ledger, recent events, and graph hotspots.")}
              </div>
          ) : (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{activeCluster.title}</p>
                    <p className="mt-1 text-[11px] text-white/45">
                      {text(locale, "우선순위", "priority")} {activeCluster.clusterPriorityScore} · {narrativeStateLabel(activeCluster.state, locale)} · {text(locale, "검토", "review")} {reviewStateLabel(activeCluster.reviewState, locale)}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      {text(locale, "드리프트", "drift")} {activeCluster.driftScore.toFixed(2)} · {text(locale, "지지", "support")} {activeCluster.supportScore.toFixed(2)} · {text(locale, "반박", "contradiction")} {activeCluster.contradictionScore.toFixed(2)} · {text(locale, "시간", "time")} {activeCluster.timeCoherenceScore.toFixed(2)}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      {text(locale, "이벤트", "events")} {activeCluster.eventCount} · {text(locale, "반복", "recurring")} {activeCluster.recurringEventCount} · {text(locale, "분기", "diverging")} {activeCluster.divergingEventCount} · {text(locale, "차단", "blocked")} {activeCluster.recentExecutionBlockedCount}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      {text(locale, "반복 추세", "recur trend")} {activeCluster.recurringStrengthTrend.toFixed(2)} · {text(locale, "분기 추세", "div trend")} {activeCluster.divergenceTrend.toFixed(2)} · {text(locale, "지지 감쇠", "support decay")} {activeCluster.supportDecayScore.toFixed(2)} · {text(locale, "반박 가속", "contradiction accel")} {activeCluster.contradictionAcceleration.toFixed(2)}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      {text(locale, "최근 반복", "last recurring")} {formatDateTime(activeCluster.lastRecurringAt)} · {text(locale, "최근 분기", "last diverging")} {formatDateTime(activeCluster.lastDivergingAt)}
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
                        {busyKey === `narrative-cluster-review:${activeCluster.id}:${state}` ? "..." : reviewStateLabel(state, locale)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onNoteClick(activeCluster.id, recentEvents[0]?.id ?? null)}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70"
                    >
                      {busyKey === `operator-note:create:narrative_cluster:${activeCluster.id}` ? "..." : text(locale, "메모", "note")}
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <DetailBlock
                  locale={locale}
                  title={text(locale, "클러스터 타임라인", "Cluster Timeline")}
                  items={selectedClusterTimeline.map((entry) => `${formatDateTime(entry.bucketStart)} · ${text(locale, "이벤트", "events")} ${entry.eventCount} · ${text(locale, "반복", "recurring")} ${entry.recurringScore.toFixed(2)} · ${text(locale, "드리프트", "drift")} ${entry.driftScore.toFixed(2)} · ${text(locale, "반박", "contradiction")} ${entry.contradictionScore.toFixed(2)} · ${text(locale, "핫스팟", "hotspot")} ${entry.hotspotEventCount}`)}
                />
                <DetailBlock
                  locale={locale}
                  title={text(locale, "클러스터 원장", "Cluster Ledger")}
                  items={(selectedClusterDetail?.ledgerEntries ?? []).map((entry) => `${temporalRelationLabel(entry.entryType, locale)} · ${entry.summary} · Δ ${entry.scoreDelta.toFixed(2)} · ${formatDateTime(entry.createdAt)}`)}
                />
              </div>
              {selectedClusterTrendSummary ? (
                <DetailBlock
                  locale={locale}
                  title={text(locale, "추세 요약", "Trend Summary")}
                  items={[
                    `${text(locale, "반복 추세", "recurring trend")} ${selectedClusterTrendSummary.recurring_strength_trend.toFixed(2)} · ${text(locale, "분기 추세", "divergence trend")} ${selectedClusterTrendSummary.divergence_trend.toFixed(2)}`,
                    `${text(locale, "지지 감쇠", "support decay")} ${selectedClusterTrendSummary.support_decay_score.toFixed(2)} · ${text(locale, "반박 가속", "contradiction acceleration")} ${selectedClusterTrendSummary.contradiction_acceleration.toFixed(2)}`,
                    `${text(locale, "최근 반복", "last recurring")} ${formatDateTime(selectedClusterTrendSummary.last_recurring_at)} · ${text(locale, "최근 분기", "last diverging")} ${formatDateTime(selectedClusterTrendSummary.last_diverging_at)}`,
                  ]}
                />
              ) : null}
              {currentClusterTransition ? (
                <DetailBlock
                  locale={locale}
                  title={text(locale, "현재 전이", "Current Transition")}
                  items={[
                    `${temporalRelationLabel(currentClusterTransition.entryType, locale)} · ${currentClusterTransition.summary}`,
                    `${text(locale, "변화", "delta")} ${currentClusterTransition.scoreDelta.toFixed(2)} · ${formatDateTime(currentClusterTransition.createdAt)}`,
                  ]}
                />
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <DetailBlock
                  locale={locale}
                  title={text(locale, "최근 이벤트", "Recent Events")}
                  items={recentEvents.map((event) => `${event.title} · ${narrativeStateLabel(event.temporalNarrativeState ?? "new", locale)} · ${text(locale, "그래프", "graph")} +${event.graphSupportScore.toFixed(2)} / -${event.graphContradictionScore.toFixed(2)} / ${text(locale, "핫스팟", "hot")} ${event.graphHotspotCount}`)}
                />
                <DetailBlock
                  locale={locale}
                  title={text(locale, "클러스터 그래프", "Cluster Graph")}
                  items={
                    selectedClusterGraph
                      ? [
                          `${text(locale, "연결 클레임", "linked claims")} ${selectedClusterGraph.summary.linkedClaimCount} · ${text(locale, "엣지", "edges")} ${selectedClusterGraph.summary.edgeCount}`,
                          `${text(locale, "지지", "support")} ${selectedClusterGraph.summary.graphSupportScore.toFixed(2)} · ${text(locale, "반박", "contradiction")} ${selectedClusterGraph.summary.graphContradictionScore.toFixed(2)} · ${text(locale, "핫스팟", "hotspots")} ${selectedClusterGraph.summary.graphHotspotCount}`,
                          ...selectedClusterGraph.hotspotClusters.slice(0, 4).map((cluster) => `${cluster.label} · ${text(locale, "핫스팟", "hotspot")} ${cluster.hotspotScore.toFixed(2)} · ${text(locale, "멤버", "members")} ${cluster.memberLinkedClaimIds.length}`),
                        ]
                      : []
                  }
                />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">{text(locale, "클러스터 멤버십", "Cluster Memberships")}</h3>
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
                        {temporalRelationLabel(member.relation, locale)} · {text(locale, "점수", "score")} {member.score.toFixed(2)} · {text(locale, "일 차이", "days Δ")} {member.daysDelta ?? "—"} · {text(locale, "시간", "time")} {member.timeCoherenceScore.toFixed(2)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
              {notes.length > 0 ? (
                <DetailBlock
                  locale={locale}
                  title={text(locale, "클러스터 메모", "Cluster Notes")}
                  items={notes.map((note) => `${formatDateTime(note.createdAt)} · ${note.note}`)}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </CollapsiblePanel>
  );
}

function TemporalNarrativeLedgerPanel({
  locale,
  items,
  onSelectEvent,
}: {
  locale: "ko" | "en";
  items: IntelligenceTemporalNarrativeLedgerEntryRecord[];
  onSelectEvent: (eventId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-mono uppercase tracking-[0.2em] text-white/70">{text(locale, "시간축 서사 원장", "Temporal Narrative Ledger")}</h3>
        <span className="text-[11px] text-white/45">{items.length} {text(locale, "항목", "entries")}</span>
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
                <span>{temporalRelationLabel(item.relation, locale)}</span>
                <span>{text(locale, "점수", "score")} {item.score.toFixed(2)}</span>
                <span>{text(locale, "일 차이", "days Δ")} {item.daysDelta ?? "—"}</span>
                <span>{text(locale, "도메인", "domain")} {domainLabel(item.topDomainId, locale)}</span>
                <span>{text(locale, "업데이트", "updated")} {formatDateTime(item.updatedAt)}</span>
              </div>
              <p className="mt-2 text-sm font-medium text-white">{item.relatedEventTitle}</p>
              <p className="mt-2 text-[11px] text-white/45">
                {text(locale, "그래프", "graph")} +{item.graphSupportScore.toFixed(2)} / -{item.graphContradictionScore.toFixed(2)} / {text(locale, "핫스팟", "hot")} {item.graphHotspotCount} · {text(locale, "시간", "time")} {item.timeCoherenceScore.toFixed(2)}
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ClaimGraphPanel({
  locale,
  graph,
  onNoteClick,
  onReviewStateChange,
  busyKey,
}: {
  locale: "ko" | "en";
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
        <h3 className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-white/60">{text(locale, "클레임 그래프", "Claim Graph")}</h3>
        <p className="text-xs text-white/40">그래프 데이터가 아직 없다.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/60">{text(locale, "클레임 그래프", "Claim Graph")}</h3>
          <p className="mt-1 text-[11px] text-white/40">
            {text(locale, "지지", "support")} {graph.summary.graphSupportScore.toFixed(2)} · {text(locale, "반박", "contradiction")} {graph.summary.graphContradictionScore.toFixed(2)} · {text(locale, "핫스팟", "hotspots")} {graph.summary.graphHotspotCount}
          </p>
          <p className="mt-1 text-[11px] text-white/35">
            {text(locale, "시간축", "temporal")} {narrativeStateLabel(graph.summary.temporalNarrativeState ?? "new", locale)} · {text(locale, "반복", "recurring")} {(graph.summary.recurringNarrativeScore ?? 0).toFixed(2)} · {text(locale, "연결", "related")} {graph.summary.relatedHistoricalEventCount ?? 0} · {text(locale, "클러스터", "clusters")} {graph.summary.hotspotClusterCount ?? graph.hotspotClusters.length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] text-white/45">
          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-100/80">{text(locale, "지지", "support")}</span>
          <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-2 py-0.5 text-rose-100/80">{text(locale, "반박", "contradict")}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-white/60">{text(locale, "관련", "related")}</span>
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
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{text(locale, "선택된 클레임", "Selected Claim")}</p>
                <p className="mt-2 text-sm text-white/90">
                  {selectedNode.canonicalSubject} {selectedNode.canonicalPredicate} {selectedNode.canonicalObject}
                </p>
                <p className="mt-2 text-[11px] text-white/45">
                  {text(locale, "패밀리", "family")} {selectedNode.predicateFamily} · {text(locale, "비소셜", "non-social")} {selectedNode.nonSocialSourceCount} · {text(locale, "반박", "contradictions")} {selectedNode.contradictionCount}
                </p>
                <p className="mt-1 text-[11px] text-white/35">
                  {text(locale, "버킷", "bucket")} {formatDateTime(selectedNode.timeBucketStart)} ~ {formatDateTime(selectedNode.timeBucketEnd)}
                </p>
                <p className="mt-1 text-[11px] text-white/35">
                  {text(locale, "지지", "support")} {formatDateTime(selectedNode.lastSupportedAt)} · {text(locale, "반박", "contradict")} {formatDateTime(selectedNode.lastContradictedAt)}
                </p>
                {selectedNode.reviewReason || selectedNode.reviewOwner || selectedNode.reviewResolvedAt ? (
                  <p className="mt-1 text-[11px] text-white/35">
                    {text(locale, "사유", "reason")} {selectedNode.reviewReason ?? "—"} · {text(locale, "담당", "owner")} {selectedNode.reviewOwner ?? "—"} · {text(locale, "해결", "resolved")} {formatDateTime(selectedNode.reviewResolvedAt)}
                  </p>
                ) : null}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{text(locale, "연결 엣지", "Connected Edges")}</p>
                <div className="mt-2 space-y-2">
                  {graph.edges
                    .filter((edge) => edge.leftLinkedClaimId === selectedNode.id || edge.rightLinkedClaimId === selectedNode.id)
                    .slice(0, 8)
                    .map((edge) => {
                      const neighborId =
                        edge.leftLinkedClaimId === selectedNode.id ? edge.rightLinkedClaimId : edge.leftLinkedClaimId;
                      return (
                        <div key={edge.id} className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[11px] text-white/65">
                          {graphRelationLabel(edge.relation, locale)} · {text(locale, "강도", "strength")} {edge.edgeStrength.toFixed(2)} · {text(locale, "이웃", "neighbor")} {neighborId.slice(0, 8)} · {text(locale, "신호", "signals")} {edge.evidence_signal_count}
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
                    {busyKey === `linked-claim-review:${selectedNode.id}:${state}` ? "..." : reviewStateLabel(state, locale)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onNoteClick(selectedNode.id)}
                  className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100"
                >
                  {busyKey === `operator-note:create:linked_claim:${selectedNode.id}` ? "..." : text(locale, "메모", "Note")}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-white/40">{text(locale, "노드를 선택하면 claim detail을 본다.", "Select a node to inspect claim detail.")}</p>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h4 className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{text(locale, "핫스팟 클러스터", "Hotspot Clusters")}</h4>
          <div className="mt-3 space-y-2">
            {graph.hotspotClusters.length === 0 ? (
              <p className="text-xs text-white/40">{text(locale, "반박 핫스팟이 없다.", "No contradiction hotspots")}</p>
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
                    {text(locale, "핫스팟", "hotspot")} {cluster.hotspotScore.toFixed(2)} · {text(locale, "멤버", "members")} {cluster.memberLinkedClaimIds.length}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    {text(locale, "반박 엣지", "contradict edges")} {cluster.contradictionEdgeCount} · {text(locale, "지지 엣지", "support edges")} {cluster.supportEdgeCount}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h4 className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{text(locale, "연결 서사", "Related Narratives")}</h4>
          <div className="mt-3 space-y-2">
            {graph.relatedHistoricalEvents.length === 0 ? (
              <p className="text-xs text-white/40">{text(locale, "연결된 과거 사건이 없다.", "No related historical events")}</p>
            ) : (
              graph.relatedHistoricalEvents.map((item) => (
                <div key={item.eventId} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-white/70">
                  <p className="text-white/85">{item.title}</p>
                  <p className="mt-1 text-[11px] text-white/45">
                    {temporalRelationLabel(item.relation, locale)} · {text(locale, "점수", "score")} {item.score.toFixed(2)} · {item.daysDelta ?? "—"}{locale === "ko" ? "일 전" : "d ago"}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    {text(locale, "그래프", "graph")} +{item.graphSupportScore.toFixed(2)} / -{item.graphContradictionScore.toFixed(2)} / {text(locale, "핫스팟", "hot")} {item.graphHotspotCount} · {text(locale, "시간", "time")} {item.timeCoherenceScore.toFixed(2)}
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
