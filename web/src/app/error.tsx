"use client";

import { useEffect } from "react";
import { useLocale } from "@/components/providers/LocaleProvider";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black/90 text-white">
      <div className="text-center max-w-md space-y-4 p-8">
        <div className="text-5xl mb-4 text-red-400">⚠</div>
        <h2 className="text-xl font-semibold">{t("globalError.title")}</h2>
        <p className="text-sm text-white/60">
          {error.message || t("globalError.defaultMessage")}
        </p>
        <button
          onClick={reset}
          className="px-6 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors"
        >
          {t("globalError.retry")}
        </button>
      </div>
    </div>
  );
}
