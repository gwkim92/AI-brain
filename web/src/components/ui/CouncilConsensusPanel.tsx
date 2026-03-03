import React from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";

interface CouncilConsensusPanelProps {
    status: "Consensus Reached" | "Contradiction Detected" | "Escalated to Human";
    summary: string;
    rounds: number;
}

export function CouncilConsensusPanel({ status, summary, rounds }: CouncilConsensusPanelProps) {
    const isHealthy = status === "Consensus Reached";

    return (
        <div className={`p-6 rounded-lg border ${isHealthy
                ? "bg-purple-900/20 border-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.1)]"
                : "bg-red-900/20 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
            }`}>

            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    {isHealthy ? (
                        <CheckCircle2 className="text-purple-400" size={18} />
                    ) : (
                        <ShieldAlert className="text-red-400" size={18} />
                    )}
                    <h2 className={`font-mono font-bold tracking-widest text-sm ${isHealthy ? "text-purple-400" : "text-red-400"}`}>
                        {status.toUpperCase()}
                    </h2>
                </div>

                <span className="text-[10px] font-mono text-white/40">
                    AFTER {rounds} ROUNDS
                </span>
            </div>

            <p className="text-sm text-white/90 leading-relaxed">
                {summary}
            </p>

        </div>
    );
}
