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
      node_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lineage_edges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_node_id UUID NOT NULL REFERENCES lineage_nodes(id) ON DELETE CASCADE,
      target_node_id UUID NOT NULL REFERENCES lineage_nodes(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
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
