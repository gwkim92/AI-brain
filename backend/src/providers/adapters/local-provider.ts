import { ensureOk, joinPath } from '../http';
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

    const model = request.model ?? this.options.model;

    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    if (this.options.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const response = await fetch(joinPath(this.options.baseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        stream: false
      })
    });

    const bodyText = await response.text();
    ensureOk(response, bodyText);

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
}
