-- JARVIS DB Schema v1
-- Date: 2026-02-22
-- Scope: context/radar/upgrade/telegram domain objects
-- Status: reference snapshot only
-- Source of truth for runtime/db:init is:
--   /Users/woody/ai/brain/backend/src/store/postgres/initializer.ts
-- Do not use this file directly for production bootstrap.
--
-- Migration order:
--   1) create extensions
--   2) create base tables
--   3) create dependent tables with FK
--   4) backfill and validate
--   5) create non-blocking indexes

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- 1) core enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_mode') THEN
    CREATE TYPE task_mode AS ENUM (
      'chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('queued', 'running', 'blocked', 'retrying', 'done', 'failed', 'cancelled');
  END IF;

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
END$$;

-- 2) base tables
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role IN ('member', 'operator', 'admin'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_credentials (
  provider TEXT PRIMARY KEY,
  encrypted_api_key TEXT NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (provider IN ('openai', 'gemini', 'anthropic', 'local'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode task_mode NOT NULL,
  status task_status NOT NULL DEFAULT 'queued',
  title TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

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
);

CREATE TABLE IF NOT EXISTS mission_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  step_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  step_order INTEGER NOT NULL,
  dependencies UUID[] NOT NULL DEFAULT '{}',
  execution_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  task_type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  CHECK (step_type IN ('llm_generate', 'council_debate', 'human_gate', 'tool_call', 'sub_mission',
                        'code', 'research', 'finance', 'news', 'approval', 'execute')),
  CHECK (status IN ('pending', 'running', 'done', 'blocked', 'failed')),
  CHECK (step_order > 0)
);

CREATE TABLE IF NOT EXISTS task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  trace_id TEXT,
  span_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assistant_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_context_id TEXT NOT NULL,
  source TEXT NOT NULL,
  intent TEXT NOT NULL,
  prompt TEXT NOT NULL,
  widget_plan JSONB NOT NULL DEFAULT '[]',
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
);

CREATE TABLE IF NOT EXISTS assistant_context_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id UUID NOT NULL REFERENCES assistant_contexts(id) ON DELETE CASCADE,
  sequence BIGSERIAL NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  trace_id TEXT,
  span_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  segment_type TEXT NOT NULL,
  content TEXT NOT NULL,
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding vector(3072),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.500,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE IF NOT EXISTS context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  token_budget INTEGER NOT NULL,
  selected_segment_ids UUID[] NOT NULL DEFAULT '{}',
  dropped_segment_ids UUID[] NOT NULL DEFAULT '{}',
  compiled_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (token_budget > 0)
);

-- 3) radar + upgrade tables
CREATE TABLE IF NOT EXISTS tech_radar_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  published_at TIMESTAMPTZ,
  item_hash TEXT NOT NULL,
  confidence_score NUMERIC(4,3) NOT NULL DEFAULT 0.500,
  status radar_item_status NOT NULL DEFAULT 'new',
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (confidence_score >= 0 AND confidence_score <= 1),
  UNIQUE (source_url, item_hash)
);

CREATE TABLE IF NOT EXISTS tech_radar_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  radar_item_id UUID NOT NULL REFERENCES tech_radar_items(id) ON DELETE CASCADE,
  performance_gain NUMERIC(5,2) NOT NULL,
  reliability_gain NUMERIC(5,2) NOT NULL,
  adoption_difficulty NUMERIC(5,2) NOT NULL,
  rollback_difficulty NUMERIC(5,2) NOT NULL,
  security_risk NUMERIC(5,2) NOT NULL,
  total_score NUMERIC(5,2) NOT NULL,
  decision radar_decision NOT NULL,
  rationale JSONB NOT NULL DEFAULT '{}',
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (performance_gain >= 0 AND performance_gain <= 5),
  CHECK (reliability_gain >= 0 AND reliability_gain <= 5),
  CHECK (adoption_difficulty >= 0 AND adoption_difficulty <= 5),
  CHECK (rollback_difficulty >= 0 AND rollback_difficulty <= 5),
  CHECK (security_risk >= 0 AND security_risk <= 5)
);

CREATE TABLE IF NOT EXISTS upgrade_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  radar_score_id UUID NOT NULL REFERENCES tech_radar_scores(id) ON DELETE RESTRICT,
  proposal_title TEXT NOT NULL,
  change_plan JSONB NOT NULL,
  risk_plan JSONB NOT NULL,
  status upgrade_status NOT NULL DEFAULT 'proposed',
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status <> 'approved' AND approved_at IS NULL)
    OR (status = 'approved' AND approved_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS upgrade_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES upgrade_proposals(id) ON DELETE RESTRICT,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  start_command TEXT NOT NULL,
  status upgrade_status NOT NULL DEFAULT 'planning',
  baseline_metrics JSONB NOT NULL DEFAULT '{}',
  post_metrics JSONB,
  rollback_ref TEXT,
  trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_command = '작업 시작')
);

CREATE TABLE IF NOT EXISTS council_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  trace_id TEXT,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  consensus_status TEXT,
  summary TEXT NOT NULL DEFAULT '',
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT,
  model TEXT NOT NULL DEFAULT 'pending',
  used_fallback BOOLEAN NOT NULL DEFAULT false,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  workflow_version TEXT NOT NULL DEFAULT 'structured_v1',
  phase_status JSONB,
  exploration_summary TEXT,
  exploration_transcript JSONB,
  synthesis_error TEXT,
  structured_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CHECK (consensus_status IS NULL OR consensus_status IN ('consensus_reached', 'contradiction_detected', 'escalated_to_human')),
  CHECK (provider IS NULL OR provider IN ('openai', 'gemini', 'anthropic', 'local'))
);

CREATE TABLE IF NOT EXISTS execution_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  trace_id TEXT,
  mode task_mode NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  output TEXT NOT NULL DEFAULT '',
  attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT,
  model TEXT NOT NULL DEFAULT 'pending',
  used_fallback BOOLEAN NOT NULL DEFAULT false,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode IN ('code', 'compute')),
  CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CHECK (provider IS NULL OR provider IN ('openai', 'gemini', 'anthropic', 'local')),
  CHECK (duration_ms >= 0)
);

CREATE TABLE IF NOT EXISTS telegram_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES upgrade_runs(id) ON DELETE SET NULL,
  chat_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  status telegram_report_status NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  telegram_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

-- 4) provider stats
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
);

-- 4b) model registry
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
);

-- 4c) task-model policy
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
);

-- 5) approvals
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);

-- 6) audit
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
);

-- compatibility adjustments for existing installations
ALTER TABLE IF EXISTS task_events ADD COLUMN IF NOT EXISTS trace_id TEXT;
ALTER TABLE IF EXISTS task_events ADD COLUMN IF NOT EXISTS span_id TEXT;

ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE IF EXISTS users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE IF EXISTS users
  ADD CONSTRAINT users_role_check CHECK (role IN ('member', 'operator', 'admin'));

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS council_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS council_runs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE IF EXISTS council_runs ADD COLUMN IF NOT EXISTS trace_id TEXT;
ALTER TABLE IF EXISTS council_runs ALTER COLUMN status SET DEFAULT 'running';
ALTER TABLE IF EXISTS council_runs ALTER COLUMN consensus_status DROP NOT NULL;
ALTER TABLE IF EXISTS council_runs ALTER COLUMN summary SET DEFAULT '';
ALTER TABLE IF EXISTS council_runs ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE IF EXISTS council_runs ALTER COLUMN model SET DEFAULT 'pending';
ALTER TABLE IF EXISTS council_runs DROP CONSTRAINT IF EXISTS council_runs_status_check;
ALTER TABLE IF EXISTS council_runs DROP CONSTRAINT IF EXISTS council_runs_consensus_status_check;
ALTER TABLE IF EXISTS council_runs DROP CONSTRAINT IF EXISTS council_runs_provider_check;
ALTER TABLE IF EXISTS council_runs
  ADD CONSTRAINT council_runs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'));
ALTER TABLE IF EXISTS council_runs
  ADD CONSTRAINT council_runs_consensus_status_check CHECK (
    consensus_status IS NULL OR consensus_status IN ('consensus_reached', 'contradiction_detected', 'escalated_to_human')
  );
ALTER TABLE IF EXISTS council_runs
  ADD CONSTRAINT council_runs_provider_check CHECK (provider IS NULL OR provider IN ('openai', 'gemini', 'anthropic', 'local'));

ALTER TABLE IF EXISTS execution_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS execution_runs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE IF EXISTS execution_runs ADD COLUMN IF NOT EXISTS trace_id TEXT;
ALTER TABLE IF EXISTS execution_runs ALTER COLUMN status SET DEFAULT 'running';
ALTER TABLE IF EXISTS execution_runs ALTER COLUMN output SET DEFAULT '';
ALTER TABLE IF EXISTS execution_runs ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE IF EXISTS execution_runs ALTER COLUMN model SET DEFAULT 'pending';
ALTER TABLE IF EXISTS execution_runs ALTER COLUMN duration_ms SET DEFAULT 0;
ALTER TABLE IF EXISTS execution_runs DROP CONSTRAINT IF EXISTS execution_runs_status_check;
ALTER TABLE IF EXISTS execution_runs DROP CONSTRAINT IF EXISTS execution_runs_provider_check;
ALTER TABLE IF EXISTS execution_runs
  ADD CONSTRAINT execution_runs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'));
ALTER TABLE IF EXISTS execution_runs
  ADD CONSTRAINT execution_runs_provider_check CHECK (provider IS NULL OR provider IN ('openai', 'gemini', 'anthropic', 'local'));
ALTER TABLE IF EXISTS telegram_reports ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS telegram_reports ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE IF EXISTS telegram_reports ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS telegram_reports ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE IF EXISTS telegram_reports DROP CONSTRAINT IF EXISTS telegram_reports_max_attempts_check;
ALTER TABLE IF EXISTS telegram_reports
  ADD CONSTRAINT telegram_reports_max_attempts_check CHECK (max_attempts > 0);

-- 5) indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status_created_at ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_trace_id ON tasks(trace_id);
CREATE INDEX IF NOT EXISTS idx_missions_user_status_updated_at ON missions(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mission_steps_mission_order ON mission_steps(mission_id, step_order ASC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id_expires_at ON user_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_events_task_id_created_at ON task_events(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_events_trace_id_created_at ON task_events(trace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_segments_user_id_created_at ON memory_segments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_segments_tsv ON memory_segments USING GIN(content_tsv);
CREATE INDEX IF NOT EXISTS idx_memory_segments_embedding_hnsw ON memory_segments USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_context_snapshots_task_id_created_at ON context_snapshots(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_radar_items_status_published_at ON tech_radar_items(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_radar_items_source_url ON tech_radar_items(source_url);
CREATE INDEX IF NOT EXISTS idx_radar_scores_item_id_evaluated_at ON tech_radar_scores(radar_item_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_upgrade_proposals_status_created_at ON upgrade_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upgrade_runs_status_created_at ON upgrade_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upgrade_runs_trace_id ON upgrade_runs(trace_id);
CREATE INDEX IF NOT EXISTS idx_council_runs_created_at ON council_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_council_runs_consensus_status_created_at ON council_runs(consensus_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_council_runs_user_idempotency ON council_runs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_council_runs_trace_id ON council_runs(trace_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_mode_created_at ON execution_runs(mode, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_runs_user_idempotency ON execution_runs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_execution_runs_trace_id ON execution_runs(trace_id);
CREATE INDEX IF NOT EXISTS idx_telegram_reports_chat_id_created_at ON telegram_reports(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_reports_status_next_attempt_at ON telegram_reports(status, next_attempt_at ASC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created_at ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_entity ON approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status_created_at ON approvals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_registry_provider_available ON model_registry(provider, is_available);
CREATE INDEX IF NOT EXISTS idx_task_model_policy_task_type_active ON task_model_policy(task_type, is_active, tier ASC, priority DESC);

-- compatibility: add new columns to mission_steps for existing installations
ALTER TABLE IF EXISTS mission_steps ADD COLUMN IF NOT EXISTS task_type TEXT;
ALTER TABLE IF EXISTS mission_steps ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS mission_steps DROP CONSTRAINT IF EXISTS mission_steps_step_type_check;
ALTER TABLE IF EXISTS mission_steps
  ADD CONSTRAINT mission_steps_step_type_check CHECK (
    step_type IN ('llm_generate', 'council_debate', 'human_gate', 'tool_call', 'sub_mission',
                  'code', 'research', 'finance', 'news', 'approval', 'execute')
  );

-- compatibility: add EMA columns to provider_stats
ALTER TABLE IF EXISTS provider_stats ADD COLUMN IF NOT EXISTS success_ema NUMERIC NOT NULL DEFAULT 0.5;
ALTER TABLE IF EXISTS provider_stats ADD COLUMN IF NOT EXISTS latency_ema NUMERIC NOT NULL DEFAULT 0;

COMMIT;

-- Backfill/validation guide:
-- 1) Backfill existing task rows with idempotency_key and trace_id before enabling stricter write paths.
-- 2) Populate memory_segments.embedding lazily; do not block writes during initial rollout.
-- 3) Run consistency checks:
--    SELECT count(*) FROM upgrade_runs WHERE start_command <> '작업 시작'; -- expect 0
--    SELECT count(*) FROM tech_radar_items WHERE confidence_score < 0 OR confidence_score > 1; -- expect 0
-- 4) After backfill, enable app-level requirement for trace_id and standardized request_id mapping.
