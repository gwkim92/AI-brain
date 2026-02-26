import { randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AppEnv } from '../config/env';
import { sendError } from '../lib/http';
import type { ProviderRouter } from '../providers/router';
import type { NotificationService } from '../notifications/proactive';
import type {
  CouncilRole,
  JarvisStore,
  MissionRecord,
  ProviderCredentialProvider,
  UserRole
} from '../store/types';

export type RouteContext = {
  store: JarvisStore;
  env: AppEnv;
  providerRouter: ProviderRouter;
  notificationService?: NotificationService;
  authContexts: Map<string, AuthRequestContext>;
  assistantContextRunsInFlight: Set<string>;
  telegramCallbackReplayGuard: ReturnType<typeof import('../integrations/telegram/commands').createTelegramCallbackReplayGuard>;
  missionSubscribers: Map<string, Set<(mission: MissionRecord) => void>>;
  missionExecutionsInFlight: Set<string>;
  subscribeMissionUpdates: (missionId: string, listener: (mission: MissionRecord) => void) => () => void;
  publishMissionUpdated: (mission: MissionRecord) => void;
  setRequestAuthContext: (request: FastifyRequest, context: AuthRequestContext) => void;
  getRequestAuthContext: (request: FastifyRequest) => AuthRequestContext | null;
  parseBearerToken: (request: FastifyRequest) => string | null;
  resolveRequestRole: (request: FastifyRequest) => UserRole;
  ensureApiAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<ReturnType<typeof sendError> | null>;
  ensureMinRole: (request: FastifyRequest, reply: FastifyReply, requiredRole: UserRole) => ReturnType<typeof sendError> | null;
  ensureHighRiskRole: (request: FastifyRequest, reply: FastifyReply) => ReturnType<typeof sendError> | null;
  resolveRequestUserId: (request: FastifyRequest) => string;
  resolveRequestTraceId: (request: FastifyRequest) => string | undefined;
  resolveRequiredIdempotencyKey: (request: FastifyRequest) => string | null;
  resolveTaskCreateContext: (request: FastifyRequest) => { userId: string; idempotencyKey: string; traceId?: string };
  getEnvProviderApiKey: (provider: ProviderCredentialProvider) => string | undefined;
  loadRuntimeProviderApiKeys: () => Promise<Partial<Record<ProviderCredentialProvider, string>>>;
  applyStoredProviderKeys: () => Promise<void>;
  buildDashboardOverviewData: (request: FastifyRequest, input: { task_limit: number; pending_approval_limit: number; running_task_limit: number }) => Promise<DashboardOverview>;
  buildDashboardOverviewSignature: (snapshot: DashboardOverview) => string;
};

export type AuthRequestContext = {
  userId: string;
  role: UserRole;
  tokenHash?: string;
  authType: 'session' | 'static_token';
};

export type DashboardOverview = {
  generated_at: string;
  signals: {
    task_count: number;
    running_count: number;
    failed_count: number;
    blocked_count: number;
    pending_approval_count: number;
  };
  tasks: Array<{ id: string; status: string; mode: string; updatedAt: string; [key: string]: unknown }>;
  running_tasks: Array<{ id: string; status: string; mode: string; updatedAt: string; [key: string]: unknown }>;
  pending_approvals: Array<{ id: string; status: string; createdAt: string; approvedAt: string | null; [key: string]: unknown }>;
};

export const ROLE_RANK: Record<UserRole, number> = {
  member: 1,
  operator: 2,
  admin: 3
};

export const COUNCIL_ROLES: CouncilRole[] = ['planner', 'researcher', 'critic', 'risk'];

export const TASK_STATUS_VALUES = ['queued', 'running', 'blocked', 'retrying', 'done', 'failed', 'cancelled'] as const;

export const TASK_MODE_VALUES = [
  'chat', 'execute', 'council', 'code', 'compute',
  'long_run', 'high_risk', 'radar_review', 'upgrade_execution'
] as const;

export const UPGRADE_STATUS_VALUES = [
  'proposed', 'approved', 'planning', 'running', 'verifying',
  'deployed', 'failed', 'rolled_back', 'rejected'
] as const;

export const RUN_STATUS_VALUES = ['queued', 'running', 'completed', 'failed'] as const;
export const CONSENSUS_VALUES = ['consensus_reached', 'contradiction_detected', 'escalated_to_human'] as const;
export const RADAR_DECISION_VALUES = ['adopt', 'hold', 'discard'] as const;
export const PROVIDER_NAME_VALUES = ['openai', 'gemini', 'anthropic', 'local'] as const;

export function initCounter<T extends readonly string[]>(keys: T): Record<T[number], number> {
  const counter = {} as Record<T[number], number>;
  for (const key of keys as readonly T[number][]) {
    counter[key] = 0;
  }
  return counter;
}

export function truncateText(input: string, maxLength = 220): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}...`;
}

export function createSpanId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 16);
}

export function parseRoundProgress(summary: string): { round: number; maxRounds: number } | null {
  const match = summary.match(/^Round\s+(\d+)\/(\d+)\s+complete:/u);
  if (!match) return null;
  const round = Number.parseInt(match[1] ?? '', 10);
  const maxRounds = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(round) || !Number.isFinite(maxRounds) || round <= 0 || maxRounds <= 0) return null;
  return { round, maxRounds };
}

export function parseRoundLogCount(summary: string): number | null {
  const marker = 'Round log:\n';
  const markerIndex = summary.indexOf(marker);
  if (markerIndex < 0) return null;
  const logSection = summary.slice(markerIndex + marker.length);
  const matches = logSection.match(/^\d+\.\s+/gmu);
  if (!matches || matches.length === 0) return null;
  return matches.length;
}

export function resolveAssistantContextTaskType(intent: string): import('../providers/types').RoutingTaskType {
  const normalized = intent.trim().toLowerCase();
  if (normalized === 'code') return 'code';
  if (normalized === 'finance') return 'compute';
  if (normalized === 'research' || normalized === 'news') return 'radar_review';
  return 'execute';
}

export function buildTelegramReportSignature(report: {
  id: string;
  status: 'queued' | 'sent' | 'failed';
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  telegramMessageId?: string | null;
  sentAt?: string | null;
}): string {
  return [
    report.id, report.status, report.attemptCount, report.maxAttempts,
    report.nextAttemptAt ?? '', report.lastError ?? '',
    report.telegramMessageId ?? '', report.sentAt ?? ''
  ].join('|');
}

export function buildTelegramReportsSignature(
  reports: Array<{
    id: string;
    status: 'queued' | 'sent' | 'failed';
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    lastError: string | null;
    telegramMessageId?: string | null;
    sentAt?: string | null;
  }>
): string {
  return reports.map((r) => buildTelegramReportSignature(r)).join('::');
}

export function summarizeTelegramReports(
  reports: Array<{ status: 'queued' | 'sent' | 'failed' }>
): { queued: number; sent: number; failed: number } {
  let queued = 0; let sent = 0; let failed = 0;
  for (const r of reports) {
    if (r.status === 'queued') queued += 1;
    else if (r.status === 'sent') sent += 1;
    else if (r.status === 'failed') failed += 1;
  }
  return { queued, sent, failed };
}

export function buildDashboardTaskSignature(
  tasks: Array<{ id: string; status: string; mode: string; updatedAt: string }>
): string {
  return tasks.map((t) => `${t.id}:${t.status}:${t.mode}:${t.updatedAt}`).join('::');
}

export function buildDashboardApprovalSignature(
  proposals: Array<{ id: string; status: string; createdAt: string; approvedAt: string | null }>
): string {
  return proposals.map((p) => `${p.id}:${p.status}:${p.createdAt}:${p.approvedAt ?? ''}`).join('::');
}

export function buildMissionStepSignature(
  steps: Array<{ id: string; type: string; route: string; status: string; order: number }>
): string {
  return steps.map((s) => `${s.id}:${s.type}:${s.route}:${s.status}:${s.order}`).join('::');
}

export function buildMissionSignature(mission: {
  id: string;
  status: string;
  updatedAt: string;
  steps: Array<{ id: string; type: string; route: string; status: string; order: number }>;
}): string {
  return [mission.id, mission.status, mission.updatedAt, buildMissionStepSignature(mission.steps)].join('|');
}

export function normalizeUserRole(value: string | null | undefined): UserRole {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'member' || normalized === 'operator' || normalized === 'admin') return normalized;
  return 'member';
}

export function applySseCorsHeaders(request: FastifyRequest, reply: FastifyReply, env: AppEnv): void {
  const originHeader = request.headers.origin;
  if (typeof originHeader === 'string' && env.allowedOrigins.includes(originHeader)) {
    reply.raw.setHeader('Access-Control-Allow-Origin', originHeader);
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    reply.raw.setHeader('Vary', 'Origin');
  }

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
}

export type MissionDomain = 'code' | 'research' | 'finance' | 'news' | 'mixed';
export type MissionStepType = 'llm_generate' | 'council_debate' | 'human_gate' | 'tool_call' | 'sub_mission' | 'code' | 'research' | 'finance' | 'news' | 'approval' | 'execute';

export type UpgradeStatus =
  | 'proposed' | 'approved' | 'planning' | 'running'
  | 'verifying' | 'deployed' | 'failed' | 'rolled_back' | 'rejected';
