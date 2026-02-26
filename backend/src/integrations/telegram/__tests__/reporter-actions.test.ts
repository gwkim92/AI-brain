import { describe, expect, it } from 'vitest';

import { validateTelegramApprovalCallbackData } from '../commands';
import { buildTelegramApprovalActionPayload, createTelegramBotClient, mergeApprovalReplyMarkup } from '../reporter';

describe('telegram reporter action payloads', () => {
  it('builds signed callback data for approve actions', () => {
    const nowMs = 1_700_100_000_000;
    const payload = buildTelegramApprovalActionPayload({
      proposalId: '123e4567-e89b-12d3-a456-426614174000',
      secret: 'telegram-reporter-secret',
      nowMs,
      expiresInSec: 600
    });

    expect(payload.proposal_id).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(payload.reply_markup.inline_keyboard).toHaveLength(1);
    expect(payload.reply_markup.inline_keyboard[0]).toHaveLength(2);

    const buttons = payload.reply_markup.inline_keyboard[0];
    for (const button of buttons) {
      const result = validateTelegramApprovalCallbackData({
        data: button.callback_data,
        secret: 'telegram-reporter-secret',
        nowMs
      });
      expect(result).toMatchObject({ accepted: true, proposalId: payload.proposal_id });
    }
  });

  it('merges approval payloads into a single inline keyboard', () => {
    const nowMs = 1_700_100_000_000;
    const payloadA = buildTelegramApprovalActionPayload({
      proposalId: '123e4567-e89b-12d3-a456-426614174000',
      secret: 'telegram-reporter-secret',
      nowMs,
      expiresInSec: 600
    });
    const payloadB = buildTelegramApprovalActionPayload({
      proposalId: '123e4567-e89b-12d3-a456-426614174001',
      secret: 'telegram-reporter-secret',
      nowMs,
      expiresInSec: 600
    });

    const merged = mergeApprovalReplyMarkup([payloadA, payloadB]);
    expect(merged).toBeDefined();
    expect(merged?.inline_keyboard).toHaveLength(2);
    expect(merged?.inline_keyboard[0]?.length).toBe(2);
    expect(merged?.inline_keyboard[1]?.length).toBe(2);
  });

  it('sends telegram message with markdown and reply_markup payload', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const client = createTelegramBotClient({
      botToken: '123456789:test-token',
      fetchImpl: async (input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        calls.push({
          url: String(input),
          body
        });
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 987654
            }
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      }
    });

    const payload = buildTelegramApprovalActionPayload({
      proposalId: '123e4567-e89b-12d3-a456-426614174000',
      secret: 'telegram-reporter-secret',
      nowMs: 1_700_100_000_000,
      expiresInSec: 600
    });
    const merged = mergeApprovalReplyMarkup([payload]);
    const result = await client.sendMessage({
      chatId: 'telegram',
      text: 'hello',
      replyMarkup: merged
    });

    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('987654');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/bot123456789:test-token/sendMessage');
    expect(calls[0]?.body.parse_mode).toBe('MarkdownV2');
    expect(calls[0]?.body.chat_id).toBe('telegram');
    expect(calls[0]?.body.reply_markup).toBeDefined();
  });
});
