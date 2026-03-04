# JARVIS Next Strategy (2026-03-04)

작성일: 2026-03-04  
목표: "어떤 일이든 처리 가능한 JARVIS"를 위한 실전 고도화 설계  
기준: 현재 코드베이스(`/backend`, `/web`) + 2026-03-04 시점 공개 최신 제품 패턴

---

## A. 방향성 선언 (Vision, but executable)

JARVIS를 "만능 AGI UX"로 만들려면, 모델 성능 하나보다 **시스템 설계**가 더 중요하다.

핵심은 4가지다.
1. **정확한 의도 이해**: 커맨드 입력을 목표/제약/리스크/산출물로 구조화
2. **신뢰 가능한 사실 수집**: 검색/근거/검증 파이프라인 강화
3. **동적 에이전트 오케스트레이션**: 요청마다 팀을 자동 구성하고 실행 추적
4. **행동 가능한 인터페이스**: 계획, 실행, 증거, 위험, 결과를 UI에서 즉시 제어 가능

---

## B. 현재 상태 진단 (코드 기준)

## 강점
1. Quick Command → 위젯 오픈/Task/Mission 연동이 이미 존재
2. Assistant/Council/Execution/Mission/Approval/Radar가 API로 분리되어 있음
3. SSE 기반 진행 스트리밍이 다수 구현됨
4. 권한, 고위험 제어, 승인 만료 정책 등 운영 장치 존재

## 병목
1. Intent 분류가 규칙 기반(휴리스틱)이라 입력 다양성에 취약
2. 인터넷 검색이 RSS 중심이라 범용성/정확도 상한이 낮음
3. Council은 팀 UX 대비 실제 멀티에이전트 분업이 제한적
4. 코드 어시스트는 강력한 "실행 루프(패치→테스트→리뷰→PR)"가 부족
5. 금융은 분석/리포트 중심으로 실시간 데이터/리스크 엔진이 얕음

---

## C. 최신 스택에서 배울 점 (2026-03-04 공개 자료 기준)

## 1) Claude Code 패턴
1. Subagent를 별도 컨텍스트로 분리해 주 작업 컨텍스트 오염 최소화
2. Hooks/Slash/MCP로 워크플로우를 프로그래머블하게 확장
3. 권한 모델과 자동화 포인트가 잘 분리되어 있음

시사점:
- JARVIS도 에이전트를 "역할"이 아니라 "독립 작업단위 + 독립 메모리"로 운영해야 함.

## 2) ChatGPT 패턴
1. Deep Research: 시작 전 연구계획 제안, 실행 중 인터럽트, 출처 포함 리포트
2. Agent 모드: 리서치 + 액션(브라우저/앱) 결합
3. Tasks: 비동기/예약 작업을 제품 레벨에서 안정적으로 운영

시사점:
- "계획 가시성 + 중간 개입 + 출처 신뢰"가 UX 핵심.

## 3) Codex 패턴
1. 로컬 페어링 + 클라우드 병렬 위임 동시 제공
2. 격리 샌드박스, 승인 모드, 코드리뷰 자동화(개발 사이클 직접 연결)
3. SDK/Slack 등 외부 업무 채널 통합

시사점:
- JARVIS도 "채팅"이 아니라 "개발 운영체계"로 확장해야 함.

## 4) OpenCode 패턴
1. Build/Plan(primary), Explore/General(subagent)처럼 책임이 선명
2. 권한 정책으로 agent mode를 강제 분리
3. 모델/프로바이더 라우팅의 사용자 제어성이 높음

시사점:
- JARVIS에 에이전트 계층/권한 템플릿을 제품 1급 개념으로 올려야 함.

---

## D. 1~9번 질문에 대한 개별 딥다이브

## 1. 커맨드를 어떻게 더 고도화할 것인가

### 현재
- 정규식+룰 기반 intent/complexity 분류.

### 목표
- "자연어 입력 → 실행 계약(Execution Contract)" 자동 변환.

### 설계
1. **Command Compiler** 도입
   - 입력을 다음 스키마로 컴파일:
   - `goal`, `success_criteria`, `constraints`, `risk_level`, `domain_mix`, `deliverables`, `deadline`, `budget`
2. **2단 라우팅**
   - 1차: 빠른 rule/router
   - 2차: LLM semantic router + uncertainty score
3. **애매성 처리**
   - confidence 낮으면 1~2개 클라리파잉 질문 후 실행
4. **실행 모드 자동 선택**
   - `quick`, `deep_research`, `agent_team`, `long_run`, `approval_required`
5. **개인화**
   - 사용자별 선호 산출물(코드/리포트/표) 및 톤을 정책으로 저장

### KPI
1. Intent routing accuracy
2. Clarification rate (낮을수록 좋음, 단 오분류와 trade-off)
3. First-run success rate

---

## 2. 인터넷 검색 엔진 고도화 + 타사 대비

### 현재 한계
- RSS 중심 소스 수집 + 품질 게이트.

### 타사가 잘하는 공통점
1. 다중 소스(웹/문서/앱/내부 데이터) 동시 리서치
2. 계획 기반 리서치(시작 전 plan, 중간 조정)
3. 출처 및 증거 trace가 UX 기본

### 고도화 설계
1. **Retrieval Plane v2**
   - adapters: web search API, 뉴스, 학술, 코드, 내부 문서, 커넥터
2. **Query decomposition**
   - 질문을 하위 질의로 분해 + 병렬 탐색 + 재랭킹
3. **Source trust graph**
   - 도메인 신뢰도, 최신성, 중복성, 편향 score
4. **Evidence coverage score**
   - 핵심 주장 대비 근거 커버율 계산
5. **User-controlled scope**
   - allowlist/blocklist/prioritize 사이트 + 프로젝트별 정책

### KPI
1. Citation precision
2. Claim coverage
3. Freshness SLA

---

## 3. 에이전트 팀: 요청 기반 동적 구성 가능한가

### 현재
- Council, Mission DAG가 있으나 "동적 팀 구성"은 제한적.

### 목표
- 사용자 요청마다 팀을 자동 편성해 분업/검증/합성까지 수행.

### 설계
1. **Team Composer**
   - 입력 계약을 보고 역할 자동 생성:
   - `planner`, `domain_researcher`, `coder`, `executor`, `critic`, `risk`, `compliance`, `synthesizer`
2. **Role-to-agent policy**
   - 역할별 모델/툴/예산/시간 제한
3. **Arbitration loop**
   - 역할 결과 충돌 시 재질문/재탐색/투표/가중합
4. **Team memory isolation**
   - 에이전트별 scratchpad + shared blackboard
5. **Command 창 연동**
   - 사용자는 그냥 요청 입력
   - 시스템이 팀 구성안을 보여주고 승인 후 실행

### KPI
1. Multi-step task completion rate
2. Conflict resolution latency
3. Human override rate

---

## 4. 코드 어시스턴스 고도화 (Codex/Claude Code급)

### 현재
- 코드 의도 라우팅 + execution run 중심.

### 목표
- "코드 생성"이 아니라 "개발 루프 자동화".

### 설계
1. **Code Loop Engine**
   - Plan → Patch → Test → Lint → Review → PR
2. **Repo cognition 강화**
   - 심볼 인덱스, 호출그래프, 테스트 매핑, 영향도 분석
3. **Safe execution**
   - 샌드박스 단계 + 권한 승격 게이트
4. **Delegation**
   - 클라우드 배치 작업(대규모 리팩토링/코드리뷰)
5. **Review bot**
   - GitHub PR 자동 리뷰 + 수정 제안 + 근거

### UI 표현
1. Plan 탭: 작업 계획/체크리스트
2. Diff 탭: 파일별 패치/영향도
3. Verify 탭: 테스트·린트·빌드 로그
4. Review 탭: 리스크/품질 코멘트
5. Merge 탭: 최종 승인/롤백

### KPI
1. PR success rate
2. Regression escape rate
3. Mean time to merge

---

## 5. 금융 분석 고도화

### 현재
- 레이더/추천/리포트 중심.

### 목표
- "신뢰 가능한 금융 리서치 워크벤치".

### 설계
1. **Data connectors**
   - 시세/재무/공시/거시 API를 계층화
2. **Research packs**
   - 티커 분석, 섹터 비교, 이벤트 리스크, 실적 프리뷰 템플릿
3. **Portfolio state**
   - 사용자 관심종목/포지션/리스크 허용치 반영
4. **Scenario engine**
   - 금리/환율/원자재 shock 시나리오
5. **Compliance layer**
   - 투자자문 고지, 근거 미흡시 제한 출력

### KPI
1. Signal freshness
2. Forecast calibration error
3. 사용자 행동 지표(재방문·보고서 재사용)

---

## 6. 지금 없는데 있어야 할 기능

1. **Unified Policy Studio**
   - 권한, 비용, 위험, 데이터 경계 정책을 한곳에서 편집
2. **Continuous Eval Platform**
   - 기능별 벤치마크 자동회귀, 실패 원인 자동 라벨링
3. **Personal Knowledge Graph**
   - 유저 목표/프로젝트/결정 이력 그래프
4. **Action Marketplace**
   - 사내/외부 액션 플러그인 등록, 검증, 권한 승인
5. **Incident & Rollback Center**
   - 에이전트 실행 실패/오작동 즉시 롤백

---

## 7. 광범위 요청 커버를 위한 설계안

### Core principle
- "모든 요청을 하나의 엔진으로"가 아니라  
- **Capability Graph + Dynamic Orchestrator**로 분해/조합해야 확장 가능.

### 제안 아키텍처
1. **Intent Compiler**
2. **Capability Graph Registry**
   - 각 능력(검색, 코드수정, 재무분석, 승인, 자동화)을 노드화
3. **Dynamic Planner**
   - 요청마다 DAG 생성
4. **Execution Fabric**
   - 에이전트/툴/샌드박스/큐/스케줄러 실행
5. **Trust Layer**
   - 권한/보안/감사/데이터 경계
6. **Experience Layer**
   - 동적 UI 렌더 + 실시간 상태

---

## 8. 화면 동적 렌더링 가능한가

### 결론
- **가능하고, 반드시 그렇게 가야 함**.

### 설계
1. **Schema-driven UI**
   - 백엔드가 `TaskViewSchema`를 내려주고 프론트가 위젯 조합 렌더
2. **Adaptive layout**
   - 요청 타입/리스크/진행상태에 따라 패널 재배치
3. **State stream**
   - SSE/WebSocket으로 단계별 UI 상태 갱신
4. **Operator controls**
   - pause/resume/replan/retry/approve 버튼을 상태 기반 표시
5. **Evidence-first surfaces**
   - 모든 결과 패널에 근거/출처/신뢰도 표시

---

## 9. 개별 고도화 vs 전체 고도화

## 개별 고도화 트랙
1. Command Intelligence 트랙
2. Retrieval/Research 트랙
3. Agent Team 트랙
4. Code Copilot 트랙
5. Finance Intelligence 트랙
6. UX Runtime 트랙

각 트랙은 자체 KPI와 백로그를 가진다.

## 전체 고도화 트랙 (System-of-systems)
1. 공통 실행 계약(Execution Contract) 표준화
2. Capability Graph + 정책 엔진 통합
3. 통합 telemetry + eval + A/B 인프라
4. 비용/지연/정확도 멀티 목적 최적화
5. 신뢰/보안/감사 체계를 제품의 기본 경로로 강제

---

## E. 6개월 실행 로드맵 (현실형)

## Phase 1 (0~6주): 기반 정리
1. Command Compiler v1
2. 동적 라우팅 confidence + clarification
3. 검색 소스/품질 지표 대시보드
4. 팀 구성안 미리보기 UI

## Phase 2 (6~12주): 핵심 기능 확장
1. Retrieval Plane v2 (다중 어댑터)
2. Agent Team Composer v1
3. Code Loop Engine v1 (patch/test/verify)
4. Finance 데이터 커넥터 1차

## Phase 3 (12~24주): 운영체계화
1. Unified Policy Studio
2. Continuous Eval Platform
3. Dynamic UI schema rollout
4. Slack/CLI/Webhook 채널 통합

---

## F. 바로 실행할 우선순위 (Top 10)

1. Intent compiler 스키마 도입
2. 라우팅 confidence + 재질문 UX
3. 검색 어댑터 2개 이상 추가(범용 웹/API)
4. evidence coverage metric
5. team composer(역할 자동편성)
6. council를 실제 분업형 실행으로 전환
7. code loop: 자동 검증 체인
8. finance connector + 시나리오 엔진
9. schema-driven dynamic UI
10. eval/telemetry 통합

---

## G. 외부 레퍼런스 (2026-03-04 확인)

## OpenAI
1. Deep research in ChatGPT: https://help.openai.com/en/articles/10500283-deep-research
2. ChatGPT agent release notes: https://help.openai.com/en/articles/11794368-chatgpt-agent-release-notes
3. Tasks in ChatGPT: https://help.openai.com/en/articles/10291617-tasks-in-chatgpt
4. Using Codex with your ChatGPT plan: https://help.openai.com/en/articles/11369540/
5. Introducing Codex: https://openai.com/index/introducing-codex/
6. Introducing upgrades to Codex: https://openai.com/index/introducing-upgrades-to-codex/
7. Codex is now generally available: https://openai.com/index/codex-now-generally-available/
8. Introducing the Codex app: https://openai.com/index/introducing-the-codex-app/

## Anthropic
1. Claude Code overview: https://docs.anthropic.com/en/docs/claude-code/overview
2. Claude Code subagents: https://docs.anthropic.com/en/docs/claude-code/sub-agents
3. Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
4. Claude Code slash commands: https://docs.anthropic.com/en/docs/claude-code/slash-commands
5. Claude Code MCP: https://docs.anthropic.com/en/docs/claude-code/mcp

## OpenCode
1. Agents: https://opencode.ai/docs/agents/
2. Providers: https://opencode.ai/docs/providers/

---

## H. JARVIS 원칙 (향후 의사결정 기준)

1. **모든 자동화는 설명 가능해야 한다** (근거/결정 사유 노출)
2. **모든 고위험 동작은 통제 가능해야 한다** (승인/롤백/감사)
3. **모든 기능은 측정 가능해야 한다** (정확도/비용/속도/성공률)
4. **모든 UX는 중단/수정/재계획이 가능해야 한다** (human-in-the-loop)

이 문서는 JARVIS 고도화의 기준 전략 문서로 유지한다.
