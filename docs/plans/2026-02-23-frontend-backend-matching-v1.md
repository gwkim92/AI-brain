# JARVIS Frontend-Backend Matching v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 현재 목업 중심 프론트를 실제 백엔드 API에 연결해, Tasks/Assistant/Approvals/Radar/Upgrades의 end-to-end 실행 흐름을 동작시킨다.

**Architecture:** Next.js(App Router) 프론트에 타입 안전 API 클라이언트 레이어를 추가하고, 페이지/모듈별로 백엔드 v1 엔드포인트에 매핑한다. 문서(OpenAPI/아키텍처)와 실제 Fastify 라우트를 동기화해 계약 드리프트를 제거한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Fastify 5, zod, SSE(EventSource), Vitest

---

### Task 1: API 계약 동기화(문서 vs 구현)

**Files:**
- Modify: `/Users/woody/ai/brain/docs/openapi-v1.yaml`
- Modify: `/Users/woody/ai/brain/docs/backend-architecture-v1.md`
- Test: `/Users/woody/ai/brain/backend/src/routes/index.ts`

**Step 1: 구현 기준 경로 리스트 고정**
- 기준 소스: `/Users/woody/ai/brain/backend/src/routes/index.ts`
- 라우트 표를 문서화한다.

**Step 2: OpenAPI 누락/과잉 정리**
- 누락 추가: `/health`, `/api/v1/providers`, `/api/v1/ai/respond`, `tasks create/list/get`, integrations webhook.
- 과잉 제거 또는 TODO 표시: `/api/v1/upgrades/runs/{run_id}/rollback` (현재 미구현).

**Step 3: 아키텍처 문서 API 섹션 동기화**
- `/Users/woody/ai/brain/docs/backend-architecture-v1.md`의 7.x API 목록을 실제 구현과 맞춘다.

**Step 4: 정합성 확인**
Run: `rg -n "app\\.(get|post)" /Users/woody/ai/brain/backend/src/routes/index.ts`
Expected: OpenAPI/문서 경로와 1:1 매칭 확인 가능

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/docs/openapi-v1.yaml /Users/woody/ai/brain/docs/backend-architecture-v1.md
git commit -m "docs: sync api contract with implemented backend routes"
```

### Task 2: 프론트 API 클라이언트 레이어 구축

**Files:**
- Create: `/Users/woody/ai/brain/web/src/lib/api/client.ts`
- Create: `/Users/woody/ai/brain/web/src/lib/api/types.ts`
- Create: `/Users/woody/ai/brain/web/src/lib/api/endpoints.ts`
- Modify: `/Users/woody/ai/brain/web/.env.example`
- Test: `/Users/woody/ai/brain/web/src/lib/api/client.ts`

**Step 1: 공통 fetch 래퍼 작성**
- `request_id`, 표준 에러(`error.code`, `error.message`)를 파싱하는 공통 함수 작성.

**Step 2: 엔드포인트 함수 정의**
- `getHealth`, `listProviders`, `createTask`, `listTasks`, `getTask`, `streamTaskEvents`,
- `aiRespond`, `ingestRadar`, `listRadarItems`, `evaluateRadar`, `listRecommendations`,
- `listUpgradeProposals`, `approveProposal`, `startUpgradeRun`, `getUpgradeRun`.

**Step 3: 환경변수 연결**
- `NEXT_PUBLIC_BACKEND_BASE_URL`을 추가하고 기본값(`http://127.0.0.1:4000`) 문서화.

**Step 4: 타입 체크/빌드 확인**
Run: `cd /Users/woody/ai/brain/web && npm run build`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/web/src/lib/api /Users/woody/ai/brain/web/.env.example
git commit -m "feat(web): add typed api client layer for backend v1"
```

### Task 3: Tasks 페이지 실데이터 연결

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/app/tasks/page.tsx`
- Create: `/Users/woody/ai/brain/web/src/app/tasks/[taskId]/page.tsx`
- Test: `/Users/woody/ai/brain/web/src/app/tasks/page.tsx`

**Step 1: 목록 API 연결**
- `mockTasks` 제거 후 `GET /api/v1/tasks` 사용.
- loading/error/empty 상태 분기 추가.

**Step 2: 상세 페이지 생성**
- `/tasks/[taskId]` 라우트 추가.
- `GET /api/v1/tasks/:taskId`로 기본 정보 표시.

**Step 3: 이벤트 스트림 연결**
- `GET /api/v1/tasks/:taskId/events` SSE 연결.
- 타임라인에 이벤트 append.

**Step 4: 검증**
Run: `cd /Users/woody/ai/brain/web && npm run lint && npm run build`
Expected: lint error 0, build PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/web/src/app/tasks
git commit -m "feat(web): connect tasks list/detail/event stream to backend"
```

### Task 4: Assistant 모듈 실연동

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx`
- Test: `/Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx`

**Step 1: 모델/공급자 상태 조회 연결**
- `GET /api/v1/providers` 호출 후 상태 배지에 반영.

**Step 2: 메시지 전송 연결**
- `POST /api/v1/ai/respond` 호출.
- 응답 텍스트/attempts/fallback 정보를 실행 패널에 반영.

**Step 3: 오류 처리**
- provider 모두 비활성 시(503) 사용자 가이드 표시.

**Step 4: 검증**
Run: `cd /Users/woody/ai/brain/backend && pnpm vitest src/routes/__tests__/api.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx
git commit -m "feat(web): wire assistant chat to ai/respond and providers api"
```

### Task 5: Approvals 화면을 Upgrades 승인 플로우에 매핑

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/app/approvals/page.tsx`
- Modify: `/Users/woody/ai/brain/web/src/components/ui/ApprovalCard.tsx`
- Test: `/Users/woody/ai/brain/web/src/app/approvals/page.tsx`

**Step 1: 승인 대기 데이터 연결**
- `GET /api/v1/upgrades/proposals?status=proposed`로 카드 구성.

**Step 2: 승인/거절 액션 연결**
- `POST /api/v1/upgrades/proposals/:proposalId/approve` 호출.
- approve/reject 결과를 즉시 반영.

**Step 3: 히스토리 탭 연결**
- 상태별 필터(`approved`, `rejected`, `failed`, `deployed`)로 history 구성.

**Step 4: 검증**
Run: `cd /Users/woody/ai/brain/web && npm run build`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/web/src/app/approvals/page.tsx /Users/woody/ai/brain/web/src/components/ui/ApprovalCard.tsx
git commit -m "feat(web): map approval center to upgrade proposal decision api"
```

### Task 6: Automations/Reports를 Radar+Upgrade 실행 흐름에 연결

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/app/automations/page.tsx`
- Modify: `/Users/woody/ai/brain/web/src/app/reports/page.tsx`
- Test: `/Users/woody/ai/brain/web/src/app/automations/page.tsx`

**Step 1: Radar 실행 버튼 연결**
- `TRIGGER NOW` -> `POST /api/v1/radar/ingest`.

**Step 2: 추천 생성/조회 연결**
- `POST /api/v1/radar/evaluate` + `GET /api/v1/radar/recommendations`.

**Step 3: Telegram 리포트 연결**
- `POST /api/v1/radar/reports/telegram`.

**Step 4: 업그레이드 실행 상태 표시**
- `POST /api/v1/upgrades/runs` + `GET /api/v1/upgrades/runs/:runId`로 리포트 페이지 상태 업데이트.

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/web/src/app/automations/page.tsx /Users/woody/ai/brain/web/src/app/reports/page.tsx
git commit -m "feat(web): connect radar ingest/recommendation and upgrade run reporting"
```

### Task 7: Settings/Onboarding 상태를 실서버 기준으로 전환

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/app/settings/page.tsx`
- Modify: `/Users/woody/ai/brain/web/src/app/onboarding/page.tsx`
- Test: `/Users/woody/ai/brain/web/src/app/settings/page.tsx`

**Step 1: health/providers 기반 시스템 상태 표시**
- `GET /health`, `GET /api/v1/providers`를 카드 상태 소스로 사용.

**Step 2: 비연결/장애 처리 UX**
- API 실패 시 degraded/error 상태와 재시도 CTA 제공.

**Step 3: 초기 진입 게이트 정리**
- Onboarding에서 최소 백엔드 연결 확인 후 홈 이동.

**Step 4: 검증**
Run: `cd /Users/woody/ai/brain/web && npm run lint`
Expected: errors 0

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/web/src/app/settings/page.tsx /Users/woody/ai/brain/web/src/app/onboarding/page.tsx
git commit -m "feat(web): drive onboarding/settings state from backend health and providers"
```

### Task 8: 공통 상태/에러/재시도 UX 표준화

**Files:**
- Create: `/Users/woody/ai/brain/web/src/components/ui/AsyncState.tsx`
- Modify: `/Users/woody/ai/brain/web/src/app/tasks/page.tsx`
- Modify: `/Users/woody/ai/brain/web/src/app/approvals/page.tsx`
- Modify: `/Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx`
- Test: `/Users/woody/ai/brain/web/src/components/ui/AsyncState.tsx`

**Step 1: 재사용 상태 컴포넌트 작성**
- loading/error/empty/retry UI 단일 컴포넌트화.

**Step 2: 주요 화면 적용**
- Tasks, Approvals, Assistant에 공통 적용.

**Step 3: HTTP 오류 코드별 메시지 표준화**
- 401/403/404/409/422/429/5xx 기본 문구 매핑.

**Step 4: 검증**
Run: `cd /Users/woody/ai/brain/web && npm run build`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/web/src/components/ui/AsyncState.tsx /Users/woody/ai/brain/web/src/app/tasks/page.tsx /Users/woody/ai/brain/web/src/app/approvals/page.tsx /Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx
git commit -m "refactor(web): standardize async state and api error handling"
```

### Task 9: 통합 검증 + 운영 체크리스트

**Files:**
- Modify: `/Users/woody/ai/brain/docs/backend-architecture-v1.md`
- Modify: `/Users/woody/ai/brain/docs/openapi-v1.yaml`
- Test: `/Users/woody/ai/brain/web`
- Test: `/Users/woody/ai/brain/backend`

**Step 1: 백엔드 테스트**
Run: `cd /Users/woody/ai/brain/backend && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS

**Step 2: 프론트 검증**
Run: `cd /Users/woody/ai/brain/web && npm run lint && npm run build`
Expected: PASS (lint warning은 별도 backlog 관리)

**Step 3: 수동 e2e 시나리오**
- Tasks 생성 -> 목록 반영 -> 상세 이벤트 스트림 확인
- Assistant 질의 -> 응답/실패 처리 확인
- Proposal 승인 -> Upgrade Run 시작/조회 확인

**Step 4: 체크리스트 문서화**
- 환경변수, 포트, CORS, known issues를 문서에 추가.

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/docs/backend-architecture-v1.md /Users/woody/ai/brain/docs/openapi-v1.yaml
git commit -m "chore: finalize frontend-backend matching v1 verification checklist"
```

---

## Priority and ETA

1. Day 1: Task 1~3 (계약 정리 + API 레이어 + Tasks 연동)
2. Day 2: Task 4~6 (Assistant/Approvals/Automations-Reports 연동)
3. Day 3: Task 7~9 (Settings/Onboarding + 공통 UX + 통합 검증)

## Definition of Done

1. 프론트에서 하드코딩 `mock*` 데이터 제거(핵심 화면 기준).
2. Tasks/Assistant/Approvals/Radar 흐름이 실제 API로 동작.
3. OpenAPI, 아키텍처 문서, 실제 라우트가 서로 모순 없음.
4. `web: lint+build`, `backend: test+typecheck+lint` 통과.
