# Dogfood Report: JARVIS HUD Phase 6

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | jarvis-phase6 |
| **Scope** | Research full lane `watcher -> run -> dossier list`, command/notification follow-up smoke |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 0 |
| **Total** | **1** |

## Issues

### ISSUE-001: Research full preset compresses widgets so hard that watcher actions overflow into neighboring widgets

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional |
| **URL** | http://127.0.0.1:3000/studio/research |
| **Repro Video** | N/A |
| **Status** | resolved |

**Description**

The `Research` full preset was opening too many widgets for the actual HUD work area. On a normal desktop viewport, that collapsed the lane into short tiles and the `Watchers` content overflowed below its widget boundary. The visible symptom was that `RUN` and related actions were no longer clickable because neighboring widget layers intercepted pointer events. The underlying causes were: tiling against the browser viewport instead of the real HUD viewport, allowing the research preset to open six widgets by default, and missing `min-h-0` / overflow constraints in the `Watchers` and `Dossier` modules.

**Repro Steps**

1. Open `/studio/research` and add a watcher in the `WATCHERS` widget.
   ![Step 1](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase6/screenshots/issue-001-dossier-list-blocked.png)

2. After the new watcher card appears, try to click `RUN`.
   ![Step 2](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase6/screenshots/issue-001-dossier-list-after-run.png)

3. **Observe:** the action area sits outside the effective widget tile, and adjacent widget layers intercept the click instead of the watcher action.
   ![Result](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase6/screenshots/issue-001-dossier-list-diagnostics.png)

**Resolution Evidence**

- Viewport-aware tiling: /Users/woody/ai/brain/web/src/lib/hud/widget-layout.ts
- Research preset reduced to core 4 widgets: /Users/woody/ai/brain/web/src/lib/hud/widget-presets.ts
- Preset open path uses measured HUD viewport:
  - /Users/woody/ai/brain/web/src/components/layout/Sidebar.tsx
  - /Users/woody/ai/brain/web/src/app/page.tsx
- Overflow hardening:
  - /Users/woody/ai/brain/web/src/components/modules/WatchersModule.tsx
  - /Users/woody/ai/brain/web/src/components/modules/DossierModule.tsx
- Regression coverage:
  - /Users/woody/ai/brain/web/e2e/sidebar-studio-navigation.spec.ts
- Live validation after fix:
  - /Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase6/screenshots/issue-001-after-fix.png

## Additional Validation

- `pnpm --dir /Users/woody/ai/brain/web exec tsc --noEmit` passed.
- `pnpm --dir /Users/woody/ai/brain/web exec playwright test e2e/sidebar-studio-navigation.spec.ts --project=chromium` passed (`7 passed`).
- Live validation confirmed `WATCHERS: ADD -> RUN` and `DOSSIERS: LIST` were both clickable after the fix.
