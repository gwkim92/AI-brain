# opencode-morph-fast-apply 분석

## 기본 정보

- Git 주소: <https://github.com/JRedeker/opencode-morph-fast-apply>
- 라이선스: MIT
- 마지막 확인 커밋: `99c82d43ed77f134081b42ea9fa3a5f533e0bf42` (2026-02-24)
- 확인 버전: `1.6.0` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로 `morph_edit` 도구를 제공한다. 로컬 파일 원문과 부분 수정 스니펫(`// ... existing code ...` marker 기반)을 Morph Fast Apply API로 보내 병합한 뒤, 결과를 파일에 반영한다.

핵심 동작:
- 대상 파일 읽기 -> Morph API 호출 -> 병합 결과 write
- 변경 결과를 unified diff로 반환하고 `+/- line` 통계를 보여줌
- plan/explore(readonly) 에이전트에서 기본 차단
- marker 누락/merge 이상징후에 대한 사전·사후 안전 가드 제공
- `tool.execute.after`에서 TUI 타이틀/메타데이터를 커스텀

## 핵심 구현 포인트

1. 단일 편집 툴 래퍼
- `index.ts`
- `morph_edit(target_filepath, instructions, code_edit)` 스키마를 노출하고, 코드 병합 책임을 API로 위임한다.

2. 입력 정규화
- `normalizeCodeEditInput`
- LLM이 `code_edit`를 markdown fence로 감싼 경우 외곽 fence를 제거해 merge 혼선을 줄인다.

3. Pre-flight guard
- marker 없는 대형 파일(`>10 lines`) 편집 시 전체 교체 위험을 감지해 차단한다.
- 작은 파일은 경고 로깅 후 진행한다.

4. Post-merge guard
- marker leakage guard: 원본에 없는 marker 문자열이 결과에 남으면 write 차단
- truncation guard: 문자 손실 >60% + 라인 손실 >50% 동시 발생 시 write 차단

5. 출력 UX 강화
- `diff` 패키지 기반 unified diff 생성
- `tool.execute.after`에서 성공/차단/실패 상태를 `Morph: ...` 형식 타이틀로 표시

## 장점

- 대형 파일/다중 지점 수정에서 편집 속도를 높이기 좋다.
- marker 기반 lazy edit로 exact-match 실패를 줄인다.
- 안전 가드(누락 marker, leakage, truncation)가 있어 파괴적 변경을 줄이는 편이다.
- 테스트(`index.test.ts`)가 guard/정규화 로직 중심으로 구성되어 있다.
- 실패 시 native `edit`로 우회 안내를 제공한다.

## 한계/주의점

1. 외부 API로 원문 전송
- 파일 전체 원문을 외부(Morph)로 보내므로, 민감 코드/비밀정보 취급 정책이 필요하다.

2. 파일 경로/권한 경계 검증 부족
- `target_filepath`가 절대경로면 그대로 사용된다.
- OpenCode permission 체계(`permission.bash` 유사 정책)와의 별도 통합이 없다.

3. 문자열 기반 후처리 의존
- `tool.execute.after`가 출력 문자열 정규식 파싱에 의존해 포맷이 바뀌면 타이틀 추론이 깨질 수 있다.

4. 모델/응답 스키마 결합
- Morph API 응답 구조(`choices[0].message.content`) 가정이 강해 API 변경 시 취약하다.

5. 편집 정확도의 외부 의존
- 핵심 merge 품질이 외부 모델 품질/가용성에 좌우되므로, 네트워크/서비스 장애면 작업이 즉시 실패한다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **“외부 merge provider + 로컬 안전 가드 + diff 가시화” 패턴은 채택 가치가 높다.** 다만 경로 권한 통제와 민감정보 보호를 먼저 강화해야 한다.

### 권장 적용안 (우선순위 순)

1. Provider-Abstraction 편집 엔진 (P0)
- 대상: 코드 수정 실행 계층
- 도입:
  - `native edit`와 `remote merge`를 동일 인터페이스로 라우팅
  - 파일 크기/변경 복잡도 기준 자동 선택

2. 강한 Safety Gate 확장 (P0)
- 대상: write 직전 검증기
- 도입:
  - leakage/truncation 외에 AST parse check, 테스트 파일 smoke check 추가
  - guard 실패 시 원자적 롤백 + 재시도 정책

3. Path/Permission Enforcement (P0)
- 대상: 파일 I/O 경계
- 도입:
  - workspace 바깥 절대경로 기본 차단
  - allowlist/denylist + 사용자 정책 연동

4. Privacy Redaction Layer (P1)
- 대상: remote merge 호출 전
- 도입:
  - 비밀정보/토큰 탐지 후 마스킹 또는 호출 거부
  - 고민감 파일(.env, secrets, key material) 원격 편집 금지

5. Structured Output Contract (P1)
- 대상: tool result schema
- 도입:
  - 문자열 파싱 대신 JSON 필드(`status`, `added`, `removed`, `duration`)를 표준화
  - UI는 구조화 필드를 직접 렌더링

### 권장하지 않는 적용

1. 원격 merge를 무조건 기본값으로 사용
- 작은 수정까지 외부 API에 의존하면 지연·비용·보안 리스크가 커진다.

2. 경로 검증 없는 절대경로 허용
- 의도치 않은 시스템 파일 수정 위험이 있다.

3. guard 없는 자동 write
- 모델 오동작 시 대규모 코드 손실 위험이 높다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS 편집 라우터에 `remote merge` provider 인터페이스 추가
2. workspace 경계/민감 파일 차단 규칙 구현
3. marker leakage + truncation 가드를 공통 검증기로 이식
4. 결과 포맷을 문자열에서 구조화 JSON으로 전환
5. 원격 편집 적용 전/후 감사 로그(요청 해시, 파일 범위, diff 요약) 설계
