import { describe, expect, it } from 'vitest';

import { redactSecretsInText, redactUnknown } from '../redaction';

describe('redaction', () => {
  it('redacts token-like values in text and query params', () => {
    const input = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz and key=sk-1234567890abcdef https://x.y?a=1&api_key=abc123';
    const output = redactSecretsInText(input);

    expect(output).toContain('Authorization: [REDACTED]');
    expect(output).toContain('key=[REDACTED]');
    expect(output).toContain('&api_key=[REDACTED]');
    expect(output.includes('sk-1234567890abcdef')).toBe(false);
  });

  it('redacts secret keys recursively', () => {
    const value = redactUnknown({
      api_key: 'sk-foo',
      nested: {
        refresh_token: 'token-abc',
        safe: 'hello'
      },
      list: [{ authorization: 'Bearer test-token-value' }]
    }) as Record<string, unknown>;

    expect(value.api_key).toBe('[REDACTED]');
    expect((value.nested as Record<string, unknown>).refresh_token).toBe('[REDACTED]');
    expect((value.nested as Record<string, unknown>).safe).toBe('hello');
    expect((value.list as Array<Record<string, unknown>>)[0]?.authorization).toBe('[REDACTED]');
  });

  it('handles circular structures safely', () => {
    const root: Record<string, unknown> = { name: 'root' };
    root.self = root;

    const value = redactUnknown(root) as Record<string, unknown>;
    expect(value.self).toBe('[REDACTED_CIRCULAR]');
  });
});
