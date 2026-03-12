"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeExecutionPanel } from "@/components/ui/CodeExecutionPanel";
import { ComputeResultPanel } from "@/components/ui/ComputeResultPanel";
import {
  Terminal,
  Database,
  ShieldAlert,
  Cpu,
  Loader2,
  Sparkles,
  ShieldCheck,
  RefreshCw,
  Square,
  PlayCircle,
} from "lucide-react";

import {
  createWorkspace,
  deleteWorkspace,
  getJarvisSession,
  listProviderModels,
  listProviders,
  listWorkspaces,
  readWorkspaceSession,
  shutdownWorkspace,
  spawnWorkspaceSession,
  startExecutionRun,
  streamExecutionRunEvents,
  writeWorkspaceSession,
} from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/client";
import type {
  ProviderAvailability,
  ProviderModelCatalogEntry,
  WorkspaceChunkRecord,
  WorkspaceCommandImpactDimension,
  WorkspaceCommandPolicy,
  WorkspaceRecord,
  JarvisSessionDetail,
  RuntimeResolvedRoute,
} from "@/lib/api/types";
import { useHUD } from "@/components/providers/HUDProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { publishSkillPrefill } from "@/lib/skills/prefill";
import { dispatchJarvisDataRefresh } from "@/lib/hud/data-refresh";
import { describeExecutionOption } from "@/lib/jarvis/execution-option";
import type { TranslationKey } from "@/lib/locale";

type ProviderSelection = "auto" | "openai" | "gemini" | "anthropic" | "local";

function truncate(value: string, max = 220): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function createClientSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `workbench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatWorkspaceCommandError(
  err: unknown,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): { message: string; notice?: string | null } {
  if (!(err instanceof ApiRequestError)) {
    return {
      message: t("workbench.error.runWorkspaceCommand"),
      notice: null,
    };
  }

  const details =
    err.details && typeof err.details === "object" ? (err.details as Record<string, unknown>) : null;
  const workspaceKind = typeof details?.workspace_kind === "string" ? details.workspace_kind : null;

  if (err.status === 403 && err.code === "FORBIDDEN") {
    if (workspaceKind === "current") {
      return {
        message: t("workbench.error.runWorkspaceCommandRoleCurrent"),
        notice: t("workbench.workspace.notice.tryIsolatedRuntime"),
      };
    }
    return {
      message: t("workbench.error.runWorkspaceCommandRole"),
      notice: null,
    };
  }

  return {
    message: `${err.code}: ${err.message}`,
    notice: null,
  };
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

function WorkspaceImpactRow({ label, dimension }: { label: string; dimension: WorkspaceCommandImpactDimension }) {
  const { t } = useLocale();
  return (
    <div className="rounded border border-white/10 bg-black/20 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.24em] text-white/50">{label}</span>
        <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${getImpactTone(dimension.level)}`}>{dimension.level}</span>
      </div>
      <p className="mt-1 text-[11px] text-white/75">{dimension.summary}</p>
      {dimension.targets.length > 0 && (
        <p className="mt-1 text-[10px] text-white/50">
          {t("workbench.workspace.targets")}: {dimension.targets.join(", ")}
        </p>
      )}
    </div>
  );
}

function formatWorkspaceChunk(chunk: WorkspaceChunkRecord): string {
  const prefix = chunk.stream === "stdout" ? "OUT" : chunk.stream === "stderr" ? "ERR" : "SYS";
  return `[${prefix}] ${chunk.text.replace(/\n$/u, "")}`;
}

function mergeWorkspaceRows(current: WorkspaceRecord[], nextRow: WorkspaceRecord): WorkspaceRecord[] {
  const existing = current.find((row) => row.id === nextRow.id);
  if (!existing) {
    return [nextRow, ...current].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  return current
    .map((row) => (row.id === nextRow.id ? nextRow : row))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function describeCapabilityKey(capability: string) {
  if (capability === "answer") return "assistant.capability.answer" as const;
  if (capability === "research") return "assistant.capability.research" as const;
  if (capability === "brief") return "assistant.capability.brief" as const;
  if (capability === "debate") return "assistant.capability.debate" as const;
  if (capability === "plan") return "assistant.capability.plan" as const;
  if (capability === "approve") return "assistant.capability.approve" as const;
  if (capability === "execute") return "assistant.capability.execute" as const;
  if (capability === "notify") return "assistant.capability.notify" as const;
  return null;
}

function describeStageStatusKey(status: string) {
  if (status === "queued") return "assistant.status.queued" as const;
  if (status === "running") return "assistant.status.running" as const;
  if (status === "blocked") return "assistant.status.blocked" as const;
  if (status === "needs_approval") return "assistant.status.needsApproval" as const;
  if (status === "completed") return "assistant.status.completed" as const;
  if (status === "failed") return "assistant.status.failed" as const;
  if (status === "stale") return "assistant.status.stale" as const;
  if (status === "skipped") return "assistant.status.skipped" as const;
  return null;
}

function describeRouteSourceKey(source: RuntimeResolvedRoute["source"]) {
  if (source === "request_override") return "providerRoute.source.request_override" as const;
  if (source === "feature_preference") return "providerRoute.source.feature_preference" as const;
  if (source === "global_default") return "providerRoute.source.global_default" as const;
  if (source === "auto") return "providerRoute.source.auto" as const;
  return "providerRoute.source.runtime_result" as const;
}

export function WorkbenchModule() {
  const { t } = useLocale();
  const { openWidgets, startSession, linkSessionTask, sessions } = useHUD();
  const streamRef = useRef<ReturnType<typeof streamExecutionRunEvents> | null>(null);
  const runtimePollRef = useRef<number | null>(null);
  const workspaceCursorRef = useRef(0);

  const [activeTab, setActiveTab] = useState<"code" | "compute">("code");
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [output, setOutput] = useState<string>(() => t("workbench.noExecutionYet"));
  const [executionTimeMs, setExecutionTimeMs] = useState<number | undefined>(undefined);
  const [providerModel, setProviderModel] = useState<string>("-");
  const [credentialSummary, setCredentialSummary] = useState<string>("pending");
  const [resolvedRoute, setResolvedRoute] = useState<RuntimeResolvedRoute | null>(null);
  const [taskId, setTaskId] = useState<string>("-");
  const [runId, setRunId] = useState<string>("-");
  const [error, setError] = useState<string | null>(null);
  const [idempotentReplay, setIdempotentReplay] = useState(false);
  const [providers, setProviders] = useState<ProviderAvailability[]>([]);
  const [providerModelCatalog, setProviderModelCatalog] = useState<ProviderModelCatalogEntry[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderSelection>("auto");
  const [strictProvider, setStrictProvider] = useState(false);
  const [modelOverride, setModelOverride] = useState("");

  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceCommand, setWorkspaceCommand] = useState("");
  const [workspaceShell, setWorkspaceShell] = useState("");
  const [workspaceStdIn, setWorkspaceStdIn] = useState("");
  const [workspaceLog, setWorkspaceLog] = useState<string>(() => t("workbench.workspace.noOutput"));
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [workspaceCreateKind, setWorkspaceCreateKind] = useState<"current" | "worktree" | "devcontainer">("current");
  const [workspaceBaseRef, setWorkspaceBaseRef] = useState("HEAD");
  const [workspaceImage, setWorkspaceImage] = useState("brain-backend:latest");
  const [workspacePolicy, setWorkspacePolicy] = useState<WorkspaceCommandPolicy | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionKind, setCurrentSessionKind] = useState<"execution" | "runtime" | null>(null);
  const [jarvisSessionDetail, setJarvisSessionDetail] = useState<JarvisSessionDetail | null>(null);

  const syncWorkspaceCursor = useCallback((nextSequence: number) => {
    workspaceCursorRef.current = nextSequence;
  }, []);

  const formatCredentialSummary = (credential: {
    source: string;
    selected_credential_mode: string | null;
    credential_priority: string;
  } | null | undefined): string => {
    if (!credential || !credential.selected_credential_mode) {
      return "none";
    }
    return `${credential.selected_credential_mode} (${credential.source}) · ${credential.credential_priority}`;
  };

  const buildWorkspaceName = useCallback(
    (kind: "current" | "worktree" | "devcontainer") => {
      if (kind === "worktree") {
        return activeTab === "code" ? t("workbench.workspace.name.codeWorktree") : t("workbench.workspace.name.computeWorktree");
      }
      if (kind === "devcontainer") {
        return activeTab === "code"
          ? t("workbench.workspace.name.codeDevcontainer")
          : t("workbench.workspace.name.computeDevcontainer");
      }
      return activeTab === "code" ? t("workbench.workspace.name.codeRuntime") : t("workbench.workspace.name.computeRuntime");
    },
    [activeTab, t]
  );

  const formatProviderModel = useCallback(
    (provider: string | null | undefined, model: string | null | undefined) =>
      `${provider ?? t("workbench.pending")}/${model ?? t("workbench.pending")}`,
    [t]
  );

  const refreshWorkspaces = useCallback(
    async (preferredWorkspaceId?: string | null) => {
      const result = await listWorkspaces();
      setWorkspaces(result.workspaces ?? []);
      setSelectedWorkspaceId((current) => {
        const target = preferredWorkspaceId ?? current;
        if (target && result.workspaces.some((workspace) => workspace.id === target)) {
          return target;
        }
        return result.workspaces[0]?.id ?? null;
      });
      return result.workspaces;
    },
    []
  );

  const loadWorkspaceTranscript = useCallback(async (workspaceId: string, reset: boolean) => {
    const afterSequence = reset ? 0 : workspaceCursorRef.current;
    const result = await readWorkspaceSession(workspaceId, {
      after_sequence: afterSequence,
      limit: 200,
    });
    setWorkspaces((current) => mergeWorkspaceRows(current, result.workspace));
    if (reset) {
      const nextLog =
        result.chunks.length > 0 ? result.chunks.map(formatWorkspaceChunk).join("\n") : t("workbench.workspace.noOutput");
      setWorkspaceLog(nextLog);
    } else if (result.chunks.length > 0) {
      setWorkspaceLog((current) => {
        const appended = result.chunks.map(formatWorkspaceChunk).join("\n");
        return current === t("workbench.workspace.noOutput") ? appended : `${current}\n${appended}`;
      });
    }
    const lastSequence = result.chunks.at(-1)?.sequence ?? afterSequence;
    syncWorkspaceCursor(lastSequence);
    return result.workspace;
  }, [syncWorkspaceCursor, t]);

  const primeWorkspaceTranscriptBoundary = useCallback(async (workspaceId: string) => {
    const result = await readWorkspaceSession(workspaceId, {
      after_sequence: 0,
      limit: 1,
    });
    setWorkspaces((current) => mergeWorkspaceRows(current, result.workspace));
    syncWorkspaceCursor(Math.max(0, result.nextSequence - 1));
    return result.workspace;
  }, [syncWorkspaceCursor]);

  useEffect(() => {
    void (async () => {
      try {
        const [providerData, modelData] = await Promise.all([
          listProviders(),
          listProviderModels({ scope: "user" }).catch(() => ({ providers: [] })),
        ]);
        setProviders(providerData.providers ?? []);
        setProviderModelCatalog(modelData.providers ?? []);
        await refreshWorkspaces().catch(() => []);
      } catch {
        setProviders([]);
        setProviderModelCatalog([]);
      } finally {
        setWorkspaceLoading(false);
      }
    })();
  }, [refreshWorkspaces]);

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
      if (runtimePollRef.current !== null) {
        window.clearInterval(runtimePollRef.current);
        runtimePollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setWorkspaceLog(t("workbench.workspace.noneSelected"));
      syncWorkspaceCursor(0);
      return;
    }
    setWorkspaceError(null);
    void loadWorkspaceTranscript(selectedWorkspaceId, true).catch((err) => {
      const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("workbench.error.readWorkspaceOutput");
      setWorkspaceError(message);
    });
  }, [loadWorkspaceTranscript, selectedWorkspaceId, syncWorkspaceCursor, t]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces]
  );
  const sourceWorkspaceForContainer = useMemo(() => {
    if (!selectedWorkspace) return null;
    if (selectedWorkspace.kind === "current" || selectedWorkspace.kind === "worktree") {
      return selectedWorkspace;
    }
    return null;
  }, [selectedWorkspace]);

  useEffect(() => {
    if (runtimePollRef.current !== null) {
      window.clearInterval(runtimePollRef.current);
      runtimePollRef.current = null;
    }
    if (!selectedWorkspace || selectedWorkspace.status !== "running") {
      return;
    }
    runtimePollRef.current = window.setInterval(() => {
      void loadWorkspaceTranscript(selectedWorkspace.id, false).catch(() => {
        // Runtime polling errors are surfaced through explicit refresh actions.
      });
    }, 1500);
    return () => {
      if (runtimePollRef.current !== null) {
        window.clearInterval(runtimePollRef.current);
        runtimePollRef.current = null;
      }
    };
  }, [loadWorkspaceTranscript, selectedWorkspace]);

  const confidence = useMemo(() => {
    if (status === "success") return 90;
    if (status === "error") return 40;
    if (status === "running") return 70;
    return 60;
  }, [status]);

  const providerOptions = useMemo(
    () => [
      { provider: "auto" as const, enabled: true, label: t("common.auto").toUpperCase() },
      ...providers.map((item) => ({
        provider: item.provider,
        enabled: item.enabled,
        label: `${item.provider.toUpperCase()}${item.model ? ` (${item.model})` : ""}`,
      })),
    ],
    [providers, t]
  );

  const selectedProviderModels = useMemo(() => {
    if (selectedProvider === "auto") {
      return [];
    }
    return providerModelCatalog.find((row) => row.provider === selectedProvider)?.models ?? [];
  }, [providerModelCatalog, selectedProvider]);
  const currentSession = useMemo(
    () => (currentSessionId ? sessions.find((session) => session.id === currentSessionId) ?? null : null),
    [currentSessionId, sessions]
  );
  const sessionAgeLabel = useMemo(() => {
    if (!currentSession) return null;
    const startedAtMs = Date.parse(currentSession.createdAt);
    if (Number.isNaN(startedAtMs)) return null;
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
    if (elapsedSec < 60) return `${elapsedSec}s`;
    const minutes = Math.floor(elapsedSec / 60);
    const seconds = elapsedSec % 60;
    return `${minutes}m ${seconds}s`;
  }, [currentSession]);
  const sessionIsFresh = useMemo(() => {
    if (!currentSession) return false;
    const startedAtMs = Date.parse(currentSession.createdAt);
    if (Number.isNaN(startedAtMs)) return false;
    return Date.now() - startedAtMs <= 2 * 60 * 1000;
  }, [currentSession]);
  const workbenchSessionStateLabel = useMemo(() => {
    if (currentSessionKind === "runtime" && workspacePolicy?.disposition === "approval_required") {
      return t("workbench.session.state.awaitingApproval");
    }
    if (status === "running" || workspaceBusy) return t("workbench.session.state.running");
    if (status === "error" || workspaceError) return t("workbench.session.state.failed");
    return t("workbench.session.state.completed");
  }, [currentSessionKind, status, t, workspaceBusy, workspaceError, workspacePolicy?.disposition]);
  const sessionStageRecords = useMemo(
    () => [...(jarvisSessionDetail?.stages ?? [])].sort((left, right) => left.orderIndex - right.orderIndex),
    [jarvisSessionDetail?.stages]
  );
  const sessionExecutionOption = useMemo(() => {
    for (const stage of sessionStageRecords) {
      const refs = (stage.artifactRefsJson ?? undefined) as Record<string, unknown> | undefined;
      const value = refs?.["execution_option"];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }
    return null;
  }, [sessionStageRecords]);
  const sessionExecutionOptionDescriptor = useMemo(
    () => describeExecutionOption(t, sessionExecutionOption),
    [sessionExecutionOption, t]
  );
  const requestedRouteSummary = useMemo(
    () =>
      t("providerRoute.requestedInput", {
        provider: selectedProvider,
        model: modelOverride.trim() || t("council.defaultModel"),
        strict: selectedProvider === "auto" ? t("common.off") : strictProvider ? t("common.on") : t("common.off"),
      }),
    [modelOverride, selectedProvider, strictProvider, t]
  );
  const resolvedRouteSummary = useMemo(() => {
    if (!resolvedRoute) return null;
    return t("providerRoute.resolved", {
      provider: resolvedRoute.provider,
      model: resolvedRoute.model ?? t("council.defaultModel"),
      strict: resolvedRoute.strict_provider ? t("common.on") : t("common.off"),
      fallback: resolvedRoute.used_fallback ? t("common.on") : t("common.off"),
      source: t(describeRouteSourceKey(resolvedRoute.source)),
    });
  }, [resolvedRoute, t]);
  const pinnedRouteWarning = useMemo(() => {
    if (!resolvedRoute) return null;
    if (selectedProvider !== "auto") return null;
    if (!resolvedRoute.strict_provider || resolvedRoute.provider === "auto") return null;
    if (resolvedRoute.source !== "feature_preference" && resolvedRoute.source !== "global_default") return null;
    return t("providerRoute.pinnedByPreference");
  }, [resolvedRoute, selectedProvider, t]);

  useEffect(() => {
    if (!currentSessionId) {
      setJarvisSessionDetail(null);
      return;
    }
    let cancelled = false;
    let timerId: number | null = null;
    const load = async () => {
      try {
        const detail = await getJarvisSession(currentSessionId);
        if (!cancelled) {
          setJarvisSessionDetail(detail);
          timerId = window.setTimeout(load, 4000);
        }
      } catch {
        if (!cancelled) {
          timerId = window.setTimeout(load, 4000);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [currentSessionId]);

  const runExecution = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || status === "running") return;

    setStatus("running");
    setError(null);
    setIdempotentReplay(false);
    setCredentialSummary("pending");
    setResolvedRoute(null);

    const clientSessionId = createClientSessionId();

    try {
      const mode = activeTab === "code" ? "code" : "compute";
      const payload: Parameters<typeof startExecutionRun>[0] = {
        client_session_id: clientSessionId,
        mode,
        prompt: trimmed,
        create_task: true,
      };
      if (selectedProvider !== "auto") {
        payload.provider = selectedProvider;
        payload.strict_provider = strictProvider;
      }
      const model = modelOverride.trim();
      if (model.length > 0) {
        payload.model = model;
      }

      const run = await startExecutionRun(payload);
      const resolvedSessionId = run.session?.id ?? clientSessionId;
      startSession(trimmed, {
        sessionId: resolvedSessionId,
        activeWidgets: ["workbench", "tasks"],
        mountedWidgets: ["workbench", "tasks"],
        focusedWidget: "workbench",
        intent: "code",
        workspacePreset: "studio_code",
        restoreMode: "full",
      });
      setCurrentSessionId(resolvedSessionId);
      setCurrentSessionKind("execution");
      dispatchJarvisDataRefresh({ scope: "sessions", source: "workbench" });
      setIdempotentReplay(run.idempotent_replay === true);

      setRunId(run.id);
      setTaskId(run.task_id ?? "-");
      setProviderModel(formatProviderModel(run.provider, run.model));
      setCredentialSummary(formatCredentialSummary(run.selected_credential));
      setResolvedRoute(run.resolved_route ?? null);
      setOutput(run.output || t("workbench.executionCreated"));
      setExecutionTimeMs(run.duration_ms > 0 ? run.duration_ms : undefined);
      if (run.task_id) {
        linkSessionTask(resolvedSessionId, run.task_id);
        dispatchJarvisDataRefresh({ scope: "tasks", source: "workbench" });
      }
      if (run.status === "completed") {
        setStatus("success");
      } else if (run.status === "failed") {
        setStatus("error");
      } else {
        setStatus("running");
      }

      streamRef.current?.close();
      streamRef.current = streamExecutionRunEvents(run.id, {
        onUpdated: (payload) => {
          if (!payload || typeof payload !== "object" || !("data" in payload)) return;
          const body = payload as {
            data?: {
              output?: string;
              status?: string;
              provider?: string | null;
              model?: string;
              selected_credential?: {
                source: string;
                selected_credential_mode: string | null;
                credential_priority: string;
              } | null;
              resolved_route?: RuntimeResolvedRoute | null;
            };
          };
          if (body.data?.output) {
            setOutput(body.data.output);
          }
          if (body.data?.provider || body.data?.model) {
            setProviderModel(formatProviderModel(body.data?.provider, body.data?.model));
          }
          if ("selected_credential" in (body.data ?? {})) {
            setCredentialSummary(formatCredentialSummary(body.data?.selected_credential ?? null));
          }
          if ("resolved_route" in (body.data ?? {})) {
            setResolvedRoute(body.data?.resolved_route ?? null);
          }
          if (body.data?.status === "running" || body.data?.status === "queued") {
            setStatus("running");
          }
        },
        onCompleted: (payload) => {
          if (!payload || typeof payload !== "object" || !("data" in payload)) return;
          const body = payload as {
            data?: {
              output?: string;
              duration_ms?: number;
              provider?: string;
              model?: string;
              task_id?: string | null;
              selected_credential?: {
                source: string;
                selected_credential_mode: string | null;
                credential_priority: string;
              } | null;
              resolved_route?: RuntimeResolvedRoute | null;
            };
          };
          setOutput(body.data?.output ?? run.output);
          setExecutionTimeMs(body.data?.duration_ms ?? run.duration_ms);
          if (body.data?.provider && body.data?.model) {
            setProviderModel(`${body.data.provider}/${body.data.model}`);
          }
          if (body.data?.task_id) {
            setTaskId(body.data.task_id);
          }
          setCredentialSummary(formatCredentialSummary(body.data?.selected_credential ?? run.selected_credential));
          setResolvedRoute(body.data?.resolved_route ?? run.resolved_route ?? null);
          setStatus("success");
        },
        onFailed: (payload) => {
          if (!payload || typeof payload !== "object" || !("data" in payload)) return;
          const body = payload as {
            data?: {
              output?: string;
              provider?: string | null;
              model?: string;
              selected_credential?: {
                source: string;
                selected_credential_mode: string | null;
                credential_priority: string;
              } | null;
              resolved_route?: RuntimeResolvedRoute | null;
            };
          };
          setOutput(body.data?.output ?? t("workbench.error.executionFailed"));
          if (body.data?.provider || body.data?.model) {
            setProviderModel(formatProviderModel(body.data?.provider, body.data?.model));
          }
          setCredentialSummary(formatCredentialSummary(body.data?.selected_credential ?? null));
          setResolvedRoute(body.data?.resolved_route ?? run.resolved_route ?? null);
          setStatus("error");
        },
        onClose: () => {
          streamRef.current = null;
        },
        onError: () => {
          setStatus("error");
          setError(t("workbench.error.executionStreamFailed"));
          streamRef.current = null;
        },
      });
    } catch (err) {
      const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("workbench.error.executionFailed");
      setError(message);
      setOutput(message);
      setStatus("error");
      setExecutionTimeMs(undefined);
      setIdempotentReplay(false);
      setCredentialSummary("none");
    }
  };

  const routeViaSkill = () => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return;
    publishSkillPrefill({
      prompt: normalizedPrompt,
      skillId: activeTab === "code" ? "repo_health_review" : "model_recommendation_reasoner",
    });
    openWidgets(["workbench", "skills", "assistant"], {
      focus: "skills",
      replace: false,
      activate: "all",
    });
  };

  const ensureWorkspace = useCallback(async () => {
    if (selectedWorkspaceId) return selectedWorkspaceId;
    const created = await createWorkspace({
      name: buildWorkspaceName(workspaceCreateKind),
      cwd: workspaceCreateKind === "current" ? "." : undefined,
      kind: workspaceCreateKind,
      base_ref: workspaceCreateKind === "worktree" ? workspaceBaseRef.trim() || "HEAD" : undefined,
      source_workspace_id: workspaceCreateKind === "devcontainer" ? sourceWorkspaceForContainer?.id ?? undefined : undefined,
      image: workspaceCreateKind === "devcontainer" ? workspaceImage.trim() || undefined : undefined,
      approval_required: true,
    });
    setWorkspaces((current) => mergeWorkspaceRows(current, created));
    setSelectedWorkspaceId(created.id);
    setWorkspaceNotice(
      created.kind === "worktree"
        ? t("workbench.workspace.notice.worktreeCreated", { baseRef: created.baseRef ?? "HEAD", name: created.name })
        : created.kind === "devcontainer"
          ? t("workbench.workspace.notice.devcontainerCreated", {
              config: created.containerConfigPath ? t("workbench.workspace.notice.usingDetectedConfig") : "",
              source: created.sourceWorkspaceId ? t("workbench.workspace.notice.fromSelectedSource") : "",
              name: created.name,
            })
        : t("workbench.workspace.notice.created", { name: created.name })
    );
    syncWorkspaceCursor(0);
    return created.id;
  }, [buildWorkspaceName, selectedWorkspaceId, t, workspaceBaseRef, workspaceCreateKind, sourceWorkspaceForContainer?.id, syncWorkspaceCursor, workspaceImage]);

  const handleCreateWorkspace = async () => {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const created = await createWorkspace({
        name: buildWorkspaceName(workspaceCreateKind),
        cwd: workspaceCreateKind === "current" ? "." : undefined,
        kind: workspaceCreateKind,
        base_ref: workspaceCreateKind === "worktree" ? workspaceBaseRef.trim() || "HEAD" : undefined,
        source_workspace_id: workspaceCreateKind === "devcontainer" ? sourceWorkspaceForContainer?.id ?? undefined : undefined,
        image: workspaceCreateKind === "devcontainer" ? workspaceImage.trim() || undefined : undefined,
        approval_required: true,
      });
      setWorkspaces((current) => mergeWorkspaceRows(current, created));
      setSelectedWorkspaceId(created.id);
      syncWorkspaceCursor(0);
      setWorkspaceLog(t("workbench.workspace.noOutput"));
      setWorkspaceNotice(
        created.kind === "worktree"
          ? t("workbench.workspace.notice.worktreeCreated", { baseRef: created.baseRef ?? "HEAD", name: created.name })
          : created.kind === "devcontainer"
            ? t("workbench.workspace.notice.devcontainerCreated", {
                config: created.containerConfigPath ? t("workbench.workspace.notice.usingDetectedConfig") : "",
                source: created.sourceWorkspaceId ? t("workbench.workspace.notice.fromSelectedSource") : "",
                name: created.name,
              })
          : t("workbench.workspace.notice.created", { name: created.name })
      );
    } catch (err) {
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("workbench.error.createWorkspace"));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleRunWorkspaceCommand = async () => {
    const trimmed = workspaceCommand.trim();
    if (!trimmed) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    setWorkspaceNotice(null);

    try {
      const workspaceId = await ensureWorkspace();
      const clientSessionId = createClientSessionId();
      const result = await spawnWorkspaceSession(workspaceId, {
        command: trimmed,
        client_session_id: clientSessionId,
        shell: workspaceShell.trim() || undefined,
      });
      const resolvedSessionId = result.session?.id ?? clientSessionId;
      startSession(trimmed, {
        sessionId: resolvedSessionId,
        activeWidgets: ["workbench", "tasks"],
        mountedWidgets: ["workbench", "tasks"],
        focusedWidget: "workbench",
        intent: "code",
        workspacePreset: "studio_code",
        restoreMode: "full",
      });
      setCurrentSessionId(resolvedSessionId);
      setCurrentSessionKind("runtime");
      dispatchJarvisDataRefresh({ scope: "sessions", source: "workbench" });
      setWorkspacePolicy(result.policy);
      setWorkspaces((current) => mergeWorkspaceRows(current, result.workspace));
      setSelectedWorkspaceId(result.workspace.id);
      syncWorkspaceCursor(0);
      if (result.requires_approval) {
        await primeWorkspaceTranscriptBoundary(result.workspace.id);
        setWorkspaceLog(t("workbench.workspace.approvalPending"));
        setWorkspaceNotice(
          t("workbench.workspace.notice.approvalQueued", {
            title: result.action?.title ?? t("workbench.workspace.requiresApproval"),
            risk: result.policy.riskLevel,
          })
        );
        dispatchJarvisDataRefresh({ scope: "approvals", source: "workbench" });
        openWidgets(["workbench", "action_center", "notifications"], {
          focus: "action_center",
          replace: false,
          activate: "all",
        });
        return;
      }
      await loadWorkspaceTranscript(result.workspace.id, true);
      setWorkspaceNotice(
        result.policy.disposition === "auto_run"
          ? t("workbench.workspace.notice.commandStartedAuto", { risk: result.policy.riskLevel })
          : t("workbench.workspace.notice.commandStartedElevated", { risk: result.policy.riskLevel })
      );
    } catch (err) {
      const formatted = formatWorkspaceCommandError(err, t);
      setWorkspaceError(formatted.message);
      setWorkspaceNotice(formatted.notice ?? null);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleWriteStdIn = async () => {
    if (!selectedWorkspaceId || !workspaceStdIn.trim()) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const result = await writeWorkspaceSession(selectedWorkspaceId, {
        data: workspaceStdIn,
      });
      setWorkspaces((current) => mergeWorkspaceRows(current, result.workspace));
      setWorkspaceStdIn("");
      await loadWorkspaceTranscript(selectedWorkspaceId, false);
    } catch (err) {
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("workbench.error.writeWorkspace"));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleShutdownWorkspace = async () => {
    if (!selectedWorkspaceId) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const result = await shutdownWorkspace(selectedWorkspaceId);
      setWorkspaces((current) => mergeWorkspaceRows(current, result.workspace));
      await loadWorkspaceTranscript(selectedWorkspaceId, false);
      setWorkspaceNotice(t("workbench.workspace.notice.terminated"));
    } catch (err) {
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("workbench.error.shutdownWorkspace"));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleRefreshWorkspace = async () => {
    if (!selectedWorkspaceId) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      await refreshWorkspaces(selectedWorkspaceId);
      await loadWorkspaceTranscript(selectedWorkspaceId, true);
    } catch (err) {
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("workbench.error.refreshWorkspace"));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!selectedWorkspaceId) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      await deleteWorkspace(selectedWorkspaceId);
      setWorkspaceNotice(t("workbench.workspace.notice.deleted"));
      setWorkspacePolicy(null);
      setWorkspaceLog(t("workbench.workspace.noneSelected"));
      syncWorkspaceCursor(0);
      const next = await refreshWorkspaces();
      setSelectedWorkspaceId(next[0]?.id ?? null);
    } catch (err) {
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("workbench.error.deleteWorkspace"));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  return (
    <main className="w-full h-full bg-transparent text-white p-6 flex flex-col">
      <header className="mb-6 border-l-2 border-emerald-500 pl-4">
        <h1 className="text-2xl font-mono font-bold tracking-widest text-emerald-400 flex items-center gap-3">
          <Terminal size={24} /> {t("workbench.title").toUpperCase()}
        </h1>
        <p className="text-sm font-mono text-white/50 tracking-wide mt-1">{t("workbench.subtitle")}</p>
      </header>

      <div className="flex bg-white/5 p-1 rounded-lg border border-white/10 font-mono text-xs w-64 mb-4">
        <button
          onClick={() => setActiveTab("code")}
          className={`flex-1 py-2 rounded transition-colors flex justify-center items-center gap-2 ${
            activeTab === "code"
              ? "bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30"
              : "text-white/50 hover:text-white"
          }`}
        >
          <Terminal size={14} /> {t("workbench.tab.code").toUpperCase()}
        </button>
        <button
          onClick={() => setActiveTab("compute")}
          className={`flex-1 py-2 rounded transition-colors flex justify-center items-center gap-2 ${
            activeTab === "compute"
              ? "bg-amber-500/20 text-amber-500 font-bold border border-amber-500/30"
              : "text-white/50 hover:text-white"
          }`}
        >
          <Cpu size={14} /> {t("workbench.tab.compute").toUpperCase()}
        </button>
      </div>

      {currentSession && (
        <div className="mb-4 rounded-lg border border-cyan-500/25 bg-cyan-500/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-cyan-400/35 bg-cyan-400/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-cyan-200">
                  {sessionIsFresh ? t("assistant.newSession") : t("assistant.activeSession")}
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-white/65">
                  {currentSession.status === "active" ? t("common.active") : t("common.background")}
                </span>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-emerald-200">
                  {currentSessionKind === "runtime" ? t("workbench.session.kind.runtime") : t("workbench.session.kind.execution")}
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-white/65">
                  {workbenchSessionStateLabel}
                </span>
              </div>
              <p className="mt-2 text-sm font-mono text-cyan-100">
                {truncate(currentSessionKind === "runtime" ? workspaceCommand.trim() || currentSession.prompt : currentSession.prompt, 180)}
              </p>
              <p className="mt-1 text-[11px] font-mono text-white/60">
                {t("common.session")} {currentSession.id.slice(0, 8)}
                {sessionAgeLabel ? ` · ${t("assistant.startedAgo", { value: sessionAgeLabel })}` : ""}
                {taskId !== "-" ? ` · ${t("workbench.task")} ${taskId.slice(0, 8)}` : ""}
                {runId !== "-" ? ` · ${t("workbench.runId")} ${runId.slice(0, 8)}` : ""}
              </p>
              <p className="mt-2 text-[11px] text-white/55">{t("workbench.session.mirrored")}</p>
              {sessionExecutionOptionDescriptor ? (
                <div className={`mt-3 rounded border p-2 ${sessionExecutionOptionDescriptor.toneClassName}`}>
                  <p className="text-[10px] font-mono tracking-widest text-white/60">
                    {t("assistant.executionOption")}
                  </p>
                  <p className="mt-1 text-sm">{sessionExecutionOptionDescriptor.label}</p>
                  <p className="mt-1 text-[11px] text-white/75">{sessionExecutionOptionDescriptor.hint}</p>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openWidgets(["workbench", "tasks"], { focus: "tasks", replace: false, activate: "focus_only" })}
                className="rounded border border-white/15 px-3 py-1.5 text-[11px] font-mono text-white/80 transition hover:border-cyan-400/40 hover:text-cyan-200"
              >
                {t("common.openTaskManager")}
              </button>
              {currentSessionKind === "runtime" && workspacePolicy?.disposition === "approval_required" && (
                <button
                  type="button"
                  onClick={() => openWidgets(["workbench", "action_center"], { focus: "action_center", replace: false, activate: "focus_only" })}
                  className="rounded border border-amber-500/25 px-3 py-1.5 text-[11px] font-mono text-amber-200 transition hover:border-amber-400/40"
                >
                  {t("common.openActionCenter")}
                </button>
              )}
            </div>
          </div>
          {sessionStageRecords.length > 0 && (
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="rounded border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] font-mono tracking-widest text-white/45">{t("assistant.capabilities")}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(jarvisSessionDetail?.requested_capabilities ?? []).map((capability) => {
                    const key = describeCapabilityKey(capability);
                    return (
                      <span
                        key={`workbench-capability-${capability}`}
                        className="rounded border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-cyan-100"
                      >
                        {key ? t(key) : capability}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] font-mono tracking-widest text-white/45">{t("assistant.stages")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {sessionStageRecords.map((stage) => {
                    const statusKey = describeStageStatusKey(stage.status);
                    const capabilityKey = describeCapabilityKey(stage.capability);
                    return (
                      <span
                        key={stage.id}
                        className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-mono text-white/75"
                      >
                        {capabilityKey ? t(capabilityKey) : stage.title} · {statusKey ? t(statusKey) : stage.status}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-6 p-4 rounded-lg bg-white/5 border border-white/10">
        <p className="text-[10px] font-mono tracking-widest text-white/40 mb-2 uppercase">{t("workbench.prompt")}</p>
        <textarea
          className="w-full bg-black/40 border border-white/10 rounded-md px-4 py-3 text-sm text-cyan-50 focus:outline-none focus:border-cyan-500/50 resize-none h-24"
          placeholder={activeTab === "code" ? t("workbench.promptPlaceholder.code") : t("workbench.promptPlaceholder.compute")}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[180px_minmax(0,1fr)_auto]">
          <select
            value={selectedProvider}
            onChange={(event) => setSelectedProvider(event.target.value as ProviderSelection)}
            className="h-9 rounded border border-white/15 bg-black/50 px-2 text-xs text-white/90"
          >
            {providerOptions.map((option) => (
              <option key={`workbench-provider-${option.provider}`} value={option.provider} disabled={!option.enabled}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            list="workbench-model-catalog"
            type="text"
            value={modelOverride}
            onChange={(event) => setModelOverride(event.target.value)}
            placeholder={t("workbench.modelOverridePlaceholder")}
            className="h-9 rounded border border-white/15 bg-black/50 px-3 text-xs text-white/90"
          />
          <datalist id="workbench-model-catalog">
            {selectedProviderModels.map((modelName) => (
              <option key={`workbench-model-${modelName}`} value={modelName} />
            ))}
          </datalist>
          <label className="inline-flex items-center gap-1 text-[11px] text-white/70">
            <input
              type="checkbox"
              checked={strictProvider}
              onChange={(event) => setStrictProvider(event.target.checked)}
              disabled={selectedProvider === "auto"}
              className="accent-cyan-400"
            />
            {t("council.strictProvider")}
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 px-5 py-2 rounded-md font-mono font-bold text-xs hover:bg-cyan-500/30 transition-all shadow-[0_0_15px_rgba(0,255,255,0.2)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={() => void runExecution()}
            disabled={status === "running" || !prompt.trim()}
          >
            {status === "running" && <Loader2 size={12} className="animate-spin" />}
            {t("workbench.run")}
          </button>
          <button
            className="bg-white/5 text-white/75 border border-white/15 px-4 py-2 rounded-md font-mono font-bold text-xs hover:text-cyan-200 hover:border-cyan-500/35 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={routeViaSkill}
            disabled={!prompt.trim()}
          >
            <Sparkles size={12} />
            {t("workbench.routeViaSkill")}
          </button>
          <span className="text-xs font-mono text-white/40">{t("workbench.provider")}: {providerModel}</span>
          <span className="text-xs font-mono text-cyan-300/80">{t("council.credential")}: {credentialSummary === "pending" ? t("workbench.pending") : credentialSummary === "none" ? t("common.none") : credentialSummary}</span>
          <span className="text-xs font-mono text-white/40">{t("workbench.task")}: {taskId === "-" ? "-" : taskId.slice(0, 8)}</span>
          <span className="text-xs font-mono text-white/40">{t("workbench.runId")}: {runId === "-" ? "-" : runId.slice(0, 8)}</span>
        </div>
        <p className="mt-2 text-xs font-mono text-white/50">{requestedRouteSummary}</p>
        {resolvedRouteSummary ? <p className="mt-1 text-xs font-mono text-cyan-300/80">{resolvedRouteSummary}</p> : null}
        {pinnedRouteWarning ? <p className="mt-2 text-xs font-mono text-amber-300">{pinnedRouteWarning}</p> : null}
        {error && <p className="mt-2 text-xs font-mono text-red-400">{error}</p>}
        {idempotentReplay && <p className="mt-2 text-xs font-mono text-amber-300">{t("council.idempotentReplay")}</p>}
      </div>

      <div className="flex-1 overflow-y-auto pr-4 pb-32 scroll-pb-32 space-y-6">
        {activeTab === "code" ? (
          <div className="space-y-6 w-full">
            <div className="flex items-center gap-6 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-sm font-mono text-emerald-100/70">
              <span className="flex items-center gap-2">
                <Database size={14} className="text-emerald-500" /> {t("workbench.info.databaseAccess")}
              </span>
              <span className="flex items-center gap-2">
                <ShieldAlert size={14} className="text-emerald-500" /> {t("workbench.info.network")}
              </span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 w-full">
              <CodeExecutionPanel
                language="typescript"
                status={status}
                executionTimeMs={executionTimeMs}
                code={prompt || t("workbench.code.promptFallback")}
                output={output}
              />

              <CodeExecutionPanel
                language="json"
                status={status === "error" ? "error" : "success"}
                executionTimeMs={executionTimeMs}
                code={`{\n  "mode": "${activeTab}",\n  "provider_model": "${providerModel}",\n  "task_id": "${taskId}",\n  "run_id": "${runId}"\n}`}
                output={status === "success" ? t("workbench.executionMetadataCaptured") : output}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 w-full">
            <ComputeResultPanel
              formula={prompt || t("workbench.compute.promptFallback")}
              result={status === "idle" ? t("workbench.na") : truncate(output, 180)}
              confidence={confidence}
            />
            <ComputeResultPanel
              formula={t("workbench.executionMetadata")}
              result={`task=${taskId === "-" ? t("workbench.na") : taskId.slice(0, 8)} | run=${runId === "-" ? t("workbench.na") : runId.slice(0, 8)} | provider=${providerModel} | time=${executionTimeMs ?? 0}ms`}
              confidence={Math.max(50, confidence - 10)}
            />
          </div>
        )}

        <section className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-300 flex items-center gap-2">
                <ShieldCheck size={14} /> {t("workbench.workspace.title")}
              </h2>
              <p className="mt-1 text-[11px] font-mono text-white/45">
                {t("workbench.workspace.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCreateWorkspace()}
                disabled={workspaceBusy}
                className="inline-flex items-center gap-1 rounded border border-white/15 px-3 py-1.5 text-[11px] font-mono text-white/80 disabled:opacity-50"
              >
                {workspaceBusy ? <Loader2 size={11} className="animate-spin" /> : <Terminal size={11} />}
                {t("workbench.workspace.new")}
              </button>
              <button
                type="button"
                onClick={() => void handleRefreshWorkspace()}
                disabled={workspaceBusy || !selectedWorkspaceId}
                className="inline-flex items-center gap-1 rounded border border-white/15 px-3 py-1.5 text-[11px] font-mono text-white/80 disabled:opacity-50"
              >
                <RefreshCw size={11} />
                {t("common.refresh").toUpperCase()}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteWorkspace()}
                disabled={workspaceBusy || !selectedWorkspaceId || selectedWorkspace?.status === "running"}
                className="inline-flex items-center gap-1 rounded border border-rose-500/30 px-3 py-1.5 text-[11px] font-mono text-rose-200 disabled:opacity-50"
              >
                <Square size={11} />
                {t("common.delete").toUpperCase()}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="space-y-3 rounded border border-white/10 bg-black/30 p-3">
              <div className="grid grid-cols-1 gap-2">
                <label className="block text-[10px] font-mono uppercase tracking-[0.3em] text-white/45">
                  {t("workbench.workspace.mode")}
                </label>
                <select
                  value={workspaceCreateKind}
                  onChange={(event) => setWorkspaceCreateKind(event.target.value as "current" | "worktree" | "devcontainer")}
                  className="w-full rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                >
                  <option value="current">{t("workbench.workspace.modeCurrent")}</option>
                  <option value="worktree">{t("workbench.workspace.modeWorktree")}</option>
                  <option value="devcontainer">{t("workbench.workspace.modeDevcontainer")}</option>
                </select>
                {workspaceCreateKind === "worktree" && (
                  <input
                    type="text"
                    value={workspaceBaseRef}
                    onChange={(event) => setWorkspaceBaseRef(event.target.value)}
                    placeholder={t("workbench.workspace.baseRefPlaceholder")}
                    className="w-full rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                  />
                )}
                {workspaceCreateKind === "devcontainer" && (
                  <>
                    <input
                      type="text"
                      value={workspaceImage}
                      onChange={(event) => setWorkspaceImage(event.target.value)}
                      placeholder={t("workbench.workspace.containerImagePlaceholder")}
                      className="w-full rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                    />
                    <p className="text-[11px] font-mono text-white/45">
                      {t("workbench.workspace.sourceMount")}: {sourceWorkspaceForContainer ? `${sourceWorkspaceForContainer.name} (${sourceWorkspaceForContainer.kind})` : t("workbench.workspace.repositoryRoot")}
                    </p>
                  </>
                )}
              </div>
              <label className="block text-[10px] font-mono uppercase tracking-[0.3em] text-white/45">
                {t("workbench.workspace.label")}
              </label>
              <select
                value={selectedWorkspaceId ?? ""}
                onChange={(event) => setSelectedWorkspaceId(event.target.value || null)}
                className="w-full rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
              >
                <option value="">{t("workbench.workspace.select")}</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name} · {workspace.kind} · {workspace.status}
                  </option>
                ))}
              </select>
              <div className="rounded border border-white/10 bg-black/30 p-3 text-[11px] font-mono text-white/65">
                {workspaceLoading && <p>{t("workbench.workspace.loadingState")}</p>}
                {!workspaceLoading && !selectedWorkspace && <p>{t("workbench.workspace.noneSelected")}</p>}
                {selectedWorkspace && (
                  <div className="space-y-1">
                    <p>{t("workbench.workspace.meta.id")}: {selectedWorkspace.id.slice(0, 8)}</p>
                    <p>{t("workbench.workspace.meta.kind")}: {selectedWorkspace.kind}</p>
                    <p>{t("workbench.workspace.meta.baseRef")}: {selectedWorkspace.baseRef ?? "-"}</p>
                    <p>{t("workbench.workspace.meta.sourceWorkspace")}: {selectedWorkspace.sourceWorkspaceId ? selectedWorkspace.sourceWorkspaceId.slice(0, 8) : "-"}</p>
                    <p>{t("workbench.workspace.meta.containerImage")}: {selectedWorkspace.containerImage ?? "-"}</p>
                    <p>{t("workbench.workspace.meta.containerSource")}: {selectedWorkspace.containerSource ?? "-"}</p>
                    <p>{t("workbench.workspace.meta.managedImage")}: {selectedWorkspace.containerImageManaged ? t("modelControl.yes") : t("modelControl.no")}</p>
                    <p>{t("workbench.workspace.meta.containerName")}: {selectedWorkspace.containerName ?? "-"}</p>
                    <p>{t("workbench.workspace.meta.buildContext")}: {selectedWorkspace.containerBuildContext ?? "-"}</p>
                    <p>{t("workbench.workspace.meta.dockerfile")}: {selectedWorkspace.containerDockerfile ?? "-"}</p>
                    <p>{t("workbench.workspace.meta.features")}: {selectedWorkspace.containerFeatures.length > 0 ? selectedWorkspace.containerFeatures.join(", ") : "-"}</p>
                    <p>{t("workbench.workspace.meta.appliedFeatures")}: {selectedWorkspace.containerAppliedFeatures.length > 0 ? selectedWorkspace.containerAppliedFeatures.join(", ") : "-"}</p>
                    <p>{t("workbench.workspace.meta.containerWorkdir")}: {selectedWorkspace.containerWorkdir ?? "-"}</p>
                    <p>{t("workbench.workspace.meta.configPath")}: {selectedWorkspace.containerConfigPath ?? "-"}</p>
                    <p>{t("workbench.workspace.meta.runArgs")}: {selectedWorkspace.containerRunArgs.length > 0 ? selectedWorkspace.containerRunArgs.join(" ") : "-"}</p>
                    <p>{t("common.status")}: {selectedWorkspace.status}</p>
                    <p>{t("workbench.workspace.meta.cwd")}: {selectedWorkspace.cwd}</p>
                    <p>{t("workbench.workspace.meta.approval")}: {selectedWorkspace.approvalRequired ? t("workbench.workspace.required") : t("common.disabled")}</p>
                    <p>{t("workbench.workspace.meta.command")}: {selectedWorkspace.activeCommand ?? "-"}</p>
                    <p>{t("workbench.workspace.meta.exit")}: {selectedWorkspace.exitCode ?? "-"}</p>
                    {selectedWorkspace.containerWarnings.length > 0 && (
                      <p>{t("workbench.workspace.meta.configWarnings")}: {selectedWorkspace.containerWarnings.join(" | ")}</p>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setWorkspaceCommand(prompt.trim())}
                disabled={!prompt.trim()}
                className="w-full rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-mono text-amber-200 disabled:opacity-50"
              >
                {t("workbench.workspace.usePromptAsShell")}
              </button>
            </div>

            <div className="space-y-3 rounded border border-white/10 bg-black/30 p-3">
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_160px]">
                <input
                  type="text"
                  data-testid="workbench-workspace-command"
                  value={workspaceCommand}
                  onChange={(event) => setWorkspaceCommand(event.target.value)}
                  placeholder={t("workbench.workspace.commandPlaceholder")}
                  className="rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                />
                <input
                  type="text"
                  data-testid="workbench-workspace-shell"
                  value={workspaceShell}
                  onChange={(event) => setWorkspaceShell(event.target.value)}
                  placeholder={t("workbench.workspace.shellOverridePlaceholder")}
                  className="rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="workbench-run-command"
                  onClick={() => void handleRunWorkspaceCommand()}
                  disabled={workspaceBusy || !workspaceCommand.trim()}
                  className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-mono text-cyan-200 disabled:opacity-50"
                >
                  {workspaceBusy ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />}
                  {t("workbench.workspace.runCommand")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleShutdownWorkspace()}
                  disabled={workspaceBusy || !selectedWorkspaceId || selectedWorkspace?.status !== "running"}
                  className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[11px] font-mono text-rose-200 disabled:opacity-50"
                >
                  <Square size={11} />
                  {t("common.stop")}
                </button>
                <span className="text-[11px] font-mono text-white/45">
                  {t("workbench.workspace.autoRunPolicy")}
                </span>
              </div>
              {workspacePolicy && (
                <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3 text-[11px] font-mono text-cyan-100/80">
                  <p>{t("workbench.workspace.policy.risk")}: {workspacePolicy.riskLevel}</p>
                  <p>{t("workbench.workspace.policy.impactProfile")}: {workspacePolicy.impactProfile}</p>
                  <p>{t("workbench.workspace.policy.severity")}: {workspacePolicy.severity}</p>
                  <p>{t("workbench.workspace.policy.policy")}: {workspacePolicy.disposition}</p>
                  <p>{t("workbench.workspace.policy.reason")}: {workspacePolicy.reason}</p>
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{t("workbench.workspace.policy.estimatedImpact")}</p>
                    <WorkspaceImpactRow label={t("workbench.workspace.policy.files")} dimension={workspacePolicy.impact.files} />
                    <WorkspaceImpactRow label={t("workbench.workspace.policy.network")} dimension={workspacePolicy.impact.network} />
                    <WorkspaceImpactRow label={t("workbench.workspace.policy.processes")} dimension={workspacePolicy.impact.processes} />
                    {workspacePolicy.impact.notes.length > 0 && (
                      <div className="rounded border border-white/10 bg-black/20 p-2 text-[10px] text-white/55">
                        {t("workbench.workspace.policy.notes")}: {workspacePolicy.impact.notes.join(" ")}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {workspaceError && <p className="text-xs font-mono text-rose-300">{workspaceError}</p>}
              {workspaceNotice && <p className="text-xs font-mono text-cyan-200">{workspaceNotice}</p>}
              <div className="rounded border border-white/10 bg-[#020617] p-3">
                <pre
                  data-testid="workbench-workspace-transcript"
                  className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[11px] font-mono leading-5 text-cyan-50"
                >
                  {workspaceLog}
                </pre>
              </div>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  type="text"
                  value={workspaceStdIn}
                  onChange={(event) => setWorkspaceStdIn(event.target.value)}
                  placeholder={t("workbench.workspace.stdinPlaceholder")}
                  className="rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                />
                <button
                  type="button"
                  onClick={() => void handleWriteStdIn()}
                  disabled={workspaceBusy || !selectedWorkspaceId || selectedWorkspace?.status !== "running" || !workspaceStdIn.trim()}
                  className="rounded border border-white/15 px-3 py-2 text-[11px] font-mono text-white/80 disabled:opacity-50"
                >
                  {t("common.write")}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
