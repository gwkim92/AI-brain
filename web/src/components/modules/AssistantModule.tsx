"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RunnerGraphSummaryPanel } from "@/components/modules/RunnerGraphSummaryPanel";
import { ToolCallTimeline, ToolCall } from "@/components/ui/ToolCallTimeline";
import { EvidencePanel, Evidence } from "@/components/ui/EvidencePanel";
import { MarkdownLite } from "@/components/ui/MarkdownLite";
import { Send, Sparkles, BrainCircuit, Loader2 } from "lucide-react";
import {
    aiRespond,
    appendAssistantContextEvent,
    createAssistantContext,
    createJarvisRequest,
    getAssistantContext,
    getAssistantContextGroundingEvidence,
    getJarvisSession,
    listTasks,
    listAssistantContexts,
    listAssistantContextEvents,
    listProviderModels,
    listProviders,
    runAssistantContext,
    runAssistantContextWithMeta,
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
    AssistantStage,
    AiRespondData,
    AssistantContextGroundingClaimRecord,
    AssistantContextGroundingSourceRecord,
    AssistantContextRecord,
    JarvisSessionDetail,
    JarvisMemoryPlanSignal,
    ProviderAttempt,
    ProviderAvailability,
    ProviderModelCatalogEntry,
    RuntimeSelectedCredential,
    WatcherKind,
} from "@/lib/api/types";
import { subscribeMissionIntake, subscribeMissionIntakeTaskLink, type MissionIntakePayload } from "@/lib/hud/mission-intake";
import { dispatchCouncilIntake } from "@/lib/hud/council-intake";
import { dispatchJarvisDataRefresh } from "@/lib/hud/data-refresh";
import { useHUD } from "@/components/providers/HUDProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { emitRuntimeEvent } from "@/lib/runtime-events";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { TranslationKey } from "@/lib/locale";
import { describeExecutionOption } from "@/lib/jarvis/execution-option";
import { buildLaunchWidgetPlan, inferHudIntent, resolveWorkspaceForIntent } from "@/lib/hud/intent-router";
import { measureHudViewport, tileWidgetLayouts } from "@/lib/hud/widget-layout";
import {
    describeResearchProfile,
    describeResearchProfileReason,
    describeResearchQualityMode,
    readResearchProfile,
    readResearchProfileReasons,
    readResearchQualityMode,
    resolveResearchWarningLabels,
    summarizeResearchQualityDimensions,
} from "@/lib/research-quality";

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
const STALE_AUTO_CONTEXT_ERROR_CODE = "server_state_lost";
const STALE_AUTO_CONTEXT_ERROR_CODES = new Set([STALE_AUTO_CONTEXT_ERROR_CODE, "SERVER_RUN_STATE_LOST"]);
const STALE_AUTO_CONTEXT_MESSAGE = "Server state was lost for this run. Re-run this session.";
const AUTO_CONTEXT_STALE_TIMEOUT_MS = 45_000;
const SESSION_LAUNCH_HIGHLIGHT_MS = 90_000;

function isStaleAutoContext(context: AutoMissionContext): boolean {
    return typeof context.error === "string" && STALE_AUTO_CONTEXT_ERROR_CODES.has(context.error);
}

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
    servedCredential?: string | null;
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

type AssistantStageTimelineRow = {
    stage: AssistantStage;
    stageSeq: number;
    startedAt: string;
    endedAt: string | null;
    reasonCode: string | null;
    finalized: "delivered" | "failed" | null;
    status: "done" | "running" | "failed";
    contextId: string;
};

type AssistantReasoningSummary = {
    headline: string;
    lines: string[];
    qualityResult: QualityGateResult | "running" | null;
};

type AssistantStageProgress = {
    currentStageLabel: string;
    progressPercent: number;
    isRunning: boolean;
    hasFailed: boolean;
    elapsedLabel: string | null;
};

const STAGE_ORDER: AssistantStage[] = [
    "accepted",
    "policy_resolved",
    "retrieval_started",
    "retrieval_completed",
    "generation_started",
    "quality_checked",
    "finalized",
];

const STAGE_LABELS: Record<AssistantStage, string> = {
    accepted: "Accepted",
    policy_resolved: "Policy",
    retrieval_started: "Retrieval Start",
    retrieval_completed: "Retrieval Done",
    generation_started: "Generation",
    quality_checked: "Quality",
    finalized: "Finalized",
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

function mapProviderAttemptStatus(status: "success" | "failed" | "skipped"): ToolCall["status"] {
    if (status === "success") return "success";
    if (status === "failed") return "error";
    return "pending";
}

function formatSelectedCredentialLabel(credential?: RuntimeSelectedCredential | null): string | null {
    if (!credential || !credential.selected_credential_mode) {
        return null;
    }
    return `${credential.selected_credential_mode} (${credential.source})`;
}

function formatAttemptCredentialLabel(
    credential:
        | {
              source: string;
              selectedCredentialMode: string | null;
              credentialPriority: string;
          }
        | undefined
): string | null {
    if (!credential?.selectedCredentialMode) {
        return null;
    }
    return `${credential.selectedCredentialMode} (${credential.source}) · ${credential.credentialPriority}`;
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

function toAssistantStage(value: unknown): AssistantStage | null {
    if (
        value === "accepted" ||
        value === "policy_resolved" ||
        value === "retrieval_started" ||
        value === "retrieval_completed" ||
        value === "generation_started" ||
        value === "quality_checked" ||
        value === "finalized"
    ) {
        return value;
    }
    return null;
}

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function toIsoStringOrNow(value: unknown): string {
    if (typeof value === "string" && value.trim().length > 0) {
        return value;
    }
    return new Date().toISOString();
}

function toQualityGateResult(value: unknown): QualityGateResult | null {
    if (value === "hard_fail" || value === "soft_warn" || value === "pass") {
        return value;
    }
    return null;
}

function formatElapsedShort(startedAt: string, nowMs: number): string | null {
    const startedAtMs = Date.parse(startedAt);
    if (Number.isNaN(startedAtMs)) {
        return null;
    }
    const elapsedSec = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
    if (elapsedSec < 60) {
        return `${elapsedSec}s`;
    }
    const minutes = Math.floor(elapsedSec / 60);
    const seconds = elapsedSec % 60;
    return `${minutes}m ${seconds}s`;
}

function describeSessionEntry(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    source?: string | null
): string {
    if (source === "inbox_quick_command") {
        return t("assistant.entry.commandBar");
    }
    if (source === "assistant_manual") {
        return t("assistant.entry.assistant");
    }
    if (source === "watcher_run") {
        return t("assistant.entry.watcher");
    }
    return t("assistant.entry.default");
}

function describePrimaryTarget(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    target?: JarvisSessionDetail["session"]["primaryTarget"]
): string {
    if (target === "dossier") return t("assistant.target.dossier");
    if (target === "council") return t("assistant.target.council");
    if (target === "mission") return t("assistant.target.mission");
    if (target === "execution") return t("assistant.target.execution");
    return t("assistant.target.default");
}

function describeCapability(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    capability: string
): string {
    if (capability === "answer") return t("assistant.capability.answer");
    if (capability === "research") return t("assistant.capability.research");
    if (capability === "brief") return t("assistant.capability.brief");
    if (capability === "debate") return t("assistant.capability.debate");
    if (capability === "plan") return t("assistant.capability.plan");
    if (capability === "approve") return t("assistant.capability.approve");
    if (capability === "execute") return t("assistant.capability.execute");
    if (capability === "notify") return t("assistant.capability.notify");
    return capability;
}

function describeCapabilityHint(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    capability: string
): string {
    if (capability === "answer") return t("assistant.capabilityHint.answer");
    if (capability === "research") return t("assistant.capabilityHint.research");
    if (capability === "brief") return t("assistant.capabilityHint.brief");
    if (capability === "debate") return t("assistant.capabilityHint.debate");
    if (capability === "plan") return t("assistant.capabilityHint.plan");
    if (capability === "approve") return t("assistant.capabilityHint.approve");
    if (capability === "execute") return t("assistant.capabilityHint.execute");
    if (capability === "notify") return t("assistant.capabilityHint.notify");
    return t("assistant.event.updated");
}

function summarizeCapabilityPlan(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    capabilities: string[]
): string | null {
    if (capabilities.length === 0) return null;
    return t("assistant.planSequence", {
        value: capabilities.map((capability) => describeCapability(t, capability)).join(" → "),
    });
}

function describeJarvisStatus(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    status: string
): string {
    if (status === "queued") return t("assistant.status.queued");
    if (status === "running") return t("assistant.status.running");
    if (status === "blocked") return t("assistant.status.blocked");
    if (status === "needs_approval") return t("assistant.status.needsApproval");
    if (status === "completed") return t("assistant.status.completed");
    if (status === "failed") return t("assistant.status.failed");
    if (status === "stale") return t("assistant.status.stale");
    if (status === "skipped") return t("assistant.status.skipped");
    return status;
}

function describeNextAction(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    action: JarvisSessionDetail["next_action"],
    researchProfile?: string | null,
    executionOption?: string | null
): string | null {
    if (!action) return null;
    if (action.kind === "open_action_center") {
        if (executionOption === "read_only_first" || executionOption === "read_only_review") {
            return t("assistant.summary.approvalRequiredReadOnly");
        }
        if (executionOption === "approval_required_write") {
            return t("assistant.summary.approvalRequiredWrite");
        }
        return t("assistant.nextAction.openActionCenter");
    }
    if (action.kind === "open_brief") {
        if (researchProfile === "comparison_research") return t("assistant.nextAction.openComparisonBrief");
        if (researchProfile === "repo_research") return t("assistant.nextAction.openRepoBrief");
        if (researchProfile === "market_research") return t("assistant.nextAction.openMarketBrief");
        if (researchProfile === "policy_regulation") return t("assistant.nextAction.openPolicyBrief");
        if (researchProfile === "entity_brief") return t("assistant.nextAction.openEntityBrief");
        return t("assistant.nextAction.openBrief");
    }
    if (action.kind === "open_workbench") return t("assistant.nextAction.openWorkbench");
    if (action.kind === "create_monitor") {
        if (researchProfile === "policy_regulation") return t("assistant.nextAction.createPolicyMonitor");
        if (researchProfile === "market_research") return t("assistant.nextAction.createMarketMonitor");
        if (researchProfile === "entity_brief") return t("assistant.nextAction.createEntityMonitor");
        return t("assistant.nextAction.createMonitor");
    }
    return action.label;
}

function describePrimaryArtifactActionLabel(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    researchProfile?: string | null
): string {
    if (researchProfile === "comparison_research") return t("assistant.openComparisonBrief");
    if (researchProfile === "repo_research") return t("assistant.openRepoBrief");
    if (researchProfile === "market_research") return t("assistant.openMarketBrief");
    if (researchProfile === "policy_regulation") return t("assistant.openPolicyBrief");
    if (researchProfile === "entity_brief") return t("assistant.openEntityBrief");
    return t("assistant.openDossier");
}

function describeMonitorActionLabel(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    researchProfile?: string | null
): string {
    if (researchProfile === "entity_brief") return t("assistant.trackEntity");
    if (researchProfile === "market_research") return t("assistant.trackMarket");
    if (researchProfile === "policy_regulation") return t("assistant.trackPolicy");
    return t("assistant.trackTopic");
}

function describeNextActionButtonLabel(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    action: JarvisSessionDetail["next_action"],
    researchProfile?: string | null,
    executionOption?: string | null
): string | null {
    if (!action) return null;
    if (action.kind === "open_action_center") {
        if (executionOption === "read_only_first" || executionOption === "read_only_review") {
            return t("assistant.cta.reviewReadOnlyChecks");
        }
        if (executionOption === "approval_required_write" || executionOption === "standard") {
            return t("assistant.cta.reviewWriteApproval");
        }
        return t("assistant.openActionCenter");
    }
    if (action.kind === "open_workbench") {
        if (executionOption === "safe_auto_run") {
            return t("assistant.cta.followAutoRun");
        }
        return t("assistant.openWorkbench");
    }
    if (action.kind === "open_brief") {
        return describePrimaryArtifactActionLabel(t, researchProfile);
    }
    if (action.kind === "create_monitor") {
        return describeMonitorActionLabel(t, researchProfile);
    }
    return action.label;
}

function describeMemoryNoteKind(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    kind: string
): string {
    if (kind === "user_preference") return t("memory.noteKind.user_preference");
    if (kind === "project_context") return t("memory.noteKind.project_context");
    if (kind === "decision_memory") return t("memory.noteKind.decision_memory");
    if (kind === "research_memory") return t("memory.noteKind.research_memory");
    return kind;
}

function describeMemoryPlanSignal(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    signal: JarvisMemoryPlanSignal
): string {
    if (signal === "pinned_context") return t("assistant.memoryPlanSignal.pinned_context");
    if (signal === "project_context_available") return t("assistant.memoryPlanSignal.project_context_available");
    if (signal === "research_history_available") return t("assistant.memoryPlanSignal.research_history_available");
    if (signal === "recent_approval_history") return t("assistant.memoryPlanSignal.recent_approval_history");
    if (signal === "recent_rejection_history") return t("assistant.memoryPlanSignal.recent_rejection_history");
    if (signal === "risk_first_preference") return t("assistant.memoryPlanSignal.risk_first_preference");
    if (signal === "approval_sensitive_preference") return t("assistant.memoryPlanSignal.approval_sensitive_preference");
    if (signal === "monitor_followup_preference") return t("assistant.memoryPlanSignal.monitor_followup_preference");
    if (signal === "notify_followup_preference") return t("assistant.memoryPlanSignal.notify_followup_preference");
    if (signal === "concise_response_preference") return t("assistant.memoryPlanSignal.concise_response_preference");
    if (signal === "detailed_response_preference") return t("assistant.memoryPlanSignal.detailed_response_preference");
    if (signal === "preferred_provider_available") return t("assistant.memoryPlanSignal.preferred_provider_available");
    if (signal === "preferred_model_available") return t("assistant.memoryPlanSignal.preferred_model_available");
    return signal;
}

function describeMemoryInfluenceLine(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    input: {
        responseStyle?: string | null;
        preferredProvider?: string | null;
        preferredModel?: string | null;
        approvalStyle?: string | null;
        monitoringPreference?: string | null;
        projectName?: string | null;
        repoSlug?: string | null;
        pinnedRefCount?: number;
    }
): string[] {
    const lines: string[] = [];
    if (input.responseStyle === "concise") {
        lines.push(t("assistant.memoryInfluence.responseStyle", { value: t("memory.preferences.responseStyle.concise") }));
    } else if (input.responseStyle === "balanced") {
        lines.push(t("assistant.memoryInfluence.responseStyle", { value: t("memory.preferences.responseStyle.balanced") }));
    } else if (input.responseStyle === "detailed") {
        lines.push(t("assistant.memoryInfluence.responseStyle", { value: t("memory.preferences.responseStyle.detailed") }));
    }
    if (input.preferredProvider) {
        lines.push(
            t("assistant.memoryInfluence.preferredProvider", {
                value: t(`memory.preferences.provider.${input.preferredProvider}` as TranslationKey),
            })
        );
    }
    if (input.preferredModel) {
        lines.push(t("assistant.memoryInfluence.preferredModel", { value: input.preferredModel }));
    }
    if (input.approvalStyle === "read_only_review") {
        lines.push(
            t("assistant.memoryInfluence.approvalStyle", {
                value: t("memory.preferences.approvalStyle.read_only_review"),
            })
        );
    } else if (input.approvalStyle === "approval_required_write") {
        lines.push(
            t("assistant.memoryInfluence.approvalStyle", {
                value: t("memory.preferences.approvalStyle.approval_required_write"),
            })
        );
    } else if (input.approvalStyle === "safe_auto_run_preferred") {
        lines.push(
            t("assistant.memoryInfluence.approvalStyle", {
                value: t("memory.preferences.approvalStyle.safe_auto_run_preferred"),
            })
        );
    }
    if (input.monitoringPreference === "manual") {
        lines.push(
            t("assistant.memoryInfluence.monitoringPreference", {
                value: t("memory.preferences.monitoringPreference.manual"),
            })
        );
    } else if (input.monitoringPreference === "important_changes") {
        lines.push(
            t("assistant.memoryInfluence.monitoringPreference", {
                value: t("memory.preferences.monitoringPreference.important_changes"),
            })
        );
    } else if (input.monitoringPreference === "all_changes") {
        lines.push(
            t("assistant.memoryInfluence.monitoringPreference", {
                value: t("memory.preferences.monitoringPreference.all_changes"),
            })
        );
    }
    if (input.projectName || input.repoSlug) {
        lines.push(
            t("assistant.memoryInfluence.projectContext", {
                value: input.projectName || input.repoSlug || "",
            })
        );
    }
    if ((input.pinnedRefCount ?? 0) > 0) {
        lines.push(t("assistant.memoryInfluence.pinnedRefs", { value: input.pinnedRefCount ?? 0 }));
    }
    return lines;
}

function describeWatcherChangeClass(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    value: string | null | undefined
): string | null {
    if (!value) return null;
    if (value === "new_high_significance_item") return t("assistant.changeClass.new_high_significance_item");
    if (value === "official_update") return t("assistant.changeClass.official_update");
    if (value === "policy_change") return t("assistant.changeClass.policy_change");
    if (value === "market_shift") return t("assistant.changeClass.market_shift");
    if (value === "repo_release") return t("assistant.changeClass.repo_release");
    if (value === "health_regression") return t("assistant.changeClass.health_regression");
    if (value === "routine_refresh") return t("assistant.changeClass.routine_refresh");
    return value;
}

function describeWatcherChangeSeverity(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    value: string | null | undefined
): string | null {
    if (!value) return null;
    if (value === "critical") return t("assistant.changeSeverity.critical");
    if (value === "warning") return t("assistant.changeSeverity.warning");
    if (value === "info") return t("assistant.changeSeverity.info");
    return value;
}

function shouldOfferMonitorAction(
    researchProfile?: string | null,
    nextActionKind?: "open_action_center" | "open_brief" | "open_workbench" | "create_monitor",
    stages?: JarvisSessionDetail["stages"]
): boolean {
    const monitorAlreadyTracked =
        Array.isArray(stages) &&
        stages.some(
            (stage) =>
                stage.capability === "monitor" &&
                (stage.status === "queued" ||
                    stage.status === "running" ||
                    stage.status === "needs_approval" ||
                    stage.status === "completed")
        );
    if (monitorAlreadyTracked) {
        return false;
    }
    if (nextActionKind === "create_monitor") {
        return true;
    }
    return (
        researchProfile === "topic_news" ||
        researchProfile === "entity_brief" ||
        researchProfile === "market_research" ||
        researchProfile === "policy_regulation"
    );
}

function localizeJarvisSummary(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    summary: string | null | undefined
): string | null {
    const normalized = summary?.trim();
    if (!normalized) {
        return null;
    }

    if (normalized === "Gathering grounded evidence") {
        return t("assistant.summary.researchStarted");
    }
    if (normalized === "Grounded dossier ready") {
        return t("assistant.summary.briefReady");
    }
    if (normalized === "Partial brief ready with coverage warnings") {
        return t("assistant.summary.partialBriefWarning");
    }
    if (normalized === "Monitor created from research session") {
        return t("assistant.summary.monitorCreated");
    }
    if (normalized === "Future updates will be surfaced through notifications") {
        return t("assistant.summary.notifyArmed");
    }
    if (normalized === "Approval required before execution") {
        return t("assistant.summary.approvalRequired");
    }
    if (normalized === "Review write execution and approve run") {
        return t("assistant.summary.approvalRequiredWrite");
    }
    if (normalized === "Review read-only checks and approve execution") {
        return t("assistant.summary.approvalRequiredReadOnly");
    }
    if (normalized === "Waiting for approval before execution") {
        return t("assistant.summary.executeBlockedByApproval");
    }
    if (normalized === "Waiting for approval before write execution") {
        return t("assistant.summary.executeBlockedByWriteApproval");
    }
    if (normalized === "Waiting for read-only review and approval before execution") {
        return t("assistant.summary.executeBlockedByReadOnlyApproval");
    }

    const fetchedMatch = normalized.match(/^(\d+)\s+grounded sources fetched$/u);
    if (fetchedMatch?.[1]) {
        return t("assistant.summary.sourcesFetched", { value: Number(fetchedMatch[1]) });
    }
    const rankedMatch = normalized.match(/^(\d+)\s+sources ranked · quality (pass|warn)$/u);
    if (rankedMatch?.[1] && rankedMatch[2]) {
        return t("assistant.summary.sourcesRanked", {
            value: Number(rankedMatch[1]),
            quality: rankedMatch[2] === "pass" ? t("assistant.quality.pass") : t("assistant.quality.warn"),
        });
    }
    const planMatch = normalized.match(/^Mission planned via (llm|fallback)$/u);
    if (planMatch?.[1]) {
        return t("assistant.summary.planReady", {
            mode: planMatch[1] === "llm" ? t("assistant.planMode.llm") : t("assistant.planMode.fallback"),
        });
    }
    const planWriteMatch = normalized.match(/^Mission planned via (llm|fallback) with approval required for write execution$/u);
    if (planWriteMatch?.[1]) {
        return t("assistant.summary.planReadyWrite", {
            mode: planWriteMatch[1] === "llm" ? t("assistant.planMode.llm") : t("assistant.planMode.fallback"),
        });
    }
    const planReadOnlyMatch = normalized.match(/^Mission planned via (llm|fallback) with read-only review first$/u);
    if (planReadOnlyMatch?.[1]) {
        return t("assistant.summary.planReadyReadOnly", {
            mode: planReadOnlyMatch[1] === "llm" ? t("assistant.planMode.llm") : t("assistant.planMode.fallback"),
        });
    }
    const memorySignalMatch = normalized.match(/^(\d+)\s+planner memory signal\(s\) applied$/u);
    if (memorySignalMatch?.[1]) {
        return t("assistant.summary.memorySignalsApplied", { value: Number(memorySignalMatch[1]) });
    }
    if (normalized === "Assistant context prepared") {
        return t("assistant.summary.contextPrepared");
    }
    const capabilitiesMatch = normalized.match(/^Capabilities:\s+(.+)$/u);
    if (capabilitiesMatch?.[1]) {
        const localized = capabilitiesMatch[1]
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
            .map((capability) => describeCapability(t, capability))
            .join(", ");
        return t("assistant.summary.capabilities", { value: localized });
    }

    return normalized;
}

function localizeMemoryPreview(
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
    value: string
): string {
    return value
        .replaceAll("Monitor:", `${t("assistant.memoryPreview.monitor")}:`)
        .replaceAll("Watcher:", `${t("assistant.memoryPreview.watcher")}:`)
        .replaceAll("Query:", `${t("assistant.memoryPreview.query")}:`)
        .replaceAll("Research profile:", `${t("assistant.memoryPreview.researchProfile")}:`)
        .replaceAll("Change class:", `${t("assistant.memoryPreview.changeClass")}:`)
        .replaceAll("Prompt:", `${t("assistant.memoryPreview.prompt")}:`)
        .replaceAll("Summary:", `${t("assistant.memoryPreview.summary")}:`);
}

function inferCapabilitiesFromIntent(intent?: string | null): string[] {
    if (intent === "council") return ["debate", "brief"];
    if (intent === "research" || intent === "news" || intent === "finance") return ["research", "brief"];
    if (intent === "code") return ["plan"];
    return ["answer"];
}

function inferHudSessionTarget(intent?: string | null): JarvisSessionDetail["session"]["primaryTarget"] {
    if (intent === "council") return "council";
    if (intent === "code") return "execution";
    if (intent === "research" || intent === "news" || intent === "finance") return "dossier";
    return "assistant";
}

function inferWatcherKindFromPrompt(prompt: string): WatcherKind {
    if (/(전쟁|war|분쟁|중동|우크라|가자|iran|israel|lebanon)/iu.test(prompt)) {
        return "war_region";
    }
    if (/(시장|macro|거시|환율|금리|주식|시장 동향|market|stocks|fx)/iu.test(prompt)) {
        return "market";
    }
    if (/(repo|repository|깃허브|github|코드베이스)/iu.test(prompt)) {
        return "repo";
    }
    if (/(회사|기업|브랜드|company)/iu.test(prompt)) {
        return "company";
    }
    return "external_topic";
}

function buildDossierSplitHref(dossierId: string): string {
    return `/?widgets=assistant,tasks,dossier&focus=dossier&replace=1&activation=all&dossier=${encodeURIComponent(dossierId)}`;
}

function buildWatcherPrefillHref(title: string, query: string, kind: WatcherKind): string {
    return `/?widgets=assistant,tasks,watchers&focus=watchers&replace=1&activation=all&watcher_title=${encodeURIComponent(title)}&watcher_query=${encodeURIComponent(query)}&watcher_kind=${encodeURIComponent(kind)}`;
}

export function AssistantModule() {
    const { t } = useLocale();
    const { sessions, activeSessionId, startSession, linkSessionTask, markSessionContextDelivered, openWidgets, updateSessionStaleState } = useHUD();
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
    const [jarvisSessionDetail, setJarvisSessionDetail] = useState<JarvisSessionDetail | null>(null);
    const [jarvisSessionError, setJarvisSessionError] = useState<string | null>(null);
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
    const autoContextEventsRef = useRef<Record<string, AutoMissionEvent[]>>({});
    const autoContextStartedThisSessionRef = useRef<Set<string>>(new Set());
    const autoContextDeliveredRevisionRef = useRef<Map<string, number>>(new Map());
    const autoContextBootstrapInFlightRef = useRef<Set<string>>(new Set());
    const sessionMessageStoreRef = useRef<Record<string, ChatMessage[]>>({});
    const activeMessageSessionRef = useRef<string | null>(null);
    const pendingSessionPersistSkipRef = useRef<string | null>(null);
    const contextStreamRef = useRef<Map<string, AssistantContextEventsStream>>(new Map());
    const contextReconnectTimersRef = useRef<Map<string, number>>(new Map());
    const contextLastEventAtRef = useRef<Map<string, number>>(new Map());
    const contextSessionMapRef = useRef<Map<string, string>>(new Map());
    const loadedContextEventsRef = useRef<Set<string>>(new Set());
    const loadedGroundingEvidenceRef = useRef<Set<string>>(new Set());
    const contextEventHydrationFailuresRef = useRef<Map<string, number>>(new Map());
    const groundingHydrationFailuresRef = useRef<Map<string, number>>(new Map());
    const pendingTaskLinksRef = useRef<Map<string, string>>(new Map());
    const queuedRecoveryStartedRef = useRef(false);
    const queuedRecoveryInFlightRef = useRef(false);
    const contextStreamRetryStateRef = useRef<Map<string, { failures: number; retryAtMs: number; terminal: boolean }>>(
        new Map()
    );
    const contextMissingProbeInFlightRef = useRef<Set<string>>(new Set());
    const lastAutoContextSyncMsRef = useRef(0);
    const [streamReconnectTick, setStreamReconnectTick] = useState(0);
    const exactlyOnceDeliveryEnabled = useMemo(
        () => isFeatureEnabled("assistant.exactly_once_delivery", true),
        []
    );
    const activeHudSession = useMemo(
        () => (activeSessionId ? sessions.find((session) => session.id === activeSessionId) ?? null : null),
        [activeSessionId, sessions]
    );
    const [jarvisSessionFallbackNotice, setJarvisSessionFallbackNotice] = useState<string | null>(null);
    const sessionLaunchCard = useMemo(() => {
        const session = jarvisSessionDetail?.session;
        const fallbackTarget = inferHudSessionTarget(activeHudSession?.intent);
        const fallbackEntry = describeSessionEntry(t, activeHudSession?.intent === "code" ? "workspace_runtime" : "assistant_manual");
        const fallbackLane = describePrimaryTarget(t, fallbackTarget);
        const fallbackStatus = activeHudSession?.status === "background" ? "background" : "running";
        const baseSession = session
            ? {
                  id: session.id.slice(0, 8),
                  entry: describeSessionEntry(t, session.source),
                  lane: describePrimaryTarget(t, session.primaryTarget),
                  status: session.status,
                  target: session.primaryTarget,
                  createdAt: session.createdAt,
              }
            : activeHudSession
              ? {
                    id: activeHudSession.id.slice(0, 8),
                    entry: fallbackEntry,
                    lane: fallbackLane,
                    status: fallbackStatus,
                    target: fallbackTarget,
                    createdAt: activeHudSession.createdAt,
                }
              : null;
        if (!baseSession) return null;
        const ageLabel = formatElapsedShort(baseSession.createdAt, Date.now());
        const isFresh = Date.now() - Date.parse(baseSession.createdAt) <= SESSION_LAUNCH_HIGHLIGHT_MS;
        return {
            id: baseSession.id,
            entry: baseSession.entry,
            lane: baseSession.lane,
            status: baseSession.status,
            target: baseSession.target,
            ageLabel,
            isFresh,
        };
    }, [activeHudSession, jarvisSessionDetail, t]);
    const sessionCapabilities = useMemo(() => {
        const resolvedFromEvents = jarvisSessionDetail?.events.find(
            (event) =>
                event.eventType === "session.capabilities.resolved" && Array.isArray(event.data?.capabilities)
        );
        const fromEvents = Array.isArray(resolvedFromEvents?.data?.capabilities)
            ? resolvedFromEvents.data.capabilities.filter((value): value is string => typeof value === "string")
            : [];
        if (fromEvents.length > 0) {
            return fromEvents;
        }

        if (jarvisSessionDetail?.session.primaryTarget === "dossier") {
            return ["research", "brief"];
        }
        if (jarvisSessionDetail?.session.primaryTarget === "council") {
            return ["debate", "brief"];
        }
        if (jarvisSessionDetail?.session.primaryTarget === "mission") {
            return ["plan", "approve"];
        }
        if (jarvisSessionDetail?.session.primaryTarget === "execution") {
            return ["execute"];
        }
        if (jarvisSessionDetail?.session.primaryTarget === "assistant") {
            return ["answer"];
        }

        return inferCapabilitiesFromIntent(activeHudSession?.intent);
    }, [activeHudSession?.intent, jarvisSessionDetail]);
    const sessionCapabilityBuckets = useMemo(() => {
        const requested =
            jarvisSessionDetail?.requested_capabilities?.length
                ? jarvisSessionDetail.requested_capabilities
                : sessionCapabilities;
        const active = jarvisSessionDetail?.active_capabilities ?? [];
        const completed = jarvisSessionDetail?.completed_capabilities ?? [];
        return { requested, active, completed };
    }, [jarvisSessionDetail, sessionCapabilities]);
    const sessionStageRecords = useMemo(() => {
        if (jarvisSessionDetail?.stages?.length) {
            return [...jarvisSessionDetail.stages].sort((left, right) => left.orderIndex - right.orderIndex);
        }
        return sessionCapabilities.map((capability, index) => ({
            id: `${capability}-${index}`,
            sessionId: activeSessionId ?? "pending",
            stageKey: capability,
            capability,
            title: describeCapability(t, capability),
            status: index === 0 ? "running" : "queued",
            orderIndex: index,
            dependsOnJson: index === 0 ? [] : [sessionCapabilities[index - 1] ?? ""].filter(Boolean),
            artifactRefsJson: {},
            summary: null,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }));
    }, [activeSessionId, jarvisSessionDetail?.stages, sessionCapabilities, t]);
    const sessionResearchProfile = useMemo(() => {
        if (jarvisSessionDetail?.research_profile) {
            return jarvisSessionDetail.research_profile;
        }
        if (jarvisSessionDetail?.dossier?.qualityJson) {
            return readResearchProfile(jarvisSessionDetail.dossier.qualityJson);
        }
        return null;
    }, [jarvisSessionDetail?.dossier?.qualityJson, jarvisSessionDetail?.research_profile]);
    const sessionResearchProfileReasons = useMemo(() => {
        if ((jarvisSessionDetail?.research_profile_reasons?.length ?? 0) > 0) {
            return jarvisSessionDetail?.research_profile_reasons ?? [];
        }
        if (jarvisSessionDetail?.dossier?.qualityJson) {
            return readResearchProfileReasons(jarvisSessionDetail.dossier.qualityJson);
        }
        return [];
    }, [jarvisSessionDetail?.dossier?.qualityJson, jarvisSessionDetail?.research_profile_reasons]);
    const sessionResearchQualityMode = useMemo(() => {
        if (jarvisSessionDetail?.quality_mode) {
            return jarvisSessionDetail.quality_mode;
        }
        if (jarvisSessionDetail?.dossier?.qualityJson) {
            return readResearchQualityMode(jarvisSessionDetail.dossier.qualityJson);
        }
        return null;
    }, [jarvisSessionDetail?.dossier?.qualityJson, jarvisSessionDetail?.quality_mode]);
    const sessionResearchDimensionLines = useMemo(
        () =>
            summarizeResearchQualityDimensions({
                profile: sessionResearchProfile,
                dimensions: jarvisSessionDetail?.quality_dimensions ?? null,
                t,
            }),
        [jarvisSessionDetail?.quality_dimensions, sessionResearchProfile, t]
    );
    const sessionMemoryContext = jarvisSessionDetail?.memory_context ?? null;
    const sessionMemoryPlanSignals = useMemo(
        () => jarvisSessionDetail?.memory_plan_signals ?? [],
        [jarvisSessionDetail?.memory_plan_signals]
    );
    const sessionMemoryPlanSummary = useMemo(
        () => jarvisSessionDetail?.memory_plan_summary ?? [],
        [jarvisSessionDetail?.memory_plan_summary]
    );
    const sessionMemoryInfluenceLines = useMemo(() => {
        const fromContext = describeMemoryInfluenceLine(t, {
            responseStyle: sessionMemoryContext?.preferences?.responseStyle ?? null,
            preferredProvider: jarvisSessionDetail?.preferred_provider_applied ?? sessionMemoryContext?.preferences?.preferredProvider ?? null,
            preferredModel: jarvisSessionDetail?.preferred_model_applied ?? sessionMemoryContext?.preferences?.preferredModel ?? null,
            approvalStyle: sessionMemoryContext?.preferences?.approvalStyle ?? null,
            monitoringPreference:
                jarvisSessionDetail?.monitoring_preference_applied ??
                sessionMemoryContext?.preferences?.monitoringPreference ??
                null,
            projectName: jarvisSessionDetail?.project_context_refs?.project_name ?? sessionMemoryContext?.projectContext?.projectName ?? null,
            repoSlug: jarvisSessionDetail?.project_context_refs?.repo_slug ?? sessionMemoryContext?.projectContext?.repoSlug ?? null,
            pinnedRefCount:
                jarvisSessionDetail?.project_context_refs?.pinned_refs?.length ??
                sessionMemoryContext?.projectContext?.pinnedRefs?.length ??
                0,
        });
        return Array.from(new Set(fromContext)).slice(0, 6);
    }, [
        jarvisSessionDetail?.monitoring_preference_applied,
        jarvisSessionDetail?.preferred_model_applied,
        jarvisSessionDetail?.preferred_provider_applied,
        jarvisSessionDetail?.project_context_refs,
        sessionMemoryContext?.preferences,
        sessionMemoryContext?.projectContext,
        t,
    ]);
    const sessionMemoryLines = useMemo(() => {
        if (!sessionMemoryContext) return [];
        return sessionMemoryContext.notes.map((note) => ({
            id: note.id,
            title: note.title,
            kind: describeMemoryNoteKind(t, note.kind),
            preview: localizeMemoryPreview(
                t,
                note.content.length > 140 ? `${note.content.slice(0, 137)}...` : note.content
            ),
            pinned: note.pinned,
            updatedAt: formatElapsedShort(note.updatedAt, Date.now()),
        }));
    }, [sessionMemoryContext, t]);
    const sessionMemoryPlanLines = useMemo(() => {
        const localizedSignals = sessionMemoryPlanSignals.map((signal) => describeMemoryPlanSignal(t, signal));
        return Array.from(new Set([...localizedSignals, ...sessionMemoryPlanSummary]));
    }, [sessionMemoryPlanSignals, sessionMemoryPlanSummary, t]);
    const localizedProfileReasons = useMemo(
        () => sessionResearchProfileReasons.map((reason) => describeResearchProfileReason(t, reason)),
        [sessionResearchProfileReasons, t]
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
    const sessionNextActionLabel = useMemo(
        () => describeNextAction(t, jarvisSessionDetail?.next_action ?? null, sessionResearchProfile, sessionExecutionOption),
        [jarvisSessionDetail?.next_action, sessionExecutionOption, sessionResearchProfile, t]
    );
    const sessionPrimaryArtifactActionLabel = useMemo(
        () => describePrimaryArtifactActionLabel(t, sessionResearchProfile),
        [sessionResearchProfile, t]
    );
    const sessionMonitorActionLabel = useMemo(
        () => describeMonitorActionLabel(t, sessionResearchProfile),
        [sessionResearchProfile, t]
    );
    const sessionNextActionButtonLabel = useMemo(
        () => describeNextActionButtonLabel(t, jarvisSessionDetail?.next_action ?? null, sessionResearchProfile, sessionExecutionOption),
        [jarvisSessionDetail?.next_action, sessionExecutionOption, sessionResearchProfile, t]
    );
    const sessionShouldOfferMonitorAction = useMemo(
        () => shouldOfferMonitorAction(sessionResearchProfile, jarvisSessionDetail?.next_action?.kind, jarvisSessionDetail?.stages),
        [jarvisSessionDetail?.next_action?.kind, jarvisSessionDetail?.stages, sessionResearchProfile]
    );
    const sessionQuickActions = useMemo(() => {
        const actions: Array<{ key: string; href: string; label: string; className: string }> = [];
        if (jarvisSessionDetail?.dossier) {
            actions.push({
                key: "open-brief",
                href: buildDossierSplitHref(jarvisSessionDetail.dossier.id),
                label: sessionPrimaryArtifactActionLabel,
                className:
                    "rounded border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20",
            });
        }
        if (sessionShouldOfferMonitorAction && jarvisSessionDetail?.session?.prompt) {
            actions.push({
                key: "create-monitor",
                href: buildWatcherPrefillHref(
                    jarvisSessionDetail.dossier?.title ?? jarvisSessionDetail.session.title,
                    jarvisSessionDetail.session.prompt,
                    inferWatcherKindFromPrompt(jarvisSessionDetail.session.prompt)
                ),
                label: sessionMonitorActionLabel,
                className:
                    "rounded border border-white/15 bg-black/30 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-widest text-white/75 hover:border-white/30 hover:text-white",
            });
        }
        if (jarvisSessionDetail?.next_action?.kind === "open_action_center") {
            actions.push({
                key: "open-action-center",
                href: "/?widget=action_center&focus=action_center",
                label: sessionNextActionButtonLabel ?? t("assistant.openActionCenter"),
                className:
                    "rounded border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-widest text-amber-200 hover:bg-amber-500/20",
            });
        }
        if (jarvisSessionDetail?.next_action?.kind === "open_workbench") {
            actions.push({
                key: "open-workbench",
                href: "/?widget=workbench&focus=workbench",
                label: sessionNextActionButtonLabel ?? t("assistant.openWorkbench"),
                className:
                    "rounded border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20",
            });
        }
        return actions;
    }, [
        jarvisSessionDetail?.dossier,
        jarvisSessionDetail?.next_action?.kind,
        jarvisSessionDetail?.session,
        sessionMonitorActionLabel,
        sessionNextActionButtonLabel,
        sessionPrimaryArtifactActionLabel,
        sessionShouldOfferMonitorAction,
        t,
    ]);
    const sessionQualityWarnings = useMemo(() => {
        if (jarvisSessionDetail?.dossier) {
            return resolveResearchWarningLabels({
                record: jarvisSessionDetail.dossier.qualityJson,
                t,
            });
        }
        if ((jarvisSessionDetail?.warning_codes?.length ?? 0) > 0) {
            return resolveResearchWarningLabels({
                record: {
                    soft_warning_codes: jarvisSessionDetail?.warning_codes ?? [],
                    soft_warnings: [],
                },
                t,
            });
        }
        return [];
    }, [jarvisSessionDetail?.dossier, jarvisSessionDetail?.warning_codes, t]);
    const sessionHasCoverageWarnings = useMemo(() => {
        if (!jarvisSessionDetail?.dossier) {
            return jarvisSessionDetail?.quality_mode === "warn";
        }
        return jarvisSessionDetail.dossier.qualityJson?.quality_gate_passed === false;
    }, [jarvisSessionDetail?.dossier, jarvisSessionDetail?.quality_mode]);
    const sessionChangeMetadata = useMemo(() => {
        const stageWithChange = (jarvisSessionDetail?.stages ?? []).find((stage) => {
            const refs = stage.artifactRefsJson ?? {};
            return typeof refs.change_class === "string" || typeof refs.change_severity === "string";
        });
        const refs = stageWithChange?.artifactRefsJson ?? {};
        return {
            changeClass: typeof refs.change_class === "string" ? refs.change_class : null,
            changeSeverity: typeof refs.change_severity === "string" ? refs.change_severity : null,
        };
    }, [jarvisSessionDetail?.stages]);
    const sessionChangeClassLabel = useMemo(
        () => describeWatcherChangeClass(t, sessionChangeMetadata.changeClass),
        [sessionChangeMetadata.changeClass, t]
    );
    const sessionChangeSeverityLabel = useMemo(
        () => describeWatcherChangeSeverity(t, sessionChangeMetadata.changeSeverity),
        [sessionChangeMetadata.changeSeverity, t]
    );
    const sessionPlanSummary = useMemo(
        () => summarizeCapabilityPlan(t, sessionCapabilityBuckets.requested),
        [sessionCapabilityBuckets.requested, t]
    );
    const currentStageRecord = useMemo(
        () =>
            sessionStageRecords.find((stage) => stage.status === "running") ??
            sessionStageRecords.find((stage) => stage.status === "needs_approval") ??
            sessionStageRecords.find((stage) => stage.status === "blocked") ??
            sessionStageRecords.find((stage) => stage.status === "queued") ??
            [...sessionStageRecords].reverse().find((stage) => stage.status === "completed") ??
            null,
        [sessionStageRecords]
    );
    const nextStageRecord = useMemo(() => {
        if (!currentStageRecord) {
            return sessionStageRecords.find((stage) => stage.status === "queued") ?? null;
        }
        const currentIndex = sessionStageRecords.findIndex((stage) => stage.id === currentStageRecord.id);
        if (currentIndex < 0) {
            return null;
        }
        return (
            sessionStageRecords
                .slice(currentIndex + 1)
                .find((stage) => stage.status === "queued" || stage.status === "blocked" || stage.status === "needs_approval") ??
            null
        );
    }, [currentStageRecord, sessionStageRecords]);
    const latestSessionSummaries = useMemo(() => {
        const events = jarvisSessionDetail?.events ?? [];
        return events
            .slice(-3)
            .map((event) => localizeJarvisSummary(t, event.summary) || t("assistant.event.updated"))
            .filter(Boolean);
    }, [jarvisSessionDetail?.events, t]);
    const qualitySoftGateEnabled = useMemo(
        () => isFeatureEnabled("assistant.quality_soft_gate_v2", true),
        []
    );
    const uiSoftWarnEnabled = useMemo(
        () => isFeatureEnabled("assistant.ui_soft_warn_render", true),
        []
    );
    const stageTimelineEnabled = useMemo(
        () => isFeatureEnabled("assistant.stage_timeline_v1", true),
        []
    );
    const streamResilienceEnabled = useMemo(
        () => isFeatureEnabled("assistant.stream_resilience_v2", true),
        []
    );
    const timelineStageSeqOnlyEnabled = useMemo(
        () => isFeatureEnabled("assistant.timeline_stage_seq_only", true),
        []
    );
    const hardFailRawOutputToggleEnabled = useMemo(
        () => isFeatureEnabled("assistant.hard_fail_raw_output_toggle", true),
        []
    );

    useEffect(() => {
        autoContextsRef.current = autoContexts;
    }, [autoContexts]);

    useEffect(() => {
        autoContextEventsRef.current = autoContextEvents;
    }, [autoContextEvents]);

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

    useEffect(() => {
        if (!activeSessionId) {
            setJarvisSessionDetail(null);
            setJarvisSessionError(null);
            setJarvisSessionFallbackNotice(null);
            return;
        }

        let cancelled = false;
        let timerId: number | null = null;
        let notFoundAttempts = 0;

        const schedule = (delayMs: number) => {
            if (cancelled) return;
            if (timerId !== null) {
                window.clearTimeout(timerId);
            }
            timerId = window.setTimeout(() => {
                void loadSessionDetail();
            }, delayMs);
        };

        const loadSessionDetail = async () => {
            try {
                const detail = await getJarvisSession(activeSessionId);
                if (!cancelled) {
                    setJarvisSessionDetail(detail);
                    setJarvisSessionError(null);
                    setJarvisSessionFallbackNotice(null);
                    notFoundAttempts = 0;
                    schedule(8000);
                }
            } catch (error) {
                if (cancelled) return;
                if (error instanceof ApiRequestError) {
                    if (error.status === 404 && activeHudSession) {
                        notFoundAttempts += 1;
                        setJarvisSessionDetail(null);
                        setJarvisSessionError(null);
                        setJarvisSessionFallbackNotice(
                            t(
                                notFoundAttempts >= 3
                                    ? "assistant.error.runtimeSessionUnavailable"
                                    : "assistant.error.runtimeSessionPending"
                            )
                        );
                        schedule(notFoundAttempts >= 3 ? 2500 : 600);
                        return;
                    }
                    setJarvisSessionError(`${error.code}: ${error.message}`);
                } else {
                    setJarvisSessionError(t("assistant.error.loadSession"));
                }
                setJarvisSessionDetail(null);
                setJarvisSessionFallbackNotice(null);
                schedule(8000);
            }
        };

        void loadSessionDetail();

        return () => {
            cancelled = true;
            if (timerId !== null) {
                window.clearTimeout(timerId);
            }
        };
    }, [activeHudSession, activeSessionId, t]);

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

    const syncAutoContextsWithThrottle = useCallback((minIntervalMs = 1000) => {
        const nowMs = Date.now();
        if (nowMs - lastAutoContextSyncMsRef.current < minIntervalMs) {
            return;
        }
        lastAutoContextSyncMsRef.current = nowMs;
        void syncAutoContexts();
    }, [syncAutoContexts]);

    const rememberContextSessionLink = useCallback((contextId: string, sessionId?: string | null) => {
        const normalizedContextId = contextId.trim();
        const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
        if (!normalizedContextId || !normalizedSessionId) {
            return;
        }
        contextSessionMapRef.current.set(normalizedContextId, normalizedSessionId);
    }, []);

    const scheduleContextReconnect = useCallback(
        (serverContextId: string, clientContextId?: string, source: "close" | "error" = "error") => {
            if (!streamResilienceEnabled) {
                return;
            }
            const activeContext = autoContextsRef.current.find((item) => item.serverContextId === serverContextId);
            if (!activeContext || activeContext.status !== "running") {
                return;
            }
            if (contextReconnectTimersRef.current.has(serverContextId)) {
                return;
            }

            const state = contextStreamRetryStateRef.current.get(serverContextId);
            if (state?.terminal) {
                return;
            }
            const failures = Math.max(1, state?.failures ?? 1);
            const delayMs = Math.min(15_000, 400 * Math.pow(2, Math.max(0, failures - 1)));
            emitRuntimeEvent("assistant_stream_reconnect_scheduled", {
                serverContextId,
                clientContextId: clientContextId ?? activeContext.id,
                source,
                failures,
                delayMs,
            });
            const timerId = window.setTimeout(() => {
                contextReconnectTimersRef.current.delete(serverContextId);
                void syncAutoContextsWithRetry({ attempts: 3, baseDelayMs: 220 });
                setStreamReconnectTick((prev) => prev + 1);
            }, delayMs);
            contextReconnectTimersRef.current.set(serverContextId, timerId);
        },
        [streamResilienceEnabled, syncAutoContextsWithRetry]
    );

    const markAutoContextAsStale = useCallback((serverContextId: string, clientContextId?: string) => {
        const nowIso = new Date().toISOString();
        setAutoContexts((prev) =>
            prev.map((item) => {
                const isTarget =
                    item.serverContextId === serverContextId || (clientContextId && item.id === clientContextId);
                if (!isTarget) {
                    return item;
                }
                if (item.status === "error" && item.error === STALE_AUTO_CONTEXT_ERROR_CODE) {
                    return item;
                }
                return {
                    ...item,
                    status: "error",
                    output: STALE_AUTO_CONTEXT_MESSAGE,
                    completedAt: item.completedAt ?? nowIso,
                    error: STALE_AUTO_CONTEXT_ERROR_CODE,
                };
            })
        );
    }, []);

    const handleContextStreamFailure = useCallback(
        async (serverContextId: string, clientContextId?: string) => {
            const currentState = contextStreamRetryStateRef.current.get(serverContextId);
            const failures = (currentState?.failures ?? 0) + 1;
            const retryDelayMs = Math.min(15000, 400 * Math.pow(2, Math.max(0, failures - 1)));
            contextStreamRetryStateRef.current.set(serverContextId, {
                failures,
                retryAtMs: Date.now() + retryDelayMs,
                terminal: currentState?.terminal ?? false,
            });

            if (currentState?.terminal) {
                return;
            }
            if (contextMissingProbeInFlightRef.current.has(serverContextId)) {
                return;
            }
            if (failures < 2) {
                syncAutoContextsWithThrottle(800);
                scheduleContextReconnect(serverContextId, clientContextId, "error");
                return;
            }

            contextMissingProbeInFlightRef.current.add(serverContextId);
            try {
                await getAssistantContext(serverContextId);
                syncAutoContextsWithThrottle(1000);
                scheduleContextReconnect(serverContextId, clientContextId, "error");
            } catch (err) {
                if (err instanceof ApiRequestError && err.status === 404) {
                    contextStreamRetryStateRef.current.set(serverContextId, {
                        failures,
                        retryAtMs: Date.now() + 60_000,
                        terminal: true,
                    });
                    markAutoContextAsStale(serverContextId, clientContextId);
                    return;
                }
                syncAutoContextsWithThrottle(err instanceof ApiRequestError && err.status === 429 ? 3000 : 1200);
                scheduleContextReconnect(serverContextId, clientContextId, "error");
            } finally {
                contextMissingProbeInFlightRef.current.delete(serverContextId);
            }
        },
        [markAutoContextAsStale, scheduleContextReconnect, syncAutoContextsWithThrottle]
    );

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

    useEffect(() => {
        const staleByContextId = new Set(
            autoContexts
                .filter((context) => isStaleAutoContext(context))
                .map((context) => context.id)
        );
        const staleByTaskId = new Set(
            autoContexts
                .filter((context) => isStaleAutoContext(context) && context.taskId)
                .map((context) => context.taskId as string)
        );

        for (const session of sessions) {
            const matchedStaleContext = autoContexts.find((context) => {
                if (!isStaleAutoContext(context)) {
                    return false;
                }
                if (context.id === session.id) {
                    return true;
                }
                if (session.taskId && context.taskId === session.taskId) {
                    return true;
                }
                return false;
            });
            const shouldBeStale =
                staleByContextId.has(session.id) || (session.taskId ? staleByTaskId.has(session.taskId) : false);
            const isStale = session.stale === true;
            if (shouldBeStale === isStale) {
                continue;
            }
            updateSessionStaleState(session.id, {
                stale: shouldBeStale,
                reason: shouldBeStale ? matchedStaleContext?.error ?? STALE_AUTO_CONTEXT_ERROR_CODE : null,
                detectedAt: shouldBeStale ? new Date().toISOString() : null,
            });
        }
    }, [autoContexts, sessions, updateSessionStaleState]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const nowMs = Date.now();
            for (const context of autoContextsRef.current) {
                if (context.status !== "running" || !context.serverContextId) {
                    continue;
                }
                const events = autoContextEventsRef.current[context.id] ?? [];
                const startedAtMs = Date.parse(context.startedAt);
                const lastEventMs =
                    events.length > 0
                        ? Date.parse(events[events.length - 1]?.createdAt ?? context.startedAt)
                        : Number.NaN;
                const activityMs = Number.isNaN(lastEventMs) ? startedAtMs : Math.max(startedAtMs, lastEventMs);
                if (Number.isNaN(activityMs)) {
                    continue;
                }
                if (nowMs - activityMs < AUTO_CONTEXT_STALE_TIMEOUT_MS) {
                    continue;
                }
                contextStreamRetryStateRef.current.set(context.serverContextId, {
                    failures: 99,
                    retryAtMs: nowMs + 60_000,
                    terminal: true,
                });
                markAutoContextAsStale(context.serverContextId, context.id);
            }
        }, 10_000);
        return () => {
            window.clearInterval(timer);
        };
    }, [markAutoContextAsStale]);

    const appendAutoContextEvents = useCallback((clientContextId: string, incoming: AutoMissionEvent[]) => {
        if (incoming.length === 0) {
            return;
        }
        for (const item of incoming) {
            if (item.eventType !== "assistant.context.stage.updated") {
                continue;
            }
            const stage = toAssistantStage(item.data.stage);
            if (!stage) {
                continue;
            }
            emitRuntimeEvent("assistant_stage_updated", {
                contextId: clientContextId,
                eventId: item.id,
                stage,
                stageSeq: toNumber(item.data.stage_seq),
                reasonCode: typeof item.data.reason_code === "string" ? item.data.reason_code : null,
                finalized: typeof item.data.finalized === "string" ? item.data.finalized : null,
            });
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
                const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("assistant.error.feedback");
                updateAutoContextFeedback(context.id, (current) => ({
                    ...current,
                    submitting: false,
                    error: message,
                }));
            }
        },
        [autoContextFeedback, t, updateAutoContextFeedback]
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
                const message = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : t("assistant.error.feedback");
                updateAutoContextFeedback(clientContextId, (draft) => ({
                    ...draft,
                    answerQuality: dimension === "answer" ? signal : draft.answerQuality,
                    sourceQuality: dimension === "source" ? signal : draft.sourceQuality,
                    submitting: false,
                    error: message,
                }));
            }
        },
        [autoContextFeedback, t, updateAutoContextFeedback]
    );

    const hydrateAutoContextEvents = useCallback(async (serverContextId: string, clientContextId: string, cacheKey: string) => {
        try {
            const rows = await listAssistantContextEvents(serverContextId, { limit: 12 });
            const mapped = rows.events.map((event) => toAutoMissionEvent(event));
            appendAutoContextEvents(clientContextId, mapped);
            contextEventHydrationFailuresRef.current.delete(serverContextId);
        } catch (err) {
            if (err instanceof ApiRequestError && err.status === 404) {
                markAutoContextAsStale(serverContextId, clientContextId);
                return;
            }
            const failures = (contextEventHydrationFailuresRef.current.get(serverContextId) ?? 0) + 1;
            contextEventHydrationFailuresRef.current.set(serverContextId, failures);
            if (failures < 2) {
                loadedContextEventsRef.current.delete(cacheKey);
            }
        }
    }, [appendAutoContextEvents, markAutoContextAsStale]);

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
                groundingHydrationFailuresRef.current.delete(cacheKey);
            } catch (err) {
                if (err instanceof ApiRequestError && err.status === 404) {
                    markAutoContextAsStale(serverContextId, clientContextId);
                    return;
                }
                const failures = (groundingHydrationFailuresRef.current.get(cacheKey) ?? 0) + 1;
                groundingHydrationFailuresRef.current.set(cacheKey, failures);
                if (failures < 2) {
                    loadedGroundingEvidenceRef.current.delete(cacheKey);
                }
            }
        },
        [markAutoContextAsStale]
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
        const timerId = window.setInterval(() => {
            const hasRunningContext = autoContextsRef.current.some((context) => context.status === "running");
            if (!hasRunningContext) {
                return;
            }
            void syncAutoContextsWithRetry({ attempts: 2, baseDelayMs: 220 });
        }, 8_000);

        return () => {
            window.clearInterval(timerId);
        };
    }, [syncAutoContextsWithRetry]);

    useEffect(() => {
        const syncOnForeground = () => {
            if (document.visibilityState !== "visible") {
                return;
            }
            void syncAutoContextsWithRetry({ attempts: 2, baseDelayMs: 220 });
        };

        window.addEventListener("focus", syncOnForeground);
        document.addEventListener("visibilitychange", syncOnForeground);

        return () => {
            window.removeEventListener("focus", syncOnForeground);
            document.removeEventListener("visibilitychange", syncOnForeground);
        };
    }, [syncAutoContextsWithRetry]);

    useEffect(() => {
        const sortedByRecent = [...autoContexts]
            .filter((context) => Boolean(context.serverContextId))
            .sort((left, right) => {
                const leftTime = Date.parse(left.completedAt ?? left.startedAt);
                const rightTime = Date.parse(right.completedAt ?? right.startedAt);
                const normalizedLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
                const normalizedRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
                return normalizedRightTime - normalizedLeftTime;
            });
        const targetMap = new Map<string, AutoMissionContext>();
        for (const context of sortedByRecent.slice(0, 12)) {
            targetMap.set(context.id, context);
        }
        if (activeSessionId) {
            const activeSession = sessions.find((session) => session.id === activeSessionId);
            if (activeSession) {
                for (const context of sortedByRecent) {
                    if (
                        context.id === activeSession.id ||
                        (activeSession.taskId && context.taskId === activeSession.taskId)
                    ) {
                        targetMap.set(context.id, context);
                    }
                }
            }
        }

        for (const context of targetMap.values()) {
            if (!context.serverContextId) {
                continue;
            }
            const cacheKey = `${context.serverContextId}:${context.revision ?? 0}`;
            if (loadedContextEventsRef.current.has(cacheKey)) {
                continue;
            }

            loadedContextEventsRef.current.add(cacheKey);
            void hydrateAutoContextEvents(context.serverContextId, context.id, cacheKey);
        }
    }, [activeSessionId, autoContexts, hydrateAutoContextEvents, sessions]);

    useEffect(() => {
        const sortedCompleted = [...autoContexts]
            .filter((context) => Boolean(context.serverContextId) && context.status !== "running")
            .sort((left, right) => {
                const leftTime = Date.parse(left.completedAt ?? left.startedAt);
                const rightTime = Date.parse(right.completedAt ?? right.startedAt);
                const normalizedLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
                const normalizedRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
                return normalizedRightTime - normalizedLeftTime;
            });
        const targetMap = new Map<string, AutoMissionContext>();
        for (const context of sortedCompleted.slice(0, 6)) {
            targetMap.set(context.id, context);
        }
        if (activeSessionId) {
            const activeSession = sessions.find((session) => session.id === activeSessionId);
            if (activeSession) {
                for (const context of sortedCompleted) {
                    if (
                        context.id === activeSession.id ||
                        (activeSession.taskId && context.taskId === activeSession.taskId)
                    ) {
                        targetMap.set(context.id, context);
                    }
                }
            }
        }

        for (const context of targetMap.values()) {
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
    }, [activeSessionId, autoContexts, hydrateAutoContextGroundingEvidence, sessions]);

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
        const payload: {
            prompt: string;
            task_type: "chat";
            provider?: ProviderSelection;
            strict_provider?: boolean;
            model?: string;
        } = {
            prompt,
            task_type: "chat",
        };

        if (selectedProvider !== "auto") {
            payload.provider = selectedProvider;
            payload.strict_provider = strictProvider;
        }
        if (model.length > 0) {
            payload.model = model;
        }
        return payload;
    }, [modelOverride, selectedProvider, strictProvider]);

    const writeSessionMessages = useCallback(
        (sessionId: string, updater: (current: ChatMessage[]) => ChatMessage[]) => {
            const current = sessionMessageStoreRef.current[sessionId] ?? defaultMessages();
            const nextMessages = pruneSessionMessages(updater(current));
            sessionMessageStoreRef.current[sessionId] = nextMessages;
            persistStoredSessionMessages(sessionMessageStoreRef.current);
            pendingSessionPersistSkipRef.current = sessionId;
            activeMessageSessionRef.current = sessionId;
            setMessages(nextMessages);
        },
        []
    );

    const toRunTimeline = useCallback((result: AiRespondData, runIndex: number, runCount: number): ToolCall[] => {
        const runPrefix = runLabel(runIndex, runCount);
        const timelineIdPrefix = `${Date.now()}_${runIndex}`;
        const calls: ToolCall[] = (result.attempts as ProviderAttempt[]).map((attempt, idx) => ({
            id: `${timelineIdPrefix}_${attempt.provider}_${idx}`,
            name: `${runPrefix}:${attempt.provider}`,
            status: mapProviderAttemptStatus(attempt.status),
            durationMs: attempt.latencyMs,
            args: formatAttemptCredentialLabel(attempt.credential) ?? undefined,
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
                status: `${onlyRun.servedProvider}/${onlyRun.servedModel}${onlyRun.usedFallback ? " (fallback)" : ""}${
                    onlyRun.servedCredential ? ` · ${onlyRun.servedCredential}` : ""
                }`,
            };
        }

        const runHeaders = successfulRuns
            .map(
                (run) =>
                    `[${run.label}] ${run.servedProvider ?? "unknown"}/${run.servedModel ?? "unknown"}${
                        run.usedFallback ? " (fallback)" : ""
                    }${run.servedCredential ? ` · ${run.servedCredential}` : ""}`
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
        rememberContextSessionLink(payload.id, payload.id);

        if (
            autoContextBootstrapInFlightRef.current.has(payload.id) ||
            autoContextsRef.current.some((item) => item.id === payload.id)
        ) {
            return;
        }

        autoContextBootstrapInFlightRef.current.add(payload.id);
        setAutoContexts((prev) => {
            if (prev.some((item) => item.id === payload.id)) {
                return prev;
            }
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
            rememberContextSessionLink(effectiveContext.clientContextId, payload.id);
            setAutoContexts((prev) => mergeAutoContexts(prev, [toAutoContextFromServer(effectiveContext)]));
        } catch (err) {
            const message =
                err instanceof ApiRequestError
                    ? `${err.code}: ${err.message}`
                    : t("assistant.error.createContext");
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
        } finally {
            autoContextBootstrapInFlightRef.current.delete(payload.id);
        }
    }, [buildRequestPayload, rememberContextSessionLink, syncAutoContextsWithRetry, t]);

    const executePrompt = useCallback(async (prompt: string, options?: { auto?: boolean; autoStatus?: string }) => {
        const normalizedPrompt = prompt.trim();
        const promptLabel = options?.auto ? `${normalizedPrompt}\n\n(auto intake)` : normalizedPrompt;
        const promptStatus = options?.auto ? options.autoStatus ?? "AUTO INTAKE" : undefined;
        const runCount = options?.auto ? 1 : parallelRuns;
        const useManualJarvisSession = !options?.auto && runCount === 1;
        const requestedModel = modelOverride.trim() || null;

        if (!normalizedPrompt || isRunning) return;

        setIsRunning(true);
        const pendingRuns = createPendingRuns(runCount, requestedModel);
        if (!useManualJarvisSession) {
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
        }
        const requestPayload = buildRequestPayload(normalizedPrompt);

        try {
            if (useManualJarvisSession) {
                const manualIntent = inferHudIntent(normalizedPrompt);
                const manualTargetHint = manualIntent === "general" ? "assistant" : undefined;
                const manualWorkspacePreset = resolveWorkspaceForIntent(manualIntent);
                const manualWidgets = buildLaunchWidgetPlan(manualIntent, "simple", normalizedPrompt);
                const manualFocusWidget = manualWidgets.includes("council")
                    ? "council"
                    : manualWidgets.includes("workbench")
                        ? "workbench"
                        : "assistant";

                if (manualWidgets.length > 1) {
                    const viewport = measureHudViewport();
                    tileWidgetLayouts(manualWidgets, viewport.width, viewport.height, 24);
                }

                openWidgets(manualWidgets, {
                    focus: manualFocusWidget,
                    replace: true,
                    activate: "all",
                    workspacePreset: manualWorkspacePreset,
                });
                const manualSessionId = startSession(normalizedPrompt, {
                    intent: manualIntent,
                    activeWidgets: manualWidgets,
                    mountedWidgets: manualWidgets,
                    focusedWidget: manualFocusWidget,
                    workspacePreset: manualWorkspacePreset,
                });
                dispatchJarvisDataRefresh({ scope: "sessions", source: "assistant-manual:start-session" });
                const manualRunNonce =
                    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                        ? `assistant_${crypto.randomUUID()}`
                        : `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

                writeSessionMessages(manualSessionId, () => [
                    buildSystemMessage(),
                    {
                        role: "user",
                        content: promptLabel,
                        status: promptStatus,
                        route: "manual",
                        promptRef: normalizedPrompt,
                    },
                ]);
                setRunRecords([]);
                setActiveRunIndex(0);

                const sessionResult = await createJarvisRequest({
                    prompt: normalizedPrompt,
                    source: "assistant_manual",
                    client_session_id: manualSessionId,
                    target_hint: manualTargetHint,
                    provider: requestPayload.provider,
                    strict_provider: requestPayload.strict_provider,
                    model: requestPayload.model,
                });
                dispatchJarvisDataRefresh({ scope: "sessions", source: "assistant-manual:jarvis-request" });

                if (sessionResult.delegation.task_id) {
                    linkSessionTask(manualSessionId, sessionResult.delegation.task_id);
                    dispatchJarvisDataRefresh({ scope: "tasks", source: "assistant-manual:task-linked" });
                }

                const contextId = sessionResult.delegation.assistant_context_id;
                if (!contextId) {
                    if (
                        sessionResult.delegation.primary_target === "council" &&
                        sessionResult.delegation.council_run_id
                    ) {
                        dispatchCouncilIntake({
                            id: manualSessionId,
                            prompt: normalizedPrompt,
                            runId: sessionResult.delegation.council_run_id,
                            taskId: sessionResult.delegation.task_id ?? undefined,
                            createdAt: new Date().toISOString(),
                        });
                        return;
                    }
                    if (sessionResult.delegation.primary_target !== "assistant") {
                        return;
                    }
                    throw new Error(t("assistant.error.contextMissing"));
                }

                rememberContextSessionLink(manualSessionId, manualSessionId);
                rememberContextSessionLink(contextId, manualSessionId);
                autoContextStartedThisSessionRef.current.add(manualSessionId);
                autoContextDeliveredRevisionRef.current.delete(manualSessionId);

                const accepted = await runAssistantContextWithMeta(contextId, {
                    provider: requestPayload.provider,
                    strict_provider: requestPayload.strict_provider,
                    model: requestPayload.model,
                    task_type: requestPayload.task_type,
                    client_run_nonce: manualRunNonce,
                });

                rememberContextSessionLink(accepted.context.id, manualSessionId);
                rememberContextSessionLink(accepted.context.clientContextId, manualSessionId);
                setAutoContexts((prev) => mergeAutoContexts(prev, [toAutoContextFromServer(accepted.context)]));
                return;
            }

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
                const resolvedCredential = formatSelectedCredentialLabel(result.credential);
                const completedRun: RunRecord = {
                    ...pendingRuns[0],
                    status: "success",
                    output: result.output,
                    servedProvider: result.provider,
                    servedModel: result.model,
                    servedCredential: resolvedCredential,
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
                        status: `${result.provider}/${result.model}${result.used_fallback ? " (fallback)" : ""}${
                            resolvedCredential ? ` · ${resolvedCredential}` : ""
                        }`,
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
                    const resolvedCredential = formatSelectedCredentialLabel(result.credential);
                    return {
                        ...pendingRun,
                        status: "success" as const,
                        output: result.output,
                        servedProvider: result.provider,
                        servedModel: result.model,
                        servedCredential: resolvedCredential,
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
            if (useManualJarvisSession) {
                const fallbackSessionId = activeMessageSessionRef.current;
                if (fallbackSessionId) {
                    writeSessionMessages(fallbackSessionId, (current) => [
                        ...current,
                        {
                            role: "assistant",
                            content: message,
                            status: failure.reason ? t("common.blocked") : t("common.error"),
                            route: "manual",
                            promptRef: normalizedPrompt,
                        },
                    ]);
                }
            }
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
                    status: failure.reason ? t("common.blocked") : t("common.error"),
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
        linkSessionTask,
        modelOverride,
        openWidgets,
        parallelRuns,
        qualitySoftGateEnabled,
        rememberContextSessionLink,
        startSession,
        t,
        toRunTimeline,
        uiSoftWarnEnabled,
        writeSessionMessages,
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
                rememberContextSessionLink(payload.id, payload.id);
                void syncAutoContextsWithRetry();
                return;
            }

            void startAutoMissionContext(payload);
        });

        const unsubscribeMissionTaskLink = subscribeMissionIntakeTaskLink((payload) => {
            pendingTaskLinksRef.current.set(payload.id, payload.taskId);
            rememberContextSessionLink(payload.id, payload.id);
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
    }, [rememberContextSessionLink, startAutoMissionContext, syncAutoContextsWithRetry]);

    useEffect(() => {
        const runningServerContextIds = new Set<string>();
        const nowMs = Date.now();
        for (const context of autoContexts) {
            if (context.status !== "running" || !context.serverContextId) {
                continue;
            }

            const serverContextId = context.serverContextId;
            runningServerContextIds.add(serverContextId);
            const retryState = contextStreamRetryStateRef.current.get(serverContextId);
            if (retryState?.terminal) {
                continue;
            }
            if (retryState && retryState.retryAtMs > nowMs) {
                continue;
            }

            if (contextStreamRef.current.has(serverContextId)) {
                continue;
            }

            const stream = streamAssistantContextEvents(serverContextId, {
                onOpen: () => {
                    contextStreamRetryStateRef.current.delete(serverContextId);
                    contextLastEventAtRef.current.set(serverContextId, Date.now());
                },
                onEvent: (payload) => {
                    contextLastEventAtRef.current.set(serverContextId, Date.now());
                    const row = payload.context;
                    const clientContextId =
                        row?.clientContextId ??
                        autoContextsRef.current.find((item) => item.serverContextId === serverContextId)?.id;
                    if (clientContextId) {
                        appendAutoContextEvents(clientContextId, [toAutoMissionEvent(payload.event)]);
                    }

                    if (!row) {
                        syncAutoContextsWithThrottle(1000);
                        return;
                    }

                    setAutoContexts((prev) => mergeAutoContexts(prev, [toAutoContextFromServer(row)]));
                    if (row.status !== "running") {
                        const current = contextStreamRef.current.get(serverContextId);
                        if (current) {
                            current.close();
                            contextStreamRef.current.delete(serverContextId);
                        }
                        contextStreamRetryStateRef.current.delete(serverContextId);
                        contextLastEventAtRef.current.delete(serverContextId);
                        const reconnectTimer = contextReconnectTimersRef.current.get(serverContextId);
                        if (reconnectTimer) {
                            window.clearTimeout(reconnectTimer);
                            contextReconnectTimersRef.current.delete(serverContextId);
                        }
                    }
                },
                onClose: () => {
                    const current = contextStreamRef.current.get(serverContextId);
                    if (current) {
                        current.close();
                    }
                    contextStreamRef.current.delete(serverContextId);
                    contextLastEventAtRef.current.delete(serverContextId);
                    emitRuntimeEvent("assistant_stream_closed", {
                        serverContextId,
                        source: "stream_close",
                    });
                    scheduleContextReconnect(serverContextId, context.id, "close");
                    syncAutoContextsWithThrottle(1200);
                },
                onError: () => {
                    const current = contextStreamRef.current.get(serverContextId);
                    if (current) {
                        current.close();
                    }
                    contextStreamRef.current.delete(serverContextId);
                    contextLastEventAtRef.current.delete(serverContextId);
                    emitRuntimeEvent("assistant_stream_closed", {
                        serverContextId,
                        source: "stream_error",
                    });
                    void handleContextStreamFailure(serverContextId, context.id);
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
            contextStreamRetryStateRef.current.delete(serverContextId);
            contextLastEventAtRef.current.delete(serverContextId);
            const reconnectTimer = contextReconnectTimersRef.current.get(serverContextId);
            if (reconnectTimer) {
                window.clearTimeout(reconnectTimer);
                contextReconnectTimersRef.current.delete(serverContextId);
            }
        }
    }, [
        appendAutoContextEvents,
        autoContexts,
        handleContextStreamFailure,
        scheduleContextReconnect,
        streamReconnectTick,
        syncAutoContextsWithThrottle,
    ]);

    useEffect(() => {
        if (!streamResilienceEnabled) {
            return;
        }
        const timerId = window.setInterval(() => {
            const nowMs = Date.now();
            for (const context of autoContextsRef.current) {
                if (context.status !== "running" || !context.serverContextId) {
                    continue;
                }
                const lastEventAt = contextLastEventAtRef.current.get(context.serverContextId);
                if (!lastEventAt || nowMs - lastEventAt <= 20_000) {
                    continue;
                }
                emitRuntimeEvent("assistant_stage_stalled_detected", {
                    contextId: context.id,
                    serverContextId: context.serverContextId,
                    lastEventAgeMs: nowMs - lastEventAt,
                });
                contextLastEventAtRef.current.set(context.serverContextId, nowMs);
                void syncAutoContextsWithRetry({ attempts: 3, baseDelayMs: 220 });
                setStreamReconnectTick((prev) => prev + 1);
            }
        }, 5_000);
        return () => {
            window.clearInterval(timerId);
        };
    }, [streamResilienceEnabled, syncAutoContextsWithRetry]);

    useEffect(() => {
        const streamMap = contextStreamRef.current;
        const streamRetryStateMap = contextStreamRetryStateRef.current;
        const reconnectTimerMap = contextReconnectTimersRef.current;
        const lastEventAtMap = contextLastEventAtRef.current;
        const missingProbeSet = contextMissingProbeInFlightRef.current;
        const eventHydrationFailuresMap = contextEventHydrationFailuresRef.current;
        const groundingHydrationFailuresMap = groundingHydrationFailuresRef.current;
        const bootstrapInFlightSet = autoContextBootstrapInFlightRef.current;
        return () => {
            for (const stream of streamMap.values()) {
                stream.close();
            }
            for (const timerId of reconnectTimerMap.values()) {
                window.clearTimeout(timerId);
            }
            streamMap.clear();
            streamRetryStateMap.clear();
            reconnectTimerMap.clear();
            lastEventAtMap.clear();
            missingProbeSet.clear();
            eventHydrationFailuresMap.clear();
            groundingHydrationFailuresMap.clear();
            bootstrapInFlightSet.clear();
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

    const userStageTimeline = useMemo<{ context: AutoMissionContext; rows: AssistantStageTimelineRow[] } | null>(() => {
        if (!stageTimelineEnabled || !activeSessionId) {
            return null;
        }
        const activeSession = sessions.find((session) => session.id === activeSessionId);
        if (!activeSession) {
            return null;
        }
        const candidateContexts = autoContexts
            .filter((context) => {
                return context.id === activeSession.id || (activeSession.taskId && context.taskId === activeSession.taskId);
            })
            .sort((left, right) => {
                if (left.status !== right.status) {
                    if (left.status === "running") return -1;
                    if (right.status === "running") return 1;
                }
                const leftTime = Date.parse(left.completedAt ?? left.startedAt);
                const rightTime = Date.parse(right.completedAt ?? right.startedAt);
                const safeLeft = Number.isNaN(leftTime) ? 0 : leftTime;
                const safeRight = Number.isNaN(rightTime) ? 0 : rightTime;
                return safeRight - safeLeft;
            });
        const target = candidateContexts[0];
        if (!target) {
            return null;
        }

        const sourceEvents = autoContextEvents[target.id] ?? [];
        const parsedRows: AssistantStageTimelineRow[] = sourceEvents
            .filter((event) => event.eventType === "assistant.context.stage.updated")
            .map((event) => {
                const data = event.data ?? {};
                const stage = toAssistantStage(data.stage);
                if (!stage) {
                    return null;
                }
                const stageSeqFromData = toNumber(data.stage_seq);
                const seq = stageSeqFromData ?? (timelineStageSeqOnlyEnabled ? event.effectiveSeq : event.sequence);
                const finalized = data.finalized === "delivered" || data.finalized === "failed" ? data.finalized : null;
                return {
                    stage,
                    stageSeq: seq,
                    startedAt: toIsoStringOrNow(data.started_at ?? event.createdAt),
                    endedAt: typeof data.ended_at === "string" ? data.ended_at : null,
                    reasonCode: typeof data.reason_code === "string" ? data.reason_code : null,
                    finalized,
                    status: finalized === "failed" ? "failed" : "done",
                    contextId: target.id,
                };
            })
            .filter((item): item is AssistantStageTimelineRow => item !== null);

        if (parsedRows.length === 0) {
            return {
                context: target,
                rows: [
                    {
                        stage: "accepted",
                        stageSeq: 1,
                        startedAt: target.startedAt,
                        endedAt: null,
                        reasonCode: null,
                        finalized: null,
                        status: target.status === "running" ? "running" : target.status === "error" ? "failed" : "done",
                        contextId: target.id,
                    },
                ],
            };
        }

        const dedupedByStage = new Map<AssistantStage, AssistantStageTimelineRow>();
        for (const row of parsedRows) {
            const current = dedupedByStage.get(row.stage);
            if (!current || row.stageSeq >= current.stageSeq) {
                dedupedByStage.set(row.stage, row);
            }
        }

        const dedupedRows = Array.from(dedupedByStage.values()).sort((left, right) => {
            if (left.stageSeq !== right.stageSeq) {
                return left.stageSeq - right.stageSeq;
            }
            return STAGE_ORDER.indexOf(left.stage) - STAGE_ORDER.indexOf(right.stage);
        });
        const highestSeq = dedupedRows.reduce((max, item) => Math.max(max, item.stageSeq), 0);
        const hasFinalized = dedupedRows.some((item) => item.stage === "finalized");

        const rows = dedupedRows.map((row) => {
            if (target.status === "running" && !hasFinalized && row.stageSeq === highestSeq) {
                return {
                    ...row,
                    status: "running" as const,
                };
            }
            if (row.stage === "finalized" && row.finalized === "failed") {
                return {
                    ...row,
                    status: "failed" as const,
                };
            }
            return {
                ...row,
                status: "done" as const,
            };
        });

        return {
            context: target,
            rows,
        };
    }, [activeSessionId, autoContextEvents, autoContexts, sessions, stageTimelineEnabled, timelineStageSeqOnlyEnabled]);

    const [stageTimelineNowMs, setStageTimelineNowMs] = useState(() => Date.now());
    const timelineContextId = userStageTimeline?.context.id ?? null;
    const timelineIsRunning = userStageTimeline?.context.status === "running";

    useEffect(() => {
        if (!timelineContextId || !timelineIsRunning) {
            return;
        }
        setStageTimelineNowMs(Date.now());
        const timerId = window.setInterval(() => {
            setStageTimelineNowMs(Date.now());
        }, 1000);
        return () => {
            window.clearInterval(timerId);
        };
    }, [timelineContextId, timelineIsRunning]);

    const userStageProgress = useMemo<AssistantStageProgress | null>(() => {
        if (!userStageTimeline || userStageTimeline.rows.length === 0) {
            return null;
        }
        const rows = userStageTimeline.rows;
        const runningRow = rows.find((row) => row.status === "running");
        const failedRow = rows.find((row) => row.status === "failed");
        const activeRow = runningRow ?? failedRow ?? rows[rows.length - 1];
        const stageIndex = Math.max(0, STAGE_ORDER.indexOf(activeRow.stage));
        const rawProgress =
            activeRow.stage === "finalized" && !runningRow
                ? 100
                : ((stageIndex + (runningRow ? 0.45 : 1)) / STAGE_ORDER.length) * 100;
        const progressPercent = Math.min(100, Math.max(6, Math.round(rawProgress)));
        return {
            currentStageLabel: STAGE_LABELS[activeRow.stage],
            progressPercent,
            isRunning: Boolean(runningRow),
            hasFailed: Boolean(failedRow),
            elapsedLabel: runningRow ? formatElapsedShort(userStageTimeline.context.startedAt, stageTimelineNowMs) : null,
        };
    }, [stageTimelineNowMs, userStageTimeline]);

    const userReasoningSummary = useMemo<AssistantReasoningSummary | null>(() => {
        if (!stageTimelineEnabled || !userStageTimeline) {
            return null;
        }

        const context = userStageTimeline.context;
        const sourceEvents = autoContextEvents[context.id] ?? [];
        const latestByEventType = new Map<string, AutoMissionEvent>();
        const stageDataByStage = new Map<AssistantStage, { seq: number; data: Record<string, unknown> }>();

        for (const event of sourceEvents) {
            const existingEvent = latestByEventType.get(event.eventType);
            if (!existingEvent || event.effectiveSeq >= existingEvent.effectiveSeq) {
                latestByEventType.set(event.eventType, event);
            }
            if (event.eventType !== "assistant.context.stage.updated") {
                continue;
            }
            const stage = toAssistantStage(event.data.stage);
            if (!stage) {
                continue;
            }
            const stageSeq = toNumber(event.data.stage_seq) ?? event.effectiveSeq;
            const current = stageDataByStage.get(stage);
            if (!current || stageSeq >= current.seq) {
                stageDataByStage.set(stage, {
                    seq: stageSeq,
                    data: event.data,
                });
            }
        }

        const policyData =
            stageDataByStage.get("policy_resolved")?.data ??
            latestByEventType.get("assistant.context.policy.resolved")?.data ??
            {};
        const retrievalData = stageDataByStage.get("retrieval_completed")?.data ?? {};
        const qualityData = stageDataByStage.get("quality_checked")?.data ?? {};
        const finalizedData = stageDataByStage.get("finalized")?.data ?? {};
        const completedData = latestByEventType.get("assistant.context.run.completed")?.data ?? {};

        const groundingPolicy =
            typeof policyData.grounding_policy === "string"
                ? policyData.grounding_policy
                : typeof completedData.grounding_policy === "string"
                    ? completedData.grounding_policy
                    : null;
        const groundingRequired =
            policyData.grounding_required === true || completedData.grounding_required === true;

        const retrievalSourceCount = toNumber(
            retrievalData.retrieval_sources_count ?? completedData.sources_count
        );
        const retrievalGatePassedRaw = retrievalData.retrieval_quality_gate_passed;
        const retrievalGatePassed =
            typeof retrievalGatePassedRaw === "boolean" ? retrievalGatePassedRaw : null;

        const completedQuality =
            completedData.quality && typeof completedData.quality === "object"
                ? (completedData.quality as Record<string, unknown>)
                : null;
        const qualityResult =
            toQualityGateResult(qualityData.quality_gate_result) ??
            toQualityGateResult(completedData.quality_gate_result) ??
            toQualityGateResult(completedQuality?.gateResult);
        const qualityReasonCodes = parseQualityReasonCodes("", [
            ...toStringArray(qualityData.quality_gate_code),
            ...toStringArray(completedData.quality_gate_code),
            ...toStringArray(completedQuality?.reasons),
        ]);

        const completedDelivery =
            completedData.delivery && typeof completedData.delivery === "object"
                ? (completedData.delivery as Record<string, unknown>)
                : null;
        const deliveryMode =
            typeof finalizedData.delivery_mode === "string"
                ? finalizedData.delivery_mode
                : typeof completedDelivery?.mode === "string"
                    ? completedDelivery.mode
                    : null;

        const provider =
            typeof finalizedData.provider === "string"
                ? finalizedData.provider
                : typeof completedData.provider === "string"
                    ? completedData.provider
                    : context.servedProvider;
        const model =
            typeof finalizedData.model === "string"
                ? finalizedData.model
                : typeof completedData.model === "string"
                    ? completedData.model
                    : context.servedModel;

        const runningStage = userStageTimeline.rows.find((item) => item.status === "running");
        const latestStage = userStageTimeline.rows[userStageTimeline.rows.length - 1];
        const currentStageLabel = STAGE_LABELS[(runningStage ?? latestStage)?.stage ?? "accepted"];
        const headline =
            context.status === "running"
                ? `현재 단계: ${currentStageLabel}`
                : context.status === "error"
                    ? "실행 실패: 품질/공급자 상태를 확인하세요."
                    : "실행 완료: 최종 응답을 전달했습니다.";

        const lines: string[] = [];
        if (groundingPolicy) {
            lines.push(
                `정책 판정: ${groundingPolicy}${groundingRequired ? " · grounded required" : " · grounded optional"}`
            );
        } else {
            lines.push(`요청 분류: ${context.intent}`);
        }
        if (retrievalSourceCount !== null || groundingRequired) {
            if (retrievalSourceCount === null) {
                lines.push(
                    `근거 수집: ${
                        context.status === "running" ? "수집 단계 진행 중" : "수집 메타 없음"
                    }`
                );
            } else {
                lines.push(
                    `근거 수집: ${retrievalSourceCount}개 출처 확보${
                        retrievalGatePassed === false ? " (retrieval 품질 경고)" : ""
                    }`
                );
            }
        }

        const qualityLabel =
            qualityResult === "hard_fail"
                ? "hard fail"
                : qualityResult === "soft_warn"
                    ? "soft warn"
                    : qualityResult === "pass"
                        ? "pass"
                        : context.status === "running"
                            ? "pending"
                            : "unknown";
        if (qualityReasonCodes.length > 0) {
            lines.push(
                `품질 게이트: ${qualityLabel} · ${qualityReasonCodes
                    .slice(0, 2)
                    .map((code) => mapBlockedReasonLabel(code))
                    .join(" / ")}`
            );
        } else {
            lines.push(`품질 게이트: ${qualityLabel}`);
        }

        if (provider || model || deliveryMode) {
            lines.push(
                `전달 경로: ${provider ?? "auto"}/${model ?? "default"} · ${
                    deliveryMode ?? (context.status === "running" ? "preparing" : "normal")
                }`
            );
        }

        return {
            headline,
            lines,
            qualityResult: context.status === "running" && !qualityResult ? "running" : qualityResult,
        };
    }, [autoContextEvents, stageTimelineEnabled, userStageTimeline]);

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
        { key: "failed", label: t("common.failed").toUpperCase() },
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
                return t("common.failed").toUpperCase();
            }
            if (qualityState.gateResult === "hard_fail") {
                return `DEGRADED${providerLabel ? ` · ${providerLabel}` : ""}`;
            }
            if (qualityState.gateResult === "soft_warn") {
                return `WARN${providerLabel ? ` · ${providerLabel}` : ""}`;
            }
            return providerLabel ?? "DONE";
        },
        [resolveAutoContextQualityState, t]
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
        if (restoredContext) {
            rememberContextSessionLink(restoredContext.id, activeSessionId);
        }
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
    }, [activeSessionId, autoContexts, buildAutoContextStatusLabel, rememberContextSessionLink, resolveAutoContextGrounding, sessions]);

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
            if (message.contextId) {
                rememberContextSessionLink(message.contextId, targetSessionId);
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
        [activeSessionId, rememberContextSessionLink]
    );

    const deliverAutoContextMessage = useCallback(
        (context: AutoMissionContext, sessionId?: string | null) => {
            if (context.status === "running") {
                return;
            }
            const resolvedSessionId =
                sessionId ??
                contextSessionMapRef.current.get(context.id) ??
                (context.taskId
                    ? sessions.find((session) => session.taskId === context.taskId)?.id ?? null
                    : null) ??
                activeSessionId ??
                null;
            rememberContextSessionLink(context.id, resolvedSessionId);
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

            appendMessageToSession(resolvedSessionId, {
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
                sessionId: resolvedSessionId,
                taskId: context.taskId ?? null,
                outputHash: hashText(context.output),
            });
            emitRuntimeEvent("assistant_message_delivered", {
                contextId: context.id,
                sessionId: resolvedSessionId,
                revision,
                qualityGateResult,
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
            if (exactlyOnceDeliveryEnabled && resolvedSessionId) {
                markSessionContextDelivered(resolvedSessionId, context.id, revision);
            }
        },
        [
            activeSessionId,
            appendMessageToSession,
            buildAutoContextStatusLabel,
            exactlyOnceDeliveryEnabled,
            markSessionContextDelivered,
            rememberContextSessionLink,
            resolveAutoContextGrounding,
            sessions,
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
            const linkedFromMap = contextSessionMapRef.current.get(context.id);
            if (linkedFromMap) {
                return linkedFromMap;
            }
            const linked = sessions.find(
                (session) => session.id === context.id || (session.taskId && context.taskId && session.taskId === context.taskId)
            );
            if (linked) {
                rememberContextSessionLink(context.id, linked.id);
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
    }, [activeSessionId, autoContexts, deliverAutoContextMessage, rememberContextSessionLink, sessions]);

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
                                {showDebugView ? t("assistant.debugOn") : t("assistant.debugOff")}
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
                        <div className="border-b border-white/5 bg-black/40">
                            <div className="px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                                <span className="text-white/55 uppercase tracking-widest">{t("assistant.userMode")}</span>
                                <span className="text-cyan-300/80">
                                    {t("assistant.groundedAnswers")}
                                </span>
                            </div>
                            {(sessionLaunchCard || jarvisSessionDetail || jarvisSessionError || jarvisSessionFallbackNotice) && (
                                <div className="px-4 pb-3">
                                    <div className="rounded border border-cyan-500/20 bg-cyan-500/5 px-3 py-3">
                                        {sessionLaunchCard && (
                                            <div className="mb-3 rounded border border-cyan-400/25 bg-gradient-to-r from-cyan-500/15 via-cyan-500/8 to-transparent px-3 py-3">
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                    <div>
                                                        <div className="inline-flex items-center gap-2 rounded border border-cyan-400/30 bg-black/30 px-2 py-1 text-[10px] font-mono tracking-[0.25em] text-cyan-200 uppercase">
                                                            <Sparkles size={11} />
                                                            {sessionLaunchCard.isFresh ? t("assistant.newSession") : t("assistant.activeSession")}
                                                        </div>
                                                        <p className="mt-2 text-sm font-mono text-cyan-100">{sessionLaunchCard.lane}</p>
                                                        <p className="mt-1 text-[11px] text-white/55">
                                                            {sessionLaunchCard.entry} · {sessionLaunchCard.id}
                                                            {sessionLaunchCard.ageLabel ? ` · ${t("assistant.startedAgo", { value: sessionLaunchCard.ageLabel })}` : ""}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">{t("assistant.currentState")}</p>
                                                        <p className="mt-1 text-sm text-white/90">
                                                            {describeJarvisStatus(t, sessionLaunchCard.status)} · {describePrimaryTarget(t, sessionLaunchCard.target)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                            <div className="rounded border border-white/10 bg-black/30 p-3">
                                                <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("assistant.goal")}</p>
                                                {jarvisSessionError ? (
                                                    <p className="mt-2 text-xs font-mono text-rose-300">{jarvisSessionError}</p>
                                                ) : (
                                                    <>
                                                        <p className="mt-2 text-sm text-white/90">
                                                            {jarvisSessionDetail?.session.title ?? activeHudSession?.prompt ?? t("common.loading")}
                                                        </p>
                                                        <p className="mt-1 text-[11px] text-white/60">
                                                            {jarvisSessionDetail?.session.prompt ?? activeHudSession?.prompt}
                                                        </p>
                                                        {jarvisSessionFallbackNotice ? (
                                                            <p className="mt-2 text-[11px] text-amber-200/85">{jarvisSessionFallbackNotice}</p>
                                                        ) : null}
                                                    </>
                                                )}
                                            </div>
                                            <div className="rounded border border-white/10 bg-black/30 p-3">
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("assistant.capabilities")}</p>
                                                    <span className="text-[10px] text-white/55">
                                                        {describeJarvisStatus(
                                                            t,
                                                            jarvisSessionDetail?.session.status ?? (activeHudSession ? "running" : "queued")
                                                        )}
                                                    </span>
                                                </div>
                                                {sessionPlanSummary ? (
                                                    <p className="mt-2 text-sm text-white/85">{sessionPlanSummary}</p>
                                                ) : null}
                                                {sessionResearchProfile ? (
                                                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                                                        <div className="rounded border border-white/10 bg-black/25 p-2">
                                                            <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                                {t("assistant.researchProfile")}
                                                            </p>
                                                            <p className="mt-1 text-sm text-white/90">
                                                                {describeResearchProfile(t, sessionResearchProfile)}
                                                            </p>
                                                        </div>
                                                        <div className="rounded border border-white/10 bg-black/25 p-2">
                                                            <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                                {t("assistant.researchQuality")}
                                                            </p>
                                                            <p className="mt-1 text-sm text-white/90">
                                                                {describeResearchQualityMode(t, sessionResearchQualityMode)}
                                                            </p>
                                                        </div>
                                                        <div className="rounded border border-white/10 bg-black/25 p-2">
                                                            <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                                {t("assistant.researchProfileReasons")}
                                                            </p>
                                                            <div className="mt-1 space-y-1">
                                                                {localizedProfileReasons.length > 0 ? (
                                                                    localizedProfileReasons.slice(0, 2).map((reason) => (
                                                                        <p key={reason} className="text-[11px] text-white/75">
                                                                            - {reason}
                                                                        </p>
                                                                    ))
                                                                ) : (
                                                                    <p className="text-[11px] text-white/55">{t("assistant.noResearchProfileReasons")}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="rounded border border-white/10 bg-black/25 p-2">
                                                            <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                                {t("assistant.researchGaps")}
                                                            </p>
                                                            <div className="mt-1 space-y-1">
                                                                {sessionQualityWarnings.length > 0 ? (
                                                                    sessionQualityWarnings.slice(0, 2).map((warning) => (
                                                                        <p key={warning} className="text-[11px] text-white/75">
                                                                            - {warning}
                                                                        </p>
                                                                    ))
                                                                ) : (
                                                                    <p className="text-[11px] text-white/55">{t("assistant.noResearchWarnings")}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : null}
                                                {sessionQuickActions.length > 0 ? (
                                                    <div className="mt-3 rounded border border-cyan-500/20 bg-cyan-500/5 p-3">
                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                            <p className="text-[10px] font-mono tracking-widest text-cyan-300">
                                                                {t("assistant.quickActions")}
                                                            </p>
                                                            <p className="text-[10px] text-white/45">{t("assistant.quickActionsHint")}</p>
                                                        </div>
                                                        <div className="mt-2 flex flex-wrap gap-2">
                                                            {sessionQuickActions.map((action) => (
                                                                <Link key={action.key} href={action.href} className={action.className}>
                                                                    {action.label}
                                                                </Link>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : null}
                                                {sessionHasCoverageWarnings ? (
                                                    <div className="mt-3 rounded border border-amber-500/25 bg-amber-500/8 p-3">
                                                        <p className="text-[10px] font-mono tracking-widest text-amber-300">
                                                            {t("assistant.coverageWarningTitle")}
                                                        </p>
                                                        <p className="mt-2 text-xs text-amber-50/85">
                                                            {t("assistant.coverageWarningBody")}
                                                        </p>
                                                        {sessionQualityWarnings.length > 0 ? (
                                                            <div className="mt-2 space-y-1">
                                                                {sessionQualityWarnings.map((warning) => (
                                                                    <p key={warning} className="text-[11px] text-amber-100/80">
                                                                        - {warning}
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                                {sessionChangeClassLabel || sessionChangeSeverityLabel ? (
                                                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                                                        <div className="rounded border border-white/10 bg-black/25 p-2">
                                                            <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                                {t("assistant.changeClassLabel")}
                                                            </p>
                                                            <p className="mt-1 text-sm text-white/90">
                                                                {sessionChangeClassLabel ?? t("assistant.changeClass.unknown")}
                                                            </p>
                                                        </div>
                                                        <div className="rounded border border-white/10 bg-black/25 p-2">
                                                            <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                                {t("assistant.changeSeverityLabel")}
                                                            </p>
                                                            <p className="mt-1 text-sm text-white/90">
                                                                {sessionChangeSeverityLabel ?? t("assistant.changeSeverity.info")}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ) : null}
                                                {sessionResearchDimensionLines.length > 0 ? (
                                                    <div className="mt-3 rounded border border-white/10 bg-black/25 p-3">
                                                        <p className="text-[10px] font-mono tracking-widest text-cyan-300">
                                                            {t("assistant.researchEvidenceSummary")}
                                                        </p>
                                                        <div className="mt-2 space-y-1">
                                                            {sessionResearchDimensionLines.map((line) => (
                                                                <p key={line} className="text-[11px] text-white/75">
                                                                    - {line}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : null}
                                                <div className="mt-3 rounded border border-white/10 bg-black/25 p-3">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="text-[10px] font-mono tracking-widest text-cyan-300">
                                                            {t("assistant.memoryInfluences")}
                                                        </p>
                                                        {sessionMemoryInfluenceLines.length > 0 ? (
                                                            <span className="text-[10px] text-white/45">
                                                                {t("assistant.memoryInfluencesCount", { value: sessionMemoryInfluenceLines.length })}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    {sessionMemoryInfluenceLines.length > 0 ? (
                                                        <div className="mt-2 space-y-1">
                                                            {sessionMemoryInfluenceLines.map((line) => (
                                                                <p key={line} className="text-[11px] leading-5 text-white/70">
                                                                    - {line}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="mt-2 text-xs text-white/45">{t("assistant.noMemoryInfluences")}</p>
                                                    )}
                                                </div>
                                                <div className="mt-3 rounded border border-white/10 bg-black/25 p-3">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="text-[10px] font-mono tracking-widest text-cyan-300">
                                                            {t("assistant.memoryContext")}
                                                        </p>
                                                        {sessionMemoryContext?.notes?.length ? (
                                                            <span className="text-[10px] text-white/45">
                                                                {t("assistant.memoryContextCount", { value: sessionMemoryContext.notes.length })}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    {sessionMemoryLines.length > 0 ? (
                                                        <div className="mt-2 space-y-2">
                                                            {sessionMemoryLines.map((item) => (
                                                                <div key={item.id} className="rounded border border-white/10 bg-black/20 p-2">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <span className="rounded border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-cyan-100">
                                                                            {item.kind}
                                                                        </span>
                                                                        {item.pinned ? (
                                                                            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-white/60">
                                                                                {t("assistant.memoryPinned")}
                                                                            </span>
                                                                        ) : null}
                                                                        <span className="text-[10px] text-white/35">{item.updatedAt}</span>
                                                                    </div>
                                                                    <p className="mt-2 text-sm text-white/90">{item.title}</p>
                                                                    <p className="mt-1 text-[11px] leading-5 text-white/65">{item.preview}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="mt-2 text-xs text-white/45">{t("assistant.noMemoryContext")}</p>
                                                    )}
                                                </div>
                                                <div className="mt-3 rounded border border-white/10 bg-black/25 p-3">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="text-[10px] font-mono tracking-widest text-cyan-300">
                                                            {t("assistant.memoryPlan")}
                                                        </p>
                                                        {sessionMemoryPlanSignals.length > 0 ? (
                                                            <span className="text-[10px] text-white/45">
                                                                {t("assistant.memoryPlanCount", { value: sessionMemoryPlanSignals.length })}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    {sessionMemoryPlanLines.length > 0 ? (
                                                        <div className="mt-2 space-y-1">
                                                            {sessionMemoryPlanLines.map((line) => (
                                                                <p key={line} className="text-[11px] leading-5 text-white/70">
                                                                    - {line}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="mt-2 text-xs text-white/45">{t("assistant.noMemoryPlan")}</p>
                                                    )}
                                                </div>
                                                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                                                    <div className="rounded border border-white/10 bg-black/25 p-2">
                                                        <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                            {t("assistant.currentStage")}
                                                        </p>
                                                        {currentStageRecord ? (
                                                            <>
                                                                <p className="mt-1 text-sm text-white/90">
                                                                    {describeCapability(t, currentStageRecord.capability)}
                                                                </p>
                                                                <p className="mt-1 text-[11px] text-white/55">
                                                                    {localizeJarvisSummary(t, currentStageRecord.summary) || describeCapabilityHint(t, currentStageRecord.capability)}
                                                                </p>
                                                            </>
                                                        ) : (
                                                            <p className="mt-1 text-xs text-white/45">{t("assistant.currentStageNone")}</p>
                                                        )}
                                                    </div>
                                                    <div className="rounded border border-white/10 bg-black/25 p-2">
                                                        <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                            {t("assistant.nextStage")}
                                                        </p>
                                                        {nextStageRecord ? (
                                                            <>
                                                                <p className="mt-1 text-sm text-white/90">
                                                                    {describeCapability(t, nextStageRecord.capability)}
                                                                </p>
                                                                <p className="mt-1 text-[11px] text-white/55">
                                                                    {describeCapabilityHint(t, nextStageRecord.capability)}
                                                                </p>
                                                            </>
                                                        ) : (
                                                            <p className="mt-1 text-xs text-white/45">{t("assistant.nextStageNone")}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                {sessionExecutionOptionDescriptor ? (
                                                    <div className="mt-3 rounded border border-white/10 bg-black/25 p-2">
                                                        <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                            {t("assistant.executionOption")}
                                                        </p>
                                                        <p className="mt-1 text-sm text-white/90">{sessionExecutionOptionDescriptor.label}</p>
                                                        <p className="mt-1 text-[11px] text-white/55">{sessionExecutionOptionDescriptor.hint}</p>
                                                    </div>
                                                ) : null}
                                                {jarvisSessionDetail ? (
                                                    <div className="mt-3">
                                                        <RunnerGraphSummaryPanel
                                                            detail={jarvisSessionDetail.runner_detail ?? null}
                                                            emptyMessage={t("actionCenter.runner.empty")}
                                                            className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3"
                                                        />
                                                    </div>
                                                ) : null}
                                                <div className="mt-3 space-y-3">
                                                    <div>
                                                        <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                            {t("assistant.capabilitiesRequested")}
                                                        </p>
                                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                                            {sessionCapabilityBuckets.requested.length > 0 ? (
                                                                sessionCapabilityBuckets.requested.map((capability) => (
                                                                    <span
                                                                        key={`requested-${capability}`}
                                                                        className="rounded border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-cyan-100"
                                                                    >
                                                                        {describeCapability(t, capability)}
                                                                    </span>
                                                                ))
                                                            ) : (
                                                                <span className="text-xs text-white/45">{t("assistant.noRequestedCapabilities")}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                            {t("assistant.capabilitiesActive")}
                                                        </p>
                                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                                            {sessionCapabilityBuckets.active.length > 0 ? (
                                                                sessionCapabilityBuckets.active.map((capability) => (
                                                                    <span
                                                                        key={`active-${capability}`}
                                                                        className="rounded border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-amber-100"
                                                                    >
                                                                        {describeCapability(t, capability)}
                                                                    </span>
                                                                ))
                                                            ) : (
                                                                <span className="text-xs text-white/45">{t("assistant.noActiveCapabilities")}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] font-mono tracking-widest text-white/40">
                                                            {t("assistant.capabilitiesCompleted")}
                                                        </p>
                                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                                            {sessionCapabilityBuckets.completed.length > 0 ? (
                                                                sessionCapabilityBuckets.completed.map((capability) => (
                                                                    <span
                                                                        key={`completed-${capability}`}
                                                                        className="rounded border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-emerald-100"
                                                                    >
                                                                        {describeCapability(t, capability)}
                                                                    </span>
                                                                ))
                                                            ) : (
                                                                <span className="text-xs text-white/45">{t("assistant.noCompletedCapabilities")}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="rounded border border-white/10 bg-black/30 p-3">
                                                <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("assistant.stages")}</p>
                                                <div className="mt-2 space-y-2">
                                                    {sessionStageRecords.length > 0 ? (
                                                        sessionStageRecords.map((stage, index) => {
                                                            const statusClass =
                                                                stage.status === "completed"
                                                                    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                                                    : stage.status === "running"
                                                                      ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-200"
                                                                      : stage.status === "needs_approval"
                                                                        ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                                                                        : stage.status === "failed"
                                                                          ? "border-rose-500/35 bg-rose-500/10 text-rose-200"
                                                                          : stage.status === "blocked"
                                                                            ? "border-orange-500/35 bg-orange-500/10 text-orange-200"
                                                                            : "border-white/15 bg-white/5 text-white/65";
                                                            return (
                                                                <div
                                                                    key={stage.id}
                                                                    className="rounded border border-white/10 bg-black/25 px-2 py-2"
                                                                >
                                                                    <div className="flex items-start justify-between gap-2">
                                                                        <div className="min-w-0">
                                                                            <p className="text-xs text-white/90">
                                                                                {index + 1}. {describeCapability(t, stage.capability)}
                                                                            </p>
                                                                            <p className="mt-1 text-[11px] text-white/55">
                                                                                {localizeJarvisSummary(t, stage.summary) || describeCapabilityHint(t, stage.capability)}
                                                                            </p>
                                                                        </div>
                                                                        <span
                                                                            className={`rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest ${statusClass}`}
                                                                        >
                                                                            {describeJarvisStatus(t, stage.status)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        <p className="text-xs text-white/45">{t("assistant.noStages")}</p>
                                                    )}
                                                </div>
                                                <div className="mt-3 space-y-1">
                                                    <p className="text-[10px] font-mono tracking-widest text-white/40">{t("assistant.latestUpdates")}</p>
                                                    {latestSessionSummaries.length > 0 ? (
                                                        latestSessionSummaries.map((summary, index) => (
                                                            <p key={`${summary}-${index}`} className="text-[10px] font-mono text-white/55">
                                                                {summary}
                                                            </p>
                                                        ))
                                                    ) : activeHudSession ? (
                                                        <p className="text-[10px] font-mono text-white/55">{t("assistant.event.updated")}</p>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="rounded border border-white/10 bg-black/30 p-3">
                                                <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("assistant.evidence")}</p>
                                                {jarvisSessionDetail?.dossier ? (
                                                    <>
                                                        <p className="mt-2 text-sm text-white/90">{jarvisSessionDetail.dossier.title}</p>
                                                        <p className="mt-1 text-[10px] font-mono text-white/55">
                                                            {t("assistant.evidenceSummary", {
                                                                sources: Number(jarvisSessionDetail.briefing?.sourceCount ?? 0),
                                                                conflicts: Number(jarvisSessionDetail.dossier.conflictsJson?.count ?? 0),
                                                            })}
                                                        </p>
                                                    </>
                                                ) : jarvisSessionDetail?.briefing ? (
                                                    <p className="mt-2 text-sm text-white/80">{jarvisSessionDetail.briefing.summary}</p>
                                                ) : jarvisSessionDetail?.session.primaryTarget === "dossier" ? (
                                                    <p className="mt-2 text-xs text-white/45">{t("assistant.researchRunning")}</p>
                                                ) : jarvisSessionDetail?.session.primaryTarget === "council" ? (
                                                    <p className="mt-2 text-xs text-white/45">{t("assistant.councilEvidence")}</p>
                                                ) : (
                                                    <p className="mt-2 text-xs text-white/45">{t("assistant.noDossier")}</p>
                                                )}
                                            </div>
                                            <div className="rounded border border-white/10 bg-black/30 p-3">
                                                <p className="text-[10px] font-mono tracking-widest text-cyan-300">{t("assistant.actionNeeded")}</p>
                                                {(jarvisSessionDetail?.actions ?? []).filter((item) => item.status === "pending").length > 0 ? (
                                                    <div className="mt-2 space-y-1">
                                                        {jarvisSessionDetail?.actions
                                                            .filter((item) => item.status === "pending")
                                                            .map((action) => (
                                                                <p key={action.id} className="text-xs text-amber-200">
                                                                    {action.title} - {action.summary}
                                                                </p>
                                                            ))}
                                                    </div>
                                                ) : jarvisSessionDetail?.next_action?.kind === "open_action_center" ? (
                                                    <div className="mt-2 space-y-2">
                                                        <p className="text-xs text-white/55">{sessionNextActionLabel}</p>
                                                        {sessionExecutionOptionDescriptor ? (
                                                            <div className={`rounded border p-2 ${sessionExecutionOptionDescriptor.toneClassName}`}>
                                                                <p className="text-[10px] font-mono tracking-widest text-white/60">
                                                                    {t("assistant.executionOption")}
                                                                </p>
                                                                <p className="mt-1 text-sm">{sessionExecutionOptionDescriptor.label}</p>
                                                                <p className="mt-1 text-[11px] text-white/75">{sessionExecutionOptionDescriptor.hint}</p>
                                                            </div>
                                                        ) : null}
                                                        <div className="flex flex-wrap gap-2">
                                                            <Link
                                                                href="/?widget=action_center&focus=action_center"
                                                                className="rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-amber-200 hover:bg-amber-500/20"
                                                            >
                                                                {sessionNextActionButtonLabel ?? t("assistant.openActionCenter")}
                                                            </Link>
                                                        </div>
                                                    </div>
                                                ) : jarvisSessionDetail?.dossier ? (
                                                    <div className="mt-2 space-y-2">
                                                        <p className="text-xs text-white/55">
                                                            {sessionNextActionLabel ?? t("assistant.researchReady")}
                                                        </p>
                                                        <div className="flex flex-wrap gap-2">
                                                            <Link
                                                                href={buildDossierSplitHref(jarvisSessionDetail.dossier.id)}
                                                                className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20"
                                                            >
                                                                {sessionPrimaryArtifactActionLabel}
                                                            </Link>
                                                            {sessionShouldOfferMonitorAction ? (
                                                                <Link
                                                                    href={buildWatcherPrefillHref(
                                                                        jarvisSessionDetail.dossier.title,
                                                                        jarvisSessionDetail.session.prompt,
                                                                        inferWatcherKindFromPrompt(jarvisSessionDetail.session.prompt)
                                                                    )}
                                                                    className="rounded border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-white/70 hover:border-white/30 hover:text-white"
                                                                >
                                                                    {sessionMonitorActionLabel}
                                                                </Link>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                ) : jarvisSessionDetail?.next_action?.kind === "open_workbench" ? (
                                                    <div className="mt-2 space-y-2">
                                                        <p className="text-xs text-white/55">{sessionNextActionLabel}</p>
                                                        {sessionExecutionOptionDescriptor ? (
                                                            <div className={`rounded border p-2 ${sessionExecutionOptionDescriptor.toneClassName}`}>
                                                                <p className="text-[10px] font-mono tracking-widest text-white/60">
                                                                    {t("assistant.executionOption")}
                                                                </p>
                                                                <p className="mt-1 text-sm">{sessionExecutionOptionDescriptor.label}</p>
                                                                <p className="mt-1 text-[11px] text-white/75">{sessionExecutionOptionDescriptor.hint}</p>
                                                            </div>
                                                        ) : null}
                                                        <div className="flex flex-wrap gap-2">
                                                            <Link
                                                                href="/?widget=workbench&focus=workbench"
                                                                className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20"
                                                            >
                                                                {sessionNextActionButtonLabel ?? t("assistant.openWorkbench")}
                                                            </Link>
                                                        </div>
                                                    </div>
                                                ) : jarvisSessionDetail?.session.primaryTarget === "council" ? (
                                                    <div className="mt-2 space-y-2">
                                                        <p className="text-xs text-white/55">
                                                            {t("assistant.councilReady")}
                                                        </p>
                                                        <div className="flex flex-wrap gap-2">
                                                            <Link
                                                                href="/?widget=council&focus=council"
                                                                className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20"
                                                            >
                                                                {t("assistant.openCouncil")}
                                                            </Link>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <p className="mt-2 text-xs text-white/45">{t("assistant.noActionNeeded")}</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {stageTimelineEnabled && userStageTimeline && (
                                <div className="px-4 pb-3">
                                        <div className="rounded border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                                            <div className="flex items-center justify-between gap-3 text-[10px] font-mono tracking-widest">
                                            <span className="text-cyan-300">{t("assistant.executionStages").toUpperCase()}</span>
                                            <div className="flex items-center gap-2 min-w-0">
                                                {userStageProgress?.isRunning && (
                                                    <span className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 text-[9px] text-cyan-200 shrink-0">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" />
                                                        LIVE
                                                    </span>
                                                )}
                                                <span className="text-white/45 truncate">
                                                    {formatAutoPrompt(userStageTimeline.context.prompt)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                            {userStageTimeline.rows.map((item) => {
                                                const isRunning = item.status === "running";
                                                const isFailed = item.status === "failed";
                                                const chipClass = isFailed
                                                    ? "border-rose-500/40 bg-rose-500/15 text-rose-200"
                                                    : isRunning
                                                        ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-200 animate-pulse"
                                                        : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
                                                return (
                                                    <span
                                                        key={`${item.contextId}:${item.stage}:${item.stageSeq}`}
                                                        className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-mono ${chipClass}`}
                                                    >
                                                        <span>{STAGE_LABELS[item.stage]}</span>
                                                        <span className="text-[9px] opacity-80">#{item.stageSeq}</span>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                        {userStageProgress && (
                                            <div className="mt-2">
                                                <div className="flex items-center justify-between text-[9px] font-mono tracking-widest text-white/50">
                                                    <span className="inline-flex items-center gap-1">
                                                        {userStageProgress.isRunning && (
                                                            <Loader2 size={11} className="animate-spin text-cyan-200" />
                                                        )}
                                                        {userStageProgress.currentStageLabel}
                                                        {userStageProgress.hasFailed && ` · ${t("common.failed").toUpperCase()}`}
                                                    </span>
                                                    <span>
                                                        {userStageProgress.progressPercent}%{userStageProgress.elapsedLabel ? ` · ${userStageProgress.elapsedLabel}` : ""}
                                                    </span>
                                                </div>
                                                <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full bg-gradient-to-r from-cyan-400/85 via-cyan-300/75 to-emerald-300/80 transition-[width] duration-500 ${
                                                            userStageProgress.isRunning ? "animate-pulse" : ""
                                                        }`}
                                                        style={{ width: `${userStageProgress.progressPercent}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {userStageTimeline.rows.some((item) => item.reasonCode) && (
                                            <p className="mt-2 text-[10px] font-mono text-rose-200/80 break-all">
                                                reason:{" "}
                                                {userStageTimeline.rows
                                                    .map((item) => item.reasonCode)
                                                    .filter((item): item is string => Boolean(item))
                                                    .join(", ")}
                                            </p>
                                        )}
                                        {userReasoningSummary && (
                                            <div className="mt-2 rounded border border-white/10 bg-black/30 px-3 py-2">
                                                <div className="flex items-center justify-between gap-2 text-[10px] font-mono tracking-widest">
                                                    <span className="inline-flex items-center gap-1 text-cyan-300">
                                                        {userStageProgress?.isRunning && (
                                                            <Loader2 size={11} className="animate-spin text-cyan-200" />
                                                        )}
                                                        REASONING SUMMARY
                                                    </span>
                                                    <span
                                                        className={`rounded border px-1.5 py-0.5 text-[9px] ${
                                                            userReasoningSummary.qualityResult === "hard_fail"
                                                                ? "border-rose-500/40 bg-rose-500/15 text-rose-200"
                                                                : userReasoningSummary.qualityResult === "soft_warn"
                                                                    ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                                                                    : userReasoningSummary.qualityResult === "pass"
                                                                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                                                        : "border-cyan-500/40 bg-cyan-500/15 text-cyan-200"
                                                        }`}
                                                    >
                                                        {userReasoningSummary.qualityResult === "hard_fail"
                                                            ? "HARD FAIL"
                                                            : userReasoningSummary.qualityResult === "soft_warn"
                                                                ? "SOFT WARN"
                                                                : userReasoningSummary.qualityResult === "pass"
                                                                    ? "PASS"
                                                                    : "RUNNING"}
                                                    </span>
                                                </div>
                                                <p className="mt-1 text-[11px] text-white/85">
                                                    {userReasoningSummary.headline}
                                                </p>
                                                <ul className="mt-1 space-y-0.5 text-[11px] text-white/70">
                                                    {userReasoningSummary.lines.map((line, index) => (
                                                        <li key={`${userStageTimeline.context.id}_reasoning_${index}`}>
                                                            - {line}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
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
                                    hardFailRawOutputToggleEnabled={hardFailRawOutputToggleEnabled}
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
                                hardFailRawOutputToggleEnabled={hardFailRawOutputToggleEnabled}
                            />
                        )}
                    </div>

                    <div className="p-4 bg-black/60 border-t border-white/5 shrink-0">
                        <div className="relative">
                            <textarea
                                className="w-full bg-white/5 border border-white/10 rounded-lg pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-cyan-500/50 resize-none h-14"
                                placeholder={t("assistant.inputPlaceholder")}
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
                                aria-label={t("assistant.sendMessage")}
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
                                                {activeRun.servedCredential && (
                                                    <p className="text-cyan-300 mt-1">
                                                        credential: {activeRun.servedCredential}
                                                    </p>
                                                )}
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
    hardFailRawOutputToggleEnabled = true,
    onRetry,
    feedback,
}: {
    content: string;
    status?: string;
    route?: MessageRoute;
    grounding?: ChatMessage["grounding"];
    renderMode?: AssistantRenderMode;
    softWarnUiEnabled?: boolean;
    hardFailRawOutputToggleEnabled?: boolean;
    onRetry?: () => void;
    feedback?: SystemMessageFeedback;
}) {
    const { t } = useLocale();
    const [showBlockedRawOutput, setShowBlockedRawOutput] = useState(false);
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
        : [t("assistant.quality.blockedFallback")];
    const softWarnReasonLabels = softWarnReasonCodes.length > 0
        ? softWarnReasonCodes.map((code) => mapBlockedReasonLabel(code))
        : [t("assistant.quality.softWarnFallback")];
    const softWarnDisplayLabels = hasOnlySoftWarnReasons(softWarnReasonCodes)
        ? softWarnReasonLabels
        : [...softWarnReasonLabels, t("assistant.quality.restrictedMode")];
    const groundingSummary = buildGroundingSummary(grounding);
    const routeLabel =
        showDiagnostics && (route === "manual" ? t("assistant.route.manual") : route === "auto_context" ? t("assistant.route.autoContext") : null);
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
                                {hardFailRawOutputToggleEnabled && (
                                    <button
                                        type="button"
                                        className="rounded border border-amber-500/40 bg-black/50 px-2.5 py-1 text-[10px] font-mono tracking-widest text-amber-200 hover:bg-amber-500/10"
                                        onClick={() => {
                                            setShowBlockedRawOutput((prev) => !prev);
                                        }}
                                    >
                                        {showBlockedRawOutput ? t("assistant.hideRawOutput") : t("assistant.showRawOutput")}
                                    </button>
                                )}
                                <Link
                                    href="/?widget=model_control&replace=1&focus=model_control"
                                    className="rounded border border-white/20 bg-black/40 px-2.5 py-1 text-[10px] font-mono tracking-widest text-white/70 hover:text-white"
                                >
                                    MODEL CONTROL
                                </Link>
                            </div>
                            {showBlockedRawOutput && (
                                <pre className="mt-3 whitespace-pre-wrap break-words rounded border border-white/10 bg-black/40 px-3 py-2 text-[12px] leading-relaxed text-white/70">
                                    {content}
                                </pre>
                            )}
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
                        <MarkdownLite
                            content={content}
                            className="text-[15px] leading-relaxed text-white/80 space-y-3"
                        />
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
