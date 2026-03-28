export type HyperAgentArtifactDiffEntry = {
  path: string;
  changeType: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
};

export type HyperAgentArtifactDiff = {
  changeCount: number;
  entries: HyperAgentArtifactDiffEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitiveArray(value: unknown): value is Array<string | number | boolean | null> {
  return (
    Array.isArray(value) &&
    value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
  );
}

function pushEntry(
  entries: HyperAgentArtifactDiffEntry[],
  entry: HyperAgentArtifactDiffEntry,
  maxEntries: number
): void {
  if (entries.length < maxEntries) {
    entries.push(entry);
  }
}

function diffRecursive(input: {
  before: unknown;
  after: unknown;
  path: string;
  entries: HyperAgentArtifactDiffEntry[];
  maxEntries: number;
}): void {
  if (Object.is(input.before, input.after)) {
    return;
  }

  if (typeof input.before === 'undefined') {
    pushEntry(
      input.entries,
      { path: input.path, changeType: 'added', before: undefined, after: input.after },
      input.maxEntries
    );
    return;
  }
  if (typeof input.after === 'undefined') {
    pushEntry(
      input.entries,
      { path: input.path, changeType: 'removed', before: input.before, after: undefined },
      input.maxEntries
    );
    return;
  }

  if (isPrimitiveArray(input.before) && isPrimitiveArray(input.after)) {
    pushEntry(
      input.entries,
      { path: input.path, changeType: 'changed', before: input.before, after: input.after },
      input.maxEntries
    );
    return;
  }

  if (Array.isArray(input.before) && Array.isArray(input.after)) {
    const maxLength = Math.max(input.before.length, input.after.length);
    for (let index = 0; index < maxLength; index += 1) {
      diffRecursive({
        before: input.before[index],
        after: input.after[index],
        path: `${input.path}[${index}]`,
        entries: input.entries,
        maxEntries: input.maxEntries,
      });
      if (input.entries.length >= input.maxEntries) {
        return;
      }
    }
    return;
  }

  if (isRecord(input.before) && isRecord(input.after)) {
    const keys = [...new Set([...Object.keys(input.before), ...Object.keys(input.after)])].sort((left, right) =>
      left.localeCompare(right)
    );
    for (const key of keys) {
      diffRecursive({
        before: input.before[key],
        after: input.after[key],
        path: input.path ? `${input.path}.${key}` : key,
        entries: input.entries,
        maxEntries: input.maxEntries,
      });
      if (input.entries.length >= input.maxEntries) {
        return;
      }
    }
    return;
  }

  pushEntry(
    input.entries,
    { path: input.path, changeType: 'changed', before: input.before, after: input.after },
    input.maxEntries
  );
}

export function buildHyperAgentArtifactDiff(input: {
  beforePayload: Record<string, unknown>;
  afterPayload: Record<string, unknown>;
  maxEntries?: number;
}): HyperAgentArtifactDiff {
  const entries: HyperAgentArtifactDiffEntry[] = [];
  diffRecursive({
    before: input.beforePayload,
    after: input.afterPayload,
    path: '',
    entries,
    maxEntries: Math.max(1, Math.trunc(input.maxEntries ?? 64)),
  });

  return {
    changeCount: entries.length,
    entries,
  };
}
