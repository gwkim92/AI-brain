# opencode-md-table-formatter 분석

## 기본 정보

- Git 주소: <https://github.com/franlol/opencode-md-table-formatter>
- 라이선스: MIT
- 마지막 확인 커밋: `1c6d9ec3ecaf45f5ecc3afa71fc16c2625a60d4c` (2026-02-21)
- 확인 버전: `0.0.6` (`package.json`)

## 이 저장소가 하는 일

OpenCode 플러그인으로, 모델 응답 완료 시점에 Markdown 파이프 테이블(`| ... |`)을 자동 정렬한다. 목표는 OpenCode concealment 모드(마크다운 기호 숨김)에서 시각 폭 기준으로 열 정렬이 어긋나지 않게 만드는 것이다.

핵심 동작:
- `experimental.text.complete` 훅에서 전체 텍스트를 후처리
- 테이블 블록 탐지 후 separator/alignment(`:---`, `:---:`, `---:`)를 유지하며 패딩 재계산
- inline code(`\`...\``) 내부 마크다운은 보존하고, 일반 텍스트 마크다운 기호는 시각 폭 계산에서 제외
- 비정상 테이블 구조는 원문 유지 + 코멘트(`<!-- table not formatted: invalid structure -->`) 추가

## 핵심 구현 포인트

1. 단일 훅 후처리 구조
- `index.ts`
- `experimental.text.complete`에서 문자열을 직접 변환한다.

2. 테이블 유효성 검사
- `isTableRow`, `isSeparatorRow`, `isValidTable`
- 최소 2행/일관된 컬럼 수/separator 존재 여부를 검사한다.

3. 폭 계산 로직
- `getStringWidth`
- inline code를 placeholder로 보호한 뒤, non-code 영역의 `**`, `*`, `~~`, 링크/이미지 문법을 strip해 concealment 기준 display width를 계산한다.
- 최종 폭은 `Bun.stringWidth`로 측정한다.

4. 정렬 처리
- `formatTable`, `padCell`, `formatSeparatorCell`
- 컬럼 정렬값(left/center/right)과 최대 폭을 기준으로 데이터행/구분행을 재구성한다.

5. 간단 캐시
- `widthCache` + operation count
- 반복 문자열 폭 계산 비용을 줄이고, 임계치(연산 100회 또는 cache 1000개)에서 캐시를 초기화한다.

## 장점

- 사용자 개입 없이 테이블 가독성을 높인다.
- concealment 모드의 시각폭 차이를 고려한 로직이 포함돼 있다.
- 정렬/유효성/포맷팅 책임이 함수 단위로 분리돼 구조가 단순하다.
- 실패 시 플러그인 전체를 멈추지 않고 원문을 유지한다.

## 한계/주의점

1. 테스트 부재
- `package.json`의 `test` 스크립트는 실제 테스트 대신 실패 메시지를 출력한다.
- 회귀 검증 자동화가 없어 정규식 기반 변경 시 리스크가 크다.

2. 출력 오염 가능성
- 포맷 실패나 유효성 실패 시 HTML 코멘트를 응답 본문에 삽입한다.
- 다운스트림 파이프라인(예: 렌더러/파서)에서 원치 않는 노이즈가 될 수 있다.

3. 파싱 한계
- 파이프/백틱/중첩 문법이 복잡한 셀, 멀티라인 셀, HTML table은 지원하지 않는다.
- `isTableRow`가 라인 단위 규칙이라 비표준 케이스에서 오탐/누락이 가능하다.

4. Bun 런타임 의존
- `Bun.stringWidth`에 의존하므로 동일 로직을 Node-only 경로에 바로 이식하기 어렵다.

5. 대용량 텍스트 처리 비용
- 응답 텍스트 전체를 라인 단위로 순회하며 정규식 다중 패스를 수행한다.
- 긴 응답/다수 테이블에서 추가 지연이 생길 수 있다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: 아이디어 자체는 유용하지만, 프로덕션에는 **옵션형 formatter 모듈 + 안전한 파서 기반 처리**로 재구성해서 적용하는 편이 안전하다.

### 권장 적용안 (우선순위 순)

1. Formatter Toggle 도입 (P0)
- 대상: 응답 후처리 파이프라인
- 도입:
  - 테이블 포맷터를 feature flag로 제어
  - 실패 시 본문 수정 없이 pass-through(코멘트 삽입 금지)

2. 파서 기반 테이블 처리 (P0)
- 대상: markdown renderer/formatter 모듈
- 도입:
  - 정규식 대신 markdown AST 기반으로 테이블 노드만 처리
  - 코드 스팬/링크/이미지 처리를 안전하게 분기

3. 폭 계산 추상화 (P1)
- 대상: text-measure 유틸
- 도입:
  - 런타임 독립 인터페이스(`stringWidth`) 정의
  - Bun/Node 환경별 구현체 분리

4. Observability 추가 (P1)
- 대상: post-process metrics
- 도입:
  - 포맷 시도 수, 성공률, 평균 처리시간, 스킵 사유 수집

5. 회귀 테스트 세트 구축 (P1)
- 대상: formatter 모듈 테스트
- 도입:
  - 정렬, concealment, inline code, emoji, invalid table 케이스의 golden test 작성

### 권장하지 않는 적용

1. 오류를 본문 코멘트로 직접 노출
- 사용자 응답 품질을 떨어뜨린다.

2. 정규식 기반 구현을 그대로 핵심 경로에 배치
- 문법 edge case가 쌓일수록 유지보수 비용이 급증한다.

3. 런타임 종속 API(Bun 전용)를 공통 레이어에 직접 사용
- 환경 확장성과 테스트 용이성이 떨어진다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS에 table formatter 적용 범위(모든 응답/옵트인) 결정
2. markdown AST 기반 테이블 후처리 PoC 구현
3. 실패 시 pass-through 정책 및 로깅 규칙 정의
4. concealment/emoji/inline-code 케이스 golden test 작성
5. Bun/Node 겸용 string width abstraction 설계
