import { ensureOk, joinPath } from '../http';
import type {
  LlmProvider,
  ProviderAvailability,
  ProviderGenerateRequest,
  ProviderGenerateResult
} from '../types';

type OpenAIProviderOptions = {
  apiKey?: string;
  baseUrl: string;
  model: string;
};

export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai' as const;

  constructor(private readonly options: OpenAIProviderOptions) {}

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
      throw new Error('openai provider is disabled: missing api key');
    }

    const model = request.model ?? this.options.model;

    const input: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (request.systemPrompt) {
      input.push({
        role: 'system',
        content: request.systemPrompt
      });
    }
    input.push({
      role: 'user',
      content: request.prompt
    });

    const response = await fetch(joinPath(this.options.baseUrl, '/responses'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify({
        model,
        input,
        temperature: request.temperature,
        max_output_tokens: request.maxOutputTokens
      })
    });

    const bodyText = await response.text();
    ensureOk(response, bodyText);

    const payload = JSON.parse(bodyText) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    const outputText =
      payload.output_text ??
      payload.output
        ?.flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text' || typeof part.text === 'string')
        .map((part) => part.text ?? '')
        .join('\n') ??
      '';

    if (!outputText) {
      throw new Error('openai provider returned empty output');
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
