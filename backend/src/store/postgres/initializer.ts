import type { Pool } from 'pg';

type PostgresInitializerDeps = {
  pool: Pool;
  defaultUserId: string;
  defaultUserEmail: string;
};

export async function initializePostgresStore({
  pool,
  defaultUserId,
  defaultUserEmail
}: PostgresInitializerDeps): Promise<void> {
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
    CREATE TABLE IF NOT EXISTS user_provider_credentials (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      encrypted_payload TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, provider),
      CHECK (provider IN ('openai', 'gemini', 'anthropic', 'local'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_provider_credentials_provider_active
    ON user_provider_credentials(provider, is_active, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_provider_credentials_user_active
    ON user_provider_credentials(user_id, is_active, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_oauth_states (
      state TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      encrypted_context TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (provider IN ('openai', 'gemini', 'anthropic', 'local'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_expires_at
    ON provider_oauth_states(expires_at ASC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_user_provider
    ON provider_oauth_states(user_id, provider, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_model_selection_preferences (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature_key TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT,
      strict_provider BOOLEAN NOT NULL DEFAULT false,
      selection_mode TEXT NOT NULL DEFAULT 'manual',
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, feature_key),
      CHECK (feature_key IN (
        'global_default',
        'assistant_chat',
        'assistant_context_run',
        'council_run',
        'execution_code',
        'execution_compute',
        'mission_plan_generation',
        'mission_execute_step'
      )),
      CHECK (provider IN ('openai', 'gemini', 'anthropic', 'local', 'auto')),
      CHECK (selection_mode IN ('auto', 'manual'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_model_selection_preferences_user_updated_at
    ON user_model_selection_preferences(user_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS model_recommendation_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature_key TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      prompt_excerpt_redacted TEXT NOT NULL,
      recommended_provider TEXT NOT NULL,
      recommended_model_id TEXT NOT NULL,
      rationale_text TEXT NOT NULL,
      evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      recommender_provider TEXT NOT NULL DEFAULT 'openai',
      applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (feature_key IN (
        'global_default',
        'assistant_chat',
        'assistant_context_run',
        'council_run',
        'execution_code',
        'execution_compute',
        'mission_plan_generation',
        'mission_execute_step'
      )),
      CHECK (recommended_provider IN ('openai', 'gemini', 'anthropic', 'local')),
      CHECK (recommender_provider IN ('openai'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_model_recommendation_runs_user_created_at
    ON model_recommendation_runs(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_model_recommendation_runs_created_at
    ON model_recommendation_runs(created_at ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_invocation_traces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature_key TEXT NOT NULL,
      task_type TEXT NOT NULL,
      request_provider TEXT NOT NULL,
      request_model TEXT,
      resolved_provider TEXT,
      resolved_model TEXT,
      credential_mode TEXT,
      credential_source TEXT NOT NULL DEFAULT 'none',
      attempts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      used_fallback BOOLEAN NOT NULL DEFAULT false,
      success BOOLEAN NOT NULL DEFAULT false,
      error_code TEXT,
      error_message_redacted TEXT,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      trace_id TEXT,
      context_refs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (feature_key IN (
        'diagnostic',
        'global_default',
        'assistant_chat',
        'assistant_context_run',
        'council_run',
        'execution_code',
        'execution_compute',
        'mission_plan_generation',
        'mission_execute_step'
      )),
      CHECK (request_provider IN ('openai', 'gemini', 'anthropic', 'local', 'auto')),
      CHECK (resolved_provider IS NULL OR resolved_provider IN ('openai', 'gemini', 'anthropic', 'local')),
      CHECK (credential_mode IS NULL OR credential_mode IN ('api_key', 'oauth_official')),
      CHECK (credential_source IN ('user', 'workspace', 'env', 'none'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_invocation_traces_user_created_at
    ON ai_invocation_traces(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_invocation_traces_created_at
    ON ai_invocation_traces(created_at ASC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_invocation_traces_user_feature_created_at
    ON ai_invocation_traces(user_id, feature_key, created_at DESC)
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
      mission_contract JSONB NOT NULL DEFAULT '{}'::jsonb,
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
      dependencies UUID[] NOT NULL DEFAULT '{}',
      execution_result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (step_type IN ('llm_generate', 'council_debate', 'human_gate', 'tool_call', 'sub_mission',
                            'code', 'research', 'finance', 'news', 'approval', 'execute')),
      CHECK (status IN ('pending', 'running', 'done', 'blocked', 'failed')),
      CHECK (step_order > 0)
    )
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS missions
    ADD COLUMN IF NOT EXISTS mission_contract JSONB NOT NULL DEFAULT '{}'::jsonb
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
    ALTER TABLE IF EXISTS mission_steps
    ADD COLUMN IF NOT EXISTS task_type TEXT
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS mission_steps
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS mission_steps
    ADD COLUMN IF NOT EXISTS dependencies UUID[] NOT NULL DEFAULT '{}'
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS mission_steps
    ADD COLUMN IF NOT EXISTS execution_result JSONB
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
    CREATE TABLE IF NOT EXISTS assistant_context_grounding_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      context_id UUID NOT NULL REFERENCES assistant_contexts(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      domain TEXT NOT NULL,
      source_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (context_id, url)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_assistant_context_grounding_sources_context_order
    ON assistant_context_grounding_sources(context_id, source_order ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assistant_context_grounding_claims (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      context_id UUID NOT NULL REFERENCES assistant_contexts(id) ON DELETE CASCADE,
      claim_text TEXT NOT NULL,
      claim_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_assistant_context_grounding_claims_context_order
    ON assistant_context_grounding_claims(context_id, claim_order ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assistant_context_grounding_claim_citations (
      claim_id UUID NOT NULL REFERENCES assistant_context_grounding_claims(id) ON DELETE CASCADE,
      source_id UUID NOT NULL REFERENCES assistant_context_grounding_sources(id) ON DELETE CASCADE,
      citation_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (claim_id, source_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_assistant_context_grounding_claim_citations_claim_order
    ON assistant_context_grounding_claim_citations(claim_id, citation_order ASC)
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
    [defaultUserId, defaultUserEmail, 'Jarvis Local User']
  );
}
