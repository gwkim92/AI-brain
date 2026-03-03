import React from "react";
import { User, Activity, Scale, ShieldAlert } from "lucide-react";

export type AgentRole = "Planner" | "Researcher" | "Critic" | "Risk" | "Synthesizer";

interface AgentArgumentCardProps {
    role: AgentRole;
    stance: "support" | "oppose" | "neutral" | "warning";
    argument: string;
    confidence: number;
}

export function AgentArgumentCard({ role, stance, argument, confidence }: AgentArgumentCardProps) {
    const getRoleIcon = () => {
        switch (role) {
            case "Planner": return <Activity size={16} />;
            case "Researcher": return <User size={16} />;
            case "Critic": return <Scale size={16} />;
            case "Risk": return <ShieldAlert size={16} className="text-amber-500" />;
            case "Synthesizer": return <Activity size={16} className="text-purple-400" />;
        }
    };

    const getStanceColor = () => {
        switch (stance) {
            case "support": return "text-emerald-400 border-emerald-500/30 bg-emerald-500/5";
            case "oppose": return "text-red-400 border-red-500/30 bg-red-500/5";
            case "neutral": return "text-cyan-400 border-cyan-500/30 bg-cyan-500/5";
            case "warning": return "text-amber-500 border-amber-500/30 bg-amber-500/5";
        }
    };

    return (
        <div className={`p-4 rounded-lg border glass-panel relative overflow-hidden ${getStanceColor()}`}>
            {/* Background Confidence Bar */}
            <div
                className="absolute bottom-0 left-0 h-0.5 bg-current opacity-20"
                style={{ width: `${confidence}%` }}
            ></div>

            <div className="flex justify-between items-start mb-3 border-b border-current/10 pb-2">
                <div className="flex items-center gap-2">
                    {getRoleIcon()}
                    <span className="font-mono font-bold tracking-widest text-xs uppercase">{role}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span className="opacity-60">CONFIDENCE</span>
                    <span className="font-bold">{confidence}%</span>
                </div>
            </div>

            <p className="text-sm text-white/80 leading-relaxed font-sans mt-2">
                &ldquo;{argument}&rdquo;
            </p>
        </div>
    );
}
