"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useState, startTransition } from "react";
import { ArrowRight, ChevronRight, RefreshCw } from "lucide-react";

import { useLocale } from "@/components/providers/LocaleProvider";
import { ApiRequestError } from "@/lib/api/client";
import { listIntelligenceWorkspaces } from "@/lib/api/endpoints";
import type { EventReviewState, IntelligenceWorkspaceRecord, ProviderName } from "@/lib/api/types";

export type IntelligenceDetailTab = "summary" | "evidence" | "timeline" | "execution";

function prettify(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  return value.replaceAll("_", " ");
}

export function text(locale: "ko" | "en", ko: string, en: string): string {
  return locale === "ko" ? ko : en;
}

export function formatDateTime(value: string | null | undefined, emptyLabel = "—"): string {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function reviewStateLabel(state: EventReviewState | null | undefined, locale: "ko" | "en"): string {
  if (!state) return locale === "ko" ? "없음" : "none";
  if (locale === "ko") {
    if (state === "watch") return "주시";
    if (state === "review") return "검토";
    if (state === "ignore") return "무시";
  }
  return state;
}

export function narrativeStateLabel(state: string | null | undefined, locale: "ko" | "en"): string {
  if (!state) return locale === "ko" ? "없음" : "none";
  if (locale === "ko") {
    if (state === "forming") return "형성중";
    if (state === "recurring") return "반복";
    if (state === "diverging") return "분기";
    if (state === "new") return "신규";
  }
  return prettify(state);
}

export function executionStatusLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    pending: { ko: "대기", en: "pending" },
    approved: { ko: "승인", en: "approved" },
    blocked: { ko: "차단", en: "blocked" },
    executed: { ko: "실행됨", en: "executed" },
    failed: { ko: "실패", en: "failed" },
    proposal: { ko: "제안", en: "proposal" },
    proceed: { ko: "진행", en: "proceed" },
    hold: { ko: "보류", en: "hold" },
    reject: { ko: "거절", en: "reject" },
    active: { ko: "활성", en: "active" },
    inactive: { ko: "비활성", en: "inactive" },
    idle: { ko: "유휴", en: "idle" },
    completed: { ko: "완료", en: "completed" },
  };
  return labels[value]?.[locale] ?? prettify(value);
}

export function genericStatusLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    active: { ko: "활성", en: "active" },
    inactive: { ko: "비활성", en: "inactive" },
    monitor: { ko: "관찰", en: "monitor" },
    confirmed: { ko: "확정", en: "confirmed" },
    invalidated: { ko: "무효", en: "invalidated" },
    mixed: { ko: "혼합", en: "mixed" },
    unresolved: { ko: "미해결", en: "unresolved" },
    pending: { ko: "대기", en: "pending" },
    dispatched: { ko: "전달됨", en: "dispatched" },
    failed: { ko: "실패", en: "failed" },
    completed: { ko: "완료", en: "completed" },
  };
  return labels[value]?.[locale] ?? prettify(value);
}

export function graphRelationLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    supports: { ko: "지지", en: "supports" },
    contradicts: { ko: "반박", en: "contradicts" },
    related: { ko: "관련", en: "related" },
    same: { ko: "동일", en: "same" },
    supporting: { ko: "보강", en: "supporting" },
    contradicting: { ko: "반박", en: "contradicting" },
    unrelated: { ko: "무관", en: "unrelated" },
  };
  return labels[value]?.[locale] ?? prettify(value);
}

export function temporalRelationLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    recurring: { ko: "반복", en: "recurring" },
    diverging: { ko: "분기", en: "diverging" },
    supportive_history: { ko: "지지 이력", en: "supportive history" },
    merge: { ko: "병합", en: "merge" },
    split: { ko: "분리", en: "split" },
    recurring_strengthened: { ko: "반복 강화", en: "recurring strengthened" },
    diverging_strengthened: { ko: "분기 강화", en: "diverging strengthened" },
    supportive_history_added: { ko: "지지 이력 추가", en: "supportive history added" },
    stability_drop: { ko: "안정성 하락", en: "stability drop" },
    latest: { ko: "최신", en: "latest" },
    snapshot: { ko: "스냅샷", en: "snapshot" },
  };
  return labels[value]?.[locale] ?? prettify(value);
}

export function providerLabel(value: ProviderName | string, locale: "ko" | "en"): string {
  const labels: Record<string, { ko: string; en: string }> = {
    openai: { ko: "OpenAI", en: "OpenAI" },
    anthropic: { ko: "Anthropic", en: "Anthropic" },
    google: { ko: "Google", en: "Google" },
    openrouter: { ko: "OpenRouter", en: "OpenRouter" },
    xai: { ko: "xAI", en: "xAI" },
  };
  return labels[value]?.[locale] ?? String(value);
}

export function workerStatusLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    ok: { ko: "정상", en: "ok" },
    running: { ko: "실행중", en: "running" },
    error: { ko: "오류", en: "error" },
    degraded: { ko: "저하", en: "degraded" },
    timeout: { ko: "시간초과", en: "timeout" },
  };
  return labels[value]?.[locale] ?? prettify(value);
}

export function sourceKindLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    rss: { ko: "RSS", en: "RSS" },
    atom: { ko: "Atom", en: "Atom" },
    json: { ko: "JSON", en: "JSON" },
    api: { ko: "API", en: "API" },
    search: { ko: "Search", en: "Search" },
    headless: { ko: "Headless", en: "Headless" },
    mcp_connector: { ko: "MCP", en: "MCP" },
    synthetic: { ko: "Synthetic", en: "Synthetic" },
  };
  return labels[value]?.[locale] ?? prettify(value);
}

export function sourceTypeLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    news: { ko: "뉴스", en: "news" },
    policy: { ko: "정책", en: "policy" },
    market_data: { ko: "시장 데이터", en: "market data" },
    community: { ko: "커뮤니티", en: "community" },
    research: { ko: "리서치", en: "research" },
    connector: { ko: "커넥터", en: "connector" },
  };
  return labels[value]?.[locale] ?? prettify(value);
}

export function sourceTierLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  if (locale === "ko") {
    if (value === "tier_0") return "0등급";
    if (value === "tier_1") return "1등급";
    if (value === "tier_2") return "2등급";
    if (value === "tier_3") return "3등급";
  }
  return prettify(value);
}

export function capabilityAliasLabel(value: string | null | undefined, locale: "ko" | "en"): string {
  if (!value) return locale === "ko" ? "없음" : "none";
  const labels: Record<string, { ko: string; en: string }> = {
    structured_extraction: { ko: "구조 추출", en: "Structured Extraction" },
    semantic_reasoning: { ko: "시맨틱 추론", en: "Semantic Reasoning" },
    brief_generation: { ko: "브리프 생성", en: "Brief Generation" },
    action_planning: { ko: "액션 계획", en: "Action Planning" },
  };
  return labels[value]?.[locale] ?? prettify(value);
}

type HrefUpdate = {
  workspace?: string | null;
  tab?: IntelligenceDetailTab | null;
};

export function useIntelligenceWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceParam = searchParams.get("workspace");
  const [workspaces, setWorkspaces] = useState<IntelligenceWorkspaceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const resolvedWorkspaceId =
    (workspaceParam && workspaces.some((workspace) => workspace.id === workspaceParam)
      ? workspaceParam
      : workspaces[0]?.id) ?? null;

  const buildHref = useCallback((path: string, updates: HrefUpdate = {}) => {
    const next = new URLSearchParams(searchParams.toString());
    if (updates.workspace !== undefined) {
      if (updates.workspace) {
        next.set("workspace", updates.workspace);
      } else {
        next.delete("workspace");
      }
    }
    if (updates.tab !== undefined) {
      if (updates.tab) {
        next.set("tab", updates.tab);
      } else {
        next.delete("tab");
      }
    }
    const qs = next.toString();
    return qs ? `${path}?${qs}` : path;
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listIntelligenceWorkspaces()
      .then((response) => {
        if (cancelled) return;
        setWorkspaces(response.workspaces);
        const resolvedWorkspaceId =
          (workspaceParam && response.workspaces.some((workspace) => workspace.id === workspaceParam)
            ? workspaceParam
            : response.workspaces[0]?.id) ?? null;
        if (resolvedWorkspaceId && resolvedWorkspaceId !== workspaceParam) {
          startTransition(() => {
            router.replace(buildHref(pathname, { workspace: resolvedWorkspaceId }));
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError) {
          setError(`${err.code}: ${err.message}`);
        } else {
          setError("Failed to load intelligence workspaces.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildHref, pathname, router, workspaceParam]);

  const setWorkspaceSelection = useCallback((nextWorkspaceId: string | null) => {
    startTransition(() => {
      router.replace(buildHref(pathname, { workspace: nextWorkspaceId }));
    });
  }, [buildHref, pathname, router]);

  const refreshWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listIntelligenceWorkspaces();
      setWorkspaces(response.workspaces);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Failed to load intelligence workspaces.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    workspaces,
    workspaceId: resolvedWorkspaceId,
    loadingWorkspace: loading,
    workspaceError: error,
    buildHref,
    setWorkspaceSelection,
    refreshWorkspaces,
  };
}

export function Panel({
  title,
  meta,
  children,
  className = "",
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl ${className}`.trim()}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-mono uppercase tracking-[0.22em] text-white/60">{title}</h2>
        {meta ? <span className="text-xs text-white/45">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "cyan" | "amber" | "emerald" | "rose"; }) {
  const tones: Record<string, string> = {
    neutral: "border-white/10 bg-white/[0.04] text-white/65",
    cyan: "border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
    amber: "border-amber-300/30 bg-amber-500/10 text-amber-100",
    emerald: "border-emerald-300/30 bg-emerald-500/10 text-emerald-100",
    rose: "border-rose-300/30 bg-rose-500/10 text-rose-100",
  };
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] ${tones[tone]}`}>{children}</span>;
}

export function ActionButton({
  href,
  onClick,
  children,
  tone = "neutral",
  icon,
  disabled = false,
}: {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
  tone?: "neutral" | "primary" | "danger";
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  const classes =
    tone === "primary"
      ? "border-cyan-300/30 bg-cyan-400/10 text-cyan-100"
      : tone === "danger"
        ? "border-rose-300/30 bg-rose-500/10 text-rose-100"
        : "border-white/10 bg-white/[0.04] text-white/75";
  const content = (
    <>
      {icon}
      {children}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${classes}`}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${classes}`}
    >
      {content}
    </button>
  );
}

export function BreadcrumbChain({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/45">
      {items.map((item, index) => (
        <React.Fragment key={`${item.label}-${index}`}>
          {item.href ? (
            <Link href={item.href} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 hover:border-white/20 hover:text-white/75">
              {item.label}
            </Link>
          ) : (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{item.label}</span>
          )}
          {index < items.length - 1 ? <ChevronRight size={12} className="text-white/20" /> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

export function SynopsisBlock({
  lines,
}: {
  lines: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-2">
      {lines.map((line) => (
        <div key={line.label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{line.label}</p>
          <p className="mt-2 text-sm leading-6 text-white/80">{line.value}</p>
        </div>
      ))}
    </div>
  );
}

export function IntelligenceTabs({
  activeTab,
  tabs,
}: {
  activeTab: IntelligenceDetailTab;
  tabs: Array<{ key: IntelligenceDetailTab; label: string; href: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`rounded-full border px-3 py-1.5 text-xs ${
            activeTab === tab.key
              ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
              : "border-white/10 bg-white/[0.04] text-white/60"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

export function IntelligenceShell({
  title,
  description,
  workspaceId,
  workspaces,
  buildHref,
  onWorkspaceChange,
  onRefresh,
  loading,
  error,
  breadcrumb,
  right,
  children,
}: {
  title: string;
  description: string;
  workspaceId: string | null;
  workspaces: IntelligenceWorkspaceRecord[];
  buildHref: (path: string, updates?: HrefUpdate) => string;
  onWorkspaceChange: (workspaceId: string | null) => void;
  onRefresh: () => void;
  loading?: boolean;
  error?: string | null;
  breadcrumb?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { locale } = useLocale();
  return (
    <main className="min-h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,_rgba(83,208,255,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(68,255,181,0.12),_transparent_22%),linear-gradient(180deg,_#08111a_0%,_#05080f_100%)] text-white">
      <div className="mx-auto max-w-[1500px] space-y-6 p-6">
        <section className="rounded-3xl border border-white/10 bg-black/35 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.32em] text-cyan-300/80">
                  {text(locale, "운영 우선 인텔리전스", "Operator-First Intelligence")}
                </p>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
                  <p className="mt-2 max-w-3xl text-sm text-white/70">{description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={buildHref("/intelligence")}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      title.includes("System")
                        ? "border-white/10 bg-white/[0.04] text-white/60"
                        : "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
                    }`}
                  >
                    {text(locale, "Inbox", "Inbox")}
                  </Link>
                  <Link
                    href={buildHref("/intelligence/system")}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      title.includes("System")
                        ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-white/[0.04] text-white/60"
                    }`}
                  >
                    {text(locale, "System", "System")}
                  </Link>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-white/45">
                  {loading ? text(locale, "불러오는 중...", "Loading...") : text(locale, "준비됨", "Ready")}
                </span>
                <select
                  value={workspaceId ?? ""}
                  onChange={(event) => onWorkspaceChange(event.target.value || null)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id} className="bg-slate-900">
                      {workspace.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100"
                >
                  <RefreshCw size={14} />
                  {text(locale, "새로고침", "Refresh")}
                </button>
                {right}
              </div>
            </div>
            {breadcrumb}
            {error ? (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
          </div>
        </section>
        {children}
      </div>
    </main>
  );
}

export function EmptyPanel({
  title,
  body,
  href,
  ctaLabel,
}: {
  title: string;
  body: string;
  href?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-sm text-white/45">
      <p className="font-medium text-white/80">{title}</p>
      <p className="mt-2 max-w-2xl leading-6">{body}</p>
      {href && ctaLabel ? (
        <Link href={href} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
          {ctaLabel}
          <ArrowRight size={12} />
        </Link>
      ) : null}
    </div>
  );
}
