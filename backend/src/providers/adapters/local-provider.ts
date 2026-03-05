import { ensureOk, joinPath } from '../http';
import { withReasonAwareRetry } from '../retry';
import type {
  LlmProvider,
  ProviderAvailability,
  ProviderGenerateRequest,
  ProviderGenerateResult
} from '../types';

type LocalProviderOptions = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export class LocalProvider implements LlmProvider {
  readonly name = 'local' as const;

  constructor(private readonly options: LocalProviderOptions) {}

  setApiKey(apiKey?: string): void {
    this.options.apiKey = apiKey;
  }

  availability(): ProviderAvailability {
    if (!this.options.enabled) {
      return {
        provider: this.name,
        enabled: false,
        model: this.options.model,
        reason: 'disabled'
      };
    }

    return {
      provider: this.name,
      enabled: true,
      model: this.options.model
    };
  }

  async generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    if (!this.options.enabled) {
      throw new Error('local provider is disabled');
    }

    const scopedCredential = request.credentialsByProvider?.local;
    const hasScopedCredential = Boolean(scopedCredential && scopedCredential.source !== 'none');
    const runtimeApiKey = hasScopedCredential
      ? scopedCredential?.selectedCredentialMode === 'api_key'
        ? scopedCredential.apiKey
        : undefined
      : this.options.apiKey;

    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    if (runtimeApiKey) {
      headers.authorization = `Bearer ${runtimeApiKey}`;
    }

    const model = request.model ?? this.options.model;
    try {
      return await this.generateWithModel(model, request, headers);
    } catch (error) {
      if (request.model || !this.isRetryableFallbackError(error)) {
        throw error;
      }

      const fallbackModels = await this.pickFallbackModels(model, headers, runtimeApiKey);
      if (fallbackModels.length === 0) {
        throw error;
      }

      let lastError: unknown = error;
      for (const fallbackModel of fallbackModels) {
        try {
          const retryResult = await this.generateWithModel(fallbackModel, request, headers);
          return {
            ...retryResult,
            raw: {
              ...(typeof retryResult.raw === 'object' && retryResult.raw !== null
                ? (retryResult.raw as Record<string, unknown>)
                : {}),
              fallback_from_model: model
            }
          };
        } catch (fallbackError) {
          lastError = fallbackError;
          if (!this.isRetryableFallbackError(fallbackError)) {
            throw fallbackError;
          }
        }
      }

      throw lastError;
    }
  }

  private async generateWithModel(
    model: string,
    request: ProviderGenerateRequest,
    headers: Record<string, string>
  ): Promise<ProviderGenerateResult> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const bodyText = await withReasonAwareRetry(
      async () => {
        const response = await fetch(joinPath(this.options.baseUrl, '/v1/chat/completions'), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages,
            temperature: request.temperature,
            top_p: request.topP,
            stop: request.stop,
            max_tokens: request.maxOutputTokens,
            stream: false
          })
        });

        const text = await response.text();
        ensureOk(response, text);
        return text;
      },
      {
        provider: this.name
      }
    );

    const payload = JSON.parse(bodyText) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    };

    const outputText = payload.choices?.[0]?.message?.content?.trim() ?? '';

    if (!outputText) {
      throw new Error('local provider returned empty output');
    }

    return {
      provider: this.name,
      model,
      outputText,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens
      },
      raw: payload
    };
  }

  private isRetryableFallbackError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return /model[\s\S]*not found|not found[\s\S]*model|unknown model|model does not exist|does not support|unsupported|incompatible/iu.test(
      error.message
    );
  }

  private async pickFallbackModels(
    currentModel: string,
    headers: Record<string, string>,
    runtimeApiKey?: string
  ): Promise<string[]> {
    const raw = await withReasonAwareRetry(
      async () => {
        const response = await fetch(joinPath(this.options.baseUrl, '/api/tags'), {
          method: 'GET',
          headers: runtimeApiKey
            ? { authorization: headers.authorization as string }
            : undefined
        });
        const text = await response.text();
        ensureOk(response, text);
        return text;
      },
      {
        provider: this.name
      }
    );

    const payload = JSON.parse(raw) as {
      models?: Array<{ name?: string }>;
    };
    const availableModels = (payload.models ?? [])
      .map((item) => (item.name ?? '').trim())
      .filter(Boolean);

    const deduped = Array.from(new Set(availableModels)).filter((name) => name !== currentModel);
    if (deduped.length === 0) return [];

    return deduped.sort((left, right) => {
      const scoreDiff = this.localModelScore(right) - this.localModelScore(left);
      if (scoreDiff !== 0) return scoreDiff;
      return left.localeCompare(right);
    });
  }

  private localModelScore(model: string): number {
    const normalized = model.toLowerCase();
    let score = 0;
    if (/(embed|embedding|rerank|whisper|tts|transcribe|clip)/u.test(normalized)) {
      score -= 20;
    } else {
      score += 10;
    }
    if (/(chat|instruct)/u.test(normalized)) score += 3;
    if (/(qwen|llama|mistral|deepseek|gemma|mixtral|phi|yi|command-r)/u.test(normalized)) score += 2;
    return score;
  }
}
