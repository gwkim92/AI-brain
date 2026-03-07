"use client";

import React, { useEffect, useState } from "react";
import { Workflow, Play, Plus, Clock } from "lucide-react";
import { ApiRequestError } from "@/lib/api/client";
import {
    evaluateRadar,
    ingestRadar,
    listRadarItems,
    listRadarRecommendations,
    sendRadarTelegramReport,
    streamRadarTelegramReportEvents,
} from "@/lib/api/endpoints";
import type { TelegramReportRecord } from "@/lib/api/types";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";
import { useLocale } from "@/components/providers/LocaleProvider";

export default function AutomationsPage() {
    const role = useCurrentRole();
    const { t, formatDateTime } = useLocale();
    const defaultLastRunSummary = t("automations.noTriggerYet");
    const canOperate = hasMinRole(role, "operator");
    const [running, setRunning] = useState(false);
    const [lastRunSummary, setLastRunSummary] = useState<string>(defaultLastRunSummary);
    const [error, setError] = useState<string | null>(null);
    const [lastTelegramReport, setLastTelegramReport] = useState<TelegramReportRecord | null>(null);
    const lastTelegramReportId = lastTelegramReport?.id ?? null;

    const runRadarPipelineNow = async () => {
        if (!canOperate) {
            return;
        }
        setRunning(true);
        setError(null);

        try {
            const ingest = await ingestRadar();
            const radarItems = await listRadarItems({ status: "new", limit: 10 });

            if (radarItems.items.length > 0) {
                await evaluateRadar({ item_ids: radarItems.items.slice(0, 10).map((item) => item.id) });
            }

            const recommendations = await listRadarRecommendations();
            const telegramReport = await sendRadarTelegramReport({ chat_id: "telegram" });
            setLastTelegramReport(telegramReport);

            setLastRunSummary(
                `Ingested ${ingest.accepted_count} items, recommendations ${recommendations.recommendations.length}, telegram job ${telegramReport.id.slice(0, 8)} created.`
            );
        } catch (err) {
            if (err instanceof ApiRequestError) {
                setError(`${err.code}: ${err.message}`);
            } else {
                setError(t("automations.runFailed"));
            }
        } finally {
            setRunning(false);
        }
    };

    useEffect(() => {
        if (!running && !lastTelegramReport && !error) {
            setLastRunSummary(defaultLastRunSummary);
        }
    }, [defaultLastRunSummary, error, lastTelegramReport, running]);

    useEffect(() => {
        if (!canOperate || !lastTelegramReportId) {
            return;
        }
        const stream = streamRadarTelegramReportEvents(lastTelegramReportId, {
            onUpdated: (payload) => {
                setLastTelegramReport(payload.data);
            },
        });

        return () => {
            stream.close();
        };
    }, [canOperate, lastTelegramReportId]);

    return (
        <main className="w-full h-full bg-black text-white p-8 overflow-y-auto">
            <header className="mb-10 border-l-2 border-white/50 pl-4 flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-mono font-bold tracking-widest text-white flex items-center gap-3">
                        <Workflow size={24} /> {t("automations.title")}
                    </h1>
                    <p className="text-sm font-mono text-white/50 tracking-wide mt-1">
                        {t("automations.subtitle")}
                    </p>
                </div>

                <button className="flex items-center gap-2 px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black rounded-md text-xs font-mono font-bold transition-colors">
                    <Plus size={16} /> {t("automations.newWorkflow")}
                </button>
            </header>

            {!canOperate && (
                <section className="rounded border border-amber-500/30 bg-amber-500/10 p-3 mb-6">
                    <p className="text-xs font-mono text-amber-300">
                        {t("automations.operatorRequired")}
                    </p>
                </section>
            )}

            {canOperate && <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Active Workflow */}
                <div className="glass-panel p-6 rounded-xl border border-white/10 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Workflow size={100} />
                    </div>

                    <div className="flex justify-between items-start mb-6 border-b border-white/5 pb-4">
                        <div>
                            <h3 className="font-bold text-lg text-white/90">{t("automations.workflow.dailyTechRadar")}</h3>
                            <p className="text-xs font-mono text-cyan-400 mt-1 flex items-center gap-2">
                                <Clock size={12} /> CRON: 0 0 * * *
                            </p>
                        </div>
                        <div className="w-10 h-5 bg-cyan-500 rounded-full relative shadow-[0_0_10px_rgba(0,255,255,0.3)]">
                            <div className="absolute right-1 top-1 w-3 h-3 bg-black rounded-full"></div>
                        </div>
                    </div>

                    <div className="space-y-4 mb-6 relative z-10">
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-mono tracking-widest text-white/40 uppercase">{t("automations.workflow.trigger")}</span>
                            <div className="bg-black/50 p-2 text-sm text-white/80 rounded border border-white/5">{t("automations.workflow.timeBased")}</div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-mono tracking-widest text-white/40 uppercase">{t("automations.workflow.actionProtocol")}</span>
                            <div className="bg-black/50 p-2 text-sm text-white/80 rounded border border-white/5">{t("automations.workflow.actionProtocolValue")}</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 border-t border-white/5 pt-4">
                        <button className="flex-1 bg-white/5 py-2 font-mono text-[10px] tracking-widest rounded text-white/60 hover:text-white transition-colors">
                            {t("automations.workflow.editConfig")}
                        </button>
                        <button
                            className="flex items-center justify-center gap-2 flex-1 bg-cyan-500/10 border border-cyan-500/30 py-2 font-mono text-[10px] tracking-widest rounded text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={() => void runRadarPipelineNow()}
                            disabled={running}
                        >
                            <Play size={12} /> {t("automations.workflow.triggerNow")}
                        </button>
                    </div>
                </div>

                {/* Failed Workflow */}
                <div className="glass-panel p-6 rounded-xl border-l-4 border-l-red-500 border-white/10 relative overflow-hidden group">
                    <div className="flex justify-between items-start mb-6 border-b border-white/5 pb-4">
                        <div>
                            <h3 className="font-bold text-lg text-white/90">{t("automations.workflow.weeklySync")}</h3>
                            <p className="text-xs font-mono text-red-500 mt-1">{t("automations.workflow.statusFailed")}</p>
                        </div>
                        <div className="w-10 h-5 bg-white/10 rounded-full relative">
                            <div className="absolute left-1 top-1 w-3 h-3 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
                        </div>
                    </div>

                    <div className="bg-red-950/30 border border-red-500/20 p-4 rounded text-sm text-red-200/80 font-mono mb-4">
                        [ERROR 401] OAuth Token Expired for Google Calendar. Please re-authenticate connector.
                    </div>
                </div>

            </div>}

            {canOperate && <section className="mt-8 border border-white/10 rounded-xl p-5 bg-white/5">
                <h2 className="text-xs font-mono tracking-widest text-white/50 mb-3 uppercase">{t("automations.lastTriggerResult")}</h2>
                {running && <p className="text-cyan-300 font-mono text-sm">{t("automations.running")}</p>}
                {!running && <p className="text-white/80 text-sm">{lastRunSummary}</p>}
                {error && <p className="mt-2 text-red-400 text-sm font-mono">{error}</p>}
            </section>}

            {canOperate && <section className="mt-4 border border-cyan-500/20 rounded-xl p-5 bg-cyan-950/10">
                <h2 className="text-xs font-mono tracking-widest text-cyan-300 mb-3 uppercase">{t("automations.telegramStatus")}</h2>
                {!lastTelegramReport && <p className="text-white/60 text-sm">{t("automations.telegramNone")}</p>}
                {lastTelegramReport && (
                    <div className="space-y-1 text-sm">
                        <p className="text-white/80">
                            {t("automations.telegram.report")}: <span className="font-mono">{lastTelegramReport.id}</span>
                        </p>
                        <p className="text-white/80">
                            {t("automations.telegram.status")}:{" "}
                            <span
                                className={
                                    lastTelegramReport.status === "sent"
                                        ? "text-emerald-300 font-mono uppercase"
                                        : lastTelegramReport.status === "failed"
                                            ? "text-red-300 font-mono uppercase"
                                            : "text-amber-300 font-mono uppercase"
                                }
                            >
                                {lastTelegramReport.status}
                            </span>
                        </p>
                        <p className="text-white/70 font-mono text-xs">
                            {t("automations.telegram.attempts", { attempts: lastTelegramReport.attemptCount ?? 0, maxAttempts: lastTelegramReport.maxAttempts ?? 0 })}
                        </p>
                        {lastTelegramReport.nextAttemptAt && (
                            <p className="text-white/60 text-xs">{t("automations.telegram.nextAttempt", { date: formatDateTime(lastTelegramReport.nextAttemptAt) })}</p>
                        )}
                        {lastTelegramReport.sentAt && (
                            <p className="text-emerald-200 text-xs">{t("automations.telegram.sentAt", { date: formatDateTime(lastTelegramReport.sentAt) })}</p>
                        )}
                        {lastTelegramReport.lastError && (
                            <p className="text-red-300 text-xs">{t("automations.telegram.error", { value: lastTelegramReport.lastError })}</p>
                        )}
                    </div>
                )}
            </section>}
        </main>
    );
}
