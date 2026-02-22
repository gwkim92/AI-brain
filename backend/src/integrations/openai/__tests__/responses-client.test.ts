import { describe, expect, it } from 'vitest';

import { maybeCompactResponseContext } from '../responses-client';

describe('maybeCompactResponseContext', () => {
  it('requests compact when token threshold is exceeded', async () => {
    const calls: string[] = [];

    const result = await maybeCompactResponseContext(
      {
        responseId: 'resp_1',
        promptTokens: 3200,
        completionTokens: 1900,
        compactThresholdTokens: 4500
      },
      {
        async compactResponse(input) {
          calls.push(input.responseId);
          return { id: 'comp_1' };
        }
      }
    );

    expect(result.compacted).toBe(true);
    expect(result.compactedResponseId).toBe('comp_1');
    expect(calls).toEqual(['resp_1']);
  });

  it('does not compact when below threshold', async () => {
    const calls: string[] = [];

    const result = await maybeCompactResponseContext(
      {
        responseId: 'resp_2',
        promptTokens: 1000,
        completionTokens: 500,
        compactThresholdTokens: 4500
      },
      {
        async compactResponse(input) {
          calls.push(input.responseId);
          return { id: 'comp_2' };
        }
      }
    );

    expect(result.compacted).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
