import type { AppEnv } from '../../config/env';
import type { JarvisStore } from '../../store/types';
import {
  buildTelegramApprovalActionPayload,
  createTelegramBotClient,
  mergeApprovalReplyMarkup,
  type TelegramClient
} from './reporter';

export type TelegramDeliveryBatchResult = {
  processed: number;
  sent: number;
  requeued: number;
  failed: number;
};

export type TelegramDeliveryBatchInput = {
  store: Pick<JarvisStore, 'listPendingTelegramReports' | 'listUpgradeProposals' | 'updateTelegramReportDelivery'>;
  client: TelegramClient;
  webhookSecret?: string;
  nowMs?: number;
  limit: number;
  defaultMaxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
};

export async function processTelegramDeliveryBatch(input: TelegramDeliveryBatchInput): Promise<TelegramDeliveryBatchResult> {
  const nowMs = input.nowMs ?? Date.now();
  const reports = await input.store.listPendingTelegramReports({
    limit: input.limit,
    nowIso: new Date(nowMs).toISOString()
  });

  if (reports.length === 0) {
    return {
      processed: 0,
      sent: 0,
      requeued: 0,
      failed: 0
    };
  }

  const proposals = input.webhookSecret ? await input.store.listUpgradeProposals('proposed') : [];

  let sent = 0;
  let requeued = 0;
  let failed = 0;

  for (const report of reports) {
    const replyMarkup = buildReplyMarkupForReport(proposals, input.webhookSecret);
    try {
      const response = await input.client.sendMessage({
        chatId: report.chatId,
        text: report.bodyMarkdown,
        replyMarkup
      });

      await input.store.updateTelegramReportDelivery({
        reportId: report.id,
        status: 'sent',
        incrementAttemptCount: true,
        telegramMessageId: response.messageId ?? null,
        sentAt: new Date().toISOString(),
        nextAttemptAt: null,
        lastError: null
      });
      sent += 1;
    } catch (error) {
      const message = normalizeError(error);
      const nextAttemptCount = report.attemptCount + 1;
      const maxAttempts = Math.max(1, report.maxAttempts || input.defaultMaxAttempts);
      const exhausted = nextAttemptCount >= maxAttempts;

      if (exhausted) {
        await input.store.updateTelegramReportDelivery({
          reportId: report.id,
          status: 'failed',
          incrementAttemptCount: true,
          lastError: message
        });
        failed += 1;
      } else {
        const nextAttemptAt = new Date(nowMs + computeRetryDelayMs(nextAttemptCount, input.retryBaseMs, input.retryMaxMs));
        await input.store.updateTelegramReportDelivery({
          reportId: report.id,
          status: 'queued',
          incrementAttemptCount: true,
          nextAttemptAt: nextAttemptAt.toISOString(),
          lastError: message
        });
        requeued += 1;
      }
    }
  }

  return {
    processed: reports.length,
    sent,
    requeued,
    failed
  };
}

export type TelegramDeliveryWorkerHandle = {
  stop: () => void;
};

export function startTelegramDeliveryWorker(input: {
  store: JarvisStore;
  env: AppEnv;
  client?: TelegramClient;
  onError?: (error: unknown) => void;
}): TelegramDeliveryWorkerHandle {
  if (!input.env.TELEGRAM_REPORT_WORKER_ENABLED) {
    return { stop: () => undefined };
  }

  if (!input.env.TELEGRAM_BOT_TOKEN) {
    return { stop: () => undefined };
  }

  const client =
    input.client ??
    createTelegramBotClient({
      botToken: input.env.TELEGRAM_BOT_TOKEN
    });

  let closed = false;
  let inflight = false;
  const pollIntervalMs = input.env.TELEGRAM_REPORT_WORKER_POLL_MS;

  const tick = async () => {
    if (closed || inflight) {
      return;
    }

    inflight = true;
    try {
      await processTelegramDeliveryBatch({
        store: input.store,
        client,
        webhookSecret: input.env.TELEGRAM_WEBHOOK_SECRET,
        limit: input.env.TELEGRAM_REPORT_WORKER_BATCH,
        defaultMaxAttempts: input.env.TELEGRAM_REPORT_MAX_ATTEMPTS,
        retryBaseMs: input.env.TELEGRAM_REPORT_RETRY_BASE_MS,
        retryMaxMs: input.env.TELEGRAM_REPORT_RETRY_MAX_MS
      });
    } catch (error) {
      input.onError?.(error);
    } finally {
      inflight = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, pollIntervalMs);
  void tick();

  return {
    stop: () => {
      closed = true;
      clearInterval(timer);
    }
  };
}

function buildReplyMarkupForReport(
  proposals: Array<{ id: string }>,
  webhookSecret: string | undefined
): ReturnType<typeof mergeApprovalReplyMarkup> {
  if (!webhookSecret || proposals.length === 0) {
    return undefined;
  }

  const payloads = proposals.slice(0, 3).map((proposal) =>
    buildTelegramApprovalActionPayload({
      proposalId: proposal.id,
      secret: webhookSecret
    })
  );

  return mergeApprovalReplyMarkup(payloads);
}

function computeRetryDelayMs(attemptCount: number, baseMs: number, maxMs: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const delay = Math.min(maxMs, baseMs * 2 ** exponent);
  return Math.max(baseMs, delay);
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.slice(0, 400);
  }

  return 'telegram_send_failed';
}
