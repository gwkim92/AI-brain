"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useMemo, useState } from "react";
import { Bell, LogOut, PanelsTopLeft, ShieldCheck, Wrench } from "lucide-react";

import { clearAuthSession } from "@/lib/auth/session";
import { authLogout } from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/client";
import { normalizeAppRole, useCurrentRole, type AppUserRole } from "@/lib/auth/role";
import { useLocale } from "@/components/providers/LocaleProvider";
import { NotificationsModule } from "@/components/modules/NotificationsModule";
import { useUserQuickCommand } from "@/hooks/useUserQuickCommand";

type ShellMode = "user" | "operator" | "system";

type NavItem = {
  href: string;
  labelKo: string;
  labelEn: string;
  descriptionKo: string;
  descriptionEn: string;
  match?: "exact" | "prefix";
};

type ProductShellProps = {
  mode: ShellMode;
  titleKo: string;
  titleEn: string;
  descriptionKo: string;
  descriptionEn: string;
  navItems: NavItem[];
  showComposer?: boolean;
  showNotifications?: boolean;
  children: React.ReactNode;
};

function labelFor(locale: "ko" | "en", ko: string, en: string): string {
  return locale === "ko" ? ko : en;
}

function canSeeMode(role: AppUserRole, mode: ShellMode): boolean {
  if (mode === "user") return true;
  if (mode === "operator") return role === "operator" || role === "admin";
  return role === "admin";
}

function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.match === "prefix") {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname === item.href;
}

function ModeSwitch({ mode, role }: { mode: ShellMode; role: AppUserRole }) {
  const { locale } = useLocale();

  const items = [
    {
      mode: "user" as const,
      href: "/",
      label: labelFor(locale, "User", "User"),
      icon: <PanelsTopLeft size={14} />,
    },
    {
      mode: "operator" as const,
      href: "/intelligence",
      label: labelFor(locale, "Operator", "Operator"),
      icon: <ShieldCheck size={14} />,
    },
    {
      mode: "system" as const,
      href: "/system",
      label: labelFor(locale, "System", "System"),
      icon: <Wrench size={14} />,
    },
  ].filter((item) => canSeeMode(role, item.mode));

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-1 py-1 shadow-sm">
      {items.map((item) => (
        <Link
          key={item.mode}
          href={item.href}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === item.mode
              ? "bg-neutral-950 text-white"
              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
          }`}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
      <Link
        href="/studio"
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
      >
        <PanelsTopLeft size={14} />
        {labelFor(locale, "Studio", "Studio")}
      </Link>
    </div>
  );
}

function UserComposer() {
  const { locale } = useLocale();
  const { commandInput, setCommandInput, isSubmitting, error, execute } = useUserQuickCommand();

  return (
    <div className="min-w-0 w-full flex-1 max-w-3xl">
      <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-sm">
        <input
          type="text"
          value={commandInput}
          onChange={(event) => setCommandInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void execute();
            }
          }}
          placeholder={labelFor(
            locale,
            "지금 필요한 작업을 한 줄로 적어라",
            "Describe the work you want Jarvis to start",
          )}
          className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-500"
        />
        <button
          type="button"
          onClick={() => void execute()}
          disabled={isSubmitting || commandInput.trim().length === 0}
          className="rounded-xl bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {labelFor(locale, isSubmitting ? "시작 중" : "시작", isSubmitting ? "Starting" : "Start")}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale } = useLocale();
  if (!open) return null;

  return (
    <>
      <button type="button" aria-label="close notifications" className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md border-l border-black/10 bg-[#f7f4ee] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
              {labelFor(locale, "보조 상태", "Context")}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-neutral-950">
              {labelFor(locale, "알림", "Notifications")}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-black/10 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100">
            {labelFor(locale, "닫기", "Close")}
          </button>
        </div>
        <div className="h-[calc(100%-64px)] overflow-hidden rounded-3xl border border-black/10 bg-black/90">
          <NotificationsModule />
        </div>
      </div>
    </>
  );
}

export function ProductShell({
  mode,
  titleKo,
  titleEn,
  descriptionKo,
  descriptionEn,
  navItems,
  showComposer = false,
  showNotifications = false,
  children,
}: ProductShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useLocale();
  const role = useCurrentRole();
  const [loggingOut, setLoggingOut] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const visibleNavItems = useMemo(() => {
    return navItems.filter((item) => {
      if (item.href === "/approvals" && role === "member") {
        return true;
      }
      return true;
    });
  }, [navItems, role]);

  const logout = async () => {
    if (loggingOut) return;
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
    <div className="min-h-screen bg-[#f7f4ee] text-neutral-950">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-black/10 bg-[#efe9dd] lg:flex lg:flex-col">
          <div className="border-b border-black/10 px-6 py-6">
            <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">JARVIS</p>
            <h1 className="mt-3 text-xl font-semibold text-neutral-950">{labelFor(locale, titleKo, titleEn)}</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-600">{labelFor(locale, descriptionKo, descriptionEn)}</p>
          </div>

          <nav className="flex-1 px-4 py-6">
            <p className="px-3 text-[11px] uppercase tracking-[0.28em] text-neutral-500">
              {labelFor(locale, "이동", "Navigate")}
            </p>
            <div className="mt-3 space-y-1">
              {visibleNavItems.map((item) => {
                const active = isNavActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-2xl px-4 py-3 transition-colors ${
                      active ? "bg-neutral-950 text-white" : "text-neutral-700 hover:bg-black/5"
                    }`}
                  >
                    <p className="text-sm font-semibold">{labelFor(locale, item.labelKo, item.labelEn)}</p>
                    <p className={`mt-1 text-xs leading-5 ${active ? "text-white/72" : "text-neutral-500"}`}>
                      {labelFor(locale, item.descriptionKo, item.descriptionEn)}
                    </p>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="border-t border-black/10 px-4 py-4">
            <button
              type="button"
              onClick={() => void logout()}
              disabled={loggingOut}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-neutral-700 transition-colors hover:bg-neutral-100"
            >
              <LogOut size={15} />
              {labelFor(locale, loggingOut ? "로그아웃 중" : "로그아웃", loggingOut ? "Signing out" : "Sign out")}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-black/10 bg-[#f7f4ee]/95 px-4 py-4 backdrop-blur md:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
                  {mode === "user" ? "User" : mode === "operator" ? "Operator" : "System"}
                </p>
                <h2 className="mt-1 text-xl font-semibold text-neutral-950">{labelFor(locale, titleKo, titleEn)}</h2>
                <p className="mt-1 max-w-2xl text-sm text-neutral-600">{labelFor(locale, descriptionKo, descriptionEn)}</p>
              </div>
              <div className="flex flex-col gap-3 xl:min-w-[44rem] xl:flex-1 xl:items-end">
                <ModeSwitch mode={mode} role={normalizeAppRole(role)} />
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
                  {showComposer ? <UserComposer /> : null}
                  {showNotifications ? (
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(true)}
                      className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm hover:bg-neutral-100"
                    >
                      <Bell size={14} />
                      {labelFor(locale, "알림", "Notifications")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
            {children}
          </main>
        </div>
      </div>
      <NotificationsDrawer open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </div>
  );
}

export function UserShell({ children }: { children: React.ReactNode }) {
  return (
    <ProductShell
      mode="user"
      titleKo="Personal AI Workspace"
      titleEn="Personal AI Workspace"
      descriptionKo="해야 할 일, 승인, 최근 결과를 먼저 보여주고 새 작업은 한 줄 요청으로 시작한다."
      descriptionEn="Start from what needs attention now, then launch new work from one prompt."
      navItems={[
        {
          href: "/",
          labelKo: "Home",
          labelEn: "Home",
          descriptionKo: "지금 이어서 할 일과 새 요청 시작",
          descriptionEn: "Continue work and start something new",
          match: "exact",
        },
        {
          href: "/tasks",
          labelKo: "Tasks",
          labelEn: "Tasks",
          descriptionKo: "모든 작업과 세션 진행 상태",
          descriptionEn: "All tasks and active session progress",
          match: "prefix",
        },
        {
          href: "/approvals",
          labelKo: "Approvals",
          labelEn: "Approvals",
          descriptionKo: "응답과 승인 판단이 필요한 항목",
          descriptionEn: "Items that need a human decision",
          match: "prefix",
        },
        {
          href: "/memory",
          labelKo: "Memory",
          labelEn: "Memory",
          descriptionKo: "최근 기억과 축적된 컨텍스트",
          descriptionEn: "Recent memory and saved context",
          match: "prefix",
        },
        {
          href: "/settings",
          labelKo: "Settings",
          labelEn: "Settings",
          descriptionKo: "개인 환경과 선호 설정",
          descriptionEn: "Personal preferences and environment",
          match: "prefix",
        },
      ]}
      showComposer
      showNotifications
    >
      {children}
    </ProductShell>
  );
}

export function OperatorShell({ children }: { children: React.ReactNode }) {
  return (
    <ProductShell
      mode="operator"
      titleKo="Operator Review"
      titleEn="Operator Review"
      descriptionKo="운영자가 지금 검토할 서사와 리포트를 분리된 흐름으로 다룬다."
      descriptionEn="Keep narrative review and report work in a focused operator flow."
      navItems={[
        {
          href: "/intelligence",
          labelKo: "Inbox",
          labelEn: "Inbox",
          descriptionKo: "지금 검토할 서사와 실행 후보",
          descriptionEn: "Narratives and execution candidates to review now",
          match: "prefix",
        },
        {
          href: "/reports",
          labelKo: "Reports",
          labelEn: "Reports",
          descriptionKo: "리포트 스튜디오와 산출물 검토",
          descriptionEn: "Report studio and report outputs",
          match: "prefix",
        },
      ]}
    >
      {children}
    </ProductShell>
  );
}

export function SystemShell({ children }: { children: React.ReactNode }) {
  return (
    <ProductShell
      mode="system"
      titleKo="System Control"
      titleEn="System Control"
      descriptionKo="런타임, 소스, 모델, 유지보수 상태를 한 곳에서 다룬다."
      descriptionEn="Manage runtime, sources, models, and maintenance from one place."
      navItems={[
        {
          href: "/system/runtime",
          labelKo: "Runtime",
          labelEn: "Runtime",
          descriptionKo: "worker 상태와 semantic backlog",
          descriptionEn: "Worker health and semantic backlog",
          match: "prefix",
        },
        {
          href: "/system/sources-failures",
          labelKo: "Sources & Failures",
          labelEn: "Sources & Failures",
          descriptionKo: "source health, fetch failure, quarantine",
          descriptionEn: "Source health, fetch failures, and quarantine",
          match: "prefix",
        },
        {
          href: "/system/models-controls",
          labelKo: "Models & Controls",
          labelEn: "Models & Controls",
          descriptionKo: "모델 레지스트리와 provider 제어",
          descriptionEn: "Model registry and provider controls",
          match: "prefix",
        },
        {
          href: "/system/hyperagents",
          labelKo: "HyperAgents",
          labelEn: "HyperAgents",
          descriptionKo: "bounded artifact와 promotion-gated apply",
          descriptionEn: "Bounded artifacts and promotion-gated apply",
          match: "prefix",
        },
        {
          href: "/system/maintenance",
          labelKo: "Maintenance",
          labelEn: "Maintenance",
          descriptionKo: "stale rebuild와 provisional backlog",
          descriptionEn: "Stale rebuild and provisional backlog",
          match: "prefix",
        },
      ]}
    >
      {children}
    </ProductShell>
  );
}
