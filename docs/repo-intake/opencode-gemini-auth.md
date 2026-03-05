# opencode-gemini-auth 분석

## 기본 정보

- Git 주소: <https://github.com/jenslys/opencode-gemini-auth>
- 라이선스: MIT
- 마지막 확인 커밋: `e1e216599865321689ce1c00a47297b223d752ca` (2026-03-02)
- 확인 버전: `v1.4.6` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 동작하며, Google OAuth를 통해 Gemini Code Assist 백엔드에 인증/요청을 붙여 Gemini 모델을 사용하게 해준다.

핵심 기능:
- Google OAuth(PKCE) + 로컬 콜백 서버(`localhost:8085`) + 수동 코드 입력 fallback
- 토큰 자동 refresh 및 `invalid_grant` 처리
- 프로젝트 컨텍스트 자동 확보(Managed project 로드/온보딩)
- 요청 변환(Generative Language 형식 -> Code Assist `v1internal` 형식)
- 429/네트워크 오류 재시도(backoff + Retry-After + quota 분류)
- `/gquota` 명령으로 quota 조회 도구 제공

## 핵심 구현 포인트

1. 인증 파이프라인
- `src/plugin/oauth-authorize.ts`: 브라우저 자동 열기 + headless/manual fallback + state 검증.
- `src/plugin/token.ts`: refresh 동시성 제어(`refreshInFlight`)와 retry 내장.

2. refresh 토큰에 프로젝트 메타데이터 패킹
- `src/plugin/auth.ts`에서 `refreshToken|projectId|managedProjectId` 형태로 저장/복구.
- 인증 데이터 하나로 프로젝트 문맥까지 유지.

3. 프로젝트 자동 온보딩
- `src/plugin/project/context.ts`, `src/plugin/project/api.ts`:
  - `loadCodeAssist` -> tier 판단 -> 필요 시 `onboardUser` -> 최종 projectId 확보.
  - free-tier/유료-tier 분기와 프로젝트 필수 조건 처리.

4. 요청/응답 정규화
- `src/plugin/request/prepare.ts`:
  - 요청 URL을 Code Assist endpoint(`https://cloudcode-pa.googleapis.com`)로 재작성.
  - OpenAI `tool_calls`를 Gemini `functionCall`로 변환.
  - thinking/system/cachedContent 필드 정규화.
- `src/plugin/request/response.ts`:
  - SSE/JSON 응답을 OpenCode 친화적으로 후처리.
  - usage 관련 헤더 주입.

5. 재시도 전략
- `src/plugin/retry/index.ts`: Gemini CLI 유사 정책으로 429/5xx/네트워크 오류 재시도.
- 모델 자동 다운그레이드는 의도적으로 하지 않음(요청 모델 보존).

## 장점

- OAuth + 프로젝트 컨텍스트 + quota 처리까지 포함한 완성도 높은 플러그인.
- 오류/쿼터 상황을 운영 친화적으로 다루는 로직이 구체적.
- 테스트 파일이 넓은 범위를 커버한다(`src/plugin/*.test.ts` 다수).

## 한계/주의점

1. 플랫폼 결합 강도
- OpenCode + Gemini Code Assist 내부 endpoint(`cloudcode-pa.googleapis.com`)에 강하게 결합됨.
- 일반 Gemini API 키 기반 서버 아키텍처로 직접 이식하기 어렵다.

2. 운영/정책 리스크
- 사용자 OAuth 기반이며 계정/플랜/쿼터 정책 변화에 민감.
- 멀티테넌트 프로덕션 기본 경로로 채택 시 운영 복잡도 상승.

3. 요청 변환 복잡도
- tool call, thought 파트, wrapper 변환 등 데이터 경로가 복잡해 회귀 테스트 없이 부분 이식하면 깨질 가능성이 높다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **핵심 아이디어는 적극 채택**, **Gemini Code Assist endpoint 자체는 직접 채택 비권장**.

### 권장 적용안 (우선순위 순)

1. Gemini provider 재시도 강화 (P0)
- 대상: `backend/src/providers/adapters/gemini-provider.ts`
- 도입:
  - 429/5xx + 네트워크 오류 backoff
  - `Retry-After` 반영
  - 재시도 가능/불가능 상태 분리

2. thinking config 정규화 계층 추가 (P0)
- 대상: `backend/src/providers/types.ts`, `backend/src/providers/adapters/gemini-provider.ts`
- 도입:
  - 모델별 `thinkingConfig` 정책 지원
  - 요청 파라미터 validation/normalization(`budget`, `level`, `includeThoughts`)

3. quota/용량 가시화 API 추가 (P1)
- 대상: `backend/src/routes/providers.ts` 또는 신규 route
- 도입:
  - provider별 현재 제한 상태를 내부 표준 스키마로 제공
  - HUD/리포트 모듈에 용량 경고 연결

4. 실험용 OAuth 모드 분리 (P1, 내부 전용)
- `GEMINI_AUTH_MODE=api_key|oauth_experimental` 플래그를 별도로 두고, 기본은 `api_key` 유지.
- 사내 개발환경에서만 PoC 후 유지 여부 판단.

### 권장하지 않는 적용

1. 프로덕션 기본 경로를 Code Assist endpoint 의존으로 전환
- 외부 정책/엔드포인트 변화 리스크가 크고 장애 반경이 커진다.

2. 응답 변환 로직을 부분 복사
- 요청/응답 스키마 연동이 크기 때문에 필요한 부분만 뜯어오면 회귀 위험이 높다.

## 바로 실행 가능한 체크리스트

1. Gemini provider용 공통 retry 유틸 설계
2. `thinkingConfig` 타입/검증/기본값 정책 정의
3. quota 상태를 노출할 내부 엔드포인트 초안 작성
4. OAuth 실험 모드의 범위/보안/kill-switch 문서화
