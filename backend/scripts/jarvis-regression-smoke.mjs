import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const baseUrl = process.env.JARVIS_BASE_URL ?? "http://127.0.0.1:4000";
const email = process.env.JARVIS_SMOKE_EMAIL ?? "admin@jarvis.local";
const password = process.env.JARVIS_SMOKE_PASSWORD ?? "Admin!234567";
const outputDir =
  process.env.JARVIS_SMOKE_OUT_DIR ??
  "/Users/woody/ai/brain/output/jarvis-regression-smoke";
const promptPackPath =
  process.env.JARVIS_SMOKE_PROMPT_PACK ??
  "/Users/woody/ai/brain/docs/plans/jarvis-regression-prompt-pack.json";

async function postJson(url, body, token) {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

async function login() {
  const { response, json } = await postJson(`${baseUrl}/api/v1/auth/login`, {
    email,
    password
  });
  if (!response.ok || !json?.data?.token) {
    throw new Error(`Login failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json.data.token;
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function summarizeCaseResult(testCase, body, passed, errors) {
  const data = body?.data ?? {};
  return {
    id: testCase.id,
    prompt: testCase.prompt,
    passed,
    errors,
    session_id: data?.session?.id ?? null,
    session_status: data?.session?.status ?? null,
    primary_target: data?.delegation?.primary_target ?? null,
    requested_capabilities: data?.requested_capabilities ?? [],
    research_profile: data?.research_profile ?? null,
    quality_mode: data?.quality_mode ?? null,
    warning_codes: data?.warning_codes ?? [],
    next_action: data?.next_action ?? null
  };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const promptPack = JSON.parse(await fs.readFile(promptPackPath, "utf8"));
  const token = await login();
  const results = [];

  for (const testCase of promptPack.cases ?? []) {
    console.error(`Running smoke case: ${testCase.id}`);
    const clientSessionId = crypto.randomUUID();
    let response;
    let json;
    const errors = [];

    try {
      const result = await postJson(
        `${baseUrl}/api/v1/jarvis/requests`,
        {
          prompt: testCase.prompt,
          client_session_id: clientSessionId
        },
        token
      );
      response = result.response;
      json = result.json;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "unknown_error";
      errors.push(`request_timeout:${message}`);
      results.push(
        summarizeCaseResult(testCase, { data: {} }, false, errors)
      );
      continue;
    }

    if (response.status !== 201) {
      errors.push(`unexpected_status:${response.status}`);
    }
    const actualProfile = json?.data?.research_profile ?? null;
    if (testCase.expected_profile !== actualProfile) {
      errors.push(`profile:${actualProfile}`);
    }
    const actualCapabilities = json?.data?.requested_capabilities ?? [];
    if (!arraysEqual(testCase.expected_capabilities, actualCapabilities)) {
      errors.push(`capabilities:${JSON.stringify(actualCapabilities)}`);
    }
    const actualQualityMode = json?.data?.quality_mode ?? null;
    if (
      Array.isArray(testCase.allowed_quality_modes) &&
      !testCase.allowed_quality_modes.includes(actualQualityMode)
    ) {
      errors.push(`quality_mode:${actualQualityMode}`);
    }

    results.push(
      summarizeCaseResult(testCase, json, errors.length === 0, errors)
    );
  }

  const summary = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    prompt_pack: promptPackPath,
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    results
  };

  await fs.writeFile(
    path.join(outputDir, "result.json"),
    JSON.stringify(summary, null, 2)
  );

  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

await main();
