import { describe, expect, it } from 'vitest';

import { assertStoreContract } from '../contract-assertions';
import { createMemoryStore } from '../memory-store';
import { createPostgresStore } from '../postgres-store';
import { ALL_STORE_METHOD_KEYS } from '../repository-contracts';
import type { JarvisStore } from '../types';

function methodKeys(store: JarvisStore): string[] {
  return Object.entries(store)
    .filter(([, value]) => typeof value === 'function')
    .map(([key]) => key)
    .sort();
}

describe('store contracts', () => {
  it('memory/postgres expose the same method surface', () => {
    const memory = createMemoryStore('default-user', 'default@example.com');
    const postgres = createPostgresStore({
      connectionString: 'postgres://user:pass@127.0.0.1:5432/jarvis_test',
      defaultUserId: 'default-user',
      defaultUserEmail: 'default@example.com'
    });

    expect(memory.kind).toBe('memory');
    expect(postgres.kind).toBe('postgres');

    const memoryMethods = methodKeys(memory);
    const postgresMethods = methodKeys(postgres);

    expect(memoryMethods).toEqual(postgresMethods);
  });

  it('every contract method key is implemented on both stores', () => {
    const memory = createMemoryStore('default-user', 'default@example.com');
    const postgres = createPostgresStore({
      connectionString: 'postgres://user:pass@127.0.0.1:5432/jarvis_test',
      defaultUserId: 'default-user',
      defaultUserEmail: 'default@example.com'
    });

    for (const key of ALL_STORE_METHOD_KEYS) {
      expect(typeof memory[key]).toBe('function');
      expect(typeof postgres[key]).toBe('function');
    }
  });

  it('assertStoreContract throws when a required method is missing', () => {
    const broken = {
      ...createMemoryStore('default-user', 'default@example.com')
    } as unknown as Record<string, unknown>;
    delete broken.listTasks;

    expect(() => assertStoreContract(broken, 'broken-memory')).toThrow(/missing=\[listTasks\]/);
    expect(() => assertStoreContract(broken, 'broken-memory')).toThrow(/missing_groups=\[task:listTasks\]/);
  });

  it('assertStoreContract throws when a required method is not a function', () => {
    const broken = {
      ...createMemoryStore('default-user', 'default@example.com')
    } as unknown as Record<string, unknown>;
    broken.listTasks = 'not-a-function';

    expect(() => assertStoreContract(broken, 'broken-memory')).toThrow(/non_function=\[listTasks\]/);
    expect(() => assertStoreContract(broken, 'broken-memory')).toThrow(/non_function_groups=\[task:listTasks\]/);
  });
});
