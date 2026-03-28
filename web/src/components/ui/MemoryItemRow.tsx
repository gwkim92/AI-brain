"use client";

import React from "react";
import { BrainCircuit, Trash2, Edit3, Lock } from "lucide-react";
import { useLocale } from "@/components/providers/LocaleProvider";

export type MemoryCategory = "preference" | "fact" | "rule";

interface MemoryItemRowProps {
    id: string;
    category: MemoryCategory;
    content: string;
    source: string;
    timestamp: string;
}

export function MemoryItemRow({ category, content, source, timestamp }: MemoryItemRowProps) {
    const { t } = useLocale();
    const getCategoryTheme = () => {
        switch (category) {
            case "preference": return "text-cyan-800 bg-cyan-50 border-cyan-200";
            case "fact": return "text-emerald-800 bg-emerald-50 border-emerald-200";
            case "rule": return "text-amber-800 bg-amber-50 border-amber-200";
        }
    };

    return (
        <div className="group flex items-center justify-between rounded-2xl border border-black/10 bg-[#fffdf8] p-4 shadow-sm transition-colors hover:border-black/20 hover:bg-white">

            <div className="flex flex-col gap-2 flex-1">
                <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold tracking-widest uppercase border ${getCategoryTheme()}`}>
                        {t(`memory.category.${category}`)}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-mono text-neutral-500">
                        <BrainCircuit size={10} /> {source}
                    </span>
                    <span className="text-[10px] font-mono text-neutral-500">{timestamp}</span>
                </div>
                <p className="pr-8 text-sm leading-6 text-neutral-800">{content}</p>
            </div>

            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="rounded-xl p-2 text-neutral-400 transition-colors hover:bg-cyan-50 hover:text-cyan-700">
                    <Edit3 size={14} />
                </button>
                <button className="rounded-xl p-2 text-neutral-400 transition-colors hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 size={14} />
                </button>
                <button className="rounded-xl p-2 text-neutral-400 transition-colors hover:bg-amber-50 hover:text-amber-700">
                    <Lock size={14} />
                </button>
            </div>

        </div>
    );
}
