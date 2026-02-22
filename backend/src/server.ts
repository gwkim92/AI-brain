import { pathToFileURL } from 'node:url';

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { loadEnv } from './config/env';
import { sendError } from './lib/http';
import { createProviderRouter } from './providers';
import { registerRoutes } from './routes';
import { createStore } from './store';

export async function buildServer() {
  const env = loadEnv();
  const store = await createStore(env);
  const providerRouter = createProviderRouter(env);

  const app = Fastify({
    logger: env.NODE_ENV === 'development'
  });

  await app.register(cors, {
    origin: env.allowedOrigins,
    credentials: true
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

  await registerRoutes(app, store, env, providerRouter);

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
