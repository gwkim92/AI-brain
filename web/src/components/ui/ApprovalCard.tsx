"use client";

import React from "react";
import { RiskPill, RiskLevel } from "./RiskPill";
import { ShieldAlert, Check, X } from "lucide-react";
import { useLocale } from "@/components/providers/LocaleProvider";

interface ApprovalCardProps {
    id: string;
    title: string;
    description: string;
    risk: RiskLevel;
    requester: string;
    impact: string;
    onApprove?: () => void;
    onReject?: () => void;
    disabled?: boolean;
    highlighted?: boolean;
    containerId?: string;
}

export function ApprovalCard({
    title,
    description,
    risk,
    requester,
    impact,
    onApprove,
    onReject,
    disabled = false,
    highlighted = false,
    containerId,
}: ApprovalCardProps) {
    const { t } = useLocale();
    const isHighRisk = risk === "high" || risk === "critical";

    return (
        <div
            id={containerId}
            className={`w-full glass-panel rounded-lg p-5 border-l-4 transition-all ${isHighRisk ? 'border-l-red-500' : 'border-l-amber-500'} ${highlighted ? 'ring-2 ring-cyan-400/80 shadow-[0_0_25px_rgba(34,211,238,0.25)]' : ''}`}
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    {isHighRisk ? <ShieldAlert className="text-red-500" size={20} /> : <ShieldAlert className="text-amber-500" size={20} />}
                    <h3 className="text-sm font-bold tracking-wide text-white/90">{title}</h3>
                </div>
                <RiskPill level={risk} />
            </div>

            <div className="space-y-3 mb-6">
                <p className="text-sm text-white/70">{description}</p>

                <div className="grid grid-cols-2 gap-4 bg-black/40 p-3 rounded border border-white/5 font-mono text-[11px] text-white/50">
                    <div>
                        <span className="block text-white/30 tracking-widest mb-1">{t("approvalCard.callerTarget")}</span>
                        <span className="text-cyan-400">{requester}</span>
                    </div>
                    <div>
                        <span className="block text-white/30 tracking-widest mb-1">{t("approvalCard.impactScope")}</span>
                        <span className={isHighRisk ? "text-red-400" : "text-amber-400"}>{impact}</span>
                    </div>
                </div>
            </div>

            <div className="flex gap-3">
                <button
                    onClick={onApprove}
                    disabled={disabled}
                    className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono text-xs font-bold tracking-widest py-2 rounded transition-colors flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Check size={14} /> {t("approvalCard.authorize")}
                </button>
                <button
                    onClick={onReject}
                    disabled={disabled}
                    className="flex-1 bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-400 border border-white/10 hover:border-red-500/30 font-mono text-xs font-bold tracking-widest py-2 rounded transition-colors flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <X size={14} /> {t("approvalCard.reject")}
                </button>
            </div>
        </div>
    );
}
