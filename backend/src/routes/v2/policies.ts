import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sendError, sendSuccess } from '../../lib/http';
import { getSharedPolicyEngine } from '../../policy/engine';
import type { V2RouteContext } from './types';

const UpsertPolicySchema = z.object({
  scope: z.string().min(1).max(120).optional(),
  action_pattern: z.string().min(1).max(200),
  min_risk_level: z.enum(['low', 'medium', 'high']).optional(),
  decision: z.enum(['allow', 'deny', 'approval_required']),
  reason: z.string().min(1).max(500).optional(),
  enabled: z.boolean().optional()
});

const PolicyEvaluateSchema = z.object({
  action: z.string().min(1).max(200),
  risk_level: z.enum(['low', 'medium', 'high']),
  scope: z.string().min(1).max(120).optional()
});

const RuleParamsSchema = z.object({
  policyKey: z.string().min(1).max(120)
});

const AuditsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100)
});

const policyEngine = getSharedPolicyEngine();

export async function registerV2PolicyRoutes(app: FastifyInstance, ctx: V2RouteContext): Promise<void> {
  app.get('/api/v2/policies/rules', async (request, reply) => {
    return sendSuccess(reply, request, 200, {
      rules: policyEngine.listRules()
    });
  });

  app.put('/api/v2/policies/rules/:policyKey', async (request, reply) => {
    const minRoleError = ctx.ensureMinRole(request, reply, 'operator');
    if (minRoleError) return minRoleError;

    const parsedParams = RuleParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid policy key', parsedParams.error.flatten());
    }
    const parsedBody = UpsertPolicySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid policy payload', parsedBody.error.flatten());
    }

    const record = policyEngine.upsertRule({
      policyKey: parsedParams.data.policyKey,
      scope: parsedBody.data.scope,
      actionPattern: parsedBody.data.action_pattern,
      minRiskLevel: parsedBody.data.min_risk_level,
      decision: parsedBody.data.decision,
      reason: parsedBody.data.reason,
      enabled: parsedBody.data.enabled
    });

    return sendSuccess(reply, request, 200, {
      rule: record
    });
  });

  app.post('/api/v2/policies/evaluate', async (request, reply) => {
    const parsed = PolicyEvaluateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid policy evaluate payload', parsed.error.flatten());
    }

    const result = policyEngine.evaluate({
      action: parsed.data.action,
      riskLevel: parsed.data.risk_level,
      scope: parsed.data.scope
    });

    return sendSuccess(reply, request, 200, {
      decision: result.decision,
      matched_rule_ids: result.matchedRuleIds,
      reasons: result.reasons
    });
  });

  app.get('/api/v2/policies/audits', async (request, reply) => {
    const parsed = AuditsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid audits query', parsed.error.flatten());
    }

    return sendSuccess(reply, request, 200, {
      audits: policyEngine.listAudits(parsed.data.limit)
    });
  });
}
