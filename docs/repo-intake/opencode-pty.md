# opencode-pty 분석

## 기본 정보

- Git 주소: <https://github.com/shekohex/opencode-pty>
- 라이선스: MIT
- 마지막 확인 커밋: `3720bcba258baf5db5f5bdfd2c779052c93f9469` (2026-02-26)
- 확인 버전: `0.2.3` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 인터랙티브 PTY 세션을 관리한다. 기본 `bash` 도구의 동기 실행 한계를 보완해, 백그라운드 프로세스 실행/입력/출력 조회를 도구 형태로 제공한다.

핵심 기능:
- PTY 세션 생성/입력/조회/목록/종료 (`pty_spawn`, `pty_write`, `pty_read`, `pty_list`, `pty_kill`)
- 출력 버퍼 읽기 + 정규식 필터 검색
- 세션 종료 시 알림 메시지 전송(`notifyOnExit`)
- 세션 웹 UI(REST + WebSocket) 제공 및 실시간 출력 스트리밍
- 부모 OpenCode 세션 종료 시 연관 PTY 자동 정리

## 핵심 구현 포인트

1. PTY manager + lifecycle 분리
- `src/plugin/pty/manager.ts`, `src/plugin/pty/session-lifecycle.ts`
- 세션 생성/상태 전이/종료/정리를 lifecycle에서 담당하고, 상위 manager는 read/write/search/notify를 조합한다.

2. 도구 단위 API 설계
- `src/plugin/pty/tools/*.ts`
- `pty_spawn`에서 permission 검사 후 세션 생성.
- `pty_read`는 plain/regex 모드와 pagination을 지원.
- `pty_write`는 escape sequence 파싱(`\x03`, `\n` 등) 및 명령 단위 permission 재검사를 수행.

3. 출력 버퍼와 검색
- `src/plugin/pty/buffer.ts`, `src/plugin/pty/output-manager.ts`
- 고정 크기 문자열 버퍼(기본 1,000,000 chars)에 누적하고 slice/search 기반으로 조회한다.

4. OpenCode 이벤트 연동
- `src/plugin.ts`, `src/plugin/pty/notification-manager.ts`
- `session.deleted` 이벤트 시 자식 PTY 정리.
- exit notification을 부모 세션으로 역전달해 polling 없이 완료 상태를 인지할 수 있다.

5. 웹 콘솔 경로
- `src/web/server/server.ts`, `src/web/server/handlers/*`
- 로컬 서버를 동적 포트로 띄우고 `/api/sessions` + `/ws`를 제공해 브라우저에서 PTY 상태를 관찰/조작한다.

## 장점

- 장시간 작업(dev server/watcher/test watcher)을 에이전트 워크플로에 자연스럽게 통합한다.
- 도구 API가 명확해 자동화 에이전트에서 재사용하기 쉽다.
- 세션 종료 알림으로 불필요한 반복 조회 비용을 줄인다.
- 테스트 범위가 넓다(unit/integration/e2e/playwright 포함).
- 기본 permission.bash 규칙과 연동해 무분별한 명령 실행을 줄이려는 설계가 있다.

## 한계/주의점

1. 웹 API 경로의 permission 우회 가능성
- `src/web/server/handlers/sessions.ts`의 `createSession`/`sendInput`는 plugin tool 레이어의 `checkCommandPermission` 경로를 거치지 않는다.
- localhost 접근이라도 동일 호스트 내 다른 프로세스에 의해 오용될 수 있다.

2. 외부 디렉터리 `ask` 처리 불완전
- `checkWorkdirPermission`에서 `external_directory=ask`는 TODO로 남아 사실상 허용 동작에 가깝다.

3. bun-pty monkey patch 의존
- `src/plugin/pty/manager.ts`에서 특정 버전 레이스 컨디션을 런타임 패치한다.
- upstream 변경 시 예기치 않은 동작 가능성이 있다.

4. 버퍼 단위가 line 기반이 아닌 문자열 길이 기반
- 매우 긴 출력/ANSI 제어문이 많을 때 line 정확도 및 메모리 예측이 어려울 수 있다.

5. 웹 UI 서버 보안 경계
- 기본은 loopback(`::1`)이지만 환경변수로 바인딩 host를 바꿀 수 있어 운영 설정 실수 시 노출면이 커질 수 있다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: 이 플러그인의 핵심인 **세션형 실행기 + 비동기 완료 알림 모델**은 직접 이식 가치가 높다. 다만 웹 제어면과 권한 계층은 우리 보안 정책에 맞게 재설계가 필요하다.

### 권장 적용안 (우선순위 순)

1. Session Runtime 추출 (P0)
- 대상: 실행 엔진 계층
- 도입:
  - long-running job을 `session_id` 기준으로 관리
  - `spawn/write/read/kill/list` 공통 contract 정의

2. Async Completion Event (P0)
- 대상: agent event bus
- 도입:
  - 작업 종료/실패 이벤트를 parent conversation에 push
  - polling 의존도를 제거

3. Guarded Permission Layer (P0)
- 대상: tool gateway 및 모든 원격 제어 경로
- 도입:
  - 명령 실행과 입력 전송 모두 동일 permission evaluator 통과
  - `ask` 정책은 fail-closed(deny)로 통일

4. Observability + Retention (P1)
- 대상: 로그/스토리지
- 도입:
  - 세션 메타데이터와 출력 버퍼 보존기간(TTL) 분리
  - 민감 데이터 마스킹/압축/샘플링 정책 추가

5. Web Console Hardened Mode (P1)
- 대상: 운영 UI
- 도입:
  - loopback 고정 + 인증 토큰 + CSRF/origin 검증
  - 쓰기 API(입력/스폰/킬)는 별도 권한 스코프 적용

### 권장하지 않는 적용

1. permission 검증을 도구 호출 경로에만 한정
- REST/WS 같은 우회 경로에서 실행 통제가 깨질 수 있다.

2. 무제한 세션/버퍼 운영
- 메모리 압박과 장애 전파 위험이 커진다.

3. monkey patch 기반 안정성에 장기 의존
- upstream 업데이트 때 회귀 가능성이 높다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS용 session 실행 API 스펙 정의(`spawn/write/read/kill/events`)
2. permission evaluator를 엔진 공통 미들웨어로 배치
3. 종료 알림 이벤트 포맷과 재시도 정책 설계
4. 버퍼 보존정책(TTL/최대크기/민감정보 마스킹) 확정
5. 웹 콘솔 도입 시 인증/네트워크 바인딩 보안 요구사항 문서화
