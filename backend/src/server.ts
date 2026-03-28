import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { hashPassword } from './auth/crypto';
import { loadEnv } from './config/env';
import { startJarvisWatcherWorker } from './jarvis/watcher-worker';
import { startTelegramDeliveryWorker } from './integrations/telegram/delivery-worker';
import { sendError } from './lib/http';
import { createProviderRouter } from './providers';
import { createProviderHealthFlushInterval, loadProviderRoutingHealth } from './providers/health-persistence';
import { startOauthCallbackBridge } from './providers/oauth-callback-bridge';
import { syncModelRegistry, createRegistryRefreshInterval } from './providers/model-registry';
import { loadProviderStats } from './providers/stats-persistence';
import { seedDefaultPolicies, loadPoliciesIntoCache } from './providers/task-model-policy';
import { startProviderTokenRefreshWorker } from './providers/token-refresh-worker';
import { createTelegramNotificationChannel, createWebhookNotificationChannel } from './notifications/channels';
import { createNotificationService } from './notifications/proactive';
import { startAiTraceCleanupWorker } from './observability/ai-trace-worker';
import { startIntelligenceCatalogSyncWorker } from './intelligence/catalog-sync-worker';
import { startIntelligenceScannerWorker } from './intelligence/scanner-worker';
import { startIntelligenceSemanticWorker } from './intelligence/semantic-worker';
import { startIntelligenceStaleMaintenanceWorker } from './intelligence/stale-maintenance-worker';
import { hydrateAppliedHyperAgentOverrides } from './hyperagent/runtime';
import { startRadarScannerWorker } from './radar/scanner-worker';
import { registerRoutes } from './routes';
import { createStore } from './store';
import { getSharedMemoryV2Repository } from './store/memory/v2-repositories';
import { createPostgresV2Repository } from './store/postgres/v2-repositories';
import type { JarvisStore } from './store/types';
import { startWorldModelOutcomeWorker } from './world-model/outcome-worker';
import { getWorkspaceRuntimeManager } from './workspaces/runtime-manager';

type RawBodyFastifyRequest = {
  rawBody?: string;
};

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
    // Optional local .env file may be absent in some environments.
  }
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(moduleDir, '..');
tryLoadEnvFile(path.join(backendRoot, '.env'));
if (process.cwd() !== backendRoot) {
  tryLoadEnvFile(path.join(process.cwd(), '.env'));
}

async function ensureBootstrapAdmin(store: JarvisStore, env: ReturnType<typeof loadEnv>): Promise<void> {
  const email = env.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase();
  const password = env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    return;
  }

  await store.upsertAuthUserByEmail({
    email,
    displayName: env.ADMIN_BOOTSTRAP_DISPLAY_NAME,
    passwordHash: hashPassword(password),
    role: 'admin'
  });
}

export async function buildServer() {
  const env = loadEnv();
  const store = await createStore(env);
  await ensureBootstrapAdmin(store, env);
  const v2Repo = store.getPool() ? createPostgresV2Repository(store.getPool()!) : getSharedMemoryV2Repository();
  await hydrateAppliedHyperAgentOverrides(v2Repo);
  const providerRouter = createProviderRouter(env);

  const loggerConfig = env.NODE_ENV === 'development'
    ? {
        level: 'info',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.authorization',
            '*.api_key',
            '*.apiKey',
            '*.token',
            '*.access_token',
            '*.refresh_token',
            '*.encrypted_payload',
            '*.encryptedApiKey',
            '*.encryptedPayload',
            '*.secret',
            '*.client_secret'
          ],
          censor: '[REDACTED]'
        }
      }
    : false;

  const app = Fastify({
    logger: loggerConfig
  });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : String(body ?? '');
    (request as unknown as RawBodyFastifyRequest).rawBody = raw;

    if (raw.length === 0) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(raw));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  await app.register(cors, {
    origin: env.allowedOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-user-role',
      'x-user-id',
      'idempotency-key',
      'x-trace-id'
    ]
  });

  await app.register(rateLimit, {
    max: env.API_RATE_LIMIT_MAX,
    timeWindow: `${env.API_RATE_LIMIT_WINDOW_SEC} second`
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'validation failed', error.flatten());
    }

    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const message = error instanceof Error ? error.message : 'unknown error';

    return sendError(
      reply,
      request,
      statusCode,
      statusCode >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR',
      statusCode >= 500 ? 'internal server error' : message
    );
  });

  const pool = store.getPool();
  if (pool) {
    try {
      const stats = await loadProviderStats(pool);
      if (stats.length > 0) {
        providerRouter.loadRuntimeStats(stats);
      }
      const health = await loadProviderRoutingHealth(pool);
      if (health.length > 0) {
        providerRouter.loadHealthStates(health);
      }
      await syncModelRegistry(pool, env);
      await seedDefaultPolicies(pool, env);
      await loadPoliciesIntoCache(pool);
      providerRouter.enablePolicyRouting();
      providerRouter.setExplorationRate(env.ROUTING_EXPLORATION_RATE);
    } catch (err) {
      app.log.warn({ err }, 'model registry / policy init skipped');
    }
  }

  const notificationChannels = [];
  const webhookChannel = createWebhookNotificationChannel({
    env,
    logger: app.log
  });
  if (webhookChannel) {
    notificationChannels.push(webhookChannel);
  }
  const telegramChannel = createTelegramNotificationChannel({
    env,
    logger: app.log
  });
  if (telegramChannel) {
    notificationChannels.push(telegramChannel);
  }

  const notificationService = createNotificationService({
    channels: notificationChannels,
    logger: app.log
  });
  await registerRoutes(app, store, env, providerRouter, notificationService);
  const workspaceRuntimeManager = getWorkspaceRuntimeManager();
  app.addHook('onClose', async () => {
    await workspaceRuntimeManager.shutdownAll();
  });

  const oauthCallbackBridge = await startOauthCallbackBridge({
    env,
    logger: app.log
  });
  if (oauthCallbackBridge) {
    app.addHook('onClose', async () => {
      await oauthCallbackBridge.stop();
    });
  }

  if (pool) {
    const registryRefresh = createRegistryRefreshInterval(pool, env, env.MODEL_REGISTRY_REFRESH_MS);
    const providerHealthFlush = createProviderHealthFlushInterval(pool, () => providerRouter.listProviderHealthStates());
    app.addHook('onClose', async () => {
      registryRefresh.stop();
      providerHealthFlush.stop();
    });
  }

  const telegramDeliveryWorker = startTelegramDeliveryWorker({
    store,
    env,
    onError: (error) => {
      app.log.error({ error }, 'telegram delivery worker tick failed');
    }
  });
  app.addHook('onClose', async () => {
    telegramDeliveryWorker.stop();
  });

  const providerTokenRefreshWorker = startProviderTokenRefreshWorker({
    store,
    env,
    logger: app.log
  });
  app.addHook('onClose', async () => {
    providerTokenRefreshWorker.stop();
  });

  const aiTraceCleanupWorker = startAiTraceCleanupWorker({
    store,
    env,
    logger: app.log
  });
  app.addHook('onClose', async () => {
    aiTraceCleanupWorker.stop();
  });

  const jarvisWatcherWorker = startJarvisWatcherWorker({
    store,
    env,
    notificationService,
    logger: app.log
  });
  app.addHook('onClose', async () => {
    jarvisWatcherWorker.stop();
  });

  const radarScannerWorker = startRadarScannerWorker({
    store,
    env,
    notificationService,
    logger: app.log,
  });
  app.addHook('onClose', async () => {
    radarScannerWorker.stop();
  });

  const intelligenceScannerWorker = startIntelligenceScannerWorker({
    store,
    env,
    providerRouter,
    notificationService,
    logger: app.log,
  });
  app.addHook('onClose', async () => {
    intelligenceScannerWorker.stop();
  });

  const intelligenceSemanticWorker = startIntelligenceSemanticWorker({
    store,
    env,
    providerRouter,
    notificationService,
    logger: app.log,
  });
  app.addHook('onClose', async () => {
    intelligenceSemanticWorker.stop();
  });

  const intelligenceStaleMaintenanceWorker = startIntelligenceStaleMaintenanceWorker({
    store,
    env,
    providerRouter,
    notificationService,
    logger: app.log,
  });
  app.addHook('onClose', async () => {
    intelligenceStaleMaintenanceWorker.stop();
  });

  const intelligenceCatalogSyncWorker = startIntelligenceCatalogSyncWorker({
    store,
    env,
    providerRouter,
    logger: app.log,
  });
  app.addHook('onClose', async () => {
    intelligenceCatalogSyncWorker.stop();
  });

  const worldModelOutcomeWorker = startWorldModelOutcomeWorker({
    store,
    env,
    logger: app.log
  });
  app.addHook('onClose', async () => {
    worldModelOutcomeWorker.stop();
  });

  return {
    app,
    env,
    store,
    providerRouter,
  };
}

async function start() {
  const { app, env } = await buildServer();
  await app.listen({
    host: env.HOST,
    port: env.PORT
  });
}

const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMainModule) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
