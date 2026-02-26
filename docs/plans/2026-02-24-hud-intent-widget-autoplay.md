# HUD Intent Widget Autoplay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 메인 HUD에서 사용자가 자연어 요청을 입력하면 요청 의도에 맞는 위젯 세트를 자동으로 열고(Assistant/Workbench/Tasks 포함), Assistant가 즉시 실행을 시작하도록 만든다.

**Architecture:** 프론트엔드 단에서 1차 Intent Router를 구현해 요청을 `intent + widget_plan`으로 변환하고, HUDProvider가 위젯 세트를 원자적으로 오픈/포커스한다. Inbox Quick Command는 intent plan을 생성해 Assistant로 핸드오프 이벤트를 발행하고, Assistant는 이벤트를 수신해 자동 실행한다. 백엔드 변경은 최소화하고 기존 `/api/v1/ai/respond`, `/api/v1/tasks`를 재사용한다.

**Tech Stack:** Next.js App Router, React Context(HUDProvider), EventSource/CustomEvent, Playwright, Vitest(backend existing)

---

### Task 1: Intent Router and HUD Handoff Contract

**Files:**
- Create: `/Users/woody/ai/brain/web/src/lib/hud/intent-router.ts`
- Create: `/Users/woody/ai/brain/web/src/lib/hud/mission-intake.ts`

**Step 1: Write failing check**
Run: `cd /Users/woody/ai/brain/web && test -f src/lib/hud/intent-router.ts`
Expected: missing file

**Step 2: Minimal implementation**
- `inferHudIntent(prompt)` 추가 (`code`, `research`, `finance`, `news`, `general`)
- `buildWidgetPlan(intent)` 추가
  - 기본: `assistant`, `tasks`
  - code/dev/debug/test 계열: `assistant`, `workbench`, `tasks`
  - research/news/finance 계열: `assistant`, `tasks` + `reports`/`council` 보강
- `buildMissionIntake(prompt, source)`로 표준 payload 구성
- `dispatchMissionIntake`, `subscribeMissionIntake` 이벤트 유틸 추가

**Step 3: Verify**
Run: `cd /Users/woody/ai/brain/web && pnpm lint`
Expected: PASS

**Step 4: Commit**
```bash
git add /Users/woody/ai/brain/web/src/lib/hud
git commit -m "feat: add hud intent router and mission intake event contract"
```

### Task 2: HUDProvider Multi-Widget Open API

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/components/providers/HUDProvider.tsx`

**Step 1: Write failing behavior check**
- 현재는 단일 `openWidget`만 있어 위젯 세트 오픈 시 순서/포커스 제어 어려움 확인

**Step 2: Minimal implementation**
- `openWidgets(ids: string[], options?: { focus?: string })` 추가
- 중복 제거 + 기존 열린 위젯 유지 + 신규 위젯 append
- `focus` 지정 시 지정 위젯으로 포커스, 없으면 마지막 위젯 포커스

**Step 3: Verify**
Run: `cd /Users/woody/ai/brain/web && pnpm lint`
Expected: PASS

**Step 4: Commit**
```bash
git add /Users/woody/ai/brain/web/src/components/providers/HUDProvider.tsx
git commit -m "feat: support atomic multi-widget open in hud provider"
```

### Task 3: Inbox Quick Command Auto-Orchestration

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/components/modules/InboxModule.tsx`

**Step 1: Write failing behavior check**
- Quick Command 실행 시 task 생성만 되고 위젯 자동 오픈/Assistant 핸드오프가 없음

**Step 2: Minimal implementation**
- Quick Command에서 `buildMissionIntake` 호출
- `openWidgets(widgetPlan, { focus: "assistant" })` 호출
- `dispatchMissionIntake(payload)` 발행
- Task mode를 intent에 따라 `code|execute`로 매핑
- 기존 task 생성 및 refresh는 유지

**Step 3: Verify**
Run: `cd /Users/woody/ai/brain/web && pnpm lint`
Expected: PASS

**Step 4: Commit**
```bash
git add /Users/woody/ai/brain/web/src/components/modules/InboxModule.tsx
git commit -m "feat: auto-open hud widgets from inbox quick command intent"
```

### Task 4: Assistant Intake Subscription and Auto-Run

**Files:**
- Modify: `/Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx`

**Step 1: Write failing behavior check**
- mission intake 이벤트를 발행해도 Assistant가 자동 실행하지 않음

**Step 2: Minimal implementation**
- `subscribeMissionIntake` 등록
- 이벤트 수신 시 prompt 자동 실행 함수 호출
- 중복 실행 방지(`isRunning` guard)
- 메시지에 `AUTO` 실행 상태 표시

**Step 3: Verify**
Run: `cd /Users/woody/ai/brain/web && pnpm lint && pnpm build`
Expected: PASS

**Step 4: Commit**
```bash
git add /Users/woody/ai/brain/web/src/components/modules/AssistantModule.tsx
git commit -m "feat: let assistant auto-run requests from hud intake events"
```

### Task 5: Playwright Smoke for HUD Auto-Open Flow

**Files:**
- Modify: `/Users/woody/ai/brain/web/e2e/sidebar-studio-navigation.spec.ts`
- Create: `/Users/woody/ai/brain/web/e2e/hud-intake-autoplay.spec.ts`
- Modify: `/Users/woody/ai/brain/web/package.json`

**Step 1: Write failing test**
- 메인 `/`에서 Quick Command 입력 후 `AI ASSISTANT`, `WORKBENCH`, `TASK MANAGER` 위젯이 자동으로 뜨는 스모크 작성

**Step 2: Run failing test**
Run: `cd /Users/woody/ai/brain/web && pnpm e2e e2e/hud-intake-autoplay.spec.ts`
Expected: FAIL (구현 전)

**Step 3: Minimal implementation**
- 필요한 API mock route 구성(`/api/v1/tasks`, `/api/v1/ai/respond`, `/api/v1/providers*`)
- 자동 오픈 및 Assistant 응답 렌더 확인 assertion 추가
- `e2e:smoke`에 신규 스펙 포함

**Step 4: Run passing tests**
Run: `cd /Users/woody/ai/brain/web && pnpm e2e:smoke`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/web/e2e /Users/woody/ai/brain/web/package.json
git commit -m "test: add hud intake autoplay smoke coverage"
```

### Task 6: Full Verification

**Files:**
- Test only

**Step 1: Frontend verification**
Run: `cd /Users/woody/ai/brain/web && pnpm lint && pnpm build && pnpm e2e:smoke`
Expected: PASS

**Step 2: Backend regression verification**
Run: `cd /Users/woody/ai/brain/backend && pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS

**Step 3: Commit (if needed)**
```bash
git add -A
git commit -m "chore: verify hud intent autoplay integration"
```
