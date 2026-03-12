import type {
  AssistantContextStatus,
  IntelligenceCapabilityAlias,
  IntelligenceDomainId,
  IntelligenceEventFamily,
  IntelligenceExecutionStatus,
  IntelligenceScanRunStatus,
  IntelligenceSourceKind,
  CouncilRunRecord,
  ExecutionRunRecord,
  MissionRecord,
  MissionStepRecord,
  RadarDomainId,
  RadarFeedKind,
  RadarExecutionMode,
  RadarIngestRunStatus,
  RadarItemStatus,
  RadarPromotionDecision,
  RadarRiskBand,
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
  observed_at: Date | null;
  confidence_score: string | number;
  status: RadarItemStatus;
  source_type: string | null;
  source_tier: string | null;
  raw_metrics_json: Record<string, unknown>;
  entity_hints_json: unknown;
  trust_hint: string | null;
  payload: Record<string, unknown>;
};

export type RadarFeedSourceRow = {
  id: string;
  name: string;
  kind: RadarFeedKind;
  url: string;
  source_type: string;
  source_tier: string;
  poll_minutes: number;
  enabled: boolean;
  parser_hints_json: Record<string, unknown>;
  entity_hints_json: unknown;
  metric_hints_json: unknown;
  last_fetched_at: Date | null;
  last_success_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type RadarFeedCursorRow = {
  source_id: string;
  cursor_text: string | null;
  etag: string | null;
  last_modified: string | null;
  last_seen_published_at: Date | null;
  last_fetched_at: Date | null;
  updated_at: Date;
};

export type RadarIngestRunRow = {
  id: string;
  source_id: string | null;
  status: RadarIngestRunStatus;
  fetched_count: number;
  ingested_count: number;
  evaluated_count: number;
  promoted_count: number;
  auto_executed_count: number;
  failed_count: number;
  error_text: string | null;
  detail_json: Record<string, unknown>;
  started_at: Date;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type RadarEventRow = {
  id: string;
  title: string;
  summary: string;
  event_type: string;
  geo_scope: string | null;
  time_scope: string | null;
  dedupe_cluster_id: string;
  primary_item_id: string | null;
  cluster_size: number;
  item_ids_json: unknown;
  entities_json: unknown;
  claims_json: unknown;
  metric_shocks_json: unknown;
  source_mix_json: Record<string, unknown>;
  source_diversity_score: string | number;
  corroboration_detail_json: Record<string, unknown>;
  novelty_score: string | number;
  corroboration_score: string | number;
  metric_alignment_score: string | number;
  bottleneck_proximity_score: string | number;
  persistence_score: string | number;
  structurality_score: string | number;
  actionability_score: string | number;
  decision: RadarPromotionDecision;
  override_decision: RadarPromotionDecision | null;
  expected_next_signals_json: unknown;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type RadarDomainPosteriorRow = {
  id: string;
  event_id: string;
  domain_id: RadarDomainId;
  score: string | number;
  evidence_features_json: unknown;
  counter_features_json: unknown;
  recommended_pack_id: RadarDomainId;
  created_at: Date;
};

export type RadarAutonomyDecisionRow = {
  id: string;
  event_id: string;
  risk_band: RadarRiskBand;
  execution_mode: RadarExecutionMode;
  policy_reasons_json: unknown;
  requires_human: boolean;
  kill_switch_scope: string;
  created_at: Date;
  updated_at: Date;
};

export type RadarOperatorFeedbackRow = {
  id: string;
  event_id: string;
  user_id: string;
  kind: 'ack' | 'override';
  note: string | null;
  override_decision: RadarPromotionDecision | null;
  created_at: Date;
};

export type RadarDomainPackMetricRow = {
  domain_id: RadarDomainId;
  calibration_score: string | number;
  evaluation_count: number;
  promotion_count: number;
  dossier_count: number;
  action_count: number;
  auto_execute_count: number;
  override_count: number;
  ack_count: number;
  confirmed_count: number;
  invalidated_count: number;
  mixed_count: number;
  unresolved_count: number;
  last_event_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type RadarControlSettingsRow = {
  global_kill_switch: boolean;
  auto_execution_enabled: boolean;
  dossier_promotion_enabled: boolean;
  tier3_escalation_enabled: boolean;
  disabled_domain_ids_json: unknown;
  disabled_source_tiers_json: unknown;
  updated_by: string | null;
  updated_at: Date;
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

export type IntelligenceWorkspaceRow = {
  id: string;
  owner_user_id: string;
  name: string;
  slug: string;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceWorkspaceMemberRow = {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'member' | 'admin';
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceSourceRow = {
  id: string;
  workspace_id: string;
  name: string;
  kind: IntelligenceSourceKind;
  url: string;
  source_type: string;
  source_tier: string;
  poll_minutes: number;
  enabled: boolean;
  parser_config_json: Record<string, unknown>;
  crawl_config_json: Record<string, unknown>;
  health_json: Record<string, unknown>;
  connector_capability_json: Record<string, unknown> | null;
  entity_hints_json: unknown;
  metric_hints_json: unknown;
  last_fetched_at: Date | null;
  last_success_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceSourceCursorRow = {
  workspace_id: string;
  source_id: string;
  cursor_text: string | null;
  etag: string | null;
  last_modified: string | null;
  last_seen_published_at: Date | null;
  last_fetched_at: Date | null;
  updated_at: Date;
};

export type IntelligenceFetchFailureRow = {
  id: string;
  workspace_id: string;
  source_id: string | null;
  url: string;
  reason: string;
  status_code: number | null;
  retryable: boolean;
  blocked_by_robots: boolean;
  created_at: Date;
};

export type IntelligenceScanRunRow = {
  id: string;
  workspace_id: string;
  source_id: string | null;
  status: IntelligenceScanRunStatus;
  fetched_count: number;
  stored_document_count: number;
  signal_count: number;
  clustered_event_count: number;
  execution_count: number;
  failed_count: number;
  error_text: string | null;
  detail_json: Record<string, unknown>;
  started_at: Date;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceRawDocumentRow = {
  id: string;
  workspace_id: string;
  source_id: string | null;
  source_url: string;
  canonical_url: string;
  title: string;
  summary: string;
  raw_text: string;
  raw_html: string | null;
  published_at: Date | null;
  observed_at: Date | null;
  language: string | null;
  source_type: string;
  source_tier: string;
  document_fingerprint: string;
  metadata_json: Record<string, unknown>;
  created_at: Date;
};

export type IntelligenceSignalRow = {
  id: string;
  workspace_id: string;
  source_id: string | null;
  document_id: string;
  linked_event_id: string | null;
  source_type: string;
  source_tier: string;
  url: string;
  published_at: Date | null;
  observed_at: Date | null;
  language: string | null;
  raw_text: string;
  raw_metrics_json: Record<string, unknown>;
  entity_hints_json: unknown;
  trust_hint: string | null;
  processing_status: 'pending' | 'processing' | 'processed' | 'failed';
  processing_error: string | null;
  processed_at: Date | null;
  created_at: Date;
};

export type IntelligenceLinkedClaimRow = {
  id: string;
  workspace_id: string;
  claim_fingerprint: string;
  canonical_subject: string;
  canonical_predicate: string;
  canonical_object: string;
  predicate_family: string;
  time_scope: string | null;
  time_bucket_start: Date | null;
  time_bucket_end: Date | null;
  stance_distribution_json: Record<string, unknown>;
  source_count: number;
  contradiction_count: number;
  non_social_source_count: number;
  supporting_signal_ids_json: unknown;
  last_supported_at: Date | null;
  last_contradicted_at: Date | null;
  review_state: 'watch' | 'review' | 'ignore';
  review_reason: string | null;
  review_owner: string | null;
  review_updated_at: Date | null;
  review_updated_by: string | null;
  review_resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceClaimLinkRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  linked_claim_id: string;
  signal_id: string;
  semantic_claim_id: string;
  relation: 'supporting' | 'contradicting' | 'related';
  confidence: string | number;
  link_strength: string | number;
  created_at: Date;
};

export type IntelligenceLinkedClaimEdgeRow = {
  id: string;
  workspace_id: string;
  left_linked_claim_id: string;
  right_linked_claim_id: string;
  relation: 'supports' | 'contradicts' | 'related';
  edge_strength: string | number;
  evidence_signal_ids_json: unknown;
  last_observed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceEventMembershipRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  linked_claim_id: string;
  role: 'core' | 'supporting' | 'contradicting';
  created_at: Date;
};

export type IntelligenceEventRow = {
  id: string;
  workspace_id: string;
  title: string;
  summary: string;
  event_family: IntelligenceEventFamily;
  signal_ids_json: unknown;
  document_ids_json: unknown;
  entities_json: unknown;
  linked_claim_count: number;
  contradiction_count: number;
  non_social_corroboration_count: number;
  linked_claim_health_score: string | number;
  time_coherence_score: string | number;
  graph_support_score: string | number;
  graph_contradiction_score: string | number;
  graph_hotspot_count: number;
  semantic_claims_json: unknown;
  metric_shocks_json: unknown;
  source_mix_json: Record<string, unknown>;
  corroboration_score: string | number;
  novelty_score: string | number;
  structurality_score: string | number;
  actionability_score: string | number;
  risk_band: RadarRiskBand;
  top_domain_id: IntelligenceDomainId | null;
  time_window_start: Date | null;
  time_window_end: Date | null;
  domain_posteriors_json: unknown;
  world_states_json: unknown;
  primary_hypotheses_json: unknown;
  counter_hypotheses_json: unknown;
  invalidation_conditions_json: unknown;
  expected_signals_json: unknown;
  deliberation_status: 'idle' | 'completed' | 'failed';
  review_state: 'watch' | 'review' | 'ignore';
  review_reason: string | null;
  review_owner: string | null;
  review_updated_at: Date | null;
  review_updated_by: string | null;
  review_resolved_at: Date | null;
  deliberations_json: unknown;
  execution_candidates_json: unknown;
  outcomes_json: unknown;
  operator_note_count: number;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceHypothesisLedgerRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  hypothesis_id: string;
  kind: 'primary' | 'counter';
  title: string;
  summary: string;
  confidence: string | number;
  rationale: string;
  status: 'active' | 'superseded';
  review_state: 'watch' | 'review' | 'ignore';
  review_reason: string | null;
  review_owner: string | null;
  review_updated_at: Date | null;
  review_updated_by: string | null;
  review_resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceHypothesisEvidenceLinkRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  hypothesis_id: string;
  linked_claim_id: string | null;
  signal_id: string | null;
  relation: 'supports' | 'contradicts' | 'monitors';
  evidence_strength: string | number | null;
  created_at: Date;
};

export type IntelligenceInvalidationEntryRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  title: string;
  description: string;
  matcher_json: Record<string, unknown>;
  status: 'pending' | 'hit' | 'missed';
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceExpectedSignalEntryRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  signal_key: string;
  description: string;
  due_at: Date | null;
  status: 'pending' | 'observed' | 'absent';
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceOutcomeEntryRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  status: 'confirmed' | 'invalidated' | 'mixed' | 'unresolved';
  summary: string;
  created_at: Date;
};

export type IntelligenceNarrativeClusterRow = {
  id: string;
  workspace_id: string;
  cluster_key: string;
  title: string;
  event_family: IntelligenceEventFamily;
  top_domain_id: IntelligenceDomainId | null;
  anchor_entities_json: unknown;
  state: 'forming' | 'recurring' | 'diverging';
  event_count: number;
  recurring_event_count: number;
  diverging_event_count: number;
  supportive_history_count: number;
  hotspot_event_count: number;
  latest_recurring_score: string | number;
  drift_score: string | number;
  support_score: string | number;
  contradiction_score: string | number;
  time_coherence_score: string | number;
  recurring_strength_trend: string | number;
  divergence_trend: string | number;
  support_decay_score: string | number;
  contradiction_acceleration: string | number;
  cluster_priority_score: number;
  recent_execution_blocked_count: number;
  review_state: 'watch' | 'review' | 'ignore';
  review_reason: string | null;
  review_owner: string | null;
  review_updated_at: Date | null;
  review_updated_by: string | null;
  review_resolved_at: Date | null;
  last_ledger_at: Date | null;
  last_event_at: Date | null;
  last_recurring_at: Date | null;
  last_diverging_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceNarrativeClusterMembershipRow = {
  id: string;
  workspace_id: string;
  cluster_id: string;
  event_id: string;
  relation: 'origin' | 'recurring' | 'diverging' | 'supportive_history';
  score: string | number;
  days_delta: number | null;
  is_latest: boolean;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceTemporalNarrativeLedgerEntryRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  related_event_id: string;
  related_event_title: string;
  relation: 'recurring' | 'diverging' | 'supportive_history';
  score: string | number;
  days_delta: number | null;
  top_domain_id: IntelligenceDomainId | null;
  graph_support_score: string | number;
  graph_contradiction_score: string | number;
  graph_hotspot_count: number;
  time_coherence_score: string | number;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceNarrativeClusterLedgerEntryRow = {
  id: string;
  workspace_id: string;
  cluster_id: string;
  entry_type:
    | 'merge'
    | 'split'
    | 'recurring_strengthened'
    | 'diverging_strengthened'
    | 'supportive_history_added'
    | 'stability_drop';
  summary: string;
  score_delta: string | number;
  source_event_ids_json: unknown;
  created_at: Date;
};

export type IntelligenceNarrativeClusterTimelineRow = {
  id: string;
  workspace_id: string;
  cluster_id: string;
  bucket_start: Date;
  event_count: number;
  recurring_score: string | number;
  drift_score: string | number;
  support_score: string | number;
  contradiction_score: string | number;
  time_coherence_score: string | number;
  hotspot_event_count: number;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceExecutionAuditRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  candidate_id: string;
  connector_id: string | null;
  action_name: string | null;
  status: string;
  summary: string;
  result_json: Record<string, unknown>;
  created_at: Date;
};

export type IntelligenceOperatorNoteRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  user_id: string;
  scope: 'event' | 'hypothesis' | 'linked_claim';
  scope_id: string | null;
  note: string;
  created_at: Date;
};

export type IntelligenceBridgeDispatchRow = {
  id: string;
  workspace_id: string;
  event_id: string;
  kind: string;
  status: string;
  target_id: string | null;
  request_json: Record<string, unknown>;
  response_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceModelRegistryRow = {
  id: string;
  provider: string;
  model_id: string;
  availability: string;
  context_window: number | null;
  supports_structured_output: boolean;
  supports_tool_use: boolean;
  supports_long_context: boolean;
  supports_reasoning: boolean;
  cost_class: string;
  latency_class: string;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceProviderHealthRow = {
  provider: string;
  available: boolean;
  cooldown_until: Date | null;
  reason_code: string | null;
  failure_count: number;
  updated_at: Date | null;
};

export type IntelligenceAliasBindingRow = {
  id: string;
  workspace_id: string | null;
  alias: IntelligenceCapabilityAlias;
  provider: string;
  model_id: string;
  weight: string | number;
  fallback_rank: number;
  canary_percent: string | number;
  is_active: boolean;
  requires_structured_output: boolean;
  requires_tool_use: boolean;
  requires_long_context: boolean;
  max_cost_class: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type IntelligenceAliasRolloutRow = {
  id: string;
  workspace_id: string | null;
  alias: string;
  binding_ids_json: unknown;
  created_by: string | null;
  note: string | null;
  created_at: Date;
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

export type UserProviderCredentialRow = {
  user_id: string;
  provider: 'openai' | 'gemini' | 'anthropic' | 'local';
  encrypted_payload: string;
  is_active: boolean;
  updated_by: string | null;
  updated_at: Date;
};

export type ProviderOauthStateRow = {
  state: string;
  user_id: string;
  provider: 'openai' | 'gemini' | 'anthropic' | 'local';
  encrypted_context: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
};

export type UserModelSelectionPreferenceRow = {
  user_id: string;
  feature_key: string;
  provider: 'openai' | 'gemini' | 'anthropic' | 'local' | 'auto';
  model_id: string | null;
  strict_provider: boolean;
  selection_mode: 'auto' | 'manual';
  updated_by: string | null;
  updated_at: Date;
};

export type ModelRecommendationRunRow = {
  id: string;
  user_id: string;
  feature_key: string;
  prompt_hash: string;
  prompt_excerpt_redacted: string;
  recommended_provider: 'openai' | 'gemini' | 'anthropic' | 'local';
  recommended_model_id: string;
  rationale_text: string;
  evidence_json: Record<string, unknown>;
  recommender_provider: 'openai';
  applied_at: Date | null;
  created_at: Date;
};

export type AiInvocationTraceRow = {
  id: string;
  user_id: string;
  feature_key: string;
  task_type: string;
  request_provider: 'openai' | 'gemini' | 'anthropic' | 'local' | 'auto';
  request_model: string | null;
  resolved_provider: 'openai' | 'gemini' | 'anthropic' | 'local' | null;
  resolved_model: string | null;
  credential_mode: 'api_key' | 'oauth_official' | null;
  credential_source: 'user' | 'workspace' | 'env' | 'none';
  attempts_json: unknown;
  used_fallback: boolean;
  success: boolean;
  error_code: string | null;
  error_message_redacted: string | null;
  latency_ms: number;
  trace_id: string | null;
  context_refs_json: Record<string, unknown>;
  created_at: Date;
};

export type JarvisSessionRow = {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  source: string;
  intent: 'general' | 'code' | 'research' | 'finance' | 'news' | 'council';
  status: 'queued' | 'running' | 'blocked' | 'needs_approval' | 'completed' | 'failed' | 'stale';
  workspace_preset: 'jarvis' | 'research' | 'execution' | 'control' | null;
  primary_target: 'assistant' | 'mission' | 'council' | 'execution' | 'briefing' | 'dossier';
  task_id: string | null;
  mission_id: string | null;
  assistant_context_id: string | null;
  council_run_id: string | null;
  execution_run_id: string | null;
  briefing_id: string | null;
  dossier_id: string | null;
  last_event_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type JarvisSessionEventRow = {
  id: string;
  session_id: string;
  sequence: string | number;
  event_type: string;
  status: 'queued' | 'running' | 'blocked' | 'needs_approval' | 'completed' | 'failed' | 'stale' | null;
  summary: string | null;
  data: Record<string, unknown>;
  created_at: Date;
};

export type JarvisSessionStageRow = {
  id: string;
  session_id: string;
  stage_key: string;
  capability: 'answer' | 'research' | 'brief' | 'debate' | 'plan' | 'approve' | 'execute' | 'monitor' | 'notify';
  title: string;
  status: 'queued' | 'running' | 'blocked' | 'needs_approval' | 'completed' | 'failed' | 'skipped';
  order_index: number;
  depends_on_json: string[] | unknown;
  artifact_refs_json: Record<string, unknown>;
  summary: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type ActionProposalRow = {
  id: string;
  user_id: string;
  session_id: string;
  kind: 'mission_execute' | 'council_run' | 'execution_run' | 'workspace_prepare' | 'notify' | 'custom';
  title: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
  payload: Record<string, unknown>;
  decided_at: Date | null;
  decided_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type MemoryNoteRow = {
  id: string;
  user_id: string;
  kind: 'user_preference' | 'project_context' | 'decision_memory' | 'research_memory';
  title: string;
  content: string;
  memory_key: string | null;
  memory_value: string | null;
  attributes_json: Record<string, unknown> | null;
  tags_json: string[] | unknown;
  pinned: boolean;
  source: 'manual' | 'session' | 'system';
  related_session_id: string | null;
  related_task_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type WatcherRow = {
  id: string;
  user_id: string;
  kind: 'external_topic' | 'company' | 'market' | 'war_region' | 'repo' | 'task_health' | 'mission_health' | 'approval_backlog';
  status: 'active' | 'paused' | 'error';
  title: string;
  query: string;
  config_json: Record<string, unknown>;
  last_run_at: Date | null;
  last_hit_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type WatcherRunRow = {
  id: string;
  watcher_id: string;
  user_id: string;
  status: 'running' | 'completed' | 'failed';
  summary: string;
  briefing_id: string | null;
  dossier_id: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type BriefingRow = {
  id: string;
  user_id: string;
  watcher_id: string | null;
  session_id: string | null;
  type: 'daily' | 'on_change' | 'on_demand';
  status: 'draft' | 'completed' | 'failed';
  title: string;
  query: string;
  summary: string;
  answer_markdown: string;
  source_count: number;
  quality_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type DossierRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  briefing_id: string | null;
  title: string;
  query: string;
  status: 'draft' | 'ready' | 'failed';
  summary: string;
  answer_markdown: string;
  quality_json: Record<string, unknown>;
  conflicts_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type DossierSourceRow = {
  id: string;
  dossier_id: string;
  url: string;
  title: string;
  domain: string;
  snippet: string;
  published_at: Date | null;
  source_order: number;
  created_at: Date;
};

export type DossierClaimRow = {
  id: string;
  dossier_id: string;
  claim_text: string;
  claim_order: number;
  source_urls: string[];
  created_at: Date;
};

export type WorldModelEntityRow = {
  id: string;
  user_id: string;
  kind: 'actor' | 'organization' | 'country' | 'asset' | 'route' | 'facility' | 'commodity' | 'policy' | 'other';
  canonical_name: string;
  aliases_json: string[] | unknown;
  attributes_json: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

export type WorldModelEventRow = {
  id: string;
  user_id: string;
  dossier_id: string | null;
  kind: 'geopolitical' | 'contract' | 'policy' | 'market' | 'operational' | 'financial' | 'other';
  summary: string;
  occurred_at: Date | null;
  recorded_at: Date | null;
  attributes_json: Record<string, unknown> | null;
  created_at: Date;
};

export type WorldModelObservationRow = {
  id: string;
  user_id: string;
  dossier_id: string | null;
  metric_key: string;
  value_text: string;
  unit: string | null;
  observed_at: Date | null;
  recorded_at: Date | null;
  attributes_json: Record<string, unknown> | null;
  created_at: Date;
};

export type WorldModelConstraintRow = {
  id: string;
  user_id: string;
  dossier_id: string | null;
  kind: 'capacity' | 'logistics' | 'insurance' | 'regulatory' | 'settlement' | 'financing' | 'other';
  description: string;
  severity: 'low' | 'medium' | 'high';
  status: 'active' | 'watching' | 'relieved';
  attributes_json: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

export type WorldModelHypothesisRow = {
  id: string;
  user_id: string;
  projection_id: string | null;
  dossier_id: string | null;
  briefing_id: string | null;
  thesis: string;
  stance: 'primary' | 'counter';
  confidence: number;
  status: 'active' | 'weakened' | 'invalidated';
  summary: string | null;
  created_at: Date;
  updated_at: Date;
};

export type WorldModelHypothesisEvidenceRow = {
  id: string;
  hypothesis_id: string;
  dossier_id: string | null;
  claim_text: string;
  relation: 'supports' | 'contradicts' | 'context';
  source_urls: string[];
  weight: number;
  created_at: Date;
};

export type WorldModelInvalidationConditionRow = {
  id: string;
  hypothesis_id: string;
  description: string;
  expected_by: Date | null;
  observed_status: 'pending' | 'hit' | 'missed';
  severity: 'low' | 'medium' | 'high';
  attributes_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type WorldModelStateSnapshotRow = {
  id: string;
  user_id: string;
  target_type: 'dossier' | 'watcher' | 'session';
  target_id: string;
  state_json: Record<string, unknown>;
  created_at: Date;
};

export type WorldModelProjectionRow = {
  id: string;
  user_id: string;
  dossier_id: string | null;
  briefing_id: string | null;
  watcher_id: string | null;
  session_id: string | null;
  origin: 'briefing_generate' | 'dossier_refresh' | 'watcher_run' | 'outcome_backfill';
  status: 'active' | 'superseded';
  generated_at: Date;
  superseded_at: Date | null;
  superseded_by_projection_id: string | null;
  summary_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type WorldModelOutcomeRow = {
  id: string;
  user_id: string;
  hypothesis_id: string;
  evaluated_at: Date;
  result: 'confirmed' | 'mixed' | 'invalidated' | 'unresolved';
  error_notes: string | null;
  horizon_realized: string | null;
  missed_invalidators_json: string[] | unknown;
  created_at: Date;
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
