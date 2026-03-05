# Repo Intake High-Impact Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `docs/repo-intake`에서 재사용 가치가 높은 패턴만 추려, 현재 Brain/JARVIS에 부족한 운영 안정성/보안/실행 제어를 단계적으로 고도화한다.

**Architecture:** 이미 반영된 OAuth/Model Control/Trace 기반 위에, (1) provider health cooldown, (2) background supervisor, (3) notification policy, (4) redaction v2, (5) observability session headers를 얇은 공통 계층으로 추가한다. 외부 레포 코드는 직접 벤더링하지 않고, 패턴만 내부 구현으로 재구성한다.

**Tech Stack:** Fastify, TypeScript, Postgres store, existing provider router/worker/observability modules, Vitest.

---

## Intake 재분류 (중복 제외)

### 이미 반영되어 중복 구현 제외
- `opencode-gemini-auth`, `opencode-google-antigravity-auth`: reason-aware retry + `Retry-After` (기본 구현 반영)
- `opencode-sentry-monitor`: auth/provider trace 기본 계측 반영
- `opencode-vibeguard`: 기본 redaction 훅 반영
- `opencode-background-agents`, `opencode-scheduler`: token refresh worker의 no-overlap/timeout/history 기본 반영

### 이번 고도화 대상 (채택)
1. provider cooldown/health 상태 저장 + 라우팅 반영
2. background supervisor 공통화(토큰 refresh 외 워커까지 확장 가능 구조)
3. notification dedupe/throttle/focus-aware 정책
4. redaction v2(placeholder restore + secure observability)
5. session-level observability headers(helicone/sentry 연계 가능 구조)

### 이번 스코프 아웃
- `subtask2` 코드 직접 사용(라이선스 리스크)
- Antigravity 계정 회전/비공식 endpoint 운영 경로
- `opencode-md-table-formatter`, `octto`, `micode`, `oh-my-opencode`는 별도 UX/문서화 트랙으로 분리

---

### Task 1: Provider Cooldown + Health Routing

**Files:**
- Create: `backend/src/providers/provider-health.ts`
- Modify: `backend/src/providers/router.ts`
- Modify: `backend/src/store/types.ts`
- Modify: `backend/src/store/postgres/initializer.ts`
- Modify: `backend/src/store/postgres/auth-repository.ts`
- Modify: `backend/src/store/memory/auth-repository.ts`
- Test: `backend/src/providers/__tests__/router-cooldown.test.ts`

**Step 1: Write failing tests**
- provider가 429/503으로 실패하면 cooldown 기간 동안 라우팅 순위에서 제외되는 테스트 작성.
- `Retry-After` 헤더가 있으면 해당 ms를 cooldown으로 사용하는 테스트 작성.

**Step 2: Run tests and verify fail**
- Run: `cd backend && pnpm test src/providers/__tests__/router-cooldown.test.ts`
- Expected: FAIL (cooldown 상태 미구현)

**Step 3: Implement minimal health/cooldown state**
- provider별 `cooldown_until`, `reason`, `updated_at` 저장 모델 추가.
- `router.generate()`에서 cooldown active provider를 skip 처리.

**Step 4: Re-run tests**
- Run: `cd backend && pnpm test src/providers/__tests__/router-cooldown.test.ts`
- Expected: PASS

**Step 5: Commit**
- `feat(provider): add persisted cooldown-aware routing health`

---

### Task 2: Background Supervisor Generalization

**Files:**
- Create: `backend/src/workers/supervisor.ts`
- Modify: `backend/src/providers/token-refresh-worker.ts`
- Modify: `backend/src/observability/ai-trace-worker.ts`
- Modify: `backend/src/routes/settings.ts`
- Test: `backend/src/workers/__tests__/supervisor.test.ts`

**Step 1: Write failing tests**
- no-overlap, timeout, run history(cap N) 보장 테스트 작성.

**Step 2: Run tests and verify fail**
- Run: `cd backend && pnpm test src/workers/__tests__/supervisor.test.ts`
- Expected: FAIL (공통 supervisor 없음)

**Step 3: Implement supervisor**
- 공통 실행기(`start/stop/status`)로 worker 실행/감독 통합.
- refresh/trace cleanup worker를 supervisor 어댑터로 전환.

**Step 4: Re-run tests**
- Run: `cd backend && pnpm test src/workers/__tests__/supervisor.test.ts`
- Expected: PASS

**Step 5: Commit**
- `feat(worker): unify worker supervision with no-overlap timeout history`

---

### Task 3: Notification Policy (Dedupe/Throttle/Focus-aware)

**Files:**
- Modify: `backend/src/notifications/proactive.ts`
- Modify: `backend/src/routes/notifications.ts`
- Modify: `web/src/components/providers/HUDProvider.tsx`
- Test: `backend/src/notifications/__tests__/policy.test.ts`

**Step 1: Write failing tests**
- 동일 이벤트 dedupe, burst throttle, focus 상태 silent 정책 테스트 작성.

**Step 2: Run tests and verify fail**
- Run: `cd backend && pnpm test src/notifications/__tests__/policy.test.ts`
- Expected: FAIL

**Step 3: Implement policy layer**
- event key 기반 dedupe 캐시 + 시간창 throttle.
- focus-aware 플래그(클라이언트 상태)로 silent 처리.

**Step 4: Re-run tests**
- Run: `cd backend && pnpm test src/notifications/__tests__/policy.test.ts`
- Expected: PASS

**Step 5: Commit**
- `feat(notification): add dedupe throttle and focus-aware policy`

---

### Task 4: Redaction V2 (Placeholder Restore + Secure Metrics)

**Files:**
- Modify: `backend/src/lib/redaction.ts`
- Modify: `backend/src/providers/router.ts`
- Modify: `backend/src/routes/ai.ts`
- Modify: `backend/src/routes/assistant/run-route.ts`
- Test: `backend/src/lib/__tests__/redaction-v2.test.ts`

**Step 1: Write failing tests**
- outbound redaction 후 tool arg restore가 가능한 placeholder 매핑 테스트 작성.
- 로그/trace에 평문 비밀값이 남지 않는 테스트 작성.

**Step 2: Run tests and verify fail**
- Run: `cd backend && pnpm test src/lib/__tests__/redaction-v2.test.ts`
- Expected: FAIL

**Step 3: Implement redaction v2**
- session 단위 placeholder map 생성/복원.
- observability에는 치환 통계만 기록하고 원문 저장 금지.

**Step 4: Re-run tests**
- Run: `cd backend && pnpm test src/lib/__tests__/redaction-v2.test.ts`
- Expected: PASS

**Step 5: Commit**
- `feat(security): implement redaction v2 with placeholder restore`

---

### Task 5: Session-level Observability Headers

**Files:**
- Create: `backend/src/providers/observability-headers.ts`
- Modify: `backend/src/providers/types.ts`
- Modify: `backend/src/providers/adapters/openai-provider.ts`
- Modify: `backend/src/providers/adapters/gemini-provider.ts`
- Modify: `backend/src/providers/adapters/anthropic-provider.ts`
- Test: `backend/src/providers/__tests__/observability-headers.test.ts`

**Step 1: Write failing tests**
- trace/session 입력 시 provider request header가 일관되게 붙는지 테스트 작성.

**Step 2: Run tests and verify fail**
- Run: `cd backend && pnpm test src/providers/__tests__/observability-headers.test.ts`
- Expected: FAIL

**Step 3: Implement header builder**
- trace/session -> deterministic id 매핑 + sanitize.
- 헤더 주입 실패가 추론 실패를 유발하지 않도록 fail-open 처리.

**Step 4: Re-run tests**
- Run: `cd backend && pnpm test src/providers/__tests__/observability-headers.test.ts`
- Expected: PASS

**Step 5: Commit**
- `feat(observability): add session-level provider headers`

---

## Rollout

1. Feature flags
- `PROVIDER_HEALTH_COOLDOWN_ENABLED`
- `WORKER_SUPERVISOR_ENABLED`
- `NOTIFICATION_POLICY_ENABLED`
- `REDACTION_V2_ENABLED`
- `PROVIDER_OBSERVABILITY_HEADERS_ENABLED`

2. Canary
- 내부 사용자 3일, 실패 시 feature flag 즉시 off

3. Metrics
- provider_call_failover_rate
- cooldown_skip_count
- notification_drop_count(dedupe/throttle)
- redaction_placeholder_unresolved_count
- trace_header_attach_success_rate

---

## Verification Gate

1. 신규 테스트 통과 + 기존 `backend` 테스트 회귀 없음
2. 사용자 A/B 동시 호출 cross-talk 0건
3. 운영 로그에 토큰/비밀값 평문 노출 0건
4. worker hang/no-overlap 위반 0건

