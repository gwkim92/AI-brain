"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { useQuickCommand } from "@/hooks/useQuickCommand";
import { useLocale } from "@/components/providers/LocaleProvider";
import {
  isRuntimeDebugEnabled,
  JARVIS_RUNTIME_DEBUG_CHANGED_EVENT,
  setRuntimeDebugEnabled,
} from "@/lib/runtime-events";
import { subscribeSessionRerun } from "@/lib/hud/session-rerun";

export function CommandBar() {
  const { t } = useLocale();
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
    <div className="w-full px-2.5 py-1 pointer-events-auto">
      <div className="mx-auto flex max-w-xl items-center gap-2 rounded-lg border border-cyan-400/35 bg-black/65 px-2.5 py-1.5 shadow-[0_0_24px_rgba(6,182,212,0.12)] backdrop-blur-xl">
        <Zap size={14} className="shrink-0 text-cyan-300" />
        <input
          type="text"
          placeholder={t("commandBar.placeholder")}
          className="flex-1 bg-transparent font-mono text-[13px] text-cyan-50 focus:outline-none placeholder:text-white/45"
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
            className={`text-[9px] font-mono font-bold tracking-widest border px-2 py-1 rounded transition-colors ${
              runtimeDebugEnabled
                ? "text-amber-200 border-amber-400/50 bg-amber-500/15 hover:bg-amber-500/25"
                : "border-white/25 bg-white/10 text-white/80 hover:bg-white/15"
            }`}
            onClick={toggleRuntimeDebug}
            aria-label={t("commandBar.toggleDebug")}
          >
            {runtimeDebugEnabled ? t("commandBar.traceOn") : t("commandBar.traceOff")}
          </button>
        )}
        <button
          className="text-[9px] font-mono font-bold tracking-widest text-cyan-400 border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 rounded hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          onClick={handleExecute}
          disabled={isSubmitting || !commandInput.trim()}
        >
          {isSubmitting && <Loader2 size={10} className="animate-spin" />}
          {t("commandBar.execute").toUpperCase()}
        </button>
      </div>
      {error && (
        <p className="text-center text-[10px] font-mono text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
