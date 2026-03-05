import type { Pool } from 'pg';

import type {
  AiInvocationMetrics,
  AuthSessionRecord,
  AuthUserRecord,
  AuthUserWithPasswordRecord,
  ModelControlFeatureKey,
  ProviderCredentialProvider,
  UserRole
} from '../types';
import type { AuthRepositoryContract } from '../repository-contracts';
import type {
  AuthSessionRow,
  AiInvocationTraceRow,
  ModelRecommendationRunRow,
  AuthUserRow,
  ProviderCredentialRow,
  ProviderOauthStateRow,
  UserModelSelectionPreferenceRow,
  UserProviderCredentialRow
} from './types';

type AuthRepositoryDeps = {
  pool: Pool;
};

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

function mapUserProviderCredentialRow(row: UserProviderCredentialRow) {
  return {
    userId: row.user_id,
    provider: row.provider,
    encryptedPayload: row.encrypted_payload,
    isActive: row.is_active,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString()
  };
}

function mapProviderOauthStateRow(row: ProviderOauthStateRow) {
  return {
    state: row.state,
    userId: row.user_id,
    provider: row.provider,
    encryptedContext: row.encrypted_context,
    expiresAt: row.expires_at.toISOString(),
    consumedAt: row.consumed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function mapUserModelSelectionPreferenceRow(row: UserModelSelectionPreferenceRow) {
  return {
    userId: row.user_id,
    featureKey: row.feature_key as ModelControlFeatureKey,
    provider: row.provider,
    modelId: row.model_id,
    strictProvider: row.strict_provider,
    selectionMode: row.selection_mode,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString()
  };
}

function mapModelRecommendationRunRow(row: ModelRecommendationRunRow) {
  return {
    id: row.id,
    userId: row.user_id,
    featureKey: row.feature_key as ModelControlFeatureKey,
    promptHash: row.prompt_hash,
    promptExcerptRedacted: row.prompt_excerpt_redacted,
    recommendedProvider: row.recommended_provider,
    recommendedModelId: row.recommended_model_id,
    rationaleText: row.rationale_text,
    evidenceJson: row.evidence_json ?? {},
    recommenderProvider: row.recommender_provider,
    appliedAt: row.applied_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function mapAiInvocationTraceRow(row: AiInvocationTraceRow) {
  return {
    id: row.id,
    userId: row.user_id,
    featureKey: row.feature_key as ModelControlFeatureKey | 'diagnostic',
    taskType: row.task_type,
    requestProvider: row.request_provider,
    requestModel: row.request_model,
    resolvedProvider: row.resolved_provider,
    resolvedModel: row.resolved_model,
    credentialMode: row.credential_mode,
    credentialSource: row.credential_source,
    attemptsJson: Array.isArray(row.attempts_json) ? (row.attempts_json as Array<Record<string, unknown>>) : [],
    usedFallback: row.used_fallback,
    success: row.success,
    errorCode: row.error_code,
    errorMessageRedacted: row.error_message_redacted,
    latencyMs: row.latency_ms,
    traceId: row.trace_id,
    contextRefsJson:
      row.context_refs_json && typeof row.context_refs_json === 'object'
        ? row.context_refs_json
        : {},
    createdAt: row.created_at.toISOString()
  };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

export function createAuthRepository({ pool }: AuthRepositoryDeps): AuthRepositoryContract {
  return {
    async createAuthUser(input: {
      email: string;
      displayName?: string;
      passwordHash: string;
      role?: UserRole;
    }): Promise<AuthUserRecord | null> {
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
    }): Promise<AuthUserRecord> {
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

    async findAuthUserByEmail(email: string): Promise<AuthUserWithPasswordRecord | null> {
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

    async getAuthUserById(userId: string): Promise<AuthUserRecord | null> {
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

    async createAuthSession(input: { userId: string; tokenHash: string; expiresAt: string }): Promise<void> {
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

    async revokeAuthSession(tokenHash: string): Promise<boolean> {
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

    async deleteProviderCredential(provider: 'openai' | 'gemini' | 'anthropic' | 'local'): Promise<boolean> {
      const { rowCount } = await pool.query(
        `
          DELETE FROM provider_credentials
          WHERE provider = $1
        `,
        [provider]
      );
      return (rowCount ?? 0) > 0;
    },

    async listUserProviderCredentials(input: { userId: string; includeInactive?: boolean }) {
      const includeInactive = input.includeInactive === true;
      const { rows } = await pool.query<UserProviderCredentialRow>(
        `
          SELECT user_id, provider, encrypted_payload, is_active, updated_by, updated_at
          FROM user_provider_credentials
          WHERE user_id = $1::uuid
            AND ($2::boolean = true OR is_active = true)
          ORDER BY provider ASC
        `,
        [input.userId, includeInactive]
      );
      return rows.map(mapUserProviderCredentialRow);
    },

    async getUserProviderCredential(input: {
      userId: string;
      provider: ProviderCredentialProvider;
      includeInactive?: boolean;
    }) {
      const includeInactive = input.includeInactive === true;
      const { rows } = await pool.query<UserProviderCredentialRow>(
        `
          SELECT user_id, provider, encrypted_payload, is_active, updated_by, updated_at
          FROM user_provider_credentials
          WHERE user_id = $1::uuid
            AND provider = $2
            AND ($3::boolean = true OR is_active = true)
          LIMIT 1
        `,
        [input.userId, input.provider, includeInactive]
      );
      return rows[0] ? mapUserProviderCredentialRow(rows[0]) : null;
    },

    async upsertUserProviderCredential(input: {
      userId: string;
      provider: ProviderCredentialProvider;
      encryptedPayload: string;
      isActive?: boolean;
      updatedBy?: string | null;
    }) {
      const { rows } = await pool.query<UserProviderCredentialRow>(
        `
          INSERT INTO user_provider_credentials (
            user_id,
            provider,
            encrypted_payload,
            is_active,
            updated_by
          )
          VALUES ($1::uuid, $2, $3, $4, $5::uuid)
          ON CONFLICT (user_id, provider) DO UPDATE
          SET
            encrypted_payload = EXCLUDED.encrypted_payload,
            is_active = EXCLUDED.is_active,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
          RETURNING user_id, provider, encrypted_payload, is_active, updated_by, updated_at
        `,
        [input.userId, input.provider, input.encryptedPayload, input.isActive ?? true, input.updatedBy ?? null]
      );
      const row = rows[0];
      if (!row) {
        throw new Error('failed to upsert user provider credential');
      }
      return mapUserProviderCredentialRow(row);
    },

    async deleteUserProviderCredential(input: { userId: string; provider: ProviderCredentialProvider }) {
      const { rowCount } = await pool.query(
        `
          DELETE FROM user_provider_credentials
          WHERE user_id = $1::uuid
            AND provider = $2
        `,
        [input.userId, input.provider]
      );
      return (rowCount ?? 0) > 0;
    },

    async listActiveUserProviderCredentials(input: { provider?: ProviderCredentialProvider; limit: number }) {
      const limit = Math.max(1, Math.min(1000, Math.trunc(input.limit)));
      const { rows } = await pool.query<UserProviderCredentialRow>(
        `
          SELECT user_id, provider, encrypted_payload, is_active, updated_by, updated_at
          FROM user_provider_credentials
          WHERE is_active = true
            AND ($1::text IS NULL OR provider = $1)
          ORDER BY updated_at DESC
          LIMIT $2
        `,
        [input.provider ?? null, limit]
      );
      return rows.map(mapUserProviderCredentialRow);
    },

    async createProviderOauthState(input: {
      state: string;
      userId: string;
      provider: ProviderCredentialProvider;
      encryptedContext: string;
      expiresAt: string;
    }) {
      const { rows } = await pool.query<ProviderOauthStateRow>(
        `
          INSERT INTO provider_oauth_states (
            state,
            user_id,
            provider,
            encrypted_context,
            expires_at
          )
          VALUES ($1, $2::uuid, $3, $4, $5::timestamptz)
          RETURNING state, user_id, provider, encrypted_context, expires_at, consumed_at, created_at
        `,
        [input.state, input.userId, input.provider, input.encryptedContext, input.expiresAt]
      );
      const row = rows[0];
      if (!row) {
        throw new Error('failed to create oauth state');
      }
      return mapProviderOauthStateRow(row);
    },

    async consumeProviderOauthState(input: { state: string; provider: ProviderCredentialProvider }) {
      const { rows } = await pool.query<ProviderOauthStateRow>(
        `
          UPDATE provider_oauth_states
          SET consumed_at = now()
          WHERE state = $1
            AND provider = $2
            AND consumed_at IS NULL
            AND expires_at > now()
          RETURNING state, user_id, provider, encrypted_context, expires_at, consumed_at, created_at
        `,
        [input.state, input.provider]
      );
      return rows[0] ? mapProviderOauthStateRow(rows[0]) : null;
    },

    async cleanupExpiredProviderOauthStates(input?: { nowIso?: string; limit?: number }) {
      const limit = Math.max(1, Math.min(1000, Math.trunc(input?.limit ?? 200)));
      const nowIso = input?.nowIso ?? new Date().toISOString();
      const { rowCount } = await pool.query(
        `
          WITH candidate AS (
            SELECT state
            FROM provider_oauth_states
            WHERE consumed_at IS NOT NULL
               OR expires_at <= $1::timestamptz
            ORDER BY created_at ASC
            LIMIT $2
          )
          DELETE FROM provider_oauth_states s
          USING candidate
          WHERE s.state = candidate.state
        `,
        [nowIso, limit]
      );
      return rowCount ?? 0;
    },

    async listUserModelSelectionPreferences(input: { userId: string }) {
      const { rows } = await pool.query<UserModelSelectionPreferenceRow>(
        `
          SELECT user_id, feature_key, provider, model_id, strict_provider, selection_mode, updated_by, updated_at
          FROM user_model_selection_preferences
          WHERE user_id = $1::uuid
          ORDER BY feature_key ASC
        `,
        [input.userId]
      );
      return rows.map(mapUserModelSelectionPreferenceRow);
    },

    async getUserModelSelectionPreference(input: {
      userId: string;
      featureKey: ModelControlFeatureKey;
    }) {
      const { rows } = await pool.query<UserModelSelectionPreferenceRow>(
        `
          SELECT user_id, feature_key, provider, model_id, strict_provider, selection_mode, updated_by, updated_at
          FROM user_model_selection_preferences
          WHERE user_id = $1::uuid
            AND feature_key = $2
          LIMIT 1
        `,
        [input.userId, input.featureKey]
      );
      return rows[0] ? mapUserModelSelectionPreferenceRow(rows[0]) : null;
    },

    async upsertUserModelSelectionPreference(input) {
      const { rows } = await pool.query<UserModelSelectionPreferenceRow>(
        `
          INSERT INTO user_model_selection_preferences (
            user_id,
            feature_key,
            provider,
            model_id,
            strict_provider,
            selection_mode,
            updated_by
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
          ON CONFLICT (user_id, feature_key) DO UPDATE
          SET
            provider = EXCLUDED.provider,
            model_id = EXCLUDED.model_id,
            strict_provider = EXCLUDED.strict_provider,
            selection_mode = EXCLUDED.selection_mode,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
          RETURNING user_id, feature_key, provider, model_id, strict_provider, selection_mode, updated_by, updated_at
        `,
        [
          input.userId,
          input.featureKey,
          input.provider,
          input.modelId ?? null,
          input.strictProvider ?? false,
          input.selectionMode ?? 'manual',
          input.updatedBy ?? null
        ]
      );
      const row = rows[0];
      if (!row) {
        throw new Error('failed to upsert user model selection preference');
      }
      return mapUserModelSelectionPreferenceRow(row);
    },

    async deleteUserModelSelectionPreference(input: { userId: string; featureKey: ModelControlFeatureKey }) {
      const { rowCount } = await pool.query(
        `
          DELETE FROM user_model_selection_preferences
          WHERE user_id = $1::uuid
            AND feature_key = $2
        `,
        [input.userId, input.featureKey]
      );
      return (rowCount ?? 0) > 0;
    },

    async createModelRecommendationRun(input) {
      const { rows } = await pool.query<ModelRecommendationRunRow>(
        `
          INSERT INTO model_recommendation_runs (
            user_id,
            feature_key,
            prompt_hash,
            prompt_excerpt_redacted,
            recommended_provider,
            recommended_model_id,
            rationale_text,
            evidence_json,
            recommender_provider
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
          RETURNING id, user_id, feature_key, prompt_hash, prompt_excerpt_redacted,
                    recommended_provider, recommended_model_id, rationale_text, evidence_json,
                    recommender_provider, applied_at, created_at
        `,
        [
          input.userId,
          input.featureKey,
          input.promptHash,
          input.promptExcerptRedacted,
          input.recommendedProvider,
          input.recommendedModelId,
          input.rationaleText,
          JSON.stringify(input.evidenceJson ?? {}),
          input.recommenderProvider ?? 'openai'
        ]
      );
      const row = rows[0];
      if (!row) {
        throw new Error('failed to create model recommendation run');
      }
      return mapModelRecommendationRunRow(row);
    },

    async listModelRecommendationRuns(input: { userId: string; limit: number; featureKey?: ModelControlFeatureKey }) {
      const limit = Math.max(1, Math.min(200, Math.trunc(input.limit)));
      const { rows } = await pool.query<ModelRecommendationRunRow>(
        `
          SELECT id, user_id, feature_key, prompt_hash, prompt_excerpt_redacted,
                 recommended_provider, recommended_model_id, rationale_text, evidence_json,
                 recommender_provider, applied_at, created_at
          FROM model_recommendation_runs
          WHERE user_id = $1::uuid
            AND ($2::text IS NULL OR feature_key = $2)
          ORDER BY created_at DESC
          LIMIT $3
        `,
        [input.userId, input.featureKey ?? null, limit]
      );
      return rows.map(mapModelRecommendationRunRow);
    },

    async markModelRecommendationApplied(input: { recommendationId: string; userId: string }) {
      const { rows } = await pool.query<ModelRecommendationRunRow>(
        `
          UPDATE model_recommendation_runs
          SET applied_at = COALESCE(applied_at, now())
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          RETURNING id, user_id, feature_key, prompt_hash, prompt_excerpt_redacted,
                    recommended_provider, recommended_model_id, rationale_text, evidence_json,
                    recommender_provider, applied_at, created_at
        `,
        [input.recommendationId, input.userId]
      );
      return rows[0] ? mapModelRecommendationRunRow(rows[0]) : null;
    },

    async cleanupExpiredModelRecommendationRuns(input?: { nowIso?: string; retentionDays?: number; limit?: number }) {
      const nowIso = input?.nowIso ?? new Date().toISOString();
      const retentionDays = Math.max(1, Math.min(365, Math.trunc(input?.retentionDays ?? 30)));
      const limit = Math.max(1, Math.min(5000, Math.trunc(input?.limit ?? 500)));
      const { rowCount } = await pool.query(
        `
          WITH candidate AS (
            SELECT id
            FROM model_recommendation_runs
            WHERE created_at <= ($1::timestamptz - ($2::text || ' days')::interval)
            ORDER BY created_at ASC
            LIMIT $3
          )
          DELETE FROM model_recommendation_runs r
          USING candidate
          WHERE r.id = candidate.id
        `,
        [nowIso, String(retentionDays), limit]
      );
      return rowCount ?? 0;
    },

    async createAiInvocationTrace(input) {
      const { rows } = await pool.query<AiInvocationTraceRow>(
        `
          INSERT INTO ai_invocation_traces (
            user_id,
            feature_key,
            task_type,
            request_provider,
            request_model,
            trace_id,
            context_refs_json
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)
          RETURNING id, user_id, feature_key, task_type, request_provider, request_model,
                    resolved_provider, resolved_model, credential_mode, credential_source,
                    attempts_json, used_fallback, success, error_code, error_message_redacted,
                    latency_ms, trace_id, context_refs_json, created_at
        `,
        [
          input.userId,
          input.featureKey,
          input.taskType,
          input.requestProvider,
          input.requestModel ?? null,
          input.traceId ?? null,
          JSON.stringify(input.contextRefsJson ?? {})
        ]
      );
      const row = rows[0];
      if (!row) {
        throw new Error('failed to create ai invocation trace');
      }
      return mapAiInvocationTraceRow(row);
    },

    async completeAiInvocationTrace(input) {
      const { rows } = await pool.query<AiInvocationTraceRow>(
        `
          UPDATE ai_invocation_traces
          SET
            resolved_provider = COALESCE($2, resolved_provider),
            resolved_model = COALESCE($3, resolved_model),
            credential_mode = $4,
            credential_source = COALESCE($5, credential_source),
            attempts_json = COALESCE($6::jsonb, attempts_json),
            used_fallback = COALESCE($7, used_fallback),
            success = $8,
            error_code = $9,
            error_message_redacted = $10,
            latency_ms = $11
          WHERE id = $1::uuid
          RETURNING id, user_id, feature_key, task_type, request_provider, request_model,
                    resolved_provider, resolved_model, credential_mode, credential_source,
                    attempts_json, used_fallback, success, error_code, error_message_redacted,
                    latency_ms, trace_id, context_refs_json, created_at
        `,
        [
          input.id,
          input.resolvedProvider ?? null,
          input.resolvedModel ?? null,
          input.credentialMode ?? null,
          input.credentialSource ?? null,
          input.attemptsJson ? JSON.stringify(input.attemptsJson) : null,
          typeof input.usedFallback === 'boolean' ? input.usedFallback : null,
          input.success,
          input.errorCode ?? null,
          input.errorMessageRedacted ?? null,
          Math.max(0, Math.trunc(input.latencyMs))
        ]
      );
      return rows[0] ? mapAiInvocationTraceRow(rows[0]) : null;
    },

    async listAiInvocationTraces(input) {
      const limit = Math.max(1, Math.min(500, Math.trunc(input.limit)));
      const { rows } = await pool.query<AiInvocationTraceRow>(
        `
          SELECT id, user_id, feature_key, task_type, request_provider, request_model,
                 resolved_provider, resolved_model, credential_mode, credential_source,
                 attempts_json, used_fallback, success, error_code, error_message_redacted,
                 latency_ms, trace_id, context_refs_json, created_at
          FROM ai_invocation_traces
          WHERE user_id = $1::uuid
            AND ($2::text IS NULL OR feature_key = $2)
            AND ($3::boolean IS NULL OR success = $3)
          ORDER BY created_at DESC
          LIMIT $4
        `,
        [input.userId, input.featureKey ?? null, typeof input.success === 'boolean' ? input.success : null, limit]
      );
      return rows.map(mapAiInvocationTraceRow);
    },

    async getAiInvocationMetrics(input): Promise<AiInvocationMetrics> {
      const sinceIso = input.sinceIso ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { rows } = await pool.query<{
        resolved_provider: 'openai' | 'gemini' | 'anthropic' | 'local' | null;
        credential_source: 'user' | 'workspace' | 'env' | 'none';
        success: boolean;
        latency_ms: number;
        created_at: Date;
      }>(
        `
          SELECT resolved_provider, credential_source, success, latency_ms, created_at
          FROM ai_invocation_traces
          WHERE user_id = $1::uuid
            AND created_at >= $2::timestamptz
          ORDER BY created_at ASC
        `,
        [input.userId, sinceIso]
      );

      const total = rows.length;
      const successCount = rows.filter((row) => row.success).length;
      const failureCount = total - successCount;
      const latencies = rows.map((row) => Math.max(0, row.latency_ms));
      const providerCounter = new Map<'openai' | 'gemini' | 'anthropic' | 'local', number>();
      const sourceCounter = new Map<'user' | 'workspace' | 'env' | 'none', number>();
      for (const row of rows) {
        if (row.resolved_provider) {
          providerCounter.set(row.resolved_provider, (providerCounter.get(row.resolved_provider) ?? 0) + 1);
        }
        sourceCounter.set(row.credential_source, (sourceCounter.get(row.credential_source) ?? 0) + 1);
      }

      return {
        windowStart: sinceIso,
        windowEnd: rows[rows.length - 1]?.created_at?.toISOString() ?? new Date().toISOString(),
        total,
        successCount,
        failureCount,
        successRate: total > 0 ? Number((successCount / total).toFixed(4)) : 0,
        p50LatencyMs: percentile(latencies, 0.5),
        p95LatencyMs: percentile(latencies, 0.95),
        providerDistribution: Array.from(providerCounter.entries())
          .map(([provider, count]) => ({ provider, count }))
          .sort((left, right) => right.count - left.count),
        credentialSourceDistribution: Array.from(sourceCounter.entries())
          .map(([source, count]) => ({ source, count }))
          .sort((left, right) => right.count - left.count)
      };
    },

    async cleanupExpiredAiInvocationTraces(input?: { nowIso?: string; retentionDays?: number; limit?: number }) {
      const nowIso = input?.nowIso ?? new Date().toISOString();
      const retentionDays = Math.max(1, Math.min(365, Math.trunc(input?.retentionDays ?? 30)));
      const limit = Math.max(1, Math.min(10000, Math.trunc(input?.limit ?? 1000)));
      const { rowCount } = await pool.query(
        `
          WITH candidate AS (
            SELECT id
            FROM ai_invocation_traces
            WHERE created_at <= ($1::timestamptz - ($2::text || ' days')::interval)
            ORDER BY created_at ASC
            LIMIT $3
          )
          DELETE FROM ai_invocation_traces t
          USING candidate
          WHERE t.id = candidate.id
        `,
        [nowIso, String(retentionDays), limit]
      );
      return rowCount ?? 0;
    }
  };
}
