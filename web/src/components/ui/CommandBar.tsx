"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { useQuickCommand } from "@/hooks/useQuickCommand";
import {
  isRuntimeDebugEnabled,
  JARVIS_RUNTIME_DEBUG_CHANGED_EVENT,
  setRuntimeDebugEnabled,
} from "@/lib/runtime-events";
import { subscribeSessionRerun } from "@/lib/hud/session-rerun";

export function CommandBar() {
  const { commandInput, setCommandInput, isSubmitting, error, execute } = useQuickCommand();
  const [runtimeDebugEnabled, setRuntimeDebugEnabledState] = useState(false);
  const showDebugToggle = process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (!showDebugToggle || typeof window === "undefined") {
      return;
    }
    const sync = () => {
      setRuntimeDebugEnabledState(isRuntimeDebugEnabled());
    };
    sync();
    window.addEventListener(JARVIS_RUNTIME_DEBUG_CHANGED_EVENT, sync as EventListener);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(JARVIS_RUNTIME_DEBUG_CHANGED_EVENT, sync as EventListener);
      window.removeEventListener("storage", sync);
    };
  }, [showDebugToggle]);

  useEffect(() => {
    return subscribeSessionRerun((payload) => {
      if (!payload.prompt || payload.prompt.trim().length === 0) {
        return;
      }
      setCommandInput(payload.prompt);
      void execute(payload.prompt);
    });
  }, [execute, setCommandInput]);

  const handleExecute = useCallback(() => {
    void execute();
  }, [execute]);

  const toggleRuntimeDebug = useCallback(() => {
    setRuntimeDebugEnabled(!runtimeDebugEnabled);
  }, [runtimeDebugEnabled]);

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
              handleExecute();
            }
          }}
        />
        {showDebugToggle && (
          <button
            type="button"
            className={`text-[10px] font-mono font-bold tracking-widest border px-2 py-1 rounded transition-colors ${
              runtimeDebugEnabled
                ? "text-amber-200 border-amber-400/50 bg-amber-500/15 hover:bg-amber-500/25"
                : "text-white/55 border-white/20 bg-white/5 hover:bg-white/10"
            }`}
            onClick={toggleRuntimeDebug}
            aria-label="Toggle runtime debug events"
          >
            TRACE {runtimeDebugEnabled ? "ON" : "OFF"}
          </button>
        )}
        <button
          className="text-[10px] font-mono font-bold tracking-widest text-cyan-400 border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 rounded hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          onClick={handleExecute}
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
