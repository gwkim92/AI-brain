import { describe, expect, it } from 'vitest';

import { extractWorldModelCandidateFacts } from '../extraction';
import { getWorldModelDossierConfig } from '../config';
import { buildWorldModelBlockFromExtraction } from '../dossier';

describe('world-model dossier config', () => {
  it('uses extracted dossier config for bounded output sizes', () => {
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

    const config = getWorldModelDossierConfig();
    const block = buildWorldModelBlockFromExtraction({ extraction });

    expect(block.bottlenecks.length).toBeLessThanOrEqual(config.maxBottlenecks);
    expect(block.invalidation_conditions.length).toBeLessThanOrEqual(config.maxInvalidationConditions);
    expect(block.next_watch_signals.length).toBeLessThanOrEqual(config.maxNextWatchSignals);
  });
});
