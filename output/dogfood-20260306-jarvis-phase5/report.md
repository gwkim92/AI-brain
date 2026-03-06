# Dogfood Report: JARVIS HUD Phase 5

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | jarvis-phase5 |
| **Scope** | Research lane watcher creation, `/studio/research` preset layout, live watcher create validation |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 0 |
| **Total** | **1** |

## Issues

### ISSUE-001: Research preset opens overlapping widgets and blocks `Watchers -> ADD`

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional |
| **URL** | http://127.0.0.1:3000/studio/research |
| **Repro Video** | /Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase5/videos/be285977a466a40488ff4559656e8249.webm |
| **Status** | resolved |

**Description**

The `Research` workspace was reopening widgets with previously persisted positions and focusing the `dossier` layer on top. In that state, the `Watchers` form looked available, but the `ADD` button could not be clicked because another widget subtree intercepted pointer events. The failure reproduced both in the real app and in the redirected `/studio/research` preset path. The fix was to treat workspace presets as explicit layouts: tile preset widgets on open and make `watchers` the focused primary widget for the research lane.

**Repro Steps**

1. Open the `Research` lane or navigate to `/studio/research`.
   ![Step 1](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase5/screenshots/phase5-research-open.png)

2. Fill `Watcher title` and `What should Jarvis monitor?` in the `WATCHERS` widget.
   ![Step 2](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase5/screenshots/phase5-watcher-before-add.png)

3. Click `ADD`.
   ![Step 3](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase5/screenshots/phase5-watcher-before-add.png)

4. **Observe:** before the fix, the click timed out because another widget intercepted pointer events; after the fix, the watcher is created and appears in the list.
   ![Result](/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase5/screenshots/phase5-watcher-after-fix.png)

**Resolution Evidence**

- Preset focus/order: /Users/woody/ai/brain/web/src/lib/hud/widget-presets.ts
- Workspace tiling on preset open: /Users/woody/ai/brain/web/src/components/layout/Sidebar.tsx
- Workspace tiling on URL-driven preset restore: /Users/woody/ai/brain/web/src/app/page.tsx
- Regression test and stable research mocks: /Users/woody/ai/brain/web/e2e/sidebar-studio-navigation.spec.ts

## Additional Validation

- `pnpm --dir /Users/woody/ai/brain/web exec tsc --noEmit` passed.
- `pnpm --dir /Users/woody/ai/brain/web exec playwright test e2e/sidebar-studio-navigation.spec.ts --project=chromium` passed (`7 passed`).
- Live validation confirmed watcher creation succeeded after the fix and produced:
  - /Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase5/screenshots/phase5-watcher-after-fix.png
