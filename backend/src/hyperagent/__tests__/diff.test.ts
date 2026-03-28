import { describe, expect, it } from 'vitest';

import { buildHyperAgentArtifactDiff } from '../diff';

describe('hyperagent artifact diff', () => {
  it('captures nested payload changes with stable paths', () => {
    const diff = buildHyperAgentArtifactDiff({
      beforePayload: {
        maxBottlenecks: 4,
        nested: {
          enabled: true,
        },
      },
      afterPayload: {
        maxBottlenecks: 3,
        nested: {
          enabled: false,
        },
      },
    });

    expect(diff.changeCount).toBe(2);
    expect(diff.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'maxBottlenecks',
          changeType: 'changed',
          before: 4,
          after: 3,
        }),
        expect.objectContaining({
          path: 'nested.enabled',
          changeType: 'changed',
          before: true,
          after: false,
        }),
      ])
    );
  });
});
