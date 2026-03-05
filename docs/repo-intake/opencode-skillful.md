# opencode-skillful 분석

## 기본 정보

- Git 주소: <https://github.com/zenobi-us/opencode-skillful>
- 라이선스: MIT
- 마지막 확인 커밋: `9ee443f5d61f1783cdbf6e01acb3a587b3c3b4f8` (2026-02-13)
- 확인 버전: `1.2.5` (`package.json`)

## 이 저장소가 하는 일

Anthropic Agent Skills 사양을 OpenCode에 맞춰 구현한 스킬 플러그인이다. 핵심은 **온디맨드 스킬 로딩**으로, 스킬을 항상 프롬프트에 넣지 않고 필요할 때만 찾아(`skill_find`) 주입(`skill_use`)하며, 개별 리소스를 읽어(`skill_resource`) 활용한다.

핵심 도구:
- `skill_find`: 키워드/문구/제외어 기반 스킬 검색
- `skill_use`: 스킬 다중 로드 후 noReply 사용자 메시지로 삽입
- `skill_resource`: 스킬 내부 리소스(스크립트/레퍼런스/에셋) 읽기 및 삽입

## 핵심 구현 포인트

1. 레지스트리 중심 구조
- `src/services/SkillRegistry.ts`
- 다중 base path에서 `SKILL.md`를 발견하고 frontmatter를 검증해 registry(Map)로 구성한다.

2. 안전한 리소스 접근 모델
- `src/services/SkillResourceResolver.ts`
- 초기 인덱싱된 리소스 맵을 통해서만 접근해 임의 경로 읽기 위험을 줄인다.

3. 자연어 검색 파서
- `src/services/SkillSearcher.ts`
- `"quoted phrase"`, `-exclude`, `*` 등을 해석해 AND/제외 검색 + 랭킹(이름 가중치) 처리한다.

4. 모델별 프롬프트 포맷 선택
- `src/lib/getModelFormat.ts`, `src/lib/createPromptRenderer.ts`
- 모델/프로바이더 조합에 따라 XML/JSON/Markdown 렌더러를 선택한다.

5. 스킬 주입 방식
- `src/lib/OpenCodeChat.ts`, `src/index.ts`
- `noReply: true` 메시지로 스킬/리소스를 세션에 삽입해 응답 오염을 줄인다.

6. 경로 해석 및 우선순위
- `src/config.ts`
- XDG, `~/.config/opencode/skills`, `~/.opencode/skills`, 프로젝트 `.opencode/skills`를 우선순위로 통합하고 중복 경로를 정규화한다.

## 장점

- lazy-loading 방식이라 대규모 스킬 라이브러리에서 컨텍스트 절약 효과가 크다.
- 검색/로딩/리소스 읽기 책임이 분리돼 운영과 디버깅이 비교적 쉽다.
- 모델별 프롬프트 포맷을 선택할 수 있어 멀티 모델 환경에서 활용성이 높다.
- 리소스를 사전 인덱싱해 path traversal 공격면을 줄이는 설계가 들어가 있다.
- 테스트 커버리지가 있는 편(Registry/Search/Resource/Renderer/Config).

## 한계/주의점

1. 핫 리로드 부재
- README 기준 스킬 변경 반영에 재시작이 필요하다.

2. 스킬 실행 통제는 외부 책임
- 플러그인은 스킬 문서/리소스를 주입하지만, 실제 스크립트 실행 통제는 에이전트/권한 정책에 의존한다.

3. 전역 경로 의존
- 사용자 전역 스킬 디렉토리와 프로젝트 로컬 스킬을 함께 사용하므로 팀 공통 환경 불일치가 생길 수 있다.

4. 텍스트 기반 검색 한계
- 태그/벡터 기반 의미 검색이 아니라 문자열 중심 검색이라 유사 개념 탐지 한계가 있다.

5. 초기 인덱싱 비용
- 스킬 수가 많을수록 시작 시 스캔/파싱 비용이 증가한다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **스킬을 도구화된 지식 리소스로 lazy 주입**하는 패턴은 Brain/JARVIS에 매우 유효하다. 특히 category 라우팅과 결합 시 토큰 효율/정확도를 같이 개선할 수 있다.

### 권장 적용안 (우선순위 순)

1. Unified Skill API (P0)
- 대상: agent runtime
- 도입:
  - `skill_find`, `skill_use`, `skill_resource` 3개 인터페이스를 표준화
  - 스킬을 “항상 로드”가 아닌 “요청 시 로드”로 전환

2. Skill Registry with Priority Paths (P0)
- 대상: config/loader 계층
- 도입:
  - global + project skill path를 우선순위 규칙으로 병합
  - 중복 스킬 충돌 규칙(last-wins 또는 explicit override) 명시

3. Model-aware Renderer (P1)
- 대상: prompt composer
- 도입:
  - 모델별 XML/JSON/MD 렌더링 프로파일 지원
  - provider-model key 기반 세밀한 오버라이드 제공

4. Skill Security Policy (P1)
- 대상: execution guard
- 도입:
  - skill resource 접근 allowlist, 스크립트 실행 시 sandbox/권한 검증
  - 민감 파일 및 외부 경로 접근 차단

5. Skill Telemetry (P1)
- 대상: observability
- 도입:
  - 스킬 검색 hit-rate, 로드 빈도, 토큰 기여량, 실패 케이스 수집

### 권장하지 않는 적용

1. 스킬 전량 자동 주입
- 토큰 비용과 노이즈가 커져 모델 품질이 오히려 떨어질 수 있다.

2. 권한 정책 없이 skill script 실행 허용
- 공급망/실행 보안 리스크가 커진다.

3. 전역 경로만 신뢰하는 단일 구성
- 팀/CI 환경 불일치로 재현성이 나빠진다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS skill API 스펙(`find/use/resource`) 확정
2. global+project path 우선순위 로더 구현
3. skill resource 접근 정책(allowlist/sandbox) 설계
4. 모델별 렌더러 매핑(XML/JSON/MD) PoC 작성
5. 스킬 사용 텔레메트리 지표 정의 및 수집 추가
