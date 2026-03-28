import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.JARVIS_BASE_URL ?? "http://127.0.0.1:4000";
const email = process.env.JARVIS_SMOKE_EMAIL ?? "admin@jarvis.local";
const password = process.env.JARVIS_SMOKE_PASSWORD ?? "Admin!234567";
const artifactKey = process.env.HYPERAGENT_SMOKE_ARTIFACT_KEY ?? "world_model_dossier_config";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = path.resolve(scriptDir, "../../output/hyperagent-smoke");
const outputDir =
  process.env.HYPERAGENT_SMOKE_OUT_DIR ?? defaultOutputDir;
const operatorNote =
  process.env.HYPERAGENT_SMOKE_NOTE ??
  "Live HyperAgent smoke accepted after verifying bounded mutation, eval, and apply flow.";

async function requestJson(method, pathname, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    signal: AbortSignal.timeout(45_000),
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const json = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return { raw: text };
    }
  })();

  return { response, json };
}

function ensure(condition, message, details) {
  if (!condition) {
    const suffix = details ? ` :: ${JSON.stringify(details)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

async function login() {
  const { response, json } = await requestJson("POST", "/api/v1/auth/login", {
    body: { email, password },
  });
  ensure(response.ok, "login_failed", { status: response.status, json });
  ensure(typeof json?.data?.token === "string", "login_token_missing", json);
  return json.data.token;
}

function summarizeStep(name, response, json, extra = {}) {
  return {
    step: name,
    status: response.status,
    ok: response.ok,
    extra,
    body: json?.data ?? json ?? null,
  };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const steps = [];
  const summary = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    artifact_key: artifactKey,
    smoke_passed: false,
    token_acquired: false,
    promotion_score: null,
    ids: {},
    steps,
  };

  try {
    const token = await login();
    summary.token_acquired = true;

    const authMe = await requestJson("GET", "/api/v1/auth/me", { token });
    steps.push(summarizeStep("auth_me", authMe.response, authMe.json));
    ensure(authMe.response.ok, "auth_me_failed", authMe.json);
    ensure(authMe.json?.data?.user?.role === "admin", "auth_me_not_admin", authMe.json);

    const v2Health = await requestJson("GET", "/api/v2/health", { token });
    steps.push(summarizeStep("v2_health", v2Health.response, v2Health.json));
    ensure(v2Health.response.ok, "v2_health_failed", v2Health.json);
    ensure(v2Health.json?.data?.flags?.hyperAgentEnabled === true, "hyperagent_flag_disabled", v2Health.json);

    const artifacts = await requestJson("GET", "/api/v2/hyperagents/artifacts", { token });
    steps.push(summarizeStep("artifacts", artifacts.response, artifacts.json));
    ensure(artifacts.response.ok, "artifacts_failed", artifacts.json);
    ensure(
      Array.isArray(artifacts.json?.data?.artifacts) &&
        artifacts.json.data.artifacts.some((entry) => entry.artifactKey === artifactKey),
      "artifact_missing",
      artifacts.json,
    );

    const fixtures = await requestJson("GET", "/api/v2/hyperagents/world-model/fixtures", { token });
    steps.push(summarizeStep("fixtures", fixtures.response, fixtures.json));
    ensure(fixtures.response.ok, "fixtures_failed", fixtures.json);

    const snapshot = await requestJson("POST", "/api/v2/hyperagents/world-model/snapshots", {
      token,
      body: {
        artifact_key: artifactKey,
      },
    });
    steps.push(summarizeStep("snapshot", snapshot.response, snapshot.json));
    ensure(snapshot.response.status === 201, "snapshot_failed", snapshot.json);
    const snapshotId = snapshot.json?.data?.snapshot?.id;
    ensure(typeof snapshotId === "string", "snapshot_id_missing", snapshot.json);
    summary.ids.snapshot_id = snapshotId;

    const variant = await requestJson("POST", "/api/v2/hyperagents/world-model/variants", {
      token,
      body: {
        artifact_snapshot_id: snapshotId,
        mutation_budget: 1,
      },
    });
    steps.push(summarizeStep("variant", variant.response, variant.json));
    ensure(variant.response.status === 201, "variant_failed", variant.json);
    const variantId = variant.json?.data?.variant?.id;
    const lineageRunId = variant.json?.data?.variant?.lineageRunId;
    ensure(typeof variantId === "string", "variant_id_missing", variant.json);
    ensure(typeof lineageRunId === "string", "lineage_run_id_missing", variant.json);
    summary.ids.variant_id = variantId;
    summary.ids.lineage_run_id = lineageRunId;

    const evalRun = await requestJson("POST", "/api/v2/hyperagents/evals", {
      token,
      body: {
        variant_id: variantId,
      },
    });
    steps.push(summarizeStep("eval", evalRun.response, evalRun.json));
    ensure(evalRun.response.ok, "eval_failed", evalRun.json);
    const evalRunId = evalRun.json?.data?.eval_run?.id;
    const promotionScore = evalRun.json?.data?.eval_run?.summary?.promotionScore;
    ensure(typeof evalRunId === "string", "eval_run_id_missing", evalRun.json);
    ensure(typeof promotionScore === "number", "promotion_score_missing", evalRun.json);
    summary.ids.eval_run_id = evalRunId;
    summary.promotion_score = promotionScore;

    const recommendation = await requestJson("POST", "/api/v2/hyperagents/recommendations", {
      token,
      body: {
        eval_run_id: evalRunId,
      },
    });
    steps.push(summarizeStep("recommendation", recommendation.response, recommendation.json));
    ensure(recommendation.response.status === 201, "recommendation_failed", recommendation.json);
    const recommendationId = recommendation.json?.data?.recommendation?.id;
    ensure(typeof recommendationId === "string", "recommendation_id_missing", recommendation.json);
    summary.ids.recommendation_id = recommendationId;

    const decision = await requestJson(
      "POST",
      `/api/v2/hyperagents/recommendations/${recommendationId}/decision`,
      {
        token,
        body: {
          decision: "accept",
          summary: {
            operatorNote,
            operatorDecision: "accept",
          },
        },
      },
    );
    steps.push(summarizeStep("decision", decision.response, decision.json));
    ensure(decision.response.ok, "decision_failed", decision.json);
    ensure(decision.json?.data?.recommendation?.status === "accepted", "decision_not_accepted", decision.json);

    const apply = await requestJson(
      "POST",
      `/api/v2/hyperagents/recommendations/${recommendationId}/apply`,
      { token },
    );
    steps.push(summarizeStep("apply", apply.response, apply.json));
    ensure(apply.response.ok, "apply_failed", apply.json);
    ensure(apply.json?.data?.recommendation?.status === "applied", "apply_not_applied", apply.json);

    const runtime = await requestJson("GET", "/api/v2/hyperagents/runtime", { token });
    steps.push(summarizeStep("runtime", runtime.response, runtime.json));
    ensure(runtime.response.ok, "runtime_failed", runtime.json);
    ensure(
      Array.isArray(runtime.json?.data?.applied_overrides) &&
        runtime.json.data.applied_overrides.some(
          (entry) =>
            entry.artifactKey === artifactKey &&
            entry.recommendationId === recommendationId,
        ),
      "runtime_override_missing",
      runtime.json,
    );

    const overview = await requestJson("GET", "/api/v2/hyperagents/overview?limit=1", { token });
    steps.push(summarizeStep("overview", overview.response, overview.json));
    ensure(overview.response.ok, "overview_failed", overview.json);
    ensure(overview.json?.data?.summary?.applied_count >= 1, "overview_applied_count_missing", overview.json);

    const lineage = await requestJson("GET", `/api/v2/hyperagents/lineage/${lineageRunId}`, { token });
    steps.push(summarizeStep("lineage", lineage.response, lineage.json));
    ensure(lineage.response.ok, "lineage_failed", lineage.json);
    ensure(
      Array.isArray(lineage.json?.data?.lineage?.nodes) &&
        lineage.json.data.lineage.nodes.length > 0,
      "lineage_nodes_missing",
      lineage.json,
    );

    summary.smoke_passed = true;
  } catch (error) {
    summary.error =
      error instanceof Error ? error.message : typeof error === "string" ? error : "unknown_error";
    process.exitCode = 1;
  }

  const outputPath = path.join(outputDir, "result.json");
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

await main();
