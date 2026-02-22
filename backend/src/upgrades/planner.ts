export type UpgradeRecommendationInput = {
  recommendationId: string;
  title: string;
  expectedBenefit: string;
  migrationCost: string;
  riskLevel: string;
};

export type UpgradeProposalDraft = {
  recommendationId: string;
  proposalTitle: string;
  status: 'proposed';
  changePlan: {
    target: string;
    expectedBenefit: string;
  };
  riskPlan: {
    riskLevel: string;
    rollback: string;
  };
};

export function createUpgradeProposalDraft(input: UpgradeRecommendationInput): UpgradeProposalDraft {
  return {
    recommendationId: input.recommendationId,
    proposalTitle: input.title,
    status: 'proposed',
    changePlan: {
      target: input.title,
      expectedBenefit: input.expectedBenefit
    },
    riskPlan: {
      riskLevel: input.riskLevel,
      rollback: 'single-workflow rollback'
    }
  };
}
