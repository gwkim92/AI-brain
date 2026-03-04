import { randomUUID } from 'node:crypto';

export type PersonalGraphNode = {
  id: string;
  userId: string;
  type: 'task' | 'decision' | 'outcome' | 'tag';
  key: string;
  label: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PersonalGraphEdge = {
  id: string;
  userId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: string;
  createdAt: string;
};

export class PersonalKnowledgeGraph {
  private readonly nodes = new Map<string, PersonalGraphNode>();
  private readonly edges = new Map<string, PersonalGraphEdge>();

  private ensureNode(input: Omit<PersonalGraphNode, 'id' | 'createdAt'>): PersonalGraphNode {
    const existing = Array.from(this.nodes.values()).find(
      (node) => node.userId === input.userId && node.type === input.type && node.key === input.key
    );
    if (existing) return existing;

    const node: PersonalGraphNode = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    };
    this.nodes.set(node.id, node);
    return node;
  }

  private ensureEdge(input: Omit<PersonalGraphEdge, 'id' | 'createdAt'>): PersonalGraphEdge {
    const existing = Array.from(this.edges.values()).find(
      (edge) =>
        edge.userId === input.userId &&
        edge.sourceNodeId === input.sourceNodeId &&
        edge.targetNodeId === input.targetNodeId &&
        edge.relation === input.relation
    );
    if (existing) return existing;

    const edge: PersonalGraphEdge = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    };
    this.edges.set(edge.id, edge);
    return edge;
  }

  ingestTaskOutcome(input: {
    userId: string;
    taskId: string;
    goal: string;
    decision: string;
    outcome: string;
    tags?: string[];
  }): { nodes: PersonalGraphNode[]; edges: PersonalGraphEdge[] } {
    const taskNode = this.ensureNode({
      userId: input.userId,
      type: 'task',
      key: input.taskId,
      label: input.goal,
      metadata: {}
    });
    const decisionNode = this.ensureNode({
      userId: input.userId,
      type: 'decision',
      key: `${input.taskId}:decision`,
      label: input.decision,
      metadata: {}
    });
    const outcomeNode = this.ensureNode({
      userId: input.userId,
      type: 'outcome',
      key: `${input.taskId}:outcome`,
      label: input.outcome,
      metadata: {}
    });

    const edges: PersonalGraphEdge[] = [
      this.ensureEdge({
        userId: input.userId,
        sourceNodeId: taskNode.id,
        targetNodeId: decisionNode.id,
        relation: 'task_to_decision'
      }),
      this.ensureEdge({
        userId: input.userId,
        sourceNodeId: decisionNode.id,
        targetNodeId: outcomeNode.id,
        relation: 'decision_to_outcome'
      })
    ];

    for (const tag of input.tags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (!normalized) continue;
      const tagNode = this.ensureNode({
        userId: input.userId,
        type: 'tag',
        key: normalized,
        label: normalized,
        metadata: {}
      });
      edges.push(
        this.ensureEdge({
          userId: input.userId,
          sourceNodeId: outcomeNode.id,
          targetNodeId: tagNode.id,
          relation: 'outcome_to_tag'
        })
      );
    }

    return {
      nodes: [taskNode, decisionNode, outcomeNode],
      edges
    };
  }

  getGraph(input: { userId: string; limit?: number }): { nodes: PersonalGraphNode[]; edges: PersonalGraphEdge[] } {
    const limit = Math.max(1, input.limit ?? 200);
    const nodes = Array.from(this.nodes.values()).filter((node) => node.userId === input.userId).slice(-limit);
    const nodeSet = new Set(nodes.map((node) => node.id));
    const edges = Array.from(this.edges.values()).filter(
      (edge) => edge.userId === input.userId && nodeSet.has(edge.sourceNodeId) && nodeSet.has(edge.targetNodeId)
    );
    return { nodes, edges };
  }

  validateGraphConsistency(userId: string): boolean {
    const nodes = Array.from(this.nodes.values()).filter((node) => node.userId === userId);
    const nodeIds = new Set(nodes.map((node) => node.id));
    return Array.from(this.edges.values())
      .filter((edge) => edge.userId === userId)
      .every((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));
  }
}

let sharedPersonalGraph: PersonalKnowledgeGraph | null = null;

export function getSharedPersonalGraph(): PersonalKnowledgeGraph {
  if (!sharedPersonalGraph) {
    sharedPersonalGraph = new PersonalKnowledgeGraph();
  }
  return sharedPersonalGraph;
}
