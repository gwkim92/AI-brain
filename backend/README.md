# JARVIS Backend

## Quick Start

1. Install dependencies

```bash
pnpm install
```

2. Copy environment file

```bash
cp .env.example .env
```

3. Start local dependencies (from repository root)

```bash
docker compose up -d postgres valkey
```

4. Apply schema

```bash
DATABASE_URL=postgres://jarvis:jarvis@127.0.0.1:5432/jarvis pnpm db:init
```

`pnpm db:init` now uses the same Postgres initializer as runtime bootstrap:
`/Users/woody/ai/brain/backend/src/store/postgres/initializer.ts`

Reference schema snapshots still exist at:
- `/Users/woody/ai/brain/backend/db-schema-v1.sql`
- `/Users/woody/ai/brain/docs/db-schema-v1.sql`

They are documentation/reference only and are not the production init path.

5. Run server

```bash
STORE_BACKEND=postgres DATABASE_URL=postgres://jarvis:jarvis@127.0.0.1:5432/jarvis pnpm dev
```

6. Run the delivery runner as a separate process

```bash
pnpm runner:local
```

`pnpm runner:local` forces `RUNNER_ENABLED=true`, defaults `RUNNER_REPO_ROOT` to the repository root, and keeps `RUNNER_STALL_TERMINATE_ENABLED=true` unless you explicitly disable it. Use plain `pnpm runner` when you want to override those values explicitly.

7. Optional: run the delivery runner in Docker Compose

```bash
docker compose --profile runner up runner
```

The compose runner mounts the full repository at `/workspace` and keeps Linux-native backend dependencies in a dedicated volume. If git push or PR handoff needs your personal credentials, host-local `pnpm runner:local` is still the safer default.

## Core Endpoints

- `GET /health`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:taskId`
- `GET /api/v1/tasks/:taskId/events` (SSE)
- `GET /api/v1/providers`
- `POST /api/v1/ai/respond`
- `POST /api/v1/councils/runs`
- `GET /api/v1/councils/runs`
- `GET /api/v1/councils/runs/:runId`
- `GET /api/v1/councils/runs/:runId/events` (SSE)
- `POST /api/v1/executions/runs`
- `GET /api/v1/executions/runs`
- `GET /api/v1/executions/runs/:runId`
- `GET /api/v1/executions/runs/:runId/events` (SSE)
- `POST /api/v1/radar/ingest`
- `GET /api/v1/radar/items`
- `POST /api/v1/radar/evaluate`
- `GET /api/v1/radar/recommendations`
- `POST /api/v1/radar/reports/telegram`
- `GET /api/v1/upgrades/proposals`
- `POST /api/v1/upgrades/proposals/:proposalId/approve`
- `POST /api/v1/upgrades/runs`
- `GET /api/v1/upgrades/runs/:runId`
- `GET /api/v1/runner/state`
- `POST /api/v1/runner/refresh`
- `GET /api/v1/runner/runs`
- `GET /api/v1/runner/runs/:runId`
- `POST /api/v1/runner/runs/:runId/cancel`
- `POST /api/v1/runner/workflow/validate`

## Delivery Runner

- The runner is a separate daemon. Keep `pnpm dev` and `pnpm runner:local` running independently.
- The execution contract is loaded from the repository root `WORKFLOW.md`.
- Internal tasks can feed the runner without extra credentials.
- Linear is now treated as external inbox intake by default, not as the runner's primary input source.
- `GET /api/v1/inbox/external-work` and `POST /api/v1/inbox/external-work/:itemId/route` drive manual Linear triage into tasks, missions, and sessions.
- Linear sync requires `LINEAR_API_KEY` and at least one of `LINEAR_TEAM_ID` or `LINEAR_PROJECT_ID`.
- Direct `Linear -> runner` polling is compatibility-only and stays off unless `RUNNER_LINEAR_DIRECT_ENABLED=true`.
- PR creation requires `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPO`.
- `git push` still depends on the local runner process having working git credentials.
- Stalled runs are retried automatically. Set `RUNNER_STALL_TERMINATE_ENABLED=true` to terminate an orphaned local process group before queueing the retry.
- `GET /api/v1/runner/state` now includes operational metrics for due retries, stalled runs, cleanup-pending workspaces, workflow validation errors, and recent runner errors.
- Runner notifications reuse the standard notification channels. Configure `NOTIFICATION_WEBHOOK_*` and/or `NOTIFICATION_TELEGRAM_*` to receive workflow-invalid, stalled-run, failed-run, and handoff-ready alerts.

Example runner env overrides:

```bash
RUNNER_ENABLED=true \
RUNNER_REPO_ROOT=/absolute/path/to/repo \
RUNNER_POLL_INTERVAL_MS=30000 \
RUNNER_STALL_TERMINATE_ENABLED=true \
RUNNER_LINEAR_DIRECT_ENABLED=false \
NOTIFICATION_WEBHOOK_ENABLED=true \
LINEAR_API_KEY=lin_api_xxx \
LINEAR_TEAM_ID=team_xxx \
GITHUB_TOKEN=ghp_xxx \
GITHUB_OWNER=your-org \
GITHUB_REPO=your-repo \
pnpm runner
```

## Auth + Admin Bootstrap

- On startup, backend upserts an admin account from env:
  - `ADMIN_BOOTSTRAP_EMAIL` (default: `admin@jarvis.local`)
  - `ADMIN_BOOTSTRAP_PASSWORD` (default: `Admin!234567`)
  - `ADMIN_BOOTSTRAP_DISPLAY_NAME` (default: `Jarvis Admin`)
- Change bootstrap password immediately in production.
- Set `AUTH_REQUIRED=true` to enforce bearer/session auth on API routes.

## Run API Notes

- `POST /api/v1/councils/runs` and `POST /api/v1/executions/runs` are asynchronous (`202 Accepted`).
- Both endpoints require `idempotency-key` header (8-200 chars); optional `x-trace-id` propagates to task events.
- Both run creation payloads support `exclude_providers` (`openai|gemini|anthropic|local`) to force rerouting away from specific providers.
- Execution SSE stream (`/api/v1/executions/runs/:runId/events`) emits `execution.run.updated`, `execution.run.completed`, `execution.run.failed`.

## AI Providers

- `openai`: `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, `OPENAI_MODEL`)
- `gemini`: `GEMINI_API_KEY` (+ optional `GEMINI_BASE_URL`, `GEMINI_MODEL`)
- `anthropic`: `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`)
- `local`: `LOCAL_LLM_ENABLED=true` with OpenAI-compatible endpoint at `LOCAL_LLM_BASE_URL` (`/v1/chat/completions`)

## Quality Checks

```bash
pnpm vitest
pnpm tsc --noEmit
pnpm eslint .
```
