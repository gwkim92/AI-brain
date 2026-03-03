import React from "react";
import { BrainCircuit, Trash2, Edit3, Lock } from "lucide-react";

export type MemoryCategory = "preference" | "fact" | "rule";

interface MemoryItemRowProps {
    id: string;
    category: MemoryCategory;
    content: string;
    source: string;
    timestamp: string;
}

export function MemoryItemRow({ category, content, source, timestamp }: MemoryItemRowProps) {
    const getCategoryTheme = () => {
        switch (category) {
            case "preference": return "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
            case "fact": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
            case "rule": return "text-amber-500 bg-amber-500/10 border-amber-500/20";
        }
    };

    return (
        <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-lg hover:border-white/20 transition-colors group">

            <div className="flex flex-col gap-2 flex-1">
                <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold tracking-widest uppercase border ${getCategoryTheme()}`}>
                        {category}
                    </span>
                    <span className="text-[10px] font-mono text-white/30 flex items-center gap-1">
                        <BrainCircuit size={10} /> {source}
                    </span>
                    <span className="text-[10px] font-mono text-white/30">{timestamp}</span>
                </div>
                <p className="text-sm text-white/80 pr-8">{content}</p>
            </div>

            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-2 text-white/40 hover:text-cyan-400 hover:bg-cyan-500/10 rounded transition-colors">
                    <Edit3 size={14} />
                </button>
                <button className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors">
                    <Trash2 size={14} />
                </button>
                <button className="p-2 text-white/40 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-colors">
                    <Lock size={14} />
                </button>
            </div>

        </div>
    );
}
