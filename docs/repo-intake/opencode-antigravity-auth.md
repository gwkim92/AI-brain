# opencode-antigravity-auth 분석

## 기본 정보

- Git 주소: <https://github.com/NoeFabris/opencode-antigravity-auth>
- 라이선스: MIT
- 마지막 확인 커밋: `f0ee206726b40ea5442838427a8f35409b4a6112` (2026-02-20)
- 확인 버전: `v1.6.0` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 동작하며, Google OAuth 기반으로 **Antigravity(Code Assist 계열 endpoint)**에 연결해 Claude/Gemini 계열 모델을 사용하는 데 초점이 맞춰져 있다.

핵심 특징:
- 멀티 계정 풀(최대 10개) + 계정 자동 회전
- Gemini 요청 시 Antigravity quota와 Gemini CLI quota 이중 풀 fallback
- 모델 변환/티어(thinking tier) 해석
- 429/503/529 대응 및 백오프, 프로젝트 컨텍스트 자동 확보
- 세션 recovery, tool schema 보정, thinking signature 처리
- `google_search` 도구 내장(별도 grounding 요청)

## 핵심 구현 포인트

1. 대형 fetch 인터셉터 중심 구조
- `src/plugin.ts`에서 인증, 계정 선택, endpoint fallback, 요청 변환, 에러 처리까지 단일 파이프라인으로 처리.

2. 멀티 계정 + 하이브리드 스케줄링
- `src/plugin/accounts.ts`, `src/plugin/rotation.ts`
- `sticky`/`round-robin`/`hybrid` 전략 + health/token bucket/LRU 기반 선택.
- 계정별 쿨다운/실패 누적/verification-required 상태 관리.

3. 이중 quota fallback (Gemini 계열)
- 기본은 Antigravity 우선, 고갈 시 Gemini CLI로 전환.
- 모델/헤더 스타일(`antigravity` vs `gemini-cli`)을 요청별로 선택.

4. 요청/응답 정규화 범위가 큼
- `src/plugin/request.ts`, `src/plugin/request-helpers.ts`
- 스키마 클리닝(`$ref`, `const`, unsupported 키워드 처리), tool pairing 복구, thinking block/서명 캐시, 스트리밍 변환까지 포함.

5. 운영 도구/UX 내장
- `google_search` tool, 계정 관리 UI(auth login 메뉴), quota 확인, verify 흐름이 플러그인 내부에 통합.

## 장점

- 계정/쿼터/재시도/회복까지 묶인 운영 지향 구현으로 실전성이 높다.
- 테스트 규모가 큰 편(플러그인 테스트 케이스 다수).
- rate limit 상황에서 fallback 전략이 구체적이고 세분화되어 있다.

## 한계/주의점

1. ToS/계정 리스크가 매우 큼
- README에서 명시적으로 계정 정지/제한 위험을 경고한다.
- 우리 서비스의 기본 상용 경로에 직접 적용하기엔 정책/컴플라이언스 리스크가 높다.

2. 단일 파일 복잡도
- 핵심 로직이 `src/plugin.ts`에 크게 집중되어 유지보수 난도가 높다.

3. 특정 내부 endpoint/헤더 결합
- Antigravity endpoint와 헤더 스타일에 강하게 결합되어 일반 provider abstraction으로 직접 이식하기 어렵다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **직접 채택은 비권장**, 하지만 운영 패턴은 높은 참고 가치가 있다.

### 권장 적용안 (우선순위 순)

1. Provider 라우팅에 health 기반 선택 추가 (P0)
- 대상: `backend/src/providers/router.ts`
- 도입:
  - provider별 health score, 최근 실패/지연 기반 동적 가중치
  - TTL 기반 실패 카운트 리셋

2. Rate-limit 대응을 reason-aware로 분리 (P0)
- 대상: `backend/src/providers/router.ts`, 각 adapter
- 도입:
  - 429/503/529 및 메시지 패턴 기반 backoff 정책 분기
  - `Retry-After` 우선 + 기본 backoff 계층화

3. Tool schema 정규화 유틸 분리 (P1)
- 대상: 신규 `backend/src/providers/tool-schema-normalizer.ts` (제안)
- 도입:
  - 모델별 허용 스키마 subset으로 sanitize
  - `const -> enum` 같은 안전 변환

4. 장애 복구 루프 표준화 (P1)
- 대상: `backend/src/routes/assistant/*`, orchestrator 경로
- 도입:
  - recoverable error class 정의
  - 자동 복구 후 재시도 정책(횟수/지연/중단 조건) 명문화

5. 내부 운영용 quota 상태 수집 (P1)
- 대상: `backend/src/observability`, `web/src/components/modules/ReportsModule.tsx`
- 도입:
  - provider별 quota/cooldown 상태를 표준 메트릭으로 노출

### 권장하지 않는 적용

1. Antigravity endpoint + 멀티 Google 계정 회전 로직을 프로덕션 핵심 경로에 직접 탑재
- 계정 정책 리스크와 운영 복잡도가 크다.

2. `src/plugin.ts` 구조를 그대로 복제
- 기능은 강하지만 결합도가 높아 우리 코드베이스에 그대로 이식하면 기술부채가 커진다.

## 바로 실행 가능한 체크리스트

1. provider runtime health score 설계 초안 작성
2. reason-aware rate limit/backoff 규칙을 공통 유틸로 분리
3. tool schema sanitize PoC 구현(Claude/Gemini 호환 기준)
4. quota/cooldown 관측 대시보드 최소 지표 정의
