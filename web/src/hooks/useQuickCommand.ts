"use client";

import { useState, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHUD } from "@/components/providers/HUDProvider";
import { canAccessWidget, useCurrentRole } from "@/lib/auth/role";
import { ApiRequestError } from "@/lib/api/client";
import {
  compileV2Command,
  createJarvisRequest,
  getV2TaskViewSchema,
  runAssistantContextWithMeta,
} from "@/lib/api/endpoints";
import { dispatchCouncilIntake } from "@/lib/hud/council-intake";
import { dispatchJarvisDataRefresh } from "@/lib/hud/data-refresh";
import { buildMissionIntake, dispatchMissionIntake, dispatchMissionIntakeTaskLink } from "@/lib/hud/mission-intake";
import { classifyPromptComplexity } from "@/lib/hud/complexity";
import { buildLaunchWidgetPlan, resolveWorkspaceForIntent } from "@/lib/hud/intent-router";
import { measureHudViewport, tileWidgetLayouts } from "@/lib/hud/widget-layout";
import { emitRuntimeEvent } from "@/lib/runtime-events";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { useLocale } from "@/components/providers/LocaleProvider";

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
  const { t } = useLocale();
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
    const v2CommandCompilerEnabled = isFeatureEnabled("v2.command_compiler", false);
    const v2SchemaUiEnabled = isFeatureEnabled("v2.schema_ui", false);
    if (v2CommandCompilerEnabled) {
      try {
        const compiled = await compileV2Command({
          prompt: trimmed,
          session_id: intake.id,
          mode_hint: intake.taskMode,
        });
        emitRuntimeEvent("v2_command_compiled", {
          intakeId: intake.id,
          sessionId: intake.id,
          requestNonce,
          executionContract: compiled.execution_contract,
          routing: compiled.routing,
          clarification: compiled.clarification,
        });
      } catch (compileError) {
        emitRuntimeEvent("quick_command_failed", {
          intakeId: intake.id,
          requestNonce,
          prompt: trimmed,
          code: "v2_compile_failed",
          message: compileError instanceof Error ? compileError.message : "v2 compile failed",
          taskMode: intake.taskMode,
          singleFlightEnabled,
        });
      }
    }
    const complexity = classifyPromptComplexity(trimmed);
    const forceIntentWorkspace = intake.intent === "council";
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

    const workspacePreset = forceIntentWorkspace
      ? resolveWorkspaceForIntent(intake.intent)
      : complexity !== "simple"
      ? ("mission" as const)
      : resolveWorkspaceForIntent(intake.intent);

    let activeWidgetsForSession: string[] = [];
    let mountedWidgetsForSession: string[] = [];
    let focusWidgetForSession: string | null = null;

    const desiredWidgetIds = buildLaunchWidgetPlan(intake.intent, complexity, trimmed);

    const allowed = desiredWidgetIds.filter((widgetId) => canAccessWidget(role, widgetId));
    mountedWidgetsForSession = allowed;

    if (allowed.length > 0) {
      const focus = allowed.includes("assistant")
        ? "assistant"
        : allowed[0]!;
      focusWidgetForSession = focus;
      activeWidgetsForSession = [...allowed];

      if (allowed.length > 1) {
        const viewport = measureHudViewport();
        tileWidgetLayouts(allowed, viewport.width, viewport.height, 24);
      }

      if (pathname !== "/studio") {
        router.push("/studio");
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
    dispatchJarvisDataRefresh({ scope: "sessions", source: "quick-command:start-session" });

    try {
      let linkedTaskId: string | null = null;
      let linkedMissionId: string | null = null;
      let linkedContextId: string | null = null;
      const result = await createJarvisRequest({
        prompt: trimmed,
        source: "inbox_quick_command",
        client_session_id: intake.id,
      });
      dispatchJarvisDataRefresh({ scope: "sessions", source: "quick-command:jarvis-request" });

      if (result.delegation.task_id) {
        dispatchMissionIntakeTaskLink({
          id: intake.id,
          taskId: result.delegation.task_id,
        });
        linkedTaskId = result.delegation.task_id;
        dispatchJarvisDataRefresh({ scope: "tasks", source: "quick-command:task-linked" });
      }
      if (result.delegation.mission_id) {
        linkedMissionId = result.delegation.mission_id;
      }
      if (result.delegation.assistant_context_id) {
        linkedContextId = result.delegation.assistant_context_id;
      }

      if (linkedTaskId || linkedMissionId) {
        linkSessionTask(sessionId, linkedTaskId ?? undefined, linkedMissionId ?? undefined);
      }

      if (v2SchemaUiEnabled && linkedTaskId) {
        try {
          const schema = await getV2TaskViewSchema(linkedTaskId);
          emitRuntimeEvent("v2_task_view_schema_updated", {
            intakeId: intake.id,
            taskId: linkedTaskId,
            schema: schema.task_view_schema,
            policy: schema.policy,
          });
        } catch {
          // Keep the jarvis workflow intact when the schema API is unavailable.
        }
      }

      if (result.delegation.primary_target === "assistant" && result.delegation.assistant_context_id) {
        try {
          const runResult = await runAssistantContextWithMeta(result.delegation.assistant_context_id, {
            task_type: intake.taskMode,
            client_run_nonce: requestNonce,
          });
          emitRuntimeEvent("assistant_stage_updated", {
            contextId: result.delegation.assistant_context_id,
            stage: runResult.meta.stage?.current ?? "accepted",
            stageSeq: runResult.meta.stage?.seq ?? null,
            accepted: runResult.meta.run?.accepted ?? runResult.meta.accepted ?? true,
            replayed: runResult.meta.run?.replayed ?? false,
            nonce: runResult.meta.run?.nonce ?? requestNonce,
          });
          setTimeout(() => {
            dispatchMissionIntake({
              ...intake,
              prestarted: true,
              prestartedContextId: result.delegation.assistant_context_id,
            });
          }, 0);
        } catch {
          setTimeout(() => {
            dispatchMissionIntake(intake);
          }, 0);
        }
      } else if (result.delegation.primary_target === "mission" && linkedMissionId) {
        setTimeout(() => {
          dispatchMissionIntake(intake);
        }, 0);
      } else if (result.delegation.primary_target === "council" && result.delegation.council_run_id) {
        setTimeout(() => {
          dispatchCouncilIntake({
            id: intake.id,
            prompt: trimmed,
            runId: result.delegation.council_run_id!,
            taskId: linkedTaskId ?? undefined,
            createdAt: new Date().toISOString(),
          });
        }, 0);
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
        setError(t("commandBar.error.createTask"));
        emitRuntimeEvent("quick_command_failed", {
          intakeId: intake.id,
          requestNonce,
          prompt: trimmed,
          code: "unknown",
          message: t("commandBar.error.createTask"),
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
  }, [commandInput, isSubmitting, linkSessionTask, openWidgets, pathname, role, router, startSession, t]);

  return {
    commandInput,
    setCommandInput,
    isSubmitting,
    error,
    setError,
    execute,
  };
}
