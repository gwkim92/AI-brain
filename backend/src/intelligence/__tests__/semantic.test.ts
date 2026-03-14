import { describe, expect, it, vi } from 'vitest';

import { extractEventSemantics, inferDomainScores, inferEventFamily } from '../semantic';
import type { CapabilityAliasBindingRecord, JarvisStore, ModelRegistryEntryRecord, ProviderHealthRecord } from '../../store/types';

function makeStore(): Pick<
  JarvisStore,
  'listIntelligenceAliasBindings' | 'listIntelligenceModelRegistryEntries' | 'listIntelligenceProviderHealth'
> {
  const now = new Date().toISOString();
  const bindings: CapabilityAliasBindingRecord[] = [
    {
      id: 'binding-local-structured',
      workspaceId: null,
      alias: 'structured_extraction',
      provider: 'local',
      modelId: 'qwen2.5:7b',
      weight: 1,
      fallbackRank: 1,
      canaryPercent: 0,
      isActive: true,
      requiresStructuredOutput: true,
      requiresToolUse: false,
      requiresLongContext: false,
      maxCostClass: 'standard',
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const registry: ModelRegistryEntryRecord[] = [
    {
      id: 'registry-local-structured',
      provider: 'local',
      modelId: 'qwen2.5:7b',
      availability: 'active',
      contextWindow: 200_000,
      supportsStructuredOutput: false,
      supportsToolUse: false,
      supportsLongContext: false,
      supportsReasoning: false,
      costClass: 'premium',
      latencyClass: 'balanced',
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const health: ProviderHealthRecord[] = [
    { provider: 'local', available: true, cooldownUntil: null, reasonCode: null, failureCount: 0, updatedAt: now },
  ];

  return {
    listIntelligenceAliasBindings: vi.fn(async (input?: { workspaceId?: string | null; alias?: string }) => {
      const workspaceId = input?.workspaceId ?? null;
      const alias = input?.alias;
      return bindings.filter((row) => row.workspaceId === workspaceId && (!alias || row.alias === alias));
    }),
    listIntelligenceModelRegistryEntries: vi.fn(async () => registry),
    listIntelligenceProviderHealth: vi.fn(async () => health),
  };
}

describe('extractEventSemantics', () => {
  it('does not classify accelerate or strategy headlines as rate repricing', () => {
    expect(inferEventFamily('Accenture and OpenAI accelerate enterprise AI success')).toBe('platform_ai_shift');
    expect(inferEventFamily('Fortress Capital AI-Driven Quantitative Digital Asset Strategy Platform')).toBe('platform_ai_shift');
  });

  it('classifies AI launch and tool headlines as platform shifts', () => {
    expect(inferEventFamily('Microsoft AI Launches Copilot Health')).toBe('platform_ai_shift');
    expect(inferEventFamily('How HN: PDF Table Extractor – AI-powered tool to extract tables from PDFs to CSV')).toBe(
      'platform_ai_shift',
    );
    expect(inferEventFamily('Lenovo ThinkStation PGX Review: The Nvidia GB10 128GB AI Workstation')).toBe(
      'platform_ai_shift',
    );
    expect(inferEventFamily('AI assistant with web search and reasoning')).toBe('platform_ai_shift');
    expect(inferEventFamily('Feedback on a local-first MCP memory system for AI assistants?')).toBe(
      'platform_ai_shift',
    );
    expect(inferEventFamily('Show HN: The Common Infrastructure for Agentic Communication')).toBe(
      'platform_ai_shift',
    );
  });

  it('keeps broad AI social commentary headlines out of platform-shift family', () => {
    expect(inferEventFamily('Management in the Age of AI')).toBe('general_signal');
    expect(inferEventFamily('AI Killed My Job: Educators')).toBe('general_signal');
  });

  it('does not default AI/software headlines to geopolitics domain when the family is generic', () => {
    const scores = inferDomainScores(
      'AI software tells cops to arrest the wrong guy. A chatbot system generated the wrong arrest recommendation.',
      'general_signal',
    );
    expect(scores[0]?.domainId).toBe('policy_regulation_platform_ai');
  });

  it('does not default generic software tool headlines to geopolitics domain', () => {
    const scores = inferDomainScores(
      'ShowHN: Turn PDFs, notes and spreadsheets into business briefs. A tool converts PDFs and notes into concise briefs.',
      'general_signal',
    );
    expect(scores[0]?.domainId).toBe('policy_regulation_platform_ai');
  });

  it('routes regulator and central-bank notices away from AI policy buckets', () => {
    expect(
      inferEventFamily('Paul Tzur and David Morrell Named Deputy Directors of the Division of Enforcement', {
        sourceEntityHints: ['SEC'],
      }),
    ).toBe('policy_change');
    expect(
      inferDomainScores(
        'Federal Reserve Board announces approval of application by Associated Banc-Corp',
        'policy_change',
      )[0]?.domainId,
    ).toBe('macro_rates_inflation_fx');
    expect(
      inferDomainScores(
        'SEC to Host Hybrid Event on Regulation S-P for Small Firms',
        'policy_change',
        ['SEC'],
      )[0]?.domainId,
    ).toBe('macro_rates_inflation_fx');
  });

  it('normalizes fenced loose local JSON into structured event semantics', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => ({
        result: {
          provider: 'local',
          model: 'qwen2.5:7b',
          outputText: [
            '```json',
            '{',
            '  "title": "Meta Acquires Moltbook, AI-Driven Social Network",',
            '  "summary": "Meta has acquired Moltbook, a social network where AI agents interact.",',
            '  "event_family": "Corporate Acquisition",',
            '  "entities": [{"name":"Meta"},{"name":"Moltbook"},{"name":"AI agents"}],',
            '  "semantic_claims": ["Meta has acquired Moltbook.","Moltbook is a social network where AI agents interact."],',
            '  "metric_shocks": ["Increase in Meta market share"],',
            '  "domain_posteriors": ["Higher likelihood of Meta expanding AI capabilities"],',
            '  "primary_hypotheses": ["Meta integrates Moltbook AI technology into its platforms."],',
            '  "counter_hypotheses": ["Meta keeps Moltbook separate."],',
            '  "invalidation_conditions": ["Meta discontinues Moltbook.","Moltbook user base declines."],',
            '  "expected_signals": ["Increased Meta AI investment.","New AI social features launched."],',
            '  "world_states": ["Meta expands AI social network footprint."]',
            '}',
            '```',
          ].join('\n'),
        },
      })),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'Meta buys Moltbook, viral social network where AI agents interact',
      rawText:
        'Meta buys Moltbook, viral social network where AI agents interact. The acquisition is described as a platform AI shift and social network move.',
      entityHints: ['Meta', 'Moltbook', 'AI'],
    });

    expect(semantics.usedModel).toEqual({ provider: 'local', modelId: 'qwen2.5:7b' });
    expect(semantics.eventFamily).not.toBe('general_signal');
    expect(semantics.entities).toContain('Meta');
    expect(semantics.semanticClaims.length).toBeGreaterThanOrEqual(2);
    expect(semantics.primaryHypotheses[0]?.summary).toContain('Meta integrates Moltbook');
    expect(semantics.expectedSignals).toHaveLength(2);
  });

  it('keeps the source document title when the model rewrites it', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => ({
        result: {
          provider: 'local',
          model: 'qwen2.5:7b',
          outputText: JSON.stringify({
            title: 'How we hire AI-native engineers now: our criteria',
            summary: 'Microsoft launched a healthcare-oriented Copilot workflow.',
            event_family: 'platform_ai_shift',
            entities: ['Microsoft', 'Copilot Health'],
            semantic_claims: [
              {
                subject_entity: 'Microsoft',
                predicate: 'mentions',
                object: 'Copilot Health',
                uncertainty: 'medium',
                stance: 'supporting',
                claim_type: 'signal',
              },
            ],
            metric_shocks: [],
            domain_posteriors: [
              {
                domain_id: 'policy_regulation_platform_ai',
                score: 0.88,
                evidence_features: ['platform ai shift'],
                counter_features: [],
              },
            ],
            primary_hypotheses: [
              {
                title: 'Healthcare Copilot expansion',
                summary: 'Microsoft is broadening Copilot into healthcare workflows.',
                confidence: 0.7,
                rationale: 'Structured extraction output.',
              },
            ],
            counter_hypotheses: [
              {
                title: 'Marketing-only update',
                summary: 'This could be packaging rather than a durable product shift.',
                confidence: 0.3,
                rationale: 'Structured extraction output.',
              },
            ],
            invalidation_conditions: [
              {
                title: 'No product rollout',
                description: 'No launch evidence appears.',
                matcher_json: {},
              },
              {
                title: 'No partner uptake',
                description: 'No healthcare partner references appear.',
                matcher_json: {},
              },
            ],
            expected_signals: [
              {
                signal_key: 'launch',
                description: 'A launch note appears.',
                due_at: null,
              },
              {
                signal_key: 'partner',
                description: 'A partner note appears.',
                due_at: null,
              },
            ],
            world_states: [],
          }),
        },
      })),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'Microsoft AI Launches Copilot Health',
      rawText: 'Microsoft AI Launches Copilot Health. The company introduced a healthcare workflow for Copilot.',
      entityHints: ['Microsoft', 'Copilot'],
    });

    expect(semantics.title).toBe('Microsoft AI Launches Copilot Health');
    expect(semantics.semanticClaims[0]?.predicate).not.toBe('mentions');
  });

  it('treats source entity hints as weak priors and upgrades fallback claims beyond mentions', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => {
        throw new Error('forced fallback');
      }),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'Our approach to age prediction',
      rawText: 'This research note explains age prediction methods and evaluation results.',
      entityHints: ['OpenAI'],
      sourceEntityHints: ['OpenAI'],
    });

    expect(semantics.entities).not.toContain('OpenAI');
    expect(semantics.semanticClaims[0]?.predicate).not.toBe('mentions');
  });

  it('replaces low-information claim subjects with a stable title subject', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => ({
        result: {
          provider: 'local',
          model: 'qwen2.5:7b',
          outputText: JSON.stringify({
            title: 'ShowHN: PDF Table Extractor – AI-powered tool to extract tables from PDFs to CSV',
            summary: 'A Hacker News post introduces PDF Table Extractor for table extraction.',
            event_family: 'general_signal',
            entities: ['ShowHN', 'PDF Table Extractor', 'AI'],
            semantic_claims: [
              {
                subject_entity: 'ShowHN',
                predicate: 'mentions',
                object: 'PDF Table Extractor',
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
      })),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'ShowHN: PDF Table Extractor – AI-powered tool to extract tables from PDFs to CSV',
      rawText: 'PDF Table Extractor is an AI-powered tool to extract tables from PDFs to CSV.',
      entityHints: [],
    });

    expect(semantics.eventFamily).toBe('platform_ai_shift');
    expect(semantics.semanticClaims[0]?.subjectEntity).toBe('PDF Table Extractor');
    expect(semantics.semanticClaims[0]?.predicate).not.toBe('mentions');
  });

  it('drops question-word prefixes when deriving a fallback subject', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => ({
        result: {
          provider: 'local',
          model: 'qwen2.5:7b',
          outputText: JSON.stringify({
            title: 'What if compiler errors were an API? (AI-native language demo)',
            summary: 'A demo reframes compiler errors as an API surface.',
            event_family: 'general_signal',
            entities: ['What'],
            semantic_claims: [
              {
                subject_entity: 'What',
                predicate: 'mentions',
                object: 'compiler errors',
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
      })),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'What if compiler errors were an API? (AI-native language demo)',
      rawText: 'Compiler errors are presented as an API for AI-native development workflows.',
      entityHints: [],
    });

    expect(semantics.semanticClaims[0]?.subjectEntity.toLowerCase()).toContain('compiler');
    expect(semantics.semanticClaims[0]?.subjectEntity).not.toBe('What');
  });

  it('extracts a focused AI phrase instead of storing an entire sentence title as the subject', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => ({
        result: {
          provider: 'local',
          model: 'qwen2.5:7b',
          outputText: JSON.stringify({
            title: "You can't escape coordination costs by throwing more AI agents at a problem",
            summary: 'The essay argues that multi-agent coordination costs remain high.',
            event_family: 'platform_ai_shift',
            entities: ['You'],
            semantic_claims: [
              {
                subject_entity: 'You',
                predicate: 'mentions',
                object: 'coordination costs',
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
      })),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: "You can't escape coordination costs by throwing more AI agents at a problem",
      rawText: 'Coordination costs remain high when teams add more AI agents.',
      entityHints: [],
    });

    expect(semantics.semanticClaims[0]?.subjectEntity).toBe('ai agents');
  });

  it('treats imperative verbs and articles as low-information subjects', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn()
        .mockResolvedValueOnce({
          result: {
            provider: 'local',
            model: 'qwen2.5:7b',
            outputText: JSON.stringify({
              title: 'Give Your AI Agents a Live Status Page',
              summary: 'A tool offers status pages for AI agents.',
              event_family: 'platform_ai_shift',
              entities: ['Give'],
              semantic_claims: [
                {
                  subject_entity: 'Give',
                  predicate: 'mentions',
                  object: 'status pages',
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
        })
        .mockResolvedValueOnce({
          result: {
            provider: 'local',
            model: 'qwen2.5:7b',
            outputText: JSON.stringify({
              title: 'AI is helping expand the frontier of theoretical physics',
              summary: 'AI tools are helping physics research.',
              event_family: 'general_signal',
              entities: ['The'],
              semantic_claims: [
                {
                  subject_entity: 'The',
                  predicate: 'mentions',
                  object: 'theoretical physics',
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
        }),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const first = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'Give Your AI Agents a Live Status Page',
      rawText: 'A status page product gives AI agents live operational visibility.',
      entityHints: [],
    });
    const second = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'AI is helping expand the frontier of theoretical physics',
      rawText: 'AI systems are helping theoretical physics research.',
      entityHints: [],
    });

    expect(first.semanticClaims[0]?.subjectEntity).toBe('ai agents');
    expect(second.semanticClaims[0]?.subjectEntity).toBe('ai');
  });

  it('replaces generic single-noun subjects when the title contains a more specific phrase', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn()
        .mockResolvedValueOnce({
          result: {
            provider: 'local',
            model: 'qwen2.5:7b',
            outputText: JSON.stringify({
              title: 'What if compiler errors were an API? (AI-native language demo)',
              summary: 'A demo reframes compiler errors as an API surface.',
              event_family: 'platform_ai_shift',
              entities: ['compiler errors'],
              semantic_claims: [
                {
                  subject_entity: 'API',
                  predicate: 'mentions',
                  object: 'compiler errors',
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
        })
        .mockResolvedValueOnce({
          result: {
            provider: 'local',
            model: 'qwen2.5:7b',
            outputText: JSON.stringify({
              title: 'How HN: PDF Table Extractor – AI-powered tool to extract tables from PDFs to CSV',
              summary: 'A tool extracts tables from PDFs to CSV.',
              event_family: 'platform_ai_shift',
              entities: ['PDF Table Extractor'],
              semantic_claims: [
                {
                  subject_entity: 'PDF',
                  predicate: 'mentions',
                  object: 'table extraction',
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
        }),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const first = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'What if compiler errors were an API? (AI-native language demo)',
      rawText: 'Compiler errors are presented as an API for AI-native development workflows.',
      entityHints: [],
    });
    const second = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'How HN: PDF Table Extractor – AI-powered tool to extract tables from PDFs to CSV',
      rawText: 'PDF Table Extractor is an AI-powered tool to extract tables from PDFs to CSV.',
      entityHints: [],
    });

    expect(first.semanticClaims[0]?.subjectEntity.toLowerCase()).toContain('compiler');
    expect(second.semanticClaims[0]?.subjectEntity).toBe('PDF Table Extractor');
  });

  it('prefers the target phrase for imperative turn-into titles', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => ({
        result: {
          provider: 'local',
          model: 'qwen2.5:7b',
          outputText: JSON.stringify({
            title: 'ShowHN: Turn PDFs, notes and spreadsheets into business briefs',
            summary: 'A tool transforms source documents into business briefs.',
            event_family: 'platform_ai_shift',
            entities: ['PDFs'],
            semantic_claims: [
              {
                subject_entity: 'PDFs',
                predicate: 'mentions',
                object: 'business briefs',
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
      })),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'ShowHN: Turn PDFs, notes and spreadsheets into business briefs',
      rawText: 'The tool turns PDFs, notes and spreadsheets into business briefs.',
      entityHints: [],
    });

    expect(semantics.semanticClaims[0]?.subjectEntity).toBe('business briefs');
  });

  it('replaces single-token model subjects with the short product title phrase', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => ({
        result: {
          provider: 'local',
          model: 'qwen2.5:7b',
          outputText: JSON.stringify({
            title: 'Show HN: Catch Tap Toy',
            summary: 'A small toy app for quick tap interactions.',
            event_family: 'general_signal',
            entities: ['Catch'],
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
      })),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'Show HN: Catch Tap Toy',
      rawText: 'Catch Tap Toy is a small toy app for quick tap interactions.',
      entityHints: [],
    });

    expect(semantics.semanticClaims[0]?.subjectEntity).toBe('Catch Tap Toy');
  });

  it('overrides unsupported model predicates when the text does not contain the cue', async () => {
    const store = makeStore();
    const providerRouter = {
      listAvailability: () => [{ provider: 'local', enabled: true, model: 'qwen2.5:7b' }],
      generate: vi.fn(async () => ({
        result: {
          provider: 'local',
          model: 'qwen2.5:7b',
          outputText: JSON.stringify({
            title: 'Show HN: ROI-first AI automation framework for B2B companies',
            summary: 'The company has developed an AI automation framework for B2B workflows.',
            event_family: 'platform_ai_shift',
            entities: ['ROI-first AI automation framework'],
            semantic_claims: [
              {
                subject_entity: 'ROI-first AI automation framework',
                predicate: 'struggles_with',
                object: 'B2B companies',
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
      })),
    };
    const env = {
      OPENAI_MODEL: 'gpt-4.1-mini',
      GEMINI_MODEL: 'gemini-2.5-pro',
      ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
      LOCAL_LLM_MODEL: 'qwen2.5:7b',
    } as never;

    const semantics = await extractEventSemantics({
      store: store as never,
      env,
      providerRouter: providerRouter as never,
      workspaceId: 'workspace-1',
      title: 'Show HN: ROI-first AI automation framework for B2B companies',
      rawText: 'The company has developed an AI automation framework for B2B workflows.',
      entityHints: [],
    });

    expect(semantics.semanticClaims[0]?.predicate).toBe('builds');
  });
});
