# Dogfood Report: JARVIS Phase 8

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | dogfood-20260306-jarvis-phase8 |
| **Scope** | Notification -> dossier deep-link validation, command bar explicit council routing validation |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total Open Issues** | **0** |

## Validated Flows

1. `watcher hit -> notification -> dossier deep-link`
   - Result: passed
   - Evidence:
     - [phase8-notification-found.png](screenshots/phase8-notification-found.png)
     - [phase8-after-open-click.png](screenshots/phase8-after-open-click.png)
   - Validation:
     - notification `Open` link resolved to `/?widget=dossier&focus=dossier&dossier=...`
     - browser URL updated with the same `dossier` id
     - `Select a dossier to inspect sources and claims.` placeholder disappeared
     - dossier id token was visible in the archive/detail view
     - evidence panels such as `Source Coverage Map` were present

2. `command bar -> explicit Agent Council request`
   - Result: passed after fix
   - Evidence:
     - [phase8-council-after-4s.png](screenshots/phase8-council-after-4s.png)
     - [phase8-council-after-16s.png](screenshots/phase8-council-after-16s.png)
   - Validation:
     - command bar request created a `council` session instead of `general`
     - `AGENT COUNCIL` widget was open
     - assistant session progress showed `running · council`
     - session event showed `council.run.created: Council run prepared`
     - task queue contained `COUNCIL` tasks for the request
     - API polling confirmed the created council session converged to `completed`

## Resolved During Phase

### RESOLVED-001: Explicit Agent Council request was misrouted as general assistant

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional |
| **URL** | http://127.0.0.1:3000/ |
| **Status** | resolved in phase8 |

**Observed before fix**

- Prompt explicitly requested `Agent Council` execution.
- UI stayed in the generic assistant lane.
- Session event showed `Intent resolved as general`.
- Result content only imitated a council debate in plain assistant output.

**Root cause**

- Frontend HUD intent routing had no `council` intent.
- Backend jarvis intent routing had no `council` intent.
- Running Postgres schema still enforced `jarvis_sessions.intent IN ('general', 'code', 'research', 'finance', 'news')`, so real `council` sessions failed with `500 INTERNAL_ERROR` once routing code was added.

**Fix applied**

- Added explicit `council` intent detection in frontend and backend.
- Added `studio_council` HUD preset and quick-command council intake wiring.
- Routed jarvis council prompts into real council runs.
- Updated Postgres initializer to replace `jarvis_sessions_intent_check` with a version that includes `council`.

**Post-fix evidence**

- [phase8-council-after-4s.png](screenshots/phase8-council-after-4s.png)
- [phase8-council-after-16s.png](screenshots/phase8-council-after-16s.png)

## Conclusion

- Phase8 ends with `0` open issues.
- Both target flows are now validated on the live app.
