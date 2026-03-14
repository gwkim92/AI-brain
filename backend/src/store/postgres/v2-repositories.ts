import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type { V2StoreRepositoryContract } from '../repository-contracts';
import type {
  V2CapabilityModuleRegistrationInput,
  V2CapabilityModuleRegistrationRecord,
  V2CapabilityModuleVersionRecord,
  V2ExecutionContractRecord,
  V2RetrievalEvidenceItemRecord,
  V2RetrievalQueryRecord,
  V2RetrievalScoreRecord,
  V2TaskViewSchemaRecord
} from '../types';

type V2ExecutionContractInsert = Omit<V2ExecutionContractRecord, 'id' | 'createdAt' | 'updatedAt'>;
type V2RetrievalQueryInsert = Omit<V2RetrievalQueryRecord, 'id' | 'createdAt'>;
type V2RetrievalEvidenceInsert = Omit<V2RetrievalEvidenceItemRecord, 'id' | 'createdAt'>;
type V2RetrievalScoreInsert = Omit<V2RetrievalScoreRecord, 'id' | 'createdAt'>;
type V2CapabilityModuleRegistrationInsert = V2CapabilityModuleRegistrationInput;
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

    async getCommandCompilationById(input: { id: string; userId: string }) {
      const result = await pool.query(
        `
          SELECT
            id, user_id, prompt, goal, success_criteria, constraints_json, risk_level, risk_reasons,
            deliverables_json, domain_mix_json, intent, complexity, intent_confidence, contract_confidence,
            uncertainty, clarification_questions, created_at, updated_at
          FROM command_compilations
          WHERE id = $1::uuid AND user_id = $2::uuid
          LIMIT 1
        `,
        [input.id, input.userId]
      );
      const row = result.rows[0] as
        | {
            id: string;
            user_id: string;
            prompt: string;
            goal: string;
            success_criteria: string[] | null;
            constraints_json: Record<string, unknown> | null;
            risk_level: V2ExecutionContractRecord['riskLevel'];
            risk_reasons: string[] | null;
            deliverables_json: Array<Record<string, unknown>> | null;
            domain_mix_json: Record<string, number> | null;
            intent: V2ExecutionContractRecord['intent'];
            complexity: V2ExecutionContractRecord['complexity'];
            intent_confidence: string | number;
            contract_confidence: string | number;
            uncertainty: string | number;
            clarification_questions: string[] | null;
            created_at: Date;
            updated_at: Date;
          }
        | undefined;
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        userId: row.user_id,
        prompt: row.prompt,
        goal: row.goal,
        successCriteria: row.success_criteria ?? [],
        constraints: row.constraints_json ?? {},
        riskLevel: row.risk_level,
        riskReasons: row.risk_reasons ?? [],
        deliverables: row.deliverables_json ?? [],
        domainMix: row.domain_mix_json ?? {},
        intent: row.intent,
        complexity: row.complexity,
        intentConfidence: Number(row.intent_confidence),
        contractConfidence: Number(row.contract_confidence),
        uncertainty: Number(row.uncertainty),
        clarificationQuestions: row.clarification_questions ?? [],
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      };
    },

    async createRetrievalQuery(input: V2RetrievalQueryInsert) {
      const id = randomUUID();
      const result = await pool.query(
        `
          INSERT INTO retrieval_queries (
            id, contract_id, user_id, query, connector, status, metadata
          )
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb)
          RETURNING created_at
        `,
        [id, input.contractId, input.userId, input.query, input.connector, input.status, JSON.stringify(input.metadata ?? {})]
      );
      const row = result.rows[0] as { created_at: Date };
      return {
        ...input,
        id,
        createdAt: row.created_at.toISOString()
      };
    },

    async createRetrievalEvidenceItems(input: V2RetrievalEvidenceInsert[]) {
      if (input.length === 0) {
        return [];
      }
      const inserted: V2RetrievalEvidenceItemRecord[] = [];
      for (const item of input) {
        const id = randomUUID();
        const result = await pool.query(
          `
            INSERT INTO retrieval_evidence_items (
              id, query_id, url, title, domain, snippet, published_at, connector, rank_score, metadata
            )
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10::jsonb)
            RETURNING created_at
          `,
          [
            id,
            item.queryId,
            item.url,
            item.title,
            item.domain,
            item.snippet,
            item.publishedAt,
            item.connector,
            item.rankScore,
            JSON.stringify(item.metadata ?? {})
          ]
        );
        const row = result.rows[0] as { created_at: Date };
        inserted.push({
          ...item,
          id,
          createdAt: row.created_at.toISOString()
        });
      }
      return inserted;
    },

    async createRetrievalScore(input: V2RetrievalScoreInsert) {
      const id = randomUUID();
      const result = await pool.query(
        `
          INSERT INTO retrieval_scores (
            id, contract_id, trust_score, coverage_score, freshness_score, diversity_score, blocked, blocked_reasons
          )
          VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb)
          RETURNING created_at
        `,
        [
          id,
          input.contractId,
          input.trustScore,
          input.coverageScore,
          input.freshnessScore,
          input.diversityScore,
          input.blocked,
          JSON.stringify(input.blockedReasons)
        ]
      );
      const row = result.rows[0] as { created_at: Date };
      return {
        ...input,
        id,
        createdAt: row.created_at.toISOString()
      };
    },

    async registerCapabilityModule(input: V2CapabilityModuleRegistrationInsert): Promise<V2CapabilityModuleRegistrationRecord> {
      const upsertModuleResult = await pool.query(
        `
          INSERT INTO capability_modules (id, module_id, title, description, owner)
          VALUES ($1::uuid, $2, $3, $4, $5)
          ON CONFLICT (module_id)
          DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            owner = EXCLUDED.owner,
            updated_at = now()
          RETURNING id, module_id, title, description, owner, created_at, updated_at
        `,
        [randomUUID(), input.moduleId, input.title, input.description, input.owner ?? null]
      );
      const moduleRow = upsertModuleResult.rows[0] as {
        id: string;
        module_id: string;
        title: string;
        description: string;
        owner: string | null;
        created_at: Date;
        updated_at: Date;
      };

      const upsertVersionResult = await pool.query(
        `
          INSERT INTO capability_module_versions (
            id, module_record_id, module_version, abi_version, input_schema_ref, output_schema_ref,
            required_permissions, dependencies, failure_modes, metadata
          )
          VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
          ON CONFLICT (module_record_id, module_version)
          DO UPDATE SET
            abi_version = EXCLUDED.abi_version,
            input_schema_ref = EXCLUDED.input_schema_ref,
            output_schema_ref = EXCLUDED.output_schema_ref,
            required_permissions = EXCLUDED.required_permissions,
            dependencies = EXCLUDED.dependencies,
            failure_modes = EXCLUDED.failure_modes,
            metadata = EXCLUDED.metadata
          RETURNING id, module_record_id, module_version, abi_version, input_schema_ref, output_schema_ref,
            required_permissions, dependencies, failure_modes, metadata, created_at
        `,
        [
          randomUUID(),
          moduleRow.id,
          input.moduleVersion,
          input.abiVersion,
          input.inputSchemaRef,
          input.outputSchemaRef,
          JSON.stringify(input.requiredPermissions),
          JSON.stringify(input.dependencies),
          JSON.stringify(input.failureModes),
          JSON.stringify(input.metadata ?? {})
        ]
      );
      const versionRow = upsertVersionResult.rows[0] as {
        id: string;
        module_record_id: string;
        module_version: string;
        abi_version: string;
        input_schema_ref: string;
        output_schema_ref: string;
        required_permissions: string[] | null;
        dependencies: string[] | null;
        failure_modes: string[] | null;
        metadata: Record<string, unknown> | null;
        created_at: Date;
      };

      return {
        module: {
          id: moduleRow.id,
          moduleId: moduleRow.module_id,
          title: moduleRow.title,
          description: moduleRow.description,
          owner: moduleRow.owner,
          createdAt: moduleRow.created_at.toISOString(),
          updatedAt: moduleRow.updated_at.toISOString()
        },
        version: {
          id: versionRow.id,
          moduleId: moduleRow.module_id,
          moduleRecordId: versionRow.module_record_id,
          moduleVersion: versionRow.module_version,
          abiVersion: versionRow.abi_version,
          inputSchemaRef: versionRow.input_schema_ref,
          outputSchemaRef: versionRow.output_schema_ref,
          requiredPermissions: versionRow.required_permissions ?? [],
          dependencies: versionRow.dependencies ?? [],
          failureModes: versionRow.failure_modes ?? [],
          metadata: versionRow.metadata ?? {},
          createdAt: versionRow.created_at.toISOString()
        }
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

    async listCapabilityModuleVersions(input: { moduleId: string }): Promise<V2CapabilityModuleVersionRecord[]> {
      const result = await pool.query(
        `
          SELECT
            v.id, v.module_record_id, m.module_id, v.module_version, v.abi_version, v.input_schema_ref,
            v.output_schema_ref, v.required_permissions, v.dependencies, v.failure_modes, v.metadata, v.created_at
          FROM capability_module_versions v
          JOIN capability_modules m ON m.id = v.module_record_id
          WHERE m.module_id = $1
          ORDER BY v.created_at DESC
          LIMIT 500
        `,
        [input.moduleId]
      );

      return result.rows.map((row) => ({
        id: String(row.id),
        moduleId: String(row.module_id),
        moduleRecordId: String(row.module_record_id),
        moduleVersion: String(row.module_version),
        abiVersion: String(row.abi_version),
        inputSchemaRef: String(row.input_schema_ref),
        outputSchemaRef: String(row.output_schema_ref),
        requiredPermissions: Array.isArray(row.required_permissions) ? (row.required_permissions as string[]) : [],
        dependencies: Array.isArray(row.dependencies) ? (row.dependencies as string[]) : [],
        failureModes: Array.isArray(row.failure_modes) ? (row.failure_modes as string[]) : [],
        metadata: (row.metadata as Record<string, unknown> | null) ?? {},
        createdAt: new Date(row.created_at as string | Date).toISOString()
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
