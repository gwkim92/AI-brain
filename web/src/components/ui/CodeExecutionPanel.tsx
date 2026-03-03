import React from "react";
import { TerminalSquare, RefreshCw, AlertCircle } from "lucide-react";

interface CodeExecutionPanelProps {
    code: string;
    language: string;
    status: "idle" | "running" | "success" | "error";
    output?: string;
    executionTimeMs?: number;
}

export function CodeExecutionPanel({ code, language, status, output, executionTimeMs }: CodeExecutionPanelProps) {
    const isRunning = status === "running";

    return (
        <div className="rounded-lg border border-white/10 overflow-hidden bg-black/80 flex flex-col font-mono shadow-[0_4px_30px_rgba(0,0,0,0.5)]">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5 text-xs">
                <div className="flex items-center gap-2 text-white/50">
                    <TerminalSquare size={14} />
                    <span className="tracking-widest capitalize">{language} SANDBOX</span>
                </div>

                <div className="flex items-center gap-4">
                    {isRunning && (
                        <span className="flex items-center gap-2 text-cyan-400">
                            <RefreshCw size={12} className="animate-spin" /> EXECUTING
                        </span>
                    )}
                    {executionTimeMs && !isRunning && (
                        <span className="text-white/30">{executionTimeMs}ms</span>
                    )}
                </div>
            </div>

            {/* Code Editor Area (Readonly for MVP) */}
            <div className="p-4 overflow-x-auto text-[13px] leading-relaxed text-emerald-300">
                <pre><code>{code}</code></pre>
            </div>

            {/* Output Console */}
            {output && (
                <div className={`p-4 border-t text-[12px] break-words ${status === "error" ? "border-red-900/50 bg-red-950/20 text-red-400" : "border-white/5 bg-black text-white/70"}`}>
                    {status === "error" && (
                        <div className="flex items-center gap-2 mb-2 font-bold tracking-widest text-red-500 text-[10px]">
                            <AlertCircle size={12} />
                            RUNTIME ERROR
                        </div>
                    )}
                    <pre className="whitespace-pre-wrap">{output}</pre>
                </div>
            )}
        </div>
    );
}
