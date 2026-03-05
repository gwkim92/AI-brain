# opencode-openai-codex-auth 분석

## 기본 정보

- Git 주소: <https://github.com/numman-ali/opencode-openai-codex-auth>
- 라이선스: MIT
- 마지막 확인 커밋: `bec2ad69b252ef4ad7dd33b9532ff8b4fdb6d016` (2026-01-09)
- 확인 버전: `v4.4.0` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 동작하며, OpenAI Platform API Key 대신 **ChatGPT OAuth(Plus/Pro)** 인증을 사용해 Codex 백엔드에 요청을 보낸다.

핵심 기능:
- OAuth PKCE 인증 + 로컬 콜백 서버(기본 `http://localhost:1455/auth/callback`)
- 만료 토큰 자동 refresh
- OpenCode 요청을 Codex 백엔드 형식으로 변환
- 모델명/variant 정규화(`gpt-5.x`, `codex` 계열 맵핑)
- SSE 응답 처리(비스트리밍은 JSON 변환, 스트리밍은 SSE passthrough)
- 설치 스크립트로 `~/.config/opencode/opencode.jsonc` 자동 병합/제거

## 핵심 구현 포인트

1. OAuth 흐름
- `lib/auth/auth.ts`에서 PKCE/state 생성, 코드 교환, refresh를 처리.
- JWT decode로 `chatgpt_account_id` claim을 뽑아 요청 헤더에 사용.

2. request interception
- `index.ts`의 `auth.loader()`에서 custom `fetch`를 반환하고 모든 provider 요청을 래핑.
- URL을 `/responses` -> `/codex/responses`로 재작성.

3. Codex 전용 헤더 주입
- `lib/request/fetch-helpers.ts`의 `createCodexHeaders()`에서
  - `Authorization: Bearer <oauth access token>`
  - `chatgpt-account-id`
  - `OpenAI-Beta: responses=experimental`
  - `originator: codex_cli_rs`
  를 주입.

4. stateless(`store:false`) 호환
- 요청 input에서 `item_reference` 제거 + message id 제거.
- 서버 상태 저장 없이 전체 히스토리를 매 요청에 재전송하는 방식.

5. 운영 안정화 로직
- usage-limit 계열 404를 429로 재매핑해 재시도 정책 친화성 향상.
- 테스트가 비교적 잘 갖춰져 있음(`test/*.test.ts` 다수).

## 장점

- OpenCode에서 Codex 계열 모델을 빠르게 사용 가능.
- 요청 변환/에러 매핑/토큰 refresh 로직이 모듈화되어 있다.
- 설치/제거 자동화가 성숙했고 JSONC 보존 처리까지 포함한다.

## 한계/주의점

1. 사용 정책 범위
- 저장소 자체 문서에도 개인 개발 용도를 명시하고, 프로덕션/멀티유저 서비스에는 OpenAI Platform API 사용을 권장한다.
- 따라서 우리 서비스의 기본 상용 경로로 직접 채택하기엔 정책/컴플라이언스 리스크가 높다.

2. OpenCode/ChatGPT 백엔드 결합
- 특정 생태계(OpenCode + chatgpt backend)에 최적화되어 있어 일반 API provider abstraction으로는 이식 비용이 있다.

3. 모델/프롬프트 정책 drift 가능성
- 모델 맵과 Codex 지침 캐시가 외부 변화에 민감하다. 지속 업데이트가 필요하다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **코어 프로덕션 경로에는 직접 통합하지 않고**, 내부 실험/개발 생산성 경로에 제한적으로 흡수하는 것이 현실적이다.

### 권장 적용안 (우선순위 순)

1. 부분 재사용: 요청 정규화 패턴 도입 (P0)
- 대상: `backend/src/providers`
- 가져올 아이디어:
  - 모델 alias -> canonical model 매핑 테이블
  - provider별 unsupported 파라미터 정규화
  - 에러 코드 표준화(예: usage limit류를 공통 재시도 가능 코드로 매핑)

2. 실험용 provider 모드 분리 (P1)
- 대상: `backend/src/config/env.ts`, `backend/src/providers/adapters/openai-provider.ts`
- `OPENAI_AUTH_MODE=api_key|chatgpt_oauth_experimental` 같은 실험 플래그를 별도 도입.
- 기본값은 현재처럼 `api_key` 유지.

3. 내부 전용 OAuth 브리지 서비스로 격리 (P1)
- 직접 프로덕션 API 서버에 섞지 말고, 사내 개발자 전용 환경에서만 사용.
- 감사 로그와 사용량 상한을 강제해 오남용 방지.

4. 프롬프트/모델 버전 레지스트리 강화 (P1)
- 대상: `backend/src/providers/model-registry.ts`, `backend/src/providers/catalog.ts`
- 모델 family/variant를 명시적으로 버전 관리하여 정책 drift 리스크 완화.

### 권장하지 않는 적용

1. 멀티테넌트 사용자 트래픽에 ChatGPT OAuth 직접 사용
- 계정/약관/운영 리스크가 커서 장기적으로 유지 불가.

2. 프로덕션 핵심 추론 경로를 Codex 백엔드 의존으로 전환
- 외부 정책 변화에 취약하고 장애 반경이 커진다.

## 바로 실행 가능한 체크리스트

1. 우리 provider layer에 모델 alias 정규화 유틸 추가
2. provider error -> 내부 표준 에러코드 매핑 테이블 추가
3. 실험 플래그 설계 문서(범위/로그/한도/kill switch) 작성
4. 내부 개발환경에서만 PoC 후 운영 반영 여부 재평가
