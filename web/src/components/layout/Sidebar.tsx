"use client";

import React, { useEffect, useState } from "react";
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
    ChevronLeft,
    ChevronRight,
} from "lucide-react";

import { useHUD } from "@/components/providers/HUDProvider";
import { canAccessWidget, useCurrentRole } from "@/lib/auth/role";
import { ApiRequestError } from "@/lib/api/client";
import { authLogout } from "@/lib/api/endpoints";
import { clearAuthSession } from "@/lib/auth/session";
import {
    getHudWorkspacePresetConfig,
    getHudWorkspacePrimaryWidget,
    type HudWorkspacePreset,
} from "@/lib/hud/widget-presets";

const SIDEBAR_COMPACT_KEY = "jarvis.sidebar.compact";

function SidebarContent() {
    const { activeWidgets, toggleWidget, openWidgets, activeWorkspacePreset } = useHUD();
    const role = useCurrentRole();
    const router = useRouter();
    const pathname = usePathname();
    const [loggingOut, setLoggingOut] = useState(false);
    const [compact, setCompact] = useState(false);

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

        if (mode === "primary") {
            openWidgets([primaryWidget], {
                focus: primaryWidget,
                replace: true,
                activate: "focus_only",
                workspacePreset: preset,
            });
            return;
        }

        const config = getHudWorkspacePresetConfig(preset);
        const allowedWidgets = config.widgets.filter((widgetId) => canAccessWidget(role, widgetId));
        if (allowedWidgets.length === 0) {
            return;
        }
        const focusWidget = allowedWidgets.includes(config.focus) ? config.focus : allowedWidgets[0]!;
        openWidgets(allowedWidgets, {
            focus: focusWidget,
            replace: true,
            activate: "all",
            workspacePreset: preset,
        });
    };

    const isWorkspacePresetActive = (preset: HudWorkspacePreset): boolean => {
        return activeWorkspacePreset === preset;
    };

    const handleWorkspaceClick = (
        preset: HudWorkspacePreset,
        event: React.MouseEvent<HTMLButtonElement>
    ) => {
        openWorkspacePreset(preset, event.shiftKey ? "full" : "primary");
    };

    const handleWorkspaceOpenFull = (
        preset: HudWorkspacePreset,
        event: React.MouseEvent<HTMLButtonElement>
    ) => {
        event.preventDefault();
        event.stopPropagation();
        openWorkspacePreset(preset, "full");
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

    return (
        <div
            className={`${compact ? "w-16" : "w-64"} h-full border-r border-white/10 bg-black/50 backdrop-blur-xl flex flex-col justify-between shrink-0 relative z-50 transition-[width] duration-200`}
        >
            <div
                className={`h-20 border-b border-white/10 shrink-0 ${compact ? "flex items-center justify-center" : "flex items-center justify-between px-3"}`}
            >
                <div className={`flex items-center ${compact ? "justify-center" : "gap-3 min-w-0"}`}>
                    <div className="w-8 h-8 rounded-full border-2 border-cyan-500/50 flex items-center justify-center p-1 relative">
                        <div className="absolute inset-0 rounded-full border border-cyan-400 animate-ping opacity-20"></div>
                        <div className="w-full h-full bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(0,255,255,0.8)]"></div>
                    </div>
                    {!compact && (
                        <div className="min-w-0">
                            <p className="text-xs font-mono tracking-widest text-cyan-300 font-bold">JARVIS</p>
                            <p className="text-[10px] font-mono text-white/45 truncate">Workspace Navigator</p>
                        </div>
                    )}
                </div>

                {!compact && (
                    <button
                        type="button"
                        aria-label="Collapse sidebar"
                        onClick={() => setCompact(true)}
                        className="h-8 w-8 rounded-md border border-white/15 bg-white/[0.04] text-white/60 hover:text-cyan-200 hover:border-cyan-500/40 transition-colors flex items-center justify-center"
                    >
                        <ChevronLeft size={14} />
                    </button>
                )}
                {compact && (
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

            <nav className={`flex-1 overflow-y-auto py-2 ${compact ? "space-y-1.5 flex flex-col items-center" : "space-y-0.5 px-2"}`}>
                {!compact && (
                    <p className="px-2 pt-1 pb-1 text-[9px] font-mono tracking-widest text-white/40 uppercase">
                        Workspaces
                    </p>
                )}

                <NavItem
                    compact={compact}
                    icon={<Inbox size={18} />}
                    label="Inbox"
                    title="Home"
                    description="Dashboard & quick command."
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
                />
                <NavItem
                    compact={compact}
                    icon={<Target size={18} />}
                    label="Mission Control"
                    title="Composite Mission"
                    description="Mission start. Grid = full stack."
                    active={isWorkspacePresetActive("mission")}
                    onClick={(event) => handleWorkspaceClick("mission", event)}
                    secondaryAction={{
                        icon: <LayoutGrid size={12} />,
                        label: "Open Mission full stack",
                        onClick: (event) => handleWorkspaceOpenFull("mission", event),
                    }}
                />
                <NavItem
                    compact={compact}
                    icon={<Code2 size={18} />}
                    label="Code"
                    title="Code Studio"
                    description="Code start. Grid = full stack."
                    active={isWorkspacePresetActive("studio_code")}
                    onClick={(event) => handleWorkspaceClick("studio_code", event)}
                    secondaryAction={{
                        icon: <LayoutGrid size={12} />,
                        label: "Open Code full stack",
                        onClick: (event) => handleWorkspaceOpenFull("studio_code", event),
                    }}
                />
                <NavItem
                    compact={compact}
                    icon={<Search size={18} />}
                    label="Research"
                    title="Research Studio"
                    description="Research start. Grid = full stack."
                    active={isWorkspacePresetActive("studio_research")}
                    onClick={(event) => handleWorkspaceClick("studio_research", event)}
                    secondaryAction={{
                        icon: <LayoutGrid size={12} />,
                        label: "Open Research full stack",
                        onClick: (event) => handleWorkspaceOpenFull("studio_research", event),
                    }}
                />
                <NavItem
                    compact={compact}
                    icon={<BarChart3 size={18} />}
                    label="Intelligence"
                    title="Finance and News"
                    description="Intel start. Grid = full stack."
                    active={isWorkspacePresetActive("studio_intelligence")}
                    onClick={(event) => handleWorkspaceClick("studio_intelligence", event)}
                    secondaryAction={{
                        icon: <LayoutGrid size={12} />,
                        label: "Open Intelligence full stack",
                        onClick: (event) => handleWorkspaceOpenFull("studio_intelligence", event),
                    }}
                />

                {!compact && (
                    <p className="px-2 pt-2 pb-1 text-[9px] font-mono tracking-widest text-white/40 uppercase">
                        Control Plane
                    </p>
                )}

                {canAccessWidget(role, "approvals") && (
                    <NavItem
                        compact={compact}
                        icon={<ShieldCheck size={18} />}
                        label="Approvals"
                        title="Approval Center"
                        description="High-risk approval review."
                        active={activeWidgets.includes("approvals")}
                        alert
                        onClick={() => toggleWidget("approvals")}
                    />
                )}
                <NavItem
                    compact={compact}
                    icon={<Brain size={18} />}
                    label="Memory"
                    title="Personal Memory"
                    description="Profile, memory, preferences."
                    active={activeWidgets.includes("memory")}
                    onClick={() => toggleWidget("memory")}
                />
                <NavItem
                    compact={compact}
                    icon={<Settings size={18} />}
                    label="Settings"
                    title="System Settings"
                    description="Keys, connectors, policies."
                    active={activeWidgets.includes("settings")}
                    onClick={() => toggleWidget("settings")}
                />
                <NavItem
                    compact={compact}
                    icon={<LogOut size={18} />}
                    label={loggingOut ? "Logging Out..." : "Logout"}
                    title="Logout"
                    description="Sign out."
                    onClick={() => void handleLogout()}
                    tone="danger"
                    disabled={loggingOut}
                />
            </nav>

            <div className={`h-16 border-t border-white/10 shrink-0 ${compact ? "flex items-center justify-center" : "flex items-center px-3"}`}>
                <div className={`relative group ${compact ? "" : "flex items-center gap-2"}`}>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] block"></span>
                    {!compact && <span className="text-[10px] font-mono tracking-wide text-emerald-300">System Online</span>}
                    {compact && (
                        <span className="absolute bottom-6 left-6 bg-black text-emerald-400 px-2 py-1 rounded text-[10px] font-mono whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity border border-emerald-500/30">
                            System Online
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

export function Sidebar() {
    return <SidebarContent />;
}

function NavItem({
    compact,
    icon,
    label,
    title,
    description,
    alert,
    active,
    onClick,
    secondaryAction,
    tone = "default",
    disabled = false,
}: {
    compact: boolean;
    icon: React.ReactNode;
    label: string;
    title?: string;
    description?: string;
    alert?: boolean;
    active?: boolean;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    secondaryAction?: {
        icon: React.ReactNode;
        label: string;
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    };
    tone?: "default" | "danger";
    disabled?: boolean;
}) {
    const inactiveClass =
        tone === "danger"
            ? "text-rose-300/70 hover:text-rose-200 hover:bg-rose-500/10 border border-transparent"
            : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent";
    const iconHoverClass = tone === "danger" ? "group-hover:text-rose-200" : "group-hover:text-cyan-400";
    const displayTitle = title ?? label;

    return (
        <div className={`relative group ${compact ? "flex items-center my-1" : "my-0.5"}`}>
            <div className={compact ? "" : "flex items-center gap-1"}>
                <button
                    onClick={onClick}
                    onDoubleClick={secondaryAction?.onClick}
                    disabled={disabled}
                    aria-label={label}
                    className={`${compact ? "w-10 h-10 justify-center" : "flex-1 h-10 px-2.5 justify-start gap-2.5"} flex items-center rounded-lg transition-all ${
                        active
                            ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 shadow-[0_0_15px_rgba(0,255,255,0.12)]"
                            : inactiveClass
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                    title={!compact ? description : undefined}
                >
                    <span className={`${active ? "text-cyan-300" : iconHoverClass} transition-colors shrink-0`}>
                        {icon}
                        {alert && compact && (
                            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse"></span>
                        )}
                    </span>

                    {!compact && (
                        <span className="min-w-0 flex-1 text-left">
                            <span className="block text-[11px] font-semibold tracking-wide text-white/90 truncate">{displayTitle}</span>
                        </span>
                    )}

                    {!compact && alert && (
                        <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse shrink-0"></span>
                    )}
                </button>

                {!compact && secondaryAction && (
                    <button
                        type="button"
                        onClick={secondaryAction.onClick}
                        aria-label={secondaryAction.label}
                        title={`${secondaryAction.label} (also Shift+Click main)`}
                        className="h-10 w-9 inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.03] text-white/45 hover:text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-colors"
                    >
                        {secondaryAction.icon}
                    </button>
                )}
            </div>

            {compact && (
                <span className="absolute left-14 bg-black text-white px-2 py-1 rounded text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity border border-white/10 pointer-events-none z-50 max-w-[220px]">
                    <span className="block whitespace-nowrap">{displayTitle}</span>
                    {description && (
                        <span className="block mt-0.5 text-[9px] text-white/60 whitespace-normal leading-snug">
                            {description}
                        </span>
                    )}
                    {secondaryAction && (
                        <span className="block mt-0.5 text-[9px] text-cyan-300 whitespace-normal leading-snug">
                            Double-click for full stack.
                        </span>
                    )}
                </span>
            )}
        </div>
    );
}
