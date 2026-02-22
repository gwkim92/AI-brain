export type ProviderName = 'openai' | 'gemini' | 'anthropic' | 'local';

export type RoutingTaskType =
  | 'chat'
  | 'execute'
  | 'council'
  | 'code'
  | 'compute'
  | 'long_run'
  | 'high_risk'
  | 'radar_review'
  | 'upgrade_execution';

export type ProviderGenerateRequest = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  taskType?: RoutingTaskType;
};

export type ProviderGenerateResult = {
  provider: ProviderName;
  model: string;
  outputText: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  raw?: unknown;
};

export type ProviderAvailability = {
  provider: ProviderName;
  enabled: boolean;
  model?: string;
  reason?: string;
};

export type ProviderAttempt = {
  provider: ProviderName;
  status: 'success' | 'failed' | 'skipped';
  latencyMs?: number;
  error?: string;
};

export type ProviderRouteResult = {
  result: ProviderGenerateResult;
  attempts: ProviderAttempt[];
  usedFallback: boolean;
};

export interface LlmProvider {
  readonly name: ProviderName;

  availability(): ProviderAvailability;

  generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult>;
}
