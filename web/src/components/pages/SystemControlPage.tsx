"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Cable,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  listIntelligenceFetchFailures,
  listIntelligenceQuarantine,
  listIntelligenceRuns,
  listIntelligenceRuntimeModels,
  listIntelligenceSources,
  listIntelligenceStaleEvents,
} from "@/lib/api/endpoints";
import type {
  IntelligenceFetchFailureRecord,
  IntelligenceModelRegistryEntry,
  IntelligenceProvisionalEventRecord,
  IntelligenceQuarantinedSignalRecord,
  IntelligenceScanRunRecord,
  IntelligenceSourceRecord,
  IntelligenceStaleEventPreview,
} from "@/lib/api/types";
import { HyperAgentControlModule } from "@/components/modules/HyperAgentControlModule";
import { ModelControlModule } from "@/components/modules/ModelControlModule";
import { useLocale } from "@/components/providers/LocaleProvider";
import { AsyncState } from "@/components/ui/AsyncState";

type SystemPageFocus = "overview" | "runtime" | "sources" | "models" | "maintenance" | "hyperagents";

type SystemControlSnapshot = {
  workspaceId: string | null;
  sources: IntelligenceSourceRecord[];
  runs: IntelligenceScanRunRecord[];
  models: IntelligenceModelRegistryEntry[];
  failures: IntelligenceFetchFailureRecord[];
  staleEvents: IntelligenceStaleEventPreview[];
  quarantinedSignals: IntelligenceQuarantinedSignalRecord[];
  provisionalEvents: IntelligenceProvisionalEventRecord[];
  identityCollisionCount: number;
  scannerEnabled: boolean;
  semanticEnabled: boolean;
  syncEnabled: boolean;
  scannerInflight: boolean;
  semanticInflight: boolean;
  semanticPendingCount: number;
  semanticFailedCount: number;
};

function SummaryCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between text-neutral-500">
        <span className="text-[11px] uppercase tracking-[0.24em]">{label}</span>
        {icon}
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-neutral-950">{value}</p>
      <p className="mt-2 text-sm text-neutral-600">{hint}</p>
    </div>
  );
}

function Surface({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-950">{title}</h2>
        <p className="mt-1 text-sm text-neutral-600">{description}</p>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-4 py-6 text-sm text-neutral-500">
      {label}
    </p>
  );
}

function formatTimestamp(value: string | null, locale: ReturnType<typeof useLocale>): string {
  if (!value) {
    return locale.locale === "ko" ? "기록 없음" : "No record";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale.locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function OverviewGrid({ snapshot, locale }: { snapshot: SystemControlSnapshot; locale: ReturnType<typeof useLocale> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label={locale.locale === "ko" ? "Runtime" : "Runtime"}
        value={snapshot.semanticPendingCount}
        hint={
          locale.locale === "ko"
            ? `pending ${snapshot.semanticPendingCount} · failed ${snapshot.semanticFailedCount}`
            : `Pending ${snapshot.semanticPendingCount} · Failed ${snapshot.semanticFailedCount}`
        }
        icon={<ShieldCheck size={16} />}
      />
      <SummaryCard
        label={locale.locale === "ko" ? "Sources" : "Sources"}
        value={snapshot.sources.length}
        hint={
          locale.locale === "ko"
            ? `${snapshot.failures.length} fetch failure · ${snapshot.quarantinedSignals.length} quarantine`
            : `${snapshot.failures.length} fetch failures · ${snapshot.quarantinedSignals.length} quarantined`
        }
        icon={<Cable size={16} />}
      />
      <SummaryCard
        label={locale.locale === "ko" ? "Models" : "Models"}
        value={snapshot.models.length}
        hint={locale.locale === "ko" ? `sync ${snapshot.syncEnabled ? "ON" : "OFF"}` : `sync ${snapshot.syncEnabled ? "ON" : "OFF"}`}
        icon={<Bot size={16} />}
      />
      <SummaryCard
        label={locale.locale === "ko" ? "Maintenance" : "Maintenance"}
        value={snapshot.staleEvents.length}
        hint={
          locale.locale === "ko"
            ? `${snapshot.provisionalEvents.length} provisional · ${snapshot.identityCollisionCount} collision`
            : `${snapshot.provisionalEvents.length} provisional · ${snapshot.identityCollisionCount} collisions`
        }
        icon={<Wrench size={16} />}
      />
    </div>
  );
}

function RuntimeSection({ snapshot, locale }: { snapshot: SystemControlSnapshot; locale: ReturnType<typeof useLocale> }) {
  const latestRun = snapshot.runs[0] ?? null;
  return (
    <Surface
      title={locale.locale === "ko" ? "Runtime" : "Runtime"}
      description={
        locale.locale === "ko"
          ? "worker 활성화 여부, backlog, 최근 scan run을 본다."
          : "Track worker activity, backlog, and the latest scan runs."
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-3xl border border-black/10 bg-white p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
            {locale.locale === "ko" ? "Workers" : "Workers"}
          </p>
          <div className="mt-3 space-y-2 text-sm text-neutral-700">
            <p>{locale.locale === "ko" ? "Scanner" : "Scanner"}: {snapshot.scannerEnabled ? "ON" : "OFF"} / {snapshot.scannerInflight ? "busy" : "idle"}</p>
            <p>{locale.locale === "ko" ? "Semantic" : "Semantic"}: {snapshot.semanticEnabled ? "ON" : "OFF"} / {snapshot.semanticInflight ? "busy" : "idle"}</p>
            <p>{locale.locale === "ko" ? "Workspace" : "Workspace"}: {snapshot.workspaceId ?? "-"}</p>
          </div>
        </div>
        <div className="rounded-3xl border border-black/10 bg-white p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
            {locale.locale === "ko" ? "Backlog" : "Backlog"}
          </p>
          <div className="mt-3 space-y-2 text-sm text-neutral-700">
            <p>{locale.locale === "ko" ? "Pending signal" : "Pending signals"}: {snapshot.semanticPendingCount}</p>
            <p>{locale.locale === "ko" ? "Failed signal" : "Failed signals"}: {snapshot.semanticFailedCount}</p>
            <p>{locale.locale === "ko" ? "Recent runs" : "Recent runs"}: {snapshot.runs.length}</p>
          </div>
        </div>
        <div className="rounded-3xl border border-black/10 bg-white p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
            {locale.locale === "ko" ? "Latest run" : "Latest run"}
          </p>
          <div className="mt-3 space-y-2 text-sm text-neutral-700">
            <p>{latestRun ? latestRun.status.toUpperCase() : "-"}</p>
            <p>{locale.locale === "ko" ? "시작" : "Started"}: {formatTimestamp(latestRun?.startedAt ?? null, locale)}</p>
            <p>{locale.locale === "ko" ? "실패" : "Failed"}: {latestRun?.failedCount ?? 0}</p>
          </div>
        </div>
      </div>
    </Surface>
  );
}

function SourcesSection({ snapshot, locale }: { snapshot: SystemControlSnapshot; locale: ReturnType<typeof useLocale> }) {
  return (
    <Surface
      title={locale.locale === "ko" ? "Sources & Failures" : "Sources & Failures"}
      description={
        locale.locale === "ko"
          ? "source health, fetch failure, quarantine 신호를 함께 본다."
          : "Review source health, fetch failures, and quarantined signals together."
      }
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-3xl border border-black/10 bg-white p-4 xl:col-span-1">
          <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
            {locale.locale === "ko" ? "Sources" : "Sources"}
          </p>
          <div className="mt-3 space-y-3">
            {snapshot.sources.slice(0, 6).map((source) => (
              <div key={source.id} className="rounded-2xl border border-black/10 bg-[#fffdf8] px-3 py-3">
                <p className="text-sm font-semibold text-neutral-950">{source.name}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  {source.sourceType} · {source.sourceTier} · {source.health.lastStatus}
                </p>
              </div>
            ))}
            {snapshot.sources.length === 0 ? <EmptyState label={locale.locale === "ko" ? "등록된 source가 없다." : "No sources are registered."} /> : null}
          </div>
        </div>
        <div className="rounded-3xl border border-black/10 bg-white p-4 xl:col-span-1">
          <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
            {locale.locale === "ko" ? "Fetch failures" : "Fetch failures"}
          </p>
          <div className="mt-3 space-y-3">
            {snapshot.failures.slice(0, 6).map((failure) => (
              <div key={failure.id} className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3">
                <p className="text-sm font-semibold text-neutral-950">{failure.url}</p>
                <p className="mt-1 text-xs text-neutral-700">
                  {failure.sourceId ?? "unknown"} · {failure.reason} · {formatTimestamp(failure.createdAt, locale)}
                </p>
              </div>
            ))}
            {snapshot.failures.length === 0 ? <EmptyState label={locale.locale === "ko" ? "최근 fetch failure가 없다." : "No recent fetch failures."} /> : null}
          </div>
        </div>
        <div className="rounded-3xl border border-black/10 bg-white p-4 xl:col-span-1">
          <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
            {locale.locale === "ko" ? "Quarantine" : "Quarantine"}
          </p>
          <div className="mt-3 space-y-3">
            {snapshot.quarantinedSignals.slice(0, 6).map((signal) => (
              <div key={signal.signal_id} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="text-sm font-semibold text-neutral-950">{signal.title}</p>
                <p className="mt-1 text-xs text-neutral-700">{signal.reasons.join(", ")}</p>
              </div>
            ))}
            {snapshot.quarantinedSignals.length === 0 ? <EmptyState label={locale.locale === "ko" ? "격리된 low-confidence signal이 없다." : "No quarantined low-confidence signals."} /> : null}
          </div>
        </div>
      </div>
    </Surface>
  );
}

function ModelsSection({ snapshot, locale }: { snapshot: SystemControlSnapshot; locale: ReturnType<typeof useLocale> }) {
  return (
    <Surface
      title={locale.locale === "ko" ? "Models & Controls" : "Models & Controls"}
      description={
        locale.locale === "ko"
          ? "registry와 provider 제어는 이 섹션에서만 다룬다."
          : "Keep the runtime model registry and provider controls in this section."
      }
    >
      <div className="grid gap-4 xl:grid-cols-[0.95fr,1.4fr]">
        <div className="rounded-3xl border border-black/10 bg-white p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
            {locale.locale === "ko" ? "Registry sample" : "Registry sample"}
          </p>
          <div className="mt-3 space-y-3">
            {snapshot.models.slice(0, 8).map((model) => (
              <div key={model.id} className="rounded-2xl border border-black/10 bg-[#fffdf8] px-3 py-3">
                <p className="text-sm font-semibold text-neutral-950">{model.modelId}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  {model.provider} · {model.availability} · {model.costClass}
                </p>
              </div>
            ))}
            {snapshot.models.length === 0 ? <EmptyState label={locale.locale === "ko" ? "등록된 runtime model이 없다." : "No runtime models are registered."} /> : null}
          </div>
        </div>
        <div className="overflow-hidden rounded-3xl border border-black/10 bg-black/90">
          <ModelControlModule />
        </div>
      </div>
    </Surface>
  );
}

function MaintenanceSection({ snapshot, locale }: { snapshot: SystemControlSnapshot; locale: ReturnType<typeof useLocale> }) {
  return (
    <Surface
      title={locale.locale === "ko" ? "Maintenance" : "Maintenance"}
      description={
        locale.locale === "ko"
          ? "stale rebuild 후보와 provisional backlog를 여기서만 본다."
          : "Review stale rebuild candidates and provisional backlog here."
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1.1fr,1fr]">
        <div className="rounded-3xl border border-black/10 bg-white p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
            {locale.locale === "ko" ? "Stale candidates" : "Stale candidates"}
          </p>
          <div className="mt-3 space-y-3">
            {snapshot.staleEvents.slice(0, 6).map((event) => (
              <div key={event.eventId} className="rounded-2xl border border-black/10 bg-[#fffdf8] px-3 py-3">
                <p className="text-sm font-semibold text-neutral-950">{event.title}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  score {event.staleScore} · {event.reasons.join(", ")}
                </p>
              </div>
            ))}
            {snapshot.staleEvents.length === 0 ? <EmptyState label={locale.locale === "ko" ? "현재 stale rebuild 후보가 없다." : "There are no stale rebuild candidates."} /> : null}
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-3xl border border-black/10 bg-white p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
              {locale.locale === "ko" ? "Provisional events" : "Provisional events"}
            </p>
            <div className="mt-3 space-y-3">
              {snapshot.provisionalEvents.slice(0, 5).map((event) => (
                <div key={event.event_id} className="rounded-2xl border border-black/10 bg-[#fffdf8] px-3 py-3">
                  <p className="text-sm font-semibold text-neutral-950">{event.title}</p>
                  <p className="mt-1 text-xs text-neutral-600">
                    {event.signal_count} signals · {event.reasons.join(", ")}
                  </p>
                </div>
              ))}
              {snapshot.provisionalEvents.length === 0 ? <EmptyState label={locale.locale === "ko" ? "대기 중인 provisional event가 없다." : "No provisional events are waiting for promotion."} /> : null}
            </div>
          </div>
          <div className="rounded-3xl border border-black/10 bg-white p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
              {locale.locale === "ko" ? "Identity collisions" : "Identity collisions"}
            </p>
            <p className="mt-3 text-sm text-neutral-700">
              {locale.locale === "ko"
                ? `${snapshot.identityCollisionCount}건의 repeated identity collision`
                : `${snapshot.identityCollisionCount} repeated identity collisions`}
            </p>
            <Link
              href={snapshot.workspaceId ? `/intelligence/system?workspace=${snapshot.workspaceId}` : "/intelligence/system"}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-black/10 bg-[#fffdf8] px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              {locale.locale === "ko" ? "세부 시스템 콘솔 열기" : "Open detailed intelligence console"}
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </Surface>
  );
}

function HyperAgentsSection({ locale }: { locale: ReturnType<typeof useLocale> }) {
  return (
    <Surface
      title={locale.locale === "ko" ? "HyperAgents" : "HyperAgents"}
      description={
        locale.locale === "ko"
          ? "bounded artifact, promotion gate, lineage를 이 섹션에서만 다룬다."
          : "Keep bounded artifacts, promotion gates, and lineage in this section."
      }
    >
      <HyperAgentControlModule />
    </Surface>
  );
}

export function SystemControlPage({ focus }: { focus: SystemPageFocus }) {
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState<SystemControlSnapshot | null>(null);
  const [loading, setLoading] = useState(focus !== "hyperagents");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sources, runs, models, failures, stale, quarantine] = await Promise.all([
        listIntelligenceSources(),
        listIntelligenceRuns({ limit: 10 }),
        listIntelligenceRuntimeModels(),
        listIntelligenceFetchFailures({ limit: 10 }),
        listIntelligenceStaleEvents({ limit: 10 }),
        listIntelligenceQuarantine(),
      ]);

      setSnapshot({
        workspaceId: sources.workspace_id ?? runs.workspace_id ?? models.workspace_id ?? quarantine.workspace_id ?? null,
        sources: sources.sources,
        runs: runs.runs,
        models: models.models,
        failures: failures.fetch_failures,
        staleEvents: stale.stale_events,
        quarantinedSignals: quarantine.quarantined_signals,
        provisionalEvents: quarantine.provisional_events,
        identityCollisionCount: quarantine.identity_collisions.length,
        scannerEnabled: sources.scanner_worker.enabled,
        semanticEnabled: runs.semantic_worker.enabled,
        syncEnabled: models.sync_worker.enabled,
        scannerInflight: sources.scanner_worker.inflight,
        semanticInflight: runs.semantic_worker.inflight,
        semanticPendingCount: runs.semantic_backlog.pendingCount,
        semanticFailedCount: runs.semantic_backlog.failedCount,
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(locale.locale === "ko" ? "시스템 상태를 불러오지 못했다." : "Failed to load system state.");
      }
    } finally {
      setLoading(false);
    }
  }, [locale.locale]);

  useEffect(() => {
    if (focus === "hyperagents") {
      setLoading(false);
      setError(null);
      setSnapshot(null);
      return;
    }
    void load();
  }, [focus, load]);

  const focusSurfaces = useMemo(() => {
    if (focus === "hyperagents") {
      return [<HyperAgentsSection key="hyperagents" locale={locale} />];
    }
    if (!snapshot) return [];

    if (focus === "runtime") return [<RuntimeSection key="runtime" snapshot={snapshot} locale={locale} />];
    if (focus === "sources") return [<SourcesSection key="sources" snapshot={snapshot} locale={locale} />];
    if (focus === "models") return [<ModelsSection key="models" snapshot={snapshot} locale={locale} />];
    if (focus === "maintenance") return [<MaintenanceSection key="maintenance" snapshot={snapshot} locale={locale} />];
    return [
      <RuntimeSection key="runtime" snapshot={snapshot} locale={locale} />,
      <SourcesSection key="sources" snapshot={snapshot} locale={locale} />,
      <ModelsSection key="models" snapshot={snapshot} locale={locale} />,
      <MaintenanceSection key="maintenance" snapshot={snapshot} locale={locale} />,
    ];
  }, [focus, locale, snapshot]);

  return (
    <main className="space-y-6">
      <section className="rounded-[32px] border border-black/10 bg-[#fffdf8] p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">
          {locale.locale === "ko" ? "시스템 모드" : "System mode"}
        </p>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight text-neutral-950">
          {focus === "hyperagents" ? <Sparkles size={28} /> : <AlertTriangle size={28} />}
          {focus === "hyperagents"
            ? locale.locale === "ko"
              ? "self-modification은 promotion gate 안에서만 다룬다."
              : "Keep self-modification inside a promotion-gated system surface."
            : locale.locale === "ko"
              ? "운영자 검토와 시스템 관제를 분리한다."
              : "Keep operator review and system control separate."}
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-neutral-600">
          {focus === "hyperagents"
            ? locale.locale === "ko"
              ? "HyperAgent는 전체 시스템을 자유 수정하지 않는다. allowlisted artifact, eval, recommendation, apply gate만 이 표면에서 다룬다."
              : "HyperAgent does not freely rewrite the system. This surface is limited to allowlisted artifacts, evals, recommendations, and apply gates."
            : locale.locale === "ko"
              ? "Runtime, sources, models, maintenance는 여기서만 다룬다. 기본 사용자 흐름과 운영 Inbox에 섞지 않는다."
              : "Runtime, sources, models, and maintenance live here instead of mixing into the user flow or operator inbox."}
        </p>
      </section>

      {focus !== "hyperagents" ? (
        <AsyncState
          loading={loading}
          error={error}
          empty={false}
          loadingText={locale.locale === "ko" ? "시스템 상태를 불러오는 중..." : "Loading system state..."}
          onRetry={() => void load()}
        />
      ) : null}

      {focus === "hyperagents" ? focusSurfaces : null}

      {!loading && !error && snapshot ? (
        <>
          <OverviewGrid snapshot={snapshot} locale={locale} />
          {focusSurfaces}
        </>
      ) : null}
    </main>
  );
}
