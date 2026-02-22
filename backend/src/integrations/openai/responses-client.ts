export type CompactContextInput = {
  responseId: string;
  promptTokens: number;
  completionTokens: number;
  compactThresholdTokens: number;
};

export type CompactGateway = {
  compactResponse: (input: { responseId: string }) => Promise<{ id: string }>;
};

export type CompactContextResult = {
  compacted: boolean;
  compactedResponseId?: string;
  totalTokens: number;
};

export function estimateTotalResponseTokens(input: Pick<CompactContextInput, 'promptTokens' | 'completionTokens'>): number {
  return Math.max(0, input.promptTokens) + Math.max(0, input.completionTokens);
}

export function shouldCompactResponseContext(totalTokens: number, compactThresholdTokens: number): boolean {
  if (compactThresholdTokens <= 0) {
    return false;
  }
  return totalTokens >= compactThresholdTokens;
}

export async function maybeCompactResponseContext(
  input: CompactContextInput,
  gateway: CompactGateway
): Promise<CompactContextResult> {
  const totalTokens = estimateTotalResponseTokens(input);

  if (!shouldCompactResponseContext(totalTokens, input.compactThresholdTokens)) {
    return {
      compacted: false,
      totalTokens
    };
  }

  const compacted = await gateway.compactResponse({
    responseId: input.responseId
  });

  return {
    compacted: true,
    compactedResponseId: compacted.id,
    totalTokens
  };
}
