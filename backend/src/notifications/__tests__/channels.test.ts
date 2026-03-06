import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../config/env';
import { createTelegramNotificationChannel, createWebhookNotificationChannel } from '../channels';

describe('notification channels', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('applies webhook severity threshold and event allowlist before delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => ''
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.NOTIFICATION_WEBHOOK_ENABLED = 'true';
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://example.com/hooks/jarvis';
    process.env.NOTIFICATION_WEBHOOK_EVENT_TYPES = 'action_proposal_ready,briefing_ready';
    process.env.NOTIFICATION_WEBHOOK_MIN_SEVERITY = 'warning';

    const channel = createWebhookNotificationChannel({ env: loadEnv() });

    expect(channel?.shouldSend?.({
      id: 'n-1',
      type: 'watcher_hit',
      title: 'Watcher',
      message: 'ignore me',
      severity: 'critical',
      createdAt: new Date().toISOString()
    })).toBe(false);
    expect(channel?.shouldSend?.({
      id: 'n-2',
      type: 'briefing_ready',
      title: 'Briefing',
      message: 'deliver me',
      severity: 'warning',
      createdAt: new Date().toISOString()
    })).toBe(true);

    await channel?.send({
      id: 'n-2',
      type: 'briefing_ready',
      title: 'Briefing',
      message: 'deliver me',
      severity: 'warning',
      createdAt: new Date().toISOString()
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies telegram severity threshold and formats markdown-safe messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, result: { message_id: 42 } })
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.TELEGRAM_BOT_TOKEN = '1234567890:test-token';
    process.env.NOTIFICATION_TELEGRAM_ENABLED = 'true';
    process.env.NOTIFICATION_TELEGRAM_CHAT_ID = 'jarvis-room';
    process.env.NOTIFICATION_TELEGRAM_MIN_SEVERITY = 'critical';

    const channel = createTelegramNotificationChannel({ env: loadEnv() });

    expect(channel?.shouldSend?.({
      id: 'n-3',
      type: 'action_proposal_ready',
      title: 'Approve [build]',
      message: 'safe?',
      severity: 'warning',
      createdAt: new Date().toISOString()
    })).toBe(false);
    expect(channel?.shouldSend?.({
      id: 'n-4',
      type: 'session_stalled',
      title: 'Session [blocked]',
      message: 'Needs review (now).',
      severity: 'critical',
      actionUrl: '/?widget=action-center',
      createdAt: new Date().toISOString()
    })).toBe(true);

    await channel?.send({
      id: 'n-4',
      type: 'session_stalled',
      title: 'Session [blocked]',
      message: 'Needs review (now).',
      severity: 'critical',
      actionUrl: '/?widget=action-center',
      createdAt: new Date().toISOString()
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(request.body)) as { text: string };
    expect(payload.text).toContain('Session \\[blocked\\]');
    expect(payload.text).toContain('Needs review \\(now\\)\\.');
  });
});
