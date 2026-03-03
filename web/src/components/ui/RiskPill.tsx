import React from "react";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export function RiskPill({ level }: { level: RiskLevel }) {
    const getRiskStyles = () => {
        switch (level) {
            case "low": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
            case "medium": return "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
            case "high": return "text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.2)]";
            case "critical": return "text-red-500 bg-red-500/10 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.4)] animate-pulse";
            default: return "text-white/50 bg-white/5 border-white/10";
        }
    };

    return (
        <div className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[10px] font-mono font-bold tracking-widest uppercase ${getRiskStyles()}`}>
            {level} RISK
        </div>
    );
}
