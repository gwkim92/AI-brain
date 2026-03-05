# opencode-websearch-cited 분석

## 기본 정보

- Git 주소: <https://github.com/ghoulr/opencode-websearch-cited>
- 라이선스: Apache-2.0
- 마지막 확인 커밋: `65e32672bccabaa18396229934193d6c3ea7c97c` (2026-01-10)
- 확인 버전: `1.2.0` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 `websearch_cited` 커스텀 툴을 제공한다. 에이전트가 단일 툴 호출로 웹 검색을 수행하고, 인라인 citation과 `Sources:` 목록 형태의 답변을 받도록 설계돼 있다.

지원 provider:
- Google (Gemini web grounding / Code Assist 경로 포함)
- OpenAI (Responses API / OAuth 시 codex backend 경로)
- OpenRouter (responses + web plugin)

## 핵심 구현 포인트

1. 단일 툴 + 멀티 provider 선택
- `index.ts`
- `provider.*.options.websearch_cited.model`을 기준으로 provider를 선택한다.
- 설정에서 먼저 발견된 provider 하나를 사용하며, 인자 스키마는 `query`만 허용한다.

2. Google 결과의 citation 정규화
- `src/google.ts`
- `groundingMetadata`의 인덱스를 활용해 응답 본문에 `[1]` 형태 citation을 삽입하고, 하단 `Sources:` 목록을 생성한다.
- UTF-8 바이트 인덱스 기준 삽입 로직이 있어 멀티바이트 문자열도 처리한다.

3. OpenAI/OpenRouter 웹검색 호출 래핑
- `src/openai.ts`, `src/openrouter.ts`
- provider별 요청 body와 인증 방식을 맞춰 호출하고 출력 텍스트를 추출한다.
- OpenAI는 SSE/JSON 응답 모두 처리하려고 파서를 분기한다.

4. Auth 레지스트리 분리
- `index.ts`
- 기본 플러그인 외에 `WebsearchCitedGooglePlugin`, `WebsearchCitedOpenAIPlugin`를 export해 provider별 인증 로더를 분리 등록한다.

5. 테스트 커버리지
- `websearch.test.ts`
- citation 포맷팅, 인증 누락, 모델 설정 오류, OAuth refresh/재시도, provider 분기 등 주요 케이스를 테스트한다.

## 장점

- 검색 결과를 citation 포함 텍스트로 표준화해 에이전트 응답 신뢰도를 높인다.
- Google/OpenAI/OpenRouter를 한 인터페이스로 감싸 운영 유연성이 있다.
- 예외 메시지가 비교적 구체적이라 장애 진단이 빠른 편이다.
- 테스트가 있는 편이라 회귀 위험을 낮출 수 있다.

## 한계/주의점

1. Google OAuth 경로의 보안/컴플라이언스 리스크
- `src/google.ts`에 특정 OAuth client id/secret과 Code Assist 내부 endpoint 의존이 포함돼 있다.
- 정책 변경이나 차단 시 기능이 빠르게 깨질 수 있다.

2. 플러그인 순서 의존
- README에서 "plugin 배열 마지막에 배치"를 요구한다.
- 다른 플러그인과 auth 훅 충돌 가능성이 있다는 신호다.

3. Provider 자동 failover 부재
- 설정 순서상 첫 provider만 선택하며, 런타임 실패 시 다음 provider 자동 전환이 없다.

4. OpenAI/OpenRouter citation 품질 의존
- Google은 메타데이터 기반 보강이 있으나, OpenAI/OpenRouter는 모델 출력 품질에 상대적으로 더 의존한다.

5. 응답 파싱 변동성
- OpenAI/OAuth의 backend 경로 및 SSE 이벤트 구조 변경에 취약할 수 있다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: 플러그인 전체를 그대로 붙이기보다, **검색 어댑터 + citation 정규화 계층**만 추출 적용하는 것이 안정적이다.

### 권장 적용안 (우선순위 순)

1. Cited Web Search 인터페이스 표준화 (P0)
- 대상: tool/service 계층
- 도입:
  - 출력 contract를 `answer_markdown + sources[]`로 분리
  - provider별 raw 응답을 공통 포맷으로 정규화

2. Provider Failover Router (P0)
- 대상: provider router
- 도입:
  - 우선순위 + 헬스체크 + cooldown 기반 자동 전환
  - provider 장애 시 다음 경로로 즉시 fallback

3. Citation 품질 게이트 (P1)
- 대상: post-processor
- 도입:
  - citation 없는 결과는 품질 점수 하향/재시도
  - source URL 스키마 검증 및 중복 정리

4. 보안 경계 재설계 (P1)
- 대상: auth/secrets 레이어
- 도입:
  - 하드코딩된 OAuth client secret 사용 금지
  - 공식 API 키/OAuth만 사용하고 secret vault 연동

5. 비용/지연 최적화 (P1)
- 대상: 검색 캐시 계층
- 도입:
  - 동일 질의 TTL 캐시
  - 긴 답변 스트리밍 중 citation 정합성 검사 로직 분리

### 권장하지 않는 적용

1. Code Assist 내부 endpoint를 프로덕션 기본 경로로 채택
- 정책/신뢰성/법적 리스크가 크다.

2. provider 선택을 설정 순서에만 의존
- 장애 전파가 빠르고 복구 지연이 발생한다.

3. citation 없는 출력을 그대로 노출
- “근거 있는 검색” 도구의 제품 신뢰도가 떨어진다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS용 `websearch_cited` 출력 스키마(JSON + Markdown) 확정
2. provider별 검색 어댑터(OpenAI/Google/OpenRouter) 최소 구현
3. citation 정합성 검증기(인덱스/소스 매핑) 추가
4. failover 및 cooldown 정책을 router에 반영
5. 운영 환경에서 허용할 인증 경로(API/OAuth) 보안정책 문서화
