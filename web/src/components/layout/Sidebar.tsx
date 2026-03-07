"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ShieldCheck,
  Brain,
  Settings,
  LogOut,
  Target,
  Code2,
  Search,
  BarChart3,
  Inbox,
  LayoutGrid,
  BellRing,
  SlidersHorizontal,
  Lightbulb,
  Bot,
  RadioTower,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { useHUD } from "@/components/providers/HUDProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { canAccessWidget, useCurrentRole } from "@/lib/auth/role";
import { ApiRequestError } from "@/lib/api/client";
import { authLogout } from "@/lib/api/endpoints";
import { clearAuthSession } from "@/lib/auth/session";
import {
  getHudWorkspacePresetConfig,
  getHudWorkspacePrimaryWidget,
  type HudWorkspacePreset,
} from "@/lib/hud/widget-presets";
import { measureHudViewport, tileWidgetLayouts } from "@/lib/hud/widget-layout";

const SIDEBAR_COMPACT_KEY = "jarvis.sidebar.compact";

type SidebarTooltip = {
  title: string;
  description: string;
  actionHint?: string;
  top: number;
  left: number;
};

type SidebarTooltipRequest = {
  title: string;
  description: string;
  actionHint?: string;
  element: HTMLElement;
};

type NavItemDescriptor = {
  testId?: string;
  compact: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
  actionHint?: string;
  alert?: boolean;
  active?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  secondaryShortcut?: () => void;
  secondaryAction?: {
    icon: React.ReactNode;
    label: string;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  };
  tone?: "default" | "danger";
  disabled?: boolean;
  onTooltipChange?: (tooltip: SidebarTooltipRequest | null) => void;
};

function resolveTooltipPosition(element: HTMLElement): Pick<SidebarTooltip, "top" | "left"> {
  const rect = element.getBoundingClientRect();
  const width = 244;
  const height = 112;
  const left = Math.min(rect.right + 12, window.innerWidth - width - 12);
  const top = Math.min(
    Math.max(12, rect.top + rect.height / 2 - height / 2),
    window.innerHeight - height - 12
  );
  return { top, left };
}

function hintIdForLabel(label: string): string {
  return `sidebar-hint-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function workspaceKeyForPreset(preset: HudWorkspacePreset) {
  if (preset === "mission") return "mission";
  if (preset === "studio_code") return "code";
  if (preset === "studio_research") return "research";
  if (preset === "studio_intelligence") return "intelligence";
  return "council";
}

function SidebarContent() {
  const {
    activeWidgets,
    mountedWidgets,
    focusedWidget,
    toggleWidget,
    openWidgets,
    activeWorkspacePreset,
  } = useHUD();
  const { t } = useLocale();
  const role = useCurrentRole();
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [compact, setCompact] = useState(false);
  const [tooltip, setTooltip] = useState<SidebarTooltip | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const persisted = window.localStorage.getItem(SIDEBAR_COMPACT_KEY);
      if (persisted === "1") {
        setCompact(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COMPACT_KEY, compact ? "1" : "0");
  }, [compact]);

  const openWorkspacePreset = (preset: HudWorkspacePreset, mode: "primary" | "full" = "primary") => {
    const primaryWidget = getHudWorkspacePrimaryWidget(preset);
    if (!canAccessWidget(role, primaryWidget)) {
      return;
    }
    const config = getHudWorkspacePresetConfig(preset);
    const allowedWidgets = config.widgets.filter((widgetId) => canAccessWidget(role, widgetId));
    if (allowedWidgets.length === 0) {
      return;
    }
    const focusWidget = allowedWidgets.includes(config.focus) ? config.focus : allowedWidgets[0]!;
    const widgetPlan = mode === "primary" ? allowedWidgets.slice(0, Math.min(3, allowedWidgets.length)) : allowedWidgets;
    const normalizedFocus = widgetPlan.includes(focusWidget) ? focusWidget : widgetPlan[0]!;
    if (widgetPlan.length > 1) {
      const viewport = measureHudViewport();
      tileWidgetLayouts(widgetPlan, viewport.width, viewport.height, 24);
    }
    openWidgets(widgetPlan, {
      focus: normalizedFocus,
      replace: true,
      activate: "all",
      workspacePreset: preset,
    });
  };

  const handleWorkspaceClick = (preset: HudWorkspacePreset, event: React.MouseEvent<HTMLButtonElement>) => {
    openWorkspacePreset(preset, event.shiftKey ? "full" : "primary");
  };

  const handleWorkspaceOpenFull = (preset: HudWorkspacePreset, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openWorkspacePreset(preset, "full");
  };

  const handleTooltipChange = (
    next: SidebarTooltipRequest | null
  ) => {
    if (!next) {
      setTooltip(null);
      return;
    }
    const { top, left } = resolveTooltipPosition(next.element);
    setTooltip({
      title: next.title,
      description: next.description,
      actionHint: next.actionHint,
      top,
      left,
    });
  };

  const handleLogout = async () => {
    if (loggingOut) {
      return;
    }
    setLoggingOut(true);
    try {
      await authLogout();
    } catch (err) {
      if (!(err instanceof ApiRequestError && (err.code === "CONFLICT" || err.code === "UNAUTHORIZED"))) {
        console.error("logout failed", err);
      }
    } finally {
      clearAuthSession();
      router.replace("/login");
      setLoggingOut(false);
    }
  };

  const currentWorkspaceSummary = useMemo(() => {
    if (activeWorkspacePreset) {
      const workspaceKey = workspaceKeyForPreset(activeWorkspacePreset);
      return {
        title: t(`sidebar.workspace.${workspaceKey}.title`),
        description: t(`sidebar.workspace.${workspaceKey}.description`),
      };
    }

    const primaryWidget = focusedWidget ?? activeWidgets[activeWidgets.length - 1] ?? mountedWidgets[mountedWidgets.length - 1] ?? null;
    if (!primaryWidget) {
      return {
        title: t("sidebar.noActiveWorkspace"),
        description: t("sidebar.noActiveWorkspaceDescription"),
      };
    }

    const labelByWidget: Record<string, string> = {
      inbox: t("sidebar.item.home.title"),
      assistant: t("sidebar.item.jarvis.title"),
      tasks: t("widget.title.tasks"),
      council: t("widget.title.council"),
      workbench: t("widget.title.workbench"),
      reports: t("widget.title.reports"),
      watchers: t("sidebar.item.watchers.title"),
      dossier: t("sidebar.item.dossiers.title"),
      action_center: t("sidebar.item.actionCenter.title"),
      notifications: t("sidebar.item.notifications.title"),
      skills: t("sidebar.item.skills.title"),
      approvals: t("sidebar.item.approvals.title"),
      memory: t("sidebar.item.memory.title"),
      settings: t("sidebar.item.settings.title"),
      model_control: t("sidebar.item.modelControl.title"),
      ideation: t("sidebar.item.ideation.title"),
    };

    return {
      title: t("sidebar.customLayout"),
      description: labelByWidget[primaryWidget] ?? t("sidebar.noActiveWorkspace"),
    };
  }, [activeWidgets, activeWorkspacePreset, focusedWidget, mountedWidgets, t]);

  return (
    <div
      className={`${compact ? "w-16" : "w-64"} h-full border-r border-white/10 bg-black/50 backdrop-blur-xl flex flex-col justify-between shrink-0 relative z-50 transition-[width] duration-200`}
    >
      <div
        className={`h-20 border-b border-white/10 shrink-0 ${compact ? "flex items-center justify-center" : "flex items-center justify-between px-3"}`}
      >
        <div className={`flex items-center ${compact ? "justify-center" : "gap-3 min-w-0"}`}>
          <div className="w-8 h-8 rounded-full border-2 border-cyan-500/50 flex items-center justify-center p-1 relative">
            <div className="absolute inset-0 rounded-full border border-cyan-400 animate-ping opacity-20" />
            <div className="w-full h-full bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(0,255,255,0.8)]" />
          </div>
          {!compact && (
            <div className="min-w-0">
              <p className="text-xs font-mono tracking-widest text-cyan-300 font-bold">JARVIS</p>
              <p className="text-[10px] font-mono text-white/45 truncate">{t("sidebar.currentWorkspace")}</p>
            </div>
          )}
        </div>

        {!compact ? (
          <button
            type="button"
            aria-label="Collapse sidebar"
            onClick={() => setCompact(true)}
            className="h-8 w-8 rounded-md border border-white/15 bg-white/[0.04] text-white/60 hover:text-cyan-200 hover:border-cyan-500/40 transition-colors flex items-center justify-center"
          >
            <ChevronLeft size={14} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Expand sidebar"
            onClick={() => setCompact(false)}
            className="absolute -right-3 top-6 h-6 w-6 rounded-full border border-cyan-500/40 bg-black text-cyan-300 hover:text-cyan-100 transition-colors flex items-center justify-center"
          >
            <ChevronRight size={12} />
          </button>
        )}
      </div>

      <div className={`border-b border-white/10 ${compact ? "px-2 py-2" : "px-3 py-3"}`}>
        {compact ? (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.08] px-2 py-2 text-center">
              <p className="text-[9px] font-mono uppercase tracking-[0.24em] text-cyan-200">{t("sidebar.workspaceHint")}</p>
            <p className="mt-1 truncate text-[11px] font-semibold text-white">{currentWorkspaceSummary.title}</p>
            </div>
        ) : (
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.07] px-3 py-3 min-h-[86px]">
            <p className="text-[9px] font-mono uppercase tracking-[0.28em] text-cyan-300">{t("sidebar.currentWorkspace")}</p>
            <p className="mt-2 text-sm font-semibold tracking-wide text-white">{currentWorkspaceSummary.title}</p>
            <p className="mt-1 text-[11px] leading-snug text-white/55">{currentWorkspaceSummary.description}</p>
          </div>
        )}
      </div>

      <nav className={`flex-1 overflow-y-auto py-2 ${compact ? "space-y-1.5 flex flex-col items-center" : "space-y-0.5 px-2"}`}>
        {!compact && (
          <p className="px-2 pt-1 pb-1 text-[9px] font-mono tracking-widest text-white/40 uppercase">
            {t("sidebar.section.workspaces")}
          </p>
        )}

        <NavItem
          testId="sidebar-home"
          compact={compact}
          icon={<Inbox size={18} />}
          label={t("sidebar.item.home.title")}
          description={t("sidebar.item.home.description")}
          actionHint={t("sidebar.item.home.hint")}
          active={activeWidgets.includes("inbox")}
          onClick={() => {
            openWidgets(["inbox"], {
              focus: "inbox",
              replace: true,
              activate: "focus_only",
              workspacePreset: null,
            });
            if (pathname !== "/") {
              router.push("/");
            }
          }}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-workspace-jarvis"
          compact={compact}
          icon={<Target size={18} />}
          label={t("sidebar.item.jarvis.title")}
          description={t("sidebar.item.jarvis.description")}
          actionHint={t("sidebar.item.jarvis.hint")}
          active={activeWorkspacePreset === "mission"}
          onClick={(event) => handleWorkspaceClick("mission", event)}
          secondaryShortcut={() => openWorkspacePreset("mission", "full")}
          secondaryAction={{
            icon: <LayoutGrid size={12} />,
            label: t("sidebar.tooltip.fullStack"),
            onClick: (event) => handleWorkspaceOpenFull("mission", event),
          }}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-workspace-execution"
          compact={compact}
          icon={<Code2 size={18} />}
          label={t("sidebar.item.execution.title")}
          description={t("sidebar.item.execution.description")}
          actionHint={t("sidebar.item.execution.hint")}
          active={activeWorkspacePreset === "studio_code"}
          onClick={(event) => handleWorkspaceClick("studio_code", event)}
          secondaryShortcut={() => openWorkspacePreset("studio_code", "full")}
          secondaryAction={{
            icon: <LayoutGrid size={12} />,
            label: t("sidebar.tooltip.fullStack"),
            onClick: (event) => handleWorkspaceOpenFull("studio_code", event),
          }}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-workspace-research"
          compact={compact}
          icon={<Search size={18} />}
          label={t("sidebar.item.research.title")}
          description={t("sidebar.item.research.description")}
          actionHint={t("sidebar.item.research.hint")}
          active={activeWorkspacePreset === "studio_research"}
          onClick={(event) => handleWorkspaceClick("studio_research", event)}
          secondaryShortcut={() => openWorkspacePreset("studio_research", "full")}
          secondaryAction={{
            icon: <LayoutGrid size={12} />,
            label: t("sidebar.tooltip.fullStack"),
            onClick: (event) => handleWorkspaceOpenFull("studio_research", event),
          }}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-workspace-control"
          compact={compact}
          icon={<BarChart3 size={18} />}
          label={t("sidebar.item.control.title")}
          description={t("sidebar.item.control.description")}
          actionHint={t("sidebar.item.control.hint")}
          active={activeWorkspacePreset === "studio_intelligence"}
          onClick={(event) => handleWorkspaceClick("studio_intelligence", event)}
          secondaryShortcut={() => openWorkspacePreset("studio_intelligence", "full")}
          secondaryAction={{
            icon: <LayoutGrid size={12} />,
            label: t("sidebar.tooltip.fullStack"),
            onClick: (event) => handleWorkspaceOpenFull("studio_intelligence", event),
          }}
          onTooltipChange={handleTooltipChange}
        />

        {!compact && (
          <p className="px-2 pt-2 pb-1 text-[9px] font-mono tracking-widest text-white/40 uppercase">
            {t("sidebar.section.controlPlane")}
          </p>
        )}

        {canAccessWidget(role, "approvals") && (
          <NavItem
            testId="sidebar-approvals"
            compact={compact}
            icon={<ShieldCheck size={18} />}
            label={t("sidebar.item.approvals.title")}
            description={t("sidebar.item.approvals.description")}
            actionHint={t("sidebar.item.approvals.hint")}
            active={activeWidgets.includes("approvals")}
            alert
            onClick={() => toggleWidget("approvals")}
            onTooltipChange={handleTooltipChange}
          />
        )}
        <NavItem
          testId="sidebar-memory"
          compact={compact}
          icon={<Brain size={18} />}
          label={t("sidebar.item.memory.title")}
          description={t("sidebar.item.memory.description")}
          actionHint={t("sidebar.item.memory.hint")}
          active={activeWidgets.includes("memory")}
          onClick={() => toggleWidget("memory")}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-watchers"
          compact={compact}
          icon={<RadioTower size={18} />}
          label={t("sidebar.item.watchers.title")}
          description={t("sidebar.item.watchers.description")}
          actionHint={t("sidebar.item.watchers.hint")}
          active={activeWidgets.includes("watchers")}
          onClick={() => toggleWidget("watchers")}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-dossiers"
          compact={compact}
          icon={<BookOpenText size={18} />}
          label={t("sidebar.item.dossiers.title")}
          description={t("sidebar.item.dossiers.description")}
          actionHint={t("sidebar.item.dossiers.hint")}
          active={activeWidgets.includes("dossier")}
          onClick={() => toggleWidget("dossier")}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-notifications"
          compact={compact}
          icon={<BellRing size={18} />}
          label={t("sidebar.item.notifications.title")}
          description={t("sidebar.item.notifications.description")}
          actionHint={t("sidebar.item.notifications.hint")}
          active={activeWidgets.includes("notifications")}
          onClick={() => toggleWidget("notifications")}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-settings"
          compact={compact}
          icon={<Settings size={18} />}
          label={t("sidebar.item.settings.title")}
          description={t("sidebar.item.settings.description")}
          actionHint={t("sidebar.item.settings.hint")}
          active={activeWidgets.includes("settings")}
          onClick={() => toggleWidget("settings")}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-action-center"
          compact={compact}
          icon={<ShieldCheck size={18} />}
          label={t("sidebar.item.actionCenter.title")}
          description={t("sidebar.item.actionCenter.description")}
          actionHint={t("sidebar.item.actionCenter.hint")}
          active={activeWidgets.includes("action_center")}
          onClick={() => toggleWidget("action_center")}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-model-control"
          compact={compact}
          icon={<SlidersHorizontal size={18} />}
          label={t("sidebar.item.modelControl.title")}
          description={t("sidebar.item.modelControl.description")}
          actionHint={t("sidebar.item.modelControl.hint")}
          active={activeWidgets.includes("model_control")}
          onClick={() => toggleWidget("model_control")}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-ideation"
          compact={compact}
          icon={<Lightbulb size={18} />}
          label={t("sidebar.item.ideation.title")}
          description={t("sidebar.item.ideation.description")}
          actionHint={t("sidebar.item.ideation.hint")}
          active={activeWidgets.includes("ideation")}
          onClick={() => toggleWidget("ideation")}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-skills"
          compact={compact}
          icon={<Bot size={18} />}
          label={t("sidebar.item.skills.title")}
          description={t("sidebar.item.skills.description")}
          actionHint={t("sidebar.item.skills.hint")}
          active={activeWidgets.includes("skills")}
          onClick={() => toggleWidget("skills")}
          onTooltipChange={handleTooltipChange}
        />
        <NavItem
          testId="sidebar-logout"
          compact={compact}
          icon={<LogOut size={18} />}
          label={loggingOut ? "Logging Out..." : t("sidebar.item.logout.title")}
          description={t("sidebar.item.logout.description")}
          actionHint={t("sidebar.item.logout.hint")}
          onClick={() => void handleLogout()}
          tone="danger"
          disabled={loggingOut}
          onTooltipChange={handleTooltipChange}
        />
      </nav>

      <div className={`h-16 border-t border-white/10 shrink-0 ${compact ? "flex items-center justify-center" : "flex items-center px-3"}`}>
        <div className={`relative group ${compact ? "" : "flex items-center gap-2"}`}>
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] block" />
          {!compact && <span className="text-[10px] font-mono tracking-wide text-emerald-300">{t("sidebar.systemOnline")}</span>}
          {compact && (
            <span className="absolute bottom-6 left-6 bg-black text-emerald-400 px-2 py-1 rounded text-[10px] font-mono whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity border border-emerald-500/30">
              {t("sidebar.systemOnline")}
            </span>
          )}
        </div>
      </div>

      {tooltip ? (
        <div
          className="pointer-events-none fixed z-[95] w-[244px] rounded-2xl border border-cyan-500/20 bg-black/88 px-4 py-3 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          style={{ top: tooltip.top, left: tooltip.left }}
        >
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-cyan-300">{tooltip.title}</p>
          <p className="mt-2 text-sm font-medium leading-6 text-white/88">{tooltip.description}</p>
          {tooltip.actionHint ? (
            <p className="mt-2 text-[11px] leading-5 text-cyan-100/80">{tooltip.actionHint}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar() {
  return <SidebarContent />;
}

function NavItem({
  testId,
  compact,
  icon,
  label,
  description,
  actionHint,
  alert,
  active,
  onClick,
  secondaryShortcut,
  secondaryAction,
  tone = "default",
  disabled = false,
  onTooltipChange,
}: NavItemDescriptor) {
  const inactiveClass =
    tone === "danger"
      ? "text-rose-300/70 hover:text-rose-200 hover:bg-rose-500/10 border border-transparent"
      : "text-white/45 hover:text-white hover:bg-white/5 border border-transparent";
  const iconHoverClass = tone === "danger" ? "group-hover:text-rose-200" : "group-hover:text-cyan-300";

  const showTooltip = (element: HTMLElement) => {
    onTooltipChange?.({
      title: label,
      description,
      actionHint,
      element,
    });
  };
  const hintId = actionHint ? hintIdForLabel(label) : undefined;

  return (
    <div className={`relative group ${compact ? "flex items-center my-1" : "my-0.5"}`}>
      <div className={compact ? "" : "flex items-center gap-1"}>
        <button
          data-testid={testId}
          onClick={onClick}
          onMouseEnter={(event) => showTooltip(event.currentTarget)}
          onMouseLeave={() => onTooltipChange?.(null)}
          onFocus={(event) => showTooltip(event.currentTarget)}
          onBlur={() => onTooltipChange?.(null)}
          disabled={disabled}
          aria-label={label}
          aria-describedby={hintId}
          aria-keyshortcuts={secondaryAction ? "Enter Shift+Enter" : undefined}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.shiftKey && secondaryShortcut) {
              event.preventDefault();
              secondaryShortcut();
            }
          }}
          className={`${compact ? "w-10 h-10 justify-center" : "flex-1 min-h-[44px] px-2.5 py-2 justify-start gap-2.5"} flex items-center rounded-xl transition-all ${
            active
              ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 shadow-[0_0_18px_rgba(0,255,255,0.12)]"
              : inactiveClass
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <span className={`${active ? "text-cyan-300" : iconHoverClass} transition-colors shrink-0 relative`}>
            {icon}
            {alert && compact && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse" />
            )}
          </span>
          {!compact ? (
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[11px] font-semibold tracking-wide text-white/92 truncate">{label}</span>
            </span>
          ) : null}
        </button>

        {!compact && secondaryAction ? (
          <button
            type="button"
            aria-label={secondaryAction.label}
            title={secondaryAction.label}
            onClick={secondaryAction.onClick}
            onMouseEnter={(event) =>
              onTooltipChange?.({
                title: label,
                description,
                actionHint,
                element: event.currentTarget,
              })
            }
            onMouseLeave={() => onTooltipChange?.(null)}
            className="pointer-events-none h-[44px] w-10 shrink-0 rounded-xl border border-white/10 bg-white/[0.03] text-white/55 opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:text-cyan-200 hover:border-cyan-500/35 flex items-center justify-center"
          >
            {secondaryAction.icon}
          </button>
        ) : null}
      </div>
      {actionHint ? (
        <span id={hintId} className="sr-only">
          {actionHint}
        </span>
      ) : null}
    </div>
  );
}
