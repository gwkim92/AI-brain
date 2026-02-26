# Jarvis Studio + Mission + Control Plane Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 기존 HUD 단일 구조를 유지한 채, 도메인별 Studio 화면을 분리하고 Mission Runtime/Control Plane 경계를 코드로 확립한다.

**Architecture:** 프론트는 `studio/*`와 `mission` 라우트를 신설하고, 백엔드는 `missions` API를 추가해 기존 `ai/council/execution` 엔진을 단계적으로 어댑트한다. 보안/승인/결제/정책은 Control Plane API로 분리하고, 고위험 실행은 `simulate -> approve -> execute` 흐름을 강제한다.

**Tech Stack:** Next.js App Router, Fastify, TypeScript, PostgreSQL, Zod, SSE, Vitest

---

### Task 1: Studio and Mission Routes Skeleton (Frontend)

**Files:**
- Create: `/Users/woody/ai/brain/web/src/app/studio/code/page.tsx`
- Create: `/Users/woody/ai/brain/web/src/app/studio/research/page.tsx`
- Create: `/Users/woody/ai/brain/web/src/app/studio/finance/page.tsx`
- Create: `/Users/woody/ai/brain/web/src/app/studio/news/page.tsx`
- Create: `/Users/woody/ai/brain/web/src/app/mission/page.tsx`
- Create: `/Users/woody/ai/brain/web/src/components/studio/StudioSurface.tsx`

**Step 1: Write failing check**
Run: `cd /Users/woody/ai/brain/web && test -f src/app/studio/code/page.tsx`
Expected: missing file

**Step 2: Minimal implementation**
- Studio 공통 Surface 컴포넌트 작성
- 도메인별 페이지 생성(코드/리서치/금융/뉴스)
- Mission 페이지 생성

**Step 3: Verify**
Run: `cd /Users/woody/ai/brain/web && pnpm lint && pnpm build`
Expected: PASS

**Step 4: Commit**
```bash
git add /Users/woody/ai/brain/web/src/app/studio /Users/woody/ai/brain/web/src/app/mission /Users/woody/ai/brain/web/src/components/studio
git commit -m "feat: add studio and mission route skeleton"
```

### Task 2: Sidebar Navigation Refactor

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/components/layout/Sidebar.tsx`

**Step 1: Write failing behavior check**
- 수동 확인: Studio/Mission으로 이동 가능한 메뉴 없음

**Step 2: Minimal implementation**
- 기존 HUD widget 토글은 유지
- Studio/Mission direct link 섹션 추가

**Step 3: Verify**
Run: `cd /Users/woody/ai/brain/web && pnpm lint && pnpm build`
Expected: PASS

**Step 4: Commit**
```bash
git add /Users/woody/ai/brain/web/src/components/layout/Sidebar.tsx
git commit -m "feat: add studio and mission navigation links"
```

### Task 3: Mission API Contract (Backend)

**Files:**
- Modify: `/Users/woody/ai/brain/backend/src/routes/index.ts`
- Modify: `/Users/woody/ai/brain/docs/openapi-v1.yaml`
- Create: `/Users/woody/ai/brain/backend/src/routes/__tests__/missions.test.ts`

**Step 1: Write failing test**
- `POST /api/v1/missions` 요청 시 404/미구현 확인

**Step 2: Run test (failing)**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/missions.test.ts`
Expected: FAIL

**Step 3: Minimal implementation**
- `POST /api/v1/missions`
- `GET /api/v1/missions/:missionId`
- 임시 in-memory/store adapter로 데이터 저장

**Step 4: Run test (passing)**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/missions.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/routes /Users/woody/ai/brain/docs/openapi-v1.yaml
git commit -m "feat: introduce mission api contract"
```

### Task 4: Mission Data Model in Store Layer

**Files:**
- Modify: `/Users/woody/ai/brain/backend/src/store/types.ts`
- Modify: `/Users/woody/ai/brain/backend/src/store/postgres-store.ts`
- Modify: `/Users/woody/ai/brain/docs/db-schema-v1.sql`
- Create: `/Users/woody/ai/brain/backend/src/store/__tests__/missions-store.test.ts`

**Step 1: Write failing test**
- mission create/get/list 저장 테스트 작성

**Step 2: Run failing test**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/store/__tests__/missions-store.test.ts`
Expected: FAIL

**Step 3: Minimal implementation**
- `missions`, `mission_steps` schema 추가
- postgres store CRUD 추가

**Step 4: Run passing test**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/store/__tests__/missions-store.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/store /Users/woody/ai/brain/docs/db-schema-v1.sql
git commit -m "feat: add mission persistence model"
```

### Task 5: Auto Model Selection Score Breakdown

**Files:**
- Modify: `/Users/woody/ai/brain/backend/src/providers/router.ts`
- Modify: `/Users/woody/ai/brain/backend/src/providers/types.ts`
- Modify: `/Users/woody/ai/brain/backend/src/providers/__tests__/router.test.ts`

**Step 1: Write failing test**
- 선택 결과에 score breakdown 필드가 없는 상태를 재현

**Step 2: Run failing test**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/providers/__tests__/router.test.ts`
Expected: FAIL

**Step 3: Minimal implementation**
- score breakdown(`domain_fit`, `latency`, `cost`, `reliability`, `context_fit`) 응답 포함

**Step 4: Run passing test**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/providers/__tests__/router.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/providers
git commit -m "feat: expose score breakdown for auto provider selection"
```

### Task 6: Council Round Event Expansion

**Files:**
- Modify: `/Users/woody/ai/brain/backend/src/routes/index.ts`
- Modify: `/Users/woody/ai/brain/backend/src/store/types.ts`
- Modify: `/Users/woody/ai/brain/docs/openapi-v1.yaml`

**Step 1: Write failing test**
- SSE가 run status 변화만 전달하고 round 이벤트를 전달하지 않는 케이스 작성

**Step 2: Run failing test**
Run: `cd /Users/woody/ai/brain/backend && pnpm test`
Expected: FAIL (target test)

**Step 3: Minimal implementation**
- `council.round.started`, `council.round.completed`, `council.agent.responded` 이벤트 모델 추가

**Step 4: Verify**
Run: `cd /Users/woody/ai/brain/backend && pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/routes /Users/woody/ai/brain/backend/src/store /Users/woody/ai/brain/docs/openapi-v1.yaml
git commit -m "feat: add council round-level streaming events"
```

### Task 7: Control Plane Hardening (Approval Callback)

**Files:**
- Modify: `/Users/woody/ai/brain/backend/src/routes/index.ts`
- Modify: `/Users/woody/ai/brain/backend/src/integrations/telegram/commands.ts`
- Create: `/Users/woody/ai/brain/backend/src/integrations/telegram/__tests__/callback-security.test.ts`

**Step 1: Write failing security tests**
- 만료된 토큰, 재사용 nonce, 서명 누락 시 reject 테스트

**Step 2: Run failing test**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/integrations/telegram/__tests__/callback-security.test.ts`
Expected: FAIL

**Step 3: Minimal implementation**
- callback payload nonce + expires_at + signature 검증 도입
- idempotency replay 방지 저장

**Step 4: Verify**
Run: `cd /Users/woody/ai/brain/backend && pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/routes /Users/woody/ai/brain/backend/src/integrations/telegram
git commit -m "feat: harden telegram approval callback verification"
```

### Task 8: Mission to Studio Deep-Link Flow

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/app/mission/page.tsx`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/types.ts`
- Modify: `/Users/woody/ai/brain/web/src/lib/api/endpoints.ts`

**Step 1: Write failing behavior check**
- mission step type이 `code`일 때 `/studio/code` deep-link 이동이 안 되는 상태 확인

**Step 2: Minimal implementation**
- mission step card에 `Open Studio` action 구현
- step type에 따라 route mapping 적용

**Step 3: Verify**
Run: `cd /Users/woody/ai/brain/web && pnpm lint && pnpm build`
Expected: PASS

**Step 4: Commit**
```bash
git add /Users/woody/ai/brain/web/src/app/mission /Users/woody/ai/brain/web/src/lib/api
git commit -m "feat: add mission step to studio deep-link routing"
```

### Task 9: Verification and Regression Check

**Files:**
- Test only

**Step 1: Backend full verification**
Run: `cd /Users/woody/ai/brain/backend && pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS

**Step 2: Frontend full verification**
Run: `cd /Users/woody/ai/brain/web && pnpm lint && pnpm build`
Expected: PASS

**Step 3: Manual smoke**
- `/login`, `/signup`, `/`, `/studio/code`, `/mission`, `/settings`
- provider key 등록/테스트
- mission 생성 및 step deep-link 확인

**Step 4: Commit (if needed)**
```bash
git add -A
git commit -m "chore: verify studio mission control refactor baseline"
```

---

## Rollout Notes

1. 기존 HUD 경로는 삭제하지 않는다.
2. 신규 Studio/Mission 경로를 먼저 열고, 점진 전환한다.
3. mission API가 안정화되면 기존 단일 호출 API를 내부 어댑터로 축소한다.

