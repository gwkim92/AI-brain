import { describe, expect, it } from 'vitest';

import { generateQueryRewriteCandidates } from '../query-rewrite';

describe('generateQueryRewriteCandidates', () => {
  it('uses entity subject for entity-brief rewrites instead of the full prompt sentence', () => {
    const variants = generateQueryRewriteCandidates({
      prompt: 'NVIDIA를 요약해줘',
      profile: 'entity_brief',
      maxVariants: 8
    });

    expect(variants).toContain('NVIDIA official site');
    expect(variants).toContain('NVIDIA investor relations newsroom');
    expect(variants).toContain('NVIDIA wikipedia overview');
    expect(variants.some((item) => item.includes('NVIDIA를 요약해줘 official site'))).toBe(false);
  });

  it('adds signal-rich English rewrites for AI infrastructure market prompts', () => {
    const variants = generateQueryRewriteCandidates({
      prompt: 'AI 인프라 시장 동향을 알려줘',
      profile: 'market_research',
      maxVariants: 8
    });

    expect(variants).toContain('AI infrastructure market demand capex');
    expect(variants).toContain('AI infrastructure data center spending demand');
    expect(variants).toContain('AI infrastructure semiconductor supply chain');
  });
});
