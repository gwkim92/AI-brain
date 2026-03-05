import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export type RetryContext = {
  attempt: number;
  maxAttempts: number;
  provider?: string;
};

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly provider?: string;
  readonly retryAfterMs?: number;
  readonly reasonCode?: string;

  constructor(input: {
    status: number;
    provider?: string;
    retryAfterMs?: number;
    reasonCode?: string;
    message: string;
  }) {
    super(input.message);
    this.name = 'ProviderHttpError';
    this.status = input.status;
    this.provider = input.provider;
    this.retryAfterMs = input.retryAfterMs;
    this.reasonCode = input.reasonCode;
  }
}

export function parseRetryAfterHeader(retryAfter: string | null): number | undefined {
  if (!retryAfter) {
    return undefined;
  }

  const trimmed = retryAfter.trim();
  if (!trimmed) {
    return undefined;
  }

  const seconds = Number.parseFloat(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const parsedDate = Date.parse(trimmed);
  if (!Number.isFinite(parsedDate)) {
    return undefined;
  }

  return Math.max(0, parsedDate - Date.now());
}

function parseRetryDelayDuration(raw: string): number | undefined {
  const match = raw.match(/([0-9]+(?:\.[0-9]+)?)s/u);
  if (!match) {
    return undefined;
  }
  const seconds = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.round(seconds * 1000);
}

function extractRetryAfterFromBody(bodyText: string): number | undefined {
  if (!bodyText) {
    return undefined;
  }

  // Google-style retry hint can appear as "retryDelay":"3s".
  const retryDelayMatch = bodyText.match(/"retryDelay"\s*:\s*"([^"]+)"/u);
  if (retryDelayMatch?.[1]) {
    const parsed = parseRetryDelayDuration(retryDelayMatch[1]);
    if (typeof parsed === 'number') {
      return parsed;
    }
  }

  return undefined;
}

function toReasonCode(status: number, bodyText: string): string {
  const lowered = bodyText.toLowerCase();
  if (status === 429 || lowered.includes('rate limit') || lowered.includes('resource_exhausted')) {
    return 'rate_limited';
  }
  if (lowered.includes('quota')) {
    return 'quota_exceeded';
  }
  if (lowered.includes('timeout') || status === 408 || status === 504) {
    return 'timeout';
  }
  if (lowered.includes('temporar') || status === 503) {
    return 'temporary_unavailable';
  }
  if (status >= 500) {
    return 'upstream_5xx';
  }
  return 'http_error';
}

export function buildProviderHttpError(input: {
  provider?: string;
  status: number;
  statusText: string;
  bodyText: string;
  retryAfterHeader?: string | null;
}): ProviderHttpError {
  const bodySnippet = input.bodyText.slice(0, 400);
  const retryAfterMs = parseRetryAfterHeader(input.retryAfterHeader ?? null) ?? extractRetryAfterFromBody(input.bodyText);
  const reasonCode = toReasonCode(input.status, input.bodyText);
  const providerPrefix = input.provider ? `${input.provider} ` : '';
  return new ProviderHttpError({
    status: input.status,
    provider: input.provider,
    retryAfterMs,
    reasonCode,
    message: `${providerPrefix}http ${input.status} (${reasonCode}): ${bodySnippet || input.statusText}`
  });
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ProviderHttpError) {
    return DEFAULT_RETRYABLE_STATUSES.has(error.status)
      || error.reasonCode === 'rate_limited'
      || error.reasonCode === 'quota_exceeded'
      || error.reasonCode === 'temporary_unavailable'
      || error.reasonCode === 'timeout';
  }

  if (error instanceof Error) {
    return /fetch failed|network|timed out|econnreset|eai_again|etimedout|socket/u.test(error.message.toLowerCase());
  }

  return false;
}

function computeBackoffMs(error: unknown, attempt: number, baseMs: number, maxMs: number): number {
  if (error instanceof ProviderHttpError && typeof error.retryAfterMs === 'number') {
    return Math.max(0, Math.min(maxMs, error.retryAfterMs));
  }

  const exponent = Math.max(0, attempt - 1);
  const noJitter = Math.min(maxMs, baseMs * 2 ** exponent);
  const jitter = Math.round(noJitter * 0.2 * Math.random());
  return noJitter + jitter;
}

export async function withReasonAwareRetry<T>(
  operation: (ctx: RetryContext) => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    provider?: string;
    onRetry?: (input: {
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      provider?: string;
      reason: string;
      error: unknown;
    }) => void;
  }
): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(50, options?.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, options?.maxDelayMs ?? 5000);

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      return await operation({
        attempt,
        maxAttempts,
        provider: options?.provider
      });
    } catch (error) {
      const canRetry = attempt < maxAttempts && isRetryableError(error);
      if (!canRetry) {
        throw error;
      }

      const delayMs = computeBackoffMs(error, attempt, baseDelayMs, maxDelayMs);
      options?.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        provider: options?.provider,
        reason: error instanceof ProviderHttpError ? error.reasonCode ?? 'http_error' : 'network_retryable_error',
        error
      });
      await sleep(delayMs);
    }
  }

  throw new Error('unreachable retry state');
}
