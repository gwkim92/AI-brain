import { describe, expect, it } from 'vitest';

import { PersonalKnowledgeGraph } from '../personal-graph';

describe('PersonalKnowledgeGraph', () => {
  it('ingests task outcomes and keeps graph consistent', () => {
    const graph = new PersonalKnowledgeGraph();
    const userId = '00000000-0000-4000-8000-000000000001';

    graph.ingestTaskOutcome({
      userId,
      taskId: 'task-001',
      goal: 'Reduce retrieval latency',
      decision: 'Deploy retrieval cache',
      outcome: 'Latency improved by 20%',
      tags: ['retrieval', 'performance']
    });

    const snapshot = graph.getGraph({ userId, limit: 100 });
    expect(snapshot.nodes.length).toBeGreaterThanOrEqual(5);
    expect(snapshot.edges.length).toBeGreaterThanOrEqual(4);
    expect(graph.validateGraphConsistency(userId)).toBe(true);
  });
});
