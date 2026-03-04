import { describe, expect, it } from 'vitest';

import { evaluateAdvisoryLiteCompliance } from '../compliance';

describe('evaluateAdvisoryLiteCompliance', () => {
  it('blocks prohibited direct trading instructions', () => {
    const result = evaluateAdvisoryLiteCompliance({
      draft: 'Strong buy now. guaranteed profit this week.',
      evidenceCount: 3
    });

    expect(result.decision).toBe('deny');
    expect(result.reasonCodes).toContain('prohibited_trading_instruction');
    expect(result.sanitizedDraft).toContain('[REDACTED]');
  });

  it('blocks when evidence is insufficient', () => {
    const result = evaluateAdvisoryLiteCompliance({
      draft: 'Macro uncertainty remains elevated.',
      evidenceCount: 1
    });

    expect(result.decision).toBe('deny');
    expect(result.reasonCodes).toContain('insufficient_evidence');
  });

  it('allows advisory-lite draft with enough evidence and neutral wording', () => {
    const result = evaluateAdvisoryLiteCompliance({
      draft: 'Scenario analysis suggests downside risk if rates rise.',
      evidenceCount: 3
    });

    expect(result.decision).toBe('allow');
    expect(result.reasonCodes).toHaveLength(0);
  });
});
