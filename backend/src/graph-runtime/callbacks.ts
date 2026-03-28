import type { ArtifactRecord, ExecutionGraphNode, ExecutionGraphSpec, GraphRunRecord, ToolInvocation } from '../store/types';

export type GraphCallbackHook =
  | 'beforeGraph'
  | 'afterGraph'
  | 'beforeNode'
  | 'afterNode'
  | 'beforeTool'
  | 'afterTool'
  | 'onRetry'
  | 'onArtifact'
  | 'onBlocked'
  | 'onFail';

export type GraphCallbackPayloadByHook = {
  beforeGraph: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    state: Record<string, unknown>;
  };
  afterGraph: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    state: Record<string, unknown>;
    results: Record<string, unknown>;
  };
  beforeNode: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    node: ExecutionGraphNode;
    state: Record<string, unknown>;
    dependencyResults: Record<string, unknown>;
  };
  afterNode: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    node: ExecutionGraphNode;
    state: Record<string, unknown>;
    result: unknown;
  };
  beforeTool: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    node: ExecutionGraphNode;
    state: Record<string, unknown>;
    invocation: ToolInvocation;
  };
  afterTool: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    node: ExecutionGraphNode;
    state: Record<string, unknown>;
    invocation: ToolInvocation;
    result: unknown;
  };
  onRetry: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    node: ExecutionGraphNode;
    state: Record<string, unknown>;
    reason: string;
  };
  onArtifact: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    node: ExecutionGraphNode;
    state: Record<string, unknown>;
    artifact: ArtifactRecord;
  };
  onFail: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    node: ExecutionGraphNode | null;
    state: Record<string, unknown>;
    error: Error;
  };
  onBlocked: {
    graph: ExecutionGraphSpec;
    graphRun: GraphRunRecord;
    node: ExecutionGraphNode;
    state: Record<string, unknown>;
    reason: string;
  };
};

export type GraphCallback<H extends GraphCallbackHook> = (payload: GraphCallbackPayloadByHook[H]) => Promise<void> | void;

export class GraphCallbackRegistry {
  private readonly handlers: Record<GraphCallbackHook, Array<GraphCallback<GraphCallbackHook>>> = {
    beforeGraph: [],
    afterGraph: [],
    beforeNode: [],
    afterNode: [],
    beforeTool: [],
    afterTool: [],
    onRetry: [],
    onArtifact: [],
    onBlocked: [],
    onFail: []
  };

  register<H extends GraphCallbackHook>(hook: H, callback: GraphCallback<H>): void {
    this.handlers[hook].push(callback as GraphCallback<GraphCallbackHook>);
  }

  async emit<H extends GraphCallbackHook>(hook: H, payload: GraphCallbackPayloadByHook[H]): Promise<void> {
    for (const callback of this.handlers[hook]) {
      await callback(payload);
    }
  }
}
