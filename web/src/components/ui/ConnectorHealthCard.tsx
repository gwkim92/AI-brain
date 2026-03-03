import React from "react";
import { Activity, PlugZap, RefreshCw, XCircle } from "lucide-react";

type HealthStatus = "healthy" | "degraded" | "error";

interface ConnectorHealthCardProps {
    name: string;
    status: HealthStatus;
    latencyMs: number;
    lastSync: string;
    description: string;
}

export function ConnectorHealthCard({ name, status, latencyMs, lastSync, description }: ConnectorHealthCardProps) {
    const isHealthy = status === "healthy";
    const isError = status === "error";

    const getStatusColor = () => {
        if (status === "healthy") return "text-emerald-500";
        if (status === "degraded") return "text-amber-500";
        return "text-red-500";
    };

    const getStatusBg = () => {
        if (status === "healthy") return "bg-emerald-500/10 border-emerald-500/20";
        if (status === "degraded") return "bg-amber-500/10 border-amber-500/20";
        return "bg-red-500/10 border-red-500/20";
    };

    return (
        <div className={`p-5 rounded-lg border glass-panel flex flex-col ${getStatusBg()}`}>

            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full bg-black/50 border border-white/10 ${getStatusColor()}`}>
                        {isError ? <XCircle size={18} /> : <PlugZap size={18} />}
                    </div>
                    <h3 className="font-bold tracking-wide text-white/90">{name}</h3>
                </div>

                <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${getStatusColor()} ${isHealthy ? 'shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'animate-pulse'}`}></span>
                    <span className={`text-[10px] font-mono font-bold tracking-widest uppercase ${getStatusColor()}`}>
                        {status}
                    </span>
                </div>
            </div>

            <p className="text-xs text-white/60 mb-4 h-8">{description}</p>

            <div className="flex justify-between items-end mt-auto text-[10px] font-mono border-t border-white/5 pt-3">
                <div className="flex items-center gap-1.5 text-white/40">
                    <Activity size={12} />
                    {latencyMs}ms P95
                </div>
                <div className="flex items-center gap-1.5 text-white/40">
                    <RefreshCw size={12} />
                    {lastSync}
                </div>
            </div>
        </div>
    );
}
