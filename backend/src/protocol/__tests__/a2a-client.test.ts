import { describe, expect, it } from 'vitest';

import { negotiateA2AVersion } from '../a2a-client';

describe('negotiateA2AVersion', () => {
  it('returns failure when no version overlap exists', () => {
    const result = negotiateA2AVersion(
      {
        supportedVersions: ['0.1', '0.2']
      },
      {
        supportedVersions: ['0.3', '0.4']
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('version_mismatch');
    }
  });

  it('returns agreed version when overlap exists', () => {
    const result = negotiateA2AVersion(
      {
        supportedVersions: ['0.2', '0.3']
      },
      {
        supportedVersions: ['0.3', '0.4']
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe('0.3');
    }
  });
});
