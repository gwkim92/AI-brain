import {
  createTelegramApprovalCallbackData,
  type TelegramApprovalCallbackAction
} from './commands';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';

export type TelegramReportMessage = {
  chatId: string;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
};

export type TelegramClient = {
  sendMessage: (message: TelegramReportMessage) => Promise<{ ok: boolean; messageId?: string }>;
};

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data: string;
};

export type TelegramReplyMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramApprovalActionPayload = {
  proposal_id: string;
  reply_markup: TelegramReplyMarkup;
};

export type RadarDigestPayload = {
  title: string;
  generatedAt: string;
  lines: string[];
};

export function createTelegramBotClient(input: {
  botToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): TelegramClient {
  const baseUrl = (input.baseUrl ?? TELEGRAM_API_BASE_URL).replace(/\/+$/u, '');
  const botToken = input.botToken.trim();
  const fetchImpl = input.fetchImpl ?? fetch;

  if (botToken.length < 10) {
    throw new Error('invalid telegram bot token');
  }

  return {
    async sendMessage(message: TelegramReportMessage) {
      const endpoint = `${baseUrl}/bot${botToken}/sendMessage`;
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: message.chatId,
          text: message.text,
          parse_mode: 'MarkdownV2',
          reply_markup: message.replyMarkup
        })
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`telegram sendMessage http ${response.status}: ${bodyText.slice(0, 300)}`);
      }

      const payload = JSON.parse(bodyText) as {
        ok?: boolean;
        description?: string;
        result?: {
          message_id?: number | string;
        };
      };

      if (!payload.ok) {
        throw new Error(`telegram sendMessage rejected: ${String(payload.description ?? 'unknown_error')}`);
      }

      const messageId = payload.result?.message_id;
      return {
        ok: true,
        messageId: messageId === undefined ? undefined : String(messageId)
      };
    }
  };
}

export function buildRadarDigestMessage(payload: RadarDigestPayload): string {
  const header = `*${escapeMarkdown(payload.title)}*`;
  const generated = `Generated: ${escapeMarkdown(payload.generatedAt)}`;
  const body = payload.lines.map((line, index) => `${index + 1}. ${escapeMarkdown(line)}`).join('\n');
  return [header, generated, body].filter(Boolean).join('\n');
}

export async function sendRadarDigest(
  client: TelegramClient,
  chatId: string,
  payload: RadarDigestPayload,
  replyMarkup?: TelegramReplyMarkup
): Promise<{ ok: boolean; messageId?: string }> {
  return await client.sendMessage({
    chatId,
    text: buildRadarDigestMessage(payload),
    replyMarkup
  });
}

export function buildTelegramApprovalActionPayload(input: {
  proposalId: string;
  secret: string;
  nowMs?: number;
  expiresInSec?: number;
  actionButtons?: Array<{ action: TelegramApprovalCallbackAction; label: string }>;
}): TelegramApprovalActionPayload {
  const actionButtons = input.actionButtons ?? [
    { action: 'approve', label: 'Approve' },
    { action: 'approve_and_start', label: 'Approve + Start' }
  ];

  const inlineRow: TelegramInlineKeyboardButton[] = actionButtons.map((entry) => ({
    text: entry.label,
    callback_data: createTelegramApprovalCallbackData({
      action: entry.action,
      proposalId: input.proposalId,
      secret: input.secret,
      nowMs: input.nowMs,
      expiresInSec: input.expiresInSec
    })
  }));

  return {
    proposal_id: input.proposalId,
    reply_markup: {
      inline_keyboard: [inlineRow]
    }
  };
}

export function mergeApprovalReplyMarkup(
  payloads: TelegramApprovalActionPayload[],
  options?: { includeProposalHintInButtonText?: boolean }
): TelegramReplyMarkup | undefined {
  if (payloads.length === 0) {
    return undefined;
  }

  return {
    inline_keyboard: payloads.map((payload) => {
      const hint = payload.proposal_id.slice(0, 8);
      const row = payload.reply_markup.inline_keyboard[0] ?? [];
      return row.map((button) => ({
        text: options?.includeProposalHintInButtonText === false ? button.text : `${button.text} ${hint}`,
        callback_data: button.callback_data
      }));
    })
  };
}

function escapeMarkdown(value: string): string {
  return value.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
}
