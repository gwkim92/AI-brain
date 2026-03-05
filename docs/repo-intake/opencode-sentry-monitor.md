# opencode-sentry-monitor 분석

## 기본 정보

- Git 주소: <https://github.com/stolinski/opencode-sentry-monitor>
- 라이선스: MIT
- 마지막 확인 커밋: `57441e0201158fcf5c27b073f47b2853157c7062` (2026-03-03)
- 확인 버전: `0.1.1` (`package.json`)

## 이 저장소가 하는 일

OpenCode 세션/도구 실행/토큰 사용량을 Sentry AI Monitoring 스팬 규약으로 전송하는 관측 플러그인이다. `gen_ai.invoke_agent`, `gen_ai.execute_tool`, `gen_ai.request` 스팬을 생성해 모델 사용량과 도구 실행 흐름을 한곳에서 추적할 수 있게 한다.

## 핵심 구현 포인트

1. Sentry 초기화 및 재초기화 보호
- `src/index.ts`
- DSN 기반으로 `Sentry.init()`을 1회 수행하고, 이미 다른 DSN으로 초기화된 경우 경고만 남기고 기존 클라이언트를 유지한다.

2. 세션 단위 부모 스팬 유지
- `ensureSessionSpan`, `cleanupSession`
- 세션별 `gen_ai.invoke_agent` 부모 스팬을 유지하고 하위 도구/요청 스팬을 연결한다.

3. 도구 실행 스팬 계측
- `tool.execute.before/after`
- 호출 단위(`callID`)로 `gen_ai.execute_tool` 스팬을 생성하고 입력/출력 속성을 옵션에 따라 기록한다.

4. 메시지 사용량 스팬 계측
- `event: message.updated`
- assistant 완료 메시지에서 토큰 정보를 읽어 `gen_ai.request` 스팬으로 입력/출력/캐시 토큰 메트릭을 기록한다.

5. 설정 탐색/병합 로직
- `src/config.ts`
- 프로젝트 `.opencode`, 사용자 config 디렉터리, 환경변수(`OPENCODE_SENTRY_*`)를 우선순위로 병합해 구성한다.

6. JSONC 파싱 + 엄격 검증
- `parseConfigContent`, `normalizeConfig`
- JSONC 지원(`strip-json-comments`)과 DSN/샘플링/속성 길이 검증을 제공한다.

7. 민감정보 마스킹/크기 제한 직렬화
- `src/serialize.ts`
- 키 패턴 기반 redaction과 최대 길이 truncate를 적용해 span attribute payload 크기 및 노출 위험을 줄인다.

## 장점

- OpenCode 내부 이벤트를 Sentry AI Monitoring 관점으로 표준화해 수집할 수 있다.
- 구성 파일 위치가 유연하고 env override가 잘 정리돼 운영 편의성이 높다.
- 입력/출력 수집 on/off 및 attribute 길이 제한 등 운영 제어 포인트가 있다.
- 스팬 구조(세션→도구/요청)가 명확해 트러블슈팅에 유리하다.

## 한계/주의점

1. 민감정보 보호 한계
- key 이름 기반 redaction이라 값 기반(secret-like content) 탐지는 하지 못한다. `recordInputs/Outputs` 활성화 시 정책 검토가 필요하다.

2. 테스트 부재
- 저장소에 테스트 코드가 보이지 않아 이벤트 훅 회귀 검증 신뢰도가 낮다.

3. 메모리 상태 의존
- 세션/메시지 dedupe 상태를 프로세스 메모리(Map/Set)로 관리해 재시작 시 상태가 초기화된다.

4. 오류 판정 단순화
- tool output 오류 감지가 `metadata.error`/status/title 패턴 중심이라 일부 실패 케이스를 놓칠 수 있다.

5. 글로벌 Sentry 클라이언트 충돌 가능성
- 동일 프로세스에서 다른 Sentry 플러그인과 공존 시 DSN 충돌/설정 간섭 가능성을 운영에서 점검해야 한다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **관측 표준화 레이어로 도입 가치가 높다.** 특히 모델/도구/세션 메트릭을 공통 스팬 스키마로 묶는 패턴은 Brain/JARVIS 운영 대시보드 구축에 직접 활용 가능하다.

### 권장 적용안 (우선순위 순)

1. 공통 AI Observability 스키마 정의 (P0)
- session/tool/request 계층 스팬과 토큰 메트릭 속성명을 서비스 표준으로 고정한다.

2. 선택적 페이로드 수집 정책 (P0)
- 환경별(`prod/stage/dev`)로 input/output 수집 여부와 최대 길이를 분리 설정한다.

3. 안전 직렬화 모듈 강화 (P0)
- 키 기반 마스킹에 더해 값 패턴 탐지, allowlist 필드 정책을 추가한다.

4. 이벤트 훅 안정성 테스트 추가 (P1)
- session/message/tool 이벤트 시퀀스 기반 회귀 테스트를 구축한다.

5. 다중 텔레메트리 백엔드 어댑터화 (P1)
- Sentry 외 OTLP/Grafana 등으로 확장 가능한 추상 계층을 둔다.

6. 오류 분류 고도화 (P1)
- tool 실패 판정을 표준 에러 코드/상태 구조 중심으로 개선한다.

### 권장하지 않는 적용

1. 기본값 그대로 production 입력/출력 전량 수집
- 개인정보/비밀정보 노출 가능성이 있어 보안 정책 위반 위험이 있다.

2. 단일 프로세스에서 관측 플러그인 무정책 병행
- 중복 계측, DSN 충돌, 성능 오버헤드가 발생할 수 있다.

3. 테스트 없이 이벤트 훅 확장
- 세션 수명주기 이벤트 누락/중복 계측 회귀 가능성이 높다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS AI 스팬 속성 표준(session/tool/request) 확정
2. 환경별 payload 수집 정책(recordInputs/Outputs, max length) 수립
3. redaction 정책 확장(키+값 패턴, allowlist) 설계
4. 이벤트 훅 회귀 테스트 시나리오 작성(session.created/deleted, message.updated, tool before/after)
5. Sentry DSN/환경변수 배포 전략 및 시크릿 관리 정책 정리
6. 관측 대시보드/알람 기준(오류율, 토큰 급증, 도구 실패율) 정의
