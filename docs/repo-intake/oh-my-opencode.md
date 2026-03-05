# oh-my-opencode 분석

## 기본 정보

- Git 주소: <https://github.com/code-yeongyu/oh-my-opencode>
- 라이선스: SUL-1.0 (일부 서드파티 컴포넌트는 개별 라이선스)
- 마지막 확인 커밋: `3d8f390b9e464a8faf285a92f3822065279fe872` (2026-03-05)
- 확인 버전: `3.10.0` (`package.json`)

## 이 저장소가 하는 일

OpenCode를 위한 대형 “에이전트 하니스” 플러그인이다. 단순 플러그인 하나가 아니라, 다중 에이전트 오케스트레이션·카테고리 기반 모델 라우팅·백그라운드 작업·훅 체인·LSP/AST 도구·내장 MCP·CLI 운영 도구까지 묶은 확장 프레임워크에 가깝다.

핵심 제공 기능:
- 다중 에이전트 체계(Sisyphus, Hephaestus, Prometheus, Atlas 등)
- 카테고리 기반 task 위임과 병렬 백그라운드 실행
- 풍부한 도구셋(LSP, AST-grep, grep/glob, session manager, hashline edit 등)
- 훅 기반 동작 제어(메시지 변환, tool guard, continuation, todo enforcement)
- 내장 MCP(websearch, context7, grep_app) + skill 임베디드 MCP
- 설치/진단/실행 CLI(`install`, `doctor`, `run`, `auth`, `mcp oauth`)

## 핵심 구현 포인트

1. 플러그인 조립형 엔트리
- `src/index.ts`
- config 로드 -> manager 생성 -> tool 레지스트리 생성 -> hook 조립 -> plugin interface 구성 순으로 모듈을 합성한다.

2. Manager 계층 분리
- `src/create-managers.ts`
- `BackgroundManager`, `TmuxSessionManager`, `SkillMcpManager`, config handler를 분리해 책임을 나눈다.

3. Tool Registry 기반 확장
- `src/plugin/tool-registry.ts`
- 기본 도구 + 백그라운드 도구 + delegate task + skill/mcp 도구를 조건부로 합성하고 disable 규칙을 적용한다.

4. Hook 파이프라인
- `src/create-hooks.ts`, `src/plugin/hooks/*`
- session/tool/transform/continuation/skill 훅을 분해해 안전 생성(`safeCreateHook`) 및 enable/disable 토글이 가능하다.

5. 표준 인터페이스 바인딩
- `src/plugin-interface.ts`
- `chat.params`, `chat.message`, `experimental.chat.messages.transform`, `tool.execute.before/after`, `event`, `config` 등을 하나의 인터페이스로 노출한다.

6. 운영 보조 CLI
- `docs/reference/cli.md`, `postinstall.mjs`
- 설치 마법사, 환경 진단(doctor), 세션 실행(run), OAuth 관리까지 CLI로 제공하며 플랫폼 바이너리 검증/다운로드 경로를 갖는다.

## 장점

- 에이전트 오케스트레이션, 도구, 운영 자동화를 한 번에 제공하는 통합도가 높다.
- 카테고리/에이전트/훅/스킬을 config로 세밀하게 제어할 수 있다.
- 테스트 범위가 매우 넓고 모듈 분리가 잘 되어 있어 확장성은 높은 편이다.
- 백그라운드 에이전트 + tmux 연계로 실제 병렬 작업 흐름에 강하다.
- `doctor` 같은 운영 진단 커맨드가 있어 배포/운영 단계에서 유용하다.

## 한계/주의점

1. 라이선스 제약
- SUL-1.0은 상용/배포 시 제약이 있어, 우리 서비스 사용 시 법무 검토가 필수다.

2. 시스템 복잡도
- 기능 범위가 매우 커서 전체 도입 시 디버깅/운영 난이도가 급격히 상승한다.

3. 모델·프로바이더 전제 의존
- README/설정이 다수 외부 모델·구독 전제를 깔고 있어, 우리 표준 provider 정책과 충돌할 수 있다.

4. 설치/런타임 환경 요구
- postinstall 바이너리 검증, optional 패키지, 일부 네이티브 의존(AST-grep) 등으로 환경 이슈 가능성이 있다.

5. 훅 충돌 리스크
- 광범위한 훅 개입 구조라 기존 플러그인/정책과 상호작용 충돌이 날 가능성이 있다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **전체를 그대로 채택하기보다, 아키텍처 패턴을 선택적으로 추출 적용**하는 것이 적절하다. 특히 라이선스/복잡도/운영 비용 관점에서 “부분 이식”이 현실적이다.

### 권장 적용안 (우선순위 순)

1. Category 기반 Task 라우팅 (P0)
- 대상: 에이전트 라우터
- 도입:
  - 작업 성격(quick/deep/visual/writing)별 모델·도구 정책 분리
  - “모델 직접 지정” 대신 “카테고리 지정” UX 도입

2. Background Subagent Runtime (P0)
- 대상: 비동기 실행 엔진
- 도입:
  - 병렬 subagent 실행 + `background_output` 형태 결과 수집
  - parent task와 상태/알림 연동

3. Hook Safety Framework (P0)
- 대상: 훅 인프라
- 도입:
  - 훅 안전 생성 래퍼 + 훅별 enable/disable 토글
  - 오류 훅 격리로 전체 세션 안정성 유지

4. Hash-anchored Edit 개념 도입 (P1)
- 대상: 편집 도구 계층
- 도입:
  - line hash 기반 stale edit 방지
  - 대형 파일 수정 신뢰성 개선

5. Doctor/Health CLI 패턴 (P1)
- 대상: 운영 도구
- 도입:
  - 설정/인증/모델/의존성 진단 커맨드 표준화
  - 배포 전 자동 점검 파이프라인 구축

### 권장하지 않는 적용

1. 라이선스 검토 없이 코드 직접 재사용
- SUL-1.0 준수 이슈로 법적 리스크가 생길 수 있다.

2. 전체 기능 일괄 이식
- 초기 통합 비용과 실패면이 과도하게 커진다.

3. 모든 훅을 기본 활성화
- 기존 워크플로와 충돌하며 디버깅 난이도를 높인다.

## 바로 실행 가능한 체크리스트

1. SUL-1.0 및 서드파티 라이선스 사용 가능 범위 법무 검토
2. Brain/JARVIS에 필요한 최소 기능군(P0)만 선별
3. category 라우팅 + background subagent PoC 작성
4. hook safety 토글 및 실패 격리 정책 수립
5. 운영용 `doctor` 스타일 진단 명세 작성
