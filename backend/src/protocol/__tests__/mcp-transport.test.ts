import { describe, expect, it } from 'vitest';

import { handleMcpStreamRequest } from '../mcp-transport';

describe('handleMcpStreamRequest', () => {
  it('rejects request when origin is not allowlisted', async () => {
    const result = await handleMcpStreamRequest(
      {
        origin: 'https://evil.example.com',
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
      },
      {
        allowedOrigins: ['https://jarvis.local']
      }
    );

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe('origin_not_allowed');
    }
  });

  it('accepts request when origin is allowlisted', async () => {
    const result = await handleMcpStreamRequest(
      {
        origin: 'https://jarvis.local',
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
      },
      {
        allowedOrigins: ['https://jarvis.local']
      }
    );

    expect(result.accepted).toBe(true);
  });
});
