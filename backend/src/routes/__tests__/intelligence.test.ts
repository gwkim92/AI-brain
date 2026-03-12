import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runIntelligenceScannerPass } from '../../intelligence/service';
import type { ProviderRouter } from '../../providers/router';
import { buildServer } from '../../server';

const ENV_SNAPSHOT = { ...process.env };

describe('Intelligence routes', () => {
  function createStructuredProviderRouter() {
    return {
      generate: vi.fn().mockImplementation(async ({ prompt }: { prompt?: string }) => {
        const text = String(prompt ?? '');
        const contradictory = text.includes('disputes') || text.includes('pushes back');
        return {
          result: {
            provider: 'openai',
            model: 'gpt-4.1-mini',
            outputText: JSON.stringify({
              title: 'Hormuz routing monitor',
              summary: contradictory
                ? 'Conflicting commentary is arriving on the same routing event.'
                : 'Routing stress is being monitored across linked documents.',
              event_family: 'geopolitical_flashpoint',
              entities: text.includes('Sparse follow-up') ? ['Hormuz'] : ['Hormuz', 'LNG', 'Fed'],
              semantic_claims: [
                {
                  subject_entity: 'Hormuz',
                  predicate: 'raises',
                  object: 'routing risk',
                  evidence_span: contradictory ? 'pushes back' : 'routing stress',
                  time_scope: null,
                  uncertainty: 'medium',
                  stance: contradictory ? 'contradicting' : 'supporting',
                  claim_type: 'signal',
                },
              ],
              metric_shocks: [],
              domain_posteriors: [
                {
                  domain_id: 'geopolitics_energy_lng',
                  score: 0.83,
                  evidence_features: ['routing risk'],
                  counter_features: contradictory ? ['analyst pushback'] : [],
                },
              ],
              primary_hypotheses: [
                {
                  title: 'Energy routing stress may persist',
                  summary: 'The event points to durable energy and logistics repricing.',
                  confidence: contradictory ? 0.68 : 0.78,
                  rationale: 'Multiple documents continue to track the same routing stress.',
                },
              ],
              counter_hypotheses: [
                {
                  title: 'Headline noise remains possible',
                  summary: 'Follow-up confirmation may fail to materialize.',
                  confidence: contradictory ? 0.5 : 0.32,
                  rationale: 'A contradictory view still exists.',
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
                  value_json: { score: contradictory ? 0.74 : 0.82 },
                },
              ],
            }),
          },
          attempts: [],
          usedFallback: false,
        };
      }),
    };
  }

  beforeEach(() => {
    process.env.STORE_BACKEND = 'memory';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PORT = '4011';
    process.env.LOCAL_LLM_ENABLED = 'false';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.AUTH_REQUIRED = 'false';
    process.env.AUTH_TOKEN = 'test_auth_token';
    process.env.TELEGRAM_REPORT_WORKER_ENABLED = 'false';
    process.env.RADAR_SCANNER_WORKER_ENABLED = 'false';
    process.env.INTELLIGENCE_SCANNER_WORKER_ENABLED = 'false';
    process.env.INTELLIGENCE_MODEL_SYNC_WORKER_ENABLED = 'false';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ENV_SNAPSHOT };
  });

  it('lists default intelligence workspaces, seeded sources, and runtime alias bindings', async () => {
    const { app } = await buildServer();
    const headers = {
      'x-user-id': '99999999-9999-4999-8999-999999999999',
      'x-user-role': 'admin',
    };

    const workspaceResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/intelligence/workspaces',
      headers,
    });
    expect(workspaceResponse.statusCode).toBe(200);
    const workspaceBody = workspaceResponse.json() as {
      data: {
        workspaces: Array<{ id: string }>;
      };
    };
    const workspaceId = workspaceBody.data.workspaces[0]?.id;
    expect(workspaceId).toBeTruthy();

    const sourcesResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/sources?workspace_id=${workspaceId}`,
      headers,
    });
    expect(sourcesResponse.statusCode).toBe(200);
    const sourcesBody = sourcesResponse.json() as {
      data: {
        sources: Array<{ id: string; name: string }>;
        scanner_worker: { enabled: boolean };
      };
    };
    expect(sourcesBody.data.sources.length).toBeGreaterThan(0);
    expect(sourcesBody.data.sources.some((row) => row.name.includes('OpenAI'))).toBe(true);
    expect(sourcesBody.data.scanner_worker.enabled).toBe(false);

    const eventsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/events?workspace_id=${workspaceId}`,
      headers,
    });
    expect(eventsResponse.statusCode).toBe(200);
    const eventsBody = eventsResponse.json() as {
      data: {
        events: Array<{ operatorPriorityScore?: number }>;
      };
    };
    expect(Array.isArray(eventsBody.data.events)).toBe(true);

    const aliasesResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/runtime/aliases?workspace_id=${workspaceId}`,
      headers,
    });
    expect(aliasesResponse.statusCode).toBe(200);
    const aliasesBody = aliasesResponse.json() as {
      data: {
        bindings: {
          global: Array<{ alias: string }>;
        };
      };
    };
    expect(aliasesBody.data.bindings.global.length).toBeGreaterThan(0);

    await app.close();
  });

  it('creates and toggles an intelligence source inside the workspace namespace', async () => {
    const { app } = await buildServer();
    const headers = {
      'x-user-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'x-user-role': 'admin',
    };

    const workspaceResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/intelligence/workspaces',
      headers,
    });
    const workspaceBody = workspaceResponse.json() as {
      data: {
        workspaces: Array<{ id: string }>;
      };
    };
    const workspaceId = workspaceBody.data.workspaces[0]?.id;
    expect(workspaceId).toBeTruthy();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/intelligence/sources',
      headers,
      payload: {
        workspace_id: workspaceId,
        name: 'Workspace Search Feed',
        kind: 'search',
        url: 'https://example.com/search?q=ai',
        source_type: 'search_result',
        source_tier: 'tier_1',
        poll_minutes: 30,
        parser_config_json: {
          query: 'ai',
        },
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const createBody = createResponse.json() as {
      data: {
        source: { id: string; enabled: boolean };
      };
    };
    expect(createBody.data.source.enabled).toBe(true);

    const toggleResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/sources/${createBody.data.source.id}/toggle`,
      headers,
      payload: {
        workspace_id: workspaceId,
        enabled: false,
      },
    });
    expect(toggleResponse.statusCode).toBe(200);
    const toggleBody = toggleResponse.json() as {
      data: {
        source: { id: string; enabled: boolean };
      };
    };
    expect(toggleBody.data.source.id).toBe(createBody.data.source.id);
    expect(toggleBody.data.source.enabled).toBe(false);

    const runsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/runs?workspace_id=${workspaceId}`,
      headers,
    });
    expect(runsResponse.statusCode).toBe(200);

    await app.close();
  });

  it('creates a dedicated workspace and returns runtime/provider metadata for intelligence sources', async () => {
    const { app } = await buildServer();
    const headers = {
      'x-user-id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'x-user-role': 'admin',
    };

    const createWorkspace = await app.inject({
      method: 'POST',
      url: '/api/v1/intelligence/workspaces',
      headers,
      payload: {
        name: 'Signals Lab',
      },
    });
    expect(createWorkspace.statusCode).toBe(201);
    const workspaceBody = createWorkspace.json() as {
      data: {
        workspace: { id: string; name: string };
      };
    };
    expect(workspaceBody.data.workspace.name).toBe('Signals Lab');

    const createSource = await app.inject({
      method: 'POST',
      url: '/api/v1/intelligence/sources',
      headers,
      payload: {
        workspace_id: workspaceBody.data.workspace.id,
        name: 'Headless docs',
        kind: 'headless',
        url: 'https://example.com/docs',
        source_type: 'web_page',
        source_tier: 'tier_1',
        crawl_policy: {
          allow_domains: ['example.com'],
          max_pages_per_run: 3,
        },
        connector_capability: {
          connector_id: 'builtin.task_create',
          write_allowed: true,
          destructive: false,
          requires_human: false,
          schema_id: 'jarvis.task_create.v1',
          allowed_actions: ['task_create'],
        },
      },
    });
    expect(createSource.statusCode).toBe(201);

    const sourceList = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/sources?workspace_id=${workspaceBody.data.workspace.id}`,
      headers,
    });
    expect(sourceList.statusCode).toBe(200);
    const sourceListBody = sourceList.json() as {
      data: {
        sources: Array<{
          name: string;
          crawlPolicy: { allowDomains: string[] };
          health: { lastStatus: string };
          connectorCapability: { schemaId: string | null } | null;
        }>;
      };
    };
    expect(sourceListBody.data.sources.some((source) => source.name === 'Headless docs')).toBe(true);
    const createdSource = sourceListBody.data.sources.find((source) => source.name === 'Headless docs');
    expect(createdSource?.crawlPolicy.allowDomains).toContain('example.com');
    expect(createdSource?.health.lastStatus).toBe('idle');
    expect(createdSource?.connectorCapability?.schemaId).toBe('jarvis.task_create.v1');

    const runtimeModels = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/runtime/models?workspace_id=${workspaceBody.data.workspace.id}`,
      headers,
    });
    expect(runtimeModels.statusCode).toBe(200);
    const runtimeModelsBody = runtimeModels.json() as {
      data: {
        provider_health: unknown[];
      };
    };
    expect(Array.isArray(runtimeModelsBody.data.provider_health)).toBe(true);

    await app.close();
  });

  it('exposes enriched event detail, review state updates, notes, hypotheses, and execution audit', async () => {
    const { app, store, env } = await buildServer();
    const headers = {
      'x-user-id': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'x-user-role': 'admin',
    };

    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId: headers['x-user-id'] });
    await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Route detail feed',
      kind: 'json',
      url: 'https://example.com/route-detail.json',
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
      connectorCapability: {
        connectorId: 'builtin.task_create',
        writeAllowed: true,
        destructive: false,
        requiresHuman: false,
        schemaId: 'jarvis.task_create.v1',
        allowedActions: ['task_create'],
      },
      entityHints: ['Hormuz', 'LNG'],
      metricHints: ['freight'],
    });

    await runIntelligenceScannerPass({
      store,
      providerRouter: createStructuredProviderRouter() as unknown as ProviderRouter,
      env,
      workspaceId: workspace.id,
      fetchTimeoutMs: 2_000,
      sourceBatch: 10,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                title: 'Official Hormuz routing notice',
                summary: 'An official routing update was issued.',
                url: 'https://example.com/official-hormuz-routing',
                published_at: '2026-03-12T01:00:00.000Z',
              },
              {
                title: 'Sparse follow-up memo',
                summary: 'A sparse memo references the same routing event.',
                url: 'https://example.com/sparse-follow-up',
                published_at: '2026-03-12T02:00:00.000Z',
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
      ),
    });

    const event = (await store.listIntelligenceEvents({ workspaceId: workspace.id, limit: 10 }))[0];
    expect(event).toBeTruthy();

    const reviewResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/events/${event!.id}/review-state`,
      headers,
      payload: {
        workspace_id: workspace.id,
        review_state: 'review',
        review_reason: 'Contradiction requires operator verification.',
        review_owner: headers['x-user-id'],
      },
    });
    expect(reviewResponse.statusCode).toBe(200);

    const noteResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/events/${event!.id}/operator-note`,
      headers,
      payload: {
        workspace_id: workspace.id,
        scope: 'event',
        note: 'Escalate this routing event for operator review.',
      },
    });
    expect(noteResponse.statusCode).toBe(201);

    const executeCandidate = (
      (await store.getIntelligenceEventById({ workspaceId: workspace.id, eventId: event!.id }))?.executionCandidates ?? []
    )[0];
    expect(executeCandidate).toBeTruthy();

    const executeResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/events/${event!.id}/execute`,
      headers,
      payload: {
        workspace_id: workspace.id,
        candidate_id: executeCandidate!.id,
      },
    });
    expect(executeResponse.statusCode).toBe(200);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/events/${event!.id}?workspace_id=${workspace.id}`,
      headers,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = detailResponse.json() as {
      data: {
        event: {
          operatorPriorityScore?: number;
          reviewReason?: string | null;
          reviewOwner?: string | null;
          nonSocialCorroborationCount?: number;
          linkedClaimHealthScore?: number;
          timeCoherenceScore?: number;
        };
        review_state: string;
        linked_claims: Array<{
          id: string;
          predicateFamily?: string;
          nonSocialSourceCount?: number;
          lastSupportedAt?: string | null;
          lastContradictedAt?: string | null;
        }>;
        claim_links: Array<{ id: string; linkStrength?: number }>;
        execution_audit: Array<{ status: string }>;
        operator_notes: Array<{ note: string }>;
        invalidation_entries: Array<{ id: string }>;
        expected_signal_entries: Array<{ status: string }>;
        outcome_entries: Array<{ summary: string }>;
        narrative_cluster: { id: string; eventCount: number; driftScore: number; reviewState: string } | null;
        narrative_cluster_members: Array<{ eventId: string; relation: string; score: number }>;
        temporal_narrative_ledger: Array<{ relatedEventId: string; relation: string; score: number }>;
      };
    };
    expect(typeof detailBody.data.event.operatorPriorityScore).toBe('number');
    expect(detailBody.data.event.reviewReason).toContain('Contradiction');
    expect(detailBody.data.event.reviewOwner).toBe(headers['x-user-id']);
    expect(detailBody.data.event.nonSocialCorroborationCount).toBeGreaterThanOrEqual(1);
    expect(detailBody.data.event.linkedClaimHealthScore).toBeGreaterThan(0);
    expect(detailBody.data.event.timeCoherenceScore).toBeGreaterThan(0);
    expect(detailBody.data.review_state).toBe('review');
    expect(detailBody.data.linked_claims.length).toBeGreaterThan(0);
    expect(detailBody.data.linked_claims[0]?.predicateFamily).toBeTruthy();
    expect(detailBody.data.linked_claims[0]?.nonSocialSourceCount).toBeGreaterThanOrEqual(1);
    expect(typeof detailBody.data.linked_claims[0]?.lastSupportedAt).toBe('string');
    expect(detailBody.data.claim_links.length).toBeGreaterThan(0);
    expect(detailBody.data.claim_links[0]?.linkStrength).toBeGreaterThan(0);
    expect(detailBody.data.execution_audit.length).toBeGreaterThan(0);
    expect(detailBody.data.operator_notes[0]?.note).toContain('operator review');
    expect(detailBody.data.invalidation_entries.length).toBeGreaterThanOrEqual(2);
    expect(detailBody.data.expected_signal_entries.length).toBeGreaterThanOrEqual(2);
    expect(detailBody.data.outcome_entries.length).toBeGreaterThan(0);
    expect(detailBody.data.narrative_cluster).toBeTruthy();
    expect(detailBody.data.narrative_cluster?.driftScore).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(detailBody.data.narrative_cluster_members)).toBe(true);
    expect(Array.isArray(detailBody.data.temporal_narrative_ledger)).toBe(true);

    const narrativeClusterReviewResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/narrative-clusters/${detailBody.data.narrative_cluster!.id}/review-state`,
      headers,
      payload: {
        workspace_id: workspace.id,
        review_state: 'review',
        review_reason: 'Cluster drift needs manual inspection.',
        review_owner: headers['x-user-id'],
      },
    });
    expect(narrativeClusterReviewResponse.statusCode).toBe(200);

    const clusterNoteResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/events/${event!.id}/operator-note`,
      headers,
      payload: {
        workspace_id: workspace.id,
        scope: 'narrative_cluster',
        scope_id: detailBody.data.narrative_cluster!.id,
        note: 'Cluster note for recurring narrative review.',
      },
    });
    expect(clusterNoteResponse.statusCode).toBe(201);

    const baseLinkedClaimId = detailBody.data.linked_claims[0]!.id;
    const seededLinkedClaim = await store.createIntelligenceLinkedClaim({
      workspaceId: workspace.id,
      claimFingerprint: 'graph-seeded-claim',
      canonicalSubject: 'hormuz',
      canonicalPredicate: 'raises',
      canonicalObject: 'insurance pressure',
      predicateFamily: 'pressure_up',
      timeScope: null,
      timeBucketStart: '2026-03-12T00:00:00.000Z',
      timeBucketEnd: '2026-03-12T23:59:59.000Z',
      stanceDistribution: {
        supporting: 1,
        neutral: 0,
        contradicting: 0,
      },
      sourceCount: 1,
      contradictionCount: 0,
      nonSocialSourceCount: 1,
      supportingSignalIds: [event!.signalIds[0]!],
      lastSupportedAt: '2026-03-12T02:00:00.000Z',
      lastContradictedAt: null,
    });
    await store.replaceIntelligenceEventMemberships({
      workspaceId: workspace.id,
      eventId: event!.id,
      memberships: [
        {
          workspaceId: workspace.id,
          eventId: event!.id,
          linkedClaimId: baseLinkedClaimId,
          role: 'core',
        },
        {
          workspaceId: workspace.id,
          eventId: event!.id,
          linkedClaimId: seededLinkedClaim.id,
          role: 'supporting',
        },
      ],
    });
    await store.createIntelligenceLinkedClaimEdge({
      workspaceId: workspace.id,
      leftLinkedClaimId: baseLinkedClaimId,
      rightLinkedClaimId: seededLinkedClaim.id,
      relation: 'contradicts',
      edgeStrength: 0.74,
      evidenceSignalIds: [event!.signalIds[0]!],
      lastObservedAt: '2026-03-12T03:30:00.000Z',
    });
    await store.upsertIntelligenceEvent({
      ...((await store.getIntelligenceEventById({ workspaceId: workspace.id, eventId: event!.id }))!),
      linkedClaimCount: 2,
      graphSupportScore: 0.22,
      graphContradictionScore: 0.74,
      graphHotspotCount: 1,
    });
    await store.upsertIntelligenceEvent({
      ...((await store.getIntelligenceEventById({ workspaceId: workspace.id, eventId: event!.id }))!),
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Hormuz routing monitor from earlier in March',
      summary: 'An earlier routing stress episode showed similar support signals with fewer contradictions.',
      graphSupportScore: 0.61,
      graphContradictionScore: 0.12,
      graphHotspotCount: 0,
      timeWindowStart: '2026-03-05T02:00:00.000Z',
      timeWindowEnd: '2026-03-05T05:00:00.000Z',
      createdAt: '2026-03-05T05:00:00.000Z',
      updatedAt: '2026-03-05T05:00:00.000Z',
      executionCandidates: [],
      outcomes: [],
      reviewReason: null,
      reviewOwner: null,
      reviewUpdatedAt: null,
      reviewUpdatedBy: null,
      reviewResolvedAt: null,
    });

    const eventsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/events?workspace_id=${workspace.id}`,
      headers,
    });
    expect(eventsResponse.statusCode).toBe(200);
    const eventsBody = eventsResponse.json() as {
      data: {
        events: Array<{
          id: string;
          recurringNarrativeScore?: number;
          relatedHistoricalEventCount?: number;
          temporalNarrativeState?: string;
        }>;
      };
    };
    const currentEventSummary = eventsBody.data.events.find((row) => row.id === event!.id);
    expect(currentEventSummary?.relatedHistoricalEventCount).toBeGreaterThan(0);
    expect(currentEventSummary?.recurringNarrativeScore).toBeGreaterThan(0);
    expect(['recurring', 'diverging']).toContain(currentEventSummary?.temporalNarrativeState);

    const linkedClaimReviewResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/linked-claims/${detailBody.data.linked_claims[0]!.id}/review-state`,
      headers,
      payload: {
        workspace_id: workspace.id,
        review_state: 'review',
        review_reason: 'Linked claim requires source-level verification.',
        review_owner: headers['x-user-id'],
      },
    });
    expect(linkedClaimReviewResponse.statusCode).toBe(200);

    const hypothesesResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/hypotheses/${event!.id}?workspace_id=${workspace.id}`,
      headers,
    });
    expect(hypothesesResponse.statusCode).toBe(200);
    const hypothesesBody = hypothesesResponse.json() as {
      data: {
        ledger_entries: unknown[];
        evidence_links: Array<{ evidenceStrength?: number | null }>;
        evidence_summary: Array<{ support_count: number; contradict_count: number; contradict_edge_count: number }>;
        invalidation_entries: unknown[];
        expected_signal_entries: unknown[];
        outcome_entries: unknown[];
      };
    };
    expect(hypothesesBody.data.ledger_entries.length).toBeGreaterThanOrEqual(2);
    expect(hypothesesBody.data.evidence_links.length).toBeGreaterThanOrEqual(2);
    expect(hypothesesBody.data.evidence_links.some((row) => typeof row.evidenceStrength === 'number')).toBe(true);
    expect(hypothesesBody.data.evidence_summary.length).toBeGreaterThanOrEqual(2);
    expect(hypothesesBody.data.evidence_summary.some((row) => row.contradict_edge_count > 0)).toBe(true);
    expect(hypothesesBody.data.invalidation_entries.length).toBeGreaterThanOrEqual(2);
    expect(hypothesesBody.data.expected_signal_entries.length).toBeGreaterThanOrEqual(2);
    expect(hypothesesBody.data.outcome_entries.length).toBeGreaterThan(0);

    const graphResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/events/${event!.id}/graph?workspace_id=${workspace.id}`,
      headers,
    });
    expect(graphResponse.statusCode).toBe(200);
    const graphBody = graphResponse.json() as {
      data: {
        summary: {
          graphSupportScore: number;
          graphContradictionScore: number;
          graphHotspotCount: number;
          recurringNarrativeScore?: number;
          relatedHistoricalEventCount?: number;
          temporalNarrativeState?: string;
          hotspotClusterCount?: number;
        };
        nodes: Array<{ id: string }>;
        edges: Array<{ relation: string; evidence_signal_count: number }>;
        hotspots: string[];
        neighborhoods: Array<{ centerLinkedClaimId: string; directNeighborIds: string[] }>;
        hotspot_clusters: Array<{ contradictionEdgeCount: number; hotspotScore: number }>;
        related_historical_events: Array<{ eventId: string; relation: string; score: number }>;
      };
    };
    expect(graphBody.data.summary.graphContradictionScore).toBeGreaterThan(0);
    expect(graphBody.data.summary.graphHotspotCount).toBeGreaterThan(0);
    expect(graphBody.data.summary.relatedHistoricalEventCount).toBeGreaterThan(0);
    expect(graphBody.data.summary.recurringNarrativeScore).toBeGreaterThan(0);
    expect(graphBody.data.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graphBody.data.edges.some((row) => row.relation === 'contradicts')).toBe(true);
    expect(graphBody.data.hotspots.length).toBeGreaterThan(0);
    expect(graphBody.data.neighborhoods.length).toBeGreaterThan(0);
    expect(graphBody.data.hotspot_clusters.length).toBeGreaterThan(0);
    expect(graphBody.data.hotspot_clusters[0]?.hotspotScore).toBeGreaterThan(0);
    expect(graphBody.data.related_historical_events.length).toBeGreaterThan(0);

    const hypothesisEntryId = (hypothesesBody.data.ledger_entries[0] as { id: string }).id;
    const hypothesisReviewResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/hypotheses/entries/${hypothesisEntryId}/review-state`,
      headers,
      payload: {
        workspace_id: workspace.id,
        review_state: 'ignore',
        review_reason: 'Hypothesis is stale and should be suppressed.',
      },
    });
    expect(hypothesisReviewResponse.statusCode).toBe(200);

    const refreshedDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/events/${event!.id}?workspace_id=${workspace.id}`,
      headers,
    });
    expect(refreshedDetailResponse.statusCode).toBe(200);
    const refreshedDetailBody = refreshedDetailResponse.json() as {
      data: {
        event: {
          recurringNarrativeScore?: number;
          relatedHistoricalEventCount?: number;
          temporalNarrativeState?: string;
        };
        linked_claims: Array<{ reviewState?: string; reviewReason?: string | null; reviewOwner?: string | null }>;
        narrative_cluster: {
          id: string;
          eventCount: number;
          driftScore: number;
          reviewState: string;
          reviewReason?: string | null;
          reviewOwner?: string | null;
        } | null;
        narrative_cluster_members: Array<{ eventId: string; relation: string; score: number }>;
        operator_notes: Array<{ scope: string; scopeId: string | null; note: string }>;
        temporal_narrative_ledger: Array<{ relatedEventId: string; relation: string; score: number }>;
        related_historical_events: Array<{ eventId: string; relation: string; score: number }>;
      };
    };
    expect(refreshedDetailBody.data.event.relatedHistoricalEventCount).toBeGreaterThan(0);
    expect(refreshedDetailBody.data.event.recurringNarrativeScore).toBeGreaterThan(0);
    expect(refreshedDetailBody.data.narrative_cluster).toBeTruthy();
    expect(refreshedDetailBody.data.narrative_cluster_members.length).toBeGreaterThan(0);
    expect(refreshedDetailBody.data.narrative_cluster?.reviewState).toBe('review');
    expect(refreshedDetailBody.data.narrative_cluster?.reviewReason).toContain('manual inspection');
    expect(refreshedDetailBody.data.narrative_cluster?.reviewOwner).toBe(headers['x-user-id']);
    expect(Array.isArray(refreshedDetailBody.data.temporal_narrative_ledger)).toBe(true);
    expect(refreshedDetailBody.data.related_historical_events.length).toBeGreaterThan(0);
    expect(
      refreshedDetailBody.data.operator_notes.some(
        (row) => row.scope === 'narrative_cluster' && row.scopeId === refreshedDetailBody.data.narrative_cluster?.id,
      ),
    ).toBe(true);
    expect(refreshedDetailBody.data.linked_claims[0]?.reviewState).toBe('review');
    expect(refreshedDetailBody.data.linked_claims[0]?.reviewReason).toContain('source-level verification');
    expect(refreshedDetailBody.data.linked_claims[0]?.reviewOwner).toBe(headers['x-user-id']);

    const refreshedHypothesesResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/hypotheses/${event!.id}?workspace_id=${workspace.id}`,
      headers,
    });
    expect(refreshedHypothesesResponse.statusCode).toBe(200);
    const refreshedHypothesesBody = refreshedHypothesesResponse.json() as {
      data: {
        ledger_entries: Array<{ id: string; reviewState?: string; reviewReason?: string | null; reviewResolvedAt?: string | null }>;
      };
    };
    const refreshedEntry = refreshedHypothesesBody.data.ledger_entries.find((row) => row.id === hypothesisEntryId);
    expect(refreshedEntry?.reviewState).toBe('ignore');
    expect(refreshedEntry?.reviewReason).toContain('stale');
    expect(typeof refreshedEntry?.reviewResolvedAt).toBe('string');

    await app.close();
  });

  it('lists fetch failures and supports source and signal retries', async () => {
    const { app, store } = await buildServer();
    const headers = {
      'x-user-id': 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'x-user-role': 'admin',
    };

    const workspace = await store.getOrCreateIntelligenceWorkspace({ userId: headers['x-user-id'] });
    const source = await store.createIntelligenceSource({
      workspaceId: workspace.id,
      name: 'Failure-prone source',
      kind: 'headless',
      url: 'https://example.com/failure-source',
      sourceType: 'web_page',
      sourceTier: 'tier_2',
      pollMinutes: 10,
    });
    await store.createIntelligenceFetchFailure({
      workspaceId: workspace.id,
      sourceId: source.id,
      url: source.url,
      reason: 'robots blocked',
      statusCode: 403,
      retryable: false,
      blockedByRobots: true,
    });
    const rawDocument = await store.createIntelligenceRawDocument({
      workspaceId: workspace.id,
      sourceId: source.id,
      sourceUrl: source.url,
      canonicalUrl: `${source.url}/doc`,
      title: 'Pending signal document',
      summary: 'Pending signal summary',
      rawText: 'Pending signal raw text',
      rawHtml: '<p>Pending signal raw text</p>',
      publishedAt: '2026-03-12T01:00:00.000Z',
      observedAt: '2026-03-12T01:05:00.000Z',
      language: 'en',
      sourceType: source.sourceType,
      sourceTier: source.sourceTier,
      documentFingerprint: 'pending-signal-doc',
      metadataJson: {},
    });
    const signal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: rawDocument.id,
      sourceType: source.sourceType,
      sourceTier: source.sourceTier,
      url: rawDocument.canonicalUrl,
      publishedAt: rawDocument.publishedAt,
      observedAt: rawDocument.observedAt,
      language: rawDocument.language,
      rawText: rawDocument.rawText,
      rawMetrics: {},
      entityHints: ['Example'],
      trustHint: 'manual',
      processingStatus: 'failed',
      linkedEventId: null,
      processingError: 'semantic extraction failed',
      processedAt: '2026-03-12T01:06:00.000Z',
    });

    const failuresResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/fetch-failures?workspace_id=${workspace.id}`,
      headers,
    });
    expect(failuresResponse.statusCode).toBe(200);
    const failuresBody = failuresResponse.json() as {
      data: {
        fetch_failures: Array<{ reason: string }>;
      };
    };
    expect(failuresBody.data.fetch_failures.length).toBeGreaterThan(0);
    expect(failuresBody.data.fetch_failures[0]?.reason).toContain('robots');

    const sourceRetryResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/sources/${source.id}/retry`,
      headers,
      payload: {
        workspace_id: workspace.id,
      },
    });
    expect(sourceRetryResponse.statusCode).toBe(202);

    const signalRetryResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/signals/${signal.id}/retry`,
      headers,
      payload: {
        workspace_id: workspace.id,
      },
    });
    expect(signalRetryResponse.statusCode).toBe(202);
    const retriedSignal = await store.listIntelligenceSignals({
      workspaceId: workspace.id,
      processingStatus: 'pending',
      limit: 10,
    });
    expect(retriedSignal.some((row) => row.id === signal.id)).toBe(true);

    await app.close();
  });
});
