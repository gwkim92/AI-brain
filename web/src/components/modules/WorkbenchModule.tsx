"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CodeExecutionPanel } from "@/components/ui/CodeExecutionPanel";
import { ComputeResultPanel } from "@/components/ui/ComputeResultPanel";
import { Terminal, Database, ShieldAlert, Cpu, Loader2 } from "lucide-react";

import { listProviderModels, listProviders, startExecutionRun, streamExecutionRunEvents } from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/client";
import type { ProviderAvailability, ProviderModelCatalogEntry } from "@/lib/api/types";

type ProviderSelection = "auto" | "openai" | "gemini" | "anthropic" | "local";

function truncate(value: string, max = 220): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export function WorkbenchModule() {
  const streamRef = useRef<ReturnType<typeof streamExecutionRunEvents> | null>(null);
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

  useEffect(() => {
    void (async () => {
      try {
        const [providerData, modelData] = await Promise.all([
          listProviders(),
          listProviderModels({ scope: "user" }).catch(() => ({ providers: [] })),
        ]);
        setProviders(providerData.providers ?? []);
        setProviderModelCatalog(modelData.providers ?? []);
      } catch {
        setProviders([]);
        setProviderModelCatalog([]);
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

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

  return (
    <main className="w-full h-full bg-transparent text-white p-6 flex flex-col">
      <header className="mb-6 border-l-2 border-emerald-500 pl-4">
        <h1 className="text-2xl font-mono font-bold tracking-widest text-emerald-400 flex items-center gap-3">
          <Terminal size={24} /> CODE & COMPUTE WORKBENCH
        </h1>
        <p className="text-sm font-mono text-white/50 tracking-wide mt-1">DEDICATED EXECUTION RUN API</p>
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
        <div className="mt-3 flex items-center gap-3">
          <button
            className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 px-5 py-2 rounded-md font-mono font-bold text-xs hover:bg-cyan-500/30 transition-all shadow-[0_0_15px_rgba(0,255,255,0.2)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={() => void runExecution()}
            disabled={status === "running" || !prompt.trim()}
          >
            {status === "running" && <Loader2 size={12} className="animate-spin" />}
            RUN
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

      <div className="flex-1 overflow-y-auto pr-4 pb-8">
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
                code={`{\n  \"mode\": \"${activeTab}\",\n  \"provider_model\": \"${providerModel}\",\n  \"task_id\": \"${taskId}\",\n  \"run_id\": \"${runId}\"\n}`}
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
      </div>
    </main>
  );
}
