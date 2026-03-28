import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import type { WorkflowContract, WorkflowValidationError } from '../store/types';

const DEFAULT_WORKFLOW_RELATIVE_PATH = 'WORKFLOW.md';

const WorkflowSchema = z.object({
  tracker: z
    .object({
      sources: z.array(z.enum(['linear', 'internal_task'])).min(1).default(['internal_task']),
      linear: z
        .object({
          teamId: z.string().trim().min(1).nullable().default(null),
          projectId: z.string().trim().min(1).nullable().default(null),
          includeStates: z.array(z.string().trim().min(1)).default([])
        })
        .default(() => ({
          teamId: null,
          projectId: null,
          includeStates: []
        }))
    })
    .default(() => ({
      sources: ['internal_task' as const],
      linear: {
        teamId: null,
        projectId: null,
        includeStates: []
      }
    })),
  polling: z
    .object({
      intervalMs: z.coerce.number().int().min(1000).default(60000),
      batchSize: z.coerce.number().int().min(1).max(100).default(10),
      maxConcurrentRuns: z.coerce.number().int().min(1).max(20).default(2),
      stallTimeoutMs: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
      retryBaseMs: z.coerce.number().int().min(1000).default(30 * 1000),
      retryMaxMs: z.coerce.number().int().min(1000).default(15 * 60 * 1000)
    })
    .default(() => ({
      intervalMs: 60000,
      batchSize: 10,
      maxConcurrentRuns: 2,
      stallTimeoutMs: 15 * 60 * 1000,
      retryBaseMs: 30 * 1000,
      retryMaxMs: 15 * 60 * 1000
    })),
  workspace: z
    .object({
      type: z.enum(['worktree', 'devcontainer']).default('worktree'),
      baseRef: z.string().trim().min(1).default('HEAD'),
      rootDir: z.string().trim().min(1).default('.worktrees/runner'),
      cleanupOnTerminal: z.boolean().default(true)
    })
    .default(() => ({
      type: 'worktree' as const,
      baseRef: 'HEAD',
      rootDir: '.worktrees/runner',
      cleanupOnTerminal: true
    })),
  hooks: z
    .object({
      afterCreate: z.array(z.string().trim().min(1)).default([]),
      beforeRun: z.array(z.string().trim().min(1)).default([]),
      afterRun: z.array(z.string().trim().min(1)).default([]),
      beforeRemove: z.array(z.string().trim().min(1)).default([])
    })
    .default(() => ({
      afterCreate: [],
      beforeRun: [],
      afterRun: [],
      beforeRemove: []
    })),
  agent: z
    .object({
      sessionTitleTemplate: z.string().trim().min(1).default('Runner: {{ workItem.title }}'),
      promptTemplate: z.string().trim().min(1).optional(),
      autoApproveMainCommand: z.boolean().default(true)
    })
    .default(() => ({
      sessionTitleTemplate: 'Runner: {{ workItem.title }}',
      autoApproveMainCommand: true
    })),
  codex: z
    .object({
      command: z.string().trim().min(1),
      shell: z.string().trim().min(1).default('/bin/zsh'),
      verificationCommands: z.array(z.string().trim().min(1)).default([]),
      pullRequest: z
        .object({
          draft: z.boolean().default(true),
          branchPrefix: z.string().trim().min(1).default('jarvis/runner'),
          titleTemplate: z.string().trim().min(1).default('[Runner] {{ workItem.title }}'),
          bodyTemplate: z.string().trim().min(1).default([
            'Automated delivery runner handoff.',
            '',
            'Work item: {{ workItem.identifier }}',
            'Title: {{ workItem.title }}',
            '',
            'Prompt:',
            '{{ prompt }}'
          ].join('\n'))
        })
        .default(() => ({
          draft: true,
          branchPrefix: 'jarvis/runner',
          titleTemplate: '[Runner] {{ workItem.title }}',
          bodyTemplate: [
            'Automated delivery runner handoff.',
            '',
            'Work item: {{ workItem.identifier }}',
            'Title: {{ workItem.title }}',
            '',
            'Prompt:',
            '{{ prompt }}'
          ].join('\n')
        }))
    })
});

export type WorkflowLoadResult = {
  contract: WorkflowContract | null;
  errors: WorkflowValidationError[];
  sourcePath: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith('---\n')) {
    return {
      frontmatter: '',
      body: raw
    };
  }
  const markerIndex = raw.indexOf('\n---\n', 4);
  if (markerIndex < 0) {
    return {
      frontmatter: '',
      body: raw
    };
  }
  return {
    frontmatter: raw.slice(4, markerIndex),
    body: raw.slice(markerIndex + 5).trim()
  };
}

function toCamelCaseKey(input: string): string {
  return input.replace(/[_-]([a-z])/gu, (_, char: string) => char.toUpperCase());
}

function normalizeConfigKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeConfigKeys(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [toCamelCaseKey(key), normalizeConfigKeys(entry)])
  );
}

function flattenIssues(error: z.ZodError): WorkflowValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'workflow',
    message: issue.message
  }));
}

function resolveTemplateValue(context: Record<string, unknown>, keyPath: string): string {
  const value = keyPath.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, context);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return '';
}

export function renderWorkflowTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/gu, (_, keyPath: string) => resolveTemplateValue(context, keyPath));
}

export function resolveWorkflowPath(repoRoot: string, explicitPath?: string): string {
  if (explicitPath?.trim()) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(repoRoot, explicitPath);
  }
  return path.resolve(repoRoot, DEFAULT_WORKFLOW_RELATIVE_PATH);
}

export function loadWorkflowContract(input: {
  repoRoot: string;
  workflowPath?: string;
  loadedAt?: string;
}): WorkflowLoadResult {
  const sourcePath = resolveWorkflowPath(input.repoRoot, input.workflowPath);
  if (!existsSync(sourcePath)) {
    return {
      contract: null,
      sourcePath,
      errors: [
        {
          path: 'workflow',
          message: `workflow file not found at ${sourcePath}`
        }
      ]
    };
  }

  const raw = readFileSync(sourcePath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  let parsedConfig: unknown = {};

  if (frontmatter.trim()) {
    try {
      parsedConfig = normalizeConfigKeys(parseYaml(frontmatter) ?? {});
    } catch (error) {
      return {
        contract: null,
        sourcePath,
        errors: [
          {
            path: 'frontmatter',
            message: error instanceof Error ? error.message : 'failed to parse workflow YAML'
          }
        ]
      };
    }
  }

  const result = WorkflowSchema.safeParse(parsedConfig);
  if (!result.success) {
    return {
      contract: null,
      sourcePath,
      errors: flattenIssues(result.error)
    };
  }

  const promptTemplate = result.data.agent.promptTemplate?.trim() || body.trim();
  if (!promptTemplate) {
    return {
      contract: null,
      sourcePath,
      errors: [
        {
          path: 'agent.promptTemplate',
          message: 'agent.promptTemplate is required when the workflow body is empty'
        }
      ]
    };
  }

  return {
    sourcePath,
    errors: [],
    contract: {
      sourcePath,
      body,
      tracker: result.data.tracker,
      polling: result.data.polling,
      workspace: result.data.workspace,
      hooks: result.data.hooks,
      agent: {
        ...result.data.agent,
        promptTemplate
      },
      codex: result.data.codex,
      loadedAt: input.loadedAt ?? nowIso()
    }
  };
}
