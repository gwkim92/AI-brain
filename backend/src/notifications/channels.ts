import type { AppEnv } from '../config/env';
import { redactSecretsInText } from '../lib/redaction';

import type { SystemNotification } from './proactive';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type NotificationChannel = {
  name: string;
  send: (notification: SystemNotification) => Promise<void>;
};

function parseEventAllowlist(raw: string): Set<string> | null {
  const values = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0 || values.includes('*')) {
    return null;
  }
  return new Set(values);
}

function withTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return controller.signal;
}

export function createWebhookNotificationChannel(input: {
  env: AppEnv;
  logger?: LoggerLike;
}): NotificationChannel | null {
  if (!input.env.NOTIFICATION_WEBHOOK_ENABLED) {
    return null;
  }

  const webhookUrl = input.env.NOTIFICATION_WEBHOOK_URL?.trim() ?? '';
  if (webhookUrl.length === 0) {
    input.logger?.warn({}, 'notification webhook enabled but NOTIFICATION_WEBHOOK_URL is missing');
    return null;
  }

  const timeoutMs = Math.max(250, input.env.NOTIFICATION_WEBHOOK_TIMEOUT_MS);
  const eventAllowlist = parseEventAllowlist(input.env.NOTIFICATION_WEBHOOK_EVENT_TYPES);
  const bearerToken = input.env.NOTIFICATION_WEBHOOK_BEARER_TOKEN?.trim();

  return {
    name: 'webhook',
    send: async (notification) => {
      const normalizedType = notification.type.toLowerCase();
      if (eventAllowlist && !eventAllowlist.has(normalizedType)) {
        return;
      }

      const headers: Record<string, string> = {
        'content-type': 'application/json'
      };
      if (bearerToken) {
        headers.authorization = `Bearer ${bearerToken}`;
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          event: notification.type,
          sent_at: new Date().toISOString(),
          notification
        }),
        signal: withTimeoutSignal(timeoutMs)
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          redactSecretsInText(
            `webhook delivery failed: status=${response.status} body=${text.slice(0, 160)}`
          )
        );
      }
    }
  };
}
