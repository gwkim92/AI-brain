import { ensureOk, joinPath } from '../http';
import { withReasonAwareRetry } from '../retry';
import { generateViaOpenAICodexGateway } from '../transports/openai-codex-gateway';
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
  gatewayUrl: string;
};

function extractChatgptAccountId(token: string | undefined): string | undefined {
  if (!token || !token.includes('.')) {
    return undefined;
  }
  try {
    const [, payloadPart] = token.split('.');
    if (!payloadPart) {
      return undefined;
    }
    const padded = payloadPart.padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const raw = Buffer.from(padded, 'base64url').toString('utf8');
    const claims = JSON.parse(raw) as Record<string, unknown>;
    const accountId =
      typeof claims['https://api.openai.com/auth.chatgpt_account_id'] === 'string'
        ? claims['https://api.openai.com/auth.chatgpt_account_id']
        : typeof claims.chatgpt_account_id === 'string'
          ? claims.chatgpt_account_id
          : '';
    const normalized = accountId.trim();
    return normalized.length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

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
    const scopedCredential = request.credentialsByProvider?.openai;
    const hasScopedCredential = Boolean(scopedCredential && scopedCredential.source !== 'none');
    const selectedMode = scopedCredential?.selectedCredentialMode;
    const shouldUseOauthTransport = hasScopedCredential && selectedMode === 'oauth_official';
    const runtimeAccessToken = hasScopedCredential
      ? scopedCredential?.selectedCredentialMode === 'oauth_official'
        ? scopedCredential.oauthAccessToken
        : scopedCredential?.selectedCredentialMode === 'api_key'
          ? scopedCredential.apiKey
          : undefined
      : this.options.apiKey;

    if (!runtimeAccessToken) {
      throw new Error('openai provider is disabled: missing api key');
    }

    const model = request.model ?? this.options.model;

    if (shouldUseOauthTransport) {
      const gatewayResult = await generateViaOpenAICodexGateway({
        gatewayUrl: this.options.gatewayUrl,
        accessToken: runtimeAccessToken,
        accountId: extractChatgptAccountId(runtimeAccessToken),
        model,
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens
      });

      return {
        provider: this.name,
        model,
        outputText: gatewayResult.outputText,
        usage: gatewayResult.usage,
        raw: gatewayResult.raw
      };
    }

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

    const bodyText = await withReasonAwareRetry(
      async () => {
        const response = await fetch(joinPath(this.options.baseUrl, '/responses'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${runtimeAccessToken}`
          },
          body: JSON.stringify({
            model,
            input,
            temperature: request.temperature,
            max_output_tokens: request.maxOutputTokens
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
