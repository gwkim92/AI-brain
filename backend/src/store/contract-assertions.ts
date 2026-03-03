import type { JarvisStore } from './types';
import { ALL_STORE_METHOD_KEYS, STORE_METHOD_KEY_GROUPS } from './repository-contracts';

type ProcessEnvLike = Record<string, string | undefined>;

const STORE_METHOD_GROUP_ENTRIES = Object.entries(STORE_METHOD_KEY_GROUPS) as Array<
  [string, readonly (keyof JarvisStore)[]]
>;

function formatGroupDetails(keys: string[]): string {
  const grouped = new Map<string, Set<string>>();

  for (const key of keys) {
    const matchedGroups = STORE_METHOD_GROUP_ENTRIES.filter(([, groupKeys]) =>
      groupKeys.includes(key as keyof JarvisStore)
    ).map(([group]) => group);

    if (matchedGroups.length === 0) {
      const unknown = grouped.get('unknown') ?? new Set<string>();
      unknown.add(key);
      grouped.set('unknown', unknown);
      continue;
    }

    for (const group of matchedGroups) {
      const bucket = grouped.get(group) ?? new Set<string>();
      bucket.add(key);
      grouped.set(group, bucket);
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, groupKeys]) => `${group}:${[...groupKeys].sort().join(',')}`)
    .join(' | ');
}

export function assertStoreContract(
  store: Record<string, unknown>,
  storeName: string,
  methodKeys: readonly (keyof JarvisStore)[] = ALL_STORE_METHOD_KEYS
): void {
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const key of methodKeys) {
    const value = store[key as string];
    if (typeof value === 'undefined') {
      missing.push(String(key));
      continue;
    }
    if (typeof value !== 'function') {
      invalid.push(String(key));
    }
  }

  if (missing.length === 0 && invalid.length === 0) {
    return;
  }

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing=[${missing.join(', ')}]`);
    parts.push(`missing_groups=[${formatGroupDetails(missing)}]`);
  }
  if (invalid.length > 0) {
    parts.push(`non_function=[${invalid.join(', ')}]`);
    parts.push(`non_function_groups=[${formatGroupDetails(invalid)}]`);
  }

  throw new Error(`[store-contract] ${storeName} failed contract assertion: ${parts.join(' ')}`);
}

export function assertStoreContractInDev(
  store: Record<string, unknown>,
  storeName: string,
  env: ProcessEnvLike = process.env
): void {
  const disabled = env['JARVIS_ASSERT_STORE_CONTRACT'] === '0';
  const isProduction = env['NODE_ENV'] === 'production';
  if (disabled || isProduction) {
    return;
  }
  assertStoreContract(store, storeName);
}
