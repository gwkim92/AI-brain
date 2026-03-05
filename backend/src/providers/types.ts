export type ProviderName = 'openai' | 'gemini' | 'anthropic' | 'local';
export type ProviderCredentialSource = 'user' | 'workspace' | 'env' | 'none';
export type ProviderCredentialMode = 'api_key' | 'oauth_official';
export type ProviderCredentialPriority = 'api_key_first' | 'auth_first';
export type ProviderCredentialUsage = {
  source: ProviderCredentialSource;
  selectedCredentialMode: ProviderCredentialMode | null;
  credentialPriority: ProviderCredentialPriority;
  authAccessTokenExpiresAt: string | null;
};

export type ProviderResolvedCredential = {
  provider: ProviderName;
  source: ProviderCredentialSource;
  selectedCredentialMode: ProviderCredentialMode | null;
  credentialPriority: ProviderCredentialPriority;
  apiKey?: string;
  oauthAccessToken?: string;
  oauthRefreshToken?: string;
  oauthScope?: string;
  oauthTokenType?: string;
  authAccessTokenExpiresAt?: string | null;
};

export type ProviderCredentialsByProvider = Partial<Record<ProviderName, ProviderResolvedCredential>>;

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
  topP?: number;
  stop?: string[];
  maxOutputTokens?: number;
  taskType?: RoutingTaskType;
  excludeProviders?: ProviderName[];
  credentialsByProvider?: ProviderCredentialsByProvider;
  traceId?: string;
  onSpanEvent?: (event: {
    name: 'provider.call.start' | 'provider.call.complete';
    provider: ProviderName;
    traceId?: string;
    success?: boolean;
    latencyMs?: number;
    error?: string;
  }) => void;
};

export type ProviderGenerateResult = {
  provider: ProviderName;
  model: string;
  outputText: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  credential?: ProviderCredentialUsage;
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
  credential?: ProviderCredentialUsage;
};

export type ProviderRouteResult = {
  result: ProviderGenerateResult;
  attempts: ProviderAttempt[];
  usedFallback: boolean;
  selectedCredential?: ProviderCredentialUsage;
  selection?: {
    strategy: 'auto_orchestrator' | 'requested_provider';
    taskType: RoutingTaskType;
    orderedProviders: ProviderName[];
    scores?: Array<{
      provider: ProviderName;
      score: number;
      breakdown?: {
        domain_fit: number;
        recent_success: number;
        latency: number;
        cost: number;
        context_fit: number;
        prompt_fit: number;
        availability_penalty: number;
      };
    }>;
    reason?: string;
  };
};

export interface LlmProvider {
  readonly name: ProviderName;

  availability(): ProviderAvailability;

  generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult>;

  setApiKey?: (apiKey?: string) => void;
}
