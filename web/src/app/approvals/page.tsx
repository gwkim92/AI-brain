"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ApprovalCard } from "@/components/ui/ApprovalCard";
import { ShieldCheck, History, SlidersHorizontal } from "lucide-react";
import type { RiskLevel } from "@/components/ui/RiskPill";
import { decideUpgradeProposal, listUpgradeProposals } from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/client";
import type { UpgradeProposalRecord, UpgradeStatus } from "@/lib/api/types";
import { AsyncState } from "@/components/ui/AsyncState";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";

function proposalAnchorId(proposalId: string): string {
    return `proposal-${proposalId}`;
}

export default function ApprovalsPage() {
    const role = useCurrentRole();
    const canOperate = hasMinRole(role, "operator");
    const [requestedProposalId, setRequestedProposalId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
    const [proposals, setProposals] = useState<UpgradeProposalRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [submittingId, setSubmittingId] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!canOperate) {
            setProposals([]);
            setLoading(false);
            setError(null);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const { proposals: rows } = await listUpgradeProposals();
            setProposals(rows);
        } catch (err) {
            if (err instanceof ApiRequestError) {
                setError(`${err.code}: ${err.message}`);
            } else {
                setError("failed to load proposals");
            }
            setProposals([]);
        } finally {
            setLoading(false);
        }
    }, [canOperate]);

    useEffect(() => {
        if (!canOperate) {
            setLoading(false);
            setError(null);
            setProposals([]);
            return;
        }
    }, [canOperate]);

    useEffect(() => {
        if (!canOperate) return;
        void refresh();
    }, [canOperate, refresh]);

    useEffect(() => {
        const syncRequestedProposalId = () => {
            const params = new URLSearchParams(window.location.search);
            setRequestedProposalId(params.get("proposal"));
        };

        syncRequestedProposalId();
        window.addEventListener("popstate", syncRequestedProposalId);

        return () => {
            window.removeEventListener("popstate", syncRequestedProposalId);
        };
    }, []);

    const resolveRisk = (status: UpgradeStatus): RiskLevel => {
        if (status === "proposed") return "high";
        if (status === "failed" || status === "rolled_back") return "critical";
        if (status === "approved" || status === "planning") return "medium";
        return "low";
    };

    const pendingApprovals = useMemo(() => proposals.filter((item) => item.status === "proposed"), [proposals]);
    const historyApprovals = useMemo(() => proposals.filter((item) => item.status !== "proposed"), [proposals]);
    const targetedProposal = useMemo(
        () => proposals.find((item) => item.id === requestedProposalId) ?? null,
        [proposals, requestedProposalId]
    );

    useEffect(() => {
        if (!targetedProposal) {
            return;
        }
        setActiveTab(targetedProposal.status === "proposed" ? "pending" : "history");
    }, [targetedProposal]);

    useEffect(() => {
        if (!targetedProposal) {
            return;
        }

        const anchorId = proposalAnchorId(targetedProposal.id);
        const timer = window.setTimeout(() => {
            const element = document.getElementById(anchorId);
            element?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 120);

        return () => {
            window.clearTimeout(timer);
        };
    }, [targetedProposal, activeTab]);

    const decide = async (proposalId: string, decision: "approve" | "reject") => {
        if (!canOperate) {
            return;
        }
        setSubmittingId(proposalId);
        setError(null);
        try {
            await decideUpgradeProposal(proposalId, { decision });
            await refresh();
        } catch (err) {
            if (err instanceof ApiRequestError) {
                setError(`${err.code}: ${err.message}`);
            } else {
                setError("failed to submit approval decision");
            }
        } finally {
            setSubmittingId(null);
        }
    };

    return (
        <main className="w-full h-full bg-black text-white p-8 flex flex-col">

            <header className="mb-8 border-l-2 border-amber-500 pl-4 flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-mono font-bold tracking-widest text-amber-500 flex items-center gap-3">
                        <ShieldCheck size={24} /> APPROVAL CENTER
                    </h1>
                    <p className="text-sm font-mono text-white/50 tracking-wide mt-1">
                        HUMAN PRE-EXECUTION GATE
                    </p>
                </div>

                <div className="flex bg-white/5 p-1 rounded-lg border border-white/10 font-mono text-xs">
                    <button
                        onClick={() => setActiveTab("pending")}
                        className={`px-4 py-2 rounded transition-colors flex items-center gap-2 ${activeTab === "pending" ? "bg-white/10 text-white font-bold shadow-[0_4px_10px_rgba(0,0,0,0.5)]" : "text-white/50 hover:text-white"}`}
                    >
                        PENDING <span className="px-1.5 rounded-full bg-amber-500 text-black text-[10px]">{pendingApprovals.length}</span>
                    </button>
                    <button
                        onClick={() => setActiveTab("history")}
                        className={`px-4 py-2 rounded transition-colors flex items-center gap-2 ${activeTab === "history" ? "bg-white/10 text-white font-bold" : "text-white/50 hover:text-white"}`}
                    >
                        HISTORY <History size={14} />
                    </button>
                </div>
            </header>

            {!canOperate && (
                <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 p-3 font-mono text-xs text-amber-300">
                    Operator role required. Member accounts cannot access approval execution APIs.
                </div>
            )}

            {canOperate && <div className="flex justify-between items-center mb-6 font-mono text-xs border-b border-white/10 pb-4">
                <div className="flex items-center gap-4 text-white/50">
                    <button className="flex items-center gap-2 hover:text-white transition-colors">
                        <SlidersHorizontal size={14} /> FILTER BY RISK
                    </button>
                    <button className="hover:text-white transition-colors">DATE</button>
                </div>
                <div className="text-white/40">
                    AUTO-REJECT IN 24H: <span className="text-amber-500">ON</span>
                </div>
            </div>}

            {canOperate && <AsyncState
                loading={loading}
                error={error}
                empty={false}
                loadingText="Loading approvals..."
                onRetry={() => void refresh()}
                className="mb-4"
            />}
            {canOperate && !loading && requestedProposalId && !targetedProposal && (
                <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 p-3 font-mono text-xs text-amber-300">
                    Proposal `{requestedProposalId.slice(0, 8)}` was not found in the current approval dataset.
                </div>
            )}
            {canOperate && !loading && targetedProposal && (
                <div className="mb-4 rounded border border-cyan-500/30 bg-cyan-500/10 p-3 font-mono text-xs text-cyan-300">
                    Focused proposal: `{targetedProposal.id.slice(0, 8)}` ({targetedProposal.status.toUpperCase()}).
                </div>
            )}

            {canOperate && (activeTab === "pending" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto pb-8 pr-4">
                    {!loading && !error && pendingApprovals.length === 0 && (
                        <AsyncState
                            loading={false}
                            error={null}
                            empty
                            emptyText="No pending upgrade proposals."
                            className="col-span-2 text-sm font-mono text-white/30 border border-white/10 rounded-lg p-6"
                        />
                    )}
                    {pendingApprovals.map((app) => (
                        <ApprovalCard
                            key={app.id}
                            id={app.id}
                            containerId={proposalAnchorId(app.id)}
                            highlighted={app.id === requestedProposalId}
                            title={app.proposalTitle}
                            description={`Proposal ${app.id.slice(0, 8)} based on recommendation ${app.recommendationId.slice(0, 8)}.`}
                            risk={resolveRisk(app.status)}
                            requester="Upgrade Planner"
                            impact={`STATUS: ${app.status.toUpperCase()} | CREATED: ${new Date(app.createdAt).toLocaleString()}`}
                            onApprove={() => void decide(app.id, "approve")}
                            onReject={() => void decide(app.id, "reject")}
                            disabled={submittingId === app.id}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto pb-8 pr-4 space-y-4">
                    {!loading && !error && historyApprovals.length === 0 && (
                        <AsyncState
                            loading={false}
                            error={null}
                            empty
                            emptyText="NO HISTORICAL APPROVALS IN TIMEFRAME"
                            className="flex-1 flex items-center justify-center text-white/20 font-mono text-sm border-2 border-dashed border-white/10 rounded-xl min-h-[180px]"
                        />
                    )}
                    {historyApprovals.map((item) => (
                        <ApprovalCard
                            key={item.id}
                            id={item.id}
                            containerId={proposalAnchorId(item.id)}
                            highlighted={item.id === requestedProposalId}
                            title={item.proposalTitle}
                            description={`Recommendation ${item.recommendationId.slice(0, 8)}.`}
                            risk={resolveRisk(item.status)}
                            requester="Upgrade Planner"
                            impact={`STATUS: ${item.status.toUpperCase()} | UPDATED: ${new Date(item.createdAt).toLocaleString()}`}
                            disabled
                        />
                    ))}
                </div>
            ))}

        </main>
    );
}
