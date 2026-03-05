import { buildProviderHttpError, withReasonAwareRetry } from '../retry';

type GeminiCodeAssistGatewayInput = {
  gatewayUrl: string;
  accessToken: string;
  projectId?: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  context?: Record<string, unknown>;
};

export async function generateViaGeminiCodeAssistGateway(input: GeminiCodeAssistGatewayInput): Promise<{
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
          ...(input.projectId ? { 'x-goog-user-project': input.projectId } : {})
        },
        body: JSON.stringify({
          model: input.model,
          context: input.context ?? undefined,
          systemInstruction: input.systemPrompt
            ? {
                role: 'system',
                parts: [{ text: input.systemPrompt }]
              }
            : undefined,
          contents: [
            {
              role: 'user',
              parts: [{ text: input.prompt }]
            }
          ],
          generationConfig: {
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens
          }
        })
      });

      const text = await response.text();
      if (!response.ok) {
        throw buildProviderHttpError({
          provider: 'gemini',
          status: response.status,
          statusText: response.statusText,
          bodyText: text,
          retryAfterHeader: response.headers.get('retry-after')
        });
      }
      return text;
    },
    {
      provider: 'gemini'
    }
  );

  const payload = JSON.parse(payloadText) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
    output?: string;
    outputText?: string;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
    };
  };

  const outputText =
    payload.outputText?.trim() ||
    payload.output?.trim() ||
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('\n')
      .trim() ||
    '';

  if (!outputText) {
    throw new Error('gemini codeassist gateway returned empty output');
  }

  return {
    outputText,
    usage: {
      inputTokens: payload.usageMetadata?.promptTokenCount ?? payload.usage?.inputTokens,
      outputTokens: payload.usageMetadata?.candidatesTokenCount ?? payload.usage?.outputTokens
    },
    raw: payload
  };
}
