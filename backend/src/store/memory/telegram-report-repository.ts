import { randomUUID } from 'node:crypto';

import type { TelegramReportRecord } from '../types';
import type { TelegramReportRepositoryContract } from '../repository-contracts';
import type { MemoryStoreState } from './state';

type MemoryTelegramReportRepositoryDeps = {
  state: MemoryStoreState;
  nowIso: () => string;
};

export function createMemoryTelegramReportRepository({
  state,
  nowIso
}: MemoryTelegramReportRepositoryDeps): TelegramReportRepositoryContract {
  return {
    async createTelegramReport(input: { chatId: string; topic?: string; bodyMarkdown?: string; maxAttempts?: number }) {
      const now = nowIso();
      const report: TelegramReportRecord = {
        id: randomUUID(),
        chatId: input.chatId,
        topic: input.topic ?? 'radar-digest',
        bodyMarkdown: input.bodyMarkdown ?? '',
        status: 'queued',
        attemptCount: 0,
        maxAttempts: Math.max(1, input.maxAttempts ?? 3),
        nextAttemptAt: now,
        lastError: null,
        telegramMessageId: null,
        sentAt: null,
        createdAt: now
      };
      state.telegramReports.set(report.id, report);
      return report;
    },

    async listTelegramReports(input: { status?: TelegramReportRecord['status']; limit: number }) {
      return [...state.telegramReports.values()]
        .filter((report) => (input.status ? report.status === input.status : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, input.limit);
    },

    async getTelegramReportById(reportId: string) {
      return state.telegramReports.get(reportId) ?? null;
    },

    async listPendingTelegramReports(input: { limit: number; nowIso?: string }) {
      const now = input.nowIso ?? nowIso();
      return [...state.telegramReports.values()]
        .filter((report) => report.status === 'queued')
        .filter((report) => report.attemptCount < report.maxAttempts)
        .filter((report) => !report.nextAttemptAt || report.nextAttemptAt <= now)
        .sort((left, right) => {
          const leftKey = left.nextAttemptAt ?? left.createdAt;
          const rightKey = right.nextAttemptAt ?? right.createdAt;
          if (leftKey === rightKey) {
            return left.createdAt.localeCompare(right.createdAt);
          }
          return leftKey.localeCompare(rightKey);
        })
        .slice(0, input.limit);
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
      const current = state.telegramReports.get(input.reportId);
      if (!current) {
        return null;
      }

      const next: TelegramReportRecord = {
        ...current,
        status: input.status,
        attemptCount: input.attemptCount ?? current.attemptCount + (input.incrementAttemptCount ? 1 : 0),
        maxAttempts: input.maxAttempts ?? current.maxAttempts,
        bodyMarkdown: input.bodyMarkdown ?? current.bodyMarkdown,
        nextAttemptAt: input.nextAttemptAt === undefined ? current.nextAttemptAt : input.nextAttemptAt,
        lastError: input.lastError === undefined ? current.lastError : input.lastError,
        telegramMessageId: input.telegramMessageId === undefined ? current.telegramMessageId ?? null : input.telegramMessageId,
        sentAt:
          input.sentAt === undefined ? (input.status === 'sent' ? nowIso() : current.sentAt ?? null) : input.sentAt
      };
      state.telegramReports.set(next.id, next);
      return next;
    }
  };
}
