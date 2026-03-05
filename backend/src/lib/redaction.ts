const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|authorization|password|access[_-]?token|refresh[_-]?token)/iu;
const MAX_REDACTED_TEXT_LENGTH = 2048;

const TOKEN_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/gu,
  /\bya29\.[A-Za-z0-9._-]{12,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  /\bbearer\s+[A-Za-z0-9._-]{12,}\b/giu
];

const QUERY_PARAM_SECRET_PATTERN =
  /([?&](?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret)=)[^&#\s]+/giu;

function truncateIfNeeded(input: string): string {
  if (input.length <= MAX_REDACTED_TEXT_LENGTH) {
    return input;
  }
  return `${input.slice(0, MAX_REDACTED_TEXT_LENGTH)}…[TRUNCATED:${input.length - MAX_REDACTED_TEXT_LENGTH}]`;
}

export function redactSecretsInText(input: string): string {
  if (!input) {
    return input;
  }

  let redacted = input;
  for (const pattern of TOKEN_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }

  redacted = redacted.replace(QUERY_PARAM_SECRET_PATTERN, '$1[REDACTED]');
  return truncateIfNeeded(redacted);
}

function redactUnknownInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknownInternal(item, seen));
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      return '[REDACTED_CIRCULAR]';
    }
    seen.add(value);

    const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
      if (SECRET_KEY_PATTERN.test(key)) {
        return [key, '[REDACTED]'] as const;
      }
      return [key, redactUnknownInternal(entryValue, seen)] as const;
    });

    return Object.fromEntries(entries);
  }

  if (typeof value === 'string') {
    return redactSecretsInText(value);
  }

  return value;
}

export function redactUnknown(value: unknown): unknown {
  return redactUnknownInternal(value, new WeakSet<object>());
}
