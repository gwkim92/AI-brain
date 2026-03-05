# micode 분석

## 기본 정보

- Git 주소: <https://github.com/vtemian/micode>
- 라이선스: MIT
- 마지막 확인 커밋: `5e7fdb2a3a57b9bd71ac17dbcf7c4a1237070573` (2026-02-02)
- 확인 버전: `0.9.1` (`package.json`)

## 이 저장소가 하는 일

OpenCode에서 **Brainstorm → Plan → Implement** 워크플로를 강제하는 오케스트레이션 플러그인이다. 다수의 역할 기반 에이전트, 세션 연속성(ledger), 자동 컨텍스트 압축, 마인드모델 기반 코드 제약, PTY/AST/아티팩트 검색 도구를 함께 제공해 “장기 개발 세션”을 운영 가능하게 만든다.

## 핵심 구현 포인트

1. 플러그인 부트스트랩 + 런타임 오버라이드
- `src/index.ts`
- 에이전트/명령/MCP 서버를 주입하고, 기본 권한 정책과 훅 파이프라인을 통합 관리한다.

2. 역할 기반 멀티 에이전트 구조
- `src/agents/index.ts`
- `commander`, `planner`, `executor`, `implementer`, `reviewer`, `mindmodel` 계열 등 다수 에이전트를 사전 정의해 워크플로를 역할 단위로 분리한다.

3. 병렬 서브에이전트 실행
- `src/tools/spawn-agent.ts`
- `spawn_agent`가 여러 에이전트를 `Promise.all`로 동시 실행해 조사/분석 단계의 처리량을 높인다.

4. 세션 연속성(ledger) 자동 주입
- `src/hooks/ledger-loader.ts`, `src/hooks/auto-compact.ts`
- 최신 continuity ledger를 system prompt에 삽입하고, 컨텍스트 압축 후 ledger 파일을 자동 갱신한다.

5. 컨텍스트 관리 훅 세트
- `src/hooks/context-injector.ts`, `src/hooks/context-window-monitor.ts`, `src/hooks/token-aware-truncation.ts`
- 루트/디렉터리 문맥 주입, 컨텍스트 윈도우 경고, 대형 툴 출력 절단을 결합해 장시간 세션 안정성을 높인다.

6. 마인드모델 제약 리뷰 루프
- `src/hooks/mindmodel-injector.ts`, `src/hooks/constraint-reviewer.ts`
- `.mindmodel` 패턴을 task와 매칭해 주입하고, Write/Edit 결과를 제약 기준으로 자동 점검해 위반 시 재시도/차단한다.

7. 아티팩트 인덱싱/검색
- `src/hooks/artifact-auto-index.ts`, `src/tools/artifact-index/index.ts`
- 계획서/ledger를 SQLite FTS로 인덱싱해 `artifact_search` 계열 도구로 과거 의사결정 재검색을 지원한다.

8. PTY 기반 장기 프로세스 제어
- `src/tools/pty/manager.ts`
- PTY 세션 생성/입력/조회/정리 기능으로 장기 실행 프로세스를 세션에 연결한다.

## 장점

- 워크플로 표준화(브레인스토밍→계획→구현)로 팀 내 에이전트 작업 품질 편차를 줄이기 좋다.
- 세션 연속성(ledger + artifact index) 설계가 강해 장기 작업 복구에 유리하다.
- 도구 구성이 폭넓어(PTY, AST 검색/치환, artifact search) 실제 개발 작업에 바로 연결된다.
- 훅 기반 자동화 범위가 넓어 운영 편의성이 높다.
- 테스트 스위트가 큰 편이라(agents/hooks/tools/integration) 회귀 방지 기반이 있다.

## 한계/주의점

1. 결합도 높은 대형 플러그인
- 에이전트/훅/도구가 촘촘히 연결되어 부분 도입이 어렵고, 변경 영향 분석 비용이 크다.

2. 권한 정책 리스크
- `config.permission`을 광범위하게 `allow`로 설정하는 방식은 서비스 보안 정책과 충돌할 수 있다.

3. 프롬프트 거버넌스 충돌 가능성
- system transform에서 `AGENTS.md`/`CLAUDE.md` 계열 지시를 필터링하는 동작이 있어 기존 운영 규칙과 상충될 수 있다.

4. Bun 런타임 의존
- `bun-pty`, `bun:sqlite` 등 Bun 중심 구현이라 Node-only 환경에는 직접 이식이 어렵다.

5. 자동 컴팩션/주입 오버헤드
- 다층 훅이 상시 동작하므로 토큰/지연/예측가능성 측면에서 운영 튜닝이 필요하다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **전체 플러그인 통째 도입보다, 검증된 패턴을 분리 이식하는 전략이 적합**하다. 특히 continuity ledger + artifact index + 워크플로 명령 계층은 Brain/JARVIS에 바로 가치가 있다.

### 권장 적용안 (우선순위 순)

1. Continuity Ledger 계층 도입 (P0)
- 세션 압축 요약을 구조화 포맷으로 저장/재주입하는 최소 기능부터 도입한다.

2. Artifact Index/검색 도입 (P0)
- plan/ledger를 인덱싱해 과거 의사결정 검색 가능하게 만들고 재작업 비용을 줄인다.

3. Workflow Command 템플릿화 (P0)
- `brainstorm`, `plan`, `implement`에 해당하는 서비스 내 명령 템플릿을 표준화한다.

4. 안전한 병렬 서브에이전트 런너 (P1)
- `spawn_agent` 패턴을 적용하되 동시성 상한/시간 제한/결과 검증을 정책으로 강제한다.

5. Context Window 가시화 (P1)
- usage 경고 + 출력 절단 로직을 서비스 토큰 정책과 맞춰 별도 계층으로 분리 적용한다.

6. Mindmodel 제약 리뷰 단계적 도입 (P1)
- 자동 차단보다는 경고 모드부터 시작해 false positive를 줄이며 단계적으로 강화한다.

### 권장하지 않는 적용

1. 권한 정책 무차별 허용 복제
- 운영/보안 정책을 우회할 수 있어 서비스 환경에는 부적합하다.

2. 기존 시스템 프롬프트 규칙 필터링
- 현재 서비스 지시 체계와 충돌 가능성이 높아, 그대로 가져오면 거버넌스 리스크가 커진다.

3. 기능 일괄 이식
- 훅 간 상호작용이 많아 장애 원인 추적이 어려워지므로 핵심 기능부터 단계 도입해야 한다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS용 continuity ledger 포맷 확정
2. plan/ledger 아티팩트 인덱스(FTS) PoC 구현
3. workflow 명령 3종(브레인스토밍/계획/구현) 최소 템플릿 정의
4. 병렬 서브에이전트 실행 정책(동시성/타임아웃/재시도) 수립
5. 권한 정책/시스템 프롬프트 거버넌스와 충돌 여부 검토
6. 단계별 롤아웃 계획 수립(경고 모드 → 강제 모드)
