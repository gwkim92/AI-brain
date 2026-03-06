# Dogfood Report: JARVIS member approval flow

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | dogfood-20260306-jarvis-phase11 |
| **Scope** | member role `approval required -> reject -> approve` end-to-end |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Result

- `REJECT` path works: pending action clears and the session moves to blocked.
- `APPROVE` path works: the browser sends `POST /api/v1/jarvis/sessions/:sessionId/actions/:actionId/approve`, the action becomes `approved`, and the session completes.
- The earlier apparent failure was not an app bug. The dogfood helper script used a fuzzy locator, `getByRole('button', { name: 'APPROVE' })`, which matched the session card button titled `Approve process launch in Code Runtime` instead of the actual `APPROVE` action button.

## Evidence

- Initial stale-UI repro and member flow artifacts:
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase11/phase11-member-flow.json`
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase11/phase11-decisions.json`
- API-level confirmation of the false positive:
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase11/phase11-approve-api-debug.json`
- Exact-selector approval verification:
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase11/phase11-approve-exact.json`
- Representative screenshots:
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase11/screenshots/phase11-after-member-reject.png`
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase11/screenshots/phase11-after-member-approve.png`
  - `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase11/screenshots/phase11-approve-api-debug.png`

## Notes

- No product changes were required for this phase.
- Permanent in-repo Playwright coverage already uses the exact selector form:
  - `/Users/woody/ai/brain/web/e2e/sidebar-studio-navigation.spec.ts`
