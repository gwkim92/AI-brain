import { joinPath, stripTrailingSlash } from '../http';
import { buildProviderHttpError, withReasonAwareRetry } from '../retry';
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
    const scopedCredential = request.credentialsByProvider?.gemini;
    const hasScopedCredential = Boolean(scopedCredential && scopedCredential.source !== 'none');
    const runtimeApiKey = hasScopedCredential
      ? scopedCredential?.selectedCredentialMode === 'api_key'
        ? scopedCredential.apiKey
        : undefined
      : this.options.apiKey;
    const runtimeAccessToken = hasScopedCredential
      ? scopedCredential?.selectedCredentialMode === 'oauth_official'
        ? scopedCredential.oauthAccessToken
        : undefined
      : undefined;

    if (!runtimeApiKey && !runtimeAccessToken) {
      throw new Error('gemini provider is disabled: missing api key');
    }

    const model = request.model ?? this.options.model;

    const endpointBase = joinPath(stripTrailingSlash(this.options.baseUrl), `/v1beta/models/${model}:generateContent`);
    const endpoint = runtimeApiKey ? `${endpointBase}?key=${encodeURIComponent(runtimeApiKey)}` : endpointBase;

    const bodyText = await withReasonAwareRetry(
      async () => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(runtimeAccessToken ? { authorization: `Bearer ${runtimeAccessToken}` } : {})
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

        const text = await response.text();
        if (!response.ok) {
          throw buildProviderHttpError({
            provider: this.name,
            status: response.status,
            statusText: response.statusText,
            bodyText: text,
            retryAfterHeader: response.headers.get('retry-after')
          });
        }
        return text;
      },
      {
        provider: this.name
      }
    );

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
