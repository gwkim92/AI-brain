import { CONTEXT_POLICIES, type ContextMode } from './policies';

export type { ContextMode };

export type CandidateSegment = {
  id: string;
  tokenCount: number;
  evidenceScore: number;
  recencyScore: number;
  reliabilityScore: number;
  content: string;
};

export type RankedSegment = CandidateSegment & {
  priorityScore: number;
};

export type CompileContextInput = {
  mode: ContextMode;
  candidates: CandidateSegment[];
  overrideTokenBudget?: number;
};

export type CompileContextResult = {
  mode: ContextMode;
  tokenBudget: number;
  usedTokens: number;
  selectedSegments: RankedSegment[];
  droppedSegments: RankedSegment[];
};

export function getTokenBudgetForMode(mode: ContextMode): number {
  return CONTEXT_POLICIES[mode].tokenBudget;
}

export function compileContext(input: CompileContextInput): CompileContextResult {
  const policy = CONTEXT_POLICIES[input.mode];
  const tokenBudget = input.overrideTokenBudget ?? policy.tokenBudget;

  const ranked = input.candidates
    .map((candidate) => {
      const evidence = normalizeScore(candidate.evidenceScore);
      const recency = normalizeScore(candidate.recencyScore);
      const reliability = normalizeScore(candidate.reliabilityScore);
      const priorityScore =
        evidence * policy.scoreWeights.evidence +
        recency * policy.scoreWeights.recency +
        reliability * policy.scoreWeights.reliability;

      return {
        ...candidate,
        priorityScore: roundScore(priorityScore)
      };
    })
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      // Prefer smaller segments at equal priority to maximize budget packing.
      return left.tokenCount - right.tokenCount;
    });

  const selectedSegments: RankedSegment[] = [];
  const droppedSegments: RankedSegment[] = [];

  let usedTokens = 0;

  for (const segment of ranked) {
    if (segment.tokenCount <= 0) {
      droppedSegments.push(segment);
      continue;
    }

    if (usedTokens + segment.tokenCount <= tokenBudget) {
      selectedSegments.push(segment);
      usedTokens += segment.tokenCount;
    } else {
      droppedSegments.push(segment);
    }
  }

  return {
    mode: input.mode,
    tokenBudget,
    usedTokens,
    selectedSegments,
    droppedSegments
  };
}

export function estimateCompiledContextTokens(result: CompileContextResult): number {
  return result.usedTokens;
}

export function shouldCompactCompiledContext(result: CompileContextResult, compactThresholdTokens: number): boolean {
  if (compactThresholdTokens <= 0) {
    return false;
  }
  return estimateCompiledContextTokens(result) >= compactThresholdTokens;
}

function normalizeScore(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
