import { randomUUID } from 'node:crypto';

import type {
  CreateMissionInput,
  MissionContractRecord,
  MissionContractUpdateInput,
  MissionRecord,
  UpdateMissionInput
} from '../types';
import type { MissionRepositoryContract } from '../repository-contracts';
import type { MemoryStoreState } from './state';

type MemoryMissionRepositoryDeps = {
  state: MemoryStoreState;
  defaultUserId: string;
  nowIso: () => string;
};

function normalizeMissionContract(value?: MissionContractRecord | null): MissionContractRecord {
  const allowedApproverRoles = new Set(['operator', 'admin']);
  const constraintsInput = value?.constraints;
  const approvalInput = value?.approvalPolicy;

  const allowedTools = Array.isArray(constraintsInput?.allowedTools)
    ? constraintsInput.allowedTools.filter((tool): tool is string => typeof tool === 'string' && tool.trim().length > 0)
    : undefined;

  const approverRoles = Array.isArray(approvalInput?.approverRoles)
    ? approvalInput.approverRoles
        .filter((role): role is 'operator' | 'admin' => typeof role === 'string' && allowedApproverRoles.has(role))
        .filter((role, index, arr) => arr.indexOf(role) === index)
    : undefined;

  return {
    constraints: {
      maxCostUsd: typeof constraintsInput?.maxCostUsd === 'number' ? constraintsInput.maxCostUsd : undefined,
      deadlineAt: typeof constraintsInput?.deadlineAt === 'string' ? constraintsInput.deadlineAt : undefined,
      allowedTools,
      maxRetriesPerStep:
        typeof constraintsInput?.maxRetriesPerStep === 'number' ? constraintsInput.maxRetriesPerStep : undefined
    },
    approvalPolicy: {
      mode:
        approvalInput?.mode === 'auto' || approvalInput?.mode === 'required_for_all'
          ? approvalInput.mode
          : 'required_for_high_risk',
      approverRoles
    }
  };
}

function mergeMissionContract(current: MissionContractRecord, patch?: MissionContractUpdateInput): MissionContractRecord {
  if (!patch) {
    return current;
  }

  return normalizeMissionContract({
    constraints: {
      ...current.constraints,
      ...(patch.constraints ?? {})
    },
    approvalPolicy: {
      ...current.approvalPolicy,
      ...(patch.approvalPolicy ?? {})
    }
  });
}

export function createMemoryMissionRepository({
  state,
  defaultUserId,
  nowIso
}: MemoryMissionRepositoryDeps): MissionRepositoryContract {
  return {
    async createMission(input: CreateMissionInput) {
      const now = nowIso();
      const mission: MissionRecord = {
        id: randomUUID(),
        userId: input.userId || defaultUserId,
        workspaceId: input.workspaceId ?? null,
        title: input.title,
        objective: input.objective,
        domain: input.domain,
        status: input.status ?? 'draft',
        missionContract: normalizeMissionContract(input.missionContract),
        steps: input.steps
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((step, index) => ({
            id: step.id || randomUUID(),
            type: step.type,
            title: step.title,
            description: step.description ?? '',
            route: step.route,
            taskType: step.taskType,
            metadata: step.metadata,
            status: step.status ?? 'pending',
            order: index + 1
          })),
        createdAt: now,
        updatedAt: now
      };

      state.missions.set(mission.id, mission);
      return mission;
    },

    async listMissions(input) {
      return [...state.missions.values()]
        .filter((item) => item.userId === input.userId)
        .filter((item) => (input.status ? item.status === input.status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit);
    },

    async getMissionById(input: { missionId: string; userId: string }) {
      const mission = state.missions.get(input.missionId);
      if (!mission || mission.userId !== input.userId) {
        return null;
      }
      return mission;
    },

    async updateMission(input: UpdateMissionInput) {
      const mission = state.missions.get(input.missionId);
      if (!mission || mission.userId !== input.userId) {
        return null;
      }

      const stepStatusMap = new Map((input.stepStatuses ?? []).map((item) => [item.stepId, item.status]));
      const nextSteps = mission.steps.map((step) => {
        const nextStatus = stepStatusMap.get(step.id);
        if (!nextStatus) {
          return step;
        }
        return {
          ...step,
          status: nextStatus
        };
      });

      const next: MissionRecord = {
        ...mission,
        status: input.status ?? mission.status,
        title: input.title ?? mission.title,
        objective: input.objective ?? mission.objective,
        missionContract: mergeMissionContract(mission.missionContract, input.missionContract),
        steps: nextSteps,
        updatedAt: nowIso()
      };

      state.missions.set(next.id, next);
      return next;
    }
  };
}
