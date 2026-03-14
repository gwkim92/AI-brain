import { describe, expect, it } from 'vitest';

import { createMemoryStore } from '../memory-store';

describe('intelligence signal processing state transitions', () => {
  it('claims a pending signal only once and rejects stale processing updates', async () => {
    const store = createMemoryStore('00000000-0000-4000-8000-000000000001', 'jarvis-local@example.com');
    await store.initialize();

    const workspace = await store.createIntelligenceWorkspace({
      userId: '00000000-0000-4000-8000-000000000001',
      name: 'Test Intelligence',
    });
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
      sourceUrl: 'https://example.com/post',
      canonicalUrl: 'https://example.com/post',
      title: 'Test title',
      rawText: 'Test raw text',
      sourceType: 'blog',
      sourceTier: 'tier_1',
      documentFingerprint: 'fingerprint-1',
    });
    const signal = await store.createIntelligenceSignal({
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: document.id,
      sourceType: 'blog',
      sourceTier: 'tier_1',
      url: 'https://example.com/post',
      rawText: 'Test raw text',
    });

    const processingLeaseId = '11111111-1111-4111-8111-111111111111';
    const firstClaim = await store.updateIntelligenceSignalProcessing({
      workspaceId: workspace.id,
      signalId: signal.id,
      processingStatus: 'processing',
      expectedCurrentStatus: 'pending',
      processingLeaseId,
    });
    const secondClaim = await store.updateIntelligenceSignalProcessing({
      workspaceId: workspace.id,
      signalId: signal.id,
      processingStatus: 'processing',
      expectedCurrentStatus: 'pending',
      processingLeaseId: '22222222-2222-4222-8222-222222222222',
    });

    expect(firstClaim?.processingStatus).toBe('processing');
    expect(firstClaim?.processingLeaseId).toBe(processingLeaseId);
    expect(secondClaim).toBeNull();

    const resetToPending = await store.updateIntelligenceSignalProcessing({
      workspaceId: workspace.id,
      signalId: signal.id,
      processingStatus: 'pending',
      expectedCurrentStatus: 'processing',
      expectedCurrentLeaseId: processingLeaseId,
      processingLeaseId: null,
      linkedEventId: null,
      processingError: null,
      processedAt: null,
    });
    const staleProcessedWrite = await store.updateIntelligenceSignalProcessing({
      workspaceId: workspace.id,
      signalId: signal.id,
      processingStatus: 'processed',
      expectedCurrentStatus: 'processing',
      expectedCurrentLeaseId: processingLeaseId,
      processingLeaseId: null,
      linkedEventId: 'event-1',
      processingError: null,
      processedAt: new Date().toISOString(),
    });

    expect(resetToPending?.processingStatus).toBe('pending');
    expect(resetToPending?.processingLeaseId).toBeNull();
    expect(staleProcessedWrite).toBeNull();

    const current = await store.listIntelligenceSignals({
      workspaceId: workspace.id,
      limit: 10,
    });
    expect(current[0]?.processingStatus).toBe('pending');
    expect(current[0]?.processingLeaseId).toBeNull();
    expect(current[0]?.linkedEventId).toBeNull();
  });
});
