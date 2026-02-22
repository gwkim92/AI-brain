import type {
  LlmProvider,
  ProviderAttempt,
  ProviderAvailability,
  ProviderName,
  ProviderRouteResult,
  RoutingTaskType,
  ProviderGenerateRequest,
  ProviderGenerateResult
} from './types';

export type ProviderRouterRequest = ProviderGenerateRequest & {
  provider?: ProviderName | 'auto';
  strictProvider?: boolean;
};

const DEFAULT_ORDER: Record<RoutingTaskType, ProviderName[]> = {
  chat: ['openai', 'anthropic', 'gemini', 'local'],
  execute: ['openai', 'anthropic', 'gemini', 'local'],
  council: ['anthropic', 'openai', 'gemini', 'local'],
  code: ['openai', 'local', 'anthropic', 'gemini'],
  compute: ['openai', 'gemini', 'anthropic', 'local'],
  long_run: ['openai', 'anthropic', 'gemini', 'local'],
  high_risk: ['anthropic', 'openai', 'gemini', 'local'],
  radar_review: ['openai', 'gemini', 'anthropic', 'local'],
  upgrade_execution: ['openai', 'anthropic', 'gemini', 'local']
};

export class ProviderRouter {
  constructor(private readonly providers: Record<ProviderName, LlmProvider>) {}

  listAvailability(): ProviderAvailability[] {
    return this.orderedProviderNames().map((name) => this.providers[name].availability());
  }

  async generate(request: ProviderRouterRequest): Promise<ProviderRouteResult> {
    const order = this.resolveOrder(request);
    const attempts: ProviderAttempt[] = [];

    for (const providerName of order) {
      const provider = this.providers[providerName];
      const availability = provider.availability();

      if (!availability.enabled) {
        attempts.push({
          provider: providerName,
          status: 'skipped',
          error: availability.reason ?? 'provider_disabled'
        });
        continue;
      }

      const startedAt = Date.now();

      try {
        const result = await provider.generate(request);
        attempts.push({
          provider: providerName,
          status: 'success',
          latencyMs: Date.now() - startedAt
        });

        return {
          result,
          attempts,
          usedFallback: attempts.filter((item) => item.status === 'failed' || item.status === 'skipped').length > 0
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({
          provider: providerName,
          status: 'failed',
          latencyMs: Date.now() - startedAt,
          error: message
        });
      }
    }

    throw new Error(
      `all providers failed: ${attempts
        .map((item) => `${item.provider}:${item.status}${item.error ? `(${item.error})` : ''}`)
        .join(', ')}`
    );
  }

  private resolveOrder(request: ProviderRouterRequest): ProviderName[] {
    const requestedProvider = request.provider;
    const taskType = request.taskType ?? 'chat';

    if (requestedProvider && requestedProvider !== 'auto') {
      if (request.strictProvider) {
        return [requestedProvider];
      }

      const fallback = DEFAULT_ORDER[taskType].filter((item) => item !== requestedProvider);
      return [requestedProvider, ...fallback];
    }

    return [...DEFAULT_ORDER[taskType]];
  }

  private orderedProviderNames(): ProviderName[] {
    return ['openai', 'gemini', 'anthropic', 'local'];
  }
}

export function maskErrorForApi(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

export function summarizeResult(result: ProviderGenerateResult): {
  provider: ProviderName;
  model: string;
  output: string;
  usage?: ProviderGenerateResult['usage'];
} {
  return {
    provider: result.provider,
    model: result.model,
    output: result.outputText,
    usage: result.usage
  };
}
