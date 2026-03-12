"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Brain, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  createMemoryNote,
  deleteMemoryNote,
  getMemoryContext,
  getMemorySnapshot,
  getMemorySummary,
  getRecentDecisionMemory,
  updateMemoryNote,
} from "@/lib/api/endpoints";
import type { MemoryContextData, MemoryNoteKind, MemoryNoteRecord, MemorySnapshotEntry, MemorySummaryData, ProviderName } from "@/lib/api/types";
import { AsyncState } from "@/components/ui/AsyncState";
import { MemoryItemRow } from "@/components/ui/MemoryItemRow";
import { useLocale } from "@/components/providers/LocaleProvider";
import { useToast } from "@/components/providers/ToastProvider";

const MEMORY_PAGE_SIZE = 20;
const MEMORY_KIND_OPTIONS: MemoryNoteKind[] = ["project_context", "user_preference", "decision_memory", "research_memory"];
type MemoryPreferenceDraft = {
  responseStyle: "" | "concise" | "balanced" | "detailed";
  preferredProvider: "" | ProviderName | "local";
  preferredModel: string;
  riskTolerance: "" | "cautious" | "balanced" | "aggressive";
  approvalStyle: "" | "read_only_review" | "approval_required_write" | "safe_auto_run_preferred";
  monitoringPreference: "" | "manual" | "important_changes" | "all_changes";
  projectName: string;
  repoSlug: string;
  goalSummary: string;
  pinnedRefs: string;
};

type TranslateFn = ReturnType<typeof useLocale>["t"];

function describeResponseStyle(t: TranslateFn, value: MemoryPreferenceDraft["responseStyle"]): string {
  if (value === "concise") return t("memory.preferences.responseStyle.concise");
  if (value === "balanced") return t("memory.preferences.responseStyle.balanced");
  if (value === "detailed") return t("memory.preferences.responseStyle.detailed");
  return t("memory.preferences.defaultOption");
}

function describeProvider(t: TranslateFn, value: MemoryPreferenceDraft["preferredProvider"]): string {
  if (value === "openai") return t("memory.preferences.provider.openai");
  if (value === "gemini") return t("memory.preferences.provider.gemini");
  if (value === "anthropic") return t("memory.preferences.provider.anthropic");
  if (value === "local") return t("memory.preferences.provider.local");
  return t("memory.preferences.defaultOption");
}

function describeRiskTolerance(t: TranslateFn, value: MemoryPreferenceDraft["riskTolerance"]): string {
  if (value === "cautious") return t("memory.preferences.riskTolerance.cautious");
  if (value === "balanced") return t("memory.preferences.riskTolerance.balanced");
  if (value === "aggressive") return t("memory.preferences.riskTolerance.aggressive");
  return t("memory.preferences.defaultOption");
}

function describeApprovalStyle(t: TranslateFn, value: MemoryPreferenceDraft["approvalStyle"]): string {
  if (value === "read_only_review") return t("memory.preferences.approvalStyle.read_only_review");
  if (value === "approval_required_write") return t("memory.preferences.approvalStyle.approval_required_write");
  if (value === "safe_auto_run_preferred") return t("memory.preferences.approvalStyle.safe_auto_run_preferred");
  return t("memory.preferences.defaultOption");
}

function describeMonitoringPreference(t: TranslateFn, value: MemoryPreferenceDraft["monitoringPreference"]): string {
  if (value === "manual") return t("memory.preferences.monitoringPreference.manual");
  if (value === "important_changes") return t("memory.preferences.monitoringPreference.important_changes");
  if (value === "all_changes") return t("memory.preferences.monitoringPreference.all_changes");
  return t("memory.preferences.defaultOption");
}

const EMPTY_PREFERENCE_DRAFT: MemoryPreferenceDraft = {
  responseStyle: "",
  preferredProvider: "",
  preferredModel: "",
  riskTolerance: "",
  approvalStyle: "",
  monitoringPreference: "",
  projectName: "",
  repoSlug: "",
  goalSummary: "",
  pinnedRefs: "",
};

function splitCommaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildStructuredMemoryTitle(
  t: TranslateFn,
  key:
    | "response_style"
    | "preferred_provider"
    | "preferred_model"
    | "risk_tolerance"
    | "approval_style"
    | "monitoring_preference"
    | "project_context",
  draft: MemoryPreferenceDraft
): string {
  if (key === "response_style") return t("memory.preferences.noteTitle.responseStyle");
  if (key === "preferred_provider") return t("memory.preferences.noteTitle.preferredProvider");
  if (key === "preferred_model") return t("memory.preferences.noteTitle.preferredModel");
  if (key === "risk_tolerance") return t("memory.preferences.noteTitle.riskTolerance");
  if (key === "approval_style") return t("memory.preferences.noteTitle.approvalStyle");
  if (key === "monitoring_preference") return t("memory.preferences.noteTitle.monitoringPreference");
  return (
    draft.projectName.trim() ||
    draft.repoSlug.trim() ||
    t("memory.preferences.noteTitle.projectContext")
  );
}

function buildStructuredMemoryContent(
  t: TranslateFn,
  key:
    | "response_style"
    | "preferred_provider"
    | "preferred_model"
    | "risk_tolerance"
    | "approval_style"
    | "monitoring_preference"
    | "project_context",
  draft: MemoryPreferenceDraft
): string {
  if (key === "response_style") {
    return `${t("memory.preferences.responseStyle")}: ${describeResponseStyle(t, draft.responseStyle)}`;
  }
  if (key === "preferred_provider") {
    return `${t("memory.preferences.preferredProvider")}: ${describeProvider(t, draft.preferredProvider)}`;
  }
  if (key === "preferred_model") {
    return `${t("memory.preferences.preferredModel")}: ${draft.preferredModel.trim()}`;
  }
  if (key === "risk_tolerance") {
    return `${t("memory.preferences.riskTolerance")}: ${describeRiskTolerance(t, draft.riskTolerance)}`;
  }
  if (key === "approval_style") {
    return `${t("memory.preferences.approvalStyle")}: ${describeApprovalStyle(t, draft.approvalStyle)}`;
  }
  if (key === "monitoring_preference") {
    return `${t("memory.preferences.monitoringPreference")}: ${describeMonitoringPreference(t, draft.monitoringPreference)}`;
  }

  const lines = [
    `${t("memory.preferences.projectName")}: ${draft.projectName.trim() || "-"}`,
    `${t("memory.preferences.repoSlug")}: ${draft.repoSlug.trim() || "-"}`,
    `${t("memory.preferences.goalSummary")}: ${draft.goalSummary.trim() || "-"}`,
  ];
  const refs = splitCommaList(draft.pinnedRefs);
  if (refs.length > 0) {
    lines.push(`${t("memory.preferences.pinnedRefs")}: ${refs.join(", ")}`);
  }
  return lines.join("\n");
}

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

function describeMemoryNoteKind(
  t: (
    key:
      | "memory.noteKind.user_preference"
      | "memory.noteKind.project_context"
      | "memory.noteKind.decision_memory"
      | "memory.noteKind.research_memory"
  ) => string,
  kind: MemoryNoteKind
): string {
  if (kind === "user_preference") return t("memory.noteKind.user_preference");
  if (kind === "project_context") return t("memory.noteKind.project_context");
  if (kind === "decision_memory") return t("memory.noteKind.decision_memory");
  return t("memory.noteKind.research_memory");
}

function noteKindTheme(kind: MemoryNoteKind): string {
  if (kind === "project_context") return "border-cyan-400/25 bg-cyan-500/10 text-cyan-100";
  if (kind === "user_preference") return "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
  if (kind === "decision_memory") return "border-amber-400/25 bg-amber-500/10 text-amber-100";
  return "border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-100";
}

function dedupeNotes(...groups: MemoryNoteRecord[][]): MemoryNoteRecord[] {
  const merged = new Map<string, MemoryNoteRecord>();
  for (const group of groups) {
    for (const note of group) {
      merged.set(note.id, note);
    }
  }
  return [...merged.values()].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

export function MemoryModule() {
  const { t, formatDateTime } = useLocale();
  const { pushToast } = useToast();
  const [snapshotRows, setSnapshotRows] = useState<MemorySnapshotEntry[]>([]);
  const [summary, setSummary] = useState<MemorySummaryData | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<MemoryNoteRecord[]>([]);
  const [memoryContextData, setMemoryContextData] = useState<MemoryContextData | null>(null);
  const [searchResults, setSearchResults] = useState<MemoryNoteRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotLoadingMore, setSnapshotLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [currentLimit, setCurrentLimit] = useState(MEMORY_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);
  const [formKind, setFormKind] = useState<MemoryNoteKind>("project_context");
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formPinned, setFormPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null);
  const [preferenceDraft, setPreferenceDraft] = useState<MemoryPreferenceDraft>(EMPTY_PREFERENCE_DRAFT);

  const refresh = async (limit = currentLimit) => {
    setLoading(true);
    setError(null);
    try {
      const [snapshot, summaryResult, recentDecisions, contextResult] = await Promise.all([
        getMemorySnapshot({ limit }),
        getMemorySummary({ limit: 8 }),
        getRecentDecisionMemory({ limit: 6 }),
        getMemoryContext({ limit: 16 }),
      ]);
      setSnapshotRows(snapshot.rows);
      setGeneratedAt(snapshot.generated_at);
      setSummary(summaryResult);
      setDecisionNotes(recentDecisions.notes);
      setMemoryContextData(contextResult);
      setHasMore(snapshot.rows.length >= limit);
      setCurrentLimit(limit);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("memory.loadFailed"));
      }
      setSnapshotRows([]);
      setGeneratedAt(null);
      setSummary(null);
      setDecisionNotes([]);
      setMemoryContextData(null);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    const nextLimit = currentLimit + MEMORY_PAGE_SIZE;
    setSnapshotLoadingMore(true);
    try {
      const snapshot = await getMemorySnapshot({ limit: nextLimit });
      setSnapshotRows(snapshot.rows);
      setGeneratedAt(snapshot.generated_at);
      setHasMore(snapshot.rows.length >= nextLimit);
      setCurrentLimit(nextLimit);
    } catch {
      // keep existing state
    } finally {
      setSnapshotLoadingMore(false);
    }
  };

  useEffect(() => {
    void refresh(MEMORY_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const preferences = memoryContextData?.preferences;
    const projectContext = memoryContextData?.project_context;
    setPreferenceDraft({
      responseStyle: preferences?.responseStyle ?? "",
      preferredProvider: preferences?.preferredProvider ?? "",
      preferredModel: preferences?.preferredModel ?? "",
      riskTolerance: preferences?.riskTolerance ?? "",
      approvalStyle: preferences?.approvalStyle ?? "",
      monitoringPreference: preferences?.monitoringPreference ?? "",
      projectName: projectContext?.project_name ?? "",
      repoSlug: projectContext?.repo_slug ?? "",
      goalSummary: projectContext?.goal_summary ?? "",
      pinnedRefs: (projectContext?.pinned_refs ?? []).join(", "),
    });
  }, [memoryContextData]);

  useEffect(() => {
    const keyword = search.trim();
    if (keyword.length < 2) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getMemoryContext({ q: keyword, limit: 8 })
        .then((result) => {
          if (!cancelled) {
            setSearchResults(result.notes);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearchResults([]);
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const noteList = useMemo(() => {
    const base = dedupeNotes(summary?.pinned_notes ?? [], summary?.recent_notes ?? [], decisionNotes);
    if ((search.trim().length ?? 0) >= 2) {
      return searchResults ?? [];
    }
    return base;
  }, [decisionNotes, search, searchResults, summary?.pinned_notes, summary?.recent_notes]);

  const structuredNotesByKey = useMemo(() => {
    const map = new Map<string, MemoryNoteRecord>();
    for (const note of memoryContextData?.structured_notes ?? []) {
      if (note.key) {
        map.set(note.key, note);
      }
    }
    return map;
  }, [memoryContextData?.structured_notes]);

  const memoryPreferenceHighlights = useMemo(() => {
    const highlights: string[] = [];
    if (memoryContextData?.preferences?.responseStyle) {
      highlights.push(
        `${t("memory.preferences.responseStyle")}: ${t(
          `memory.preferences.responseStyle.${memoryContextData.preferences.responseStyle}`
        )}`
      );
    }
    if (memoryContextData?.preferences?.preferredProvider) {
      highlights.push(
        `${t("memory.preferences.preferredProvider")}: ${t(
          `memory.preferences.provider.${memoryContextData.preferences.preferredProvider}`
        )}`
      );
    }
    if (memoryContextData?.preferences?.preferredModel) {
      highlights.push(
        `${t("memory.preferences.preferredModel")}: ${memoryContextData.preferences.preferredModel}`
      );
    }
    if (memoryContextData?.preferences?.riskTolerance) {
      highlights.push(
        `${t("memory.preferences.riskTolerance")}: ${t(
          `memory.preferences.riskTolerance.${memoryContextData.preferences.riskTolerance}`
        )}`
      );
    }
    if (memoryContextData?.preferences?.approvalStyle) {
      highlights.push(
        `${t("memory.preferences.approvalStyle")}: ${t(
          `memory.preferences.approvalStyle.${memoryContextData.preferences.approvalStyle}`
        )}`
      );
    }
    if (memoryContextData?.preferences?.monitoringPreference) {
      highlights.push(
        `${t("memory.preferences.monitoringPreference")}: ${t(
          `memory.preferences.monitoringPreference.${memoryContextData.preferences.monitoringPreference}`
        )}`
      );
    }
    if (memoryContextData?.project_context?.project_name || memoryContextData?.project_context?.repo_slug) {
      highlights.push(
        `${t("memory.preferences.projectContextTitle")}: ${
          memoryContextData?.project_context?.project_name ||
          memoryContextData?.project_context?.repo_slug ||
          "-"
        }`
      );
    }
    return highlights;
  }, [memoryContextData?.preferences, memoryContextData?.project_context, t]);

  const handleCreate = async () => {
    if (!formTitle.trim() || !formContent.trim()) return;
    setSubmitting(true);
    try {
      await createMemoryNote({
        kind: formKind,
        title: formTitle.trim(),
        content: formContent.trim(),
        tags: formTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        pinned: formPinned,
      });
      setFormTitle("");
      setFormContent("");
      setFormTags("");
      setFormPinned(false);
      await refresh(MEMORY_PAGE_SIZE);
      pushToast({
        tone: "success",
        title: t("memory.toast.savedTitle"),
        message: t("memory.toast.savedBody"),
      });
    } catch (err) {
      const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("memory.noteSaveFailed");
      pushToast({
        tone: "error",
        title: t("memory.toast.saveFailedTitle"),
        message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePreferences = async () => {
    setSavingPreferences(true);
    try {
      const syncStructuredNote = async (
        key:
          | "response_style"
          | "preferred_provider"
          | "preferred_model"
          | "risk_tolerance"
          | "approval_style"
          | "monitoring_preference"
          | "project_context",
        payload:
          | {
              kind: MemoryNoteKind;
              value: string;
              attributes?: Record<string, unknown>;
            }
          | null
      ) => {
        const existing = structuredNotesByKey.get(key);
        if (!payload) {
          if (existing) {
            await deleteMemoryNote(existing.id);
          }
          return;
        }
        const title = buildStructuredMemoryTitle(t, key, preferenceDraft);
        const content = buildStructuredMemoryContent(t, key, preferenceDraft);
        const requestBody = {
          kind: payload.kind,
          title,
          content,
          key,
          value: payload.value,
          attributes: payload.attributes ?? {},
          tags:
            key === "project_context"
              ? ["project", "context"]
              : ["preference", key.replaceAll("_", "-")],
          pinned: existing?.pinned ?? key === "project_context",
        };
        if (existing) {
          await updateMemoryNote(existing.id, requestBody);
          return;
        }
        await createMemoryNote(requestBody);
      };

      const projectPinnedRefs = splitCommaList(preferenceDraft.pinnedRefs);
      await syncStructuredNote(
        "response_style",
        preferenceDraft.responseStyle
          ? {
              kind: "user_preference",
              value: preferenceDraft.responseStyle,
              attributes: { response_style: preferenceDraft.responseStyle },
            }
          : null
      );
      await syncStructuredNote(
        "preferred_provider",
        preferenceDraft.preferredProvider
          ? {
              kind: "user_preference",
              value: preferenceDraft.preferredProvider,
              attributes: { preferred_provider: preferenceDraft.preferredProvider },
            }
          : null
      );
      await syncStructuredNote(
        "preferred_model",
        preferenceDraft.preferredModel.trim()
          ? {
              kind: "user_preference",
              value: preferenceDraft.preferredModel.trim(),
              attributes: { preferred_model: preferenceDraft.preferredModel.trim() },
            }
          : null
      );
      await syncStructuredNote(
        "risk_tolerance",
        preferenceDraft.riskTolerance
          ? {
              kind: "user_preference",
              value: preferenceDraft.riskTolerance,
              attributes: { risk_tolerance: preferenceDraft.riskTolerance },
            }
          : null
      );
      await syncStructuredNote(
        "approval_style",
        preferenceDraft.approvalStyle
          ? {
              kind: "user_preference",
              value: preferenceDraft.approvalStyle,
              attributes: { approval_style: preferenceDraft.approvalStyle },
            }
          : null
      );
      await syncStructuredNote(
        "monitoring_preference",
        preferenceDraft.monitoringPreference
          ? {
              kind: "user_preference",
              value: preferenceDraft.monitoringPreference,
              attributes: { monitoring_preference: preferenceDraft.monitoringPreference },
            }
          : null
      );
      await syncStructuredNote(
        "project_context",
        preferenceDraft.projectName.trim() ||
          preferenceDraft.repoSlug.trim() ||
          preferenceDraft.goalSummary.trim() ||
          projectPinnedRefs.length > 0
          ? {
              kind: "project_context",
              value:
                preferenceDraft.projectName.trim() ||
                preferenceDraft.repoSlug.trim() ||
                "project-context",
              attributes: {
                project_name: preferenceDraft.projectName.trim() || null,
                repo_slug: preferenceDraft.repoSlug.trim() || null,
                goal_summary: preferenceDraft.goalSummary.trim() || null,
                pinned_refs: projectPinnedRefs,
              },
            }
          : null
      );

      await refresh(MEMORY_PAGE_SIZE);
      pushToast({
        tone: "success",
        title: t("memory.preferences.savedTitle"),
        message: t("memory.preferences.savedBody"),
      });
    } catch (err) {
      const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("memory.preferences.saveFailedBody");
      pushToast({
        tone: "error",
        title: t("memory.preferences.saveFailedTitle"),
        message,
      });
    } finally {
      setSavingPreferences(false);
    }
  };

  const handleTogglePinned = async (note: MemoryNoteRecord) => {
    setBusyNoteId(note.id);
    try {
      await updateMemoryNote(note.id, { pinned: !note.pinned });
      await refresh(MEMORY_PAGE_SIZE);
    } finally {
      setBusyNoteId(null);
    }
  };

  const handleDelete = async (note: MemoryNoteRecord) => {
    setBusyNoteId(note.id);
    try {
      await deleteMemoryNote(note.id);
      await refresh(MEMORY_PAGE_SIZE);
    } finally {
      setBusyNoteId(null);
    }
  };

  return (
    <main className="w-full h-full bg-transparent text-white p-4 flex flex-col overflow-hidden">
      <header className="mb-4 border-l-2 border-white pl-3">
        <h2 className="text-sm font-mono font-bold tracking-widest text-white flex items-center gap-2">
          <Brain size={14} /> {t("memory.title")}
        </h2>
      </header>

      <div className="grid grid-cols-2 gap-2 mb-4 text-[10px] font-mono">
        <div className="rounded border border-white/10 bg-black/30 p-3">
          <p className="text-white/40">{t("memory.summary.total")}</p>
          <p className="mt-1 text-lg text-white">{summary?.counts.total ?? 0}</p>
        </div>
        <div className="rounded border border-white/10 bg-black/30 p-3">
          <p className="text-white/40">{t("memory.summary.pinned")}</p>
          <p className="mt-1 text-lg text-cyan-200">{summary?.counts.pinned ?? 0}</p>
        </div>
        <div className="rounded border border-white/10 bg-black/30 p-3">
          <p className="text-white/40">{t("memory.summary.project")}</p>
          <p className="mt-1 text-lg text-white">{summary?.counts.project_context ?? 0}</p>
        </div>
        <div className="rounded border border-white/10 bg-black/30 p-3">
          <p className="text-white/40">{t("memory.summary.decisions")}</p>
          <p className="mt-1 text-lg text-white">{summary?.counts.decision_memory ?? 0}</p>
        </div>
      </div>

      <section className="rounded border border-cyan-400/15 bg-cyan-500/5 p-3 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("memory.preferences.title")}</p>
            <p className="mt-1 text-xs text-white/55">{t("memory.preferences.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleSavePreferences()}
            disabled={savingPreferences}
            className="inline-flex items-center gap-2 rounded border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-40"
          >
            {savingPreferences ? t("memory.preferences.saving") : t("memory.preferences.save")}
          </button>
        </div>

        {memoryPreferenceHighlights.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {memoryPreferenceHighlights.map((item) => (
              <span
                key={item}
                className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-mono text-white/70"
              >
                {item}
              </span>
            ))}
          </div>
        ) : null}

        {(memoryContextData?.recent_decision_signals?.summary?.length ?? 0) > 0 ? (
          <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
            <p className="text-[10px] font-mono tracking-widest text-white/45">{t("memory.preferences.decisionSignals")}</p>
            <div className="mt-1 space-y-1">
              {memoryContextData?.recent_decision_signals?.summary?.map((line) => (
                <p key={line} className="text-[11px] text-white/65">
                  - {line}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-[10px] font-mono text-white/55">
            {t("memory.preferences.responseStyle")}
            <select
              value={preferenceDraft.responseStyle}
              onChange={(event) =>
                setPreferenceDraft((draft) => ({
                  ...draft,
                  responseStyle: event.target.value as MemoryPreferenceDraft["responseStyle"],
                }))
              }
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            >
              <option value="">{t("memory.preferences.defaultOption")}</option>
              <option value="concise">{t("memory.preferences.responseStyle.concise")}</option>
              <option value="balanced">{t("memory.preferences.responseStyle.balanced")}</option>
              <option value="detailed">{t("memory.preferences.responseStyle.detailed")}</option>
            </select>
          </label>
          <label className="text-[10px] font-mono text-white/55">
            {t("memory.preferences.preferredProvider")}
            <select
              value={preferenceDraft.preferredProvider}
              onChange={(event) =>
                setPreferenceDraft((draft) => ({
                  ...draft,
                  preferredProvider: event.target.value as MemoryPreferenceDraft["preferredProvider"],
                }))
              }
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            >
              <option value="">{t("memory.preferences.defaultOption")}</option>
              <option value="openai">{t("memory.preferences.provider.openai")}</option>
              <option value="gemini">{t("memory.preferences.provider.gemini")}</option>
              <option value="anthropic">{t("memory.preferences.provider.anthropic")}</option>
              <option value="local">{t("memory.preferences.provider.local")}</option>
            </select>
          </label>
          <label className="text-[10px] font-mono text-white/55">
            {t("memory.preferences.preferredModel")}
            <input
              value={preferenceDraft.preferredModel}
              onChange={(event) =>
                setPreferenceDraft((draft) => ({
                  ...draft,
                  preferredModel: event.target.value,
                }))
              }
              placeholder={t("memory.preferences.preferredModelPlaceholder")}
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            />
          </label>
          <label className="text-[10px] font-mono text-white/55">
            {t("memory.preferences.riskTolerance")}
            <select
              value={preferenceDraft.riskTolerance}
              onChange={(event) =>
                setPreferenceDraft((draft) => ({
                  ...draft,
                  riskTolerance: event.target.value as MemoryPreferenceDraft["riskTolerance"],
                }))
              }
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            >
              <option value="">{t("memory.preferences.defaultOption")}</option>
              <option value="cautious">{t("memory.preferences.riskTolerance.cautious")}</option>
              <option value="balanced">{t("memory.preferences.riskTolerance.balanced")}</option>
              <option value="aggressive">{t("memory.preferences.riskTolerance.aggressive")}</option>
            </select>
          </label>
          <label className="text-[10px] font-mono text-white/55">
            {t("memory.preferences.approvalStyle")}
            <select
              value={preferenceDraft.approvalStyle}
              onChange={(event) =>
                setPreferenceDraft((draft) => ({
                  ...draft,
                  approvalStyle: event.target.value as MemoryPreferenceDraft["approvalStyle"],
                }))
              }
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            >
              <option value="">{t("memory.preferences.defaultOption")}</option>
              <option value="read_only_review">{t("memory.preferences.approvalStyle.read_only_review")}</option>
              <option value="approval_required_write">{t("memory.preferences.approvalStyle.approval_required_write")}</option>
              <option value="safe_auto_run_preferred">{t("memory.preferences.approvalStyle.safe_auto_run_preferred")}</option>
            </select>
          </label>
          <label className="text-[10px] font-mono text-white/55">
            {t("memory.preferences.monitoringPreference")}
            <select
              value={preferenceDraft.monitoringPreference}
              onChange={(event) =>
                setPreferenceDraft((draft) => ({
                  ...draft,
                  monitoringPreference: event.target.value as MemoryPreferenceDraft["monitoringPreference"],
                }))
              }
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            >
              <option value="">{t("memory.preferences.defaultOption")}</option>
              <option value="manual">{t("memory.preferences.monitoringPreference.manual")}</option>
              <option value="important_changes">{t("memory.preferences.monitoringPreference.important_changes")}</option>
              <option value="all_changes">{t("memory.preferences.monitoringPreference.all_changes")}</option>
            </select>
          </label>
        </div>

        <div className="mt-3 rounded border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("memory.preferences.projectContextTitle")}</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="text-[10px] font-mono text-white/55">
              {t("memory.preferences.projectName")}
              <input
                value={preferenceDraft.projectName}
                onChange={(event) =>
                  setPreferenceDraft((draft) => ({
                    ...draft,
                    projectName: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
              />
            </label>
            <label className="text-[10px] font-mono text-white/55">
              {t("memory.preferences.repoSlug")}
              <input
                value={preferenceDraft.repoSlug}
                onChange={(event) =>
                  setPreferenceDraft((draft) => ({
                    ...draft,
                    repoSlug: event.target.value,
                  }))
                }
                placeholder="gwkim92/AI-brain"
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
              />
            </label>
          </div>
          <label className="mt-2 block text-[10px] font-mono text-white/55">
            {t("memory.preferences.goalSummary")}
            <textarea
              value={preferenceDraft.goalSummary}
              onChange={(event) =>
                setPreferenceDraft((draft) => ({
                  ...draft,
                  goalSummary: event.target.value,
                }))
              }
              className="mt-1 h-20 w-full resize-none rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            />
          </label>
          <label className="mt-2 block text-[10px] font-mono text-white/55">
            {t("memory.preferences.pinnedRefs")}
            <input
              value={preferenceDraft.pinnedRefs}
              onChange={(event) =>
                setPreferenceDraft((draft) => ({
                  ...draft,
                  pinnedRefs: event.target.value,
                }))
              }
              placeholder={t("memory.preferences.pinnedRefsPlaceholder")}
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            />
          </label>
        </div>
      </section>

      <div className="rounded border border-white/10 bg-black/30 p-3 mb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("memory.savedContext")}</p>
          <label className="inline-flex items-center gap-2 text-[10px] font-mono text-white/55">
            <input
              type="checkbox"
              checked={formPinned}
              onChange={(event) => setFormPinned(event.target.checked)}
              className="h-3 w-3 rounded border-white/20 bg-black/40"
            />
            {t("memory.form.pinNote")}
          </label>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <label className="text-[10px] font-mono text-white/55">
            {t("memory.form.kind")}
            <select
              value={formKind}
              onChange={(event) => setFormKind(event.target.value as MemoryNoteKind)}
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            >
              {MEMORY_KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>
                  {describeMemoryNoteKind(t, kind)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-mono text-white/55">
            {t("memory.form.title")}
            <input
              value={formTitle}
              onChange={(event) => setFormTitle(event.target.value)}
              placeholder={t("memory.form.titlePlaceholder")}
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
            />
          </label>
        </div>
        <label className="mt-2 block text-[10px] font-mono text-white/55">
          {t("memory.form.content")}
          <textarea
            value={formContent}
            onChange={(event) => setFormContent(event.target.value)}
            placeholder={t("memory.form.contentPlaceholder")}
            className="mt-1 h-24 w-full resize-none rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
          />
        </label>
        <label className="mt-2 block text-[10px] font-mono text-white/55">
          {t("memory.form.tags")}
          <input
            value={formTags}
            onChange={(event) => setFormTags(event.target.value)}
            placeholder={t("memory.form.tagsPlaceholder")}
            className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
          />
        </label>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={submitting || !formTitle.trim() || !formContent.trim()}
            className="inline-flex items-center gap-2 rounded border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
          >
            <Plus size={12} />
            {submitting ? t("memory.form.saving") : t("memory.form.save")}
          </button>
        </div>
      </div>

      <label className="relative mb-3">
        <Search size={14} className="absolute left-3 top-2.5 text-white/30" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("memory.searchSavedContext")}
          className="w-full bg-black/40 border border-white/10 rounded px-9 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500/40"
        />
      </label>

      {generatedAt ? (
        <p className="mb-3 text-[10px] font-mono text-white/40">{t("memory.generated", { date: formatDateTime(generatedAt) })}</p>
      ) : null}

      <AsyncState
        loading={loading}
        error={error}
        empty={!loading && !error && noteList.length === 0 && snapshotRows.length === 0}
        emptyText={t("memory.empty")}
        loadingText={t("memory.loading")}
        onRetry={() => void refresh(MEMORY_PAGE_SIZE)}
        className="mb-3"
      />

      <div className="flex-1 overflow-y-auto pr-1 space-y-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("memory.savedContext")}</p>
            <p className="text-[10px] font-mono text-white/45">
              {search.trim().length >= 2 ? t("memory.searchResults") : t("memory.recentNotes")}
            </p>
          </div>
          {!loading &&
            !error &&
            noteList.map((note) => (
              <div key={note.id} className="rounded border border-white/10 bg-black/30 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-widest ${noteKindTheme(note.kind)}`}>
                        {describeMemoryNoteKind(t, note.kind)}
                      </span>
                      {note.pinned ? (
                        <span className="rounded border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-cyan-100">
                          {t("memory.note.pinned")}
                        </span>
                      ) : null}
                      <span className="text-[10px] font-mono text-white/35">{formatRelative(note.updatedAt, t)}</span>
                    </div>
                    <p className="mt-2 text-sm text-white">{note.title}</p>
                    <p className="mt-1 text-xs leading-5 text-white/70 whitespace-pre-wrap">{note.content}</p>
                    {note.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {note.tags.map((tag) => (
                          <span key={`${note.id}:${tag}`} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono text-white/60">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTogglePinned(note)}
                      disabled={busyNoteId === note.id}
                      className="rounded border border-white/10 bg-black/30 p-2 text-white/55 hover:text-cyan-200 disabled:opacity-40"
                      aria-label={note.pinned ? t("memory.note.unpin") : t("memory.note.pin")}
                    >
                      {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(note)}
                      disabled={busyNoteId === note.id}
                      className="rounded border border-white/10 bg-black/30 p-2 text-white/55 hover:text-rose-200 disabled:opacity-40"
                      aria-label={t("memory.note.delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
        </section>

        {decisionNotes.length > 0 ? (
          <section className="space-y-2">
            <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("memory.recentDecisions")}</p>
            {decisionNotes.slice(0, 3).map((note) => (
              <div key={`decision-${note.id}`} className="rounded border border-white/10 bg-black/25 p-3">
                <p className="text-xs font-mono text-white/50">{formatRelative(note.updatedAt, t)}</p>
                <p className="mt-1 text-sm text-white">{note.title}</p>
                <p className="mt-1 text-xs leading-5 text-white/65">{note.content}</p>
              </div>
            ))}
          </section>
        ) : null}

        <section className="space-y-2">
          <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("memory.snapshotTitle")}</p>
          {!loading &&
            !error &&
            snapshotRows.map((row) => (
              <MemoryItemRow
                key={row.id}
                id={row.id}
                category={row.category}
                content={row.content}
                source={row.source}
                timestamp={formatRelative(row.timestamp, t)}
              />
            ))}

          {!loading && !error && hasMore && snapshotRows.length > 0 ? (
            <button
              onClick={() => void loadMore()}
              disabled={snapshotLoadingMore}
              className="w-full py-2 text-[11px] font-mono text-cyan-400 hover:text-cyan-200 border border-white/10 rounded hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              {snapshotLoadingMore ? t("memory.loadingMore") : t("memory.loadMore")}
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
