import type { Pool } from 'pg';

import type { MissionRepositoryContract } from '../repository-contracts';
import type { MissionRow, MissionStepRow } from './types';
import type {
  CreateMissionInput,
  MissionContractRecord,
  MissionContractUpdateInput,
  MissionRecord,
  MissionStepRecord,
  UpdateMissionInput
} from '../types';

type MissionRepositoryDeps = {
  pool: Pool;
  defaultUserId: string;
};

export function createMissionRepository({ pool, defaultUserId }: MissionRepositoryDeps): MissionRepositoryContract {
  return {
    async createMission(input: CreateMissionInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { rows } = await client.query<MissionRow>(
          `
            INSERT INTO missions (
              user_id,
              workspace_id,
              title,
              objective,
              domain,
              status,
              mission_contract
            )
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
            RETURNING id, user_id, workspace_id, title, objective, domain, status, mission_contract, created_at, updated_at
          `,
          [
            input.userId || defaultUserId,
            input.workspaceId ?? null,
            input.title,
            input.objective,
            input.domain,
            input.status ?? 'draft',
            JSON.stringify(normalizeMissionContract(input.missionContract))
          ]
        );

        const missionRow = rows[0];
        if (!missionRow) {
          throw new Error('failed to create mission');
        }

        const normalizedSteps = input.steps
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((step, index) => ({
            id: step.id,
            type: step.type,
            title: step.title,
            description: step.description ?? '',
            route: step.route,
            status: step.status ?? 'pending',
            order: index + 1,
            taskType: step.taskType,
            metadata: step.metadata
          }));

        for (const step of normalizedSteps) {
          await client.query(
            `
              INSERT INTO mission_steps (
                id,
                mission_id,
                step_type,
                title,
                description,
                route,
                status,
                step_order,
                task_type,
                metadata
              )
              VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
            `,
            [
              step.id,
              missionRow.id,
              step.type,
              step.title,
              step.description,
              step.route,
              step.status,
              step.order,
              step.taskType ?? null,
              JSON.stringify(step.metadata ?? {})
            ]
          );
        }

        const stepRows = await client.query<MissionStepRow>(
          `
            SELECT
              id, mission_id, step_type, title, description, route, status, step_order, task_type, metadata, created_at, updated_at
            FROM mission_steps
            WHERE mission_id = $1::uuid
            ORDER BY step_order ASC
          `,
          [missionRow.id]
        );

        await client.query('COMMIT');
        return mapMissionRow(missionRow, stepRows.rows);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listMissions(input) {
      const params: unknown[] = [input.userId, input.limit];
      let where = '';
      if (input.status) {
        params.splice(1, 0, input.status);
        where = 'AND status = $2';
      }

      const missionLimitParam = input.status ? '$3' : '$2';
      const { rows } = await pool.query<MissionRow>(
        `
          SELECT id, user_id, workspace_id, title, objective, domain, status, mission_contract, created_at, updated_at
          FROM missions
          WHERE user_id = $1::uuid
          ${where}
          ORDER BY updated_at DESC
          LIMIT ${missionLimitParam}
        `,
        params
      );

      if (rows.length === 0) {
        return [];
      }

      const missionIds = rows.map((item) => item.id);
      const stepRows = await pool.query<MissionStepRow>(
        `
          SELECT
            id, mission_id, step_type, title, description, route, status, step_order, task_type, metadata, created_at, updated_at
          FROM mission_steps
          WHERE mission_id = ANY($1::uuid[])
          ORDER BY mission_id ASC, step_order ASC
        `,
        [missionIds]
      );

      const stepMap = groupMissionSteps(stepRows.rows);
      return rows.map((row) => mapMissionRow(row, stepMap.get(row.id) ?? []));
    },

    async getMissionById(input: { missionId: string; userId: string }) {
      const { rows } = await pool.query<MissionRow>(
        `
          SELECT id, user_id, workspace_id, title, objective, domain, status, mission_contract, created_at, updated_at
          FROM missions
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          LIMIT 1
        `,
        [input.missionId, input.userId]
      );

      const mission = rows[0];
      if (!mission) {
        return null;
      }

      const stepRows = await pool.query<MissionStepRow>(
        `
          SELECT
            id, mission_id, step_type, title, description, route, status, step_order, task_type, metadata, created_at, updated_at
          FROM mission_steps
          WHERE mission_id = $1::uuid
          ORDER BY step_order ASC
        `,
        [mission.id]
      );

      return mapMissionRow(mission, stepRows.rows);
    },

    async updateMission(input: UpdateMissionInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const currentMission = await client.query<MissionRow>(
          `
            SELECT id, user_id, workspace_id, title, objective, domain, status, mission_contract, created_at, updated_at
            FROM missions
            WHERE id = $1::uuid
              AND user_id = $2::uuid
            LIMIT 1
            FOR UPDATE
          `,
          [input.missionId, input.userId]
        );

        const missionRow = currentMission.rows[0];
        if (!missionRow) {
          await client.query('ROLLBACK');
          return null;
        }

        if (input.stepStatuses && input.stepStatuses.length > 0) {
          for (const stepPatch of input.stepStatuses) {
            await client.query(
              `
                UPDATE mission_steps
                SET
                  status = $3,
                  updated_at = now()
                WHERE id = $1::uuid
                  AND mission_id = $2::uuid
              `,
              [stepPatch.stepId, missionRow.id, stepPatch.status]
            );
          }
        }

        const nextStatus = input.status ?? missionRow.status;
        const nextTitle = input.title ?? missionRow.title;
        const nextObjective = input.objective ?? missionRow.objective;
        const nextMissionContract = mergeMissionContract(parseMissionContract(missionRow.mission_contract), input.missionContract);

        const updatedMissionRows = await client.query<MissionRow>(
          `
            UPDATE missions
            SET
              status = $2,
              title = $3,
              objective = $4,
              mission_contract = $5::jsonb,
              updated_at = now()
            WHERE id = $1::uuid
            RETURNING id, user_id, workspace_id, title, objective, domain, status, mission_contract, created_at, updated_at
          `,
          [missionRow.id, nextStatus, nextTitle, nextObjective, JSON.stringify(nextMissionContract)]
        );

        const updatedMission = updatedMissionRows.rows[0];
        if (!updatedMission) {
          throw new Error('failed to update mission');
        }

        const stepRows = await client.query<MissionStepRow>(
          `
            SELECT
              id, mission_id, step_type, title, description, route, status, step_order, task_type, metadata, created_at, updated_at
            FROM mission_steps
            WHERE mission_id = $1::uuid
            ORDER BY step_order ASC
          `,
          [missionRow.id]
        );

        await client.query('COMMIT');
        return mapMissionRow(updatedMission, stepRows.rows);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

function mapMissionStepRow(row: MissionStepRow): MissionStepRecord {
  return {
    id: row.id,
    type: row.step_type,
    title: row.title,
    description: row.description ?? '',
    route: row.route,
    status: row.status,
    order: row.step_order,
    taskType: row.task_type ?? undefined,
    metadata: row.metadata ?? undefined
  };
}

function groupMissionSteps(rows: MissionStepRow[]): Map<string, MissionStepRow[]> {
  const grouped = new Map<string, MissionStepRow[]>();
  for (const row of rows) {
    const prev = grouped.get(row.mission_id) ?? [];
    prev.push(row);
    grouped.set(row.mission_id, prev);
  }
  return grouped;
}

function mapMissionRow(row: MissionRow, stepRows: MissionStepRow[]): MissionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    title: row.title,
    objective: row.objective,
    domain: row.domain,
    status: row.status,
    missionContract: parseMissionContract(row.mission_contract),
    steps: stepRows.map((step) => mapMissionStepRow(step)),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

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

function parseMissionContract(value: unknown): MissionContractRecord {
  if (!value || typeof value !== 'object') {
    return normalizeMissionContract();
  }

  return normalizeMissionContract(value as MissionContractRecord);
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
