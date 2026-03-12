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

  it('emits low-risk intelligence notification through MCP tool', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const result = await handleMcpStreamRequest(
      {
        origin: 'https://jarvis.local',
        payload: {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'notification_emit',
            arguments: {
              title: 'Intelligence alert',
              message: 'A clustered event crossed the alert threshold.',
              severity: 'warning',
              entity_type: 'intelligence_event',
              entity_id: 'evt_123',
            },
          },
        },
      },
      {
        allowedOrigins: ['https://jarvis.local']
      },
      {
        store: {} as never,
        providerRouter: {} as never,
        userId: '00000000-0000-4000-8000-000000000001',
        notificationService: {
          emit: (notification: Record<string, unknown>) => {
            notifications.push(notification);
          },
        } as never,
      }
    );

    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.response.error).toBeUndefined();
    }
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe('intelligence_event');
    expect(notifications[0]?.title).toBe('Intelligence alert');
  });
});
