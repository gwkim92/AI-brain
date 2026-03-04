import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type { V2StoreRepositoryContract } from '../repository-contracts';
import type { V2ExecutionContractRecord, V2TaskViewSchemaRecord } from '../types';

type V2ExecutionContractInsert = Omit<V2ExecutionContractRecord, 'id' | 'createdAt' | 'updatedAt'>;
type V2TaskViewSchemaInsert = Omit<V2TaskViewSchemaRecord, 'id' | 'createdAt'>;

export function createPostgresV2Repository(pool: Pool): V2StoreRepositoryContract {
  return {
    async createCommandCompilation(input: V2ExecutionContractInsert) {
      const id = randomUUID();
      const result = await pool.query(
        `
          INSERT INTO command_compilations (
            id, user_id, prompt, goal, success_criteria, constraints_json, risk_level, risk_reasons,
            deliverables_json, domain_mix_json, intent, complexity, intent_confidence, contract_confidence,
            uncertainty, clarification_questions
          )
          VALUES (
            $1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb,
            $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16::jsonb
          )
          RETURNING created_at, updated_at
        `,
        [
          id,
          input.userId,
          input.prompt,
          input.goal,
          JSON.stringify(input.successCriteria),
          JSON.stringify(input.constraints ?? {}),
          input.riskLevel,
          JSON.stringify(input.riskReasons),
          JSON.stringify(input.deliverables),
          JSON.stringify(input.domainMix),
          input.intent,
          input.complexity,
          input.intentConfidence,
          input.contractConfidence,
          input.uncertainty,
          JSON.stringify(input.clarificationQuestions)
        ]
      );

      const row = result.rows[0] as { created_at: Date; updated_at: Date };

      return {
        ...input,
        id,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      };
    },

    async listCapabilityModules() {
      const result = await pool.query(
        `
          SELECT id, module_id, title, description, owner, created_at, updated_at
          FROM capability_modules
          ORDER BY updated_at DESC
          LIMIT 500
        `
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        moduleId: String(row.module_id),
        title: String(row.title),
        description: String(row.description),
        owner: row.owner ? String(row.owner) : null,
        createdAt: new Date(row.created_at as string | Date).toISOString(),
        updatedAt: new Date(row.updated_at as string | Date).toISOString()
      }));
    },

    async saveTaskViewSchema(input: V2TaskViewSchemaInsert) {
      const id = randomUUID();
      const result = await pool.query(
        `
          INSERT INTO task_view_schemas (id, task_id, schema_version, schema_json)
          VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)
          RETURNING created_at
        `,
        [id, input.taskId, input.schemaVersion, JSON.stringify(input.schema ?? {})]
      );
      const row = result.rows[0] as { created_at: Date };
      return {
        ...input,
        id,
        createdAt: row.created_at.toISOString()
      };
    }
  };
}

