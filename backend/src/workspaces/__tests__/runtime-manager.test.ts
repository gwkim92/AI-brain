import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildDevcontainerFeaturePlan, classifyWorkspaceCommand, readDevcontainerDescriptor } from '../runtime-manager';

describe('workspace runtime manager helpers', () => {
  const cleanupTargets: string[] = [];

  afterEach(() => {
    while (cleanupTargets.length > 0) {
      const target = cleanupTargets.pop();
      if (!target) continue;
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('auto-runs build commands only inside devcontainers', () => {
    const currentPolicy = classifyWorkspaceCommand('node -p process.version', 'current');
    const devcontainerPolicy = classifyWorkspaceCommand('node -p process.version', 'devcontainer');

    expect(currentPolicy.riskLevel).toBe('build');
    expect(currentPolicy.impactProfile).toBe('process_launch');
    expect(currentPolicy.severity).toBe('high');
    expect(currentPolicy.disposition).toBe('approval_required');
    expect(currentPolicy.impact.files.level).toBe('possible');
    expect(currentPolicy.impact.processes.level).toBe('expected');
    expect(devcontainerPolicy.riskLevel).toBe('build');
    expect(devcontainerPolicy.impactProfile).toBe('process_launch');
    expect(devcontainerPolicy.severity).toBe('medium');
    expect(devcontainerPolicy.disposition).toBe('auto_run');
    expect(devcontainerPolicy.impact.processes.level).toBe('expected');
  });

  it('requires elevated role for host process-control commands', () => {
    const hostPolicy = classifyWorkspaceCommand('kill 123', 'current');
    const containerPolicy = classifyWorkspaceCommand('kill 123', 'devcontainer');

    expect(hostPolicy.riskLevel).toBe('process_control');
    expect(hostPolicy.impactProfile).toBe('process_control');
    expect(hostPolicy.severity).toBe('critical');
    expect(hostPolicy.disposition).toBe('role_required');
    expect(hostPolicy.impact.processes.level).toBe('expected');
    expect(containerPolicy.riskLevel).toBe('process_control');
    expect(containerPolicy.impactProfile).toBe('process_control');
    expect(containerPolicy.severity).toBe('high');
    expect(containerPolicy.disposition).toBe('approval_required');
    expect(containerPolicy.impact.processes.level).toBe('expected');
  });

  it('requires elevated role for host write and network commands but keeps devcontainer network approval-based', () => {
    const hostWritePolicy = classifyWorkspaceCommand('touch notes.txt', 'current');
    const worktreeWritePolicy = classifyWorkspaceCommand('touch notes.txt', 'worktree');
    const hostNetworkPolicy = classifyWorkspaceCommand('curl https://example.com', 'current');
    const containerNetworkPolicy = classifyWorkspaceCommand('curl https://example.com', 'devcontainer');

    expect(hostWritePolicy.riskLevel).toBe('write');
    expect(hostWritePolicy.impactProfile).toBe('file_mutation');
    expect(hostWritePolicy.severity).toBe('critical');
    expect(hostWritePolicy.disposition).toBe('role_required');
    expect(hostWritePolicy.impact.files.level).toBe('expected');
    expect(hostWritePolicy.impact.files.targets).toContain('notes.txt');
    expect(worktreeWritePolicy.riskLevel).toBe('write');
    expect(worktreeWritePolicy.impactProfile).toBe('file_mutation');
    expect(worktreeWritePolicy.severity).toBe('high');
    expect(worktreeWritePolicy.disposition).toBe('approval_required');
    expect(worktreeWritePolicy.impact.files.level).toBe('expected');
    expect(hostNetworkPolicy.riskLevel).toBe('network');
    expect(hostNetworkPolicy.impactProfile).toBe('external_access');
    expect(hostNetworkPolicy.severity).toBe('critical');
    expect(hostNetworkPolicy.disposition).toBe('role_required');
    expect(hostNetworkPolicy.impact.network.level).toBe('expected');
    expect(hostNetworkPolicy.impact.network.targets).toContain('https://example.com');
    expect(containerNetworkPolicy.riskLevel).toBe('network');
    expect(containerNetworkPolicy.impactProfile).toBe('external_access');
    expect(containerNetworkPolicy.severity).toBe('high');
    expect(containerNetworkPolicy.disposition).toBe('approval_required');
    expect(containerNetworkPolicy.impact.network.level).toBe('expected');
  });

  it('marks git pull as a network command that may mutate local refs or files', () => {
    const policy = classifyWorkspaceCommand('git pull origin main', 'current');

    expect(policy.riskLevel).toBe('network');
    expect(policy.impactProfile).toBe('external_sync');
    expect(policy.severity).toBe('critical');
    expect(policy.disposition).toBe('role_required');
    expect(policy.impact.network.level).toBe('expected');
    expect(policy.impact.network.targets).toContain('origin');
    expect(policy.impact.files.level).toBe('possible');
    expect(policy.impact.files.summary).toContain('Remote repository data');
    expect(policy.impact.processes.level).toBe('possible');
    expect(policy.impact.processes.targets).toContain('git pull');
    expect(policy.impact.notes[0]).toContain('primary repository checkout');
  });

  it('captures explicit download outputs as expected file mutations', () => {
    const policy = classifyWorkspaceCommand('curl --output report.json https://example.com/report.json', 'devcontainer');

    expect(policy.riskLevel).toBe('network');
    expect(policy.impactProfile).toBe('external_sync');
    expect(policy.severity).toBe('high');
    expect(policy.disposition).toBe('approval_required');
    expect(policy.impact.network.targets).toContain('https://example.com/report.json');
    expect(policy.impact.files.level).toBe('expected');
    expect(policy.impact.files.targets).toContain('report.json');
    expect(policy.impact.processes.targets).toContain('curl');
  });

  it('maps package manager installs to dependency artifact targets', () => {
    const policy = classifyWorkspaceCommand('pnpm install', 'devcontainer');

    expect(policy.riskLevel).toBe('build');
    expect(policy.impactProfile).toBe('dependency_install');
    expect(policy.severity).toBe('high');
    expect(policy.disposition).toBe('approval_required');
    expect(policy.impact.files.level).toBe('expected');
    expect(policy.impact.files.targets).toEqual(expect.arrayContaining(['package.json', 'pnpm-lock.yaml', 'node_modules/']));
    expect(policy.impact.network.level).toBe('possible');
    expect(policy.impact.network.targets).toContain('package registry');
    expect(policy.impact.processes.targets).toContain('pnpm install');
  });

  it('parses devcontainer config with comment stripping and runArg sanitization', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jarvis-devcontainer-'));
    cleanupTargets.push(root);
    const configDir = path.join(root, '.devcontainer');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      path.join(configDir, 'devcontainer.json'),
      `{
        // comment should be ignored
        "image": "ghcr.io/example/jarvis:latest",
        "workspaceFolder": "/workspaces/\${localWorkspaceFolderBasename}",
        "runArgs": ["--cpus", "2", "--cap-add=SYS_PTRACE"],
        "containerUser": "node",
        "features": {
          "ghcr.io/devcontainers/features/git:1": {}
        },
        "build": {
          "dockerfile": "Dockerfile",
        },
      }`
    );

    const descriptor = readDevcontainerDescriptor(root);

    expect(descriptor.configPath).toContain('.devcontainer/devcontainer.json');
    expect(descriptor.image).toBe('ghcr.io/example/jarvis:latest');
    expect(descriptor.imageSource).toBe('image');
    expect(descriptor.workspaceFolder).toBe('/workspaces/${localWorkspaceFolderBasename}');
    expect(descriptor.runArgs).toEqual(['--cpus', '2', '--user', 'node']);
    expect(descriptor.features).toEqual(['ghcr.io/devcontainers/features/git:1']);
    expect(descriptor.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ignored unsupported devcontainer runArg')
      ])
    );
  });

  it('parses devcontainer dockerfile builds and sanitizes build args', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jarvis-devcontainer-build-'));
    cleanupTargets.push(root);
    const configDir = path.join(root, '.devcontainer');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, 'Dockerfile'), 'FROM node:24-alpine\nRUN node --version\n');
    writeFileSync(
      path.join(configDir, 'devcontainer.json'),
      `{
        "build": {
          "context": "..",
          "dockerfile": "Dockerfile",
          "target": "runtime",
          "args": {
            "NODE_ENV": "development",
            "WORKSPACE_NAME": "\${localWorkspaceFolderBasename}"
          }
        }
      }`
    );

    const descriptor = readDevcontainerDescriptor(root);

    expect(descriptor.image).toBeNull();
    expect(descriptor.imageSource).toBe('dockerfile');
    expect(descriptor.buildContext).toBe(root);
    expect(descriptor.dockerfilePath).toBe(path.join(configDir, 'Dockerfile'));
    expect(descriptor.buildTarget).toBe('runtime');
    expect(descriptor.buildArgs).toEqual([
      { key: 'NODE_ENV', value: 'development' },
      { key: 'WORKSPACE_NAME', value: path.basename(root) }
    ]);
  });

  it('materializes only allowlisted devcontainer features', () => {
    const plan = buildDevcontainerFeaturePlan([
      'ghcr.io/devcontainers/features/git:1',
      'ghcr.io/devcontainers/features/github-cli:1'
    ]);

    expect(plan.appliedFeatures).toEqual(['ghcr.io/devcontainers/features/git:1']);
    expect(plan.dockerfileLines[0]).toContain('apt-get');
    expect(plan.warnings).toEqual(['ignored unsupported devcontainer feature: ghcr.io/devcontainers/features/github-cli:1']);
  });
});
