import { describe, expect, it } from 'vitest';

import {
  buildGroundingSystemInstruction,
  extractGroundingClaimsFromText,
  extractGroundingSourcesFromText,
  mergeSystemPrompt,
  normalizeGroundingUrl
} from '../grounding';
import { resolveGroundingPolicy } from '../policy-router';

describe('grounding helpers', () => {
  it('extracts markdown and plain URL sources without duplicates', () => {
    const sources = extractGroundingSourcesFromText(
      [
        'Top sources:',
        '- [Reuters](https://www.reuters.com/world)',
        '- [Bloomberg](https://www.bloomberg.com/markets)',
        'Also see https://www.reuters.com/world for details'
      ].join('\n')
    );

    expect(sources.length).toBe(2);
    expect(sources[0]?.domain).toBe('www.reuters.com');
    expect(sources[1]?.domain).toBe('www.bloomberg.com');
  });

  it('extracts claims and maps citations from source set', () => {
    const output = [
      'Tesla announced revised production guidance for 2026. [Reuters](https://www.reuters.com/world)',
      'KOSPI closed higher after rate-cut expectations. [Bloomberg](https://www.bloomberg.com/markets)',
      '',
      'Sources:',
      '- [Reuters](https://www.reuters.com/world)',
      '- [Bloomberg](https://www.bloomberg.com/markets)'
    ].join('\n');
    const sources = extractGroundingSourcesFromText(output);
    const claims = extractGroundingClaimsFromText(output, sources);

    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims[0]?.claimText).toContain('Tesla announced revised production guidance');
    expect(claims[0]?.sourceUrls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not assign blind fallback citations when claim has no lexical evidence match', () => {
    const output = [
      'A newly discovered deep ocean species changed marine biology forecasts.',
      '',
      'Sources:',
      '- [Reuters](https://www.reuters.com/world)',
      '- [Bloomberg](https://www.bloomberg.com/markets)'
    ].join('\n');
    const sources = extractGroundingSourcesFromText(output);
    const claims = extractGroundingClaimsFromText(output, sources);

    expect(claims.length).toBe(1);
    expect(claims[0]?.sourceUrls.length).toBe(0);
  });

  it('does not keep global regex state across repeated extraction', () => {
    const text = '- [Reuters](https://www.reuters.com/world)';
    const first = extractGroundingSourcesFromText(text);
    const second = extractGroundingSourcesFromText(text);

    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
  });

  it('builds grounding instruction only when policy requires grounding', () => {
    const staticDecision = resolveGroundingPolicy({
      prompt: 'Explain TCP handshake.',
      taskType: 'chat'
    });
    const dynamicDecision = resolveGroundingPolicy({
      prompt: '최신 환율과 주요 뉴스',
      taskType: 'chat'
    });

    expect(buildGroundingSystemInstruction(staticDecision)).toBe('');
    expect(buildGroundingSystemInstruction(dynamicDecision)).toContain('grounded answer');
  });

  it('merges system prompt fragments', () => {
    expect(mergeSystemPrompt(undefined, 'B')).toBe('B');
    expect(mergeSystemPrompt('A', 'B')).toBe('A\n\nB');
  });

  it('normalizes grounding urls by removing fragments and trailing slash', () => {
    expect(normalizeGroundingUrl('https://example.com/report/#top')).toBe('https://example.com/report');
    expect(normalizeGroundingUrl('https://example.com/report/')).toBe('https://example.com/report');
  });
});
