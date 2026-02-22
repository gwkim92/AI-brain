export type TelegramReportMessage = {
  chatId: string;
  text: string;
};

export type TelegramClient = {
  sendMessage: (message: TelegramReportMessage) => Promise<{ ok: boolean; messageId?: string }>;
};

export type RadarDigestPayload = {
  title: string;
  generatedAt: string;
  lines: string[];
};

export function buildRadarDigestMessage(payload: RadarDigestPayload): string {
  const header = `*${escapeMarkdown(payload.title)}*`;
  const generated = `Generated: ${escapeMarkdown(payload.generatedAt)}`;
  const body = payload.lines.map((line, index) => `${index + 1}. ${escapeMarkdown(line)}`).join('\n');
  return [header, generated, body].filter(Boolean).join('\n');
}

export async function sendRadarDigest(
  client: TelegramClient,
  chatId: string,
  payload: RadarDigestPayload
): Promise<{ ok: boolean; messageId?: string }> {
  return await client.sendMessage({
    chatId,
    text: buildRadarDigestMessage(payload)
  });
}

function escapeMarkdown(value: string): string {
  return value.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
}
