# Dogfood Report: JARVIS HUD Phase 4

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | jarvis-phase4 |
| **Scope** | Action Center approve/reject sync, Inbox alert counts, command bar complex request smoke |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |
| **Total** | **1** |

## Issues

### ISSUE-001: Inbox pending action summary stays stale after approve/reject in Action Center

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | functional |
| **URL** | http://127.0.0.1:3000 |
| **Repro Video** | /Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase4/videos/issue-001-repro.webm |
| **Status** | resolved |

**Description**

When a member approved or rejected a pending action in `Action Center`, the queue itself and the right-side approval counter updated immediately, but the `Inbox -> Pending Actions` tile kept showing the old count. The root cause was that `InboxModule` only refreshed on mount. `ActionCenterModule` refreshed its own state locally, but it did not broadcast a shared data-refresh signal, so `InboxModule` never re-fetched session approvals.

**Repro Steps**

1. Open the `Execution` lane and queue an approval-required workspace command.
   ![Step 1](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase4/screenshots/phase4-approve-before.png)

2. Open `Action Center` with `Inbox` still visible and confirm both areas show pending approvals.
   ![Step 2](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase4/screenshots/phase4-action-center-open.png)

3. Click `APPROVE` or `REJECT` on the selected action.
   ![Step 3](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase4/screenshots/phase4-approve-after.png)

4. **Observe:** `Action Center` and the right panel counts drop, but `Inbox -> Pending Actions` keeps the old count until another refresh path happens.
   ![Result](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase4/screenshots/phase4-approve-after.png)

**Resolution Evidence**

- Fix file: /Users/woody/ai/brain/web/src/components/modules/InboxModule.tsx
- Related emitters:
  - /Users/woody/ai/brain/web/src/components/modules/ActionCenterModule.tsx
  - /Users/woody/ai/brain/web/src/components/modules/WorkbenchModule.tsx
- Shared event helper: /Users/woody/ai/brain/web/src/lib/hud/data-refresh.ts
- Regression test: /Users/woody/ai/brain/web/e2e/sidebar-studio-navigation.spec.ts
- Live validation screenshot: /Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase4/screenshots/phase4-live-inbox-sync-after.png

## Additional Validation

- Command bar complex request (`이 저장소의 현재 상태를 점검하고...`) still opened `Assistant + Tasks` and streamed normally after the approval sync fix.
- Smoke evidence: /Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase4/screenshots/phase4-commandbar-complete.png
