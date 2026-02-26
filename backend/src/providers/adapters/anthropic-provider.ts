import { ensureOk, joinPath } from '../http';
import type {
  LlmProvider,
  ProviderAvailability,
  ProviderGenerateRequest,
  ProviderGenerateResult
} from '../types';

type AnthropicProviderOptions = {
  apiKey?: string;
  baseUrl: string;
  model: string;
};

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;

  constructor(private readonly options: AnthropicProviderOptions) {}

  setApiKey(apiKey?: string): void {
    this.options.apiKey = apiKey;
  }

  availability(): ProviderAvailability {
    if (!this.options.apiKey) {
      return {
        provider: this.name,
        enabled: false,
        model: this.options.model,
        reason: 'missing_api_key'
      };
    }

    return {
      provider: this.name,
      enabled: true,
      model: this.options.model
    };
  }

  async generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    if (!this.options.apiKey) {
      throw new Error('anthropic provider is disabled: missing api key');
    }

    const model = request.model ?? this.options.model;

    const response = await fetch(joinPath(this.options.baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        system: request.systemPrompt,
        max_tokens: request.maxOutputTokens ?? 1024,
        temperature: request.temperature,
        messages: [
          {
            role: 'user',
            content: request.prompt
          }
        ]
      })
    });

    const bodyText = await response.text();
    ensureOk(response, bodyText);

    const payload = JSON.parse(bodyText) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    const outputText =
      payload.content
        ?.filter((item) => item.type === 'text')
        .map((item) => item.text ?? '')
        .join('\n')
        .trim() ?? '';

    if (!outputText) {
      throw new Error('anthropic provider returned empty output');
    }

    return {
      provider: this.name,
      model,
      outputText,
      usage: {
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens
      },
      raw: payload
    };
  }
}
