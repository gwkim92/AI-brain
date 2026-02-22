import { createHmac, timingSafeEqual } from 'node:crypto';

export type ResponsesWebhookInput = {
  rawBody: string;
  signature?: string;
  secret: string;
};

export type ResponsesWebhookEvent = {
  id: string;
  type: string;
};

export type ResponsesWebhookDeps = {
  onEvent: (event: ResponsesWebhookEvent) => Promise<void>;
};

export type ResponsesWebhookResult =
  | { accepted: true }
  | { accepted: false; reason: 'missing_signature' | 'invalid_signature' | 'invalid_payload' };

export async function handleResponsesWebhook(
  input: ResponsesWebhookInput,
  deps: ResponsesWebhookDeps
): Promise<ResponsesWebhookResult> {
  if (!input.signature) {
    return {
      accepted: false,
      reason: 'missing_signature'
    };
  }

  if (!verifyWebhookSignature(input.rawBody, input.signature, input.secret)) {
    return {
      accepted: false,
      reason: 'invalid_signature'
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return {
      accepted: false,
      reason: 'invalid_payload'
    };
  }

  if (!isWebhookEvent(payload)) {
    return {
      accepted: false,
      reason: 'invalid_payload'
    };
  }

  await deps.onEvent({
    id: payload.id,
    type: payload.type
  });

  return {
    accepted: true
  };
}

function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function isWebhookEvent(value: unknown): value is ResponsesWebhookEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const typed = value as Record<string, unknown>;
  return typeof typed.id === 'string' && typeof typed.type === 'string';
}
