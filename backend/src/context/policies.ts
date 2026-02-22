export type ContextMode = 'chat' | 'council' | 'code' | 'compute';

export type ContextPolicy = {
  tokenBudget: number;
  scoreWeights: {
    evidence: number;
    recency: number;
    reliability: number;
  };
};

export const CONTEXT_POLICIES: Record<ContextMode, ContextPolicy> = {
  chat: {
    tokenBudget: 4096,
    scoreWeights: {
      evidence: 0.45,
      recency: 0.35,
      reliability: 0.20
    }
  },
  council: {
    tokenBudget: 12288,
    scoreWeights: {
      evidence: 0.50,
      recency: 0.20,
      reliability: 0.30
    }
  },
  code: {
    tokenBudget: 10240,
    scoreWeights: {
      evidence: 0.40,
      recency: 0.15,
      reliability: 0.45
    }
  },
  compute: {
    tokenBudget: 11264,
    scoreWeights: {
      evidence: 0.55,
      recency: 0.10,
      reliability: 0.35
    }
  }
};
