# Dogfood Report: notification policy and settings visibility

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | dogfood-20260306-jarvis-phase12 |
| **Scope** | member action proposal -> notifications widget -> settings channel policy |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Result

- A member-generated `action_proposal_ready` event appeared in the `Notifications` widget as a `WARNING`.
- `System Settings` exposed the `Notification Channels` section in the UI.
- `GET /api/v1/settings/overview` returned the expected notification policy/runtime blocks:
  - `notification_policy.in_app.enabled = true`
  - `notification_policy.webhook.enabled = false`
  - `notification_policy.telegram.enabled = false`
  - `notification_runtime.listeners = 1`

## Evidence

- `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase12/phase12-notification-policy.json`
- `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase12/screenshots/phase12-notification-policy.png`
