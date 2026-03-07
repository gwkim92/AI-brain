import React from "react";
import { Calculator } from "lucide-react";
import { useLocale } from "@/components/providers/LocaleProvider";

interface ComputeResultPanelProps {
    formula: string;
    result: string | number;
    confidence: number;
}

export function ComputeResultPanel({ formula, result, confidence }: ComputeResultPanelProps) {
    const { t } = useLocale();
    return (
        <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-5 font-mono shadow-[0_0_20px_rgba(245,158,11,0.05)]">

            <div className="flex items-center justify-between mb-4 border-b border-amber-500/10 pb-3">
                <div className="flex items-center gap-2 text-amber-500">
                    <Calculator size={16} />
                    <span className="text-xs font-bold tracking-widest">{t("workbench.compute.core")}</span>
                </div>
                <span className="text-[10px] text-amber-500/50">{t("workbench.compute.confidence")}: {confidence}%</span>
            </div>

            <div className="space-y-4">
                <div>
                    <span className="block text-[10px] text-white/30 tracking-widest mb-1.5">{t("workbench.compute.input")}</span>
                    <div className="bg-black/50 p-3 rounded text-amber-200/70 text-sm overflow-x-auto">
                        {formula}
                    </div>
                </div>

                <div>
                    <span className="block text-[10px] text-white/30 tracking-widest mb-1.5">{t("workbench.compute.result")}</span>
                    <div className="bg-black/80 border border-amber-500/30 p-4 rounded text-amber-400 text-2xl font-bold shadow-[inset_0_0_20px_rgba(245,158,11,0.1)]">
                        {result}
                    </div>
                </div>
            </div>

        </div>
    );
}
