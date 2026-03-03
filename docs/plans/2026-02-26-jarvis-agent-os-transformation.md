# JARVIS Agent OS Transformation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert JARVIS from prompt-response UX into a mission-driven Agent OS that can plan, spawn subagents, enforce policy, preserve memory, and explain every execution decision.

**Architecture:** Extend the existing mission + orchestrator backbone with a contract-first mission model, dynamic team orchestration loop (planner/executor/critic), policy-bound execution with approval gates, and durable traceability. Keep backward compatibility by layering new schema fields and APIs behind optional defaults, then expose the operating model through HUD modules and operator dashboards.

**Tech Stack:** Fastify, TypeScript, PostgreSQL, Next.js App Router, SSE, Zod, Vitest, Playwright, OpenAPI

---

## PRD Backlog (Priority Order)

1. PRD-01: Mission Contract V2 (goal/constraints/budget/deadline/approval policy)
2. PRD-02: Dynamic Agent Team Planner (subagent graph generation)
3. PRD-03: Team Execution Loop (planner -> executor -> critic with retries)
4. PRD-04: Policy and HITL Guardrails (risk + approvals + role checks)
5. PRD-05: 3-Layer Memory (user/project/run)
6. PRD-06: Trace and Explainability (decision/event timeline)
7. PRD-07: Mission Control UI (team run visibility + intervention)
8. PRD-08: Outcome KPI + Usage Ledger (completion/cost/time dashboards)

## Release Gates

- Gate A (Backend): PRD-01 through PRD-06 merged with tests passing
- Gate B (Frontend): PRD-07 merged and e2e pass for mission lifecycle
- Gate C (Ops): PRD-08 dashboards stable for 7 days in staging

### Task 1: PRD-01 Mission Contract V2

**Files:**
- Modify: `/Users/woody/ai/brain/backend/src/routes/missions.ts`
- Modify: `/Users/woody/ai/brain/backend/src/store/types.ts`
- Modify: `/Users/woody/ai/brain/backend/src/store/postgres-store.ts`
- Modify: `/Users/woody/ai/brain/backend/db-schema-v1.sql`
- Modify: `/Users/woody/ai/brain/backend/src/routes/__tests__/missions.test.ts`
- Modify: `/Users/woody/ai/brain/docs/openapi-v1.yaml`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/types.ts`
- Modify: `/Users/woody/ai/brain/web/src/lib/hud/mission-intake.ts`

**Step 1: Write failing backend test for contract fields**
- Add a new case in `missions.test.ts` that posts mission payload with:
  - `constraints.max_cost_usd`
  - `constraints.deadline_at`
  - `constraints.allowed_tools`
  - `approval_policy.mode`
- Assert response includes persisted contract object.

**Step 2: Run focused test to confirm failure**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/missions.test.ts -t "contract fields"`
Expected: FAIL due to unknown payload keys.

**Step 3: Extend mission request/response schema**
- Add nested zod schemas in `missions.ts` for `constraints` and `approval_policy`.
- Add optional defaults to keep current clients working.

**Step 4: Persist contract in store layer**
- Add `missionContract` to `MissionRecord` and `CreateMissionInput` in `store/types.ts`.
- Add `mission_contract JSONB NOT NULL DEFAULT '{}'` to DB schema and postgres initializer.
- Map field in create/get/list/update mission queries.

**Step 5: Update API schema and frontend types**
- Extend mission schemas in `openapi-v1.yaml`.
- Regenerate API types for web client.
- Add typed contract shape in `web/src/lib/api/types.ts`.

**Step 6: Run verification**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/missions.test.ts && pnpm test`
Run: `cd /Users/woody/ai/brain/web && npm run api:types:check && npm run lint`
Expected: PASS.

**Step 7: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/routes/missions.ts /Users/woody/ai/brain/backend/src/store/types.ts /Users/woody/ai/brain/backend/src/store/postgres-store.ts /Users/woody/ai/brain/backend/db-schema-v1.sql /Users/woody/ai/brain/backend/src/routes/__tests__/missions.test.ts /Users/woody/ai/brain/docs/openapi-v1.yaml /Users/woody/ai/brain/web/src/lib/api/types.ts /Users/woody/ai/brain/web/src/lib/hud/mission-intake.ts

git commit -m "feat: add mission contract v2 fields and persistence"
```

### Task 2: PRD-02 Dynamic Agent Team Planner

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/orchestrator/team-planner.ts`
- Create: `/Users/woody/ai/brain/backend/src/orchestrator/team-templates.ts`
- Modify: `/Users/woody/ai/brain/backend/src/orchestrator/complexity.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/missions.ts`
- Create: `/Users/woody/ai/brain/backend/src/orchestrator/__tests__/team-planner.test.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/__tests__/missions.test.ts`

**Step 1: Write failing team planner tests**
- Validate planner chooses template by mission domain + complexity.
- Validate output graph includes `leader`, `workers[]`, and `handoff_rules`.

**Step 2: Run focused test to confirm failure**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/orchestrator/__tests__/team-planner.test.ts`
Expected: FAIL because planner module does not exist.

**Step 3: Implement team template registry**
- Add deterministic templates (`code`, `research`, `mixed`).
- Include role definitions and max parallel workers.

**Step 4: Implement team planner function**
- Input: mission objective + contract + complexity.
- Output: subagent plan graph with role/task mapping.

**Step 5: Wire planner into mission plan generation endpoint**
- In `/api/v1/missions/generate-plan`, include `team_plan` in response.
- Keep previous `plan` field unchanged for compatibility.

**Step 6: Re-run tests**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/orchestrator/__tests__/team-planner.test.ts src/routes/__tests__/missions.test.ts`
Expected: PASS.

**Step 7: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/orchestrator/team-planner.ts /Users/woody/ai/brain/backend/src/orchestrator/team-templates.ts /Users/woody/ai/brain/backend/src/orchestrator/complexity.ts /Users/woody/ai/brain/backend/src/routes/missions.ts /Users/woody/ai/brain/backend/src/orchestrator/__tests__/team-planner.test.ts /Users/woody/ai/brain/backend/src/routes/__tests__/missions.test.ts

git commit -m "feat: add dynamic subagent team planner"
```

### Task 3: PRD-03 Team Execution Loop (Planner -> Executor -> Critic)

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/orchestrator/team-execution-loop.ts`
- Modify: `/Users/woody/ai/brain/backend/src/orchestrator/mission-executor.ts`
- Modify: `/Users/woody/ai/brain/backend/src/orchestrator/dag-runner.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/missions.ts`
- Create: `/Users/woody/ai/brain/backend/src/orchestrator/__tests__/team-execution-loop.test.ts`
- Modify: `/Users/woody/ai/brain/backend/src/orchestrator/__tests__/dag-runner.test.ts`

**Step 1: Write failing tests for loop behavior**
- Assert each mission phase emits `planner`, `executor`, `critic` outputs.
- Assert critic-triggered retry executes once and then escalates.

**Step 2: Run focused tests**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/orchestrator/__tests__/team-execution-loop.test.ts`
Expected: FAIL.

**Step 3: Implement execution loop state machine**
- States: `planned -> executing -> critiquing -> retrying|completed|blocked`.
- Add bounded retry count from mission contract.

**Step 4: Integrate loop into mission execution path**
- Replace direct per-step provider call path in `mission-executor.ts` with loop wrapper.
- Preserve existing `executeMission` function signature.

**Step 5: Add event payloads for each loop phase**
- Emit phase metadata for SSE consumers (`mission.updated`).

**Step 6: Verify tests**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/orchestrator/__tests__/team-execution-loop.test.ts src/orchestrator/__tests__/dag-runner.test.ts && pnpm test`
Expected: PASS.

**Step 7: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/orchestrator/team-execution-loop.ts /Users/woody/ai/brain/backend/src/orchestrator/mission-executor.ts /Users/woody/ai/brain/backend/src/orchestrator/dag-runner.ts /Users/woody/ai/brain/backend/src/routes/missions.ts /Users/woody/ai/brain/backend/src/orchestrator/__tests__/team-execution-loop.test.ts /Users/woody/ai/brain/backend/src/orchestrator/__tests__/dag-runner.test.ts

git commit -m "feat: add planner-executor-critic mission execution loop"
```

### Task 4: PRD-04 Policy + HITL Guardrails

**Files:**
- Modify: `/Users/woody/ai/brain/backend/src/routes/approvals.ts`
- Modify: `/Users/woody/ai/brain/backend/src/orchestrator/mission-executor.ts`
- Modify: `/Users/woody/ai/brain/backend/src/notifications/proactive.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/types.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/__tests__/api.test.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/__tests__/missions.test.ts`

**Step 1: Write failing policy gate test**
- Add test where high-risk mission step should auto-create approval and block execution.
- Add test where operator approves and step resumes.

**Step 2: Run test and confirm failure**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/api.test.ts -t "high-risk mission step"`
Expected: FAIL.

**Step 3: Implement risk policy resolver**
- Derive risk from step type + mission contract.
- Route high-risk actions through approval route.

**Step 4: Add mission approval linkage**
- Include `mission_id` + `step_id` metadata in approval record payload.
- Emit `approval_required` notification with mission context.

**Step 5: Add resume execution behavior after decision**
- On approved decision, mission step transitions from `blocked` to `pending`.

**Step 6: Verify tests**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/api.test.ts src/routes/__tests__/missions.test.ts`
Expected: PASS.

**Step 7: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/routes/approvals.ts /Users/woody/ai/brain/backend/src/orchestrator/mission-executor.ts /Users/woody/ai/brain/backend/src/notifications/proactive.ts /Users/woody/ai/brain/backend/src/routes/types.ts /Users/woody/ai/brain/backend/src/routes/__tests__/api.test.ts /Users/woody/ai/brain/backend/src/routes/__tests__/missions.test.ts

git commit -m "feat: enforce risk-based hitl approval gates for missions"
```

### Task 5: PRD-05 3-Layer Memory (User / Project / Run)

**Files:**
- Modify: `/Users/woody/ai/brain/backend/db-schema-v1.sql`
- Modify: `/Users/woody/ai/brain/backend/src/store/types.ts`
- Modify: `/Users/woody/ai/brain/backend/src/store/postgres-store.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/memory.ts`
- Modify: `/Users/woody/ai/brain/backend/src/memory/embed.ts`
- Create: `/Users/woody/ai/brain/backend/src/routes/__tests__/memory.test.ts`
- Modify: `/Users/woody/ai/brain/web/src/components/modules/MemoryModule.tsx`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/endpoints.ts`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/types.ts`

**Step 1: Write failing memory tier tests**
- Add tests for storing and retrieving `user_profile`, `project_memory`, `run_memory` separately.

**Step 2: Run focused test**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/memory.test.ts`
Expected: FAIL.

**Step 3: Add DB and store primitives**
- Create tables for user/profile and project memory.
- Keep `memory_segments` as run-level memory.

**Step 4: Add memory APIs**
- `GET/PUT /api/v1/memory/profile`
- `GET/PUT /api/v1/memory/projects/:workspaceId`
- Keep existing `/snapshot` and `/search` endpoints.

**Step 5: Update embedding ingestion path**
- Tag each memory insert with layer and source metadata.

**Step 6: Update Memory widget**
- Add layer filters and source labels.

**Step 7: Verify**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/memory.test.ts && pnpm test`
Run: `cd /Users/woody/ai/brain/web && npm run lint && npm run build`
Expected: PASS.

**Step 8: Commit**
```bash
git add /Users/woody/ai/brain/backend/db-schema-v1.sql /Users/woody/ai/brain/backend/src/store/types.ts /Users/woody/ai/brain/backend/src/store/postgres-store.ts /Users/woody/ai/brain/backend/src/routes/memory.ts /Users/woody/ai/brain/backend/src/memory/embed.ts /Users/woody/ai/brain/backend/src/routes/__tests__/memory.test.ts /Users/woody/ai/brain/web/src/components/modules/MemoryModule.tsx /Users/woody/ai/brain/web/src/lib/api/endpoints.ts /Users/woody/ai/brain/web/src/lib/api/types.ts

git commit -m "feat: add three-layer memory model and APIs"
```

### Task 6: PRD-06 Trace + Explainability Timeline

**Files:**
- Modify: `/Users/woody/ai/brain/backend/db-schema-v1.sql`
- Modify: `/Users/woody/ai/brain/backend/src/store/types.ts`
- Modify: `/Users/woody/ai/brain/backend/src/store/postgres-store.ts`
- Create: `/Users/woody/ai/brain/backend/src/routes/traces.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/index.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/assistant.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/councils.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/executions.ts`
- Create: `/Users/woody/ai/brain/backend/src/routes/__tests__/traces.test.ts`
- Modify: `/Users/woody/ai/brain/docs/openapi-v1.yaml`

**Step 1: Write failing trace API tests**
- Add tests for `GET /api/v1/traces/:traceId` and SSE endpoint.
- Assert event order and redacted sensitive fields.

**Step 2: Run focused test**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/traces.test.ts`
Expected: FAIL.

**Step 3: Add trace event persistence**
- Add `trace_events` table with `trace_id`, `category`, `event_type`, `payload`, `created_at`.
- Add store methods `appendTraceEvent`, `listTraceEvents`.

**Step 4: Instrument execution routes**
- Append trace events in assistant/council/execution/mission route flows.

**Step 5: Implement trace routes and OpenAPI schemas**
- Add list/detail stream route.
- Add `decision_reason` and `policy_snapshot` fields in response model.

**Step 6: Verify**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/traces.test.ts && pnpm test`
Expected: PASS.

**Step 7: Commit**
```bash
git add /Users/woody/ai/brain/backend/db-schema-v1.sql /Users/woody/ai/brain/backend/src/store/types.ts /Users/woody/ai/brain/backend/src/store/postgres-store.ts /Users/woody/ai/brain/backend/src/routes/traces.ts /Users/woody/ai/brain/backend/src/routes/index.ts /Users/woody/ai/brain/backend/src/routes/assistant.ts /Users/woody/ai/brain/backend/src/routes/councils.ts /Users/woody/ai/brain/backend/src/routes/executions.ts /Users/woody/ai/brain/backend/src/routes/__tests__/traces.test.ts /Users/woody/ai/brain/docs/openapi-v1.yaml

git commit -m "feat: add end-to-end trace and explainability timeline APIs"
```

### Task 7: PRD-07 Mission Control UI (Agent Team Ops)

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx`
- Modify: `/Users/woody/ai/brain/web/src/components/modules/CouncilModule.tsx`
- Modify: `/Users/woody/ai/brain/web/src/components/modules/ApprovalsModule.tsx`
- Create: `/Users/woody/ai/brain/web/src/components/ui/TeamRunTimeline.tsx`
- Create: `/Users/woody/ai/brain/web/src/components/ui/AgentRoleCard.tsx`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/endpoints.ts`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/types.ts`
- Create: `/Users/woody/ai/brain/web/e2e/mission-control-agent-team.spec.ts`

**Step 1: Add failing e2e scenario**
- User submits mission contract.
- UI shows team graph, run phases, and approval intervention controls.

**Step 2: Run e2e and confirm failure**
Run: `cd /Users/woody/ai/brain/web && npm run e2e -- mission-control-agent-team.spec.ts`
Expected: FAIL.

**Step 3: Implement TeamRunTimeline widget**
- Render phase-level timeline (`plan`, `execute`, `critic`, `approval`).
- Show assigned role per phase.

**Step 4: Implement AgentRoleCard list**
- Display role objective, status, provider/model served, and last output summary.

**Step 5: Wire approval actions inline**
- Allow approve/reject directly from mission timeline card.

**Step 6: Verify UI build and tests**
Run: `cd /Users/woody/ai/brain/web && npm run lint && npm run build && npm run e2e -- mission-control-agent-team.spec.ts`
Expected: PASS.

**Step 7: Commit**
```bash
git add /Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx /Users/woody/ai/brain/web/src/components/modules/CouncilModule.tsx /Users/woody/ai/brain/web/src/components/modules/ApprovalsModule.tsx /Users/woody/ai/brain/web/src/components/ui/TeamRunTimeline.tsx /Users/woody/ai/brain/web/src/components/ui/AgentRoleCard.tsx /Users/woody/ai/brain/web/src/lib/api/endpoints.ts /Users/woody/ai/brain/web/src/lib/api/types.ts /Users/woody/ai/brain/web/e2e/mission-control-agent-team.spec.ts

git commit -m "feat: add mission control ui for agent team execution"
```

### Task 8: PRD-08 Outcome KPI + Usage Ledger

**Files:**
- Modify: `/Users/woody/ai/brain/backend/db-schema-v1.sql`
- Modify: `/Users/woody/ai/brain/backend/src/store/postgres-store.ts`
- Modify: `/Users/woody/ai/brain/backend/src/store/types.ts`
- Modify: `/Users/woody/ai/brain/backend/src/providers/router.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/reports.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/dashboard.ts`
- Create: `/Users/woody/ai/brain/backend/src/routes/__tests__/reports-kpi.test.ts`
- Modify: `/Users/woody/ai/brain/web/src/components/modules/ReportsModule.tsx`
- Modify: `/Users/woody/ai/brain/web/src/components/modules/InboxModule.tsx`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/types.ts`

**Step 1: Write failing KPI test**
- Verify report API returns:
  - `task_completion_rate_pct`
  - `human_override_rate_pct`
  - `cost_per_completed_task_usd`
  - `median_time_to_value_ms`

**Step 2: Run focused test**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/reports-kpi.test.ts`
Expected: FAIL.

**Step 3: Add usage ledger persistence**
- Add table for per-run usage/cost snapshot.
- Persist provider/model tokens and estimated USD cost at completion.

**Step 4: Compute KPI aggregations in reports route**
- Add last-7d and last-30d windows.
- Keep current report payload backward compatible.

**Step 5: Surface KPI cards in frontend**
- Add KPI strip in ReportsModule and Inbox signals.

**Step 6: Verify end to end**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/reports-kpi.test.ts && pnpm test`
Run: `cd /Users/woody/ai/brain/web && npm run lint && npm run build`
Expected: PASS.

**Step 7: Commit**
```bash
git add /Users/woody/ai/brain/backend/db-schema-v1.sql /Users/woody/ai/brain/backend/src/store/postgres-store.ts /Users/woody/ai/brain/backend/src/store/types.ts /Users/woody/ai/brain/backend/src/providers/router.ts /Users/woody/ai/brain/backend/src/routes/reports.ts /Users/woody/ai/brain/backend/src/routes/dashboard.ts /Users/woody/ai/brain/backend/src/routes/__tests__/reports-kpi.test.ts /Users/woody/ai/brain/web/src/components/modules/ReportsModule.tsx /Users/woody/ai/brain/web/src/components/modules/InboxModule.tsx /Users/woody/ai/brain/web/src/lib/api/types.ts

git commit -m "feat: add outcome kpis and usage ledger for agent os operations"
```

## Verification Checklist (Before PR)

- Backend: `cd /Users/woody/ai/brain/backend && pnpm lint && pnpm typecheck && pnpm test`
- Web: `cd /Users/woody/ai/brain/web && npm run lint && npm run build && npm run e2e:smoke`
- API schema sync: `cd /Users/woody/ai/brain/web && npm run api:types:check`

## Deployment Sequence

1. Deploy DB migrations for new mission contract + trace + usage tables.
2. Deploy backend with compatibility defaults enabled.
3. Deploy web UI with feature flags for Mission Control widgets.
4. Enable KPI dashboard for operators after 24h data warm-up.

## Rollback Rules

- If mission creation error rate > 2% for 5 minutes, disable mission-contract-required fields via env flag.
- If trace event write latency adds > 50ms p95, switch trace write mode to async buffered.
- If approval flow blocks > 15% of normal missions unexpectedly, revert to previous risk classifier.
