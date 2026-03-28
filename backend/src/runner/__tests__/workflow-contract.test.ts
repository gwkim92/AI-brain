import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadWorkflowContract, renderWorkflowTemplate } from '../workflow-contract';

const tempDirs: string[] = [];

function createTempRepo(workflowContent: string): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'runner-workflow-'));
  tempDirs.push(repoRoot);
  writeFileSync(path.join(repoRoot, 'WORKFLOW.md'), workflowContent, 'utf8');
  return repoRoot;
}

describe('loadWorkflowContract', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses valid workflow contracts and uses markdown body as prompt template fallback', () => {
    const repoRoot = createTempRepo(`---
codex:
  command: codex exec "hello"
---
Implement {{ workItem.title }}
`);

    const result = loadWorkflowContract({ repoRoot });

    expect(result.errors).toEqual([]);
    expect(result.contract).not.toBeNull();
    expect(result.contract?.agent.promptTemplate).toContain('Implement {{ workItem.title }}');
    expect(result.contract?.tracker.sources).toEqual(['internal_task']);
  });

  it('returns validation errors when required workflow fields are missing', () => {
    const repoRoot = createTempRepo(`---
tracker:
  sources:
    - internal_task
---
Prompt only
`);

    const result = loadWorkflowContract({ repoRoot });

    expect(result.contract).toBeNull();
    expect(result.errors.some((entry) => entry.path.startsWith('codex'))).toBe(true);
  });

  it('returns parse errors for invalid yaml frontmatter', () => {
    const repoRoot = createTempRepo(`---
codex:
  command: "missing quote
---
Prompt
`);

    const result = loadWorkflowContract({ repoRoot });

    expect(result.contract).toBeNull();
    expect(result.errors[0]?.path).toBe('frontmatter');
  });

  it('renders workflow templates with dotted paths', () => {
    const output = renderWorkflowTemplate('run {{ workItem.identifier }} in {{ workspace.cwd }}', {
      workItem: {
        identifier: 'task:123'
      },
      workspace: {
        cwd: '/tmp/worktree'
      }
    });

    expect(output).toBe('run task:123 in /tmp/worktree');
  });
});
