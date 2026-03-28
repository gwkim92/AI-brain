import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from '../config/env';
import {
  createTelegramNotificationChannel,
  createWebhookNotificationChannel,
  type NotificationChannel
} from '../notifications/channels';
import { createNotificationService } from '../notifications/proactive';
import { createStore } from '../store';
import { DeliveryRunnerService } from './service';

function tryLoadEnvFile(filePath: string): void {
  if (typeof process.loadEnvFile !== 'function') {
    return;
  }
  if (!existsSync(filePath)) {
    return;
  }
  try {
    process.loadEnvFile(filePath);
  } catch {
    // local env files are optional
  }
}

function createServiceLogger() {
  return {
    info: (message: string, data?: Record<string, unknown>) => console.info(message, data ?? {}),
    warn: (message: string, data?: Record<string, unknown>) => console.warn(message, data ?? {}),
    error: (message: string, data?: Record<string, unknown>) => console.error(message, data ?? {})
  };
}

function createNotificationLogger() {
  return {
    info: (obj: Record<string, unknown>, msg?: string) => console.info(msg ?? 'runner notification', obj),
    warn: (obj: Record<string, unknown>, msg?: string) => console.warn(msg ?? 'runner notification', obj),
    error: (obj: Record<string, unknown>, msg?: string) => console.error(msg ?? 'runner notification', obj)
  };
}

async function main() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(moduleDir, '../..');
  tryLoadEnvFile(path.join(backendRoot, '.env'));
  if (process.cwd() !== backendRoot) {
    tryLoadEnvFile(path.join(process.cwd(), '.env'));
  }

  const env = loadEnv();
  const store = await createStore(env);
  const serviceLogger = createServiceLogger();
  const notificationLogger = createNotificationLogger();
  const notificationChannels: NotificationChannel[] = [];
  const webhookChannel = createWebhookNotificationChannel({
    env,
    logger: notificationLogger
  });
  if (webhookChannel) {
    notificationChannels.push(webhookChannel);
  }
  const telegramChannel = createTelegramNotificationChannel({
    env,
    logger: notificationLogger
  });
  if (telegramChannel) {
    notificationChannels.push(telegramChannel);
  }
  const notificationService = createNotificationService({
    channels: notificationChannels,
    logger: notificationLogger
  });
  const service = new DeliveryRunnerService(store, env, notificationService, serviceLogger);

  service.start();
  const shutdown = () => {
    service.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
