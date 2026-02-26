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

5. Run server

```bash
STORE_BACKEND=postgres DATABASE_URL=postgres://jarvis:jarvis@127.0.0.1:5432/jarvis pnpm dev
```

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
