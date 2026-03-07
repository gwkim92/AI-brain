"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/providers/LocaleProvider";
import type { TranslationKey } from "@/lib/locale";

type ToastTone = "success" | "info" | "error";

type ToastRecord = {
  id: string;
  title: string;
  message?: string;
  tone: ToastTone;
};

type ToastContextValue = {
  pushToast: (toast: {
    title: string;
    message?: string;
    tone?: ToastTone;
    durationMs?: number;
  }) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

function toneClass(tone: ToastTone): string {
  if (tone === "success") {
    return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  }
  if (tone === "error") {
    return "border-rose-400/35 bg-rose-500/10 text-rose-100";
  }
  return "border-cyan-400/35 bg-cyan-500/10 text-cyan-100";
}

function toneLabel(tone: ToastTone, t: (key: TranslationKey) => string): string {
  if (tone === "success") {
    return t("common.success");
  }
  if (tone === "error") {
    return t("common.error");
  }
  return t("common.info");
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (typeof timer === "number") {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    ({
      title,
      message,
      tone = "info",
      durationMs = 4200,
    }: {
      title: string;
      message?: string;
      tone?: ToastTone;
      durationMs?: number;
    }) => {
      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      setToasts((current) => [{ id, title, message, tone }, ...current].slice(0, 4));
      const timer = window.setTimeout(() => {
        removeToast(id);
      }, durationMs);
      timersRef.current.set(id, timer);
    },
    [removeToast]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      pushToast,
    }),
    [pushToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-5 top-5 z-[120] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl ${toneClass(
              toast.tone
            )}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-mono uppercase tracking-[0.28em] text-white/55">{toneLabel(toast.tone, t)}</p>
                <p className="mt-1 text-sm font-semibold text-white">{toast.title}</p>
                {toast.message ? <p className="mt-1 text-xs leading-5 text-white/75">{toast.message}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.24em] text-white/55 hover:text-white"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
