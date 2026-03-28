"use client";

import React, { useMemo, useState } from "react";
import { AgentArgumentCard } from "@/components/ui/AgentArgumentCard";
import { CouncilConsensusPanel } from "@/components/ui/CouncilConsensusPanel";
import { RunnerGraphSummaryPanel } from "@/components/modules/RunnerGraphSummaryPanel";
import { Network, AlertCircle, Loader2 } from "lucide-react";

import { getCouncilRun, getJarvisSession, listProviderModels, listProviders, startCouncilRun, streamCouncilRunEvents } from "@/lib/api/endpoints";
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
  JarvisSessionDetail,
  RuntimeResolvedRoute,
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

function describeRouteSourceKey(source: RuntimeResolvedRoute["source"]) {
  if (source === "request_override") return "providerRoute.source.request_override" as const;
  if (source === "feature_preference") return "providerRoute.source.feature_preference" as const;
  if (source === "global_default") return "providerRoute.source.global_default" as const;
  if (source === "auto") return "providerRoute.source.auto" as const;
  return "providerRoute.source.runtime_result" as const;
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

export function CouncilModule() {
  const { t } = useLocale();
  const { startSession, linkSessionTask, openWidgets, sessions } = useHUD();
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
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [jarvisSessionDetail, setJarvisSessionDetail] = useState<JarvisSessionDetail | null>(null);
  const [idempotentReplay, setIdempotentReplay] = useState(false);
  const [providerAttempts, setProviderAttempts] = useState<ProviderAttempt[]>([]);
  const [lastExcludedProviders, setLastExcludedProviders] = useState<ProviderAttempt["provider"][]>([]);
  const [selectedCredentialSummary, setSelectedCredentialSummary] = useState<string>("pending");
  const [resolvedRoute, setResolvedRoute] = useState<RuntimeResolvedRoute | null>(null);
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
  const councilSessionStateLabel = useMemo(() => {
    if (error) return t("council.session.state.failed");
    if (running) return t("council.session.state.running");
    if (rounds > 0) return t("council.session.state.ready");
    return t("council.session.state.ready");
  }, [error, rounds, running, t]);
  const councilPhase = useMemo(() => {
    if (!running && rounds === 0 && providerAttempts.length === 0 && !hasResult) {
      return null;
    }
    if (!running && hasResult) {
      return "synthesis" as const;
    }
    if (providerAttempts.length === 0 && rounds <= 1) {
      return "framing" as const;
    }
    if (rounds <= 1) {
      return "pros" as const;
    }
    if (providerFailures.length > 0 || rounds === 2) {
      return "risks" as const;
    }
    return "synthesis" as const;
  }, [hasResult, providerAttempts.length, providerFailures.length, rounds, running]);
  const councilStages = useMemo(
    () =>
      (["framing", "pros", "risks", "synthesis"] as const).map((phase) => {
        const index = ["framing", "pros", "risks", "synthesis"].indexOf(phase);
        const currentIndex = councilPhase ? ["framing", "pros", "risks", "synthesis"].indexOf(councilPhase) : -1;
        return {
          phase,
          complete: currentIndex > index || (!running && hasResult && phase === "synthesis"),
          active: councilPhase === phase,
        };
      }),
    [councilPhase, hasResult, running]
  );
  const councilLatestNote = useMemo(() => {
    if (providerFailures.length > 0) {
      const latestFailure = providerFailures[providerFailures.length - 1];
      return latestFailure?.error ?? `${latestFailure?.provider ?? "provider"} ${latestFailure?.status ?? "update"}`;
    }
    return summary;
  }, [providerFailures, summary]);
  const councilNextStep = useMemo(() => {
    if (councilPhase === "framing") return t("council.phase.next.framing");
    if (councilPhase === "pros") return t("council.phase.next.pros");
    if (councilPhase === "risks") return t("council.phase.next.risks");
    if (councilPhase === "synthesis") return t("council.phase.next.synthesis");
    return null;
  }, [councilPhase, t]);
  const sessionStageRecords = useMemo(
    () => [...(jarvisSessionDetail?.stages ?? [])].sort((left, right) => left.orderIndex - right.orderIndex),
    [jarvisSessionDetail?.stages]
  );

  React.useEffect(() => {
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
    resolved_route?: RuntimeResolvedRoute | null;
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
    if (result.resolved_route) {
      setResolvedRoute(result.resolved_route);
    }

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
    setResolvedRoute(null);

    const clientSessionId = startSession(prompt, {
      activeWidgets: ["council", "tasks"],
      mountedWidgets: ["council", "tasks"],
      focusedWidget: "council",
      intent: "council",
      restoreMode: "full",
    });
    setCurrentSessionId(clientSessionId);
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
      if (result.session?.id) {
        setCurrentSessionId(result.session.id);
      }
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
  }, [applyCouncilResult, attachCouncilStream, linkSessionTask, modelOverride, query, running, selectedProvider, startSession, strictProvider, t]);

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

  return (
    <main className="w-full h-full relative overflow-hidden bg-transparent text-white flex">
      <div className="relative z-10 w-full h-full p-6 flex flex-col">
        <header className="mb-6 border-l-2 border-purple-500 pl-4">
          <h1 className="text-2xl font-mono font-bold tracking-widest text-purple-400 flex items-center gap-3">
            <Network size={24} /> {t("council.title").toUpperCase()}
          </h1>
          <p className="text-sm font-mono text-white/50 tracking-wide mt-1">{t("council.subtitle").toUpperCase()}</p>
        </header>

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
                  <span className="rounded-full border border-purple-500/25 bg-purple-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-purple-200">
                    {councilSessionStateLabel}
                  </span>
                </div>
                <p className="mt-2 text-sm font-mono text-cyan-100">{truncate(currentSession.prompt, 180)}</p>
                <p className="mt-1 text-[11px] font-mono text-white/60">
                  {t("common.session")} {currentSession.id.slice(0, 8)}
                  {sessionAgeLabel ? ` · ${t("assistant.startedAgo", { value: sessionAgeLabel })}` : ""}
                  {lastTaskId ? ` · ${t("council.session.taskLinked", { value: lastTaskId.slice(0, 8) })}` : ""}
                </p>
                <p className="mt-2 text-[11px] text-white/55">{t("council.session.mirrored")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openWidgets(["council", "tasks"], { focus: "tasks", replace: false, activate: "focus_only" })}
                  className="rounded border border-white/15 px-3 py-1.5 text-[11px] font-mono text-white/80 transition hover:border-cyan-400/40 hover:text-cyan-200"
                >
                  {t("common.openTaskManager")}
                </button>
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
                          key={`council-capability-${capability}`}
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
                      return (
                        <span
                          key={stage.id}
                          className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-mono text-white/75"
                        >
                          {(describeCapabilityKey(stage.capability) ? t(describeCapabilityKey(stage.capability)!) : stage.title)} ·{" "}
                          {statusKey ? t(statusKey) : stage.status}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {jarvisSessionDetail && (
              <div className="mt-4">
                <RunnerGraphSummaryPanel
                  detail={jarvisSessionDetail.runner_detail ?? null}
                  emptyMessage={t("actionCenter.runner.empty")}
                  className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3"
                />
              </div>
            )}
          </div>
        )}

        <div className="bg-black/40 border border-white/10 p-4 rounded-lg mb-6 font-mono text-sm border-l-4 border-l-cyan-500">
          {councilPhase && (
            <div className="mb-4 rounded border border-white/10 bg-black/35 p-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {councilStages.map((stage) => (
                  <div
                    key={stage.phase}
                    className={`rounded border px-3 py-2 text-[10px] uppercase tracking-[0.24em] ${
                      stage.active
                        ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100"
                        : stage.complete
                          ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                          : "border-white/10 bg-black/20 text-white/40"
                    }`}
                  >
                    {t(`council.phase.${stage.phase}` as const)}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-white/65">{t("council.phase.latestNote")}: {councilLatestNote}</p>
              {councilNextStep ? <p className="mt-1 text-[11px] text-cyan-200/80">{councilNextStep}</p> : null}
            </div>
          )}
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
          <p className="mt-2 text-xs text-white/60">{requestedRouteSummary}</p>
          {resolvedRouteSummary ? <p className="mt-1 text-xs text-cyan-200/80">{resolvedRouteSummary}</p> : null}
          <p className="mt-2 text-xs text-cyan-200/80">
            {t("council.credential")}:{" "}
            {selectedCredentialSummary === "pending"
              ? t("workbench.pending")
              : selectedCredentialSummary === "none"
                ? t("common.none")
                : selectedCredentialSummary}
          </p>
          {pinnedRouteWarning ? <p className="mt-2 text-xs text-amber-300">{pinnedRouteWarning}</p> : null}
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
