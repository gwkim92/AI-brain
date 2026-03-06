# Dogfood Report: stale approval session recovery

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | dogfood-20260306-jarvis-phase15 |
| **Scope** | forced stale pending-approval session -> action center + dashboard count |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Result

- A member approval-required workspace session was created successfully.
- After forcing `jarvis_sessions.updated_at` to 20 minutes in the past, the UI reflected stale state correctly:
  - `Action Center` showed `STALE 1`
  - the session card showed `stale`
  - the detail view showed `age 20m`
- `GET /api/v1/dashboard/overview` stayed aligned with the stale session:
  - `pending_approval_count = 1`
  - `pending_session_approval_count = 1`

## Evidence

- `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase15/phase15-stale-session.json`
- `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase15/screenshots/phase15-stale-session.png`
