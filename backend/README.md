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
- `POST /api/v1/radar/ingest`
- `GET /api/v1/radar/items`
- `POST /api/v1/radar/evaluate`
- `GET /api/v1/radar/recommendations`
- `POST /api/v1/radar/reports/telegram`
- `GET /api/v1/upgrades/proposals`
- `POST /api/v1/upgrades/proposals/:proposalId/approve`
- `POST /api/v1/upgrades/runs`
- `GET /api/v1/upgrades/runs/:runId`

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
