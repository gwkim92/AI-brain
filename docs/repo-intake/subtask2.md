# subtask2 분석

## 기본 정보

- Git 주소: <https://github.com/spoons-and-mirrors/subtask2>
- 라이선스: PolyForm-Noncommercial-1.0.0
- 마지막 확인 커밋: `92ad854c0d3190f407bfdcb9a012a5446dbb10a0` (2026-01-30)
- 확인 버전: `0.3.5` (`package.json`)

## 이 저장소가 하는 일

OpenCode의 `/command` 실행 흐름을 확장해, 여러 서브태스크를 더 결정론적으로 오케스트레이션하는 플러그인이다. 핵심은 `return`(후속 액션 체인), `loop`(조건 기반 반복), `parallel`(병렬 서브태스크), `$TURN`/`$RESULT`(컨텍스트·결과 재사용), 동적 `/subtask` 실행을 한 세트로 묶어 워크플로를 자동화하는 점이다.

## 핵심 구현 포인트

1. 훅 중심 오케스트레이션
- `src/core/plugin.ts`
- `command.execute.before`, `tool.execute.before/after`, `experimental.chat.messages.transform`, `session.idle`를 모두 연결해 명령 실행 전후와 메시지 변환까지 제어한다.

2. `/subtask` 가로채기 + 인라인 오버라이드
- `src/hooks/command-hooks.ts`
- `{model:... && agent:... && loop:... && return:... && as:...}` 문법을 파싱해 런타임에서 즉시 서브태스크로 변환한다.

3. `return` 체인과 기본 요약 메시지 대체
- `src/hooks/message-hooks.ts`, `src/features/returns.ts`
- OpenCode의 기본 synthetic 요약 메시지를 제거/치환하고, 프롬프트 return과 `/command` return을 서로 다르게 처리한다.

4. 조건 기반 루프 평가
- `src/loop.ts`, `src/hooks/session-idle-hook.ts`
- `until` 조건이 있으면 메인 세션이 `<subtask2 loop="break|continue"/>`로 다음 반복 여부를 판단하도록 설계되어 있다.

5. 병렬 서브태스크 평탄화
- `src/features/parallel.ts`
- 중첩 parallel을 재귀적으로 펼치고 depth 제한(기본 5)과 visited 기반 중복 방지를 적용한다.

6. 컨텍스트/결과 전달 메커니즘
- `src/features/turns.ts`, `src/core/state.ts`
- `$TURN[n]` 참조 해석, `{as:name}` 캡처, `$RESULT[name]` 치환으로 서브태스크 간 데이터 전달을 지원한다.

7. 상태 저장소 집중형 구조
- `src/core/state.ts`
- 다수의 Map/Set으로 세션별 실행 상태를 추적하며, return stack, pending capture, parent-child 세션 매핑까지 한곳에서 관리한다.

## 장점

- 복잡한 multi-step 명령 흐름을 선언적으로 구성할 수 있다.
- `return`/`loop`/`parallel` 조합으로 반복적 오퍼레이션 자동화에 강하다.
- `$TURN`, `$RESULT`로 컨텍스트 재사용성이 높아 긴 작업 체인에서 유용하다.
- session idle 이벤트를 기준으로 다음 스텝을 진행해 타이밍 제어를 비교적 안정적으로 처리한다.

## 한계/주의점

1. 라이선스 제약
- PolyForm-Noncommercial은 상용 서비스 직접 포함에 제약이 크다. 법무 검토 없이 코드 재사용하면 위험하다.

2. 내부 동작 결합도 높음
- `experimental.chat.messages.transform`, 내부 HTTP PATCH 사용 등 OpenCode 내부 구현에 의존하는 부분이 있어 업스트림 변경 시 깨질 가능성이 높다.

3. 상태 복잡도 높음
- 세션/리턴/루프/캡처 상태가 분산된 Map으로 많아 디버깅과 회귀 방지가 어렵다.

4. 병렬 기능 선행 의존성
- README 기준 `parallel`은 OpenCode PR(`opencode/pull/6478`) 의존성이 있어 환경별 동작 편차가 생길 수 있다.

5. 설정 파서 견고성 이슈
- `src/utils/config.ts`의 JSONC 파싱이 정규식 strip 기반이라 엣지 케이스에서 오동작 가능성이 있다.

6. 검증 체계 단순
- 테스트 파일은 있지만 `package.json`에 표준 `test` 스크립트가 없어 CI 재현성이 낮다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **아이디어/패턴은 매우 유용하지만, 코드 직접 흡수보다 재설계 이식이 맞다.** 특히 `return` 체인과 `until` 루프 평가 모델은 Brain/JARVIS 에이전트 워크플로 자동화에 바로 쓸 수 있다.

### 권장 적용안 (우선순위 순)

1. 워크플로 DSL 최소셋 도입 (P0)
- `return`, `loop(max/until)`, `as/result` 3개만 먼저 스펙화해 내부 명령 체인 자동화를 구현한다.

2. 평가 루프 패턴 도입 (P0)
- 반복 작업 종료를 문자열 플래그가 아니라 평가 프롬프트 + 명시 태그(`break/continue`)로 표준화한다.

3. 컨텍스트 릴레이 API 도입 (P1)
- `$TURN`/`$RESULT`에 해당하는 명시적 참조 API를 런타임에 추가해 태스크 간 데이터 전달을 안정화한다.

4. 동시성/재귀 가드레일 (P1)
- 병렬 태스크 수, 최대 depth, 최대 반복 횟수, 타임아웃을 정책으로 강제한다.

5. 관측성 지표 추가 (P1)
- 체인 길이, 반복 횟수, 실패 위치, 토큰 비용, 성공률을 세션 단위로 수집해 운영 판단 근거를 만든다.

6. 라이선스 리스크 회피 (P0)
- 원본 코드 벤더링 대신 설계만 참고해 사내 구현으로 대체한다.

### 권장하지 않는 적용

1. 원본 플러그인 코드 직접 포함
- Noncommercial 라이선스와 업스트림 결합도 때문에 장기 운영 리스크가 크다.

2. 메시지 변환 훅에 핵심 로직 집중
- 프레임워크 내부 동작 변화에 취약하므로 핵심 오케스트레이션은 독립 레이어로 두는 것이 안전하다.

3. 모든 기능 동시 도입
- 디버깅 난도가 급상승하므로 `return → loop → parallel` 순으로 단계 적용이 맞다.

## 바로 실행 가능한 체크리스트

1. 법무 검토: PolyForm-Noncommercial 코드 직접 사용 가능 범위 확인
2. Brain/JARVIS 워크플로 DSL 초안 작성 (`return`, `loop`, `as/result`)
3. 종료 판정 프로토콜 정의 (`break/continue` 표준 응답 포맷)
4. 최소 POC 구현: 단일 명령 체인 + 조건 루프
5. 상태머신 테스트 작성: 중첩 return/loop/parallel 회귀 케이스
6. 운영 제한치 설정: max parallel, max depth, max loop, timeout
