import { joinPath, stripTrailingSlash } from '../http';
import type {
  LlmProvider,
  ProviderAvailability,
  ProviderGenerateRequest,
  ProviderGenerateResult
} from '../types';

type GeminiProviderOptions = {
  apiKey?: string;
  baseUrl: string;
  model: string;
};

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;

  constructor(private readonly options: GeminiProviderOptions) {}

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
      throw new Error('gemini provider is disabled: missing api key');
    }

    const model = request.model ?? this.options.model;

    const endpoint = `${joinPath(stripTrailingSlash(this.options.baseUrl), `/v1beta/models/${model}:generateContent`)}?key=${encodeURIComponent(this.options.apiKey)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: request.systemPrompt
          ? {
              role: 'system',
              parts: [{ text: request.systemPrompt }]
            }
          : undefined,
        contents: [
          {
            role: 'user',
            parts: [{ text: request.prompt }]
          }
        ],
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens
        }
      })
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`gemini provider http ${response.status}: ${bodyText.slice(0, 400)}`);
    }

    const payload = JSON.parse(bodyText) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };

    const outputText =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('\n')
        .trim() ?? '';

    if (!outputText) {
      throw new Error('gemini provider returned empty output');
    }

    return {
      provider: this.name,
      model,
      outputText,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount,
        outputTokens: payload.usageMetadata?.candidatesTokenCount
      },
      raw: payload
    };
  }
}
