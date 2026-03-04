import type { V2ExecutionContractRecord, V2TeamRole } from '../store/types';

export type TeamAssignmentV2 = {
  role: V2TeamRole;
  reason: string;
  weight: number;
};

export type TeamPlanV2 = {
  roles: TeamAssignmentV2[];
  dag: Array<{
    id: V2TeamRole;
    depends_on: V2TeamRole[];
  }>;
  arbitration: {
    max_rounds: number;
    weighted: boolean;
  };
};

const ROLE_ORDER: V2TeamRole[] = ['planner', 'researcher', 'coder', 'critic', 'risk', 'synthesizer'];

function hasDomainSignal(contract: V2ExecutionContractRecord, domain: 'code' | 'research' | 'finance' | 'news'): boolean {
  return (contract.domainMix[domain] ?? 0) >= 0.3 || contract.intent === domain;
}

export function composeTeamPlan(contract: V2ExecutionContractRecord): TeamPlanV2 {
  const selected = new Map<V2TeamRole, TeamAssignmentV2>();
  const addRole = (role: V2TeamRole, reason: string, weight: number) => {
    if (!selected.has(role)) {
      selected.set(role, { role, reason, weight });
    }
  };

  addRole('planner', 'always_required_for_task_planning', 1);
  addRole('critic', 'always_required_for_quality_control', 0.9);

  if (hasDomainSignal(contract, 'research') || hasDomainSignal(contract, 'news') || hasDomainSignal(contract, 'finance')) {
    addRole('researcher', 'domain_requires_evidence_collection', 0.95);
  }
  if (hasDomainSignal(contract, 'code')) {
    addRole('coder', 'domain_requires_code_execution', 1);
  }
  if (contract.riskLevel === 'high' || contract.intent === 'finance' || (contract.domainMix.finance ?? 0) >= 0.3) {
    addRole('risk', 'high_risk_or_finance_requires_guardrail_review', 1);
  }

  // Ensure at least one domain worker is selected.
  if (!selected.has('researcher') && !selected.has('coder')) {
    addRole('researcher', 'fallback_general_analysis_role', 0.8);
  }

  addRole('synthesizer', 'always_required_for_final_merge', 1);

  const roles = ROLE_ORDER.flatMap((role) => {
    const item = selected.get(role);
    return item ? [item] : [];
  });
  const workerRoles = roles.map((item) => item.role).filter((role) => role !== 'planner' && role !== 'synthesizer');

  const dag: TeamPlanV2['dag'] = [];
  for (const role of ROLE_ORDER) {
    if (!selected.has(role)) continue;
    if (role === 'planner') {
      dag.push({ id: role, depends_on: [] });
      continue;
    }
    if (role === 'synthesizer') {
      dag.push({ id: role, depends_on: [...workerRoles] });
      continue;
    }
    dag.push({ id: role, depends_on: ['planner'] });
  }

  return {
    roles,
    dag,
    arbitration: {
      max_rounds: 2,
      weighted: true
    }
  };
}
