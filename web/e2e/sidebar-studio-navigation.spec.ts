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

  await page.route(`${API_BASE}/api/v1/dossiers**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/dossiers") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ dossiers: [] })),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        request_id: "req-e2e",
        error: { code: "NOT_FOUND", message: "dossier not found" },
      }),
    });
  });

  await page.route(`${API_BASE}/api/v1/skills**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ skills: [] })),
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
    { ariaLabel: "Mission Control", headings: ["ORCHESTRATION HUB", "AI ASSISTANT", "TASK MANAGER"] },
    { ariaLabel: "Code", headings: ["AI ASSISTANT", "TASK MANAGER", "WORKBENCH"] },
    { ariaLabel: "Research", headings: ["DOSSIER ARCHIVE", "WATCHERS", "AI ASSISTANT"] },
    { ariaLabel: "Intelligence", headings: ["SYSTEM REPORTS", "ACTION CENTER", "NOTIFICATIONS"] },
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
    { path: "/mission?mission=mid-1&step=sid-1", headings: ["ORCHESTRATION HUB", "AI ASSISTANT", "TASK MANAGER"] },
    { path: "/studio/code", headings: ["AI ASSISTANT", "TASK MANAGER", "WORKBENCH"] },
    { path: "/studio/research", headings: ["DOSSIER ARCHIVE", "WATCHERS", "AI ASSISTANT"] },
    { path: "/studio/finance", headings: ["SYSTEM REPORTS", "ACTION CENTER", "NOTIFICATIONS"] },
    { path: "/studio/news", headings: ["SYSTEM REPORTS", "ACTION CENTER", "NOTIFICATIONS"] },
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

test("research preset keeps watcher create form clickable beside empty dossier state", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "member");
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

  const watchers: Array<{
    id: string;
    userId: string;
    kind: string;
    title: string;
    query: string;
    status: string;
    lastRunAt: string | null;
    createdAt: string;
    updatedAt: string;
  }> = [];

  await page.route(`${API_BASE}/api/v1/watchers**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/watchers" && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ watchers })),
      });
      return;
    }
    if (path === "/api/v1/watchers" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { kind: string; title: string; query: string };
      watchers.unshift({
        id: "watcher-e2e-1",
        userId: "00000000-0000-4000-8000-000000000000",
        kind: body.kind,
        title: body.title,
        query: body.query,
        status: "active",
        lastRunAt: null,
        createdAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(envelope(watchers[0])),
      });
      return;
    }
    if (path === "/api/v1/watchers/watcher-e2e-1/run" && route.request().method() === "POST") {
      watchers[0] = {
        ...watchers[0],
        lastRunAt: "2026-03-06T00:05:00.000Z",
        updatedAt: "2026-03-06T00:05:00.000Z",
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            watcher: watchers[0],
            run: {
              id: "watcher-run-e2e-1",
              watcherId: watchers[0].id,
              userId: watchers[0].userId,
              status: "completed",
              summary: "Synthetic watcher run completed",
              briefingId: "briefing-e2e-1",
              dossierId: "dossier-e2e-1",
              error: null,
              createdAt: "2026-03-06T00:05:00.000Z",
              updatedAt: "2026-03-06T00:05:00.000Z",
            },
            briefing: {
              id: "briefing-e2e-1",
            },
            dossier: {
              id: "dossier-e2e-1",
            },
          })
        ),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/studio/research");
  await expect(page).not.toHaveURL(/\/studio\//);
  await expect(page.getByRole("heading", { name: "WATCHERS", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "DOSSIERS", exact: true }).first()).toBeVisible();
  await page
    .locator("main")
    .filter({ has: page.getByText("Grounded research archive") })
    .first()
    .getByRole("button", { name: "LIST", exact: true })
    .click();

  await page.getByPlaceholder("Watcher title").fill("Research lane watcher");
  await page.getByPlaceholder("What should Jarvis monitor?").fill("world major news and war updates");
  await page.getByRole("button", { name: "ADD", exact: true }).click();
  await page
    .locator("main")
    .filter({ has: page.getByText("Proactive monitoring lanes") })
    .first()
    .locator("div.rounded.border")
    .filter({ has: page.getByText("Research lane watcher") })
    .first()
    .getByRole("button", { name: "RUN", exact: true })
    .click();
  await page
    .locator("main")
    .filter({ has: page.getByText("Grounded research archive") })
    .first()
    .getByRole("button", { name: "LIST", exact: true })
    .click();

  await expect(page.getByText("Research lane watcher")).toBeVisible();
  await expect(page.getByText("external_topic · world major news and war updates")).toBeVisible();
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

test("approving an action refreshes inbox pending actions", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "member");
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

  let pendingCount = 1;
  const sessionRecord = {
    id: "session-approval-1",
    userId: "00000000-0000-4000-8000-000000000000",
    title: "Approve process launch in Inbox Sync Runtime",
    prompt: "node -p process.version",
    source: "workspace_runtime",
    intent: "code",
    status: "needs_approval",
    workspacePreset: "execution",
    primaryTarget: "execution",
    taskId: null,
    missionId: null,
    assistantContextId: null,
    councilRunId: null,
    executionRunId: null,
    briefingId: null,
    dossierId: null,
    lastEventAt: "2026-03-06T00:01:00.000Z",
    createdAt: "2026-03-06T00:01:00.000Z",
    updatedAt: "2026-03-06T00:01:00.000Z",
  };
  const actionRecord = {
    id: "action-approval-1",
    userId: sessionRecord.userId,
    sessionId: sessionRecord.id,
    kind: "workspace_prepare",
    title: sessionRecord.title,
    summary: "A runtime or script process is expected to start.",
    status: "pending",
    payload: {
      command: "node -p process.version",
      cwd: "/workspace",
      risk_level: "build",
      policy_severity: "high",
      impact_profile: "process_launch",
      workspace_kind: "current",
      policy_disposition: "approval_required",
      policy_reason: "runtime or script launch on host or worktree runtimes requires approval",
      impact: {
        files: {
          level: "possible",
          summary: "Build artifacts, caches, or local outputs may be created.",
          targets: ["process.version"],
        },
        network: {
          level: "none",
          summary: "No external network access expected unless the tool fetches dependencies implicitly.",
          targets: [],
        },
        processes: {
          level: "expected",
          summary: "A runtime or script process is expected to start.",
          targets: ["node -p", "process.version"],
        },
        notes: ["Targets the primary repository checkout on the host."],
      },
    },
    decidedAt: null,
    decidedBy: null,
    createdAt: "2026-03-06T00:01:00.000Z",
    updatedAt: "2026-03-06T00:01:00.000Z",
  };

  await page.route(`${API_BASE}/api/v1/jarvis/sessions**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/jarvis/sessions") {
      const sessions = pendingCount > 0 ? [sessionRecord] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ sessions })),
      });
      return;
    }
    if (path === `/api/v1/jarvis/sessions/${sessionRecord.id}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            session: {
              ...sessionRecord,
              status: pendingCount > 0 ? "needs_approval" : "completed",
            },
            events: [],
            actions: pendingCount > 0 ? [actionRecord] : [],
            briefing: null,
            dossier: null,
          })
        ),
      });
      return;
    }
    await route.fallback();
  });

  await page.route(`${API_BASE}/api/v1/jarvis/sessions/${sessionRecord.id}/actions/${actionRecord.id}/approve`, async (route) => {
    pendingCount = 0;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          session: { ...sessionRecord, status: "running" },
          action: { ...actionRecord, status: "approved" },
        })
      ),
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "INBOX", exact: true }).first()).toBeVisible();
  await expect(page.getByText("1 proposal(s) waiting.")).toBeVisible();

  await page.getByRole("button", { name: "Action Center", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ACTION CENTER", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "APPROVE", exact: true }).click();

  await expect(page.getByText("0 proposal(s) waiting.")).toBeVisible();
});

test("approval-required workspace commands hide stale transcript until approval", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "member");
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

  const workspace = {
    id: "workspace-e2e",
    userId: "00000000-0000-4000-8000-000000000000",
    name: "Approval Replay Runtime",
    cwd: "/workspace",
    kind: "current",
    baseRef: null,
    sourceWorkspaceId: null,
    containerName: null,
    containerImage: null,
    containerSource: null,
    containerImageManaged: false,
    containerBuildContext: null,
    containerDockerfile: null,
    containerFeatures: [],
    containerAppliedFeatures: [],
    containerWorkdir: null,
    containerConfigPath: null,
    containerRunArgs: [],
    containerWarnings: [],
    status: "stopped",
    approvalRequired: true,
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
    sessionId: "workspace-session-e2e",
    activeCommand: null,
    exitCode: 0,
    lastError: null,
  };

  await page.route(`${API_BASE}/api/v1/workspaces`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ workspaces: [workspace] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/workspaces/${workspace.id}/pty/read**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          workspace,
          chunks: [
            {
              sequence: 1,
              stream: "system",
              text: "command started: printf PREVIOUS-OUTPUT",
              createdAt: "2026-03-06T00:00:00.000Z",
            },
            {
              sequence: 2,
              stream: "stdout",
              text: "PREVIOUS-OUTPUT\\n",
              createdAt: "2026-03-06T00:00:00.100Z",
            },
            {
              sequence: 3,
              stream: "system",
              text: "command exited with code 0",
              createdAt: "2026-03-06T00:00:00.200Z",
            },
          ],
          nextSequence: 4,
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/workspaces/${workspace.id}/pty/spawn`, async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          workspace,
          low_risk: false,
          requires_approval: true,
          policy: {
            normalizedCommand: "node -p process.version",
            riskLevel: "build",
            impactProfile: "process_launch",
            severity: "high",
            disposition: "approval_required",
            reason: "runtime or script launch on host or worktree runtimes requires approval",
            impact: {
              files: {
                level: "possible",
                summary: "Build artifacts, caches, or local outputs may be created.",
                targets: ["process.version"],
              },
              network: {
                level: "none",
                summary: "No external network access expected unless the tool fetches dependencies implicitly.",
                targets: [],
              },
              processes: {
                level: "expected",
                summary: "A runtime or script process is expected to start.",
                targets: ["node -p", "process.version"],
              },
              notes: ["Targets the primary repository checkout on the host."],
            },
          },
          session: {
            id: "jarvis-session-e2e",
            userId: workspace.userId,
            title: "Approve process launch in Approval Replay Runtime",
            prompt: "node -p process.version",
            source: "workspace_runtime",
            intent: "code",
            status: "needs_approval",
            workspacePreset: "execution",
            primaryTarget: "execution",
            taskId: null,
            missionId: null,
            assistantContextId: null,
            councilRunId: null,
            executionRunId: null,
            briefingId: null,
            dossierId: null,
            lastEventAt: "2026-03-06T00:01:00.000Z",
            createdAt: "2026-03-06T00:01:00.000Z",
            updatedAt: "2026-03-06T00:01:00.000Z",
          },
          action: {
            id: "action-e2e",
            userId: workspace.userId,
            sessionId: "jarvis-session-e2e",
            kind: "workspace_prepare",
            title: "Approve process launch in Approval Replay Runtime",
            summary: "A runtime or script process is expected to start.",
            status: "pending",
            payload: {},
            decidedAt: null,
            decidedBy: null,
            createdAt: "2026-03-06T00:01:00.000Z",
            updatedAt: "2026-03-06T00:01:00.000Z",
          },
        })
      ),
    });
  });

  await page.goto("/studio/code");
  await expect(page).not.toHaveURL(/\/studio\//);
  await expect(page.getByRole("heading", { name: "WORKBENCH", exact: true }).first()).toBeVisible();
  const dock = page.getByRole("region", { name: "Context Dock" });
  await expect(dock).toBeVisible();
  const runCommandButton = page.getByRole("button", { name: "RUN COMMAND" });
  await runCommandButton.scrollIntoViewIfNeeded();
  const [runButtonBox, dockBox] = await Promise.all([runCommandButton.boundingBox(), dock.boundingBox()]);
  expect(runButtonBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  const runButtonBottom = (runButtonBox?.y ?? 0) + (runButtonBox?.height ?? 0);
  expect(runButtonBottom < (dockBox?.y ?? Number.POSITIVE_INFINITY) - 4).toBe(true);
  const workspaceRuntimePanel = page
    .getByRole("button", { name: "RUN COMMAND" })
    .locator('xpath=ancestor::div[contains(@class,"space-y-3")][1]');
  const workspaceTranscript = workspaceRuntimePanel.locator("pre");

  await expect(workspaceTranscript).toContainText("PREVIOUS-OUTPUT");

  await page.getByPlaceholder("pwd | git status | rg TODO src").fill("node -p process.version");
  await runCommandButton.click();

  await expect(workspaceRuntimePanel).toContainText("Approval queued: Approve process launch in Approval Replay Runtime (build)");
  await expect(workspaceTranscript).toContainText(
    "Approval pending. Existing workspace output is hidden until this command is approved."
  );
  await expect(workspaceTranscript).not.toContainText("PREVIOUS-OUTPUT");
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
