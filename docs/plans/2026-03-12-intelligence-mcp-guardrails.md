# Autonomous Intelligence Plane MCP Guardrails

## 목적
- `Autonomous Intelligence Plane`의 auto-exec 범위를 무분별하게 넓히지 않고, connector capability와 policy 기반으로만 단계적으로 확장하기 위한 운영 기준이다.
- 이번 문서는 실행 범위를 늘리기 위한 구현이 아니라, 다음 tranche에서 사용할 승격 기준과 차단 규칙을 고정하는 용도다.

## 현재 허용 범위
- `task_create`
- `notification_emit`

두 경로 모두 `저위험`, `schema-normalized`, `destructive=false`, `requires_human=false` 조건을 만족하는 경우에만 auto-exec 후보가 된다.

## 확장 후보
아래는 검토 가능한 후보이며, 이번 tranche에서는 구현하지 않는다.

1. `notion_page_create`
- 신규 문서 생성
- 사전 승인된 workspace/database에 한정

2. `notion_comment_create`
- 기존 문서에 주석/코멘트 추가
- destructive write가 아니고 rollback이 쉬운 경우에 한정

3. `ticket_create`
- 승인된 issue tracker 또는 internal task system에 ticket 생성

4. `internal_webhook_emit`
- 명시적으로 allowlist된 사내 webhook만 허용

## connector capability 최소 조건
새 MCP write tool이 auto-exec 후보가 되려면 connector metadata가 최소 아래 필드를 가져야 한다.

- `write_allowed=true`
- `destructive=false`
- `requires_human=false`
- `schema_id` 존재
- `allowed_actions[]` 존재
- `legal_sensitive=false`
- `audit_enabled=true`

이 중 하나라도 빠지면 auto-exec 후보 생성 금지다.

## auto-exec 승격 조건
기존 event-level, graph-level, cluster-level gating을 모두 통과한 뒤 아래를 추가로 만족해야 한다.

1. connector capability가 `write_allowed=true`
2. payload가 `schema_id`에 맞게 정규화됨
3. `destructive=false`
4. `requires_human=false`
5. `legal_sensitive=false`
6. event가 social-only 근거가 아님
7. primary/counter hypothesis 둘 다 존재
8. expected signal 2개 이상 존재
9. graph contradiction / hotspot / cluster drift가 임계치 이하

## 필수 schema 규칙
- freeform text를 그대로 MCP write payload로 넘기지 않는다.
- 실행 후보는 반드시 typed payload를 가져야 한다.
- payload validation 실패 시 candidate는 삭제하지 않고 `blocked` 상태로 남긴다.
- `blocked_reason`에는 최소 다음 중 하나를 남긴다.
  - `missing_schema`
  - `requires_human`
  - `destructive_action`
  - `legal_sensitive`
  - `cluster_diverging`
  - `graph_contradiction`

## 자동 차단 규칙
아래 조건이면 tool 종류와 무관하게 auto-exec 금지다.

- `destructive=true`
- `requires_human=true`
- `legal_sensitive=true`
- connector가 allowlist 밖
- schema validation 실패
- event의 `graphHotspotCount > 0`
- event의 `graphContradictionScore`가 임계값 초과
- cluster state가 `diverging`
- 최근 7일 내 동일 cluster에서 blocked execution 2회 이상

## 법적/보안 민감 범주
아래 범주는 기본적으로 auto-exec 금지다.

- 권한/역할 변경
- 사용자 계정 상태 변경
- 삭제/파기
- 결제/청구/정산
- 법률/규제 문서 제출
- 외부 공개 상태 전환

이 범주들은 이후에도 `requires_human=true`를 기본값으로 둔다.

## 운영 TODO
1. connector capability registry에 `legal_sensitive`, `audit_enabled`를 강제할지 결정
2. policy engine에서 `blocked_reason` taxonomy를 enum으로 고정
3. `/intelligence` execution inbox에 `schema missing`, `requires human`, `legal sensitive` preset filter 추가
4. rollout 전 connector별 dry-run/receipt 저장 검토
