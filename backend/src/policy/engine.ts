import { randomUUID } from 'node:crypto';

import type { V2PolicyDecision, V2RiskLevel } from '../store/types';

export type PolicyRuleRecordV2 = {
  id: string;
  policyKey: string;
  scope: string;
  actionPattern: string;
  minRiskLevel?: V2RiskLevel;
  decision: V2PolicyDecision;
  reason?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PolicyAuditRecordV2 = {
  id: string;
  action: string;
  input: Record<string, unknown>;
  decision: V2PolicyDecision;
  matchedRuleIds: string[];
  createdAt: string;
};

const RISK_RANK: Record<V2RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3
};

const DECISION_RANK: Record<V2PolicyDecision, number> = {
  allow: 1,
  approval_required: 2,
  deny: 3
};

function patternMatches(pattern: string, action: string): boolean {
  if (pattern === '*' || pattern === 'all') return true;
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*');
    return new RegExp(`^${escaped}$`, 'iu').test(action);
  }
  return pattern.toLowerCase() === action.toLowerCase();
}

export class PolicyEngineV2 {
  private readonly rules = new Map<string, PolicyRuleRecordV2>();
  private readonly audits: PolicyAuditRecordV2[] = [];

  listRules(): PolicyRuleRecordV2[] {
    return Array.from(this.rules.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  listAudits(limit = 100): PolicyAuditRecordV2[] {
    return this.audits.slice(-Math.max(1, limit)).reverse();
  }

  upsertRule(input: {
    policyKey: string;
    scope?: string;
    actionPattern: string;
    minRiskLevel?: V2RiskLevel;
    decision: V2PolicyDecision;
    reason?: string;
    enabled?: boolean;
  }): PolicyRuleRecordV2 {
    const now = new Date().toISOString();
    const existing = Array.from(this.rules.values()).find((rule) => rule.policyKey === input.policyKey) ?? null;
    const record: PolicyRuleRecordV2 = existing
      ? {
          ...existing,
          scope: input.scope ?? existing.scope,
          actionPattern: input.actionPattern,
          minRiskLevel: input.minRiskLevel,
          decision: input.decision,
          reason: input.reason,
          enabled: input.enabled ?? existing.enabled,
          updatedAt: now
        }
      : {
          id: randomUUID(),
          policyKey: input.policyKey,
          scope: input.scope ?? 'global',
          actionPattern: input.actionPattern,
          minRiskLevel: input.minRiskLevel,
          decision: input.decision,
          reason: input.reason,
          enabled: input.enabled ?? true,
          createdAt: now,
          updatedAt: now
        };
    this.rules.set(record.id, record);
    return record;
  }

  evaluate(input: {
    action: string;
    riskLevel: V2RiskLevel;
    scope?: string;
  }): {
    decision: V2PolicyDecision;
    matchedRuleIds: string[];
    reasons: string[];
  } {
    const scope = input.scope ?? 'global';
    const matched = this.listRules().filter((rule) => {
      if (!rule.enabled) return false;
      if (rule.scope !== 'global' && rule.scope !== scope) return false;
      if (!patternMatches(rule.actionPattern, input.action)) return false;
      if (rule.minRiskLevel && RISK_RANK[input.riskLevel] < RISK_RANK[rule.minRiskLevel]) return false;
      return true;
    });

    const winning = matched.sort((left, right) => DECISION_RANK[right.decision] - DECISION_RANK[left.decision])[0];
    const decision: V2PolicyDecision = winning?.decision ?? 'allow';
    const reasons = matched.map((rule) => rule.reason).filter((reason): reason is string => Boolean(reason));
    const matchedRuleIds = matched.map((rule) => rule.id);

    this.audits.push({
      id: randomUUID(),
      action: input.action,
      input: {
        risk_level: input.riskLevel,
        scope
      },
      decision,
      matchedRuleIds,
      createdAt: new Date().toISOString()
    });

    return {
      decision,
      matchedRuleIds,
      reasons
    };
  }
}

let sharedPolicyEngine: PolicyEngineV2 | null = null;

export function getSharedPolicyEngine(): PolicyEngineV2 {
  if (!sharedPolicyEngine) {
    sharedPolicyEngine = new PolicyEngineV2();
  }
  return sharedPolicyEngine;
}
