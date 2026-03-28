import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_CAPTURE_CHARS = 40_000;

function trimCapturedOutput(input: string): string {
  if (input.length <= MAX_CAPTURE_CHARS) {
    return input;
  }
  return `${input.slice(0, MAX_CAPTURE_CHARS)}\n[truncated]`;
}

function slugify(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || 'runner-workspace';
}

function execGit(repoRoot: string, args: string[], cwd = repoRoot): string {
  return execFileSync('git', args, {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  }).trim();
}

export function resolveRunnerRepoRoot(explicitRoot?: string): string {
  if (explicitRoot?.trim()) {
    return path.resolve(explicitRoot.trim());
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

export function ensureRunnerWorktree(input: {
  repoRoot: string;
  rootDir: string;
  workspaceKey: string;
  baseRef: string;
}): { workspacePath: string; created: boolean } {
  const workspaceRoot = path.resolve(input.repoRoot, input.rootDir);
  const workspacePath = path.join(workspaceRoot, slugify(input.workspaceKey));

  if (existsSync(workspacePath)) {
    return { workspacePath, created: false };
  }

  mkdirSync(workspaceRoot, { recursive: true });
  execGit(input.repoRoot, ['worktree', 'add', '--detach', workspacePath, input.baseRef], input.repoRoot);
  return { workspacePath, created: true };
}

export function removeRunnerWorktree(input: { repoRoot: string; workspacePath: string }): void {
  if (!existsSync(input.workspacePath)) {
    return;
  }
  execGit(input.repoRoot, ['worktree', 'remove', '--force', input.workspacePath], input.repoRoot);
}

export function ensureLocalBranch(input: { cwd: string; branchName: string; baseRef: string }): void {
  const currentBranch = execGit(input.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], input.cwd);
  if (currentBranch === input.branchName) {
    return;
  }
  try {
    execGit(input.cwd, ['checkout', input.branchName], input.cwd);
  } catch {
    execGit(input.cwd, ['checkout', '-B', input.branchName, input.baseRef], input.cwd);
  }
}

export function getGitStatus(input: { cwd: string }): string {
  return execGit(input.cwd, ['status', '--short'], input.cwd);
}

export function listChangedFiles(input: { cwd: string }): string[] {
  const output = getGitStatus(input);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0);
}

export function commitAndPushChanges(input: { cwd: string; branchName: string; commitMessage: string }): void {
  execGit(input.cwd, ['add', '-A'], input.cwd);
  execGit(input.cwd, ['commit', '-m', input.commitMessage], input.cwd);
  execGit(input.cwd, ['push', '-u', 'origin', input.branchName], input.cwd);
}

export type ShellCommandRunInput = {
  cwd: string;
  shell: string;
  command: string;
  onStarted?: (pid: number) => void | Promise<void>;
  onHeartbeat?: () => void | Promise<void>;
};

export type ShellCommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  pid: number;
};

export async function runShellCommand(input: ShellCommandRunInput): Promise<ShellCommandRunResult> {
  const startedAt = Date.now();
  return await new Promise<ShellCommandRunResult>((resolve, reject) => {
    const child = spawn(input.shell, ['-lc', input.command], {
      cwd: input.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = child.pid ?? -1;
    let stdout = '';
    let stderr = '';

    if (pid > 0) {
      void Promise.resolve(input.onStarted?.(pid));
    }

    const heartbeat = setInterval(() => {
      void Promise.resolve(input.onHeartbeat?.());
    }, 2000);

    child.stdout.on('data', (chunk) => {
      stdout = trimCapturedOutput(stdout + chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr = trimCapturedOutput(stderr + chunk.toString());
    });
    child.on('error', (error) => {
      clearInterval(heartbeat);
      reject(error);
    });
    child.on('close', (code) => {
      clearInterval(heartbeat);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        pid
      });
    });
  });
}

export function terminateProcessGroup(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(-pid, 'SIGTERM');
    return true;
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  }
}
