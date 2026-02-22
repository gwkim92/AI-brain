# Gemini UI Review Checklist

문서 버전: v2.0  
작성일: 2026-02-22  
프로젝트: JARVIS Personal AI Operating System  
대상 산출물: `/Users/woody/ai/brain/docs/gemini-ui-design-brief.md` 기반 Gemini 디자인 결과

## 1) 사용 방법
1. Gemini 산출물을 섹션 단위로 읽는다.
2. 각 항목을 `PASS / FAIL / N/A`로 표시한다.
3. `치명적 실패(Critical Fail)`가 1개라도 있으면 전체 결과는 FAIL이다.
4. 치명적 실패가 없으면 점수 합계로 승인 여부를 판단한다.

## 2) 치명적 실패 (Critical Fail)
아래 중 하나라도 해당하면 즉시 반려한다.

1. 고위험 액션(결제/삭제/외부발송/권한변경)에 승인 게이트가 없다.
2. Single/Multi-agent 전환 상태가 사용자에게 보이지 않는다.
3. 심층 회의(Council) 진입/결과 보고 화면이 없다.
4. 코딩/복잡 연산 실행 화면이 없다.
5. 결과에 근거/출처/실행로그/재현 정보가 없다.
6. Desktop 또는 Mobile 한쪽만 설계되어 있다.
7. Empty/Loading/Error/Permission Denied 상태가 공통적으로 누락되어 있다.

## 3) 점수 기준 (100점)

### A. 아키텍처 정합성 (20점)
1. 제품 원칙 8개를 위반하지 않는다. (8점)
2. IA가 Inbox/Assistant/Tasks/Approvals/Memory/Settings 6개를 포함한다. (4점)
3. 실행 단계(Think -> Debate -> Do -> Verify -> Report)가 UI에 반영된다. (4점)
4. Multi-Agent 단계(Planner/Researcher/Critic/Risk/Synthesizer)가 UI에 반영된다. (4점)

### B. 화면 완성도 (30점)
1. MVP 12개 화면이 모두 존재한다. (10점)
2. 각 화면의 필수 요소가 누락 없이 반영된다. (8점)
3. 각 화면에 상태(Empty/Loading/Error/Permission Denied)가 설계되어 있다. (8점)
4. Desktop 1440, Mobile 390 각각 레이아웃 차이가 설명된다. (4점)

### C. 확장 능력(회의/코드/연산) (25점)
1. Council Room + Reasoning Report Studio 흐름이 완결된다. (9점)
2. Code & Compute Workbench가 실행/검증/재현을 모두 다룬다. (10점)
3. 결과 화면에서 근거 연결(출처/로그/수식/실행결과)이 명확하다. (6점)

### D. 흐름/안전성 (15점)
1. Flow A(일반 실행) 완결성. (3점)
2. Flow B(고위험 승인) 완결성. (4점)
3. Flow C(심층 회의) 완결성. (3점)
4. Flow D(코딩) 완결성. (3점)
5. Flow E(복잡 연산) 완결성. (2점)

### E. 접근성/신뢰성 (10점)
1. WCAG 2.2 AA 기준을 충족하는 체크가 있다. (3점)
2. 키보드 포커스/스크린리더/대비 기준이 구체적이다. (3점)
3. 색상 외 리스크 전달 수단(텍스트/아이콘)이 있다. (2점)
4. 감사로그/정책 위반/실패 복구 UX가 명확하다. (2점)

승인 기준:
1. Critical Fail = 0
2. 총점 85점 이상

## 4) IA 검수 체크
1. 상위 메뉴가 정확히 6개인가.
2. Assistant에 `Chat/Council/Code/Compute` 모드가 노출되는가.
3. 승인/보안/메모리 메뉴가 부속이 아닌 1급 정보구조로 다뤄지는가.

## 5) 화면별 체크 (12개)

### Screen 1. Onboarding & Connector Setup
1. Connector 5종이 보이는가.
2. 읽기/쓰기 권한이 분리 표기되는가.
3. 최소권한 권장 UI가 있는가.
4. 연결 실패 재시도 경로가 있는가.

### Screen 2. Home / Inbox
1. Today Summary가 있는가.
2. Pending Approvals 위젯이 있는가.
3. Running/Failed Tasks 구분이 보이는가.
4. Quick Ask가 바로 보이는가.

### Screen 3. Assistant Chat + Execution View
1. 모드 스위치(Chat/Council/Code/Compute)가 있는가.
2. 대화 + 실행계획 + 도구로그 + 출처가 동시 확인 가능한가.
3. single vs multi-agent 모드 표시가 명확한가.
4. Waiting Approval 상태가 분명한가.

### Screen 4. Task List
1. 필터/정렬 기능이 보이는가.
2. 상태/ETA/비용/마지막 이벤트가 카드에 포함되는가.
3. 멀티 선택 액션(재시도/취소)이 가능한가.

### Screen 5. Task Detail + Checkpoints
1. 단계 타임라인이 있는가.
2. 체크포인트 복구 지점이 있는가.
3. 실패 원인 + 재시도 정책이 보이는가.

### Screen 6. Agent Council Room
1. 5개 역할이 모두 보이는가.
2. 주장/근거/신뢰도/반론 관계가 보이는가.
3. 라운드 제한(최대 3)과 종료 조건이 표현되는가.

### Screen 7. Approval Center
1. 요청 영향 범위(무엇/누구/영향)가 보이는가.
2. Risk 라벨과 만료 타이머가 있는가.
3. Approve/Reject/Edit 요청 액션이 있는가.
4. Undo 가능 여부가 명시되는가.

### Screen 8. Automation Builder
1. 트리거/템플릿/후속 액션/미리보기가 있는가.
2. Active/Pause 전환이 가능한가.
3. 실패한 최근 실행에 대한 피드백이 있는가.

### Screen 9. Memory Manager
1. 메모리 카테고리(선호/사실/금지사항)가 있는가.
2. 출처/신뢰도/TTL이 보이는가.
3. 수정/삭제/검색 경로가 있는가.

### Screen 10. Security, Connectors & Observability
1. Connector 상태가 보이는가.
2. OAuth scope 상세가 보이는가.
3. 감사로그 검색이 가능한가.
4. KPI(성공률/비용/p95 지연)가 보이는가.
5. 정책 위반/차단 이벤트가 보이는가.

### Screen 11. Reasoning Report Studio
1. 질문 분해(가정/제약/평가기준)가 보이는가.
2. 회의 합의/비합의/쟁점이 구조화되어 보이는가.
3. 결론과 대안, 리스크가 분리되어 보이는가.
4. 근거 링크(출처/로그/실험)가 따라붙는가.

### Screen 12. Code & Compute Workbench
1. 코드 실행(테스트/린트/빌드) UI가 존재하는가.
2. 연산 입력/결과 시각화 UI가 존재하는가.
3. 실행 환경 정보(버전/런타임) 노출이 있는가.
4. 재현 정보(입력/파라미터/스냅샷)가 제공되는가.

## 6) 상태 설계 체크
공통 상태가 모든 핵심 컴포넌트에 정의되어야 한다.

1. default
2. loading
3. empty
4. error
5. disabled
6. permission_denied
7. running
8. verifying

## 7) 컴포넌트 계약 체크
아래 컴포넌트 이름이 동일하게 사용되는지 확인한다.

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

검수 포인트:
1. Props가 상태/값/액션을 구분해 정의됐는가.
2. 에러/로딩 상태별 UI가 분리됐는가.
3. 모바일 축약 규칙이 정의됐는가.

## 8) 접근성 체크
1. 텍스트 대비가 WCAG AA를 만족하는가.
2. 포커스 순서가 시각 순서와 일치하는가.
3. 아이콘 버튼에 레이블이 있는가.
4. 상태 알림이 스크린리더에 전달되는가.
5. 색상만으로 의미를 전달하지 않는가.
6. 코드/수식 결과에 보조 텍스트가 있는가.

## 9) 반려 사유 템플릿
아래 형식으로 반려한다.

```text
[Reject] Gemini UI Package vX
Critical Fail: <항목 번호>
Reason: <한 문장>
Required Fix:
1) ...
2) ...
Re-review Scope: <재검수 범위>
```

## 10) 승인 사유 템플릿
아래 형식으로 승인한다.

```text
[Approve] Gemini UI Package vX
Score: <점수>/100
Critical Fail: 0
Strengths:
1) ...
2) ...
Follow-up (non-blocking):
1) ...
2) ...
```

## 11) 빠른 검수용 요약표
아래 14개만 먼저 확인해도 1차 판정이 가능하다.

1. IA 6개 메뉴 존재
2. Assistant 모드 4개(Chat/Council/Code/Compute)
3. MVP 12개 화면 존재
4. Desktop + Mobile 둘 다 있음
5. 승인 게이트 존재
6. Single/Multi 모드 표시
7. 출처/근거 표시
8. 실행 로그 표시
9. 재현 정보 표시
10. 상태(Empty/Loading/Error/Permission Denied)
11. Flow A/B/C/D/E 존재
12. 컴포넌트 계약 14개 존재
13. WCAG 2.2 AA 항목 존재
14. Dev handoff 메모 존재

