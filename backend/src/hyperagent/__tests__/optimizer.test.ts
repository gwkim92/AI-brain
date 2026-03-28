import { describe, expect, it } from 'vitest';

import { generateBoundedVariant } from '../optimizer';

describe('hyperagent optimizer', () => {
  it('mutates only allowlisted fields', async () => {
    const variant = await generateBoundedVariant({
      artifactKey: 'radar_domain_pack',
      basePayload: {
        domainPacks: [
          {
            id: 'policy_regulation_platform_ai',
            displayName: 'Policy / Regulation / Platform AI',
            ontology: ['regulator', 'platform'],
            mechanismTemplates: ['policy_change -> compliance_cost'],
            stateVariables: ['contract_urgency'],
            invalidationTemplates: ['formal rule text does not materialize'],
            watchMetrics: ['policy_calendar'],
            keywordLexicon: ['policy', 'privacy'],
            actionMapping: {
              watcherKind: 'external_topic',
              sessionIntent: 'research',
              defaultActionKind: 'notify',
              executionMode: 'proposal_auto',
            },
          },
        ],
      },
      mutationBudget: 2,
      lineageRunId: 'run-1',
    });

    expect(variant.strategy).toBe('bounded_json_mutation');
    expect((variant.payload.domainPacks as Array<{ keywordLexicon: string[] }>)[0]?.keywordLexicon).toEqual(
      expect.arrayContaining(['policy', 'privacy'])
    );
    expect(variant.changedKeys).toEqual(
      expect.arrayContaining(['domainPacks[0].mechanismTemplates', 'domainPacks[0].stateVariables'])
    );
    expect((variant.payload as Record<string, unknown>).sourceCode).toBeUndefined();
    expect(variant.metadata.lineageRunId).toBe('run-1');
  });
});
