"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, History, Loader2, CheckCircle, XCircle } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  decideUpgradeProposal,
  listUpgradeProposals,
  listApprovals,
  decideApproval,
  streamDashboardOverviewEvents,
} from "@/lib/api/endpoints";
import type { UpgradeProposalRecord, UpgradeStatus, ApprovalRecord } from "@/lib/api/types";
import { AsyncState } from "@/components/ui/AsyncState";
import { ApprovalCard } from "@/components/ui/ApprovalCard";
import type { RiskLevel } from "@/components/ui/RiskPill";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";
import { useLocale } from "@/components/providers/LocaleProvider";

type Section = "upgrades" | "missions";
type SubTab = "pending" | "history";

function resolveUpgradeRisk(status: UpgradeStatus): RiskLevel {
  if (status === "proposed") return "high";
  if (status === "failed" || status === "rolled_back") return "critical";
  if (status === "approved" || status === "planning") return "medium";
  return "low";
}

export function ApprovalsModule() {
  const role = useCurrentRole();
  const { t, formatDateTime } = useLocale();
  const canOperate = hasMinRole(role, "operator");
  const [section, setSection] = useState<Section>("upgrades");
  const [subTab, setSubTab] = useState<SubTab>("pending");

  const [proposals, setProposals] = useState<UpgradeProposalRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const refreshUpgrades = async () => {
    const data = await listUpgradeProposals();
    setProposals(data.proposals);
  };

  const refreshApprovals = async () => {
    const data = await listApprovals({ limit: 100 });
    setApprovals(data.approvals);
  };

  const refresh = async () => {
    if (!canOperate) {
      setProposals([]);
      setApprovals([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (section === "upgrades") {
        await refreshUpgrades();
      } else {
        await refreshApprovals();
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("approvals.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canOperate) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOperate, section]);

  useEffect(() => {
    if (!canOperate) return;
    const stream = streamDashboardOverviewEvents(
      { poll_ms: 3000, timeout_ms: 60000 },
      { onUpdated: () => void refresh() }
    );
    return () => stream.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOperate, section]);

  const upgradePending = useMemo(() => proposals.filter((p) => p.status === "proposed"), [proposals]);
  const upgradeHistory = useMemo(() => proposals.filter((p) => p.status !== "proposed"), [proposals]);

  const missionPending = useMemo(() => approvals.filter((a) => a.status === "pending"), [approvals]);
  const missionHistory = useMemo(() => approvals.filter((a) => a.status !== "pending"), [approvals]);

  const decideUpgrade = async (proposalId: string, decision: "approve" | "reject") => {
    if (!canOperate) return;
    setSubmittingId(proposalId);
    setError(null);
    try {
      await decideUpgradeProposal(proposalId, { decision });
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(`${err.code}: ${err.message}`);
      else setError(t("approvals.submitFailed"));
    } finally {
      setSubmittingId(null);
    }
  };

  const decideMission = async (approvalId: string, decision: "approved" | "rejected") => {
    if (!canOperate) return;
    setSubmittingId(approvalId);
    setError(null);
    try {
      await decideApproval(approvalId, { decision });
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(`${err.code}: ${err.message}`);
      else setError(t("approvals.submitFailed"));
    } finally {
      setSubmittingId(null);
    }
  };

  const pendingCount = section === "upgrades" ? upgradePending.length : missionPending.length;

  return (
    <main className="w-full h-full bg-transparent text-white p-4 flex flex-col">
      <header className="mb-3 border-l-2 border-amber-500 pl-3">
        <h2 className="text-sm font-mono font-bold tracking-widest text-amber-400 flex items-center gap-2">
          <ShieldCheck size={14} /> {t("approvals.title")}
        </h2>
      </header>

      {!canOperate && (
        <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-mono text-amber-300">
            {t("approvals.operatorRequired")}
          </p>
        </div>
      )}

      {/* Section toggle */}
      {canOperate && <div className="flex gap-1 mb-3 bg-white/5 p-1 rounded border border-white/10 w-fit">
        <button
          onClick={() => { setSection("upgrades"); setSubTab("pending"); }}
          className={`px-2.5 py-1 text-[10px] font-mono rounded transition-colors ${section === "upgrades" ? "bg-amber-500/20 text-amber-300" : "text-white/50 hover:text-white/70"}`}
        >
          {t("approvals.section.upgrades")}
        </button>
        <button
          onClick={() => { setSection("missions"); setSubTab("pending"); }}
          className={`px-2.5 py-1 text-[10px] font-mono rounded transition-colors ${section === "missions" ? "bg-cyan-500/20 text-cyan-300" : "text-white/50 hover:text-white/70"}`}
        >
          {t("approvals.section.missions")}
        </button>
      </div>}

      {/* Sub-tab toggle */}
      {canOperate && <div className="flex bg-white/5 p-1 rounded border border-white/10 mb-3 w-fit">
        <button
          onClick={() => setSubTab("pending")}
          className={`px-2 py-1 text-[10px] font-mono rounded ${subTab === "pending" ? "bg-white/10 text-white" : "text-white/50"}`}
        >
          {t("approvals.tab.pending")} ({pendingCount})
        </button>
        <button
          onClick={() => setSubTab("history")}
          className={`px-2 py-1 text-[10px] font-mono rounded flex items-center gap-1 ${subTab === "history" ? "bg-white/10 text-white" : "text-white/50"}`}
        >
          {t("approvals.tab.history")} <History size={11} />
        </button>
      </div>}

      {canOperate && (
        <AsyncState
          loading={loading}
          error={error}
          empty={false}
          loadingText={t("approvals.loading")}
          onRetry={() => void refresh()}
          className="mb-3"
        />
      )}

      {canOperate && <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        {/* Upgrade cards */}
        {section === "upgrades" && subTab === "pending" && !loading && !error &&
          upgradePending.map((item) => (
            <ApprovalCard
              key={item.id}
              id={item.id}
              title={item.proposalTitle}
              description={t("approvals.upgrade.description", {
                proposalId: item.id.slice(0, 8),
                recommendationId: item.recommendationId.slice(0, 8),
              })}
              risk={resolveUpgradeRisk(item.status)}
              requester={t("approvals.upgrade.requester")}
              impact={t("approvals.impact.created", {
                status: item.status.toUpperCase(),
                date: formatDateTime(item.createdAt),
              })}
              onApprove={() => void decideUpgrade(item.id, "approve")}
              onReject={() => void decideUpgrade(item.id, "reject")}
              disabled={submittingId === item.id}
            />
          ))}

        {section === "upgrades" && subTab === "history" && !loading && !error &&
          upgradeHistory.map((item) => (
            <ApprovalCard
              key={item.id}
              id={item.id}
              title={item.proposalTitle}
              description={t("approvals.upgrade.historyDescription", {
                recommendationId: item.recommendationId.slice(0, 8),
              })}
              risk={resolveUpgradeRisk(item.status)}
              requester={t("approvals.upgrade.requester")}
              impact={t("approvals.impact.updated", {
                status: item.status.toUpperCase(),
                date: formatDateTime(item.createdAt),
              })}
              disabled
            />
          ))}

        {/* Mission approval cards */}
        {section === "missions" && subTab === "pending" && !loading && !error &&
          missionPending.map((item) => (
            <div key={item.id} className="border border-white/10 rounded-lg p-3 bg-black/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-cyan-300 font-medium">{item.action}</span>
                <span className="text-[10px] font-mono text-white/30">{item.id.slice(0, 8)}</span>
              </div>
              <p className="text-[11px] text-white/60">
                {item.entityType} &middot; {item.entityId.slice(0, 8)}
              </p>
              <p className="text-[10px] text-white/40">
                {t("approvals.mission.requestedBy", { user: item.requestedBy.slice(0, 8), date: formatDateTime(item.createdAt) })}
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => void decideMission(item.id, "approved")}
                  disabled={submittingId === item.id}
                  className="flex items-center gap-1 px-3 py-1 text-[10px] font-mono rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-50"
                >
                  <CheckCircle size={11} /> {t("actionCenter.approve")}
                </button>
                <button
                  onClick={() => void decideMission(item.id, "rejected")}
                  disabled={submittingId === item.id}
                  className="flex items-center gap-1 px-3 py-1 text-[10px] font-mono rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors disabled:opacity-50"
                >
                  <XCircle size={11} /> {t("actionCenter.reject")}
                </button>
              </div>
            </div>
          ))}

        {section === "missions" && subTab === "history" && !loading && !error &&
          missionHistory.map((item) => (
            <div key={item.id} className="border border-white/10 rounded-lg p-3 bg-black/20 opacity-70 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-white/60">{item.action}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${item.status === "approved" ? "bg-green-600/20 text-green-400" : item.status === "rejected" ? "bg-red-600/20 text-red-400" : "bg-white/10 text-white/50"}`}>
                  {item.status.toUpperCase()}
                </span>
              </div>
              <p className="text-[10px] text-white/40">
                {item.entityType} &middot; {item.entityId.slice(0, 8)} &middot; {formatDateTime(item.updatedAt)}
              </p>
              {item.reason && (
                <p className="text-[10px] text-white/30 italic">{item.reason}</p>
              )}
            </div>
          ))}

        {/* Empty states */}
        {!loading && !error && subTab === "pending" &&
          ((section === "upgrades" && upgradePending.length === 0) || (section === "missions" && missionPending.length === 0)) && (
          <div className="text-sm font-mono text-white/40 border border-white/10 rounded p-4">{t("approvals.mission.nonePending")}</div>
        )}

        {!loading && !error && subTab === "history" &&
          ((section === "upgrades" && upgradeHistory.length === 0) || (section === "missions" && missionHistory.length === 0)) && (
          <div className="text-sm font-mono text-white/40 border border-white/10 rounded p-4">{t("approvals.mission.noneHistory")}</div>
        )}
      </div>}

      {canOperate && submittingId && (
        <div className="mt-3 text-xs font-mono text-cyan-300 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" />
          {t("approvals.submitting")}
        </div>
      )}
    </main>
  );
}
