# Dogfood Report: JARVIS Phase 9

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | dogfood-20260306-jarvis-phase9 |
| **Scope** | Notification noise dedupe, council reload recovery, settings notification policy visibility |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total Open Issues** | **0** |

## Validated Flows

1. `watcher hit dedupe`
   - Result: passed after fix
   - Evidence:
     - [phase9-rerun-with-notifications-start.png](screenshots/phase9-rerun-with-notifications-start.png)
     - [phase9-after-rerun-with-notifications-fix.png](screenshots/phase9-after-rerun-with-notifications-fix.png)
   - Validation:
     - same watcher was run twice with a 3.5s gap
     - notifications panel showed exactly one `Watcher Hit: <watcher>` line
     - live rerun result recorded `duplicateWatcherHitCount = 1`

2. `council reload recovery`
   - Result: passed
   - Evidence:
     - [phase9-council-before-reload.png](screenshots/phase9-council-before-reload.png)
     - [phase9-council-after-reload.png](screenshots/phase9-council-after-reload.png)
   - Validation:
     - council widget remained visible after reload
     - running council state remained visible after reload
     - no `jarvis session not found` error was shown
     - no `INTERNAL_ERROR` recovery failure was shown

3. `settings notification policy visibility`
   - Result: passed
   - Evidence:
     - [phase9-settings.png](screenshots/phase9-settings.png)
   - Validation:
     - settings page was reachable
     - in-app, webhook, and telegram channel rows were visible
     - exact `Notification Channels` heading string was not treated as a product issue because the policy rows themselves were present and readable

## Resolved During Phase

### RESOLVED-001: Manual watcher reruns emitted duplicate `Watcher Hit` notifications

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | functional |
| **URL** | http://127.0.0.1:3000/ |
| **Status** | resolved in phase9 |

**Observed before fix**

- Creating a watcher and clicking `RUN` twice a few seconds apart produced duplicate `Watcher Hit` notifications for the same watcher.
- This violated the intended dedupe/throttle behavior for operational notifications.

**Root cause**

- `emitWatcherHit()` already had the correct dedupe key shape.
- The dedupe window was only `1.2s`, which was shorter than the real user retry interval used during dogfooding.
- A second manual rerun after roughly `2.5s` bypassed suppression and emitted the same hit again.

**Fix applied**

- Increased watcher-hit dedupe window to `60s` while keeping the same dedupe key.
- Added regression coverage to ensure reruns after `2.5s` are still suppressed.

**Post-fix evidence**

- [phase9-rerun-with-notifications-start.png](screenshots/phase9-rerun-with-notifications-start.png)
- [phase9-after-rerun-with-notifications-fix.png](screenshots/phase9-after-rerun-with-notifications-fix.png)

## Conclusion

- Phase9 ends with `0` open issues.
- Notification dedupe, council reload recovery, and settings notification policy visibility are all validated on the live app.
