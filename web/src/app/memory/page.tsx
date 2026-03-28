"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MemoryItemRow } from "@/components/ui/MemoryItemRow";
import { Brain, Search, DatabaseBackup } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { getMemorySnapshot } from "@/lib/api/endpoints";
import type { MemorySnapshotEntry } from "@/lib/api/types";
import { useLocale } from "@/components/providers/LocaleProvider";

function formatRelative(
  value: string,
  t: (key: "tasks.relative.justNow" | "tasks.relative.minutesAgo" | "tasks.relative.hoursAgo" | "tasks.relative.daysAgo", values?: Record<string, string | number>) => string
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffSec = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return t("tasks.relative.justNow");
  if (diffSec < 3600) return t("tasks.relative.minutesAgo", { value: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("tasks.relative.hoursAgo", { value: Math.floor(diffSec / 3600) });
  return t("tasks.relative.daysAgo", { value: Math.floor(diffSec / 86400) });
}

export default function MemoryPage() {
  const { t, formatDateTime } = useLocale();
  const [searchTerm, setSearchTerm] = useState("");
  const [rows, setRows] = useState<MemorySnapshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const snapshot = await getMemorySnapshot({ limit: 50 });
      setRows(snapshot.rows);
      setGeneratedAt(snapshot.generated_at);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("memory.loadFailedPage"));
      }
      setRows([]);
      setGeneratedAt(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) => {
      return (
        row.content.toLowerCase().includes(keyword) ||
        row.source.toLowerCase().includes(keyword) ||
        row.category.toLowerCase().includes(keyword)
      );
    });
  }, [rows, searchTerm]);

  return (
    <main className="rounded-[32px] border border-black/10 bg-[#fffdf8] text-neutral-950 p-8 flex flex-col shadow-sm">
      <header className="mb-8 border-l-2 border-neutral-950 pl-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-widest text-neutral-950 flex items-center gap-3">
            <Brain size={24} /> {t("memory.pageTitle")}
          </h1>
          <p className="text-sm font-mono text-neutral-500 tracking-wide mt-1">{t("memory.pageSubtitle")}</p>
        </div>

        <button className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-neutral-100 border border-black/10 rounded-md text-xs font-mono font-bold transition-colors">
          <DatabaseBackup size={14} /> {t("memory.export")}
        </button>
      </header>

      <div className="flex items-center mb-6 relative w-full md:w-1/2">
        <Search size={16} className="absolute left-4 top-3 text-neutral-400" />
        <input
          type="text"
          placeholder={t("memory.searchPlaceholderPage")}
          className="w-full bg-white border border-black/10 rounded-lg py-2.5 pl-11 pr-4 text-sm font-mono text-neutral-950 focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950/20 transition-all placeholder:text-neutral-400"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {generatedAt && (
        <div className="mb-4 text-xs font-mono text-neutral-500">
          {t("memory.generatedPage", { date: formatDateTime(generatedAt) })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-4 pb-8 space-y-3">
        {loading && <p className="text-sm font-mono text-neutral-500">{t("memory.loadingPage")}</p>}
        {!loading && error && <p className="text-sm font-mono text-red-400">{error}</p>}
        {!loading && !error && filteredRows.length === 0 && (
          <p className="text-sm font-mono text-neutral-500">{t("memory.emptyPage")}</p>
        )}

        {!loading && !error && filteredRows.map((row) => (
          <MemoryItemRow
            key={row.id}
            id={row.id}
            category={row.category}
            content={row.content}
            source={row.source}
            timestamp={formatRelative(row.timestamp, t)}
          />
        ))}
      </div>
    </main>
  );
}
