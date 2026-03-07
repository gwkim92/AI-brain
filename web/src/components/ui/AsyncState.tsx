"use client";

import React from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useLocale } from "@/components/providers/LocaleProvider";

type AsyncStateProps = {
  loading: boolean;
  error: string | null;
  empty: boolean;
  loadingText?: string;
  emptyText?: string;
  onRetry?: () => void;
  className?: string;
};

export function AsyncState({
  loading,
  error,
  empty,
  loadingText,
  emptyText,
  onRetry,
  className = "",
}: AsyncStateProps) {
  const { t } = useLocale();
  const resolvedLoadingText = loadingText ?? t("common.loading");
  const resolvedEmptyText = emptyText ?? t("common.noData");

  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-sm font-mono text-white/50 ${className}`}>
        <Loader2 size={14} className="animate-spin" />
        {resolvedLoadingText}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <div className="flex items-start gap-2 text-sm font-mono text-red-400">
          <AlertTriangle size={14} className="mt-0.5" />
          <span>{error}</span>
        </div>
        {onRetry && (
          <button
            className="inline-flex w-fit items-center gap-2 px-3 py-1.5 text-xs font-mono text-cyan-300 border border-cyan-500/40 rounded hover:text-cyan-100"
            onClick={onRetry}
          >
            <RefreshCw size={12} /> {t("common.retry")}
          </button>
        )}
      </div>
    );
  }

  if (empty) {
    return <div className={`text-sm font-mono text-white/40 ${className}`}>{resolvedEmptyText}</div>;
  }

  return null;
}
