import { describe, expect, it } from 'vitest';

import { buildLanguageSystemInstruction, detectPromptLanguage, evaluateLanguageAlignment } from '../language-policy';

describe('language-policy', () => {
  it('detects korean prompt language and builds instruction', () => {
    expect(detectPromptLanguage('최신 뉴스 중에 주요 뉴스 브리핑 해봐')).toBe('ko');
    const policy = buildLanguageSystemInstruction('최신 뉴스 중에 주요 뉴스 브리핑 해봐');
    expect(policy.expectedLanguage).toBe('ko');
    expect(policy.instruction).toContain('Respond strictly in Korean');
  });

  it('keeps korean for mixed prompts that include english entity names', () => {
    expect(detectPromptLanguage('openai codex repo 조사해줘')).toBe('ko');
    const policy = buildLanguageSystemInstruction('openai codex repo 조사해줘');
    expect(policy.expectedLanguage).toBe('ko');
  });

  it('flags alignment failure when korean prompt returns english-heavy output', () => {
    const result = evaluateLanguageAlignment(
      'ko',
      'Top world briefing: markets rallied and governments announced new sanctions.'
    );
    expect(result.passed).toBe(false);
  });
});
