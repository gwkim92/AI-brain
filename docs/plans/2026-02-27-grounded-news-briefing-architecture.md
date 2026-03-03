# Grounded News Briefing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 최신 뉴스 요청을 "모델 단독 생성"이 아닌 "검색 근거 기반 생성"으로 전환해, 신뢰 가능한 브리핑과 출처 검증 UX를 기본값으로 제공한다.

**Architecture:** 기존 `assistant context`/`task` 파이프라인은 유지하되, `radar_review + news intent` 경로에 `News Retrieval Layer`를 삽입한다. Retrieval은 실시간 검색 provider(OpenAI web search / Anthropic web search / Gemini grounding / Perplexity Search API 등)로 수행하고, 생성 모델은 retrieval 결과만 요약하도록 강제한다. 답변은 항상 claim-source 매핑 및 freshness 메타데이터와 함께 저장/표시하며, 품질 게이트 미통과 시 fail-fast 한다.

**Tech Stack:** Fastify(backend routes), Postgres(memory/postgres store), Next.js(assistant/reports/tasks widgets), SSE(stream events), existing provider router.

---

## 0. External Baseline (Research Summary)

### 0-1. 산업 공통 패턴
- LLM 자체를 최신성 소스로 취급하지 않고 웹검색/그라운딩 도구를 별도 계층으로 둔다.
- 최종 답변과 별도로 출처 목록(citation metadata)을 응답 계약에 포함한다.
- recency/domain 제약을 요청 단위로 설정한다.
- 품질 미달 시 graceful degradation이 아니라 fail-fast+이유 노출을 택한다.

### 0-2. 근거 문서
- OpenAI Responses API는 `include`를 통해 `web_search_call.action.sources`를 반환할 수 있음.
- Anthropic web search tool은 citations와 domain allow/block, max uses 제약을 제공.
- Gemini grounding은 `groundingMetadata`를 통해 문장-근거 연결 제공.
- Perplexity Search API는 raw search results(제목/URL/날짜/업데이트 시각) 반환, recency/domain 필터 제공.
- Bing Grounding(Foundry)은 grounding tool을 별도 도구로 붙이는 패턴을 제시.

---

## 1. Target Product Contract

### 1-1. 사용자 기대 동작
- 사용자: "최신 뉴스 브리핑해줘"
- 시스템:
  1) 검색 계층에서 최근 기사 N개 수집
  2) 중복/낚시/저신뢰 소스 필터
  3) 생성 모델이 "수집 근거 범위 안에서만" 요약
  4) 본문 하단에 출처, 수집 시각, 기사 발행시각, freshness 상태 노출
  5) 기준 미달이면 브리핑 차단 + 구체 사유 + 재시도 가이드

### 1-2. 품질 게이트(정량)
- 최소 출처 수: 3
- 상위 출처 다양성: 도메인 2개 이상
- 최신성: `published_at <= now - 48h` 비중 30% 초과 시 경고/차단
- 인용 커버리지: 답변 주요 bullet의 80% 이상이 source id를 가짐
- 언어/템플릿 오염 검출: 기존 token artifact detector 유지 + 강화

---

## 2. Data Model (Postgres + Store)

### 2-1. 신규 테이블

**Files:**
- Modify: `backend/db-schema-v1.sql`
- Modify: `backend/src/store/types.ts`
- Modify: `backend/src/store/postgres-store.ts`
- Modify: `backend/src/store/memory-store.ts`

#### A) `news_briefing_runs`
- 목적: 브리핑 요청 단위 실행 메타
- 주요 컬럼:
  - `id UUID PK`
  - `assistant_context_id UUID FK assistant_contexts(id)`
  - `task_id UUID FK tasks(id)`
  - `query TEXT NOT NULL`
  - `intent TEXT NOT NULL DEFAULT 'news'`
  - `retrieval_provider TEXT NOT NULL`
  - `generation_provider TEXT NULL`
  - `status TEXT CHECK (queued|retrieving|grounded|blocked|completed|failed)`
  - `quality_gate JSONB NOT NULL DEFAULT '{}'`
  - `error_code TEXT NULL`
  - `error_message TEXT NULL`
  - `created_at/updated_at`

#### B) `news_sources`
- 목적: 기사 단위 원천 저장/중복제거
- 주요 컬럼:
  - `id UUID PK`
  - `run_id UUID FK news_briefing_runs(id) ON DELETE CASCADE`
  - `source_provider TEXT NOT NULL`
  - `title TEXT NOT NULL`
  - `url TEXT NOT NULL`
  - `publisher TEXT NULL`
  - `snippet TEXT NULL`
  - `published_at TIMESTAMPTZ NULL`
  - `retrieved_at TIMESTAMPTZ NOT NULL`
  - `relevance_score NUMERIC(6,4) NULL`
  - `dedupe_hash TEXT NOT NULL`
  - `raw JSONB NOT NULL DEFAULT '{}'`
  - `UNIQUE(run_id, dedupe_hash)`

#### C) `news_claim_citations`
- 목적: 답변 claim ↔ source 매핑 저장
- 주요 컬럼:
  - `id UUID PK`
  - `run_id UUID FK news_briefing_runs(id) ON DELETE CASCADE`
  - `claim_text TEXT NOT NULL`
  - `source_id UUID FK news_sources(id) ON DELETE CASCADE`
  - `confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5`
  - `position INTEGER NOT NULL`

### 2-2. 인덱스
- `idx_news_runs_context_created_at (assistant_context_id, created_at desc)`
- `idx_news_sources_run_published_at (run_id, published_at desc)`
- `idx_news_sources_url (url)`
- `idx_news_claims_run_position (run_id, position)`

---

## 3. API Contract

### 3-1. Retrieval + Briefing 실행

**Files:**
- Modify: `backend/src/routes/assistant.ts`
- Modify: `backend/src/routes/types.ts`
- Modify: `backend/src/routes/index.ts`
- Modify: `docs/openapi-v1.yaml`
- Modify: `web/src/lib/api/types.ts`
- Modify: `web/src/lib/api/endpoints.ts`

#### Route: `POST /api/v1/assistant/contexts/:contextId/run`
- 기존 유지 + `news` 경로 확장
- 동작:
  - `task_type=radar_review` && `intent/news prompt`이면
    1) retrieval adapter 호출
    2) source normalization
    3) quality gate 평가
    4) pass 시 generation 호출
    5) fail 시 `status=failed/blocked` + structured error

#### 추가 응답/이벤트 필드
- `assistant.context.run.started` data:
  - `retrieval_provider`, `retrieval_count`, `freshness_window_hours`
- `assistant.context.run.completed` data:
  - `sources_count`, `source_domains`, `quality_gate_passed`, `quality_gate_reason`
- `assistant.context.run.failed/rejected` data:
  - `reason`, `retrieval_error?`, `quality_gate_snapshot`

### 3-2. News Evidence 조회 API

#### A) `GET /api/v1/assistant/contexts/:contextId/news-evidence`
- response:
  - `run` metadata
  - `sources[]`
  - `claims[]`(claim_text + source refs)
  - `freshness_summary`

#### B) `GET /api/v1/news/runs/:runId`
- 운영/디버그용 상세 조회

---

## 4. Retrieval Provider Abstraction

### 4-1. 인터페이스

**Files:**
- Create: `backend/src/news/types.ts`
- Create: `backend/src/news/retrieval-router.ts`
- Create: `backend/src/news/providers/openai-web-search.ts`
- Create: `backend/src/news/providers/anthropic-web-search.ts`
- Create: `backend/src/news/providers/gemini-grounding.ts`
- Create: `backend/src/news/providers/perplexity-search.ts`

```ts
export type NewsSearchRequest = {
  query: string;
  recencyHours: number;
  maxResults: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
};

export type NewsSearchResult = {
  provider: string;
  items: Array<{
    title: string;
    url: string;
    publisher?: string;
    snippet?: string;
    publishedAt?: string;
    retrievedAt: string;
    score?: number;
    raw?: unknown;
  }>;
};
```

### 4-2. 라우팅 정책
- 기본: 외부 검색 provider 우선 (configured+healthy)
- 실패 시: 차순위 검색 provider fallback
- 모두 실패: fail-fast (`NEWS_RETRIEVAL_UNAVAILABLE`)
- 로컬 LLM은 retrieval provider가 아님. generation-only fallback으로만 허용.

---

## 5. Prompting & Synthesis Policy

### 5-1. 생성 프롬프트 강제 규칙

**Files:**
- Modify: `backend/src/context/pipeline.ts` (if needed)
- Create: `backend/src/news/synthesis.ts`

- 모델 입력에 source bundle만 전달 (원문 URL + snippet + published_at)
- 지시문:
  - source 없는 주장 금지
  - 불확실한 내용은 `확인 불가`로 표기
  - 날짜/시간은 절대값(YYYY-MM-DD)으로 명시
  - 출력 스키마(JSON or markdown template) 강제

### 5-2. 출력 스키마
- `summary_headlines[]`
- `market/politics/tech` 섹션(선택)
- `watchlist`
- `sources[]` (title, publisher, published_at, url)
- `limitations`

---

## 6. UI/UX Plan (Assistant + Reports)

### 6-1. Assistant 기본뷰

**Files:**
- Modify: `web/src/components/modules/AssistantModule.tsx`
- Modify: `web/src/components/ui/EvidencePanel.tsx`
- Modify: `web/src/lib/api/types.ts`

- 본문 아래 `Sources` 섹션 항상 노출 (debug mode와 무관)
- source 카드: 제목, 도메인, 발행시각, 수집시각, 외부링크
- `freshness badge`: `LIVE`, `MIXED`, `STALE`
- `quality blocked`일 때 이유/해결 버튼(Providers 이동)

### 6-2. Feedback UX
- 기존 GOOD/BAD 유지 + source quality 분리 질문 추가:
  - "출처가 신뢰 가능했나요?"
- feedback 이벤트 타입 분리:
  - `assistant.context.user_feedback.answer_quality`
  - `assistant.context.user_feedback.source_quality`

### 6-3. Session UX
- 세션 카드에 `news` intent badge + `sources_count`/`freshness` 요약 표시
- 세션 재진입 시 뉴스 evidence 위젯(또는 assistant evidence 탭) 즉시 복원

---

## 7. Quality Gate Service

### 7-1. 구현

**Files:**
- Create: `backend/src/news/quality-gate.ts`
- Modify: `backend/src/routes/assistant.ts`

```ts
export type NewsQualityGateInput = {
  sources: NewsSource[];
  claims?: ClaimCitation[];
  now: string;
};

export type NewsQualityGateResult = {
  passed: boolean;
  score: number;
  reasons: string[];
  snapshot: Record<string, unknown>;
};
```

### 7-2. 차단 코드 표준화
- `NEWS_RETRIEVAL_UNAVAILABLE`
- `NEWS_SOURCE_INSUFFICIENT`
- `NEWS_SOURCE_STALE`
- `NEWS_CITATION_INSUFFICIENT`
- `NEWS_SYNTHESIS_ARTIFACT`

---

## 8. Security/Abuse Controls

### 8-1. SSRF/URL 안전성

**Files:**
- Create: `backend/src/news/url-guard.ts`
- Modify: `backend/src/routes/assistant.ts`

- internal/private IP 차단
- localhost/link-local 차단
- allowed/blocked domain policy

### 8-2. Prompt Injection 방어
- source snippet sanitize
- model instruction에 source isolation 규칙 주입
- raw HTML/JS 제거 후 전달

---

## 9. Testing Strategy (TDD)

### Task 1: 품질 게이트 단위 테스트

**Files:**
- Create: `backend/src/news/__tests__/quality-gate.test.ts`
- Create: `backend/src/news/quality-gate.ts`

**Step 1: Write the failing test**
- 출처 1개/오래된 기사만 있을 때 fail 기대
- 출처 3개/최신성 충족 시 pass 기대

**Step 2: Run test to verify it fails**
- Run: `pnpm -C backend test -- quality-gate.test.ts`
- Expected: FAIL (module not found)

**Step 3: Write minimal implementation**
- source count + freshness 계산만으로 pass/fail 구현

**Step 4: Run test to verify it passes**
- Run: `pnpm -C backend test -- quality-gate.test.ts`
- Expected: PASS

**Step 5: Commit**
```bash
git add backend/src/news/quality-gate.ts backend/src/news/__tests__/quality-gate.test.ts
git commit -m "feat(news): add quality gate baseline"
```

### Task 2: Retrieval router 단위 테스트

**Files:**
- Create: `backend/src/news/__tests__/retrieval-router.test.ts`
- Create: `backend/src/news/retrieval-router.ts`

**Step 1: Write the failing test**
- 1순위 provider 실패 시 2순위 fallback 검증

**Step 2: Run test to verify it fails**
- Run: `pnpm -C backend test -- retrieval-router.test.ts`
- Expected: FAIL

**Step 3: Write minimal implementation**
- provider list 순회 + 실패 누적 + 성공 즉시 반환

**Step 4: Run test to verify it passes**
- Run: `pnpm -C backend test -- retrieval-router.test.ts`
- Expected: PASS

**Step 5: Commit**
```bash
git add backend/src/news/retrieval-router.ts backend/src/news/__tests__/retrieval-router.test.ts
git commit -m "feat(news): add retrieval fallback router"
```

### Task 3: Assistant route 통합 테스트

**Files:**
- Modify: `backend/src/routes/__tests__/api.test.ts`
- Modify: `backend/src/routes/assistant.ts`

**Step 1: Write the failing test**
- 뉴스 요청 시 retrieval 성공 + evidence 필드 포함 완료 이벤트 검증

**Step 2: Run test to verify it fails**
- Run: `pnpm -C backend test -- api.test.ts -t "news evidence"`
- Expected: FAIL

**Step 3: Write minimal implementation**
- assistant news 분기에서 retrieval->gate->synthesis 연결

**Step 4: Run test to verify it passes**
- Run: `pnpm -C backend test -- api.test.ts -t "news evidence"`
- Expected: PASS

**Step 5: Commit**
```bash
git add backend/src/routes/assistant.ts backend/src/routes/__tests__/api.test.ts
git commit -m "feat(assistant): add grounded news pipeline"
```

### Task 4: OpenAPI + Web 타입 동기화

**Files:**
- Modify: `docs/openapi-v1.yaml`
- Modify: `web/src/lib/api/generated/openapi.ts`
- Modify: `web/src/lib/api/types.ts`
- Modify: `web/src/lib/api/endpoints.ts`

**Step 1: Write the failing test**
- 타입 체크 실패를 기준으로 스키마 미반영 확인

**Step 2: Run test to verify it fails**
- Run: `pnpm -C web exec tsc --noEmit`
- Expected: FAIL (new response fields missing)

**Step 3: Write minimal implementation**
- API 스키마/endpoint/types 반영

**Step 4: Run test to verify it passes**
- Run: `pnpm -C web exec tsc --noEmit`
- Expected: PASS

**Step 5: Commit**
```bash
git add docs/openapi-v1.yaml web/src/lib/api/types.ts web/src/lib/api/endpoints.ts web/src/lib/api/generated/openapi.ts
git commit -m "feat(api): expose news evidence contract"
```

### Task 5: Assistant UI evidence 표시

**Files:**
- Modify: `web/src/components/modules/AssistantModule.tsx`
- Modify: `web/src/components/ui/EvidencePanel.tsx`
- Modify: `web/src/components/layout/RightPanel.tsx`

**Step 1: Write the failing test**
- e2e: 뉴스 응답 후 sources 섹션 visible 기대

**Step 2: Run test to verify it fails**
- Run: `pnpm -C web e2e --grep "news sources"`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 응답 카드 아래 sources/freshness 렌더링

**Step 4: Run test to verify it passes**
- Run: `pnpm -C web e2e --grep "news sources"`
- Expected: PASS

**Step 5: Commit**
```bash
git add web/src/components/modules/AssistantModule.tsx web/src/components/ui/EvidencePanel.tsx web/e2e/*.spec.ts
git commit -m "feat(web): render grounded news evidence in assistant"
```

---

## 10. Rollout Plan

### Phase A (1주)
- retrieval abstraction + quality gate + blocked UX
- risk: provider key 미설정 환경에서 차단률 증가

### Phase B (1주)
- evidence API + assistant sources UI + feedback 분리
- risk: UI 복잡도 증가

### Phase C (1주)
- ranking 개선(도메인 신뢰도, duplicate cluster) + metrics
- risk: 성능/비용 최적화 필요

---

## 11. Metrics / SLO
- News briefing success rate (`completed` / total news requests)
- Quality gate block rate (reason별)
- Citation coverage ratio
- Median retrieval latency / synthesis latency
- User feedback ratio (GOOD/BAD + source_quality)

---

## 12. Definition of Done
- 뉴스 응답의 95% 이상에서 source metadata 제공
- quality gate 기준 미달 시 hallucinated summary 0%
- 세션 재진입 시 동일 evidence 복원
- OpenAPI/TS 타입/테스트 모두 green

---

## 13. References
- OpenAI Responses API reference (include: `web_search_call.action.sources`)
- OpenAI Tools - Web Search guide
- Anthropic Web Search Tool documentation
- Gemini Grounding with Google Search documentation
- Perplexity Search API docs + changelog
- Microsoft Foundry Bing Grounding tool docs
