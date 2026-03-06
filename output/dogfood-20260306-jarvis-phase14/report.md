# Dogfood Report: watcher alert to dossier deep-link

| Field | Value |
|-------|-------|
| **Date** | 2026-03-06 |
| **App URL** | http://127.0.0.1:3000 |
| **Session** | dogfood-20260306-jarvis-phase14 |
| **Scope** | admin watcher run -> alerts -> dossier drill-down |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Result

- Manual watcher execution emitted alert traffic (`watcher` and `briefing` notifications).
- Two `Open` links were present because both the watcher hit and the briefing notification pointed to the same generated dossier.
- The dossier surface reflected the new watcher query (`today world war latest developments`) after the run.
- The dossier view does not show the watcher title itself; it shows the research query/content. That is expected for the current UI and was not treated as a defect.

## Evidence

- `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase14/phase14-watcher-dossier-alert.json`
- `/Users/woody/ai/brain/output/dogfood-20260306-jarvis-phase14/screenshots/phase14-watcher-dossier-alert.png`
