import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as spawnPty, type IPty } from 'node-pty';

type WorkspaceStatus = 'ready' | 'running' | 'stopped' | 'error';
export type WorkspaceKind = 'current' | 'worktree' | 'devcontainer';
export type WorkspaceCommandRiskLevel = 'read_only' | 'write' | 'build' | 'network' | 'process_control' | 'unknown';
export type WorkspaceCommandImpactProfile =
  | 'read_only'
  | 'file_mutation'
  | 'artifact_build'
  | 'dependency_install'
  | 'process_launch'
  | 'external_access'
  | 'external_sync'
  | 'process_control'
  | 'unclassified';
export type WorkspaceCommandSeverity = 'low' | 'medium' | 'high' | 'critical';

export type WorkspaceCommandPolicy = {
  normalizedCommand: string;
  riskLevel: WorkspaceCommandRiskLevel;
  impactProfile: WorkspaceCommandImpactProfile;
  severity: WorkspaceCommandSeverity;
  disposition: 'auto_run' | 'approval_required' | 'role_required';
  reason: string;
  impact: WorkspaceCommandImpact;
};

export type WorkspaceCommandImpactLevel = 'none' | 'possible' | 'expected';

export type WorkspaceCommandImpactDimension = {
  level: WorkspaceCommandImpactLevel;
  summary: string;
  targets: string[];
};

export type WorkspaceCommandImpact = {
  files: WorkspaceCommandImpactDimension;
  network: WorkspaceCommandImpactDimension;
  processes: WorkspaceCommandImpactDimension;
  notes: string[];
};

export type WorkspaceRecord = {
  id: string;
  userId: string;
  name: string;
  cwd: string;
  kind: WorkspaceKind;
  baseRef: string | null;
  sourceWorkspaceId: string | null;
  containerName: string | null;
  containerImage: string | null;
  containerSource: 'image' | 'dockerfile' | null;
  containerImageManaged: boolean;
  containerBuildContext: string | null;
  containerDockerfile: string | null;
  containerFeatures: string[];
  containerAppliedFeatures: string[];
  containerWorkdir: string | null;
  containerConfigPath: string | null;
  containerRunArgs: string[];
  containerWarnings: string[];
  status: WorkspaceStatus;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
  sessionId: string | null;
  activeCommand: string | null;
  exitCode: number | null;
  lastError: string | null;
};

export type WorkspaceChunkRecord = {
  sequence: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  createdAt: string;
};

type WorkspaceRuntimeState = {
  workspace: WorkspaceRecord;
  nextSequence: number;
  chunks: WorkspaceChunkRecord[];
  child: IPty | null;
  linkedJarvisSessionId: string | null;
  linkedActionProposalId: string | null;
  terminating: boolean;
};

export type WorkspaceRuntimeEvent =
  | {
      type: 'closed';
      workspace: WorkspaceRecord;
      linkedJarvisSessionId: string | null;
      linkedActionProposalId: string | null;
      exitCode: number | null;
      reason: 'completed' | 'terminated' | 'failed';
    }
  | {
      type: 'error';
      workspace: WorkspaceRecord;
      linkedJarvisSessionId: string | null;
      linkedActionProposalId: string | null;
      error: string;
    };

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(moduleDir, '../../..');
const WORKTREE_ROOT = path.join(REPO_ROOT, '.worktrees');
const DEFAULT_DEVCONTAINER_IMAGE = process.env.WORKSPACE_DEVCONTAINER_IMAGE?.trim() || 'node:24-alpine';
const DEFAULT_DEVCONTAINER_WORKDIR = process.env.WORKSPACE_DEVCONTAINER_WORKDIR?.trim() || '/workspace';
const DEVCONTAINER_CONFIG_CANDIDATES = ['.devcontainer/devcontainer.json', '.devcontainer.json'] as const;
const DEVCONTAINER_ALLOWED_SINGLE_ARGS = new Set(['--init']);
const DEVCONTAINER_ALLOWED_VALUE_ARGS = new Set(['--cpus', '--memory', '--memory-swap', '--pids-limit', '--user']);
const MAX_CHUNKS = 500;
const READ_ONLY_COMMAND_PATTERNS = [
  /^pwd$/u,
  /^date$/u,
  /^env$/u,
  /^ps(?:\s|$)/u,
  /^ls(?:\s|$)/u,
  /^cat(?:\s|$)/u,
  /^head(?:\s|$)/u,
  /^tail(?:\s|$)/u,
  /^wc(?:\s|$)/u,
  /^find(?:\s|$)/u,
  /^rg(?:\s|$)/u,
  /^git\s+(status|diff)(?:\s|$)/u,
  /^sed\s+-n(?:\s|$)/u
];
const WRITE_COMMAND_PATTERNS = [
  /^touch(?:\s|$)/u,
  /^mkdir(?:\s|$)/u,
  /^rm(?:\s|$)/u,
  /^mv(?:\s|$)/u,
  /^cp(?:\s|$)/u,
  /^ln(?:\s|$)/u,
  /^chmod(?:\s|$)/u,
  /^chown(?:\s|$)/u,
  /^tee(?:\s|$)/u,
  /^dd(?:\s|$)/u,
  /^git\s+(add|apply|checkout|clean|commit|merge|rebase|reset|restore|stash|worktree)(?:\s|$)/u
];
const BUILD_COMMAND_PATTERNS = [
  /^pnpm\s+(add|build|dev|dlx|exec|install|remove|run|start|test|up|update)(?:\s|$)/u,
  /^npm\s+(install|run|start|test|exec)(?:\s|$)/u,
  /^yarn(?:\s|$)/u,
  /^bun(?:\s|$)/u,
  /^make(?:\s|$)/u,
  /^cmake(?:\s|$)/u,
  /^cargo\s+(build|run|test)(?:\s|$)/u,
  /^go\s+(build|run|test)(?:\s|$)/u,
  /^uv(?:\s|$)/u,
  /^python(?:3)?(?:\s|$)/u,
  /^node(?:\s|$)/u
];
const NETWORK_COMMAND_PATTERNS = [
  /^curl(?:\s|$)/u,
  /^wget(?:\s|$)/u,
  /^ssh(?:\s|$)/u,
  /^scp(?:\s|$)/u,
  /^ping(?:\s|$)/u,
  /^nc(?:\s|$)/u,
  /^nmap(?:\s|$)/u,
  /^git\s+(clone|fetch|pull|push)(?:\s|$)/u
];
const PROCESS_CONTROL_PATTERNS = [
  /^kill(?:\s|$)/u,
  /^pkill(?:\s|$)/u,
  /^killall(?:\s|$)/u,
  /^launchctl(?:\s|$)/u,
  /^open(?:\s|$)/u
];

function nowIso(): string {
  return new Date().toISOString();
}

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateWorkspaceCwd(rawCwd?: string): string {
  const candidate = rawCwd?.trim() ? path.resolve(REPO_ROOT, rawCwd.trim()) : REPO_ROOT;
  if (!existsSync(candidate)) {
    throw new Error('workspace cwd does not exist');
  }
  if (!isPathWithinRoot(candidate, REPO_ROOT)) {
    throw new Error('workspace cwd must stay within repository root');
  }
  return candidate;
}

function normalizeReadOnlyCommand(command: string): string {
  return command.replace(/\s+/gu, ' ').trim();
}

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|\S+/gu) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/gu, ''));
}

function slugifyWorkspaceSegment(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || 'jarvis-worktree';
}

function buildPtyEnv(): Record<string, string> {
  const envEntries = Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(envEntries);
}

function makeImpactDimension(
  level: WorkspaceCommandImpactLevel,
  summary: string,
  targets: string[] = []
): WorkspaceCommandImpactDimension {
  return {
    level,
    summary,
    targets: [...new Set(targets.filter((target) => target.trim().length > 0))].slice(0, 6)
  };
}

function getNonFlagArgs(tokens: string[], startIndex = 1): string[] {
  return tokens.slice(startIndex).filter((token) => token.trim().length > 0 && !token.startsWith('-'));
}

function getOptionValue(tokens: string[], optionNames: string[], startIndex = 1): string | null {
  const names = new Set(optionNames);
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (!token) continue;
    if (names.has(token)) {
      const next = tokens[index + 1]?.trim();
      if (next && !next.startsWith('-')) {
        return next;
      }
      continue;
    }
    for (const name of names) {
      if (token.startsWith(`${name}=`)) {
        const [, value] = token.split('=', 2);
        if (value?.trim()) return value.trim();
      }
    }
  }
  return null;
}

function getLikelyNetworkTargets(tokens: string[]): string[] {
  const candidates = tokens.filter((token) =>
    /^(?:https?:\/\/\S+|ssh:\/\/\S+|git@\S+|[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/\S*)?)$/iu.test(token)
  );
  const first = tokens[0]?.toLowerCase() ?? '';
  const second = tokens[1]?.toLowerCase() ?? '';
  if (first === 'git' && /^(clone|fetch|pull|push)$/u.test(second)) {
    const remoteCandidate = getNonFlagArgs(tokens, 2)[0];
    if (remoteCandidate && !candidates.includes(remoteCandidate)) {
      candidates.push(remoteCandidate);
    }
  }
  return [...new Set(candidates)].slice(0, 6);
}

function getLikelyWriteTargets(tokens: string[]): string[] {
  const first = tokens[0]?.toLowerCase() ?? '';
  const second = tokens[1]?.toLowerCase() ?? '';

  if (first === 'git') {
    if (/^(add|rm|mv|restore|checkout|clean)$/u.test(second)) {
      return getNonFlagArgs(tokens, 2).slice(0, 4);
    }
    if (/^(commit|merge|rebase|reset|stash|apply)$/u.test(second)) {
      return ['git working tree', 'git index'];
    }
    return ['git working tree'];
  }

  if (first === 'mv' || first === 'cp') {
    return getNonFlagArgs(tokens, 1).slice(0, 2);
  }

  if (first === 'tee') {
    return getNonFlagArgs(tokens, 1).slice(0, 4);
  }

  if (first === 'chmod' || first === 'chown') {
    return getNonFlagArgs(tokens, 2).slice(0, 4);
  }

  return getNonFlagArgs(tokens, 1).slice(0, 4);
}

function getLikelyProcessTargets(tokens: string[], fallback: string): string[] {
  const first = tokens[0]?.toLowerCase() ?? '';
  const second = tokens[1]?.toLowerCase() ?? '';
  const candidates: string[] = [];

  if (first) {
    if (second && !second.startsWith('-')) {
      candidates.push(`${first} ${second}`);
    } else if (['node', 'python', 'python3', 'uv'].includes(first) && second) {
      candidates.push(`${first} ${second}`);
    } else {
      candidates.push(first);
    }
  }

  if (['node', 'python', 'python3', 'uv'].includes(first)) {
    const scriptArg = getNonFlagArgs(tokens, 1)[0];
    if (scriptArg) candidates.push(scriptArg);
  }

  if (first === 'pnpm' || first === 'npm' || first === 'yarn' || first === 'bun') {
    const runTarget = getNonFlagArgs(tokens, 2)[0];
    if (runTarget) candidates.push(runTarget);
  }

  if (first === 'kill' || first === 'pkill' || first === 'killall') {
    candidates.push(...getNonFlagArgs(tokens, 1).slice(0, 3));
  }

  const deduped = [...new Set(candidates.filter((candidate) => candidate.trim().length > 0))];
  return deduped.length > 0 ? deduped.slice(0, 4) : [fallback];
}

function buildWorkspaceCommandImpact(
  normalizedCommand: string,
  workspaceKind: WorkspaceKind,
  riskLevel: WorkspaceCommandRiskLevel
): WorkspaceCommandImpact {
  const tokens = tokenizeCommand(normalizedCommand);
  const first = tokens[0]?.toLowerCase() ?? '';
  const second = tokens[1]?.toLowerCase() ?? '';
  const nonFlagArgs = getNonFlagArgs(tokens, 1);
  const subcommandArgs = getNonFlagArgs(tokens, 2);
  const networkTargets = getLikelyNetworkTargets(tokens);
  const notes: string[] = [];

  if (workspaceKind === 'current') {
    notes.push('Targets the primary repository checkout on the host.');
  } else if (workspaceKind === 'worktree') {
    notes.push('Targets an isolated git worktree, not the primary checkout.');
  } else {
    notes.push('Runs inside an isolated container runtime mounted to the selected workspace.');
  }

  if (riskLevel === 'read_only') {
    return {
      files: makeImpactDimension('none', 'No file mutations expected from this allowlisted inspection command.'),
      network: makeImpactDimension('none', 'No external network access expected.'),
      processes: makeImpactDimension('none', 'No long-lived process or process-control action expected.'),
      notes
    };
  }

  if (riskLevel === 'write') {
    const targets = getLikelyWriteTargets(tokens);
    return {
      files: makeImpactDimension(
        'expected',
        first === 'git' ? 'Git state or tracked files are expected to change.' : 'Workspace files are expected to change.',
        targets
      ),
      network: makeImpactDimension('none', 'No external network access expected unless the command invokes it indirectly.'),
      processes: makeImpactDimension(
        'possible',
        'Short-lived local processes may run while applying the change.',
        getLikelyProcessTargets(tokens, first || 'command')
      ),
      notes
    };
  }

  if (riskLevel === 'build') {
    const installLike = /(add|install|update|remove)$/u.test(second) || /^(npm|pnpm|yarn|bun)$/u.test(first) && second === 'install';
    const longRunning = /(?:\bdev\b|\bstart\b|\brun\b)/u.test(normalizedCommand) || /^(node|python|python3|uv)$/u.test(first);
    const fileTargets = installLike
      ? [
          'package.json',
          first === 'pnpm'
            ? 'pnpm-lock.yaml'
            : first === 'npm'
              ? 'package-lock.json'
              : first === 'yarn'
                ? 'yarn.lock'
                : first === 'bun'
                  ? 'bun.lockb'
                  : 'lockfile',
          'node_modules/',
          ...subcommandArgs
        ]
      : second === 'build'
        ? ['dist/', 'build/', '.next/']
        : subcommandArgs;
    return {
      files: makeImpactDimension(
        installLike ? 'expected' : 'possible',
        installLike ? 'Dependencies, lockfiles, caches, or build outputs may change.' : 'Build artifacts, caches, or local outputs may be created.',
        fileTargets.slice(0, 4)
      ),
      network: makeImpactDimension(
        installLike ? 'possible' : 'none',
        installLike ? 'Package registries or upstream sources may be contacted during install/update steps.' : 'No external network access expected unless the tool fetches dependencies implicitly.',
        installLike && networkTargets.length === 0 ? ['package registry'] : networkTargets
      ),
      processes: makeImpactDimension(
        longRunning ? 'expected' : 'possible',
        longRunning ? 'A runtime or script process is expected to start.' : 'Build/test processes will execute and may consume CPU or memory.',
        getLikelyProcessTargets(tokens, first || 'build tool')
      ),
      notes
    };
  }

  if (riskLevel === 'network') {
    const explicitOutputFile = getOptionValue(tokens, ['-o', '-O', '--output']);
    const isGitSync = first === 'git' && /^(clone|pull|fetch)$/u.test(second);
    const fileLevel: WorkspaceCommandImpactLevel =
      explicitOutputFile || /^(wget)$/u.test(first) || isGitSync ? (explicitOutputFile ? 'expected' : 'possible') : 'none';
    const fileSummary =
      explicitOutputFile
        ? 'Downloaded or synchronized content is expected to create or update local files.'
        : first === 'git' && /^(clone|pull|fetch)$/u.test(second)
        ? 'Remote repository data may update local files or refs.'
        : first === 'wget'
          ? 'Downloaded content may create local files.'
          : 'No direct file mutation expected beyond command-side effects.';
    const fileTargets = explicitOutputFile
      ? [explicitOutputFile]
      : isGitSync
        ? ['git refs', 'working tree']
        : first === 'wget'
          ? [subcommandArgs[0] ?? 'downloaded file']
          : [];
    return {
      files: makeImpactDimension(fileLevel, fileSummary, fileTargets),
      network: makeImpactDimension('expected', 'External hosts or remote repositories will be contacted.', networkTargets),
      processes: makeImpactDimension(
        'possible',
        'Transient network client processes will run while the command is active.',
        getLikelyProcessTargets(tokens, first || 'network client')
      ),
      notes
    };
  }

  if (riskLevel === 'process_control') {
    return {
      files: makeImpactDimension('none', 'No direct file mutation expected from process-control commands.'),
      network: makeImpactDimension('none', 'No direct network access expected.'),
      processes: makeImpactDimension(
        'expected',
        workspaceKind === 'devcontainer'
          ? 'Processes inside the selected container may be interrupted or controlled.'
          : 'Host processes or local services may be interrupted or controlled.',
        getLikelyProcessTargets(tokens, 'process target')
      ),
      notes
    };
  }

  return {
    files: makeImpactDimension('possible', 'Unreviewed command may read or modify workspace files.', nonFlagArgs.slice(0, 4)),
    network: makeImpactDimension('possible', 'Unreviewed command may contact external systems or fetch mutable state.', networkTargets),
    processes: makeImpactDimension(
      'possible',
      'Unreviewed command may start, stop, or affect local processes.',
      getLikelyProcessTargets(tokens, first || 'command')
    ),
    notes: [...notes, 'Command is outside the reviewed allowlist, so impact is estimated conservatively.']
  };
}

function buildWorkspaceCommandProfile(
  riskLevel: WorkspaceCommandRiskLevel,
  workspaceKind: WorkspaceKind,
  impact: WorkspaceCommandImpact
): Pick<WorkspaceCommandPolicy, 'impactProfile' | 'severity' | 'disposition' | 'reason'> {
  const filesActive = impact.files.level !== 'none';
  const filesExpected = impact.files.level === 'expected';
  const networkActive = impact.network.level !== 'none';
  const networkExpected = impact.network.level === 'expected';
  const processesExpected = impact.processes.level === 'expected';

  if (riskLevel === 'read_only') {
    return {
      impactProfile: 'read_only',
      severity: 'low',
      disposition: 'auto_run',
      reason:
        workspaceKind === 'devcontainer'
          ? 'read-only command is allowed inside the selected runtime'
          : 'read-only command is on the allowlist'
    };
  }

  if (riskLevel === 'process_control') {
    return {
      impactProfile: 'process_control',
      severity: workspaceKind === 'devcontainer' ? 'high' : 'critical',
      disposition: workspaceKind === 'devcontainer' ? 'approval_required' : 'role_required',
      reason:
        workspaceKind === 'devcontainer'
          ? 'process control inside a container still requires approval'
          : 'process control against host runtimes requires operator or admin role'
    };
  }

  if (riskLevel === 'network') {
    if (filesActive) {
      return {
        impactProfile: 'external_sync',
        severity: workspaceKind === 'devcontainer' ? 'high' : 'critical',
        disposition: workspaceKind === 'devcontainer' ? 'approval_required' : 'role_required',
        reason:
          workspaceKind === 'devcontainer'
            ? 'remote sync inside a devcontainer can still change mounted workspace state and requires approval'
            : 'remote sync from host-linked runtimes requires operator or admin role'
      };
    }
    return {
      impactProfile: 'external_access',
      severity: workspaceKind === 'devcontainer' ? 'high' : 'critical',
      disposition: workspaceKind === 'devcontainer' ? 'approval_required' : 'role_required',
      reason:
        workspaceKind === 'devcontainer'
          ? 'network access inside an isolated container still requires approval'
          : 'network access from host-linked runtimes requires operator or admin role'
    };
  }

  if (riskLevel === 'write') {
    return {
      impactProfile: 'file_mutation',
      severity: workspaceKind === 'current' ? 'critical' : 'high',
      disposition: workspaceKind === 'current' ? 'role_required' : 'approval_required',
      reason:
        workspaceKind === 'current'
          ? 'mutating the primary repository runtime requires operator or admin role'
          : 'command modifies files or git state and requires approval'
    };
  }

  if (riskLevel === 'build') {
    if (filesExpected && networkActive) {
      return {
        impactProfile: 'dependency_install',
        severity: workspaceKind === 'devcontainer' ? 'high' : workspaceKind === 'worktree' ? 'high' : 'critical',
        disposition: workspaceKind === 'devcontainer' ? 'approval_required' : workspaceKind === 'current' ? 'role_required' : 'approval_required',
        reason:
          workspaceKind === 'devcontainer'
            ? 'dependency installation inside a devcontainer fetches remote packages and changes local artifacts, so approval is required'
            : workspaceKind === 'current'
              ? 'dependency installation on the primary runtime requires operator or admin role'
              : 'dependency installation in an isolated worktree still requires approval'
      };
    }
    if (processesExpected) {
      return {
        impactProfile: 'process_launch',
        severity: workspaceKind === 'devcontainer' ? 'medium' : 'high',
        disposition: workspaceKind === 'devcontainer' ? 'auto_run' : 'approval_required',
        reason:
          workspaceKind === 'devcontainer'
            ? 'runtime or script launch can auto-run inside an isolated devcontainer runtime'
            : 'runtime or script launch on host or worktree runtimes requires approval'
      };
    }
    return {
      impactProfile: 'artifact_build',
      severity: networkExpected ? 'high' : workspaceKind === 'devcontainer' ? 'medium' : 'high',
      disposition: workspaceKind === 'devcontainer' ? 'auto_run' : 'approval_required',
      reason:
        workspaceKind === 'devcontainer'
          ? 'artifact builds can auto-run inside an isolated devcontainer runtime'
          : 'build commands on host or worktree runtimes require approval'
    };
  }

  return {
    impactProfile: 'unclassified',
    severity: workspaceKind === 'current' ? 'critical' : 'high',
    disposition: workspaceKind === 'current' ? 'role_required' : 'approval_required',
    reason:
      workspaceKind === 'current'
        ? 'unreviewed commands on the primary repository runtime require operator or admin role'
        : 'command is outside the reviewed allowlist'
  };
}

function stripJsonComments(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index] ?? '';
    const next = input[index + 1] ?? '';

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false;
        output += current;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inString && current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (!inString && current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += current;

    if (current === '"' && !escaped) {
      inString = !inString;
    }

    if (current === '\\' && !escaped) {
      escaped = true;
      continue;
    }

    escaped = false;
  }

  return output.replace(/,\s*([}\]])/gu, '$1');
}

function normalizeDevcontainerFeatureId(featureId: string): string {
  return featureId.trim().replace(/:\d+(?:\.\d+)*$/u, '');
}

export type DevcontainerDescriptor = {
  configPath: string | null;
  image: string | null;
  imageSource: 'image' | 'dockerfile' | null;
  buildContext: string | null;
  dockerfilePath: string | null;
  buildTarget: string | null;
  buildArgs: Array<{ key: string; value: string }>;
  features: string[];
  workspaceFolder: string | null;
  runArgs: string[];
  warnings: string[];
};

type DevcontainerFeaturePlan = {
  appliedFeatures: string[];
  dockerfileLines: string[];
  warnings: string[];
};

function findDevcontainerConfigPath(rootPath: string): string | null {
  for (const relativePath of DEVCONTAINER_CONFIG_CANDIDATES) {
    const absolutePath = path.join(rootPath, relativePath);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  return null;
}

function resolveContainerWorkspaceFolder(rawFolder: string, mountPath: string): string {
  const basename = path.basename(mountPath);
  const normalized = rawFolder
    .trim()
    .replace(/\$\{localWorkspaceFolderBasename\}/gu, basename)
    .replace(/\$\{localWorkspaceFolder\}/gu, DEFAULT_DEVCONTAINER_WORKDIR);
  if (normalized.startsWith('/')) return normalized;
  return path.posix.join(DEFAULT_DEVCONTAINER_WORKDIR, normalized);
}

function resolveDevcontainerTemplateValue(rawValue: string, rootPath: string): string {
  return rawValue
    .replace(/\$\{localWorkspaceFolderBasename\}/gu, path.basename(rootPath))
    .replace(/\$\{localWorkspaceFolder\}/gu, rootPath);
}

function resolveDevcontainerRelativePath(rootPath: string, configPath: string, rawPath: string): string {
  const resolved = path.resolve(path.dirname(configPath), resolveDevcontainerTemplateValue(rawPath.trim(), rootPath));
  if (!isPathWithinRoot(resolved, rootPath)) {
    throw new Error(`devcontainer path escapes workspace root: ${rawPath}`);
  }
  return resolved;
}

function sanitizeDevcontainerRunArgs(runArgs: unknown): { runArgs: string[]; warnings: string[] } {
  if (!Array.isArray(runArgs)) {
    return { runArgs: [], warnings: [] };
  }

  const sanitized: string[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < runArgs.length; index += 1) {
    const rawValue = runArgs[index];
    if (typeof rawValue !== 'string') {
      warnings.push('ignored non-string devcontainer runArg entry');
      continue;
    }
    const token = rawValue.trim();
    if (!token) continue;

    if (DEVCONTAINER_ALLOWED_SINGLE_ARGS.has(token)) {
      sanitized.push(token);
      continue;
    }

    const [flag, inlineValue] = token.split('=', 2);
    if (DEVCONTAINER_ALLOWED_VALUE_ARGS.has(flag)) {
      const value = inlineValue ?? (typeof runArgs[index + 1] === 'string' ? runArgs[index + 1].trim() : '');
      if (!value) {
        warnings.push(`ignored incomplete devcontainer runArg: ${flag}`);
        continue;
      }
      if (inlineValue) {
        sanitized.push(`${flag}=${value}`);
      } else {
        sanitized.push(flag, value);
        index += 1;
      }
      continue;
    }

    warnings.push(`ignored unsupported devcontainer runArg: ${token}`);
    if (!inlineValue && typeof runArgs[index + 1] === 'string' && !(runArgs[index + 1] as string).startsWith('--')) {
      index += 1;
    }
  }

  return { runArgs: sanitized, warnings };
}

function sanitizeDevcontainerBuildArgs(
  rawArgs: unknown,
  rootPath: string
): { buildArgs: Array<{ key: string; value: string }>; warnings: string[] } {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    return { buildArgs: [], warnings: [] };
  }

  const buildArgs: Array<{ key: string; value: string }> = [];
  const warnings: string[] = [];

  for (const [key, rawValue] of Object.entries(rawArgs)) {
    const normalizedKey = key.trim();
    if (!/^[A-Z0-9_][A-Z0-9_.-]*$/iu.test(normalizedKey)) {
      warnings.push(`ignored unsupported build arg key: ${key}`);
      continue;
    }
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number' && typeof rawValue !== 'boolean') {
      warnings.push(`ignored non-scalar build arg: ${key}`);
      continue;
    }
    const value = resolveDevcontainerTemplateValue(String(rawValue), rootPath);
    buildArgs.push({ key: normalizedKey, value });
  }

  return { buildArgs, warnings };
}

function parseDevcontainerBuild(
  rawBuild: unknown,
  rootPath: string,
  configPath: string
): {
  imageSource: 'image' | 'dockerfile' | null;
  buildContext: string | null;
  dockerfilePath: string | null;
  buildTarget: string | null;
  buildArgs: Array<{ key: string; value: string }>;
  warnings: string[];
} {
  if (!rawBuild || typeof rawBuild !== 'object' || Array.isArray(rawBuild)) {
    return {
      imageSource: null,
      buildContext: null,
      dockerfilePath: null,
      buildTarget: null,
      buildArgs: [],
      warnings: []
    };
  }

  const build = rawBuild as Record<string, unknown>;
  const warnings: string[] = [];
  let buildContext = rootPath;

  if (typeof build.context === 'string' && build.context.trim().length > 0) {
    try {
      buildContext = resolveDevcontainerRelativePath(rootPath, configPath, build.context);
      if (!existsSync(buildContext)) {
        warnings.push(`devcontainer build context does not exist: ${build.context}`);
        buildContext = rootPath;
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'invalid devcontainer build context');
      buildContext = rootPath;
    }
  }

  let dockerfilePath = path.join(path.dirname(configPath), 'Dockerfile');
  if (typeof build.dockerfile === 'string' && build.dockerfile.trim().length > 0) {
    try {
      dockerfilePath = resolveDevcontainerRelativePath(rootPath, configPath, build.dockerfile);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'invalid devcontainer dockerfile path');
    }
  }
  if (!existsSync(dockerfilePath)) {
    warnings.push(`devcontainer dockerfile does not exist: ${path.relative(rootPath, dockerfilePath) || 'Dockerfile'}`);
    return {
      imageSource: null,
      buildContext: null,
      dockerfilePath: null,
      buildTarget: null,
      buildArgs: [],
      warnings
    };
  }

  const { buildArgs, warnings: buildArgWarnings } = sanitizeDevcontainerBuildArgs(build.args, rootPath);
  warnings.push(...buildArgWarnings);

  return {
    imageSource: 'dockerfile',
    buildContext,
    dockerfilePath,
    buildTarget: typeof build.target === 'string' && build.target.trim().length > 0 ? build.target.trim() : null,
    buildArgs,
    warnings
  };
}

export function readDevcontainerDescriptor(rootPath: string): DevcontainerDescriptor {
  const configPath = findDevcontainerConfigPath(rootPath);
  if (!configPath) {
    return {
      configPath: null,
      image: null,
      imageSource: null,
      buildContext: null,
      dockerfilePath: null,
      buildTarget: null,
      buildArgs: [],
      features: [],
      workspaceFolder: null,
      runArgs: [],
      warnings: []
    };
  }

  try {
    const parsed = JSON.parse(stripJsonComments(readFileSync(configPath, 'utf8'))) as Record<string, unknown>;
    const warnings: string[] = [];
    const { runArgs, warnings: runArgWarnings } = sanitizeDevcontainerRunArgs(parsed.runArgs);
    warnings.push(...runArgWarnings);
    if (typeof parsed.workspaceMount === 'string') {
      warnings.push('ignored unsupported devcontainer workspaceMount override');
    }

    if (parsed.init === true && !runArgs.includes('--init')) {
      runArgs.unshift('--init');
    }

    const preferredUser =
      typeof parsed.containerUser === 'string'
        ? parsed.containerUser.trim()
        : typeof parsed.remoteUser === 'string'
          ? parsed.remoteUser.trim()
          : '';
    if (preferredUser && !runArgs.some((entry) => entry === '--user' || entry.startsWith('--user='))) {
      runArgs.push('--user', preferredUser);
    }

    const workspaceFolder =
      typeof parsed.workspaceFolder === 'string' && parsed.workspaceFolder.trim().length > 0
        ? parsed.workspaceFolder.trim()
        : null;
    if (workspaceFolder && workspaceFolder.includes('${') && !/\$\{localWorkspaceFolder(?:Basename)?\}/u.test(workspaceFolder)) {
      warnings.push(`workspaceFolder contains unsupported template: ${workspaceFolder}`);
    }

    const parsedFeatures =
      parsed.features && typeof parsed.features === 'object' && !Array.isArray(parsed.features)
        ? Object.keys(parsed.features as Record<string, unknown>)
        : [];

    const buildDescriptor = parseDevcontainerBuild(parsed.build, rootPath, configPath);
    warnings.push(...buildDescriptor.warnings);
    const image =
      typeof parsed.image === 'string' && parsed.image.trim().length > 0
        ? parsed.image.trim()
        : buildDescriptor.imageSource === 'dockerfile'
          ? null
          : null;

    return {
      configPath,
      image,
      imageSource: image ? 'image' : buildDescriptor.imageSource,
      buildContext: buildDescriptor.buildContext,
      dockerfilePath: buildDescriptor.dockerfilePath,
      buildTarget: buildDescriptor.buildTarget,
      buildArgs: buildDescriptor.buildArgs,
      features: parsedFeatures,
      workspaceFolder,
      runArgs,
      warnings
    };
  } catch (error) {
    return {
      configPath,
      image: null,
      imageSource: null,
      buildContext: null,
      dockerfilePath: null,
      buildTarget: null,
      buildArgs: [],
      features: [],
      workspaceFolder: null,
      runArgs: [],
      warnings: [error instanceof Error ? `failed to parse devcontainer config: ${error.message}` : 'failed to parse devcontainer config']
    };
  }
}

export function buildDevcontainerFeaturePlan(features: string[]): DevcontainerFeaturePlan {
  const appliedFeatures: string[] = [];
  const dockerfileLines: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const featureId of features) {
    const normalized = normalizeDevcontainerFeatureId(featureId);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (normalized === 'ghcr.io/devcontainers/features/git') {
      appliedFeatures.push(featureId);
      dockerfileLines.push(
        'RUN if command -v git >/dev/null 2>&1; then git --version >/dev/null; ' +
          'elif command -v apt-get >/dev/null 2>&1; then apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y git && rm -rf /var/lib/apt/lists/*; ' +
          'elif command -v apk >/dev/null 2>&1; then apk add --no-cache git; ' +
          'elif command -v dnf >/dev/null 2>&1; then dnf install -y git && dnf clean all; ' +
          'elif command -v yum >/dev/null 2>&1; then yum install -y git && yum clean all; ' +
          'else echo \"unsupported package manager for git feature\" >&2; exit 1; fi'
      );
      continue;
    }

    warnings.push(`ignored unsupported devcontainer feature: ${featureId}`);
  }

  return {
    appliedFeatures,
    dockerfileLines,
    warnings
  };
}

function buildLayeredDevcontainerImage(input: {
  baseImage: string;
  tag: string;
  dockerfileLines: string[];
}): void {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'jarvis-devcontainer-feature-'));
  try {
    writeFileSync(
      path.join(tempDir, 'Dockerfile'),
      `FROM ${input.baseImage}
SHELL ["/bin/sh","-lc"]
${input.dockerfileLines.join('\n')}
`
    );
    execFileSync('docker', ['build', '-t', input.tag, tempDir], {
      cwd: REPO_ROOT,
      env: buildPtyEnv(),
      stdio: 'pipe'
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function isLowRiskReadOnlyCommand(command: string): boolean {
  const normalized = normalizeReadOnlyCommand(command);
  if (!normalized) return false;
  if (/[><|;&`$()]/u.test(normalized)) return false;
  return READ_ONLY_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function classifyWorkspaceCommand(command: string, workspaceKind: WorkspaceKind = 'current'): WorkspaceCommandPolicy {
  const normalized = normalizeReadOnlyCommand(command);
  const buildPolicy = (riskLevel: WorkspaceCommandRiskLevel): WorkspaceCommandPolicy => {
    const impact = buildWorkspaceCommandImpact(normalized, workspaceKind, riskLevel);
    const profile = buildWorkspaceCommandProfile(riskLevel, workspaceKind, impact);
    return {
      normalizedCommand: normalized,
      riskLevel,
      impactProfile: profile.impactProfile,
      severity: profile.severity,
      disposition: profile.disposition,
      reason: profile.reason,
      impact
    };
  };
  if (!normalized) {
    return buildPolicy('unknown');
  }
  if (/[><|;&`$()]/u.test(normalized)) {
    const policy = buildPolicy('unknown');
    return {
      ...policy,
      reason: 'shell operators or subshell syntax require approval'
    };
  }
  if (READ_ONLY_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return buildPolicy('read_only');
  }
  if (NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return buildPolicy('network');
  }
  if (PROCESS_CONTROL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return buildPolicy('process_control');
  }
  if (WRITE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return buildPolicy('write');
  }
  if (BUILD_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return buildPolicy('build');
  }
  return buildPolicy('unknown');
}

function cleanupWorkspaceContainerArtifacts(workspace: WorkspaceRecord): void {
  if (workspace.kind === 'devcontainer' && workspace.containerName) {
    try {
      execFileSync('docker', ['rm', '-f', workspace.containerName], {
        cwd: REPO_ROOT,
        env: buildPtyEnv(),
        stdio: 'pipe'
      });
    } catch {
      // best-effort cleanup
    }
  }
  if (workspace.kind === 'devcontainer' && workspace.containerImageManaged && workspace.containerImage) {
    try {
      execFileSync('docker', ['image', 'rm', '-f', workspace.containerImage], {
        cwd: REPO_ROOT,
        env: buildPtyEnv(),
        stdio: 'pipe'
      });
    } catch {
      // best-effort cleanup
    }
  }
}

class WorkspaceRuntimeManager {
  private readonly workspaces = new Map<string, WorkspaceRuntimeState>();
  private readonly listeners = new Set<(event: WorkspaceRuntimeEvent) => void | Promise<void>>();

  createWorkspace(input: { userId: string; name?: string; cwd?: string; approvalRequired?: boolean }): WorkspaceRecord {
    const createdAt = nowIso();
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      userId: input.userId,
      name: input.name?.trim() || 'Jarvis Workspace',
      cwd: validateWorkspaceCwd(input.cwd),
      kind: 'current',
      baseRef: null,
      sourceWorkspaceId: null,
      containerName: null,
      containerImage: null,
      containerSource: null,
      containerImageManaged: false,
      containerBuildContext: null,
      containerDockerfile: null,
      containerFeatures: [],
      containerAppliedFeatures: [],
      containerWorkdir: null,
      containerConfigPath: null,
      containerRunArgs: [],
      containerWarnings: [],
      status: 'ready',
      approvalRequired: input.approvalRequired ?? true,
      createdAt,
      updatedAt: createdAt,
      sessionId: null,
      activeCommand: null,
      exitCode: null,
      lastError: null
    };
    this.workspaces.set(workspace.id, {
      workspace,
      nextSequence: 1,
      chunks: [],
      child: null,
      linkedJarvisSessionId: null,
      linkedActionProposalId: null,
      terminating: false
    });
    return { ...workspace };
  }

  createWorktreeWorkspace(input: {
    userId: string;
    name?: string;
    approvalRequired?: boolean;
    baseRef?: string;
  }): WorkspaceRecord {
    mkdirSync(WORKTREE_ROOT, { recursive: true });
    const createdAt = nowIso();
    const id = randomUUID();
    const baseRef = input.baseRef?.trim() || 'HEAD';
    const slug = slugifyWorkspaceSegment(input.name?.trim() || 'jarvis-worktree');
    const worktreePath = path.join(WORKTREE_ROOT, `${slug}-${id.slice(0, 8)}`);
    try {
      execFileSync('git', ['worktree', 'add', '--detach', worktreePath, baseRef], {
        cwd: REPO_ROOT,
        env: buildPtyEnv(),
        stdio: 'pipe'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to create git worktree';
      throw new Error(message);
    }

    const workspace: WorkspaceRecord = {
      id,
      userId: input.userId,
      name: input.name?.trim() || 'Jarvis Worktree',
      cwd: worktreePath,
      kind: 'worktree',
      baseRef,
      sourceWorkspaceId: null,
      containerName: null,
      containerImage: null,
      containerSource: null,
      containerImageManaged: false,
      containerBuildContext: null,
      containerDockerfile: null,
      containerFeatures: [],
      containerAppliedFeatures: [],
      containerWorkdir: null,
      containerConfigPath: null,
      containerRunArgs: [],
      containerWarnings: [],
      status: 'ready',
      approvalRequired: input.approvalRequired ?? true,
      createdAt,
      updatedAt: createdAt,
      sessionId: null,
      activeCommand: null,
      exitCode: null,
      lastError: null
    };
    this.workspaces.set(workspace.id, {
      workspace,
      nextSequence: 1,
      chunks: [],
      child: null,
      linkedJarvisSessionId: null,
      linkedActionProposalId: null,
      terminating: false
    });
    return { ...workspace };
  }

  createDevcontainerWorkspace(input: {
    userId: string;
    name?: string;
    approvalRequired?: boolean;
    image?: string;
    sourceWorkspaceId?: string | null;
  }): WorkspaceRecord {
    const createdAt = nowIso();
    const id = randomUUID();
    const sourceState =
      input.sourceWorkspaceId && input.sourceWorkspaceId.trim()
        ? this.getWorkspace(input.sourceWorkspaceId.trim(), input.userId)
        : null;
    if (input.sourceWorkspaceId && !sourceState) {
      throw new Error('source workspace not found');
    }
    const sourceWorkspace = sourceState?.workspace ?? null;
    if (sourceWorkspace?.kind === 'devcontainer') {
      throw new Error('devcontainer workspace cannot use another devcontainer as its source');
    }
    const mountPath = sourceWorkspace?.cwd ?? REPO_ROOT;
    const devcontainerDescriptor = readDevcontainerDescriptor(mountPath);
    let image = input.image?.trim() || devcontainerDescriptor.image || DEFAULT_DEVCONTAINER_IMAGE;
    let imageSource: 'image' | 'dockerfile' = input.image?.trim() ? 'image' : (devcontainerDescriptor.imageSource ?? 'image');
    let imageManaged = false;
    if (!input.image?.trim() && devcontainerDescriptor.imageSource === 'dockerfile' && devcontainerDescriptor.buildContext && devcontainerDescriptor.dockerfilePath) {
      image = `jarvis-devcontainer-build-${id.slice(0, 8)}`;
      const buildArgs = devcontainerDescriptor.buildArgs.flatMap((entry) => ['--build-arg', `${entry.key}=${entry.value}`]);
      const buildTargetArgs = devcontainerDescriptor.buildTarget ? ['--target', devcontainerDescriptor.buildTarget] : [];
      try {
        execFileSync(
          'docker',
          ['build', '-t', image, '-f', devcontainerDescriptor.dockerfilePath, ...buildTargetArgs, ...buildArgs, devcontainerDescriptor.buildContext],
          {
            cwd: REPO_ROOT,
            env: buildPtyEnv(),
            stdio: 'pipe'
          }
        );
        imageSource = 'dockerfile';
        imageManaged = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'failed to build devcontainer image';
        throw new Error(message);
      }
    }
    const featurePlan = buildDevcontainerFeaturePlan(devcontainerDescriptor.features);
    const finalWarnings = [...devcontainerDescriptor.warnings, ...featurePlan.warnings];
    if (featurePlan.dockerfileLines.length > 0) {
      const layeredImage = `jarvis-devcontainer-feature-${id.slice(0, 8)}`;
      try {
        buildLayeredDevcontainerImage({
          baseImage: image,
          tag: layeredImage,
          dockerfileLines: featurePlan.dockerfileLines
        });
        if (imageManaged) {
          try {
            execFileSync('docker', ['image', 'rm', '-f', image], {
              cwd: REPO_ROOT,
              env: buildPtyEnv(),
              stdio: 'pipe'
            });
          } catch {
            // best-effort cleanup of intermediate image
          }
        }
        image = layeredImage;
        imageManaged = true;
      } catch (error) {
        if (imageManaged) {
          try {
            execFileSync('docker', ['image', 'rm', '-f', image], {
              cwd: REPO_ROOT,
              env: buildPtyEnv(),
              stdio: 'pipe'
            });
          } catch {
            // best-effort cleanup after failed feature layer build
          }
        }
        const message = error instanceof Error ? error.message : 'failed to materialize devcontainer features';
        throw new Error(message);
      }
    }
    const containerWorkdir = devcontainerDescriptor.workspaceFolder
      ? resolveContainerWorkspaceFolder(devcontainerDescriptor.workspaceFolder, mountPath)
      : DEFAULT_DEVCONTAINER_WORKDIR;
    const containerName = `jarvis-devcontainer-${id.slice(0, 8)}`;
    try {
      execFileSync(
        'docker',
        [
          'run',
          '-d',
          '--rm',
          '--name',
          containerName,
          '-w',
          containerWorkdir,
          '-v',
          `${mountPath}:${containerWorkdir}`,
          ...devcontainerDescriptor.runArgs,
          image,
          'sh',
          '-lc',
          'tail -f /dev/null'
        ],
        {
          cwd: REPO_ROOT,
          env: buildPtyEnv(),
          stdio: 'pipe'
        }
      );
    } catch (error) {
      if (imageManaged) {
        try {
          execFileSync('docker', ['image', 'rm', '-f', image], {
            cwd: REPO_ROOT,
            env: buildPtyEnv(),
            stdio: 'pipe'
          });
        } catch {
          // best-effort cleanup after failed container creation
        }
      }
      const message = error instanceof Error ? error.message : 'failed to create devcontainer workspace';
      throw new Error(message);
    }

    const workspace: WorkspaceRecord = {
      id,
      userId: input.userId,
      name: input.name?.trim() || 'Jarvis Devcontainer',
      cwd: mountPath,
      kind: 'devcontainer',
      baseRef: sourceWorkspace?.baseRef ?? null,
      sourceWorkspaceId: sourceWorkspace?.id ?? null,
      containerName,
      containerImage: image,
      containerSource: imageSource,
      containerImageManaged: imageManaged,
      containerBuildContext: devcontainerDescriptor.buildContext,
      containerDockerfile: devcontainerDescriptor.dockerfilePath,
      containerFeatures: [...devcontainerDescriptor.features],
      containerAppliedFeatures: [...featurePlan.appliedFeatures],
      containerWorkdir,
      containerConfigPath: devcontainerDescriptor.configPath,
      containerRunArgs: [...devcontainerDescriptor.runArgs],
      containerWarnings: finalWarnings,
      status: 'ready',
      approvalRequired: input.approvalRequired ?? true,
      createdAt,
      updatedAt: createdAt,
      sessionId: null,
      activeCommand: null,
      exitCode: null,
      lastError: null
    };
    this.workspaces.set(workspace.id, {
      workspace,
      nextSequence: 1,
      chunks: [],
      child: null,
      linkedJarvisSessionId: null,
      linkedActionProposalId: null,
      terminating: false
    });
    return { ...workspace };
  }

  getWorkspace(workspaceId: string, userId: string): WorkspaceRuntimeState | null {
    const state = this.workspaces.get(workspaceId);
    if (!state || state.workspace.userId !== userId) return null;
    return state;
  }

  listWorkspaces(userId: string): WorkspaceRecord[] {
    return [...this.workspaces.values()]
      .filter((state) => state.workspace.userId === userId)
      .map((state) => ({ ...state.workspace }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getWorkspaceRecord(input: { workspaceId: string; userId: string }): WorkspaceRecord | null {
    const state = this.getWorkspace(input.workspaceId, input.userId);
    return state ? { ...state.workspace } : null;
  }

  spawnCommand(input: {
    workspaceId: string;
    userId: string;
    command: string;
    shell?: string;
    linkedJarvisSessionId?: string | null;
    linkedActionProposalId?: string | null;
  }): WorkspaceRecord {
    const state = this.getWorkspace(input.workspaceId, input.userId);
    if (!state) throw new Error('workspace not found');
    if (state.child) throw new Error('workspace already has a running session');

    const normalizedCommand = input.command.trim();
    if (!normalizedCommand) throw new Error('command is required');

    const shell = input.shell?.trim() || (state.workspace.kind === 'devcontainer' ? '/bin/sh' : process.env.SHELL || '/bin/zsh');
    let child: IPty;
    try {
      if (state.workspace.kind === 'devcontainer') {
        if (!state.workspace.containerName) {
          throw new Error('devcontainer workspace is missing container metadata');
        }
        child = spawnPty(
          'docker',
          [
            'exec',
            '-i',
            '-w',
            state.workspace.containerWorkdir ?? DEFAULT_DEVCONTAINER_WORKDIR,
            state.workspace.containerName,
            shell,
            '-lc',
            normalizedCommand
          ],
          {
            name: 'xterm-color',
            cols: 120,
            rows: 32,
            cwd: REPO_ROOT,
            env: buildPtyEnv(),
            encoding: 'utf8'
          }
        );
      } else {
        child = spawnPty(shell, ['-lc', normalizedCommand], {
          name: 'xterm-color',
          cols: 120,
          rows: 32,
          cwd: state.workspace.cwd,
          env: buildPtyEnv(),
          encoding: 'utf8'
        });
      }
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'failed to spawn pty process');
    }
    state.child = child;
    state.workspace.status = 'running';
    state.workspace.updatedAt = nowIso();
    state.workspace.sessionId = randomUUID();
    state.workspace.activeCommand = normalizedCommand;
    state.workspace.exitCode = null;
    state.workspace.lastError = null;
    state.linkedJarvisSessionId = input.linkedJarvisSessionId ?? null;
    state.linkedActionProposalId = input.linkedActionProposalId ?? null;
    state.terminating = false;
    this.appendChunk(state, 'system', `command started: ${normalizedCommand}`);

    child.onData((chunk: string) => {
      this.appendChunk(state, 'stdout', chunk);
    });
    child.onExit(({ exitCode, signal }) => {
      const reason = state.terminating ? 'terminated' : exitCode === 0 ? 'completed' : 'failed';
      state.workspace.status = reason === 'failed' ? 'error' : 'stopped';
      state.workspace.updatedAt = nowIso();
      state.workspace.exitCode = state.terminating ? 0 : exitCode ?? null;
      state.workspace.activeCommand = null;
      state.workspace.lastError = reason === 'failed' ? `command exited with code ${exitCode ?? -1}` : null;
      this.appendChunk(
        state,
        'system',
        reason === 'terminated'
          ? `command terminated by user${typeof signal === 'number' ? ` (signal ${signal})` : ''}`
          : `command exited with code ${exitCode ?? -1}`
      );
      state.child = null;
      this.emit({
        type: 'closed',
        workspace: { ...state.workspace },
        linkedJarvisSessionId: state.linkedJarvisSessionId,
        linkedActionProposalId: state.linkedActionProposalId,
        exitCode: state.workspace.exitCode,
        reason
      });
      state.linkedJarvisSessionId = null;
      state.linkedActionProposalId = null;
      state.terminating = false;
    });

    return { ...state.workspace };
  }

  writeToSession(input: { workspaceId: string; userId: string; data: string }): WorkspaceRecord {
    const state = this.getWorkspace(input.workspaceId, input.userId);
    if (!state) throw new Error('workspace not found');
    if (!state.child) throw new Error('workspace session is not running');
    state.child.write(input.data);
    this.appendChunk(state, 'system', `stdin write: ${input.data.length} byte(s)`);
    return { ...state.workspace };
  }

  readChunks(input: { workspaceId: string; userId: string; afterSequence?: number; limit?: number }): {
    workspace: WorkspaceRecord;
    chunks: WorkspaceChunkRecord[];
    nextSequence: number;
  } {
    const state = this.getWorkspace(input.workspaceId, input.userId);
    if (!state) throw new Error('workspace not found');
    const afterSequence = Math.max(0, input.afterSequence ?? 0);
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
    const chunks = state.chunks.filter((chunk) => chunk.sequence > afterSequence).slice(0, limit);
    return {
      workspace: { ...state.workspace },
      chunks,
      nextSequence: state.nextSequence
    };
  }

  shutdownWorkspace(input: { workspaceId: string; userId: string }): WorkspaceRecord {
    const state = this.getWorkspace(input.workspaceId, input.userId);
    if (!state) throw new Error('workspace not found');
    if (state.child) {
      state.terminating = true;
      state.child.kill('SIGTERM');
      this.appendChunk(state, 'system', 'workspace session terminated');
    }
    state.workspace.status = state.child ? 'running' : 'stopped';
    state.workspace.updatedAt = nowIso();
    state.workspace.activeCommand = null;
    return { ...state.workspace };
  }

  deleteWorkspace(input: { workspaceId: string; userId: string }): WorkspaceRecord {
    const state = this.getWorkspace(input.workspaceId, input.userId);
    if (!state) throw new Error('workspace not found');
    if (state.child) throw new Error('workspace already has a running session');
    if (state.workspace.kind === 'worktree') {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', state.workspace.cwd], {
          cwd: REPO_ROOT,
          env: buildPtyEnv(),
          stdio: 'pipe'
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'failed to delete git worktree';
        throw new Error(message);
      }
    }
    if (state.workspace.kind === 'devcontainer' && state.workspace.containerName) {
      cleanupWorkspaceContainerArtifacts(state.workspace);
    }
    this.workspaces.delete(state.workspace.id);
    return { ...state.workspace };
  }

  subscribe(listener: (event: WorkspaceRuntimeEvent) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): {
    total: number;
    running: number;
    worktrees: number;
    devcontainers: number;
    rootPath: string;
  } {
    const workspaces = [...this.workspaces.values()].map((state) => state.workspace);
    return {
      total: workspaces.length,
      running: workspaces.filter((workspace) => workspace.status === 'running').length,
      worktrees: workspaces.filter((workspace) => workspace.kind === 'worktree').length,
      devcontainers: workspaces.filter((workspace) => workspace.kind === 'devcontainer').length,
      rootPath: REPO_ROOT
    };
  }

  async shutdownAll(): Promise<void> {
    for (const state of this.workspaces.values()) {
      if (state.child) {
        state.terminating = true;
        state.child.kill('SIGTERM');
        state.child = null;
      }
      if (state.workspace.kind === 'devcontainer' && state.workspace.containerName) {
        cleanupWorkspaceContainerArtifacts(state.workspace);
      }
    }
    this.workspaces.clear();
  }

  private emit(event: WorkspaceRuntimeEvent): void {
    for (const listener of this.listeners) {
      void Promise.resolve(listener(event)).catch(() => {
        // Listener failures must not break runtime cleanup.
      });
    }
  }

  private appendChunk(state: WorkspaceRuntimeState, stream: WorkspaceChunkRecord['stream'], text: string): void {
    const normalized = text.length > 4000 ? `${text.slice(0, 4000)}\n[truncated]` : text;
    state.chunks.push({
      sequence: state.nextSequence,
      stream,
      text: normalized,
      createdAt: nowIso()
    });
    state.nextSequence += 1;
    state.workspace.updatedAt = nowIso();
    if (state.chunks.length > MAX_CHUNKS) {
      state.chunks.splice(0, state.chunks.length - MAX_CHUNKS);
    }
  }
}

let singleton: WorkspaceRuntimeManager | null = null;

export function getWorkspaceRuntimeManager(): WorkspaceRuntimeManager {
  singleton ??= new WorkspaceRuntimeManager();
  return singleton;
}

export function getWorkspaceRuntimeStatus() {
  return getWorkspaceRuntimeManager().getStatus();
}
