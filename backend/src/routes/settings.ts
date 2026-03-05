import type { FastifyInstance } from 'fastify';
import { sendSuccess } from '../lib/http';
import { getAiTraceCleanupWorkerStatus } from '../observability/ai-trace-worker';
import { getProviderTokenRefreshWorkerStatus } from '../providers/token-refresh-worker';
import type { RouteContext } from './types';

export async function settingsRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, env, providerRouter, resolveRequestProviderCredentials } = ctx;

  app.get('/api/v1/settings/overview', async (request, reply) => {
    const health = await store.health();
    const runtime = providerRouter.listRuntimeStats();
    const resolvedCredentials = await resolveRequestProviderCredentials(request);
    const scopedAvailability = providerRouter.listAvailability(resolvedCredentials.credentialsByProvider);
    const availabilityByProvider = new Map(scopedAvailability.map((item) => [item.provider, item] as const));
    const oauthWorker = getProviderTokenRefreshWorkerStatus();
    const aiTraceWorker = getAiTraceCleanupWorkerStatus();
    const notificationRuntime = ctx.notificationService?.getRuntimeStatus() ?? null;

    return sendSuccess(reply, request, 200, {
      generated_at: new Date().toISOString(),
      backend: {
        env: env.NODE_ENV,
        store: health.store,
        db: health.db,
        now: new Date().toISOString()
      },
      providers: runtime.map((item) => ({
        ...(availabilityByProvider.get(item.provider) ?? {}),
        provider: item.provider,
        enabled: availabilityByProvider.get(item.provider)?.enabled ?? item.enabled,
        model: availabilityByProvider.get(item.provider)?.model ?? item.model,
        reason: availabilityByProvider.get(item.provider)?.reason ?? item.reason,
        credential_source: resolvedCredentials.credentialsByProvider[item.provider]?.source ?? 'none',
        selected_credential_mode: resolvedCredentials.credentialsByProvider[item.provider]?.selectedCredentialMode ?? null,
        credential_priority: resolvedCredentials.credentialsByProvider[item.provider]?.credentialPriority ?? 'api_key_first',
        attempts: item.attempts,
        successes: item.successes,
        failures: item.failures,
        avg_latency_ms: item.avgLatencyMs,
        success_rate_pct: item.successRatePct,
        last_attempt_at: item.lastAttemptAt,
        cooldown_until: item.cooldownUntil,
        cooldown_reason: item.cooldownReason,
        health_failure_count: item.failureCount
      })),
      policies: {
        high_risk_requires_approval: true,
        approval_max_age_hours: env.APPROVAL_MAX_AGE_HOURS,
        high_risk_allowed_roles: env.highRiskAllowedRoles,
        provider_failover_auto: true,
        auth_required: env.AUTH_REQUIRED,
        auth_allow_signup: env.AUTH_ALLOW_SIGNUP,
        auth_token_configured: Boolean(env.AUTH_TOKEN?.trim())
      },
      oauth_worker: {
        ...oauthWorker,
        history: oauthWorker.history.slice(0, 5)
      },
      ai_trace_worker: {
        ...aiTraceWorker,
        history: aiTraceWorker.history.slice(0, 5)
      },
      notification_runtime: notificationRuntime
    });
  });
}
