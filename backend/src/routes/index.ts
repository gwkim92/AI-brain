import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { hashSessionToken } from '../auth/crypto';
import { decryptSecretValue } from '../auth/secrets';
import type { AppEnv } from '../config/env';
import { createTelegramCallbackReplayGuard } from '../integrations/telegram/commands';
import { sendError } from '../lib/http';
import type { ProviderRouter } from '../providers/router';
import type { NotificationService } from '../notifications/proactive';
import type {
  JarvisStore,
  MissionRecord,
  ProviderCredentialProvider,
  UserRole
} from '../store/types';

import type { RouteContext, AuthRequestContext, DashboardOverview } from './types';
import {
  ROLE_RANK,
  PROVIDER_NAME_VALUES,
  normalizeUserRole,
  buildDashboardTaskSignature,
  buildDashboardApprovalSignature
} from './types';

import { healthRoutes } from './health';
import { notificationRoutes } from './notifications';
import { mcpRoutes } from './mcp';
import { authRoutes } from './auth';
import { providerRoutes } from './providers';
import { settingsRoutes } from './settings';
import { dashboardRoutes } from './dashboard';
import { adminCredentialRoutes } from './admin-credentials';
import { aiRoutes } from './ai';
import { missionRoutes } from './missions';
import { assistantRoutes } from './assistant';
import { councilRoutes } from './councils';
import { executionRoutes } from './executions';
import { taskRoutes } from './tasks';
import { memoryRoutes } from './memory';
import { approvalRoutes } from './approvals';
import { reportRoutes } from './reports';
import { radarRoutes } from './radar';
import { upgradeRoutes } from './upgrades';
import { integrationRoutes } from './integrations';

export async function registerRoutes(
  app: FastifyInstance,
  store: JarvisStore,
  env: AppEnv,
  providerRouter: ProviderRouter,
  notificationService?: NotificationService
): Promise<void> {
  const authContexts = new Map<string, AuthRequestContext>();
  const assistantContextRunsInFlight = new Set<string>();
  const telegramCallbackReplayGuard = createTelegramCallbackReplayGuard();
  const missionSubscribers = new Map<string, Set<(mission: MissionRecord) => void>>();
  const missionExecutionsInFlight = new Set<string>();

  const subscribeMissionUpdates = (missionId: string, listener: (mission: MissionRecord) => void) => {
    const listeners = missionSubscribers.get(missionId) ?? new Set<(mission: MissionRecord) => void>();
    listeners.add(listener);
    missionSubscribers.set(missionId, listeners);
    return () => {
      const current = missionSubscribers.get(missionId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) missionSubscribers.delete(missionId);
    };
  };

  const publishMissionUpdated = (mission: MissionRecord) => {
    const listeners = missionSubscribers.get(mission.id);
    if (!listeners || listeners.size === 0) return;
    for (const listener of listeners) listener(mission);
  };

  const setRequestAuthContext = (request: FastifyRequest, context: AuthRequestContext) => {
    authContexts.set(request.id, context);
  };

  const getRequestAuthContext = (request: FastifyRequest): AuthRequestContext | null => {
    return authContexts.get(request.id) ?? null;
  };

  const parseBearerToken = (request: FastifyRequest): string | null => {
    const header = request.headers.authorization;
    if (typeof header !== 'string') return null;
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const token = match[1]?.trim();
    return token && token.length > 0 ? token : null;
  };

  const resolveRequestRole = (request: FastifyRequest): UserRole => {
    const auth = getRequestAuthContext(request);
    if (auth?.authType === 'session') return auth.role;
    const header = request.headers['x-user-role'];
    if (typeof header === 'string' && header.trim().length > 0) return normalizeUserRole(header);
    if (auth?.role) return auth.role;
    return 'member';
  };

  const ensureApiAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const providedToken = parseBearerToken(request);
    const configuredToken = env.AUTH_TOKEN?.trim();

    if (providedToken && configuredToken && providedToken === configuredToken) {
      setRequestAuthContext(request, { userId: env.DEFAULT_USER_ID, role: 'admin', authType: 'static_token' });
      return null;
    }

    if (providedToken) {
      const session = await store.getAuthSessionByTokenHash(hashSessionToken(providedToken));
      if (session) {
        setRequestAuthContext(request, {
          userId: session.user.id,
          role: session.user.role,
          tokenHash: session.tokenHash,
          authType: 'session'
        });
        return null;
      }
    }

    if (env.AUTH_REQUIRED) {
      return sendError(reply, request, 401, 'UNAUTHORIZED', 'invalid bearer token');
    }

    return null;
  };

  const ensureMinRole = (request: FastifyRequest, reply: FastifyReply, requiredRole: UserRole) => {
    const currentRole = resolveRequestRole(request);
    if (ROLE_RANK[currentRole] >= ROLE_RANK[requiredRole]) return null;
    return sendError(reply, request, 403, 'FORBIDDEN', 'insufficient role', {
      current_role: currentRole,
      required_role: requiredRole
    });
  };

  const ensureHighRiskRole = (request: FastifyRequest, reply: FastifyReply) => {
    const role = resolveRequestRole(request);
    if (env.highRiskAllowedRoles.includes(role)) return null;
    return sendError(reply, request, 403, 'FORBIDDEN', 'insufficient role for high-risk action', {
      current_role: role,
      required_roles: env.highRiskAllowedRoles
    });
  };

  const getEnvProviderApiKey = (provider: ProviderCredentialProvider): string | undefined => {
    if (provider === 'openai') return env.OPENAI_API_KEY;
    if (provider === 'gemini') return env.GEMINI_API_KEY;
    if (provider === 'anthropic') return env.ANTHROPIC_API_KEY;
    return env.LOCAL_LLM_API_KEY;
  };

  const loadRuntimeProviderApiKeys = async (): Promise<Partial<Record<ProviderCredentialProvider, string>>> => {
    const rows = await store.listProviderCredentials();
    const resolved: Partial<Record<ProviderCredentialProvider, string>> = {};
    for (const row of rows) {
      try {
        const decrypted = decryptSecretValue(row.encryptedApiKey, env.SECRETS_ENCRYPTION_KEY).trim();
        if (decrypted.length > 0) resolved[row.provider] = decrypted;
      } catch { continue; }
    }
    return resolved;
  };

  const applyStoredProviderKeys = async (): Promise<void> => {
    const runtimeKeys = await loadRuntimeProviderApiKeys();
    for (const provider of PROVIDER_NAME_VALUES) {
      const runtimeValue = runtimeKeys[provider];
      if (runtimeValue) providerRouter.setProviderApiKey(provider, runtimeValue);
    }
  };

  await applyStoredProviderKeys();

  const resolveRequestUserId = (request: FastifyRequest): string => {
    const auth = getRequestAuthContext(request);
    if (auth?.userId) return auth.userId;
    const header = request.headers['x-user-id'];
    return typeof header === 'string' ? header : env.DEFAULT_USER_ID;
  };

  const resolveRequestTraceId = (request: FastifyRequest): string | undefined => {
    const traceHeader = request.headers['x-trace-id'];
    return typeof traceHeader === 'string' ? traceHeader : undefined;
  };

  const resolveRequiredIdempotencyKey = (request: FastifyRequest): string | null => {
    const header = request.headers['idempotency-key'];
    if (typeof header !== 'string') return null;
    const normalized = header.trim();
    if (normalized.length < 8 || normalized.length > 200) return null;
    return normalized;
  };

  const resolveTaskCreateContext = (request: FastifyRequest): { userId: string; idempotencyKey: string; traceId?: string } => {
    const userId = resolveRequestUserId(request);
    const idempotencyKey = resolveRequiredIdempotencyKey(request) ?? randomUUID();
    const traceId = resolveRequestTraceId(request);
    return { userId, idempotencyKey, traceId };
  };

  const buildDashboardOverviewData = async (
    request: FastifyRequest,
    input: { task_limit: number; pending_approval_limit: number; running_task_limit: number }
  ): Promise<DashboardOverview> => {
    const userRole = resolveRequestRole(request);
    const [tasks, pendingApprovals] = await Promise.all([
      store.listTasks({ limit: input.task_limit, status: undefined }),
      ROLE_RANK[userRole] >= ROLE_RANK.operator
        ? store.listUpgradeProposals('proposed')
        : Promise.resolve([])
    ]);

    const runningTasks = tasks
      .filter((t) => t.status === 'running' || t.status === 'retrying')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, input.running_task_limit);

    const blockedCount = tasks.filter((t) => t.status === 'blocked').length;
    const failedCount = tasks.filter((t) => t.status === 'failed' || t.status === 'cancelled').length;
    const runningCount = tasks.filter((t) => t.status === 'running' || t.status === 'retrying').length;

    return {
      generated_at: new Date().toISOString(),
      signals: {
        task_count: tasks.length,
        running_count: runningCount,
        failed_count: failedCount,
        blocked_count: blockedCount,
        pending_approval_count: pendingApprovals.length
      },
      tasks,
      running_tasks: runningTasks,
      pending_approvals: pendingApprovals.slice(0, input.pending_approval_limit)
    };
  };

  const buildDashboardOverviewSignature = (snapshot: DashboardOverview): string => {
    return [
      snapshot.signals.task_count,
      snapshot.signals.running_count,
      snapshot.signals.failed_count,
      snapshot.signals.blocked_count,
      snapshot.signals.pending_approval_count,
      buildDashboardTaskSignature(snapshot.tasks),
      buildDashboardApprovalSignature(snapshot.pending_approvals)
    ].join('|');
  };

  const ctx: RouteContext = {
    store,
    env,
    providerRouter,
    notificationService,
    authContexts,
    assistantContextRunsInFlight,
    telegramCallbackReplayGuard,
    missionSubscribers,
    missionExecutionsInFlight,
    subscribeMissionUpdates,
    publishMissionUpdated,
    setRequestAuthContext,
    getRequestAuthContext,
    parseBearerToken,
    resolveRequestRole,
    ensureApiAuth,
    ensureMinRole,
    ensureHighRiskRole,
    resolveRequestUserId,
    resolveRequestTraceId,
    resolveRequiredIdempotencyKey,
    resolveTaskCreateContext,
    getEnvProviderApiKey,
    loadRuntimeProviderApiKeys,
    applyStoredProviderKeys,
    buildDashboardOverviewData,
    buildDashboardOverviewSignature,
  };

  // Auth hook
  app.addHook('onRequest', async (request, reply) => {
    const requestPath = request.url.split('?')[0] ?? request.url;
    if (!requestPath.startsWith('/api/v1/')) return;
    if (requestPath === '/api/v1/auth/signup' || requestPath === '/api/v1/auth/login') return;
    if (requestPath === '/api/v1/integrations/openai/webhook' || requestPath === '/api/v1/integrations/telegram/webhook') return;
    const authError = await ensureApiAuth(request, reply);
    if (authError) return authError;
  });

  app.addHook('onResponse', async (request) => {
    authContexts.delete(request.id);
  });

  // Register all domain route plugins
  await healthRoutes(app, ctx);
  await notificationRoutes(app, ctx);
  await mcpRoutes(app, ctx);
  await authRoutes(app, ctx);
  await providerRoutes(app, ctx);
  await settingsRoutes(app, ctx);
  await dashboardRoutes(app, ctx);
  await adminCredentialRoutes(app, ctx);
  await aiRoutes(app, ctx);
  await missionRoutes(app, ctx);
  await assistantRoutes(app, ctx);
  await councilRoutes(app, ctx);
  await executionRoutes(app, ctx);
  await taskRoutes(app, ctx);
  await memoryRoutes(app, ctx);
  await approvalRoutes(app, ctx);
  await reportRoutes(app, ctx);
  await radarRoutes(app, ctx);
  await upgradeRoutes(app, ctx);
  await integrationRoutes(app, ctx);
}
