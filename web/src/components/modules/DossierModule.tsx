"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenText, Download, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { ApiRequestError } from "@/lib/api/client";
import { exportDossier, getDossier, listDossiers, refreshDossier } from "@/lib/api/endpoints";
import type { DossierDetail, DossierRecord } from "@/lib/api/types";
import { MarkdownLite } from "@/components/ui/MarkdownLite";

type ParsedQuality = {
  sourceCount: number | null;
  domainCount: number | null;
  domainDiversityScore: number | null;
  freshnessBucket: string | null;
  citationCoverage: number | null;
  qualityGatePassed: boolean | null;
  softWarnings: string[];
  topDomains: Array<{ domain: string; count: number }>;
};

type SourceFreshnessTone = "recent" | "stale" | "unknown";

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

function formatSourceDate(value: string | null): string {
  if (!value) return "date unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date unknown";
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeAge(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return "just now";
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 86_400_000) return `${Math.floor(deltaMs / 3_600_000)}h ago`;
  return `${Math.floor(deltaMs / 86_400_000)}d ago`;
}

export function DossierModule() {
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
        if (requestedId && result.dossiers.some((item) => item.id === requestedId)) {
          return requestedId;
        }
        return current ?? result.dossiers[0]?.id ?? null;
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to load dossiers");
      }
      setDossiers([]);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  const hydrateDetail = useCallback(async (dossierId: string) => {
    try {
      const result = await getDossier(dossierId);
      setDetail(result);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to load dossier detail");
      }
      setDetail(null);
    }
  }, []);

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
    if (dossiers.some((item) => item.id === requestedId)) {
      setSelectedId(requestedId);
    }
  }, [dossiers, searchParams, selectedId]);

  const selected = useMemo(() => dossiers.find((item) => item.id === selectedId) ?? null, [dossiers, selectedId]);
  const quality = useMemo(
    () => (detail ? parseQualityJson(detail.dossier.qualityJson) : null),
    [detail]
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
        setError("failed to refresh dossier");
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
        setError("failed to export dossier");
      }
    }
  };

  return (
    <main className="w-full h-full min-h-0 overflow-hidden bg-transparent p-4 text-white flex flex-col gap-4">
      <header className="border-l-2 border-cyan-500 pl-3 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-400 flex items-center gap-2">
            <BookOpenText size={14} /> DOSSIERS
          </h2>
          <p className="text-[10px] font-mono text-white/40">Grounded research archive</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void refreshList()} className="inline-flex h-7 items-center gap-1 rounded border border-white/20 px-2 text-[10px] font-mono text-white/70">
            <RefreshCw size={11} /> LIST
          </button>
          <button type="button" onClick={() => void onRefreshDossier()} disabled={!selected || refreshing} className="inline-flex h-7 items-center gap-1 rounded border border-cyan-500/40 px-2 text-[10px] font-mono text-cyan-300 disabled:opacity-50">
            <RefreshCw size={11} /> REFRESH
          </button>
          <button type="button" onClick={() => void onExport()} disabled={!selected} className="inline-flex h-7 items-center gap-1 rounded border border-emerald-500/40 px-2 text-[10px] font-mono text-emerald-300 disabled:opacity-50">
            <Download size={11} /> EXPORT
          </button>
        </div>
      </header>

      {error && <p className="text-xs font-mono text-rose-300">{error}</p>}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-3 overflow-hidden">
        <section className="rounded border border-white/10 bg-black/30 overflow-y-auto p-2 space-y-2 min-h-0">
          {loading && <p className="text-xs font-mono text-white/45">Loading dossiers...</p>}
          {!loading && dossiers.length === 0 && <p className="text-xs font-mono text-white/45">No dossiers yet.</p>}
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
                <span className="rounded border border-white/10 px-2 py-0.5">updated {formatRelativeAge(dossier.updatedAt)}</span>
                <span className="rounded border border-white/10 px-2 py-0.5">created {formatSourceDate(dossier.createdAt)}</span>
                <span className="rounded border border-white/10 px-2 py-0.5">id {dossier.id.slice(0, 8)}</span>
                {dossier.sessionId ? (
                  <span className="rounded border border-white/10 px-2 py-0.5">session {dossier.sessionId.slice(0, 8)}</span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${qualityTone(quality.qualityGatePassed)}`}>
                  {quality.qualityGatePassed === true ? "quality pass" : quality.qualityGatePassed === false ? "quality warn" : "quality n/a"}
                </span>
                {quality.sourceCount !== null && (
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/55">
                    {quality.sourceCount} sources
                  </span>
                )}
                {quality.freshnessBucket && (
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/55">
                    freshness {quality.freshnessBucket}
                  </span>
                )}
              </div>
            </button>
              );
            })()
          ))}
        </section>

        <section className="rounded border border-white/10 bg-black/30 overflow-hidden flex min-h-0 flex-col">
          {!detail && <div className="p-4 text-xs font-mono text-white/45">Select a dossier to inspect sources and claims.</div>}
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
                      {quality.qualityGatePassed === true ? "QUALITY PASS" : quality.qualityGatePassed === false ? "QUALITY WARN" : "QUALITY UNKNOWN"}
                    </span>
                    {quality.freshnessBucket && (
                      <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white/60">
                        freshness {quality.freshnessBucket}
                      </span>
                    )}
                    {conflictCount !== null && (
                      <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white/60">
                        conflicts {conflictCount}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">sources</p>
                      <p className="mt-1 text-sm text-white/90">{quality.sourceCount ?? "-"}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">domains</p>
                      <p className="mt-1 text-sm text-white/90">
                        {quality.domainCount ?? "-"}
                        {quality.domainDiversityScore !== null ? ` · ${quality.domainDiversityScore}` : ""}
                      </p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">citation</p>
                      <p className="mt-1 text-sm text-white/90">
                        {quality.citationCoverage !== null ? `${Math.round(quality.citationCoverage * 100)}%` : "-"}
                      </p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">freshness</p>
                      <p className="mt-1 text-sm text-white/90">{quality.freshnessBucket ?? "-"}</p>
                    </div>
                  </div>
                  {quality.softWarnings.length > 0 && (
                    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
                      <h4 className="text-[11px] font-mono tracking-widest text-amber-300 mb-2">QUALITY WARNINGS</h4>
                      <div className="space-y-1">
                        {quality.softWarnings.map((warning) => (
                          <p key={warning} className="text-xs text-amber-100/80">
                            - {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {quality.topDomains.length > 0 && (
                    <div className="rounded border border-white/10 bg-black/20 p-3">
                      <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">TOP DOMAINS</h4>
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
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3">
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">FRESHNESS TIMELINE</h4>
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
                              {freshness}
                            </span>
                            <span className="text-[10px] font-mono text-white/45">{formatSourceDate(source.publishedAt)}</span>
                          </div>
                          <p className="mt-2 text-sm text-white/90">{source.title}</p>
                          <p className="mt-1 text-[10px] font-mono text-white/50">
                            {source.domain} · cited by {sourceUsage.get(source.url) ?? 0} claim{(sourceUsage.get(source.url) ?? 0) === 1 ? "" : "s"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">CLAIM COVERAGE</h4>
                  <div className="space-y-2">
                    {detail.claims.map((claim) => (
                      <div key={claim.id} className="rounded border border-white/10 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/55">
                            {claim.sourceUrls.length} source{claim.sourceUrls.length === 1 ? "" : "s"}
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
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">SOURCE COVERAGE MAP</h4>
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
                          <span className="text-[10px] font-mono text-white/45">{citedByClaims} claims</span>
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
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">SUPPORT BREAKDOWN</h4>
                  <div className="space-y-2">
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">multi-source</p>
                      <p className="mt-1 text-sm text-white/90">{claimSupportStats.multiSourceClaims}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">single-source</p>
                      <p className="mt-1 text-sm text-white/90">{claimSupportStats.singleSourceClaims}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">unsupported</p>
                      <p className="mt-1 text-sm text-white/90">{claimSupportStats.unsupportedClaims}</p>
                    </div>
                  </div>
                </div>
              </div>
              {conflictTopics.length > 0 && (
                <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-amber-300 mb-2">CONFLICT TOPICS</h4>
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
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">SOURCES</h4>
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
                            {sourceFreshnessTone(source.publishedAt)}
                          </span>
                          <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/55">
                            cited {sourceUsage.get(source.url) ?? 0}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] font-mono text-white/45">{source.domain} · {formatSourceDate(source.publishedAt)}</p>
                        {source.snippet ? <p className="mt-2 text-xs text-white/65 line-clamp-3">{source.snippet}</p> : null}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <h4 className="text-[11px] font-mono tracking-widest text-cyan-300 mb-2">CLAIMS</h4>
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
                  <h4 className="text-[11px] font-mono tracking-widest text-emerald-300 mb-2">EXPORT PREVIEW</h4>
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
