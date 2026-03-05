# opencode-background-agents 분석

## 기본 정보

- Git 주소: <https://github.com/kdcokenny/opencode-background-agents>
- 라이선스: MIT
- 마지막 확인 커밋: `6f7bf4bf1a8248ecacf7c8dd35d1bdf86b9b1e9c` (2026-03-02)
- 패키지 정보: 별도 `package.json` 없음(OCX 레지스트리 기반 배포 구조)

## 이 저장소가 하는 일

OpenCode에서 읽기 전용 에이전트 작업을 **백그라운드 비동기 위임**으로 실행하고, 결과를 디스크에 영속화하는 플러그인이다. 핵심 목표는 컨텍스트 압축(compaction) 이후에도 위임 결과를 잃지 않도록 `delegation_read`로 복원 가능하게 만드는 것이다.

## 핵심 구현 포인트

1. 비동기 위임 매니저
- `src/plugin/background-agents.ts`
- `delegate` 호출 시 별도 세션을 생성해 즉시 반환(fire-and-forget)하고 상태를 메모리 맵으로 추적한다.

2. 영속 저장 레이어
- `persistOutput`, `readOutput`, `listDelegations`
- 위임 결과를 `~/.local/share/opencode/delegations/<projectId>/<delegationId>.md`에 저장하고, 목록/재조회 기능을 제공한다.

3. 읽기 전용 에이전트 강제 라우팅
- `parseAgentWriteCapability`, `tool.execute.before`
- read-only 에이전트는 `delegate`, write-capable 에이전트는 native `task`를 쓰도록 강제해 undo/branching 불일치 위험을 줄인다.

4. 완료 알림 배치 모델
- `notifyParent`
- 위임 완료 시 부모 세션에 `task-notification`을 보내고, 여러 위임이 있을 때는 전체 완료 시점에 응답 트리거를 보낸다.

5. 세션 이벤트 기반 상태 전이
- `event` 훅 (`session.idle`, `message.updated`)
- sub-session idle 시 완료 처리/결과 수집을 수행하고 진행 상태를 갱신한다.

6. compaction 복구 컨텍스트 주입
- `experimental.session.compacting`
- 실행 중/최근 완료 위임 요약을 컨텍스트에 삽입해 압축 후에도 복구 경로를 유지한다.

7. 프로젝트 식별 안정화
- `src/plugin/kdco-primitives/get-project-id.ts`
- git root commit 기반 projectId를 계산해 worktree 간 공유 저장소 일관성을 확보한다.

8. 결과 메타데이터 자동 생성
- `generateMetadata`
- `small_model`이 있으면 title/description을 자동 생성해 `delegation_list` 가독성을 높인다.

## 장점

- 비동기 위임 결과를 디스크에 남겨 컨텍스트 손실 문제를 완화한다.
- 에이전트 권한에 따른 도구 사용 정책이 명시적이다(read-only vs write-capable).
- compaction 시 복구 안내를 자동 주입해 장기 세션 연속성이 좋다.
- 사람이 읽기 쉬운 delegation ID(형용사-색상-동물)로 운영 편의성이 높다.

## 한계/주의점

1. 배포 매니페스트 불일치 가능성
- `registry.json`은 `src/plugin/kdco-background-agents.ts`, `src/skill/...`를 참조하지만 실제 저장소에는 해당 경로가 보이지 않는다.

2. 테스트/패키징 정보 부족
- 저장소에 `package.json`/테스트 스위트가 없어서 로컬 검증/버전 의존성 확인이 어렵다.

3. 메모리 상태 의존 구간
- 실행 중 delegation 상태는 프로세스 메모리에 있으므로 프로세스 재시작 시 진행 상태 추적이 약해질 수 있다(완료 결과 파일은 유지).

4. LLM 응답 파싱 취약성
- 메타데이터 생성 시 JSON 추출 정규식 기반 파싱이어서 응답 포맷 편차에 취약할 수 있다.

5. read-only 판정 정책 의존
- 권한 스키마(`edit/write/bash`) 해석에 의존하므로 에이전트 정책 체계 변경 시 라우팅 규칙 점검이 필요하다.

## 우리 서비스(Brain/JARVIS)에 녹이는 방법

결론: **“비동기 위임 + 영속 저장 + 복구 주입” 패턴은 Brain/JARVIS에 직접 가치가 높다.** 특히 리서치형 서브에이전트 결과를 잃지 않는 구조를 빠르게 도입할 수 있다.

### 권장 적용안 (우선순위 순)

1. Delegation Storage 계층 도입 (P0)
- 위임 ID, 상태, 결과, 요약 메타데이터를 영속 저장하는 공통 저장소를 만든다.

2. Agent Capability Router 도입 (P0)
- read-only 작업과 write 작업을 런타임에서 분기해 안전한 실행 경로를 강제한다.

3. Completion Notification 프로토콜 도입 (P0)
- 비동기 작업 완료 시점에 배치 알림/최종 알림을 분리해 메인 세션 흐름을 안정화한다.

4. Context Recovery Injection (P1)
- compaction/재개 시 최근 위임 요약과 조회 명령 힌트를 자동 주입한다.

5. Metadata Summarizer 분리 (P1)
- 결과 title/description 생성을 별도 경량 모델 단계로 분리하고 실패 시 deterministic fallback을 둔다.

6. 상태 내구성 강화 (P1)
- 실행 중 delegation 상태도 메모리뿐 아니라 durable store에 체크포인트 저장한다.

### 권장하지 않는 적용

1. 권한 검증 없이 delegate/task 혼용
- undo/branching 일관성 깨짐으로 예기치 않은 변경 위험이 커진다.

2. 프로세스 메모리 상태만 신뢰
- 장애/재시작 시 running 상태 추적 손실로 운영 신뢰성이 떨어진다.

3. 매니페스트/소스 경로 검증 생략
- 레지스트리 참조 경로 불일치 시 설치 실패 가능성이 있다.

## 바로 실행 가능한 체크리스트

1. Brain/JARVIS delegation 데이터 모델 정의(ID/상태/결과/메타)
2. read-only vs write-capable 실행 라우터 정책 확정
3. completion 알림 프로토콜(개별 완료/전체 완료) 설계
4. compaction 복구 컨텍스트 주입 규격 정의
5. running 상태 durable checkpoint 저장 방식 결정
6. 외부 레지스트리 매니페스트와 실제 파일 경로 검증 자동화 추가
