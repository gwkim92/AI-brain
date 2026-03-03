# JARVIS System Quality Stabilization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stabilize JARVIS end-to-end UX and grounded-answer quality so users consistently get correct session behavior, understandable outputs, and reproducible operational outcomes.

**Architecture:** Keep existing backend/web architecture, but close high-impact gaps in configuration consistency, session state semantics, grounded response contract, and CI/observability. Prioritize user-visible reliability before deeper refactors.

**Tech Stack:** Fastify, TypeScript, PostgreSQL, Next.js App Router, SSE, Vitest, Playwright, OpenAPI.

---

## Priority Backlog (Execution Order)

1. Runtime configuration consistency and auth UX hardening
2. Session semantics and workspace restoration correctness
3. Assistant surface split (user answer vs debug internals)
4. Grounded output contract hardening and quality gate explainability
5. CI and contract/test safety net for backend + frontend
6. Large module decomposition for maintainability

---

### Task 1: Runtime Config Consistency + Auth UX Hardening

**Files:**
- Modify: `/Users/woody/ai/brain/docker-compose.yml`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/client.ts`
- Modify: `/Users/woody/ai/brain/web/src/app/login/page.tsx`
- Modify: `/Users/woody/ai/brain/backend/src/routes/settings.ts`
- Modify: `/Users/woody/ai/brain/backend/src/config/env.ts`

**Step 1: Fix backend base URL env mismatch in container runtime**
- Align compose env key with frontend runtime expectation (`NEXT_PUBLIC_BACKEND_BASE_URL`).

**Step 2: Add explicit settings flags for auth bootstrap mode**
- Expose `auth_token_configured` and `auth_allow_signup` in `/settings/overview`.

**Step 3: Conditional render static token mode in login UI**
- Show static-token login only when backend indicates token auth is configured.
- Improve error copy for invalid credentials vs invalid static token.

**Step 4: Enforce production-safe defaults**
- Add runtime guard for weak default secrets/bootstrap credentials in production mode.

**Step 5: Verify**
Run: 
- `cd /Users/woody/ai/brain/backend && pnpm test src/routes/__tests__/api.test.ts -t "auth"`
- `cd /Users/woody/ai/brain/web && npm run lint && npm run build`

**Step 6: Commit**
```bash
git add /Users/woody/ai/brain/docker-compose.yml /Users/woody/ai/brain/web/src/lib/api/client.ts /Users/woody/ai/brain/web/src/app/login/page.tsx /Users/woody/ai/brain/backend/src/routes/settings.ts /Users/woody/ai/brain/backend/src/config/env.ts
git commit -m "fix: align runtime api config and harden login auth UX"
```

---

### Task 2: Session Semantics + Workspace Restoration Correctness

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/hooks/useQuickCommand.ts`
- Modify: `/Users/woody/ai/brain/web/src/components/providers/HUDProvider.tsx`
- Modify: `/Users/woody/ai/brain/web/src/lib/hud/session.ts`
- Modify: `/Users/woody/ai/brain/web/src/components/layout/RightPanel.tsx`
- Create: `/Users/woody/ai/brain/web/e2e/session-restore.spec.ts`

**Step 1: Save both "active" and "workspace snapshot" explicitly**
- Persist `restoreMode` and `lastWorkspacePreset` metadata in session model.

**Step 2: Change session restore behavior**
- Clicking a session restores its last visible workspace (mounted + focus), not only one focused widget.

**Step 3: Add per-session restore action controls in RightPanel**
- Quick actions: `restore full`, `focus only`.

**Step 4: Prevent auto-cleanup from discarding session-critical widgets too early**
- Tie cleanup to session archival, not inactivity timer alone.

**Step 5: Verify with Playwright**
Run:
- `cd /Users/woody/ai/brain/web && npm run e2e -- e2e/session-restore.spec.ts`

**Step 6: Commit**
```bash
git add /Users/woody/ai/brain/web/src/hooks/useQuickCommand.ts /Users/woody/ai/brain/web/src/components/providers/HUDProvider.tsx /Users/woody/ai/brain/web/src/lib/hud/session.ts /Users/woody/ai/brain/web/src/components/layout/RightPanel.tsx /Users/woody/ai/brain/web/e2e/session-restore.spec.ts
git commit -m "fix: restore full session workspace deterministically"
```

---

### Task 3: Assistant Surface Split (User vs Debug)

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx`
- Modify: `/Users/woody/ai/brain/web/src/components/ui/EvidencePanel.tsx`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/types.ts`

**Step 1: Define explicit render modes**
- `user_mode`: final answer + concise citations + feedback.
- `debug_mode`: attempts/events/gate metrics.

**Step 2: Keep quality-gate diagnostics out of default user mode**
- Show actionable copy + retry suggestions in user mode.

**Step 3: Add dedicated feedback fields**
- Separate `answer_quality` and `source_quality` signals.

**Step 4: Verify**
Run:
- `cd /Users/woody/ai/brain/web && npm run lint && npm run build`

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx /Users/woody/ai/brain/web/src/components/ui/EvidencePanel.tsx /Users/woody/ai/brain/web/src/lib/api/types.ts
git commit -m "feat: separate user answer surface from debug diagnostics"
```

---

### Task 4: Grounded Output Contract Hardening

**Files:**
- Modify: `/Users/woody/ai/brain/backend/src/routes/assistant.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/ai.ts`
- Modify: `/Users/woody/ai/brain/backend/src/retrieval/news-briefing.ts`
- Modify: `/Users/woody/ai/brain/backend/src/retrieval/quality-gate.ts`
- Modify: `/Users/woody/ai/brain/backend/src/retrieval/retrieval-quality-gate.ts`
- Modify: `/Users/woody/ai/brain/backend/src/routes/__tests__/api.test.ts`

**Step 1: Introduce strict response contract metadata**
- Include `render_mode`, `source_count`, `domain_count`, `freshness_ratio`, `quality_gate_code[]`.

**Step 2: Gate reason taxonomy cleanup**
- Normalize reason codes for UI-level interpretation.

**Step 3: Add deterministic fallback trace tag**
- Mark when summary was generated from non-structured fallback path.

**Step 4: Verify**
Run:
- `cd /Users/woody/ai/brain/backend && pnpm test src/retrieval/__tests__/news-briefing.test.ts src/retrieval/__tests__/quality-gate.test.ts src/routes/__tests__/api.test.ts`

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/routes/assistant.ts /Users/woody/ai/brain/backend/src/routes/ai.ts /Users/woody/ai/brain/backend/src/retrieval/news-briefing.ts /Users/woody/ai/brain/backend/src/retrieval/quality-gate.ts /Users/woody/ai/brain/backend/src/retrieval/retrieval-quality-gate.ts /Users/woody/ai/brain/backend/src/routes/__tests__/api.test.ts
git commit -m "feat: harden grounded output contract and gate reason taxonomy"
```

---

### Task 5: CI Safety Net Expansion

**Files:**
- Modify: `/Users/woody/ai/brain/.github/workflows/web-api-contract.yml`
- Create: `/Users/woody/ai/brain/.github/workflows/backend-quality.yml`

**Step 1: Add backend quality workflow**
- `pnpm -C backend typecheck`
- `pnpm -C backend test`
- `pnpm -C backend lint`

**Step 2: Strengthen web workflow trigger scope**
- Include backend OpenAPI-affecting route changes where relevant.

**Step 3: Verify workflow locally where possible**
- Run matching commands manually.

**Step 4: Commit**
```bash
git add /Users/woody/ai/brain/.github/workflows/web-api-contract.yml /Users/woody/ai/brain/.github/workflows/backend-quality.yml
git commit -m "ci: add backend quality checks and tighten contract gates"
```

---

### Task 6: Large Module Decomposition (Maintainability)

**Files:**
- Modify: `/Users/woody/ai/brain/backend/src/routes/assistant.ts`
- Create: `/Users/woody/ai/brain/backend/src/routes/assistant/` modules
- Modify: `/Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx`
- Create: `/Users/woody/ai/brain/web/src/components/modules/assistant/` modules
- Modify: `/Users/woody/ai/brain/backend/src/store/postgres-store.ts`
- Create: `/Users/woody/ai/brain/backend/src/store/postgres/` repositories

**Step 1: Extract pure helper/service layers first**
- No behavior change commits first.

**Step 2: Split by responsibility**
- assistant: create/run/events/feedback streams
- postgres store: auth/tasks/missions/assistant_context/radar sections

**Step 3: Add narrow unit tests on extracted modules**
- Prevent regression during split.

**Step 4: Verify full suite**
Run:
- `cd /Users/woody/ai/brain/backend && pnpm test`
- `cd /Users/woody/ai/brain/web && npm run lint && npm run build`

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/routes/assistant.ts /Users/woody/ai/brain/backend/src/routes/assistant /Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx /Users/woody/ai/brain/web/src/components/modules/assistant /Users/woody/ai/brain/backend/src/store/postgres-store.ts /Users/woody/ai/brain/backend/src/store/postgres
git commit -m "refactor: decompose assistant and store monolith modules"
```

---

## Release Checkpoints

1. User flow checkpoint: login -> command -> session restore -> answer feedback passes e2e.
2. Grounding checkpoint: quality gate reason surfaced consistently in API and UI.
3. Ops checkpoint: CI blocks schema/contract drift and backend regression before merge.

## Success Metrics

1. Session restore defect reports: 80% reduction.
2. Grounded response blocked-without-explanation incidents: near zero.
3. Login/token confusion incidents: 70% reduction.
4. PR regression catch rate in CI: increase via backend checks.
