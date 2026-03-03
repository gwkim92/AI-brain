# Grounded Web Search Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 최신성/사실성 의존 질의(뉴스, 주가, 날씨, 정책변경, 버전 릴리즈 등)에 대해 LLM 단독 응답을 금지하고, 검색 근거 기반 응답을 기본 동작으로 전환한다.

**Architecture:** 기존 `assistant context -> provider router -> output` 흐름 앞단에 `Query Policy Router`와 `Grounded Retrieval Pipeline`을 삽입한다. 검색/근거 수집은 독립 계층으로 분리하고, 생성은 근거 번들만 입력받아 수행한다. 품질 게이트 미통과 시 답변 생성을 차단하고 구조화된 실패 사유를 반환한다.

**Tech Stack:** Fastify, Postgres, SSE, Next.js, 기존 Provider Router + 신규 Search/Ranking/Grounding 모듈.

---

## 1. 문제 정의

현재 구조는 Provider 라우팅 중심이며, 최신성 보장이 필요한 질문에서도 모델이 가진 내부 지식 또는 비결정적 검색 도구 결과에 의존한다. 이로 인해 다음 문제가 반복된다.

1. 최신 뉴스/시계열 질의에서 신뢰도 불량 응답 발생
2. 출처/근거와 본문 문장 연결이 약함
3. UI에서 실행 내부 위젯과 사용자 답변 UI가 혼합되어 혼란 발생
4. 실패 원인이 사용자/운영자에게 명확히 전달되지 않음

핵심 원인은 "검색엔진 계층"과 "생성 계층"의 분리가 없기 때문이다.

## 2. 목표 범위 (뉴스 한정 아님)

### 2-1. 적용 대상 질의

`dynamic_factual` 유형 전체를 대상화한다.

1. 뉴스/속보/브리핑
2. 금융 시세/경제 지표
3. 날씨/스포츠 일정/결과
4. 법·정책 변경/공시
5. 라이브 제품 정보(버전, 가격, 릴리즈)

### 2-2. 비대상 (초기)

1. 창작/카피라이팅
2. 사내 메모리만으로 해결 가능한 내부 질의
3. 고정 지식 설명(수학/개념/역사 기초)

## 3. 설계 원칙

1. 검색 계층과 생성 계층 분리
2. 근거 없는 문장 금지(grounded-only generation)
3. 실패를 숨기지 않고 구조화해 반환
4. 사용자 모드와 디버그 모드 UI 분리
5. 관측성(trace_id)과 재현성(query/evidence snapshot) 기본 탑재

## 4. 타깃 시스템 아키텍처

## 4-1. Query Policy Router

입력 프롬프트를 아래 세 가지로 분류한다.

1. `static`: 일반 LLM 응답 허용
2. `dynamic_factual`: 검색+근거 필수
3. `high_risk_factual`: 검색+근거+강화 게이트 필수

분류 신호:
- 최신성 키워드(최신, 오늘, 방금, 현재, 실시간)
- 시계열 엔티티(가격, 점수, 일정, 공시, 정책)
- 사용자의 명시적 근거 요구(출처, 링크, 근거)

## 4-2. Grounded Retrieval Pipeline

1. Query Normalize/Rewrites
- 엔티티 추출, 기간 추론, 동의어 확장, 언어/지역 정규화

2. Retrieval Adapter
- 단기: 외부 검색 백엔드 어댑터(구축 비용/속도 균형)
- 중기: 자체 수집/인덱스 계층 병행

3. Result Cleaner
- canonical URL 정규화
- 중복 기사 병합
- 저품질/스팸/유사 mirror 필터

4. Ranker
- relevance + freshness + source trust + diversity 점수
- 동일 도메인 과집중 패널티

5. Grounding Pack Builder
- 답변에 필요한 근거 패시지 묶음 생성
- source id, url, published_at, retrieved_at, snippet 포함

## 4-3. Answer Composer

생성 모델 입력은 Grounding Pack만 허용한다.

규칙:
1. 근거 없는 주장 문장 생성 금지
2. 시간 표현은 절대 날짜(YYYY-MM-DD) 우선
3. 불확실하면 "확인 불가" 명시
4. 각 섹션에 citation 목록 연결

## 4-4. Quality Gate (2단)

1. Pre-Generation Gate
- source_count >= 3
- unique_domains >= 2
- freshness ratio 임계치 충족
- retrieval error 없음

2. Post-Generation Gate
- claim-citation coverage >= 0.8
- 금지 패턴/템플릿 토큰 없음
- 출처가 본문 주장과 불일치하지 않음

미통과 시 `blocked` 상태로 종료하고 사유 코드를 반환한다.

## 4-5. Observability

요청 단위로 아래를 저장한다.

1. query_original/query_rewritten
2. retrieval provider별 결과와 latency
3. 최종 evidence bundle 스냅샷
4. gate 판정 및 reason codes
5. 최종 답변/피드백(정답품질 vs 출처품질 분리)

## 5. 데이터 계약

## 5-1. 공통 Retrieval Result

```json
{
  "query": "latest major news briefing",
  "rewritten_queries": ["..."],
  "items": [
    {
      "source_id": "src_...",
      "title": "...",
      "url": "https://...",
      "domain": "...",
      "published_at": "2026-02-27T10:00:00Z",
      "retrieved_at": "2026-02-27T10:02:10Z",
      "snippet": "...",
      "scores": {
        "relevance": 0.91,
        "freshness": 0.88,
        "trust": 0.73,
        "diversity": 0.62,
        "final": 0.84
      }
    }
  ]
}
```

## 5-2. Grounded Answer Envelope

```json
{
  "status": "completed|blocked|failed",
  "answer": "...",
  "citations": [
    {
      "claim_idx": 1,
      "source_ids": ["src_1", "src_4"]
    }
  ],
  "sources": [
    {
      "source_id": "src_1",
      "title": "...",
      "url": "https://...",
      "published_at": "..."
    }
  ],
  "quality_gate": {
    "passed": true,
    "reasons": []
  }
}
```

## 6. 코드베이스 적용 설계

## 6-1. Backend

기존 파일 확장:

1. `backend/src/routes/assistant.ts`
- run 진입 시 Policy Router 호출
- `dynamic_factual/high_risk_factual`면 Retrieval Pipeline 경유

2. `backend/src/providers/types.ts`
- 생성 provider와 retrieval provider 역할 분리 타입 추가

3. `backend/src/evals/gate.ts`
- 일반 eval gate + grounded quality gate 분리

4. `backend/src/store/postgres-store.ts`
- retrieval run, source, citation, gate_result 저장 스키마 추가

신규 모듈:

1. `backend/src/retrieval/policy-router.ts`
2. `backend/src/retrieval/query-rewrite.ts`
3. `backend/src/retrieval/adapter-router.ts`
4. `backend/src/retrieval/ranker.ts`
5. `backend/src/retrieval/grounding.ts`
6. `backend/src/retrieval/quality-gate.ts`

## 6-2. Frontend

1. `web/src/components/modules/AssistantModule.tsx`
- 기본 모드: 답변+출처+피드백
- 디버그 모드: run sections/evidence timeline 분리 노출

2. `web/src/components/ui/EvidencePanel.tsx`
- source card(도메인/발행시각/수집시각/링크)
- freshness badge(`LIVE/MIXED/STALE`)

3. `web/src/lib/api/types.ts`, `web/src/lib/api/endpoints.ts`
- grounded answer envelope 타입 반영

4. 세션 UX
- 세션 클릭 시 "새 입력창"이 아니라 해당 세션의 마지막 grounded 결과 복원

## 7. UX 정책 (필수)

1. 사용자 기본 화면에서 내부 디버그 위젯 숨김
2. 응답 하단에 출처 목록 항상 표시
3. 피드백은 2축으로 분리
- `answer_quality` (도움됨/안됨)
- `source_quality` (출처 신뢰 가능/불가)
4. blocked 상태는 인간이 이해 가능한 사유+조치 버튼 제공

## 8. 실패/예외 설계

주요 오류코드:

1. `RETRIEVAL_UNAVAILABLE`
2. `INSUFFICIENT_EVIDENCE`
3. `QUALITY_GATE_FAILED`
4. `GENERATION_FAILED`

반환 규칙:
- `blocked`: 근거 부족/품질 미달 (재시도 가능)
- `failed`: 시스템/네트워크 실패

## 9. 보안/정책

1. 도메인 allow/deny 정책 지원
2. robots/약관 준수 수집 정책 분리
3. 악성 링크 차단 필터
4. 고위험 도메인(의료/금융)에서 강한 gate 적용

## 10. 단계별 실행 로드맵

### Phase 1 (1주): 정책 라우팅 + 근거 계약

1. Query Policy Router 도입
2. Grounded Answer Envelope 계약 확정
3. UI 기본/디버그 모드 분리

완료 기준:
- dynamic 질의가 반드시 retrieval path로 이동
- 답변이 sources 없이 반환되지 않음

### Phase 2 (1~2주): Retrieval Pipeline v1

1. query rewrite + adapter router + ranker
2. pre/post quality gate
3. evidence 저장/복원

완료 기준:
- 뉴스/주가/날씨/스포츠 질의에서 출처 포함 응답률 95%+

### Phase 3 (2주): 신뢰도 강화

1. source trust scoring
2. dedup 강화
3. 피드백 기반 랭킹 보정

완료 기준:
- hallucination-related bad feedback 비율 50% 이상 감소

### Phase 4 (지속): 자체 인덱스 확장

1. 도메인별 크롤러/파서 도입
2. BM25 + 벡터 하이브리드 서빙
3. 외부 검색 의존도 단계적 축소

## 11. 운영 KPI

1. grounded coverage rate
2. citation coverage rate
3. freshness SLA pass rate
4. blocked rate(reason별)
5. user feedback bad rate(answer/source 분리)
6. p95 latency / request cost

## 12. 의사결정 요약

1. 뉴스 전용 예외처리가 아니라 dynamic factual 전체를 동일 정책으로 처리한다.
2. "모델 잘 고르기"보다 "근거 파이프라인"을 우선 구축한다.
3. 사용자 경험은 기본적으로 간결한 답변+출처, 디버그 정보는 분리한다.
4. 실패는 숨기지 않고 구조화해 제품 신뢰도를 높인다.
