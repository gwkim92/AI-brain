import { randomUUID } from 'node:crypto';

import { runDag, type DagStep } from '../orchestrator/dag-runner';
import type { V2ExecutionContractRecord, V2RunStatus, V2TeamRole } from '../store/types';
import { arbitrateTeamOutputs, type ArbitrationDecisionV2, type TeamRoleOutputV2 } from './arbitration';
import type { TeamPlanV2 } from './composer';

export type TeamRunEventV2 = {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
};

export type TeamRunRecordV2 = {
  id: string;
  userId: string;
  contractId: string;
  prompt: string;
  plan: TeamPlanV2;
  status: V2RunStatus;
  arbitrationRounds: number;
  escalatedToHuman: boolean;
  selectedRole: V2TeamRole | null;
  synthesizedOutput: string | null;
  roleOutputs: TeamRoleOutputV2[];
  events: TeamRunEventV2[];
  createdAt: string;
  updatedAt: string;
};

const BASE_ROLE_CONFIDENCE: Record<V2TeamRole, number> = {
  planner: 0.75,
  researcher: 0.72,
  coder: 0.78,
  critic: 0.69,
  risk: 0.81,
  synthesizer: 0.8
};

function isTeamRoleOutput(value: unknown): value is TeamRoleOutputV2 {
  if (!value || typeof value !== 'object') return false;
  if (!('role' in value) || !('output' in value) || !('confidence' in value)) return false;
  return true;
}

function summarizeDependencyResults(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return 'none';
  return keys.slice(0, 4).join(', ');
}

function executeRoleStep(input: {
  role: V2TeamRole;
  prompt: string;
  contract: V2ExecutionContractRecord;
  dependencyResults: Record<string, unknown>;
}): TeamRoleOutputV2 {
  const base = BASE_ROLE_CONFIDENCE[input.role] ?? 0.7;
  const dependencyBoost = Math.min(0.08, Object.keys(input.dependencyResults).length * 0.02);
  const riskBoost = input.contract.riskLevel === 'high' && input.role === 'risk' ? 0.1 : 0;
  const confidence = Math.min(0.98, Number((base + dependencyBoost + riskBoost).toFixed(3)));
  const deps = summarizeDependencyResults(input.dependencyResults);

  const rolePrefix: Record<V2TeamRole, string> = {
    planner: 'Execution Plan',
    researcher: 'Evidence Summary',
    coder: 'Implementation Strategy',
    critic: 'Critical Review',
    risk: 'Risk Assessment',
    synthesizer: 'Integrated Conclusion'
  };

  return {
    role: input.role,
    confidence,
    output: `${rolePrefix[input.role]}:\nPrompt="${input.prompt}"\nDependencies=${deps}\nIntent=${input.contract.intent}`
  };
}

export class TeamRunEngineV2 {
  private readonly runs = new Map<string, TeamRunRecordV2>();

  getRun(runId: string): TeamRunRecordV2 | null {
    return this.runs.get(runId) ?? null;
  }

  async startRun(input: {
    userId: string;
    contract: V2ExecutionContractRecord;
    prompt: string;
    plan: TeamPlanV2;
  }): Promise<TeamRunRecordV2> {
    const now = new Date().toISOString();
    const runId = randomUUID();
    const events: TeamRunEventV2[] = [];
    const pushEvent = (type: string, data: Record<string, unknown>) => {
      events.push({
        id: randomUUID(),
        type,
        timestamp: new Date().toISOString(),
        data
      });
    };

    const record: TeamRunRecordV2 = {
      id: runId,
      userId: input.userId,
      contractId: input.contract.id,
      prompt: input.prompt,
      plan: input.plan,
      status: 'running',
      arbitrationRounds: 0,
      escalatedToHuman: false,
      selectedRole: null,
      synthesizedOutput: null,
      roleOutputs: [],
      events,
      createdAt: now,
      updatedAt: now
    };
    this.runs.set(runId, record);
    pushEvent('team.run.started', {
      run_id: runId,
      role_count: input.plan.roles.length
    });

    try {
      const steps: DagStep[] = input.plan.dag.map((node) => ({
        id: node.id,
        dependencies: node.depends_on,
        run: async ({ dependencyResults }) => {
          pushEvent('team.role.started', { run_id: runId, role: node.id });
          const roleOutput = executeRoleStep({
            role: node.id,
            prompt: input.prompt,
            contract: input.contract,
            dependencyResults
          });
          pushEvent('team.role.completed', {
            run_id: runId,
            role: node.id,
            confidence: roleOutput.confidence
          });
          return roleOutput;
        }
      }));

      const dagResult = await runDag(steps, { maxConcurrency: 4, failFast: true });
      const roleOutputs = Object.values(dagResult.results)
        .filter(isTeamRoleOutput)
        .filter((value) => value.role !== 'synthesizer');
      record.roleOutputs = roleOutputs;

      const maxRounds = input.plan.arbitration.max_rounds;
      let round = 1;
      let arbitrationDecision: ArbitrationDecisionV2 | null = null;
      let mutableOutputs = [...roleOutputs];
      while (round <= maxRounds) {
        arbitrationDecision = arbitrateTeamOutputs({
          outputs: mutableOutputs,
          round,
          maxRounds
        });
        pushEvent('team.arbitration.round.completed', {
          run_id: runId,
          round,
          status: arbitrationDecision.status,
          rationale: arbitrationDecision.rationale
        });

        if (arbitrationDecision.status === 'resolved' || arbitrationDecision.status === 'escalated') {
          break;
        }

        mutableOutputs = mutableOutputs.map((item) => ({
          ...item,
          confidence: Math.min(0.99, Number((item.confidence + 0.05).toFixed(3))),
          output: `${item.output}\n[refined round ${round + 1}]`
        }));
        round += 1;
      }

      record.arbitrationRounds = arbitrationDecision?.round ?? 0;
      record.selectedRole = arbitrationDecision?.selected?.role ?? null;
      record.escalatedToHuman = arbitrationDecision?.status === 'escalated';
      const synthesized = dagResult.results.synthesizer;
      record.synthesizedOutput =
        synthesized && typeof synthesized === 'object' && 'output' in synthesized
          ? String((synthesized as TeamRoleOutputV2).output)
          : null;
      record.status = record.escalatedToHuman ? 'blocked' : 'completed';
      record.updatedAt = new Date().toISOString();

      pushEvent(record.escalatedToHuman ? 'team.run.escalated' : 'team.run.completed', {
        run_id: runId,
        status: record.status,
        arbitration_rounds: record.arbitrationRounds,
        selected_role: record.selectedRole
      });
    } catch (error) {
      record.status = 'failed';
      record.updatedAt = new Date().toISOString();
      pushEvent('team.run.failed', {
        run_id: runId,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return record;
  }
}

let sharedTeamRunEngine: TeamRunEngineV2 | null = null;

export function getSharedTeamRunEngine(): TeamRunEngineV2 {
  if (!sharedTeamRunEngine) {
    sharedTeamRunEngine = new TeamRunEngineV2();
  }
  return sharedTeamRunEngine;
}
