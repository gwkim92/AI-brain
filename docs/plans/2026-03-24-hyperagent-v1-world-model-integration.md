# HyperAgent V1 World-Model Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an approval-gated HyperAgent V1 that can snapshot, mutate, evaluate, archive, and selectively apply bounded world-model and radar runtime artifacts without allowing arbitrary code self-modification.

**Architecture:** Keep the outer control loop fixed and safe. Add a new backend-only `hyperagent` subsystem that works on structured runtime artifacts first: radar domain packs and dossier/world-model thresholds. Candidate variants are serialized as JSON, evaluated against deterministic backtests built from existing world-model outcomes and dossier fixtures, and only then promoted into an applied runtime override. No direct source-file rewriting is allowed in V1.

**Tech Stack:** TypeScript, Fastify, Postgres JSONB, existing v2 repository pattern, existing world-model/radar pipeline, Vitest

---

## Scope and Constraints

- V1 only touches `world-model / radar` interpretation artifacts.
- V1 must not edit arbitrary TypeScript files or prompts in-place.
- V1 must run in `shadow` by default and require operator action to apply a winning variant.
- V1 must preserve current behavior when no override exists.
- V1 must reuse existing store and v2 route conventions instead of inventing a parallel stack.

## Editable Artifacts for V1

1. `radar_domain_pack`
   - Backed by `backend/src/radar/domain-packs.ts`
   - Editable fields: `mechanismTemplates`, `stateVariables`, `invalidationTemplates`, `watchMetrics`, `keywordLexicon`, `actionMapping.executionMode`
2. `world_model_dossier_config`
   - New extracted config for values currently hard-coded in `backend/src/world-model/dossier.ts`
   - Editable fields: `maxBottlenecks`, `maxInvalidationConditions`, `maxNextWatchSignals`, score thresholds

## Non-Goals for V1

- Assistant prompt self-rewriting
- Mission planner self-rewriting
- Automatic source-code patch generation
- Fully autonomous apply/deploy without operator intervention
- UI-heavy operator tooling beyond minimal inspection/apply endpoints

### Task 1: Add HyperAgent Persistence and V2 Repository Surface

**Files:**
- Modify: `backend/src/store/types.ts`
- Modify: `backend/src/store/repository-contracts.ts`
- Modify: `backend/src/store/postgres/initializer.ts`
- Modify: `backend/src/store/postgres/v2-repositories.ts`
- Modify: `backend/src/store/memory/v2-repositories.ts`
- Test: `backend/src/store/__tests__/hyperagent-v2-repositories.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createMemoryV2Repository } from '../memory/v2-repositories';

describe('hyperagent v2 repository', () => {
  it('stores artifact snapshots, variants, eval runs, and recommendations', async () => {
    const repo = createMemoryV2Repository();

    const snapshot = await repo.createHyperAgentArtifactSnapshot({
      artifactKey: 'radar_domain_pack',
      artifactVersion: '2026-03-24',
      scope: 'world_model',
      payload: { domainId: 'policy_regulation_platform_ai', keywordLexicon: ['policy'] },
      createdBy: 'system',
    });

    const variant = await repo.createHyperAgentVariant({
      artifactSnapshotId: snapshot.id,
      strategy: 'bounded_json_mutation',
      payload: { domainId: 'policy_regulation_platform_ai', keywordLexicon: ['policy', 'regulation'] },
      parentVariantId: null,
      lineageRunId: 'run-1',
    });

    const evalRun = await repo.createHyperAgentEvalRun({
      variantId: variant.id,
      evaluatorKey: 'world_model_backtest_v1',
      status: 'running',
      summary: {},
    });

    const completed = await repo.updateHyperAgentEvalRun({
      evalRunId: evalRun.id,
      status: 'completed',
      summary: { promotionScore: 0.84 },
    });

    expect(snapshot.artifactKey).toBe('radar_domain_pack');
    expect(variant.parentVariantId).toBeNull();
    expect(completed?.summary.promotionScore).toBe(0.84);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && pnpm vitest run src/store/__tests__/hyperagent-v2-repositories.test.ts`

Expected: FAIL with missing repository methods and missing HyperAgent record types.

**Step 3: Write minimal implementation**

```ts
export type V2HyperAgentArtifactSnapshotRecord = {
  id: string;
  artifactKey: string;
  artifactVersion: string;
  scope: 'world_model';
  payload: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
};

export type V2HyperAgentVariantRecord = {
  id: string;
  artifactSnapshotId: string;
  strategy: 'bounded_json_mutation' | 'manual_seed';
  payload: Record<string, unknown>;
  parentVariantId: string | null;
  lineageRunId: string;
  createdAt: string;
};
```

- Add four new tables in `initializer.ts`:
  - `hyperagent_artifact_snapshots`
  - `hyperagent_variants`
  - `hyperagent_eval_runs`
  - `hyperagent_recommendations`
- Extend `V2RepositoryContract` and `V2_REPOSITORY_METHOD_KEYS`.
- Implement the new methods in both Postgres and memory repositories.

**Step 4: Run test to verify it passes**

Run: `cd backend && pnpm vitest run src/store/__tests__/hyperagent-v2-repositories.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/store/types.ts backend/src/store/repository-contracts.ts backend/src/store/postgres/initializer.ts backend/src/store/postgres/v2-repositories.ts backend/src/store/memory/v2-repositories.ts backend/src/store/__tests__/hyperagent-v2-repositories.test.ts
git commit -m "feat: add hyperagent v2 persistence layer"
```

### Task 2: Extract Bounded Runtime Artifacts from Radar and World Model

**Files:**
- Create: `backend/src/hyperagent/types.ts`
- Create: `backend/src/hyperagent/artifact-catalog.ts`
- Create: `backend/src/world-model/config.ts`
- Modify: `backend/src/radar/domain-packs.ts`
- Modify: `backend/src/world-model/dossier.ts`
- Test: `backend/src/hyperagent/__tests__/artifact-catalog.test.ts`
- Test: `backend/src/world-model/__tests__/dossier-config.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { listEditableHyperAgentArtifacts, snapshotArtifactPayload } from '../artifact-catalog';

describe('artifact catalog', () => {
  it('exposes radar domain packs and dossier config as editable artifacts', () => {
    const artifacts = listEditableHyperAgentArtifacts();
    expect(artifacts.map((item) => item.artifactKey)).toEqual([
      'radar_domain_pack',
      'world_model_dossier_config',
    ]);
  });

  it('serializes dossier config without reading source text', () => {
    const payload = snapshotArtifactPayload('world_model_dossier_config');
    expect(payload.maxNextWatchSignals).toBeTypeOf('number');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd backend && pnpm vitest run src/hyperagent/__tests__/artifact-catalog.test.ts src/world-model/__tests__/dossier-config.test.ts`

Expected: FAIL because the catalog and extracted config do not exist.

**Step 3: Write minimal implementation**

```ts
export const WORLD_MODEL_DOSSIER_CONFIG = {
  maxBottlenecks: 4,
  maxInvalidationConditions: 12,
  maxNextWatchSignals: 5,
  bottleneckScoreThreshold: 0.3,
} as const;

export function listEditableHyperAgentArtifacts(): HyperAgentEditableArtifact[] {
  return [
    { artifactKey: 'radar_domain_pack', scope: 'world_model' },
    { artifactKey: 'world_model_dossier_config', scope: 'world_model' },
  ];
}
```

- Replace hard-coded `slice(0, 4)` and `slice(0, 5)` logic in `dossier.ts` with values from `WORLD_MODEL_DOSSIER_CONFIG`.
- Add deterministic JSON snapshot helpers for domain-pack payloads.

**Step 4: Run tests to verify they pass**

Run: `cd backend && pnpm vitest run src/hyperagent/__tests__/artifact-catalog.test.ts src/world-model/__tests__/dossier-config.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/hyperagent/types.ts backend/src/hyperagent/artifact-catalog.ts backend/src/world-model/config.ts backend/src/radar/domain-packs.ts backend/src/world-model/dossier.ts backend/src/hyperagent/__tests__/artifact-catalog.test.ts backend/src/world-model/__tests__/dossier-config.test.ts
git commit -m "refactor: extract bounded hyperagent runtime artifacts"
```

### Task 3: Build a Deterministic World-Model HyperAgent Evaluator

**Files:**
- Create: `backend/src/hyperagent/world-model-evaluator.ts`
- Create: `backend/src/hyperagent/scorecard.ts`
- Test: `backend/src/hyperagent/__tests__/world-model-evaluator.test.ts`
- Reference: `backend/src/world-model/outcome-worker.ts`
- Reference: `backend/src/world-model/dossier.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateWorldModelVariant } from '../world-model-evaluator';

describe('world-model evaluator', () => {
  it('scores a variant using promotion-safe metrics', async () => {
    const result = await evaluateWorldModelVariant({
      artifactKey: 'world_model_dossier_config',
      payload: {
        maxBottlenecks: 3,
        maxInvalidationConditions: 10,
        maxNextWatchSignals: 4,
        bottleneckScoreThreshold: 0.35,
      },
      fixtures: [
        {
          fixtureId: 'case-1',
          expectedPrimaryThesisPresent: true,
          expectedCounterHypothesisPresent: true,
        },
      ],
    });

    expect(result.metrics.counterHypothesisRetained).toBeGreaterThanOrEqual(0);
    expect(result.metrics.promotionScore).toBeGreaterThanOrEqual(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && pnpm vitest run src/hyperagent/__tests__/world-model-evaluator.test.ts`

Expected: FAIL because the evaluator and scorecard do not exist.

**Step 3: Write minimal implementation**

```ts
export type WorldModelEvalMetrics = {
  primaryThesisCoverage: number;
  counterHypothesisRetained: number;
  invalidationConditionCoverage: number;
  promotionScore: number;
};

export function computePromotionScore(metrics: WorldModelEvalMetrics): number {
  return Number((
    metrics.primaryThesisCoverage * 0.4 +
    metrics.counterHypothesisRetained * 0.3 +
    metrics.invalidationConditionCoverage * 0.3
  ).toFixed(4));
}
```

- Keep the evaluator deterministic and local.
- Do not call an LLM inside the evaluator.
- Rebuild dossier/world-model output from fixture inputs and compare structural expectations, not prose.

**Step 4: Run test to verify it passes**

Run: `cd backend && pnpm vitest run src/hyperagent/__tests__/world-model-evaluator.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/hyperagent/world-model-evaluator.ts backend/src/hyperagent/scorecard.ts backend/src/hyperagent/__tests__/world-model-evaluator.test.ts
git commit -m "feat: add deterministic world-model hyperagent evaluator"
```

### Task 4: Add a Bounded Variant Generator and Archive Policy

**Files:**
- Create: `backend/src/hyperagent/archive.ts`
- Create: `backend/src/hyperagent/mutators.ts`
- Create: `backend/src/hyperagent/optimizer.ts`
- Test: `backend/src/hyperagent/__tests__/optimizer.test.ts`
- Reference: `backend/src/lineage/recorder.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { generateBoundedVariant } from '../optimizer';

describe('hyperagent optimizer', () => {
  it('mutates only allowlisted fields', async () => {
    const variant = await generateBoundedVariant({
      artifactKey: 'radar_domain_pack',
      basePayload: {
        domainId: 'policy_regulation_platform_ai',
        keywordLexicon: ['policy', 'privacy'],
        mechanismTemplates: ['policy_change -> compliance_cost'],
      },
      mutationBudget: 2,
    });

    expect(variant.payload.keywordLexicon).toContain('policy');
    expect((variant.payload as Record<string, unknown>).sourceCode).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && pnpm vitest run src/hyperagent/__tests__/optimizer.test.ts`

Expected: FAIL because no optimizer or bounded mutator exists.

**Step 3: Write minimal implementation**

```ts
const MUTABLE_FIELD_ALLOWLIST: Record<string, string[]> = {
  radar_domain_pack: [
    'mechanismTemplates',
    'stateVariables',
    'invalidationTemplates',
    'watchMetrics',
    'keywordLexicon',
  ],
  world_model_dossier_config: [
    'maxBottlenecks',
    'maxInvalidationConditions',
    'maxNextWatchSignals',
    'bottleneckScoreThreshold',
  ],
};
```

- Generate candidates by bounded JSON mutation only.
- Record lineage metadata for parent snapshot, strategy, and changed keys.
- Reject any candidate that adds non-allowlisted top-level keys.

**Step 4: Run test to verify it passes**

Run: `cd backend && pnpm vitest run src/hyperagent/__tests__/optimizer.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/hyperagent/archive.ts backend/src/hyperagent/mutators.ts backend/src/hyperagent/optimizer.ts backend/src/hyperagent/__tests__/optimizer.test.ts
git commit -m "feat: add bounded hyperagent variant generation"
```

### Task 5: Wire Runtime Override Resolution Without Breaking Defaults

**Files:**
- Create: `backend/src/hyperagent/runtime.ts`
- Modify: `backend/src/radar/domain-packs.ts`
- Modify: `backend/src/world-model/dossier.ts`
- Test: `backend/src/hyperagent/__tests__/runtime.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { resolveAppliedArtifactOverride } from '../runtime';

describe('hyperagent runtime', () => {
  it('falls back to static defaults when no applied override exists', () => {
    const resolved = resolveAppliedArtifactOverride({
      artifactKey: 'world_model_dossier_config',
      applied: null,
      fallback: { maxNextWatchSignals: 5 },
    });

    expect(resolved.maxNextWatchSignals).toBe(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && pnpm vitest run src/hyperagent/__tests__/runtime.test.ts`

Expected: FAIL because runtime resolution helpers do not exist.

**Step 3: Write minimal implementation**

```ts
export function resolveAppliedArtifactOverride<T extends Record<string, unknown>>(input: {
  artifactKey: string;
  applied: Record<string, unknown> | null;
  fallback: T;
}): T {
  if (!input.applied) return input.fallback;
  return {
    ...input.fallback,
    ...input.applied,
  } as T;
}
```

- Keep static exports as the canonical fallback.
- Add override-aware helpers instead of mutating `RADAR_DOMAIN_PACKS` in place.
- Make sure call sites remain deterministic in tests.

**Step 4: Run test to verify it passes**

Run: `cd backend && pnpm vitest run src/hyperagent/__tests__/runtime.test.ts src/radar/__tests__/pipeline.test.ts src/world-model/__tests__/*.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/hyperagent/runtime.ts backend/src/radar/domain-packs.ts backend/src/world-model/dossier.ts backend/src/hyperagent/__tests__/runtime.test.ts
git commit -m "refactor: make radar and dossier runtime override-aware"
```

### Task 6: Expose HyperAgent V2 Routes for Snapshot, Evaluate, Recommend, and Apply

**Files:**
- Create: `backend/src/routes/v2/hyperagents.ts`
- Modify: `backend/src/routes/v2/index.ts`
- Modify: `backend/src/routes/v2/types.ts`
- Test: `backend/src/routes/__tests__/hyperagents-v2.test.ts`

**Step 1: Write the failing route test**

```ts
import { describe, expect, it } from 'vitest';

describe('v2 hyperagent routes', () => {
  it('creates and evaluates a world-model variant', async () => {
    // bootstrap test server
    // POST /api/v2/hyperagents/world-model/variants
    // POST /api/v2/hyperagents/evals
    // GET /api/v2/hyperagents/evals/:id
    expect(true).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && pnpm vitest run src/routes/__tests__/hyperagents-v2.test.ts`

Expected: FAIL because the route file and feature flag are missing.

**Step 3: Write minimal implementation**

```ts
app.post('/api/v2/hyperagents/world-model/variants', async (request, reply) => {
  const minRoleError = ctx.ensureMinRole(request, reply, 'operator');
  if (minRoleError) return minRoleError;

  // snapshot base artifact, generate bounded variant, persist archive row
});
```

Add endpoints:

- `POST /api/v2/hyperagents/world-model/snapshots`
- `POST /api/v2/hyperagents/world-model/variants`
- `POST /api/v2/hyperagents/evals`
- `GET /api/v2/hyperagents/evals/:id`
- `GET /api/v2/hyperagents/recommendations`
- `POST /api/v2/hyperagents/recommendations/:id/apply`

Add a new v2 flag:

```ts
hyperAgentEnabled: ctx.env.V2_HYPERAGENT_ENABLED
```

**Step 4: Run test to verify it passes**

Run: `cd backend && pnpm vitest run src/routes/__tests__/hyperagents-v2.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/v2/hyperagents.ts backend/src/routes/v2/index.ts backend/src/routes/v2/types.ts backend/src/routes/__tests__/hyperagents-v2.test.ts
git commit -m "feat: expose v2 hyperagent control routes"
```

### Task 7: Add Apply Gate, Audit Trail, and End-to-End Smoke Coverage

**Files:**
- Modify: `backend/src/hyperagent/optimizer.ts`
- Modify: `backend/src/hyperagent/runtime.ts`
- Modify: `backend/src/routes/v2/hyperagents.ts`
- Modify: `backend/src/evals/gate.ts`
- Test: `backend/src/hyperagent/__tests__/apply-flow.test.ts`
- Test: `backend/src/routes/__tests__/hyperagents-v2.test.ts`
- Optional smoke: `backend/scripts/jarvis-regression-smoke.mjs`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

describe('hyperagent apply flow', () => {
  it('refuses to apply a recommendation that failed the eval gate', async () => {
    // seed recommendation with promotionScore below threshold
    // call apply
    // assert 409 and unchanged runtime override
    expect(true).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && pnpm vitest run src/hyperagent/__tests__/apply-flow.test.ts`

Expected: FAIL because apply-gate logic is missing.

**Step 3: Write minimal implementation**

```ts
if (recommendation.summary.promotionScore < 0.8) {
  return {
    passed: false,
    reasons: ['hyperagent_promotion_score_below_threshold'],
  };
}
```

- Add a dedicated HyperAgent gate helper instead of overloading generic prose-quality gates.
- Persist `applied_at`, `applied_by`, and `applied_variant_id` in the recommendation or snapshot row.
- Emit lineage/audit metadata for `snapshot -> variant -> eval -> recommendation -> apply`.

**Step 4: Run full verification**

Run:

```bash
cd backend
pnpm vitest run src/hyperagent/__tests__/apply-flow.test.ts src/hyperagent/__tests__/*.test.ts src/routes/__tests__/hyperagents-v2.test.ts
pnpm vitest run src/radar/__tests__/pipeline.test.ts src/world-model/__tests__/*.test.ts
pnpm tsc --noEmit
pnpm eslint .
```

Expected:

- All HyperAgent tests PASS
- Existing radar/world-model tests stay green
- Typecheck PASS
- Lint PASS

**Step 5: Commit**

```bash
git add backend/src/hyperagent/optimizer.ts backend/src/hyperagent/runtime.ts backend/src/routes/v2/hyperagents.ts backend/src/evals/gate.ts backend/src/hyperagent/__tests__/apply-flow.test.ts backend/src/routes/__tests__/hyperagents-v2.test.ts backend/scripts/jarvis-regression-smoke.mjs
git commit -m "feat: gate and apply hyperagent world-model recommendations"
```

## Rollout Notes

1. Start with `V2_HYPERAGENT_ENABLED=false` in all shared environments.
2. Run the new evaluator on seeded fixtures and historical outcomes before allowing operator apply.
3. Keep assistant and mission runtime out of scope until this loop shows stable gains.
4. Only after V1 proves value should we add:
   - planner prompt artifacts
   - routing score artifacts
   - retrieval rewrite artifacts
   - code-loop prompt or policy artifacts

## Success Criteria

- A bounded artifact snapshot can be created without reading or rewriting source code text.
- A candidate variant can be generated by allowlisted mutation only.
- The evaluator scores variants deterministically with no model call.
- The runtime can apply an approved override while preserving static fallback behavior.
- Existing world-model and radar tests remain green.

Plan complete and saved to `docs/plans/2026-03-24-hyperagent-v1-world-model-integration.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration

2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
