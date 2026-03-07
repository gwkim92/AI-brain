"use client";

import React, { useMemo, useState } from "react";
import { AgentArgumentCard } from "@/components/ui/AgentArgumentCard";
import { CouncilConsensusPanel } from "@/components/ui/CouncilConsensusPanel";
import { Network, AlertCircle, Loader2 } from "lucide-react";

import { getCouncilRun, listProviderModels, listProviders, startCouncilRun, streamCouncilRunEvents } from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/client";
import { useHUD } from "@/components/providers/HUDProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { subscribeCouncilIntake } from "@/lib/hud/council-intake";
import { dispatchJarvisDataRefresh } from "@/lib/hud/data-refresh";
import type { AgentRole } from "@/components/ui/AgentArgumentCard";
import type {
  CouncilConsensusStatus,
  CouncilRole,
  ProviderAttempt,
  ProviderAvailability,
  ProviderModelCatalogEntry,
} from "@/lib/api/types";

type ConsensusStatus = "Consensus Reached" | "Contradiction Detected" | "Escalated to Human";

type CouncilCard = {
  role: AgentRole;
  stance: "support" | "oppose" | "neutral" | "warning";
  confidence: number;
  argument: string;
};

const ROLES: AgentRole[] = ["Planner", "Researcher", "Critic", "Risk", "Synthesizer"];

const ROLE_MAP: Record<CouncilRole, AgentRole> = {
  planner: "Planner",
  researcher: "Researcher",
  critic: "Critic",
  risk: "Risk",
  synthesizer: "Synthesizer",
};

type ProviderSelection = "auto" | "openai" | "gemini" | "anthropic" | "local";

const CONSENSUS_MAP: Record<CouncilConsensusStatus, ConsensusStatus> = {
  consensus_reached: "Consensus Reached",
  contradiction_detected: "Contradiction Detected",
  escalated_to_human: "Escalated to Human",
};

function truncate(value: string, max = 220): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function confidenceFrom(status: "success" | "failed" | "skipped", latencyMs?: number): number {
  if (status === "success") {
    return Math.min(95, 75 + Math.round((latencyMs ?? 0) / 90));
  }
  if (status === "failed") return 40;
  return 55;
}

function attemptStatusClass(status: ProviderAttempt["status"]): string {
  if (status === "success") return "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";
  if (status === "failed") return "text-red-300 border-red-500/30 bg-red-500/10";
  return "text-amber-300 border-amber-500/30 bg-amber-500/10";
}

function parseRoundProgress(summary: string): { round: number; maxRounds: number } | null {
  const match = summary.match(/^Round\s+(\d+)\/(\d+)\s+complete:/u);
  if (!match) return null;
  const round = Number.parseInt(match[1] ?? "", 10);
  const maxRounds = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(round) || !Number.isFinite(maxRounds) || round <= 0 || maxRounds <= 0) {
    return null;
  }
  return { round, maxRounds };
}

function parseRoundLogCount(summary: string): number | null {
  const marker = "Round log:\n";
  const markerIndex = summary.indexOf(marker);
  if (markerIndex < 0) return null;

  const logSection = summary.slice(markerIndex + marker.length);
  const matches = logSection.match(/^\d+\.\s+/gmu);
  if (!matches || matches.length === 0) return null;
  return matches.length;
}

export function CouncilModule() {
  const { t } = useLocale();
  const { startSession, linkSessionTask } = useHUD();
  const defaultCards = React.useMemo<CouncilCard[]>(
    () =>
      ROLES.map((role) => ({
        role,
        stance: "neutral",
        confidence: 50,
        argument: t("council.waiting"),
      })),
    [t]
  );
  const streamRef = React.useRef<ReturnType<typeof streamCouncilRunEvents> | null>(null);
  const [query, setQuery] = useState(() => t("council.queryDefault"));
  const [cards, setCards] = useState<CouncilCard[]>(defaultCards);
  const [summary, setSummary] = useState(() => t("council.summary.idle"));
  const [status, setStatus] = useState<ConsensusStatus>("Escalated to Human");
  const [rounds, setRounds] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTaskId, setLastTaskId] = useState<string | null>(null);
  const [idempotentReplay, setIdempotentReplay] = useState(false);
  const [providerAttempts, setProviderAttempts] = useState<ProviderAttempt[]>([]);
  const [lastExcludedProviders, setLastExcludedProviders] = useState<ProviderAttempt["provider"][]>([]);
  const [selectedCredentialSummary, setSelectedCredentialSummary] = useState<string>("pending");
  const [providers, setProviders] = useState<ProviderAvailability[]>([]);
  const [providerModelCatalog, setProviderModelCatalog] = useState<ProviderModelCatalogEntry[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderSelection>("auto");
  const [strictProvider, setStrictProvider] = useState(false);
  const [modelOverride, setModelOverride] = useState("");

  const hasResult = useMemo(() => rounds > 0, [rounds]);
  const providerFailures = useMemo(
    () => providerAttempts.filter((attempt) => attempt.status === "failed" || attempt.status === "skipped"),
    [providerAttempts]
  );
  const retryExcludedProviders = useMemo(
    () => Array.from(new Set(providerFailures.map((attempt) => attempt.provider))),
    [providerFailures]
  );
  const canRetryExcludingFailures = useMemo(() => retryExcludedProviders.length > 0 && retryExcludedProviders.length < 4, [retryExcludedProviders]);
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

  React.useEffect(() => {
    if (!running && rounds === 0 && providerAttempts.length === 0) {
      setCards(defaultCards);
      setSummary(t("council.summary.idle"));
    }
  }, [defaultCards, providerAttempts.length, rounds, running, t]);

  React.useEffect(() => {
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

  React.useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

  const applyCouncilResult = React.useCallback((result: {
    summary: string;
    status: "queued" | "running" | "completed" | "failed";
    consensus_status: CouncilConsensusStatus | null;
    attempts: ProviderAttempt[];
    selected_credential?: {
      source: string;
      selected_credential_mode: string | null;
      credential_priority: string;
    } | null;
    task_id: string | null;
    participants: Array<{
      role: CouncilRole;
      status: "success" | "failed" | "skipped";
      summary: string;
      error?: string;
      latency_ms?: number;
    }>;
  }) => {
    const credentialSummary = result.selected_credential?.selected_credential_mode
      ? `${result.selected_credential.selected_credential_mode} (${result.selected_credential.source}) · ${result.selected_credential.credential_priority}`
      : "none";

    if (result.status === "queued" || result.status === "running") {
      const progress = parseRoundProgress(result.summary);
      setCards(
        ROLES.map((role) => ({
          role,
          stance: "neutral",
          confidence: 50,
          argument: t("council.running"),
        }))
      );
      setStatus("Escalated to Human");
      setRounds(progress?.round ?? 1);
      setSummary(result.summary || t("council.summary.running"));
      setLastTaskId(result.task_id);
      setProviderAttempts(result.attempts);
      setSelectedCredentialSummary(credentialSummary);
      return;
    }

    const mappedCards: CouncilCard[] = result.participants.map((participant) => {
      const role = ROLE_MAP[participant.role];
      const stance =
        participant.role === "synthesizer"
          ? "neutral"
          : participant.status === "success"
            ? "support"
            : participant.status === "failed"
              ? "oppose"
              : "warning";

      const argument =
        participant.status === "success"
          ? participant.summary
          : participant.error
            ? `${participant.summary} ${truncate(participant.error, 160)}`
            : participant.summary;

      return {
        role,
        stance,
        confidence: confidenceFrom(participant.status, participant.latency_ms),
        argument: truncate(argument, 220),
      };
    });

    setCards(mappedCards);
    setStatus(result.consensus_status ? CONSENSUS_MAP[result.consensus_status] : "Escalated to Human");
    setRounds(
      parseRoundLogCount(result.summary) ??
        parseRoundProgress(result.summary)?.round ??
        Math.max(1, Math.min(5, result.attempts.length || 1))
    );
    setSummary(result.summary);
    setLastTaskId(result.task_id);
    setProviderAttempts(result.attempts);
    setSelectedCredentialSummary(credentialSummary);
  }, [t]);

  const attachCouncilStream = React.useCallback((runId: string) => {
    streamRef.current?.close();
    streamRef.current = streamCouncilRunEvents(runId, {
      onRoundStarted: (payload) => {
        if (payload && typeof payload === "object" && "round" in payload) {
          const data = payload as { round: number; max_rounds: number };
          setRounds((current) => Math.max(current, data.round));
          setSummary(`Round ${data.round}/${data.max_rounds} in progress...`);
        }
      },
      onAgentResponded: (payload) => {
        if (payload && typeof payload === "object" && "attempt" in payload) {
          const data = payload as { attempt: ProviderAttempt; agent_index?: number };
          setProviderAttempts((current) => {
            if (typeof data.agent_index === "number") {
              if (data.agent_index <= 0) return current;
              const next = [...current];
              next[data.agent_index - 1] = data.attempt;
              return next;
            }
            return [...current, data.attempt];
          });
        }
      },
      onRoundCompleted: (payload) => {
        if (payload && typeof payload === "object" && "round" in payload && "summary" in payload) {
          const data = payload as { round: number; summary: string };
          setRounds((current) => Math.max(current, data.round));
          setSummary(data.summary);
        }
      },
      onUpdated: (payload) => {
        if (!payload || typeof payload !== "object" || !("data" in payload)) return;
        const body = payload as { data?: Parameters<typeof applyCouncilResult>[0] };
        if (body.data) {
          applyCouncilResult(body.data);
        }
      },
      onCompleted: (payload) => {
        if (!payload || typeof payload !== "object" || !("data" in payload)) return;
        const body = payload as { data?: Parameters<typeof applyCouncilResult>[0] };
        if (body.data) {
          applyCouncilResult(body.data);
        }
        setRunning(false);
      },
      onFailed: (payload) => {
        if (!payload || typeof payload !== "object" || !("data" in payload)) return;
        const body = payload as { data?: Parameters<typeof applyCouncilResult>[0] };
        if (body.data) {
          applyCouncilResult(body.data);
        }
        setRunning(false);
      },
      onClose: () => {
        streamRef.current = null;
        setRunning(false);
      },
      onError: () => {
        setError(t("council.error.streamFailed"));
        streamRef.current = null;
        setRunning(false);
      },
    });
  }, [applyCouncilResult, t]);

  React.useEffect(() => {
    return subscribeCouncilIntake((payload) => {
      setQuery(payload.prompt);
      setLastTaskId(payload.taskId ?? null);
      setError(null);
      setRunning(true);
      setIdempotentReplay(false);
      void (async () => {
        try {
          const run = await getCouncilRun(payload.runId);
          applyCouncilResult(run);
          if (run.status === "completed" || run.status === "failed") {
            setRunning(false);
            return;
          }
          attachCouncilStream(run.id);
        } catch (err) {
          if (err instanceof ApiRequestError) {
            setError(`${err.code}: ${err.message}`);
          } else {
            setError(t("council.error.loadRunFailed"));
          }
          setRunning(false);
        }
      })();
    });
  }, [attachCouncilStream, applyCouncilResult, t]);

  const runCouncil = React.useCallback(async (
    createTask: boolean,
    options?: {
      excludeProviders?: ProviderAttempt["provider"][];
    }
  ) => {
    const prompt = query.trim();
    if (!prompt || running) return;

    setRunning(true);
    setError(null);
    setIdempotentReplay(false);
    setProviderAttempts([]);
    setLastExcludedProviders(options?.excludeProviders ?? []);
    setSelectedCredentialSummary("pending");

    const clientSessionId = startSession(prompt, {
      activeWidgets: ["council", "tasks"],
      mountedWidgets: ["council", "tasks"],
      focusedWidget: "council",
      intent: "council",
      restoreMode: "full",
    });
    dispatchJarvisDataRefresh({ scope: "sessions", source: "council" });

    try {
      const payload: Parameters<typeof startCouncilRun>[0] = {
        client_session_id: clientSessionId,
        question: prompt,
        exclude_providers: options?.excludeProviders,
        create_task: createTask,
      };
      if (selectedProvider !== "auto") {
        payload.provider = selectedProvider;
        payload.strict_provider = strictProvider;
      }
      const model = modelOverride.trim();
      if (model.length > 0) {
        payload.model = model;
      }

      const result = await startCouncilRun(payload);
      setIdempotentReplay(result.idempotent_replay === true);

      if (result.task_id) {
        linkSessionTask(clientSessionId, result.task_id);
        dispatchJarvisDataRefresh({ scope: "tasks", source: "council" });
      }

      applyCouncilResult(result);

      if (result.status === "completed" || result.status === "failed") {
        setRunning(false);
        return;
      }

      attachCouncilStream(result.id);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("council.error.runFailed"));
      }
      setStatus("Escalated to Human");
      setRounds(1);
      setSummary(t("council.summary.failed"));
      setLastTaskId(null);
      setIdempotentReplay(false);
      setProviderAttempts([]);
      setSelectedCredentialSummary("none");
    } finally {
      if (streamRef.current === null) {
        setRunning(false);
      }
    }
  }, [applyCouncilResult, attachCouncilStream, modelOverride, query, running, selectedProvider, strictProvider, t]);

  return (
    <main className="w-full h-full relative overflow-hidden bg-transparent text-white flex">
      <div className="relative z-10 w-full h-full p-6 flex flex-col">
        <header className="mb-6 border-l-2 border-purple-500 pl-4">
          <h1 className="text-2xl font-mono font-bold tracking-widest text-purple-400 flex items-center gap-3">
            <Network size={24} /> {t("council.title").toUpperCase()}
          </h1>
          <p className="text-sm font-mono text-white/50 tracking-wide mt-1">{t("council.subtitle").toUpperCase()}</p>
        </header>

        <div className="bg-black/40 border border-white/10 p-4 rounded-lg mb-6 font-mono text-sm border-l-4 border-l-cyan-500">
          <span className="text-white/40 mr-2">{t("council.query")}:</span>
          <textarea
            className="mt-3 w-full bg-black/50 border border-white/10 rounded p-3 text-sm text-white resize-none h-24"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[180px_minmax(0,1fr)_auto]">
            <select
              value={selectedProvider}
              onChange={(event) => setSelectedProvider(event.target.value as ProviderSelection)}
              className="h-9 rounded border border-white/15 bg-black/50 px-2 text-xs text-white/90"
            >
              {providerOptions.map((option) => (
                <option key={`council-provider-${option.provider}`} value={option.provider} disabled={!option.enabled}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              list="council-model-catalog"
              type="text"
              value={modelOverride}
              onChange={(event) => setModelOverride(event.target.value)}
              placeholder={t("council.modelOverridePlaceholder")}
              className="h-9 rounded border border-white/15 bg-black/50 px-3 text-xs text-white/90"
            />
            <datalist id="council-model-catalog">
              {selectedProviderModels.map((modelName) => (
                <option key={`council-model-${modelName}`} value={modelName} />
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
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => void runCouncil(false)}
              disabled={running || !query.trim()}
              className="bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs py-2 px-4 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {running && <Loader2 size={12} className="animate-spin" />}
              {t("council.run")}
            </button>
            <button
              onClick={() => void runCouncil(true)}
              disabled={running || !query.trim()}
              className="bg-white/10 hover:bg-white/20 text-white font-mono font-bold text-xs py-2 px-4 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("council.runTask")}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          {lastTaskId && <p className="mt-2 text-xs text-cyan-300">{t("council.taskQueued", { value: lastTaskId.slice(0, 8) })}</p>}
          <p className="mt-2 text-xs text-white/60">
            {t("council.requestedRoute", {
              provider: selectedProvider,
              model: modelOverride.trim() || t("council.defaultModel"),
              strict: selectedProvider === "auto" ? t("common.off") : strictProvider ? t("common.on") : t("common.off"),
            })}
          </p>
          <p className="mt-2 text-xs text-cyan-200/80">
            {t("council.credential")}:{" "}
            {selectedCredentialSummary === "pending"
              ? t("workbench.pending")
              : selectedCredentialSummary === "none"
                ? t("common.none")
                : selectedCredentialSummary}
          </p>
          {lastExcludedProviders.length > 0 && (
            <p className="mt-2 text-xs text-amber-300">{t("council.excludedProviders", { value: lastExcludedProviders.join(", ") })}</p>
          )}
          {idempotentReplay && <p className="mt-2 text-xs text-amber-300">{t("council.idempotentReplay")}</p>}
        </div>

        <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden pb-8 relative lg:pr-4">
          <div className="flex-[7] grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-4 auto-rows-min overflow-y-auto pr-2">
            {cards.map((card) => (
              <AgentArgumentCard
                key={card.role}
                role={card.role}
                stance={card.stance}
                confidence={card.confidence}
                argument={card.argument}
              />
            ))}
          </div>

          <div className="flex-[3] flex flex-col gap-6 overflow-y-auto lg:overflow-visible">
            <CouncilConsensusPanel status={status} rounds={rounds} summary={summary} />

            <div className="glass-panel p-5 rounded-lg border-l-4 border-red-500">
              <h4 className="font-mono text-xs font-bold text-red-400 tracking-widest mb-2">{t("council.providerFailureReasons")}</h4>
              {providerAttempts.length === 0 ? (
                <p className="text-xs text-white/55">{t("council.noProviderAttempts")}</p>
              ) : providerFailures.length === 0 ? (
                <p className="text-xs text-emerald-300">{t("council.noProviderFailures")}</p>
              ) : (
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {providerFailures.map((attempt, index) => (
                    <div key={`${attempt.provider}-${index}`} className={`rounded border p-2 ${attemptStatusClass(attempt.status)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono font-bold uppercase">{attempt.provider}</span>
                        <span className="text-[10px] font-mono uppercase tracking-wide">
                          {attempt.status}
                          {typeof attempt.latencyMs === "number" ? ` · ${attempt.latencyMs}ms` : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-white/85">{truncate(attempt.error ?? t("council.noErrorReason"), 160)}</p>
                      {attempt.credential?.selectedCredentialMode && (
                        <p className="mt-1 text-[10px] text-cyan-100/80">
                          {t("council.credential")} {attempt.credential.selectedCredentialMode} ({attempt.credential.source}) · {attempt.credential.credentialPriority}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <button
                className="mt-3 w-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 font-mono font-bold text-[11px] py-2 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => void runCouncil(false, { excludeProviders: retryExcludedProviders })}
                disabled={running || !query.trim() || !canRetryExcludingFailures}
              >
                {t("council.retryExcludingFailed")}
              </button>
              {!canRetryExcludingFailures && providerFailures.length > 0 && (
                <p className="mt-2 text-[11px] text-red-300/90">
                  {t("council.cannotReroute")}
                </p>
              )}
            </div>

            <div className="glass-panel p-5 rounded-lg border-l-4 border-amber-500">
              <h4 className="font-mono text-xs font-bold text-amber-500 tracking-widest mb-2 flex items-center gap-2">
                <AlertCircle size={14} /> {t("council.recommendedAction")}
              </h4>
              <p className="text-sm text-white/80 mb-4">
                {hasResult
                  ? t("council.recommendedActionReady")
                  : t("council.recommendedActionIdle")}
              </p>
              <button
                className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs py-2 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => void runCouncil(true)}
                disabled={!query.trim() || running}
              >
                {t("council.initiateFollowup")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
