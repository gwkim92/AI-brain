import type { AppEnv } from '../config/env';
import { redactSecretsInText, redactUnknown } from '../lib/redaction';
import { extractProviderAttempts, maskErrorForApi } from '../providers/router';
import type { ProviderRouteResult } from '../providers/types';
import type { JarvisStore, ModelControlFeatureKey } from '../store/types';

function redactAttempts(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return {};
    }
    return redactUnknown(entry) as Record<string, unknown>;
  });
}

export async function withAiInvocationTrace<T extends ProviderRouteResult>(input: {
  store: JarvisStore;
  env: AppEnv;
  userId: string;
  featureKey: ModelControlFeatureKey | 'diagnostic';
  taskType: string;
  requestProvider: 'openai' | 'gemini' | 'anthropic' | 'local' | 'auto';
  requestModel?: string | null;
  traceId?: string;
  contextRefs?: Record<string, unknown>;
  run: () => Promise<T>;
}): Promise<T> {
  const traceEnabled = input.env.AI_TRACE_LOGGING_ENABLED;
  const startedAt = Date.now();
  const traceRow = traceEnabled
    ? await input.store.createAiInvocationTrace({
        userId: input.userId,
        featureKey: input.featureKey,
        taskType: input.taskType,
        requestProvider: input.requestProvider,
        requestModel: input.requestModel ?? null,
        traceId: input.traceId ?? null,
        contextRefsJson: redactUnknown(input.contextRefs ?? {}) as Record<string, unknown>
      })
    : null;

  try {
    const result = await input.run();
    if (traceRow) {
      await input.store.completeAiInvocationTrace({
        id: traceRow.id,
        resolvedProvider: result.result.provider,
        resolvedModel: result.result.model,
        credentialMode: result.result.credential?.selectedCredentialMode ?? null,
        credentialSource: result.result.credential?.source ?? 'none',
        attemptsJson: redactAttempts(result.attempts),
        usedFallback: result.usedFallback,
        success: true,
        errorCode: null,
        errorMessageRedacted: null,
        latencyMs: Date.now() - startedAt
      });
    }
    return result;
  } catch (error) {
    if (traceRow) {
      await input.store.completeAiInvocationTrace({
        id: traceRow.id,
        resolvedProvider: null,
        resolvedModel: null,
        credentialMode: null,
        credentialSource: 'none',
        attemptsJson: redactAttempts(extractProviderAttempts(error)),
        usedFallback: extractProviderAttempts(error).length > 0,
        success: false,
        errorCode: 'PROVIDER_ROUTING_FAILED',
        errorMessageRedacted: redactSecretsInText(maskErrorForApi(error)),
        latencyMs: Date.now() - startedAt
      });
    }
    throw error;
  }
}
