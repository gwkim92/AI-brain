import { describe, expect, it } from 'vitest';

import { parsePlanFromLLMOutput } from '../planner';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

describe('parsePlanFromLLMOutput', () => {
  it('normalizes non-uuid step ids and remaps dependencies', () => {
    const output = JSON.stringify({
      title: 'News plan',
      objective: 'Summarize world headlines',
      domain: 'mixed',
      steps: [
        {
          id: 'step-1',
          type: 'llm_generate',
          task_type: 'execute',
          title: 'Collect headlines',
          description: 'Gather major world headlines',
          order: 1,
          dependencies: []
        },
        {
          id: 'step-2',
          type: 'llm_generate',
          task_type: 'execute',
          title: 'Summarize',
          description: 'Summarize collected headlines',
          order: 2,
          dependencies: ['step-1']
        }
      ]
    });

    const plan = parsePlanFromLLMOutput(output);
    expect(plan.steps).toHaveLength(2);

    const step1 = plan.steps[0];
    const step2 = plan.steps[1];
    expect(step1?.id).toMatch(UUID_PATTERN);
    expect(step2?.id).toMatch(UUID_PATTERN);
    expect(step1?.id).not.toBe('step-1');
    expect(step2?.id).not.toBe('step-2');
    expect(step2?.dependencies).toEqual([step1?.id]);
    expect(plan.graph.nodes).toHaveLength(2);
    expect(plan.graph.entryNodeIds).toEqual([step1?.id]);
  });

  it('replaces llm-provided uuid step ids to avoid cross-plan collisions', () => {
    const output = JSON.stringify({
      title: 'News plan',
      objective: 'Summarize world headlines',
      domain: 'mixed',
      steps: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'tool_call',
          task_type: 'execute',
          title: 'Collect headlines',
          description: 'Gather major world headlines',
          order: 1,
          dependencies: []
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          type: 'llm_generate',
          task_type: 'chat',
          title: 'Summarize',
          description: 'Summarize collected headlines',
          order: 2,
          dependencies: ['00000000-0000-4000-8000-000000000001']
        }
      ]
    });

    const plan = parsePlanFromLLMOutput(output);
    expect(plan.steps).toHaveLength(2);

    const step1 = plan.steps[0];
    const step2 = plan.steps[1];
    expect(step1?.id).toMatch(UUID_PATTERN);
    expect(step2?.id).toMatch(UUID_PATTERN);
    expect(step1?.id).not.toBe('00000000-0000-4000-8000-000000000001');
    expect(step2?.id).not.toBe('00000000-0000-4000-8000-000000000002');
    expect(step2?.dependencies).toEqual([step1?.id]);
    expect(plan.graph.nodes[0]?.kind).toBe('tool');
    expect(plan.graph.nodes[1]?.dependencies).toEqual([step1?.id]);
  });
});
