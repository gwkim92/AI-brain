# Linear Intake Dogfood

## Purpose

Validate the new product boundary:

- Linear is an external intake channel.
- JARVIS internal objects stay canonical.
- Routing is explicit.
- Runner is only downstream for code-delivery work.

## Test Issues

Create these three Linear issues in the `WOO` team.

### 1. Code Delivery

Title:

`Verify Inbox external work -> Code Task -> Runner handoff`

Body:

```md
Use the new External Work intake in Inbox.

Expected flow:
- Linear issue appears in Inbox external work
- Operator routes it to Code Task
- Task detail shows linked external work
- Runner can later pick up the internal task
- Runner detail shows the same linked external work
- Linear receives import comment and PR/handoff comment

Success means the issue is no longer acting as the canonical execution record.
The task and runner run inside JARVIS should be canonical.
```

Expected route:

- `Code Task`

### 2. Research Intake

Title:

`Verify Inbox external work -> Research Session`

Body:

```md
Use the new External Work intake in Inbox.

Expected flow:
- Linear issue appears in Inbox external work
- Operator routes it to Research Session
- Jarvis session is created with:
  - intent = research
  - primary target = assistant
  - workspace preset = research
- Session detail shows linked external work
- No runner execution is created automatically

Success means research work stays in the assistant/session lane and never gets forced into code delivery.
```

Expected route:

- `Research Session`

### 3. Decision Intake

Title:

`Verify Inbox external work -> Council Session`

Body:

```md
Use the new External Work intake in Inbox.

Expected flow:
- Linear issue appears in Inbox external work
- Operator routes it to Council Session
- Jarvis session is created with:
  - intent = council
  - primary target = council
  - workspace preset = control
- Session detail shows linked external work
- No council run starts automatically

Success means intake creates a council-intent session only.
The actual council run should remain a downstream execution step.
```

Expected route:

- `Council Session`

## Run Order

1. Sync Inbox external work.
2. Confirm all three Linear issues appear in `External Work`.
3. Route each issue into the expected lane.
4. Open the created task/session detail and verify `linked_external_work`.
5. For the code task only, continue downstream into runner.
6. Verify import comment and downstream comment appear back in Linear.

## Dogfood Checklist

### Inbox

- External Work loads without breaking the existing Inbox summary.
- Disabled state is clear when Linear credentials are missing.
- Sync works and refreshes cached Linear items.
- `new`, `imported`, `ignored`, and `sync_error` states render correctly.
- Action buttons are explicit and understandable without extra docs.

### Canonical Record Boundary

- Linear issue remains a reference, not the execution record.
- Task, mission, session, council run, and runner run are the canonical internal records.
- `linked_external_work` is visible on the internal detail surface.

### Routing

- `Code Task` creates a task in `mode=code`.
- `Code Mission` creates a mission in `domain=code`.
- `Research Session` creates a session with `intent=research`, `primaryTarget=assistant`.
- `Research Mission` creates a mission in `domain=research`.
- `Council Session` creates a session with `intent=council`, `primaryTarget=council`.
- `Ignore` does not create an internal object.

### Downstream Execution

- Code intake can later create a derived runner link.
- Council-intake session can later create a derived council run link.
- Research intake never auto-creates a runner run.
- Council intake never auto-starts a council run.

### Sync-back

- Import adds a Linear comment.
- Runner handoff adds a PR/handoff comment.
- Runner blocked/failed states add a status note.
- No sync-back happens for unrelated internal objects.

## Decisions To Make After Dogfood

### 1. Routing Copy

Decide whether the current action labels are final:

- `Code Task`
- `Code Mission`
- `Research Session`
- `Research Mission`
- `Council Session`
- `Ignore`

### 2. Auto-Routing Candidates

Do not automate yet. After dogfood, only consider automation for clearly bounded cases:

- label contains `code` or `bug` -> suggest `Code Task`
- label contains `research` -> suggest `Research Session`
- label contains `decision` or `priority` -> suggest `Council Session`

Keep these as suggestions first, not automatic imports.

### 3. Runner Policy

Keep this default:

- `RUNNER_LINEAR_DIRECT_ENABLED=false`

Only revisit direct Linear -> runner if the product intentionally becomes issue-driven delivery-first, which is not the current model.

## Exit Criteria

This dogfood pass is complete when:

- All three issue classes route cleanly.
- Internal detail pages consistently show `linked_external_work`.
- The code-delivery lane reaches runner without reintroducing Linear as canonical state.
- The team agrees on which routing actions should stay manual and which can become suggestions later.
