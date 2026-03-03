import { expect, test, type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";

test.describe.configure({ mode: "serial" });

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-e2e",
    data,
    meta,
  };
}

async function installAppApiMocks(page: Page) {
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

  await page.route(`${API_BASE}/api/v1/tasks**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope([])),
    });
  });

  await page.route(`${API_BASE}/api/v1/upgrades/proposals**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ proposals: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/missions**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    const missionEventsMatch = path.match(/^\/api\/v1\/missions\/([^/]+)\/events$/);
    if (missionEventsMatch) {
      const missionId = missionEventsMatch[1] ?? "mission-e2e";
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
        body: [
          "event: stream.open",
          `data: ${JSON.stringify({ request_id: "req-e2e", mission_id: missionId })}`,
          "",
          "event: mission.updated",
          `data: ${JSON.stringify({
            mission_id: missionId,
            timestamp: "2026-02-25T00:00:00.000Z",
            data: {
              id: missionId,
              userId: "00000000-0000-4000-8000-000000000000",
              workspaceId: null,
              title: "Mission",
              objective: "Synthetic mission stream",
              domain: "mixed",
              status: "running",
              steps: [
                {
                  id: "sid-1",
                  type: "execute",
                  title: "Step 1",
                  description: "Synthetic step",
                  route: "/mission",
                  status: "running",
                  order: 1,
                },
              ],
              createdAt: "2026-02-25T00:00:00.000Z",
              updatedAt: "2026-02-25T00:00:00.000Z",
            },
          })}`,
          "",
          "event: stream.close",
          `data: ${JSON.stringify({ request_id: "req-e2e", mission_id: missionId, reason: "timeout" })}`,
          "",
        ].join("\n"),
      });
      return;
    }

    const missionDetailMatch = path.match(/^\/api\/v1\/missions\/([^/]+)$/);
    if (missionDetailMatch) {
      const missionId = missionDetailMatch[1] ?? "mission-e2e";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            id: missionId,
            userId: "00000000-0000-4000-8000-000000000000",
            workspaceId: null,
            title: "Mission",
            objective: "Synthetic mission snapshot",
            domain: "mixed",
            status: "running",
            steps: [
              {
                id: "sid-1",
                type: "execute",
                title: "Step 1",
                description: "Synthetic step",
                route: "/mission",
                status: "running",
                order: 1,
              },
            ],
            createdAt: "2026-02-25T00:00:00.000Z",
            updatedAt: "2026-02-25T00:00:00.000Z",
          })
        ),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ missions: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers/models**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ providers: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ providers: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/reports/overview**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          generated_at: "2026-02-24T00:00:00.000Z",
          sampled_limits: { task_limit: 120, run_limit: 80 },
          tasks: {
            total: 0,
            by_status: { queued: 0, running: 0, blocked: 0, retrying: 0, done: 0, failed: 0, cancelled: 0 },
            by_mode: {
              chat: 0,
              execute: 0,
              council: 0,
              code: 0,
              compute: 0,
              long_run: 0,
              high_risk: 0,
              radar_review: 0,
              upgrade_execution: 0,
            },
            running: 0,
            failed_or_cancelled: 0,
          },
          councils: {
            total: 0,
            by_status: { queued: 0, running: 0, completed: 0, failed: 0 },
            by_consensus: { consensus_reached: 0, contradiction_detected: 0, escalated_to_human: 0 },
            escalated: 0,
          },
          executions: {
            total: 0,
            by_status: { queued: 0, running: 0, completed: 0, failed: 0 },
            avg_duration_ms: 0,
            fallback_used: 0,
            fallback_rate_pct: 0,
          },
          upgrades: {
            total: 0,
            by_status: {
              proposed: 0,
              approved: 0,
              planning: 0,
              running: 0,
              verifying: 0,
              deployed: 0,
              failed: 0,
              rolled_back: 0,
              rejected: 0,
            },
            pending_approvals: 0,
          },
          radar: {
            recommendation_total: 0,
            by_decision: { adopt: 0, hold: 0, discard: 0 },
          },
          providers: {
            enabled: 0,
            disabled: 0,
            items: [],
          },
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/radar/reports/telegram/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
      body: "event: stream.open\ndata: {\"request_id\":\"req-e2e\"}\n\nevent: stream.close\ndata: {}\n\n",
    });
  });

  await page.route(`${API_BASE}/api/v1/radar/reports/telegram**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ reports: [] })),
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
}

async function installMissionDockMocks(page: Page) {
  await installAppApiMocks(page);

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

  await page.route(`${API_BASE}/api/v1/missions/mission-1/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
      body: [
        "event: stream.open",
        `data: ${JSON.stringify({ request_id: "req-e2e", mission_id: "mission-1" })}`,
        "",
        "event: mission.updated",
        `data: ${JSON.stringify({
          mission_id: "mission-1",
          timestamp: "2026-02-25T00:02:00.000Z",
          data: {
            id: "mission-1",
            userId: "00000000-0000-4000-8000-000000000000",
            workspaceId: null,
            title: "Alpha",
            objective: "execute coordinated mission",
            domain: "mixed",
            status: "running",
            steps: [
              {
                id: "step-code",
                type: "code",
                title: "Implement core flow",
                description: "build runtime integration",
                route: "/studio/code",
                status: "running",
                order: 1,
              },
              {
                id: "step-research",
                type: "research",
                title: "Collect references",
                description: "gather supporting data",
                route: "/studio/research",
                status: "pending",
                order: 2,
              },
            ],
            createdAt: "2026-02-25T00:00:00.000Z",
            updatedAt: "2026-02-25T00:02:00.000Z",
          },
        })}`,
        "",
        "event: stream.close",
        `data: ${JSON.stringify({ request_id: "req-e2e", mission_id: "mission-1", reason: "timeout" })}`,
        "",
      ].join("\n"),
    });
  });

  await page.route(`${API_BASE}/api/v1/missions/mission-1`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          id: "mission-1",
          userId: "00000000-0000-4000-8000-000000000000",
          workspaceId: null,
          title: "Alpha",
          objective: "execute coordinated mission",
          domain: "mixed",
          status: "running",
          steps: [
            {
              id: "step-code",
              type: "code",
              title: "Implement core flow",
              description: "build runtime integration",
              route: "/studio/code",
              status: "running",
              order: 1,
            },
            {
              id: "step-research",
              type: "research",
              title: "Collect references",
              description: "gather supporting data",
              route: "/studio/research",
              status: "pending",
              order: 2,
            },
          ],
          createdAt: "2026-02-25T00:00:00.000Z",
          updatedAt: "2026-02-25T00:02:00.000Z",
        })
      ),
    });
  });
}

test("sidebar mission/studio buttons open HUD widget workspaces without route navigation", async ({ page, context }) => {
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

  await installAppApiMocks(page);

  const navigationChecks: Array<{ ariaLabel: string; headings: string[] }> = [
    { ariaLabel: "Mission Control", headings: ["TASK MANAGER"] },
    { ariaLabel: "Code", headings: ["WORKBENCH"] },
    { ariaLabel: "Research", headings: ["AGENT COUNCIL"] },
    { ariaLabel: "Intelligence", headings: ["SYSTEM REPORTS"] },
  ];

  for (const item of navigationChecks) {
    await page.goto("/?widget=inbox");

    const navButton = page.locator(`button[aria-label="${item.ariaLabel}"]`);
    await expect(navButton).toBeVisible();
    await navButton.click();
    await expect(page).not.toHaveURL(/\/mission(?:\?|$)|\/studio\//);

    for (const heading of item.headings) {
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    }
  }
});

test("legacy mission/studio routes redirect to HUD widgets", async ({ page, context }) => {
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

  await installAppApiMocks(page);

  const checks: Array<{ path: string; headings: string[] }> = [
    { path: "/mission?mission=mid-1&step=sid-1", headings: ["TASK MANAGER"] },
    { path: "/studio/code", headings: ["WORKBENCH"] },
    { path: "/studio/research", headings: ["AGENT COUNCIL"] },
    { path: "/studio/finance", headings: ["SYSTEM REPORTS"] },
    { path: "/studio/news", headings: ["SYSTEM REPORTS"] },
  ];

  for (const item of checks) {
    await page.goto(item.path);
    await expect(page).not.toHaveURL(/\/mission(?:\?|$)|\/studio\//);
    await expect
      .poll(() => {
        const currentUrl = new URL(page.url());
        return currentUrl.searchParams.get("widgets");
      })
      .toBeNull();

    const currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("widgets")).toBeNull();
    if (item.path.startsWith("/mission?")) {
      expect(currentUrl.searchParams.get("mission")).toBe("mid-1");
      expect(currentUrl.searchParams.get("step")).toBe("sid-1");
    }

    for (const heading of item.headings) {
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    }
  }
});

test("widget close remains closed and refresh does not reopen preset widgets", async ({ page, context }) => {
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

  await installAppApiMocks(page);

  await page.goto("/studio/code");
  await expect(page).not.toHaveURL(/\/studio\//);

  await expect(page.getByRole("heading", { name: "WORKBENCH", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Close WORKBENCH" }).click();
  await expect(page.getByRole("heading", { name: "WORKBENCH", exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "WORKBENCH", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "TASK MANAGER", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI ASSISTANT", exact: true }).first()).toBeVisible();
});

test("mission dock supports focus switch and recommendation controls", async ({ page, context }) => {
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

  await installMissionDockMocks(page);

  await page.goto("/?mission=mission-1");

  const dock = page.getByRole("region", { name: "Context Dock" });
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("dock-step-status")).toHaveText("RUNNING");
  await expect(dock.getByTestId("dock-step-timeline")).toBeVisible();
  await expect(dock.getByTestId("dock-step-1")).toContainText("RUNNING");
  await expect(dock.getByTestId("dock-step-2")).toContainText("PENDING");
  await expect(page.getByRole("heading", { name: "WORKBENCH", exact: true }).first()).toBeVisible();

  await dock.getByRole("button", { name: "Dock Tasks" }).click();
  await expect(page.getByRole("heading", { name: "TASK MANAGER", exact: true }).first()).toBeVisible();
  await expect(dock.getByRole("button", { name: "Recommended Workbench" })).toBeVisible();
  await expect(dock.getByTestId("dock-auto-focus-hold")).toContainText("MANUAL HOLD");

  const autoFocusToggle = dock.getByRole("button", { name: "Mission Auto Focus Toggle" });
  await autoFocusToggle.click();
  await expect(autoFocusToggle).toContainText("AUTO FOCUS OFF");
  await expect
    .poll(() =>
      page.evaluate(() => {
        return window.localStorage.getItem("jarvis.hud.mission.auto_focus");
      })
    )
    .toBe("0");

  await dock.getByRole("button", { name: "Recommended Workbench" }).click();
  await expect(page.getByRole("heading", { name: "WORKBENCH", exact: true }).first()).toBeVisible();
});
