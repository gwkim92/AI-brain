import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { handleResponsesWebhook } from '../webhook-handler';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('handleResponsesWebhook', () => {
  it('rejects webhook when signature is invalid', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'response.completed' });

    const result = await handleResponsesWebhook(
      {
        rawBody: payload,
        signature: 'invalid_signature',
        secret: 'test_secret'
      },
      {
        async onEvent() {
          throw new Error('onEvent should not be called');
        }
      }
    );

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe('invalid_signature');
    }
  });

  it('accepts webhook when signature is valid', async () => {
    const payload = JSON.stringify({ id: 'evt_2', type: 'response.completed' });
    const secret = 'test_secret';
    const signature = sign(payload, secret);
    const events: Array<{ id: string; type: string }> = [];

    const result = await handleResponsesWebhook(
      {
        rawBody: payload,
        signature,
        secret
      },
      {
        async onEvent(event) {
          events.push(event);
        }
      }
    );

    expect(result.accepted).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: 'evt_2', type: 'response.completed' });
  });
});
