import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";
const NOW = "2026-03-24T09:00:00.000Z";
const LATER = "2026-03-24T09:05:00.000Z";

type HyperAgentArtifactKey = "world_model_dossier_config" | "radar_domain_pack";
type HyperAgentRecommendationStatus = "proposed" | "accepted" | "rejected" | "applied";

type HyperAgentRunState = {
  artifactKey: HyperAgentArtifactKey;
  snapshot: {
    id: string;
    artifactKey: HyperAgentArtifactKey;
    artifactVersion: string;
    scope: "world_model";
    payload: Record<string, unknown>;
    createdBy: string;
    createdAt: string;
  };
  variant: {
    id: string;
    artifactSnapshotId: string;
    strategy: string;
    payload: Record<string, unknown>;
    parentVariantId: string | null;
    lineageRunId: string;
    createdAt: string;
  };
  evalRun: {
    id: string;
    variantId: string;
    evaluatorKey: string;
    status: string;
    summary: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  recommendation: {
    id: string;
    evalRunId: string;
    variantId: string;
    status: HyperAgentRecommendationStatus;
    summary: Record<string, unknown>;
    decidedBy: string | null;
    decidedAt: string | null;
    appliedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  diff: {
    changeCount: number;
    entries: Array<{
      path: string;
      changeType: "changed";
      before: unknown;
      after: unknown;
    }>;
  };
  gate: {
    passed: boolean;
    reasons: string[];
  };
  lineageRunId: string;
  appliedOverride: {
    artifactKey: HyperAgentArtifactKey;
    payload: Record<string, unknown>;
    recommendationId: string;
    variantId: string;
    artifactSnapshotId: string;
    appliedAt: string;
  } | null;
  runtimeApplied: boolean;
};

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-hyperagents-e2e",
    data,
    meta,
  };
}

async function installAuth(page: Page, context: BrowserContext) {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.user_id", "user-1");
    window.sessionStorage.setItem("jarvis.auth.token", "e2e-token");
  });

  await context.addCookies([
    {
      name: "jarvis_auth_token",
      value: "e2e-token",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function installShellMocks(page: Page) {
  await page.route(`${API_BASE}/api/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path === "/api/v1/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            id: "user-1",
            email: "operator@example.com",
            role: "admin",
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/tasks" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope([])),
      });
      return;
    }

    if (path === "/api/v1/jarvis/sessions" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            sessions: [],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/providers" || path === "/api/v1/providers/models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            providers: [],
          }),
        ),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({})),
    });
  });
}

async function installHyperAgentMocks(page: Page) {
  const artifacts = [
    {
      artifactKey: "world_model_dossier_config" as const,
      scope: "world_model" as const,
      description: "Tune dossier emission constraints and world-model scoring without editing source code.",
      mutableFields: [
        "maxPrimaryHypotheses",
        "maxCounterHypotheses",
        "maxWatchItems",
      ],
      applied_override: null as HyperAgentRunState["appliedOverride"],
    },
    {
      artifactKey: "radar_domain_pack" as const,
      scope: "world_model" as const,
      description: "Bounded mutations for radar domain pack thresholds and watch lexicons.",
      mutableFields: ["domains[0].keywords", "domains[0].watchlist"],
      applied_override: null as HyperAgentRunState["appliedOverride"],
    },
  ];

  const fixtureSets = [
    {
      key: "world_model_smoke_v1",
      title: "Smoke Fixture",
      description: "Baseline cases that validate primary-thesis and invalidation coverage.",
      fixtureCount: 2,
    },
    {
      key: "world_model_stress_v1",
      title: "Stress Fixture",
      description: "Stress cases that preserve invalidation and counter-hypothesis coverage.",
      fixtureCount: 2,
    },
  ];

  const runs: HyperAgentRunState[] = [];
  const lineageByRunId = new Map<
    string,
    {
      nodes: Array<{
        id: string;
        runId: string;
        nodeType: string;
        referenceId: string;
        metadata: Record<string, unknown>;
        createdAt: string;
      }>;
      edges: Array<{
        id: string;
        runId: string;
        sourceNodeId: string;
        targetNodeId: string;
        edgeType: string;
        metadata: Record<string, unknown>;
        createdAt: string;
      }>;
    }
  >();

  let runCounter = 0;
  let pendingDraft:
    | {
        artifactKey: HyperAgentArtifactKey;
        snapshot: HyperAgentRunState["snapshot"];
        variant: HyperAgentRunState["variant"];
      }
    | null = null;

  const telemetry: {
    lastEvalFixtureSet: string | null;
    lastDecision: Record<string, unknown> | null;
    applyCount: number;
  } = {
    lastEvalFixtureSet: null,
    lastDecision: null,
    applyCount: 0,
  };

  function buildEvalSummary(fixtureSet: string) {
    const promotionScore = fixtureSet === "world_model_stress_v1" ? 0.932 : 0.881;
    return {
      promotionScore,
      fixtureSet,
      metrics: {
        primaryThesisCoverage: 1,
        counterHypothesisRetained: fixtureSet === "world_model_stress_v1" ? 0.92 : 0.84,
        invalidationConditionCoverage: 0.97,
        bottleneckCoverage: 0.89,
        watchSignalDiscipline: 0.94,
        averageCaseScore: fixtureSet === "world_model_stress_v1" ? 0.915 : 0.862,
        promotionScore,
      },
      caseResults: [
        {
          fixtureId: fixtureSet === "world_model_stress_v1" ? "fixture-stress-alpha" : "fixture-smoke-alpha",
          passed: true,
          score: fixtureSet === "world_model_stress_v1" ? 0.94 : 0.88,
          details: {
            checks: ["primary_thesis", "counter_hypothesis", "invalidation"],
          },
        },
        {
          fixtureId: fixtureSet === "world_model_stress_v1" ? "fixture-stress-beta" : "fixture-smoke-beta",
          passed: true,
          score: fixtureSet === "world_model_stress_v1" ? 0.89 : 0.84,
          details: {
            checks: ["watch_signals", "bottleneck"],
          },
        },
      ],
    };
  }

  function attachLineage(run: HyperAgentRunState) {
    const snapshotNodeId = `node-${run.lineageRunId}-snapshot`;
    const variantNodeId = `node-${run.lineageRunId}-variant`;
    const evalNodeId = `node-${run.lineageRunId}-eval`;
    const recommendationNodeId = `node-${run.lineageRunId}-recommendation`;

    lineageByRunId.set(run.lineageRunId, {
      nodes: [
        {
          id: snapshotNodeId,
          runId: run.lineageRunId,
          nodeType: "snapshot",
          referenceId: run.snapshot.id,
          metadata: {
            artifactKey: run.snapshot.artifactKey,
            artifactVersion: run.snapshot.artifactVersion,
          },
          createdAt: NOW,
        },
        {
          id: variantNodeId,
          runId: run.lineageRunId,
          nodeType: "variant",
          referenceId: run.variant.id,
          metadata: {
            strategy: run.variant.strategy,
            mutationBudget: 2,
          },
          createdAt: NOW,
        },
        {
          id: evalNodeId,
          runId: run.lineageRunId,
          nodeType: "eval",
          referenceId: run.evalRun.id,
          metadata: {
            evaluatorKey: run.evalRun.evaluatorKey,
            promotionScore: run.evalRun.summary.promotionScore,
          },
          createdAt: NOW,
        },
        {
          id: recommendationNodeId,
          runId: run.lineageRunId,
          nodeType: "recommendation",
          referenceId: run.recommendation.id,
          metadata: {
            status: run.recommendation.status,
          },
          createdAt: NOW,
        },
      ],
      edges: [
        {
          id: `edge-${run.lineageRunId}-snapshot-variant`,
          runId: run.lineageRunId,
          sourceNodeId: snapshotNodeId,
          targetNodeId: variantNodeId,
          edgeType: "derived_from",
          metadata: {
            artifactKey: run.artifactKey,
          },
          createdAt: NOW,
        },
        {
          id: `edge-${run.lineageRunId}-variant-eval`,
          runId: run.lineageRunId,
          sourceNodeId: variantNodeId,
          targetNodeId: evalNodeId,
          edgeType: "evaluated_by",
          metadata: {
            evaluatorKey: run.evalRun.evaluatorKey,
          },
          createdAt: NOW,
        },
        {
          id: `edge-${run.lineageRunId}-eval-recommendation`,
          runId: run.lineageRunId,
          sourceNodeId: evalNodeId,
          targetNodeId: recommendationNodeId,
          edgeType: "promoted_to",
          metadata: {
            status: run.recommendation.status,
          },
          createdAt: NOW,
        },
      ],
    });
  }

  function buildOverview(statusFilter: string | null) {
    const filteredRuns = statusFilter ? runs.filter((run) => run.recommendation.status === statusFilter) : runs;
    return {
      summary: {
        total: filteredRuns.length,
        applied_count: runs.filter((run) => run.runtimeApplied).length,
        statuses: {
          proposed: runs.filter((run) => run.recommendation.status === "proposed").length,
          accepted: runs.filter((run) => run.recommendation.status === "accepted").length,
          rejected: runs.filter((run) => run.recommendation.status === "rejected").length,
          applied: runs.filter((run) => run.recommendation.status === "applied").length,
        },
      },
      runs: filteredRuns.map((run) => ({
        artifact: artifacts.find((artifact) => artifact.artifactKey === run.artifactKey) ?? null,
        snapshot: run.snapshot,
        variant: run.variant,
        eval_run: run.evalRun,
        recommendation: run.recommendation,
        lineage_run_id: run.lineageRunId,
        lineage: {
          nodeCount: lineageByRunId.get(run.lineageRunId)?.nodes.length ?? 0,
          edgeCount: lineageByRunId.get(run.lineageRunId)?.edges.length ?? 0,
        },
        diff: run.diff,
        gate: run.gate,
        applied_override: run.appliedOverride,
        runtime_applied: run.runtimeApplied,
      })),
    };
  }

  await page.route(`${API_BASE}/api/v2/hyperagents/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path === "/api/v2/hyperagents/artifacts" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            artifacts,
          }),
        ),
      });
      return;
    }

    if (path === "/api/v2/hyperagents/overview" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope(buildOverview(url.searchParams.get("status")))),
      });
      return;
    }

    if (path === "/api/v2/hyperagents/world-model/fixtures" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            default_fixture_set: fixtureSets[0].key,
            fixture_sets: fixtureSets,
          }),
        ),
      });
      return;
    }

    if (path === "/api/v2/hyperagents/world-model/snapshots" && method === "POST") {
      const body = route.request().postDataJSON() as { artifact_key: HyperAgentArtifactKey };
      runCounter += 1;
      const snapshot = {
        id: `snapshot-${runCounter}`,
        artifactKey: body.artifact_key,
        artifactVersion: `world-model-${runCounter}`,
        scope: "world_model" as const,
        payload: {
          maxPrimaryHypotheses: 3,
          maxCounterHypotheses: 2,
          maxWatchItems: 4,
        },
        createdBy: "operator-e2e",
        createdAt: NOW,
      };
      pendingDraft = {
        artifactKey: body.artifact_key,
        snapshot,
        variant: {
          id: `variant-${runCounter}`,
          artifactSnapshotId: snapshot.id,
          strategy: "bounded_mutation_v1",
          payload: {
            maxPrimaryHypotheses: 3,
            maxCounterHypotheses: 2,
            maxWatchItems: 5,
          },
          parentVariantId: null,
          lineageRunId: `lineage-${runCounter}`,
          createdAt: NOW,
        },
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            snapshot,
          }),
        ),
      });
      return;
    }

    if (path === "/api/v2/hyperagents/world-model/variants" && method === "POST") {
      if (!pendingDraft) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            request_id: "req-hyperagents-e2e",
            error: {
              code: "DRAFT_NOT_READY",
              message: "snapshot must be created before variant",
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            variant: pendingDraft.variant,
            archive: {
              accepted: false,
            },
            changed_keys: ["maxWatchItems"],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v2/hyperagents/evals" && method === "POST") {
      if (!pendingDraft) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            request_id: "req-hyperagents-e2e",
            error: {
              code: "DRAFT_NOT_READY",
              message: "variant must be created before eval",
            },
          }),
        });
        return;
      }

      const body = route.request().postDataJSON() as { fixture_set?: string };
      const fixtureSet = body.fixture_set ?? fixtureSets[0].key;
      telemetry.lastEvalFixtureSet = fixtureSet;
      const summary = buildEvalSummary(fixtureSet);
      const evalRun = {
        id: `eval-${runCounter}`,
        variantId: pendingDraft.variant.id,
        evaluatorKey: "world_model_backtest_v1",
        status: "completed",
        summary,
        createdAt: NOW,
        updatedAt: NOW,
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            eval_run: evalRun,
            result: {
              evaluatedAt: NOW,
              metrics: summary.metrics,
              caseResults: summary.caseResults,
            },
          }),
        ),
      });

      pendingDraft = {
        ...pendingDraft,
        variant: pendingDraft.variant,
        snapshot: pendingDraft.snapshot,
        artifactKey: pendingDraft.artifactKey,
      };
      return;
    }

    if (path === "/api/v2/hyperagents/recommendations" && method === "POST") {
      if (!pendingDraft) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            request_id: "req-hyperagents-e2e",
            error: {
              code: "DRAFT_NOT_READY",
              message: "eval must be created before recommendation",
            },
          }),
        });
        return;
      }

      const fixtureSet = telemetry.lastEvalFixtureSet ?? fixtureSets[0].key;
      const evalSummary = buildEvalSummary(fixtureSet);
      const run: HyperAgentRunState = {
        artifactKey: pendingDraft.artifactKey,
        snapshot: pendingDraft.snapshot,
        variant: pendingDraft.variant,
        evalRun: {
          id: `eval-${runCounter}`,
          variantId: pendingDraft.variant.id,
          evaluatorKey: "world_model_backtest_v1",
          status: "completed",
          summary: evalSummary,
          createdAt: NOW,
          updatedAt: NOW,
        },
        recommendation: {
          id: `recommendation-${runCounter}`,
          evalRunId: `eval-${runCounter}`,
          variantId: pendingDraft.variant.id,
          status: "proposed",
          summary: {
            promotionScore: evalSummary.promotionScore,
            fixtureSet,
          },
          decidedBy: null,
          decidedAt: null,
          appliedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
        diff: {
          changeCount: 1,
          entries: [
            {
              path: "maxWatchItems",
              changeType: "changed",
              before: 4,
              after: 5,
            },
          ],
        },
        gate: {
          passed: true,
          reasons: [],
        },
        lineageRunId: pendingDraft.variant.lineageRunId,
        appliedOverride: null,
        runtimeApplied: false,
      };

      attachLineage(run);
      runs.unshift(run);
      pendingDraft = null;

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            recommendation: run.recommendation,
          }),
        ),
      });
      return;
    }

    if (path.startsWith("/api/v2/hyperagents/recommendations/") && path.endsWith("/decision") && method === "POST") {
      const recommendationId = path.split("/")[5];
      const body = route.request().postDataJSON() as {
        decision: "accept" | "reject";
        summary?: Record<string, unknown>;
      };
      telemetry.lastDecision = body.summary ?? null;

      const run = runs.find((entry) => entry.recommendation.id === recommendationId);
      if (!run) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
        return;
      }

      run.recommendation = {
        ...run.recommendation,
        status: body.decision === "accept" ? "accepted" : "rejected",
        summary: {
          ...run.recommendation.summary,
          ...(body.summary ?? {}),
        },
        decidedBy: "user-1",
        decidedAt: LATER,
        updatedAt: LATER,
      };
      attachLineage(run);

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            recommendation: run.recommendation,
          }),
        ),
      });
      return;
    }

    if (path.startsWith("/api/v2/hyperagents/recommendations/") && path.endsWith("/apply") && method === "POST") {
      const recommendationId = path.split("/")[5];
      const run = runs.find((entry) => entry.recommendation.id === recommendationId);
      if (!run) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
        return;
      }

      telemetry.applyCount += 1;
      run.recommendation = {
        ...run.recommendation,
        status: "applied",
        appliedAt: LATER,
        updatedAt: LATER,
      };
      run.runtimeApplied = true;
      run.appliedOverride = {
        artifactKey: run.artifactKey,
        payload: run.variant.payload,
        recommendationId: run.recommendation.id,
        variantId: run.variant.id,
        artifactSnapshotId: run.snapshot.id,
        appliedAt: LATER,
      };

      const artifact = artifacts.find((entry) => entry.artifactKey === run.artifactKey);
      if (artifact) {
        artifact.applied_override = run.appliedOverride;
      }
      attachLineage(run);

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            recommendation: run.recommendation,
          }),
        ),
      });
      return;
    }

    if (path.startsWith("/api/v2/hyperagents/lineage/") && method === "GET") {
      const runId = path.split("/").pop() ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            run_id: runId,
            lineage: lineageByRunId.get(runId) ?? { nodes: [], edges: [] },
          }),
        ),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        request_id: "req-hyperagents-e2e",
        error: {
          code: "NOT_FOUND",
          message: `${method} ${path} is not mocked`,
        },
      }),
    });
  });

  return telemetry;
}

test("hyperagent system surface supports generate, review, and apply flow", async ({ page, context }) => {
  await installAuth(page, context);
  await installShellMocks(page);
  const telemetry = await installHyperAgentMocks(page);

  await page.goto("/system/hyperagents");

  await expect(
    page.getByRole("heading", {
      name: /self-modification은 promotion gate 안에서만 다룬다\.|Keep self-modification inside a promotion-gated system surface\./,
    }),
  ).toBeVisible();
  await expect(page.getByText(/There are no HyperAgent runs to show yet\.|아직 표시할 HyperAgent run이 없다\./)).toBeVisible();
  await expect(page.getByText(/Artifact Catalog|Artifact Surface/).first()).toBeVisible();

  await page.getByRole("button", { name: /Stress Fixture · 2/ }).click();
  await expect(
    page.getByText(/Stress cases that preserve invalidation and counter-hypothesis coverage\./),
  ).toBeVisible();

  await page.getByRole("button", { name: /Generate Candidate/ }).click();

  await expect
    .poll(() => telemetry.lastEvalFixtureSet, {
      message: "selected fixture set should be passed to eval creation",
    })
    .toBe("world_model_stress_v1");

  await expect(page.getByText(/Created candidate|candidate .* 생성했다\./)).toBeVisible();
  await expect(page.getByText(/Bounded mutation inspector|bounded mutation inspector/)).toBeVisible();
  await expect(page.getByText("Eval Scorecard")).toBeVisible();
  await expect(page.getByText("fixture-stress-alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("Lineage Detail")).toBeVisible();
  await expect(page.getByText("derived_from", { exact: true })).toBeVisible();
  await expect(page.getByText("recommendation-1", { exact: true })).toBeVisible();

  const operatorNote = "Gate looks clean. Apply after watch review stays bounded.";
  await page.locator("textarea").fill(operatorNote);
  await page.getByRole("button", { name: /^Accept$/ }).click();

  await expect
    .poll(() => telemetry.lastDecision?.operatorDecision, {
      message: "accept decision should be forwarded into the summary",
    })
    .toBe("accept");
  await expect
    .poll(() => telemetry.lastDecision?.operatorNote, {
      message: "operator note should be forwarded into the summary",
    })
    .toBe(operatorNote);

  await expect(page.getByText(/Accepted the selected recommendation\.|선택한 recommendation을 accept 했다\./)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Apply$/ })).toBeEnabled();

  await page.getByRole("button", { name: /^Apply$/ }).click();

  await expect
    .poll(() => telemetry.applyCount, {
      message: "apply endpoint should be invoked once",
    })
    .toBe(1);

  await expect(
    page.getByText(/Applied the selected HyperAgent override to runtime\.|선택한 HyperAgent override를 runtime에 적용했다\./),
  ).toBeVisible();
  await expect(page.getByText(/Currently applied as the runtime override|현재 runtime override로 적용 중/)).toBeVisible();
  await expect(page.getByText("Runtime Override", { exact: true })).toBeVisible();
  await expect(page.getByText("Applied Payload JSON", { exact: true })).toBeVisible();
  await expect(page.getByText("Review Packet JSON", { exact: true })).toBeVisible();
  await expect(page.getByText("Lineage JSON", { exact: true })).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: '"recommendationId": "recommendation-1"' }).first(),
  ).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: '"operator_note": "Gate looks clean. Apply after watch review stays bounded."' }).first(),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Review Packet" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("hyperagent-review-packet-recommendation-1-applied.json");

  await expect(page.getByRole("button", { name: /^Applied$/ })).toBeDisabled();
});
