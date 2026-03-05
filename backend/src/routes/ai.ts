import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import { withAiInvocationTrace } from '../observability/ai-trace';
import { resolveModelSelection } from '../providers/model-selection';
import { summarizeResult, maskErrorForApi, toProviderCredentialUsage } from '../providers/router';
import type { ProviderName } from '../providers/types';
import { buildRetrievalSystemInstruction, retrieveWebEvidence } from '../retrieval/adapter-router';
import {
  buildGroundingSystemInstruction,
  ensureGroundingSourcesSection,
  extractGroundingClaimsFromText,
  extractGroundingSourcesFromText,
  mergeGroundingSources,
  mergeSystemPrompt
} from '../retrieval/grounding';
import { buildGroundingUnavailableMessage, resolveGroundingPolicy, toGroundingUnavailableCode } from '../retrieval/policy-router';
import {
  buildGroundingQualityBlockedMessage,
  classifyGroundingGateResult,
  evaluateGroundingQualityGate,
  normalizeGroundingQualityReasons
} from '../retrieval/quality-gate';
import { generateQueryRewriteCandidates } from '../retrieval/query-rewrite';
import {
  buildRetrievalQualityBlockedMessage,
  evaluateRetrievalQualityGate,
  normalizeRetrievalQualityReasons
} from '../retrieval/retrieval-quality-gate';
import { buildLanguageSystemInstruction } from '../retrieval/language-policy';
import {
  buildFallbackNewsFactsFromSources,
  buildNewsFactExtractionPrompt,
  buildNewsFactExtractionSystemInstruction,
  ensureFactDomainCoverage,
  extractNewsFactsFromOutput,
  renderNewsBriefingFromFacts
} from '../retrieval/news-briefing';
import type { RouteContext } from './types';

const AiRespondSchema = z.object({
  prompt: z.string().min(1),
  system_prompt: z.string().optional(),
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).optional(),
  strict_provider: z.boolean().optional(),
  task_type: z
    .enum(['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'])
    .default('chat'),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().max(32000).optional()
});

const QUALITY_SOFT_GATE_ENABLED = process.env.JARVIS_FF_ASSISTANT_QUALITY_SOFT_GATE_V2 !== '0';

export async function aiRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.post('/api/v1/ai/respond', async (request, reply) => {
    const parsed = AiRespondSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid AI respond payload', parsed.error.flatten());
    }

    const resolvedCredentials = await ctx.resolveRequestProviderCredentials(request);
    const credentialsByProvider = resolvedCredentials.credentialsByProvider;
    const userId = ctx.resolveRequestUserId(request);
    const modelSelection = await resolveModelSelection({
      store: ctx.store,
      userId,
      featureKey: 'assistant_chat',
      override: {
        provider: parsed.data.provider,
        strictProvider: parsed.data.strict_provider,
        model: parsed.data.model
      }
    });

    const grounding = resolveGroundingPolicy({
      prompt: parsed.data.prompt,
      taskType: parsed.data.task_type
    });
    const languagePolicy = buildLanguageSystemInstruction(parsed.data.prompt);
    const providerAvailability = ctx.providerRouter.listAvailability(credentialsByProvider);
    const externalProviderEnabled = providerAvailability.some((item) => item.enabled && item.provider !== 'local');
    const localProviderEnabled = providerAvailability.some((item) => item.provider === 'local' && item.enabled);
    const strictLocalOnly = modelSelection.provider === 'local' && modelSelection.strictProvider;
    const shouldRunGroundedRetrieval = grounding.requiresGrounding;
    let retrievalPack: Awaited<ReturnType<typeof retrieveWebEvidence>> | null = null;
    if (shouldRunGroundedRetrieval) {
      retrievalPack = await retrieveWebEvidence({
        prompt: parsed.data.prompt,
        rewrittenQueries: generateQueryRewriteCandidates({
          prompt: parsed.data.prompt,
          maxVariants: 4
        }),
        maxItems: 8
      });
    }
    const retrievalQualityGate = retrievalPack
      ? evaluateRetrievalQualityGate({
          decision: grounding,
          evidence: retrievalPack
        })
      : null;
    const retrievalGateBlocked = Boolean(retrievalQualityGate && !retrievalQualityGate.passed);
    const canUseLocalGroundedFallback = Boolean(
      retrievalPack && retrievalPack.sources.length > 0 && localProviderEnabled && !retrievalGateBlocked
    );
    const canUseRetrievalOnlyFallback = Boolean(
      retrievalPack && retrievalPack.sources.length > 0 && !retrievalGateBlocked
    );
    const canServeGroundedRequest = canUseLocalGroundedFallback || canUseRetrievalOnlyFallback;

    if (grounding.requiresGrounding && (!externalProviderEnabled || strictLocalOnly) && !canServeGroundedRequest) {
      const errorCode = retrievalGateBlocked ? 'INSUFFICIENT_EVIDENCE' : toGroundingUnavailableCode(grounding);
      const blockedMessage =
        retrievalGateBlocked && retrievalQualityGate
          ? buildRetrievalQualityBlockedMessage(retrievalQualityGate)
          : buildGroundingUnavailableMessage(grounding);
      return sendError(reply, request, 503, 'INTERNAL_ERROR', blockedMessage, {
        reason: errorCode,
        grounding_policy: grounding.policy,
        grounding_reasons: grounding.reasons,
        retrieval_quality_gate: retrievalQualityGate,
        required_external_providers: ['openai', 'gemini', 'anthropic'],
        availability: providerAvailability.map((item) => ({
          provider: item.provider,
          enabled: item.enabled
        }))
      });
    }

    try {
      const useRetrievalOnlyFallback =
        grounding.requiresGrounding &&
        canUseRetrievalOnlyFallback &&
        (!externalProviderEnabled || strictLocalOnly) &&
        !localProviderEnabled;
      const useStructuredLocalNewsFlow = Boolean(canUseLocalGroundedFallback && grounding.signals.news);
      const groundingInstruction = useStructuredLocalNewsFlow ? '' : buildGroundingSystemInstruction(grounding);
      const retrievalInstruction = useStructuredLocalNewsFlow ? '' : retrievalPack ? buildRetrievalSystemInstruction(retrievalPack) : '';
      const strictFactualTemperature = Math.min(parsed.data.temperature ?? 0.2, 0.4);
      const strictFactualMaxTokens = Math.min(parsed.data.max_output_tokens ?? 1200, 1800);
      const generationPrompt = useStructuredLocalNewsFlow
        ? buildNewsFactExtractionPrompt({
            userPrompt: parsed.data.prompt,
            sources: retrievalPack?.sources ?? []
          })
        : parsed.data.prompt;
      const generationSystemPrompt = useStructuredLocalNewsFlow
        ? mergeSystemPrompt(
            parsed.data.system_prompt,
            buildNewsFactExtractionSystemInstruction(languagePolicy.expectedLanguage)
          )
        : mergeSystemPrompt(
            mergeSystemPrompt(
              mergeSystemPrompt(parsed.data.system_prompt, groundingInstruction),
              retrievalInstruction
            ),
            languagePolicy.instruction
          );
      const routed = useRetrievalOnlyFallback
        ? null
        : await withAiInvocationTrace({
            store: ctx.store,
            env: ctx.env,
            userId,
            featureKey: 'assistant_chat',
            taskType: parsed.data.task_type,
            requestProvider: modelSelection.provider,
            requestModel: modelSelection.model,
            traceId: ctx.resolveRequestTraceId(request),
            contextRefs: {
              route: '/api/v1/ai/respond',
              model_selection_source: modelSelection.source
            },
            run: () =>
              ctx.providerRouter.generate({
                prompt: generationPrompt,
                systemPrompt: generationSystemPrompt,
                provider: modelSelection.provider,
                strictProvider: modelSelection.strictProvider,
                credentialsByProvider,
                traceId: ctx.resolveRequestTraceId(request),
                onSpanEvent: (event) => {
                  request.log.info(
                    {
                      trace_id: event.traceId,
                      provider: event.provider,
                      success: event.success,
                      latency_ms: event.latencyMs,
                      error: event.error
                    },
                    event.name
                  );
                },
                taskType: parsed.data.task_type,
                model: modelSelection.model ?? undefined,
                temperature: grounding.requiresGrounding ? strictFactualTemperature : parsed.data.temperature,
                topP: grounding.requiresGrounding ? 0.9 : undefined,
                stop: grounding.requiresGrounding ? ['<|im_start|>', '<|im_end|>', '<|endoftext|>'] : undefined,
                maxOutputTokens: grounding.requiresGrounding ? strictFactualMaxTokens : parsed.data.max_output_tokens,
                excludeProviders: grounding.requiresGrounding && !canUseLocalGroundedFallback ? ['local'] : undefined
              })
          });
      const groundedLocalViolation =
        grounding.requiresGrounding && routed?.result.provider === 'local' && !canUseLocalGroundedFallback;
      const hasTemplateArtifact = routed
        ? /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/u.test(routed.result.outputText)
        : false;
      const extractedFacts = useStructuredLocalNewsFlow
        ? extractNewsFactsFromOutput(
            routed?.result.outputText ?? '',
            retrievalPack?.sources ?? [],
            5,
            languagePolicy.expectedLanguage
          )
        : null;
      const fallbackFacts =
        useStructuredLocalNewsFlow && extractedFacts && extractedFacts.facts.length === 0
          ? buildFallbackNewsFactsFromSources({
              sources: retrievalPack?.sources ?? [],
              expectedLanguage: languagePolicy.expectedLanguage,
              maxFacts: 5
            })
          : [];
      const structuredFacts = extractedFacts && extractedFacts.facts.length > 0 ? extractedFacts.facts : fallbackFacts;
      const diversifiedFacts =
        useStructuredLocalNewsFlow && structuredFacts.length > 0
          ? ensureFactDomainCoverage({
              facts: structuredFacts,
              sources: retrievalPack?.sources ?? [],
              expectedLanguage: languagePolicy.expectedLanguage,
              maxFacts: 5
            })
          : structuredFacts;
      const renderedNewsBriefingFromModel =
        diversifiedFacts.length > 0
          ? renderNewsBriefingFromFacts({
              facts: diversifiedFacts,
              sources: retrievalPack?.sources ?? [],
              expectedLanguage: languagePolicy.expectedLanguage,
              retrievedAt: new Date().toISOString()
            })
          : '';
      const retrievalOnlyFacts = useRetrievalOnlyFallback
        ? ensureFactDomainCoverage({
            facts: buildFallbackNewsFactsFromSources({
              sources: retrievalPack?.sources ?? [],
              expectedLanguage: languagePolicy.expectedLanguage,
              maxFacts: 5
            }),
            sources: retrievalPack?.sources ?? [],
            expectedLanguage: languagePolicy.expectedLanguage,
            maxFacts: 5
          })
        : [];
      const retrievalOnlyOutput =
        useRetrievalOnlyFallback && retrievalOnlyFacts.length > 0
          ? renderNewsBriefingFromFacts({
              facts: retrievalOnlyFacts,
              sources: retrievalPack?.sources ?? [],
              expectedLanguage: languagePolicy.expectedLanguage,
              retrievedAt: new Date().toISOString()
            })
          : '';
      const renderedNewsBriefing = retrievalOnlyOutput || renderedNewsBriefingFromModel;
      const candidateOutputText = renderedNewsBriefing || (routed?.result.outputText ?? '');
      const modelSources = extractGroundingSourcesFromText(candidateOutputText);
      const sources = mergeGroundingSources(retrievalPack?.sources ?? [], modelSources);
      const outputWithSources = ensureGroundingSourcesSection(candidateOutputText, sources);
      const claims = extractGroundingClaimsFromText(outputWithSources, sources);
      const groundingGate = evaluateGroundingQualityGate({
        decision: grounding,
        sources,
        claims,
        hasTemplateArtifact,
        outputText: candidateOutputText,
        expectedLanguage: languagePolicy.expectedLanguage
      });
      const augmentedReasons = [...groundingGate.reasons];
      if (useStructuredLocalNewsFlow && extractedFacts && extractedFacts.facts.length === 0 && fallbackFacts.length === 0) {
        augmentedReasons.push(extractedFacts.parseFailed ? 'structured_fact_extraction_failed' : 'structured_fact_empty');
      }
      const uniqueReasons = Array.from(new Set(augmentedReasons));
      const normalizedReasonCodes = normalizeGroundingQualityReasons(uniqueReasons);
      const effectiveGate = normalizedReasonCodes.length === groundingGate.reasons.length
        ? groundingGate
        : {
            ...groundingGate,
            passed: normalizedReasonCodes.length === 0,
            reasons: normalizedReasonCodes
          };
      const needsRealtimeEvidence = grounding.signals.news || grounding.signals.recency;
      const missingRealtimeEvidence =
        grounding.requiresGrounding && needsRealtimeEvidence && (retrievalPack?.sources.length ?? 0) === 0;
      const normalizedQualityReasons = normalizeGroundingQualityReasons(
        Array.from(
          new Set([
            ...effectiveGate.reasons,
            ...(missingRealtimeEvidence ? ['insufficient_retrieval_sources'] : [])
          ])
        )
      );
      const baseGateResult = classifyGroundingGateResult(normalizedQualityReasons);
      const gateResult =
        groundedLocalViolation || missingRealtimeEvidence
          ? 'hard_fail'
          : !QUALITY_SOFT_GATE_ENABLED && normalizedQualityReasons.length > 0
            ? 'hard_fail'
            : baseGateResult;
      const blockedByQuality = gateResult === 'hard_fail';
      const softenedByQualityPolicy = QUALITY_SOFT_GATE_ENABLED && gateResult === 'soft_warn';
      const blockedReasonCodes = groundedLocalViolation
        ? ['grounding_local_violation', ...normalizedQualityReasons]
        : normalizedQualityReasons;
      const output = blockedByQuality
        ? missingRealtimeEvidence && retrievalQualityGate
          ? buildRetrievalQualityBlockedMessage(retrievalQualityGate)
          : buildGroundingQualityBlockedMessage({
              ...effectiveGate,
              passed: false,
              reasons: blockedReasonCodes
            })
        : outputWithSources;
      const sourceDomains = Array.from(new Set(sources.map((item) => item.domain)));
      const fallbackTraceTag =
        useRetrievalOnlyFallback
          ? 'retrieval_only_fallback'
          : useStructuredLocalNewsFlow && renderedNewsBriefing.length === 0 && (routed?.result.outputText.length ?? 0) > 0
          ? 'raw_model_output_fallback'
          : null;
      const normalizedRetrievalReasonCodes = retrievalQualityGate
        ? normalizeRetrievalQualityReasons(retrievalQualityGate.reasons)
        : [];
      const freshnessRatio = retrievalQualityGate?.metrics.freshnessRatio ?? null;
      const responseProvider = routed?.result.provider ?? 'local';
      const responseModel = routed?.result.model ?? 'retrieval-fallback-v1';
      const responseUsage = routed?.result.usage;
      const responseCredential =
        routed?.result.credential ?? toProviderCredentialUsage(credentialsByProvider[responseProvider as ProviderName]);
      const responseAttempts =
        routed?.attempts ?? [{ provider: 'local', status: 'skipped' as const, error: 'retrieval_only_fallback' }];
      const responseSelection =
        routed?.selection ?? {
          strategy: 'requested_provider' as const,
          taskType: parsed.data.task_type,
          orderedProviders: ['local'] as const,
          reason: 'retrieval_only_fallback_without_model_provider'
        };
      const responseUsedFallback = routed?.usedFallback ?? true;

      return sendSuccess(reply, request, 200, {
        ...summarizeResult({
          provider: responseProvider,
          model: responseModel,
          usage: responseUsage,
          outputText: output,
          credential: responseCredential
        }),
        credential: {
          source: responseCredential.source,
          selected_credential_mode: responseCredential.selectedCredentialMode,
          credential_priority: responseCredential.credentialPriority,
          auth_access_token_expires_at: responseCredential.authAccessTokenExpiresAt
        },
        attempts: responseAttempts,
        used_fallback: responseUsedFallback,
        selection: responseSelection,
        grounding: {
          policy: grounding.policy,
          required: grounding.requiresGrounding,
          reasons: grounding.reasons,
          status: blockedByQuality
            ? 'blocked_due_to_quality_gate'
            : gateResult === 'soft_warn'
              ? 'soft_warn'
              : useRetrievalOnlyFallback
                ? 'served_with_limits'
              : grounding.requiresGrounding && retrievalQualityGate && !retrievalQualityGate.passed
                ? 'served_with_limits'
                : grounding.requiresGrounding
                  ? 'provider_only'
                  : 'not_required',
          render_mode: 'user_mode',
          sources,
          claims,
          source_count: sources.length,
          domain_count: sourceDomains.length,
          freshness_ratio: freshnessRatio,
          quality_gate_code: normalizedQualityReasons,
          retrieval_quality_gate_code: normalizedRetrievalReasonCodes,
          quality_gate_result: gateResult,
          quality_gate_softened: softenedByQualityPolicy,
          fallback_trace_tag: fallbackTraceTag,
          quality_gate: {
            passed: gateResult !== 'hard_fail',
            reasons: normalizedQualityReasons
          },
          quality: {
            gateResult,
            reasons: normalizedQualityReasons,
            softened: softenedByQualityPolicy,
            languageAligned: !normalizedQualityReasons.includes('language_mismatch'),
            claimCitationCoverage: effectiveGate.metrics.claimCitationCoverage ?? 0
          },
          retrieval_quality_gate: retrievalQualityGate,
          language: {
            expected: languagePolicy.expectedLanguage,
            detected: groundingGate.metrics.detectedLanguage,
            score: groundingGate.metrics.languageAlignmentScore
          }
        },
        delivery: {
          mode: gateResult === 'pass' && !useRetrievalOnlyFallback ? 'normal' : 'degraded',
          contextId: null,
          revision: 0
        }
      });
    } catch (error) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'all providers failed', {
        reason: maskErrorForApi(error)
      });
    }
  });
}
