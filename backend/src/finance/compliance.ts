export type FinanceComplianceInput = {
  draft: string;
  evidenceCount: number;
};

export type FinanceComplianceResult = {
  decision: 'allow' | 'deny';
  reasonCodes: string[];
  sanitizedDraft: string;
};

const PROHIBITED_ADVISORY_PATTERN =
  /(buy now|strong buy|guaranteed profit|no risk|확정 수익|무조건 수익|지금 매수|당장 매도|전량 매수|전량 매도)/iu;

export function evaluateAdvisoryLiteCompliance(input: FinanceComplianceInput): FinanceComplianceResult {
  const reasonCodes: string[] = [];
  const trimmedDraft = input.draft.trim();

  if (input.evidenceCount < 2) {
    reasonCodes.push('insufficient_evidence');
  }
  if (PROHIBITED_ADVISORY_PATTERN.test(trimmedDraft)) {
    reasonCodes.push('prohibited_trading_instruction');
  }

  let sanitizedDraft = trimmedDraft;
  if (reasonCodes.includes('prohibited_trading_instruction')) {
    sanitizedDraft = trimmedDraft.replace(PROHIBITED_ADVISORY_PATTERN, '[REDACTED]');
  }

  return {
    decision: reasonCodes.length > 0 ? 'deny' : 'allow',
    reasonCodes,
    sanitizedDraft
  };
}
