"use client";

import React from "react";
import { Loader2, Zap } from "lucide-react";
import { useQuickCommand } from "@/hooks/useQuickCommand";

export function CommandBar() {
  const { commandInput, setCommandInput, isSubmitting, error, execute } = useQuickCommand();

  return (
    <div className="w-full px-4 py-2 pointer-events-auto">
      <div className="max-w-3xl mx-auto flex items-center gap-3 rounded-lg border border-cyan-500/25 bg-black/50 backdrop-blur-xl px-4 py-1.5 shadow-[0_0_20px_rgba(0,255,255,0.06)]">
        <Zap size={14} className="text-cyan-500/60 shrink-0" />
        <input
          type="text"
          placeholder="Ask JARVIS anything..."
          className="flex-1 bg-transparent text-sm text-cyan-50 focus:outline-none font-mono placeholder:text-white/25"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void execute();
            }
          }}
        />
        <button
          className="text-[10px] font-mono font-bold tracking-widest text-cyan-400 border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 rounded hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          onClick={() => void execute()}
          disabled={isSubmitting || !commandInput.trim()}
        >
          {isSubmitting && <Loader2 size={10} className="animate-spin" />}
          EXEC
        </button>
      </div>
      {error && (
        <p className="text-center text-[10px] font-mono text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
