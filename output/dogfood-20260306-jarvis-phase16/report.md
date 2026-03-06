# Dogfood Report: external webhook severity policy

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:4100 (temporary backend) |
| **Session** | dogfood-20260306-jarvis-phase16 |
| **Scope** | local webhook sink + temporary backend severity threshold validation |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Result

- A local webhook sink on `127.0.0.1:4601` received real notification deliveries from a temporary backend on `127.0.0.1:4100`.
- With `NOTIFICATION_WEBHOOK_MIN_SEVERITY=critical`:
  - a member-generated `action_proposal_ready` warning event produced `webhook_count = 0`
- With `NOTIFICATION_WEBHOOK_MIN_SEVERITY=warning`:
  - the same warning event produced `webhook_count = 1`
  - the webhook payload contained:
    - `event = action_proposal_ready`
    - `notification.severity = warning`
    - `actionUrl = /?widget=action_center&focus=action_center&session=...`
- Telegram channel was not validated end-to-end in this phase because `TELEGRAM_BOT_TOKEN` / `NOTIFICATION_TELEGRAM_CHAT_ID` are not configured in the local environment.

## Evidence

- Critical threshold result:
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase16/critical-threshold-result.json`
- Warning threshold result:
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase16/warning-threshold-result.json`
- Delivered webhook payload:
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase16/webhook-received.ndjson`

## Notes

- An initial `fetch failed` during this phase was caused by the temporary sink process dying, not by product code. The sink was re-run in a persistent foreground session and the validation then passed.
