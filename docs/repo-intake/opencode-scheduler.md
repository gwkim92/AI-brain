# opencode-scheduler 분석

## 기본 정보

- Git 주소: <https://github.com/different-ai/opencode-scheduler>
- 라이선스: MIT
- 마지막 확인 커밋: `cd0b62364792f53e8687db53bc2c2c0261c9cf17` (2026-02-22)
- 확인 버전: `1.3.0` (`package.json`)

## 이 저장소가 하는 일

OpenCode 작업을 주기적으로 실행하는 스케줄러 플러그인이다. 자연어 요청을 받아 `schedule_job` 등 도구로 Job을 만들고, OS 네이티브 스케줄러(launchd/systemd/Task Scheduler, 필요 시 cron fallback)에 등록해 백그라운드에서 반복 실행한다.

## 핵심 구현 포인트

1. 크로스플랫폼 백엔드 추상화
- `src/index.ts`
- macOS(`launchd`), Linux(`systemd --user`), Windows(`schtasks`), cron fallback을 런타임에서 자동 선택한다.

2. workdir 기반 Scope 분리
- `deriveScopeId`, `scopeJobsDir`, `scopeRunsDir`
- `workdir` 절대경로를 해시+슬러그로 scope ID화해서 프로젝트별 job/lock/log/run 아티팩트를 격리한다.

3. 감독(supervisor) 실행 파이프라인
- `SUPERVISOR_SCRIPT` (Perl)
- 스케줄드 실행에서 lock 파일로 중복 실행 방지, timeout(TERM→KILL), run history(jsonl), 상태 업데이트를 처리한다.

4. 비대화형 실행 강제
- `buildRunEnvironment`, supervisor 내부 `OPENCODE_PERMISSION`
- 스케줄드 실행이 사용자 승인 대기(`question`)로 멈추지 않도록 기본 deny 정책을 주입한다.

5. Cron 파싱/검증 + 플랫폼 변환
- `validateCronExpression`, `cronToLaunchdCalendars`, `cronToSystemdCalendars`, `cronToWindowsTaskDefinitions`
- 5-field cron을 검증하고 플랫폼별 스케줄 포맷으로 변환하며, Windows 한계는 명시적 에러로 안내한다.

6. 운영 툴셋 제공
- `schedule_job`, `list_jobs`, `get_job`, `update_job`, `delete_job`, `run_job`, `job_logs`, `cleanup_global`
- 생성/수정/즉시실행/로그조회/전역정리까지 한 플러그인에서 제공한다.

7. 스킬 템플릿 내장
- `get_skill`, `install_skill`
- scheduled job 운영 베스트 프랙티스 스킬을 프로젝트에 설치할 수 있다.

## 장점

- OS 네이티브 스케줄러를 써서 재부팅 이후에도 반복 작업 지속성이 좋다.
- scope 기반 격리로 다중 프로젝트 충돌 위험을 줄인다.
- 수동 실행(`run_job`)과 스케줄 실행을 동일 로그 체계로 묶어 운영 추적이 쉽다.
- `cleanup_global` dry-run 기본값으로 운영 정리 작업이 비교적 안전하다.
- `format: json` 응답을 지원해 상위 오케스트레이터와 연동하기 쉽다.

## 한계/주의점

1. 단일 대형 파일 구조
- 핵심 로직이 `src/index.ts` 하나에 집중돼 변경 영향 범위가 크고 유지보수 난도가 높다.

2. 테스트 체계 부재
- `package.json`에 `test` 스크립트가 없고 타입체크 중심이라 회귀 검증 자동화가 약하다.

3. Windows 실행 보장 차이
- README 기준 Windows는 supervisor 파이프라인이 완전 동일하지 않아 no-overlap/timeout 보장이 약해질 수 있다.

4. 로컬/OS 결합 강함
- 사용자 환경의 scheduler 명령, PATH, 로컬 파일시스템에 의존하므로 서버/컨테이너 환경에 바로 이식하긴 어렵다.

5. 권한/보안 운영 책임
- 작업이 실제로 `opencode run`을 실행하므로, 프롬프트·환경변수·파일 접근 정책은 상위 서비스에서 별도 통제가 필요하다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **백그라운드 에이전트 실행 안정화 패턴으로는 매우 유용**하다. 다만 OS scheduler 직접 의존 방식은 클라우드 서비스 구조와 맞지 않을 수 있어, 스키마/락/관측성 설계를 우선 이식하는 것이 좋다.

### 권장 적용안 (우선순위 순)

1. JobSpec/RunSpec 표준화 (P0)
- `name`, `schedule`, `workdir(scope)`, `timeout`, `run(command/prompt/model/agent)` 스키마를 Brain/JARVIS 표준으로 정의한다.

2. 실행 감독기 도입 (P0)
- no-overlap lock, timeout, run history, 상태 전이(`running/success/failed`)를 공통 실행기 레이어로 구현한다.

3. Scope 격리 모델 도입 (P0)
- 프로젝트/워크스페이스 단위 격리 저장소를 두고, 로그·락·런 기록을 분리한다.

4. 백엔드 어댑터 분리 (P1)
- 로컬 환경은 OS scheduler, 서버 환경은 queue/worker(예: Redis+cron worker)로 동일 인터페이스를 제공한다.

5. 안전한 런타임 정책 (P1)
- 비대화형 정책, 허용된 env/prompt 정책, 민감 파일 접근 제한을 실행기에서 강제한다.

6. 운영 툴링 확장 (P1)
- `list/get/run/logs/cleanup` 관리 API를 서비스 관리자 UI/CLI에 노출한다.

### 권장하지 않는 적용

1. 서버 프로덕션에서 OS 스케줄러 직접 사용
- 다중 인스턴스/컨테이너 환경에서 상태 일관성과 복구가 어려워진다.

2. 스케줄러/실행/스토리지 결합 설계
- 단일 파일/단일 계층 구조는 기능 확장 시 리스크가 커진다.

3. 테스트 없이 기능 확장
- cron 변환·백엔드별 설치/삭제·락 처리 회귀가 발생하기 쉽다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS 스케줄 JobSpec/RunSpec 스키마 확정
2. no-overlap lock + timeout + run history 최소 실행기 POC 구현
3. scope(워크스페이스) 격리 저장 구조 설계
4. 백엔드 전략 결정: 로컬(OS) vs 서버(queue worker) 이원화
5. 운영 API 초안 작성: schedule/list/get/update/delete/run/logs/cleanup
6. 회귀 테스트 설계: cron 파싱, 중복 실행 방지, 타임아웃, 백엔드별 설치/삭제
