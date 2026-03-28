import { describe, expect, it } from 'vitest';

import { GraphCallbackRegistry } from '../callbacks';
import { executeExecutionGraph, GraphExecutionHalt, validateExecutionGraph } from '../executor';
import { createExecutionGraphFromPlan } from '../graph';

describe('execution graph runtime', () => {
  it('executes a graph with callbacks and dependency results', async () => {
    const graph = createExecutionGraphFromPlan({
      title: 'Graph runtime',
      objective: 'Verify executor callbacks',
      domain: 'code',
      steps: [
        {
          id: 'node-a',
          type: 'llm_generate',
          taskType: 'execute',
          title: 'A',
          description: 'first',
          order: 1,
          dependencies: [],
          route: '/mission'
        },
        {
          id: 'node-b',
          type: 'tool_call',
          taskType: 'execute',
          title: 'B',
          description: 'second',
          order: 2,
          dependencies: ['node-a'],
          route: '/mission'
        }
      ]
    });

    const events: string[] = [];
    const callbacks = new GraphCallbackRegistry();
    callbacks.register('beforeGraph', () => {
      events.push('beforeGraph');
    });
    callbacks.register('beforeNode', ({ node }) => {
      events.push(`before:${node.key}`);
    });
    callbacks.register('afterNode', ({ node }) => {
      events.push(`after:${node.key}`);
    });
    callbacks.register('afterGraph', () => {
      events.push('afterGraph');
    });

    const result = await executeExecutionGraph(graph, {
      callbacks,
      maxConcurrency: 1,
      state: {
        count: 0
      },
      defaultExecutor: async ({ node, state, dependencyResults }) => {
        state.count = Number(state.count ?? 0) + 1;
        return {
          node: node.key,
          dependencyResults
        };
      }
    });

    expect(result.completedOrder).toEqual(['node-a', 'node-b']);
    expect(result.results['node-b']).toEqual({
      node: 'node-b',
      dependencyResults: {
        'node-a': {
          node: 'node-a',
          dependencyResults: {}
        }
      }
    });
    expect(result.state.count).toBe(2);
    expect(result.graphRun.status).toBe('completed');
    expect(events).toEqual(['beforeGraph', 'before:node-a', 'after:node-a', 'before:node-b', 'after:node-b', 'afterGraph']);
  });

  it('fails invalid or throwing graphs with failure state', async () => {
    const invalid = createExecutionGraphFromPlan({
      title: 'Invalid graph',
      objective: 'duplicate dependency check',
      domain: 'code',
      steps: [
        {
          id: 'node-a',
          type: 'llm_generate',
          taskType: 'execute',
          title: 'A',
          description: 'first',
          order: 1,
          dependencies: ['missing-node'],
          route: '/mission'
        }
      ]
    });

    expect(validateExecutionGraph(invalid).valid).toBe(false);

    const throwing = createExecutionGraphFromPlan({
      title: 'Throw graph',
      objective: 'runtime failure',
      domain: 'code',
      steps: [
        {
          id: 'node-a',
          type: 'llm_generate',
          taskType: 'execute',
          title: 'A',
          description: 'first',
          order: 1,
          dependencies: [],
          route: '/mission'
        }
      ]
    });

    await expect(
      executeExecutionGraph(throwing, {
        executors: {
          llm: async () => {
            throw new Error('boom');
          }
        }
      })
    ).rejects.toThrow('boom');
  });

  it('emits afterGraph for halted graphs and returns halt metadata', async () => {
    const graph = createExecutionGraphFromPlan({
      title: 'Halt graph',
      objective: 'blocked graph',
      domain: 'code',
      steps: [
        {
          id: 'node-a',
          type: 'human_gate',
          taskType: 'execute',
          title: 'Approval',
          description: 'pause here',
          order: 1,
          dependencies: [],
          route: '/approvals'
        }
      ]
    });

    const events: string[] = [];
    const callbacks = new GraphCallbackRegistry();
    callbacks.register('beforeGraph', () => {
      events.push('beforeGraph');
    });
    callbacks.register('onBlocked', ({ node }) => {
      events.push(`blocked:${node.key}`);
    });
    callbacks.register('afterGraph', ({ graphRun }) => {
      events.push(`afterGraph:${graphRun.status}`);
    });

    const result = await executeExecutionGraph(graph, {
      callbacks,
      defaultExecutor: async () => {
        throw new GraphExecutionHalt({
          message: 'approval_required',
          nodeStatus: 'blocked',
          graphStatus: 'blocked'
        });
      }
    });

    expect(result.halted).toEqual({
      reason: 'approval_required',
      nodeId: graph.nodes[0]?.id ?? null,
      nodeStatus: 'blocked',
      graphStatus: 'blocked'
    });
    expect(events).toEqual(['beforeGraph', 'blocked:node-a', 'afterGraph:blocked']);
  });
});
