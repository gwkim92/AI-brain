# opencode-devcontainers 분석

## 기본 정보

- Git 주소: <https://github.com/athal7/opencode-devcontainers>
- 라이선스: MIT
- 마지막 확인 커밋: `670b4385960e369567655f756313e1dcd044a227` (2026-02-20)
- 확인 버전: `v0.3.3` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 동작하며, 브랜치별 격리 작업공간을 **devcontainer clone** 또는 **git worktree** 방식으로 관리한다.

핵심 기능:
- `/devcontainer <branch>`: 브랜치별 clone + devcontainer 실행
- `/worktree <branch>`: 브랜치별 worktree 생성/전환
- `/workspaces`, `/workspaces cleanup`: 작업공간 목록/오래된 공간 정리
- 세션 단위 workspace 상태 저장(세션별 활성 대상 유지)
- 포트 자동 할당(기본 `13000-13099`) 및 충돌 회피
- gitignored 파일(예: `.env`) 자동 복사

## 핵심 구현 포인트

1. 코어 모듈 분리
- `plugin/core/*`로 기능 분리:
  - `devcontainer.js` (컨테이너 up/exec/down)
  - `worktree.js` (worktree 생성/제거)
  - `ports.js` (파일 락 기반 포트 할당)
  - `jobs.js` (백그라운드 시작 작업 상태 추적)
  - `workspaces.js` (clone/worktree 통합 뷰)

2. 세션 기반 명령 인터셉트
- `plugin/index.js`의 `"tool.execute.before"` 훅으로 bash 명령을 가로채 컨텍스트별로 라우팅.
- worktree 모드면 `workdir`를 해당 경로로 전환.
- devcontainer 모드면 `devcontainer exec ...` 래핑.
- `HOST:` escape로 호스트 강제 실행 가능.

3. 안전장치
- shell quote 처리(`shellQuote`)로 명령 인젝션 위험 완화.
- 포트 할당 시 lock 디렉터리(`mkdir` 원자성) 기반 동시성 제어.
- 장시간 작업은 job 상태 파일로 추적하여 UI 응답성 유지.

4. 운영 편의 기능
- command markdown 자동 설치(`devcontainer.md`, `worktree.md`, `workspaces.md`)
- stale session/job 정리 루틴 내장
- 환경변수로 저장 경로 재정의 가능(`OCDC_*`)

## 장점

- “브랜치별 격리 실행” 문제를 실용적으로 해결한다.
- clone/worktree를 같은 UX로 다루는 추상화가 좋다.
- 포트/세션/작업 상태를 파일 기반으로 안정적으로 관리한다.

## 한계/주의점

1. 플랫폼 의존성
- devcontainer CLI, Docker, git 환경에 크게 의존.

2. 파일 기반 상태 저장의 한계
- 단일 머신/단일 사용자에는 적합하지만 분산 환경에서는 별도 상태 저장소가 필요.

3. 범위
- OpenCode 플러그인 중심 설계라 일반 백엔드 서비스에 바로 재사용하려면 인터페이스 변환이 필요.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: 직접 플러그인 채택보다는, **workspace isolation 패턴**을 우리 코드 실행/업그레이드 파이프라인에 이식하는 것이 유효하다.

### 권장 적용안 (우선순위 순)

1. 코드 실행용 격리 workspace manager 도입 (P0)
- 대상 후보: `backend/src/upgrades/executor.ts`, `backend/src/orchestrator/mission-executor.ts`
- 도입:
  - `task/mission` 단위 worktree 생성
  - 실행 종료 후 상태/아티팩트 수집 및 정리 정책 적용

2. 포트/리소스 allocator 공통 모듈화 (P0)
- 대상 후보: 신규 `backend/src/runtime/workspace-allocator.ts`
- 도입:
  - 파일락 또는 DB락 기반 포트/워크스페이스 할당
  - 충돌/유실 복구 루틴 포함

3. background job 상태 모델 추가 (P1)
- 대상 후보: `backend/src/store/*`, `backend/src/routes/executions.ts`
- 도입:
  - `pending/running/completed/failed` 상태를 명시 저장
  - web에서 진행 상태 조회 및 재시도 UX 제공

4. stale workspace GC 정책 (P1)
- 대상 후보: `backend/src/upgrades/planner.ts` 또는 배치 워커
- 도입:
  - N일 미사용 작업공간 정리
  - 미커밋 변경/아티팩트 존재 시 보존 예외 규칙

### 권장하지 않는 적용

1. 우리 서버에 OpenCode 전용 command 훅 구조를 그대로 이식
- 현재 서비스 구조(HTTP API + orchestrator)와 결합 방식이 다르다.

2. 무조건 gitignored 파일 자동 복사
- 보안 관점에서 허용 목록(allowlist) 기반 복사가 더 안전하다.

## 바로 실행 가능한 체크리스트

1. 작업 단위(worktree) 생성/정리 라이프사이클 설계
2. 포트/리소스 할당 락 전략 결정(파일락 vs DB락)
3. 실행 job 상태 스키마와 API 정의
4. stale workspace 정리 기준(보존 예외 포함) 수립
