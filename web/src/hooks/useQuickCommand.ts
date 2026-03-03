"use client";

import { useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHUD } from "@/components/providers/HUDProvider";
import { canAccessWidget, useCurrentRole } from "@/lib/auth/role";
import { ApiRequestError } from "@/lib/api/client";
import { createAssistantContext, createTask, generateMissionPlan, runAssistantContext } from "@/lib/api/endpoints";
import { buildMissionIntake, dispatchMissionIntake, dispatchMissionIntakeTaskLink } from "@/lib/hud/mission-intake";
import { classifyPromptComplexity } from "@/lib/hud/complexity";
import { resolveWorkspaceForIntent } from "@/lib/hud/intent-router";
import { getHudWorkspacePrimaryWidget } from "@/lib/hud/widget-presets";

export function useQuickCommand() {
  const { openWidgets, startSession, linkSessionTask } = useHUD();
  const role = useCurrentRole();
  const router = useRouter();
  const pathname = usePathname();
  const [commandInput, setCommandInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (input?: string) => {
    const trimmed = (input ?? commandInput).trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    const intake = buildMissionIntake(trimmed, "inbox_quick_command");
    const complexity = classifyPromptComplexity(trimmed);

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
      activeWidgetsForSession = [focus];

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
          dispatchMissionIntakeTaskLink({
            id: intake.id,
            taskId: result.mission.id,
          });
          linkSessionTask(sessionId, undefined, result.mission.id);
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

        try {
          const context = await createAssistantContext({
            client_context_id: intake.id,
            source: "inbox_quick_command",
            intent: intake.intent,
            prompt: trimmed,
            widget_plan: intake.widgetPlan,
            task_id: task.id,
          });
          await runAssistantContext(context.id, {
            task_type: intake.taskMode,
          });

          setTimeout(() => {
            dispatchMissionIntake({
              ...intake,
              prestarted: true,
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
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("failed to create task");
      }
    } finally {
      setIsSubmitting(false);
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
