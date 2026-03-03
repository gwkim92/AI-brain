import { describe, expect, it } from 'vitest';

import { resolveGroundingPolicy, toGroundingUnavailableCode } from '../policy-router';

describe('resolveGroundingPolicy', () => {
  it('classifies static prompts as static policy', () => {
    const decision = resolveGroundingPolicy({
      prompt: 'Explain how hash maps work in simple terms.',
      intent: 'general',
      taskType: 'chat'
    });

    expect(decision.policy).toBe('static');
    expect(decision.requiresGrounding).toBe(false);
  });

  it('classifies recency/factual prompts as dynamic_factual policy', () => {
    const decision = resolveGroundingPolicy({
      prompt: '최신 주가와 오늘 주요 경제 뉴스 알려줘',
      intent: 'general',
      taskType: 'chat'
    });

    expect(decision.policy).toBe('dynamic_factual');
    expect(decision.requiresGrounding).toBe(true);
    expect(decision.signals.recency).toBe(true);
    expect(decision.signals.factual).toBe(true);
  });

  it('classifies high risk prompts as high_risk_factual policy', () => {
    const decision = resolveGroundingPolicy({
      prompt: 'legal advice for pending lawsuit with latest regulation updates',
      taskType: 'high_risk'
    });

    expect(decision.policy).toBe('high_risk_factual');
    expect(decision.requiresGrounding).toBe(true);
  });

  it('returns news-specific unavailable code for news signals', () => {
    const decision = resolveGroundingPolicy({
      prompt: '최신 뉴스 브리핑 해줘',
      intent: 'news',
      taskType: 'radar_review'
    });

    expect(toGroundingUnavailableCode(decision)).toBe('NEWS_BRIEFING_UNAVAILABLE');
  });
});
