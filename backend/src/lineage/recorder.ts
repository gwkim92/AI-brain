import { randomUUID } from 'node:crypto';

export type LineageNode = {
  id: string;
  runId: string;
  nodeType: string;
  referenceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type LineageEdge = {
  id: string;
  runId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export class LineageRecorder {
  private readonly nodes = new Map<string, LineageNode>();
  private readonly edges = new Map<string, LineageEdge>();

  recordNode(input: {
    runId: string;
    nodeType: string;
    referenceId: string;
    metadata?: Record<string, unknown>;
  }): LineageNode {
    const node: LineageNode = {
      id: randomUUID(),
      runId: input.runId,
      nodeType: input.nodeType,
      referenceId: input.referenceId,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString()
    };
    this.nodes.set(node.id, node);
    return node;
  }

  recordEdge(input: {
    runId: string;
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: string;
    metadata?: Record<string, unknown>;
  }): LineageEdge {
    const edge: LineageEdge = {
      id: randomUUID(),
      runId: input.runId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      edgeType: input.edgeType,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString()
    };
    this.edges.set(edge.id, edge);
    return edge;
  }

  listByRun(runId: string): { nodes: LineageNode[]; edges: LineageEdge[] } {
    return {
      nodes: Array.from(this.nodes.values()).filter((node) => node.runId === runId),
      edges: Array.from(this.edges.values()).filter((edge) => edge.runId === runId)
    };
  }
}

let sharedLineageRecorder: LineageRecorder | null = null;

export function getSharedLineageRecorder(): LineageRecorder {
  if (!sharedLineageRecorder) {
    sharedLineageRecorder = new LineageRecorder();
  }
  return sharedLineageRecorder;
}
