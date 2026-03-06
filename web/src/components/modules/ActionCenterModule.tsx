"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ShieldQuestion, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { ApiRequestError } from "@/lib/api/client";
import { approveJarvisAction, getJarvisSession, listJarvisSessions, rejectJarvisAction } from "@/lib/api/endpoints";
import { dispatchJarvisDataRefresh, subscribeJarvisDataRefresh } from "@/lib/hud/data-refresh";
import type {
  ActionProposalRecord,
  JarvisSessionDetail,
  JarvisSessionPrimaryTarget,
  JarvisSessionRecord,
  WorkspaceCommandImpact,
  WorkspaceCommandImpactDimension,
} from "@/lib/api/types";

type SessionActionPreview = {
  badge: string;
  summary: string;
  tone: string;
  severity: string;
  priority: number;
};

type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";
type TargetFilter = "all" | JarvisSessionPrimaryTarget;
type ActivityFilter = "all" | "fresh" | "stale";

const STALE_AFTER_MS = 15 * 60 * 1000;

function getRiskTone(riskLevel: string) {
  if (riskLevel === "network" || riskLevel === "process_control") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  }
  if (riskLevel === "write" || riskLevel === "unknown") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  if (riskLevel === "build") {
    return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
  }
  return "border-white/15 bg-white/5 text-white/70";
}

function getImpactTone(level: string) {
  if (level === "expected") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  }
  if (level === "possible") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
}

function getSeverityTone(severity: string) {
  if (severity === "critical") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  }
  if (severity === "high") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  if (severity === "medium") {
    return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
}

function getSeverityRank(severity: string): number {
  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function formatAge(isoValue: string): string {
  const deltaMs = Date.now() - Date.parse(isoValue);
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "-";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function isStaleSession(session: JarvisSessionRecord): boolean {
  if (session.status === "stale") return true;
  const updatedAtMs = Date.parse(session.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  return Date.now() - updatedAtMs >= STALE_AFTER_MS;
}

function formatTargetLabel(target: JarvisSessionPrimaryTarget): string {
  return target.replaceAll("_", " ");
}

function isImpactDimension(value: unknown): value is WorkspaceCommandImpactDimension {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.level === "string" && typeof candidate.summary === "string" && Array.isArray(candidate.targets);
}

function readImpact(payload: Record<string, unknown>): WorkspaceCommandImpact | null {
  const raw = payload.impact;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (
    !isImpactDimension(candidate.files) ||
    !isImpactDimension(candidate.network) ||
    !isImpactDimension(candidate.processes) ||
    !Array.isArray(candidate.notes)
  ) {
    return null;
  }
  return {
    files: candidate.files,
    network: candidate.network,
    processes: candidate.processes,
    notes: candidate.notes.filter((note): note is string => typeof note === "string"),
  };
}

function ImpactRow({ label, dimension }: { label: string; dimension: WorkspaceCommandImpactDimension }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.24em] text-white/55">{label}</span>
        <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${getImpactTone(dimension.level)}`}>{dimension.level}</span>
      </div>
      <p className="mt-1 text-[11px] text-white/75">{dimension.summary}</p>
      {dimension.targets.length > 0 && (
        <p className="mt-1 text-[10px] text-white/50">targets: {dimension.targets.join(", ")}</p>
      )}
    </div>
  );
}

function describeImpactDimension(label: string, dimension: WorkspaceCommandImpactDimension): string {
  const targetText = dimension.targets.length > 0 ? ` (${dimension.targets.slice(0, 2).join(", ")})` : "";
  return `${label} ${dimension.level}${targetText}`;
}

function buildWorkspacePreview(action: ActionProposalRecord, impact: WorkspaceCommandImpact | null): SessionActionPreview {
  const riskLevel = String(action.payload.risk_level ?? "unknown");
  const severity = String(action.payload.policy_severity ?? "medium");
  const parts: string[] = [];
  if (impact) {
    if (impact.network.level !== "none") {
      parts.push(describeImpactDimension("network", impact.network));
    }
    if (impact.files.level !== "none") {
      parts.push(describeImpactDimension("files", impact.files));
    }
    if (impact.processes.level !== "none") {
      parts.push(describeImpactDimension("processes", impact.processes));
    }
  }
  return {
    badge: riskLevel,
    summary: parts.length > 0 ? parts.slice(0, 2).join(" · ") : action.summary,
    tone: getRiskTone(riskLevel),
    severity,
    priority: getSeverityRank(severity),
  };
}

function buildActionPreview(action: ActionProposalRecord): SessionActionPreview {
  if (action.kind === "workspace_prepare") {
    return buildWorkspacePreview(action, readImpact(action.payload));
  }
  return {
    badge: action.kind,
    summary: action.summary,
    tone: "border-white/15 bg-white/5 text-white/70",
    severity: "medium",
    priority: 2,
  };
}

export function ActionCenterModule() {
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState<JarvisSessionRecord[]>([]);
  const [sessionPreviews, setSessionPreviews] = useState<Record<string, SessionActionPreview>>({});
  const [selected, setSelected] = useState<JarvisSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [targetFilter, setTargetFilter] = useState<TargetFilter>("all");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");

  const loadDetail = useCallback(async (sessionId: string) => {
    try {
      setSelected(await getJarvisSession(sessionId));
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to load session action detail");
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listJarvisSessions({ status: "needs_approval", limit: 20 });
      const previewEntries = await Promise.all(
        result.sessions.map(async (session) => {
          try {
            const detail = await getJarvisSession(session.id);
            const action = detail.actions.find((item) => item.status === "pending");
            return [session.id, action ? buildActionPreview(action) : null] as const;
          } catch {
            return [session.id, null] as const;
          }
        })
      );
      const previewMap = Object.fromEntries(
        previewEntries.filter((entry): entry is readonly [string, SessionActionPreview] => entry[1] !== null)
      );
      const sortedSessions = [...result.sessions].sort((left, right) => {
        const leftPriority = previewMap[left.id]?.priority ?? 0;
        const rightPriority = previewMap[right.id]?.priority ?? 0;
        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }
        const leftStale = isStaleSession(left);
        const rightStale = isStaleSession(right);
        if (leftStale !== rightStale) {
          return leftStale ? -1 : 1;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      });
      setSessions(sortedSessions);
      setSessionPreviews(previewMap);
      const requestedSessionId = searchParams.get("session");
      const preferredSessionId =
        requestedSessionId && sortedSessions.some((item) => item.id === requestedSessionId)
          ? requestedSessionId
          : sortedSessions[0]?.id;
      if (preferredSessionId) {
        await loadDetail(preferredSessionId);
      } else {
        setSelected(null);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to load action center");
      }
      setSessions([]);
      setSessionPreviews({});
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, [loadDetail, searchParams]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return subscribeJarvisDataRefresh((detail) => {
      if (detail.scope === "all" || detail.scope === "approvals" || detail.scope === "sessions") {
        void refresh();
      }
    });
  }, [refresh]);

  useEffect(() => {
    const requestedSessionId = searchParams.get("session");
    if (!requestedSessionId) return;
    if (selected?.session.id === requestedSessionId) return;
    if (sessions.some((item) => item.id === requestedSessionId)) {
      void loadDetail(requestedSessionId);
    }
  }, [loadDetail, searchParams, selected?.session.id, sessions]);

  const pendingActions = useMemo(() => selected?.actions.filter((action) => action.status === "pending") ?? [], [selected]);
  const targetOptions = useMemo(() => {
    const options = new Set<JarvisSessionPrimaryTarget>();
    for (const session of sessions) {
      options.add(session.primaryTarget);
    }
    return ["all", ...[...options].sort()] as TargetFilter[];
  }, [sessions]);
  const visibleSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (severityFilter !== "all" && (sessionPreviews[session.id]?.severity ?? "low") !== severityFilter) {
        return false;
      }
      if (targetFilter !== "all" && session.primaryTarget !== targetFilter) {
        return false;
      }
      const stale = isStaleSession(session);
      if (activityFilter === "fresh" && stale) {
        return false;
      }
      if (activityFilter === "stale" && !stale) {
        return false;
      }
      return true;
    });
  }, [activityFilter, sessionPreviews, sessions, severityFilter, targetFilter]);
  const staleCount = useMemo(() => sessions.filter((session) => isStaleSession(session)).length, [sessions]);
  const sessionSections = useMemo(() => {
    const order: SeverityFilter[] = ["critical", "high", "medium", "low"];
    return order
      .map((severity) => ({
        severity,
        sessions: visibleSessions.filter((session) => (sessionPreviews[session.id]?.severity ?? "low") === severity),
      }))
      .filter((section) => severityFilter === "all" ? section.sessions.length > 0 : section.severity === severityFilter);
  }, [sessionPreviews, severityFilter, visibleSessions]);

  useEffect(() => {
    if (visibleSessions.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !visibleSessions.some((session) => session.id === selected.session.id)) {
      void loadDetail(visibleSessions[0].id);
    }
  }, [loadDetail, selected, visibleSessions]);

  const decide = async (action: ActionProposalRecord, decision: "approve" | "reject") => {
    if (!selected) return;
    setActingId(action.id);
    setError(null);
    try {
      if (decision === "approve") {
        await approveJarvisAction(selected.session.id, action.id);
      } else {
        await rejectJarvisAction(selected.session.id, action.id);
      }
      await refresh();
      dispatchJarvisDataRefresh({ scope: "approvals", source: "action_center" });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(`failed to ${decision} action`);
      }
    } finally {
      setActingId(null);
    }
  };

  return (
    <main className="w-full h-full bg-transparent text-white p-4 flex flex-col gap-4">
      <header className="border-l-2 border-cyan-500 pl-3">
        <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-400 flex items-center gap-2">
          <ShieldQuestion size={14} /> ACTION CENTER
        </h2>
        <p className="text-[10px] font-mono text-white/40">Approval-gated action proposals</p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "critical", "high", "medium", "low"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSeverityFilter(value)}
            className={`rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.22em] ${
              severityFilter === value ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/55"
            }`}
          >
            {value}
          </button>
        ))}
        <span className="rounded border border-white/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.22em] text-white/50">
          stale {staleCount}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {targetOptions.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTargetFilter(value)}
            className={`rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.22em] ${
              targetFilter === value ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/55"
            }`}
          >
            {value === "all" ? "all targets" : formatTargetLabel(value)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "fresh", "stale"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setActivityFilter(value)}
            className={`rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.22em] ${
              activityFilter === value ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/55"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      {error && <p className="text-xs font-mono text-rose-300">{error}</p>}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-3 overflow-hidden">
        <section className="rounded border border-white/10 bg-black/30 overflow-y-auto p-2 space-y-2">
          {loading && <p className="text-xs font-mono text-white/45">Loading approval queue...</p>}
          {!loading && visibleSessions.length === 0 && <p className="text-xs font-mono text-white/45">No approval-gated sessions for this filter.</p>}
          {sessionSections.map((section) => (
            <div key={section.severity} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-white/45">{section.severity}</p>
                <span className="text-[10px] font-mono text-white/35">{section.sessions.length}</span>
              </div>
              {section.sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => void loadDetail(session.id)}
                  className={`w-full rounded border px-3 py-2 text-left ${selected?.session.id === session.id ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10 bg-black/30"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-white/90 truncate">{session.title}</p>
                    <div className="flex items-center gap-1">
                      {isStaleSession(session) && (
                        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-mono text-amber-200">
                          stale
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-white/35">{formatAge(session.updatedAt)}</span>
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] font-mono text-white/45">{session.primaryTarget} · {session.status}</p>
                  {sessionPreviews[session.id] && (
                    <div className="mt-2 space-y-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-[9px] font-mono ${getSeverityTone(sessionPreviews[session.id]!.severity)}`}>
                          {sessionPreviews[session.id]!.severity}
                        </span>
                        <span className={`inline-flex rounded border px-2 py-0.5 text-[9px] font-mono ${sessionPreviews[session.id]!.tone}`}>
                          {sessionPreviews[session.id]!.badge}
                        </span>
                      </div>
                      <p className="text-[10px] text-white/60">{sessionPreviews[session.id]!.summary}</p>
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}
        </section>
        <section className="rounded border border-white/10 bg-black/30 overflow-y-auto p-4 space-y-4">
          {!selected && <p className="text-xs font-mono text-white/45">Choose a session to inspect pending actions.</p>}
          {selected && (
            <>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg text-white/90">{selected.session.title}</h3>
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white/60">
                    {formatTargetLabel(selected.session.primaryTarget)}
                  </span>
                  {isStaleSession(selected.session) && (
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-200">
                      stale
                    </span>
                  )}
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white/50">
                    age {formatAge(selected.session.updatedAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs font-mono text-white/45">{selected.session.prompt}</p>
              </div>
              <div className="space-y-3">
                {pendingActions.length === 0 && <p className="text-xs font-mono text-white/45">No pending actions on this session.</p>}
                {pendingActions.map((action) => {
                  const impact = action.kind === "workspace_prepare" ? readImpact(action.payload) : null;
                  return (
                    <div key={action.id} className="rounded border border-white/10 bg-black/35 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-white/90">{action.title}</p>
                        <p className="mt-1 text-xs text-white/65">{action.summary}</p>
                      </div>
                      <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-mono text-amber-200">PENDING</span>
                    </div>
                    {action.kind === "workspace_prepare" && (
                      <div className="mt-3 rounded border border-cyan-500/20 bg-cyan-500/5 p-2 text-[11px] font-mono text-cyan-100/80">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${getSeverityTone(String(action.payload.policy_severity ?? "medium"))}`}>
                            {String(action.payload.policy_severity ?? "medium")}
                          </span>
                          <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${getRiskTone(String(action.payload.risk_level ?? "-"))}`}>
                            {String(action.payload.risk_level ?? "-")}
                          </span>
                          <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                            {String(action.payload.impact_profile ?? "-")}
                          </span>
                          <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                            {String(action.payload.workspace_kind ?? "-")}
                          </span>
                          <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-mono text-white/60">
                            {String(action.payload.policy_disposition ?? "-")}
                          </span>
                        </div>
                        <p>command: {String(action.payload.command ?? "-")}</p>
                        <p>cwd: {String(action.payload.cwd ?? "-")}</p>
                        <p>workspace: {String(action.payload.workspace_name ?? action.payload.workspace_id ?? "-")}</p>
                        <p>risk: {String(action.payload.risk_level ?? "-")}</p>
                        <p>reason: {String(action.payload.policy_reason ?? "-")}</p>
                        {impact && (
                          <div className="mt-3 space-y-2">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">estimated impact</p>
                            <ImpactRow label="files" dimension={impact.files} />
                            <ImpactRow label="network" dimension={impact.network} />
                            <ImpactRow label="processes" dimension={impact.processes} />
                            {impact.notes.length > 0 && (
                              <div className="rounded border border-white/10 bg-black/20 p-2 text-[10px] text-white/55">
                                notes: {impact.notes.join(" ")}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <button type="button" onClick={() => void decide(action, "approve")} disabled={actingId === action.id} className="inline-flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-1 text-[10px] font-mono text-emerald-300 disabled:opacity-50">
                        <CheckCircle2 size={11} /> APPROVE
                      </button>
                      <button type="button" onClick={() => void decide(action, "reject")} disabled={actingId === action.id} className="inline-flex items-center gap-1 rounded border border-rose-500/40 px-2 py-1 text-[10px] font-mono text-rose-300 disabled:opacity-50">
                        <XCircle size={11} /> REJECT
                      </button>
                    </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
