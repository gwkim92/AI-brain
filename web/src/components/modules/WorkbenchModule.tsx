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
} from "@/lib/api/types";
import { useHUD } from "@/components/providers/HUDProvider";
import { publishSkillPrefill } from "@/lib/skills/prefill";
import { dispatchJarvisDataRefresh } from "@/lib/hud/data-refresh";

type ProviderSelection = "auto" | "openai" | "gemini" | "anthropic" | "local";

function truncate(value: string, max = 220): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
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
  return (
    <div className="rounded border border-white/10 bg-black/20 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.24em] text-white/50">{label}</span>
        <span className={`rounded border px-2 py-0.5 text-[9px] font-mono ${getImpactTone(dimension.level)}`}>{dimension.level}</span>
      </div>
      <p className="mt-1 text-[11px] text-white/75">{dimension.summary}</p>
      {dimension.targets.length > 0 && (
        <p className="mt-1 text-[10px] text-white/50">targets: {dimension.targets.join(", ")}</p>
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

export function WorkbenchModule() {
  const { openWidgets } = useHUD();
  const streamRef = useRef<ReturnType<typeof streamExecutionRunEvents> | null>(null);
  const runtimePollRef = useRef<number | null>(null);
  const workspaceCursorRef = useRef(0);

  const [activeTab, setActiveTab] = useState<"code" | "compute">("code");
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [output, setOutput] = useState<string>("No execution yet.");
  const [executionTimeMs, setExecutionTimeMs] = useState<number | undefined>(undefined);
  const [providerModel, setProviderModel] = useState<string>("-");
  const [credentialSummary, setCredentialSummary] = useState<string>("pending");
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
  const [workspaceLog, setWorkspaceLog] = useState("No workspace output yet.");
  const [workspaceCursor, setWorkspaceCursor] = useState(0);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [workspaceCreateKind, setWorkspaceCreateKind] = useState<"current" | "worktree" | "devcontainer">("current");
  const [workspaceBaseRef, setWorkspaceBaseRef] = useState("HEAD");
  const [workspaceImage, setWorkspaceImage] = useState("brain-backend:latest");
  const [workspacePolicy, setWorkspacePolicy] = useState<WorkspaceCommandPolicy | null>(null);

  const syncWorkspaceCursor = useCallback((nextSequence: number) => {
    workspaceCursorRef.current = nextSequence;
    setWorkspaceCursor(nextSequence);
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
      const nextLog = result.chunks.length > 0 ? result.chunks.map(formatWorkspaceChunk).join("\n") : "No workspace output yet.";
      setWorkspaceLog(nextLog);
    } else if (result.chunks.length > 0) {
      setWorkspaceLog((current) => {
        const appended = result.chunks.map(formatWorkspaceChunk).join("\n");
        return current === "No workspace output yet." ? appended : `${current}\n${appended}`;
      });
    }
    const lastSequence = result.chunks.at(-1)?.sequence ?? afterSequence;
    syncWorkspaceCursor(lastSequence);
    return result.workspace;
  }, [syncWorkspaceCursor]);

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
      setWorkspaceLog("No workspace selected.");
      syncWorkspaceCursor(0);
      return;
    }
    setWorkspaceError(null);
    void loadWorkspaceTranscript(selectedWorkspaceId, true).catch((err) => {
      const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "failed to read workspace output";
      setWorkspaceError(message);
    });
  }, [loadWorkspaceTranscript, selectedWorkspaceId, syncWorkspaceCursor]);

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
      { provider: "auto" as const, enabled: true, label: "AUTO" },
      ...providers.map((item) => ({
        provider: item.provider,
        enabled: item.enabled,
        label: `${item.provider.toUpperCase()}${item.model ? ` (${item.model})` : ""}`,
      })),
    ],
    [providers]
  );

  const selectedProviderModels = useMemo(() => {
    if (selectedProvider === "auto") {
      return [];
    }
    return providerModelCatalog.find((row) => row.provider === selectedProvider)?.models ?? [];
  }, [providerModelCatalog, selectedProvider]);

  const runExecution = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || status === "running") return;

    setStatus("running");
    setError(null);
    setIdempotentReplay(false);
    setCredentialSummary("pending");

    try {
      const mode = activeTab === "code" ? "code" : "compute";
      const payload: Parameters<typeof startExecutionRun>[0] = {
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
      setIdempotentReplay(run.idempotent_replay === true);

      setRunId(run.id);
      setTaskId(run.task_id ?? "-");
      setProviderModel(`${run.provider ?? "pending"}/${run.model}`);
      setCredentialSummary(formatCredentialSummary(run.selected_credential));
      setOutput(run.output || "Execution run created. Waiting for completion stream...");
      setExecutionTimeMs(run.duration_ms > 0 ? run.duration_ms : undefined);
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
            };
          };
          if (body.data?.output) {
            setOutput(body.data.output);
          }
          if (body.data?.provider || body.data?.model) {
            setProviderModel(`${body.data?.provider ?? "pending"}/${body.data?.model ?? "pending"}`);
          }
          if ("selected_credential" in (body.data ?? {})) {
            setCredentialSummary(formatCredentialSummary(body.data?.selected_credential ?? null));
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
            };
          };
          setOutput(body.data?.output ?? "execution failed");
          if (body.data?.provider || body.data?.model) {
            setProviderModel(`${body.data?.provider ?? "pending"}/${body.data?.model ?? "pending"}`);
          }
          setCredentialSummary(formatCredentialSummary(body.data?.selected_credential ?? null));
          setStatus("error");
        },
        onClose: () => {
          streamRef.current = null;
        },
        onError: () => {
          setStatus("error");
          setError("execution event stream failed");
          streamRef.current = null;
        },
      });
    } catch (err) {
      const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "execution failed";
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
      name:
        workspaceCreateKind === "worktree"
          ? `${activeTab === "code" ? "Code" : "Compute"} Worktree`
          : workspaceCreateKind === "devcontainer"
            ? `${activeTab === "code" ? "Code" : "Compute"} Devcontainer`
          : activeTab === "code"
            ? "Code Runtime"
            : "Compute Runtime",
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
        ? `Isolated worktree created from ${created.baseRef ?? "HEAD"}: ${created.name}`
        : created.kind === "devcontainer"
          ? `Devcontainer created${created.containerConfigPath ? " using detected .devcontainer config" : ""}${created.sourceWorkspaceId ? " from selected source workspace" : ""}: ${created.name}`
        : `Workspace created: ${created.name}`
    );
    syncWorkspaceCursor(0);
    return created.id;
  }, [activeTab, selectedWorkspaceId, workspaceBaseRef, workspaceCreateKind, sourceWorkspaceForContainer?.id, syncWorkspaceCursor, workspaceImage]);

  const handleCreateWorkspace = async () => {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const created = await createWorkspace({
        name:
          workspaceCreateKind === "worktree"
            ? `${activeTab === "code" ? "Code" : "Compute"} Worktree`
            : workspaceCreateKind === "devcontainer"
              ? `${activeTab === "code" ? "Code" : "Compute"} Devcontainer`
            : activeTab === "code"
              ? "Code Runtime"
              : "Compute Runtime",
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
      setWorkspaceLog("No workspace output yet.");
      setWorkspaceNotice(
        created.kind === "worktree"
          ? `Isolated worktree created from ${created.baseRef ?? "HEAD"}: ${created.name}`
          : created.kind === "devcontainer"
            ? `Devcontainer created${created.containerConfigPath ? " using detected .devcontainer config" : ""}${created.sourceWorkspaceId ? " from selected source workspace" : ""}: ${created.name}`
          : `Workspace created: ${created.name}`
      );
    } catch (err) {
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "failed to create workspace");
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
      const result = await spawnWorkspaceSession(workspaceId, {
        command: trimmed,
        shell: workspaceShell.trim() || undefined,
      });
      setWorkspacePolicy(result.policy);
      setWorkspaces((current) => mergeWorkspaceRows(current, result.workspace));
      setSelectedWorkspaceId(result.workspace.id);
      syncWorkspaceCursor(0);
      if (result.requires_approval) {
        await primeWorkspaceTranscriptBoundary(result.workspace.id);
        setWorkspaceLog("Approval pending. Existing workspace output is hidden until this command is approved.");
        setWorkspaceNotice(
          `Approval queued: ${result.action?.title ?? "Workspace command requires approval."} (${result.policy.riskLevel})`
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
          ? `Workspace command started (${result.policy.riskLevel}, auto-run).`
          : `Workspace command started with elevated access (${result.policy.riskLevel}).`
      );
    } catch (err) {
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "failed to run workspace command");
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
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "failed to write to workspace session");
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
      setWorkspaceNotice("Workspace session terminated.");
    } catch (err) {
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "failed to shutdown workspace");
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
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "failed to refresh workspace");
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
      setWorkspaceNotice("Workspace deleted.");
      setWorkspacePolicy(null);
      setWorkspaceLog("No workspace selected.");
      syncWorkspaceCursor(0);
      const next = await refreshWorkspaces();
      setSelectedWorkspaceId(next[0]?.id ?? null);
    } catch (err) {
      setWorkspaceError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "failed to delete workspace");
    } finally {
      setWorkspaceBusy(false);
    }
  };

  return (
    <main className="w-full h-full bg-transparent text-white p-6 flex flex-col">
      <header className="mb-6 border-l-2 border-emerald-500 pl-4">
        <h1 className="text-2xl font-mono font-bold tracking-widest text-emerald-400 flex items-center gap-3">
          <Terminal size={24} /> CODE & COMPUTE WORKBENCH
        </h1>
        <p className="text-sm font-mono text-white/50 tracking-wide mt-1">AI execution runs + approval-gated workspace runtime</p>
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
          <Terminal size={14} /> CODE
        </button>
        <button
          onClick={() => setActiveTab("compute")}
          className={`flex-1 py-2 rounded transition-colors flex justify-center items-center gap-2 ${
            activeTab === "compute"
              ? "bg-amber-500/20 text-amber-500 font-bold border border-amber-500/30"
              : "text-white/50 hover:text-white"
          }`}
        >
          <Cpu size={14} /> COMPUTE
        </button>
      </div>

      <div className="mb-6 p-4 rounded-lg bg-white/5 border border-white/10">
        <p className="text-[10px] font-mono tracking-widest text-white/40 mb-2 uppercase">Prompt</p>
        <textarea
          className="w-full bg-black/40 border border-white/10 rounded-md px-4 py-3 text-sm text-cyan-50 focus:outline-none focus:border-cyan-500/50 resize-none h-24"
          placeholder={activeTab === "code" ? "Paste code task request..." : "Describe compute formula or model..."}
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
            placeholder="model override (optional)"
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
            strict provider
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 px-5 py-2 rounded-md font-mono font-bold text-xs hover:bg-cyan-500/30 transition-all shadow-[0_0_15px_rgba(0,255,255,0.2)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={() => void runExecution()}
            disabled={status === "running" || !prompt.trim()}
          >
            {status === "running" && <Loader2 size={12} className="animate-spin" />}
            RUN
          </button>
          <button
            className="bg-white/5 text-white/75 border border-white/15 px-4 py-2 rounded-md font-mono font-bold text-xs hover:text-cyan-200 hover:border-cyan-500/35 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={routeViaSkill}
            disabled={!prompt.trim()}
          >
            <Sparkles size={12} />
            ROUTE VIA SKILL
          </button>
          <span className="text-xs font-mono text-white/40">Provider: {providerModel}</span>
          <span className="text-xs font-mono text-cyan-300/80">Credential: {credentialSummary}</span>
          <span className="text-xs font-mono text-white/40">Task: {taskId === "-" ? "-" : taskId.slice(0, 8)}</span>
          <span className="text-xs font-mono text-white/40">Run: {runId === "-" ? "-" : runId.slice(0, 8)}</span>
        </div>
        <p className="mt-2 text-xs font-mono text-white/50">
          Requested route: {selectedProvider}/{modelOverride.trim() || "default"} · strict={selectedProvider === "auto" ? "off" : strictProvider ? "on" : "off"}
        </p>
        {error && <p className="mt-2 text-xs font-mono text-red-400">{error}</p>}
        {idempotentReplay && <p className="mt-2 text-xs font-mono text-amber-300">Idempotent replay: existing run was reused.</p>}
      </div>

      <div className="flex-1 overflow-y-auto pr-4 pb-32 scroll-pb-32 space-y-6">
        {activeTab === "code" ? (
          <div className="space-y-6 w-full">
            <div className="flex items-center gap-6 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-sm font-mono text-emerald-100/70">
              <span className="flex items-center gap-2">
                <Database size={14} className="text-emerald-500" /> Database Access: Task sandbox policy
              </span>
              <span className="flex items-center gap-2">
                <ShieldAlert size={14} className="text-emerald-500" /> Network: Provider router policy
              </span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 w-full">
              <CodeExecutionPanel
                language="typescript"
                status={status}
                executionTimeMs={executionTimeMs}
                code={prompt || "// Enter a code task prompt and press RUN"}
                output={output}
              />

              <CodeExecutionPanel
                language="json"
                status={status === "error" ? "error" : "success"}
                executionTimeMs={executionTimeMs}
                code={`{\n  "mode": "${activeTab}",\n  "provider_model": "${providerModel}",\n  "task_id": "${taskId}",\n  "run_id": "${runId}"\n}`}
                output={status === "success" ? "Execution metadata captured." : output}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 w-full">
            <ComputeResultPanel
              formula={prompt || "Enter compute request and press RUN"}
              result={status === "idle" ? "N/A" : truncate(output, 180)}
              confidence={confidence}
            />
            <ComputeResultPanel
              formula="Execution metadata"
              result={`task=${taskId === "-" ? "N/A" : taskId.slice(0, 8)} | run=${runId === "-" ? "N/A" : runId.slice(0, 8)} | provider=${providerModel} | time=${executionTimeMs ?? 0}ms`}
              confidence={Math.max(50, confidence - 10)}
            />
          </div>
        )}

        <section className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-300 flex items-center gap-2">
                <ShieldCheck size={14} /> SAFE WORKSPACE RUNTIME
              </h2>
              <p className="mt-1 text-[11px] font-mono text-white/45">
                Read-only commands run directly. Commands outside the allowlist generate approval proposals for members.
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
                NEW WORKSPACE
              </button>
              <button
                type="button"
                onClick={() => void handleRefreshWorkspace()}
                disabled={workspaceBusy || !selectedWorkspaceId}
                className="inline-flex items-center gap-1 rounded border border-white/15 px-3 py-1.5 text-[11px] font-mono text-white/80 disabled:opacity-50"
              >
                <RefreshCw size={11} />
                REFRESH
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteWorkspace()}
                disabled={workspaceBusy || !selectedWorkspaceId || selectedWorkspace?.status === "running"}
                className="inline-flex items-center gap-1 rounded border border-rose-500/30 px-3 py-1.5 text-[11px] font-mono text-rose-200 disabled:opacity-50"
              >
                <Square size={11} />
                DELETE
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="space-y-3 rounded border border-white/10 bg-black/30 p-3">
              <div className="grid grid-cols-1 gap-2">
                <label className="block text-[10px] font-mono uppercase tracking-[0.3em] text-white/45">
                  Workspace Mode
                </label>
                <select
                  value={workspaceCreateKind}
                  onChange={(event) => setWorkspaceCreateKind(event.target.value as "current" | "worktree" | "devcontainer")}
                  className="w-full rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                >
                  <option value="current">Current repo runtime</option>
                  <option value="worktree">Isolated git worktree</option>
                  <option value="devcontainer">Docker devcontainer</option>
                </select>
                {workspaceCreateKind === "worktree" && (
                  <input
                    type="text"
                    value={workspaceBaseRef}
                    onChange={(event) => setWorkspaceBaseRef(event.target.value)}
                    placeholder="base ref (default HEAD)"
                    className="w-full rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                  />
                )}
                {workspaceCreateKind === "devcontainer" && (
                  <>
                    <input
                      type="text"
                      value={workspaceImage}
                      onChange={(event) => setWorkspaceImage(event.target.value)}
                      placeholder="container image"
                      className="w-full rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                    />
                    <p className="text-[11px] font-mono text-white/45">
                      source mount: {sourceWorkspaceForContainer ? `${sourceWorkspaceForContainer.name} (${sourceWorkspaceForContainer.kind})` : "repository root"}
                    </p>
                  </>
                )}
              </div>
              <label className="block text-[10px] font-mono uppercase tracking-[0.3em] text-white/45">
                Workspace
              </label>
              <select
                value={selectedWorkspaceId ?? ""}
                onChange={(event) => setSelectedWorkspaceId(event.target.value || null)}
                className="w-full rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
              >
                <option value="">Select workspace</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name} · {workspace.kind} · {workspace.status}
                  </option>
                ))}
              </select>
              <div className="rounded border border-white/10 bg-black/30 p-3 text-[11px] font-mono text-white/65">
                {workspaceLoading && <p>Loading runtime state...</p>}
                {!workspaceLoading && !selectedWorkspace && <p>No workspace selected.</p>}
                {selectedWorkspace && (
                  <div className="space-y-1">
                    <p>ID: {selectedWorkspace.id.slice(0, 8)}</p>
                    <p>Kind: {selectedWorkspace.kind}</p>
                    <p>Base ref: {selectedWorkspace.baseRef ?? "-"}</p>
                    <p>Source workspace: {selectedWorkspace.sourceWorkspaceId ? selectedWorkspace.sourceWorkspaceId.slice(0, 8) : "-"}</p>
                    <p>Container image: {selectedWorkspace.containerImage ?? "-"}</p>
                    <p>Container source: {selectedWorkspace.containerSource ?? "-"}</p>
                    <p>Managed image: {selectedWorkspace.containerImageManaged ? "yes" : "no"}</p>
                    <p>Container name: {selectedWorkspace.containerName ?? "-"}</p>
                    <p>Build context: {selectedWorkspace.containerBuildContext ?? "-"}</p>
                    <p>Dockerfile: {selectedWorkspace.containerDockerfile ?? "-"}</p>
                    <p>Features: {selectedWorkspace.containerFeatures.length > 0 ? selectedWorkspace.containerFeatures.join(", ") : "-"}</p>
                    <p>Applied features: {selectedWorkspace.containerAppliedFeatures.length > 0 ? selectedWorkspace.containerAppliedFeatures.join(", ") : "-"}</p>
                    <p>Container workdir: {selectedWorkspace.containerWorkdir ?? "-"}</p>
                    <p>Config path: {selectedWorkspace.containerConfigPath ?? "-"}</p>
                    <p>Run args: {selectedWorkspace.containerRunArgs.length > 0 ? selectedWorkspace.containerRunArgs.join(" ") : "-"}</p>
                    <p>Status: {selectedWorkspace.status}</p>
                    <p>CWD: {selectedWorkspace.cwd}</p>
                    <p>Approval: {selectedWorkspace.approvalRequired ? "required" : "disabled"}</p>
                    <p>Command: {selectedWorkspace.activeCommand ?? "-"}</p>
                    <p>Exit: {selectedWorkspace.exitCode ?? "-"}</p>
                    {selectedWorkspace.containerWarnings.length > 0 && (
                      <p>Config warnings: {selectedWorkspace.containerWarnings.join(" | ")}</p>
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
                USE PROMPT AS SHELL COMMAND
              </button>
            </div>

            <div className="space-y-3 rounded border border-white/10 bg-black/30 p-3">
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_160px]">
                <input
                  type="text"
                  value={workspaceCommand}
                  onChange={(event) => setWorkspaceCommand(event.target.value)}
                  placeholder="pwd | git status | rg TODO src"
                  className="rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                />
                <input
                  type="text"
                  value={workspaceShell}
                  onChange={(event) => setWorkspaceShell(event.target.value)}
                  placeholder="shell override"
                  className="rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleRunWorkspaceCommand()}
                  disabled={workspaceBusy || !workspaceCommand.trim()}
                  className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-mono text-cyan-200 disabled:opacity-50"
                >
                  {workspaceBusy ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />}
                  RUN COMMAND
                </button>
                <button
                  type="button"
                  onClick={() => void handleShutdownWorkspace()}
                  disabled={workspaceBusy || !selectedWorkspaceId || selectedWorkspace?.status !== "running"}
                  className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[11px] font-mono text-rose-200 disabled:opacity-50"
                >
                  <Square size={11} />
                  STOP
                </button>
                <span className="text-[11px] font-mono text-white/45">
                  Auto-run: read-only everywhere, build inside devcontainers. Role-gated on host current runtime: write, network, process control, unknown.
                </span>
              </div>
              {workspacePolicy && (
                <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3 text-[11px] font-mono text-cyan-100/80">
                  <p>risk: {workspacePolicy.riskLevel}</p>
                  <p>impact profile: {workspacePolicy.impactProfile}</p>
                  <p>severity: {workspacePolicy.severity}</p>
                  <p>policy: {workspacePolicy.disposition}</p>
                  <p>reason: {workspacePolicy.reason}</p>
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">estimated impact</p>
                    <WorkspaceImpactRow label="files" dimension={workspacePolicy.impact.files} />
                    <WorkspaceImpactRow label="network" dimension={workspacePolicy.impact.network} />
                    <WorkspaceImpactRow label="processes" dimension={workspacePolicy.impact.processes} />
                    {workspacePolicy.impact.notes.length > 0 && (
                      <div className="rounded border border-white/10 bg-black/20 p-2 text-[10px] text-white/55">
                        notes: {workspacePolicy.impact.notes.join(" ")}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {workspaceError && <p className="text-xs font-mono text-rose-300">{workspaceError}</p>}
              {workspaceNotice && <p className="text-xs font-mono text-cyan-200">{workspaceNotice}</p>}
              <div className="rounded border border-white/10 bg-[#020617] p-3">
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[11px] font-mono leading-5 text-cyan-50">
                  {workspaceLog}
                </pre>
              </div>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  type="text"
                  value={workspaceStdIn}
                  onChange={(event) => setWorkspaceStdIn(event.target.value)}
                  placeholder="stdin payload"
                  className="rounded border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/90"
                />
                <button
                  type="button"
                  onClick={() => void handleWriteStdIn()}
                  disabled={workspaceBusy || !selectedWorkspaceId || selectedWorkspace?.status !== "running" || !workspaceStdIn.trim()}
                  className="rounded border border-white/15 px-3 py-2 text-[11px] font-mono text-white/80 disabled:opacity-50"
                >
                  WRITE STDIN
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
