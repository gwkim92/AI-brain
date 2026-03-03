import React from "react";

export type TaskStatus = "queued" | "running" | "blocked" | "retrying" | "done" | "failed" | "cancelled";

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
    const getStyles = () => {
        switch (status) {
            case "queued": return "text-white/40 border-white/20";
            case "running": return "text-cyan-400 border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_10px_rgba(0,255,255,0.2)]";
            case "blocked": return "text-amber-500 border-amber-500/50 bg-amber-500/10";
            case "retrying": return "text-purple-400 border-purple-500/50 bg-purple-500/10 animate-pulse";
            case "done": return "text-emerald-400 border-emerald-500/50 bg-emerald-500/10";
            case "failed": return "text-red-500 border-red-500/50 bg-red-500/10";
            case "cancelled": return "text-slate-400 border-slate-500/40 bg-slate-500/10";
            default: return "text-white/50 border-white/10";
        }
    };

    const getDotStyles = () => {
        switch (status) {
            case "running": return "bg-cyan-400 animate-ping";
            case "retrying": return "bg-purple-400 animate-spin";
            default: return "hidden";
        }
    };

    return (
        <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[10px] font-mono font-bold tracking-widest uppercase ${getStyles()}`}>
            {(status === "running" || status === "retrying") && (
                <span className="relative flex h-1.5 w-1.5">
                    <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${getDotStyles()}`}></span>
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${status === 'running' ? 'bg-cyan-500' : 'bg-purple-500'}`}></span>
                </span>
            )}
            {status}
        </div>
    );
}
