import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { loadEnv } from '../src/config/env';
import { initializePostgresStore } from '../src/store/postgres/initializer';

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

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDir, '..');
  tryLoadEnvFile(path.join(backendRoot, '.env'));
  if (process.cwd() !== backendRoot) {
    tryLoadEnvFile(path.join(process.cwd(), '.env'));
  }

  const env = loadEnv();
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    await initializePostgresStore({
      pool,
      defaultUserId: env.DEFAULT_USER_ID,
      defaultUserEmail: env.DEFAULT_USER_EMAIL,
    });
    console.log('[db:init] initializer schema applied successfully');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[db:init] failed', error);
  process.exit(1);
});
