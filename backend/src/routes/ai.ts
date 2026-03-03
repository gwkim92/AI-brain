import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/http';
import { summarizeResult, maskErrorForApi } from '../providers/router';
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
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).default('auto'),
  strict_provider: z.boolean().default(false),
  task_type: z
    .enum(['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'])
    .default('chat'),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().max(32000).optional()
});

export async function aiRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.post('/api/v1/ai/respond', async (request, reply) => {
    const parsed = AiRespondSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid AI respond payload', parsed.error.flatten());
    }

    const grounding = resolveGroundingPolicy({
      prompt: parsed.data.prompt,
      taskType: parsed.data.task_type
    });
    const languagePolicy = buildLanguageSystemInstruction(parsed.data.prompt);
    const providerAvailability = ctx.providerRouter.listAvailability();
    const externalProviderEnabled = providerAvailability.some((item) => item.enabled && item.provider !== 'local');
    const localProviderEnabled = providerAvailability.some((item) => item.provider === 'local' && item.enabled);
    const strictLocalOnly = parsed.data.provider === 'local' && parsed.data.strict_provider;
    const shouldTryNewsRetrievalFallback =
      grounding.requiresGrounding && grounding.signals.news && localProviderEnabled && (!externalProviderEnabled || strictLocalOnly);
    let retrievalPack: Awaited<ReturnType<typeof retrieveWebEvidence>> | null = null;
    if (shouldTryNewsRetrievalFallback) {
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

    if (grounding.requiresGrounding && (!externalProviderEnabled || strictLocalOnly) && !canUseLocalGroundedFallback) {
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
      const routed = await ctx.providerRouter.generate({
        prompt: generationPrompt,
        systemPrompt: generationSystemPrompt,
        provider: parsed.data.provider,
        strictProvider: parsed.data.strict_provider,
        taskType: parsed.data.task_type,
        model: parsed.data.model,
        temperature: grounding.requiresGrounding ? strictFactualTemperature : parsed.data.temperature,
        topP: grounding.requiresGrounding ? 0.9 : undefined,
        stop: grounding.requiresGrounding ? ['<|im_start|>', '<|im_end|>', '<|endoftext|>'] : undefined,
        maxOutputTokens: grounding.requiresGrounding ? strictFactualMaxTokens : parsed.data.max_output_tokens,
        excludeProviders: grounding.requiresGrounding && !canUseLocalGroundedFallback ? ['local'] : undefined
      });
      const groundedLocalViolation =
        grounding.requiresGrounding && routed.result.provider === 'local' && !canUseLocalGroundedFallback;
      const hasTemplateArtifact = /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/u.test(routed.result.outputText);
      const extractedFacts = useStructuredLocalNewsFlow
        ? extractNewsFactsFromOutput(
            routed.result.outputText,
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
      const renderedNewsBriefing =
        diversifiedFacts.length > 0
          ? renderNewsBriefingFromFacts({
              facts: diversifiedFacts,
              sources: retrievalPack?.sources ?? [],
              expectedLanguage: languagePolicy.expectedLanguage,
              retrievedAt: new Date().toISOString()
            })
          : '';
      const candidateOutputText = renderedNewsBriefing || routed.result.outputText;
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
      const blockedByQuality = groundedLocalViolation || (grounding.requiresGrounding && !effectiveGate.passed);
      const output = blockedByQuality ? buildGroundingQualityBlockedMessage(effectiveGate) : outputWithSources;
      const sourceDomains = Array.from(new Set(sources.map((item) => item.domain)));
      const fallbackTraceTag =
        useStructuredLocalNewsFlow && renderedNewsBriefing.length === 0 && routed.result.outputText.length > 0
          ? 'raw_model_output_fallback'
          : null;
      const normalizedRetrievalReasonCodes = retrievalQualityGate
        ? normalizeRetrievalQualityReasons(retrievalQualityGate.reasons)
        : [];
      const freshnessRatio = retrievalQualityGate?.metrics.freshnessRatio ?? null;

      return sendSuccess(reply, request, 200, {
        ...summarizeResult({
          ...routed.result,
          outputText: output
        }),
        attempts: routed.attempts,
        used_fallback: routed.usedFallback,
        selection: routed.selection,
        grounding: {
          policy: grounding.policy,
          required: grounding.requiresGrounding,
          reasons: grounding.reasons,
          status: blockedByQuality ? 'blocked_due_to_quality_gate' : grounding.requiresGrounding ? 'provider_only' : 'not_required',
          render_mode: 'user_mode',
          sources,
          claims,
          source_count: sources.length,
          domain_count: sourceDomains.length,
          freshness_ratio: freshnessRatio,
          quality_gate_code: effectiveGate.reasons,
          retrieval_quality_gate_code: normalizedRetrievalReasonCodes,
          fallback_trace_tag: fallbackTraceTag,
          quality_gate: {
            passed: effectiveGate.passed,
            reasons: effectiveGate.reasons
          },
          retrieval_quality_gate: retrievalQualityGate,
          language: {
            expected: languagePolicy.expectedLanguage,
            detected: groundingGate.metrics.detectedLanguage,
            score: groundingGate.metrics.languageAlignmentScore
          }
        }
      });
    } catch (error) {
      return sendError(reply, request, 503, 'INTERNAL_ERROR', 'all providers failed', {
        reason: maskErrorForApi(error)
      });
    }
  });
}
