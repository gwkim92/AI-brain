"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ToolCallTimeline, ToolCall } from "@/components/ui/ToolCallTimeline";
import { EvidencePanel, Evidence } from "@/components/ui/EvidencePanel";
import { Send, Sparkles, BrainCircuit } from "lucide-react";
import {
    aiRespond,
    appendAssistantContextEvent,
    createAssistantContext,
    getAssistantContextGroundingEvidence,
    listTasks,
    listAssistantContexts,
    listAssistantContextEvents,
    listProviderModels,
    listProviders,
    runAssistantContext,
    streamAssistantContextEvents,
    type AssistantContextEventsStream,
    updateAssistantContext,
} from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/client";
import {
    buildProviderUnavailableMessage,
    isBlockedQualityOutput,
    isQualityGuardFallbackOutput,
    mapBlockedReasonLabel,
    parseBlockedReasons,
    resolveProviderUnavailableReason,
    type ProviderUnavailableReason,
} from "@/components/modules/assistant/message-quality";
import {
    mergeAutoContexts,
    mergeAutoMissionEvents,
    toAutoContextFromServer,
    toAutoMissionEvent,
    type AutoMissionContext,
    type AutoMissionEvent,
} from "@/components/modules/assistant/auto-context";
import type {
    AssistantFeedbackEventData,
    AssistantFeedbackSignal,
    AssistantRenderMode,
    AiRespondData,
    AssistantContextGroundingClaimRecord,
    AssistantContextGroundingSourceRecord,
    AssistantContextRecord,
    ProviderAvailability,
    ProviderModelCatalogEntry,
} from "@/lib/api/types";
import { subscribeMissionIntake, subscribeMissionIntakeTaskLink, type MissionIntakePayload } from "@/lib/hud/mission-intake";
import { useHUD } from "@/components/providers/HUDProvider";

type MessageRoute = "system" | "manual" | "auto_context";

type ChatMessage = {
    role: "user" | "assistant";
    content: string;
    status?: string;
    contextId?: string;
    route?: MessageRoute;
    promptRef?: string;
    grounding?: {
        policy: "static" | "dynamic_factual" | "high_risk_factual";
        required: boolean;
        status: "not_required" | "provider_only" | "required_unavailable" | "blocked_due_to_quality_gate";
        reasons: string[];
        sources?: Array<{
            url: string;
            title: string;
            domain: string;
        }>;
        claims?: Array<{
            claimText: string;
            sourceUrls: string[];
            citations?: Array<{
                url: string;
                title: string;
                domain: string;
            }>;
        }>;
    };
};

type ProviderSelection = "auto" | "openai" | "gemini" | "anthropic" | "local";

type RunRecord = {
    id: string;
    label: string;
    status: "running" | "success" | "error";
    requestedProvider: ProviderSelection;
    requestedModel: string | null;
    strictProvider: boolean;
    servedProvider?: string;
    servedModel?: string;
    usedFallback?: boolean;
    selectionStrategy?: string;
    selectionReason?: string;
    selectionOrder?: string[];
    output: string;
    attempts: ToolCall[];
    error?: string;
};

type AutoMissionEventFilter = "all" | "accepted" | "started" | "completed" | "failed";
type AutoMissionFeedbackDimension = "answer" | "source";
type AutoMissionFeedbackDraft = {
    answerQuality?: AssistantFeedbackSignal;
    sourceQuality?: AssistantFeedbackSignal;
    comment: string;
    submitting: boolean;
    submitted: boolean;
    error?: string;
};

type AutoMissionQualityState = {
    degraded: boolean;
    reason?: string;
};

function formatAssistantFailureMessage(
    error: unknown,
    fallbackMessage: string
): { message: string; reason: ProviderUnavailableReason | null } {
    if (!(error instanceof ApiRequestError)) {
        return { message: fallbackMessage, reason: null };
    }

    const reason = resolveProviderUnavailableReason(error.details);
    if (reason) {
        return {
            message: buildProviderUnavailableMessage(reason),
            reason,
        };
    }

    return {
        message: error.message,
        reason: null,
    };
}

function buildGroundingSummary(grounding?: ChatMessage["grounding"]): string | null {
    if (!grounding) {
        return null;
    }
    if (!grounding.required) {
        return "Grounding: optional";
    }
    const reasons = grounding.reasons.length > 0 ? grounding.reasons.join(", ") : "policy_required";
    if (grounding.status === "blocked_due_to_quality_gate") {
        return `Grounding: blocked by quality gate · ${reasons}`;
    }
    return `Grounding: ${grounding.policy} (${grounding.status}) · ${reasons}`;
}

function sanitizeRetryPrompt(value: string): string {
    return value
        .replace(/\n\n\(auto intake\)\s*$/iu, "")
        .replace(/\n\n\(parallel runs:\s*\d+\)\s*$/iu, "")
        .trim();
}

function hashText(value: string): string {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16);
}

export function AssistantModule() {
    const { sessions, activeSessionId } = useHUD();
    const [inputVal, setInputVal] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            role: "assistant",
            content: "Connected to backend. Ask anything and I will route this to available providers.",
            route: "system",
        },
    ]);
    const [runRecords, setRunRecords] = useState<RunRecord[]>([]);
    const [activeRunIndex, setActiveRunIndex] = useState(0);
    const [providers, setProviders] = useState<ProviderAvailability[]>([]);
    const [providerModelCatalog, setProviderModelCatalog] = useState<ProviderModelCatalogEntry[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [selectedProvider, setSelectedProvider] = useState<ProviderSelection>("auto");
    const [strictProvider, setStrictProvider] = useState(false);
    const [modelOverride, setModelOverride] = useState("");
    const [parallelRuns, setParallelRuns] = useState(1);
    const [showDebugView, setShowDebugView] = useState(false);
    const renderMode: AssistantRenderMode = showDebugView ? "debug_mode" : "user_mode";
    const [autoContexts, setAutoContexts] = useState<AutoMissionContext[]>([]);
    const [autoContextEvents, setAutoContextEvents] = useState<Record<string, AutoMissionEvent[]>>({});
    const [autoContextGroundingSources, setAutoContextGroundingSources] = useState<
        Record<string, AssistantContextGroundingSourceRecord[]>
    >({});
    const [autoContextGroundingClaims, setAutoContextGroundingClaims] = useState<
        Record<string, AssistantContextGroundingClaimRecord[]>
    >({});
    const [autoContextEventFilter, setAutoContextEventFilter] = useState<AutoMissionEventFilter>("all");
    const [autoContextFeedback, setAutoContextFeedback] = useState<Record<string, AutoMissionFeedbackDraft>>({});
    const autoContextsRef = useRef<AutoMissionContext[]>([]);
    const autoContextStartedThisSessionRef = useRef<Set<string>>(new Set());
    const autoContextChatDeliveryRef = useRef<Set<string>>(new Set());
    const contextStreamRef = useRef<Map<string, AssistantContextEventsStream>>(new Map());
    const loadedContextEventsRef = useRef<Set<string>>(new Set());
    const loadedGroundingEvidenceRef = useRef<Set<string>>(new Set());
    const pendingTaskLinksRef = useRef<Map<string, string>>(new Map());
    const queuedRecoveryStartedRef = useRef(false);
    const queuedRecoveryInFlightRef = useRef(false);

    useEffect(() => {
        autoContextsRef.current = autoContexts;
    }, [autoContexts]);

    useEffect(() => {
        const loadProviders = async () => {
            try {
                const [providerData, modelData] = await Promise.all([
                    listProviders(),
                    listProviderModels().catch(() => ({ providers: [] })),
                ]);
                setProviders(providerData.providers);
                setProviderModelCatalog(modelData.providers);
            } catch {
                setProviders([]);
                setProviderModelCatalog([]);
            }
        };

        void loadProviders();
    }, []);

    const syncAutoContexts = useCallback(async () => {
        try {
            const rows = await listAssistantContexts({ limit: 120 });
            const restored = rows.contexts.map((record) => toAutoContextFromServer(record));
            if (restored.length > 0) {
                setAutoContexts((prev) => mergeAutoContexts(prev, restored));
            }
        } catch {
            return;
        }
    }, []);

    const recoverQueuedQuickCommandTasks = useCallback(async () => {
        if (queuedRecoveryInFlightRef.current) {
            return;
        }
        queuedRecoveryInFlightRef.current = true;

        try {
            const RECOVERY_WINDOW_MS = 30 * 60 * 1000;
            const [queuedTasks, contexts] = await Promise.all([
                listTasks({ status: "queued", limit: 40 }),
                listAssistantContexts({ limit: 200 }),
            ]);

            const knownContextIds = new Set<string>([
                ...contexts.contexts.map((row) => row.clientContextId),
                ...autoContextsRef.current.map((row) => row.id),
            ]);
            const nowMs = Date.now();

            const recoverableTasks = queuedTasks.filter((task) => {
                const source = typeof task.input?.source === "string" ? task.input.source : null;
                const missionIntakeId =
                    typeof task.input?.mission_intake_id === "string" ? task.input.mission_intake_id : null;
                if (source !== "inbox_quick_command" || !missionIntakeId) {
                    return false;
                }
                if (knownContextIds.has(missionIntakeId)) {
                    return false;
                }
                const createdAtMs = Date.parse(task.createdAt);
                if (Number.isNaN(createdAtMs) || nowMs - createdAtMs > RECOVERY_WINDOW_MS) {
                    return false;
                }
                return true;
            });

            const newestRecoverableTask = [...recoverableTasks].sort(
                (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
            )[0];
            if (!newestRecoverableTask) {
                return;
            }

            const newestRecoverablePrompt =
                typeof newestRecoverableTask.input?.prompt === "string" ? newestRecoverableTask.input.prompt.trim() : "";
            const hasRecentSimilarContext = contexts.contexts.some((context) => {
                const createdAtMs = Date.parse(context.createdAt);
                if (Number.isNaN(createdAtMs) || nowMs - createdAtMs > RECOVERY_WINDOW_MS) {
                    return false;
                }
                if (
                    context.clientContextId ===
                    (typeof newestRecoverableTask.input?.mission_intake_id === "string"
                        ? newestRecoverableTask.input.mission_intake_id
                        : "")
                ) {
                    return true;
                }
                return newestRecoverablePrompt.length > 0 && context.prompt.trim() === newestRecoverablePrompt;
            });
            if (hasRecentSimilarContext) {
                return;
            }

            for (const task of [newestRecoverableTask]) {
                const missionIntakeId =
                    typeof task.input?.mission_intake_id === "string" ? task.input.mission_intake_id : null;
                if (!missionIntakeId) {
                    continue;
                }
                knownContextIds.add(missionIntakeId);
                autoContextStartedThisSessionRef.current.add(missionIntakeId);
                for (const key of Array.from(autoContextChatDeliveryRef.current.values())) {
                    if (key.startsWith(`${missionIntakeId}:`)) {
                        autoContextChatDeliveryRef.current.delete(key);
                    }
                }

                const prompt =
                    typeof task.input?.prompt === "string" && task.input.prompt.trim().length > 0
                        ? task.input.prompt
                        : task.title;
                const intent =
                    typeof task.input?.intent === "string" && task.input.intent.trim().length > 0
                        ? task.input.intent
                        : "general";
                const widgetPlanRaw = Array.isArray(task.input?.widget_plan) ? task.input.widget_plan : [];
                const widgetPlan = Array.from(
                    new Set(
                        widgetPlanRaw.filter(
                            (value): value is string => typeof value === "string" && value.trim().length > 0
                        )
                    )
                );

                setAutoContexts((prev) => {
                    if (prev.some((item) => item.id === missionIntakeId)) {
                        return prev;
                    }
                    return [
                        {
                            id: missionIntakeId,
                            prompt,
                            intent,
                            widgetPlan,
                            status: "running",
                            output: "Recovering queued intake...",
                            taskId: task.id,
                            startedAt: task.createdAt,
                        },
                        ...prev,
                    ];
                });

                const context = await createAssistantContext({
                    client_context_id: missionIntakeId,
                    source: "inbox_quick_command",
                    intent,
                    prompt,
                    widget_plan: widgetPlan,
                    task_id: task.id,
                });
                setAutoContexts((prev) => mergeAutoContexts(prev, [toAutoContextFromServer(context)]));
                await runAssistantContext(context.id, {
                    task_type: task.mode,
                });
            }

            void syncAutoContexts();
        } catch {
            return;
        } finally {
            queuedRecoveryInFlightRef.current = false;
        }
    }, [syncAutoContexts]);

    const appendAutoContextEvents = useCallback((clientContextId: string, incoming: AutoMissionEvent[]) => {
        if (incoming.length === 0) {
            return;
        }
        setAutoContextEvents((prev) => ({
            ...prev,
            [clientContextId]: mergeAutoMissionEvents(prev[clientContextId] ?? [], incoming),
        }));
    }, []);

    const updateAutoContextFeedback = useCallback(
        (
            clientContextId: string,
            updater: (draft: AutoMissionFeedbackDraft) => AutoMissionFeedbackDraft
        ) => {
            setAutoContextFeedback((prev) => {
                const current = prev[clientContextId] ?? {
                    comment: "",
                    submitting: false,
                    submitted: false,
                };
                return {
                    ...prev,
                    [clientContextId]: updater(current),
                };
            });
        },
        []
    );

    const submitAutoContextFeedback = useCallback(
        async (context: AutoMissionContext) => {
            if (!context.serverContextId) {
                return;
            }

            const draft = autoContextFeedback[context.id];
            if ((!draft?.answerQuality && !draft?.sourceQuality) || draft?.submitting || draft?.submitted) {
                return;
            }

            updateAutoContextFeedback(context.id, (current) => ({
                ...current,
                submitting: true,
                error: undefined,
            }));

            try {
                const feedbackData: AssistantFeedbackEventData = {
                    answer_quality: draft.answerQuality ?? null,
                    source_quality: draft.sourceQuality ?? null,
                    comment: draft.comment.trim() || null,
                    task_id: context.taskId ?? null,
                };
                await appendAssistantContextEvent(context.serverContextId, {
                    event_type: "assistant.context.user_feedback",
                    data: feedbackData as Record<string, unknown>,
                });
                updateAutoContextFeedback(context.id, (current) => ({
                    ...current,
                    submitting: false,
                    submitted: true,
                }));
            } catch (err) {
                const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "feedback submit failed";
                updateAutoContextFeedback(context.id, (current) => ({
                    ...current,
                    submitting: false,
                    error: message,
                }));
            }
        },
        [autoContextFeedback, updateAutoContextFeedback]
    );

    const submitInlineAutoContextFeedback = useCallback(
        async (clientContextId: string, dimension: AutoMissionFeedbackDimension, signal: AssistantFeedbackSignal) => {
            const context = autoContextsRef.current.find((item) => item.id === clientContextId);
            if (!context?.serverContextId) {
                return;
            }

            const current = autoContextFeedback[clientContextId];
            if (current?.submitting) {
                return;
            }

            updateAutoContextFeedback(clientContextId, (draft) => ({
                ...draft,
                answerQuality: dimension === "answer" ? signal : draft.answerQuality,
                sourceQuality: dimension === "source" ? signal : draft.sourceQuality,
                submitting: true,
                submitted: false,
                error: undefined,
            }));

            try {
                const answerQuality = dimension === "answer" ? signal : current?.answerQuality;
                const sourceQuality = dimension === "source" ? signal : current?.sourceQuality;
                const feedbackData: AssistantFeedbackEventData = {
                    answer_quality: answerQuality ?? null,
                    source_quality: sourceQuality ?? null,
                    comment: current?.comment?.trim() || null,
                    task_id: context.taskId ?? null,
                };
                await appendAssistantContextEvent(context.serverContextId, {
                    event_type: "assistant.context.user_feedback",
                    data: feedbackData as Record<string, unknown>,
                });
                updateAutoContextFeedback(clientContextId, (draft) => ({
                    ...draft,
                    answerQuality,
                    sourceQuality,
                    submitting: false,
                    submitted: true,
                }));
            } catch (err) {
                const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : "feedback submit failed";
                updateAutoContextFeedback(clientContextId, (draft) => ({
                    ...draft,
                    answerQuality: dimension === "answer" ? signal : draft.answerQuality,
                    sourceQuality: dimension === "source" ? signal : draft.sourceQuality,
                    submitting: false,
                    error: message,
                }));
            }
        },
        [autoContextFeedback, updateAutoContextFeedback]
    );

    const hydrateAutoContextEvents = useCallback(async (serverContextId: string, clientContextId: string) => {
        try {
            const rows = await listAssistantContextEvents(serverContextId, { limit: 12 });
            const mapped = rows.events.map((event) => toAutoMissionEvent(event));
            appendAutoContextEvents(clientContextId, mapped);
        } catch {
            loadedContextEventsRef.current.delete(serverContextId);
        }
    }, [appendAutoContextEvents]);

    const hydrateAutoContextGroundingEvidence = useCallback(
        async (serverContextId: string, clientContextId: string, cacheKey: string) => {
            try {
                const evidence = await getAssistantContextGroundingEvidence(serverContextId, { limit: 12 });
                setAutoContextGroundingSources((prev) => ({
                    ...prev,
                    [clientContextId]: evidence.sources ?? [],
                }));
                setAutoContextGroundingClaims((prev) => ({
                    ...prev,
                    [clientContextId]: evidence.claims ?? [],
                }));
            } catch {
                loadedGroundingEvidenceRef.current.delete(cacheKey);
            }
        },
        []
    );

    useEffect(() => {
        void (async () => {
            await syncAutoContexts();
            if (queuedRecoveryStartedRef.current) {
                return;
            }
            queuedRecoveryStartedRef.current = true;
            await recoverQueuedQuickCommandTasks();
        })();
    }, [recoverQueuedQuickCommandTasks, syncAutoContexts]);

    useEffect(() => {
        for (const context of autoContexts) {
            if (!context.serverContextId) {
                continue;
            }
            if (loadedContextEventsRef.current.has(context.serverContextId)) {
                continue;
            }

            loadedContextEventsRef.current.add(context.serverContextId);
            void hydrateAutoContextEvents(context.serverContextId, context.id);
        }
    }, [autoContexts, hydrateAutoContextEvents]);

    useEffect(() => {
        for (const context of autoContexts) {
            if (!context.serverContextId || context.status === "running") {
                continue;
            }
            const cacheKey = `${context.serverContextId}:${context.revision ?? 0}`;
            if (loadedGroundingEvidenceRef.current.has(cacheKey)) {
                continue;
            }

            loadedGroundingEvidenceRef.current.add(cacheKey);
            void hydrateAutoContextGroundingEvidence(context.serverContextId, context.id, cacheKey);
        }
    }, [autoContexts, hydrateAutoContextGroundingEvidence]);

    const evidenceItems: Evidence[] = useMemo(() => {
        const enabledProviders = providers.filter((item) => item.enabled);
        const providerEvidence: Evidence[] = enabledProviders.map((item) => ({
            type: "query",
            label: `${item.provider.toUpperCase()} available`,
            source: item.model ? `model: ${item.model}` : "model: default",
            reproducibilityScore: 100,
        }));

        if (providerEvidence.length === 0) {
            return [
                {
                    type: "security",
                    label: "No provider is currently enabled",
                    source: "Check backend env keys",
                    reproducibilityScore: 100,
                },
            ];
        }

        return providerEvidence;
    }, [providers]);

    const activeRun = runRecords[activeRunIndex] ?? null;

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
        const row = providerModelCatalog.find((item) => item.provider === selectedProvider);
        return row?.models ?? [];
    }, [providerModelCatalog, selectedProvider]);

    const runLabel = useCallback((runIndex: number, runCount: number): string => (runCount > 1 ? `RUN-${runIndex + 1}` : "RUN"), []);

    const buildRequestPayload = useCallback((prompt: string) => {
        const model = modelOverride.trim();
        return {
            prompt,
            task_type: "chat" as const,
            provider: selectedProvider,
            strict_provider: strictProvider,
            model: model.length > 0 ? model : undefined,
        };
    }, [modelOverride, selectedProvider, strictProvider]);

    const mapAttemptStatus = (status: "success" | "failed" | "skipped"): ToolCall["status"] => {
        if (status === "success") return "success";
        if (status === "failed") return "error";
        return "pending";
    };

    const toRunTimeline = useCallback((result: AiRespondData, runIndex: number, runCount: number): ToolCall[] => {
        const runPrefix = runLabel(runIndex, runCount);
        const timelineIdPrefix = `${Date.now()}_${runIndex}`;
        const calls: ToolCall[] = result.attempts.map((attempt, idx) => ({
            id: `${timelineIdPrefix}_${attempt.provider}_${idx}`,
            name: `${runPrefix}:${attempt.provider}`,
            status: mapAttemptStatus(attempt.status),
            durationMs: attempt.latencyMs,
            resultExcerpt: attempt.error,
        }));

        if (calls.length === 0) {
            calls.push({
                id: `${timelineIdPrefix}_router_done`,
                name: `${runPrefix}:router`,
                status: "success",
            });
        }

        return calls;
    }, [runLabel]);

    const buildSynthesisMessage = useCallback((runs: RunRecord[]): { content: string; status: string } => {
        const successfulRuns = runs.filter((run) => run.status === "success");
        if (successfulRuns.length === 0) {
            const firstFailure = runs.find((run) => run.status === "error");
            return {
                content: firstFailure?.output ?? "요청 실행에 실패했습니다. Provider 설정과 연결 상태를 확인하세요.",
                status: `${runs.length} run(s) failed`,
            };
        }

        if (successfulRuns.length === 1) {
            const onlyRun = successfulRuns[0];
            return {
                content: onlyRun.output,
                status: `${onlyRun.servedProvider}/${onlyRun.servedModel}${onlyRun.usedFallback ? " (fallback)" : ""}`,
            };
        }

        const runHeaders = successfulRuns
            .map(
                (run) =>
                    `[${run.label}] ${run.servedProvider ?? "unknown"}/${run.servedModel ?? "unknown"}${run.usedFallback ? " (fallback)" : ""}`
            )
            .join("\n");

        const runBodies = successfulRuns.map((run) => `[${run.label}]\n${run.output}`).join("\n\n");

        return {
            content: `Synthesis from successful runs:\n${runHeaders}\n\n${runBodies}`,
            status: `${successfulRuns.length}/${runs.length} run(s) succeeded`,
        };
    }, []);

    const createPendingRuns = useCallback((runCount: number, requestedModel: string | null): RunRecord[] =>
        Array.from({ length: runCount }).map((_, runIndex) => {
            const label = runLabel(runIndex, runCount);
            return {
                id: `${Date.now()}_${runIndex}`,
                label,
                status: "running",
                requestedProvider: selectedProvider,
                requestedModel,
                strictProvider,
                output: "Waiting for provider response...",
                attempts: [
                    {
                        id: `${Date.now()}_router_${runIndex}`,
                        name: `${label}:ProviderRouter`,
                        status: "running",
                        args: JSON.stringify({
                            task_type: "chat",
                            provider: selectedProvider,
                            strict_provider: strictProvider,
                            model: requestedModel ?? "default",
                        }),
                    },
                ],
            };
        }), [runLabel, selectedProvider, strictProvider]);

    const startAutoMissionContext = useCallback(async (payload: MissionIntakePayload) => {
        let shouldRun = false;

        setAutoContexts((prev) => {
            if (prev.some((item) => item.id === payload.id)) {
                return prev;
            }
            shouldRun = true;
            return [
                {
                    id: payload.id,
                    prompt: payload.prompt,
                    intent: payload.intent,
                    widgetPlan: [...payload.widgetPlan],
                    status: "running",
                    output: "Routing request to provider...",
                    startedAt: payload.createdAt,
                },
                ...prev,
            ];
        });

        if (!shouldRun) {
            return;
        }
        autoContextStartedThisSessionRef.current.add(payload.id);
        for (const key of Array.from(autoContextChatDeliveryRef.current.values())) {
            if (key.startsWith(`${payload.id}:`)) {
                autoContextChatDeliveryRef.current.delete(key);
            }
        }

        let createdContext: AssistantContextRecord | null = null;
        let serverContextId: string | undefined;
        const pendingTaskIdAtStart = pendingTaskLinksRef.current.get(payload.id);

        try {
            const created = await createAssistantContext({
                client_context_id: payload.id,
                source: payload.source,
                intent: payload.intent,
                prompt: payload.prompt,
                widget_plan: payload.widgetPlan,
                task_id: pendingTaskIdAtStart,
            });
            let effectiveContext = created;
            const latestPendingTaskId = pendingTaskLinksRef.current.get(payload.id) ?? pendingTaskIdAtStart;
            if (latestPendingTaskId && created.taskId !== latestPendingTaskId) {
                try {
                    const updated = await updateAssistantContext(created.id, {
                        task_id: latestPendingTaskId,
                    });
                    effectiveContext = updated;
                } catch {
                    // best effort: local state will still keep task link
                }
            }

            createdContext = effectiveContext;
            serverContextId = created.id;
            setAutoContexts((prev) => mergeAutoContexts(prev, [toAutoContextFromServer(effectiveContext)]));
        } catch (err) {
            const message =
                err instanceof ApiRequestError
                    ? `${err.code}: ${err.message}`
                    : "failed to create /api/v1/assistant/contexts";
            setAutoContexts((prev) =>
                prev.map((item) =>
                    item.id === payload.id
                        ? {
                            ...item,
                            status: "error",
                            output: message,
                            completedAt: new Date().toISOString(),
                            error: message,
                        }
                        : item
                )
            );
            return;
        }

        if (!serverContextId || !createdContext || createdContext.status !== "running") {
            return;
        }

        try {
            const requestPayload = buildRequestPayload(payload.prompt);
            const accepted = await runAssistantContext(serverContextId, {
                provider: requestPayload.provider,
                strict_provider: requestPayload.strict_provider,
                model: requestPayload.model,
                task_type: payload.taskMode,
            });
            setAutoContexts((prev) => mergeAutoContexts(prev, [toAutoContextFromServer(accepted)]));
        } catch (err) {
            const failure = formatAssistantFailureMessage(err, "요청을 실행하지 못했습니다. 잠시 후 다시 시도하세요.");
            const message = failure.message;
            setAutoContexts((prev) =>
                prev.map((item) =>
                    item.id === payload.id
                        ? {
                            ...item,
                            status: "error",
                            output: message,
                            completedAt: new Date().toISOString(),
                            error: message,
                        }
                        : item
                )
            );
            void syncAutoContexts();
        }
    }, [buildRequestPayload, syncAutoContexts]);

    const executePrompt = useCallback(async (prompt: string, options?: { auto?: boolean; autoStatus?: string }) => {
        const normalizedPrompt = prompt.trim();
        const promptLabel = options?.auto ? `${normalizedPrompt}\n\n(auto intake)` : normalizedPrompt;
        const promptStatus = options?.auto ? options.autoStatus ?? "AUTO INTAKE" : undefined;
        const runCount = options?.auto ? 1 : parallelRuns;
        const requestedModel = modelOverride.trim() || null;

        if (!normalizedPrompt || isRunning) return;

        setIsRunning(true);
        const pendingRuns = createPendingRuns(runCount, requestedModel);
        setRunRecords(pendingRuns);
        setActiveRunIndex(0);
        setMessages((prev) => [
            ...prev,
            {
                role: "user",
                content: runCount > 1 ? `${promptLabel}\n\n(parallel runs: ${runCount})` : promptLabel,
                status: promptStatus,
            },
        ]);
        const requestPayload = buildRequestPayload(normalizedPrompt);

        try {
            if (runCount <= 1) {
                const result = await aiRespond(requestPayload);
                const completedRun: RunRecord = {
                    ...pendingRuns[0],
                    status: "success",
                    output: result.output,
                    servedProvider: result.provider,
                    servedModel: result.model,
                    usedFallback: result.used_fallback,
                    selectionStrategy: result.selection?.strategy,
                    selectionReason: result.selection?.reason,
                    selectionOrder: result.selection?.orderedProviders,
                    attempts: toRunTimeline(result, 0, runCount),
                    error: undefined,
                };
                setRunRecords([completedRun]);
                setMessages((prev) => [
                    ...prev,
                    {
                        role: "assistant",
                        content: result.output,
                        status: `${result.provider}/${result.model}${result.used_fallback ? " (fallback)" : ""}`,
                        route: "manual",
                        promptRef: normalizedPrompt,
                        grounding: result.grounding
                            ? {
                                policy: result.grounding.policy,
                                required: result.grounding.required,
                                status: result.grounding.status,
                                reasons: result.grounding.reasons ?? [],
                                sources: result.grounding.sources,
                                claims: result.grounding.claims?.map((claim) => ({
                                    claimText: claim.claimText,
                                    sourceUrls: claim.sourceUrls,
                                })),
                              }
                            : undefined,
                    },
                ]);
                return;
            }

            const settled = await Promise.allSettled(
                Array.from({ length: runCount }).map(async (_unused, runIndex) => {
                    const result = await aiRespond(requestPayload);
                    return { runIndex, result };
                })
            );

            const completedRuns: RunRecord[] = pendingRuns.map((pendingRun, runIndex) => {
                const item = settled[runIndex];
                if (item.status === "fulfilled") {
                    const { result } = item.value;
                    return {
                        ...pendingRun,
                        status: "success" as const,
                        output: result.output,
                        servedProvider: result.provider,
                        servedModel: result.model,
                        usedFallback: result.used_fallback,
                        selectionStrategy: result.selection?.strategy,
                        selectionReason: result.selection?.reason,
                        selectionOrder: result.selection?.orderedProviders,
                        attempts: toRunTimeline(result, runIndex, runCount),
                        error: undefined,
                    };
                }

                const failure = formatAssistantFailureMessage(item.reason, "요청 실행에 실패했습니다. Provider 상태를 확인하세요.");
                const message = failure.message;
                return {
                    ...pendingRun,
                    status: "error" as const,
                    output: message,
                    servedProvider: undefined,
                    servedModel: undefined,
                    usedFallback: false,
                    attempts: [
                        {
                            id: `${Date.now()}_run_${runIndex}_error`,
                            name: `${pendingRun.label}:ProviderRouter`,
                            status: "error" as const,
                            resultExcerpt: message,
                        },
                    ],
                    error: message,
                };
            });

            setRunRecords(completedRuns);
            const synthesis = buildSynthesisMessage(completedRuns);
            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    content: synthesis.content,
                    status: synthesis.status,
                    route: "manual",
                    promptRef: normalizedPrompt,
                },
            ]);
        } catch (err) {
            const failure = formatAssistantFailureMessage(err, "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.");
            const message = failure.message;
            setRunRecords(
                pendingRuns.map((run) => ({
                    ...run,
                    status: "error",
                    output: message,
                    attempts: [
                        {
                            id: `${Date.now()}_${run.label}_error`,
                            name: `${run.label}:ProviderRouter`,
                            status: "error",
                            resultExcerpt: message,
                        },
                    ],
                    error: message,
                }))
            );
            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    content: message,
                    status: failure.reason ? "Blocked" : "Error",
                    route: "manual",
                    promptRef: normalizedPrompt,
                },
            ]);
        } finally {
            setIsRunning(false);
        }
    }, [buildRequestPayload, buildSynthesisMessage, createPendingRuns, isRunning, modelOverride, parallelRuns, toRunTimeline]);

    const sendMessage = async () => {
        const prompt = inputVal.trim();
        if (!prompt || isRunning) return;

        setInputVal("");
        await executePrompt(prompt);
    };

    useEffect(() => {
        const unsubscribeMissionIntake = subscribeMissionIntake((payload) => {
            if (payload.source !== "inbox_quick_command") {
                return;
            }

            if (payload.prestarted) {
                autoContextStartedThisSessionRef.current.add(payload.id);
                for (const key of Array.from(autoContextChatDeliveryRef.current.values())) {
                    if (key.startsWith(`${payload.id}:`)) {
                        autoContextChatDeliveryRef.current.delete(key);
                    }
                }
                void syncAutoContexts();
                return;
            }

            void startAutoMissionContext(payload);
        });

        const unsubscribeMissionTaskLink = subscribeMissionIntakeTaskLink((payload) => {
            pendingTaskLinksRef.current.set(payload.id, payload.taskId);
            const linkedContextId = autoContextsRef.current.find((item) => item.id === payload.id)?.serverContextId;
            setAutoContexts((prev) => prev.map((item) => (item.id === payload.id ? { ...item, taskId: payload.taskId } : item)));
            if (linkedContextId) {
                void updateAssistantContext(linkedContextId, {
                    task_id: payload.taskId,
                }).catch(() => undefined);
            }
        });

        return () => {
            unsubscribeMissionIntake();
            unsubscribeMissionTaskLink();
        };
    }, [startAutoMissionContext, syncAutoContexts]);

    useEffect(() => {
        const runningServerContextIds = new Set<string>();
        for (const context of autoContexts) {
            if (context.status !== "running" || !context.serverContextId) {
                continue;
            }

            const serverContextId = context.serverContextId;
            runningServerContextIds.add(serverContextId);

            if (contextStreamRef.current.has(serverContextId)) {
                continue;
            }

            const stream = streamAssistantContextEvents(serverContextId, {
                onEvent: (payload) => {
                    const row = payload.context;
                    const clientContextId =
                        row?.clientContextId ??
                        autoContextsRef.current.find((item) => item.serverContextId === serverContextId)?.id;
                    if (clientContextId) {
                        appendAutoContextEvents(clientContextId, [toAutoMissionEvent(payload.event)]);
                    }

                    if (!row) {
                        void syncAutoContexts();
                        return;
                    }

                    setAutoContexts((prev) => mergeAutoContexts(prev, [toAutoContextFromServer(row)]));
                    if (row.status !== "running") {
                        const current = contextStreamRef.current.get(serverContextId);
                        if (current) {
                            current.close();
                            contextStreamRef.current.delete(serverContextId);
                        }
                    }
                },
                onClose: () => {
                    const current = contextStreamRef.current.get(serverContextId);
                    if (current) {
                        current.close();
                    }
                    contextStreamRef.current.delete(serverContextId);
                    void syncAutoContexts();
                },
                onError: () => {
                    const current = contextStreamRef.current.get(serverContextId);
                    if (current) {
                        current.close();
                    }
                    contextStreamRef.current.delete(serverContextId);
                    void syncAutoContexts();
                },
            });

            contextStreamRef.current.set(serverContextId, stream);
        }

        for (const [serverContextId, stream] of Array.from(contextStreamRef.current.entries())) {
            if (runningServerContextIds.has(serverContextId)) {
                continue;
            }
            stream.close();
            contextStreamRef.current.delete(serverContextId);
        }
    }, [appendAutoContextEvents, autoContexts, syncAutoContexts]);

    useEffect(() => {
        const streamMap = contextStreamRef.current;
        return () => {
            for (const stream of streamMap.values()) {
                stream.close();
            }
            streamMap.clear();
        };
    }, []);

    const sortedAutoContexts = useMemo(() => {
        return [...autoContexts].sort((a, b) => {
            const aTime = Date.parse(a.startedAt);
            const bTime = Date.parse(b.startedAt);
            if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
                return 0;
            }
            return bTime - aTime;
        });
    }, [autoContexts]);

    const autoContextSummary = useMemo(() => {
        const running = autoContexts.filter((item) => item.status === "running").length;
        const success = autoContexts.filter((item) => item.status === "success").length;
        const errorCount = autoContexts.filter((item) => item.status === "error").length;
        return {
            total: autoContexts.length,
            running,
            success,
            error: errorCount,
        };
    }, [autoContexts]);

    const formatAutoPrompt = (prompt: string): string => {
        const normalized = prompt.replace(/\s+/g, " ").trim();
        if (normalized.length <= 72) {
            return normalized;
        }
        return `${normalized.slice(0, 72)}...`;
    };

    const formatAutoTimestamp = (value: string): string => {
        const timestamp = Date.parse(value);
        if (Number.isNaN(timestamp)) {
            return value;
        }
        const diffSeconds = Math.floor((Date.now() - timestamp) / 1000);
        if (diffSeconds < 60) {
            return `${Math.max(diffSeconds, 0)}s ago`;
        }
        if (diffSeconds < 3600) {
            return `${Math.floor(diffSeconds / 60)}m ago`;
        }
        if (diffSeconds < 86400) {
            return `${Math.floor(diffSeconds / 3600)}h ago`;
        }
        return `${Math.floor(diffSeconds / 86400)}d ago`;
    };

    const autoContextStatusClass = (status: AutoMissionContext["status"], degraded = false): string => {
        if (status === "running") return "text-cyan-300 border-cyan-500/40 bg-cyan-500/10";
        if (status === "success" && degraded) return "text-amber-300 border-amber-500/40 bg-amber-500/10";
        if (status === "success") return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
        return "text-red-300 border-red-500/40 bg-red-500/10";
    };

    const autoContextStatusLabel = (status: AutoMissionContext["status"], degraded = false): string => {
        if (status === "running") return "RUNNING";
        if (status === "success" && degraded) return "DEGRADED";
        if (status === "success") return "DONE";
        return "ERROR";
    };

    const autoContextEventFilterOptions: Array<{ key: AutoMissionEventFilter; label: string }> = [
        { key: "all", label: "ALL" },
        { key: "accepted", label: "ACCEPTED" },
        { key: "started", label: "STARTED" },
        { key: "completed", label: "COMPLETED" },
        { key: "failed", label: "FAILED" },
    ];

    const countEventsByFilter = useCallback(
        (filterKey: AutoMissionEventFilter): number => {
            const all = Object.values(autoContextEvents).flat();
            if (filterKey === "all") {
                return all.length;
            }
            return all.filter((item) => item.kind === filterKey).length;
        },
        [autoContextEvents]
    );

    const resolveAutoContextQualityState = useCallback(
        (context: AutoMissionContext): AutoMissionQualityState => {
            if (context.status !== "success") {
                return { degraded: false };
            }

            const rows = autoContextEvents[context.id] ?? [];
            for (let index = rows.length - 1; index >= 0; index -= 1) {
                const event = rows[index];
                if (!event || event.kind !== "completed") {
                    continue;
                }
                const degraded = event.data?.quality_guard_triggered === true;
                if (!degraded) {
                    return { degraded: false };
                }
                const reason = typeof event.data?.quality_guard_reason === "string" ? event.data.quality_guard_reason : undefined;
                return {
                    degraded: true,
                    reason,
                };
            }

            if (isQualityGuardFallbackOutput(context.output)) {
                return {
                    degraded: true,
                    reason: "quality_guard_output",
                };
            }

            return { degraded: false };
        },
        [autoContextEvents]
    );

    useEffect(() => {
        if (!activeSessionId) {
            return;
        }

        const activeSession = sessions.find((session) => session.id === activeSessionId);
        if (!activeSession) {
            return;
        }

        const candidateContexts = autoContexts.filter((context) => {
            if (context.status === "running") {
                return false;
            }
            if (context.id === activeSession.id) {
                return true;
            }
            if (activeSession.taskId && context.taskId === activeSession.taskId) {
                return true;
            }
            return false;
        });

        if (candidateContexts.length === 0) {
            return;
        }

        const sortedCandidates = [...candidateContexts].sort((left, right) => {
            const leftTime = Date.parse(left.completedAt ?? left.startedAt);
            const rightTime = Date.parse(right.completedAt ?? right.startedAt);
            const normalizedLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
            const normalizedRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
            return normalizedRightTime - normalizedLeftTime;
        });
        const targetContext = sortedCandidates[0];
        if (!targetContext) {
            return;
        }

        autoContextStartedThisSessionRef.current.add(targetContext.id);

        const deliveryKey = `${targetContext.id}:${targetContext.status}:${hashText(targetContext.output)}`;
        if (autoContextChatDeliveryRef.current.has(deliveryKey)) {
            return;
        }
        autoContextChatDeliveryRef.current.add(deliveryKey);

        const qualityState = resolveAutoContextQualityState(targetContext);
        const providerLabel =
            targetContext.servedProvider && targetContext.servedModel
                ? `${targetContext.servedProvider}/${targetContext.servedModel}${targetContext.usedFallback ? " (fallback)" : ""}`
                : null;

        const statusLabel =
            targetContext.status === "error"
                ? "FAILED"
                : qualityState.degraded
                    ? `DEGRADED${providerLabel ? ` · ${providerLabel}` : ""}`
                    : providerLabel ?? "DONE";

        setMessages((prev) => [
            ...prev,
            {
                role: "assistant",
                content: targetContext.output,
                status: statusLabel,
                contextId: targetContext.id,
                route: "auto_context",
                promptRef: targetContext.prompt,
            },
        ]);
    }, [activeSessionId, autoContexts, resolveAutoContextQualityState, sessions]);

    useEffect(() => {
        const nextMessages: ChatMessage[] = [];

        for (const context of autoContexts) {
            if (!autoContextStartedThisSessionRef.current.has(context.id)) {
                continue;
            }
            if (context.status === "running") {
                continue;
            }

            const deliveryKey = `${context.id}:${context.status}:${hashText(context.output)}`;
            if (autoContextChatDeliveryRef.current.has(deliveryKey)) {
                continue;
            }
            autoContextChatDeliveryRef.current.add(deliveryKey);

            const qualityState = resolveAutoContextQualityState(context);
            const providerLabel =
                context.servedProvider && context.servedModel
                    ? `${context.servedProvider}/${context.servedModel}${context.usedFallback ? " (fallback)" : ""}`
                    : null;

            const statusLabel =
                context.status === "error"
                    ? "FAILED"
                    : qualityState.degraded
                        ? `DEGRADED${providerLabel ? ` · ${providerLabel}` : ""}`
                        : providerLabel ?? "DONE";

            nextMessages.push({
                role: "assistant",
                content: context.output,
                status: statusLabel,
                contextId: context.id,
                route: "auto_context",
                promptRef: context.prompt,
            });
        }

        if (nextMessages.length > 0) {
            setMessages((prev) => [...prev, ...nextMessages]);
        }
    }, [autoContexts, resolveAutoContextQualityState]);

    return (
        <main className="w-full h-full relative overflow-hidden bg-transparent text-white flex">


            <div className="relative z-10 w-full h-full flex flex-col p-4 gap-6 overflow-y-auto">

                {/* Left: Chat & Input (60%) */}
                <div className="flex-1 glass-panel rounded-xl flex flex-col min-h-[500px] overflow-hidden">
                    <div className="px-6 py-4 border-b border-white/5 bg-black/40 flex justify-between items-center shrink-0">
                        <h2 className="font-mono font-bold tracking-widest text-cyan-400 flex items-center gap-2">
                            <Sparkles size={16} /> ASSISTANT
                        </h2>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 px-3 py-1 rounded bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-mono text-cyan-400">
                                <BrainCircuit size={12} /> {renderMode === "debug_mode" ? "ORCHESTRATOR MODE" : "ASSISTANT MODE"}
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowDebugView((prev) => !prev)}
                                className="px-2.5 py-1 rounded border border-white/20 bg-black/40 text-[10px] font-mono tracking-widest text-white/65 hover:text-white"
                            >
                                {showDebugView ? "DEBUG ON" : "DEBUG OFF"}
                            </button>
                        </div>
                    </div>

                    {showDebugView ? (
                        <div className="px-4 py-3 border-b border-white/5 bg-black/40 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest">Provider</span>
                                <select
                                    className="h-8 rounded border border-white/15 bg-black/60 px-2 text-xs font-mono"
                                    value={selectedProvider}
                                    onChange={(event) =>
                                        setSelectedProvider(event.target.value as ProviderSelection)
                                    }
                                >
                                    {providerOptions.map((option) => (
                                        <option key={option.provider} value={option.provider} disabled={!option.enabled && option.provider !== "auto"}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest">Model Override</span>
                                <input
                                    className="h-8 rounded border border-white/15 bg-black/60 px-2 text-xs font-mono"
                                    placeholder="default"
                                    value={modelOverride}
                                    list="provider-model-list"
                                    onChange={(event) => setModelOverride(event.target.value)}
                                />
                                <datalist id="provider-model-list">
                                    {selectedProviderModels.map((modelName) => (
                                        <option key={modelName} value={modelName} />
                                    ))}
                                </datalist>
                                {selectedProvider !== "auto" && selectedProviderModels.length > 0 && (
                                    <span className="text-[9px] font-mono text-white/35 truncate">
                                        catalog: {selectedProviderModels.slice(0, 3).join(", ")}
                                    </span>
                                )}
                            </label>

                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest">Parallel Runs</span>
                                <select
                                    className="h-8 rounded border border-white/15 bg-black/60 px-2 text-xs font-mono"
                                    value={parallelRuns}
                                    onChange={(event) => setParallelRuns(Number(event.target.value))}
                                >
                                    <option value={1}>1 (single)</option>
                                    <option value={2}>2</option>
                                    <option value={3}>3</option>
                                    <option value={4}>4</option>
                                </select>
                            </label>

                            <label className="flex items-center gap-2 px-2 rounded border border-white/15 bg-black/60">
                                <input
                                    type="checkbox"
                                    checked={strictProvider}
                                    onChange={(event) => setStrictProvider(event.target.checked)}
                                />
                                <span className="text-[10px] font-mono text-white/70 uppercase tracking-widest">Strict Provider</span>
                            </label>
                        </div>
                    ) : (
                        <div className="px-4 py-2 border-b border-white/5 bg-black/40 flex items-center justify-between text-[10px] font-mono">
                            <span className="text-white/55 uppercase tracking-widest">User Mode</span>
                            <span className="text-cyan-300/80">
                                grounded answers enabled for dynamic factual prompts
                            </span>
                        </div>
                    )}

                    <div className="flex-1 p-6 overflow-y-auto space-y-6">
                        {messages.map((message, idx) => {
                            if (message.role === "user") {
                                return <UserMessage key={`u_${idx}`} content={message.content} />;
                            }

                            const retryPrompt =
                                message.promptRef ??
                                (() => {
                                    for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
                                        const row = messages[cursor];
                                        if (row?.role === "user") {
                                            return sanitizeRetryPrompt(row.content);
                                        }
                                    }
                                    return undefined;
                                })();

                            const contextId = message.contextId;
                            const contextGroundingSources = contextId
                                ? autoContextGroundingSources[contextId]
                                : undefined;
                            const contextGroundingClaims = contextId
                                ? autoContextGroundingClaims[contextId]
                                : undefined;
                            const resolvedGrounding =
                                message.grounding ||
                                (contextGroundingSources && contextGroundingSources.length > 0) ||
                                (contextGroundingClaims && contextGroundingClaims.length > 0)
                                    ? {
                                        policy: message.grounding?.policy ?? "dynamic_factual",
                                        required: message.grounding?.required ?? true,
                                        status: message.grounding?.status ?? "provider_only",
                                        reasons: message.grounding?.reasons ?? [],
                                        sources: message.grounding?.sources ?? contextGroundingSources,
                                        claims:
                                            message.grounding?.claims ??
                                            contextGroundingClaims?.map((claim) => ({
                                                claimText: claim.claimText,
                                                sourceUrls: claim.citations.map((citation) => citation.url),
                                                citations: claim.citations.map((citation) => ({
                                                    url: citation.url,
                                                    title: citation.title,
                                                    domain: citation.domain,
                                                })),
                                            })),
                                      }
                                    : undefined;
                            const feedbackDraft = contextId
                                ? autoContextFeedback[contextId] ?? {
                                    comment: "",
                                    submitting: false,
                                    submitted: false,
                                  }
                                : undefined;

                            return (
                                <SystemMessage
                                    key={`s_${idx}`}
                                    content={message.content}
                                    status={message.status}
                                    route={message.route}
                                    grounding={resolvedGrounding}
                                    renderMode={renderMode}
                                    onRetry={
                                        retryPrompt
                                            ? () => {
                                                void executePrompt(retryPrompt);
                                            }
                                            : undefined
                                    }
                                    feedback={
                                        contextId && feedbackDraft
                                            ? {
                                                answerQuality: feedbackDraft.answerQuality,
                                                sourceQuality: feedbackDraft.sourceQuality,
                                                submitting: feedbackDraft.submitting,
                                                submitted: feedbackDraft.submitted,
                                                error: feedbackDraft.error,
                                                onVote: (dimension, signal) => {
                                                    void submitInlineAutoContextFeedback(contextId, dimension, signal);
                                                },
                                              }
                                            : undefined
                                    }
                                />
                            );
                        })}
                        {isRunning && (
                            <SystemMessage
                                content="Running provider routing and generation..."
                                status="Thinking"
                                route="manual"
                                renderMode={renderMode}
                            />
                        )}
                    </div>

                    <div className="p-4 bg-black/60 border-t border-white/5 shrink-0">
                        <div className="relative">
                            <textarea
                                className="w-full bg-white/5 border border-white/10 rounded-lg pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-cyan-500/50 resize-none h-14"
                                placeholder="Message JARVIS..."
                                value={inputVal}
                                onChange={e => setInputVal(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        void sendMessage();
                                    }
                                }}
                            />
                            <button
                                className="absolute right-2 top-2 p-2 rounded-md bg-cyan-500 hover:bg-cyan-400 text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                aria-label="Send Message"
                                onClick={() => void sendMessage()}
                                disabled={isRunning || !inputVal.trim()}
                            >
                                <Send size={16} className="-ml-1 mt-0.5" />
                            </button>
                        </div>
                    </div>
                </div>

                {showDebugView && (
                <div className="w-full flex flex-col gap-6 shrink-0">
                    <div className="glass-panel p-5 rounded-xl border-t-2 border-cyan-500/50 min-h-[230px]">
                        <h3 className="text-[10px] font-mono font-bold tracking-widest text-white/50 mb-3 uppercase">Run Sections</h3>
                        {runRecords.length === 0 ? (
                            <p className="text-xs text-white/60">No runs yet. Submit a prompt to create sectioned run views.</p>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                    {runRecords.map((run, index) => (
                                        <button
                                            key={run.id}
                                            type="button"
                                            onClick={() => setActiveRunIndex(index)}
                                            className={`px-3 py-1 rounded border text-[10px] font-mono tracking-widest transition-colors ${
                                                index === activeRunIndex
                                                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                                    : "border-white/20 bg-black/40 text-white/60 hover:text-white hover:border-white/40"
                                            }`}
                                        >
                                            {run.label}
                                        </button>
                                    ))}
                                </div>

                                {activeRun && (
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
                                            <div className="rounded border border-white/10 bg-black/40 p-2">
                                                <p className="text-white/40 uppercase tracking-widest text-[9px] mb-1">Requested</p>
                                                <p>{activeRun.requestedProvider}/{activeRun.requestedModel ?? "default"}</p>
                                                <p className="text-white/50 mt-1">
                                                    strict: {activeRun.strictProvider ? "on" : "off"}
                                                </p>
                                            </div>
                                            <div className="rounded border border-white/10 bg-black/40 p-2">
                                                <p className="text-white/40 uppercase tracking-widest text-[9px] mb-1">Served Model</p>
                                                <p>{activeRun.servedProvider ?? "pending"}/{activeRun.servedModel ?? "pending"}</p>
                                                <p className="text-white/50 mt-1">
                                                    fallback: {activeRun.usedFallback ? "yes" : "no"}
                                                </p>
                                                {activeRun.selectionStrategy && (
                                                    <p className="text-white/40 mt-1 truncate">
                                                        {activeRun.selectionStrategy}: {activeRun.selectionReason ?? "n/a"}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="rounded border border-white/10 bg-black/40 p-3">
                                            <p className="text-[9px] font-mono uppercase tracking-widest text-white/40 mb-1">
                                                {activeRun.label} Output
                                            </p>
                                            <p className="text-xs text-white/80 whitespace-pre-wrap max-h-72 overflow-y-auto pr-1">
                                                {activeRun.output}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="glass-panel p-5 rounded-xl border-t-2 border-cyan-500/50 min-h-[220px]">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-[10px] font-mono font-bold tracking-widest text-white/50 uppercase">Auto Mission Contexts</h3>
                            <span className="text-[10px] font-mono text-white/45">
                                {autoContextSummary.running} running / {autoContextSummary.total} total
                            </span>
                        </div>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                            {autoContextEventFilterOptions.map((option) => {
                                const active = autoContextEventFilter === option.key;
                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        onClick={() => setAutoContextEventFilter(option.key)}
                                        className={`rounded border px-2 py-0.5 text-[9px] font-mono tracking-widest transition-colors ${
                                            active
                                                ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                                : "border-white/20 bg-black/40 text-white/50 hover:text-white/80"
                                        }`}
                                    >
                                        {option.label} {countEventsByFilter(option.key)}
                                    </button>
                                );
                            })}
                        </div>
                        {sortedAutoContexts.length === 0 ? (
                            <p className="text-xs text-white/60">Quick Command intake contexts will appear here.</p>
                        ) : (
                            <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                                {sortedAutoContexts.map((context) => {
                                    const contextEventsRows = autoContextEvents[context.id] ?? [];
                                    const filteredContextEvents =
                                        autoContextEventFilter === "all"
                                            ? contextEventsRows
                                            : contextEventsRows.filter((item) => item.kind === autoContextEventFilter);
                                    const qualityState = resolveAutoContextQualityState(context);
                                    const feedbackDraft = autoContextFeedback[context.id] ?? {
                                        comment: "",
                                        submitting: false,
                                        submitted: false,
                                    };
                                    const feedbackReady =
                                        Boolean(feedbackDraft.answerQuality || feedbackDraft.sourceQuality) &&
                                        !feedbackDraft.submitting &&
                                        !feedbackDraft.submitted;
                                    return (
                                        <div key={context.id} className="rounded border border-white/10 bg-black/40 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-[11px] font-mono text-white/85 truncate">
                                                    [{context.intent.toUpperCase()}] {formatAutoPrompt(context.prompt)}
                                                </p>
                                                <span className={`px-2 py-0.5 rounded border text-[9px] font-mono tracking-widest ${autoContextStatusClass(context.status, qualityState.degraded)}`}>
                                                    {autoContextStatusLabel(context.status, qualityState.degraded)}
                                                </span>
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-white/45">
                                                <span>{formatAutoTimestamp(context.startedAt)}</span>
                                                {context.servedProvider && context.servedModel && (
                                                    <span>{context.servedProvider}/{context.servedModel}{context.usedFallback ? " (fallback)" : ""}</span>
                                                )}
                                                {context.taskId && (
                                                    <Link
                                                        href={`/tasks/${context.taskId}`}
                                                        className="text-cyan-300 hover:text-cyan-200 underline decoration-cyan-500/40"
                                                    >
                                                        task:{context.taskId.slice(0, 8)}
                                                    </Link>
                                                )}
                                                {qualityState.degraded && qualityState.reason && (
                                                    <span className="text-amber-300/80">quality:{qualityState.reason}</span>
                                                )}
                                            </div>
                                            <p className="mt-2 text-[11px] text-white/70 whitespace-pre-wrap max-h-56 overflow-y-auto pr-1">
                                                {context.output}
                                            </p>
                                            {context.status !== "running" && (
                                                <div className="mt-3 rounded border border-white/10 bg-black/30 p-2.5">
                                                    <p className="text-[10px] font-mono uppercase tracking-widest text-white/45">
                                                        Response Feedback
                                                    </p>
                                                    <p className="mt-1 text-[11px] text-white/65">답변 품질과 출처 신뢰도를 각각 평가해주세요.</p>
                                                    <div className="mt-2 grid grid-cols-1 gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-mono text-white/55 min-w-[72px]">답변 품질</span>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    updateAutoContextFeedback(context.id, (current) => ({
                                                                        ...current,
                                                                        answerQuality: "good",
                                                                        submitted: false,
                                                                        error: undefined,
                                                                    }))
                                                                }
                                                                className={`rounded border px-2 py-1 text-[10px] font-mono tracking-widest ${
                                                                    feedbackDraft.answerQuality === "good"
                                                                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                                                        : "border-white/20 bg-black/40 text-white/60"
                                                                }`}
                                                                disabled={feedbackDraft.submitting}
                                                            >
                                                                GOOD
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    updateAutoContextFeedback(context.id, (current) => ({
                                                                        ...current,
                                                                        answerQuality: "bad",
                                                                        submitted: false,
                                                                        error: undefined,
                                                                    }))
                                                                }
                                                                className={`rounded border px-2 py-1 text-[10px] font-mono tracking-widest ${
                                                                    feedbackDraft.answerQuality === "bad"
                                                                        ? "border-rose-400 bg-rose-500/20 text-rose-300"
                                                                        : "border-white/20 bg-black/40 text-white/60"
                                                                }`}
                                                                disabled={feedbackDraft.submitting}
                                                            >
                                                                BAD
                                                            </button>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-mono text-white/55 min-w-[72px]">출처 신뢰도</span>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    updateAutoContextFeedback(context.id, (current) => ({
                                                                        ...current,
                                                                        sourceQuality: "good",
                                                                        submitted: false,
                                                                        error: undefined,
                                                                    }))
                                                                }
                                                                className={`rounded border px-2 py-1 text-[10px] font-mono tracking-widest ${
                                                                    feedbackDraft.sourceQuality === "good"
                                                                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                                                        : "border-white/20 bg-black/40 text-white/60"
                                                                }`}
                                                                disabled={feedbackDraft.submitting}
                                                            >
                                                                GOOD
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    updateAutoContextFeedback(context.id, (current) => ({
                                                                        ...current,
                                                                        sourceQuality: "bad",
                                                                        submitted: false,
                                                                        error: undefined,
                                                                    }))
                                                                }
                                                                className={`rounded border px-2 py-1 text-[10px] font-mono tracking-widest ${
                                                                    feedbackDraft.sourceQuality === "bad"
                                                                        ? "border-rose-400 bg-rose-500/20 text-rose-300"
                                                                        : "border-white/20 bg-black/40 text-white/60"
                                                                }`}
                                                                disabled={feedbackDraft.submitting}
                                                            >
                                                                BAD
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <textarea
                                                        className="mt-2 w-full rounded border border-white/15 bg-black/50 px-2 py-1.5 text-[11px] text-white/75 focus:border-cyan-500/40 focus:outline-none"
                                                        rows={2}
                                                        placeholder="추가 의견(선택)"
                                                        value={feedbackDraft.comment}
                                                        onChange={(event) =>
                                                            updateAutoContextFeedback(context.id, (current) => ({
                                                                ...current,
                                                                comment: event.target.value,
                                                                submitted: false,
                                                            }))
                                                        }
                                                        disabled={feedbackDraft.submitting}
                                                    />
                                                    <div className="mt-2 flex items-center justify-between gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => void submitAutoContextFeedback(context)}
                                                            disabled={!feedbackReady}
                                                            className="rounded border border-cyan-500/40 bg-cyan-500/20 px-2 py-1 text-[10px] font-mono tracking-widest text-cyan-300 disabled:opacity-40"
                                                        >
                                                            {feedbackDraft.submitting ? "SENDING..." : feedbackDraft.submitted ? "SENT" : "SEND FEEDBACK"}
                                                        </button>
                                                        {feedbackDraft.error && (
                                                            <span className="text-[10px] text-rose-300">{feedbackDraft.error}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            {filteredContextEvents.length > 0 && (
                                                <div className="mt-2 border-t border-white/10 pt-2 space-y-1">
                                                    {filteredContextEvents.map((event) => (
                                                        <div key={event.id} className="space-y-1">
                                                            <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-white/45">
                                                                <span className="truncate">{event.summary}</span>
                                                                <span className="shrink-0">{formatAutoTimestamp(event.createdAt)}</span>
                                                            </div>
                                                            {event.kind === "completed" && event.attempts.length > 0 && (
                                                                <details className="rounded border border-white/10 bg-black/30 px-2 py-1">
                                                                    <summary className="cursor-pointer text-[9px] font-mono tracking-widest text-cyan-300">
                                                                        ATTEMPTS ({event.attempts.length})
                                                                    </summary>
                                                                    <div className="mt-1 space-y-1">
                                                                        {event.attempts.map((attempt, index) => (
                                                                            <div
                                                                                key={`${event.id}_attempt_${index}`}
                                                                                className="text-[9px] font-mono text-white/60 break-words"
                                                                            >
                                                                                {attempt.provider} · {attempt.status}
                                                                                {typeof attempt.latencyMs === "number" ? ` · ${attempt.latencyMs}ms` : ""}
                                                                                {attempt.error ? ` · ${attempt.error}` : ""}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </details>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="glass-panel p-5 rounded-xl flex flex-col border-t-2 border-cyan-500/50 min-h-[260px]">
                        <h3 className="text-[10px] font-mono font-bold tracking-widest text-white/50 mb-4 uppercase">Execution Plan</h3>
                        <div className="flex-1 overflow-y-auto">
                            <ToolCallTimeline calls={activeRun?.attempts ?? []} />
                        </div>
                    </div>

                    <div className="h-56">
                        <EvidencePanel items={evidenceItems} mode={renderMode} />
                    </div>
                </div>
                )}

            </div>
        </main>
    );
}

function UserMessage({ content }: { content: string }) {
    return (
        <div className="flex justify-end">
            <div className="bg-white/10 border border-white/10 rounded-2xl rounded-tr-sm px-5 py-3 max-w-[80%] text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                {content}
            </div>
        </div>
    );
}

type SystemMessageFeedback = {
    answerQuality?: AssistantFeedbackSignal;
    sourceQuality?: AssistantFeedbackSignal;
    submitting: boolean;
    submitted: boolean;
    error?: string;
    onVote: (dimension: AutoMissionFeedbackDimension, signal: AssistantFeedbackSignal) => void;
};

function SystemMessage({
    content,
    status,
    route,
    grounding,
    renderMode = "user_mode",
    onRetry,
    feedback,
}: {
    content: string;
    status?: string;
    route?: MessageRoute;
    grounding?: ChatMessage["grounding"];
    renderMode?: AssistantRenderMode;
    onRetry?: () => void;
    feedback?: SystemMessageFeedback;
}) {
    const showDiagnostics = renderMode === "debug_mode";
    const blockedQuality = isBlockedQualityOutput(content, grounding?.status);
    const blockedReasonCodes = parseBlockedReasons(content);
    const blockedReasonLabels = blockedReasonCodes.length > 0
        ? blockedReasonCodes.map((code) => mapBlockedReasonLabel(code))
        : ["응답 품질 기준을 충족하지 못했습니다."];
    const groundingSummary = buildGroundingSummary(grounding);
    const routeLabel =
        showDiagnostics && (route === "manual" ? "MANUAL" : route === "auto_context" ? "AUTO CONTEXT" : null);
    const routeClass =
        route === "manual"
            ? "text-cyan-300/90 border-cyan-500/40 bg-cyan-500/10"
            : route === "auto_context"
                ? "text-amber-300/90 border-amber-500/40 bg-amber-500/10"
                : "text-white/55 border-white/15 bg-black/30";
    const sourceByUrl = new Map((grounding?.sources ?? []).map((source) => [source.url, source]));
    const toDomain = (url: string): string => {
        try {
            return new URL(url).hostname;
        } catch {
            return "unknown";
        }
    };
    const resolveClaimCitations = (claim: NonNullable<NonNullable<ChatMessage["grounding"]>["claims"]>[number]) => {
        if (claim.citations && claim.citations.length > 0) {
            return claim.citations;
        }
        return claim.sourceUrls.map((url) => {
            const source = sourceByUrl.get(url);
            return {
                url,
                title: source?.title ?? toDomain(url),
                domain: source?.domain ?? toDomain(url),
            };
        });
    };
    return (
        <div className="flex justify-start">
            <div className="max-w-[96%]">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center">
                        <Sparkles size={12} className="text-cyan-400" />
                    </div>
                    <span className="font-mono text-[10px] font-bold tracking-widest text-cyan-400">JARVIS</span>
                    {showDiagnostics && status && (
                        <span className="font-mono text-[10px] text-white/40 italic">({status}...)</span>
                    )}
                    {routeLabel && (
                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-mono tracking-widest ${routeClass}`}>
                            {routeLabel}
                        </span>
                    )}
                </div>
                {!showDiagnostics && blockedQuality ? (
                    <div className="pl-9 max-w-[44rem]">
                        <div className="rounded border border-amber-500/35 bg-amber-500/10 px-4 py-3">
                            <p className="text-[12px] font-mono uppercase tracking-widest text-amber-300">브리핑 생성 실패</p>
                            <p className="mt-2 text-[14px] text-white/80">
                                수집된 근거는 있었지만 최종 응답 품질 기준을 통과하지 못했습니다.
                            </p>
                            <ul className="mt-2 space-y-1 text-[13px] text-white/75">
                                {blockedReasonLabels.map((label, index) => (
                                    <li key={`blocked_reason_${index}`}>- {label}</li>
                                ))}
                            </ul>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    className="rounded border border-cyan-500/40 bg-cyan-500/20 px-2.5 py-1 text-[10px] font-mono tracking-widest text-cyan-300 disabled:opacity-40"
                                    onClick={() => {
                                        onRetry?.();
                                    }}
                                    disabled={!onRetry}
                                >
                                    다시 시도
                                </button>
                                <Link
                                    href="/settings"
                                    className="rounded border border-white/20 bg-black/40 px-2.5 py-1 text-[10px] font-mono tracking-widest text-white/70 hover:text-white"
                                >
                                    PROVIDERS 설정
                                </Link>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-[15px] leading-relaxed text-white/80 pl-9 whitespace-pre-wrap break-words">
                        {content}
                    </div>
                )}
                {showDiagnostics && groundingSummary && (
                    <p className="pl-9 mt-2 text-[11px] font-mono text-cyan-300/80">
                        {groundingSummary}
                    </p>
                )}
                {(!blockedQuality || showDiagnostics) && grounding?.sources && grounding.sources.length > 0 && (
                    <div className="pl-9 mt-2 max-w-[42rem]">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-white/45">Sources</p>
                        <ul className="mt-1 space-y-1">
                            {grounding.sources.slice(0, 5).map((source) => (
                                <li key={source.url} className="text-[11px] text-white/70 break-all">
                                    <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-cyan-300 hover:text-cyan-200 underline decoration-cyan-500/40"
                                    >
                                        {source.title || source.domain}
                                    </a>
                                    <span className="ml-1 text-white/40">({source.domain})</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {showDiagnostics && grounding?.claims && grounding.claims.length > 0 && (
                    <div className="pl-9 mt-3 max-w-[44rem]">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-white/45">Claims</p>
                        <ol className="mt-1 space-y-2 list-decimal list-inside">
                            {grounding.claims.slice(0, 4).map((claim, claimIndex) => {
                                const citations = resolveClaimCitations(claim);
                                return (
                                    <li key={`${claim.claimText}_${claimIndex}`} className="text-[11px] text-white/75">
                                        <p className="inline">{claim.claimText}</p>
                                        {citations.length > 0 && (
                                            <div className="mt-1 flex flex-wrap gap-1.5">
                                                {citations.slice(0, 3).map((citation) => (
                                                    <a
                                                        key={`${claim.claimText}_${citation.url}`}
                                                        href={citation.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:text-cyan-200"
                                                    >
                                                        <span>{citation.title || citation.domain}</span>
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                )}
                {feedback && (
                    <div className="pl-9 mt-3 max-w-[34rem]">
                        <div className="rounded border border-white/10 bg-black/25 px-3 py-2">
                            <p className="text-[10px] font-mono uppercase tracking-widest text-white/45">Response Feedback</p>
                            <p className="mt-1 text-[11px] text-white/65">
                                {blockedQuality ? "실패 안내와 출처 신뢰도를 각각 평가해주세요." : "답변 품질과 출처 신뢰도를 각각 평가해주세요."}
                            </p>
                            <div className="mt-2 grid grid-cols-1 gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-mono text-white/55 min-w-[72px]">답변 품질</span>
                                    <button
                                        type="button"
                                        onClick={() => feedback.onVote("answer", "good")}
                                        disabled={feedback.submitting}
                                        className={`rounded border px-2 py-1 text-[10px] font-mono tracking-widest ${
                                            feedback.answerQuality === "good"
                                                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                                : "border-white/20 bg-black/40 text-white/60"
                                        }`}
                                    >
                                        GOOD
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => feedback.onVote("answer", "bad")}
                                        disabled={feedback.submitting}
                                        className={`rounded border px-2 py-1 text-[10px] font-mono tracking-widest ${
                                            feedback.answerQuality === "bad"
                                                ? "border-rose-400 bg-rose-500/20 text-rose-300"
                                                : "border-white/20 bg-black/40 text-white/60"
                                        }`}
                                    >
                                        BAD
                                    </button>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-mono text-white/55 min-w-[72px]">출처 신뢰도</span>
                                    <button
                                        type="button"
                                        onClick={() => feedback.onVote("source", "good")}
                                        disabled={feedback.submitting}
                                        className={`rounded border px-2 py-1 text-[10px] font-mono tracking-widest ${
                                            feedback.sourceQuality === "good"
                                                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                                : "border-white/20 bg-black/40 text-white/60"
                                        }`}
                                    >
                                        GOOD
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => feedback.onVote("source", "bad")}
                                        disabled={feedback.submitting}
                                        className={`rounded border px-2 py-1 text-[10px] font-mono tracking-widest ${
                                            feedback.sourceQuality === "bad"
                                                ? "border-rose-400 bg-rose-500/20 text-rose-300"
                                                : "border-white/20 bg-black/40 text-white/60"
                                        }`}
                                    >
                                        BAD
                                    </button>
                                </div>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                                {feedback.submitting && (
                                    <span className="text-[10px] font-mono text-cyan-300">SENDING...</span>
                                )}
                                {!feedback.submitting && feedback.submitted && (
                                    <span className="text-[10px] font-mono text-emerald-300">SENT</span>
                                )}
                            </div>
                            {feedback.error && (
                                <p className="mt-1 text-[10px] text-rose-300">{feedback.error}</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
