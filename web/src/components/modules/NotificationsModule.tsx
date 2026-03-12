"use client";

import { useEffect, useMemo, useState } from "react";

import { useLocale } from "@/components/providers/LocaleProvider";
import { streamNotifications } from "@/lib/api/endpoints";
import type { SystemNotification } from "@/lib/api/types";

const MAX_ITEMS = 24;
type SeverityFilter = "all" | SystemNotification["severity"];
type TargetFilter = "all" | NonNullable<SystemNotification["entityType"]>;

function severityClass(severity: SystemNotification["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-red-500/50 bg-red-500/10 text-red-200";
    case "warning":
      return "border-amber-400/50 bg-amber-500/10 text-amber-100";
    default:
      return "border-cyan-500/40 bg-cyan-500/10 text-cyan-100";
  }
}

function severityBadgeClass(severity: SystemNotification["severity"]): string {
  if (severity === "critical") {
    return "border-red-500/40 bg-red-500/10 text-red-200";
  }
  if (severity === "warning") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
}

function formatTargetLabel(
  value: string,
  t: (
    key:
      | "widget.title.action_center"
      | "widget.title.notifications"
      | "common.system"
      | "notifications.target.watcher"
      | "notifications.target.briefing"
      | "notifications.target.dossier"
      | "notifications.target.session"
      | "notifications.target.task"
  ) => string
): string {
  if (value === "action_center") return t("widget.title.action_center");
  if (value === "notifications") return t("widget.title.notifications");
  if (value === "system") return t("common.system");
  if (value === "watcher") return t("notifications.target.watcher");
  if (value === "briefing") return t("notifications.target.briefing");
  if (value === "dossier") return t("notifications.target.dossier");
  if (value === "session") return t("notifications.target.session");
  if (value === "task") return t("notifications.target.task");
  return value.replaceAll("_", " ");
}

function formatNotificationType(
  value: string,
  t: (
    key:
      | "notifications.type.watcherHit"
      | "notifications.type.briefingReady"
      | "notifications.type.dossierRefreshFailed"
      | "notifications.type.actionProposalReady"
      | "notifications.type.sessionStalled"
  ) => string
): string {
  if (value === "watcher_hit") return t("notifications.type.watcherHit");
  if (value === "briefing_ready") return t("notifications.type.briefingReady");
  if (value === "dossier_refresh_failed") return t("notifications.type.dossierRefreshFailed");
  if (value === "action_proposal_ready") return t("notifications.type.actionProposalReady");
  if (value === "session_stalled") return t("notifications.type.sessionStalled");
  return value.replaceAll("_", " ");
}

export function NotificationsModule() {
  const { t, formatTime } = useLocale();
  const [items, setItems] = useState<SystemNotification[]>([]);
  const [streamState, setStreamState] = useState<"connecting" | "idle" | "live" | "error">("connecting");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [targetFilter, setTargetFilter] = useState<TargetFilter>("all");

  useEffect(() => {
    const stream = streamNotifications({
      onOpen: () => {
        setStreamState((current) => (current === "live" ? "live" : "idle"));
      },
      onMessage: (notification) => {
        setStreamState("live");
        setItems((current) => {
          const next = [notification, ...current.filter((item) => item.id !== notification.id)];
          return next.slice(0, MAX_ITEMS);
        });
      },
      onError: () => {
        setStreamState("error");
      },
    });

    return () => {
      stream.close();
    };
  }, []);

  const summary = useMemo(() => {
    return {
      total: items.length,
      critical: items.filter((item) => item.severity === "critical").length,
      warning: items.filter((item) => item.severity === "warning").length,
      info: items.filter((item) => item.severity === "info").length,
    };
  }, [items]);

  const targetOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      if (item.entityType) values.add(item.entityType);
    }
    return ["all", ...[...values].sort()] as TargetFilter[];
  }, [items]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (severityFilter !== "all" && item.severity !== severityFilter) {
        return false;
      }
      if (targetFilter !== "all" && (item.entityType ?? "system") !== targetFilter) {
        return false;
      }
      return true;
    });
  }, [items, severityFilter, targetFilter]);

  return (
    <div className="h-full w-full overflow-hidden rounded-[28px] border border-white/10 bg-black/30 p-5 text-white">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-cyan-300/80">{t("notifications.kicker")}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{t("notifications.title")}</h2>
        </div>
        <div className="text-right font-mono text-[11px] uppercase tracking-[0.28em] text-white/55">
          <div>{t(`notifications.${streamState}` as const)}</div>
          <div className="mt-1">n:{summary.total} i:{summary.info} w:{summary.warning} c:{summary.critical}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["all", "critical", "warning", "info"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSeverityFilter(value)}
            className={`rounded-full border px-3 py-1 text-[10px] font-mono uppercase tracking-[0.24em] ${
              severityFilter === value ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100" : "border-white/10 text-white/55"
            }`}
          >
            {value === "all"
              ? t("common.all")
              : value === "critical"
                ? t("notifications.severity.critical")
                : value === "warning"
                  ? t("notifications.severity.warning")
                  : t("common.info")}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {targetOptions.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTargetFilter(value)}
            className={`rounded-full border px-3 py-1 text-[10px] font-mono uppercase tracking-[0.24em] ${
              targetFilter === value ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100" : "border-white/10 text-white/55"
            }`}
          >
            {value === "all" ? t("notifications.allTargets") : formatTargetLabel(value, t)}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 overflow-y-auto pr-1" style={{ maxHeight: "calc(100% - 150px)" }}>
        {visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-6 text-sm text-white/50">
            {t("notifications.none")}
          </div>
        ) : (
          visibleItems.map((item) => (
            <div
              key={item.id}
              className={`rounded-2xl border px-4 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] ${severityClass(item.severity)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-80">
                    {formatNotificationType(item.type, t)}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-white">{item.title}</h3>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/60">
                  {formatTime(item.createdAt)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-white/80">{item.message}</p>
              <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-mono uppercase tracking-[0.22em] text-white/50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${severityBadgeClass(item.severity)}`}>
                    {item.severity === "critical"
                      ? t("notifications.severity.critical")
                      : item.severity === "warning"
                        ? t("notifications.severity.warning")
                        : t("common.info")}
                  </span>
                  <span>
                    {formatTargetLabel(item.entityType ?? "system", t)}
                    {item.entityId ? ` · ${item.entityId.slice(0, 8)}` : ""}
                  </span>
                </div>
                {item.actionUrl ? (
                  <a
                    href={item.actionUrl}
                    className="rounded-full border border-white/20 px-3 py-1 text-cyan-200 transition hover:border-cyan-300/50 hover:text-cyan-100"
                  >
                    {t("notifications.open")}
                  </a>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default NotificationsModule;
