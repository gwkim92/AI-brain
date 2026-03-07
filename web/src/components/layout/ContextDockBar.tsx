"use client";

import React from "react";
import { X, Focus, Eye, EyeOff, LayoutGrid, XCircle, RotateCcw } from "lucide-react";

import { useHUD } from "@/components/providers/HUDProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { clearAllWidgetLayouts, tileWidgetLayouts } from "@/lib/hud/widget-layout";
import type { MissionStepStatus } from "@/lib/api/types";
import type { TranslationKey } from "@/lib/locale";

type MissionStepDockItem = {
  id: string;
  order: number;
  type: string;
  title: string;
  status: MissionStepStatus;
};

type ContextDockBarProps = {
  mountedWidgets: string[];
  activeWidgets: string[];
  focusedWidget: string | null;
  recommendedWidget: string | null;
  recommendedReason: string | null;
  missionTitle: string | null;
  missionStepLabel: string | null;
  missionStepStatus: MissionStepStatus | null;
  missionSteps: MissionStepDockItem[];
  activeMissionStepId: string | null;
  missionAutoFocusEnabled: boolean;
  missionAutoFocusHoldRemainingSec: number;
  onMissionAutoFocusChange: (enabled: boolean) => void;
  onUserFocusWidget: (widgetId: string) => void;
};

const WIDGET_LABEL_KEYS: Record<string, TranslationKey> = {
  inbox: "widget.title.inbox",
  assistant: "widget.title.assistant",
  tasks: "widget.title.tasks",
  council: "widget.title.council",
  workbench: "widget.title.workbench",
  reports: "widget.title.reports",
  approvals: "widget.title.approvals",
  memory: "widget.title.memory",
  settings: "widget.title.settings",
  model_control: "widget.title.model_control",
  ideation: "widget.title.ideation",
};

function widgetLabel(id: string, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const key = WIDGET_LABEL_KEYS[id];
  return key ? t(key) : id;
}

function missionStatusLabel(
  status: MissionStepStatus | null,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
): string | null {
  if (!status) {
    return null;
  }
  if (status === "done") return t("taskStatus.done").toUpperCase();
  if (status === "running") return t("taskStatus.running").toUpperCase();
  if (status === "blocked") return t("taskStatus.blocked").toUpperCase();
  if (status === "failed") return t("taskStatus.failed").toUpperCase();
  return t("taskStatus.queued").toUpperCase();
}

function missionStatusClass(status: MissionStepStatus | null): string {
  if (status === "done") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
  if (status === "running") return "border-cyan-500/40 bg-cyan-500/15 text-cyan-200";
  if (status === "blocked") return "border-amber-500/40 bg-amber-500/15 text-amber-200";
  if (status === "failed") return "border-rose-500/40 bg-rose-500/15 text-rose-200";
  return "border-white/20 bg-white/5 text-white/70";
}

export function ContextDockBar({
  mountedWidgets,
  activeWidgets,
  focusedWidget,
  recommendedWidget,
  recommendedReason,
  missionTitle,
  missionStepLabel,
  missionStepStatus,
  missionSteps,
  activeMissionStepId,
  missionAutoFocusEnabled,
  missionAutoFocusHoldRemainingSec,
  onMissionAutoFocusChange,
  onUserFocusWidget,
}: ContextDockBarProps) {
  const { t } = useLocale();
  const { openWidget, focusWidget, closeWidget, dropWidget, closeAll } = useHUD();

  if (mountedWidgets.length === 0) {
    return null;
  }

  const focusSingleWidget = (widgetId: string) => {
    onUserFocusWidget(widgetId);
    if (activeWidgets.includes(widgetId)) {
      focusWidget(widgetId);
    } else {
      openWidget(widgetId);
    }
  };

  const showRecommendation = typeof recommendedWidget === "string" && recommendedWidget.length > 0;
  const statusLabel = missionStatusLabel(missionStepStatus, t);

  return (
    <div
      role="region"
      aria-label={t("contextDock.ariaLabel")}
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[70] pointer-events-auto"
      data-testid="context-dock"
    >
      <div className="rounded-xl border border-cyan-500/30 bg-black/65 backdrop-blur-xl px-3 py-2 shadow-[0_0_30px_rgba(0,255,255,0.12)]">
        {(missionTitle || missionStepLabel) && (
          <div className="mb-2 text-[10px] font-mono tracking-widest text-white/60 flex flex-wrap items-center gap-2">
            {missionTitle && <span className="text-cyan-300">{t("contextDock.mission", { value: missionTitle })}</span>}
            {missionStepLabel && <span>{t("contextDock.step", { value: missionStepLabel })}</span>}
            {statusLabel && (
              <span
                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] ${missionStatusClass(missionStepStatus)}`}
                data-testid="dock-step-status"
              >
                {statusLabel}
              </span>
            )}
            <button
              type="button"
              data-testid="dock-auto-focus-toggle"
              onClick={() => onMissionAutoFocusChange(!missionAutoFocusEnabled)}
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] transition-colors ${
                missionAutoFocusEnabled
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                  : "border-white/20 bg-white/5 text-white/70"
              }`}
              aria-label="Mission Auto Focus Toggle"
            >
              {t("contextDock.autoFocus", {
                value: missionAutoFocusEnabled ? t("common.on") : t("common.off"),
              })}
            </button>
            {missionAutoFocusHoldRemainingSec > 0 && (
              <span
                className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-200"
                data-testid="dock-auto-focus-hold"
              >
                {t("contextDock.manualHold", { value: missionAutoFocusHoldRemainingSec })}
              </span>
            )}
          </div>
        )}

        {missionSteps.length > 0 && (
          <div
            className="mb-2 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1 max-w-[78vw]"
            data-testid="dock-step-timeline"
          >
            {missionSteps.map((step) => {
              const isActiveStep = activeMissionStepId === step.id;
              return (
                <span
                  key={step.id}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-mono tracking-wide ${
                    missionStatusClass(step.status)
                  } ${isActiveStep ? "ring-1 ring-cyan-300/60" : ""}`}
                  title={`${step.order}. ${step.title}`}
                  data-testid={`dock-step-${step.order}`}
                >
                  <span className="text-white/70">#{step.order}</span>
                  <span className="uppercase">{step.type}</span>
                  <span>{missionStatusLabel(step.status, t)}</span>
                </span>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {mountedWidgets.map((widgetId) => {
            const isFocused = focusedWidget === widgetId;
            const isActive = activeWidgets.includes(widgetId);
            const isHidden = !isActive;
            const isRecommended = showRecommendation && recommendedWidget === widgetId;

            return (
              <button
                key={widgetId}
                type="button"
                data-testid={`dock-widget-${widgetId}`}
                onClick={() => focusSingleWidget(widgetId)}
                aria-label={`Dock ${widgetLabel(widgetId, t)}`}
                className={`group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-mono tracking-widest transition-all ${
                  isFocused
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                    : isActive
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                      : "border-white/10 border-dashed bg-black/30 text-white/40 hover:text-white/70 hover:border-white/25"
                }`}
                title={
                  isFocused
                    ? t("contextDock.state.focused")
                    : isActive
                      ? t("contextDock.state.visible")
                      : t("contextDock.state.hidden")
                }
              >
                {isHidden && <EyeOff size={9} className="text-white/30" />}
                <span>{widgetLabel(widgetId, t)}</span>
                {isFocused && <Focus size={10} />}
                {isActive && !isFocused && (
                  <Eye size={9} className="text-emerald-300/60" />
                )}
                {!isFocused && widgetId !== "inbox" && (
                  <span
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (isHidden) {
                        dropWidget(widgetId);
                      } else {
                        closeWidget(widgetId);
                      }
                    }}
                    className="inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-white/50 hover:text-white"
                  >
                    <X size={10} />
                  </span>
                )}
                {isRecommended && <span className="text-[9px] text-amber-300">{t("contextDock.rec")}</span>}
              </button>
            );
          })}

          {showRecommendation && recommendedWidget && focusedWidget !== recommendedWidget && (
            <button
              type="button"
              data-testid="dock-recommended-widget"
              onClick={() => focusSingleWidget(recommendedWidget)}
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[10px] font-mono tracking-widest text-amber-200"
              title={recommendedReason ?? t("contextDock.recommendedReasonFallback")}
              aria-label={t("contextDock.recommendedTitle", { value: widgetLabel(recommendedWidget, t) })}
            >
              <Focus size={10} />
              {t("common.recommended").toUpperCase()} {widgetLabel(recommendedWidget, t)}
            </button>
          )}

          {activeWidgets.length > 0 && (
            <div className="flex items-center gap-1 ml-1 pl-2 border-l border-white/10">
              <button
                type="button"
                onClick={() => {
                  tileWidgetLayouts(
                    activeWidgets,
                    window.innerWidth - 72,
                    window.innerHeight,
                  );
                  window.location.reload();
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-1.5 py-1 text-[9px] font-mono tracking-widest text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
                title="Tile all visible widgets in a grid"
                aria-label="Tile widgets"
              >
                <LayoutGrid size={9} />
                TILE
              </button>
              <button
                type="button"
                onClick={() => closeAll()}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-1.5 py-1 text-[9px] font-mono tracking-widest text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
                title="Close all visible widgets"
                aria-label="Close all widgets"
              >
                <XCircle size={9} />
                CLEAR
              </button>
              <button
                type="button"
                onClick={() => {
                  clearAllWidgetLayouts();
                  window.location.reload();
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-1.5 py-1 text-[9px] font-mono tracking-widest text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
                title="Reset all widget positions and sizes to default"
                aria-label="Reset layout"
              >
                <RotateCcw size={9} />
                RESET
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
