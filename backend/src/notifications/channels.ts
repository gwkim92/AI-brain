import type { AppEnv } from '../config/env';
import { createTelegramBotClient } from '../integrations/telegram/reporter';
import { redactSecretsInText } from '../lib/redaction';

import type { SystemNotification } from './proactive';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type NotificationChannel = {
  name: string;
  shouldSend?: (notification: SystemNotification) => boolean;
  send: (notification: SystemNotification) => Promise<void>;
};

type NotificationSeverity = SystemNotification['severity'];

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

function severityRank(severity: NotificationSeverity): number {
  if (severity === 'critical') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function parseSeverityThreshold(raw: string | undefined, fallback: NotificationSeverity): NotificationSeverity {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'critical' || normalized === 'warning' || normalized === 'info') {
    return normalized;
  }
  return fallback;
}

function buildChannelPolicy(input: {
  eventTypes: string;
  minSeverity: NotificationSeverity;
}): (notification: SystemNotification) => boolean {
  const eventAllowlist = parseEventAllowlist(input.eventTypes);
  return (notification) => {
    const normalizedType = notification.type.toLowerCase();
    if (eventAllowlist && !eventAllowlist.has(normalizedType)) {
      return false;
    }
    return severityRank(notification.severity) >= severityRank(input.minSeverity);
  };
}

function escapeTelegramMarkdown(value: string): string {
  return value.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
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
  const shouldSend = buildChannelPolicy({
    eventTypes: input.env.NOTIFICATION_WEBHOOK_EVENT_TYPES,
    minSeverity: parseSeverityThreshold(input.env.NOTIFICATION_WEBHOOK_MIN_SEVERITY, 'critical')
  });
  const bearerToken = input.env.NOTIFICATION_WEBHOOK_BEARER_TOKEN?.trim();

  return {
    name: 'webhook',
    shouldSend,
    send: async (notification) => {
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

export function createTelegramNotificationChannel(input: {
  env: AppEnv;
  logger?: LoggerLike;
}): NotificationChannel | null {
  if (!input.env.NOTIFICATION_TELEGRAM_ENABLED) {
    return null;
  }

  const botToken = input.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const chatId = input.env.NOTIFICATION_TELEGRAM_CHAT_ID?.trim() ?? '';
  if (botToken.length === 0 || chatId.length === 0) {
    input.logger?.warn(
      {},
      'telegram notification channel enabled but TELEGRAM_BOT_TOKEN or NOTIFICATION_TELEGRAM_CHAT_ID is missing'
    );
    return null;
  }

  const shouldSend = buildChannelPolicy({
    eventTypes: input.env.NOTIFICATION_TELEGRAM_EVENT_TYPES,
    minSeverity: parseSeverityThreshold(input.env.NOTIFICATION_TELEGRAM_MIN_SEVERITY, 'critical')
  });
  const client = createTelegramBotClient({
    botToken
  });

  return {
    name: 'telegram',
    shouldSend,
    send: async (notification) => {
      const lines = [
        `*${escapeTelegramMarkdown(notification.title)}*`,
        escapeTelegramMarkdown(notification.message)
      ];
      if (notification.actionUrl) {
        lines.push(escapeTelegramMarkdown(`Open: ${notification.actionUrl}`));
      }

      await client.sendMessage({
        chatId,
        text: lines.filter(Boolean).join('\n')
      });
    }
  };
}
