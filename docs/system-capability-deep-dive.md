# JARVIS User-Capability Deep Dive (Code-Verified)

Last updated: 2026-03-04 (KST)  
Scope: `/backend`, `/web` current implementation

---

## 0. Executive Summary (User View)

### Q1. "커맨드에 뭐를 입력하든 알아서 맞는 위젯으로 가나?"
- **Partial (부분 자동화)**.
- Intent/complexity 분류가 있지만, **LLM semantic parser가 아니라 규칙/휴리스틱 기반**이라 오분류 가능성 있음.
- 분류되면 해당 워크스페이스(위젯 조합)로 자동 전환하고 실행 시작.

### Q2. "인터넷 검색 엔진 있나?"
- **Yes, but narrow (제한적 있음)**.
- 범용 검색엔진이 아니라 **뉴스/근거 수집용 RSS 기반 웹 증거 수집**.
- Google News RSS + 일부 curated RSS를 결합해 grounding evidence를 만듦.

### Q3. "Agent team 있나?"
- **Yes, but simulated/mapped 형태**.
- Council UI는 planner/researcher/critic/risk/synthesizer 팀 형태.
- 백엔드 구현은 라운드별 provider routing 결과를 역할에 매핑하는 구조이며, 완전 독립 멀티에이전트 병렬 토론 엔진은 아님.

### Q4. "코드 어시스턴스 있나?"
- **Yes**.
- 코드 의도 입력 시 Code Workspace(Workbench 중심)로 이동, execution run 호출로 결과 생성.
- 다만 IDE-level 자동 편집/테스트/커밋 파이프라인까지 내장된 형태는 아님.

### Q5. "금융 분석 있나?"
- **Yes (분석/브리핑 중심)**.
- Finance/News 의도는 Intelligence Workspace로 라우팅되고, radar/recommendation/report 파이프라인 존재.
- 실거래/브로커 주문/포트폴리오 체결 자동화는 현재 코드에서 확인되지 않음.

---

## 1. Command Understanding & Widget Routing

### What exists
- Quick Command 입력은 `intent` + `complexity`를 계산:
  - Intent: `code/research/finance/news/general`
  - Complexity: `simple/moderate/complex`
- `simple`: 즉시 Task + Assistant Context 실행
- `moderate|complex`: mission plan 생성(`generate-plan`, `auto_create=true`)
- 결과에 따라 HUD 위젯 세트를 자동 오픈

### How it works
1. Prompt hash/duplicate window로 중복 입력 억제
2. Intent 추정(키워드 기반)
3. Complexity 추정(문장수/단계 표현/도메인 혼합도)
4. Workspace preset 선택(`mission`, `studio_code`, `studio_research`, `studio_intelligence`)
5. 위젯 오픈 + 세션 연결 + Task/Mission 생성

### Coverage
- 코드 요청: `Workbench + Assistant + Tasks`
- 리서치 요청: `Council + Assistant + Tasks`
- 금융/뉴스 요청: `Reports + Assistant + Tasks`
- 일반/복합 요청: `Mission`

### Limits
- Intent/Complexity가 규칙 기반이므로:
  - 애매한 문장/도메인 혼합/신조어에 오분류 가능
  - "아무 입력이나 완벽 이해"는 아님

---

## 2. Internet Search / Grounding

### What exists
- Grounding policy가 `dynamic_factual`/`high_risk_factual`이면 증거 수집 수행
- `retrieveWebEvidence`가 외부 RSS 소스에서 evidence pack 생성
- 품질 게이트(검색 품질 + 근거 인용 품질)로 응답 차단/완화

### Data sources currently wired
- Google News RSS search/top feeds
- Curated feeds (BBC, NYT, Al Jazeera, YNA)

### What users get
- 근거/출처 포함 응답
- 뉴스 브리핑 전용 구조화 후처리(팩트 추출/도메인 커버리지 보정)
- 품질이 낮으면 blocked 또는 soft warn

### Limits
- 범용 웹 검색(임의 사이트 크롤링/인덱스 기반 검색)은 아님
- 실시간 시장 데이터 API(가격/체결/호가 등) 연결은 코드에서 직접 확인되지 않음
- 뉴스/사실성 중심의 grounding에 최적화

---

## 3. Agent Team (Council + Mission)

### What exists
- Council Run:
  - 라운드 반복 실행
  - provider fallback/제외(`exclude_providers`) 지원
  - SSE로 라운드 이벤트 스트리밍
- Mission Run:
  - DAG 실행기(`runDag`)로 step dependency + 최대 동시성 실행
  - step 유형: `llm_generate`, `council_debate`, `human_gate`, `tool_call`, `sub_mission`

### Reality check
- Council은 팀 역할 UI를 제공하지만,
  - 내부적으로는 provider router 결과를 role에 매핑하는 형태
  - 완전 독립 agent 프로세스들이 병렬 토론하는 구조와는 다름
- Mission은 진짜 DAG 실행/동시성 제어(`maxConcurrency`)가 존재

### Limits
- 사람 승인 단계(`human_gate`)는 blocked 상태 반환 중심
- 진짜 외부 툴 실행 오케스트레이션은 제한적(LLM 프롬프트 기반 tool_call 해석)

---

## 4. Code Assistance

### What exists
- 코드 의도 입력 시 Code Workspace로 자동 라우팅
- Workbench에서 `execution run (mode=code|compute)` 실행
- Provider router가 코드 관련 prompt에 대해 provider 가중치/부스트 적용

### What users can do
- 코드 생성/수정 방향 제시
- 계산/실행형 응답 받기
- task/run 상태 추적

### Limits
- 백엔드 execution은 "LLM generation result" 중심
- 로컬 저장소 직접 변경/테스트/커밋을 자동으로 수행하는 통합 CI형 엔진은 아님

---

## 5. Finance / News Intelligence

### What exists
- Finance/News intent -> `studio_intelligence` 프리셋
- Radar pipeline:
  - ingest -> evaluate -> recommendation
  - Telegram digest 생성/재시도/상태 SSE
- Reports/overview로 운영 지표 확인

### What users can do
- 금융/뉴스성 요청 분류 후 관련 위젯에서 분석
- 레이더 추천(채택/보류/폐기) 확인
- 요약 리포트 텔레그램 전달

### Limits
- 투자 주문 실행/계좌 연동/브로커 API 체결은 현재 범위 밖
- 분석/브리핑/추천 중심

---

## 6. Capability Verdict Table

| Capability | Status | Notes |
|---|---|---|
| 자유 입력 자동 이해 + 최적 위젯 라우팅 | **Partial** | 규칙 기반 분류, 오분류 가능 |
| 인터넷 검색 엔진 | **Partial** | 뉴스/RSS 기반 grounding 검색 |
| 에이전트 팀 | **Partial** | Council 팀 UX + 라운드 실행, 완전 독립 병렬팀은 아님 |
| 코드 어시스턴스 | **Yes** | 코드 워크스페이스 + execution run |
| 금융 분석 | **Yes (analysis-focused)** | 인텔리전스 + 레이더 + 리포트, 실거래는 없음 |
| 승인/고위험 통제 | **Yes** | role + approval gate + 고위험 권한 제어 |

---

## 7. Follow-up Deep Dive Backlog (Recommended)

1. Intent/complexity 오분류 케이스 수집 + 테스트셋화
2. Council "실제 멀티에이전트" 강화 여부 결정(현재 매핑형 구조 대체)
3. Web grounding을 RSS 중심에서 일반 검색 어댑터로 확장할지 결정
4. Code assistance를 "실행 가능 자동화(테스트/패치/검증)"까지 확장할지 결정
5. Finance domain에 실시간 데이터 소스/포트폴리오 모델 추가 여부 결정

---

## 8. Assistant Reference Rule (for future responses)

앞으로 기능 문의에 답할 때는 반드시 아래 포맷을 사용:
1. **지원 여부**: Yes / Partial / No
2. **현재 구현 범위**: 사용자 관점 1~2줄
3. **제약/미구현**: 과장 없이 1~2줄
4. **근거 경로**: 관련 코드 파일 명시

This file is the baseline reference for future capability reporting.
