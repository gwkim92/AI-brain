"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MemoryItemRow } from "@/components/ui/MemoryItemRow";
import { Brain, Search, DatabaseBackup } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import { getMemorySnapshot } from "@/lib/api/endpoints";
import type { MemorySnapshotEntry } from "@/lib/api/types";

function formatRelative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffSec = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export default function MemoryPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [rows, setRows] = useState<MemorySnapshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
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
          setError("failed to load memory snapshot");
        }
        setRows([]);
        setGeneratedAt(null);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

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
    <main className="w-full h-full bg-black text-white p-8 flex flex-col">
      <header className="mb-8 border-l-2 border-white pl-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-widest text-white flex items-center gap-3">
            <Brain size={24} /> MEMORY MANAGER
          </h1>
          <p className="text-sm font-mono text-white/50 tracking-wide mt-1">MEMORY SNAPSHOT FROM BACKEND API</p>
        </div>

        <button className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-md text-xs font-mono font-bold transition-colors">
          <DatabaseBackup size={14} /> EXPORT KNOWLEDGE BASE
        </button>
      </header>

      <div className="flex items-center mb-6 relative w-full md:w-1/2">
        <Search size={16} className="absolute left-4 top-3 text-white/30" />
        <input
          type="text"
          placeholder="Search semantic memory..."
          className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-11 pr-4 text-sm font-mono text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all placeholder:text-white/20"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {generatedAt && (
        <div className="mb-4 text-xs font-mono text-white/40">
          Snapshot generated at {new Date(generatedAt).toLocaleString()}.
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-4 pb-8 space-y-3">
        {loading && <p className="text-sm font-mono text-white/40">Loading memory snapshot...</p>}
        {!loading && error && <p className="text-sm font-mono text-red-400">{error}</p>}
        {!loading && !error && filteredRows.length === 0 && (
          <p className="text-sm font-mono text-white/40">No memory rows matched your search.</p>
        )}

        {!loading && !error && filteredRows.map((row) => (
          <MemoryItemRow
            key={row.id}
            id={row.id}
            category={row.category}
            content={row.content}
            source={row.source}
            timestamp={formatRelative(row.timestamp)}
          />
        ))}
      </div>
    </main>
  );
}
