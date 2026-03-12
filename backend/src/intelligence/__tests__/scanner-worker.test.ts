import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../config/env';
import type { ProviderRouter } from '../../providers/router';
import { createMemoryStore } from '../../store/memory-store';
import { computeIntelligenceTemporalNarrativeProfile, runIntelligenceScannerPass } from '../service';

const ENV_SNAPSHOT = { ...process.env };

describe('runIntelligenceScannerPass', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LOCAL_LLM_ENABLED = 'false';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ENV_SNAPSHOT };
  });

  it('fetches documents, creates signals, and upserts clustered events', async () => {
    const userId = '00000000-0000-4000-8000-000000000421';
    const store = createMemoryStore(userId, 'intelligence-scanner@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Intelligence JSON Feed',
      kind: 'json',
      url: 'https://example.com/intelligence.json',
      sourceType: 'policy',
      sourceTier: 'tier_0',
      pollMinutes: 5,
      parserConfigJson: {
        itemsPath: 'items',
        titleField: 'title',
        summaryField: 'summary',
        urlField: 'url',
        publishedAtField: 'published_at',
      },
      entityHints: ['Hormuz', 'LNG'],
      metricHints: ['rates', 'freight'],
    });

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              title: 'Official Hormuz LNG routing shock',
              summary: 'Government update points to freight pressure, insurance repricing, and policy spillovers.',
              url: 'https://example.com/hormuz-lng',
              published_at: '2026-03-12T01:00:00.000Z',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: 'intel-etag-1',
            'last-modified': 'Thu, 12 Mar 2026 01:00:00 GMT',
          },
        }
      )
    );

    const providerRouter = {
      generate: vi.fn().mockResolvedValue({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify({
            title: 'Hormuz LNG routing shock',
            summary: 'Routing stress is spilling into freight, insurance, and policy expectations.',
            event_family: 'geopolitical_flashpoint',
            entities: ['Hormuz', 'LNG', 'Fed'],
            semantic_claims: [
              {
                subject_entity: 'Hormuz',
                predicate: 'raises',
                object: 'routing risk',
                evidence_span: 'routing shock',
                time_scope: null,
                uncertainty: 'medium',
                stance: 'supporting',
                claim_type: 'signal',
              },
            ],
            metric_shocks: [],
            domain_posteriors: [
              {
                domain_id: 'geopolitics_energy_lng',
                score: 0.82,
                evidence_features: ['routing risk'],
                counter_features: [],
              },
            ],
            primary_hypotheses: [
              {
                title: 'Energy routing stress may persist',
                summary: 'The event points to durable energy and logistics repricing.',
                confidence: 0.72,
                rationale: 'Official source and clustered claims align on a cross-market signal.',
              },
            ],
            counter_hypotheses: [
              {
                title: 'Headline noise remains possible',
                summary: 'Follow-up confirmation may fail to materialize.',
                confidence: 0.42,
                rationale: 'Only the initial signal is visible so far.',
              },
            ],
            invalidation_conditions: [
              {
                title: 'No follow-up filing',
                description: 'No official follow-up appears.',
                matcher_json: { type: 'official_follow_up_absent' },
              },
              {
                title: 'No market reaction',
                description: 'Related markets remain flat.',
                matcher_json: { type: 'market_confirmation_absent' },
              },
            ],
            expected_signals: [
              {
                signal_key: 'official_follow_up',
                description: 'Official follow-up appears.',
                due_at: null,
              },
              {
                signal_key: 'market_confirmation',
                description: 'Market confirmation appears.',
                due_at: null,
              },
            ],
            world_states: [
              {
                key: 'routing_risk',
                value_json: { score: 0.8 },
              },
            ],
          }),
        },
        attempts: [],
        usedFallback: false,
      }),
    } as unknown as ProviderRouter;

    const result = await runIntelligenceScannerPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      fetchTimeoutMs: 2_000,
      sourceBatch: 10,
      fetchImpl,
    });

    expect(result.fetchedCount).toBe(1);
    expect(result.storedDocumentCount).toBe(1);
    expect(result.signalCount).toBe(1);
    expect(result.clusteredEventCount).toBe(1);

    const events = await store.listIntelligenceEvents({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(events[0]?.title).toBe('Hormuz LNG routing shock');
    expect(events[0]?.topDomainId).toBe('geopolitics_energy_lng');
    expect(events[0]?.primaryHypotheses.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.timeCoherenceScore).toBeGreaterThan(0);

    const runs = await store.listIntelligenceScanRuns({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(runs[0]?.status).toBe('ok');
  });

  it('separates time-distant identical claims into different linked claims and events', async () => {
    const userId = '00000000-0000-4000-8000-000000000430';
    const store = createMemoryStore(userId, 'intelligence-temporal@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Temporal Claim Feed',
      kind: 'json',
      url: 'https://example.com/temporal-claims.json',
      sourceType: 'policy',
      sourceTier: 'tier_0',
      pollMinutes: 5,
      parserConfigJson: {
        itemsPath: 'items',
        titleField: 'title',
        summaryField: 'summary',
        urlField: 'url',
        publishedAtField: 'published_at',
      },
      entityHints: ['Hormuz', 'LNG'],
    });

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              title: 'Hormuz routing stress flares in early March',
              summary: 'Official routing update points to LNG shipping stress.',
              url: 'https://example.com/hormuz-routing-early-march',
              published_at: '2026-03-01T01:00:00.000Z',
            },
            {
              title: 'Hormuz routing stress returns later in March',
              summary: 'A later update repeats the same routing stress language.',
              url: 'https://example.com/hormuz-routing-late-march',
              published_at: '2026-03-10T01:00:00.000Z',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: 'temporal-claim-etag-1',
            'last-modified': 'Tue, 10 Mar 2026 01:00:00 GMT',
          },
        },
      ),
    );

    const providerRouter = {
      generate: vi.fn().mockResolvedValue({
        result: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          outputText: JSON.stringify({
            title: 'Hormuz routing stress',
            summary: 'Routing stress is affecting LNG shipping confidence.',
            event_family: 'geopolitical_flashpoint',
            entities: ['Hormuz', 'LNG'],
            semantic_claims: [
              {
                subject_entity: 'Hormuz',
                predicate: 'raises',
                object: 'routing risk',
                evidence_span: 'routing stress',
                time_scope: null,
                uncertainty: 'medium',
                stance: 'supporting',
                claim_type: 'signal',
              },
            ],
            metric_shocks: [],
            domain_posteriors: [
              {
                domain_id: 'geopolitics_energy_lng',
                score: 0.8,
                evidence_features: ['routing risk'],
                counter_features: [],
              },
            ],
            primary_hypotheses: [
              {
                title: 'Routing stress is active',
                summary: 'Shipping lanes remain stressed.',
                confidence: 0.72,
                rationale: 'Official language points to renewed routing stress.',
              },
            ],
            counter_hypotheses: [
              {
                title: 'Headline repetition only',
                summary: 'The language may be stale and not indicate an active shift.',
                confidence: 0.4,
                rationale: 'Repeated wording can overstate current conditions.',
              },
            ],
            invalidation_conditions: [
              {
                title: 'No freight confirmation',
                description: 'Freight metrics do not react.',
                matcher_json: { type: 'market_confirmation_absent' },
              },
              {
                title: 'No official follow-up',
                description: 'No higher-trust follow-up appears.',
                matcher_json: { type: 'official_follow_up_absent' },
              },
            ],
            expected_signals: [
              {
                signal_key: 'freight_confirmation',
                description: 'Freight confirmation appears.',
                due_at: null,
              },
              {
                signal_key: 'official_follow_up',
                description: 'Official follow-up appears.',
                due_at: null,
              },
            ],
            world_states: [
              {
                key: 'routing_risk',
                value_json: { score: 0.74 },
              },
            ],
          }),
        },
        attempts: [],
        usedFallback: false,
      }),
    } as unknown as ProviderRouter;

    const result = await runIntelligenceScannerPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      fetchTimeoutMs: 2_000,
      sourceBatch: 10,
      fetchImpl,
    });

    expect(result.signalCount).toBe(2);
    expect(result.clusteredEventCount).toBe(2);

    const events = await store.listIntelligenceEvents({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(events).toHaveLength(2);
    expect(events.every((row) => row.linkedClaimCount === 1)).toBe(true);
    expect(events.every((row) => row.timeCoherenceScore > 0.8)).toBe(true);

    const linkedClaims = await store.listIntelligenceLinkedClaims({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(linkedClaims).toHaveLength(2);
    expect(linkedClaims.every((row) => row.sourceCount === 1)).toBe(true);

    const sortedEvents = [...events].sort(
      (left, right) => new Date(left.timeWindowEnd ?? left.updatedAt).getTime() - new Date(right.timeWindowEnd ?? right.updatedAt).getTime(),
    );
    const temporalProfile = computeIntelligenceTemporalNarrativeProfile({
      event: sortedEvents[1]!,
      candidateEvents: sortedEvents,
    });
    expect(temporalProfile.relatedHistoricalEventCount).toBeGreaterThan(0);
    expect(temporalProfile.recurringNarrativeScore).toBeGreaterThan(0);
    expect(['recurring', 'diverging']).toContain(temporalProfile.temporalNarrativeState);
    const temporalLedger = await store.listIntelligenceTemporalNarrativeLedgerEntries({
      workspaceId: workspace.id,
      eventId: sortedEvents[1]!.id,
    });
    expect(temporalLedger.length).toBeGreaterThan(0);
    expect(temporalLedger[0]?.relatedEventId).toBe(sortedEvents[0]!.id);
    const memberships = await store.listIntelligenceNarrativeClusterMemberships({
      workspaceId: workspace.id,
      eventId: sortedEvents[1]!.id,
      limit: 5,
    });
    expect(memberships.length).toBeGreaterThan(0);
    const cluster = await store.getIntelligenceNarrativeClusterById({
      workspaceId: workspace.id,
      clusterId: memberships[0]!.clusterId,
    });
    expect(cluster?.eventCount).toBeGreaterThanOrEqual(2);
  });

  it('links sparse multi-document claims into one event and records absence evidence', async () => {
    const userId = '00000000-0000-4000-8000-000000000422';
    const store = createMemoryStore(userId, 'intelligence-linking@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Linked Claim Feed',
      kind: 'json',
      url: 'https://example.com/linked-claims.json',
      sourceType: 'policy',
      sourceTier: 'tier_0',
      pollMinutes: 5,
      parserConfigJson: {
        itemsPath: 'items',
        titleField: 'title',
        summaryField: 'summary',
        urlField: 'url',
        publishedAtField: 'published_at',
      },
      entityHints: ['Hormuz', 'LNG'],
      metricHints: ['freight'],
    });
    await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Linked Claim Social Feed',
      kind: 'json',
      url: 'https://example.com/social-linked-claims.json',
      sourceType: 'social',
      sourceTier: 'tier_3',
      pollMinutes: 5,
      parserConfigJson: {
        itemsPath: 'items',
        titleField: 'title',
        summaryField: 'summary',
        urlField: 'url',
        publishedAtField: 'published_at',
      },
      entityHints: ['Hormuz', 'LNG'],
    });

    const fetchImpl = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('social-linked-claims')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                title: 'Social desk echoes Hormuz routing stress',
                summary: 'Community chatter mirrors the same routing risk.',
                url: 'https://social.example.com/hormuz-desk',
                published_at: '2026-03-12T02:30:00.000Z',
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              etag: 'linked-claim-social-etag-1',
              'last-modified': 'Thu, 12 Mar 2026 02:30:00 GMT',
            },
          },
        );
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              title: 'Official Hormuz LNG routing shock',
              summary: 'Government update points to freight pressure.',
              url: 'https://example.com/hormuz-routing-shock',
              published_at: '2026-03-12T01:00:00.000Z',
            },
            {
              title: 'Follow-up logistics memo',
              summary: 'A logistics desk sees the same routing stress.',
              url: 'https://example.com/logistics-memo',
              published_at: '2026-03-12T02:00:00.000Z',
            },
            {
              title: 'Analyst disputes immediate market damage',
              summary: 'A follow-up note pushes back on the severity.',
              url: 'https://example.com/analyst-dispute',
              published_at: '2026-03-12T03:00:00.000Z',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: 'linked-claim-etag-1',
            'last-modified': 'Thu, 12 Mar 2026 03:00:00 GMT',
          },
        },
      );
    });

    const providerRouter = {
      generate: vi.fn().mockImplementation(async ({ prompt }: { prompt?: string }) => {
        const text = String(prompt ?? '');
        if (text.includes('Analyst disputes immediate market damage')) {
          return {
            result: {
              provider: 'openai',
              model: 'gpt-4.1-mini',
              outputText: JSON.stringify({
                title: 'Hormuz routing uncertainty',
                summary: 'Conflicting follow-up commentary is arriving around the same shipping event.',
                event_family: 'geopolitical_flashpoint',
                entities: ['Hormuz'],
                semantic_claims: [
                  {
                    subject_entity: 'Hormuz',
                    predicate: 'raises',
                    object: 'routing risk',
                    evidence_span: 'pushes back on the severity',
                    time_scope: null,
                    uncertainty: 'medium',
                    stance: 'contradicting',
                    claim_type: 'signal',
                  },
                ],
                metric_shocks: [],
                domain_posteriors: [
                  {
                    domain_id: 'geopolitics_energy_lng',
                    score: 0.8,
                    evidence_features: ['routing risk'],
                    counter_features: ['analyst dispute'],
                  },
                ],
                primary_hypotheses: [
                  {
                    title: 'Energy routing stress may persist',
                    summary: 'The event still points to durable energy and logistics repricing.',
                    confidence: 0.74,
                    rationale: 'Official and logistics signals still dominate.',
                  },
                ],
                counter_hypotheses: [
                  {
                    title: 'Headline noise remains possible',
                    summary: 'The dispute may mean stress is overstated.',
                    confidence: 0.39,
                    rationale: 'A contradictory analyst note arrived quickly.',
                  },
                ],
                invalidation_conditions: [
                  {
                    title: 'No follow-up filing',
                    description: 'No official follow-up appears.',
                    matcher_json: { type: 'official_follow_up_absent' },
                  },
                  {
                    title: 'No market reaction',
                    description: 'Related markets remain flat.',
                    matcher_json: { type: 'market_confirmation_absent' },
                  },
                ],
                expected_signals: [
                  {
                    signal_key: 'official_follow_up',
                    description: 'Official follow-up appears.',
                    due_at: '2026-03-11T00:00:00.000Z',
                  },
                  {
                    signal_key: 'market_confirmation',
                    description: 'Market confirmation appears.',
                    due_at: null,
                  },
                ],
                world_states: [
                  {
                    key: 'routing_risk',
                    value_json: { score: 0.78 },
                  },
                ],
              }),
            },
            attempts: [],
            usedFallback: false,
          };
        }

        if (text.includes('Follow-up logistics memo')) {
          return {
            result: {
              provider: 'openai',
              model: 'gpt-4.1-mini',
              outputText: JSON.stringify({
                title: 'Hormuz routing update',
                summary: 'A logistics memo reinforces the same routing stress.',
                event_family: 'geopolitical_flashpoint',
                entities: ['Hormuz'],
                semantic_claims: [
                  {
                    subject_entity: 'Hormuz',
                    predicate: 'raises',
                    object: 'routing risk',
                    evidence_span: 'same routing stress',
                    time_scope: null,
                    uncertainty: 'medium',
                    stance: 'supporting',
                    claim_type: 'signal',
                  },
                ],
                metric_shocks: [],
                domain_posteriors: [
                  {
                    domain_id: 'geopolitics_energy_lng',
                    score: 0.81,
                    evidence_features: ['routing risk'],
                    counter_features: [],
                  },
                ],
                primary_hypotheses: [
                  {
                    title: 'Energy routing stress may persist',
                    summary: 'The event points to durable energy and logistics repricing.',
                    confidence: 0.76,
                    rationale: 'A second document reinforces the same claim.',
                  },
                ],
                counter_hypotheses: [
                  {
                    title: 'Headline noise remains possible',
                    summary: 'Follow-up confirmation may still fail to materialize.',
                    confidence: 0.33,
                    rationale: 'Signal remains early.',
                  },
                ],
                invalidation_conditions: [
                  {
                    title: 'No follow-up filing',
                    description: 'No official follow-up appears.',
                    matcher_json: { type: 'official_follow_up_absent' },
                  },
                  {
                    title: 'No market reaction',
                    description: 'Related markets remain flat.',
                    matcher_json: { type: 'market_confirmation_absent' },
                  },
                ],
                expected_signals: [
                  {
                    signal_key: 'official_follow_up',
                    description: 'Official follow-up appears.',
                    due_at: '2026-03-11T00:00:00.000Z',
                  },
                  {
                    signal_key: 'market_confirmation',
                    description: 'Market confirmation appears.',
                    due_at: null,
                  },
                ],
                world_states: [
                  {
                    key: 'routing_risk',
                    value_json: { score: 0.81 },
                  },
                ],
              }),
            },
            attempts: [],
            usedFallback: false,
          };
        }

        return {
          result: {
            provider: 'openai',
            model: 'gpt-4.1-mini',
            outputText: JSON.stringify({
              title: 'Hormuz LNG routing shock',
              summary: 'Routing stress is spilling into freight and insurance.',
              event_family: 'geopolitical_flashpoint',
              entities: ['Hormuz', 'LNG', 'Fed'],
              semantic_claims: [
                {
                  subject_entity: 'Hormuz',
                  predicate: 'raises',
                  object: 'routing risk',
                  evidence_span: 'routing shock',
                  time_scope: null,
                  uncertainty: 'medium',
                  stance: 'supporting',
                  claim_type: 'signal',
                },
              ],
              metric_shocks: [],
              domain_posteriors: [
                {
                  domain_id: 'geopolitics_energy_lng',
                  score: 0.82,
                  evidence_features: ['routing risk'],
                  counter_features: [],
                },
              ],
              primary_hypotheses: [
                {
                  title: 'Energy routing stress may persist',
                  summary: 'The event points to durable energy and logistics repricing.',
                  confidence: 0.78,
                  rationale: 'Official source aligns with shipping risk language.',
                },
              ],
              counter_hypotheses: [
                {
                  title: 'Headline noise remains possible',
                  summary: 'Follow-up confirmation may fail to materialize.',
                  confidence: 0.28,
                  rationale: 'Only the initial signal is visible so far.',
                },
              ],
              invalidation_conditions: [
                {
                  title: 'No follow-up filing',
                  description: 'No official follow-up appears.',
                  matcher_json: { type: 'official_follow_up_absent' },
                },
                {
                  title: 'No market reaction',
                  description: 'Related markets remain flat.',
                  matcher_json: { type: 'market_confirmation_absent' },
                },
              ],
              expected_signals: [
                {
                  signal_key: 'official_follow_up',
                  description: 'Official follow-up appears.',
                  due_at: '2026-03-11T00:00:00.000Z',
                },
                {
                  signal_key: 'market_confirmation',
                  description: 'Market confirmation appears.',
                  due_at: null,
                },
              ],
              world_states: [
                {
                  key: 'routing_risk',
                  value_json: { score: 0.82 },
                },
              ],
            }),
          },
          attempts: [],
          usedFallback: false,
        };
      }),
    } as unknown as ProviderRouter;

    const result = await runIntelligenceScannerPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      fetchTimeoutMs: 2_000,
      sourceBatch: 10,
      fetchImpl,
    });

    expect(result.fetchedCount).toBe(4);
    expect(result.signalCount).toBe(4);
    expect(result.clusteredEventCount).toBe(1);

    const events = await store.listIntelligenceEvents({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.linkedClaimCount).toBe(1);
    expect(events[0]?.contradictionCount).toBeGreaterThanOrEqual(1);
    expect(events[0]?.nonSocialCorroborationCount).toBeGreaterThanOrEqual(1);
    expect(events[0]?.linkedClaimHealthScore).toBeGreaterThan(0);
    expect(events[0]?.timeCoherenceScore).toBeGreaterThan(0);
    expect(events[0]?.expectedSignals.some((signal) => signal.status === 'absent')).toBe(true);
    expect(events[0]?.outcomes.some((outcome) => outcome.summary.includes('absent past due date'))).toBe(true);

    const linkedClaims = await store.listIntelligenceLinkedClaims({
      workspaceId: workspace.id,
      eventId: events[0]!.id,
      limit: 10,
    });
    expect(linkedClaims).toHaveLength(1);
    expect(linkedClaims[0]?.sourceCount).toBe(4);
    expect(linkedClaims[0]?.contradictionCount).toBeGreaterThanOrEqual(1);
    expect(linkedClaims[0]?.predicateFamily).toBe('pressure_up');
    expect(linkedClaims[0]?.nonSocialSourceCount).toBeGreaterThanOrEqual(1);
    expect(typeof linkedClaims[0]?.lastSupportedAt).toBe('string');
    expect(typeof linkedClaims[0]?.lastContradictedAt).toBe('string');

    const claimLinks = await store.listIntelligenceClaimLinks({
      workspaceId: workspace.id,
      eventId: events[0]!.id,
      limit: 10,
    });
    expect(claimLinks).toHaveLength(4);
    expect(claimLinks.some((row) => row.linkStrength > 0.5)).toBe(true);

    const ledgerEntries = await store.listIntelligenceHypothesisLedgerEntries({
      workspaceId: workspace.id,
      eventId: events[0]!.id,
    });
    const evidenceLinks = await store.listIntelligenceHypothesisEvidenceLinks({
      workspaceId: workspace.id,
      eventId: events[0]!.id,
    });
    const invalidationEntries = await store.listIntelligenceInvalidationEntries({
      workspaceId: workspace.id,
      eventId: events[0]!.id,
    });
    const expectedSignalEntries = await store.listIntelligenceExpectedSignalEntries({
      workspaceId: workspace.id,
      eventId: events[0]!.id,
    });
    const outcomeEntries = await store.listIntelligenceOutcomeEntries({
      workspaceId: workspace.id,
      eventId: events[0]!.id,
    });
    expect(ledgerEntries.length).toBeGreaterThanOrEqual(2);
    expect(evidenceLinks.length).toBeGreaterThanOrEqual(2);
    expect(evidenceLinks.some((row) => row.evidenceStrength !== null)).toBe(true);
    expect(invalidationEntries.length).toBeGreaterThanOrEqual(2);
    expect(expectedSignalEntries.some((row) => row.status === 'absent')).toBe(true);
    expect(outcomeEntries.some((row) => row.summary.includes('absent past due date'))).toBe(true);
  });

  it('builds support and contradiction edges for multi-claim events', async () => {
    const userId = '00000000-0000-4000-8000-000000000433';
    const store = createMemoryStore(userId, 'intelligence-graph@example.com');
    await store.initialize();
    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId });
    await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Graph Claim Feed',
      kind: 'json',
      url: 'https://example.com/graph-claims.json',
      sourceType: 'policy',
      sourceTier: 'tier_0',
      pollMinutes: 5,
      parserConfigJson: {
        itemsPath: 'items',
        titleField: 'title',
        summaryField: 'summary',
        urlField: 'url',
        publishedAtField: 'published_at',
      },
      entityHints: ['Hormuz', 'LNG'],
    });

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              title: 'Hormuz routing stress rises',
              summary: 'Official routing stress is rising.',
              url: 'https://example.com/graph-routing-risk',
              published_at: '2026-03-12T01:00:00.000Z',
            },
            {
              title: 'Hormuz insurance pressure follows routing stress',
              summary: 'Insurance pressure is rising alongside the same event.',
              url: 'https://example.com/graph-insurance-pressure',
              published_at: '2026-03-12T02:00:00.000Z',
            },
            {
              title: 'Analyst says Hormuz routing risk is easing',
              summary: 'A follow-up note disputes the severity of routing stress.',
              url: 'https://example.com/graph-routing-dispute',
              published_at: '2026-03-12T03:00:00.000Z',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const providerRouter = {
      generate: vi.fn().mockImplementation(async ({ prompt }: { prompt?: string }) => {
        const text = String(prompt ?? '');
        if (text.includes('Classify whether an incoming claim should be linked')) {
          if (text.includes('INCOMING_OBJECT: insurance pressure') && text.includes('CANONICAL_OBJECT: routing risk')) {
            return {
              result: {
                provider: 'openai',
                model: 'gpt-4.1-mini',
                outputText: JSON.stringify({
                  relation: 'unrelated',
                  confidence: 0.81,
                  rationale: 'This should remain a separate canonical claim and be linked later via graph edges.',
                }),
              },
              attempts: [],
              usedFallback: false,
            };
          }
          if (text.includes('INCOMING_OBJECT: routing risk') && text.includes('CANONICAL_OBJECT: insurance pressure')) {
            return {
              result: {
                provider: 'openai',
                model: 'gpt-4.1-mini',
                outputText: JSON.stringify({
                  relation: 'supporting',
                  confidence: 0.78,
                  rationale: 'Routing stress and insurance pressure are part of the same event chain.',
                }),
              },
              attempts: [],
              usedFallback: false,
            };
          }
          if (text.includes('INCOMING_OBJECT: easing pressure') && text.includes('CANONICAL_OBJECT: routing risk')) {
            return {
              result: {
                provider: 'openai',
                model: 'gpt-4.1-mini',
                outputText: JSON.stringify({
                  relation: 'unrelated',
                  confidence: 0.83,
                  rationale: 'This should remain separate so the contradiction edge can be tracked explicitly.',
                }),
              },
              attempts: [],
              usedFallback: false,
            };
          }
          if (text.includes('INCOMING_OBJECT: routing risk') && text.includes('CANONICAL_OBJECT: easing pressure')) {
            return {
              result: {
                provider: 'openai',
                model: 'gpt-4.1-mini',
                outputText: JSON.stringify({
                  relation: 'contradicting',
                  confidence: 0.82,
                  rationale: 'The candidate explicitly disputes the routing risk narrative.',
                }),
              },
              attempts: [],
              usedFallback: false,
            };
          }
          if (text.includes('INCOMING_OBJECT: insurance pressure') && text.includes('CANONICAL_OBJECT: easing pressure')) {
            return {
              result: {
                provider: 'openai',
                model: 'gpt-4.1-mini',
                outputText: JSON.stringify({
                  relation: 'unrelated',
                  confidence: 0.8,
                  rationale: 'Keep the contradiction claim separate from the support claim.',
                }),
              },
              attempts: [],
              usedFallback: false,
            };
          }
          if (text.includes('INCOMING_OBJECT: easing pressure') && text.includes('CANONICAL_OBJECT: insurance pressure')) {
            return {
              result: {
                provider: 'openai',
                model: 'gpt-4.1-mini',
                outputText: JSON.stringify({
                  relation: 'unrelated',
                  confidence: 0.8,
                  rationale: 'Keep the contradiction claim separate from the support claim.',
                }),
              },
              attempts: [],
              usedFallback: false,
            };
          }
          return {
            result: {
              provider: 'openai',
              model: 'gpt-4.1-mini',
              outputText: JSON.stringify({
                relation: 'related',
                confidence: 0.62,
                rationale: 'Loose topical overlap.',
              }),
            },
            attempts: [],
            usedFallback: false,
          };
        }

        if (text.includes('insurance pressure follows')) {
          return {
            result: {
              provider: 'openai',
              model: 'gpt-4.1-mini',
              outputText: JSON.stringify({
                title: 'Hormuz routing monitor',
                summary: 'Insurance pressure is rising alongside routing stress.',
                event_family: 'geopolitical_flashpoint',
                entities: ['Hormuz', 'LNG'],
                semantic_claims: [
                  {
                    subject_entity: 'Hormuz',
                    predicate: 'raises',
                    object: 'insurance pressure',
                    evidence_span: 'insurance pressure is rising',
                    time_scope: null,
                    uncertainty: 'medium',
                    stance: 'supporting',
                    claim_type: 'signal',
                  },
                ],
                metric_shocks: [],
                domain_posteriors: [
                  {
                    domain_id: 'geopolitics_energy_lng',
                    score: 0.8,
                    evidence_features: ['insurance pressure'],
                    counter_features: [],
                  },
                ],
                primary_hypotheses: [
                  {
                    title: 'Routing stress is broadening',
                    summary: 'Insurance pressure confirms the stress chain.',
                    confidence: 0.75,
                    rationale: 'A second claim extends the same event structure.',
                  },
                ],
                counter_hypotheses: [
                  {
                    title: 'Narrative spillover only',
                    summary: 'The event may still be media amplification.',
                    confidence: 0.34,
                    rationale: 'Only claim-level spillover is visible.',
                  },
                ],
                invalidation_conditions: [
                  {
                    title: 'No official follow-up',
                    description: 'No official follow-up appears.',
                    matcher_json: { type: 'official_follow_up_absent' },
                  },
                  {
                    title: 'No market reaction',
                    description: 'Related markets remain flat.',
                    matcher_json: { type: 'market_confirmation_absent' },
                  },
                ],
                expected_signals: [
                  {
                    signal_key: 'official_follow_up',
                    description: 'Official follow-up appears.',
                    due_at: null,
                  },
                  {
                    signal_key: 'market_confirmation',
                    description: 'Market confirmation appears.',
                    due_at: null,
                  },
                ],
                world_states: [{ key: 'routing_risk', value_json: { score: 0.77 } }],
              }),
            },
            attempts: [],
            usedFallback: false,
          };
        }

        if (text.includes('routing risk is easing')) {
          return {
            result: {
              provider: 'openai',
              model: 'gpt-4.1-mini',
              outputText: JSON.stringify({
                title: 'Hormuz routing monitor',
                summary: 'A follow-up note disputes the routing stress narrative.',
                event_family: 'geopolitical_flashpoint',
                entities: ['Hormuz', 'LNG'],
                semantic_claims: [
                  {
                    subject_entity: 'Hormuz',
                    predicate: 'lowers',
                    object: 'easing pressure',
                    evidence_span: 'risk is easing',
                    time_scope: null,
                    uncertainty: 'medium',
                    stance: 'contradicting',
                    claim_type: 'signal',
                  },
                ],
                metric_shocks: [],
                domain_posteriors: [
                  {
                    domain_id: 'geopolitics_energy_lng',
                    score: 0.74,
                    evidence_features: ['routing dispute'],
                    counter_features: ['analyst pushback'],
                  },
                ],
                primary_hypotheses: [
                  {
                    title: 'Routing stress remains active',
                    summary: 'Support edges still outweigh the dispute.',
                    confidence: 0.68,
                    rationale: 'Contradiction exists but does not erase the event.',
                  },
                ],
                counter_hypotheses: [
                  {
                    title: 'Stress may be overstated',
                    summary: 'The contradiction may weaken the primary narrative.',
                    confidence: 0.52,
                    rationale: 'A directly conflicting claim has appeared.',
                  },
                ],
                invalidation_conditions: [
                  {
                    title: 'No official follow-up',
                    description: 'No official follow-up appears.',
                    matcher_json: { type: 'official_follow_up_absent' },
                  },
                  {
                    title: 'No market reaction',
                    description: 'Related markets remain flat.',
                    matcher_json: { type: 'market_confirmation_absent' },
                  },
                ],
                expected_signals: [
                  {
                    signal_key: 'official_follow_up',
                    description: 'Official follow-up appears.',
                    due_at: null,
                  },
                  {
                    signal_key: 'market_confirmation',
                    description: 'Market confirmation appears.',
                    due_at: null,
                  },
                ],
                world_states: [{ key: 'routing_risk', value_json: { score: 0.64 } }],
              }),
            },
            attempts: [],
            usedFallback: false,
          };
        }

        return {
          result: {
            provider: 'openai',
            model: 'gpt-4.1-mini',
            outputText: JSON.stringify({
              title: 'Hormuz routing monitor',
              summary: 'Routing stress is rising across the same event.',
              event_family: 'geopolitical_flashpoint',
              entities: ['Hormuz', 'LNG'],
              semantic_claims: [
                {
                  subject_entity: 'Hormuz',
                  predicate: 'raises',
                  object: 'routing risk',
                  evidence_span: 'routing stress is rising',
                  time_scope: null,
                  uncertainty: 'medium',
                  stance: 'supporting',
                  claim_type: 'signal',
                },
              ],
              metric_shocks: [],
              domain_posteriors: [
                {
                  domain_id: 'geopolitics_energy_lng',
                  score: 0.82,
                  evidence_features: ['routing risk'],
                  counter_features: [],
                },
              ],
              primary_hypotheses: [
                {
                  title: 'Routing stress remains active',
                  summary: 'Initial claim indicates active stress.',
                  confidence: 0.78,
                  rationale: 'Official language points to routing pressure.',
                },
              ],
              counter_hypotheses: [
                {
                  title: 'Headline noise remains possible',
                  summary: 'The signal could still fade.',
                  confidence: 0.28,
                  rationale: 'Only one claim is visible initially.',
                },
              ],
              invalidation_conditions: [
                {
                  title: 'No official follow-up',
                  description: 'No official follow-up appears.',
                  matcher_json: { type: 'official_follow_up_absent' },
                },
                {
                  title: 'No market reaction',
                  description: 'Related markets remain flat.',
                  matcher_json: { type: 'market_confirmation_absent' },
                },
              ],
              expected_signals: [
                {
                  signal_key: 'official_follow_up',
                  description: 'Official follow-up appears.',
                  due_at: null,
                },
                {
                  signal_key: 'market_confirmation',
                  description: 'Market confirmation appears.',
                  due_at: null,
                },
              ],
              world_states: [{ key: 'routing_risk', value_json: { score: 0.8 } }],
            }),
          },
          attempts: [],
          usedFallback: false,
        };
      }),
    } as unknown as ProviderRouter;

    await runIntelligenceScannerPass({
      store,
      providerRouter,
      env: loadEnv(),
      workspaceId: workspace.id,
      fetchTimeoutMs: 2_000,
      sourceBatch: 10,
      fetchImpl,
    });

    const events = await store.listIntelligenceEvents({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.linkedClaimCount).toBeGreaterThanOrEqual(2);
    expect(events[0]?.graphSupportScore).toBeGreaterThan(0);
    expect(events[0]?.graphContradictionScore).toBeGreaterThan(0);
    expect(events[0]?.graphHotspotCount).toBeGreaterThan(0);

    const edges = await store.listIntelligenceLinkedClaimEdges({
      workspaceId: workspace.id,
      eventId: events[0]!.id,
      limit: 20,
    });
    expect(edges.some((row) => row.relation === 'supports')).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });
});
