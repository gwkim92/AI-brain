import { Pool } from 'pg';

import { evaluateRadarItems } from '../radar/scoring';
import type {
  AuthSessionRecord,
  AuthUserRecord,
  AuthUserWithPasswordRecord,
  AssistantContextEventRecord,
  AssistantContextRecord,
  AssistantContextStatus,
  AppendAssistantContextEventInput,
  AppendTaskEventInput,
  CouncilParticipantRecord,
  CouncilRunRecord,
  CreateMissionInput,
  UpdateMissionInput,
  CreateCouncilRunInput,
  CreateExecutionRunInput,
  CreateTaskInput,
  ExecutionRunRecord,
  JarvisStore,
  MissionRecord,
  MissionStepRecord,
  MissionStatus,
  ProviderAttemptRecord,
  RadarItemRecord,
  RadarItemStatus,
  RadarRecommendationRecord,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  UpdateAssistantContextInput,
  UserRole,
  UpsertAssistantContextInput,
  UpgradeProposalRecord,
  UpgradeRunApiRecord,
  UpgradeStatus
} from './types';

type PostgresStoreOptions = {
  connectionString: string;
  defaultUserId: string;
  defaultUserEmail: string;
};

type TaskRow = {
  id: string;
  user_id: string;
  mode: TaskRecord['mode'];
  status: TaskRecord['status'];
  title: string;
  input: Record<string, unknown>;
  idempotency_key: string;
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type TaskEventRow = {
  id: string;
  task_id: string;
  type: string;
  data: Record<string, unknown>;
  trace_id: string | null;
  span_id: string | null;
  created_at: Date;
};

type RadarItemRow = {
  id: string;
  title: string;
  summary: string | null;
  source_url: string;
  source_name: string;
  published_at: Date | null;
  confidence_score: string | number;
  status: RadarItemStatus;
};

type UpgradeProposalRow = {
  id: string;
  radar_score_id: string;
  proposal_title: string;
  status: UpgradeStatus;
  created_at: Date;
  approved_at: Date | null;
};

type UpgradeRunRow = {
  id: string;
  proposal_id: string;
  status: UpgradeStatus;
  start_command: string;
  created_at: Date;
  updated_at: Date;
};

type CouncilRunRow = {
  id: string;
  question: string;
  status: CouncilRunRecord['status'];
  consensus_status: CouncilRunRecord['consensus_status'];
  summary: string;
  participants: unknown;
  attempts: unknown;
  provider: CouncilRunRecord['provider'];
  model: string;
  used_fallback: boolean;
  task_id: string | null;
  user_id: string;
  idempotency_key: string;
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type ExecutionRunRow = {
  id: string;
  mode: ExecutionRunRecord['mode'];
  prompt: string;
  status: ExecutionRunRecord['status'];
  output: string;
  attempts: unknown;
  provider: ExecutionRunRecord['provider'];
  model: string;
  used_fallback: boolean;
  task_id: string | null;
  duration_ms: number;
  user_id: string;
  idempotency_key: string;
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type AuthUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
};

type AuthSessionRow = {
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  user_id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
};

type ProviderCredentialRow = {
  provider: 'openai' | 'gemini' | 'anthropic' | 'local';
  encrypted_api_key: string;
  updated_by: string | null;
  updated_at: Date;
};

type MissionRow = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  title: string;
  objective: string;
  domain: MissionRecord['domain'];
  status: MissionRecord['status'];
  created_at: Date;
  updated_at: Date;
};

type MissionStepRow = {
  id: string;
  mission_id: string;
  step_type: MissionStepRecord['type'];
  title: string;
  description: string | null;
  route: string;
  status: MissionStepRecord['status'];
  step_order: number;
  task_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

type AssistantContextRow = {
  id: string;
  user_id: string;
  client_context_id: string;
  source: string;
  intent: string;
  prompt: string;
  widget_plan: unknown;
  status: AssistantContextStatus;
  task_id: string | null;
  served_provider: 'openai' | 'gemini' | 'anthropic' | 'local' | null;
  served_model: string | null;
  used_fallback: boolean;
  selection_reason: string | null;
  output: string;
  error: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
};

type AssistantContextEventRow = {
  id: string;
  context_id: string;
  sequence: string | number;
  event_type: string;
  data: Record<string, unknown>;
  trace_id: string | null;
  span_id: string | null;
  created_at: Date;
};

type TelegramReportRow = {
  id: string;
  chat_id: string;
  topic: string;
  body_markdown: string;
  status: 'queued' | 'sent' | 'failed';
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  telegram_message_id: string | null;
  created_at: Date;
  sent_at: Date | null;
};

export function createPostgresStore(options: PostgresStoreOptions): JarvisStore {
  const pool = new Pool({ connectionString: options.connectionString });

  const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

  const store: JarvisStore = {
    kind: 'postgres',

    getPool() {
      return pool;
    },

    async initialize() {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'
      `);
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS password_hash TEXT
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id_expires_at
        ON user_sessions(user_id, expires_at DESC)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS provider_credentials (
          provider TEXT PRIMARY KEY,
          encrypted_api_key TEXT NOT NULL,
          updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (provider IN ('openai', 'gemini', 'anthropic', 'local'))
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS provider_stats (
          provider TEXT NOT NULL,
          task_type TEXT NOT NULL,
          success_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          avg_latency_ms NUMERIC NOT NULL DEFAULT 0,
          success_ema NUMERIC NOT NULL DEFAULT 0.5,
          latency_ema NUMERIC NOT NULL DEFAULT 0,
          last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (provider, task_type)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS model_registry (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          provider TEXT NOT NULL,
          model_id TEXT NOT NULL,
          display_name TEXT,
          is_available BOOLEAN NOT NULL DEFAULT true,
          context_window INTEGER,
          max_output_tokens INTEGER,
          supports_vision BOOLEAN NOT NULL DEFAULT false,
          supports_streaming BOOLEAN NOT NULL DEFAULT true,
          cost_tier TEXT NOT NULL DEFAULT 'standard',
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (provider IN ('openai', 'gemini', 'anthropic', 'local')),
          CHECK (cost_tier IN ('free', 'low', 'standard', 'premium')),
          UNIQUE (provider, model_id)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_model_registry_provider_available
        ON model_registry(provider, is_available)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_model_policy (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          task_type TEXT NOT NULL,
          provider TEXT NOT NULL,
          model_id TEXT NOT NULL,
          tier INTEGER NOT NULL DEFAULT 1,
          priority INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (tier >= 1 AND tier <= 3),
          UNIQUE (task_type, provider, model_id)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_task_model_policy_task_type_active
        ON task_model_policy(task_type, is_active, tier ASC, priority DESC)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS missions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          workspace_id UUID,
          title TEXT NOT NULL,
          objective TEXT NOT NULL,
          domain TEXT NOT NULL DEFAULT 'mixed',
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (domain IN ('code', 'research', 'finance', 'news', 'mixed')),
          CHECK (status IN ('draft', 'planned', 'running', 'blocked', 'completed', 'failed'))
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mission_steps (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
          step_type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          route TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          step_order INTEGER NOT NULL,
          task_type TEXT,
          metadata JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (step_type IN ('llm_generate', 'council_debate', 'human_gate', 'tool_call', 'sub_mission',
                                'code', 'research', 'finance', 'news', 'approval', 'execute')),
          CHECK (status IN ('pending', 'running', 'done', 'blocked', 'failed')),
          CHECK (step_order > 0)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_missions_user_status_updated_at
        ON missions(user_id, status, updated_at DESC)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_mission_steps_mission_order
        ON mission_steps(mission_id, step_order ASC)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS assistant_contexts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_context_id TEXT NOT NULL,
          source TEXT NOT NULL,
          intent TEXT NOT NULL,
          prompt TEXT NOT NULL,
          widget_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
          status TEXT NOT NULL DEFAULT 'running',
          task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
          served_provider TEXT,
          served_model TEXT,
          used_fallback BOOLEAN NOT NULL DEFAULT false,
          selection_reason TEXT,
          output TEXT NOT NULL DEFAULT '',
          error TEXT,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (status IN ('running', 'completed', 'failed')),
          CHECK (served_provider IS NULL OR served_provider IN ('openai', 'gemini', 'anthropic', 'local')),
          UNIQUE (user_id, client_context_id)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_assistant_contexts_user_status_updated_at
        ON assistant_contexts(user_id, status, updated_at DESC)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS assistant_context_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          context_id UUID NOT NULL REFERENCES assistant_contexts(id) ON DELETE CASCADE,
          sequence BIGSERIAL NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          trace_id TEXT,
          span_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_assistant_context_events_context_sequence
        ON assistant_context_events(context_id, sequence ASC)
      `);
      await pool.query(`
        ALTER TABLE IF EXISTS telegram_reports
        ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0
      `);
      await pool.query(`
        ALTER TABLE IF EXISTS telegram_reports
        ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3
      `);
      await pool.query(`
        ALTER TABLE IF EXISTS telegram_reports
        ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
      `);
      await pool.query(`
        ALTER TABLE IF EXISTS telegram_reports
        ADD COLUMN IF NOT EXISTS last_error TEXT
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_telegram_reports_status_next_attempt_at
        ON telegram_reports(status, next_attempt_at ASC)
      `);

      await pool.query(
        `
          INSERT INTO users (id, email, display_name, role, password_hash)
          VALUES ($1::uuid, $2, $3, 'admin', NULL)
          ON CONFLICT (id) DO UPDATE
          SET email = EXCLUDED.email,
              display_name = EXCLUDED.display_name,
              role = 'admin',
              updated_at = now()
        `,
        [options.defaultUserId, options.defaultUserEmail, 'Jarvis Local User']
      );
    },

    async health() {
      try {
        await pool.query('SELECT 1');
        return {
          store: 'postgres',
          db: 'up'
        };
      } catch {
        return {
          store: 'postgres',
          db: 'down'
        };
      }
    },

    async createAuthUser(input: {
      email: string;
      displayName?: string;
      passwordHash: string;
      role?: UserRole;
    }) {
      const email = input.email.trim().toLowerCase();
      try {
        const { rows } = await pool.query<AuthUserRow>(
          `
            INSERT INTO users (email, display_name, role, password_hash)
            VALUES ($1, $2, $3, $4)
            RETURNING id, email, display_name, role, password_hash, created_at, updated_at
          `,
          [email, input.displayName?.trim() || null, input.role ?? 'member', input.passwordHash]
        );

        return rows[0] ? mapAuthUserRow(rows[0]) : null;
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
            ? error.code
            : '';
        if (code === '23505') {
          return null;
        }
        throw error;
      }
    },

    async upsertAuthUserByEmail(input: {
      email: string;
      displayName?: string;
      passwordHash: string;
      role: UserRole;
    }) {
      const email = input.email.trim().toLowerCase();
      const { rows } = await pool.query<AuthUserRow>(
        `
          INSERT INTO users (email, display_name, role, password_hash)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (email) DO UPDATE
          SET
            display_name = COALESCE(EXCLUDED.display_name, users.display_name),
            role = EXCLUDED.role,
            password_hash = EXCLUDED.password_hash,
            updated_at = now()
          RETURNING id, email, display_name, role, password_hash, created_at, updated_at
        `,
        [email, input.displayName?.trim() || null, input.role, input.passwordHash]
      );

      const row = rows[0];
      if (!row) {
        throw new Error('failed to upsert auth user');
      }

      return mapAuthUserRow(row);
    },

    async findAuthUserByEmail(email: string) {
      const { rows } = await pool.query<AuthUserRow>(
        `
          SELECT id, email, display_name, role, password_hash, created_at, updated_at
          FROM users
          WHERE lower(email) = lower($1)
          LIMIT 1
        `,
        [email.trim().toLowerCase()]
      );

      return rows[0] ? mapAuthUserWithPasswordRow(rows[0]) : null;
    },

    async getAuthUserById(userId: string) {
      const { rows } = await pool.query<AuthUserRow>(
        `
          SELECT id, email, display_name, role, password_hash, created_at, updated_at
          FROM users
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [userId]
      );

      return rows[0] ? mapAuthUserRow(rows[0]) : null;
    },

    async createAuthSession(input: { userId: string; tokenHash: string; expiresAt: string }) {
      await pool.query(
        `
          INSERT INTO user_sessions (user_id, token_hash, expires_at)
          VALUES ($1::uuid, $2, $3::timestamptz)
        `,
        [input.userId, input.tokenHash, input.expiresAt]
      );
    },

    async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
      const { rows } = await pool.query<AuthSessionRow>(
        `
          SELECT
            s.token_hash,
            s.expires_at,
            s.revoked_at,
            u.id AS user_id,
            u.email,
            u.display_name,
            u.role,
            u.created_at,
            u.updated_at
          FROM user_sessions s
          INNER JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1
          LIMIT 1
        `,
        [tokenHash]
      );

      const row = rows[0];
      if (!row || row.revoked_at !== null || row.expires_at.getTime() <= Date.now()) {
        return null;
      }

      await pool.query(
        `
          UPDATE user_sessions
          SET last_seen_at = now()
          WHERE token_hash = $1
        `,
        [tokenHash]
      );

      return {
        user: mapAuthUserRow({
          id: row.user_id,
          email: row.email,
          display_name: row.display_name,
          role: row.role,
          password_hash: null,
          created_at: row.created_at,
          updated_at: row.updated_at
        }),
        tokenHash: row.token_hash,
        expiresAt: row.expires_at.toISOString()
      };
    },

    async revokeAuthSession(tokenHash: string) {
      const { rowCount } = await pool.query(
        `
          UPDATE user_sessions
          SET revoked_at = now()
          WHERE token_hash = $1
            AND revoked_at IS NULL
        `,
        [tokenHash]
      );

      return (rowCount ?? 0) > 0;
    },

    async listProviderCredentials() {
      const { rows } = await pool.query<ProviderCredentialRow>(
        `
          SELECT provider, encrypted_api_key, updated_by, updated_at
          FROM provider_credentials
          ORDER BY provider ASC
        `
      );

      return rows.map((row) => ({
        provider: row.provider,
        encryptedApiKey: row.encrypted_api_key,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at.toISOString()
      }));
    },

    async upsertProviderCredential(input: {
      provider: 'openai' | 'gemini' | 'anthropic' | 'local';
      encryptedApiKey: string;
      updatedBy?: string | null;
    }) {
      const { rows } = await pool.query<ProviderCredentialRow>(
        `
          INSERT INTO provider_credentials (provider, encrypted_api_key, updated_by)
          VALUES ($1, $2, $3::uuid)
          ON CONFLICT (provider) DO UPDATE
          SET
            encrypted_api_key = EXCLUDED.encrypted_api_key,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
          RETURNING provider, encrypted_api_key, updated_by, updated_at
        `,
        [input.provider, input.encryptedApiKey, input.updatedBy ?? null]
      );

      const row = rows[0];
      if (!row) {
        throw new Error('failed to upsert provider credential');
      }

      return {
        provider: row.provider,
        encryptedApiKey: row.encrypted_api_key,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at.toISOString()
      };
    },

    async deleteProviderCredential(provider: 'openai' | 'gemini' | 'anthropic' | 'local') {
      const { rowCount } = await pool.query(
        `
          DELETE FROM provider_credentials
          WHERE provider = $1
        `,
        [provider]
      );
      return (rowCount ?? 0) > 0;
    },

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
              status
            )
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
            RETURNING id, user_id, workspace_id, title, objective, domain, status, created_at, updated_at
          `,
          [input.userId || options.defaultUserId, input.workspaceId ?? null, input.title, input.objective, input.domain, input.status ?? 'draft']
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
            [step.id, missionRow.id, step.type, step.title, step.description, step.route, step.status, step.order, step.taskType ?? null, JSON.stringify(step.metadata ?? {})]
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

    async listMissions(input: { userId: string; status?: MissionStatus; limit: number }) {
      const params: unknown[] = [input.userId, input.limit];
      let where = '';
      if (input.status) {
        params.splice(1, 0, input.status);
        where = 'AND status = $2';
      }

      const missionLimitParam = input.status ? '$3' : '$2';
      const { rows } = await pool.query<MissionRow>(
        `
          SELECT id, user_id, workspace_id, title, objective, domain, status, created_at, updated_at
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
          SELECT id, user_id, workspace_id, title, objective, domain, status, created_at, updated_at
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
            SELECT id, user_id, workspace_id, title, objective, domain, status, created_at, updated_at
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

        const updatedMissionRows = await client.query<MissionRow>(
          `
            UPDATE missions
            SET
              status = $2,
              title = $3,
              objective = $4,
              updated_at = now()
            WHERE id = $1::uuid
            RETURNING id, user_id, workspace_id, title, objective, domain, status, created_at, updated_at
          `,
          [missionRow.id, nextStatus, nextTitle, nextObjective]
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
    },

    async upsertAssistantContext(input: UpsertAssistantContextInput) {
      const { rows } = await pool.query<AssistantContextRow>(
        `
          INSERT INTO assistant_contexts (
            user_id,
            client_context_id,
            source,
            intent,
            prompt,
            widget_plan,
            status,
            task_id
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8::uuid)
          ON CONFLICT (user_id, client_context_id) DO UPDATE
          SET
            task_id = COALESCE(EXCLUDED.task_id, assistant_contexts.task_id),
            updated_at = now(),
            revision = assistant_contexts.revision + 1
          RETURNING
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
        `,
        [
          input.userId || options.defaultUserId,
          input.clientContextId,
          input.source,
          input.intent,
          input.prompt,
          JSON.stringify(input.widgetPlan),
          input.status ?? 'running',
          input.taskId ?? null
        ]
      );

      return mapAssistantContextRow(rows[0]!);
    },

    async updateAssistantContext(input: UpdateAssistantContextInput) {
      const current = await pool.query<AssistantContextRow>(
        `
          SELECT
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
          FROM assistant_contexts
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          LIMIT 1
        `,
        [input.contextId, input.userId]
      );

      const row = current.rows[0];
      if (!row) {
        return null;
      }

      const next = mapAssistantContextRow(row);
      const updatedStatus = input.status ?? next.status;
      const updatedTaskId = typeof input.taskId === 'undefined' ? next.taskId : input.taskId;
      const updatedServedProvider =
        typeof input.servedProvider === 'undefined' ? next.servedProvider : input.servedProvider;
      const updatedServedModel = typeof input.servedModel === 'undefined' ? next.servedModel : input.servedModel;
      const updatedUsedFallback = typeof input.usedFallback === 'undefined' ? next.usedFallback : input.usedFallback;
      const updatedSelectionReason =
        typeof input.selectionReason === 'undefined' ? next.selectionReason : input.selectionReason;
      const updatedOutput = typeof input.output === 'undefined' ? next.output : input.output;
      const updatedError = typeof input.error === 'undefined' ? next.error : input.error;

      const { rows } = await pool.query<AssistantContextRow>(
        `
          UPDATE assistant_contexts
          SET
            status = $3,
            task_id = $4::uuid,
            served_provider = $5,
            served_model = $6,
            used_fallback = $7,
            selection_reason = $8,
            output = $9,
            error = $10,
            revision = revision + 1,
            updated_at = now()
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          RETURNING
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
        `,
        [
          input.contextId,
          input.userId,
          updatedStatus,
          updatedTaskId,
          updatedServedProvider,
          updatedServedModel,
          updatedUsedFallback,
          updatedSelectionReason,
          updatedOutput,
          updatedError
        ]
      );

      return rows[0] ? mapAssistantContextRow(rows[0]) : null;
    },

    async listAssistantContexts(input: { userId: string; status?: AssistantContextStatus; limit: number }) {
      const params: unknown[] = [input.userId, input.limit];
      let where = '';

      if (input.status) {
        params.splice(1, 0, input.status);
        where = 'AND status = $2';
      }

      const limitParam = input.status ? '$3' : '$2';
      const { rows } = await pool.query<AssistantContextRow>(
        `
          SELECT
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
          FROM assistant_contexts
          WHERE user_id = $1::uuid
          ${where}
          ORDER BY updated_at DESC
          LIMIT ${limitParam}
        `,
        params
      );

      return rows.map((row) => mapAssistantContextRow(row));
    },

    async getAssistantContextById(input: { userId: string; contextId: string }) {
      const { rows } = await pool.query<AssistantContextRow>(
        `
          SELECT
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
          FROM assistant_contexts
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          LIMIT 1
        `,
        [input.contextId, input.userId]
      );

      return rows[0] ? mapAssistantContextRow(rows[0]) : null;
    },

    async getAssistantContextByClientContextId(input: { userId: string; clientContextId: string }) {
      const { rows } = await pool.query<AssistantContextRow>(
        `
          SELECT
            id, user_id, client_context_id, source, intent, prompt, widget_plan, status, task_id,
            served_provider, served_model, used_fallback, selection_reason, output, error, revision,
            created_at, updated_at
          FROM assistant_contexts
          WHERE user_id = $1::uuid
            AND client_context_id = $2
          LIMIT 1
        `,
        [input.userId, input.clientContextId]
      );

      return rows[0] ? mapAssistantContextRow(rows[0]) : null;
    },

    async appendAssistantContextEvent(input: AppendAssistantContextEventInput) {
      const { rows } = await pool.query<AssistantContextEventRow>(
        `
          INSERT INTO assistant_context_events (
            context_id,
            event_type,
            data,
            trace_id,
            span_id
          )
          SELECT c.id, $3, $4::jsonb, $5, $6
          FROM assistant_contexts c
          WHERE c.id = $1::uuid
            AND c.user_id = $2::uuid
          RETURNING id, context_id, sequence, event_type, data, trace_id, span_id, created_at
        `,
        [input.contextId, input.userId, input.eventType, JSON.stringify(input.data), input.traceId ?? null, input.spanId ?? null]
      );

      if (!rows[0]) {
        return null;
      }

      return mapAssistantContextEventRow(rows[0]);
    },

    async listAssistantContextEvents(input: { userId: string; contextId: string; sinceSequence?: number; limit: number }) {
      const params: unknown[] = [input.userId, input.contextId];
      let sinceClause = '';

      if (typeof input.sinceSequence === 'number') {
        params.push(input.sinceSequence);
        sinceClause = `AND e.sequence > $${params.length}::bigint`;
      }

      params.push(input.limit);
      const limitParam = `$${params.length}`;

      const { rows } = await pool.query<AssistantContextEventRow>(
        `
          SELECT
            e.id, e.context_id, e.sequence, e.event_type, e.data, e.trace_id, e.span_id, e.created_at
          FROM assistant_context_events e
          INNER JOIN assistant_contexts c ON c.id = e.context_id
          WHERE c.user_id = $1::uuid
            AND e.context_id = $2::uuid
            ${sinceClause}
          ORDER BY e.sequence ASC
          LIMIT ${limitParam}
        `,
        params
      );

      return rows.map((row) => mapAssistantContextEventRow(row));
    },

    async createTask(input: CreateTaskInput) {
      const { rows } = await pool.query<TaskRow>(
        `
          INSERT INTO tasks (
            user_id,
            mode,
            status,
            title,
            input,
            idempotency_key,
            trace_id
          )
          VALUES ($1::uuid, $2::task_mode, 'queued'::task_status, $3, $4::jsonb, $5, $6)
          RETURNING *
        `,
        [
          input.userId || options.defaultUserId,
          input.mode,
          input.title,
          JSON.stringify(input.input),
          input.idempotencyKey,
          input.traceId ?? null
        ]
      );

      const task = mapTaskRow(rows[0]!);

      await store.appendTaskEvent({
        taskId: task.id,
        type: 'task.created',
        data: {
          mode: task.mode,
          status: task.status
        }
      });

      return task;
    },

    async setTaskStatus(input: {
      taskId: string;
      status: TaskStatus;
      eventType?: string;
      data?: Record<string, unknown>;
      traceId?: string;
      spanId?: string;
    }) {
      const { rows } = await pool.query<TaskRow>(
        `
          UPDATE tasks
          SET status = $2::task_status,
              updated_at = now()
          WHERE id = $1::uuid
          RETURNING *
        `,
        [input.taskId, input.status]
      );

      if (!rows[0]) {
        return null;
      }

      const task = mapTaskRow(rows[0]);

      await store.appendTaskEvent({
        taskId: task.id,
        type: input.eventType ?? 'task.updated',
        data: {
          status: task.status,
          ...(input.data ?? {})
        },
        traceId: input.traceId,
        spanId: input.spanId
      });

      return task;
    },

    async listTasks(input: { status?: TaskStatus; limit: number }) {
      const params: unknown[] = [input.limit];
      let where = '';

      if (input.status) {
        params.push(input.status);
        where = 'WHERE status = $2::task_status';
      }

      const { rows } = await pool.query<TaskRow>(
        `
          SELECT *
          FROM tasks
          ${where}
          ORDER BY created_at DESC
          LIMIT $1
        `,
        params
      );

      return rows.map((row) => mapTaskRow(row));
    },

    async getTaskById(taskId: string) {
      const { rows } = await pool.query<TaskRow>(
        `
          SELECT *
          FROM tasks
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [taskId]
      );

      return rows[0] ? mapTaskRow(rows[0]) : null;
    },

    async appendTaskEvent(event: AppendTaskEventInput) {
      const { rows } = await pool.query<TaskEventRow>(
        `
          INSERT INTO task_events (
            task_id,
            type,
            data,
            trace_id,
            span_id
          )
          VALUES ($1::uuid, $2, $3::jsonb, $4, $5)
          RETURNING id, task_id, type, data, trace_id, span_id, created_at
        `,
        [event.taskId, event.type, JSON.stringify(event.data), event.traceId ?? null, event.spanId ?? null]
      );

      return mapTaskEventRow(rows[0]!);
    },

    async listTaskEvents(taskId: string, limit: number) {
      const { rows } = await pool.query<TaskEventRow>(
        `
          SELECT id, task_id, type, data, trace_id, span_id, created_at
          FROM task_events
          WHERE task_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [taskId, limit]
      );

      return rows.reverse().map((row) => mapTaskEventRow(row));
    },

    async ingestRadarItems(items: RadarItemRecord[]) {
      for (const item of items) {
        await pool.query(
          `
            INSERT INTO tech_radar_items (
              source_url,
              source_name,
              title,
              summary,
              published_at,
              item_hash,
              confidence_score,
              status,
              payload
            )
            VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::radar_item_status, '{}'::jsonb)
            ON CONFLICT (source_url, item_hash)
            DO UPDATE SET
              title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              published_at = EXCLUDED.published_at,
              confidence_score = EXCLUDED.confidence_score,
              updated_at = now()
          `,
          [
            item.sourceUrl,
            item.sourceName,
            item.title,
            item.summary,
            item.publishedAt,
            item.id,
            item.confidenceScore,
            item.status
          ]
        );
      }

      return items.length;
    },

    async listRadarItems(input: { status?: RadarItemStatus; limit: number }) {
      const params: unknown[] = [input.limit];
      let where = '';

      if (input.status) {
        params.push(input.status);
        where = 'WHERE status = $2::radar_item_status';
      }

      const { rows } = await pool.query<RadarItemRow>(
        `
          SELECT id, title, summary, source_url, source_name, published_at, confidence_score, status
          FROM tech_radar_items
          ${where}
          ORDER BY published_at DESC NULLS LAST, created_at DESC
          LIMIT $1
        `,
        params
      );

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary ?? '',
        sourceUrl: row.source_url,
        sourceName: row.source_name,
        publishedAt: toIso(row.published_at),
        confidenceScore: Number(row.confidence_score),
        status: row.status
      }));
    },

    async evaluateRadar(input: { itemIds: string[] }) {
      if (input.itemIds.length === 0) {
        return [];
      }

      const { rows } = await pool.query<RadarItemRow>(
        `
          SELECT id, title, summary, source_url, source_name, published_at, confidence_score, status
          FROM tech_radar_items
          WHERE id = ANY($1::uuid[])
        `,
        [input.itemIds]
      );

      const scored = evaluateRadarItems(
        rows.map((item) => {
          const confidence = Number(item.confidence_score);
          return {
            id: item.id,
            title: item.title,
            benefit: Math.max(1.5, Math.min(5, confidence * 5)),
            risk: Math.max(0.5, 3.2 - confidence * 2),
            cost: 2.5
          };
        })
      );

      const recommendations: RadarRecommendationRecord[] = [];

      for (const row of scored) {
        const { rows: scoreRows } = await pool.query<{
          id: string;
          evaluated_at: Date;
        }>(
          `
            INSERT INTO tech_radar_scores (
              radar_item_id,
              performance_gain,
              reliability_gain,
              adoption_difficulty,
              rollback_difficulty,
              security_risk,
              total_score,
              decision,
              rationale
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::radar_decision, $9::jsonb)
            RETURNING id, evaluated_at
          `,
          [
            row.itemId,
            row.totalScore,
            row.totalScore,
            2.0,
            2.0,
            row.riskLevel === 'high' ? 4 : row.riskLevel === 'medium' ? 2.5 : 1.2,
            row.totalScore,
            row.decision,
            JSON.stringify({
              expectedBenefit: row.expectedBenefit,
              migrationCost: row.migrationCost,
              riskLevel: row.riskLevel
            })
          ]
        );

        await pool.query(
          `
            UPDATE tech_radar_items
            SET status = 'scored'::radar_item_status,
                updated_at = now()
            WHERE id = $1::uuid
          `,
          [row.itemId]
        );

        if (row.decision !== 'discard') {
          await pool.query(
            `
              INSERT INTO upgrade_proposals (
                radar_score_id,
                proposal_title,
                change_plan,
                risk_plan,
                status
              )
              VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, 'proposed'::upgrade_status)
            `,
            [
              scoreRows[0]!.id,
              `Adopt candidate ${row.itemId}`,
              JSON.stringify({ target: row.itemId, expectedBenefit: row.expectedBenefit }),
              JSON.stringify({ risk: row.riskLevel, migrationCost: row.migrationCost })
            ]
          );
        }

        recommendations.push({
          id: scoreRows[0]!.id,
          itemId: row.itemId,
          decision: row.decision,
          totalScore: row.totalScore,
          expectedBenefit: row.expectedBenefit,
          migrationCost: row.migrationCost,
          riskLevel: row.riskLevel,
          evaluatedAt: scoreRows[0]!.evaluated_at.toISOString()
        });
      }

      return recommendations;
    },

    async listRadarRecommendations(decision?: 'adopt' | 'hold' | 'discard') {
      const params: unknown[] = [];
      let where = '';

      if (decision) {
        params.push(decision);
        where = 'WHERE decision = $1::radar_decision';
      }

      const { rows } = await pool.query<{
        id: string;
        radar_item_id: string;
        decision: 'adopt' | 'hold' | 'discard';
        total_score: string | number;
        rationale: Record<string, unknown>;
        evaluated_at: Date;
      }>(
        `
          SELECT id, radar_item_id, decision, total_score, rationale, evaluated_at
          FROM tech_radar_scores
          ${where}
          ORDER BY evaluated_at DESC
          LIMIT 200
        `,
        params
      );

      return rows.map((row) => ({
        id: row.id,
        itemId: row.radar_item_id,
        decision: row.decision,
        totalScore: Number(row.total_score),
        expectedBenefit: String(row.rationale.expectedBenefit ?? 'medium'),
        migrationCost: String(row.rationale.migrationCost ?? 'medium'),
        riskLevel: String(row.rationale.riskLevel ?? 'medium'),
        evaluatedAt: row.evaluated_at.toISOString()
      }));
    },

    async createTelegramReport(input: { chatId: string; topic?: string; bodyMarkdown?: string; maxAttempts?: number }) {
      const { rows } = await pool.query<TelegramReportRow>(
        `
          INSERT INTO telegram_reports (chat_id, topic, body_markdown, status, max_attempts, next_attempt_at)
          VALUES ($1, $2, $3, 'queued'::telegram_report_status, $4, now())
          RETURNING id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error, telegram_message_id, created_at, sent_at
        `,
        [input.chatId, input.topic ?? 'radar-digest', input.bodyMarkdown ?? 'queued by api', Math.max(1, input.maxAttempts ?? 3)]
      );

      return {
        id: rows[0]!.id,
        chatId: rows[0]!.chat_id,
        topic: rows[0]!.topic,
        bodyMarkdown: rows[0]!.body_markdown,
        status: rows[0]!.status,
        attemptCount: rows[0]!.attempt_count,
        maxAttempts: rows[0]!.max_attempts,
        nextAttemptAt: toIso(rows[0]!.next_attempt_at),
        lastError: rows[0]!.last_error,
        telegramMessageId: rows[0]!.telegram_message_id,
        sentAt: toIso(rows[0]!.sent_at),
        createdAt: rows[0]!.created_at.toISOString()
      };
    },

    async listTelegramReports(input: { status?: TelegramReportRow['status']; limit: number }) {
      const params: unknown[] = [];
      let where = '';
      if (input.status) {
        params.push(input.status);
        where = 'WHERE status = $1::telegram_report_status';
      }
      params.push(input.limit);
      const limitParam = input.status ? '$2' : '$1';

      const { rows } = await pool.query<TelegramReportRow>(
        `
          SELECT
            id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error,
            telegram_message_id, created_at, sent_at
          FROM telegram_reports
          ${where}
          ORDER BY created_at DESC
          LIMIT ${limitParam}
        `,
        params
      );

      return rows.map((row) => ({
        id: row.id,
        chatId: row.chat_id,
        topic: row.topic,
        bodyMarkdown: row.body_markdown,
        status: row.status,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        nextAttemptAt: toIso(row.next_attempt_at),
        lastError: row.last_error,
        telegramMessageId: row.telegram_message_id,
        sentAt: toIso(row.sent_at),
        createdAt: row.created_at.toISOString()
      }));
    },

    async getTelegramReportById(reportId: string) {
      const { rows } = await pool.query<TelegramReportRow>(
        `
          SELECT
            id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error,
            telegram_message_id, created_at, sent_at
          FROM telegram_reports
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [reportId]
      );
      if (!rows[0]) {
        return null;
      }
      return {
        id: rows[0].id,
        chatId: rows[0].chat_id,
        topic: rows[0].topic,
        bodyMarkdown: rows[0].body_markdown,
        status: rows[0].status,
        attemptCount: rows[0].attempt_count,
        maxAttempts: rows[0].max_attempts,
        nextAttemptAt: toIso(rows[0].next_attempt_at),
        lastError: rows[0].last_error,
        telegramMessageId: rows[0].telegram_message_id,
        sentAt: toIso(rows[0].sent_at),
        createdAt: rows[0].created_at.toISOString()
      };
    },

    async listPendingTelegramReports(input: { limit: number; nowIso?: string }) {
      const now = input.nowIso ? new Date(input.nowIso) : new Date();
      const { rows } = await pool.query<TelegramReportRow>(
        `
          SELECT
            id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error,
            telegram_message_id, created_at, sent_at
          FROM telegram_reports
          WHERE status = 'queued'::telegram_report_status
            AND attempt_count < max_attempts
            AND COALESCE(next_attempt_at, created_at) <= $1
          ORDER BY COALESCE(next_attempt_at, created_at) ASC, created_at ASC
          LIMIT $2
        `,
        [now, input.limit]
      );

      return rows.map((row) => ({
        id: row.id,
        chatId: row.chat_id,
        topic: row.topic,
        bodyMarkdown: row.body_markdown,
        status: row.status,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        nextAttemptAt: toIso(row.next_attempt_at),
        lastError: row.last_error,
        telegramMessageId: row.telegram_message_id,
        sentAt: toIso(row.sent_at),
        createdAt: row.created_at.toISOString()
      }));
    },

    async updateTelegramReportDelivery(input: {
      reportId: string;
      status: 'queued' | 'sent' | 'failed';
      incrementAttemptCount?: boolean;
      attemptCount?: number;
      maxAttempts?: number;
      telegramMessageId?: string | null;
      sentAt?: string | null;
      nextAttemptAt?: string | null;
      lastError?: string | null;
      bodyMarkdown?: string;
    }) {
      const shouldSetNextAttemptAt = input.nextAttemptAt !== undefined;
      const nextAttemptAt = input.nextAttemptAt ? new Date(input.nextAttemptAt) : null;
      const shouldSetLastError = input.lastError !== undefined;
      const shouldSetTelegramMessageId = input.telegramMessageId !== undefined;
      const shouldSetSentAt = input.sentAt !== undefined || input.status === 'sent';
      const sentAt = input.sentAt ? new Date(input.sentAt) : input.status === 'sent' ? new Date() : null;
      const shouldSetBodyMarkdown = input.bodyMarkdown !== undefined;
      const incrementAttempt = input.incrementAttemptCount === true;

      const { rows } = await pool.query<TelegramReportRow>(
        `
          UPDATE telegram_reports
          SET status = $2::telegram_report_status,
              attempt_count = CASE
                WHEN $4::int IS NOT NULL THEN $4::int
                WHEN $3::boolean THEN attempt_count + 1
                ELSE attempt_count
              END,
              max_attempts = COALESCE($5::int, max_attempts),
              next_attempt_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE next_attempt_at END,
              last_error = CASE WHEN $8::boolean THEN $9::text ELSE last_error END,
              telegram_message_id = CASE WHEN $10::boolean THEN $11::text ELSE telegram_message_id END,
              sent_at = CASE WHEN $12::boolean THEN $13::timestamptz ELSE sent_at END,
              body_markdown = CASE WHEN $14::boolean THEN $15::text ELSE body_markdown END
          WHERE id = $1::uuid
          RETURNING id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error, telegram_message_id, created_at, sent_at
        `,
        [
          input.reportId,
          input.status,
          incrementAttempt,
          input.attemptCount ?? null,
          input.maxAttempts ?? null,
          shouldSetNextAttemptAt,
          nextAttemptAt,
          shouldSetLastError,
          input.lastError ?? null,
          shouldSetTelegramMessageId,
          input.telegramMessageId ?? null,
          shouldSetSentAt,
          sentAt,
          shouldSetBodyMarkdown,
          input.bodyMarkdown ?? null
        ]
      );

      if (!rows[0]) {
        return null;
      }

      return {
        id: rows[0].id,
        chatId: rows[0].chat_id,
        topic: rows[0].topic,
        bodyMarkdown: rows[0].body_markdown,
        status: rows[0].status,
        attemptCount: rows[0].attempt_count,
        maxAttempts: rows[0].max_attempts,
        nextAttemptAt: toIso(rows[0].next_attempt_at),
        lastError: rows[0].last_error,
        telegramMessageId: rows[0].telegram_message_id,
        sentAt: toIso(rows[0].sent_at),
        createdAt: rows[0].created_at.toISOString()
      };
    },

    async listUpgradeProposals(status?: UpgradeStatus) {
      const params: unknown[] = [];
      let where = '';

      if (status) {
        params.push(status);
        where = 'WHERE status = $1::upgrade_status';
      }

      const { rows } = await pool.query<UpgradeProposalRow>(
        `
          SELECT id, radar_score_id, proposal_title, status, created_at, approved_at
          FROM upgrade_proposals
          ${where}
          ORDER BY created_at DESC
          LIMIT 200
        `,
        params
      );

      return rows.map((row) => mapUpgradeProposalRow(row));
    },

    async findUpgradeProposalById(proposalId: string) {
      const { rows } = await pool.query<UpgradeProposalRow>(
        `
          SELECT id, radar_score_id, proposal_title, status, created_at, approved_at
          FROM upgrade_proposals
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [proposalId]
      );

      return rows[0] ? mapUpgradeProposalRow(rows[0]) : null;
    },

    async decideUpgradeProposal(proposalId: string, decision: 'approve' | 'reject', reason?: string) {
      const nextStatus: UpgradeStatus = decision === 'approve' ? 'approved' : 'rejected';

      const { rows } = await pool.query<UpgradeProposalRow>(
        `
          UPDATE upgrade_proposals
          SET status = $2::upgrade_status,
              approved_at = CASE WHEN $2::upgrade_status = 'approved'::upgrade_status THEN now() ELSE NULL END,
              updated_at = now()
          WHERE id = $1::uuid
          RETURNING id, radar_score_id, proposal_title, status, created_at, approved_at
        `,
        [proposalId, nextStatus]
      );

      if (!rows[0]) {
        return null;
      }

      await pool.query(
        `
          INSERT INTO audit_logs (
            actor_user_id,
            action,
            entity_type,
            entity_id,
            reason,
            after_data
          )
          VALUES ($1::uuid, 'upgrade_proposal.decide', 'upgrade_proposal', $2::uuid, $3, $4::jsonb)
        `,
        [options.defaultUserId, proposalId, reason ?? nextStatus, JSON.stringify({ status: nextStatus })]
      );

      return mapUpgradeProposalRow(rows[0]);
    },

    async createUpgradeRun(payload: { proposalId: string; startCommand: string }) {
      const { rows } = await pool.query<UpgradeRunRow>(
        `
          INSERT INTO upgrade_runs (
            proposal_id,
            triggered_by,
            start_command,
            status
          )
          VALUES ($1::uuid, $2::uuid, $3, 'planning'::upgrade_status)
          RETURNING id, proposal_id, status, start_command, created_at, updated_at
        `,
        [payload.proposalId, options.defaultUserId, payload.startCommand]
      );

      return mapUpgradeRunRow(rows[0]!);
    },

    async listUpgradeRuns(limit: number) {
      const { rows } = await pool.query<UpgradeRunRow>(
        `
          SELECT id, proposal_id, status, start_command, created_at, updated_at
          FROM upgrade_runs
          ORDER BY created_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return rows.map((row) => mapUpgradeRunRow(row));
    },

    async getUpgradeRunById(runId: string) {
      const { rows } = await pool.query<UpgradeRunRow>(
        `
          SELECT id, proposal_id, status, start_command, created_at, updated_at
          FROM upgrade_runs
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [runId]
      );

      return rows[0] ? mapUpgradeRunRow(rows[0]) : null;
    },

    async createCouncilRun(input: CreateCouncilRunInput) {
      const { rows } = await pool.query<CouncilRunRow>(
        `
          INSERT INTO council_runs (
            user_id,
            idempotency_key,
            trace_id,
            question,
            status,
            consensus_status,
            summary,
            participants,
            attempts,
            provider,
            model,
            used_fallback,
            task_id
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13::uuid)
          RETURNING
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
        `,
        [
          input.user_id,
          input.idempotency_key,
          input.trace_id ?? null,
          input.question,
          input.status,
          input.consensus_status,
          input.summary,
          JSON.stringify(input.participants),
          JSON.stringify(input.attempts),
          input.provider,
          input.model,
          input.used_fallback,
          input.task_id
        ]
      );

      return mapCouncilRunRow(rows[0]!);
    },

    async updateCouncilRun(input) {
      const updates: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      const push = (sql: string, value: unknown) => {
        updates.push(`${sql} = $${i}`);
        params.push(value);
        i += 1;
      };

      if (input.status !== undefined) push('status', input.status);
      if (input.consensus_status !== undefined) push('consensus_status', input.consensus_status);
      if (input.summary !== undefined) push('summary', input.summary);
      if (input.participants !== undefined) push('participants', JSON.stringify(input.participants));
      if (input.attempts !== undefined) push('attempts', JSON.stringify(input.attempts));
      if (input.provider !== undefined) push('provider', input.provider);
      if (input.model !== undefined) push('model', input.model);
      if (input.used_fallback !== undefined) push('used_fallback', input.used_fallback);
      if (input.task_id !== undefined) push('task_id', input.task_id);

      if (updates.length === 0) {
        return store.getCouncilRunById(input.runId);
      }

      const whereIdx = i;
      params.push(input.runId);

      const { rows } = await pool.query<CouncilRunRow>(
        `
          UPDATE council_runs
          SET ${updates.join(', ')}, updated_at = now()
          WHERE id = $${whereIdx}::uuid
          RETURNING
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
        `,
        params
      );

      return rows[0] ? mapCouncilRunRow(rows[0]) : null;
    },

    async getCouncilRunByIdempotency(input: { userId: string; idempotencyKey: string }) {
      const { rows } = await pool.query<CouncilRunRow>(
        `
          SELECT
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM council_runs
          WHERE user_id = $1::uuid
            AND idempotency_key = $2
          LIMIT 1
        `,
        [input.userId, input.idempotencyKey]
      );

      return rows[0] ? mapCouncilRunRow(rows[0]) : null;
    },

    async listCouncilRuns(limit: number) {
      const { rows } = await pool.query<CouncilRunRow>(
        `
          SELECT
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM council_runs
          ORDER BY created_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return rows.map((row) => mapCouncilRunRow(row));
    },

    async getCouncilRunById(runId: string) {
      const { rows } = await pool.query<CouncilRunRow>(
        `
          SELECT
            id, question, status, consensus_status, summary, participants, attempts,
            provider, model, used_fallback, task_id, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM council_runs
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [runId]
      );

      return rows[0] ? mapCouncilRunRow(rows[0]) : null;
    },

    async createExecutionRun(input: CreateExecutionRunInput) {
      const { rows } = await pool.query<ExecutionRunRow>(
        `
          INSERT INTO execution_runs (
            user_id,
            idempotency_key,
            trace_id,
            mode,
            prompt,
            status,
            output,
            attempts,
            provider,
            model,
            used_fallback,
            task_id,
            duration_ms
          )
          VALUES ($1::uuid, $2, $3, $4::task_mode, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::uuid, $13)
          RETURNING
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
        `,
        [
          input.user_id,
          input.idempotency_key,
          input.trace_id ?? null,
          input.mode,
          input.prompt,
          input.status,
          input.output,
          JSON.stringify(input.attempts),
          input.provider,
          input.model,
          input.used_fallback,
          input.task_id,
          input.duration_ms
        ]
      );

      return mapExecutionRunRow(rows[0]!);
    },

    async updateExecutionRun(input) {
      const updates: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      const push = (sql: string, value: unknown) => {
        updates.push(`${sql} = $${i}`);
        params.push(value);
        i += 1;
      };

      if (input.status !== undefined) push('status', input.status);
      if (input.output !== undefined) push('output', input.output);
      if (input.attempts !== undefined) push('attempts', JSON.stringify(input.attempts));
      if (input.provider !== undefined) push('provider', input.provider);
      if (input.model !== undefined) push('model', input.model);
      if (input.used_fallback !== undefined) push('used_fallback', input.used_fallback);
      if (input.task_id !== undefined) push('task_id', input.task_id);
      if (input.duration_ms !== undefined) push('duration_ms', input.duration_ms);

      if (updates.length === 0) {
        return store.getExecutionRunById(input.runId);
      }

      const whereIdx = i;
      params.push(input.runId);

      const { rows } = await pool.query<ExecutionRunRow>(
        `
          UPDATE execution_runs
          SET ${updates.join(', ')}, updated_at = now()
          WHERE id = $${whereIdx}::uuid
          RETURNING
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
        `,
        params
      );

      return rows[0] ? mapExecutionRunRow(rows[0]) : null;
    },

    async getExecutionRunByIdempotency(input: { userId: string; idempotencyKey: string }) {
      const { rows } = await pool.query<ExecutionRunRow>(
        `
          SELECT
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM execution_runs
          WHERE user_id = $1::uuid
            AND idempotency_key = $2
          LIMIT 1
        `,
        [input.userId, input.idempotencyKey]
      );

      return rows[0] ? mapExecutionRunRow(rows[0]) : null;
    },

    async listExecutionRuns(limit: number) {
      const { rows } = await pool.query<ExecutionRunRow>(
        `
          SELECT
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM execution_runs
          ORDER BY created_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return rows.map((row) => mapExecutionRunRow(row));
    },

    async getExecutionRunById(runId: string) {
      const { rows } = await pool.query<ExecutionRunRow>(
        `
          SELECT
            id, mode, prompt, status, output, attempts, provider, model,
            used_fallback, task_id, duration_ms, user_id, idempotency_key, trace_id, created_at, updated_at
          FROM execution_runs
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [runId]
      );

      return rows[0] ? mapExecutionRunRow(rows[0]) : null;
    },

    async createMemorySegment(input) {
      const { rows } = await pool.query(
        `
          INSERT INTO memory_segments (user_id, task_id, segment_type, content, embedding, confidence, expires_at)
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
          RETURNING id, user_id, task_id, segment_type, content, confidence, created_at, expires_at
        `,
        [
          input.userId,
          input.taskId ?? null,
          input.segmentType,
          input.content,
          input.embedding ? `[${input.embedding.join(',')}]` : null,
          input.confidence ?? 0.5,
          input.expiresAt ?? null
        ]
      );
      const row = rows[0]!;
      return {
        id: row.id,
        userId: row.user_id,
        taskId: row.task_id,
        segmentType: row.segment_type,
        content: row.content,
        confidence: Number(row.confidence),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        expiresAt: row.expires_at ? (row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at)) : null
      };
    },

    async searchMemoryByEmbedding(input) {
      const minConf = input.minConfidence ?? 0;
      const { rows } = await pool.query(
        `
          SELECT id, user_id, task_id, segment_type, content, confidence, created_at, expires_at,
                 1 - (embedding <=> $1::vector) AS similarity
          FROM memory_segments
          WHERE user_id = $2::uuid
            AND embedding IS NOT NULL
            AND confidence >= $3
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY embedding <=> $1::vector
          LIMIT $4
        `,
        [`[${input.embedding.join(',')}]`, input.userId, minConf, input.limit]
      );
      return rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        userId: String(row.user_id),
        taskId: row.task_id ? String(row.task_id) : null,
        segmentType: String(row.segment_type),
        content: String(row.content),
        confidence: Number(row.confidence),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        expiresAt: row.expires_at ? (row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at)) : null,
        similarity: Number(row.similarity)
      }));
    },

    async listMemorySegments(input) {
      const { rows } = await pool.query(
        `
          SELECT id, user_id, task_id, segment_type, content, confidence, created_at, expires_at
          FROM memory_segments
          WHERE user_id = $1::uuid
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [input.userId, input.limit]
      );
      return rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        userId: String(row.user_id),
        taskId: row.task_id ? String(row.task_id) : null,
        segmentType: String(row.segment_type),
        content: String(row.content),
        confidence: Number(row.confidence),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        expiresAt: row.expires_at ? (row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at)) : null
      }));
    },

    async createApproval(input) {
      const { rows } = await pool.query(
        `
          INSERT INTO approvals (entity_type, entity_id, action, requested_by, expires_at)
          VALUES ($1, $2::uuid, $3, $4, $5)
          RETURNING *
        `,
        [input.entityType, input.entityId, input.action, input.requestedBy ?? null, input.expiresAt ?? null]
      );
      const row = rows[0]!;
      return mapApprovalRow(row);
    },

    async listApprovals(input) {
      const conditions = ['1=1'];
      const params: unknown[] = [];
      if (input.status) {
        params.push(input.status);
        conditions.push(`status = $${params.length}`);
      }
      params.push(input.limit);
      const { rows } = await pool.query(
        `SELECT * FROM approvals WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      );
      return rows.map(mapApprovalRow);
    },

    async decideApproval(input) {
      const { rows } = await pool.query(
        `
          UPDATE approvals
          SET status = $1, decided_by = $2::uuid, decided_at = now(), reason = $3
          WHERE id = $4::uuid AND status = 'pending'
          RETURNING *
        `,
        [input.decision, input.decidedBy, input.reason ?? null, input.approvalId]
      );
      return rows[0] ? mapApprovalRow(rows[0]) : null;
    },

    createUpgradeExecutorGateway() {
      return {
        findProposalById: async (proposalId: string) => {
          const proposal = await store.findUpgradeProposalById(proposalId);
          if (!proposal) {
            return null;
          }
          return {
            id: proposal.id,
            status: proposal.status,
            approvedAt: proposal.approvedAt
          };
        },
        createRun: async (payload: { proposalId: string; startCommand: string }) => {
          const run = await store.createUpgradeRun(payload);
          return {
            id: run.id,
            proposalId: run.proposalId,
            status: run.status
          };
        },
        appendAuditLog: async (entry: { action: string; proposalId: string; reason: string }) => {
          await pool.query(
            `
              INSERT INTO audit_logs (
                actor_user_id,
                action,
                entity_type,
                entity_id,
                reason,
                after_data
              )
              VALUES ($1::uuid, $2, 'upgrade_proposal', $3::uuid, $4, $5::jsonb)
            `,
            [
              options.defaultUserId,
              entry.action,
              entry.proposalId,
              entry.reason,
              JSON.stringify({ reason: entry.reason })
            ]
          );
        }
      };
    }
  };

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
      steps: stepRows.map((step) => mapMissionStepRow(step)),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  function mapTaskRow(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      userId: row.user_id,
      mode: row.mode,
      status: row.status,
      title: row.title,
      input: row.input,
      idempotencyKey: row.idempotency_key,
      traceId: row.trace_id ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  function mapAssistantContextRow(row: AssistantContextRow): AssistantContextRecord {
    const widgetPlan = parseJsonArray<string>(row.widget_plan).filter((item) => typeof item === 'string' && item.trim().length > 0);

    return {
      id: row.id,
      userId: row.user_id,
      clientContextId: row.client_context_id,
      source: row.source,
      intent: row.intent,
      prompt: row.prompt,
      widgetPlan,
      status: row.status,
      taskId: row.task_id,
      servedProvider: row.served_provider,
      servedModel: row.served_model,
      usedFallback: row.used_fallback,
      selectionReason: row.selection_reason,
      output: row.output,
      error: row.error,
      revision: row.revision,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  function mapAssistantContextEventRow(row: AssistantContextEventRow): AssistantContextEventRecord {
    return {
      id: row.id,
      contextId: row.context_id,
      sequence: typeof row.sequence === 'string' ? Number.parseInt(row.sequence, 10) : row.sequence,
      eventType: row.event_type,
      data: row.data,
      traceId: row.trace_id ?? undefined,
      spanId: row.span_id ?? undefined,
      createdAt: row.created_at.toISOString()
    };
  }

  function mapAuthUserRow(row: AuthUserRow): AuthUserRecord {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  function mapAuthUserWithPasswordRow(row: AuthUserRow): AuthUserWithPasswordRecord {
    return {
      ...mapAuthUserRow(row),
      passwordHash: row.password_hash
    };
  }

  function mapTaskEventRow(row: TaskEventRow): TaskEventRecord {
    return {
      id: row.id,
      taskId: row.task_id,
      type: row.type,
      timestamp: row.created_at.toISOString(),
      data: row.data,
      traceId: row.trace_id ?? undefined,
      spanId: row.span_id ?? undefined
    };
  }

  function mapUpgradeProposalRow(row: UpgradeProposalRow): UpgradeProposalRecord {
    return {
      id: row.id,
      recommendationId: row.radar_score_id,
      proposalTitle: row.proposal_title,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      approvedAt: toIso(row.approved_at)
    };
  }

  function mapUpgradeRunRow(row: UpgradeRunRow): UpgradeRunApiRecord {
    return {
      id: row.id,
      proposalId: row.proposal_id,
      status: row.status,
      startCommand: row.start_command,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  function parseJsonArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) {
      return value as T[];
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch {
        return [];
      }
    }

    return [];
  }

  function mapCouncilRunRow(row: CouncilRunRow): CouncilRunRecord {
    return {
      id: row.id,
      question: row.question,
      status: row.status,
      consensus_status: row.consensus_status,
      summary: row.summary,
      participants: parseJsonArray<CouncilParticipantRecord>(row.participants),
      attempts: parseJsonArray<ProviderAttemptRecord>(row.attempts),
      provider: row.provider,
      model: row.model,
      used_fallback: row.used_fallback,
      task_id: row.task_id,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString()
    };
  }

  function mapExecutionRunRow(row: ExecutionRunRow): ExecutionRunRecord {
    return {
      id: row.id,
      mode: row.mode,
      prompt: row.prompt,
      status: row.status,
      output: row.output,
      attempts: parseJsonArray<ProviderAttemptRecord>(row.attempts),
      provider: row.provider,
      model: row.model,
      used_fallback: row.used_fallback,
      task_id: row.task_id,
      duration_ms: row.duration_ms,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString()
    };
  }

  function mapApprovalRow(row: Record<string, unknown>) {
    return {
      id: String(row.id),
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      action: String(row.action),
      status: String(row.status) as 'pending' | 'approved' | 'rejected' | 'expired',
      requestedBy: row.requested_by ? String(row.requested_by) : null,
      decidedBy: row.decided_by ? String(row.decided_by) : null,
      decidedAt: row.decided_at ? (row.decided_at instanceof Date ? row.decided_at.toISOString() : String(row.decided_at)) : null,
      reason: row.reason ? String(row.reason) : null,
      expiresAt: row.expires_at ? (row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at)) : null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
    };
  }

  return store;
}
