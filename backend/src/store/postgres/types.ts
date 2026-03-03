import type {
  AssistantContextStatus,
  CouncilRunRecord,
  ExecutionRunRecord,
  MissionRecord,
  MissionStepRecord,
  RadarItemStatus,
  TaskRecord,
  UpgradeStatus,
  UserRole
} from '../types';

export type PostgresStoreOptions = {
  connectionString: string;
  defaultUserId: string;
  defaultUserEmail: string;
};

export type TaskRow = {
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

export type TaskEventRow = {
  id: string;
  task_id: string;
  type: string;
  data: Record<string, unknown>;
  trace_id: string | null;
  span_id: string | null;
  created_at: Date;
};

export type RadarItemRow = {
  id: string;
  title: string;
  summary: string | null;
  source_url: string;
  source_name: string;
  published_at: Date | null;
  confidence_score: string | number;
  status: RadarItemStatus;
};

export type UpgradeProposalRow = {
  id: string;
  radar_score_id: string;
  proposal_title: string;
  status: UpgradeStatus;
  created_at: Date;
  approved_at: Date | null;
};

export type UpgradeRunRow = {
  id: string;
  proposal_id: string;
  status: UpgradeStatus;
  start_command: string;
  created_at: Date;
  updated_at: Date;
};

export type CouncilRunRow = {
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

export type ExecutionRunRow = {
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

export type AuthUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AuthSessionRow = {
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

export type ProviderCredentialRow = {
  provider: 'openai' | 'gemini' | 'anthropic' | 'local';
  encrypted_api_key: string;
  updated_by: string | null;
  updated_at: Date;
};

export type MissionRow = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  title: string;
  objective: string;
  domain: MissionRecord['domain'];
  status: MissionRecord['status'];
  mission_contract: unknown;
  created_at: Date;
  updated_at: Date;
};

export type MissionStepRow = {
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

export type AssistantContextRow = {
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

export type AssistantContextEventRow = {
  id: string;
  context_id: string;
  sequence: string | number;
  event_type: string;
  data: Record<string, unknown>;
  trace_id: string | null;
  span_id: string | null;
  created_at: Date;
};

export type AssistantContextGroundingSourceRow = {
  id: string;
  context_id: string;
  url: string;
  title: string;
  domain: string;
  source_order: number;
  created_at: Date;
};

export type AssistantContextGroundingClaimRow = {
  id: string;
  context_id: string;
  claim_text: string;
  claim_order: number;
  created_at: Date;
};

export type AssistantContextGroundingClaimCitationJoinRow = {
  claim_id: string;
  source_id: string;
  citation_order: number;
  source_order: number;
  url: string;
  title: string;
  domain: string;
};

export type TelegramReportRow = {
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
