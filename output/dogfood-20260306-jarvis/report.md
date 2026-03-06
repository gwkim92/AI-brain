# Dogfood Report: Jarvis Local

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | jarvis-local |
| **Scope** | Authenticated HUD workflows: watchers, approvals, notifications, dossier archive |
| **Branch** | `codex/jarvis-checkpoint-20260306-council-followup` |

## Executive Summary

이 세션에서 처음 제기된 항목은 6건이었지만, 재검증 결과 2건은 false positive였고 4건만 실제 제품 이슈였습니다.

현재 정리:

| Bucket | Count |
|--------|-------|
| Initial reported findings | 6 |
| Removed false positives | 2 |
| Confirmed product issues | 4 |
| Resolved in current branch | 4 |
| **Open issues remaining from this batch** | **0** |

## False Positives Removed

### Removed-001: Login submit disabled
- 상태: false positive
- 이유: `agent-browser` 재현 경로에서 잘못 관측된 현상
- 재검증: Playwright 기반 실제 로그인 성공 확인
- 참고 증거:
  - `screenshots/playwright-login-start.png`
  - `screenshots/playwright-login-post.png`

### Removed-002: Signup submit disabled
- 상태: false positive
- 이유: 초기 도그푸딩 재현이 잘못되었고, 실제 폼은 정상 제출됨
- 재검증: Playwright 기반 실제 회원가입 성공 확인
- 참고 증거:
  - `screenshots/playwright-signup-filled.png`

## Confirmed Issues And Current Status

### ISSUE-003: Watchers `ADD` control silently no-op'd on invalid input

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional / ux |
| **Original URL** | http://127.0.0.1:3000/?widget=watchers |
| **Current Status** | resolved |

**Original problem**

Watchers 화면에서 title/query가 비어 있을 때 `ADD`를 눌러도 아무 반응이 없었습니다. 버튼은 활성 상태처럼 보이는데 실제로는 조용히 반환되어, 사용자는 생성 경로가 고장난 것으로 이해할 수 있었습니다.

**Fix**

- 빈 입력일 때 `ADD` 비활성화
- 인라인 helper / validation message 추가
- 입력이 채워지면 즉시 활성화

**Validation evidence**

- Empty state: `screenshots/validated/watchers-empty.png`
- Filled state: `screenshots/validated/watchers-filled.png`

---

### ISSUE-004: Action Center and HUD approval summary disagreed

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | data consistency / ux |
| **Original URL** | http://127.0.0.1:3000/?widget=action_center |
| **Current Status** | resolved |

**Original problem**

Action Center에는 pending approval session이 보이는데, 같은 화면의 HUD/RightPanel은 `PENDING APPROVALS 0 Req`로 표시했습니다. 원인은 두 화면이 서로 다른 데이터 원천을 보고 있었기 때문입니다.

**Fix**

- dashboard overview 신호에 `pending_session_approval_count` 추가
- RightPanel이 legacy proposal 수만 보지 않고 session approval 수까지 합산
- session approval은 Action Center deep-link로 따로 안내

**Validation evidence**

- Current screenshot: `screenshots/validated/rightpanel-approval-count.png`
- API regression:
  - `validation-results.json`
  - backend route test updated

---

### ISSUE-005: Notifications widget stuck in `CONNECTING`

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | streaming state / ux |
| **Original URL** | http://127.0.0.1:3000/?widget=notifications |
| **Current Status** | resolved |

**Original problem**

Notifications SSE stream이 실제로는 열려 있어도, 첫 이벤트가 오기 전까지 위젯 상태가 계속 `CONNECTING`으로 남았습니다. 따라서 운영자가 `조용한 상태`와 `고장 상태`를 구분할 수 없었습니다.

**Fix**

- SSE `open` 이벤트를 클라이언트에서 처리
- 연결 성공 후 이벤트가 아직 없으면 `idle`
- 실제 알림이 들어오면 `live`

**Validation evidence**

- Current screenshot: `screenshots/validated/notifications-state.png`

---

### ISSUE-006: Duplicate dossiers were hard to distinguish in archive

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | archive discoverability / ux |
| **Original URL** | http://127.0.0.1:3000/?widget=dossier |
| **Current Status** | resolved |

**Original problem**

같은 제목과 유사한 summary를 가진 dossier가 archive에 여러 개 있으면, 어떤 항목이 최신인지 즉시 구분하기 어려웠습니다.

**Fix**

- archive 카드에 `updated`
- `created`
- short `id`
- linked `session`
메타데이터를 추가

**Validation evidence**

- Current screenshot: `screenshots/validated/dossier-archive-meta.png`

---

## Validation Result

재검증 파일:
- `validation-results.json`

재검증 결과:
- `watchers_form_guard`: pass
- `notifications_state_transition`: pass
- `dossier_archive_metadata`: pass
- `rightpanel_approval_count`: pass

## Conclusion

이 도그푸딩 배치에서 실제로 남아 있던 제품 이슈 4건은 현재 브랜치에서 해결됐고, false positive 2건은 보고서에서 제거했습니다.
