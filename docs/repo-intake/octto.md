# octto 분석

## 기본 정보

- Git 주소: <https://github.com/vtemian/octto>
- 라이선스: MIT (`package.json` 표기, 별도 LICENSE 파일은 저장소에서 확인되지 않음)
- 마지막 확인 커밋: `07720191ba41bac3c405cf3325ea79722a66076a` (2026-01-28)
- 확인 버전: `0.3.0` (`package.json`)

## 이 저장소가 하는 일

터미널 기반 질의응답 대신 브라우저 UI를 띄워, 클릭/선택 중심으로 아이디어를 구조화하는 OpenCode 플러그인이다. 요청을 여러 탐색 브랜치로 분해한 뒤, 질문-응답을 반복 수집하고 최종 디자인 결론을 만드는 “인터랙티브 브레인스토밍” 엔진에 가깝다.

## 핵심 구현 포인트

1. 브라우저 세션 + WebSocket 인터랙션
- `src/session/server.ts`, `src/session/sessions.ts`
- Bun 서버를 띄우고 WS로 질문/응답을 실시간 송수신한다. 세션별 질문 큐와 응답 대기(waiter)를 관리한다.

2. 브랜치 기반 브레인스토밍 상태머신
- `src/tools/brainstorm.ts`, `src/state/store.ts`, `src/state/persistence.ts`
- 요청을 브랜치 단위로 추적하고, 질문/응답/브랜치 완료 상태를 `.octto/*.json`에 저장한다.

3. 멀티 에이전트 역할 분리
- `src/agents/octto.ts`, `src/agents/bootstrapper.ts`, `src/agents/probe.ts`
- `bootstrapper`가 브랜치 생성, `probe`가 추가 질문/종료 판단, `octto`가 전체 흐름을 오케스트레이션한다.

4. 질문 타입 확장성
- `src/tools/questions.ts`, `src/types.ts`
- 선택형/랭킹/슬라이더/코드/파일/이미지 등 다수 질문 타입을 동일 API로 생성·푸시·응답 처리한다.

5. 비동기 응답 수집 루프
- `src/tools/brainstorm.ts`
- `await_brainstorm_complete`가 답변 도착 순서대로 처리하며 브랜치별 후속 질문을 자동으로 생성한다.

6. 프로브 결과 기반 동적 후속 질문
- `src/tools/processor.ts`
- 브랜치 문맥을 probe 에이전트에 전달하고 JSON 판단(`done`/`question`)을 받아 다음 액션을 결정한다.

7. 프래그먼트 기반 프롬프트 커스터마이징
- `src/hooks/fragment-injector.ts`, `src/config/loader.ts`
- 전역(`~/.config/opencode/octto.json`) + 프로젝트(`.octto/fragments.json`) 지시를 병합해 agent prompt 앞단에 주입한다.

## 장점

- “질문-응답 UI” 자체를 플러그인에 내장해 사용성 장벽이 낮다.
- 브랜치별 탐색으로 복잡한 요구를 병렬적으로 분해해 구조화하기 좋다.
- 세션 상태를 파일로 유지해 중단/복구 흐름을 만들기 쉽다.
- 질문 타입이 풍부해 기획/설계 인터뷰에 유연하다.
- config/fragment/test 구성이 비교적 체계적이다.

## 한계/주의점

1. 로컬 브라우저 전제
- `open/xdg-open/cmd start` 기반이라 헤드리스 서버/원격 에이전트 환경에서 적용이 제한된다.

2. Bun 런타임 결합
- Bun 서버/파일 API 전제가 있어 Node-only 런타임으로 바로 이식하기 어렵다.

3. Probe 응답 파싱 취약점
- `processor.ts`에서 JSON 정규식 추출 후 파싱하는 방식이라 모델 응답 포맷 편차에 취약할 수 있다.

4. 대화형 의존성
- 사용자 응답이 핵심이므로 완전 무인 자동화 파이프라인에는 맞지 않는다.

5. 라이선스 표기 일관성 점검 필요
- 패키지는 MIT로 명시되지만 저장소 루트 LICENSE 파일 부재로, 사내 반입 시 확인 절차가 필요하다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **아이디어 탐색/요구사항 정제 단계에 특화된 인터랙티브 프론트엔드 패턴으로 도입 가치가 높다.** 다만 백엔드 자동 실행 엔진과는 분리해 “설계 수집 인터페이스”로 별도 계층화하는 것이 적합하다.

### 권장 적용안 (우선순위 순)

1. 브랜치 탐색 워크플로 도입 (P0)
- 단일 질의응답이 아니라 브랜치별 탐색 상태를 갖는 설계 수집 플로우를 도입한다.

2. 질문 컴포넌트 표준화 (P0)
- `pick_one`, `pick_many`, `rank`, `ask_text` 등 핵심 타입부터 UI 컴포넌트로 표준화한다.

3. 상태 저장소 분리 (P0)
- 세션/질문/응답/결론을 독립 저장소(서비스 DB)로 관리해 복구/감사/재사용을 가능하게 한다.

4. 모델 판단 계층 안정화 (P1)
- probe 결과를 JSON schema 검증으로 강제하고, 파싱 실패 fallback 정책을 추가한다.

5. Agent Prompt Fragment 시스템 도입 (P1)
- 프로젝트별 커스텀 지시를 주입하되 허용 키/길이/보안 필터를 정책화한다.

6. 문서 산출 파이프라인 연결 (P1)
- 최종 findings를 `docs/plans` 또는 Notion 스펙으로 자동 변환하는 후처리 단계를 붙인다.

### 권장하지 않는 적용

1. 서버 프로덕션에서 브라우저 의존 흐름 강제
- 운영 환경 특성상 사용자 브라우저 가용성/세션 지속성 리스크가 크다.

2. probe 파서 무검증 복제
- 자유형 LLM 응답을 정규식으로 파싱하는 방식은 실패 시 복구 비용이 높다.

3. 설계 수집과 구현 실행 계층 결합
- 인터랙티브 단계 실패가 실행 파이프라인 전체 장애로 번질 수 있다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS용 인터랙티브 설계 세션 스키마 정의
2. 질문 타입 최소셋(선택/텍스트/랭킹) UI 컴포넌트 PoC 구현
3. 브랜치 상태머신(진행/완료/결론) 저장 모델 설계
4. probe JSON schema + 실패 fallback 규칙 정의
5. 프래그먼트 주입 정책(허용 범위/검증/감사 로그) 수립
6. 최종 설계 산출물 자동 문서화 경로 확정(`docs` 또는 Notion)
