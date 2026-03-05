# opencode-notificator 분석

## 기본 정보

- Git 주소: <https://github.com/panta82/opencode-notificator>
- 라이선스: MIT (`package.json`)
- 마지막 확인 커밋: `07b3a7b2a7e3cf349b4b2da0453a46095cd45720` (2026-02-02)
- 확인 버전: `1.0.0` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 세션 이벤트 기반 데스크톱 알림과 사운드 알림을 제공한다.

핵심 동작:
- `session.idle` 시 “Generation completed” 데스크톱 알림 + 사운드 재생
- `permission.ask` 시 권한 요청 알림 + 사운드 재생
- 프로젝트 경로 기반 해시로 사운드 파일을 자동 선택(`fileSeed`)
- 명시적 사운드 파일 지정(`playSound.file`)도 지원

## 핵심 구현 포인트

1. 단일 플러그인 엔트리
- `notificator.js`
- `NotificationPlugin`에서 `event` 훅과 `permission.ask` 훅을 등록한다.

2. JSONC 설정 로딩
- `notificator.js`
- 로컬 `notificator.jsonc`를 읽고 주석 제거 후 파싱해 enabled/desktop/sound 옵션을 적용한다.

3. 프로젝트별 사운드 선택
- `hashString`, `pickSoundFile`
- `worktree || directory` + seed를 해싱해 `notificator-sounds/` 내 파일을 안정적으로 선택한다.

4. 플랫폼별 알림 실행
- macOS: `osascript`, `afplay`
- Linux: `notify-send`, `ffplay`
- 알림/사운드는 실패 시 워크플로를 중단하지 않도록 대부분 무시 처리한다.

5. 배포 자동화
- `build.js`, `deploy.js`
- esbuild 번들 + 사운드/설정 복사 후 OpenCode plugin 디렉토리로 설치한다.
- 기존 `notificator.jsonc`는 보존하도록 처리한다.

## 장점

- 구현이 단순해 설치 후 바로 체감 가능한 UX 개선(완료/권한 요청 알림)을 제공한다.
- 프로젝트별 사운드 분리 아이디어가 실용적이다.
- 설정 구조가 작고 직관적이라 운영 부담이 낮다.
- 빌드/배포 스크립트가 있어 로컬 적용이 쉽다.

## 한계/주의점

1. Windows 실질 미지원
- README/AGENTS는 cross-platform을 언급하지만 실제 알림/사운드 실행 분기는 macOS/Linux만 구현되어 있다.

2. 테스트 부재
- 자동 테스트 코드가 없고 `scripts.test`도 정의되어 있지 않다.

3. 훅 이벤트 의존성
- `session.idle`/`permission.ask` 이벤트 구조 변경 시 바로 깨질 수 있다.
- `currentSessionID` 전역 상태 기반 필터링은 세션 모델 변화에 취약하다.

4. JSONC 파서 단순 구현
- 정규식 주석 제거 방식이라 edge case(JSON 문자열 내 `//` 등)에 취약할 수 있다.

5. 알림 중복 제어 부족
- idle 이벤트가 반복 발생하면 동일 알림이 여러 번 발생할 가능성이 있다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: 기능 자체는 작지만 **세션 이벤트를 사용자 피드백 채널로 연결하는 패턴**은 유용하다. 다만 프로덕션에는 플랫폼 추상화·중복 방지·정책 제어를 추가한 형태로 이식하는 것이 좋다.

### 권장 적용안 (우선순위 순)

1. Notification Event Bus (P0)
- 대상: 세션 런타임 이벤트 계층
- 도입:
  - `task.completed`, `permission.required`, `task.failed` 같은 표준 이벤트 정의
  - 알림 채널(Desktop/Webhook/Slack)을 플러그형으로 분리

2. Dedup + Throttle (P0)
- 대상: 알림 송신기
- 도입:
  - 동일 세션/이벤트 키 기준 dedupe
  - 시간 창 기반 throttle로 알림 폭주 방지

3. Cross-platform Adapter (P1)
- 대상: 플랫폼 통합 레이어
- 도입:
  - macOS/Linux/Windows별 공식 API 분기
  - 실행 실패 시 표준 fallback(예: in-app toast)

4. Config Robustness (P1)
- 대상: 설정 로더
- 도입:
  - 정규식 파서 대신 검증 가능한 JSONC 파서 사용
  - 스키마 검증으로 잘못된 값 사전 차단

5. Notification Policy (P1)
- 대상: 사용자 설정
- 도입:
  - 이벤트별 on/off, quiet hours, 프로젝트별 사운드 정책
  - 민감 작업(권한/보안) 알림 우선순위 지정

### 권장하지 않는 적용

1. 쉘 커맨드 하드코딩 방식 직접 확장
- 플랫폼별 예외 처리 누락이 누적되어 운영 품질이 떨어진다.

2. 전역 상태 하나로 세션 필터링
- 병렬 작업/서브태스크가 많아지면 누락·중복이 발생하기 쉽다.

3. 검증 없는 설정 파싱
- 잘못된 설정이 런타임 오류로 이어질 수 있다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS 알림 이벤트 표준 스펙 정의
2. desktop/webhook 알림 어댑터 PoC 구현
3. dedupe/throttle 규칙 추가
4. 설정 스키마(JSONC + validation) 도입
5. Windows 포함 3개 플랫폼 알림/사운드 동작 검증
