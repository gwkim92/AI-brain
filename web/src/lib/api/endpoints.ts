import { apiRequest, apiRequestEnvelope, buildApiUrl, createClientRequestId, tryParseSseData } from "@/lib/api/client";
import type {
  AssistantContextCreateRequest,
  AssistantContextEventRecord,
  AssistantContextGroundingEvidenceData,
  AssistantContextEventStreamEnvelope,
  AssistantContextRecord,
  AssistantContextRunRequest,
  AssistantContextRunMeta,
  AssistantContextStatus,
  AssistantContextUpdateRequest,
  AiRespondData,
  AiRespondRequest,
  AuthLoginRequest,
  AuthConfigData,
  AuthMeData,
  AuthSessionData,
  AuthStaticTokenLoginData,
  AuthStaticTokenLoginRequest,
  AuthSignupRequest,
  CouncilAgentRespondedStreamEnvelope,
  CouncilRoundCompletedStreamEnvelope,
  CouncilRoundStartedStreamEnvelope,
  CouncilRunRecord,
  CouncilRunRequest,
  CouncilRunStreamEnvelope,
  DashboardOverviewData,
  DashboardOverviewStreamEnvelope,
  ExecutionRunRecord,
  ExecutionRunRequest,
  ExecutionRunStreamEnvelope,
  HealthPayload,
  MemorySnapshotData,
  MissionCreateRequest,
  MissionRecord,
  MissionStreamEnvelope,
  MissionStatus,
  MissionUpdateRequest,
  ProposalDecisionRequest,
  ProviderModelCatalogEntry,
  ProviderName,
  ProviderAvailability,
  ProviderConnectionTestResult,
  ProviderCredentialMutationResult,
  ProviderCredentialRecord,
  ProviderCredentialSelectionMode,
  UserProviderCredentialRecord,
  UserProviderConnectionTestResult,
  ProviderOauthStartResult,
  ModelControlFeatureKey,
  UserModelSelectionPreference,
  ModelRecommendationRun,
  AiInvocationTraceRecord,
  AiInvocationMetrics,
  RadarDecision,
  RadarIngestRequest,
  RadarItemRecord,
  RadarItemStatus,
  RadarRecommendationRecord,
  ReportsOverviewData,
  SettingsOverviewData,
  TaskCreateRequest,
  TaskListQuery,
  TaskRecord,
  TelegramReportRecord,
  TelegramReportStreamEnvelope,
  TelegramReportStatus,
  TelegramReportsStreamEnvelope,
  TaskStreamEnvelope,
  UpgradeProposalRecord,
  UpgradeRunRecord,
  UpgradeRunRequest,
  UpgradeStatus,
  GeneratePlanRequest,
  GeneratePlanResponse,
} from "@/lib/api/types";

export async function getHealth(): Promise<HealthPayload> {
  return apiRequest<HealthPayload>("/health", { method: "GET" });
}

export async function authSignup(payload: AuthSignupRequest): Promise<AuthSessionData> {
  return apiRequest<AuthSessionData>("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function authLogin(payload: AuthLoginRequest): Promise<AuthSessionData> {
  return apiRequest<AuthSessionData>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function authStaticTokenLogin(payload: AuthStaticTokenLoginRequest): Promise<AuthStaticTokenLoginData> {
  return apiRequest<AuthStaticTokenLoginData>("/api/v1/auth/static-token/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function authMe(): Promise<AuthMeData> {
  return apiRequest<AuthMeData>("/api/v1/auth/me", { method: "GET" });
}

export async function authConfig(): Promise<AuthConfigData> {
  return apiRequest<AuthConfigData>("/api/v1/auth/config", { method: "GET" });
}

export async function authLogout(): Promise<{ revoked: boolean }> {
  return apiRequest<{ revoked: boolean }>("/api/v1/auth/logout", { method: "POST" });
}

export async function listProviders(): Promise<{ providers: ProviderAvailability[] }> {
  return apiRequest<{ providers: ProviderAvailability[] }>("/api/v1/providers", { method: "GET" });
}

export async function listProviderModels(query: { scope?: "user" | "workspace" } = {}): Promise<{ providers: ProviderModelCatalogEntry[] }> {
  return apiRequest<{ providers: ProviderModelCatalogEntry[] }>("/api/v1/providers/models", { method: "GET", query });
}

export async function getSettingsOverview(): Promise<SettingsOverviewData> {
  return apiRequest<SettingsOverviewData>("/api/v1/settings/overview", { method: "GET" });
}

export async function getDashboardOverview(
  query: {
    task_limit?: number;
    pending_approval_limit?: number;
    running_task_limit?: number;
  } = {}
): Promise<DashboardOverviewData> {
  return apiRequest<DashboardOverviewData>("/api/v1/dashboard/overview", {
    method: "GET",
    query,
  });
}

export type DashboardOverviewEventsStream = {
  close: () => void;
};

function createApiEventSource(pathname: string): EventSource {
  return new EventSource(buildApiUrl(pathname), { withCredentials: true });
}

export function streamDashboardOverviewEvents(
  query: {
    task_limit?: number;
    pending_approval_limit?: number;
    running_task_limit?: number;
    poll_ms?: number;
    timeout_ms?: number;
  } = {},
  handlers: {
    onOpen?: (payload: { request_id: string }) => void;
    onUpdated?: (payload: DashboardOverviewStreamEnvelope) => void;
    onClose?: (payload: unknown) => void;
    onError?: (error: unknown) => void;
  }
): DashboardOverviewEventsStream {
  const params = new URLSearchParams();
  if (typeof query.task_limit === "number") {
    params.set("task_limit", String(query.task_limit));
  }
  if (typeof query.pending_approval_limit === "number") {
    params.set("pending_approval_limit", String(query.pending_approval_limit));
  }
  if (typeof query.running_task_limit === "number") {
    params.set("running_task_limit", String(query.running_task_limit));
  }
  if (typeof query.poll_ms === "number") {
    params.set("poll_ms", String(query.poll_ms));
  }
  if (typeof query.timeout_ms === "number") {
    params.set("timeout_ms", String(query.timeout_ms));
  }
  const querySuffix = params.toString().length > 0 ? `?${params.toString()}` : "";
  const source = createApiEventSource(`/api/v1/dashboard/events${querySuffix}`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string });
  });

  source.addEventListener("dashboard.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as DashboardOverviewStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    handlers.onClose?.(tryParseSseData((event as MessageEvent).data));
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function listAdminProviderCredentials(): Promise<{ providers: ProviderCredentialRecord[] }> {
  return apiRequest<{ providers: ProviderCredentialRecord[] }>("/api/v1/admin/providers/credentials", { method: "GET" });
}

export async function upsertAdminProviderCredential(
  provider: ProviderCredentialRecord["provider"],
  apiKey: string
): Promise<ProviderCredentialMutationResult> {
  return apiRequest<ProviderCredentialMutationResult>(`/api/v1/admin/providers/credentials/${provider}`, {
    method: "PUT",
    body: JSON.stringify({
      api_key: apiKey,
    }),
  });
}

export async function deleteAdminProviderCredential(
  provider: ProviderCredentialRecord["provider"]
): Promise<ProviderCredentialMutationResult> {
  return apiRequest<ProviderCredentialMutationResult>(`/api/v1/admin/providers/credentials/${provider}`, {
    method: "DELETE",
  });
}

export async function testAdminProviderConnection(
  provider: ProviderCredentialRecord["provider"]
): Promise<ProviderConnectionTestResult> {
  return apiRequest<ProviderConnectionTestResult>(`/api/v1/admin/providers/credentials/${provider}/test`, {
    method: "POST",
  });
}

export async function listUserProviderCredentials(): Promise<{ providers: UserProviderCredentialRecord[] }> {
  return apiRequest<{ providers: UserProviderCredentialRecord[] }>("/api/v1/providers/credentials", { method: "GET" });
}

export async function getUserProviderCredential(provider: ProviderName): Promise<UserProviderCredentialRecord> {
  return apiRequest<UserProviderCredentialRecord>(`/api/v1/providers/credentials/${provider}`, { method: "GET" });
}

export async function upsertUserProviderCredential(
  provider: ProviderName,
  payload: {
    api_key?: string;
    credential_priority?: "api_key_first" | "auth_first";
    selected_credential_mode?: ProviderCredentialSelectionMode;
    is_active?: boolean;
  }
): Promise<UserProviderCredentialRecord> {
  return apiRequest<UserProviderCredentialRecord>(`/api/v1/providers/credentials/${provider}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteUserProviderCredential(provider: ProviderName): Promise<UserProviderCredentialRecord> {
  return apiRequest<UserProviderCredentialRecord>(`/api/v1/providers/credentials/${provider}`, {
    method: "DELETE",
  });
}

export async function testUserProviderCredential(provider: ProviderName): Promise<UserProviderConnectionTestResult> {
  return apiRequest<UserProviderConnectionTestResult>(`/api/v1/providers/credentials/${provider}/test`, {
    method: "POST",
  });
}

export async function startUserProviderOauth(
  provider: Extract<ProviderName, "openai" | "gemini">,
  payload: Record<string, never> = {}
): Promise<ProviderOauthStartResult> {
  return apiRequest<ProviderOauthStartResult>(`/api/v1/providers/credentials/${provider}/auth/start`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function completeUserProviderOauth(
  provider: Extract<ProviderName, "openai" | "gemini">,
  payload: {
    state: string;
    code: string;
  }
): Promise<UserProviderCredentialRecord> {
  return apiRequest<UserProviderCredentialRecord>(`/api/v1/providers/credentials/${provider}/auth/complete`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getModelControlPreferences(): Promise<{ preferences: UserModelSelectionPreference[] }> {
  return apiRequest<{ preferences: UserModelSelectionPreference[] }>("/api/v1/model-control/preferences", {
    method: "GET",
  });
}

export async function upsertModelControlPreference(
  feature: ModelControlFeatureKey,
  payload: {
    provider: ProviderName | "auto";
    model?: string;
    strict_provider?: boolean;
    selection_mode?: "auto" | "manual";
  }
): Promise<UserModelSelectionPreference> {
  return apiRequest<UserModelSelectionPreference>(`/api/v1/model-control/preferences/${feature}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function createModelRecommendation(payload: {
  feature_key: ModelControlFeatureKey;
  prompt: string;
  task_type?: string;
}): Promise<ModelRecommendationRun> {
  return apiRequest<ModelRecommendationRun>("/api/v1/model-control/recommendations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listModelRecommendations(query: {
  feature_key?: ModelControlFeatureKey;
  limit?: number;
} = {}): Promise<{ recommendations: ModelRecommendationRun[] }> {
  return apiRequest<{ recommendations: ModelRecommendationRun[] }>("/api/v1/model-control/recommendations", {
    method: "GET",
    query,
  });
}

export async function applyModelRecommendation(recommendationId: string): Promise<{
  recommendation: ModelRecommendationRun;
  preference: UserModelSelectionPreference;
}> {
  return apiRequest<{ recommendation: ModelRecommendationRun; preference: UserModelSelectionPreference }>(
    `/api/v1/model-control/recommendations/${recommendationId}/apply`,
    {
      method: "POST",
    }
  );
}

export async function listModelControlTraces(query: {
  feature_key?: ModelControlFeatureKey | "diagnostic";
  success?: boolean;
  limit?: number;
} = {}): Promise<{ traces: AiInvocationTraceRecord[] }> {
  const normalizedQuery: Record<string, string | number> = {};
  if (query.feature_key) {
    normalizedQuery.feature_key = query.feature_key;
  }
  if (typeof query.success === "boolean") {
    normalizedQuery.success = query.success ? "true" : "false";
  }
  if (typeof query.limit === "number") {
    normalizedQuery.limit = query.limit;
  }
  return apiRequest<{ traces: AiInvocationTraceRecord[] }>("/api/v1/model-control/traces", {
    method: "GET",
    query: normalizedQuery,
  });
}

export async function getModelControlMetrics(query: { since?: string } = {}): Promise<AiInvocationMetrics> {
  return apiRequest<AiInvocationMetrics>("/api/v1/model-control/metrics", {
    method: "GET",
    query,
  });
}

export async function aiRespond(payload: AiRespondRequest): Promise<AiRespondData> {
  return apiRequest<AiRespondData>("/api/v1/ai/respond", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function startCouncilRun(payload: CouncilRunRequest): Promise<CouncilRunRecord> {
  const idempotencyKey = payload.idempotency_key ?? createClientRequestId("council");
  const traceId = payload.trace_id ?? createClientRequestId("trace");
  const requestBody = {
    ...payload,
  };
  delete requestBody.idempotency_key;
  delete requestBody.trace_id;
  const response = await apiRequestEnvelope<CouncilRunRecord>("/api/v1/councils/runs", {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
      "x-trace-id": traceId,
    },
    body: JSON.stringify(requestBody),
  });

  return {
    ...response.data,
    idempotent_replay: response.meta.idempotent_replay === true,
  };
}

export async function getCouncilRun(runId: string): Promise<CouncilRunRecord> {
  return apiRequest<CouncilRunRecord>(`/api/v1/councils/runs/${runId}`, { method: "GET" });
}

export async function listCouncilRuns(query: { limit?: number } = {}): Promise<{ runs: CouncilRunRecord[] }> {
  return apiRequest<{ runs: CouncilRunRecord[] }>("/api/v1/councils/runs", {
    method: "GET",
    query,
  });
}

export async function startExecutionRun(payload: ExecutionRunRequest): Promise<ExecutionRunRecord> {
  const idempotencyKey = payload.idempotency_key ?? createClientRequestId("execution");
  const traceId = payload.trace_id ?? createClientRequestId("trace");
  const requestBody = {
    ...payload,
  };
  delete requestBody.idempotency_key;
  delete requestBody.trace_id;
  const response = await apiRequestEnvelope<ExecutionRunRecord>("/api/v1/executions/runs", {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
      "x-trace-id": traceId,
    },
    body: JSON.stringify(requestBody),
  });

  return {
    ...response.data,
    idempotent_replay: response.meta.idempotent_replay === true,
  };
}

export async function getExecutionRun(runId: string): Promise<ExecutionRunRecord> {
  return apiRequest<ExecutionRunRecord>(`/api/v1/executions/runs/${runId}`, { method: "GET" });
}

export async function listExecutionRuns(query: { limit?: number } = {}): Promise<{ runs: ExecutionRunRecord[] }> {
  return apiRequest<{ runs: ExecutionRunRecord[] }>("/api/v1/executions/runs", {
    method: "GET",
    query,
  });
}

export type ExecutionRunEventsStream = {
  close: () => void;
};

export type CouncilRunEventsStream = {
  close: () => void;
};

export function streamCouncilRunEvents(
  runId: string,
  handlers: {
    onOpen?: (payload: CouncilRunStreamEnvelope) => void;
    onRoundStarted?: (payload: CouncilRoundStartedStreamEnvelope) => void;
    onAgentResponded?: (payload: CouncilAgentRespondedStreamEnvelope) => void;
    onRoundCompleted?: (payload: CouncilRoundCompletedStreamEnvelope) => void;
    onUpdated?: (payload: CouncilRunStreamEnvelope) => void;
    onCompleted?: (payload: CouncilRunStreamEnvelope) => void;
    onFailed?: (payload: CouncilRunStreamEnvelope) => void;
    onClose?: (payload: CouncilRunStreamEnvelope) => void;
    onError?: (error: unknown) => void;
  }
): CouncilRunEventsStream {
  const source = createApiEventSource(`/api/v1/councils/runs/${runId}/events`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope);
  });

  source.addEventListener("council.round.started", (event) => {
    handlers.onRoundStarted?.(tryParseSseData((event as MessageEvent).data) as CouncilRoundStartedStreamEnvelope);
  });

  source.addEventListener("council.agent.responded", (event) => {
    handlers.onAgentResponded?.(tryParseSseData((event as MessageEvent).data) as CouncilAgentRespondedStreamEnvelope);
  });

  source.addEventListener("council.round.completed", (event) => {
    handlers.onRoundCompleted?.(tryParseSseData((event as MessageEvent).data) as CouncilRoundCompletedStreamEnvelope);
  });

  source.addEventListener("council.run.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope);
  });

  source.addEventListener("council.run.completed", (event) => {
    handlers.onCompleted?.(tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope);
  });

  source.addEventListener("council.run.failed", (event) => {
    handlers.onFailed?.(tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    const payload = tryParseSseData((event as MessageEvent).data) as CouncilRunStreamEnvelope;
    handlers.onClose?.(payload);
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export function streamExecutionRunEvents(
  runId: string,
  handlers: {
    onOpen?: (payload: ExecutionRunStreamEnvelope) => void;
    onUpdated?: (payload: ExecutionRunStreamEnvelope) => void;
    onCompleted?: (payload: ExecutionRunStreamEnvelope) => void;
    onFailed?: (payload: ExecutionRunStreamEnvelope) => void;
    onClose?: (payload: ExecutionRunStreamEnvelope) => void;
    onError?: (error: unknown) => void;
  }
): ExecutionRunEventsStream {
  const source = createApiEventSource(`/api/v1/executions/runs/${runId}/events`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope);
  });

  source.addEventListener("execution.run.completed", (event) => {
    handlers.onCompleted?.(tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope);
  });

  source.addEventListener("execution.run.failed", (event) => {
    handlers.onFailed?.(tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope);
  });

  source.addEventListener("execution.run.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    const payload = tryParseSseData((event as MessageEvent).data) as ExecutionRunStreamEnvelope;
    handlers.onClose?.(payload);
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function createTask(
  payload: TaskCreateRequest,
  options?: {
    idempotencyKey?: string;
  }
): Promise<TaskRecord> {
  return apiRequest<TaskRecord>("/api/v1/tasks", {
    method: "POST",
    headers: options?.idempotencyKey
      ? {
          "idempotency-key": options.idempotencyKey,
        }
      : undefined,
    body: JSON.stringify(payload),
  });
}

export async function createMission(payload: MissionCreateRequest): Promise<MissionRecord> {
  return apiRequest<MissionRecord>("/api/v1/missions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listMissions(query: { status?: MissionStatus; limit?: number } = {}): Promise<{ missions: MissionRecord[] }> {
  return apiRequest<{ missions: MissionRecord[] }>("/api/v1/missions", {
    method: "GET",
    query,
  });
}

export async function getMission(missionId: string): Promise<MissionRecord> {
  return apiRequest<MissionRecord>(`/api/v1/missions/${missionId}`, { method: "GET" });
}

export async function updateMission(missionId: string, payload: MissionUpdateRequest): Promise<MissionRecord> {
  return apiRequest<MissionRecord>(`/api/v1/missions/${missionId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function generateMissionPlan(payload: GeneratePlanRequest): Promise<GeneratePlanResponse> {
  return apiRequest<GeneratePlanResponse>("/api/v1/missions/generate-plan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type MissionEventsStream = {
  close: () => void;
};

export function streamMissionEvents(
  missionId: string,
  query: {
    poll_ms?: number;
    timeout_ms?: number;
  } = {},
  handlers: {
    onOpen?: (payload: { request_id: string; mission_id: string }) => void;
    onUpdated?: (payload: MissionStreamEnvelope) => void;
    onClose?: (payload: unknown) => void;
    onError?: (error: unknown) => void;
  }
): MissionEventsStream {
  const params = new URLSearchParams();
  if (typeof query.poll_ms === "number") {
    params.set("poll_ms", String(query.poll_ms));
  }
  if (typeof query.timeout_ms === "number") {
    params.set("timeout_ms", String(query.timeout_ms));
  }
  const querySuffix = params.toString().length > 0 ? `?${params.toString()}` : "";
  const source = createApiEventSource(`/api/v1/missions/${missionId}/events${querySuffix}`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string; mission_id: string });
  });

  source.addEventListener("mission.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as MissionStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    handlers.onClose?.(tryParseSseData((event as MessageEvent).data));
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function createAssistantContext(payload: AssistantContextCreateRequest): Promise<AssistantContextRecord> {
  return apiRequest<AssistantContextRecord>("/api/v1/assistant/contexts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listAssistantContexts(
  query: { status?: AssistantContextStatus; limit?: number } = {}
): Promise<{ contexts: AssistantContextRecord[] }> {
  return apiRequest<{ contexts: AssistantContextRecord[] }>("/api/v1/assistant/contexts", {
    method: "GET",
    query,
  });
}

export async function getAssistantContext(contextId: string): Promise<AssistantContextRecord> {
  return apiRequest<AssistantContextRecord>(`/api/v1/assistant/contexts/${contextId}`, {
    method: "GET",
  });
}

export async function getAssistantContextGroundingEvidence(
  contextId: string,
  query: { limit?: number } = {}
): Promise<AssistantContextGroundingEvidenceData> {
  return apiRequest<AssistantContextGroundingEvidenceData>(
    `/api/v1/assistant/contexts/${contextId}/grounding-evidence`,
    {
      method: "GET",
      query,
    }
  );
}

export async function updateAssistantContext(
  contextId: string,
  payload: AssistantContextUpdateRequest
): Promise<AssistantContextRecord> {
  return apiRequest<AssistantContextRecord>(`/api/v1/assistant/contexts/${contextId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function runAssistantContext(
  contextId: string,
  payload: AssistantContextRunRequest = {}
): Promise<AssistantContextRecord> {
  const response = await apiRequestEnvelope<AssistantContextRecord>(`/api/v1/assistant/contexts/${contextId}/run`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function runAssistantContextWithMeta(
  contextId: string,
  payload: AssistantContextRunRequest = {}
): Promise<{ context: AssistantContextRecord; meta: AssistantContextRunMeta }> {
  const response = await apiRequestEnvelope<AssistantContextRecord>(`/api/v1/assistant/contexts/${contextId}/run`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    context: response.data,
    meta: response.meta as AssistantContextRunMeta,
  };
}

export async function appendAssistantContextEvent(
  contextId: string,
  payload: { event_type: string; data?: Record<string, unknown> }
): Promise<AssistantContextEventRecord> {
  return apiRequest<AssistantContextEventRecord>(`/api/v1/assistant/contexts/${contextId}/events`, {
    method: "POST",
    body: JSON.stringify({
      event_type: payload.event_type,
      data: payload.data ?? {},
    }),
  });
}

export async function listAssistantContextEvents(
  contextId: string,
  query: { since_sequence?: number; limit?: number } = {}
): Promise<{ context_id: string; events: AssistantContextEventRecord[]; next_since_sequence: number | null }> {
  return apiRequest<{ context_id: string; events: AssistantContextEventRecord[]; next_since_sequence: number | null }>(
    `/api/v1/assistant/contexts/${contextId}/events`,
    {
      method: "GET",
      query,
    }
  );
}

export async function listTasks(query: TaskListQuery = {}): Promise<TaskRecord[]> {
  return apiRequest<TaskRecord[]>("/api/v1/tasks", {
    method: "GET",
    query: {
      status: query.status,
      limit: query.limit,
    },
  });
}

export async function getTask(taskId: string): Promise<TaskRecord> {
  return apiRequest<TaskRecord>(`/api/v1/tasks/${taskId}`, { method: "GET" });
}

export async function getMemorySnapshot(query: { limit?: number } = {}): Promise<MemorySnapshotData> {
  return apiRequest<MemorySnapshotData>("/api/v1/memory/snapshot", {
    method: "GET",
    query,
  });
}

export async function getReportsOverview(
  query: {
    task_limit?: number;
    run_limit?: number;
  } = {}
): Promise<ReportsOverviewData> {
  return apiRequest<ReportsOverviewData>("/api/v1/reports/overview", {
    method: "GET",
    query,
  });
}

export type TaskEventsStream = {
  close: () => void;
};

export type AssistantContextEventsStream = {
  close: () => void;
};

export function streamTaskEvents(
  taskId: string,
  handlers: {
    onOpen?: (payload: TaskStreamEnvelope) => void;
    onEvent?: (eventType: string, payload: TaskStreamEnvelope) => void;
    onClose?: (payload: TaskStreamEnvelope) => void;
    onError?: (error: unknown) => void;
  }
): TaskEventsStream {
  const source = createApiEventSource(`/api/v1/tasks/${taskId}/events`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as TaskStreamEnvelope);
  });

  const knownTaskEvents = [
    "task.created",
    "task.updated",
    "task.blocked",
    "task.retrying",
    "task.failed",
    "task.done",
    "task.cancelled",
  ];

  for (const eventName of knownTaskEvents) {
    source.addEventListener(eventName, (event) => {
      handlers.onEvent?.(eventName, tryParseSseData((event as MessageEvent).data) as TaskStreamEnvelope);
    });
  }

  source.addEventListener("stream.close", (event) => {
    const payload = tryParseSseData((event as MessageEvent).data) as TaskStreamEnvelope;
    handlers.onClose?.(payload);
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export function streamAssistantContextEvents(
  contextId: string,
  handlers: {
    onOpen?: (payload: { request_id: string; context_id: string; since_sequence: number | null }) => void;
    onEvent?: (payload: AssistantContextEventStreamEnvelope) => void;
    onClose?: (payload: { context_id: string; since_sequence: number | null }) => void;
    onError?: (error: unknown) => void;
  }
): AssistantContextEventsStream {
  const source = createApiEventSource(`/api/v1/assistant/contexts/${contextId}/events/stream`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string; context_id: string; since_sequence: number | null });
  });

  source.addEventListener("assistant.context.event", (event) => {
    handlers.onEvent?.(tryParseSseData((event as MessageEvent).data) as AssistantContextEventStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    const payload = tryParseSseData((event as MessageEvent).data) as { context_id: string; since_sequence: number | null };
    handlers.onClose?.(payload);
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function ingestRadar(payload: RadarIngestRequest = {}): Promise<{ ingest_job_id: string; status: string; accepted_count: number }> {
  return apiRequest<{ ingest_job_id: string; status: string; accepted_count: number }>("/api/v1/radar/ingest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listRadarItems(query: { status?: RadarItemStatus; limit?: number } = {}): Promise<{ items: RadarItemRecord[] }> {
  return apiRequest<{ items: RadarItemRecord[] }>("/api/v1/radar/items", {
    method: "GET",
    query,
  });
}

export async function evaluateRadar(payload: { item_ids: string[] }): Promise<{ evaluation_job_id: string; status: string; recommendation_count: number }> {
  return apiRequest<{ evaluation_job_id: string; status: string; recommendation_count: number }>("/api/v1/radar/evaluate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listRadarRecommendations(query: { decision?: RadarDecision } = {}): Promise<{ recommendations: RadarRecommendationRecord[] }> {
  return apiRequest<{ recommendations: RadarRecommendationRecord[] }>("/api/v1/radar/recommendations", {
    method: "GET",
    query,
  });
}

export async function sendRadarTelegramReport(payload: { chat_id: string }): Promise<TelegramReportRecord> {
  return apiRequest<TelegramReportRecord>("/api/v1/radar/reports/telegram", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function retryRadarTelegramReport(
  reportId: string,
  payload: { max_attempts?: number } = {}
): Promise<TelegramReportRecord> {
  return apiRequest<TelegramReportRecord>(`/api/v1/radar/reports/telegram/${reportId}/retry`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listRadarTelegramReports(
  query: { status?: TelegramReportStatus; limit?: number } = {}
): Promise<{ reports: TelegramReportRecord[] }> {
  return apiRequest<{ reports: TelegramReportRecord[] }>("/api/v1/radar/reports/telegram", {
    method: "GET",
    query,
  });
}

export async function getRadarTelegramReport(reportId: string): Promise<TelegramReportRecord> {
  return apiRequest<TelegramReportRecord>(`/api/v1/radar/reports/telegram/${reportId}`, { method: "GET" });
}

export type TelegramReportsEventsStream = {
  close: () => void;
};

export function streamRadarTelegramReportsEvents(
  query: { status?: TelegramReportStatus; limit?: number } = {},
  handlers: {
    onOpen?: (payload: { request_id: string }) => void;
    onUpdated?: (payload: TelegramReportsStreamEnvelope) => void;
    onClose?: (payload: unknown) => void;
    onError?: (error: unknown) => void;
  }
): TelegramReportsEventsStream {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const querySuffix = params.toString().length > 0 ? `?${params.toString()}` : "";
  const source = createApiEventSource(`/api/v1/radar/reports/telegram/events${querySuffix}`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string });
  });

  source.addEventListener("telegram.reports.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as TelegramReportsStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    handlers.onClose?.(tryParseSseData((event as MessageEvent).data));
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export type TelegramReportEventsStream = {
  close: () => void;
};

export function streamRadarTelegramReportEvents(
  reportId: string,
  handlers: {
    onOpen?: (payload: { request_id: string; report_id: string }) => void;
    onUpdated?: (payload: TelegramReportStreamEnvelope) => void;
    onClose?: (payload: unknown) => void;
    onError?: (error: unknown) => void;
  }
): TelegramReportEventsStream {
  const source = createApiEventSource(`/api/v1/radar/reports/telegram/${reportId}/events`);

  source.addEventListener("stream.open", (event) => {
    handlers.onOpen?.(tryParseSseData((event as MessageEvent).data) as { request_id: string; report_id: string });
  });

  source.addEventListener("telegram.report.updated", (event) => {
    handlers.onUpdated?.(tryParseSseData((event as MessageEvent).data) as TelegramReportStreamEnvelope);
  });

  source.addEventListener("stream.close", (event) => {
    handlers.onClose?.(tryParseSseData((event as MessageEvent).data));
    source.close();
  });

  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };

  return {
    close: () => source.close(),
  };
}

export async function listUpgradeProposals(query: { status?: UpgradeStatus } = {}): Promise<{ proposals: UpgradeProposalRecord[] }> {
  return apiRequest<{ proposals: UpgradeProposalRecord[] }>("/api/v1/upgrades/proposals", {
    method: "GET",
    query,
  });
}

export async function decideUpgradeProposal(proposalId: string, payload: ProposalDecisionRequest): Promise<UpgradeProposalRecord> {
  return apiRequest<UpgradeProposalRecord>(`/api/v1/upgrades/proposals/${proposalId}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function startUpgradeRun(payload: UpgradeRunRequest): Promise<UpgradeRunRecord> {
  return apiRequest<UpgradeRunRecord>("/api/v1/upgrades/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listUpgradeRuns(query: { limit?: number } = {}): Promise<{ runs: UpgradeRunRecord[] }> {
  return apiRequest<{ runs: UpgradeRunRecord[] }>("/api/v1/upgrades/runs", {
    method: "GET",
    query,
  });
}

export async function getUpgradeRun(runId: string): Promise<UpgradeRunRecord> {
  return apiRequest<UpgradeRunRecord>(`/api/v1/upgrades/runs/${runId}`, { method: "GET" });
}

export type ModelRegistryEntry = {
  id: string;
  provider: string;
  model_id: string;
  display_name: string | null;
  capabilities: string[];
  context_window: number | null;
  is_available: boolean;
  last_seen_at: string | null;
};

export type TaskModelPolicyEntry = {
  id: string;
  task_type: string;
  provider: string;
  model_id: string;
  tier: number;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function getModelRegistry(): Promise<{ models: ModelRegistryEntry[] }> {
  return apiRequest<{ models: ModelRegistryEntry[] }>("/api/v1/providers/registry", { method: "GET" });
}

export async function getTaskModelPolicies(): Promise<{ policies: TaskModelPolicyEntry[] }> {
  return apiRequest<{ policies: TaskModelPolicyEntry[] }>("/api/v1/providers/policies", { method: "GET" });
}

export async function upsertTaskModelPolicy(payload: {
  task_type: string;
  provider: string;
  model_id: string;
  tier?: number;
  priority?: number;
  is_active?: boolean;
}): Promise<TaskModelPolicyEntry> {
  return apiRequest<TaskModelPolicyEntry>("/api/v1/providers/policies", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function listApprovals(
  query: { status?: import("./types").ApprovalStatus; limit?: number } = {}
): Promise<{ approvals: import("./types").ApprovalRecord[] }> {
  return apiRequest<{ approvals: import("./types").ApprovalRecord[] }>("/api/v1/approvals", {
    method: "GET",
    query,
  });
}

export async function decideApproval(
  approvalId: string,
  payload: { decision: "approved" | "rejected"; reason?: string }
): Promise<import("./types").ApprovalRecord> {
  return apiRequest<import("./types").ApprovalRecord>(`/api/v1/approvals/${approvalId}/decision`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
