---
tracker:
  sources:
    - internal_task
    - linear
  linear:
    include_states:
      - backlog
      - unstarted
      - started
polling:
  interval_ms: 60000
  batch_size: 5
  max_concurrent_runs: 1
  stall_timeout_ms: 900000
  retry_base_ms: 30000
  retry_max_ms: 900000
workspace:
  type: worktree
  base_ref: HEAD
  root_dir: .worktrees/runner
  cleanup_on_terminal: true
hooks:
  after_create: []
  before_run: []
  after_run: []
  before_remove: []
agent:
  session_title_template: "Runner: {{ workItem.identifier }}"
  auto_approve_main_command: true
codex:
  command: >-
    codex exec --cd "{{ workspace.cwd }}" --full-auto --skip-git-repo-check "{{ prompt }}"
  shell: /bin/zsh
  verification_commands:
    - pnpm --dir backend typecheck
  pull_request:
    draft: true
    branch_prefix: jarvis/runner
    title_template: "[Runner] {{ workItem.title }}"
    body_template: |
      Automated delivery runner handoff.

      Work item: {{ workItem.identifier }}
      Workspace: {{ workspace.cwd }}

      Prompt:
      {{ prompt }}
---
You are the repository delivery runner for this codebase.

Objective:
- Complete the requested change for `{{ workItem.identifier }}`.
- Keep edits scoped to the repository at `{{ workspace.cwd }}`.
- Run verification before handoff.
- Leave the result in a reviewable state for a pull request.

Execution rules:
- Prefer small, coherent edits over broad refactors.
- Do not revert unrelated user changes.
- If the requested work is ambiguous, choose the smallest defensible implementation.
- Summarize what changed and any residual risk in the final message.
