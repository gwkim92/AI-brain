import type { AppEnv } from '../config/env';
import type { JarvisStore } from './types';
import { createMemoryStore } from './memory-store';
import { createPostgresStore } from './postgres-store';

export async function createStore(env: AppEnv): Promise<JarvisStore> {
  const shouldUsePostgres =
    env.STORE_BACKEND === 'postgres' || (env.STORE_BACKEND === 'auto' && Boolean(env.DATABASE_URL));

  if (shouldUsePostgres && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when STORE_BACKEND resolves to postgres');
  }

  const store = shouldUsePostgres
    ? createPostgresStore({
        connectionString: env.DATABASE_URL as string,
        defaultUserId: env.DEFAULT_USER_ID,
        defaultUserEmail: env.DEFAULT_USER_EMAIL
      })
    : createMemoryStore(env.DEFAULT_USER_ID, env.DEFAULT_USER_EMAIL);

  await store.initialize();
  return store;
}
