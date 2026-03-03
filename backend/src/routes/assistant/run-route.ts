import type { FastifyInstance } from 'fastify';

import { runContextPipeline } from '../../context/pipeline';
import { evaluateEvalGate } from '../../evals/gate';
import { sendError, sendSuccess } from '../../lib/http';
import { embedAndStore } from '../../memory/embed';
import { extractProviderAttempts, maskErrorForApi } from '../../providers/router';
import { buildRetrievalSystemInstruction, retrieveWebEvidence } from '../../retrieval/adapter-router';
import {
  buildGroundingSystemInstruction,
  ensureGroundingSourcesSection,
  extractGroundingClaimsFromText,
  extractGroundingSourcesFromText,
  mergeGroundingSources,
  mergeSystemPrompt
} from '../../retrieval/grounding';
import { buildGroundingUnavailableMessage, resolveGroundingPolicy, toGroundingUnavailableCode } from '../../retrieval/policy-router';
import { generateQueryRewriteCandidates } from '../../retrieval/query-rewrite';
import {
  buildGroundingQualityBlockedMessage,
  evaluateGroundingQualityGate,
  normalizeGroundingQualityReasons
} from '../../retrieval/quality-gate';
import {
  buildRetrievalQualityBlockedMessage,
  evaluateRetrievalQualityGate,
  normalizeRetrievalQualityReasons
} from '../../retrieval/retrieval-quality-gate';
import { buildLanguageSystemInstruction } from '../../retrieval/language-policy';
import {
  buildFallbackNewsFactsFromSources,
  buildNewsFactExtractionPrompt,
  buildNewsFactExtractionSystemInstruction,
  ensureFactDomainCoverage,
  extractNewsFactsFromOutput,
  renderNewsBriefingFromFacts
} from '../../retrieval/news-briefing';
import { buildRadarQualityFallbackMessage, hasTemplateArtifact, resolveTaskIdForContext } from './helpers';
import { AssistantContextRunSchema } from './schemas';
import type { RouteContext } from '../types';
import { createSpanId, resolveAssistantContextTaskType } from '../types';

// --- Routes ---

export function registerAssistantContextRunRoute(app: FastifyInstance, ctx: RouteContext): void {
  const {
    store,
    providerRouter,
    notificationService,
    resolveRequestUserId,
    resolveRequestTraceId,
    assistantContextRunsInFlight
  } = ctx;

  app.post('/api/v1/assistant/contexts/:contextId/run', async (request, reply) => {
    const parsed = AssistantContextRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, request, 422, 'VALIDATION_ERROR', 'invalid assistant context run payload', parsed.error.flatten());
    }

    const contextId = (request.params as { contextId: string }).contextId;
    const userId = resolveRequestUserId(request);
    const traceId = resolveRequestTraceId(request);
    const context = await store.getAssistantContextById({
      userId,
      contextId
    });

    if (!context) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'assistant context not found');
    }

    if (context.status === 'completed' && !parsed.data.force_rerun) {
      return sendSuccess(reply, request, 200, context, {
        accepted: false,
        reason: 'already_completed'
      });
    }

    if (assistantContextRunsInFlight.has(contextId)) {
      return sendSuccess(reply, request, 202, context, {
        accepted: false,
        reason: 'already_running'
      });
    }

    const taskType = parsed.data.task_type ?? resolveAssistantContextTaskType(context.intent);
    const resolvedRunTaskId = context.taskId ?? (await resolveTaskIdForContext(store, userId, context.clientContextId));
    const prepared =
      parsed.data.force_rerun || context.status !== 'running'
        ? await store.updateAssistantContext({
            userId,
            contextId,
            status: 'running',
            taskId: resolvedRunTaskId ?? undefined,
            servedProvider: null,
            servedModel: null,
            usedFallback: false,
            selectionReason: null,
            output: '',
            error: null
          })
        : context;

    if (!prepared) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'assistant context not found');
    }

    const groundingDecision = resolveGroundingPolicy({
      prompt: prepared.prompt,
      intent: prepared.intent,
      taskType
    });
    const languagePolicy = buildLanguageSystemInstruction(prepared.prompt);
    const providerAvailability = providerRouter.listAvailability();
    const externalProviderEnabled = providerAvailability.some((item) => item.enabled && item.provider !== 'local');
    const localProviderEnabled = providerAvailability.some((item) => item.provider === 'local' && item.enabled);
    const strictLocalOnly = parsed.data.provider === 'local' && parsed.data.strict_provider;
    const shouldTryNewsRetrievalFallback =
      groundingDecision.requiresGrounding &&
      groundingDecision.signals.news &&
      localProviderEnabled &&
      (!externalProviderEnabled || strictLocalOnly);
    let retrievalPack: Awaited<ReturnType<typeof retrieveWebEvidence>> | null = null;
    if (shouldTryNewsRetrievalFallback) {
      retrievalPack = await retrieveWebEvidence({
        prompt: prepared.prompt,
        rewrittenQueries: generateQueryRewriteCandidates({
          prompt: prepared.prompt,
          maxVariants: 4
        }),
        maxItems: 8
      });
    }
    const retrievalQualityGate = retrievalPack
      ? evaluateRetrievalQualityGate({
          decision: groundingDecision,
          evidence: retrievalPack
        })
      : null;
    const retrievalGateBlocked = Boolean(retrievalQualityGate && !retrievalQualityGate.passed);
    const canUseLocalGroundedFallback = Boolean(
      retrievalPack && retrievalPack.sources.length > 0 && localProviderEnabled && !retrievalGateBlocked
    );

    if (groundingDecision.requiresGrounding && (!externalProviderEnabled || strictLocalOnly) && !canUseLocalGroundedFallback) {
      const blockedMessage =
        retrievalGateBlocked && retrievalQualityGate
          ? buildRetrievalQualityBlockedMessage(retrievalQualityGate)
          : buildGroundingUnavailableMessage(groundingDecision);
      const errorCode = retrievalGateBlocked ? 'INSUFFICIENT_EVIDENCE' : toGroundingUnavailableCode(groundingDecision);
      await store.replaceAssistantContextGroundingSources({
        userId,
        contextId: prepared.id,
        sources: []
      });
      await store.replaceAssistantContextGroundingClaims({
        userId,
        contextId: prepared.id,
        claims: []
      });
      const rejected = await store.updateAssistantContext({
        userId,
        contextId: prepared.id,
        status: 'failed',
        output: blockedMessage,
        error: errorCode
      });
      const effectiveTaskId = rejected?.taskId ?? prepared.taskId ?? resolvedRunTaskId ?? null;

      await store.appendAssistantContextEvent({
        userId,
        contextId: prepared.id,
        eventType: 'assistant.context.run.rejected',
        data: {
          task_type: taskType,
          reason: errorCode,
          grounding_policy: groundingDecision.policy,
          grounding_reasons: groundingDecision.reasons,
          retrieval_fallback_attempted: shouldTryNewsRetrievalFallback,
          retrieval_sources_count: retrievalPack?.sources.length ?? 0,
          retrieval_quality_gate: retrievalQualityGate,
          required_external_providers: ['openai', 'gemini', 'anthropic'],
          availability: providerAvailability.map((item) => ({
            provider: item.provider,
            enabled: item.enabled
          }))
        },
        traceId,
        spanId: createSpanId()
      });

      if (effectiveTaskId) {
        await store.setTaskStatus({
          taskId: effectiveTaskId,
          status: 'failed',
          eventType: 'task.failed',
          traceId,
          spanId: createSpanId(),
          data: {
            source: 'assistant_context_preflight',
            context_id: prepared.id,
            error_code: errorCode,
            error: blockedMessage
          }
        });
      }

      return sendError(reply, request, 503, 'INTERNAL_ERROR', blockedMessage, {
        reason: errorCode,
        grounding_policy: groundingDecision.policy,
        grounding_reasons: groundingDecision.reasons,
        retrieval_fallback_attempted: shouldTryNewsRetrievalFallback,
        retrieval_sources_count: retrievalPack?.sources.length ?? 0,
        retrieval_quality_gate: retrievalQualityGate,
        required_external_providers: ['openai', 'gemini', 'anthropic'],
        availability: providerAvailability.map((item) => ({
          provider: item.provider,
          enabled: item.enabled
        }))
      });
    }

    await store.appendAssistantContextEvent({
      userId,
      contextId: prepared.id,
      eventType: 'assistant.context.policy.resolved',
      data: {
        task_type: taskType,
        grounding_policy: groundingDecision.policy,
        grounding_required: groundingDecision.requiresGrounding,
        grounding_reasons: groundingDecision.reasons,
        grounding_signals: groundingDecision.signals,
        retrieval_fallback_enabled: canUseLocalGroundedFallback,
        retrieval_sources_count: retrievalPack?.sources.length ?? 0,
        retrieval_quality_gate: retrievalQualityGate
      },
      traceId,
      spanId: createSpanId()
    });

    await store.appendAssistantContextEvent({
      userId,
      contextId: prepared.id,
      eventType: 'assistant.context.run.accepted',
      data: {
        task_type: taskType,
        provider: parsed.data.provider,
        strict_provider: parsed.data.strict_provider,
        model: parsed.data.model ?? null,
        force_rerun: parsed.data.force_rerun,
        grounding_policy: groundingDecision.policy,
        grounding_required: groundingDecision.requiresGrounding,
        grounding_reasons: groundingDecision.reasons,
        retrieval_fallback_enabled: canUseLocalGroundedFallback
      },
      traceId,
      spanId: createSpanId()
    });

    assistantContextRunsInFlight.add(prepared.id);

    void (async () => {
      const spanId = createSpanId();
      let linkedTaskId = prepared.taskId ?? resolvedRunTaskId ?? null;
      const ensureLinkedTaskId = async (): Promise<string | null> => {
        if (linkedTaskId) {
          return linkedTaskId;
        }

        const resolvedTaskId = await resolveTaskIdForContext(store, userId, prepared.clientContextId);
        if (!resolvedTaskId) {
          return null;
        }

        linkedTaskId = resolvedTaskId;
        await store.updateAssistantContext({
          userId,
          contextId: prepared.id,
          taskId: linkedTaskId
        });
        return linkedTaskId;
      };
      try {
        const rewrittenQueries = generateQueryRewriteCandidates({
          prompt: prepared.prompt,
          maxVariants: 4
        });
        const contextResult = await runContextPipeline(store, {
          userId,
          prompt: prepared.prompt,
          taskType
        });

        linkedTaskId = await ensureLinkedTaskId();

        await store.appendAssistantContextEvent({
          userId,
          contextId: prepared.id,
          eventType: 'assistant.context.run.started',
          data: {
            task_type: taskType,
            prompt_chars: prepared.prompt.length,
            rewritten_queries: rewrittenQueries,
            context_segments_used: contextResult.segmentsUsed,
            context_tokens_used: contextResult.tokensUsed,
            context_mode: contextResult.contextMode,
            grounding_policy: groundingDecision.policy,
            grounding_required: groundingDecision.requiresGrounding
          },
          traceId,
          spanId
        });

        if (linkedTaskId) {
          await store.setTaskStatus({
            taskId: linkedTaskId,
            status: 'running',
            eventType: 'task.updated',
            traceId,
            spanId: createSpanId(),
            data: {
              source: 'assistant_context_run',
              context_id: prepared.id,
              stage: 'running'
            }
          });
        }

        const useStructuredLocalNewsFlow = Boolean(canUseLocalGroundedFallback && groundingDecision.signals.news);
        const groundingInstruction = useStructuredLocalNewsFlow ? '' : buildGroundingSystemInstruction(groundingDecision);
        const retrievalInstruction = useStructuredLocalNewsFlow ? '' : retrievalPack ? buildRetrievalSystemInstruction(retrievalPack) : '';
        const strictFactualTemperature = Math.min(parsed.data.temperature ?? 0.2, 0.4);
        const strictFactualMaxTokens = Math.min(parsed.data.max_output_tokens ?? 1200, 1800);
        const generationPrompt = useStructuredLocalNewsFlow
          ? buildNewsFactExtractionPrompt({
              userPrompt: prepared.prompt,
              sources: retrievalPack?.sources ?? []
            })
          : contextResult.enrichedPrompt;
        const generationSystemPrompt = useStructuredLocalNewsFlow
          ? mergeSystemPrompt(
              contextResult.systemPrompt || undefined,
              buildNewsFactExtractionSystemInstruction(languagePolicy.expectedLanguage)
            )
          : mergeSystemPrompt(
              mergeSystemPrompt(
                mergeSystemPrompt(contextResult.systemPrompt || undefined, groundingInstruction),
                retrievalInstruction
              ),
              languagePolicy.instruction
            );
        const routed = await providerRouter.generate({
          prompt: generationPrompt,
          systemPrompt: generationSystemPrompt,
          provider: parsed.data.provider,
          strictProvider: parsed.data.strict_provider,
          taskType,
          model: parsed.data.model,
          temperature: groundingDecision.requiresGrounding ? strictFactualTemperature : parsed.data.temperature,
          topP: groundingDecision.requiresGrounding ? 0.9 : undefined,
          stop: groundingDecision.requiresGrounding ? ['<|im_start|>', '<|im_end|>', '<|endoftext|>'] : undefined,
          maxOutputTokens: groundingDecision.requiresGrounding ? strictFactualMaxTokens : parsed.data.max_output_tokens,
          excludeProviders: groundingDecision.requiresGrounding && !canUseLocalGroundedFallback ? ['local'] : undefined
        });

        const groundedLocalViolation =
          groundingDecision.requiresGrounding && routed.result.provider === 'local' && !canUseLocalGroundedFallback;
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
        const groundingClaims = extractGroundingClaimsFromText(outputWithSources, sources);
        const groundingQuality = evaluateGroundingQualityGate({
          decision: groundingDecision,
          sources,
          claims: groundingClaims,
          hasTemplateArtifact: hasTemplateArtifact(routed.result.outputText),
          outputText: candidateOutputText,
          expectedLanguage: languagePolicy.expectedLanguage
        });
        const augmentedReasons = [...groundingQuality.reasons];
        if (useStructuredLocalNewsFlow && extractedFacts && extractedFacts.facts.length === 0 && fallbackFacts.length === 0) {
          augmentedReasons.push(extractedFacts.parseFailed ? 'structured_fact_extraction_failed' : 'structured_fact_empty');
        }
        const uniqueReasons = Array.from(new Set(augmentedReasons));
        const normalizedReasonCodes = normalizeGroundingQualityReasons(uniqueReasons);
        const effectiveGroundingQuality =
          normalizedReasonCodes.length === groundingQuality.reasons.length
            ? groundingQuality
            : {
                ...groundingQuality,
                passed: normalizedReasonCodes.length === 0,
                reasons: normalizedReasonCodes
              };
        await store.replaceAssistantContextGroundingSources({
          userId,
          contextId: prepared.id,
          sources
        });
        await store.replaceAssistantContextGroundingClaims({
          userId,
          contextId: prepared.id,
          claims: groundingClaims
        });
        const qualityGuardTriggered = groundedLocalViolation || !effectiveGroundingQuality.passed;
        const guardedOutput = qualityGuardTriggered
          ? groundedLocalViolation
            ? buildRadarQualityFallbackMessage()
            : buildGroundingQualityBlockedMessage(effectiveGroundingQuality)
          : outputWithSources;
        const sourceDomains = Array.from(new Set(sources.map((item) => item.domain)));
        const fallbackTraceTag =
          useStructuredLocalNewsFlow && renderedNewsBriefing.length === 0 && routed.result.outputText.length > 0
            ? 'raw_model_output_fallback'
            : null;
        const normalizedRetrievalReasonCodes = retrievalQualityGate
          ? normalizeRetrievalQualityReasons(retrievalQualityGate.reasons)
          : [];

        const evalResult = evaluateEvalGate({
          accuracy: qualityGuardTriggered ? 0.4 : routed.result.outputText.length > 10 ? 0.85 : 0.4,
          safety: 0.95,
          costDeltaPct: 0
        });

        if (!evalResult.passed) {
          await store.appendAssistantContextEvent({
            userId,
            contextId: prepared.id,
            eventType: 'assistant.context.eval_gate.warning',
            data: {
              passed: false,
              reasons: evalResult.reasons,
              provider: routed.result.provider,
              model: routed.result.model
            },
            traceId,
            spanId: createSpanId()
          });
          notificationService?.emitEvalGateDegradation(routed.result.provider);
        }

        const completed = await store.updateAssistantContext({
          userId,
          contextId: prepared.id,
          status: 'completed',
          servedProvider: routed.result.provider,
          servedModel: routed.result.model,
          usedFallback: routed.usedFallback,
          selectionReason: routed.selection?.reason ?? null,
          output: guardedOutput,
          error: null
        });

        if (completed) {
          await store.appendAssistantContextEvent({
            userId,
            contextId: completed.id,
            eventType: 'assistant.context.run.completed',
            data: {
              task_type: taskType,
              provider: routed.result.provider,
              model: routed.result.model,
              used_fallback: routed.usedFallback,
              selection_reason: routed.selection?.reason ?? null,
              quality_guard_triggered: qualityGuardTriggered,
              quality_guard_reason: groundedLocalViolation
                ? 'grounding_local_violation'
                : effectiveGroundingQuality.reasons[0] ?? null,
              quality_gate_code: effectiveGroundingQuality.reasons,
              grounding_policy: groundingDecision.policy,
              grounding_required: groundingDecision.requiresGrounding,
              grounding_status: groundingDecision.requiresGrounding ? 'provider_only' : 'not_required',
              render_mode: 'user_mode',
              retrieval_fallback_enabled: canUseLocalGroundedFallback,
              sources_count: sources.length,
              domain_count: sourceDomains.length,
              claims_count: groundingClaims.length,
              source_domains: sourceDomains,
              freshness_ratio: retrievalQualityGate?.metrics.freshnessRatio ?? null,
              retrieval_quality_gate_code: normalizedRetrievalReasonCodes,
              fallback_trace_tag: fallbackTraceTag,
              retrieval_quality_gate: retrievalQualityGate,
              language_policy: {
                expected: languagePolicy.expectedLanguage,
                detected: effectiveGroundingQuality.metrics.detectedLanguage,
                score: effectiveGroundingQuality.metrics.languageAlignmentScore
              },
              quality_gate: effectiveGroundingQuality,
              attempts: routed.attempts,
              eval_gate: { passed: evalResult.passed, reasons: evalResult.reasons }
            },
            traceId,
            spanId: createSpanId()
          });

          void embedAndStore(store, null, {
            userId,
            content: `Q: ${prepared.prompt}\nA: ${guardedOutput}`,
            segmentType: 'assistant_response',
            taskId: linkedTaskId ?? undefined,
            confidence: evalResult.passed ? 0.8 : 0.4,
          }).catch(() => undefined);
        }

        linkedTaskId = await ensureLinkedTaskId();
        if (linkedTaskId) {
          await store.setTaskStatus({
            taskId: linkedTaskId,
            status: 'done',
            eventType: 'task.done',
            traceId,
            spanId: createSpanId(),
            data: {
              source: 'assistant_context_run',
              context_id: prepared.id,
              provider: routed.result.provider,
              model: routed.result.model,
              used_fallback: routed.usedFallback,
              quality_guard_triggered: qualityGuardTriggered
            }
          });
        }
      } catch (error) {
        const reason = maskErrorForApi(error);
        const attempts = extractProviderAttempts(error);
        await store.replaceAssistantContextGroundingSources({
          userId,
          contextId: prepared.id,
          sources: []
        });
        await store.replaceAssistantContextGroundingClaims({
          userId,
          contextId: prepared.id,
          claims: []
        });
        const failed = await store.updateAssistantContext({
          userId,
          contextId: prepared.id,
          status: 'failed',
          servedProvider: null,
          servedModel: null,
          usedFallback: attempts.length > 0,
          selectionReason: null,
          output: `PROVIDER_ROUTING_FAILED: ${reason}`,
          error: reason
        });

        if (failed) {
          await store.appendAssistantContextEvent({
            userId,
            contextId: failed.id,
            eventType: 'assistant.context.run.failed',
            data: {
              task_type: taskType,
              reason,
              attempts
            },
            traceId,
            spanId: createSpanId()
          });
        }

        linkedTaskId = await ensureLinkedTaskId();
        if (linkedTaskId) {
          await store.setTaskStatus({
            taskId: linkedTaskId,
            status: 'failed',
            eventType: 'task.failed',
            traceId,
            spanId: createSpanId(),
            data: {
              source: 'assistant_context_run',
              context_id: prepared.id,
              error_code: 'PROVIDER_ROUTING_FAILED',
              error: reason
            }
          });
        }
      } finally {
        assistantContextRunsInFlight.delete(prepared.id);
      }
    })();

    return sendSuccess(reply, request, 202, prepared, {
      accepted: true,
      task_type: taskType
    });
  });
}
