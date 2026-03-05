import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateViaOpenAICodexGateway } from '../transports/openai-codex-gateway';

describe('generateViaOpenAICodexGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls codex gateway with chatgpt-compatible headers and payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: 'gateway ok',
          usage: {
            input_tokens: 11,
            output_tokens: 22
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateViaOpenAICodexGateway({
      gatewayUrl: 'https://chatgpt.com/backend-api/codex/responses',
      accessToken: 'oauth-token',
      accountId: 'acct_123',
      model: 'gpt-5',
      prompt: 'hello',
      systemPrompt: 'system'
    });

    expect(result.outputText).toBe('gateway ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer oauth-token');
    expect(headers['OpenAI-Beta']).toBe('responses=experimental');
    expect(headers.originator).toBe('codex_cli_rs');
    expect(headers['chatgpt-account-id']).toBe('acct_123');

    const body = JSON.parse(String(init.body)) as {
      model: string;
      store: boolean;
      stream: boolean;
      instructions: string;
      input: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
    };
    expect(body.model).toBe('gpt-5');
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.instructions).toBe('system');
    expect(body.input[0]?.role).toBe('user');
    expect(body.input[0]?.content[0]).toEqual({ type: 'input_text', text: 'hello' });
  });

  it('parses SSE style codex responses', async () => {
    const sseBody = [
      'event: message',
      'data: {"type":"response.output_text.delta","delta":"hello "}',
      '',
      'event: message',
      'data: {"type":"response.output_text.delta","delta":"world"}',
      '',
      'data: [DONE]',
      ''
    ].join('\n');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sseBody, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream'
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateViaOpenAICodexGateway({
      gatewayUrl: 'https://chatgpt.com/backend-api/codex/responses',
      accessToken: 'oauth-token',
      model: 'gpt-5',
      prompt: 'hello'
    });

    expect(result.outputText).toBe('hello world');
  });
});
