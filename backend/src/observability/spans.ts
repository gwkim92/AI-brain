import { redactUnknown } from '../lib/redaction';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

type SpanLogLevel = 'info' | 'warn' | 'error';
type SpanStage = 'start' | 'retry' | 'complete' | 'error';

type SpanLogInput = {
  logger?: LoggerLike;
  spanName: string;
  stage: SpanStage;
  traceId?: string | null;
  userId?: string | null;
  provider?: string | null;
  featureKey?: string | null;
  status?: 'ok' | 'error' | 'retry' | 'timeout';
  durationMs?: number;
  attrs?: Record<string, unknown>;
  message?: string;
  level?: SpanLogLevel;
};

export function logSpanEvent(input: SpanLogInput): void {
  const logger = input.logger;
  if (!logger) {
    return;
  }

  const level: SpanLogLevel = input.level
    ?? (input.stage === 'error' ? 'error' : input.stage === 'retry' ? 'warn' : 'info');

  const payload = redactUnknown({
    span_name: input.spanName,
    span_stage: input.stage,
    span_status: input.status,
    trace_id: input.traceId ?? undefined,
    user_id: input.userId ?? undefined,
    provider: input.provider ?? undefined,
    feature_key: input.featureKey ?? undefined,
    duration_ms: typeof input.durationMs === 'number' ? Math.max(0, Math.trunc(input.durationMs)) : undefined,
    attrs: input.attrs ?? undefined
  }) as Record<string, unknown>;

  if (level === 'error') {
    logger.error(payload, input.message ?? `${input.spanName} ${input.stage}`);
    return;
  }
  if (level === 'warn') {
    logger.warn(payload, input.message ?? `${input.spanName} ${input.stage}`);
    return;
  }
  logger.info(payload, input.message ?? `${input.spanName} ${input.stage}`);
}
