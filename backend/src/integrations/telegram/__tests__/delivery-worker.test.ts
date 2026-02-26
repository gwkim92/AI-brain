import { describe, expect, it, vi } from 'vitest';

import { processTelegramDeliveryBatch } from '../delivery-worker';
import type { TelegramReportRecord } from '../../../store/types';

function createQueuedReport(overrides: Partial<TelegramReportRecord> = {}): TelegramReportRecord {
  return {
    id: 'f6dfcb3f-a81a-4fa4-a77c-92f5256ce2d8',
    chatId: 'telegram',
    topic: 'radar-digest',
    bodyMarkdown: '*Digest*',
    status: 'queued',
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: '2026-02-24T10:00:00.000Z',
    lastError: null,
    telegramMessageId: null,
    sentAt: null,
    createdAt: '2026-02-24T10:00:00.000Z',
    ...overrides
  };
}

describe('telegram delivery worker', () => {
  it('sends queued reports and marks them as sent', async () => {
    const listPendingTelegramReports = vi.fn().mockResolvedValue([createQueuedReport()]);
    const listUpgradeProposals = vi
      .fn()
      .mockResolvedValue([{ id: '123e4567-e89b-12d3-a456-426614174000', status: 'proposed' }]);
    const updateTelegramReportDelivery = vi.fn().mockResolvedValue(
      createQueuedReport({
        status: 'sent',
        attemptCount: 1,
        telegramMessageId: '777001',
        sentAt: '2026-02-24T10:00:01.000Z'
      })
    );

    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      messageId: '777001'
    });

    const result = await processTelegramDeliveryBatch({
      store: {
        listPendingTelegramReports,
        listUpgradeProposals,
        updateTelegramReportDelivery
      },
      client: {
        sendMessage
      },
      webhookSecret: 'telegram_secret',
      nowMs: Date.parse('2026-02-24T10:00:00.000Z'),
      limit: 5,
      defaultMaxAttempts: 3,
      retryBaseMs: 2000,
      retryMaxMs: 60000
    });

    expect(result).toEqual({
      processed: 1,
      sent: 1,
      requeued: 0,
      failed: 0
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(updateTelegramReportDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'f6dfcb3f-a81a-4fa4-a77c-92f5256ce2d8',
        status: 'sent',
        incrementAttemptCount: true,
        telegramMessageId: '777001',
        lastError: null
      })
    );
  });

  it('requeues failed delivery with exponential backoff', async () => {
    const listPendingTelegramReports = vi.fn().mockResolvedValue([
      createQueuedReport({
        attemptCount: 1,
        maxAttempts: 4
      })
    ]);
    const listUpgradeProposals = vi.fn().mockResolvedValue([]);
    const updateTelegramReportDelivery = vi.fn().mockResolvedValue(createQueuedReport());

    const sendMessage = vi.fn().mockRejectedValue(new Error('telegram timeout'));
    const nowMs = Date.parse('2026-02-24T10:00:00.000Z');

    const result = await processTelegramDeliveryBatch({
      store: {
        listPendingTelegramReports,
        listUpgradeProposals,
        updateTelegramReportDelivery
      },
      client: {
        sendMessage
      },
      webhookSecret: undefined,
      nowMs,
      limit: 5,
      defaultMaxAttempts: 3,
      retryBaseMs: 2000,
      retryMaxMs: 60000
    });

    expect(result).toEqual({
      processed: 1,
      sent: 0,
      requeued: 1,
      failed: 0
    });
    expect(updateTelegramReportDelivery).toHaveBeenCalledTimes(1);
    const updatePayload = updateTelegramReportDelivery.mock.calls[0]?.[0] as {
      status: string;
      incrementAttemptCount: boolean;
      nextAttemptAt: string;
      lastError: string;
    };
    expect(updatePayload.status).toBe('queued');
    expect(updatePayload.incrementAttemptCount).toBe(true);
    expect(updatePayload.lastError).toContain('telegram timeout');
    expect(Date.parse(updatePayload.nextAttemptAt)).toBe(nowMs + 4_000);
  });

  it('marks delivery as failed after max attempts', async () => {
    const listPendingTelegramReports = vi.fn().mockResolvedValue([
      createQueuedReport({
        attemptCount: 2,
        maxAttempts: 3
      })
    ]);
    const listUpgradeProposals = vi.fn().mockResolvedValue([]);
    const updateTelegramReportDelivery = vi.fn().mockResolvedValue(createQueuedReport());

    const sendMessage = vi.fn().mockRejectedValue(new Error('telegram 429'));

    const result = await processTelegramDeliveryBatch({
      store: {
        listPendingTelegramReports,
        listUpgradeProposals,
        updateTelegramReportDelivery
      },
      client: {
        sendMessage
      },
      webhookSecret: undefined,
      nowMs: Date.parse('2026-02-24T10:00:00.000Z'),
      limit: 5,
      defaultMaxAttempts: 3,
      retryBaseMs: 2000,
      retryMaxMs: 60000
    });

    expect(result).toEqual({
      processed: 1,
      sent: 0,
      requeued: 0,
      failed: 1
    });
    expect(updateTelegramReportDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        incrementAttemptCount: true,
        lastError: expect.stringContaining('telegram 429')
      })
    );
  });
});
