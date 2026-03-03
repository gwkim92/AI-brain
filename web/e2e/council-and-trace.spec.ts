import { expect, test } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-e2e",
    data,
    meta,
  };
}

test("council retry sends exclude_providers from failed attempts", async ({ page }) => {
  const councilBodies: Array<Record<string, unknown>> = [];
  let runNumber = 0;

  await page.route(`${API_BASE}/api/v1/tasks?*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope([])),
    });
  });

  await page.route(`${API_BASE}/api/v1/upgrades/proposals?*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ proposals: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/councils/runs`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    const raw = route.request().postData() ?? "{}";
    const body = JSON.parse(raw) as Record<string, unknown>;
    councilBodies.push(body);
    runNumber += 1;

    const isSecondRun = runNumber >= 2;

    const data = {
      id: `run-council-${runNumber}`,
      question: String(body.question ?? "unknown"),
      status: "completed" as const,
      consensus_status: (isSecondRun ? "consensus_reached" : "contradiction_detected") as
        | "consensus_reached"
        | "contradiction_detected",
      summary: isSecondRun ? "Second run summary" : "First run summary",
      participants: [
        {
          role: "planner" as const,
          provider: "openai" as const,
          status: (isSecondRun ? "skipped" : "failed") as "skipped" | "failed",
          summary: "Planner provider did not complete.",
          error: isSecondRun ? "excluded_by_request" : "openai timeout",
          latency_ms: 120,
        },
        {
          role: "researcher" as const,
          provider: "gemini" as const,
          status: "success" as const,
          summary: "Researcher provided supporting evidence.",
          latency_ms: 90,
        },
        {
          role: "critic" as const,
          provider: "gemini" as const,
          status: "success" as const,
          summary: "Critic validated trade-offs.",
          latency_ms: 85,
        },
        {
          role: "risk" as const,
          provider: "gemini" as const,
          status: "success" as const,
          summary: "Risk checks completed.",
          latency_ms: 88,
        },
        {
          role: "synthesizer" as const,
          provider: "gemini" as const,
          status: "success" as const,
          summary: isSecondRun ? "Consensus after reroute." : "Initial synthesis.",
        },
      ],
      attempts: isSecondRun
        ? [
            { provider: "openai", status: "skipped", error: "excluded_by_request" },
            { provider: "gemini", status: "success", latencyMs: 95 },
          ]
        : [
            { provider: "openai", status: "failed", latencyMs: 120, error: "openai timeout" },
            { provider: "gemini", status: "success", latencyMs: 95 },
          ],
      provider: "gemini" as const,
      model: "gemini-2.5-pro",
      used_fallback: true,
      task_id: null,
      created_at: "2026-02-23T00:00:00.000Z",
      updated_at: "2026-02-23T00:00:01.000Z",
    };

    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify(envelope(data, { accepted: true })),
    });
  });

  await page.goto("/");
  await page.locator("nav button").nth(3).click();
  await expect(page.getByText("AGENT COUNCIL ROOM")).toBeVisible();

  await page.getByRole("button", { name: "RUN COUNCIL" }).click();

  await expect(page.getByText("openai timeout", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "RETRY EXCLUDING FAILED" })).toBeEnabled();

  await page.getByRole("button", { name: "RETRY EXCLUDING FAILED" }).click();

  await expect.poll(() => councilBodies.length).toBe(2);
  expect(councilBodies[1]?.exclude_providers).toEqual(["openai"]);

  await expect(page.getByText("Excluded providers: openai")).toBeVisible();
  await expect(page.getByText("Second run summary")).toBeVisible();
});

test("task detail trace filter toggles between traces", async ({ page }) => {
  const taskId = "task-trace-e2e";

  await page.route(`${API_BASE}/api/v1/tasks/${taskId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          id: taskId,
          userId: "user-test",
          mode: "execute",
          status: "running",
          title: "Trace filter smoke",
          input: { source: "e2e" },
          idempotencyKey: "idem-trace-e2e",
          traceId: "traceaaa1111",
          createdAt: "2026-02-23T00:00:00.000Z",
          updatedAt: "2026-02-23T00:00:01.000Z",
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/tasks/${taskId}/events`, async (route) => {
    const sseBody = [
      "event: stream.open",
      `data: ${JSON.stringify({ request_id: "req-task-stream", task_id: taskId })}`,
      "",
      "event: task.updated",
      `data: ${JSON.stringify({
        event_id: "evt-a",
        task_id: taskId,
        timestamp: "2026-02-23T00:00:02.000Z",
        data: { marker: "MARKER_TRACE_A", source: "trace-a" },
        trace_id: "traceaaa1111",
        span_id: "span-a-1111",
      })}`,
      "",
      "event: task.failed",
      `data: ${JSON.stringify({
        event_id: "evt-b",
        task_id: taskId,
        timestamp: "2026-02-23T00:00:03.000Z",
        data: { marker: "MARKER_TRACE_B", source: "trace-b" },
        trace_id: "tracebbb2222",
        span_id: "span-b-2222",
      })}`,
      "",
      "event: stream.close",
      `data: ${JSON.stringify({ task_id: taskId })}`,
      "",
    ].join("\n");

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body: sseBody,
    });
  });

  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByText("TASK DETAIL")).toBeVisible();
  await expect(page.getByText("MARKER_TRACE_A")).toBeVisible();
  await expect(page.getByText("MARKER_TRACE_B")).toBeVisible();

  await page.getByRole("button", { name: /traceaaa1111/i }).first().click();
  await expect(page.getByText("MARKER_TRACE_A")).toBeVisible();
  await expect(page.getByText("MARKER_TRACE_B")).toHaveCount(0);

  await page.getByRole("button", { name: "ALL TRACES" }).click();
  await expect(page.getByText("MARKER_TRACE_B")).toBeVisible();

  await page.getByRole("button", { name: /TRACE tracebbb2222/i }).click();
  await expect(page.getByText("MARKER_TRACE_B")).toBeVisible();
  await expect(page.getByText("MARKER_TRACE_A")).toHaveCount(0);
});
