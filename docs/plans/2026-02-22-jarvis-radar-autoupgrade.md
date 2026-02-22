# JARVIS Radar + Auto-Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 병렬 작업, 컨텍스트/메모리 최적화, 최신 스택 레이더, Telegram 보고, 사용자 명령 기반 자동 개선 파이프라인을 백엔드에 구현한다.

**Architecture:** 기존 `BFF + Orchestrator` 구조에 `Context Compiler`, `Tech Radar Service`, `Upgrade Planner/Executor`를 추가한다. 모든 실행은 이벤트 기반으로 추적하고, 위험한 변경은 승인 명령(`작업 시작`) 이후에만 진행한다.

**Tech Stack:** Next.js Route Handlers, Fastify, OpenAI Responses/Conversations/Evals, MCP+A2A, Temporal(or BullMQ), PostgreSQL18+pgvector, Valkey(or Redis), OpenTelemetry, Telegram Bot API, zod

---

### Task 1: API 계약 및 스키마 고정

**Files:**
- Create: `/Users/woody/ai/brain/docs/openapi-v1.yaml`
- Modify: `/Users/woody/ai/brain/docs/backend-architecture-v1.md`
- Test: `/Users/woody/ai/brain/docs/backend-architecture-v1.md`

**Step 1: OpenAPI에 신규 자원 추가**
- `radar`, `upgrades`, `events` 경로를 명시한다.

**Step 2: 요청/응답 스키마 추가**
- `RadarItem`, `RadarRecommendation`, `UpgradeProposal`, `UpgradeRun`, `TelegramReport` 스키마를 추가한다.

**Step 3: 오류 포맷 통일**
- 모든 엔드포인트에서 `request_id` + 표준 `error` 객체를 사용한다.

**Step 4: 문서 정합성 확인**
- 아키텍처 문서와 OpenAPI 경로가 1:1 매칭되는지 확인한다.

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/docs/openapi-v1.yaml /Users/woody/ai/brain/docs/backend-architecture-v1.md
git commit -m "docs: add v1 api contract for radar and upgrade orchestration"
```

### Task 2: DB 스키마 및 인덱스 정의

**Files:**
- Create: `/Users/woody/ai/brain/docs/db-schema-v1.sql`
- Modify: `/Users/woody/ai/brain/docs/backend-architecture-v1.md`
- Test: `/Users/woody/ai/brain/docs/db-schema-v1.sql`

**Step 1: 신규 테이블 생성**
- `tech_radar_items`, `tech_radar_scores`, `upgrade_proposals`, `upgrade_runs`, `context_snapshots`, `memory_segments`, `telegram_reports`

**Step 2: 인덱스/제약 추가**
- `idempotency_key`, `trace_id`, `published_at`, `status`, `created_at` 인덱스를 추가한다.

**Step 3: 무결성 제약 추가**
- FK, unique, check constraint를 추가한다.

**Step 4: 마이그레이션 순서 문서화**
- 생성/백필/인덱스/검증 순서로 문서화한다.

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/docs/db-schema-v1.sql /Users/woody/ai/brain/docs/backend-architecture-v1.md
git commit -m "docs: define db schema for context, radar, and upgrade runs"
```

### Task 3: Context Compiler 구현

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/context/compiler.ts`
- Create: `/Users/woody/ai/brain/backend/src/context/policies.ts`
- Create: `/Users/woody/ai/brain/backend/src/context/__tests__/compiler.test.ts`
- Test: `/Users/woody/ai/brain/backend/src/context/__tests__/compiler.test.ts`

**Step 1: failing test 작성**
- `chat/council/code/compute` 별 토큰 예산 계산이 다르게 나오는지 테스트한다.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/context/__tests__/compiler.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- 요약 전략 + 우선순위(근거/최근성/신뢰도) 기반 선택기 구현.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/context/__tests__/compiler.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/context
git commit -m "feat: add context compiler with task-specific policies"
```

### Task 4: 병렬 DAG 실행기 구현

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/orchestrator/dag-runner.ts`
- Create: `/Users/woody/ai/brain/backend/src/orchestrator/__tests__/dag-runner.test.ts`
- Modify: `/Users/woody/ai/brain/backend/src/orchestrator/service.ts`
- Test: `/Users/woody/ai/brain/backend/src/orchestrator/__tests__/dag-runner.test.ts`

**Step 1: failing test 작성**
- 독립 스텝 3개가 순차가 아니라 병렬로 실행되는지 검증.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/orchestrator/__tests__/dag-runner.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- 위상정렬 + worker pool 기반 실행기 구현.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/orchestrator/__tests__/dag-runner.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/orchestrator
git commit -m "feat: add parallel dag runner for orchestrator"
```

### Task 5: Tech Radar 수집/평가 파이프라인 구현

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/radar/ingest.ts`
- Create: `/Users/woody/ai/brain/backend/src/radar/scoring.ts`
- Create: `/Users/woody/ai/brain/backend/src/radar/__tests__/scoring.test.ts`
- Test: `/Users/woody/ai/brain/backend/src/radar/__tests__/scoring.test.ts`

**Step 1: failing test 작성**
- 점수 규칙(효익/리스크/비용)이 기대값을 반환하는지 테스트.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/radar/__tests__/scoring.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- 수집 결과 정규화 + 점수 계산 + 추천(도입/보류/폐기) 생성.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/radar/__tests__/scoring.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/radar
git commit -m "feat: add tech radar ingest and scoring pipeline"
```

### Task 6: Telegram 리포터 + 명령 파서 구현

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/integrations/telegram/reporter.ts`
- Create: `/Users/woody/ai/brain/backend/src/integrations/telegram/commands.ts`
- Create: `/Users/woody/ai/brain/backend/src/integrations/telegram/__tests__/commands.test.ts`
- Test: `/Users/woody/ai/brain/backend/src/integrations/telegram/__tests__/commands.test.ts`

**Step 1: failing test 작성**
- `작업 시작` 명령이 승인된 proposal만 실행으로 전환되는지 검증.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/integrations/telegram/__tests__/commands.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- `status digest`, `proposal summary`, `start command` 처리 구현.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/integrations/telegram/__tests__/commands.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/integrations/telegram
git commit -m "feat: add telegram reporting and start-command parser"
```

### Task 7: Upgrade Planner/Executor 구현

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/upgrades/planner.ts`
- Create: `/Users/woody/ai/brain/backend/src/upgrades/executor.ts`
- Create: `/Users/woody/ai/brain/backend/src/upgrades/__tests__/executor.test.ts`
- Test: `/Users/woody/ai/brain/backend/src/upgrades/__tests__/executor.test.ts`

**Step 1: failing test 작성**
- 승인 없이 실행 요청 시 거부되고 audit이 남는지 테스트.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/upgrades/__tests__/executor.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- `proposed -> approved -> running -> verifying -> deployed/rolled_back` 구현.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/upgrades/__tests__/executor.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/upgrades
git commit -m "feat: add approval-gated upgrade executor"
```

### Task 8: 관측/평가 지표 연결

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/observability/metrics.ts`
- Create: `/Users/woody/ai/brain/backend/src/observability/__tests__/metrics.test.ts`
- Modify: `/Users/woody/ai/brain/docs/backend-architecture-v1.md`
- Test: `/Users/woody/ai/brain/backend/src/observability/__tests__/metrics.test.ts`

**Step 1: failing test 작성**
- 병렬 효율, 토큰 절감, radar 보고 누락률 계산 정확성 검증.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/observability/__tests__/metrics.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- SLO 지표 계산기 + 이벤트 매핑 구현.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/observability/__tests__/metrics.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/observability /Users/woody/ai/brain/docs/backend-architecture-v1.md
git commit -m "feat: add metrics model for parallelism and radar operations"
```

### Task 9: 1차 종합 검증

**Files:**
- Test: `/Users/woody/ai/brain/backend`

**Step 1: 단위 테스트 실행**
Run: `pnpm vitest`
Expected: All tests PASS

**Step 2: 타입 체크**
Run: `pnpm tsc --noEmit`
Expected: PASS

**Step 3: 린트**
Run: `pnpm eslint .`
Expected: PASS

**Step 4: 통합 시나리오 검증**
- 시나리오: radar digest 생성 -> telegram 보고 -> `작업 시작` -> upgrade run -> 결과 보고

**Step 5: Commit**
```bash
git add .
git commit -m "chore: finalize jarvis radar and auto-upgrade v1"
```

### Task 10: Responses 수명주기 최적화 (Compact + Webhook)

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/integrations/openai/responses-client.ts`
- Create: `/Users/woody/ai/brain/backend/src/integrations/openai/webhook-handler.ts`
- Create: `/Users/woody/ai/brain/backend/src/integrations/openai/__tests__/responses-client.test.ts`
- Create: `/Users/woody/ai/brain/backend/src/integrations/openai/__tests__/webhook-handler.test.ts`
- Modify: `/Users/woody/ai/brain/backend/src/context/compiler.ts`
- Test: `/Users/woody/ai/brain/backend/src/integrations/openai/__tests__/responses-client.test.ts`

**Step 1: failing test 작성**
- 장기 세션에서 `responses/compact` 호출 조건(토큰 임계치)이 충족되면 compact 요청이 발생하는지 테스트한다.
- webhook 서명 실패 요청이 거부되는지 테스트한다.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/integrations/openai/__tests__/responses-client.test.ts /Users/woody/ai/brain/backend/src/integrations/openai/__tests__/webhook-handler.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- `background=true` 작업의 상태 폴링 + webhook 완료 처리 경로를 구현한다.
- 컨텍스트 임계치 초과 시 compact를 호출하고, compact 전후 토큰/비용 메트릭을 기록한다.
- webhook 서명 검증을 강제한다.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/integrations/openai/__tests__/responses-client.test.ts /Users/woody/ai/brain/backend/src/integrations/openai/__tests__/webhook-handler.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/integrations/openai /Users/woody/ai/brain/backend/src/context/compiler.ts
git commit -m "feat: add responses compact policy and signed webhook handling"
```

### Task 11: Eval Gate + Prompt Optimizer 검증 파이프라인

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/evals/gate.ts`
- Create: `/Users/woody/ai/brain/backend/src/evals/datasets/core-regression.json`
- Create: `/Users/woody/ai/brain/backend/src/evals/__tests__/gate.test.ts`
- Modify: `/Users/woody/ai/brain/backend/src/upgrades/executor.ts`
- Test: `/Users/woody/ai/brain/backend/src/evals/__tests__/gate.test.ts`

**Step 1: failing test 작성**
- `upgrade run` 전 eval score가 기준치 미달이면 배포가 차단되는지 테스트한다.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/evals/__tests__/gate.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- OpenAI Evals/trace grader 결과를 가져와 임계치(정확도/안전성/비용)를 계산한다.
- Prompt Optimizer 결과를 후보 patch와 함께 저장하고, 비교 리포트를 생성한다.
- 기준 미달 시 상태를 `verifying -> rejected`로 전환한다.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/evals/__tests__/gate.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/evals /Users/woody/ai/brain/backend/src/upgrades/executor.ts
git commit -m "feat: add eval gate and prompt-optimizer report to upgrade flow"
```

### Task 12: MCP/A2A 표준 적합성 + 보안 게이트

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/protocol/mcp-transport.ts`
- Create: `/Users/woody/ai/brain/backend/src/protocol/a2a-client.ts`
- Create: `/Users/woody/ai/brain/backend/src/protocol/__tests__/mcp-transport.test.ts`
- Create: `/Users/woody/ai/brain/backend/src/protocol/__tests__/a2a-client.test.ts`
- Create: `/Users/woody/ai/brain/backend/scripts/protocol-conformance.sh`
- Test: `/Users/woody/ai/brain/backend/src/protocol/__tests__/mcp-transport.test.ts`

**Step 1: failing test 작성**
- MCP 요청에서 허용되지 않은 `Origin`이 들어오면 차단되는지 테스트한다.
- A2A 클라이언트가 protocol version 협상 실패를 오류로 처리하는지 테스트한다.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/protocol/__tests__/mcp-transport.test.ts /Users/woody/ai/brain/backend/src/protocol/__tests__/a2a-client.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- MCP Streamable HTTP transport 기본 구현 + `Origin` 검증을 추가한다.
- A2A client capability/version handshake를 구현한다.
- conformance 스크립트에서 MCP/A2A smoke + TCK 실행 단계를 정의한다.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/protocol/__tests__/mcp-transport.test.ts /Users/woody/ai/brain/backend/src/protocol/__tests__/a2a-client.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/protocol /Users/woody/ai/brain/backend/scripts/protocol-conformance.sh
git commit -m "feat: add mcp streamable-http guardrails and a2a compatibility checks"
```

### Task 13: 운영 패치/런타임 정책 자동화

**Files:**
- Create: `/Users/woody/ai/brain/backend/src/radar/ops-policy.ts`
- Create: `/Users/woody/ai/brain/backend/src/radar/__tests__/ops-policy.test.ts`
- Modify: `/Users/woody/ai/brain/backend/src/radar/ingest.ts`
- Modify: `/Users/woody/ai/brain/docs/backend-architecture-v1.md`
- Test: `/Users/woody/ai/brain/backend/src/radar/__tests__/ops-policy.test.ts`

**Step 1: failing test 작성**
- PostgreSQL/Node/Valkey 버전 상태가 정책 기준을 벗어나면 `upgrade_proposals`가 자동 생성되는지 테스트한다.

**Step 2: 테스트 실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/radar/__tests__/ops-policy.test.ts`
Expected: FAIL

**Step 3: 최소 구현**
- Node LTS, PostgreSQL minor/out-of-cycle, Valkey patch 릴리스 정보를 정책 규칙으로 정규화한다.
- 위험 수준(critical/high/medium)에 따라 Telegram 긴급 보고를 생성한다.

**Step 4: 테스트 재실행**
Run: `pnpm vitest /Users/woody/ai/brain/backend/src/radar/__tests__/ops-policy.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add /Users/woody/ai/brain/backend/src/radar /Users/woody/ai/brain/docs/backend-architecture-v1.md
git commit -m "feat: add runtime and patch governance automation for radar"
```

### Task 14: 최종 종합 검증 (2026-02 확장판)

**Files:**
- Test: `/Users/woody/ai/brain/backend`

**Step 1: 전체 단위 테스트 실행**
Run: `pnpm vitest`
Expected: All tests PASS

**Step 2: 타입 체크**
Run: `pnpm tsc --noEmit`
Expected: PASS

**Step 3: 린트**
Run: `pnpm eslint .`
Expected: PASS

**Step 4: 확장 통합 시나리오 검증**
- 시나리오 A: long-run 요청 -> background 처리 -> webhook 완료 수신 -> compact 호출
- 시나리오 B: radar digest -> patch 제안 -> eval gate 통과 -> `작업 시작` -> 배포/롤백 판단
- 시나리오 C: MCP/A2A conformance 스모크 + 보안 게이트(`Origin`, 버전 협상) 검증

**Step 5: Commit**
```bash
git add .
git commit -m "chore: finalize jarvis backend plan with 2026-02 stack upgrades"
```
