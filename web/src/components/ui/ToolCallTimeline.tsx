import React from "react";
import { Terminal, CheckCircle2, CircleDashed, AlertCircle } from "lucide-react";

export interface ToolCall {
    id: string;
    name: string;
    status: "pending" | "running" | "success" | "error";
    durationMs?: number;
    args?: string;
    resultExcerpt?: string;
}

export function ToolCallTimeline({ calls }: { calls: ToolCall[] }) {
    return (
        <div className="flex flex-col gap-0 border-l border-white/10 ml-3 pl-4 py-2 relative">
            <div className="absolute top-0 -left-6 bg-black p-1 rounded-full border border-white/20">
                <Terminal size={14} className="text-white/40" />
            </div>

            {calls.map((call) => {
                const isRunning = call.status === "running";
                const isSuccess = call.status === "success";
                const isError = call.status === "error";

                return (
                    <div key={call.id} className="relative mb-4 last:mb-0 group">
                        {/* Timeline Dot */}
                        <span className={`absolute -left-[21px] top-1.5 w-2 h-2 rounded-full border bg-black transition-colors
              ${isRunning ? "border-cyan-400 shadow-[0_0_8px_rgba(0,255,255,0.5)] animate-pulse" : ""}
              ${isSuccess ? "border-emerald-500" : ""}
              ${isError ? "border-red-500" : ""}
              ${call.status === "pending" ? "border-white/20" : ""}
            `}></span>

                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                                <span className={`font-mono text-xs font-bold tracking-widest ${isRunning ? 'text-cyan-400' : isError ? 'text-red-400' : 'text-white/70'}`}>
                                    {call.name}
                                </span>

                                {isRunning && <CircleDashed size={12} className="text-cyan-400 animate-spin" />}
                                {isSuccess && <CheckCircle2 size={12} className="text-emerald-500" />}
                                {isError && <AlertCircle size={12} className="text-red-500" />}
                            </div>

                            {call.durationMs && (
                                <span className="text-[10px] font-mono text-white/30">{call.durationMs}ms</span>
                            )}
                        </div>

                        {call.args && (
                            <div className="mt-1 text-[11px] font-mono text-white/40 truncate max-w-sm">
                                <span className="text-white/20">ARGS:</span> {call.args}
                            </div>
                        )}

                        {call.resultExcerpt && (
                            <div className="mt-2 p-2 bg-white/5 border border-white/10 text-[11px] font-mono text-white/60 rounded">
                                <span className="block text-white/20 text-[9px] mb-1">STDOUT/RESULT</span>
                                <span className="line-clamp-2">{call.resultExcerpt}</span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
