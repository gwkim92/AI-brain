import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { access } from 'node:fs/promises';

import { Client } from 'pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const schemaPath = await resolveSchemaPath();
  const sql = await readFile(schemaPath, 'utf8');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(sql);
    console.log('[db:init] schema applied successfully');
  } finally {
    await client.end();
  }
}

async function resolveSchemaPath(): Promise<string> {
  const candidates = [
    process.env.DB_SCHEMA_PATH,
    path.resolve(process.cwd(), 'db-schema-v1.sql'),
    path.resolve(process.cwd(), '../docs/db-schema-v1.sql')
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  throw new Error('Could not locate db schema file. Set DB_SCHEMA_PATH explicitly.');
}

main().catch((error) => {
  console.error('[db:init] failed', error);
  process.exit(1);
});
