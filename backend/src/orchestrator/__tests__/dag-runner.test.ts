import { describe, expect, it } from 'vitest';

import { runDag } from '../dag-runner';

describe('runDag', () => {
  it('executes independent steps in parallel instead of sequentially', async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const steps = [
      { id: 's1', run: async () => { await wait(120); return 's1'; } },
      { id: 's2', run: async () => { await wait(120); return 's2'; } },
      { id: 's3', run: async () => { await wait(120); return 's3'; } }
    ];

    const startedAt = Date.now();
    const result = await runDag(steps, { maxConcurrency: 3 });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(260);
    expect(Object.keys(result.results).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('waits for dependencies before executing child nodes', async () => {
    const executionOrder: string[] = [];

    const steps = [
      {
        id: 'root',
        run: async () => {
          executionOrder.push('root');
          return { rootValue: 3 };
        }
      },
      {
        id: 'child',
        dependencies: ['root'],
        run: async ({ dependencyResults }: { dependencyResults: Record<string, unknown> }) => {
          executionOrder.push('child');
          return (dependencyResults.root as { rootValue: number }).rootValue * 2;
        }
      }
    ];

    const result = await runDag(steps, { maxConcurrency: 2 });

    expect(executionOrder).toEqual(['root', 'child']);
    expect(result.results.child).toBe(6);
  });
});
