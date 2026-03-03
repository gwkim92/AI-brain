import type { FastifyInstance } from 'fastify';
import { sendSuccess } from '../lib/http';
import type { RouteContext } from './types';

export async function settingsRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { store, env, providerRouter } = ctx;

  app.get('/api/v1/settings/overview', async (request, reply) => {
    const health = await store.health();
    const runtime = providerRouter.listRuntimeStats();

    return sendSuccess(reply, request, 200, {
      generated_at: new Date().toISOString(),
      backend: {
        env: env.NODE_ENV,
        store: health.store,
        db: health.db,
        now: new Date().toISOString()
      },
      providers: runtime.map((item) => ({
        provider: item.provider,
        enabled: item.enabled,
        model: item.model,
        reason: item.reason,
        attempts: item.attempts,
        successes: item.successes,
        failures: item.failures,
        avg_latency_ms: item.avgLatencyMs,
        success_rate_pct: item.successRatePct,
        last_attempt_at: item.lastAttemptAt
      })),
      policies: {
        high_risk_requires_approval: true,
        approval_max_age_hours: env.APPROVAL_MAX_AGE_HOURS,
        high_risk_allowed_roles: env.highRiskAllowedRoles,
        provider_failover_auto: true,
        auth_required: env.AUTH_REQUIRED,
        auth_allow_signup: env.AUTH_ALLOW_SIGNUP,
        auth_token_configured: Boolean(env.AUTH_TOKEN?.trim())
      }
    });
  });
}
