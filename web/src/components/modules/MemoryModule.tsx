"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Brain, Search } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { getMemorySnapshot } from "@/lib/api/endpoints";
import type { MemorySnapshotEntry } from "@/lib/api/types";
import { AsyncState } from "@/components/ui/AsyncState";
import { MemoryItemRow } from "@/components/ui/MemoryItemRow";

function formatRelative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffSec = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

const MEMORY_PAGE_SIZE = 20;

export function MemoryModule() {
  const [rows, setRows] = useState<MemorySnapshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [currentLimit, setCurrentLimit] = useState(MEMORY_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);

  const refresh = async (limit = MEMORY_PAGE_SIZE) => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getMemorySnapshot({ limit });
      setRows(snapshot.rows);
      setGeneratedAt(snapshot.generated_at);
      setHasMore(snapshot.rows.length >= limit);
      setCurrentLimit(limit);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to load memory");
      }
      setRows([]);
      setGeneratedAt(null);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    const nextLimit = currentLimit + MEMORY_PAGE_SIZE;
    setLoadingMore(true);
    try {
      const snapshot = await getMemorySnapshot({ limit: nextLimit });
      setRows(snapshot.rows);
      setGeneratedAt(snapshot.generated_at);
      setHasMore(snapshot.rows.length >= nextLimit);
      setCurrentLimit(nextLimit);
    } catch {
      // keep existing
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) => {
      return (
        row.content.toLowerCase().includes(keyword) ||
        row.source.toLowerCase().includes(keyword) ||
        row.category.toLowerCase().includes(keyword)
      );
    });
  }, [rows, search]);

  return (
    <main className="w-full h-full bg-transparent text-white p-4 flex flex-col">
      <header className="mb-4 border-l-2 border-white pl-3">
        <h2 className="text-sm font-mono font-bold tracking-widest text-white flex items-center gap-2">
          <Brain size={14} /> SEMANTIC MEMORY
        </h2>
      </header>

      <label className="relative mb-3">
        <Search size={14} className="absolute left-3 top-2.5 text-white/30" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search memory rows..."
          className="w-full bg-black/40 border border-white/10 rounded px-9 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500/40"
        />
      </label>

      {generatedAt && (
        <p className="mb-3 text-[10px] font-mono text-white/40">Generated: {new Date(generatedAt).toLocaleString()}</p>
      )}

      <AsyncState
        loading={loading}
        error={error}
        empty={!loading && !error && filtered.length === 0}
        emptyText="No memory rows found."
        loadingText="Loading memory..."
        onRetry={() => void refresh()}
        className="mb-3"
      />

      <div className="flex-1 overflow-y-auto pr-1 space-y-2">
        {!loading &&
          !error &&
          filtered.map((row) => (
            <MemoryItemRow
              key={row.id}
              id={row.id}
              category={row.category}
              content={row.content}
              source={row.source}
              timestamp={formatRelative(row.timestamp)}
            />
          ))}

        {!loading && !error && hasMore && filtered.length > 0 && (
          <button
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="w-full py-2 text-[11px] font-mono text-cyan-400 hover:text-cyan-200 border border-white/10 rounded hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        )}
      </div>
    </main>
  );
}
