"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Cable, RefreshCw, ScanSearch, ShieldCheck } from "lucide-react";

import { useLocale } from "@/components/providers/LocaleProvider";
import { ApiRequestError } from "@/lib/api/client";
import {
  bulkRebuildIntelligenceEvents,
  listIntelligenceFetchFailures,
  listIntelligenceQuarantine,
  listIntelligenceRuns,
  listIntelligenceRuntimeAliases,
  listIntelligenceRuntimeModels,
  listIntelligenceSources,
  listIntelligenceStaleEvents,
  rebuildIntelligenceEventById,
  rebuildIntelligenceWorkspace,
  retryIntelligenceSignal,
  retryIntelligenceSource,
  toggleIntelligenceSource,
  updateIntelligenceAliasBindings,
} from "@/lib/api/endpoints";
import type {
  IntelligenceBulkEventRebuildResult,
  IntelligenceIdentityCollisionRecord,
  IntelligenceEventRebuildResult,
  IntelligenceFetchFailureRecord,
  IntelligenceProvisionalEventRecord,
  IntelligenceQuarantinedSignalRecord,
  IntelligenceSourceRecord,
  IntelligenceWorkspaceRebuildResult,
} from "@/lib/api/types";

import { RuntimeControlPlanePanel, type RuntimeSnapshot } from "@/components/modules/IntelligenceModule";
import {
  ActionButton,
  EmptyPanel,
  formatDateTime,
  IntelligenceShell,
  Panel,
  providerLabel,
  sourceKindLabel,
  sourceTierLabel,
  sourceTypeLabel,
  StatusPill,
  text,
  useIntelligenceWorkspace,
  workerStatusLabel,
} from "@/components/modules/intelligence/shared";

type SystemState = {
  sources: IntelligenceSourceRecord[];
  fetchFailures: IntelligenceFetchFailureRecord[];
  staleEvents: Awaited<ReturnType<typeof listIntelligenceStaleEvents>>["stale_events"];
  quarantine: {
    quarantinedSignals: IntelligenceQuarantinedSignalRecord[];
    provisionalEvents: IntelligenceProvisionalEventRecord[];
    identityCollisions: IntelligenceIdentityCollisionRecord[];
  };
  runs: Awaited<ReturnType<typeof listIntelligenceRuns>>["runs"];
  runtime: RuntimeSnapshot;
};

function createEmptyRuntime(): RuntimeSnapshot {
  return {
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
  };
}

export function IntelligenceSystemModule() {
  const { locale } = useLocale();
  const workspace = useIntelligenceWorkspace();
  const [state, setState] = useState<SystemState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lastRebuildResult, setLastRebuildResult] = useState<IntelligenceEventRebuildResult | null>(null);
  const [lastBulkRebuildResult, setLastBulkRebuildResult] = useState<IntelligenceBulkEventRebuildResult | null>(null);
  const [lastWorkspaceRebuildResult, setLastWorkspaceRebuildResult] = useState<IntelligenceWorkspaceRebuildResult | null>(null);

  const load = useCallback(async () => {
    if (!workspace.workspaceId) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [sourceData, runData, modelData, aliasData, failureData, staleData, quarantineData] = await Promise.all([
        listIntelligenceSources({ workspace_id: workspace.workspaceId }),
        listIntelligenceRuns({ workspace_id: workspace.workspaceId, limit: 20 }),
        listIntelligenceRuntimeModels({ workspace_id: workspace.workspaceId }),
        listIntelligenceRuntimeAliases({ workspace_id: workspace.workspaceId }),
        listIntelligenceFetchFailures({ workspace_id: workspace.workspaceId, limit: 20 }),
        listIntelligenceStaleEvents({ workspace_id: workspace.workspaceId, limit: 20 }),
        listIntelligenceQuarantine({ workspace_id: workspace.workspaceId }),
      ]);
      setState({
        sources: sourceData.sources,
        fetchFailures: failureData.fetch_failures,
        staleEvents: staleData.stale_events,
        quarantine: {
          quarantinedSignals: quarantineData.quarantined_signals,
          provisionalEvents: quarantineData.provisional_events,
          identityCollisions: quarantineData.identity_collisions,
        },
        runs: runData.runs,
        runtime: {
          scannerWorker: sourceData.scanner_worker,
          semanticWorker: sourceData.semantic_worker,
          staleMaintenanceWorker: runData.stale_maintenance_worker,
          syncWorker: modelData.sync_worker,
          semanticBacklog: runData.semantic_backlog,
          aliases: aliasData.bindings,
          rollouts: aliasData.rollouts,
          models: modelData.models,
          providerHealth: modelData.provider_health,
        },
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(text(locale, "시스템 상태를 불러오지 못했다.", "Failed to load system state."));
      }
    } finally {
      setLoading(false);
    }
  }, [locale, workspace.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSourceState = useCallback(async (source: IntelligenceSourceRecord) => {
    if (!workspace.workspaceId) return;
    setBusyKey(`source:${source.id}`);
    try {
      await toggleIntelligenceSource(source.id, {
        workspace_id: workspace.workspaceId,
        enabled: !source.enabled,
      });
      await load();
    } finally {
      setBusyKey(null);
    }
  }, [load, workspace.workspaceId]);

  const retrySource = useCallback(async (source: IntelligenceSourceRecord) => {
    if (!workspace.workspaceId) return;
    setBusyKey(`source-retry:${source.id}`);
    try {
      await retryIntelligenceSource(source.id, { workspace_id: workspace.workspaceId });
      await load();
    } finally {
      setBusyKey(null);
    }
  }, [load, workspace.workspaceId]);

  const rebuildStaleEvent = useCallback(async (eventId: string) => {
    if (!workspace.workspaceId) return;
    setBusyKey(`stale:${eventId}`);
    try {
      const response = await rebuildIntelligenceEventById(eventId, { workspace_id: workspace.workspaceId });
      setLastRebuildResult(response.result);
      await load();
    } finally {
      setBusyKey(null);
    }
  }, [load, workspace.workspaceId]);

  const retrySignal = useCallback(async (signalId: string) => {
    if (!workspace.workspaceId) return;
    setBusyKey(`signal:${signalId}`);
    try {
      await retryIntelligenceSignal(signalId, { workspace_id: workspace.workspaceId });
      await load();
    } finally {
      setBusyKey(null);
    }
  }, [load, workspace.workspaceId]);

  const bulkRebuild = useCallback(async () => {
    if (!workspace.workspaceId || !state?.staleEvents.length) return;
    setBusyKey("stale:bulk");
    try {
      const eventIds = state.staleEvents.slice(0, 5).map((event) => event.eventId);
      const response = await bulkRebuildIntelligenceEvents({
        workspace_id: workspace.workspaceId,
        event_ids: eventIds,
        limit: eventIds.length,
      });
      setLastBulkRebuildResult(response.result);
      await load();
    } finally {
      setBusyKey(null);
    }
  }, [load, state?.staleEvents, workspace.workspaceId]);

  const rebuildWorkspaceState = useCallback(async () => {
    if (!workspace.workspaceId) return;
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            text(
              locale,
              "derived intelligence 상태를 전부 지우고 signal을 다시 큐잉한다. 계속할까?",
              "This resets all derived intelligence state and requeues every signal. Continue?",
            ),
          );
    if (!confirmed) return;
    setBusyKey("workspace:rebuild");
    try {
      const response = await rebuildIntelligenceWorkspace({
        workspace_id: workspace.workspaceId,
        mode: "hard_reset",
      });
      setLastWorkspaceRebuildResult(response.result);
      await load();
    } finally {
      setBusyKey(null);
    }
  }, [load, locale, workspace.workspaceId]);

  const saveBindings = useCallback(async (input: Parameters<NonNullable<React.ComponentProps<typeof RuntimeControlPlanePanel>["onSaveBindings"]>>[0]) => {
    if (!workspace.workspaceId) return;
    setBusyKey(`runtime-alias:${input.scope}:${input.alias}`);
    try {
      await updateIntelligenceAliasBindings(input.alias, {
        workspace_id: workspace.workspaceId,
        scope: input.scope,
        bindings: input.bindings,
      });
      await load();
    } finally {
      setBusyKey(null);
    }
  }, [load, workspace.workspaceId]);

  const latestRun = state?.runs[0] ?? null;
  const failureSummary = useMemo(() => {
    const grouped = new Map<string, { title: string; total: number; latestAt: string; reasons: string[] }>();
    for (const failure of state?.fetchFailures ?? []) {
      const key = failure.sourceId ?? failure.url;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          title: failure.sourceId ?? failure.url,
          total: 1,
          latestAt: failure.createdAt,
          reasons: [failure.reason],
        });
      } else {
        current.total += 1;
        if (!current.reasons.includes(failure.reason)) current.reasons.push(failure.reason);
        if (Date.parse(failure.createdAt) > Date.parse(current.latestAt)) current.latestAt = failure.createdAt;
      }
    }
    return [...grouped.values()].sort((left, right) => Date.parse(right.latestAt) - Date.parse(left.latestAt));
  }, [state?.fetchFailures]);

  return (
    <IntelligenceShell
      title={text(locale, "Intelligence System", "Intelligence System")}
      description={text(
        locale,
        "System은 운영자 업무보다 뒤에 있어야 하는 내부 상태를 모아둔다. 소스, 실패, 백로그, 런타임 모델 제어를 여기로 분리한다.",
        "System contains the internal state that should not compete with operator work: sources, failures, backlog, and runtime model control.",
      )}
      workspaceId={workspace.workspaceId}
      workspaces={workspace.workspaces}
      buildHref={workspace.buildHref}
      onWorkspaceChange={workspace.setWorkspaceSelection}
      onRefresh={() => {
        void workspace.refreshWorkspaces();
        void load();
      }}
      loading={loading || workspace.loadingWorkspace}
      error={error ?? workspace.workspaceError}
    >
      <div className="grid gap-6 xl:grid-cols-4">
        <Panel title={text(locale, "System Snapshot", "System Snapshot")} meta={latestRun ? formatDateTime(latestRun.startedAt) : "—"} className="xl:col-span-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between text-white/50"><span className="text-xs font-mono uppercase tracking-[0.18em]">Sources</span><ScanSearch size={16} /></div>
              <p className="mt-3 text-2xl font-semibold text-white">{state?.sources.length ?? 0}</p>
              <p className="mt-1 text-xs text-white/45">{state?.runtime.scannerWorker?.enabled ? text(locale, "스캐너 켜짐", "scanner on") : text(locale, "스캐너 꺼짐", "scanner off")}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between text-white/50"><span className="text-xs font-mono uppercase tracking-[0.18em]">Semantic</span><Cable size={16} /></div>
              <p className="mt-3 text-2xl font-semibold text-white">{state?.runtime.semanticBacklog.pendingCount ?? 0}</p>
              <p className="mt-1 text-xs text-white/45">{text(locale, "실패", "failed")} {state?.runtime.semanticBacklog.failedCount ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between text-white/50"><span className="text-xs font-mono uppercase tracking-[0.18em]">Stale</span><RefreshCw size={16} /></div>
              <p className="mt-3 text-2xl font-semibold text-white">{state?.staleEvents.length ?? 0}</p>
              <p className="mt-1 text-xs text-white/45">{state?.runtime.staleMaintenanceWorker?.enabled ? text(locale, "워커 켜짐", "worker on") : text(locale, "워커 꺼짐", "worker off")}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between text-white/50"><span className="text-xs font-mono uppercase tracking-[0.18em]">Models</span><Bot size={16} /></div>
              <p className="mt-3 text-2xl font-semibold text-white">{state?.runtime.models.length ?? 0}</p>
              <p className="mt-1 text-xs text-white/45">{state ? state.runtime.aliases.workspace.length + state.runtime.aliases.global.length : 0} bindings</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between text-white/50"><span className="text-xs font-mono uppercase tracking-[0.18em]">Sync</span><ShieldCheck size={16} /></div>
              <p className="mt-3 text-2xl font-semibold text-white">{state?.runtime.syncWorker?.enabled ? "ON" : "OFF"}</p>
              <p className="mt-1 text-xs text-white/45">{state?.runtime.syncWorker?.lastRun ? formatDateTime(state.runtime.syncWorker.lastRun.finishedAt) : "—"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between text-white/50"><span className="text-xs font-mono uppercase tracking-[0.18em]">Quarantine</span><ShieldCheck size={16} /></div>
              <p className="mt-3 text-2xl font-semibold text-white">
                {(state?.quarantine.quarantinedSignals.length ?? 0) + (state?.quarantine.provisionalEvents.length ?? 0)}
              </p>
              <p className="mt-1 text-xs text-white/45">
                {text(locale, "격리", "quarantined")} {state?.quarantine.quarantinedSignals.length ?? 0} · {text(locale, "대기", "provisional")} {state?.quarantine.provisionalEvents.length ?? 0}
              </p>
            </div>
          </div>
        </Panel>

        <Panel title={text(locale, "Sources", "Sources")} meta={`${state?.sources.length ?? 0} ${text(locale, "개", "items")}`} className="xl:col-span-2">
          <div className="space-y-3">
            {state?.sources.length ? state.sources.map((source) => (
              <div key={source.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{source.name}</p>
                    <p className="mt-1 text-xs text-white/45">{sourceKindLabel(source.kind, locale)} · {sourceTypeLabel(source.sourceType, locale)} · {sourceTierLabel(source.sourceTier, locale)}</p>
                    <p className="mt-2 text-xs text-white/45">
                      {text(locale, "상태", "status")} {workerStatusLabel(source.health.lastStatus, locale)} · 403 {source.health.status403Count} · 429 {source.health.status429Count}
                    </p>
                  </div>
                  <StatusPill tone={source.enabled ? "emerald" : "neutral"}>{source.enabled ? "ON" : "OFF"}</StatusPill>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionButton onClick={() => void toggleSourceState(source)}>
                    {busyKey === `source:${source.id}` ? "..." : source.enabled ? text(locale, "비활성", "Disable") : text(locale, "활성", "Enable")}
                  </ActionButton>
                  <ActionButton onClick={() => void retrySource(source)} tone="primary">
                    {busyKey === `source-retry:${source.id}` ? "..." : text(locale, "재시도", "Retry")}
                  </ActionButton>
                </div>
              </div>
            )) : (
              <EmptyPanel
                title={text(locale, "소스가 없다.", "No sources.")}
                body={text(locale, "현재 워크스페이스에 등록된 인텔리전스 소스가 없다.", "There are no intelligence sources in the selected workspace.")}
              />
            )}
          </div>
        </Panel>

        <Panel title={text(locale, "Fetch Failures", "Fetch Failures")} meta={`${state?.fetchFailures.length ?? 0} ${text(locale, "개", "items")}`} className="xl:col-span-2">
          <div className="space-y-3">
            {failureSummary.length ? failureSummary.map((failure) => (
              <div key={`${failure.title}-${failure.latestAt}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">{failure.title}</p>
                <p className="mt-2 text-sm text-white/72">{failure.total} {text(locale, "실패", "failures")} · {failure.reasons.slice(0, 2).join(" / ")}</p>
                <p className="mt-2 text-xs text-white/45">{formatDateTime(failure.latestAt)}</p>
              </div>
            )) : (
              <EmptyPanel
                title={text(locale, "최근 수집 실패가 없다.", "No recent fetch failures.")}
                body={text(locale, "최근 소스 수집 실패가 보고되지 않았다.", "No recent source fetch failures were reported.")}
              />
            )}
          </div>
        </Panel>

        <Panel title={text(locale, "Quarantined Signals", "Quarantined Signals")} meta={`${state?.quarantine.quarantinedSignals.length ?? 0} ${text(locale, "개", "items")}`} className="xl:col-span-2">
          <div className="space-y-3">
            {state?.quarantine.quarantinedSignals.length ? state.quarantine.quarantinedSignals.slice(0, 12).map((signal) => (
              <div key={signal.signal_id} className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                <p className="text-sm font-medium text-white">{signal.title}</p>
                <p className="mt-2 text-sm text-white/72">{signal.reasons.join(" / ")}</p>
                <p className="mt-2 text-xs text-white/45">{formatDateTime(signal.processed_at ?? signal.created_at)}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionButton onClick={() => void retrySignal(signal.signal_id)} tone="primary">
                    {busyKey === `signal:${signal.signal_id}` ? "..." : text(locale, "재처리", "Retry")}
                  </ActionButton>
                  <ActionButton href={signal.url}>
                    {text(locale, "원문 보기", "Open source")}
                  </ActionButton>
                </div>
              </div>
            )) : (
              <EmptyPanel
                title={text(locale, "격리된 시그널이 없다.", "No quarantined signals.")}
                body={text(locale, "validation에서 막힌 low-confidence 시그널이 없다.", "There are no low-confidence signals blocked by validation.")}
              />
            )}
          </div>
        </Panel>

        <Panel title={text(locale, "Provisional Events", "Provisional Events")} meta={`${state?.quarantine.provisionalEvents.length ?? 0} ${text(locale, "개", "items")}`} className="xl:col-span-2">
          <div className="space-y-3">
            {state?.quarantine.provisionalEvents.length ? state.quarantine.provisionalEvents.slice(0, 12).map((event) => (
              <div key={event.event_id} className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
                <p className="text-sm font-medium text-white">{event.title}</p>
                <p className="mt-2 text-sm text-white/72">{event.reasons.join(" / ")}</p>
                <p className="mt-2 text-xs text-white/45">
                  {text(locale, "문서", "docs")} {event.document_count} · {text(locale, "비사회적 corroboration", "non-social corroboration")} {event.non_social_corroboration_count}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionButton onClick={() => void rebuildStaleEvent(event.event_id)} tone="primary">
                    {busyKey === `stale:${event.event_id}` ? "..." : text(locale, "재처리", "Reprocess")}
                  </ActionButton>
                </div>
              </div>
            )) : (
              <EmptyPanel
                title={text(locale, "승격 대기 이벤트가 없다.", "No provisional events.")}
                body={text(locale, "corroboration을 기다리는 provisional event가 없다.", "There are no provisional events awaiting corroboration.")}
              />
            )}
          </div>
        </Panel>

        <Panel title={text(locale, "Identity Collisions", "Identity Collisions")} meta={`${state?.quarantine.identityCollisions.length ?? 0} ${text(locale, "개", "items")}`} className="xl:col-span-2">
          <div className="space-y-3">
            {state?.quarantine.identityCollisions.length ? state.quarantine.identityCollisions.slice(0, 10).map((collision) => (
              <div key={collision.document_identity_key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">{collision.document_identity_key}</p>
                <p className="mt-2 text-sm text-white/72">{collision.count} {text(locale, "문서", "documents")} · {collision.titles.slice(0, 2).join(" / ")}</p>
                <p className="mt-2 text-xs text-white/45">{collision.canonical_urls.slice(0, 2).join(" · ")}</p>
              </div>
            )) : (
              <EmptyPanel
                title={text(locale, "identity collision이 없다.", "No identity collisions.")}
                body={text(locale, "동일 identity key를 공유하는 raw document 중복이 감지되지 않았다.", "No duplicate raw documents sharing the same identity key were detected.")}
              />
            )}
          </div>
        </Panel>

        <Panel title={text(locale, "Semantic Backlog & Runs", "Semantic Backlog & Runs")} meta={`${state?.runtime.semanticBacklog.pendingCount ?? 0} pending`} className="xl:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Backlog</p>
              <p className="mt-3 text-sm text-white/78">
                {text(locale, "대기", "pending")} {state?.runtime.semanticBacklog.pendingCount ?? 0} · {text(locale, "처리중", "processing")} {state?.runtime.semanticBacklog.processingCount ?? 0} · {text(locale, "실패", "failed")} {state?.runtime.semanticBacklog.failedCount ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Providers</p>
              <div className="mt-3 space-y-2">
                {state?.runtime.providerHealth.map((row) => (
                  <div key={row.provider} className="text-sm text-white/78">
                    {providerLabel(row.provider, locale)} · {row.available ? text(locale, "정상", "available") : text(locale, "저하", "degraded")}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title={text(locale, "Stale Maintenance", "Stale Maintenance")} meta={`${state?.staleEvents.length ?? 0} ${text(locale, "후보", "candidates")}`} className="xl:col-span-2">
          <div className="mb-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => void bulkRebuild()} tone="primary">
              {busyKey === "stale:bulk" ? "..." : text(locale, "상위 5개 일괄 재빌드", "Bulk rebuild top 5")}
            </ActionButton>
            <ActionButton onClick={() => void rebuildWorkspaceState()} tone="danger">
              {busyKey === "workspace:rebuild" ? "..." : text(locale, "전체 재빌드", "Rebuild workspace")}
            </ActionButton>
          </div>
          {lastWorkspaceRebuildResult ? (
            <div className="mb-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3 text-xs text-rose-100/85">
              {text(locale, "삭제", "deleted")} {lastWorkspaceRebuildResult.deletedEventCount} {text(locale, "이벤트", "events")} · {lastWorkspaceRebuildResult.deletedClusterCount} {text(locale, "클러스터", "clusters")} · {text(locale, "재큐잉", "requeued")} {lastWorkspaceRebuildResult.queuedSignalCount} {text(locale, "시그널", "signals")} · {lastWorkspaceRebuildResult.executionMode}
            </div>
          ) : null}
          {lastBulkRebuildResult ? (
            <div className="mb-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-3 text-xs text-cyan-100/85">
              {text(locale, "시도", "attempted")} {lastBulkRebuildResult.attemptedEventIds.length} · {text(locale, "재빌드", "rebuilt")} {lastBulkRebuildResult.rebuiltCount}
            </div>
          ) : null}
          {lastRebuildResult ? (
            <div className="mb-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs text-emerald-100/85">
              {text(locale, "재빌드", "rebuilt")} {lastRebuildResult.previousEventId.slice(0, 8)} → {lastRebuildResult.rebuiltEventId?.slice(0, 8) ?? "—"}
            </div>
          ) : null}
          <div className="space-y-3">
            {state?.staleEvents.length ? state.staleEvents.map((event) => (
              <div key={event.eventId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">{event.title}</p>
                <p className="mt-2 text-sm text-white/72">{text(locale, "오염 점수", "stale")} {event.staleScore} · {event.reasons.join(", ")}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionButton onClick={() => void rebuildStaleEvent(event.eventId)} tone="primary">
                    {busyKey === `stale:${event.eventId}` ? "..." : text(locale, "정리 후 재빌드", "Clean rebuild")}
                  </ActionButton>
                </div>
              </div>
            )) : (
              <EmptyPanel
                title={text(locale, "오염 후보가 없다.", "No stale candidates.")}
                body={text(locale, "현재 정리 대상 오염 이벤트가 없다.", "There are no stale event candidates to rebuild right now.")}
              />
            )}
          </div>
        </Panel>

        <div className="xl:col-span-4">
          <RuntimeControlPlanePanel
            locale={locale}
            runtime={state?.runtime ?? createEmptyRuntime()}
            workspaceId={workspace.workspaceId}
            busyKey={busyKey}
            onSaveBindings={saveBindings}
          />
        </div>
      </div>
    </IntelligenceShell>
  );
}
