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
    hasOnlySoftWarnReasons,
    isBlockedQualityOutput,
    isQualityGuardFallbackOutput,
    isSoftWarnQualityOutput,
    mapBlockedReasonLabel,
    parseQualityReasonCodes,
    resolveQualityGateResult,
    resolveProviderUnavailableReason,
    type ProviderUnavailableReason,
    type QualityGateResult,
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
import { emitRuntimeEvent } from "@/lib/runtime-events";
import { isFeatureEnabled } from "@/lib/feature-flags";

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
        status:
            | "not_required"
            | "provider_only"
            | "required_unavailable"
            | "blocked_due_to_quality_gate"
            | "soft_warn"
            | "served_with_limits";
        reasons: string[];
        quality?: {
            gateResult: QualityGateResult;
            reasons: string[];
            softened: boolean;
            languageAligned: boolean;
            claimCitationCoverage: number;
        };
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

const ASSISTANT_SESSION_MESSAGES_STORAGE_KEY = "assistant-session-messages-v1";
const MAX_ASSISTANT_SESSION_MESSAGES = 120;
const ASSISTANT_SYSTEM_GREETING = "Connected to backend. Ask anything and I will route this to available providers.";

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
    gateResult: QualityGateResult;
    reasons: string[];
};

type AutoContextSyncRetryOptions = {
    attempts?: number;
    baseDelayMs?: number;
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
    const qualityGateResult = grounding.quality?.gateResult;
    if (grounding.status === "blocked_due_to_quality_gate") {
        return `Grounding: blocked by quality gate · ${reasons}`;
    }
    if (qualityGateResult === "soft_warn" || grounding.status === "soft_warn" || grounding.status === "served_with_limits") {
        return `Grounding: soft warning · ${reasons}`;
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

function buildSystemMessage(): ChatMessage {
    return {
        role: "assistant",
        content: ASSISTANT_SYSTEM_GREETING,
        route: "system",
    };
}

function defaultMessages(): ChatMessage[] {
    return [buildSystemMessage()];
}

function normalizeStoredChatMessages(value: unknown): ChatMessage[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const rows: ChatMessage[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const row = item as Record<string, unknown>;
        const role = row.role;
        const content = row.content;
        if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
            continue;
        }
        const route =
            row.route === "system" || row.route === "manual" || row.route === "auto_context"
                ? row.route
                : undefined;
        rows.push({
            role,
            content,
            status: typeof row.status === "string" ? row.status : undefined,
            contextId: typeof row.contextId === "string" ? row.contextId : undefined,
            route,
            promptRef: typeof row.promptRef === "string" ? row.promptRef : undefined,
            grounding:
                row.grounding && typeof row.grounding === "object"
                    ? (row.grounding as ChatMessage["grounding"])
                    : undefined,
        });
    }
    return rows;
}

function pruneSessionMessages(rows: ChatMessage[]): ChatMessage[] {
    if (rows.length <= MAX_ASSISTANT_SESSION_MESSAGES) {
        return rows;
    }
    return rows.slice(-MAX_ASSISTANT_SESSION_MESSAGES);
}

function loadStoredSessionMessages(): Record<string, ChatMessage[]> {
    if (typeof window === "undefined") {
        return {};
    }
    try {
        const raw = window.localStorage.getItem(ASSISTANT_SESSION_MESSAGES_STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return {};
        }
        const next: Record<string, ChatMessage[]> = {};
        for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
                continue;
            }
            const normalized = normalizeStoredChatMessages(value);
            if (normalized.length > 0) {
                next[sessionId] = pruneSessionMessages(normalized);
            }
        }
        return next;
    } catch {
        return {};
    }
}

function persistStoredSessionMessages(store: Record<string, ChatMessage[]>): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage.setItem(ASSISTANT_SESSION_MESSAGES_STORAGE_KEY, JSON.stringify(store));
    } catch {
        // localStorage may be unavailable.
    }
}

function resolveDeliveryRevision(context: Pick<AutoMissionContext, "revision" | "status" | "output">): number {
    if (typeof context.revision === "number" && Number.isFinite(context.revision)) {
        return context.revision;
    }
    const fallback = Number.parseInt(hashText(`${context.status}:${context.output}`), 16);
    if (Number.isFinite(fallback)) {
        return fallback;
    }
    return 0;
}

function toGroundingStatus(
    value: unknown,
    fallback: NonNullable<ChatMessage["grounding"]>["status"] = "provider_only"
): NonNullable<ChatMessage["grounding"]>["status"] {
    if (
        value === "not_required" ||
        value === "provider_only" ||
        value === "required_unavailable" ||
        value === "blocked_due_to_quality_gate" ||
        value === "soft_warn" ||
        value === "served_with_limits"
    ) {
        return value;
    }
    return fallback;
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
}

export function AssistantModule() {
    const { sessions, activeSessionId, markSessionContextDelivered } = useHUD();
    const [inputVal, setInputVal] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>(() => defaultMessages());
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
    const autoContextDeliveredRevisionRef = useRef<Map<string, number>>(new Map());
    const sessionMessageStoreRef = useRef<Record<string, ChatMessage[]>>({});
    const activeMessageSessionRef = useRef<string | null>(null);
    const pendingSessionPersistSkipRef = useRef<string | null>(null);
    const contextStreamRef = useRef<Map<string, AssistantContextEventsStream>>(new Map());
    const loadedContextEventsRef = useRef<Set<string>>(new Set());
    const loadedGroundingEvidenceRef = useRef<Set<string>>(new Set());
    const pendingTaskLinksRef = useRef<Map<string, string>>(new Map());
    const queuedRecoveryStartedRef = useRef(false);
    const queuedRecoveryInFlightRef = useRef(false);
    const exactlyOnceDeliveryEnabled = useMemo(
        () => isFeatureEnabled("assistant.exactly_once_delivery", true),
        []
    );
    const qualitySoftGateEnabled = useMemo(
        () => isFeatureEnabled("assistant.quality_soft_gate_v2", true),
        []
    );
    const uiSoftWarnEnabled = useMemo(
        () => isFeatureEnabled("assistant.ui_soft_warn_render", true),
        []
    );

    useEffect(() => {
        autoContextsRef.current = autoContexts;
    }, [autoContexts]);

    useEffect(() => {
        sessionMessageStoreRef.current = loadStoredSessionMessages();
    }, []);

    useEffect(() => {
        if (!exactlyOnceDeliveryEnabled) {
            return;
        }
        for (const session of sessions) {
            const delivered = session.lastDeliveredContextRevision ?? {};
            for (const [contextId, revision] of Object.entries(delivered)) {
                const existing = autoContextDeliveredRevisionRef.current.get(contextId);
                if (typeof existing === "number" && existing >= revision) {
                    continue;
                }
                autoContextDeliveredRevisionRef.current.set(contextId, revision);
            }
        }
    }, [exactlyOnceDeliveryEnabled, sessions]);

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
            return true;
        } catch {
            return false;
        }
    }, []);

    const syncAutoContextsWithRetry = useCallback(async (options?: AutoContextSyncRetryOptions) => {
        const attempts = Math.max(1, options?.attempts ?? 4);
        const baseDelayMs = Math.max(80, options?.baseDelayMs ?? 220);
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const ok = await syncAutoContexts();
            if (ok) {
                return true;
            }
            if (attempt + 1 >= attempts) {
                break;
            }
            const delayMs = baseDelayMs * Math.pow(2, attempt);
            await new Promise((resolve) => {
                window.setTimeout(resolve, delayMs);
            });
        }
        return false;
    }, [syncAutoContexts]);

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
                autoContextDeliveredRevisionRef.current.delete(missionIntakeId);

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
                    client_run_nonce: `${missionIntakeId}:recover`,
                });
            }

            void syncAutoContextsWithRetry();
        } catch {
            return;
        } finally {
            queuedRecoveryInFlightRef.current = false;
        }
    }, [syncAutoContextsWithRetry]);

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
        autoContextDeliveredRevisionRef.current.delete(payload.id);

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
            const runNonce =
                typeof payload.requestNonce === "string" && payload.requestNonce.trim().length > 0
                    ? payload.requestNonce.trim()
                    : `${payload.id}:run`;
            const accepted = await runAssistantContext(serverContextId, {
                provider: requestPayload.provider,
                strict_provider: requestPayload.strict_provider,
                model: requestPayload.model,
                task_type: payload.taskMode,
                client_run_nonce: runNonce,
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
            void syncAutoContextsWithRetry();
        }
    }, [buildRequestPayload, syncAutoContextsWithRetry]);

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
                const resolvedGateResult = resolveQualityGateResult({
                    content: result.output,
                    groundingStatus: result.grounding?.status,
                    qualityGateResult: result.grounding?.quality?.gateResult ?? result.grounding?.quality_gate_result,
                });
                const qualityReasonCodes = parseQualityReasonCodes(
                    result.output,
                    result.grounding?.quality?.reasons ?? result.grounding?.quality_gate_code
                );
                const softenedByQualityPolicy =
                    qualitySoftGateEnabled &&
                    (result.grounding?.quality?.softened ?? resolvedGateResult === "soft_warn");
                const normalizedGrounding = result.grounding
                    ? {
                        policy: result.grounding.policy,
                        required: result.grounding.required,
                        status: result.grounding.status,
                        reasons: result.grounding.reasons ?? [],
                        quality: {
                            gateResult: resolvedGateResult,
                            reasons: qualityReasonCodes,
                            softened: softenedByQualityPolicy,
                            languageAligned:
                                result.grounding.quality?.languageAligned ??
                                !qualityReasonCodes.includes("language_mismatch"),
                            claimCitationCoverage:
                                result.grounding.quality?.claimCitationCoverage ?? 0,
                        },
                        sources: result.grounding.sources,
                        claims: result.grounding.claims?.map((claim) => ({
                            claimText: claim.claimText,
                            sourceUrls: claim.sourceUrls,
                        })),
                      }
                    : undefined;
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
                        grounding: normalizedGrounding,
                    },
                ]);
                emitRuntimeEvent("assistant_quality_evaluated", {
                    route: "manual",
                    gateResult: resolvedGateResult,
                    reasons: qualityReasonCodes,
                    promptHash: hashText(normalizedPrompt),
                });
                if (resolvedGateResult === "soft_warn") {
                    emitRuntimeEvent("assistant_quality_softened", {
                        route: "manual",
                        reasons: qualityReasonCodes,
                        softened: softenedByQualityPolicy,
                    });
                }
                emitRuntimeEvent("assistant_delivery_rendered", {
                    route: "manual",
                    gateResult: resolvedGateResult,
                    softWarnRendered: uiSoftWarnEnabled && resolvedGateResult === "soft_warn",
                    promptHash: hashText(normalizedPrompt),
                });
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
            emitRuntimeEvent("assistant_delivery_rendered", {
                route: "manual",
                gateResult: "pass",
                parallelRuns: runCount,
                promptHash: hashText(normalizedPrompt),
            });
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
    }, [
        buildRequestPayload,
        buildSynthesisMessage,
        createPendingRuns,
        isRunning,
        modelOverride,
        parallelRuns,
        qualitySoftGateEnabled,
        toRunTimeline,
        uiSoftWarnEnabled,
    ]);

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
                autoContextDeliveredRevisionRef.current.delete(payload.id);
                void syncAutoContextsWithRetry();
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
    }, [startAutoMissionContext, syncAutoContextsWithRetry]);

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
                return { degraded: false, gateResult: "pass", reasons: [] };
            }

            const rows = autoContextEvents[context.id] ?? [];
            for (let index = rows.length - 1; index >= 0; index -= 1) {
                const event = rows[index];
                if (!event || event.kind !== "completed") {
                    continue;
                }
                const data = event.data ?? {};
                const qualityReasons = parseQualityReasonCodes(
                    context.output,
                    toStringArray(data.quality_gate_code)
                );
                const gateResult = resolveQualityGateResult({
                    content: context.output,
                    groundingStatus: typeof data.grounding_status === "string" ? data.grounding_status : undefined,
                    qualityGateResult:
                        typeof data.quality_gate_result === "string"
                            ? data.quality_gate_result
                            : data.quality_guard_triggered === true
                                ? "hard_fail"
                                : data.quality_gate_softened === true
                                    ? "soft_warn"
                                    : undefined,
                });
                const reason =
                    typeof data.quality_guard_reason === "string"
                        ? data.quality_guard_reason
                        : qualityReasons[0];
                return {
                    degraded: gateResult !== "pass",
                    reason,
                    gateResult,
                    reasons: qualityReasons,
                };
            }

            if (isQualityGuardFallbackOutput(context.output)) {
                return {
                    degraded: true,
                    reason: "quality_guard_output",
                    gateResult: "hard_fail",
                    reasons: parseQualityReasonCodes(context.output),
                };
            }

            return {
                degraded: false,
                gateResult: "pass",
                reasons: [],
            };
        },
        [autoContextEvents]
    );

    const resolveAutoContextGrounding = useCallback(
        (context: AutoMissionContext): ChatMessage["grounding"] | undefined => {
            const rows = autoContextEvents[context.id] ?? [];
            const qualityState = resolveAutoContextQualityState(context);
            for (let index = rows.length - 1; index >= 0; index -= 1) {
                const event = rows[index];
                if (!event || event.kind !== "completed") {
                    continue;
                }
                const data = event.data ?? {};
                const qualityReasons = parseQualityReasonCodes(
                    context.output,
                    toStringArray(data.quality_gate_code)
                );
                const gateResult = resolveQualityGateResult({
                    content: context.output,
                    groundingStatus: typeof data.grounding_status === "string" ? data.grounding_status : undefined,
                    qualityGateResult:
                        typeof data.quality_gate_result === "string"
                            ? data.quality_gate_result
                            : qualityState.gateResult,
                });
                const reasons = toStringArray(data.grounding_reasons);
                const required = data.grounding_required === true;
                const statusFallback =
                    gateResult === "hard_fail"
                        ? "blocked_due_to_quality_gate"
                        : gateResult === "soft_warn"
                            ? "soft_warn"
                            : required
                                ? "provider_only"
                                : "not_required";

                return {
                    policy:
                        data.grounding_policy === "static" ||
                        data.grounding_policy === "dynamic_factual" ||
                        data.grounding_policy === "high_risk_factual"
                            ? data.grounding_policy
                            : "dynamic_factual",
                    required,
                    status: toGroundingStatus(data.grounding_status, statusFallback),
                    reasons: reasons.length > 0 ? reasons : qualityReasons,
                    quality: {
                        gateResult,
                        reasons: qualityReasons,
                        softened: data.quality_gate_softened === true || gateResult === "soft_warn",
                        languageAligned: !qualityReasons.includes("language_mismatch"),
                        claimCitationCoverage:
                            typeof data.claim_citation_coverage === "number"
                                ? data.claim_citation_coverage
                                : 0,
                    },
                };
            }

            if (context.status === "success" && qualityState.gateResult !== "pass") {
                return {
                    policy: "dynamic_factual",
                    required: true,
                    status: qualityState.gateResult === "hard_fail" ? "blocked_due_to_quality_gate" : "soft_warn",
                    reasons: qualityState.reasons,
                    quality: {
                        gateResult: qualityState.gateResult,
                        reasons: qualityState.reasons,
                        softened: qualityState.gateResult === "soft_warn",
                        languageAligned: !qualityState.reasons.includes("language_mismatch"),
                        claimCitationCoverage: 0,
                    },
                };
            }

            return undefined;
        },
        [autoContextEvents, resolveAutoContextQualityState]
    );

    const buildAutoContextStatusLabel = useCallback(
        (context: AutoMissionContext): string => {
            const qualityState = resolveAutoContextQualityState(context);
            const providerLabel =
                context.servedProvider && context.servedModel
                    ? `${context.servedProvider}/${context.servedModel}${context.usedFallback ? " (fallback)" : ""}`
                    : null;
            if (context.status === "error") {
                return "FAILED";
            }
            if (qualityState.gateResult === "hard_fail") {
                return `DEGRADED${providerLabel ? ` · ${providerLabel}` : ""}`;
            }
            if (qualityState.gateResult === "soft_warn") {
                return `WARN${providerLabel ? ` · ${providerLabel}` : ""}`;
            }
            return providerLabel ?? "DONE";
        },
        [resolveAutoContextQualityState]
    );

    useEffect(() => {
        if (!activeSessionId) {
            pendingSessionPersistSkipRef.current = null;
            activeMessageSessionRef.current = null;
            setMessages(defaultMessages());
            return;
        }

        const cached = sessionMessageStoreRef.current[activeSessionId];
        const hasMeaningfulCachedMessage =
            Array.isArray(cached) &&
            cached.some(
                (row) =>
                    row.route !== "system" ||
                    row.role === "user" ||
                    row.content !== ASSISTANT_SYSTEM_GREETING
            );
        if (Array.isArray(cached) && cached.length > 0 && hasMeaningfulCachedMessage) {
            pendingSessionPersistSkipRef.current = activeSessionId;
            activeMessageSessionRef.current = activeSessionId;
            setMessages(cached);
            return;
        }

        const activeSession = sessions.find((session) => session.id === activeSessionId);
        if (!activeSession) {
            const fallbackMessages = defaultMessages();
            pendingSessionPersistSkipRef.current = activeSessionId;
            activeMessageSessionRef.current = activeSessionId;
            setMessages(fallbackMessages);
            sessionMessageStoreRef.current[activeSessionId] = fallbackMessages;
            persistStoredSessionMessages(sessionMessageStoreRef.current);
            return;
        }

        const candidateContexts = autoContexts
            .filter((context) => context.status !== "running")
            .filter((context) => context.id === activeSession.id || (activeSession.taskId && context.taskId === activeSession.taskId))
            .sort((left, right) => {
                const leftTime = Date.parse(left.completedAt ?? left.startedAt);
                const rightTime = Date.parse(right.completedAt ?? right.startedAt);
                const normalizedLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
                const normalizedRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
                return normalizedRightTime - normalizedLeftTime;
            });

        const restoredContext = candidateContexts[0];
        const restoredGrounding = restoredContext ? resolveAutoContextGrounding(restoredContext) : undefined;
        const fallbackMessages = restoredContext
            ? [
                buildSystemMessage(),
                {
                    role: "assistant" as const,
                    content: restoredContext.output,
                    status: buildAutoContextStatusLabel(restoredContext),
                    contextId: restoredContext.id,
                    route: "auto_context" as const,
                    promptRef: restoredContext.prompt,
                    grounding: restoredGrounding,
                },
              ]
            : defaultMessages();

        const normalizedFallbackMessages = pruneSessionMessages(fallbackMessages);
        pendingSessionPersistSkipRef.current = activeSessionId;
        activeMessageSessionRef.current = activeSessionId;
        setMessages(normalizedFallbackMessages);
        sessionMessageStoreRef.current[activeSessionId] = normalizedFallbackMessages;
        persistStoredSessionMessages(sessionMessageStoreRef.current);
    }, [activeSessionId, autoContexts, buildAutoContextStatusLabel, resolveAutoContextGrounding, sessions]);

    useEffect(() => {
        if (!activeSessionId || activeMessageSessionRef.current !== activeSessionId) {
            return;
        }
        if (pendingSessionPersistSkipRef.current === activeSessionId) {
            pendingSessionPersistSkipRef.current = null;
            return;
        }
        const normalizedMessages = pruneSessionMessages(messages);
        sessionMessageStoreRef.current[activeSessionId] = normalizedMessages;
        persistStoredSessionMessages(sessionMessageStoreRef.current);
    }, [activeSessionId, messages]);

    const appendMessageToSession = useCallback(
        (sessionId: string | null | undefined, message: ChatMessage) => {
            const targetSessionId = sessionId ?? activeSessionId;
            if (!targetSessionId) {
                setMessages((prev) => pruneSessionMessages([...prev, message]));
                return;
            }

            const baseMessages = sessionMessageStoreRef.current[targetSessionId] ?? defaultMessages();
            const dedupedBase =
                message.contextId && message.contextId.trim().length > 0
                    ? baseMessages.filter((row) => row.contextId !== message.contextId)
                    : baseMessages;
            const nextMessages = pruneSessionMessages([...dedupedBase, message]);
            sessionMessageStoreRef.current[targetSessionId] = nextMessages;
            persistStoredSessionMessages(sessionMessageStoreRef.current);

            if (activeSessionId === targetSessionId) {
                activeMessageSessionRef.current = targetSessionId;
                setMessages(nextMessages);
            }
        },
        [activeSessionId]
    );

    const deliverAutoContextMessage = useCallback(
        (context: AutoMissionContext, sessionId?: string | null) => {
            if (context.status === "running") {
                return;
            }
            const grounding = resolveAutoContextGrounding(context);
            const qualityGateResult = resolveQualityGateResult({
                content: context.output,
                groundingStatus: grounding?.status,
                qualityGateResult: grounding?.quality?.gateResult,
            });
            const qualityReasonCodes = parseQualityReasonCodes(context.output, grounding?.quality?.reasons);
            const revision = resolveDeliveryRevision(context);
            if (exactlyOnceDeliveryEnabled) {
                const deliveredRevision = autoContextDeliveredRevisionRef.current.get(context.id);
                if (typeof deliveredRevision === "number" && revision <= deliveredRevision) {
                    return;
                }
                autoContextDeliveredRevisionRef.current.set(context.id, revision);
            }

            appendMessageToSession(sessionId, {
                role: "assistant",
                content: context.output,
                status: buildAutoContextStatusLabel(context),
                contextId: context.id,
                route: "auto_context",
                promptRef: context.prompt,
                grounding,
            });

            emitRuntimeEvent("auto_context_delivered", {
                contextId: context.id,
                revision,
                status: context.status,
                exactlyOnceDeliveryEnabled,
                sessionId: sessionId ?? null,
                taskId: context.taskId ?? null,
                outputHash: hashText(context.output),
            });
            emitRuntimeEvent("assistant_quality_evaluated", {
                route: "auto_context",
                contextId: context.id,
                gateResult: qualityGateResult,
                reasons: qualityReasonCodes,
            });
            if (qualityGateResult === "soft_warn") {
                emitRuntimeEvent("assistant_quality_softened", {
                    route: "auto_context",
                    contextId: context.id,
                    reasons: qualityReasonCodes,
                    softened: true,
                });
            }
            emitRuntimeEvent("assistant_delivery_rendered", {
                route: "auto_context",
                contextId: context.id,
                revision,
                gateResult: qualityGateResult,
                softWarnRendered: uiSoftWarnEnabled && qualityGateResult === "soft_warn",
            });
            if (exactlyOnceDeliveryEnabled && sessionId) {
                markSessionContextDelivered(sessionId, context.id, revision);
            }
        },
        [
            appendMessageToSession,
            buildAutoContextStatusLabel,
            exactlyOnceDeliveryEnabled,
            markSessionContextDelivered,
            resolveAutoContextGrounding,
            uiSoftWarnEnabled,
        ]
    );

    useEffect(() => {
        const completedContexts = autoContexts.filter((context) => context.status !== "running");
        if (completedContexts.length === 0) {
            return;
        }

        if (activeSessionId) {
            const activeSession = sessions.find((session) => session.id === activeSessionId);
            if (activeSession) {
                const candidateContexts = completedContexts
                    .filter((context) => context.id === activeSession.id || (activeSession.taskId && context.taskId === activeSession.taskId))
                    .sort((left, right) => {
                        const leftTime = Date.parse(left.completedAt ?? left.startedAt);
                        const rightTime = Date.parse(right.completedAt ?? right.startedAt);
                        const normalizedLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
                        const normalizedRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
                        return normalizedRightTime - normalizedLeftTime;
                    });
                const preferred = candidateContexts[0];
                if (preferred) {
                    autoContextStartedThisSessionRef.current.add(preferred.id);
                    deliverAutoContextMessage(preferred, activeSession.id);
                }
            }
        }

        const resolveSessionIdForContext = (context: AutoMissionContext): string | null => {
            const linked = sessions.find(
                (session) => session.id === context.id || (session.taskId && context.taskId && session.taskId === context.taskId)
            );
            if (linked) {
                return linked.id;
            }
            return activeSessionId ?? null;
        };

        const queued = completedContexts
            .filter((context) => autoContextStartedThisSessionRef.current.has(context.id))
            .sort((left, right) => {
                const leftTime = Date.parse(left.completedAt ?? left.startedAt);
                const rightTime = Date.parse(right.completedAt ?? right.startedAt);
                const normalizedLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
                const normalizedRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
                return normalizedLeftTime - normalizedRightTime;
            });

        for (const context of queued) {
            deliverAutoContextMessage(context, resolveSessionIdForContext(context));
        }
    }, [activeSessionId, autoContexts, deliverAutoContextMessage, sessions]);

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
                                        quality: message.grounding?.quality,
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
                                    softWarnUiEnabled={uiSoftWarnEnabled}
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
                                softWarnUiEnabled={uiSoftWarnEnabled}
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
    softWarnUiEnabled = true,
    onRetry,
    feedback,
}: {
    content: string;
    status?: string;
    route?: MessageRoute;
    grounding?: ChatMessage["grounding"];
    renderMode?: AssistantRenderMode;
    softWarnUiEnabled?: boolean;
    onRetry?: () => void;
    feedback?: SystemMessageFeedback;
}) {
    const showDiagnostics = renderMode === "debug_mode";
    const qualityGateResult = resolveQualityGateResult({
        content,
        groundingStatus: grounding?.status,
        qualityGateResult: grounding?.quality?.gateResult,
    });
    const blockedQuality = isBlockedQualityOutput(content, grounding?.status, qualityGateResult);
    const softWarnQuality =
        softWarnUiEnabled &&
        isSoftWarnQualityOutput(content, grounding?.status, qualityGateResult) &&
        !blockedQuality;
    const reasonCodes = parseQualityReasonCodes(content, grounding?.quality?.reasons);
    const blockedReasonCodes = qualityGateResult === "hard_fail" ? reasonCodes : [];
    const softWarnReasonCodes = qualityGateResult === "soft_warn" ? reasonCodes : [];
    const blockedReasonLabels = blockedReasonCodes.length > 0
        ? blockedReasonCodes.map((code) => mapBlockedReasonLabel(code))
        : ["응답 품질 기준을 충족하지 못했습니다."];
    const softWarnReasonLabels = softWarnReasonCodes.length > 0
        ? softWarnReasonCodes.map((code) => mapBlockedReasonLabel(code))
        : ["근거 품질이 일부 기준에 미달해 보정된 응답으로 제공됩니다."];
    const softWarnDisplayLabels = hasOnlySoftWarnReasons(softWarnReasonCodes)
        ? softWarnReasonLabels
        : [...softWarnReasonLabels, "일부 위험 신호로 인해 제한 모드로 응답했습니다."];
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
                    <div className="pl-9 max-w-[44rem]">
                        {softWarnQuality && (
                            <div className="mb-3 rounded border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                                <p className="text-[11px] font-mono uppercase tracking-widest text-amber-300">
                                    품질 경고 (SOFT WARN)
                                </p>
                                <ul className="mt-1 space-y-0.5 text-[12px] text-white/75">
                                    {softWarnDisplayLabels.map((label, index) => (
                                        <li key={`soft_warn_reason_${index}`}>- {label}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <div className="text-[15px] leading-relaxed text-white/80 whitespace-pre-wrap break-words">
                            {content}
                        </div>
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
