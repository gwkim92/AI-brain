import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalProvider } from '../adapters/local-provider';

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

describe('LocalProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back across multiple discovered local models when configured model is missing', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/api/tags')) {
        return createJsonResponse({
          models: [{ name: 'nomic-embed-text:latest' }, { name: 'qwen2.5:7b' }]
        });
      }

      if (url.endsWith('/v1/chat/completions')) {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
        if (payload.model === 'llama3.1:8b') {
          return createJsonResponse({ error: "model 'llama3.1:8b' not found" }, 404);
        }
        if (payload.model === 'nomic-embed-text:latest') {
          return createJsonResponse({ error: "model 'nomic-embed-text:latest' does not support chat" }, 400);
        }
        if (payload.model === 'qwen2.5:7b') {
          return createJsonResponse({
            choices: [{ message: { content: 'fallback success' } }],
            usage: { prompt_tokens: 11, completion_tokens: 7 }
          });
        }
      }

      return createJsonResponse({ error: 'unexpected local provider request' }, 500);
    });

    vi.stubGlobal('fetch', fetchMock);

    const provider = new LocalProvider({
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });

    const result = await provider.generate({
      prompt: 'hello world'
    });

    expect(result.provider).toBe('local');
    expect(result.model).toBe('qwen2.5:7b');
    expect(result.outputText).toBe('fallback success');
    expect((result.raw as Record<string, unknown>).fallback_from_model).toBe('llama3.1:8b');

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    const chatModels = fetchMock.mock.calls
      .filter((call) => String(call[0]).endsWith('/v1/chat/completions'))
      .map((call) => {
        const requestInit = (call[1] ?? {}) as RequestInit;
        const payload = JSON.parse(String(requestInit.body ?? '{}')) as { model?: string };
        return payload.model;
      });

    expect(calledUrls.some((url) => url.endsWith('/api/tags'))).toBe(true);
    expect(chatModels[0]).toBe('llama3.1:8b');
    expect(chatModels.at(-1)).toBe('qwen2.5:7b');
    expect(chatModels.length).toBeGreaterThanOrEqual(2);
  });

  it('does not fallback when model is explicitly requested by caller', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ error: "model 'unknown:model' not found" }, 404));

    vi.stubGlobal('fetch', fetchMock);

    const provider = new LocalProvider({
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:7b'
    });

    await expect(
      provider.generate({
        prompt: 'hello world',
        model: 'unknown:model'
      })
    ).rejects.toThrow(/not found/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
