# opencode-vibeguard 분석

## 기본 정보

- Git 주소: <https://github.com/inkdust2021/opencode-vibeguard>
- 라이선스: MIT
- 마지막 확인 커밋: `f965b33468bafa27ac0654a04f5ed3c7c29c9b13` (2026-03-01)
- 확인 버전: `0.1.0` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 동작하며, 민감 문자열을 LLM provider로 보내기 전에 placeholder로 치환하고, 로컬 실행 지점에서 원문으로 복원한다.

핵심 동작:
- 요청 직전(`experimental.chat.messages.transform`)에 `text/reasoning/tool input/output`을 탈민감화
- 응답 완료 시점(`experimental.text.complete`)에 placeholder를 원문으로 복원
- 툴 실행 직전(`tool.execute.before`)에 args를 원문으로 복원
- 설정 파일이 없거나 `enabled=false`이면 no-op으로 동작

Placeholder 형식:
- `__VG_<CATEGORY>_<hash12>__` 또는 `__VG_<CATEGORY>_<hash12>_<N>__`
- `hash12`는 세션 랜덤 secret 기반 HMAC-SHA256 일부라 provider 관점에서 역추적이 어렵다.

## 핵심 구현 포인트

1. OpenCode 훅 기반 경계 보호
- `src/index.js`
- provider 요청 경계(전송 전), 모델 출력 경계(완료 후), 로컬 툴 실행 경계(실행 전)를 분리해 처리한다.

2. 세션 단위 placeholder 매핑
- `src/session.js`
- 세션 내 동일 원문은 동일 placeholder로 매핑된다.
- TTL/최대 매핑 수 제한, 충돌 시 `_N` suffix로 유니크 보장 로직이 있다.

3. 패턴 엔진 및 중첩 매치 처리
- `src/patterns.js`, `src/engine.js`
- `keywords/regex/builtin/exclude` 조합 규칙.
- 중첩 매치에서 영역 충돌을 정리한 뒤 치환해 placeholder가 깨지지 않게 처리한다.

4. 깊은 객체 순회 복원/치환
- `src/deep.js`, `src/restore.js`
- Array/PlainObject만 순회하고 `WeakSet`으로 순환 참조를 방지한다.
- 툴 args 같은 중첩 JSON에도 동일 정책을 적용한다.

5. 설정 로딩 우선순위
- `src/config.js`
- `OPENCODE_VIBEGUARD_CONFIG` -> 프로젝트 루트 -> `.opencode` -> 글로벌 경로 순으로 config를 탐색한다.

## 장점

- provider에 평문 비밀정보가 전달되지 않도록 경계 보호를 강제한다.
- 과거 툴 입력/출력까지 재탈민감화하여 후속 턴 누출을 줄인다.
- debug 로그가 평문을 출력하지 않도록 설계되어 운영 중 노출 위험이 낮다.
- no-op 기본값으로 오작동 시 코드 변경 부작용을 최소화한다.

## 한계/주의점

1. OpenCode 실험 API 의존성
- `experimental.*` 훅 변경 시 동작이 깨질 가능성이 있다.

2. 스트리밍 중 placeholder 노출 가능
- README 기준 `text-end` 이전 델타에서는 placeholder가 잠깐 보일 수 있다.

3. 자동화 테스트 부재
- `npm test` 스크립트는 있지만 저장소 내 테스트 파일은 확인되지 않았다.

4. 로컬 저장 평문 리스크
- README에 따르면 실제 툴 실행 args/output은 DB에 평문으로 저장될 수 있다.
- 즉, upstream 누출은 줄여도 로컬 저장소 보안(암호화/권한/보존정책)은 별도 대응이 필요하다.

5. 규칙 품질 의존
- regex/builtin 규칙이 과하면 과도한 치환으로 모델 품질 저하가 생길 수 있다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: 플러그인 자체를 그대로 쓰기보다, **provider 경계 redaction + tool 실행 전 restore 패턴**을 우리 runtime에 내장하는 방식이 적절하다.

### 권장 적용안 (우선순위 순)

1. Outbound Redaction Guard (P0)
- 대상: provider adapter 직전 메시지 직렬화 경로
- 도입:
  - `text/reasoning/tool history`를 공통 훅에서 탈민감화
  - 세션 단위 placeholder 매핑 저장(메모리 + 필요 시 암호화 저장)

2. Tool Arg Restore Guard (P0)
- 대상: tool dispatcher 실행 직전
- 도입:
  - args placeholder 복원 후 실제 툴 실행
  - 실행 결과는 모델 재주입 전 다시 탈민감화

3. Secret Pattern Registry (P1)
- 대상: config/ops 레이어
- 도입:
  - 기본 builtin + 서비스별 커스텀 regex/keyword 정책
  - exclude/allowlist를 환경별(dev/stage/prod)로 분리

4. Secure Observability (P1)
- 대상: 로깅/모니터링
- 도입:
  - "치환 건수/복원 건수/미복원 placeholder 비율"만 수집
  - 평문 샘플 로깅 금지

5. 운영 안전장치 (P1)
- 대상: 런타임 설정 정책
- 도입:
  - 프로덕션에서 config 누락 시 no-op 대신 fail-closed 옵션 검토
  - 세션 TTL 만료 시 미복원 placeholder 대응 정책(재시도/경고) 정의

### 권장하지 않는 적용

1. 사용자 입력 regex를 검증 없이 운영 반영
- 오탐/성능 이슈로 실시간 처리 경로가 불안정해질 수 있다.

2. 툴 실행 로그 평문 장기 보관
- provider로 안 나가더라도 내부 유출면이 커진다.

3. 프론트/클라이언트 단독 탈민감화
- 서버 경계 보호가 없으면 우회 경로에서 누출된다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS 민감정보 카테고리(API 키, 토큰, 이메일, 식별자) 정의
2. provider 요청 직전 redaction middleware 초안 구현
3. tool dispatcher 직전 restore + 실행 후 재-redaction 체인 구현
4. 최소 회귀 테스트 작성(왕복 복원, 중첩 매치, TTL 만료, tool args)
5. 로컬 DB/tool 로그 보존·암호화 정책 확정
