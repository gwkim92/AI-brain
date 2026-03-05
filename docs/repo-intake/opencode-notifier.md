# opencode-notifier 분석

## 기본 정보

- Git 주소: <https://github.com/mohak34/opencode-notifier>
- 라이선스: MIT
- 마지막 확인 커밋: `4a7bd4c3b8f4e5c70962a53b1847ff4580cae8a8` (2026-03-04)
- 확인 버전: `0.1.30` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 세션 상태/권한 요청/질문 툴 호출/오류 이벤트에 대해 시스템 알림과 사운드를 보낸다.

핵심 동작:
- `permission.updated`, `permission.asked` -> permission 알림
- `session.idle` -> complete 또는 subagent_complete 알림
- `session.error` -> error 또는 user_cancelled 알림(중단 오류 구분)
- `tool.execute.before`에서 `question` 툴 감지 시 question 알림
- 이벤트별 사운드, 메시지, 볼륨, 명령 실행(command hook) 커스터마이즈 지원

## 핵심 구현 포인트

1. 이벤트 기반 라우팅
- `src/index.ts`
- OpenCode 이벤트를 내부 `EventType`으로 매핑해 공통 `handleEvent`를 호출한다.

2. 레이스/중복 제어
- `src/index.ts`
- `session.idle` 처리에 350ms 지연과 시퀀스 맵을 사용해 오류 직후 완료 알림 중복을 억제한다.
- 사운드/알림은 1초 debounce를 적용한다.

3. 구성 가능 알림 시스템
- `src/config.ts`, `src/notify.ts`, `src/sound.ts`
- 이벤트별 `sound/notification/message/sound-path/volume` 설정 지원
- macOS(`osascript`/`node-notifier`/`ghostty`), Linux(`notify-send` 중심), Windows(toast/PowerShell) 분기 처리

4. 포커스 기반 억제
- `src/focus.ts`
- 터미널이 현재 포커스 상태면 알림을 억제(`suppressWhenFocused`)한다.
- tmux, Hyprland/Sway/KDE Wayland, X11, macOS, Windows 경로를 분기한다.

5. 확장 알림 액션
- `src/command.ts`
- 이벤트 발생 시 외부 커맨드 실행을 지원하며 `{event}`, `{message}`, `{sessionTitle}`, `{projectName}`, `{timestamp}`, `{turn}` 토큰 치환을 제공한다.

6. 상태 지속
- `src/index.ts`, `src/config.ts`
- 전역 turn 카운터를 `~/.config/opencode/opencode-notifier-state.json`에 저장해 재시작 후에도 증가 값을 유지한다.

## 장점

- 이벤트 커버리지가 넓고 실사용 흐름(권한 요청/완료/질문/오류)을 잘 잡는다.
- 이벤트별 세밀한 제어(sound/notification/volume/message)가 가능하다.
- 완료/오류 경합 상황을 고려한 억제 로직이 들어가 있다.
- 외부 명령 실행 훅으로 Slack/webhook 같은 알림 확장이 쉽다.
- 설정 파서/보간 함수에 대한 테스트(`src/config.test.ts`)가 존재한다.

## 한계/주의점

1. 포커스 감지 신뢰성 변동
- 다양한 플랫폼 커맨드(`hyprctl`, `swaymsg`, `xdotool`, `powershell`, `osascript`)에 의존해 환경별 오탐/누락 가능성이 있다.

2. 보안/운영 리스크(커맨드 훅)
- `command.path`/`args`로 임의 프로세스를 실행할 수 있어 설정 오남용 시 위험하다.

3. Linux 플레이어 의존
- 사운드 재생은 `paplay/aplay/mpv/ffplay` 중 하나가 필요하며, 미설치 환경에서 사운드가 조용히 실패할 수 있다.

4. 이벤트 모델 의존성
- OpenCode 이벤트 스키마 변화 시 매핑 로직(`permission.*`, `session.*`)이 깨질 수 있다.

5. 노이즈 가능성
- 설정에 따라 알림 빈도가 높아지며, command 훅까지 켜면 사용자 피로도가 급증할 수 있다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: 이 저장소는 **알림 도메인 설계 예시**로 가치가 높다. 그대로 이식보다는 “이벤트 표준화 + 채널 어댑터 + 억제 정책”을 우리 런타임에 맞춰 재구성하는 것이 적절하다.

### 권장 적용안 (우선순위 순)

1. Notification Core 표준화 (P0)
- 대상: 세션 이벤트 버스
- 도입:
  - `permission`, `complete`, `subagent_complete`, `error`, `question`, `cancelled` 표준 이벤트 정의
  - 이벤트별 우선순위와 기본 알림 정책 정의

2. Anti-spam Guard (P0)
- 대상: 알림 송신 레이어
- 도입:
  - debounce + dedupe + race suppression 공통 모듈화
  - 오류 직후 완료 알림 억제 등 시나리오 룰 반영

3. Multi-channel Adapter (P1)
- 대상: 알림 채널
- 도입:
  - Desktop/Slack/Webhook/Email 어댑터 인터페이스 통일
  - 채널별 실패는 격리 처리(업무 흐름 영향 최소화)

4. Safe Command Hook (P1)
- 대상: 커맨드 실행기
- 도입:
  - allowlist 명령만 실행, 실행 시간 제한/샌드박스 적용
  - 민감 토큰 치환 시 escaping 정책 명확화

5. Focus-aware Policy (P1)
- 대상: UX 정책
- 도입:
  - 포커스 시 silent, 백그라운드 시 alert 정책
  - 개인/팀 프로파일(집중 모드, 야간 모드) 추가

### 권장하지 않는 적용

1. 플랫폼별 쉘 명령을 앱 전역에 직접 하드코딩
- 유지보수성과 이식성이 크게 떨어진다.

2. 검증 없는 command 훅 기본 활성화
- 보안면이 커지고 운영 사고 가능성이 높아진다.

3. 모든 이벤트를 기본 소리+팝업으로 활성화
- 알림 피로로 실제 중요한 이벤트 신호가 묻힌다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS 알림 이벤트 taxonomy 확정
2. debounce/dedupe/race suppression 공통 모듈 구현
3. Desktop + Webhook 2개 채널 어댑터 PoC 작성
4. command hook 보안 정책(allowlist/timeout) 정의
5. 포커스 기반 알림 억제 정책과 사용자 옵션 설계
