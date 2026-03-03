import { expect, test, type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-e2e",
    data,
    meta,
  };
}

async function installApiMocks(page: Page) {
  await page.route(`${API_BASE}/api/v1/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/events") || path.endsWith("/stream")) {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
        body: "event: stream.open\ndata: {\"request_id\":\"req-e2e\"}\n\nevent: stream.close\ndata: {}\n\n",
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({})),
    });
  });

  await page.route(`${API_BASE}/api/v1/dashboard/overview**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          generated_at: "2026-03-03T00:00:00.000Z",
          tasks: [],
          pending_approvals: [],
          running_tasks: [],
          signals: {
            task_count: 0,
            running_count: 0,
            failed_count: 0,
            blocked_count: 0,
            pending_approval_count: 0,
          },
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/dashboard/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
      body: "event: stream.open\ndata: {\"request_id\":\"req-e2e\"}\n\nevent: stream.close\ndata: {}\n\n",
    });
  });
}

test.beforeEach(async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
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

  await installApiMocks(page);
});

test("core page always renders a visible core surface", async ({ page }) => {
  await page.goto("/core");

  const root = page.getByTestId("jarvis-core-root");
  await expect(root).toBeVisible();

  await expect.poll(async () => await root.getAttribute("data-core-status"), {
    timeout: 10000,
  }).not.toBe("probing");

  await expect.poll(async () => await root.getAttribute("data-core-engine"), {
    timeout: 10000,
  }).toMatch(/^(gpgpu|stable|lite|cpu)$/);

  const canvasCount = await root.locator("canvas").count();
  expect(canvasCount).toBeGreaterThan(0);
});

test("core_engine query forces deterministic debug engine", async ({ page }) => {
  await page.goto("/core?core_engine=cpu");

  const root = page.getByTestId("jarvis-core-root");
  await expect(root).toBeVisible();
  await expect.poll(async () => await root.getAttribute("data-core-engine"), {
    timeout: 10000,
  }).toBe("cpu");
  await expect.poll(async () => await root.getAttribute("data-core-reason"), {
    timeout: 10000,
  }).toMatch(/^(forced_engine|webgl_unavailable)$/);

  await page.goto("/core?core_engine=lite");
  await expect(root).toBeVisible();
  await expect.poll(async () => await root.getAttribute("data-core-engine"), {
    timeout: 10000,
  }).toMatch(/^(lite|cpu)$/);
});
