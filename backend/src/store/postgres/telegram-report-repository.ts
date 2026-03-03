import type { Pool } from 'pg';

import type { TelegramReportRepositoryContract } from '../repository-contracts';
import type { TelegramReportRow } from './types';

type TelegramReportRepositoryDeps = {
  pool: Pool;
};

export function createTelegramReportRepository({
  pool
}: TelegramReportRepositoryDeps): TelegramReportRepositoryContract {
  const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

  return {
    async createTelegramReport(input: { chatId: string; topic?: string; bodyMarkdown?: string; maxAttempts?: number }) {
      const { rows } = await pool.query<TelegramReportRow>(
        `
          INSERT INTO telegram_reports (chat_id, topic, body_markdown, status, max_attempts, next_attempt_at)
          VALUES ($1, $2, $3, 'queued'::telegram_report_status, $4, now())
          RETURNING id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error, telegram_message_id, created_at, sent_at
        `,
        [input.chatId, input.topic ?? 'radar-digest', input.bodyMarkdown ?? 'queued by api', Math.max(1, input.maxAttempts ?? 3)]
      );

      return mapTelegramReportRow(rows[0]!, toIso);
    },

    async listTelegramReports(input: { status?: TelegramReportRow['status']; limit: number }) {
      const params: unknown[] = [];
      let where = '';
      if (input.status) {
        params.push(input.status);
        where = 'WHERE status = $1::telegram_report_status';
      }
      params.push(input.limit);
      const limitParam = input.status ? '$2' : '$1';

      const { rows } = await pool.query<TelegramReportRow>(
        `
          SELECT
            id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error,
            telegram_message_id, created_at, sent_at
          FROM telegram_reports
          ${where}
          ORDER BY created_at DESC
          LIMIT ${limitParam}
        `,
        params
      );

      return rows.map((row) => mapTelegramReportRow(row, toIso));
    },

    async getTelegramReportById(reportId: string) {
      const { rows } = await pool.query<TelegramReportRow>(
        `
          SELECT
            id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error,
            telegram_message_id, created_at, sent_at
          FROM telegram_reports
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [reportId]
      );
      if (!rows[0]) {
        return null;
      }
      return mapTelegramReportRow(rows[0], toIso);
    },

    async listPendingTelegramReports(input: { limit: number; nowIso?: string }) {
      const now = input.nowIso ? new Date(input.nowIso) : new Date();
      const { rows } = await pool.query<TelegramReportRow>(
        `
          SELECT
            id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error,
            telegram_message_id, created_at, sent_at
          FROM telegram_reports
          WHERE status = 'queued'::telegram_report_status
            AND attempt_count < max_attempts
            AND COALESCE(next_attempt_at, created_at) <= $1
          ORDER BY COALESCE(next_attempt_at, created_at) ASC, created_at ASC
          LIMIT $2
        `,
        [now, input.limit]
      );

      return rows.map((row) => mapTelegramReportRow(row, toIso));
    },

    async updateTelegramReportDelivery(input: {
      reportId: string;
      status: 'queued' | 'sent' | 'failed';
      incrementAttemptCount?: boolean;
      attemptCount?: number;
      maxAttempts?: number;
      telegramMessageId?: string | null;
      sentAt?: string | null;
      nextAttemptAt?: string | null;
      lastError?: string | null;
      bodyMarkdown?: string;
    }) {
      const shouldSetNextAttemptAt = input.nextAttemptAt !== undefined;
      const nextAttemptAt = input.nextAttemptAt ? new Date(input.nextAttemptAt) : null;
      const shouldSetLastError = input.lastError !== undefined;
      const shouldSetTelegramMessageId = input.telegramMessageId !== undefined;
      const shouldSetSentAt = input.sentAt !== undefined || input.status === 'sent';
      const sentAt = input.sentAt ? new Date(input.sentAt) : input.status === 'sent' ? new Date() : null;
      const shouldSetBodyMarkdown = input.bodyMarkdown !== undefined;
      const incrementAttempt = input.incrementAttemptCount === true;

      const { rows } = await pool.query<TelegramReportRow>(
        `
          UPDATE telegram_reports
          SET status = $2::telegram_report_status,
              attempt_count = CASE
                WHEN $4::int IS NOT NULL THEN $4::int
                WHEN $3::boolean THEN attempt_count + 1
                ELSE attempt_count
              END,
              max_attempts = COALESCE($5::int, max_attempts),
              next_attempt_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE next_attempt_at END,
              last_error = CASE WHEN $8::boolean THEN $9::text ELSE last_error END,
              telegram_message_id = CASE WHEN $10::boolean THEN $11::text ELSE telegram_message_id END,
              sent_at = CASE WHEN $12::boolean THEN $13::timestamptz ELSE sent_at END,
              body_markdown = CASE WHEN $14::boolean THEN $15::text ELSE body_markdown END
          WHERE id = $1::uuid
          RETURNING id, chat_id, topic, body_markdown, status, attempt_count, max_attempts, next_attempt_at, last_error, telegram_message_id, created_at, sent_at
        `,
        [
          input.reportId,
          input.status,
          incrementAttempt,
          input.attemptCount ?? null,
          input.maxAttempts ?? null,
          shouldSetNextAttemptAt,
          nextAttemptAt,
          shouldSetLastError,
          input.lastError ?? null,
          shouldSetTelegramMessageId,
          input.telegramMessageId ?? null,
          shouldSetSentAt,
          sentAt,
          shouldSetBodyMarkdown,
          input.bodyMarkdown ?? null
        ]
      );

      if (!rows[0]) {
        return null;
      }

      return mapTelegramReportRow(rows[0], toIso);
    }
  };
}

function mapTelegramReportRow(
  row: TelegramReportRow,
  toIso: (value: Date | null) => string | null
) {
  return {
    id: row.id,
    chatId: row.chat_id,
    topic: row.topic,
    bodyMarkdown: row.body_markdown,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: toIso(row.next_attempt_at),
    lastError: row.last_error,
    telegramMessageId: row.telegram_message_id,
    sentAt: toIso(row.sent_at),
    createdAt: row.created_at.toISOString()
  };
}
