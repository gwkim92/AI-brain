import { expect, test, type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-e2e",
    data,
    meta,
  };
}

async function installSessionRestoreMocks(page: Page) {
  await page.route(`${API_BASE}/api/v1/**`, async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const path = new URL(request.url()).pathname;

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

    if (method === "GET" && path === "/api/v1/dashboard/overview") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            generated_at: "2026-02-28T00:00:00.000Z",
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
      return;
    }

    if (method === "GET" && path === "/api/v1/tasks") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope([])),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/upgrades/proposals") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ proposals: [] })),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/radar/recommendations") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ recommendations: [] })),
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

test("session click restores full workspace and supports focus-only restore", async ({ page, context }) => {
  await page.addInitScript(() => {
    const sessions = [
      {
        id: "session-focus",
        prompt: "focus session",
        createdAt: "2026-02-28T00:00:00.000Z",
        activeWidgets: ["inbox"],
        mountedWidgets: ["inbox", "tasks"],
        focusedWidget: "inbox",
        workspacePreset: "mission",
        lastWorkspacePreset: "mission",
        restoreMode: "full",
        status: "background",
      },
      {
        id: "session-inbox",
        prompt: "inbox session",
        createdAt: "2026-02-28T00:01:00.000Z",
        activeWidgets: ["inbox"],
        mountedWidgets: ["inbox"],
        focusedWidget: "inbox",
        workspacePreset: null,
        lastWorkspacePreset: null,
        restoreMode: "full",
        status: "active",
      },
    ];

    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("hud-sessions", JSON.stringify(sessions));
    window.localStorage.setItem("hud-active-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-mounted-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-focused-widget", "inbox");
    window.localStorage.setItem("hud-workspace-preset", "");
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

  await installSessionRestoreMocks(page);
  await page.goto("/");
  const panelToggle = page.getByTitle("Toggle panel (Ctrl+.)");
  if (await panelToggle.isVisible()) {
    await panelToggle.click();
  }

  const sessionCard = page.locator('[data-testid="session-card-session-focus"]:visible').first();
  await expect(sessionCard).toBeVisible();
  await sessionCard.locator("button").first().click();

  await expect.poll(async () => {
    return page.evaluate(() => window.localStorage.getItem("hud-active-widgets"));
  }).toContain("tasks");

  const restoredSnapshot = await page.evaluate(() => {
    const active = JSON.parse(window.localStorage.getItem("hud-active-widgets") ?? "[]") as string[];
    const mounted = JSON.parse(window.localStorage.getItem("hud-mounted-widgets") ?? "[]") as string[];
    const focused = window.localStorage.getItem("hud-focused-widget");
    return { active, mounted, focused };
  });

  expect(restoredSnapshot.active).toEqual(["inbox", "tasks"]);
  expect(restoredSnapshot.mounted).toEqual(["inbox", "tasks"]);
  expect(restoredSnapshot.focused).toBe("inbox");

  await page.locator('[data-testid="session-restore-focus-session-focus"]:visible').first().click();

  const focusOnlySnapshot = await page.evaluate(() => {
    const active = JSON.parse(window.localStorage.getItem("hud-active-widgets") ?? "[]") as string[];
    const mounted = JSON.parse(window.localStorage.getItem("hud-mounted-widgets") ?? "[]") as string[];
    const sessions = JSON.parse(window.localStorage.getItem("hud-sessions") ?? "[]") as Array<{
      id: string;
      restoreMode?: string;
    }>;
    const focusedSession = sessions.find((item) => item.id === "session-focus");
    return {
      active,
      mounted,
      restoreMode: focusedSession?.restoreMode ?? null,
    };
  });

  expect(focusOnlySnapshot.active).toEqual(["inbox"]);
  expect(focusOnlySnapshot.mounted).toEqual(["inbox", "tasks"]);
  expect(focusOnlySnapshot.restoreMode).toBe("focus_only");
});
