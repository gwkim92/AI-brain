import type { V2RiskLevel } from '../store/types';

export type CodeLoopPolicyInput = {
  riskLevel: V2RiskLevel;
  changedFiles: string[];
  policyViolations?: string[];
};

export type CodeLoopPolicyDecision = {
  requiresApproval: boolean;
  reasons: string[];
};

const SENSITIVE_PATH_PATTERN =
  /(auth|payment|billing|secret|credential|token|apikey|key|wallet|invoice|compliance|rbac|permission|\.env)/iu;

export function evaluateCodeLoopPolicy(input: CodeLoopPolicyInput): CodeLoopPolicyDecision {
  const reasons = new Set<string>();

  if (input.riskLevel === 'high') {
    reasons.add('high_risk_contract');
  }
  if (input.changedFiles.some((path) => SENSITIVE_PATH_PATTERN.test(path))) {
    reasons.add('sensitive_path_change');
  }
  for (const violation of input.policyViolations ?? []) {
    if (violation.trim()) reasons.add(`policy_violation:${violation.trim()}`);
  }

  return {
    requiresApproval: reasons.size > 0,
    reasons: Array.from(reasons)
  };
}
