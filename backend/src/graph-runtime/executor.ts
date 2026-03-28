import { createGraphRun, updateGraphRunNode } from './graph';
import { GraphCallbackRegistry } from './callbacks';
import { runDag, validateDagSteps, type DagStep } from '../orchestrator/dag-runner';
import type {
  ExecutionGraphNode,
  ExecutionGraphNodeKind,
  ExecutionGraphNodeStatus,
  ExecutionGraphRunStatus,
  ExecutionGraphSpec,
  GraphRunRecord
} from '../store/types';

export type GraphNodeExecutorContext = {
  graph: ExecutionGraphSpec;
  node: ExecutionGraphNode;
  graphRun: GraphRunRecord;
  state: Record<string, unknown>;
  dependencyResults: Record<string, unknown>;
};

export type GraphNodeExecutor = (context: GraphNodeExecutorContext) => Promise<unknown> | unknown;

export type GraphExecutorOptions = {
  state?: Record<string, unknown>;
  callbacks?: GraphCallbackRegistry;
  executors?: Partial<Record<ExecutionGraphNodeKind, GraphNodeExecutor>>;
  defaultExecutor?: GraphNodeExecutor;
  maxConcurrency?: number;
  failFast?: boolean;
};

export type GraphExecutorResult = {
  graphRun: GraphRunRecord;
  results: Record<string, unknown>;
  state: Record<string, unknown>;
  completedOrder: string[];
  halted?: {
    reason: string;
    nodeId: string | null;
    nodeStatus: ExecutionGraphNodeStatus;
    graphStatus: ExecutionGraphRunStatus;
  };
};

export class GraphExecutionHalt extends Error {
  readonly nodeStatus: ExecutionGraphNodeStatus;
  readonly graphStatus: ExecutionGraphRunStatus;

  constructor(input: {
    message: string;
    nodeStatus: ExecutionGraphNodeStatus;
    graphStatus: ExecutionGraphRunStatus;
  }) {
    super(input.message);
    this.name = 'GraphExecutionHalt';
    this.nodeStatus = input.nodeStatus;
    this.graphStatus = input.graphStatus;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultNodeExecutor(context: GraphNodeExecutorContext): unknown {
  return {
    nodeKey: context.node.key,
    kind: context.node.kind,
    metadata: context.node.metadata ?? null
  };
}

function pickExecutor(node: ExecutionGraphNode, options: GraphExecutorOptions): GraphNodeExecutor {
  return options.executors?.[node.kind] ?? options.defaultExecutor ?? defaultNodeExecutor;
}

export function validateExecutionGraph(graph: ExecutionGraphSpec): { valid: boolean; errors: string[] } {
  return validateDagSteps(
    graph.nodes.map<DagStep>((node) => ({
      id: node.id,
      dependencies: node.dependencies,
      run: async () => node.key
    }))
  );
}

export async function executeExecutionGraph(graph: ExecutionGraphSpec, options: GraphExecutorOptions = {}): Promise<GraphExecutorResult> {
  const validation = validateExecutionGraph(graph);
  if (!validation.valid) {
    throw new Error(`invalid_execution_graph:${validation.errors.join(',')}`);
  }

  const state = {
    ...(options.state ?? {})
  };
  const callbacks = options.callbacks ?? new GraphCallbackRegistry();
  const startedAt = nowIso();
  let graphRun = createGraphRun(graph, startedAt);

  if (graph.nodes.length === 0) {
    graphRun = {
      ...graphRun,
      status: 'completed',
      completedAt: startedAt,
      updatedAt: startedAt
    };
    await callbacks.emit('beforeGraph', { graph, graphRun, state });
    await callbacks.emit('afterGraph', { graph, graphRun, state, results: {} });
    return {
      graphRun,
      results: {},
      state,
      completedOrder: []
    };
  }

  await callbacks.emit('beforeGraph', { graph, graphRun, state });
  let nodeFailureReported = false;
  const partialResults: Record<string, unknown> = {};
  const partialCompletedOrder: string[] = [];

  try {
    const dagSteps = graph.nodes.map<DagStep>((node) => ({
      id: node.id,
      dependencies: node.dependencies,
      run: async ({ dependencyResults }) => {
        graphRun = updateGraphRunNode({
          graphSpec: graph,
          graphRun,
          nodeKey: node.id,
          status: 'running',
          timestamp: nowIso(),
          summary: node.title
        });

        await callbacks.emit('beforeNode', {
          graph,
          graphRun,
          node,
          state,
          dependencyResults
        });

        try {
          const executor = pickExecutor(node, options);
          const result = await executor({
            graph,
            node,
            graphRun,
            state,
            dependencyResults
          });
          graphRun = updateGraphRunNode({
            graphSpec: graph,
            graphRun,
            nodeKey: node.id,
            status: 'completed',
            timestamp: nowIso(),
            summary: node.title
          });
          await callbacks.emit('afterNode', {
            graph,
            graphRun,
            node,
            state,
            result
          });
          partialResults[node.id] = result;
          partialCompletedOrder.push(node.id);
          return result;
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error));
          if (normalized instanceof GraphExecutionHalt) {
            graphRun = updateGraphRunNode({
              graphSpec: graph,
              graphRun,
              nodeKey: node.id,
              status: normalized.nodeStatus,
              runStatus: normalized.graphStatus,
              timestamp: nowIso(),
              summary: node.title,
              error: normalized.message
            });
            if (normalized.graphStatus === 'blocked' || normalized.graphStatus === 'queued') {
              await callbacks.emit('onBlocked', {
                graph,
                graphRun,
                node,
                state,
                reason: normalized.message
              });
            }
            throw normalized;
          }
          graphRun = updateGraphRunNode({
            graphSpec: graph,
            graphRun,
            nodeKey: node.id,
            status: 'failed',
            timestamp: nowIso(),
            summary: node.title,
            error: normalized.message
          });
          await callbacks.emit('onFail', {
            graph,
            graphRun,
            node,
            state,
            error: normalized
          });
          nodeFailureReported = true;
          throw normalized;
        }
      }
    }));

    const dagResult = await runDag(dagSteps, {
      maxConcurrency: options.maxConcurrency,
      failFast: options.failFast
    });

    graphRun = {
      ...graphRun,
      status: graphRun.status === 'failed' ? 'failed' : 'completed',
      completedAt: graphRun.completedAt ?? nowIso(),
      updatedAt: nowIso()
    };

    await callbacks.emit('afterGraph', {
      graph,
      graphRun,
      state,
      results: dagResult.results
    });

    return {
      graphRun,
      results: dagResult.results,
      state,
      completedOrder: dagResult.completedOrder
    };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (normalized instanceof GraphExecutionHalt) {
      const haltedGraphRun = {
        ...graphRun,
        completedAt: graphRun.completedAt ?? nowIso(),
        updatedAt: nowIso()
      };
      await callbacks.emit('afterGraph', {
        graph,
        graphRun: haltedGraphRun,
        state,
        results: partialResults
      });
      return {
        graphRun: haltedGraphRun,
        results: partialResults,
        state,
        completedOrder: partialCompletedOrder,
        halted: {
          reason: normalized.message,
          nodeId: graphRun.currentNodeId,
          nodeStatus: normalized.nodeStatus,
          graphStatus: normalized.graphStatus
        }
      };
    }
    if (!nodeFailureReported) {
      await callbacks.emit('onFail', {
        graph,
        graphRun: {
          ...graphRun,
          status: 'failed',
          completedAt: graphRun.completedAt ?? nowIso(),
          updatedAt: nowIso()
        },
        node: null,
        state,
        error: normalized
      });
    }
    throw normalized;
  }
}
