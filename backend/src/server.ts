import { pathToFileURL } from 'node:url';

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { hashPassword } from './auth/crypto';
import { loadEnv } from './config/env';
import { startTelegramDeliveryWorker } from './integrations/telegram/delivery-worker';
import { sendError } from './lib/http';
import { createProviderRouter } from './providers';
import { syncModelRegistry, createRegistryRefreshInterval } from './providers/model-registry';
import { loadProviderStats } from './providers/stats-persistence';
import { seedDefaultPolicies, loadPoliciesIntoCache } from './providers/task-model-policy';
import { createNotificationService } from './notifications/proactive';
import { registerRoutes } from './routes';
import { createStore } from './store';
import type { JarvisStore } from './store/types';

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
  const providerRouter = createProviderRouter(env);

  const app = Fastify({
    logger: env.NODE_ENV === 'development'
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
      await syncModelRegistry(pool, env);
      await seedDefaultPolicies(pool, env);
      await loadPoliciesIntoCache(pool);
      providerRouter.enablePolicyRouting();
      providerRouter.setExplorationRate(env.ROUTING_EXPLORATION_RATE);
    } catch (err) {
      app.log.warn({ err }, 'model registry / policy init skipped');
    }
  }

  const notificationService = createNotificationService();
  await registerRoutes(app, store, env, providerRouter, notificationService);

  if (pool) {
    const registryRefresh = createRegistryRefreshInterval(pool, env, env.MODEL_REGISTRY_REFRESH_MS);
    app.addHook('onClose', async () => {
      registryRefresh.stop();
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

  return {
    app,
    env
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
