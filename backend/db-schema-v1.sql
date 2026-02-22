-- JARVIS DB Schema v1
-- Date: 2026-02-22
-- Scope: context/radar/upgrade/telegram domain objects
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
);

-- 4) audit
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

-- 5) indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status_created_at ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_trace_id ON tasks(trace_id);
CREATE INDEX IF NOT EXISTS idx_memory_segments_user_id_created_at ON memory_segments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_segments_tsv ON memory_segments USING GIN(content_tsv);
CREATE INDEX IF NOT EXISTS idx_context_snapshots_task_id_created_at ON context_snapshots(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_radar_items_status_published_at ON tech_radar_items(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_radar_items_source_url ON tech_radar_items(source_url);
CREATE INDEX IF NOT EXISTS idx_radar_scores_item_id_evaluated_at ON tech_radar_scores(radar_item_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_upgrade_proposals_status_created_at ON upgrade_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upgrade_runs_status_created_at ON upgrade_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upgrade_runs_trace_id ON upgrade_runs(trace_id);
CREATE INDEX IF NOT EXISTS idx_telegram_reports_chat_id_created_at ON telegram_reports(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created_at ON audit_logs(entity_type, entity_id, created_at DESC);

COMMIT;

-- Backfill/validation guide:
-- 1) Backfill existing task rows with idempotency_key and trace_id before enabling stricter write paths.
-- 2) Populate memory_segments.embedding lazily; do not block writes during initial rollout.
-- 3) Run consistency checks:
--    SELECT count(*) FROM upgrade_runs WHERE start_command <> '작업 시작'; -- expect 0
--    SELECT count(*) FROM tech_radar_items WHERE confidence_score < 0 OR confidence_score > 1; -- expect 0
-- 4) After backfill, enable app-level requirement for trace_id and standardized request_id mapping.
