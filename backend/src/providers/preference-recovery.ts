import type { ResolvedModelSelection } from './model-selection';
import { ProviderRouter, ProviderRoutingError, type ProviderRouterRequest } from './router';
import type { ProviderAttempt, ProviderRouteResult } from './types';

const RECOVERABLE_PROVIDER_FAILURE_PATTERNS = [
  /deactivated_workspace/u,
  /invalid_api_key/u,
  /missing_api_key/u,
  /invalid[_\s-]?grant/u,
  /revoked/u,
  /oauth/u,
  /unauthorized/u,
  /authentication/u,
  /credential/u,
  /workspace/u
];

function isRecoverablePreferenceFailure(error: string | undefined): boolean {
  if (typeof error !== 'string' || error.trim().length === 0) {
    return false;
  }
  return RECOVERABLE_PROVIDER_FAILURE_PATTERNS.some((pattern) => pattern.test(error));
}

function shouldRelaxPreferenceSelection(
  error: unknown,
  modelSelection: ResolvedModelSelection
): error is ProviderRoutingError {
  if (!(error instanceof ProviderRoutingError)) {
    return false;
  }

  if (modelSelection.source === 'request_override') {
    return false;
  }

  if (!modelSelection.strictProvider || modelSelection.provider === 'auto') {
    return false;
  }

  const failedAttempts = error.attempts.filter((attempt) => attempt.status === 'failed');
  if (failedAttempts.length === 0) {
    return false;
  }

  if (!failedAttempts.every((attempt) => attempt.provider === modelSelection.provider)) {
    return false;
  }

  return failedAttempts.every((attempt) => isRecoverablePreferenceFailure(attempt.error));
}

function mergeAttempts(primary: ProviderAttempt[], fallback: ProviderAttempt[]): ProviderAttempt[] {
  return [...primary, ...fallback];
}

export async function generateWithPreferenceRecovery(params: {
  providerRouter: ProviderRouter;
  request: ProviderRouterRequest;
  modelSelection: ResolvedModelSelection;
}): Promise<ProviderRouteResult> {
  try {
    return await params.providerRouter.generate(params.request);
  } catch (error) {
    if (!shouldRelaxPreferenceSelection(error, params.modelSelection)) {
      throw error;
    }

    const excludedProviders = Array.from(
      new Set<ProviderAttempt['provider']>([
        ...(params.request.excludeProviders ?? []),
        params.modelSelection.provider as ProviderAttempt['provider']
      ])
    );

    try {
      const fallbackResult = await params.providerRouter.generate({
        ...params.request,
        provider: 'auto',
        strictProvider: false,
        model: undefined,
        excludeProviders: excludedProviders
      });

      return {
        ...fallbackResult,
        attempts: mergeAttempts(error.attempts, fallbackResult.attempts),
        usedFallback: true,
        selection: fallbackResult.selection
          ? {
              ...fallbackResult.selection,
              reason: `preference provider ${params.modelSelection.provider} unavailable; ${fallbackResult.selection.reason ?? 'fell back to orchestrator'}`
            }
          : fallbackResult.selection
      };
    } catch (fallbackError) {
      if (fallbackError instanceof ProviderRoutingError) {
        throw new ProviderRoutingError(mergeAttempts(error.attempts, fallbackError.attempts));
      }
      throw fallbackError;
    }
  }
}
