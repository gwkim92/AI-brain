import type { AssistantContextEventRecord, AssistantContextRecord } from "@/lib/api/types";

export type AutoMissionContext = {
    id: string;
    prompt: string;
    intent: string;
    widgetPlan: string[];
    status: "running" | "success" | "error";
    output: string;
    servedProvider?: string;
    servedModel?: string;
    usedFallback?: boolean;
    selectionReason?: string;
    taskId?: string;
    serverContextId?: string;
    revision?: number;
    startedAt: string;
    completedAt?: string;
    error?: string;
};

export type AutoMissionEvent = {
    id: string;
    sequence: number;
    eventType: string;
    kind: "accepted" | "started" | "completed" | "failed" | "other";
    data: Record<string, unknown>;
    createdAt: string;
    summary: string;
    attempts: Array<{
        provider: string;
        status: "success" | "failed" | "skipped" | "unknown";
        latencyMs?: number;
        error?: string;
    }>;
};

export function toAutoContextStatus(status: AssistantContextRecord["status"]): AutoMissionContext["status"] {
    if (status === "completed") {
        return "success";
    }
    if (status === "failed") {
        return "error";
    }
    return "running";
}

export function toAutoContextFromServer(record: AssistantContextRecord): AutoMissionContext {
    const mappedStatus = toAutoContextStatus(record.status);
    if (record.output && record.output.trim().length > 0) {
        return {
            id: record.clientContextId,
            prompt: record.prompt,
            intent: record.intent,
            widgetPlan: record.widgetPlan,
            status: mappedStatus,
            output: record.output,
            servedProvider: record.servedProvider ?? undefined,
            servedModel: record.servedModel ?? undefined,
            usedFallback: record.usedFallback,
            selectionReason: record.selectionReason ?? undefined,
            taskId: record.taskId ?? undefined,
            startedAt: record.createdAt,
            completedAt: mappedStatus === "running" ? undefined : record.updatedAt,
            error: record.error ?? undefined,
            serverContextId: record.id,
            revision: record.revision,
        };
    }

    const fallbackOutput =
        mappedStatus === "running"
            ? "Context is running in background."
            : mappedStatus === "success"
                ? "Context finished. Open linked task for execution details."
                : "Context failed. Open linked task for diagnostics.";

    return {
        id: record.clientContextId,
        prompt: record.prompt,
        intent: record.intent,
        widgetPlan: record.widgetPlan,
        status: mappedStatus,
        output: fallbackOutput,
        servedProvider: record.servedProvider ?? undefined,
        servedModel: record.servedModel ?? undefined,
        usedFallback: record.usedFallback,
        selectionReason: record.selectionReason ?? undefined,
        taskId: record.taskId ?? undefined,
        startedAt: record.createdAt,
        completedAt: mappedStatus === "running" ? undefined : record.updatedAt,
        error: record.error ?? undefined,
        serverContextId: record.id,
        revision: record.revision,
    };
}

export function mergeAutoContexts(prev: AutoMissionContext[], restored: AutoMissionContext[]): AutoMissionContext[] {
    const map = new Map(prev.map((item) => [item.id, item]));
    for (const item of restored) {
        const current = map.get(item.id);
        if (!current) {
            map.set(item.id, item);
            continue;
        }

        const currentRevision = current.revision ?? -1;
        const nextRevision = item.revision ?? -1;
        if (nextRevision < currentRevision) {
            continue;
        }

        const next: AutoMissionContext = {
            ...current,
            ...item,
            taskId: item.taskId ?? current.taskId,
            serverContextId: item.serverContextId ?? current.serverContextId,
            widgetPlan: item.widgetPlan.length > 0 ? item.widgetPlan : current.widgetPlan,
            prompt: item.prompt || current.prompt,
            intent: item.intent || current.intent,
        };

        map.set(item.id, next);
    }

    return Array.from(map.values());
}

export function toAutoMissionEventSummary(record: AssistantContextEventRecord): string {
    const data = record.data ?? {};
    if (record.eventType === "assistant.context.run.accepted") {
        const taskType = typeof data.task_type === "string" ? data.task_type : "execute";
        const provider = typeof data.provider === "string" ? data.provider : "auto";
        return `accepted · ${taskType} · ${provider}`;
    }
    if (record.eventType === "assistant.context.run.started") {
        return "started";
    }
    if (record.eventType === "assistant.context.policy.resolved") {
        const policy = typeof data.grounding_policy === "string" ? data.grounding_policy : "static";
        const required = data.grounding_required === true;
        return `policy · ${policy}${required ? " · grounded" : ""}`;
    }
    if (record.eventType === "assistant.context.run.completed") {
        const provider = typeof data.provider === "string" ? data.provider : "unknown";
        const model = typeof data.model === "string" ? data.model : "default";
        const usedFallback = data.used_fallback === true;
        const degraded = data.quality_guard_triggered === true;
        const prefix = degraded ? "completed(degraded)" : "completed";
        return `${prefix} · ${provider}/${model}${usedFallback ? " (fallback)" : ""}`;
    }
    if (record.eventType === "assistant.context.run.failed") {
        const reason = typeof data.reason === "string" ? data.reason : "provider routing failed";
        return `failed · ${reason}`;
    }
    if (record.eventType === "assistant.context.updated") {
        const status = typeof data.status === "string" ? data.status : "updated";
        return `updated · ${status}`;
    }

    return record.eventType;
}

export function toAutoMissionEventKind(eventType: string): AutoMissionEvent["kind"] {
    if (eventType === "assistant.context.run.accepted") {
        return "accepted";
    }
    if (eventType === "assistant.context.run.started") {
        return "started";
    }
    if (eventType === "assistant.context.run.completed") {
        return "completed";
    }
    if (eventType === "assistant.context.run.failed") {
        return "failed";
    }
    return "other";
}

export function toAutoMissionEventAttempts(data: Record<string, unknown>): AutoMissionEvent["attempts"] {
    const raw = data.attempts;
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .map((item) => {
            if (!item || typeof item !== "object") {
                return null;
            }
            const row = item as Record<string, unknown>;
            const provider = typeof row.provider === "string" ? row.provider : "unknown";
            const latencyMs = typeof row.latencyMs === "number" ? row.latencyMs : undefined;
            const error = typeof row.error === "string" ? row.error : undefined;
            let status: AutoMissionEvent["attempts"][number]["status"] = "unknown";
            if (row.status === "success" || row.status === "failed" || row.status === "skipped") {
                status = row.status;
            }
            return {
                provider,
                status,
                latencyMs,
                error,
            };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
}

export function toAutoMissionEvent(record: AssistantContextEventRecord): AutoMissionEvent {
    return {
        id: record.id,
        sequence: record.sequence,
        eventType: record.eventType,
        kind: toAutoMissionEventKind(record.eventType),
        data: record.data ?? {},
        createdAt: record.createdAt,
        summary: toAutoMissionEventSummary(record),
        attempts: toAutoMissionEventAttempts(record.data ?? {}),
    };
}

export function mergeAutoMissionEvents(prev: AutoMissionEvent[], incoming: AutoMissionEvent[], limit = 8): AutoMissionEvent[] {
    const map = new Map<string, AutoMissionEvent>();
    for (const item of prev) {
        map.set(item.id, item);
    }
    for (const item of incoming) {
        map.set(item.id, item);
    }
    return Array.from(map.values())
        .sort((left, right) => left.sequence - right.sequence)
        .slice(-limit);
}
