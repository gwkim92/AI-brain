"use client";

import { useState, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHUD } from "@/components/providers/HUDProvider";
import { canAccessWidget, useCurrentRole } from "@/lib/auth/role";
import { ApiRequestError } from "@/lib/api/client";
import { createAssistantContext, createTask, generateMissionPlan, runAssistantContextWithMeta } from "@/lib/api/endpoints";
import { buildMissionIntake, dispatchMissionIntake, dispatchMissionIntakeTaskLink } from "@/lib/hud/mission-intake";
import { classifyPromptComplexity } from "@/lib/hud/complexity";
import { resolveWorkspaceForIntent } from "@/lib/hud/intent-router";
import { getHudWorkspacePrimaryWidget } from "@/lib/hud/widget-presets";
import { emitRuntimeEvent } from "@/lib/runtime-events";
import { isFeatureEnabled } from "@/lib/feature-flags";

const DUPLICATE_WINDOW_MS = 800;

function hashPrompt(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function createRequestNonce(prefix = "qc"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useQuickCommand() {
  const { openWidgets, startSession, linkSessionTask } = useHUD();
  const role = useCurrentRole();
  const router = useRouter();
  const pathname = usePathname();
  const [commandInput, setCommandInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const recentPromptRef = useRef<{ hash: string; atMs: number } | null>(null);

  const execute = useCallback(async (input?: string) => {
    const trimmed = (input ?? commandInput).trim();
    if (!trimmed) return;
    const singleFlightEnabled = isFeatureEnabled("hud.single_flight_quick_command", true);
    const nowMs = Date.now();
    const promptHash = hashPrompt(trimmed);
    const recent = recentPromptRef.current;

    if ((singleFlightEnabled && inFlightRef.current) || isSubmitting) {
      emitRuntimeEvent("quick_command_ignored_duplicate", {
        reason: "in_flight",
        promptHash,
        singleFlightEnabled,
      });
      return;
    }
    if (
      singleFlightEnabled &&
      recent &&
      recent.hash === promptHash &&
      nowMs - recent.atMs < DUPLICATE_WINDOW_MS
    ) {
      emitRuntimeEvent("quick_command_ignored_duplicate", {
        reason: "duplicate_window",
        promptHash,
        ageMs: nowMs - recent.atMs,
        singleFlightEnabled,
      });
      return;
    }
    if (singleFlightEnabled) {
      recentPromptRef.current = { hash: promptHash, atMs: nowMs };
      inFlightRef.current = true;
    }

    setIsSubmitting(true);
    setError(null);
    const requestNonce = createRequestNonce();
    const intake = buildMissionIntake(trimmed, "inbox_quick_command", {
      requestNonce,
    });
    const complexity = classifyPromptComplexity(trimmed);
    emitRuntimeEvent("quick_command_started", {
      intakeId: intake.id,
      sessionId: intake.id,
      requestNonce,
      complexity,
      promptHash,
      prompt: trimmed,
      taskMode: intake.taskMode,
      singleFlightEnabled,
    });

    const workspacePreset = complexity !== "simple"
      ? ("mission" as const)
      : resolveWorkspaceForIntent(intake.intent);

    const primaryWidget = getHudWorkspacePrimaryWidget(workspacePreset);
    let activeWidgetsForSession: string[] = [];
    let mountedWidgetsForSession: string[] = [];
    let focusWidgetForSession: string | null = null;

    const shouldShowApprovals = intake.widgetPlan.includes("approvals");
    const desiredWidgetIds = complexity !== "simple"
      ? ["assistant", "tasks", ...(canAccessWidget(role, primaryWidget) ? [primaryWidget] : []), ...(shouldShowApprovals ? ["approvals"] : [])]
      : Array.from(
          new Set([
            "assistant",
            "tasks",
            primaryWidget,
            ...(shouldShowApprovals ? ["approvals"] : []),
          ])
        );

    const allowed = desiredWidgetIds.filter((widgetId) => canAccessWidget(role, widgetId));
    mountedWidgetsForSession = allowed;

    if (allowed.length > 0) {
      const focus = allowed.includes("assistant")
        ? "assistant"
        : allowed.includes(primaryWidget)
          ? primaryWidget
          : allowed[0]!;
      focusWidgetForSession = focus;
      activeWidgetsForSession = [...allowed];

      if (pathname !== "/") {
        router.push("/");
      }

      openWidgets(allowed, {
        focus,
        replace: true,
        activate: "all",
        workspacePreset,
      });
    }

    const sessionId = startSession(trimmed, {
      sessionId: intake.id,
      intent: intake.intent,
      activeWidgets: activeWidgetsForSession,
      mountedWidgets: mountedWidgetsForSession,
      focusedWidget: focusWidgetForSession,
      workspacePreset,
      restoreMode: "full",
    });

    try {
      let linkedTaskId: string | null = null;
      let linkedMissionId: string | null = null;
      let linkedContextId: string | null = null;
      if (complexity !== "simple") {
        const result = await generateMissionPlan({
          prompt: trimmed,
          auto_create: true,
          complexity_hint: complexity,
        });

        setTimeout(() => {
          dispatchMissionIntake(intake);
        }, 0);

        if (result.mission) {
          linkSessionTask(sessionId, undefined, result.mission.id);
          linkedMissionId = result.mission.id;
        }
      } else {
        const task = await createTask({
          mode: intake.taskMode,
          title: trimmed.slice(0, 180),
          input: {
            prompt: trimmed,
            source: "inbox_quick_command",
            intent: intake.intent,
            widget_plan: intake.widgetPlan,
            mission_intake_id: intake.id,
          },
        }, {
          idempotencyKey: `quick-command:${intake.id}`,
        });
        dispatchMissionIntakeTaskLink({
          id: intake.id,
          taskId: task.id,
        });
        linkSessionTask(sessionId, task.id);
        linkedTaskId = task.id;

        try {
          const context = await createAssistantContext({
            client_context_id: intake.id,
            source: "inbox_quick_command",
            intent: intake.intent,
            prompt: trimmed,
            widget_plan: intake.widgetPlan,
            task_id: task.id,
          });
          const runResult = await runAssistantContextWithMeta(context.id, {
            task_type: intake.taskMode,
            client_run_nonce: requestNonce,
          });
          emitRuntimeEvent("assistant_stage_updated", {
            contextId: context.id,
            stage: runResult.meta.stage?.current ?? "accepted",
            stageSeq: runResult.meta.stage?.seq ?? null,
            accepted: runResult.meta.run?.accepted ?? runResult.meta.accepted ?? true,
            replayed: runResult.meta.run?.replayed ?? false,
            nonce: runResult.meta.run?.nonce ?? requestNonce,
          });
          linkedContextId = context.id;

          setTimeout(() => {
            dispatchMissionIntake({
              ...intake,
              prestarted: true,
              prestartedContextId: context.id,
            });
          }, 0);
        } catch {
          // Fallback: keep legacy client-side intake orchestration when prestart fails.
          setTimeout(() => {
            dispatchMissionIntake(intake);
          }, 0);
        }
      }

      setCommandInput("");
      emitRuntimeEvent("quick_command_completed", {
        intakeId: intake.id,
        requestNonce,
        prompt: trimmed,
        sessionId,
        taskId: linkedTaskId,
        missionId: linkedMissionId,
        contextId: linkedContextId,
        taskMode: intake.taskMode,
        singleFlightEnabled,
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
        emitRuntimeEvent("quick_command_failed", {
          intakeId: intake.id,
          requestNonce,
          prompt: trimmed,
          code: err.code,
          message: err.message,
          taskMode: intake.taskMode,
          singleFlightEnabled,
        });
      } else {
        setError("failed to create task");
        emitRuntimeEvent("quick_command_failed", {
          intakeId: intake.id,
          requestNonce,
          prompt: trimmed,
          code: "unknown",
          message: "failed to create task",
          taskMode: intake.taskMode,
          singleFlightEnabled,
        });
      }
    } finally {
      setIsSubmitting(false);
      if (singleFlightEnabled) {
        inFlightRef.current = false;
      }
    }
  }, [commandInput, isSubmitting, linkSessionTask, openWidgets, pathname, role, router, startSession]);

  return {
    commandInput,
    setCommandInput,
    isSubmitting,
    error,
    setError,
    execute,
  };
}
