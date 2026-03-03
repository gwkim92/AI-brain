import { expect, test } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-e2e",
    data,
    meta,
  };
}

test("login/signup pages keep 3d core visible with readable auth forms", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "LOGIN" })).toBeVisible();
  const loginCanvas = page.locator("canvas").first();
  if ((await loginCanvas.count()) > 0) {
    await expect(loginCanvas).toBeVisible();
  } else {
    await expect(page.locator("main .fixed.inset-0.z-0 > div").first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "SIGN IN" })).toBeVisible();

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "SIGN UP" })).toBeVisible();
  const signupCanvas = page.locator("canvas").first();
  if ((await signupCanvas.count()) > 0) {
    await expect(signupCanvas).toBeVisible();
  } else {
    await expect(page.locator("main .fixed.inset-0.z-0 > div").first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "CREATE ACCOUNT" })).toBeVisible();
});

test("settings panel uses a scroll container and remains scrollable", async ({ page, context }) => {
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

  await page.route(`${API_BASE}/health`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          status: "ok",
          service: "jarvis-backend",
          env: "test",
          store: "memory",
          db: "n/a",
          now: "2026-02-24T00:00:00.000Z",
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers`, async (route) => {
    const providers = Array.from({ length: 32 }).map((_, index) => ({
      provider: `mock-${index}`,
      enabled: index % 2 === 0,
      model: "test-model",
      reason: index % 2 === 0 ? undefined : "disabled",
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ providers })),
    });
  });

  await page.route(`${API_BASE}/api/v1/admin/providers/credentials`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ providers: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers/registry**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ models: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers/policies**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ policies: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/dashboard/overview**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          generated_at: "2026-02-25T00:00:00.000Z",
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

  await page.route(`${API_BASE}/api/v1/settings/overview**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          generated_at: "2026-02-25T00:00:00.000Z",
          backend: {
            env: "test",
            store: "memory",
            db: "n/a",
            now: "2026-02-25T00:00:00.000Z",
          },
          providers: [],
          policies: {
            high_risk_requires_approval: true,
            approval_max_age_hours: 24,
            high_risk_allowed_roles: ["operator", "admin"],
            provider_failover_auto: true,
            auth_required: true,
          },
        })
      ),
    });
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: /SYSTEM SETTINGS/i })).toBeVisible();

  const settingsScrollContainer = page.getByTestId("settings-scroll-container");
  await expect(settingsScrollContainer).toBeVisible();

  const overflowY = await settingsScrollContainer.evaluate((element) => getComputedStyle(element).overflowY);
  expect(overflowY).toBe("auto");

  const canScroll = await settingsScrollContainer.evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(canScroll).toBeTruthy();
});
