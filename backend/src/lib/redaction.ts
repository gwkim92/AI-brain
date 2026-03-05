const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|authorization|password|access[_-]?token|refresh[_-]?token)/iu;

const TOKEN_LIKE_PATTERN = /\b(sk-[a-z0-9_\-]{12,}|ya29\.[a-z0-9\-_.]+|eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}|bearer\s+[a-z0-9\-_.]{12,})\b/giu;

export function redactSecretsInText(input: string): string {
  if (!input) {
    return input;
  }
  return input.replace(TOKEN_LIKE_PATTERN, '[REDACTED]');
}

export function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item));
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
      if (SECRET_KEY_PATTERN.test(key)) {
        return [key, '[REDACTED]'] as const;
      }
      return [key, redactUnknown(entryValue)] as const;
    });

    return Object.fromEntries(entries);
  }

  if (typeof value === 'string') {
    return redactSecretsInText(value);
  }

  return value;
}
