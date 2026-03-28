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
        if (status === "healthy") return "bg-emerald-50 border-emerald-200";
        if (status === "degraded") return "bg-amber-50 border-amber-200";
        return "bg-rose-50 border-rose-200";
    };

    return (
        <div className={`flex flex-col rounded-2xl border p-5 shadow-sm ${getStatusBg()}`}>

            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className={`rounded-full border border-black/10 bg-white p-2 ${getStatusColor()}`}>
                        {isError ? <XCircle size={18} /> : <PlugZap size={18} />}
                    </div>
                    <h3 className="font-bold tracking-wide text-neutral-900">{name}</h3>
                </div>

                <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${getStatusColor()} ${isHealthy ? 'shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'animate-pulse'}`}></span>
                    <span className={`text-[10px] font-mono font-bold tracking-widest uppercase ${getStatusColor()}`}>
                        {status}
                    </span>
                </div>
            </div>

            <p className="mb-4 h-8 text-xs text-neutral-600">{description}</p>

            <div className="mt-auto flex items-end justify-between border-t border-black/5 pt-3 text-[10px] font-mono">
                <div className="flex items-center gap-1.5 text-neutral-500">
                    <Activity size={12} />
                    {latencyMs}ms P95
                </div>
                <div className="flex items-center gap-1.5 text-neutral-500">
                    <RefreshCw size={12} />
                    {lastSync}
                </div>
            </div>
        </div>
    );
}
