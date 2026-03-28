import { describe, expect, it, vi } from 'vitest';

import { initializePostgresStore } from '../initializer';

const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_USER_EMAIL = 'jarvis-local@example.com';

describe('initializePostgresStore', () => {
  it('serializes schema initialization through an advisory lock on a dedicated client', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const poolQuery = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({
        query: clientQuery,
        release
      }),
      query: poolQuery
    } as any;

    await initializePostgresStore({
      pool,
      defaultUserId: DEFAULT_USER_ID,
      defaultUserEmail: DEFAULT_USER_EMAIL
    });

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(String(clientQuery.mock.calls[0]?.[0])).toContain('pg_advisory_lock');
    const queries = clientQuery.mock.calls.map(([sql]) => String(sql));
    const createUsersIndex = queries.findIndex((sql) => sql.includes('CREATE TABLE IF NOT EXISTS users'));
    const alterUsersIndex = queries.findIndex((sql) => sql.includes('ALTER TABLE users'));
    const createTasksIndex = queries.findIndex((sql) => sql.includes('CREATE TABLE IF NOT EXISTS tasks'));
    expect(createUsersIndex).toBeGreaterThan(0);
    expect(alterUsersIndex).toBeGreaterThan(createUsersIndex);
    expect(createTasksIndex).toBeGreaterThan(alterUsersIndex);
    expect(String(clientQuery.mock.calls.at(-1)?.[0])).toContain('pg_advisory_unlock');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the advisory lock when initialization fails', async () => {
    const release = vi.fn();
    let callCount = 0;
    const clientQuery = vi.fn().mockImplementation(async (sql: string) => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error('initializer_failure');
      }
      return { rows: [], rowCount: 0, command: sql };
    });
    const pool = {
      connect: vi.fn().mockResolvedValue({
        query: clientQuery,
        release
      }),
      query: vi.fn()
    } as any;

    await expect(
      initializePostgresStore({
        pool,
        defaultUserId: DEFAULT_USER_ID,
        defaultUserEmail: DEFAULT_USER_EMAIL
      })
    ).rejects.toThrow('initializer_failure');

    expect(String(clientQuery.mock.calls[0]?.[0])).toContain('pg_advisory_lock');
    expect(String(clientQuery.mock.calls.at(-1)?.[0])).toContain('pg_advisory_unlock');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
