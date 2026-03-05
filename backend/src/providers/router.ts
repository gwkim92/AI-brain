import type {
  LlmProvider,
  ProviderAttempt,
  ProviderAvailability,
  ProviderCredentialUsage,
  ProviderCredentialsByProvider,
  ProviderName,
  ProviderResolvedCredential,
  ProviderRouteResult,
  RoutingTaskType,
  ProviderGenerateRequest,
  ProviderGenerateResult
} from './types';
import { getPolicyScoresForTask } from './task-model-policy';
import { redactSecretsInText } from '../lib/redaction';

export type ProviderRouterRequest = ProviderGenerateRequest & {
  provider?: ProviderName | 'auto';
  strictProvider?: boolean;
  excludeProviders?: ProviderName[];
};

export class ProviderRoutingError extends Error {
  readonly attempts: ProviderAttempt[];
  readonly code = 'ALL_PROVIDERS_FAILED';

  constructor(attempts: ProviderAttempt[]) {
    super(
      `all providers failed: ${attempts
        .map((item) => `${item.provider}:${item.status}${item.error ? `(${item.error})` : ''}`)
        .join(', ')}`
    );
    this.name = 'ProviderRoutingError';
    this.attempts = attempts;
  }
}

const DEFAULT_TIE_ORDER: ProviderName[] = ['openai', 'anthropic', 'gemini', 'local'];

const FALLBACK_BASE_SCORES: Record<RoutingTaskType, Record<ProviderName, number>> = {
  chat: { openai: 1.0, anthropic: 0.92, gemini: 0.86, local: 0.74 },
  execute: { openai: 1.0, anthropic: 0.95, gemini: 0.9, local: 0.8 },
  council: { anthropic: 1.0, openai: 0.98, gemini: 0.93, local: 0.78 },
  code: { openai: 1.0, local: 0.97, anthropic: 0.88, gemini: 0.84 },
  compute: { openai: 1.0, gemini: 0.96, anthropic: 0.9, local: 0.82 },
  long_run: { openai: 1.0, anthropic: 0.98, gemini: 0.92, local: 0.8 },
  high_risk: { anthropic: 1.0, openai: 0.96, gemini: 0.9, local: 0.72 },
  radar_review: { openai: 1.0, gemini: 0.95, anthropic: 0.92, local: 0.75 },
  upgrade_execution: { openai: 1.0, anthropic: 0.98, gemini: 0.9, local: 0.83 }
};

const COST_BONUS: Record<ProviderName, number> = {
  openai: 0.04,
  gemini: 0.08,
  anthropic: 0.05,
  local: 0.12
};

export type ProviderRuntimeStats = {
  attempts: number;
  successes: number;
  failures: number;
  avgLatencyMs: number;
  successEma: number;
  latencyEma: number;
  lastAttemptAtMs: number | null;
};

export function toProviderCredentialUsage(
  credential: ProviderResolvedCredential | undefined
): ProviderCredentialUsage {
  return {
    source: credential?.source ?? 'none',
    selectedCredentialMode: credential?.selectedCredentialMode ?? null,
    credentialPriority: credential?.credentialPriority ?? 'api_key_first',
    authAccessTokenExpiresAt: credential?.authAccessTokenExpiresAt ?? null
  };
}

export class ProviderRouter {
  private readonly providerStats: Record<ProviderName, ProviderRuntimeStats>;
  private readonly emaAlpha = 0.3;
  private explorationRate = 0.05;
  private usePolicies = false;

  constructor(private readonly providers: Record<ProviderName, LlmProvider>) {
    this.providerStats = {
      openai: { attempts: 0, successes: 0, failures: 0, avgLatencyMs: 0, successEma: 0.5, latencyEma: 0, lastAttemptAtMs: null },
      gemini: { attempts: 0, successes: 0, failures: 0, avgLatencyMs: 0, successEma: 0.5, latencyEma: 0, lastAttemptAtMs: null },
      anthropic: { attempts: 0, successes: 0, failures: 0, avgLatencyMs: 0, successEma: 0.5, latencyEma: 0, lastAttemptAtMs: null },
      local: { attempts: 0, successes: 0, failures: 0, avgLatencyMs: 0, successEma: 0.5, latencyEma: 0, lastAttemptAtMs: null }
    };
  }

  setExplorationRate(rate: number): void {
    this.explorationRate = Math.max(0, Math.min(1, rate));
  }

  enablePolicyRouting(): void {
    this.usePolicies = true;
  }

  listAvailability(credentialsByProvider?: ProviderCredentialsByProvider): ProviderAvailability[] {
    return this.orderedProviderNames().map((name) => this.resolveAvailability(name, credentialsByProvider));
  }

  setProviderApiKey(provider: ProviderName, apiKey?: string): void {
    this.providers[provider].setApiKey?.(apiKey);
  }

  getRuntimeStats(): Record<ProviderName, ProviderRuntimeStats> {
    return { ...this.providerStats };
  }

  loadRuntimeStats(entries: Array<{
    provider: string;
    taskType: string;
    successCount: number;
    failureCount: number;
    avgLatencyMs: number;
    successEma?: number;
    latencyEma?: number;
  }>): void {
    for (const entry of entries) {
      const name = entry.provider as ProviderName;
      if (this.providerStats[name]) {
        const total = entry.successCount + entry.failureCount;
        this.providerStats[name] = {
          attempts: total,
          successes: entry.successCount,
          failures: entry.failureCount,
          avgLatencyMs: entry.avgLatencyMs,
          successEma: entry.successEma ?? (total > 0 ? entry.successCount / total : 0.5),
          latencyEma: entry.latencyEma ?? entry.avgLatencyMs,
          lastAttemptAtMs: this.providerStats[name].lastAttemptAtMs
        };
      }
    }
  }

  listRuntimeStats(): Array<{
    provider: ProviderName;
    enabled: boolean;
    model: string | null;
    reason?: string;
    attempts: number;
    successes: number;
    failures: number;
    avgLatencyMs: number;
    successRatePct: number;
    lastAttemptAt: string | null;
  }> {
    return this.orderedProviderNames().map((providerName) => {
      const availability = this.providers[providerName].availability();
      const runtime = this.providerStats[providerName];
      const successRatePct =
        runtime.attempts > 0 ? Number(((runtime.successes / runtime.attempts) * 100).toFixed(1)) : 0;

      return {
        provider: providerName,
        enabled: availability.enabled,
        model: availability.model ?? null,
        reason: availability.reason,
        attempts: runtime.attempts,
        successes: runtime.successes,
        failures: runtime.failures,
        avgLatencyMs: Number(runtime.avgLatencyMs.toFixed(3)),
        successRatePct,
        lastAttemptAt: runtime.lastAttemptAtMs ? new Date(runtime.lastAttemptAtMs).toISOString() : null
      };
    });
  }

  async generate(request: ProviderRouterRequest): Promise<ProviderRouteResult> {
    const routePlan = this.resolveOrder(request);
    const order = routePlan.order;
    const attempts: ProviderAttempt[] = [];
    const excludedProviders = new Set<ProviderName>(request.excludeProviders ?? []);

    for (const providerName of order) {
      const attemptCredential = toProviderCredentialUsage(request.credentialsByProvider?.[providerName]);
      if (excludedProviders.has(providerName)) {
        attempts.push({
          provider: providerName,
          status: 'skipped',
          error: 'excluded_by_request',
          credential: attemptCredential
        });
        continue;
      }

      const provider = this.providers[providerName];
      const availability = this.resolveAvailability(providerName, request.credentialsByProvider);

      if (!availability.enabled) {
        attempts.push({
          provider: providerName,
          status: 'skipped',
          error: availability.reason ?? 'provider_disabled',
          credential: attemptCredential
        });
        continue;
      }

      const startedAt = Date.now();
      request.onSpanEvent?.({
        name: 'provider.call.start',
        provider: providerName,
        traceId: request.traceId
      });

      try {
        const result = await provider.generate(request);
        const routedResult: ProviderGenerateResult = {
          ...result,
          credential: toProviderCredentialUsage(request.credentialsByProvider?.[providerName])
        };
        const latencyMs = Date.now() - startedAt;
        this.recordProviderAttempt(providerName, 'success', Date.now() - startedAt);
        attempts.push({
          provider: providerName,
          status: 'success',
          latencyMs,
          credential: attemptCredential
        });
        request.onSpanEvent?.({
          name: 'provider.call.complete',
          provider: providerName,
          traceId: request.traceId,
          success: true,
          latencyMs
        });

        return {
          result: routedResult,
          attempts,
          usedFallback: attempts.filter((item) => item.status === 'failed' || item.status === 'skipped').length > 0,
          selectedCredential: routedResult.credential,
          selection: routePlan.selection
        };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        this.recordProviderAttempt(providerName, 'failed', Date.now() - startedAt);
        attempts.push({
          provider: providerName,
          status: 'failed',
          latencyMs,
          error: message,
          credential: attemptCredential
        });
        request.onSpanEvent?.({
          name: 'provider.call.complete',
          provider: providerName,
          traceId: request.traceId,
          success: false,
          latencyMs,
          error: message
        });
      }
    }

    throw new ProviderRoutingError(attempts);
  }

  private resolveOrder(
    request: ProviderRouterRequest
  ): {
    order: ProviderName[];
    selection: ProviderRouteResult['selection'];
  } {
    const requestedProvider = request.provider;
    const taskType = request.taskType ?? 'chat';

    if (requestedProvider && requestedProvider !== 'auto') {
      if (request.strictProvider) {
        return {
          order: [requestedProvider],
          selection: {
            strategy: 'requested_provider',
            taskType,
            orderedProviders: [requestedProvider],
            reason: 'strict provider requested by user'
          }
        };
      }

      const fallbackPlan = this.buildAutoOrder(taskType, request);
      const order = [requestedProvider, ...fallbackPlan.order.filter((item) => item !== requestedProvider)];
      return {
        order,
        selection: {
          strategy: 'requested_provider',
          taskType,
          orderedProviders: order,
          scores: fallbackPlan.scores,
          reason: `requested provider pinned first; fallback ranked by orchestrator (${fallbackPlan.reason})`
        }
      };
    }

    const autoPlan = this.buildAutoOrder(taskType, request);
    return {
      order: autoPlan.order,
      selection: {
        strategy: 'auto_orchestrator',
        taskType,
        orderedProviders: autoPlan.order,
        scores: autoPlan.scores,
        reason: autoPlan.reason
      }
    };
  }

  private getDomainFit(taskType: RoutingTaskType, providerName: ProviderName): number {
    if (this.usePolicies) {
      const policyScores = getPolicyScoresForTask(taskType);
      const found = policyScores.find((p) => p.provider === providerName);
      if (found) return found.score;
    }
    return FALLBACK_BASE_SCORES[taskType]?.[providerName] ?? 0.5;
  }

  private buildAutoOrder(
    taskType: RoutingTaskType,
    request: ProviderRouterRequest
  ): {
    order: ProviderName[];
    scores: Array<{
      provider: ProviderName;
      score: number;
      breakdown: {
        domain_fit: number;
        recent_success: number;
        latency: number;
        cost: number;
        context_fit: number;
        prompt_fit: number;
        availability_penalty: number;
      };
    }>;
    reason: string;
  } {
    const promptText = `${request.systemPrompt ?? ''}\n${request.prompt ?? ''}`.toLowerCase();
    const promptBoost = this.computePromptBoost(taskType, promptText);

    const scored = this.orderedProviderNames().map((providerName) => {
      const availability = this.resolveAvailability(providerName, request.credentialsByProvider);
      const runtime = this.providerStats[providerName];

      const domainFit = this.getDomainFit(taskType, providerName);
      const availabilityPenalty = availability.enabled ? 0 : -10;

      const recentSuccess = runtime.attempts > 0
        ? (runtime.successEma - 0.5) * 0.9
        : 0;

      const latency = runtime.attempts > 0
        ? -Math.min(0.35, runtime.latencyEma / 3000)
        : 0;

      const cost = COST_BONUS[providerName];
      const contextFit = this.computeContextFit(providerName, taskType, promptText.length);
      const promptFit = promptBoost[providerName] ?? 0;

      const score = domainFit + recentSuccess + latency + cost + contextFit + promptFit + availabilityPenalty;

      return {
        provider: providerName,
        score: Number(score.toFixed(6)),
        breakdown: {
          domain_fit: Number(domainFit.toFixed(6)),
          recent_success: Number(recentSuccess.toFixed(6)),
          latency: Number(latency.toFixed(6)),
          cost: Number(cost.toFixed(6)),
          context_fit: Number(contextFit.toFixed(6)),
          prompt_fit: Number(promptFit.toFixed(6)),
          availability_penalty: Number(availabilityPenalty.toFixed(6))
        }
      };
    });

    const tieBreaker = new Map(DEFAULT_TIE_ORDER.map((provider, index) => [provider, index] as const));
    scored.sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return (tieBreaker.get(left.provider) ?? 99) - (tieBreaker.get(right.provider) ?? 99);
    });

    let order = scored.map((item) => item.provider);

    if (this.explorationRate > 0 && Math.random() < this.explorationRate) {
      const available = order.filter((name) => this.resolveAvailability(name, request.credentialsByProvider).enabled);
      if (available.length > 1) {
        const randomIdx = Math.floor(Math.random() * available.length);
        const chosen = available[randomIdx]!;
        order = [chosen, ...order.filter((p) => p !== chosen)];
      }
    }

    const top = scored[0];
    const routingSource = this.usePolicies ? 'policy' : 'fallback';
    const reason = top
      ? `top=${top.provider} score=${top.score.toFixed(3)} task=${taskType} source=${routingSource}`
      : `no provider candidate for task=${taskType}`;

    return {
      order,
      scores: scored,
      reason
    };
  }

  private computePromptBoost(
    taskType: RoutingTaskType,
    promptText: string
  ): Partial<Record<ProviderName, number>> {
    const boost: Partial<Record<ProviderName, number>> = {};

    const looksLikeCode =
      taskType === 'code' ||
      /```|typescript|javascript|python|java|go|rust|sql|stack trace|exception|compile|lint|unit test|integration test|pytest|vitest|jest/u.test(
        promptText
      );
    if (looksLikeCode) {
      boost.openai = (boost.openai ?? 0) + 0.18;
      boost.local = (boost.local ?? 0) + 0.12;
    }

    const looksAnalytical = /tradeoff|risk|policy|approve|security|audit|architecture|compliance/u.test(promptText);
    if (looksAnalytical) {
      boost.anthropic = (boost.anthropic ?? 0) + 0.15;
      boost.openai = (boost.openai ?? 0) + 0.08;
    }

    const looksMathHeavy = taskType === 'compute' || /equation|matrix|proof|statistic|optimiz|regression/u.test(promptText);
    if (looksMathHeavy) {
      boost.gemini = (boost.gemini ?? 0) + 0.13;
      boost.openai = (boost.openai ?? 0) + 0.06;
    }

    return boost;
  }

  private computeContextFit(provider: ProviderName, taskType: RoutingTaskType, promptLength: number): number {
    const longContext = promptLength >= 1800;
    const mediumContext = promptLength >= 700;
    const shortContext = promptLength <= 180;

    if (taskType === 'code') {
      if (provider === 'openai' && mediumContext) return 0.08;
      if (provider === 'local' && shortContext) return 0.07;
      return 0;
    }

    if (taskType === 'council' || taskType === 'high_risk') {
      if ((provider === 'anthropic' || provider === 'openai') && longContext) return 0.09;
      if (provider === 'local' && longContext) return -0.06;
      return 0;
    }

    if (taskType === 'compute') {
      if (provider === 'gemini' && mediumContext) return 0.07;
      return 0;
    }

    if (shortContext && provider === 'local') {
      return 0.05;
    }

    if (longContext && provider === 'openai') {
      return 0.04;
    }

    return 0;
  }

  private recordProviderAttempt(provider: ProviderName, status: 'success' | 'failed', latencyMs: number): void {
    const current = this.providerStats[provider];
    const attempts = current.attempts + 1;
    const avgLatencyMs = attempts === 1 ? latencyMs : (current.avgLatencyMs * current.attempts + latencyMs) / attempts;

    const successSignal = status === 'success' ? 1.0 : 0.0;
    const successEma = current.attempts === 0
      ? successSignal
      : this.emaAlpha * successSignal + (1 - this.emaAlpha) * current.successEma;
    const latencyEma = current.attempts === 0
      ? latencyMs
      : this.emaAlpha * latencyMs + (1 - this.emaAlpha) * current.latencyEma;

    this.providerStats[provider] = {
      attempts,
      successes: current.successes + (status === 'success' ? 1 : 0),
      failures: current.failures + (status === 'failed' ? 1 : 0),
      avgLatencyMs,
      successEma,
      latencyEma,
      lastAttemptAtMs: Date.now()
    };
  }

  private orderedProviderNames(): ProviderName[] {
    return ['openai', 'gemini', 'anthropic', 'local'];
  }

  private resolveAvailability(
    providerName: ProviderName,
    credentialsByProvider?: ProviderCredentialsByProvider
  ): ProviderAvailability {
    const base = this.providers[providerName].availability();
    const scoped = credentialsByProvider?.[providerName];
    if (!scoped) {
      return base;
    }

    if (scoped.source === 'none') {
      return base;
    }

    if (scoped.selectedCredentialMode === 'api_key') {
      const apiKey = scoped.apiKey?.trim();
      if (apiKey && apiKey.length > 0) {
        return {
          ...base,
          enabled: true,
          reason: undefined
        };
      }

      return {
        ...base,
        enabled: false,
        reason: 'missing_api_key'
      };
    }

    if (scoped.selectedCredentialMode === 'oauth_official') {
      const accessToken = scoped.oauthAccessToken?.trim();
      if (accessToken && accessToken.length > 0) {
        return {
          ...base,
          enabled: true,
          reason: undefined
        };
      }

      return {
        ...base,
        enabled: false,
        reason: 'missing_access_token'
      };
    }

    return base;
  }
}

export function maskErrorForApi(error: unknown): string {
  if (error instanceof ProviderRoutingError) {
    return redactSecretsInText(`${error.code}: ${error.message}`).slice(0, 500);
  }

  const message = error instanceof Error ? error.message : String(error);
  return redactSecretsInText(message).slice(0, 500);
}

export function extractProviderAttempts(error: unknown): ProviderAttempt[] {
  if (error instanceof ProviderRoutingError) {
    return error.attempts;
  }
  return [];
}

export function summarizeResult(result: ProviderGenerateResult): {
  provider: ProviderName;
  model: string;
  output: string;
  usage?: ProviderGenerateResult['usage'];
  credential?: ProviderGenerateResult['credential'];
} {
  return {
    provider: result.provider,
    model: result.model,
    output: result.outputText,
    usage: result.usage,
    credential: result.credential
  };
}
