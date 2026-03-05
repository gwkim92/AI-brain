# opencode-google-antigravity-auth 분석

## 기본 정보

- Git 주소: <https://github.com/shekohex/opencode-google-antigravity-auth>
- 라이선스: MIT
- 마지막 확인 커밋: `bcf88f2e9879d6e91f4ab40a243f268179a9df28` (2026-02-18)
- 확인 버전: `v0.2.15` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 동작하며, Google OAuth 기반으로 Antigravity(Code Assist) 경로를 통해 Gemini/Claude 계열 모델을 사용하도록 연결한다.

핵심 기능:
- Google OAuth + 로컬 콜백 서버(`localhost:36742`) + 수동 fallback
- 멀티 계정(최대 10개) 저장 및 자동 회전
- endpoint fallback(`daily -> autopush -> prod`)
- 요청 변환(Claude/Gemini별 transform) 및 응답 정규화
- `google_search` 도구 제공(별도 grounding 요청)
- 세션 recovery(특정 thinking block 오류 자동 복구)

## 핵심 구현 포인트

1. fetch wrapper 기반 라우팅
- `src/plugin/fetch-wrapper.ts`
- 계정 선택 -> 토큰 갱신 -> 프로젝트 컨텍스트 확보 -> endpoint fallback -> 응답 변환 흐름으로 구성.
- 429에 대해 `Retry-After`/body의 `RetryInfo`를 읽고 backoff를 계산.

2. 멀티 계정 모델 패밀리 단위 제한 관리
- `src/plugin/accounts.ts`, `src/plugin/storage.ts`
- 모델 family(`claude`, `gemini-flash`, `gemini-pro`) 기준으로 rate-limit reset 시간 추적.
- free/paid tier 우선순위 선택 로직 포함.

3. 모델별 요청 변환 계층
- `src/plugin/transform/claude.ts`, `src/plugin/transform/gemini.ts`
- tool schema 정규화, thinking config 처리, 시스템 인스트럭션 삽입, 함수 호출/응답 파트 보정.

4. 프로젝트 자동 확인
- `src/plugin/project.ts`, `src/antigravity/oauth.ts`
- `loadCodeAssist`/`onboardUser` 기반으로 project context를 확보하고 캐시.

5. 검색 도구 및 복구 훅
- `src/plugin/search.ts`: Google Search + URL context 결과를 markdown으로 반환.
- `src/plugin/recovery/index.ts`: thinking block 순서 오류 시 메시지 보정 후 `continue` 자동 입력.

## 장점

- 인증/요청/응답/복구가 모듈 단위로 비교적 깔끔하게 분리돼 있다.
- 멀티 계정 + endpoint fallback 조합으로 가용성 확보를 시도한다.
- 테스트 커버리지가 중간 이상(`unit + integration` 구성이 존재).

## 한계/주의점

1. 정책/계정 리스크
- README에서 Google 계정 제한 가능성을 명시한다.
- 프로덕션 기본 경로로 채택하기에는 컴플라이언스 리스크가 높다.

2. 내부 endpoint 결합
- Antigravity/Code Assist 내부 동작에 강하게 결합되어 외부 변화에 취약할 수 있다.

3. 복잡한 변환 경로
- 모델별 변환/정규화가 많아 부분 이식 시 회귀 가능성이 있다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: 직접 채택보다는, **재시도·계정풀·오류복구 패턴**을 우리 provider 계층에 추출 적용하는 것이 적절하다.

### 권장 적용안 (우선순위 순)

1. reason-aware rate-limit/backoff 공통화 (P0)
- 대상: `backend/src/providers/router.ts`, 각 provider adapter
- 도입:
  - 헤더 + 응답 body에서 retry 힌트 추출
  - 지수 backoff + 상한 + AbortSignal 대응

2. provider health/쿨다운 상태 저장 (P0)
- 대상: `backend/src/store/*`, `backend/src/providers/router.ts`
- 도입:
  - provider별 family 단위 cooldown 상태 저장
  - 라우팅 시 cooldown-aware 선택

3. 모델 변환 계층 분리 (P1)
- 대상: 신규 `backend/src/providers/transform/*` (제안)
- 도입:
  - provider별 요청 정규화(스키마/thinking/tool-call)
  - 테스트 가능한 순수 함수로 분리

4. recoverable error 자동 복구 훅 (P1)
- 대상: `backend/src/routes/assistant/*`
- 도입:
  - 특정 오류 패턴 자동 복구(재구성/재시도)
  - 재시도 횟수/조건을 정책화

5. 내부 검색 tool 패턴 참고 (P1)
- 대상: retrieval/assistant tool 경로
- 도입:
  - "주요 실행 경로와 분리된 검색 호출" 패턴으로 안정성 확보

### 권장하지 않는 적용

1. Antigravity OAuth/멀티 Google 계정 직접 운영
- 계정/정책 리스크로 운영 비용이 크게 증가한다.

2. 모델 변환 로직의 무분별한 복붙
- 우리 시스템 contract와 맞지 않으면 디버깅 비용이 커진다.

## 바로 실행 가능한 체크리스트

1. rate-limit 힌트 파싱 유틸(`Retry-After` + body) 설계
2. provider cooldown 상태 모델 및 저장 방식 결정
3. 요청 변환 레이어 초안(입력/출력 contract) 작성
4. assistant recoverable error 목록과 자동복구 범위 정의
