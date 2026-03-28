import { buildProviderHttpError, withReasonAwareRetry } from '../retry';

type OpenAICodexGatewayInput = {
  gatewayUrl: string;
  accessToken: string;
  accountId?: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

type OpenAICodexResponsePayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string; output_text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

function extractOutputTextFromPayload(payload: OpenAICodexResponsePayload): string {
  return (
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text' || typeof part.text === 'string' || typeof part.output_text === 'string')
      .map((part) => part.text ?? part.output_text ?? '')
      .join('\n')
      .trim() ??
    ''
  );
}

function extractOutputTextFromSse(raw: string): string {
  const chunks: string[] = [];
  let completed = '';
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) {
      continue;
    }
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') {
      continue;
    }
    try {
      const parsed = JSON.parse(data) as {
        type?: string;
        delta?: string;
        response?: OpenAICodexResponsePayload;
        item?: {
          content?: Array<{ type?: string; text?: string; output_text?: string }>;
        };
      };
      if (parsed.type === 'response.completed' && parsed.response) {
        const text = extractOutputTextFromPayload(parsed.response);
        if (text) {
          completed = text;
        }
        continue;
      }
      if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
        chunks.push(parsed.delta);
        continue;
      }
      if (parsed.item) {
        const text = extractOutputTextFromPayload({
          output: [{ content: parsed.item.content }]
        });
        if (text) {
          chunks.push(text);
        }
      }
    } catch {
      // ignore malformed SSE line
    }
  }
  return (completed || chunks.join('')).trim();
}

export async function generateViaOpenAICodexGateway(input: OpenAICodexGatewayInput): Promise<{
  outputText: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  raw: unknown;
}> {
  const payloadText = await withReasonAwareRetry(
    async () => {
      const response = await fetch(input.gatewayUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${input.accessToken}`,
          'OpenAI-Beta': 'responses=experimental',
          originator: 'codex_cli_rs',
          ...(input.accountId ? { 'chatgpt-account-id': input.accountId } : {})
        },
        body: JSON.stringify({
          model: input.model,
          store: false,
          stream: true,
          instructions: input.systemPrompt?.trim() || 'You are a helpful AI assistant.',
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: input.prompt }]
            }
          ]
        })
      });

      const text = await response.text();
      if (!response.ok) {
        throw buildProviderHttpError({
          provider: 'openai',
          status: response.status,
          statusText: response.statusText,
          bodyText: text,
          retryAfterHeader: response.headers.get('retry-after')
        });
      }
      return text;
    },
    {
      provider: 'openai'
    }
  );

  const trimmed = payloadText.trimStart();
  const payload =
    trimmed.startsWith('{') || trimmed.startsWith('[')
      ? (JSON.parse(payloadText) as OpenAICodexResponsePayload)
      : null;
  const outputText =
    payload ? extractOutputTextFromPayload(payload) : extractOutputTextFromSse(payloadText);

  if (!outputText) {
    throw new Error('openai codex gateway returned empty output');
  }

  return {
    outputText,
    usage: {
      inputTokens: payload?.usage?.input_tokens,
      outputTokens: payload?.usage?.output_tokens
    },
    raw: payload ?? { sse: payloadText }
  };
}
