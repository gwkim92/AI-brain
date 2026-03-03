import { describe, expect, it } from 'vitest';

import { resolveGroundingPolicy } from '../policy-router';
import { buildGroundingQualityBlockedMessage, classifyGroundingGateResult, evaluateGroundingQualityGate } from '../quality-gate';

describe('evaluateGroundingQualityGate', () => {
  it('passes static prompt with no sources', () => {
    const decision = resolveGroundingPolicy({
      prompt: 'Explain pointers in C language',
      taskType: 'chat'
    });
    const result = evaluateGroundingQualityGate({
      decision,
      sources: [],
      hasTemplateArtifact: false
    });

    expect(result.passed).toBe(true);
  });

  it('fails dynamic factual prompt when sources are missing', () => {
    const decision = resolveGroundingPolicy({
      prompt: '오늘 환율 알려줘',
      taskType: 'chat'
    });
    const result = evaluateGroundingQualityGate({
      decision,
      sources: [],
      hasTemplateArtifact: false
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('insufficient_sources');
  });

  it('fails on template artifacts regardless of policy', () => {
    const decision = resolveGroundingPolicy({
      prompt: 'Explain JWT',
      taskType: 'chat'
    });
    const result = evaluateGroundingQualityGate({
      decision,
      sources: [],
      hasTemplateArtifact: true
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('template_artifact');
    expect(buildGroundingQualityBlockedMessage(result)).toContain('template_artifact');
  });

  it('fails when output language mismatches prompt language', () => {
    const decision = resolveGroundingPolicy({
      prompt: '오늘 주요 뉴스를 요약해줘',
      taskType: 'chat'
    });
    const result = evaluateGroundingQualityGate({
      decision,
      sources: [
        {
          url: 'https://www.bbc.com/news/world-00000001',
          title: 'Sample',
          domain: 'www.bbc.com'
        }
      ],
      hasTemplateArtifact: false,
      expectedLanguage: 'ko',
      outputText: 'Top world news briefing: markets recovered and diplomatic tensions increased.'
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('language_mismatch');
  });

  it('fails when grounded claim citation coverage is too low', () => {
    const decision = resolveGroundingPolicy({
      prompt: '오늘 주요 뉴스를 브리핑해줘',
      taskType: 'chat'
    });
    const result = evaluateGroundingQualityGate({
      decision,
      sources: [
        {
          url: 'https://www.bbc.com/news/world-00000001',
          title: 'Markets rally after policy shift',
          domain: 'www.bbc.com'
        }
      ],
      claims: [
        {
          claimText: '국제 유가가 급락했다.',
          sourceUrls: []
        },
        {
          claimText: '영국 시장이 반등했다.',
          sourceUrls: ['https://www.bbc.com/news/world-00000001']
        }
      ],
      hasTemplateArtifact: false,
      outputText: '국제 유가가 급락했다.\n영국 시장이 반등했다.\n\nSources:\n- [BBC](https://www.bbc.com/news/world-00000001)'
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('insufficient_claim_citation_coverage');
  });

  it('classifies soft reasons as soft_warn', () => {
    const result = classifyGroundingGateResult([
      'language_mismatch',
      'insufficient_claim_citation_coverage'
    ]);
    expect(result).toBe('soft_warn');
  });

  it('classifies strong failures as hard_fail', () => {
    const result = classifyGroundingGateResult([
      'insufficient_sources',
      'language_mismatch'
    ]);
    expect(result).toBe('hard_fail');
  });

  it('classifies empty reasons as pass', () => {
    const result = classifyGroundingGateResult([]);
    expect(result).toBe('pass');
  });
});
