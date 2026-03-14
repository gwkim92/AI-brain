import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../config/env';
import type { ProviderRouter } from '../../providers/router';
import { createMemoryStore } from '../../store/memory-store';
import { rebuildIntelligenceEvent, runIntelligenceSemanticPass } from '../service';

const ENV_SNAPSHOT = { ...process.env };

function createAvailableProviderRouter(generate: ReturnType<typeof vi.fn>): ProviderRouter {
  return {
    listAvailability: vi.fn().mockReturnValue([
      { provider: 'openai', enabled: true, reason: 'configured' },
      { provider: 'gemini', enabled: false, reason: 'missing_api_key' },
      { provider: 'anthropic', enabled: false, reason: 'missing_api_key' },
      { provider: 'local', enabled: false, reason: 'disabled' },
    ]),
    generate,
  } as unknown as ProviderRouter;
}

function buildStructuredExtraction(input: {
  title: string;
  summary: string;
  eventFamily: 'platform_ai_shift' | 'policy_change' | 'general_signal';
  entities: string[];
  semanticClaims: Array<{
    subject_entity: string;
    predicate: string;
    object: string;
    evidence_span?: string;
    uncertainty?: 'low' | 'medium' | 'high';
    stance?: 'supporting' | 'neutral' | 'contradicting';
    claim_type?: 'fact' | 'prediction' | 'opinion' | 'signal';
  }>;
  domainId: 'policy_regulation_platform_ai' | 'macro_rates_inflation_fx';
  domainScore?: number;
}) {
  const secondaryDomain =
    input.domainId === 'policy_regulation_platform_ai'
      ? 'macro_rates_inflation_fx'
      : 'policy_regulation_platform_ai';
  return {
    title: input.title,
    summary: input.summary,
    event_family: input.eventFamily,
    entities: input.entities,
    semantic_claims: input.semanticClaims.map((claim) => ({
      uncertainty: 'medium',
      stance: 'supporting',
      claim_type: 'signal',
      ...claim,
    })),
    metric_shocks: [],
    domain_posteriors: [
      {
        domain_id: input.domainId,
        score: input.domainScore ?? 0.84,
        evidence_features: ['structured extraction'],
        counter_features: [],
      },
      {
        domain_id: secondaryDomain,
        score: 0.22,
        evidence_features: [],
        counter_features: ['weaker domain fit'],
      },
    ],
    primary_hypotheses: [
      {
        title: 'Primary interpretation',
        summary: input.summary,
        confidence: 0.74,
        rationale: 'Structured extraction detected a coherent narrative.',
      },
    ],
    counter_hypotheses: [
      {
        title: 'Alternative interpretation',
        summary: 'This may remain a narrow signal until corroborated.',
        confidence: 0.38,
        rationale: 'Cross-document corroboration is still limited.',
      },
    ],
    invalidation_conditions: [
      {
        title: 'No corroboration',
        description: 'Expected corroboration does not appear.',
        matcher_json: {},
      },
      {
        title: 'Contradictory follow-up',
        description: 'A contradictory follow-up appears from a trusted source.',
        matcher_json: {},
      },
    ],
    expected_signals: [
      {
        signal_key: 'official_follow_up',
        description: 'An official follow-up appears.',
      },
      {
        signal_key: 'corroborating_coverage',
        description: 'Independent corroborating coverage appears.',
      },
    ],
    world_states: [],
  };
}

async function waitForLease(input: {
  store: ReturnType<typeof createMemoryStore>;
  workspaceId: string;
  signalId: string;
}) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current =
      (
        await input.store.listIntelligenceSignalsByIds({
          workspaceId: input.workspaceId,
          signalIds: [input.signalId],
        })
      )[0] ?? null;
    if (current?.processingStatus === 'processing' && current.processingLeaseId) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('processing lease was not claimed in time');
}

describe('runIntelligenceSemanticPass lease guards', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'false';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ENV_SNAPSHOT };
  });

  it('does not persist derived events after the signal lease is cleared mid-pass', async () => {
    const userId = '00000000-0000-4000-8000-000000000511';
    const store = createMemoryStore(userId, 'intelligence-lease@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    const source = await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Test Source',
      kind: 'rss',
      url: 'https://example.com/feed.xml',
      sourceType: 'blog',
      sourceTier: 'tier_1',
    });
    const document = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://example.com/catch-tap-toy',
      canonicalUrl: 'https://example.com/catch-tap-toy',
      title: 'Show HN: Catch Tap Toy',
      rawText: 'Catch Tap Toy is a small toy app for quick tap interactions.',
      sourceType: 'blog',
      sourceTier: 'tier_1',
      documentFingerprint: 'catch-tap-toy-1',
    });
    const signal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: document.id,
      sourceType: 'blog',
      sourceTier: 'tier_1',
      url: 'https://example.com/catch-tap-toy',
      rawText: document.rawText,
    });

    type StructuredGenerateResult = {
      result: {
        provider: string;
        model: string;
        outputText: string;
      };
    };
    let resolveGenerate!: (value: StructuredGenerateResult) => void;
    const generatePromise = new Promise<StructuredGenerateResult>((resolve) => {
      resolveGenerate = resolve;
    });
    const generate = vi.fn(() => generatePromise);
    const providerRouter = createAvailableProviderRouter(generate);

    const passPromise = runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [signal.id],
    });

    const claimedSignal = await waitForLease({
      store,
      workspaceId: workspace.id,
      signalId: signal.id,
    });
    const resetSignal = await store.updateIntelligenceSignalProcessing({
      workspaceId: workspace.id,
      signalId: signal.id,
      processingStatus: 'pending',
      expectedCurrentStatus: 'processing',
      expectedCurrentLeaseId: claimedSignal.processingLeaseId,
      processingLeaseId: null,
      linkedEventId: null,
      processingError: null,
      processedAt: null,
    });
    expect(resetSignal?.processingStatus).toBe('pending');
    expect(resetSignal?.processingLeaseId).toBeNull();

    resolveGenerate({
      result: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        outputText: JSON.stringify({
          title: 'Show HN: Catch Tap Toy',
          summary: 'A small toy app for quick tap interactions.',
          event_family: 'general_signal',
          entities: ['Catch Tap Toy'],
          semantic_claims: [
            {
              subject_entity: 'Catch',
              predicate: 'mentions',
              object: 'tap toy',
              uncertainty: 'medium',
              stance: 'supporting',
              claim_type: 'signal',
            },
          ],
          metric_shocks: [],
          domain_posteriors: [],
          primary_hypotheses: [],
          counter_hypotheses: [],
          invalidation_conditions: [],
          expected_signals: [],
          world_states: [],
        }),
      },
    });

    const summary = await passPromise;
    expect(summary.failedCount).toBe(0);

    const events = await store.listIntelligenceEvents({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(events).toHaveLength(0);

    const currentSignal =
      (
        await store.listIntelligenceSignalsByIds({
          workspaceId: workspace.id,
          signalIds: [signal.id],
        })
      )[0] ?? null;
    expect(currentSignal?.processingStatus).toBe('pending');
    expect(currentSignal?.processingLeaseId).toBeNull();
    expect(currentSignal?.linkedEventId).toBeNull();
  });

  it('keeps similar AI cost-monitoring launches separate when product anchors differ', async () => {
    const userId = '00000000-0000-4000-8000-000000000512';
    const store = createMemoryStore(userId, 'intelligence-merge@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    const source = await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'HN AI Search',
      kind: 'search',
      url: 'https://example.com/hn-ai',
      sourceType: 'forum',
      sourceTier: 'tier_3',
    });
    const tokenWatchDoc = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://example.com/tokenwatch',
      canonicalUrl: 'https://example.com/tokenwatch',
      title: 'Show HN: TokenWatch – Real-Time AI API Cost Monitor for OpenAI/Anthropic/Gemini',
      rawText: 'TokenWatch provides real-time cost monitoring for AI APIs and helps avoid surprise invoices.',
      sourceType: 'forum',
      sourceTier: 'tier_3',
      documentFingerprint: 'tokenwatch-1',
    });
    const cacheLensDoc = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://example.com/cachelens',
      canonicalUrl: 'https://example.com/cachelens',
      title: 'Show HN: CacheLens – Local-first cost tracking proxy for LLM APIs',
      rawText: 'CacheLens tracks API usage and costs in real-time while keeping prompts local.',
      sourceType: 'forum',
      sourceTier: 'tier_3',
      documentFingerprint: 'cachelens-1',
    });
    const tokenWatchSignal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: tokenWatchDoc.id,
      sourceType: 'forum',
      sourceTier: 'tier_3',
      url: tokenWatchDoc.sourceUrl,
      rawText: tokenWatchDoc.rawText,
    });
    const cacheLensSignal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: cacheLensDoc.id,
      sourceType: 'forum',
      sourceTier: 'tier_3',
      url: cacheLensDoc.sourceUrl,
      rawText: cacheLensDoc.rawText,
    });

    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: tokenWatchDoc.title,
            summary: 'TokenWatch provides real-time cost monitoring for AI APIs.',
            eventFamily: 'platform_ai_shift',
            entities: ['TokenWatch', 'OpenAI', 'Anthropic', 'Gemini'],
            semanticClaims: [
              {
                subject_entity: 'TokenWatch',
                predicate: 'builds',
                object: 'real-time cost monitoring for AI APIs',
                evidence_span: 'TokenWatch provides real-time cost monitoring for AI APIs.',
              },
            ],
            domainId: 'policy_regulation_platform_ai',
          })),
        },
      })
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: cacheLensDoc.title,
            summary: 'CacheLens tracks AI API costs locally and blocks overspending.',
            eventFamily: 'platform_ai_shift',
            entities: ['CacheLens', 'OpenAI', 'Anthropic', 'Gemini'],
            semanticClaims: [
              {
                subject_entity: 'CacheLens',
                predicate: 'builds',
                object: 'local-first AI API cost tracking',
                evidence_span: 'CacheLens tracks API usage and costs in real-time while keeping prompts local.',
              },
            ],
            domainId: 'policy_regulation_platform_ai',
          })),
        },
      });
    const providerRouter = createAvailableProviderRouter(generate);

    await runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [tokenWatchSignal.id],
    });
    await runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [cacheLensSignal.id],
    });

    const events = await store.listIntelligenceEvents({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.lifecycleState === 'provisional')).toBe(true);
    expect(events.map((event) => event.title).sort()).toEqual([
      cacheLensDoc.title,
      tokenWatchDoc.title,
    ]);

    const clusters = await store.listIntelligenceNarrativeClusters({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(clusters).toHaveLength(0);
  });

  it('keeps distinct regulator notices in separate narrative clusters when only the agency overlaps', async () => {
    const userId = '00000000-0000-4000-8000-000000000513';
    const store = createMemoryStore(userId, 'intelligence-policy-cluster@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    const source = await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'SEC Press Releases',
      kind: 'rss',
      url: 'https://example.com/sec.xml',
      sourceType: 'policy',
      sourceTier: 'tier_1',
      entityHints: ['SEC'],
    });
    const amendmentsDoc = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://example.com/sec-amendments',
      canonicalUrl: 'https://example.com/sec-amendments',
      title: 'SEC Proposes Amendments to Reduce Burdens in Reporting of Fund Portfolio Holdings',
      rawText: 'The SEC proposes amendments to reduce burdens in reporting of fund portfolio holdings.',
      summary: 'The SEC proposes amendments to reduce burdens in reporting of fund portfolio holdings.',
      sourceType: 'policy',
      sourceTier: 'tier_1',
      documentFingerprint: 'sec-amendments-1',
    });
    const roundtableDoc = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://example.com/sec-roundtable',
      canonicalUrl: 'https://example.com/sec-roundtable',
      title: 'SEC Announces Roundtable on Options Market Structure Reform',
      rawText: 'The SEC is organizing a roundtable on options market structure reform.',
      summary: 'The SEC is organizing a roundtable on options market structure reform.',
      sourceType: 'policy',
      sourceTier: 'tier_1',
      documentFingerprint: 'sec-roundtable-1',
    });
    const amendmentsSignal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: amendmentsDoc.id,
      sourceType: 'policy',
      sourceTier: 'tier_1',
      url: amendmentsDoc.sourceUrl,
      rawText: amendmentsDoc.rawText,
      entityHints: ['SEC'],
    });
    const roundtableSignal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: roundtableDoc.id,
      sourceType: 'policy',
      sourceTier: 'tier_1',
      url: roundtableDoc.sourceUrl,
      rawText: roundtableDoc.rawText,
      entityHints: ['SEC'],
    });

    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: amendmentsDoc.title,
            summary: amendmentsDoc.summary,
            eventFamily: 'policy_change',
            entities: ['SEC'],
            semanticClaims: [
              {
                subject_entity: amendmentsDoc.title,
                predicate: 'changes_policy',
                object: 'fund portfolio holdings reporting',
                evidence_span: amendmentsDoc.rawText,
              },
            ],
            domainId: 'macro_rates_inflation_fx',
          })),
        },
      })
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: amendmentsDoc.title,
            summary: amendmentsDoc.summary,
            eventFamily: 'policy_change',
            entities: ['SEC'],
            semanticClaims: [
              {
                subject_entity: amendmentsDoc.title,
                predicate: 'changes_policy',
                object: 'fund portfolio holdings reporting',
                evidence_span: amendmentsDoc.rawText,
              },
            ],
            domainId: 'macro_rates_inflation_fx',
          })),
        },
      })
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: roundtableDoc.title,
            summary: roundtableDoc.summary,
            eventFamily: 'policy_change',
            entities: ['SEC'],
            semanticClaims: [
              {
                subject_entity: roundtableDoc.title,
                predicate: 'changes_policy',
                object: 'options market structure reform roundtable',
                evidence_span: roundtableDoc.rawText,
              },
            ],
            domainId: 'macro_rates_inflation_fx',
          })),
        },
      })
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: roundtableDoc.title,
            summary: roundtableDoc.summary,
            eventFamily: 'policy_change',
            entities: ['SEC'],
            semanticClaims: [
              {
                subject_entity: roundtableDoc.title,
                predicate: 'changes_policy',
                object: 'options market structure reform roundtable',
                evidence_span: roundtableDoc.rawText,
              },
            ],
            domainId: 'macro_rates_inflation_fx',
          })),
        },
      });
    const providerRouter = createAvailableProviderRouter(generate);

    await runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [amendmentsSignal.id],
    });
    await runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [roundtableSignal.id],
    });

    const clusters = await store.listIntelligenceNarrativeClusters({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.title).sort()).toEqual([
      amendmentsDoc.title,
      roundtableDoc.title,
    ].sort());
  });

  it('keeps templated Federal Reserve approval notices in separate events when applicant entities differ', async () => {
    const userId = '00000000-0000-4000-8000-000000000514';
    const store = createMemoryStore(userId, 'intelligence-fed-approval@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    const source = await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Federal Reserve Releases',
      kind: 'rss',
      url: 'https://example.com/fed.xml',
      sourceType: 'policy',
      sourceTier: 'tier_1',
      entityHints: ['Federal Reserve', 'Fed'],
    });
    const associatedDoc = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://example.com/associated',
      canonicalUrl: 'https://example.com/associated',
      title: 'Federal Reserve Board announces approval of application by Associated Banc-Corp',
      rawText: 'The Federal Reserve Board has approved the application by Associated Banc-Corp.',
      summary: 'The Federal Reserve Board has approved the application by Associated Banc-Corp.',
      sourceType: 'policy',
      sourceTier: 'tier_1',
      documentFingerprint: 'fed-associated-1',
    });
    const firstSunDoc = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://example.com/firstsun',
      canonicalUrl: 'https://example.com/firstsun',
      title: 'Federal Reserve Board announces approval of application by FirstSun Capital Bancorp',
      rawText: 'The Federal Reserve Board has approved the application by FirstSun Capital Bancorp.',
      summary: 'The Federal Reserve Board has approved the application by FirstSun Capital Bancorp.',
      sourceType: 'policy',
      sourceTier: 'tier_1',
      documentFingerprint: 'fed-firstsun-1',
    });
    const associatedSignal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: associatedDoc.id,
      sourceType: 'policy',
      sourceTier: 'tier_1',
      url: associatedDoc.sourceUrl,
      rawText: associatedDoc.rawText,
      entityHints: ['Federal Reserve', 'Fed'],
    });
    const firstSunSignal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: firstSunDoc.id,
      sourceType: 'policy',
      sourceTier: 'tier_1',
      url: firstSunDoc.sourceUrl,
      rawText: firstSunDoc.rawText,
      entityHints: ['Federal Reserve', 'Fed'],
    });

    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: associatedDoc.title,
            summary: associatedDoc.summary,
            eventFamily: 'policy_change',
            entities: ['Federal Reserve', 'Federal', 'Reserve', 'Board', 'Associated', 'Banc-Corp'],
            semanticClaims: [
              {
                subject_entity: 'Federal Reserve',
                predicate: 'changes_policy',
                object: associatedDoc.title,
                evidence_span: associatedDoc.rawText,
              },
            ],
            domainId: 'macro_rates_inflation_fx',
          })),
        },
      })
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: associatedDoc.title,
            summary: associatedDoc.summary,
            eventFamily: 'policy_change',
            entities: ['Federal Reserve', 'Federal', 'Reserve', 'Board', 'Associated', 'Banc-Corp'],
            semanticClaims: [
              {
                subject_entity: 'Federal Reserve',
                predicate: 'changes_policy',
                object: associatedDoc.title,
                evidence_span: associatedDoc.rawText,
              },
            ],
            domainId: 'macro_rates_inflation_fx',
          })),
        },
      })
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: firstSunDoc.title,
            summary: firstSunDoc.summary,
            eventFamily: 'policy_change',
            entities: ['Federal Reserve', 'Federal', 'Reserve', 'Board', 'FirstSun', 'Capital', 'Bancorp'],
            semanticClaims: [
              {
                subject_entity: 'Federal Reserve',
                predicate: 'changes_policy',
                object: firstSunDoc.title,
                evidence_span: firstSunDoc.rawText,
              },
            ],
            domainId: 'macro_rates_inflation_fx',
          })),
        },
      })
      .mockResolvedValueOnce({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: firstSunDoc.title,
            summary: firstSunDoc.summary,
            eventFamily: 'policy_change',
            entities: ['Federal Reserve', 'Federal', 'Reserve', 'Board', 'FirstSun', 'Capital', 'Bancorp'],
            semanticClaims: [
              {
                subject_entity: 'Federal Reserve',
                predicate: 'changes_policy',
                object: firstSunDoc.title,
                evidence_span: firstSunDoc.rawText,
              },
            ],
            domainId: 'macro_rates_inflation_fx',
          })),
        },
      });
    const providerRouter = createAvailableProviderRouter(generate);

    await runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [associatedSignal.id],
    });
    await runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [firstSunSignal.id],
    });

    const events = await store.listIntelligenceEvents({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.title).sort()).toEqual([
      associatedDoc.title,
      firstSunDoc.title,
    ].sort());

    const clusters = await store.listIntelligenceNarrativeClusters({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.title).sort()).toEqual([
      associatedDoc.title,
      firstSunDoc.title,
    ].sort());
  });

  it('merges duplicate signals for the same canonical url even when published time drifts', async () => {
    const userId = '00000000-0000-4000-8000-000000000517';
    const store = createMemoryStore(userId, 'intelligence-canonical-url@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    const source = await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Repeated article source',
      kind: 'search',
      url: 'https://example.com/search?q=institutional-ai',
      sourceType: 'search_result',
      sourceTier: 'tier_1',
    });
    const firstDocument = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://www.a16z.news/p/institutional-ai-vs-individual-ai',
      canonicalUrl: 'https://www.a16z.news/p/institutional-ai-vs-individual-ai',
      title: 'Institutional AI vs. Individual AI',
      rawText: 'Institutional AI and Individual AI have different operational tradeoffs.',
      summary: '',
      publishedAt: '2026-03-12T14:10:13.000Z',
      sourceType: 'search_result',
      sourceTier: 'tier_1',
      documentFingerprint: 'institutional-ai-v1',
    });
    const secondDocument = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://www.a16z.news/p/institutional-ai-vs-individual-ai',
      canonicalUrl: 'https://www.a16z.news/p/institutional-ai-vs-individual-ai',
      title: 'Institutional AI vs. Individual AI',
      rawText: 'Institutional AI and Individual AI have different operational tradeoffs.',
      summary: '',
      publishedAt: '2026-03-14T01:05:43.000Z',
      sourceType: 'search_result',
      sourceTier: 'tier_1',
      documentFingerprint: 'institutional-ai-v2',
    });
    const firstSignal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: firstDocument.id,
      sourceType: 'search_result',
      sourceTier: 'tier_1',
      url: firstDocument.sourceUrl,
      publishedAt: firstDocument.publishedAt,
      rawText: firstDocument.rawText,
      entityHints: ['7777777phil'],
    });
    const secondSignal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: secondDocument.id,
      sourceType: 'search_result',
      sourceTier: 'tier_1',
      url: secondDocument.sourceUrl,
      publishedAt: secondDocument.publishedAt,
      rawText: secondDocument.rawText,
      entityHints: ['gmays'],
    });

    const providerRouter = createAvailableProviderRouter(
      vi.fn().mockResolvedValue({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify(buildStructuredExtraction({
            title: 'Institutional AI vs. Individual AI',
            summary: 'The document discusses the differences and implications of using Institutional AI versus Individual AI.',
            eventFamily: 'general_signal',
            entities: ['Institutional', 'Individual'],
            semanticClaims: [
              {
                subject_entity: 'Institutional AI',
                predicate: 'contrasts_with',
                object: 'Individual AI',
                evidence_span: 'different operational tradeoffs',
              },
            ],
            domainId: 'policy_regulation_platform_ai',
            domainScore: 0.74,
          })),
        },
        attempts: [],
        usedFallback: false,
      }),
    );

    await runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [firstSignal.id],
    });
    await runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [secondSignal.id],
    });

    const events = await store.listIntelligenceEvents({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.lifecycleState).toBe('provisional');
    expect(events[0]?.signalIds).toHaveLength(2);
    expect(new Set(events[0]?.signalIds)).toEqual(new Set([firstSignal.id, secondSignal.id]));
  });

  it('removes stale orphan events that still reference rebuilt signal ids', async () => {
    const userId = '00000000-0000-4000-8000-000000000515';
    const store = createMemoryStore(userId, 'intelligence-orphan-cleanup@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    const source = await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Federal Reserve Releases',
      kind: 'rss',
      url: 'https://example.com/fed.xml',
      sourceType: 'policy',
      sourceTier: 'tier_1',
      entityHints: ['Federal Reserve', 'Fed'],
    });
    const document = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: 'https://example.com/firstsun',
      canonicalUrl: 'https://example.com/firstsun',
      title: 'Federal Reserve Board announces approval of application by FirstSun Capital Bancorp',
      rawText: 'The Federal Reserve Board has approved the application by FirstSun Capital Bancorp.',
      summary: 'The Federal Reserve Board has approved the application by FirstSun Capital Bancorp.',
      sourceType: 'policy',
      sourceTier: 'tier_1',
      documentFingerprint: 'fed-firstsun-orphan-1',
    });
    const signal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: document.id,
      sourceType: 'policy',
      sourceTier: 'tier_1',
      url: document.sourceUrl,
      rawText: document.rawText,
      entityHints: ['Federal Reserve', 'Fed'],
    });

    const generate = vi.fn().mockResolvedValue({
      result: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        outputText: JSON.stringify(buildStructuredExtraction({
          title: document.title,
          summary: document.summary,
          eventFamily: 'policy_change',
          entities: ['Federal Reserve', 'Federal', 'Reserve', 'Board', 'FirstSun', 'Capital', 'Bancorp'],
          semanticClaims: [
            {
              subject_entity: 'Federal Reserve',
              predicate: 'changes_policy',
              object: document.title,
              evidence_span: document.rawText,
            },
          ],
          domainId: 'macro_rates_inflation_fx',
        })),
      },
    });
    const providerRouter = createAvailableProviderRouter(generate);

    await runIntelligenceSemanticPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      signalBatch: 1,
      signalIds: [signal.id],
    });

    const realEvent = (
      await store.listIntelligenceEvents({
        workspaceId: workspace.id,
        limit: 10,
      })
    )[0];
    expect(realEvent).toBeTruthy();
    const membership = (
      await store.listIntelligenceNarrativeClusterMemberships({
        workspaceId: workspace.id,
        eventId: realEvent!.id,
        limit: 1,
      })
    )[0];
    expect(membership).toBeTruthy();

    const staleEventId = '00000000-0000-4000-8000-000000000999';
    await store.upsertIntelligenceEvent({
      ...realEvent!,
      id: staleEventId,
      title: 'Unrelated stale event',
      summary: 'Stale derived event left behind by an older rebuild.',
      eventFamily: 'general_signal',
      topDomainId: 'geopolitics_energy_lng',
      entities: ['Unrelated stale event'],
      semanticClaims: [
        {
          claimId: '00000000-0000-4000-8000-000000000997',
          subjectEntity: 'Unrelated stale event',
          predicate: 'mentions',
          object: 'stale rebuild artifact',
          evidenceSpan: 'stale rebuild artifact',
          timeScope: null,
          uncertainty: 'medium',
          stance: 'supporting',
          claimType: 'signal',
        },
      ],
      signalIds: [...realEvent!.signalIds],
      documentIds: [],
    });
    await store.upsertIntelligenceNarrativeClusterMembership({
      id: '00000000-0000-4000-8000-000000000998',
      workspaceId: workspace.id,
      clusterId: membership!.clusterId,
      eventId: staleEventId,
      relation: 'supportive_history',
      score: 0.61,
      daysDelta: 1,
      isLatest: false,
    });

    const rebuildResult = await rebuildIntelligenceEvent({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      userId,
      eventId: realEvent!.id,
    });
    expect(rebuildResult.semanticSummary.failedCount).toBe(0);

    const staleEvent = await store.getIntelligenceEventById({
      workspaceId: workspace.id,
      eventId: staleEventId,
    });
    expect(staleEvent).toBeNull();
    const staleMemberships = await store.listIntelligenceNarrativeClusterMemberships({
      workspaceId: workspace.id,
      eventId: staleEventId,
      limit: 10,
    });
    expect(staleMemberships).toHaveLength(0);
  });
});
