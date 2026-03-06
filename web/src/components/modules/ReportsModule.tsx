"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Play, GitPullRequest, RefreshCw, Send, RotateCcw } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  getReportsOverview,
  getUpgradeRun,
  listBriefings,
  listDossiers,
  listUpgradeRuns,
  listRadarTelegramReports,
  listUpgradeProposals,
  retryRadarTelegramReport,
  startUpgradeRun,
  streamRadarTelegramReportsEvents,
} from "@/lib/api/endpoints";
import type {
  BriefingRecord,
  DossierRecord,
  ReportsOverviewData,
  TelegramReportRecord,
  UpgradeProposalRecord,
  UpgradeRunRecord,
} from "@/lib/api/types";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";
import { AsyncState } from "@/components/ui/AsyncState";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ReportsModule() {
  const role = useCurrentRole();
  const canOperate = hasMinRole(role, "operator");
  const [proposals, setProposals] = useState<UpgradeProposalRecord[]>([]);
  const [overview, setOverview] = useState<ReportsOverviewData | null>(null);
  const [latestRun, setLatestRun] = useState<UpgradeRunRecord | null>(null);
  const [telegramReports, setTelegramReports] = useState<TelegramReportRecord[]>([]);
  const [briefings, setBriefings] = useState<BriefingRecord[]>([]);
  const [dossiers, setDossiers] = useState<DossierRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingFor, setStartingFor] = useState<string | null>(null);
  const [retryingReportId, setRetryingReportId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canOperate) {
      setProposals([]);
      setOverview(null);
      setLatestRun(null);
      setTelegramReports([]);
      setBriefings([]);
      setDossiers([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [proposalData, overviewData, telegramData, upgradeRunsData, briefingData, dossierData] = await Promise.all([
        listUpgradeProposals(),
        getReportsOverview(),
        listRadarTelegramReports({ limit: 20 }),
        listUpgradeRuns({ limit: 1 }),
        listBriefings({ limit: 12 }).catch(() => ({ briefings: [] })),
        listDossiers({ limit: 12 }).catch(() => ({ dossiers: [] })),
      ]);
      setProposals(proposalData.proposals);
      setOverview(overviewData);
      setTelegramReports(telegramData.reports);
      setLatestRun(upgradeRunsData.runs[0] ?? null);
      setBriefings(briefingData.briefings);
      setDossiers(dossierData.dossiers);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to load reports");
      }
      setProposals([]);
      setOverview(null);
      setTelegramReports([]);
      setLatestRun(null);
      setBriefings([]);
      setDossiers([]);
    } finally {
      setLoading(false);
    }
  }, [canOperate]);

  useEffect(() => {
    if (!canOperate) return;
    void refresh();
  }, [canOperate, refresh]);

  useEffect(() => {
    if (!canOperate) return;
    const stream = streamRadarTelegramReportsEvents(
      { limit: 20 },
      {
        onUpdated: (payload) => {
          setTelegramReports(payload.data.reports);
        },
      }
    );

    return () => {
      stream.close();
    };
  }, [canOperate]);

  const approved = useMemo(() => proposals.filter((item) => item.status === "approved"), [proposals]);
  const telegramSummary = useMemo(() => {
    return {
      queued: telegramReports.filter((item) => item.status === "queued").length,
      sent: telegramReports.filter((item) => item.status === "sent").length,
      failed: telegramReports.filter((item) => item.status === "failed").length,
    };
  }, [telegramReports]);

  const startRun = async (proposalId: string) => {
    if (!canOperate) return;
    setStartingFor(proposalId);
    setError(null);
    try {
      const run = await startUpgradeRun({
        proposal_id: proposalId,
        start_command: "작업 시작",
      });
      const detail = await getUpgradeRun(run.id);
      setLatestRun(detail);
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to start run");
      }
    } finally {
      setStartingFor(null);
    }
  };

  const retryReport = async (reportId: string) => {
    if (!canOperate) return;
    setRetryingReportId(reportId);
    setError(null);
    try {
      await retryRadarTelegramReport(reportId);
      const latest = await listRadarTelegramReports({ limit: 20 });
      setTelegramReports(latest.reports);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to retry telegram report");
      }
    } finally {
      setRetryingReportId(null);
    }
  };

  return (
    <main className="w-full h-full bg-transparent text-white p-4 flex flex-col">
      <header className="mb-4 border-l-2 border-white/40 pl-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-mono font-bold tracking-widest text-white flex items-center gap-2">
            <FileSpreadsheet size={14} /> REPORT STUDIO
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 h-7 px-2 rounded border border-white/20 text-[10px] font-mono text-white/70 hover:text-white hover:border-white/40"
        >
          <RefreshCw size={11} /> REFRESH
        </button>
      </header>

      {!canOperate && (
        <section className="rounded border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-mono text-amber-300">
            Operator role required. Member accounts cannot load report, radar, or upgrade execution APIs.
          </p>
        </section>
      )}

      {canOperate && (
        <AsyncState
          loading={loading}
          error={error}
          empty={false}
          loadingText="Loading report data..."
          onRetry={() => void refresh()}
          className="mb-3"
        />
      )}

      {canOperate && overview && (
        <section className="mb-3 grid grid-cols-2 xl:grid-cols-4 gap-2">
          <div className="rounded border border-white/10 bg-black/40 p-2">
            <p className="text-[10px] font-mono text-white/40 uppercase">Running Tasks</p>
            <p className="text-sm font-mono text-cyan-300">{overview.tasks.running}</p>
          </div>
          <div className="rounded border border-white/10 bg-black/40 p-2">
            <p className="text-[10px] font-mono text-white/40 uppercase">Pending Approvals</p>
            <p className="text-sm font-mono text-amber-300">{overview.upgrades.pending_approvals}</p>
          </div>
          <div className="rounded border border-white/10 bg-black/40 p-2">
            <p className="text-[10px] font-mono text-white/40 uppercase">Fallback Rate</p>
            <p className="text-sm font-mono text-rose-300">{overview.executions.fallback_rate_pct}%</p>
          </div>
          <div className="rounded border border-white/10 bg-black/40 p-2">
            <p className="text-[10px] font-mono text-white/40 uppercase">Providers</p>
            <p className="text-sm font-mono text-emerald-300">
              {overview.providers.enabled}/{overview.providers.items.length} enabled
            </p>
          </div>
        </section>
      )}

      {canOperate && (
        <section className="mb-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3">
            <p className="text-[10px] font-mono tracking-widest text-cyan-300 uppercase mb-2">Briefing Archive</p>
            <div className="space-y-2">
              {briefings.slice(0, 4).map((briefing) => (
                <div key={briefing.id} className="rounded border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-sm text-white/90">{briefing.title}</p>
                  <p className="text-[10px] font-mono text-white/45">{briefing.sourceCount} sources</p>
                </div>
              ))}
              {briefings.length === 0 && <p className="text-xs text-white/45">No briefings generated yet.</p>}
            </div>
          </div>
          <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3">
            <p className="text-[10px] font-mono tracking-widest text-cyan-300 uppercase mb-2">Dossier Archive</p>
            <div className="space-y-2">
              {dossiers.slice(0, 4).map((dossier) => (
                <div key={dossier.id} className="rounded border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-sm text-white/90">{dossier.title}</p>
                  <p className="text-[10px] font-mono text-white/45">{dossier.status}</p>
                </div>
              ))}
              {dossiers.length === 0 && <p className="text-xs text-white/45">No dossiers compiled yet.</p>}
            </div>
          </div>
        </section>
      )}

      {canOperate && <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 flex-1 overflow-hidden">
        <section className="border border-white/10 rounded bg-black/30 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-white/10 font-mono text-[10px] text-white/40 uppercase tracking-widest">
            Approved Proposals ({approved.length})
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {!loading && !error && approved.length === 0 && (
              <p className="text-xs font-mono text-white/40">No approved proposals yet.</p>
            )}

            {!loading &&
              !error &&
              approved.map((item) => (
                <div key={item.id} className="rounded border border-white/10 bg-black/40 p-3">
                  <p className="text-sm text-white/90 mb-1">{item.proposalTitle}</p>
                  <p className="text-[10px] font-mono text-white/40 mb-2">{item.id}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-white/35">{formatDate(item.createdAt)}</span>
                    <button
                      onClick={() => void startRun(item.id)}
                      disabled={startingFor === item.id}
                      className="px-2 py-1 text-[10px] font-mono rounded border border-emerald-500/40 text-emerald-300 hover:text-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                      <Play size={11} /> START RUN
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </section>

        <section className="border border-emerald-500/20 rounded bg-emerald-950/10 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-emerald-500/20 font-mono text-[10px] text-emerald-300 uppercase tracking-widest flex items-center gap-2">
            <GitPullRequest size={12} /> Latest Run
          </div>
          <div className="p-3 space-y-2 text-sm">
            {!latestRun && <p className="text-white/50">No run started from widget.</p>}
            {latestRun && (
              <>
                <p className="text-emerald-100/90">Run: {latestRun.id}</p>
                <p className="text-emerald-100/90">Proposal: {latestRun.proposalId}</p>
                <p className="text-emerald-100/90">Status: {latestRun.status}</p>
                <p className="text-emerald-100/90">Created: {formatDate(latestRun.createdAt)}</p>
                <p className="text-emerald-100/90">Updated: {formatDate(latestRun.updatedAt)}</p>
              </>
            )}
          </div>
        </section>

        <section className="border border-cyan-500/20 rounded bg-cyan-950/10 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-cyan-500/20 font-mono text-[10px] text-cyan-300 uppercase tracking-widest flex items-center justify-between">
            <span className="inline-flex items-center gap-2">
              <Send size={12} /> Telegram Delivery
            </span>
            <span className="text-[9px] text-cyan-200/80">
              q:{telegramSummary.queued} s:{telegramSummary.sent} f:{telegramSummary.failed}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {!loading && !error && telegramReports.length === 0 && (
              <p className="text-xs font-mono text-white/40">No telegram reports yet.</p>
            )}
            {!loading &&
              !error &&
              telegramReports.map((report) => (
                <div key={report.id} className="rounded border border-white/10 bg-black/40 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-white/90">{report.chatId}</p>
                    <span
                      className={`text-[10px] font-mono uppercase ${
                        report.status === "sent"
                          ? "text-emerald-300"
                          : report.status === "failed"
                            ? "text-rose-300"
                            : "text-amber-300"
                      }`}
                    >
                      {report.status}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-white/40">{report.id}</p>
                  <p className="text-[10px] font-mono text-white/50 mt-1">
                    attempts {report.attemptCount ?? 0}/{report.maxAttempts ?? 0}
                  </p>
                  {report.status === "queued" && report.nextAttemptAt && (
                    <p className="text-[10px] font-mono text-amber-200/80">next: {formatDate(report.nextAttemptAt)}</p>
                  )}
                  {report.status === "sent" && report.sentAt && (
                    <p className="text-[10px] font-mono text-emerald-200/80">
                      sent: {formatDate(report.sentAt)}
                      {report.telegramMessageId ? ` · msg ${report.telegramMessageId}` : ""}
                    </p>
                  )}
                  {report.status === "failed" && report.lastError && (
                    <p className="text-[10px] font-mono text-rose-200/80 truncate">{report.lastError}</p>
                  )}
                  {report.status === "failed" && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => void retryReport(report.id)}
                        disabled={retryingReportId === report.id}
                        className="inline-flex items-center gap-1 h-6 px-2 rounded border border-amber-400/40 bg-amber-500/10 text-[10px] font-mono text-amber-200 disabled:opacity-40"
                      >
                        <RotateCcw size={10} />
                        {retryingReportId === report.id ? "RETRYING..." : "RETRY"}
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] font-mono text-white/35 mt-1">{formatDate(report.createdAt)}</p>
                </div>
              ))}
          </div>
        </section>
      </div>}
    </main>
  );
}
