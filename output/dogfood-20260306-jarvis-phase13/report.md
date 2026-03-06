# Dogfood Report: notification filtering and action-center deep-link

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | dogfood-20260306-jarvis-phase13 |
| **Scope** | notifications severity filter + `Open` link -> action center |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Result

- The notification card rendered an `ACTION PROPOSAL READY` warning.
- Switching the alerts widget to `critical` correctly hid the warning and showed the empty state.
- Switching back to `warning` restored the notification.
- The notification card `Open` link deep-linked into `Action Center` and selected the pending approval, including the correct `node -p process.platform` command.

## Evidence

- `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase13/phase13-notification-deeplink.json`
- `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase13/screenshots/phase13-notification-deeplink.png`
