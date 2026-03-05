# opencode-helicone-session 분석

## 기본 정보

- Git 주소: <https://github.com/H2Shami/opencode-helicone-session>
- 라이선스: MIT
- 마지막 확인 커밋: `8a8bb2456a87602ada7dc8524a96ca1683f0a0e2` (2025-12-10)
- 저장소 크기: 소형(핵심 파일 `index.ts` 단일 중심)

## 이 저장소가 하는 일

OpenCode 플러그인으로 동작하며, LLM 요청마다 Helicone 세션 헤더를 자동 주입한다.

- `Helicone-Session-Id`: OpenCode session ID를 기반으로 만든 고정 UUID
- `Helicone-Session-Name`: 세션 제목

결과적으로 Helicone 대시보드에서 같은 세션의 요청들이 한 그룹으로 묶인다.

## 핵심 구현 포인트

1. 세션 이벤트 구독
- `session.created`, `session.updated` 이벤트를 받아 최신 세션 상태를 메모리에 유지.

2. fetch 래핑으로 헤더 주입
- 플러그인 `auth.loader`에서 custom `fetch`를 반환하고, 모든 outbound request의 헤더를 가로채 주입.
- 사용자가 이미 `Helicone-Session-*` 헤더를 지정한 경우 덮어쓰지 않음.

3. 헤더 인젝션 방어
- `sanitizeForHeader()`로 제어문자/개행 제거하여 header injection 위험을 줄임.

4. 결정적(deterministic) 세션 ID
- `Bun.hash(sessionId)` 기반으로 UUID 형태 문자열을 생성해, 세션 재시작 간에도 같은 ID를 유지할 수 있게 설계.

## 장점

- 구현이 단순하고 침투 범위가 작다(요청 경로 한 지점에서 해결).
- 관측성 도구(Helicone)와 세션 맥락이 자연스럽게 연결된다.
- 사용자 override를 허용해 확장성이 있다.

## 한계/주의점

1. 런타임 의존
- `Bun.hash`에 의존하므로 Bun 런타임 가정이 깔려 있다.

2. 글로벌 상태
- `currentSessionUUID`, `currentSessionName` 전역 mutable 상태를 사용한다.
- 동시에 여러 세션을 병렬 처리하는 서버형 런타임에서는 request-scoped 메타데이터가 더 안전하다.

3. 테스트 부재
- 자동화 테스트 파일이 없다. 회귀 방지를 위해 최소 단위 테스트가 필요하다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

우리 서비스는 OpenCode 플러그인이 아니라 자체 백엔드 provider adapter 구조이므로, 동일 아이디어를 **request-scoped 관측 헤더 계층**으로 이식하는 게 맞다.

### 권장 적용안 (우선순위 순)

1. 관측 메타데이터 스키마 추가 (P0)
- 대상: `backend/src/providers/types.ts`
- `ProviderGenerateRequest`에 아래 필드 추가:
  - `traceId?: string`
  - `sessionId?: string`
  - `sessionName?: string`
  - `observability?: { heliconeSessionId?: string; heliconeSessionName?: string }`

2. 헤더 빌더 유틸 추가 (P0)
- 신규 파일 예: `backend/src/providers/observability-headers.ts`
- 역할:
  - 세션 ID -> 결정적 UUID 변환(Node `crypto` 기반)
  - 헤더 sanitize
  - 사용자 제공 헤더가 있으면 preserve

3. OpenAI/Anthropic/Gemini adapter에 주입 (P0)
- 대상 예:
  - `backend/src/providers/adapters/openai-provider.ts`
  - `backend/src/providers/adapters/anthropic-provider.ts`
  - `backend/src/providers/adapters/gemini-provider.ts`
- 기존 인증 헤더에 observability 헤더 merge.

4. trace/session과 연동한 ID 일관성 확보 (P1)
- 웹에서 생성/유지 중인 HUD session ID(`web/src/lib/hud/session.ts`)와 백엔드 trace ID를 매핑.
- 같은 사용자 작업 단위에서 provider 요청이 항상 같은 session header를 사용하도록 표준화.

5. 운영 가드레일 (P1)
- ENV feature flag로 온/오프:
  - `HELICONE_ENABLED=true|false`
  - `HELICONE_TARGET=proxy|header_only`
- 장애 시 graceful fallback(헤더 주입 실패가 본 요청 실패를 유발하지 않게).

### 기대 효과

- 요청 단위가 아니라 “세션/미션 단위” 비용·지연·실패율 분석 가능
- 멀티 provider 라우팅(`backend/src/providers/router.ts`) 성능 비교가 쉬워짐
- 이후 보고서 모듈에서 세션별 품질 추세를 직접 노출 가능

## 바로 실행 가능한 도입 체크리스트

1. `ProviderGenerateRequest`에 observability 필드 추가
2. `buildObservabilityHeaders()` 유틸 구현 + 단위 테스트
3. OpenAI provider부터 1차 적용
4. 스테이징에서 Helicone 세션 grouping 확인
5. 나머지 provider로 확장
