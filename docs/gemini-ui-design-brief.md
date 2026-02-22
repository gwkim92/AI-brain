# Gemini UI Design Brief

문서 버전: v2.0  
작성일: 2026-02-22  
프로젝트: JARVIS Personal AI Operating System

## 1) 목적
Gemini가 이 문서만 읽고 아래 결과물을 바로 산출할 수 있게 한다.

1. 제품 정보구조(IA)
2. 핵심 사용자 플로우 5개
3. MVP 화면 12개(데스크톱 + 모바일)
4. 컴포넌트 스펙(상태 포함)
5. 개발 핸드오프 가능한 디자인 토큰
6. 신뢰/검증 UX(근거, 로그, 재현성) 설계

## 2) 제품 목표 (v2 재정의)
이 프로젝트는 생산성 자동화 앱이 아니라, 개인용 JARVIS형 운영체제를 목표로 한다.

1. 실행형 비서: 일정/메일/문서/리서치/자동화를 실제 실행한다.
2. 사고형 비서: 복잡한 질문을 멀티에이전트 회의로 분석하고 결론을 보고한다.
3. 엔지니어링 비서: 코딩, 리팩토링, 테스트, 디버깅, 실행 결과 비교를 지원한다.
4. 계산 비서: 복잡 수식, 시뮬레이션, 데이터 분석, 최적화 계산을 처리한다.
5. 운영형 비서: 장기 작업, 체크포인트 재개, 실패 복구, 주간 리포트를 제공한다.

## 3) 제품 원칙 (고정)
화면 설계에서 아래 원칙은 절대 변경하지 않는다.

1. 기본 실행 구조는 `Single Orchestrator`다.
2. `Multi-Agent Council`은 고난도/고불확실 작업에서만 동적으로 켠다.
3. 결제/삭제/외부발송/권한변경은 항상 `Human Approval Gate`를 통과한다.
4. 결론에는 근거가 필수다: 출처/실행로그/수식근거/코드 실행 결과를 연결해 보여준다.
5. 장기 작업은 `백그라운드 + 체크포인트 재개`를 전제로 한다.
6. 메모리는 `작업 단기 메모리`와 `장기 개인 메모리`를 분리한다.
7. 코드/연산 실행은 재현 가능해야 한다(입력/환경/결과 추적).
8. 시각적 멋보다 통제 가능성, 위험 가시성, 검증 가능성을 우선한다.

## 4) 시스템 컨텍스트 (UI에 반영)
UI는 아래 상태를 사용자가 이해 가능한 형태로 보여줘야 한다.

1. 요청 분류:
   `즉답 / 도구 실행 / 심층 회의 / 코드 작업 / 복잡 연산 / 장기 작업 / 고위험 작업`
2. 실행 단계:
   `Think -> Debate -> Do -> Verify -> Report`
3. 에이전트 회의 단계:
   `Planner -> Researcher -> Critic -> Risk -> Synthesizer`
4. 승인 상태:
   `pending / approved / rejected / expired`
5. 작업 상태:
   `queued / running / blocked / retrying / done / failed`
6. 검증 상태:
   `unverified / partially_verified / verified / contradiction_detected`

## 5) 대상 플랫폼
1. Desktop: 1440 기준
2. Mobile: 390 기준

## 6) 사용자
1. 1차 사용자: 개인 생산성 고도화 사용자(일정, 메일, 문서, 리서치 자동화)
2. 2차 사용자: 지식 노동자/기획자(복잡 질문, 의사결정용 회의 결과 필요)
3. 3차 사용자: 엔지니어/분석가(코딩, 테스트, 계산, 비교 분석)
4. 승인 책임자: 고위험 액션의 최종 승인자(기본적으로 같은 사용자 본인)

## 7) 정보구조 (IA)
최상위 내비게이션은 아래 6개를 유지한다.

1. Inbox (오늘 할 일, 대기 승인, 완료 요약)
2. Assistant (모드 전환: Chat / Council / Code / Compute)
3. Tasks (작업 목록/상세/체크포인트/아티팩트)
4. Approvals (고위험 승인 센터)
5. Memory (개인 메모리 관리)
6. Settings (연결, 보안, 정책, 평가)

## 8) MVP 화면 12개 스펙

### Screen 1. Onboarding & Connector Setup
목표: 초기 연결과 권한 설명을 통해 신뢰 형성.

필수 요소:
1. Connector 카드: Calendar, Mail, Notion, Files, Browser
2. 권한 스코프 설명(읽기/쓰기 분리 표시)
3. 최소권한 권장 배지
4. 실패 재시도 CTA
5. 완료 후 홈 이동 CTA

상태:
1. Empty (연결 전)
2. Connecting
3. Success
4. Error (OAuth 실패, 토큰 만료, 권한 부족)

### Screen 2. Home / Inbox
목표: 오늘 필요한 액션을 즉시 파악.

필수 요소:
1. Today Summary (예정, 마감, 자동화 리포트)
2. Pending Approvals 위젯
3. Running Tasks 위젯
4. Failed Tasks 위젯(재시도 버튼 포함)
5. Quick Ask 입력창

상태:
1. Empty (초기)
2. Normal
3. Busy
4. Error

### Screen 3. Assistant Chat + Execution View
목표: 대화와 실행 과정을 한 화면에서 확인.

필수 요소:
1. 모드 스위치: Chat / Council / Code / Compute
2. 메시지 영역
3. 실행 계획 패널 (현재 단계 강조)
4. 도구 호출 로그(툴명, 시간, 결과)
5. 근거/출처 패널
6. 모델/모드 배지 (single vs multi-agent)

상태:
1. Typing
2. Tool Running
3. Waiting Approval
4. Final Answer
5. Verification Warning

### Screen 4. Task List
목표: 작업 전체 현황 관리.

필수 요소:
1. 필터 (상태/위험도/날짜/작업유형)
2. 정렬 (최신/긴급/실패/비용)
3. 작업 카드 (상태, ETA, 비용, 마지막 이벤트)
4. 멀티 선택 재시도/취소

상태:
1. Empty
2. Populated
3. Error

### Screen 5. Task Detail + Checkpoints
목표: 장기 작업 가시성 및 복구.

필수 요소:
1. 목표/범위
2. 단계 타임라인
3. 체크포인트 리스트(복구 지점)
4. 산출물 아티팩트
5. 실패 원인 및 재시도 정책

상태:
1. Running
2. Blocked
3. Retry Scheduled
4. Completed
5. Failed

### Screen 6. Agent Council Room
목표: 동적 멀티에이전트 토론 과정을 투명하게 표시.

필수 요소:
1. 역할 탭: Planner, Researcher, Critic, Risk, Synthesizer
2. 주장/근거/신뢰도 카드
3. 반론 관계 표시
4. 최종 합의안 섹션
5. 라운드 카운터(최대 3라운드)

상태:
1. Not Activated
2. Round Active
3. Consensus Reached
4. Escalated to Human

### Screen 7. Approval Center
목표: 고위험 액션을 안전하게 승인/거절.

필수 요소:
1. 요청 카드 (무엇을, 누구에게, 어떤 영향)
2. 리스크 라벨 (low/medium/high/critical)
3. Undo 가능 여부
4. Approve / Reject / Edit 요청
5. 만료 타이머

상태:
1. Pending
2. Approved
3. Rejected
4. Expired

### Screen 8. Automation Builder
목표: 반복 작업 자동화 설정.

필수 요소:
1. 트리거 (시간/이벤트)
2. 작업 템플릿 선택
3. 성공/실패 후속 액션
4. 실행 미리보기
5. 활성/일시중지 토글

상태:
1. Draft
2. Active
3. Paused
4. Failed Last Run

### Screen 9. Memory Manager
목표: 장기 기억을 사용자 통제 하에 관리.

필수 요소:
1. 메모리 카테고리 (선호/사실/금지사항)
2. 각 메모리의 출처/신뢰도/TTL
3. 검색, 수정, 삭제
4. 자동저장 규칙 토글

상태:
1. Empty
2. Populated
3. Delete Confirm
4. Error

### Screen 10. Security, Connectors & Observability
목표: 연결 상태, 권한, 성능을 통합 확인.

필수 요소:
1. Connector 헬스 상태
2. OAuth scope 상세
3. 감사로그 검색
4. 성능 KPI (성공률, 비용, p95 지연)
5. 정책 위반/차단 이벤트

상태:
1. Healthy
2. Degraded
3. Incident

### Screen 11. Reasoning Report Studio
목표: 복잡 질문의 회의 결과를 구조적으로 보고.

필수 요소:
1. 질문 분해(가정/제약/평가기준)
2. 회의 요약(합의/비합의/쟁점)
3. 결론 카드(권고안, 대안, 리스크)
4. 근거 링크(출처/도구로그/실험결과)
5. 실행 권장 단계(즉시/보류/추가검증)

상태:
1. Drafting
2. Under Review
3. Finalized
4. Contradiction Detected

### Screen 12. Code & Compute Workbench
목표: 코딩/연산 작업을 안전하게 실행하고 결과를 비교.

필수 요소:
1. Code Editor + 실행 패널
2. 테스트/린트/빌드 결과 카드
3. 수식/연산 입력 패널 + 결과 시각화
4. 실행 환경 정보(런타임/버전/리소스)
5. 재현 토큰(입력, 파라미터, 결과 스냅샷)

상태:
1. Idle
2. Running
3. Verifying
4. Failed
5. Reproducible

## 9) 핵심 사용자 플로우 (필수 5개)

### Flow A: 일반 작업 실행
1. Inbox에서 요청 입력
2. Assistant 화면에서 실행 계획 확인
3. Tool 실행 진행 확인
4. 검증 완료된 결과 수신

### Flow B: 고위험 승인 작업
1. Assistant가 고위험 액션 감지
2. Approval Center로 이동
3. 영향 범위 확인
4. 승인 또는 거절
5. 실행 로그 확인

### Flow C: 복합/불확실 질문 회의
1. Router가 Council 모드 활성화
2. Council Room에서 라운드별 토론 표시
3. 합의안 생성
4. Reasoning Report Studio에서 최종 보고

### Flow D: 코딩 작업
1. Assistant에서 Code 모드 진입
2. 작업 계획 생성 및 코드 수정 제안
3. Workbench에서 테스트/린트/빌드 실행
4. 결과 검증 후 패치/요약 보고

### Flow E: 복잡 연산 작업
1. Assistant에서 Compute 모드 진입
2. 문제 분해/가정 설정
3. 연산 실행 및 결과 시각화
4. 검증 후 결론/한계/민감도 보고

## 10) 공통 컴포넌트 계약 (개발 핸드오프용)
아래 컴포넌트 이름을 디자인과 개발에서 동일하게 사용한다.

1. `TaskStatusBadge`
2. `RiskPill`
3. `ApprovalCard`
4. `ToolCallTimeline`
5. `EvidencePanel`
6. `CheckpointList`
7. `AgentArgumentCard`
8. `CouncilConsensusPanel`
9. `CodeExecutionPanel`
10. `ComputeResultPanel`
11. `MemoryItemRow`
12. `ConnectorHealthCard`
13. `KPIStatTile`
14. `ReproducibilityStamp`

각 컴포넌트는 아래 상태를 정의한다.
1. default
2. loading
3. empty
4. error
5. disabled
6. permission_denied
7. running
8. verifying

## 11) 디자인 토큰 요구사항
기본 화이트+퍼플 클리셰 금지. 전문가형 운영 콘솔 톤.

필수 토큰:
1. Color scale (neutral + semantic + risk + code + compute)
2. Typography scale (desktop/mobile 분리)
3. Spacing scale (4px grid)
4. Radius scale
5. Elevation scale
6. Motion tokens (duration/easing)

추가 지침:
1. 고위험 액션은 색/아이콘/문구 3중 강조.
2. 회의결과, 코드결과, 계산결과는 시각적으로 명확히 구분.
3. 모바일에서 핵심 4행동(질문/승인/작업확인/결과확인)을 3탭 이내 접근.

## 12) 접근성/국제화
1. WCAG 2.2 AA 대비 준수
2. 키보드만으로 핵심 동작 가능
3. 스크린리더 라벨 필수
4. 날짜/숫자/통화 포맷 locale 대응
5. 색상만으로 상태 전달 금지
6. 코드 블록과 수식 결과는 보조 텍스트 제공

## 13) Gemini 산출물 형식 (반드시 이 순서)
1. IA 다이어그램
2. 5개 사용자 플로우
3. 12개 화면 와이어프레임 설명(Desktop/Mobile 분리)
4. 컴포넌트 명세표
5. 상태 전이표
6. 디자인 토큰 표
7. 접근성 체크리스트
8. 신뢰/검증 UX 표준
9. 개발 핸드오프 메모

## 14) 완료 기준 (Definition of Done)
1. 모든 화면이 Empty/Loading/Error/Permission Denied 상태를 가진다.
2. 고위험 액션은 승인 게이트 없이 실행되는 경로가 없다.
3. Single/Multi-agent 전환이 화면에 명확히 노출된다.
4. Council/Code/Compute 진입 경로가 명확하다.
5. 결과 화면에 근거/로그/재현 정보가 연결된다.
6. Desktop/Mobile 모두에서 핵심 플로우 5개가 끊기지 않는다.

## 15) Gemini 입력용 최종 프롬프트 (복사해서 사용)
```text
You are a principal product designer.
Read the attached "Gemini UI Design Brief" and produce a complete UI design package for a 2026 JARVIS-style personal AI operating system.

Core mission:
- Not only productivity execution (calendar, mail, docs, research, automation),
- but also deep reasoning councils, coding workflows, and complex computation workflows.

Constraints:
- Keep core system principles unchanged.
- Prioritize trust, visibility, controllability, and reproducibility.
- Show high-risk actions through explicit approval UX.
- Support Desktop (1440) and Mobile (390).
- Include all mandatory screens, states, and flows.

Output format (strict):
1) IA
2) 5 user flows
3) 12 screen specs with desktop/mobile layouts
4) Component specs with states
5) State transition matrix
6) Design tokens
7) Accessibility checklist
8) Trust/verification UX standards
9) Dev handoff notes
```

