"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenText, Download, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { ApiRequestError } from "@/lib/api/client";
import { exportDossier, getDossier, listDossiers, refreshDossier } from "@/lib/api/endpoints";
import type { DossierDetail, DossierRecord } from "@/lib/api/types";
import { useLocale } from "@/components/providers/LocaleProvider";
import { MarkdownLite } from "@/components/ui/MarkdownLite";
import {
  describeResearchProfile,
  describeResearchProfileReason,
  describeResearchFormatHint,
  describeResearchQualityMode,
  readResearchFormatHint,
  readResearchProfile,
  readResearchProfileReasons,
  readResearchQualityMode,
  resolveResearchWarningLabels,
  summarizeResearchQualityDimensions,
} from "@/lib/research-quality";

type ParsedQuality = {
  sourceCount: number | null;
  domainCount: number | null;
  domainDiversityScore: number | null;
  freshnessBucket: string | null;
  citationCoverage: number | null;
  qualityGatePassed: boolean | null;
  softWarnings: string[];
  softWarningCodes: string[];
  topDomains: Array<{ domain: string; count: number }>;
};

type SourceFreshnessTone = "recent" | "stale" | "unknown";

function formatFreshnessLabel(
  value: string | null,
  t: ReturnType<typeof useLocale>["t"]
): string {
  if (!value) return "-";
  if (value === "recent") return t("dossier.freshness.recent");
  if (value === "stale") return t("dossier.freshness.stale");
  if (value === "unknown") return t("dossier.freshness.unknown");
  if (value === "mixed") return t("dossier.freshness.mixed");
  return value;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseQualityJson(record: Record<string, unknown>): ParsedQuality {
  const topDomains = Array.isArray(record.top_domains)
    ? record.top_domains
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const row = entry as Record<string, unknown>;
          return typeof row.domain === "string" && typeof row.count === "number"
            ? { domain: row.domain, count: row.count }
            : null;
        })
        .filter((entry): entry is { domain: string; count: number } => entry !== null)
    : [];
  return {
    sourceCount: toNumber(record.source_count),
    domainCount: toNumber(record.domain_count),
    domainDiversityScore: toNumber(record.domain_diversity_score),
    freshnessBucket: typeof record.freshness_bucket === "string" ? record.freshness_bucket : null,
    citationCoverage: toNumber(record.citation_coverage),
    qualityGatePassed: typeof record.quality_gate_passed === "boolean" ? record.quality_gate_passed : null,
    softWarnings: Array.isArray(record.soft_warnings)
      ? record.soft_warnings.filter((entry): entry is string => typeof entry === "string")
      : [],
    softWarningCodes: Array.isArray(record.soft_warning_codes)
      ? record.soft_warning_codes.filter((entry): entry is string => typeof entry === "string")
      : [],
    topDomains,
  };
}

function qualityTone(passed: boolean | null) {
  if (passed === true) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (passed === false) return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-white/15 bg-white/5 text-white/70";
}

function sourceFreshnessTone(publishedAt: string | null): SourceFreshnessTone {
  const publishedAtMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  if (!Number.isFinite(publishedAtMs)) return "unknown";
  return Date.now() - publishedAtMs <= 7 * 24 * 60 * 60 * 1000 ? "recent" : "stale";
}

function sourceFreshnessClass(tone: SourceFreshnessTone): string {
  if (tone === "recent") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (tone === "stale") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-white/15 bg-white/5 text-white/60";
}

function formatRelativeAge(value: string, t: ReturnType<typeof useLocale>["t"]): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return t("tasks.relative.justNow");
  if (deltaMs < 3_600_000) return t("tasks.relative.minutesAgo", { value: Math.floor(deltaMs / 60_000) });
  if (deltaMs < 86_400_000) return t("tasks.relative.hoursAgo", { value: Math.floor(deltaMs / 3_600_000) });
  return t("tasks.relative.daysAgo", { value: Math.floor(deltaMs / 86_400_000) });
}

function worldModelSignalLabel(key: string, t: ReturnType<typeof useLocale>["t"]): string {
  const labels: Record<string, string> = {
    route_risk: t("dossier.worldModel.signal.routeRisk"),
    freight_pressure: t("dossier.worldModel.signal.freightPressure"),
    insurance_pressure: t("dossier.worldModel.signal.insurancePressure"),
    contract_urgency: t("dossier.worldModel.signal.contractUrgency"),
    inflation_passthrough_risk: t("dossier.worldModel.signal.inflationRisk"),
    rate_repricing_pressure: t("dossier.worldModel.signal.ratePressure"),
  };
  return labels[key] ?? key.replace(/_/g, " ");
}

function worldModelStanceLabel(value: "primary" | "counter", t: ReturnType<typeof useLocale>["t"]): string {
  return value === "primary" ? t("dossier.worldModel.stance.primary") : t("dossier.worldModel.stance.counter");
}

function worldModelStatusLabel(value: "active" | "weakened" | "invalidated", t: ReturnType<typeof useLocale>["t"]): string {
  if (value === "active") return t("dossier.worldModel.status.active");
  if (value === "weakened") return t("dossier.worldModel.status.weakened");
  return t("dossier.worldModel.status.invalidated");
}

function worldModelStatusClass(value: "active" | "weakened" | "invalidated"): string {
  if (value === "active") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (value === "weakened") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-rose-500/30 bg-rose-500/10 text-rose-200";
}

function invalidationStatusLabel(value: "pending" | "hit" | "missed", t: ReturnType<typeof useLocale>["t"]): string {
  if (value === "pending") return t("dossier.worldModel.invalidation.pending");
  if (value === "hit") return t("dossier.worldModel.invalidation.hit");
  return t("dossier.worldModel.invalidation.missed");
}

function invalidationStatusClass(value: "pending" | "hit" | "missed"): string {
  if (value === "pending") return "border-white/15 bg-white/5 text-white/70";
  if (value === "hit") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
}

function severityClass(value: "low" | "medium" | "high"): string {
  if (value === "high") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  if (value === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
}

function relationLabel(value: "supports" | "contradicts" | "context", t: ReturnType<typeof useLocale>["t"]): string {
  if (value === "supports") return t("dossier.worldModel.relation.supports");
  if (value === "contradicts") return t("dossier.worldModel.relation.contradicts");
  return t("dossier.worldModel.relation.context");
}

export function DossierModule() {
  const { t, formatDateTime } = useLocale();
  const searchParams = useSearchParams();
  const [dossiers, setDossiers] = useState<DossierRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DossierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exportedMarkdown, setExportedMarkdown] = useState<string | null>(null);
  const [selectedSourceUrl, setSelectedSourceUrl] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDossiers({ limit: 30 });
      setDossiers(result.dossiers);
      const requestedId = searchParams.get("dossier");
      setSelectedId((current) => {
        if (requestedId) {
          return requestedId;
        }
        return current ?? result.dossiers[0]?.id ?? null;
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("dossier.loadFailed"));
      }
      setDossiers([]);
    } finally {
      setLoading(false);
    }
  }, [searchParams, t]);

  const hydrateDetail = useCallback(async (dossierId: string) => {
    try {
      const result = await getDossier(dossierId);
      setDetail(result);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("dossier.loadDetailFailed"));
      }
      setDetail(null);
    }
  }, [t]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setSelectedSourceUrl(null);
      return;
    }
    void hydrateDetail(selectedId);
  }, [hydrateDetail, selectedId]);

  useEffect(() => {
    const requestedId = searchParams.get("dossier");
    if (!requestedId) return;
    if (requestedId === selectedId) return;
    setSelectedId(requestedId);
  }, [dossiers, searchParams, selectedId]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    setDossiers((current) => {
      if (current.some((item) => item.id === detail.dossier.id)) {
        return current.map((item) => (item.id === detail.dossier.id ? detail.dossier : item));
      }
      return [detail.dossier, ...current];
    });
  }, [detail]);

  const selected = useMemo(() => dossiers.find((item) => item.id === selectedId) ?? null, [dossiers, selectedId]);
  const quality = useMemo(
    () => (detail ? parseQualityJson(detail.dossier.qualityJson) : null),
    [detail]
  );
  const localizedQualityWarnings = useMemo(
    () => (detail ? resolveResearchWarningLabels({ record: detail.dossier.qualityJson, t }) : []),
    [detail, t]
  );
  const dossierResearchProfile = useMemo(
    () => (detail ? readResearchProfile(detail.dossier.qualityJson) : null),
    [detail]
  );
  const dossierProfileReasons = useMemo(
    () => (detail ? readResearchProfileReasons(detail.dossier.qualityJson).map((reason) => describeResearchProfileReason(t, reason)) : []),
    [detail, t]
  );
  const dossierFormatHint = useMemo(
    () => (detail ? readResearchFormatHint(detail.dossier.qualityJson) : null),
    [detail]
  );
  const dossierQualityMode = useMemo(
    () => (detail ? readResearchQualityMode(detail.dossier.qualityJson) : null),
    [detail]
  );
  const dossierDimensionLines = useMemo(
    () =>
      detail
        ? summarizeResearchQualityDimensions({
            profile: dossierResearchProfile,
            dimensions:
              detail.dossier.qualityJson?.quality_dimensions &&
              typeof detail.dossier.qualityJson.quality_dimensions === "object" &&
              !Array.isArray(detail.dossier.qualityJson.quality_dimensions)
                ? (detail.dossier.qualityJson.quality_dimensions as Record<string, unknown>)
                : null,
            t,
          })
        : [],
    [detail, dossierResearchProfile, t]
  );
  const conflictCount = useMemo(() => {
    if (!detail) return null;
    const raw = detail.dossier.conflictsJson?.count;
    return typeof raw === "number" ? raw : null;
  }, [detail]);
  const conflictTopics = useMemo(() => {
    if (!detail) return [];
    const raw = detail.dossier.conflictsJson?.topics;
    return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
  }, [detail]);
  const worldModel = useMemo(() => detail?.world_model ?? null, [detail]);
  const primaryHypotheses = useMemo(
    () => worldModel?.hypotheses.filter((hypothesis) => hypothesis.stance === "primary") ?? [],
    [worldModel]
  );
  const counterHypotheses = useMemo(
    () => worldModel?.hypotheses.filter((hypothesis) => hypothesis.stance === "counter") ?? [],
    [worldModel]
  );
  const worldModelSignals = useMemo(() => {
    if (!worldModel) return [];
    return Object.entries(worldModel.state_snapshot.variables)
      .sort((left, right) => right[1].score - left[1].score)
      .slice(0, 6);
  }, [worldModel]);
  const sourceUsage = useMemo(() => {
    if (!detail) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const claim of detail.claims) {
      for (const url of claim.sourceUrls) {
        counts.set(url, (counts.get(url) ?? 0) + 1);
      }
    }
    return counts;
  }, [detail]);
  const sourceCoverageRows = useMemo(() => {
    if (!detail) return [];
    const maxUsage = Math.max(1, ...detail.sources.map((source) => sourceUsage.get(source.url) ?? 0));
    return detail.sources.map((source) => {
      const citedByClaims = sourceUsage.get(source.url) ?? 0;
      return {
        source,
        citedByClaims,
        coveragePct: Math.round((citedByClaims / maxUsage) * 100),
      };
    });
  }, [detail, sourceUsage]);
  const sourcesByUrl = useMemo(() => {
    if (!detail) return new Map<string, DossierDetail["sources"][number]>();
    return new Map(detail.sources.map((source) => [source.url, source] as const));
  }, [detail]);
  const freshnessTimeline = useMemo(() => {
    if (!detail) return [];
    return [...detail.sources].sort((left, right) => {
      const rightMs = right.publishedAt ? Date.parse(right.publishedAt) : Number.NEGATIVE_INFINITY;
      const leftMs = left.publishedAt ? Date.parse(left.publishedAt) : Number.NEGATIVE_INFINITY;
      return rightMs - leftMs;
    });
  }, [detail]);
  const claimSupportStats = useMemo(() => {
    if (!detail || detail.claims.length === 0) {
      return {
        multiSourceClaims: 0,
        singleSourceClaims: 0,
        unsupportedClaims: 0,
      };
    }
    let multiSourceClaims = 0;
    let singleSourceClaims = 0;
    let unsupportedClaims = 0;
    for (const claim of detail.claims) {
      if (claim.sourceUrls.length >= 2) {
        multiSourceClaims += 1;
      } else if (claim.sourceUrls.length === 1) {
        singleSourceClaims += 1;
      } else {
        unsupportedClaims += 1;
      }
    }
    return {
      multiSourceClaims,
      singleSourceClaims,
      unsupportedClaims,
    };
  }, [detail]);

  useEffect(() => {
    if (!detail) {
      setSelectedSourceUrl(null);
      return;
    }
    setSelectedSourceUrl((current) => {
      if (current && detail.sources.some((source) => source.url === current)) {
        return current;
      }
      return detail.sources[0]?.url ?? null;
    });
  }, [detail]);

  const onRefreshDossier = async () => {
    if (!selected) return;
    setRefreshing(true);
    setError(null);
    try {
      await refreshDossier(selected.id);
      await hydrateDetail(selected.id);
      await refreshList();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("dossier.refreshFailed"));
      }
    } finally {
      setRefreshing(false);
    }
  };

  const onExport = async () => {
    if (!selected) return;
    try {
      const result = await exportDossier(selected.id);
      setExportedMarkdown(result.content);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("dossier.exportFailed"));
      }
    }
  };

  return (
    <main className="w-full h-full min-h-0 overflow-hidden bg-transparent p-4 text-white flex flex-col gap-4">
      <header className="border-l-2 border-cyan-500 pl-3 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-400 flex items-center gap-2">
            <BookOpenText size={14} /> {t("dossier.title")}
          </h2>
          <p className="text-[10px] font-mono text-white/40">{t("dossier.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void refreshList()} className="inline-flex h-7 items-center gap-1 rounded border border-white/20 px-2 text-[10px] font-mono text-white/70">
            <RefreshCw size={11} /> {t("dossier.list")}
          </button>
          <button type="button" onClick={() => void onRefreshDossier()} disabled={!selected || refreshing} className="inline-flex h-7 items-center gap-1 rounded border border-cyan-500/40 px-2 text-[10px] font-mono text-cyan-300 disabled:opacity-50">
            <RefreshCw size={11} /> {t("common.refresh")}
          </button>
          <button type="button" onClick={() => void onExport()} disabled={!selected} className="inline-flex h-7 items-center gap-1 rounded border border-emerald-500/40 px-2 text-[10px] font-mono text-emerald-300 disabled:opacity-50">
            <Download size={11} /> {t("common.export")}
          </button>
        </div>
      </header>

      {error && <p className="text-xs font-mono text-rose-300">{error}</p>}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-3 overflow-hidden">
        <section className="rounded border border-white/10 bg-black/30 overflow-y-auto p-2 space-y-2 min-h-0">
          {loading && <p className="text-xs font-mono text-white/45">{t("dossier.loading")}</p>}
          {!loading && dossiers.length === 0 && <p className="text-xs font-mono text-white/45">{t("dossier.empty")}</p>}
          {dossiers.map((dossier) => (
            (() => {
              const quality = parseQualityJson(dossier.qualityJson);
              return (
            <button
              key={dossier.id}
              type="button"
              onClick={() => setSelectedId(dossier.id)}
              className={`w-full rounded border px-3 py-2 text-left ${selectedId === dossier.id ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10 bg-black/30"}`}
            >
              <p className="text-sm text-white/90 truncate">{dossier.title}</p>
              <p className="mt-1 text-[10px] font-mono text-white/45 line-clamp-2">{dossier.summary}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1 text-[9px] font-mono text-white/40">
                <span className="rounded border border-white/10 px-2 py-0.5">{t("dossier.badge.updated", { value: formatRelativeAge(dossier.updatedAt, t) })}</span>
                <span className="rounded border border-white/10 px-2 py-0.5">{t("dossier.badge.created", { value: formatDateTime(dossier.createdAt) })}</span>
                <span className="rounded border border-white/10 px-2 py-0.5">{t("dossier.badge.id", { value: dossier.id.slice(0, 8) })}</span>
                {dossier.sessionId ? (
                  <span className="rounded border border-white/10 px-2 py-0.5">{t("dossier.badge.session", { value: dossier.sessionId.slice(0, 8) })}</span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${qualityTone(quality.qualityGatePassed)}`}>
                  {quality.qualityGatePassed === true ? t("dossier.badge.qualityPass") : quality.qualityGatePassed === false ? t("dossier.badge.qualityWarn") : t("dossier.badge.qualityNa")}
                </span>
                {quality.sourceCount !== null && (
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/55">
                    {t("dossier.badge.sources", { value: quality.sourceCount })}
                  </span>
                )}
                {quality.freshnessBucket && (
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/55">
                    {t("dossier.badge.freshness", { value: formatFreshnessLabel(quality.freshnessBucket, t) })}
                  </span>
                )}
              </div>
            </button>
              );
            })()
          ))}
        </section>

        <section className="rounded border border-white/10 bg-black/30 overflow-hidden flex min-h-0 flex-col">
          {!detail && <div className="p-4 text-xs font-mono text-white/45">{t("dossier.select")}</div>}
          {detail && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <h3 className="text-lg text-white/90">{detail.dossier.title}</h3>
                <p className="mt-1 text-xs font-mono text-white/45">{detail.dossier.query}</p>
              </div>
              {quality && (
                <div className="rounded border border-white/10 bg-black/35 p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-mono ${qualityTone(quality.qualityGatePassed)}`}>
                      {quality.qualityGatePassed === true ? t("dossier.quality.pass") : quality.qualityGatePassed === false ? t("dossier.quality.warn") : t("dossier.quality.unknown")}
                    </span>
                    {quality.freshnessBucket && (
                      <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white/60">
                        {t("dossier.badge.freshness", { value: formatFreshnessLabel(quality.freshnessBucket, t) })}
                      </span>
                    )}
                    {conflictCount !== null && (
                      <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white/60">
                        {t("dossier.quality.conflicts", { value: conflictCount })}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.researchProfile")}</p>
                      <p className="mt-1 text-sm text-white/90">{describeResearchProfile(t, dossierResearchProfile)}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.researchQuality")}</p>
                      <p className="mt-1 text-sm text-white/90">{describeResearchQualityMode(t, dossierQualityMode)}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.researchFormat")}</p>
                      <p className="mt-1 text-sm text-white/90">{describeResearchFormatHint(t, dossierFormatHint)}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.quality.sources")}</p>
                      <p className="mt-1 text-sm text-white/90">{quality.sourceCount ?? "-"}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.quality.domains")}</p>
                      <p className="mt-1 text-sm text-white/90">
                        {quality.domainCount ?? "-"}
                        {quality.domainDiversityScore !== null ? ` · ${quality.domainDiversityScore}` : ""}
                      </p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.quality.citation")}</p>
                      <p className="mt-1 text-sm text-white/90">
                        {quality.citationCoverage !== null ? `${Math.round(quality.citationCoverage * 100)}%` : "-"}
                      </p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.quality.freshness")}</p>
                      <p className="mt-1 text-sm text-white/90">{formatFreshnessLabel(quality.freshnessBucket, t)}</p>
                    </div>
                  </div>
                  {dossierProfileReasons.length > 0 && (
                    <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3">
                      <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">{t("dossier.profileReasons")}</h4>
                      <div className="space-y-1">
                        {dossierProfileReasons.map((reason) => (
                          <p key={reason} className="text-xs text-cyan-100/80">
                            - {reason}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {localizedQualityWarnings.length > 0 && (
                    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
                      <h4 className="text-[11px] font-mono tracking-widest text-amber-300 mb-2">{t("dossier.quality.warnings")}</h4>
                      <div className="space-y-1">
                        {localizedQualityWarnings.map((warning) => (
                          <p key={warning} className="text-xs text-amber-100/80">
                            - {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {dossierDimensionLines.length > 0 && (
                    <div className="rounded border border-white/10 bg-black/20 p-3">
                      <h4 className="text-[11px] font-mono tracking-widest text-white/70 mb-2">{t("dossier.profileEvidenceSummary")}</h4>
                      <div className="space-y-1">
                        {dossierDimensionLines.map((line) => (
                          <p key={line} className="text-xs text-white/75">
                            - {line}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {quality.topDomains.length > 0 && (
                    <div className="rounded border border-white/10 bg-black/20 p-3">
                      <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">{t("dossier.quality.topDomains")}</h4>
                      <div className="flex flex-wrap gap-2">
                        {quality.topDomains.map((entry) => (
                          <span key={entry.domain} className="rounded border border-white/10 px-2 py-1 text-[10px] font-mono text-white/65">
                            {entry.domain} × {entry.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="rounded border border-white/10 bg-black/35 p-3">
                <MarkdownLite content={detail.dossier.answerMarkdown} />
              </div>
              {worldModel && (
                <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-[11px] font-mono tracking-widest text-cyan-300">{t("dossier.worldModel.title")}</h4>
                      <p className="mt-1 text-xs text-cyan-100/70">{t("dossier.worldModel.subtitle")}</p>
                    </div>
                    <span className="rounded border border-cyan-500/20 px-2 py-0.5 text-[10px] font-mono text-cyan-200">
                      {t("dossier.badge.updated", { value: formatRelativeAge(worldModel.state_snapshot.generated_at, t) })}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                    {worldModelSignals.map(([key, value]) => (
                      <div key={key} className="rounded border border-white/10 bg-black/20 p-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                          {worldModelSignalLabel(key, t)}
                        </p>
                        <p className="mt-1 text-lg text-white/90">{Math.round(value.score * 100)}%</p>
                        <p className="mt-1 text-[10px] font-mono text-white/45 line-clamp-2">
                          {value.drivers[0] ?? t("common.none")}
                        </p>
                      </div>
                    ))}
                  </div>

                  {worldModel.state_snapshot.notes.length > 0 && (
                    <div className="rounded border border-white/10 bg-black/20 p-3">
                      <h5 className="text-[11px] font-mono tracking-widest text-white/70 mb-2">{t("dossier.worldModel.notes")}</h5>
                      <div className="space-y-1">
                        {worldModel.state_snapshot.notes.map((note) => (
                          <p key={note} className="text-xs text-white/75">- {note}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {worldModel.bottlenecks.length > 0 && (
                    <div className="rounded border border-white/10 bg-black/20 p-3">
                      <h5 className="text-[11px] font-mono tracking-widest text-white/70 mb-2">{t("dossier.worldModel.bottlenecks")}</h5>
                      <div className="flex flex-wrap gap-2">
                        {worldModel.bottlenecks.map((bottleneck) => (
                          <div key={bottleneck.key} className="rounded border border-white/10 px-2 py-1">
                            <p className="text-[10px] font-mono text-white/55">{worldModelSignalLabel(bottleneck.key, t)}</p>
                            <p className="mt-1 text-sm text-white/90">{Math.round(bottleneck.score * 100)}%</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <div className="rounded border border-white/10 bg-black/20 p-3">
                      <h5 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">{t("dossier.worldModel.primaryHypotheses")}</h5>
                      <div className="space-y-2">
                        {primaryHypotheses.map((hypothesis) => (
                          <div key={`${hypothesis.stance}-${hypothesis.thesis}`} className="rounded border border-white/10 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${worldModelStatusClass(hypothesis.status)}`}>
                                {worldModelStatusLabel(hypothesis.status, t)}
                              </span>
                              <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                {worldModelStanceLabel(hypothesis.stance, t)}
                              </span>
                              <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                {t("dossier.worldModel.confidence", { value: Math.round(hypothesis.confidence * 100) })}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-white/90">{hypothesis.thesis}</p>
                            <p className="mt-1 text-xs text-white/60">{hypothesis.summary}</p>
                            {hypothesis.watch_state_keys.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {hypothesis.watch_state_keys.map((key) => (
                                  <span key={key} className="rounded border border-cyan-500/20 px-2 py-0.5 text-[10px] font-mono text-cyan-200">
                                    {worldModelSignalLabel(key, t)}
                                  </span>
                                ))}
                              </div>
                            )}
                            {hypothesis.evidence.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {hypothesis.evidence.slice(0, 2).map((evidence) => (
                                  <div key={`${hypothesis.thesis}-${evidence.claim_text}`} className="rounded border border-white/10 bg-black/20 p-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                        {relationLabel(evidence.relation, t)}
                                      </span>
                                      <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                        {t("dossier.worldModel.weight", { value: evidence.weight.toFixed(2) })}
                                      </span>
                                    </div>
                                    <p className="mt-2 text-xs text-white/80">{evidence.claim_text}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-3">
                      <h5 className="text-[11px] font-mono tracking-widest text-amber-300 mb-2">{t("dossier.worldModel.counterHypotheses")}</h5>
                      <div className="space-y-2">
                        {counterHypotheses.map((hypothesis) => (
                          <div key={`${hypothesis.stance}-${hypothesis.thesis}`} className="rounded border border-white/10 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${worldModelStatusClass(hypothesis.status)}`}>
                                {worldModelStatusLabel(hypothesis.status, t)}
                              </span>
                              <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                {worldModelStanceLabel(hypothesis.stance, t)}
                              </span>
                              <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                {t("dossier.worldModel.confidence", { value: Math.round(hypothesis.confidence * 100) })}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-white/90">{hypothesis.thesis}</p>
                            <p className="mt-1 text-xs text-white/60">{hypothesis.summary}</p>
                            {hypothesis.evidence.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {hypothesis.evidence.slice(0, 2).map((evidence) => (
                                  <div key={`${hypothesis.thesis}-${evidence.claim_text}`} className="rounded border border-white/10 bg-black/20 p-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                        {relationLabel(evidence.relation, t)}
                                      </span>
                                      <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                        {t("dossier.worldModel.weight", { value: evidence.weight.toFixed(2) })}
                                      </span>
                                    </div>
                                    <p className="mt-2 text-xs text-white/80">{evidence.claim_text}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3">
                    <div className="rounded border border-white/10 bg-black/20 p-3">
                      <h5 className="text-[11px] font-mono tracking-widest text-white/70 mb-2">{t("dossier.worldModel.invalidationTitle")}</h5>
                      <div className="space-y-2">
                        {worldModel.invalidation_conditions.map((condition) => (
                          <div key={`${condition.hypothesis_thesis}-${condition.description}`} className="rounded border border-white/10 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${invalidationStatusClass(condition.observed_status)}`}>
                                {invalidationStatusLabel(condition.observed_status, t)}
                              </span>
                              <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${severityClass(condition.severity)}`}>
                                {condition.severity.toUpperCase()}
                              </span>
                              <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                {worldModelStanceLabel(condition.stance, t)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-white/90">{condition.description}</p>
                            {condition.expected_by ? (
                              <p className="mt-1 text-[10px] font-mono text-white/50">
                                {t("dossier.worldModel.expectedBy", { value: formatDateTime(condition.expected_by) })}
                              </p>
                            ) : null}
                            {condition.matched_evidence.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {condition.matched_evidence.slice(0, 2).map((evidence) => (
                                  <p key={evidence} className="text-[10px] font-mono text-white/55">- {evidence}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-3">
                      <h5 className="text-[11px] font-mono tracking-widest text-white/70 mb-2">{t("dossier.worldModel.nextSignals")}</h5>
                      <div className="space-y-2">
                        {worldModel.next_watch_signals.length > 0 ? (
                          worldModel.next_watch_signals.map((signal) => (
                            <div key={`${signal.stance}-${signal.description}`} className="rounded border border-white/10 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${severityClass(signal.severity)}`}>
                                  {signal.severity.toUpperCase()}
                                </span>
                                <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                                  {worldModelStanceLabel(signal.stance, t)}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-white/85">{signal.description}</p>
                              {signal.expected_by ? (
                                <p className="mt-1 text-[10px] font-mono text-white/50">
                                  {t("dossier.worldModel.expectedBy", { value: formatDateTime(signal.expected_by) })}
                                </p>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-white/55">{t("dossier.worldModel.nextSignalsEmpty")}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3">
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">{t("dossier.timeline.title")}</h4>
                  <div className="space-y-2">
                    {freshnessTimeline.map((source) => {
                      const freshness = sourceFreshnessTone(source.publishedAt);
                      return (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => setSelectedSourceUrl(source.url)}
                          className={`w-full rounded border px-3 py-2 text-left ${
                            selectedSourceUrl === source.url ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10 bg-black/20"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${sourceFreshnessClass(freshness)}`}>
                              {formatFreshnessLabel(freshness, t)}
                            </span>
                            <span className="text-[10px] font-mono text-white/45">{source.publishedAt ? formatDateTime(source.publishedAt) : t("dossier.timeline.dateUnknown")}</span>
                          </div>
                          <p className="mt-2 text-sm text-white/90">{source.title}</p>
                          <p className="mt-1 text-[10px] font-mono text-white/50">
                            {t("dossier.timeline.citedByClaims", { domain: source.domain, count: sourceUsage.get(source.url) ?? 0 })}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">{t("dossier.claimCoverage.title")}</h4>
                  <div className="space-y-2">
                    {detail.claims.map((claim) => (
                      <div key={claim.id} className="rounded border border-white/10 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/55">
                            {t("dossier.claimCoverage.sources", { value: claim.sourceUrls.length })}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-white/85">{claim.claimText}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {claim.sourceUrls.map((url) => {
                            const source = sourcesByUrl.get(url);
                            return (
                              <button
                                key={`${claim.id}-${url}`}
                                type="button"
                                onClick={() => setSelectedSourceUrl(url)}
                                className={`rounded border px-2 py-1 text-[10px] font-mono ${
                                  selectedSourceUrl === url ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/60"
                                }`}
                              >
                                {source?.domain ?? url}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3">
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">{t("dossier.sourceCoverage.title")}</h4>
                  <div className="space-y-2">
                    {sourceCoverageRows.map(({ source, citedByClaims, coveragePct }) => (
                      <button
                        key={`coverage-${source.id}`}
                        type="button"
                        onClick={() => setSelectedSourceUrl(source.url)}
                        className={`w-full rounded border px-3 py-2 text-left ${
                          selectedSourceUrl === source.url ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10 bg-black/20"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm text-white/85">{source.domain}</p>
                          <span className="text-[10px] font-mono text-white/45">{t("dossier.sourceCoverage.claims", { value: citedByClaims })}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-cyan-400/70" style={{ width: `${coveragePct}%` }} />
                        </div>
                        <p className="mt-2 text-[10px] font-mono text-white/45">{source.title}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">{t("dossier.support.title")}</h4>
                  <div className="space-y-2">
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.support.multi")}</p>
                      <p className="mt-1 text-sm text-white/90">{claimSupportStats.multiSourceClaims}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.support.single")}</p>
                      <p className="mt-1 text-sm text-white/90">{claimSupportStats.singleSourceClaims}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("dossier.support.unsupported")}</p>
                      <p className="mt-1 text-sm text-white/90">{claimSupportStats.unsupportedClaims}</p>
                    </div>
                  </div>
                </div>
              </div>
              {conflictTopics.length > 0 && (
                <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-amber-300 mb-2">{t("dossier.conflicts.title")}</h4>
                  <div className="flex flex-wrap gap-2">
                    {conflictTopics.map((topic) => (
                      <span key={topic} className="rounded border border-amber-500/20 px-2 py-1 text-[10px] font-mono text-amber-100/80">
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">{t("dossier.sources.title")}</h4>
                  <div className="space-y-2">
                    {detail.sources.map((source) => (
                      <a
                        key={source.id}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`block rounded border px-2 py-2 hover:border-cyan-500/30 ${
                          selectedSourceUrl === source.url ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm text-white/90">{source.title}</p>
                          <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${sourceFreshnessClass(sourceFreshnessTone(source.publishedAt))}`}>
                            {formatFreshnessLabel(sourceFreshnessTone(source.publishedAt), t)}
                          </span>
                          <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/55">
                            {t("dossier.sources.cited", { value: sourceUsage.get(source.url) ?? 0 })}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] font-mono text-white/45">{source.domain} · {source.publishedAt ? formatDateTime(source.publishedAt) : t("dossier.timeline.dateUnknown")}</p>
                        {source.snippet ? <p className="mt-2 text-xs text-white/65 line-clamp-3">{source.snippet}</p> : null}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">{t("dossier.claims.title")}</h4>
                  <div className="space-y-2">
                    {detail.claims.map((claim) => (
                      <div key={claim.id} className="rounded border border-white/10 px-2 py-2">
                        <p className="text-sm text-white/85">{claim.claimText}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {claim.sourceUrls.map((url) => {
                            const source = sourcesByUrl.get(url);
                            return (
                              <button
                                key={`${claim.id}-detail-${url}`}
                                type="button"
                                onClick={() => setSelectedSourceUrl(url)}
                                className={`rounded border px-2 py-1 text-[10px] font-mono ${
                                  selectedSourceUrl === url ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/60"
                                }`}
                              >
                                {source?.domain ?? url}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {exportedMarkdown && (
                <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-emerald-300 mb-2">{t("dossier.exportPreview")}</h4>
                  <pre className="whitespace-pre-wrap text-[11px] font-mono text-white/75">{exportedMarkdown}</pre>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
