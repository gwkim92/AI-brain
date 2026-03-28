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
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'radar_item_status') THEN
        CREATE TYPE radar_item_status AS ENUM ('new', 'scored', 'archived');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'radar_decision') THEN
        CREATE TYPE radar_decision AS ENUM ('adopt', 'hold', 'discard');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'upgrade_status') THEN
        CREATE TYPE upgrade_status AS ENUM (
          'proposed', 'approved', 'planning', 'running', 'verifying', 'deployed', 'failed', 'rolled_back', 'rejected'
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'telegram_report_status') THEN
        CREATE TYPE telegram_report_status AS ENUM ('queued', 'sent', 'failed');
      END IF;
    END
    $$;
  `);
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
    CREATE TABLE IF NOT EXISTS memory_segments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
      segment_type TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(1536),
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_memory_segments_user_created_at
    ON memory_segments(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jarvis_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      source TEXT NOT NULL,
      intent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      workspace_preset TEXT,
      primary_target TEXT NOT NULL,
      task_id UUID,
      mission_id UUID,
      assistant_context_id UUID,
      council_run_id UUID,
      execution_run_id UUID,
      briefing_id UUID,
      dossier_id UUID,
      last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (intent IN ('general', 'code', 'research', 'finance', 'news')),
      CHECK (status IN ('queued', 'running', 'blocked', 'needs_approval', 'completed', 'failed', 'stale')),
      CHECK (workspace_preset IS NULL OR workspace_preset IN ('jarvis', 'research', 'execution', 'control')),
      CHECK (primary_target IN ('assistant', 'mission', 'council', 'execution', 'briefing', 'dossier'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jarvis_sessions_user_status_updated_at
    ON jarvis_sessions(user_id, status, updated_at DESC)
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'jarvis_sessions'
          AND c.conname = 'jarvis_sessions_intent_check'
      ) THEN
        ALTER TABLE jarvis_sessions DROP CONSTRAINT IF EXISTS jarvis_sessions_intent_check;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'jarvis_sessions'
          AND c.conname = 'jarvis_sessions_intent_check'
      ) THEN
        ALTER TABLE jarvis_sessions
        ADD CONSTRAINT jarvis_sessions_intent_check
        CHECK (intent IN ('general', 'code', 'research', 'finance', 'news', 'council'));
      END IF;
    END
    $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      memory_key TEXT,
      memory_value TEXT,
      attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      pinned BOOLEAN NOT NULL DEFAULT false,
      source TEXT NOT NULL DEFAULT 'manual',
      related_session_id UUID REFERENCES jarvis_sessions(id) ON DELETE SET NULL,
      related_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (kind IN ('user_preference', 'project_context', 'decision_memory', 'research_memory')),
      CHECK (source IN ('manual', 'session', 'system'))
    )
  `);
  await pool.query(`
    ALTER TABLE memory_notes
    ADD COLUMN IF NOT EXISTS memory_key TEXT
  `);
  await pool.query(`
    ALTER TABLE memory_notes
    ADD COLUMN IF NOT EXISTS memory_value TEXT
  `);
  await pool.query(`
    ALTER TABLE memory_notes
    ADD COLUMN IF NOT EXISTS attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_memory_notes_user_kind_updated_at
    ON memory_notes(user_id, kind, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_memory_notes_user_pinned_updated_at
    ON memory_notes(user_id, pinned, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jarvis_session_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES jarvis_sessions(id) ON DELETE CASCADE,
      sequence BIGSERIAL NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      status TEXT,
      summary TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (status IS NULL OR status IN ('queued', 'running', 'blocked', 'needs_approval', 'completed', 'failed', 'stale'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jarvis_session_events_session_sequence
    ON jarvis_session_events(session_id, sequence ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jarvis_session_stages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES jarvis_sessions(id) ON DELETE CASCADE,
      stage_key TEXT NOT NULL,
      capability TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      order_index INTEGER NOT NULL DEFAULT 0,
      depends_on_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      artifact_refs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary TEXT,
      error_code TEXT,
      error_message TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (session_id, stage_key),
      CHECK (capability IN ('answer', 'research', 'brief', 'debate', 'plan', 'approve', 'execute', 'monitor', 'notify')),
      CHECK (status IN ('queued', 'running', 'blocked', 'needs_approval', 'completed', 'failed', 'skipped'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jarvis_session_stages_session_order
    ON jarvis_session_stages(session_id, order_index ASC, created_at ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS action_proposals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES jarvis_sessions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      decided_at TIMESTAMPTZ,
      decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (kind IN ('mission_execute', 'council_run', 'execution_run', 'workspace_prepare', 'notify', 'custom')),
      CHECK (status IN ('pending', 'approved', 'rejected'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_action_proposals_user_status_updated_at
    ON action_proposals(user_id, status, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      title TEXT NOT NULL,
      query TEXT NOT NULL,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_run_at TIMESTAMPTZ,
      last_hit_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (kind IN ('external_topic', 'company', 'market', 'war_region', 'repo', 'task_health', 'mission_health', 'approval_backlog')),
      CHECK (status IN ('active', 'paused', 'error'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_watchers_user_status_updated_at
    ON watchers(user_id, status, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watcher_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      watcher_id UUID NOT NULL REFERENCES watchers(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT NOT NULL DEFAULT '',
      briefing_id UUID,
      dossier_id UUID,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (status IN ('running', 'completed', 'failed'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_watcher_runs_watcher_created_at
    ON watcher_runs(watcher_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS briefings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      watcher_id UUID REFERENCES watchers(id) ON DELETE SET NULL,
      session_id UUID REFERENCES jarvis_sessions(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      title TEXT NOT NULL,
      query TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      answer_markdown TEXT NOT NULL DEFAULT '',
      source_count INTEGER NOT NULL DEFAULT 0,
      quality_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (type IN ('daily', 'on_change', 'on_demand')),
      CHECK (status IN ('draft', 'completed', 'failed'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_briefings_user_created_at
    ON briefings(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dossiers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id UUID REFERENCES jarvis_sessions(id) ON DELETE SET NULL,
      briefing_id UUID REFERENCES briefings(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      query TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      summary TEXT NOT NULL DEFAULT '',
      answer_markdown TEXT NOT NULL DEFAULT '',
      quality_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      conflicts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (status IN ('draft', 'ready', 'failed'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dossiers_user_created_at
    ON dossiers(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dossier_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dossier_id UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      domain TEXT NOT NULL,
      snippet TEXT NOT NULL DEFAULT '',
      published_at TIMESTAMPTZ,
      source_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (dossier_id, url)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dossier_sources_dossier_order
    ON dossier_sources(dossier_id, source_order ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dossier_claims (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dossier_id UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      claim_text TEXT NOT NULL,
      claim_order INTEGER NOT NULL DEFAULT 0,
      source_urls TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dossier_claims_dossier_order
    ON dossier_claims(dossier_id, claim_order ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_entities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (kind IN ('actor', 'organization', 'country', 'asset', 'route', 'facility', 'commodity', 'policy', 'other')),
      UNIQUE (user_id, kind, canonical_name)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_entities_user_kind_updated_at
    ON world_model_entities(user_id, kind, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_projections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dossier_id UUID REFERENCES dossiers(id) ON DELETE CASCADE,
      briefing_id UUID REFERENCES briefings(id) ON DELETE CASCADE,
      watcher_id UUID REFERENCES watchers(id) ON DELETE CASCADE,
      session_id UUID REFERENCES jarvis_sessions(id) ON DELETE CASCADE,
      origin TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      superseded_at TIMESTAMPTZ,
      superseded_by_projection_id UUID REFERENCES world_model_projections(id) ON DELETE SET NULL,
      summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (origin IN ('briefing_generate', 'dossier_refresh', 'watcher_run', 'outcome_backfill')),
      CHECK (status IN ('active', 'superseded'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_projections_user_generated_at
    ON world_model_projections(user_id, generated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_projections_active_scope
    ON world_model_projections(status, dossier_id, watcher_id, briefing_id, generated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dossier_id UUID REFERENCES dossiers(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      occurred_at TIMESTAMPTZ,
      recorded_at TIMESTAMPTZ,
      attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (kind IN ('geopolitical', 'contract', 'policy', 'market', 'operational', 'financial', 'other'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_events_user_created_at
    ON world_model_events(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_events_dossier_created_at
    ON world_model_events(dossier_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_observations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dossier_id UUID REFERENCES dossiers(id) ON DELETE SET NULL,
      metric_key TEXT NOT NULL,
      value_text TEXT NOT NULL,
      unit TEXT,
      observed_at TIMESTAMPTZ,
      recorded_at TIMESTAMPTZ,
      attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_observations_user_created_at
    ON world_model_observations(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_observations_dossier_metric
    ON world_model_observations(dossier_id, metric_key, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_constraints (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dossier_id UUID REFERENCES dossiers(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'active',
      attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (kind IN ('capacity', 'logistics', 'insurance', 'regulatory', 'settlement', 'financing', 'other')),
      CHECK (severity IN ('low', 'medium', 'high')),
      CHECK (status IN ('active', 'watching', 'relieved'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_constraints_user_updated_at
    ON world_model_constraints(user_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_constraints_dossier_updated_at
    ON world_model_constraints(dossier_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_hypotheses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      projection_id UUID REFERENCES world_model_projections(id) ON DELETE SET NULL,
      dossier_id UUID REFERENCES dossiers(id) ON DELETE SET NULL,
      briefing_id UUID REFERENCES briefings(id) ON DELETE SET NULL,
      thesis TEXT NOT NULL,
      stance TEXT NOT NULL,
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (stance IN ('primary', 'counter')),
      CHECK (status IN ('active', 'weakened', 'invalidated'))
    )
  `);
  await pool.query(`
    ALTER TABLE world_model_hypotheses
    ADD COLUMN IF NOT EXISTS projection_id UUID REFERENCES world_model_projections(id) ON DELETE SET NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_hypotheses_user_updated_at
    ON world_model_hypotheses(user_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_hypotheses_projection_updated_at
    ON world_model_hypotheses(projection_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_hypotheses_dossier_updated_at
    ON world_model_hypotheses(dossier_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_hypothesis_evidence (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hypothesis_id UUID NOT NULL REFERENCES world_model_hypotheses(id) ON DELETE CASCADE,
      dossier_id UUID REFERENCES dossiers(id) ON DELETE SET NULL,
      claim_text TEXT NOT NULL,
      relation TEXT NOT NULL DEFAULT 'supports',
      source_urls TEXT[] NOT NULL DEFAULT '{}',
      weight DOUBLE PRECISION NOT NULL DEFAULT 0.5,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (relation IN ('supports', 'contradicts', 'context'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_hypothesis_evidence_hypothesis_created_at
    ON world_model_hypothesis_evidence(hypothesis_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_invalidation_conditions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hypothesis_id UUID NOT NULL REFERENCES world_model_hypotheses(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      expected_by TIMESTAMPTZ,
      observed_status TEXT NOT NULL DEFAULT 'pending',
      severity TEXT NOT NULL DEFAULT 'medium',
      attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (observed_status IN ('pending', 'hit', 'missed')),
      CHECK (severity IN ('low', 'medium', 'high'))
    )
  `);
  await pool.query(`
    ALTER TABLE world_model_invalidation_conditions
    ADD COLUMN IF NOT EXISTS attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_invalidation_conditions_hypothesis_updated_at
    ON world_model_invalidation_conditions(hypothesis_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_state_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id UUID NOT NULL,
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (target_type IN ('dossier', 'watcher', 'session'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_state_snapshots_user_created_at
    ON world_model_state_snapshots(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_state_snapshots_target_created_at
    ON world_model_state_snapshots(target_type, target_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS world_model_outcomes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hypothesis_id UUID NOT NULL REFERENCES world_model_hypotheses(id) ON DELETE CASCADE,
      evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      result TEXT NOT NULL,
      error_notes TEXT,
      horizon_realized TEXT,
      missed_invalidators_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (result IN ('confirmed', 'mixed', 'invalidated', 'unresolved'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_outcomes_user_created_at
    ON world_model_outcomes(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_world_model_outcomes_hypothesis_created_at
    ON world_model_outcomes(hypothesis_id, created_at DESC)
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
    CREATE TABLE IF NOT EXISTS provider_routing_health (
      provider TEXT PRIMARY KEY,
      cooldown_until TIMESTAMPTZ,
      reason_code TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (provider IN ('openai', 'gemini', 'anthropic', 'local'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_provider_routing_health_cooldown_until
    ON provider_routing_health(cooldown_until ASC)
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
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'mission_steps'
          AND c.conname = 'mission_steps_step_type_check'
      ) THEN
        ALTER TABLE mission_steps DROP CONSTRAINT IF EXISTS mission_steps_step_type_check;
      END IF;
    END
    $$;
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS mission_steps
    ADD CONSTRAINT mission_steps_step_type_check
    CHECK (step_type IN ('llm_generate', 'council_debate', 'human_gate', 'tool_call', 'sub_mission',
                          'code', 'research', 'finance', 'news', 'approval', 'execute'))
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
    CREATE TABLE IF NOT EXISTS radar_feed_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_tier TEXT NOT NULL,
      poll_minutes INTEGER NOT NULL DEFAULT 5,
      enabled BOOLEAN NOT NULL DEFAULT true,
      parser_hints_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      entity_hints_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      metric_hints_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_fetched_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radar_feed_cursors (
      source_id TEXT PRIMARY KEY REFERENCES radar_feed_sources(id) ON DELETE CASCADE,
      cursor_text TEXT,
      etag TEXT,
      last_modified TEXT,
      last_seen_published_at TIMESTAMPTZ,
      last_fetched_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radar_ingest_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id TEXT REFERENCES radar_feed_sources(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'running',
      fetched_count INTEGER NOT NULL DEFAULT 0,
      ingested_count INTEGER NOT NULL DEFAULT 0,
      evaluated_count INTEGER NOT NULL DEFAULT 0,
      promoted_count INTEGER NOT NULL DEFAULT 0,
      auto_executed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      error_text TEXT,
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tech_radar_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_url TEXT NOT NULL,
      source_name TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      published_at TIMESTAMPTZ,
      observed_at TIMESTAMPTZ,
      item_hash TEXT NOT NULL,
      confidence_score NUMERIC(4,3) NOT NULL DEFAULT 0.500,
      status radar_item_status NOT NULL DEFAULT 'new',
      source_type TEXT,
      source_tier TEXT,
      raw_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      entity_hints_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      trust_hint TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (confidence_score >= 0 AND confidence_score <= 1),
      UNIQUE (source_url, item_hash)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radar_event_candidates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      event_type TEXT NOT NULL,
      geo_scope TEXT,
      time_scope TEXT,
      dedupe_cluster_id TEXT NOT NULL,
      primary_item_id UUID REFERENCES tech_radar_items(id) ON DELETE SET NULL,
      cluster_size INTEGER NOT NULL DEFAULT 1,
      item_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      entities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      claims_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      metric_shocks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_mix_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_diversity_score NUMERIC(4,3) NOT NULL DEFAULT 0,
      corroboration_detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      novelty_score NUMERIC(4,3) NOT NULL DEFAULT 0,
      corroboration_score NUMERIC(4,3) NOT NULL DEFAULT 0,
      metric_alignment_score NUMERIC(4,3) NOT NULL DEFAULT 0,
      bottleneck_proximity_score NUMERIC(4,3) NOT NULL DEFAULT 0,
      persistence_score NUMERIC(4,3) NOT NULL DEFAULT 0,
      structurality_score NUMERIC(4,3) NOT NULL DEFAULT 0,
      actionability_score NUMERIC(4,3) NOT NULL DEFAULT 0,
      decision TEXT NOT NULL,
      override_decision TEXT,
      expected_next_signals_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE radar_event_candidates
    ADD COLUMN IF NOT EXISTS primary_item_id UUID REFERENCES tech_radar_items(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE radar_event_candidates
    ADD COLUMN IF NOT EXISTS cluster_size INTEGER NOT NULL DEFAULT 1
  `);
  await pool.query(`
    ALTER TABLE radar_event_candidates
    ADD COLUMN IF NOT EXISTS source_diversity_score NUMERIC(4,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE radar_event_candidates
    ADD COLUMN IF NOT EXISTS corroboration_detail_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radar_domain_posteriors (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES radar_event_candidates(id) ON DELETE CASCADE,
      domain_id TEXT NOT NULL,
      score NUMERIC(4,3) NOT NULL DEFAULT 0,
      evidence_features_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      counter_features_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      recommended_pack_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radar_autonomy_decisions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE REFERENCES radar_event_candidates(id) ON DELETE CASCADE,
      risk_band TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      policy_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      requires_human BOOLEAN NOT NULL DEFAULT true,
      kill_switch_scope TEXT NOT NULL DEFAULT 'none',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radar_operator_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL REFERENCES radar_event_candidates(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      note TEXT,
      override_decision TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radar_domain_pack_metrics (
      domain_id TEXT PRIMARY KEY,
      calibration_score NUMERIC(4,3) NOT NULL DEFAULT 0.75,
      evaluation_count INTEGER NOT NULL DEFAULT 0,
      promotion_count INTEGER NOT NULL DEFAULT 0,
      dossier_count INTEGER NOT NULL DEFAULT 0,
      action_count INTEGER NOT NULL DEFAULT 0,
      auto_execute_count INTEGER NOT NULL DEFAULT 0,
      override_count INTEGER NOT NULL DEFAULT 0,
      ack_count INTEGER NOT NULL DEFAULT 0,
      confirmed_count INTEGER NOT NULL DEFAULT 0,
      invalidated_count INTEGER NOT NULL DEFAULT 0,
      mixed_count INTEGER NOT NULL DEFAULT 0,
      unresolved_count INTEGER NOT NULL DEFAULT 0,
      last_event_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE radar_domain_pack_metrics
    ADD COLUMN IF NOT EXISTS confirmed_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE radar_domain_pack_metrics
    ADD COLUMN IF NOT EXISTS invalidated_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE radar_domain_pack_metrics
    ADD COLUMN IF NOT EXISTS mixed_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE radar_domain_pack_metrics
    ADD COLUMN IF NOT EXISTS unresolved_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radar_control_settings (
      singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
      global_kill_switch BOOLEAN NOT NULL DEFAULT false,
      auto_execution_enabled BOOLEAN NOT NULL DEFAULT true,
      dossier_promotion_enabled BOOLEAN NOT NULL DEFAULT true,
      tier3_escalation_enabled BOOLEAN NOT NULL DEFAULT false,
      disabled_domain_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      disabled_source_tiers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    INSERT INTO radar_control_settings (
      singleton,
      global_kill_switch,
      auto_execution_enabled,
      dossier_promotion_enabled,
      tier3_escalation_enabled
    )
    VALUES (true, false, true, true, false)
    ON CONFLICT (singleton) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tech_radar_scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      radar_item_id UUID NOT NULL REFERENCES tech_radar_items(id) ON DELETE CASCADE,
      event_id TEXT REFERENCES radar_event_candidates(id) ON DELETE SET NULL,
      performance_gain NUMERIC(5,2) NOT NULL,
      reliability_gain NUMERIC(5,2) NOT NULL,
      adoption_difficulty NUMERIC(5,2) NOT NULL,
      rollback_difficulty NUMERIC(5,2) NOT NULL,
      security_risk NUMERIC(5,2) NOT NULL,
      total_score NUMERIC(5,2) NOT NULL,
      decision radar_decision NOT NULL,
      rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
      evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE tech_radar_scores
    ADD COLUMN IF NOT EXISTS event_id TEXT REFERENCES radar_event_candidates(id) ON DELETE SET NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS upgrade_proposals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      radar_score_id UUID NOT NULL REFERENCES tech_radar_scores(id) ON DELETE RESTRICT,
      proposal_title TEXT NOT NULL,
      change_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
      risk_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
      status upgrade_status NOT NULL DEFAULT 'proposed',
      approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS upgrade_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id UUID NOT NULL REFERENCES upgrade_proposals(id) ON DELETE RESTRICT,
      triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
      start_command TEXT NOT NULL,
      status upgrade_status NOT NULL DEFAULT 'planning',
      baseline_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      post_metrics JSONB,
      rollback_ref TEXT,
      trace_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID REFERENCES upgrade_runs(id) ON DELETE SET NULL,
      chat_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      status telegram_report_status NOT NULL DEFAULT 'queued',
      telegram_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id UUID,
      trace_id TEXT,
      reason TEXT,
      before_data JSONB,
      after_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_feed_sources_enabled_updated_at
    ON radar_feed_sources(enabled, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_feed_cursors_last_fetched_at
    ON radar_feed_cursors(last_fetched_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_ingest_runs_source_started_at
    ON radar_ingest_runs(source_id, started_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_ingest_runs_started_at
    ON radar_ingest_runs(started_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_items_status_published_at
    ON tech_radar_items(status, published_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_scores_item_id_evaluated_at
    ON tech_radar_scores(radar_item_id, evaluated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_scores_event_id_evaluated_at
    ON tech_radar_scores(event_id, evaluated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_event_candidates_decision_updated_at
    ON radar_event_candidates(decision, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_domain_posteriors_event_score
    ON radar_domain_posteriors(event_id, score DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_operator_feedback_event_created_at
    ON radar_operator_feedback(event_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_radar_domain_pack_metrics_calibration
    ON radar_domain_pack_metrics(calibration_score ASC, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_upgrade_proposals_status_created_at
    ON upgrade_proposals(status, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_upgrade_runs_status_created_at
    ON upgrade_runs(status, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created_at
    ON audit_logs(entity_type, entity_id, created_at DESC)
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
    ALTER TABLE IF EXISTS council_runs
    ADD COLUMN IF NOT EXISTS workflow_version TEXT NOT NULL DEFAULT 'structured_v1'
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS council_runs
    ADD COLUMN IF NOT EXISTS phase_status JSONB
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS council_runs
    ADD COLUMN IF NOT EXISTS exploration_summary TEXT
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS council_runs
    ADD COLUMN IF NOT EXISTS exploration_transcript JSONB
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS council_runs
    ADD COLUMN IF NOT EXISTS synthesis_error TEXT
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS council_runs
    ADD COLUMN IF NOT EXISTS structured_result JSONB
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_telegram_reports_status_next_attempt_at
    ON telegram_reports(status, next_attempt_at ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_workspaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_workspace_members (
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id),
      CHECK (role IN ('owner', 'member', 'admin'))
    )
  `);
  await pool.query(`
    ALTER TABLE intelligence_workspace_members
    DROP CONSTRAINT IF EXISTS intelligence_workspace_members_role_check
  `);
  await pool.query(`
    ALTER TABLE intelligence_workspace_members
    ADD CONSTRAINT intelligence_workspace_members_role_check
    CHECK (role IN ('owner', 'member', 'admin'))
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_tier TEXT NOT NULL,
      poll_minutes INTEGER NOT NULL DEFAULT 5,
      enabled BOOLEAN NOT NULL DEFAULT true,
      parser_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      crawl_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      health_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      connector_capability_json JSONB,
      entity_hints_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      metric_hints_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_fetched_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE intelligence_sources
    ADD COLUMN IF NOT EXISTS health_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await pool.query(`
    ALTER TABLE intelligence_sources
    ADD COLUMN IF NOT EXISTS connector_capability_json JSONB
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_source_cursors (
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      source_id UUID NOT NULL REFERENCES intelligence_sources(id) ON DELETE CASCADE,
      cursor_text TEXT,
      etag TEXT,
      last_modified TEXT,
      last_seen_published_at TIMESTAMPTZ,
      last_fetched_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, source_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_fetch_failures (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      source_id UUID REFERENCES intelligence_sources(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      reason TEXT NOT NULL,
      status_code INTEGER,
      retryable BOOLEAN NOT NULL DEFAULT false,
      blocked_by_robots BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_scan_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      source_id UUID REFERENCES intelligence_sources(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'running',
      fetched_count INTEGER NOT NULL DEFAULT 0,
      stored_document_count INTEGER NOT NULL DEFAULT 0,
      signal_count INTEGER NOT NULL DEFAULT 0,
      clustered_event_count INTEGER NOT NULL DEFAULT 0,
      execution_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      error_text TEXT,
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_raw_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      source_id UUID REFERENCES intelligence_sources(id) ON DELETE SET NULL,
      source_url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      document_identity_key TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      raw_text TEXT NOT NULL,
      raw_html TEXT,
      published_at TIMESTAMPTZ,
      observed_at TIMESTAMPTZ,
      language TEXT,
      source_type TEXT NOT NULL,
      source_tier TEXT NOT NULL,
      document_fingerprint TEXT NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, document_fingerprint)
    )
  `);
  await pool.query(`
    ALTER TABLE intelligence_raw_documents
    ADD COLUMN IF NOT EXISTS document_identity_key TEXT NOT NULL DEFAULT ''
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_raw_documents_identity
    ON intelligence_raw_documents(workspace_id, document_identity_key)
    WHERE document_identity_key <> ''
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      source_id UUID REFERENCES intelligence_sources(id) ON DELETE SET NULL,
      document_id UUID NOT NULL REFERENCES intelligence_raw_documents(id) ON DELETE CASCADE,
      linked_event_id UUID,
      source_type TEXT NOT NULL,
      source_tier TEXT NOT NULL,
      url TEXT NOT NULL,
      published_at TIMESTAMPTZ,
      observed_at TIMESTAMPTZ,
      language TEXT,
      raw_text TEXT NOT NULL,
      raw_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      entity_hints_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      trust_hint TEXT,
      processing_status TEXT NOT NULL DEFAULT 'pending',
      promotion_state TEXT NOT NULL DEFAULT 'pending_validation',
      promotion_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      processing_lease_id UUID,
      processing_error TEXT,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_linked_claims (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      claim_fingerprint TEXT NOT NULL,
      canonical_subject TEXT NOT NULL,
      canonical_predicate TEXT NOT NULL,
      canonical_object TEXT NOT NULL,
      time_scope TEXT,
      stance_distribution_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_count INTEGER NOT NULL DEFAULT 0,
      contradiction_count INTEGER NOT NULL DEFAULT 0,
      supporting_signal_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, claim_fingerprint)
    )
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'watch'
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS review_reason TEXT
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS review_owner UUID REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS review_updated_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS review_updated_by UUID REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS review_resolved_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS predicate_family TEXT NOT NULL DEFAULT 'general'
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS time_bucket_start TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS time_bucket_end TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS non_social_source_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS last_supported_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_linked_claims
    ADD COLUMN IF NOT EXISTS last_contradicted_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_signals
    ADD COLUMN IF NOT EXISTS linked_event_id UUID
  `);
  await pool.query(`
    ALTER TABLE intelligence_signals
    ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending'
  `);
  await pool.query(`
    ALTER TABLE intelligence_signals
    ADD COLUMN IF NOT EXISTS processing_error TEXT
  `);
  await pool.query(`
    ALTER TABLE intelligence_signals
    ADD COLUMN IF NOT EXISTS processing_lease_id UUID
  `);
  await pool.query(`
    ALTER TABLE intelligence_signals
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_signals
    ADD COLUMN IF NOT EXISTS promotion_state TEXT NOT NULL DEFAULT 'pending_validation'
  `);
  await pool.query(`
    ALTER TABLE intelligence_signals
    ADD COLUMN IF NOT EXISTS promotion_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_events (
      id UUID PRIMARY KEY,
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      event_family TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'canonical',
      validation_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      signal_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      document_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      entities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      linked_claim_count INTEGER NOT NULL DEFAULT 0,
      contradiction_count INTEGER NOT NULL DEFAULT 0,
      semantic_claims_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      metric_shocks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_mix_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      corroboration_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      novelty_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      structurality_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      actionability_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      risk_band TEXT NOT NULL DEFAULT 'low',
      top_domain_id TEXT,
      time_window_start TIMESTAMPTZ,
      time_window_end TIMESTAMPTZ,
      domain_posteriors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      world_states_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      primary_hypotheses_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      counter_hypotheses_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      invalidation_conditions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      expected_signals_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      deliberation_status TEXT NOT NULL DEFAULT 'idle',
      review_state TEXT NOT NULL DEFAULT 'watch',
      review_reason TEXT,
      review_owner UUID REFERENCES users(id) ON DELETE SET NULL,
      review_updated_at TIMESTAMPTZ,
      review_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      review_resolved_at TIMESTAMPTZ,
      deliberations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      execution_candidates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      outcomes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      operator_note_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS linked_claim_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS contradiction_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS deliberation_status TEXT NOT NULL DEFAULT 'idle'
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'watch'
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS review_updated_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS review_reason TEXT
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS review_owner UUID REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS review_updated_by UUID REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS review_resolved_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS operator_note_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'canonical'
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS validation_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS non_social_corroboration_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS linked_claim_health_score NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS time_coherence_score NUMERIC(5,3) NOT NULL DEFAULT 0.8
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS graph_support_score NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS graph_contradiction_score NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_events
    ADD COLUMN IF NOT EXISTS graph_hotspot_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_hypothesis_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      hypothesis_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      confidence NUMERIC(5,3) NOT NULL DEFAULT 0,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE intelligence_hypothesis_ledger
    ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'watch'
  `);
  await pool.query(`
    ALTER TABLE intelligence_hypothesis_ledger
    ADD COLUMN IF NOT EXISTS review_reason TEXT
  `);
  await pool.query(`
    ALTER TABLE intelligence_hypothesis_ledger
    ADD COLUMN IF NOT EXISTS review_owner UUID REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE intelligence_hypothesis_ledger
    ADD COLUMN IF NOT EXISTS review_updated_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_hypothesis_ledger
    ADD COLUMN IF NOT EXISTS review_updated_by UUID REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE intelligence_hypothesis_ledger
    ADD COLUMN IF NOT EXISTS review_resolved_at TIMESTAMPTZ
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_claim_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      linked_claim_id UUID NOT NULL REFERENCES intelligence_linked_claims(id) ON DELETE CASCADE,
      signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
      semantic_claim_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      confidence NUMERIC(5,3) NOT NULL DEFAULT 0.5,
      link_strength NUMERIC(5,3) NOT NULL DEFAULT 0.5,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE intelligence_claim_links
    ADD COLUMN IF NOT EXISTS link_strength NUMERIC(5,3) NOT NULL DEFAULT 0.5
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_linked_claim_edges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      left_linked_claim_id UUID NOT NULL REFERENCES intelligence_linked_claims(id) ON DELETE CASCADE,
      right_linked_claim_id UUID NOT NULL REFERENCES intelligence_linked_claims(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      edge_strength NUMERIC(5,3) NOT NULL DEFAULT 0.5,
      evidence_signal_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_observed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, left_linked_claim_id, right_linked_claim_id),
      CHECK (left_linked_claim_id <> right_linked_claim_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_event_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      linked_claim_id UUID NOT NULL REFERENCES intelligence_linked_claims(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_hypothesis_evidence_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      hypothesis_id TEXT NOT NULL,
      linked_claim_id UUID REFERENCES intelligence_linked_claims(id) ON DELETE SET NULL,
      signal_id UUID REFERENCES intelligence_signals(id) ON DELETE SET NULL,
      relation TEXT NOT NULL,
      evidence_strength NUMERIC(5,3),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE intelligence_hypothesis_evidence_links
    ADD COLUMN IF NOT EXISTS evidence_strength NUMERIC(5,3)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_invalidation_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      matcher_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_expected_signal_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      signal_key TEXT NOT NULL,
      description TEXT NOT NULL,
      due_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_outcome_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_narrative_clusters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      cluster_key TEXT NOT NULL,
      title TEXT NOT NULL,
      event_family TEXT NOT NULL,
      top_domain_id TEXT,
      anchor_entities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      state TEXT NOT NULL DEFAULT 'forming',
      event_count INTEGER NOT NULL DEFAULT 0,
      recurring_event_count INTEGER NOT NULL DEFAULT 0,
      diverging_event_count INTEGER NOT NULL DEFAULT 0,
      supportive_history_count INTEGER NOT NULL DEFAULT 0,
      hotspot_event_count INTEGER NOT NULL DEFAULT 0,
      latest_recurring_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      drift_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      support_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      contradiction_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      time_coherence_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      recurring_strength_trend NUMERIC(5,3) NOT NULL DEFAULT 0,
      divergence_trend NUMERIC(5,3) NOT NULL DEFAULT 0,
      support_decay_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      contradiction_acceleration NUMERIC(5,3) NOT NULL DEFAULT 0,
      cluster_priority_score INTEGER NOT NULL DEFAULT 0,
      recent_execution_blocked_count INTEGER NOT NULL DEFAULT 0,
      review_state TEXT NOT NULL DEFAULT 'watch',
      review_reason TEXT,
      review_owner TEXT,
      review_updated_at TIMESTAMPTZ,
      review_updated_by TEXT,
      review_resolved_at TIMESTAMPTZ,
      last_ledger_at TIMESTAMPTZ,
      last_event_at TIMESTAMPTZ,
      last_recurring_at TIMESTAMPTZ,
      last_diverging_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, cluster_key)
    )
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS drift_score NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS support_score NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS contradiction_score NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS time_coherence_score NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS recurring_strength_trend NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS divergence_trend NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS support_decay_score NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS contradiction_acceleration NUMERIC(5,3) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'watch'
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS review_reason TEXT
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS review_owner TEXT
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS review_updated_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS review_updated_by TEXT
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS review_resolved_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS cluster_priority_score INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS recent_execution_blocked_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS last_ledger_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS last_recurring_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE intelligence_narrative_clusters
    ADD COLUMN IF NOT EXISTS last_diverging_at TIMESTAMPTZ
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_narrative_cluster_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      cluster_id UUID NOT NULL REFERENCES intelligence_narrative_clusters(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      score NUMERIC(5,3) NOT NULL DEFAULT 0,
      days_delta INTEGER,
      is_latest BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, event_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_temporal_narrative_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      related_event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      related_event_title TEXT NOT NULL,
      relation TEXT NOT NULL,
      score NUMERIC(5,3) NOT NULL DEFAULT 0,
      days_delta INTEGER,
      top_domain_id TEXT,
      graph_support_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      graph_contradiction_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      graph_hotspot_count INTEGER NOT NULL DEFAULT 0,
      time_coherence_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_narrative_cluster_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      cluster_id UUID NOT NULL REFERENCES intelligence_narrative_clusters(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      score_delta NUMERIC(5,3) NOT NULL DEFAULT 0,
      source_event_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_narrative_cluster_timeline (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      cluster_id UUID NOT NULL REFERENCES intelligence_narrative_clusters(id) ON DELETE CASCADE,
      bucket_start TIMESTAMPTZ NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      recurring_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      drift_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      support_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      contradiction_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      time_coherence_score NUMERIC(5,3) NOT NULL DEFAULT 0,
      hotspot_event_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, cluster_id, bucket_start)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_execution_audits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL,
      connector_id TEXT,
      action_name TEXT,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_operator_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      scope_id TEXT,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_bridge_dispatches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      target_id TEXT,
      request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_model_registry (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      availability TEXT NOT NULL DEFAULT 'active',
      context_window INTEGER,
      supports_structured_output BOOLEAN NOT NULL DEFAULT false,
      supports_tool_use BOOLEAN NOT NULL DEFAULT false,
      supports_long_context BOOLEAN NOT NULL DEFAULT false,
      supports_reasoning BOOLEAN NOT NULL DEFAULT false,
      cost_class TEXT NOT NULL DEFAULT 'standard',
      latency_class TEXT NOT NULL DEFAULT 'balanced',
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (provider, model_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_provider_health (
      provider TEXT PRIMARY KEY,
      available BOOLEAN NOT NULL DEFAULT true,
      cooldown_until TIMESTAMPTZ,
      reason_code TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_model_alias_bindings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      weight NUMERIC(5,3) NOT NULL DEFAULT 1,
      fallback_rank INTEGER NOT NULL DEFAULT 1,
      canary_percent NUMERIC(5,3) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      requires_structured_output BOOLEAN NOT NULL DEFAULT false,
      requires_tool_use BOOLEAN NOT NULL DEFAULT false,
      requires_long_context BOOLEAN NOT NULL DEFAULT false,
      max_cost_class TEXT,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_alias_rollouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES intelligence_workspaces(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      binding_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_workspace_members_user
    ON intelligence_workspace_members(user_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_sources_workspace_updated
    ON intelligence_sources(workspace_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_fetch_failures_workspace_created
    ON intelligence_fetch_failures(workspace_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_scan_runs_workspace_started
    ON intelligence_scan_runs(workspace_id, started_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_documents_workspace_created
    ON intelligence_raw_documents(workspace_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_signals_workspace_created
    ON intelligence_signals(workspace_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_signals_processing_status
    ON intelligence_signals(workspace_id, processing_status, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_events_workspace_updated
    ON intelligence_events(workspace_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_linked_claims_workspace_updated
    ON intelligence_linked_claims(workspace_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_claim_links_event_created
    ON intelligence_claim_links(workspace_id, event_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_linked_claim_edges_left
    ON intelligence_linked_claim_edges(workspace_id, left_linked_claim_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_linked_claim_edges_right
    ON intelligence_linked_claim_edges(workspace_id, right_linked_claim_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_event_memberships_event
    ON intelligence_event_memberships(workspace_id, event_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_hypothesis_ledger_event_updated
    ON intelligence_hypothesis_ledger(workspace_id, event_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_hypothesis_evidence_event_created
    ON intelligence_hypothesis_evidence_links(workspace_id, event_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_invalidation_entries_event_updated
    ON intelligence_invalidation_entries(workspace_id, event_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_expected_signal_entries_event_updated
    ON intelligence_expected_signal_entries(workspace_id, event_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_outcome_entries_event_created
    ON intelligence_outcome_entries(workspace_id, event_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_narrative_clusters_workspace_updated
    ON intelligence_narrative_clusters(workspace_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_narrative_cluster_memberships_cluster_updated
    ON intelligence_narrative_cluster_memberships(workspace_id, cluster_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_temporal_narrative_ledger_event_updated
    ON intelligence_temporal_narrative_ledger(workspace_id, event_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_narrative_cluster_ledger_cluster_created
    ON intelligence_narrative_cluster_ledger(workspace_id, cluster_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_narrative_cluster_timeline_cluster_bucket
    ON intelligence_narrative_cluster_timeline(workspace_id, cluster_id, bucket_start DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_execution_audits_event_created
    ON intelligence_execution_audits(workspace_id, event_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_operator_notes_event_created
    ON intelligence_operator_notes(workspace_id, event_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_bridge_dispatches_workspace_updated
    ON intelligence_bridge_dispatches(workspace_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_model_alias_bindings_alias
    ON intelligence_model_alias_bindings(alias, workspace_id, is_active, fallback_rank ASC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_alias_rollouts_alias_created
    ON intelligence_alias_rollouts(alias, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS command_compilations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      goal TEXT NOT NULL,
      success_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
      constraints_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      risk_level TEXT NOT NULL,
      risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      deliverables_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      domain_mix_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      intent TEXT NOT NULL,
      complexity TEXT NOT NULL,
      intent_confidence NUMERIC NOT NULL DEFAULT 0,
      contract_confidence NUMERIC NOT NULL DEFAULT 0,
      uncertainty NUMERIC NOT NULL DEFAULT 1,
      clarification_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_command_compilations_user_created_at
    ON command_compilations(user_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS retrieval_queries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id UUID NOT NULL REFERENCES command_compilations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      connector TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS retrieval_evidence_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      query_id UUID NOT NULL REFERENCES retrieval_queries(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      domain TEXT NOT NULL,
      snippet TEXT NOT NULL DEFAULT '',
      published_at TIMESTAMPTZ,
      connector TEXT NOT NULL,
      rank_score NUMERIC NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS retrieval_scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id UUID NOT NULL REFERENCES command_compilations(id) ON DELETE CASCADE,
      trust_score NUMERIC NOT NULL DEFAULT 0,
      coverage_score NUMERIC NOT NULL DEFAULT 0,
      freshness_score NUMERIC NOT NULL DEFAULT 0,
      diversity_score NUMERIC NOT NULL DEFAULT 0,
      blocked BOOLEAN NOT NULL DEFAULT false,
      blocked_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_retrieval_queries_contract_id
    ON retrieval_queries(contract_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id UUID NOT NULL REFERENCES command_compilations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      arbitration_rounds INTEGER NOT NULL DEFAULT 0,
      escalated_to_human BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_outputs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
      agent_id UUID NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
      output TEXT NOT NULL,
      confidence NUMERIC NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_arbitrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS code_loop_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id UUID NOT NULL REFERENCES command_compilations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'planned',
      retry_count INTEGER NOT NULL DEFAULT 0,
      pr_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS code_loop_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES code_loop_runs(id) ON DELETE CASCADE,
      step_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      log TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS code_loop_artifacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES code_loop_runs(id) ON DELETE CASCADE,
      step_id UUID REFERENCES code_loop_steps(id) ON DELETE SET NULL,
      artifact_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      risk_profile TEXT NOT NULL DEFAULT 'balanced',
      base_currency TEXT NOT NULL DEFAULT 'USD',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 0,
      avg_price NUMERIC NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_scenarios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scenario_type TEXT NOT NULL,
      input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_compliance_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      decision TEXT NOT NULL,
      reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_view_schemas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '1.0',
      schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_task_view_schemas_task_created
    ON task_view_schemas(task_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS capability_modules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      module_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS capability_module_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      module_record_id UUID NOT NULL REFERENCES capability_modules(id) ON DELETE CASCADE,
      module_version TEXT NOT NULL,
      abi_version TEXT NOT NULL,
      input_schema_ref TEXT NOT NULL,
      output_schema_ref TEXT NOT NULL,
      required_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
      failure_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (module_record_id, module_version)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hyperagent_artifact_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      artifact_key TEXT NOT NULL,
      artifact_version TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('world_model')),
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hyperagent_artifact_snapshots_scope_created
    ON hyperagent_artifact_snapshots(scope, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hyperagent_artifact_snapshots_key_created
    ON hyperagent_artifact_snapshots(artifact_key, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hyperagent_variants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      artifact_snapshot_id UUID NOT NULL REFERENCES hyperagent_artifact_snapshots(id) ON DELETE CASCADE,
      strategy TEXT NOT NULL CHECK (strategy IN ('bounded_json_mutation', 'manual_seed')),
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      parent_variant_id UUID REFERENCES hyperagent_variants(id) ON DELETE SET NULL,
      lineage_run_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hyperagent_variants_snapshot_created
    ON hyperagent_variants(artifact_snapshot_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hyperagent_variants_lineage_created
    ON hyperagent_variants(lineage_run_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hyperagent_eval_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      variant_id UUID NOT NULL REFERENCES hyperagent_variants(id) ON DELETE CASCADE,
      evaluator_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'blocked')),
      summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hyperagent_eval_runs_variant_created
    ON hyperagent_eval_runs(variant_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hyperagent_recommendations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      eval_run_id UUID NOT NULL REFERENCES hyperagent_eval_runs(id) ON DELETE CASCADE,
      variant_id UUID NOT NULL REFERENCES hyperagent_variants(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'applied')),
      summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      decided_by TEXT,
      decided_at TIMESTAMPTZ,
      applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hyperagent_recommendations_status_updated
    ON hyperagent_recommendations(status, updated_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS policy_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_key TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS policy_audits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_rule_id UUID REFERENCES policy_rules(id) ON DELETE SET NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      before_data JSONB,
      after_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS eval_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      suite TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eval_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      score NUMERIC NOT NULL DEFAULT 0,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      summary TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rollback_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lineage_nodes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id TEXT,
      node_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lineage_edges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id TEXT,
      source_node_id UUID NOT NULL REFERENCES lineage_nodes(id) ON DELETE CASCADE,
      target_node_id UUID NOT NULL REFERENCES lineage_nodes(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE lineage_nodes ADD COLUMN IF NOT EXISTS run_id TEXT`);
  await pool.query(`ALTER TABLE lineage_edges ADD COLUMN IF NOT EXISTS run_id TEXT`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lineage_nodes_run_created
    ON lineage_nodes(run_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lineage_edges_run_created
    ON lineage_edges(run_id, created_at DESC)
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
