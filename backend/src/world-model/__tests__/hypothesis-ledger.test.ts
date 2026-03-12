import { describe, expect, it } from 'vitest';

import { extractWorldModelCandidateFacts } from '../extraction';
import { buildHypothesisLedger } from '../hypothesis-ledger';
import { buildWorldModelState } from '../state-model';

describe('buildHypothesisLedger', () => {
  it('keeps both primary and counter hypotheses alive for the same extraction', () => {
    const extraction = extractWorldModelCandidateFacts({
      query: '중동 충돌이 LNG 계약과 운임에 미치는 영향',
      researchProfile: 'market_research',
      generatedAt: '2026-03-10T00:00:00Z',
      sources: [
        {
          url: 'https://www.reuters.com/world/middle-east/lng-shipping',
          title: 'Qatar signs LNG deal as freight rates jump',
          domain: 'www.reuters.com',
          publishedAt: '2026-03-10T00:00:00Z',
          snippet: 'Shipping rates rose 12% and insurers raised premiums after conflict fears.'
        }
      ],
      claims: [
        {
          claimText: 'Qatar signed an LNG contract after the Iran-Israel conflict pushed shipping rates up 12% and lifted insurance costs.',
          sourceUrls: ['https://www.reuters.com/world/middle-east/lng-shipping']
        }
      ],
    });

    const state = buildWorldModelState({ extraction });
    const ledger = buildHypothesisLedger({ extraction, state });

    expect(ledger.some((row) => row.stance === 'primary')).toBe(true);
    expect(ledger.some((row) => row.stance === 'counter')).toBe(true);
    expect(ledger.find((row) => row.stance === 'primary')?.evidence.length).toBeGreaterThan(0);
    expect(ledger.find((row) => row.stance === 'primary')?.watchStateKeys).toEqual(
      expect.arrayContaining(['route_risk'])
    );
  });

  it('turns missing expected signals into invalidation hits after the deadline while counter invalidators stay missed', () => {
    const extraction = extractWorldModelCandidateFacts({
      query: '호르무즈 리스크가 구조 재편으로 이어질까',
      researchProfile: 'topic_news',
      generatedAt: '2026-03-01T00:00:00Z',
      sources: [
        {
          url: 'https://example.com/hormuz-risk',
          title: 'Iran warns over Hormuz transit',
          domain: 'example.com',
          publishedAt: '2026-03-01T00:00:00Z',
          snippet: 'Officials warned about the Strait of Hormuz but no contracts or rate moves were confirmed.'
        }
      ],
      claims: [
        {
          claimText: 'Iran raised the risk of disruption around the Strait of Hormuz, but no LNG contract changes were confirmed.',
          sourceUrls: ['https://example.com/hormuz-risk']
        }
      ],
    });

    const state = buildWorldModelState({ extraction });
    const ledger = buildHypothesisLedger({
      extraction,
      state,
      now: '2026-03-20T00:00:00Z',
    });

    const primary = ledger.find((row) => row.stance === 'primary');
    const counter = ledger.find((row) => row.stance === 'counter');

    expect(primary?.invalidationConditions.some((condition) => condition.observedStatus === 'hit')).toBe(true);
    expect(primary?.status).not.toBe('active');
    expect(counter?.invalidationConditions.every((condition) => condition.observedStatus === 'missed')).toBe(true);
  });
});
