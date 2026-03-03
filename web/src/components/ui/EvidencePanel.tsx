import React from "react";
import { Link2, FileText, Database, ShieldAlert } from "lucide-react";
import type { AssistantRenderMode } from "@/lib/api/types";

export interface Evidence {
    type: "link" | "document" | "query" | "security";
    label: string;
    source: string;
    reproducibilityScore?: number;
}

export function EvidencePanel({
    items,
    mode = "debug_mode",
}: {
    items: Evidence[];
    mode?: AssistantRenderMode;
}) {
    if (!items || items.length === 0) return null;
    const isDebug = mode === "debug_mode";

    return (
        <div className="bg-black/30 border border-white/10 rounded-lg p-4">
            <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-white/40 mb-3 border-b border-white/5 pb-2">
                {isDebug ? "GROUNDING EVIDENCE" : "CITED SOURCES"}
            </h4>

            <div className={`gap-3 ${isDebug ? "grid grid-cols-2" : "grid grid-cols-1"}`}>
                {items.map((item, i) => (
                    <div key={i} className="flex items-start gap-3 p-2 rounded hover:bg-white/5 transition-colors group cursor-default">

                        <div className="mt-0.5 p-1 rounded bg-white/5 text-white/50 group-hover:text-cyan-400 transition-colors">
                            {item.type === "link" && <Link2 size={12} />}
                            {item.type === "document" && <FileText size={12} />}
                            {item.type === "query" && <Database size={12} />}
                            {item.type === "security" && <ShieldAlert size={12} className="text-amber-500" />}
                        </div>

                        <div className="flex-1 overflow-hidden">
                            <p className="text-xs font-bold text-white/80 truncate">{item.label}</p>
                            <p className="text-[10px] font-mono text-white/40 truncate">{item.source}</p>
                        </div>

                        {isDebug && item.reproducibilityScore && (
                            <div className="shrink-0 flex items-center justify-center p-1 px-2 rounded-sm bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-mono text-[9px]">
                                {item.reproducibilityScore}% REPRO
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
