import { spawn } from 'node:child_process';

const ALLOWED_PREFIXES = [
  ['npm', 'run', 'test'],
  ['npm', 'test'],
  ['npm', 'run', 'lint'],
  ['pnpm', 'test'],
  ['pnpm', 'lint'],
  ['vitest'],
  ['eslint']
];

function tokenize(command: string): string[] {
  return command
    .trim()
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isAllowedCommand(tokens: string[]): boolean {
  return ALLOWED_PREFIXES.some((prefix) => prefix.every((item, index) => tokens[index] === item));
}

export type LocalShellRunInput = {
  command: string;
  cwd?: string;
  enabled: boolean;
  timeoutMs?: number;
};

export type LocalShellRunResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  blockedReason?: string;
  durationMs: number;
};

export async function runLocalVerificationCommand(input: LocalShellRunInput): Promise<LocalShellRunResult> {
  const startedAt = Date.now();
  const tokens = tokenize(input.command);
  if (!input.enabled) {
    return {
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      blockedReason: 'local_execution_disabled',
      durationMs: Date.now() - startedAt
    };
  }
  if (tokens.length === 0 || !isAllowedCommand(tokens)) {
    return {
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      blockedReason: 'command_not_allowlisted',
      durationMs: Date.now() - startedAt
    };
  }

  return await new Promise<LocalShellRunResult>((resolve) => {
    const timeoutMs = Math.max(1000, input.timeoutMs ?? 180000);
    const child = spawn(tokens[0]!, tokens.slice(1), {
      cwd: input.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        ok: !timedOut && code === 0,
        exitCode: timedOut ? 124 : code ?? 1,
        stdout,
        stderr,
        blockedReason: timedOut ? 'command_timeout' : undefined,
        durationMs: Date.now() - startedAt
      });
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt
      });
    });
  });
}
